# Services

Frontend service layer for connecting to the project-tab backend.

## Architecture

```
[WebSocket]          [REST API Client]
     |                      |
     v                      v
[WebSocketService] ---> [State Adapter] ---> dispatch(action)
                              |
                              v
                    [projectReducer (existing)]
```

## Files

- **api-client.ts** — Typed REST client for all backend endpoints (fetch-based)
- **ws-service.ts** — WebSocket connection manager with reconnect + typed handlers
- **state-adapter.ts** — Maps backend types to frontend types
- **index.ts** — Barrel export

## Modes

- **Mock mode** (default): No `VITE_API_URL` set. Uses scenario data.
- **Live mode**: Set `VITE_API_URL=http://localhost:3001/api` and optionally `VITE_WS_URL=ws://localhost:3001`.

## Usage

```bash
# Mock mode (default)
npm run dev

# Live mode
VITE_API_URL=http://localhost:3001/api npm run dev
```
