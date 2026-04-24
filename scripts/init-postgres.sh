#!/bin/bash
set -euo pipefail

for db in omni genie namastex; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<SQL
SELECT 'CREATE DATABASE $db'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$db')\gexec
SQL
done
