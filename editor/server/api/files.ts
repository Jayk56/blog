import express, { Router, Request, Response } from 'express';
import fs from 'fs-extra';
import path from 'path';
import multer from 'multer';

const router = Router();

// Per-slug upload locks to prevent concurrent manifest read-modify-write races
const uploadLocks = new Map<string, Promise<any>>();
function withUploadLock<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  const prev = uploadLocks.get(slug) ?? Promise.resolve();
  const result = prev.catch(() => {}).then(() => fn());
  uploadLocks.set(slug, result.catch(() => {}));
  return result;
}

const MAX_UPLOAD_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_FILE_COUNT = 20;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
    files: MAX_UPLOAD_FILE_COUNT,
  },
});

interface AssetManifest {
  slug: string;
  collected_at: string;
  total_requested: number;
  total_successful: number;
  assets: Record<string, any>[];
  failures: Record<string, any>[];
  [key: string]: any;
}

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

function validateSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug);
}

function sanitizeFilename(filename: string): string {
  const basename = path.basename(filename || 'upload');
  const lower = basename.toLowerCase();
  const normalized = lower
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-+/g, '-');

  const ext = path.extname(normalized).replace(/[^a-z0-9.]/g, '');
  const name = path.basename(normalized, ext)
    .replace(/\.+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return `${name || 'file'}${ext}`;
}

async function ensureUniqueFilename(dirPath: string, filename: string): Promise<string> {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = filename;
  let suffix = 1;

  while (await fs.pathExists(path.join(dirPath, candidate))) {
    candidate = `${base}-${suffix}${ext}`;
    suffix += 1;
  }

  return candidate;
}

function createDefaultAssetManifest(slug: string): AssetManifest {
  return {
    slug,
    collected_at: new Date().toISOString(),
    total_requested: 0,
    total_successful: 0,
    assets: [],
    failures: [],
  };
}

async function readAssetManifest(manifestPath: string, slug: string): Promise<AssetManifest> {
  const fallback = createDefaultAssetManifest(slug);

  if (!await fs.pathExists(manifestPath)) {
    return fallback;
  }

  try {
    const parsed = await fs.readJSON(manifestPath);
    // Handle legacy array-form manifests (where the entire file is an array of assets)
    if (Array.isArray(parsed)) {
      return {
        ...fallback,
        slug,
        assets: parsed,
      };
    }
    return {
      ...fallback,
      ...parsed,
      slug,
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
      failures: Array.isArray(parsed.failures) ? parsed.failures : [],
    };
  } catch (err) {
    console.error(`Failed to read assets manifest at ${manifestPath}:`, err);
    return fallback;
  }
}

async function parseUploadFiles(req: Request, res: Response): Promise<Express.Multer.File[]> {
  return new Promise((resolve, reject) => {
    upload.array('files', MAX_UPLOAD_FILE_COUNT)(req, res, (err: any) => {
      if (err) {
        reject(err);
        return;
      }
      resolve((req.files as Express.Multer.File[]) || []);
    });
  });
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

// POST /api/posts/:slug/assets/upload - Upload one or more image assets
router.post('/posts/:slug/assets/upload', async (req: Request, res: Response) => {
  try {
    const repoRoot = getRepoRoot(req);
    const { slug } = req.params;

    if (!validateSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug' });
    }

    const sourceManifestRelativePath = path.join('audio-notes', slug, 'manifest.json');
    const sourceManifestPath = validateFilePath(repoRoot, sourceManifestRelativePath);
    if (!sourceManifestPath || !await fs.pathExists(sourceManifestPath)) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const files = await parseUploadFiles(req, res);
    if (files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const invalidFile = files.find(file => !ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype));
    if (invalidFile) {
      return res.status(400).json({ error: 'Only image files are allowed' });
    }

    const collectDirRelativePath = path.join('output', 'collect', slug);
    const assetsDirRelativePath = path.join(collectDirRelativePath, 'assets');
    const assetsManifestRelativePath = path.join(collectDirRelativePath, 'assets.json');

    const assetsDirPath = validateFilePath(repoRoot, assetsDirRelativePath);
    const assetsManifestPath = validateFilePath(repoRoot, assetsManifestRelativePath);

    if (!assetsDirPath || !assetsManifestPath) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    // Serialize per-slug to prevent concurrent manifest read-modify-write races
    const uploaded = await withUploadLock(slug, async () => {
      await fs.ensureDir(assetsDirPath);
      const manifest = await readAssetManifest(assetsManifestPath, slug);

      let nextAssetId = manifest.assets.length + 1;
      const results: Array<{ id: string; file: string; originalName: string; size_bytes: number }> = [];

      for (const file of files) {
        const safeBaseName = sanitizeFilename(file.originalname);
        const uniqueFileName = await ensureUniqueFilename(assetsDirPath, safeBaseName);
        const fileRelativePath = path.join('output', 'collect', slug, 'assets', uniqueFileName);
        const fullFilePath = validateFilePath(repoRoot, fileRelativePath);

        if (!fullFilePath) {
          throw new Error('Invalid file path');
        }

        await fs.writeFile(fullFilePath, file.buffer);

        // If the file was deduplicated (name changed), use the unique name as
        // the display name so the user can distinguish between uploads
        const displayName = uniqueFileName !== safeBaseName ? uniqueFileName : file.originalname;

        const id = `upload-${nextAssetId}`;
        const manifestAsset = {
          id,
          type: 'image',
          status: 'success',
          file: `assets/${uniqueFileName}`,
          originalName: displayName,
          size_bytes: file.size,
          uploaded_at: new Date().toISOString(),
        };

        manifest.assets.push(manifestAsset);
        results.push({
          id,
          file: manifestAsset.file,
          originalName: displayName,
          size_bytes: file.size,
        });

        nextAssetId += 1;
      }

      manifest.collected_at = new Date().toISOString();
      manifest.total_successful = manifest.assets.filter(asset => asset?.status === 'success').length;
      await fs.writeJSON(assetsManifestPath, manifest, { spaces: 2 });

      return results;
    });

    return res.json({
      success: true,
      uploaded,
    });
  } catch (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 10MB)' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files (max 20)' });
      }
      return res.status(400).json({ error: err.message || 'Invalid upload payload' });
    }

    console.error('[POST /posts/:slug/assets/upload] Error:', err);
    return res.status(500).json({ error: 'Failed to upload assets' });
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

// GET /api/posts/:slug/assets/file/:filename - Serve uploaded asset file
router.get('/posts/:slug/assets/file/:filename', async (req: Request, res: Response) => {
  try {
    const repoRoot = getRepoRoot(req);
    const { slug, filename } = req.params;

    if (!validateSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug' });
    }

    if (!filename || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const sourceManifestRelativePath = path.join('audio-notes', slug, 'manifest.json');
    const sourceManifestPath = validateFilePath(repoRoot, sourceManifestRelativePath);
    if (!sourceManifestPath || !await fs.pathExists(sourceManifestPath)) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const assetRelativePath = path.join('output', 'collect', slug, 'assets', filename);
    const assetPath = validateFilePath(repoRoot, assetRelativePath);
    if (!assetPath) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    if (!await fs.pathExists(assetPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stats = await fs.stat(assetPath);
    if (!stats.isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = IMAGE_CONTENT_TYPES[ext] || 'application/octet-stream';
    res.type(contentType);
    return res.sendFile(assetPath);
  } catch (err) {
    console.error('[GET /posts/:slug/assets/file/:filename] Error:', err);
    return res.status(500).json({ error: 'Failed to serve asset file' });
  }
});

// PATCH /api/posts/:slug/assets/:assetId/rename - Rename an asset
router.patch('/posts/:slug/assets/:assetId/rename', express.json(), async (req: Request, res: Response) => {
  try {
    const repoRoot = getRepoRoot(req);
    const { slug, assetId } = req.params;
    const { name } = req.body;

    if (!validateSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug' });
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const newSafeName = sanitizeFilename(name.trim());

    const collectDirRelativePath = path.join('output', 'collect', slug);
    const assetsDirRelativePath = path.join(collectDirRelativePath, 'assets');
    const assetsManifestRelativePath = path.join(collectDirRelativePath, 'assets.json');

    const assetsDirPath = validateFilePath(repoRoot, assetsDirRelativePath);
    const assetsManifestPath = validateFilePath(repoRoot, assetsManifestRelativePath);

    if (!assetsDirPath || !assetsManifestPath) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    const result = await withUploadLock(slug, async () => {
      const manifest = await readAssetManifest(assetsManifestPath, slug);
      const assetIndex = manifest.assets.findIndex((a: any) => a.id === assetId);
      if (assetIndex < 0) {
        return { error: 'Asset not found', status: 404 };
      }

      const asset = manifest.assets[assetIndex];
      const oldFilename = asset.file ? path.basename(asset.file) : null;
      if (!oldFilename) {
        return { error: 'Asset has no file', status: 400 };
      }

      // Keep the same extension as the original file
      const oldExt = path.extname(oldFilename);
      const newExt = path.extname(newSafeName);
      const finalName = newExt === oldExt ? newSafeName : path.basename(newSafeName, newExt) + oldExt;

      if (finalName === oldFilename) {
        return { asset, renamed: false };
      }

      // Ensure unique name on disk
      const uniqueName = await ensureUniqueFilename(assetsDirPath, finalName);

      const oldPath = path.join(assetsDirPath, oldFilename);
      const newPath = path.join(assetsDirPath, uniqueName);

      if (await fs.pathExists(oldPath)) {
        await fs.rename(oldPath, newPath);
      }

      asset.file = `assets/${uniqueName}`;
      asset.originalName = name.trim();
      manifest.collected_at = new Date().toISOString();
      await fs.writeJSON(assetsManifestPath, manifest, { spaces: 2 });

      return { asset, renamed: true };
    });

    if ('error' in result) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.json({ success: true, asset: result.asset, renamed: result.renamed });
  } catch (err) {
    console.error('[PATCH /posts/:slug/assets/:assetId/rename] Error:', err);
    return res.status(500).json({ error: 'Failed to rename asset' });
  }
});

// --- Metadata endpoints ---

function deepMergeMetadata(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  for (const key of Object.keys(source)) {
    // Sessions: upsert by started_at to prevent duplicates from repeated flushes
    if (key === 'sessions' && Array.isArray(target[key]) && Array.isArray(source[key])) {
      for (const newSession of source[key]) {
        const existingIdx = target[key].findIndex(
          (s: any) => s.started_at === newSession.started_at
        );
        if (existingIdx >= 0) {
          target[key][existingIdx] = newSession;
        } else {
          target[key].push(newSession);
        }
      }
    // Known append-arrays: stage_transitions, files, pipeline_jobs
    } else if (
      ['stage_transitions', 'files', 'pipeline_jobs'].includes(key) &&
      Array.isArray(target[key]) && Array.isArray(source[key])
    ) {
      target[key] = [...target[key], ...source[key]];
    // Recurse into nested objects
    } else if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      target[key] = deepMergeMetadata(target[key], source[key]);
    // Scalars and everything else: overwrite
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// POST /api/posts/:slug/metadata - Merge metadata fragment
router.post('/posts/:slug/metadata', express.json(), async (req: Request, res: Response) => {
  try {
    const repoRoot = getRepoRoot(req);
    const { slug } = req.params;
    const fragment = req.body;

    if (!validateSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug' });
    }

    const metadataDir = path.join(repoRoot, 'output', 'metadata', slug);
    const metadataPath = path.join(metadataDir, 'metadata.json');

    await fs.ensureDir(metadataDir);

    let current: Record<string, any> = { slug };
    if (await fs.pathExists(metadataPath)) {
      try {
        current = await fs.readJSON(metadataPath);
      } catch { /* start fresh */ }
    }

    const merged = deepMergeMetadata(current, fragment);
    await fs.writeJSON(metadataPath, merged, { spaces: 2 });

    res.json({ success: true });
  } catch (err) {
    console.error('[POST /posts/:slug/metadata] Error:', err);
    res.status(500).json({ error: 'Failed to update metadata' });
  }
});

// GET /api/posts/:slug/metadata - Read metadata
router.get('/posts/:slug/metadata', async (req: Request, res: Response) => {
  try {
    const repoRoot = getRepoRoot(req);
    const { slug } = req.params;

    const metadataPath = path.join(repoRoot, 'output', 'metadata', slug, 'metadata.json');
    if (!await fs.pathExists(metadataPath)) {
      return res.json({ slug });
    }

    const metadata = await fs.readJSON(metadataPath);
    res.json(metadata);
  } catch (err) {
    console.error('[GET /posts/:slug/metadata] Error:', err);
    res.status(500).json({ error: 'Failed to read metadata' });
  }
});

export default router;
