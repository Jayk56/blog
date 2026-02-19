# Monitoring & Observability Research

## Three Pillars

### Metrics (Prometheus + Grafana)
- Request rate, error rate, duration (RED metrics)
- System metrics: CPU, memory, disk, network
- Custom business metrics: signups, conversions
- Alert thresholds based on SLO budgets

### Logging (Structured JSON)
- Use structured logging (pino recommended)
- Log levels: error, warn, info, debug
- Include correlation IDs for request tracing
- Ship to centralized log aggregation (ELK/Loki)

### Tracing (OpenTelemetry)
- Distributed tracing across services
- Auto-instrumentation for HTTP, database, Redis
- Sample rate: 10% in production, 100% in staging
- Visualize with Jaeger or Tempo

## Recommended Stack
| Component | Tool | Justification |
|-----------|------|---------------|
| Metrics | Prometheus | Industry standard, pull-based |
| Dashboards | Grafana | Flexible, team familiarity |
| Logging | Pino + Loki | Fast, structured, cost-effective |
| Tracing | OpenTelemetry | Vendor-neutral, growing ecosystem |
| Alerting | Alertmanager | Integrates with Prometheus |

## SLO Definitions
- Availability: 99.9% (43 min/month error budget)
- Latency p95: < 500ms
- Error rate: < 0.1%
