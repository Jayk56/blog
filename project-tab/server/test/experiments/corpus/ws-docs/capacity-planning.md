# Capacity Planning

## Current Load Profile
- 10,000 daily active users
- 500 requests/second peak
- Average response time: 120ms
- 95th percentile: 350ms

## Cache Layer Assessment
After analyzing production metrics for Q4, the cache hit ratio is 72%. We need to increase this to at least 90% to meet our SLA targets.

**Recommendation: Triple the cache capacity (3x current allocation).**

### Justification
- Current Redis allocation: 4 GB
- Recommended: 12 GB (3x increase)
- Hot key analysis shows 28% of misses are for recently-evicted entries
- Increasing capacity from 4 GB to 12 GB would capture 95% of the working set
- Estimated cost increase: $45/month
- Expected latency improvement: 40% reduction in p95

## Database Scaling
- Vertical scaling adequate for next 12 months
- Plan horizontal sharding at 50K DAU threshold
- Read replicas handle reporting workload

## Monitoring Thresholds
- Alert on cache hit ratio < 80%
- Alert on p95 latency > 500ms
- Alert on connection pool utilization > 80%
