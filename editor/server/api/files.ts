import express, { Router, Request, Response } from 'express';
import fs from 'fs-extra';
import path from 'path';

const router = Router();

// Helper to get repo root from app locals
function getRepoRoot(req: Request): string {
  return req.app.locals.repoRoot;
}

// Helper to validate and normalize file path
function validateFilePath(repoRoot: string, filePath: string): string | null {
  // Normalize the path
  const normalized = path.normalize(filePath);

  // Prevent directory traversal attacks
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return null;
  }

  // Resolve relative to repo root
  const fullPath = path.resolve(repoRoot, normalized);

  // Ensure the resolved path is still within repo root
  if (!fullPath.startsWith(repoRoot)) {
    return null;
  }

  return fullPath;
}

// GET /api/posts/:slug/file - Read a file
router.get('/posts/:slug/file', async (req: Request, res: Response) => {
  try {
    const repoRoot = getRepoRoot(req);
    const { path: filePath } = req.query;

    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ error: 'path query parameter is required' });
    }

    const fullPath = validateFilePath(repoRoot, filePath);
    if (!fullPath) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    // Check if file exists
    if (!await fs.pathExists(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Check if it's a file (not directory)
    const stats = await fs.stat(fullPath);
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Path is a directory' });
    }

    // Read file content
    const content = await fs.readFile(fullPath, 'utf-8');

    // Determine content type based on file extension
    const ext = path.extname(fullPath).toLowerCase();
    let contentType = 'text/plain';
    if (ext === '.json') contentType = 'application/json';
    if (ext === '.md') contentType = 'text/markdown';
    if (ext === '.html') contentType = 'text/html';

    res.type(contentType).send(content);
  } catch (err) {
    console.error('[GET /posts/:slug/file] Error:', err);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// PUT /api/posts/:slug/file - Write a file
router.put('/posts/:slug/file', async (req: Request, res: Response) => {
  try {
    const repoRoot = getRepoRoot(req);
    const { path: filePath } = req.query;

    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ error: 'path query parameter is required' });
    }

    const fullPath = validateFilePath(repoRoot, filePath);
    if (!fullPath) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    // Get content from request body
    const content = req.body;

    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Request body must be plain text' });
    }

    // Create parent directories if needed
    const dir = path.dirname(fullPath);
    await fs.ensureDir(dir);

    // Write file
    await fs.writeFile(fullPath, content, 'utf-8');

    res.json({ success: true, path: filePath });
  } catch (err) {
    console.error('[PUT /posts/:slug/file] Error:', err);
    res.status(500).json({ error: 'Failed to write file' });
  }
});

// GET /api/posts/:slug/assets - List assets for a post
router.get('/posts/:slug/assets', async (req: Request, res: Response) => {
  try {
    const repoRoot = getRepoRoot(req);
    const { slug } = req.params;

    const collectPath = path.join(repoRoot, 'output/collect', slug);
    const assetsPath = path.join(collectPath, 'assets');
    const assetsJsonPath = path.join(collectPath, 'assets.json');

    let assetManifest = null;
    let assetFiles = [];

    // Read assets.json if it exists
    if (await fs.pathExists(assetsJsonPath)) {
      try {
        assetManifest = await fs.readJSON(assetsJsonPath);
      } catch (err) {
        console.error(`Failed to read assets.json for ${slug}:`, err);
      }
    }

    // List files in assets directory if it exists
    if (await fs.pathExists(assetsPath)) {
      try {
        const files = await fs.readdir(assetsPath);
        assetFiles = files.map(file => ({
          name: file,
          path: `output/collect/${slug}/assets/${file}`,
        }));
      } catch (err) {
        console.error(`Failed to list assets directory for ${slug}:`, err);
      }
    }

    res.json({
      assetManifest,
      assetFiles,
    });
  } catch (err) {
    console.error('[GET /posts/:slug/assets] Error:', err);
    res.status(500).json({ error: 'Failed to get assets' });
  }
});

export default router;
