import express, { Express } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { createProxyMiddleware } from 'http-proxy-middleware';

// Import API routes
import postsRouter from './api/posts';
import filesRouter from './api/files';
import pipelineRouter from './api/pipeline';
import hugoRouter from './api/hugo';

// Import watcher
import { startWatcher } from './watcher';

const app: Express = express();
const server = createServer(app);
const wss = new WebSocketServer({ port: 3001 });

// Store active WebSocket connections
const wsConnections = new Set<WebSocket>();

// Constants
const PORT = 3000;
const REPO_ROOT = path.resolve(__dirname, '../..');
const IS_DEV = process.env.NODE_ENV !== 'production';

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:3001'],
  credentials: true,
}));

app.use(express.json());
app.use(express.text({ type: 'text/plain' }));
app.use(express.urlencoded({ extended: true }));

// In dev mode, proxy Vite dev server
if (IS_DEV) {
  app.use(
    '/src',
    createProxyMiddleware({
      target: 'http://localhost:5173',
      changeOrigin: true,
      pathRewrite: { '^/src': '' },
      ws: true,
    })
  );

  // HMR proxy for Vite
  app.use(
    '/@vite',
    createProxyMiddleware({
      target: 'http://localhost:5173',
      changeOrigin: true,
      pathRewrite: { '^/@vite': '/@vite' },
      ws: true,
    })
  );
}

// Expose REPO_ROOT for API routes
app.locals.repoRoot = REPO_ROOT;

// Mount API routes
app.use('/api', postsRouter);
app.use('/api', filesRouter);
app.use('/api', pipelineRouter);
app.use('/api', hugoRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Broadcast function - exported for use by watcher and pipeline
export function broadcast(event: any) {
  wsConnections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  });
}

// Export broadcast to modules that need it
app.locals.broadcast = broadcast;

// WebSocket server
wss.on('connection', (ws: WebSocket) => {
  console.log('[WS] Client connected');
  wsConnections.add(ws);

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
    wsConnections.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('[WS] Error:', error);
    wsConnections.delete(ws);
  });

  // Send welcome message
  ws.send(JSON.stringify({ type: 'connected', message: 'Connected to server' }));
});

// Start file watcher
startWatcher(broadcast, REPO_ROOT);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`[Server] Express server listening on port ${PORT}`);
  console.log(`[Server] WebSocket server listening on port 3001`);
  console.log(`[Server] Repo root: ${REPO_ROOT}`);
  console.log(`[Server] Environment: ${IS_DEV ? 'development' : 'production'}`);
});

export default app;
