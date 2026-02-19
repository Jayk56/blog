# Architecture Overview

## System Components

### Frontend
- React 18 with TypeScript
- Vite build toolchain
- State management via React Context + useReducer
- API communication via REST client

### Backend
- Express.js with TypeScript
- PostgreSQL for persistent storage
- Redis for caching and session management
- JWT-based authentication

### Infrastructure
- Docker containers on AWS ECS Fargate
- RDS for managed PostgreSQL
- ElastiCache for managed Redis
- CloudFront CDN for static assets

## Data Flow
```
Client → CloudFront → ALB → ECS (Express) → PostgreSQL
                                          → Redis (cache)
```

## Key Design Decisions
1. **Monorepo**: Single repository for frontend, backend, and infrastructure code
2. **REST API**: Simple, well-understood protocol for client-server communication
3. **PostgreSQL**: ACID compliance, JSONB support, mature ecosystem
4. **Redis caching**: Sub-millisecond latency for frequently accessed data
5. **Container-based deployment**: Reproducible environments, easy scaling
