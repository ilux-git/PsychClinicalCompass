"""Read-only source snapshot -> custom dump -> empty *_restore_test database.

URLs come from environment variables; no credentials or patient rows are reported.
Requires matching PostgreSQL client utilities on PATH or --pg-bin.
"""
import argparse
import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import time

import asyncpg
from sqlalchemy.engine import make_url


class VerificationError(Exception):
    pass


@dataclass(frozen=True)
class Database:
    dsn: str
    name: str
    environment: dict[str, str]


def database_from_env(key: str) -> Database:
    value = os.environ.get(key)
    if not value:
        raise VerificationError(f"Missing environment variable: {key}")
    url = make_url(value)
    if url.drivername not in {"postgresql", "postgresql+asyncpg"} or not url.database or not url.host or not url.username:
        raise VerificationError("Explicit PostgreSQL host/user/database required")
    if set(url.query) - {"sslmode"}:
        raise VerificationError("Only sslmode URL option is supported by this verification utility")
    environment = {key: value for key, value in os.environ.items() if not key.upper().startswith("PG")}
    environment.update(PGHOST=url.host, PGPORT=str(url.port or 5432), PGUSER=url.username,
                       PGPASSWORD=url.password or "", PGDATABASE=url.database, PGCONNECT_TIMEOUT="5")
    if "sslmode" in url.query:
        environment["PGSSLMODE"] = str(url.query["sslmode"])
    return Database(url.set(drivername="postgresql").render_as_string(hide_password=False), url.database, environment)


def validate_target(source: Database, target: Database) -> None:
    if not target.name.endswith("_restore_test"):
        raise VerificationError("Target database name must end with _restore_test")
    if source.name == target.name:
        raise VerificationError("Source and target database names must differ")


def quoted(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


async def assert_empty_target(connection) -> None:
    objects = await connection.fetchval("""
        SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%')
             + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname NOT IN ('pg_catalog','information_schema'))
             + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
                WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%')
    """)
    if objects:
        raise VerificationError("Target must be empty: existing relations, functions or types found")


async def fingerprints(connection) -> dict:
    tables = await connection.fetch("""
        SELECT schemaname, tablename FROM pg_tables
        WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname, tablename
    """)
    result = {}
    for table in tables:
        name = f'{quoted(table["schemaname"])}.{quoted(table["tablename"])}'
        digest, count = hashlib.sha256(), 0
        # DB-native JSON preserves exact numeric values; ordering ignores physical row order.
        query = f'SELECT row_to_json(t)::text FROM {name} t ORDER BY row_to_json(t)::text COLLATE "C"'
        async for row in connection.cursor(query, prefetch=500):
            digest.update(row[0].encode("utf-8") + b"\n")
            count += 1
        result[f'{table["schemaname"]}.{table["tablename"]}'] = {"rows": count, "sha256": digest.hexdigest()}
    return result


async def verify_sequences(connection) -> list[dict]:
    columns = await connection.fetch("""
        SELECT table_schema, table_name, column_name,
               pg_get_serial_sequence(format('%I.%I',table_schema,table_name),column_name) AS sequence
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog','information_schema')
          AND (column_default LIKE 'nextval(%' OR is_identity='YES')
        ORDER BY table_schema, table_name, column_name
    """)
    results = []
    for column in columns:
        sequence = column["sequence"]  # pg_get_serial_sequence supplies a qualified, quoted identifier.
        if not sequence:
            raise VerificationError("Sequence ownership not found")
        state = await connection.fetchrow(f"SELECT last_value, is_called FROM {sequence}")
        increment = await connection.fetchval("SELECT seqincrement FROM pg_sequence WHERE seqrelid=$1::regclass", sequence)
        if increment <= 0:
            raise VerificationError("This verifier expects increasing application sequences")
        table = f'{quoted(column["table_schema"])}.{quoted(column["table_name"])}'
        maximum = await connection.fetchval(f'SELECT max({quoted(column["column_name"])}) FROM {table}')
        next_value = state["last_value"] + (increment if state["is_called"] else 0)
        ok = maximum is None or next_value > maximum
        results.append({"table": f'{column["table_schema"]}.{column["table_name"]}',
                        "column": column["column_name"], "next_value_exceeds_maximum": ok})
    if not all(row["next_value_exceeds_maximum"] for row in results):
        raise VerificationError("Restored sequence can collide with existing rows")
    return results


def executable(name: str, pg_bin: Path | None) -> str:
    path = str(pg_bin / (name + (".exe" if os.name == "nt" else ""))) if pg_bin else shutil.which(name)
    if not path or not Path(path).is_file():
        raise VerificationError(f"PostgreSQL utility not found: {name}")
    return path


async def run_utility(command: list[str], environment: dict[str, str]) -> float:
    start = time.perf_counter()
    process = await asyncio.create_subprocess_exec(*command, env=environment,
                                                 stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        await asyncio.wait_for(process.communicate(), timeout=300)
    except TimeoutError:
        process.kill()
        await process.communicate()
        raise VerificationError("PostgreSQL utility timed out") from None
    if process.returncode:
        # pg_restore errors can contain rows/SQL. Do not include raw stderr in reports or logs.
        raise VerificationError(f"{Path(command[0]).stem} failed with exit code {process.returncode}")
    return round(time.perf_counter() - start, 3)


async def verify(args) -> dict:
    source = database_from_env(args.source_env)
    target = database_from_env(args.target_env)
    validate_target(source, target)
    dump_tool = executable("pg_dump", args.pg_bin)
    restore_tool = executable("pg_restore", args.pg_bin)
    target_connection = await asyncpg.connect(target.dsn, timeout=5)
    source_connection = None
    try:
        actual_target = await target_connection.fetchval("SELECT current_database()")
        if actual_target != target.name:
            raise VerificationError("Target identity differs from URL")
        await assert_empty_target(target_connection)
        source_connection = await asyncpg.connect(source.dsn, timeout=5)
        if await source_connection.fetchval("SELECT current_database()") == actual_target:
            raise VerificationError("Source and target identities must differ")
        args.output.mkdir(parents=True, exist_ok=True)
        if any(args.output.iterdir()):
            raise VerificationError("Output directory must be empty")
        archive = args.output / "compass.dump"
        for connection in (source_connection, target_connection):
            await connection.execute("SET TIME ZONE 'UTC'")
            await connection.execute("SET DateStyle TO ISO, YMD")
        async with source_connection.transaction(isolation="repeatable_read", readonly=True):
            snapshot = await source_connection.fetchval("SELECT pg_export_snapshot()")
            snapshot_at = await source_connection.fetchval("SELECT transaction_timestamp()")
            expected = await fingerprints(source_connection)
            backup_seconds = await run_utility([dump_tool, "--format=custom", "--no-owner", "--no-acl",
                                               f"--snapshot={snapshot}", f"--file={archive}"], source.environment)
        await assert_empty_target(target_connection)
        restore_seconds = await run_utility([restore_tool, "--no-owner", "--no-acl", "--exit-on-error",
                                             "--single-transaction", f"--dbname={target.name}", str(archive)], target.environment)
        async with target_connection.transaction(isolation="repeatable_read", readonly=True):
            actual = await fingerprints(target_connection)
            sequences = await verify_sequences(target_connection)
        if actual != expected:
            raise VerificationError("Restored table counts/checksums differ from the exported source snapshot")
        archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
        report = {"verified_at": datetime.now(timezone.utc).isoformat(), "source_database": source.name,
                  "target_database": target.name, "snapshot_at": snapshot_at.isoformat(),
                  "consistent_exported_snapshot": True, "source_modified": False,
                  "backup_seconds": backup_seconds, "restore_seconds": restore_seconds,
                  "archive_bytes": archive.stat().st_size, "archive_sha256": archive_hash,
                  "tables": actual, "sequences": sequences, "data_match": True,
                  "scope": "Single synthetic Compass database; not a full-service RTO/RPO or MIS recovery test"}
        (args.output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return report
    finally:
        if source_connection:
            await source_connection.close()
        await target_connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-env", default="COMPASS_DATABASE_URL")
    parser.add_argument("--target-env", default="RESTORE_TEST_DATABASE_URL")
    parser.add_argument("--output", type=Path, required=True, help="New empty output directory; archive contains all source data")
    parser.add_argument("--pg-bin", type=Path)
    args = parser.parse_args()
    try:
        report = asyncio.run(verify(args))
    except VerificationError as error:
        parser.exit(1, f"Verification stopped: {error}\n")
    except Exception as error:
        parser.exit(1, f"Verification stopped: {type(error).__name__}; credentials and database contents suppressed\n")
    print(f'Backup/restore verified: {len(report["tables"])} tables, {len(report["sequences"])} sequences; '
          f'backup {report["backup_seconds"]}s, restore {report["restore_seconds"]}s. Report: {args.output / "report.json"}')


if __name__ == "__main__":
    main()
