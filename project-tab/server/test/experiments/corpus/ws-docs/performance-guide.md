# Performance Guide

## Caching Strategy

### Redis Caching Layer
Our application uses Redis as the primary caching layer. All cacheable queries should go through the Redis cache before hitting the database.

**Key patterns:**
- `user:{id}` — User profile cache, TTL 5 minutes
- `project:{id}` — Project data cache, TTL 10 minutes
- `query:{hash}` — Query result cache, TTL 1 minute

**Cache invalidation:**
- Write-through for user profiles
- Event-driven invalidation for project data
- TTL-based expiry for query caches

### Connection Pooling
- Redis: max 50 connections per service instance
- PostgreSQL: max 20 connections per service instance
- Connection health checks every 30 seconds

### Response Compression
- Enable gzip for responses > 1KB
- Use Brotli for static assets
- Cache compressed responses in Redis

## Database Optimization
- Use EXPLAIN ANALYZE for query optimization
- Index columns used in WHERE and JOIN clauses
- Prefer batch queries over N+1 patterns
- Use materialized views for complex aggregations
