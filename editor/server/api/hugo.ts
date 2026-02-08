import express, { Router, Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

const router = Router();

// Hugo process tracking
let hugoProcess: ChildProcess | null = null;
const HUGO_PORT = 1314;

// Helper to get repo root from app locals
function getRepoRoot(req: Request): string {
  return req.app.locals.repoRoot;
}

// Helper to get broadcast function from app locals
function getBroadcast(req: Request): Function {
  return req.app.locals.broadcast;
}

// POST /api/hugo/start - Start Hugo server
router.post('/hugo/start', async (req: Request, res: Response) => {
  try {
    const repoRoot = getRepoRoot(req);
    const broadcast = getBroadcast(req);

    // If Hugo is already running, return success
    if (hugoProcess) {
      return res.json({ port: HUGO_PORT, message: 'Hugo server already running' });
    }

    const hugoSourcePath = path.join(repoRoot, 'jkerschner.com');

    // Spawn Hugo process
    hugoProcess = spawn('hugo', [
      'server',
      '--port', HUGO_PORT.toString(),
      '--source', hugoSourcePath,
      '--disableFastRender',
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:${process.env.PATH}`,
      },
    });

    let hugoStarted = false;

    // Handle stdout
    hugoProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log('[Hugo]', output.trim());

      // Check if Hugo is running
      if (output.includes('Web Server is available')) {
        if (!hugoStarted) {
          hugoStarted = true;
          broadcast({
            type: 'hugo-started',
            port: HUGO_PORT,
          });
        }
      }
    });

    // Handle stderr
    hugoProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      console.log('[Hugo Error]', output.trim());
    });

    // Handle process exit
    hugoProcess.on('exit', (code) => {
      console.log(`[Hugo] Process exited with code ${code}`);
      hugoProcess = null;

      broadcast({
        type: 'hugo-stopped',
        exitCode: code,
      });
    });

    // Handle process errors
    hugoProcess.on('error', (err) => {
      console.error('[Hugo] Process error:', err);
      hugoProcess = null;

      broadcast({
        type: 'hugo-error',
        error: err.message,
      });
    });

    res.json({
      port: HUGO_PORT,
      message: 'Hugo server starting',
    });
  } catch (err) {
    console.error('[POST /hugo/start] Error:', err);
    res.status(500).json({ error: 'Failed to start Hugo server' });
  }
});

// POST /api/hugo/stop - Stop Hugo server
router.post('/hugo/stop', async (req: Request, res: Response) => {
  try {
    if (!hugoProcess) {
      return res.json({ success: true, message: 'Hugo server not running' });
    }

    hugoProcess.kill('SIGTERM');

    // Wait a bit for graceful shutdown
    setTimeout(() => {
      if (hugoProcess) {
        hugoProcess.kill('SIGKILL');
      }
    }, 5000);

    res.json({ success: true });
  } catch (err) {
    console.error('[POST /hugo/stop] Error:', err);
    res.status(500).json({ error: 'Failed to stop Hugo server' });
  }
});

// GET /api/hugo/status - Get Hugo server status
router.get('/hugo/status', async (req: Request, res: Response) => {
  try {
    const running = hugoProcess !== null;

    res.json({
      running,
      port: running ? HUGO_PORT : null,
    });
  } catch (err) {
    console.error('[GET /hugo/status] Error:', err);
    res.status(500).json({ error: 'Failed to get Hugo status' });
  }
});

export default router;
