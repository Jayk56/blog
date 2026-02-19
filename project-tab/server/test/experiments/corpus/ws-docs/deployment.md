# Deployment Guide

## Environments
| Environment | URL | Branch |
|-------------|-----|--------|
| Development | dev.example.com | develop |
| Staging | staging.example.com | release/* |
| Production | app.example.com | main |

## CI/CD Pipeline
1. Push to branch triggers CI
2. Tests, lint, type-check run in parallel
3. Docker image built and tagged
4. Image pushed to ECR
5. ECS service updated with new task definition

## Rollback Procedure
1. Identify the last known good task definition revision
2. Update ECS service to previous revision:
```bash
aws ecs update-service --cluster app-production \
  --service app-service \
  --task-definition app:PREVIOUS_REVISION
```
3. Monitor health checks for 5 minutes
4. Investigate root cause of failed deployment

## Health Checks
- `/health` — Basic liveness check
- `/health/ready` — Readiness check (DB + Redis connectivity)
- `/health/detailed` — Full system status (admin only)
