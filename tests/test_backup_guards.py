import pytest

from scripts.verify_backup_restore import Database, VerificationError, database_from_env, validate_target


@pytest.mark.parametrize("source,target", [
    ("compass_dev", "compass_dev"),
    ("compass_dev", "production"),
    ("compass_restore_test", "compass_restore_test"),
])
def test_restore_rejects_working_or_same_database_before_connecting(source, target):
    with pytest.raises(VerificationError):
        validate_target(Database("", source, {}), Database("", target, {}))


def test_connection_credentials_are_environment_only(monkeypatch):
    monkeypatch.setenv("SOURCE_DATABASE_URL", "postgresql+asyncpg://demo:secret%21@localhost:55432/compass_dev")
    connection = database_from_env("SOURCE_DATABASE_URL")
    assert connection.environment["PGPASSWORD"] == "secret!"
    assert connection.environment["PGDATABASE"] == "compass_dev"
    validate_target(connection, Database("", "compass_restore_test", {}))
