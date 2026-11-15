#!/bin/sh
set -eu
for database in causalotel_user causalotel_product causalotel_order causalotel_payment causalotel_inventory; do
  psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 \
    --command "CREATE DATABASE \"${database}\" OWNER \"${POSTGRES_USER}\";"
done
