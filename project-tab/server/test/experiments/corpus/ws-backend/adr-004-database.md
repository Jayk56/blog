# ADR-004: Database Strategy

## Status
Accepted

## Context
Choosing the primary database for the application's relational data storage needs.

## Decision
**We will use PostgreSQL 16 as our primary database.**

### Rationale
- PostgreSQL 16 introduces logical replication improvements critical for our HA strategy
- JSONB column support for semi-structured data reduces need for a document store
- Parallel query improvements in PG16 benefit our analytics workloads
- The pg_stat_io view (new in PG16) enables better I/O monitoring
- We specifically rely on PG16's new COPY ... DEFAULT syntax for bulk imports

## Consequences
- All migrations target PostgreSQL 16+ features
- Docker Compose uses postgres:16-alpine image
- CI tests run against PostgreSQL 16
- Backup strategy uses pg_basebackup with PG16 incremental backup support
