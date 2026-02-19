# Getting Started

## Prerequisites
- Node.js 20 LTS
- PostgreSQL 15+
- Redis 7+
- Docker & Docker Compose

## Quick Start

1. Clone the repository:
```bash
git clone https://github.com/example/project.git
cd project
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start services:
```bash
docker-compose up -d
npm run migrate
npm run dev
```

5. Open http://localhost:3000

## Project Structure
- `src/` — Application source code
- `test/` — Test files
- `docs/` — Documentation
- `infra/` — Infrastructure configs
