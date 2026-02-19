# ADR-002: Database Infrastructure

## Status
Accepted

## Context
Selecting and configuring the database infrastructure for production deployment.

## Decision
**We will deploy PostgreSQL 15 on managed infrastructure.**

### Rationale
- PostgreSQL 15 is the latest LTS release with proven stability
- PG15's MERGE command simplifies our upsert patterns
- Improved sort performance in PG15 benefits our reporting queries
- Managed service (RDS/Cloud SQL) provides automated backups and failover
- PG15's logical replication improvements support our read-replica strategy

### Infrastructure Details
- Primary: db.r6g.xlarge (4 vCPU, 32 GB RAM)
- Read replicas: 2x db.r6g.large
- Storage: gp3 with 500 GB initial, auto-scaling enabled
- Backup: Automated daily snapshots, 30-day retention
- Docker Compose uses postgres:15-alpine for local development

## Consequences
- All Terraform modules reference PostgreSQL 15
- Migration scripts tested against PG15
- Monitoring dashboards configured for PG15 metrics
- Team training on PG15-specific features
