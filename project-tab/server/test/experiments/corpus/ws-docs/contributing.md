# Contributing Guide

## Branch Naming
- Feature: `feature/TICKET-description`
- Bug fix: `fix/TICKET-description`
- Docs: `docs/description`

## Commit Messages
Follow Conventional Commits:
- `feat: add user search`
- `fix: resolve auth token expiry`
- `docs: update API reference`
- `chore: bump dependencies`

## Pull Request Process
1. Create branch from `develop`
2. Make changes with tests
3. Ensure all checks pass locally
4. Open PR with description template
5. Request review from team lead
6. Address feedback
7. Squash merge when approved

## Code Standards
- TypeScript strict mode
- 100% type coverage (no `any`)
- Minimum 80% test coverage for new code
- All public APIs documented with JSDoc

## Testing
- Unit tests: `npm test`
- Integration tests: `npm run test:integration`
- E2E tests: `npm run test:e2e`
