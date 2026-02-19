# Testing Strategy Research

## Test Pyramid
Our recommended testing distribution:
- Unit tests: 70% (fast, isolated)
- Integration tests: 20% (API boundaries)
- E2E tests: 10% (critical user flows)

## Framework Comparison

### Vitest (Recommended)
- Native ESM support
- Vite-powered HMR for watch mode
- Compatible with Jest API
- Built-in TypeScript support
- Faster cold start than Jest

### Jest
- Mature ecosystem
- Extensive mocking capabilities
- Slower startup due to transform pipeline
- Well-documented patterns

## Coverage Strategy
- Minimum 80% line coverage for new code
- Critical paths (auth, payments) require 95%+
- Use Istanbul/c8 for coverage reporting
- Coverage gates in CI prevent regression

## Mock Strategy
- Use dependency injection for testability
- Prefer real implementations over mocks when fast enough
- Mock external services at HTTP boundary
- Use factories for test data generation
