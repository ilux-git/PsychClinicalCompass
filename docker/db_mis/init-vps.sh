#!/bin/sh
# New, empty synthetic MIS volume only. Patient tables arrive from a verified dump.
set -eu
: "${MIS_READER_PASSWORD:?MIS_READER_PASSWORD is required}"
psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=reader_password="$MIS_READER_PASSWORD" <<'SQL'
CREATE ROLE mis_reader WITH LOGIN PASSWORD :'reader_password';
GRANT CONNECT ON DATABASE mis TO mis_reader;
GRANT USAGE ON SCHEMA public TO mis_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mis_reader;
ALTER ROLE mis_reader SET default_transaction_read_only = on;
SQL
