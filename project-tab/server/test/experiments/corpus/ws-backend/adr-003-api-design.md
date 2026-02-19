# ADR-003: API Design Approach

## Status
Accepted

## Context
We need to choose an API design approach for communication between our frontend and backend services. The team evaluated REST, GraphQL, and gRPC.

## Decision
**We will use REST with OpenAPI 3.1 specification.**

### Rationale
- REST is well-understood by the team and ecosystem
- OpenAPI spec enables automatic client generation
- Simpler caching via HTTP semantics
- Lower operational complexity than GraphQL
- Better tooling support for monitoring and debugging

### Rejected Alternatives
- **GraphQL**: Over-fetching concerns are minimal for our use case. Added complexity of schema management and resolver optimization not justified. N+1 query problem requires additional infrastructure (DataLoader).
- **gRPC**: Not suitable for browser clients without a proxy layer. Team lacks protobuf expertise.

## Consequences
- All API endpoints follow RESTful conventions
- Request/response schemas defined in OpenAPI 3.1
- Client SDK auto-generated from spec
- Versioning via URL path prefix (/api/v1/)
