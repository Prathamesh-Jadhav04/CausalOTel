# Production deployment

This directory deploys CausalOTel as a single-node production installation on an
Oracle Cloud Always Free Ubuntu VM. It uses PostgreSQL (one database per business
service), Caddy-managed HTTPS, persistent Docker volumes, and an internal-only
application network. It deliberately starts with **empty PostgreSQL databases**;
the repository's prior SQLite files are local-demo data and are not imported.

## Prerequisites

1. Create an Oracle Cloud Always Free VM with Ubuntu, reserve a public IP, and point
   a DNS `A` record for `DOMAIN` at that address.
2. Permit inbound TCP `80` and `443` in the OCI security list/network security group.
   Do not expose database, service, metrics, Tempo, or collector ports.
3. Install Docker Engine and the Compose plugin on the VM. Clone this repository to
   `/opt/causalotel` as a non-root deployment user.
4. Create an OCI Vault secret for the shared token key and database password. Export
   them only into the deployment process (or render the ignored `.env.production`
   file with restrictive permissions).

## Configure and start

```bash
cd /opt/causalotel
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
# Edit DOMAIN and replace both placeholder secrets with cryptographically random values.
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml config --quiet
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml up -d --build
docker compose --env-file deploy/.env.production -f deploy/compose.production.yml ps
```

The first start creates the five databases, applies the PostgreSQL Flyway schemas,
and obtains a Let's Encrypt certificate through Caddy. Confirm `https://DOMAIN/` and
`https://DOMAIN/api/analysis/health/live` return successfully.

## Operations

- Upgrade: `git pull` then run the same `docker compose ... up -d --build` command.
- View logs: `docker compose --env-file deploy/.env.production -f deploy/compose.production.yml logs -f`.
- Back up PostgreSQL before upgrades: use `pg_dump` from the `postgres` container and
  store encrypted backups outside the VM.
- Rotate `AUTH_TOKEN_SECRET` only through a planned maintenance window because it
  invalidates existing signed sessions and service tokens.
- Oracle Always Free is a single VM; it provides restart resilience, not horizontal
  scaling or an SLA. Move PostgreSQL and workloads to managed/replicated services
  before claiming high availability.
