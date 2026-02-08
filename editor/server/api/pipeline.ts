import express, { Router, Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Job tracking
interface Job {
  jobId: string;
  status: 'running' | 'completed';
  exitCode?: number;
  output: string[];
  process?: ChildProcess;
}

const jobs = new Map<string, Job>();

// Helper to get repo root from app locals
function getRepoRoot(req: Request): string {
  return req.app.locals.repoRoot;
}

// Helper to get broadcast function from app locals
function getBroadcast(req: Request): Function {
  return req.app.locals.broadcast;
}

// Helper to map action to script
function getScriptPath(repoRoot: string, action: string): string | null {
  const scriptMap: Record<string, string> = {
    'transcribe': 'transcribe.sh',
    'increment-transcribe': 'increment-transcribe.sh',
    'preprocess': 'preprocess.sh',
    'draft': 'advance.sh',
    'review': 'advance.sh',
    'collect': 'collect.sh',
    'publish': 'publish.sh',
    'advance': 'advance.sh',
  };

  const script = scriptMap[action];
  if (!script) return null;

  return path.join(repoRoot, 'pipeline/scripts', script);
}

// Helper to get additional arguments based on action
function getAdditionalArgs(action: string): string[] {
  if (action === 'update-preprocess') {
    return ['--update'];
  }
  return [];
}

// POST /api/posts/:slug/pipeline/:action - Run pipeline script
router.post('/posts/:slug/pipeline/:action', async (req: Request, res: Response) => {
  try {
    const repoRoot = getRepoRoot(req);
    const broadcast = getBroadcast(req);
    const { slug, action } = req.params;

    // Get script path (handle update-preprocess as preprocess)
    let scriptAction = action;
    if (action === 'update-preprocess') {
      scriptAction = 'preprocess';
    }

    const scriptPath = getScriptPath(repoRoot, scriptAction);
    if (!scriptPath) {
      return res.status(400).json({ error: 'Invalid pipeline action' });
    }

    const jobId = uuidv4();
    const job: Job = {
      jobId,
      status: 'running',
      output: [],
    };

    jobs.set(jobId, job);

    // Broadcast job start
    broadcast({
      type: 'pipeline-start',
      jobId,
      slug,
      action,
    });

    // Prepare arguments
    const args = [scriptPath, slug];
    const additionalArgs = getAdditionalArgs(action);
    args.push(...additionalArgs);

    // Spawn process
    const proc = spawn('bash', args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:${process.env.PATH}`,
      },
    });

    job.process = proc;

    console.log(`[Pipeline] Job ${jobId}: bash ${args.join(' ')} (cwd: ${repoRoot})`);

    // Handle stdout
    proc.stdout?.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        console.log(`[Pipeline] ${jobId} stdout: ${line}`);
        job.output.push(line);
        broadcast({
          type: 'pipeline-output',
          jobId,
          line,
        });
      }
    });

    // Handle stderr
    proc.stderr?.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        console.error(`[Pipeline] ${jobId} stderr: ${line}`);
        job.output.push(`[ERROR] ${line}`);
        broadcast({
          type: 'pipeline-output',
          jobId,
          line: `[ERROR] ${line}`,
        });
      }
    });

    // Handle process exit
    proc.on('exit', (code) => {
      job.status = 'completed';
      job.exitCode = code || 0;

      broadcast({
        type: 'pipeline-complete',
        jobId,
        exitCode: job.exitCode,
      });

      console.log(`[Pipeline] Job ${jobId} completed with exit code ${job.exitCode} | output: ${job.output.join(' | ')}`);

      // Keep job in memory for a bit longer for status queries
      setTimeout(() => {
        jobs.delete(jobId);
      }, 30000); // 30 seconds
    });

    // Handle process errors
    proc.on('error', (err) => {
      job.output.push(`[FATAL ERROR] ${err.message}`);
      job.status = 'completed';
      job.exitCode = 1;

      broadcast({
        type: 'pipeline-error',
        jobId,
        error: err.message,
      });

      console.error(`[Pipeline] Job ${jobId} error:`, err);
    });

    // Return immediately with job ID
    res.json({ jobId });
  } catch (err) {
    console.error('[POST /posts/:slug/pipeline/:action] Error:', err);
    res.status(500).json({ error: 'Failed to start pipeline job' });
  }
});

// GET /api/pipeline/jobs/:jobId - Check job status
router.get('/pipeline/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const job = jobs.get(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      jobId: job.jobId,
      status: job.status,
      exitCode: job.exitCode,
      output: job.output,
    });
  } catch (err) {
    console.error('[GET /pipeline/jobs/:jobId] Error:', err);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

export default router;
