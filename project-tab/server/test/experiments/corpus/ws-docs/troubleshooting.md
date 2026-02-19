# Troubleshooting

## Common Issues

### Database Connection Refused
**Symptom:** `ECONNREFUSED 127.0.0.1:5432`
**Solution:** Ensure PostgreSQL is running:
```bash
docker-compose up -d postgres
```

### Redis Timeout
**Symptom:** `Redis connection timed out`
**Solution:** Check Redis health and increase timeout:
```bash
redis-cli ping
```

### Build Failures
**Symptom:** TypeScript compilation errors after pull
**Solution:** Clean and rebuild:
```bash
rm -rf node_modules dist
npm install
npm run build
```

### Test Flakiness
**Symptom:** Tests pass locally but fail in CI
**Possible causes:**
- Timing-dependent assertions (use `waitFor` helpers)
- Port conflicts (use random ports in tests)
- Database state leaking between tests (ensure cleanup in afterEach)

### Memory Leaks
**Symptom:** Increasing RSS over time
**Debug steps:**
1. Enable `--inspect` flag
2. Connect Chrome DevTools
3. Take heap snapshots at intervals
4. Compare retained objects
