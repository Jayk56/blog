# ADR-001: Frontend Data Fetching Strategy

## Status
Accepted

## Context
We need a data fetching strategy for the frontend that supports complex nested queries and real-time updates.

## Decision
**We will use GraphQL with Apollo Client for all frontend data fetching.**

### Rationale
- GraphQL eliminates over-fetching by requesting only needed fields
- Apollo Client provides excellent caching and state management
- Subscriptions enable real-time updates without additional infrastructure
- Strong typing via codegen from GraphQL schema
- Optimistic updates improve perceived performance

### Implementation Details
- Apollo Client 3.x with InMemoryCache
- GraphQL Code Generator for TypeScript types
- Subscription transport via WebSocket
- Query batching enabled for performance

## Consequences
- All data fetching uses GraphQL queries/mutations
- Frontend team maintains .graphql files alongside components
- Schema changes coordinated between frontend and backend teams
- Apollo DevTools used for debugging
