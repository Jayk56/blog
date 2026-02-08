import express, { Router, Request, Response } from 'express';
import fs from 'fs-extra';
import path from 'path';
import { execFileSync } from 'child_process';

const router = Router();

// Helper to get repo root from app locals
function getRepoRoot(req: Request): string {
  return req.app.locals.repoRoot;
}

// Helper to validate slug format
function validateSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug);
}

// Helper to get audio files for a post
async function getAudioFiles(audioNotesPath: string): Promise<string[]> {
  if (!await fs.pathExists(audioNotesPath)) {
    return [];
  }

  const files = await fs.readdir(audioNotesPath);
  const audioExtensions = ['.m4a', '.mp3', '.wav', '.aac'];
  return files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    return audioExtensions.includes(ext);
  }).sort();
}

// Helper to check which stage files exist
async function getStageFiles(repoRoot: string, slug: string): Promise<Record<string, any>> {
  const stages = {
    transcribe: path.join(repoRoot, 'output/transcribe', slug),
    preprocess: path.join(repoRoot, 'output/outline', slug),
    draft: path.join(repoRoot, 'output/draft', slug),
    review: path.join(repoRoot, 'output/review', slug),
    collect: path.join(repoRoot, 'output/collect', slug),
  };

  const stageFiles: Record<string, any> = {};

  // Check transcribe files
  if (await fs.pathExists(stages.transcribe)) {
    stageFiles.transcribe = {
      exists: true,
      transcriptPath: path.join(stages.transcribe, 'transcript.md'),
      transcriptExists: await fs.pathExists(path.join(stages.transcribe, 'transcript.md')),
    };
  } else {
    stageFiles.transcribe = { exists: false };
  }

  // Check preprocess (notes.md, outline.md)
  if (await fs.pathExists(stages.preprocess)) {
    const notesPath = path.join(stages.preprocess, 'notes.md');
    const outlinePath = path.join(stages.preprocess, 'outline.md');
    stageFiles.preprocess = {
      exists: true,
      notesPath,
      notesExists: await fs.pathExists(notesPath),
      outlinePath,
      outlineExists: await fs.pathExists(outlinePath),
    };
  } else {
    stageFiles.preprocess = { exists: false };
  }

  // Check draft
  if (await fs.pathExists(stages.draft)) {
    const draftPath = path.join(stages.draft, 'draft.md');
    stageFiles.draft = {
      exists: true,
      draftPath,
      draftExists: await fs.pathExists(draftPath),
    };
  } else {
    stageFiles.draft = { exists: false };
  }

  // Check review
  if (await fs.pathExists(stages.review)) {
    const reviewPath = path.join(stages.review, 'review.md');
    const calloutsPath = path.join(stages.review, 'callouts.md');
    stageFiles.review = {
      exists: true,
      reviewPath,
      reviewExists: await fs.pathExists(reviewPath),
      calloutsPath,
      calloutsExists: await fs.pathExists(calloutsPath),
    };
  } else {
    stageFiles.review = { exists: false };
  }

  // Check collect
  if (await fs.pathExists(stages.collect)) {
    const assetsPath = path.join(stages.collect, 'assets.json');
    const assetsDirPath = path.join(stages.collect, 'assets');
    stageFiles.collect = {
      exists: true,
      assetsPath,
      assetsExists: await fs.pathExists(assetsPath),
      assetsDirPath,
      assetsDirExists: await fs.pathExists(assetsDirPath),
    };
  } else {
    stageFiles.collect = { exists: false };
  }

  return stageFiles;
}

// GET /api/posts - List all posts
router.get('/posts', async (req: Request, res: Response) => {
  try {
    const repoRoot = getRepoRoot(req);
    const audioNotesPath = path.join(repoRoot, 'audio-notes');

    if (!await fs.pathExists(audioNotesPath)) {
      return res.json([]);
    }

    const dirs = await fs.readdir(audioNotesPath);
    const posts = [];

    for (const dir of dirs) {
      const manifestPath = path.join(audioNotesPath, dir, 'manifest.json');
      if (!await fs.pathExists(manifestPath)) continue;

      try {
        const manifest = await fs.readJSON(manifestPath);
        const audioFiles = await getAudioFiles(path.join(audioNotesPath, dir));
        const stageFiles = await getStageFiles(repoRoot, dir);

        posts.push({
          slug: manifest.slug,
          title: manifest.title || '(Untitled)',
          category: manifest.category,
          stage: manifest.stage,
          created: manifest.created,
          lastModified: manifest.lastModified,
          tags: manifest.tags || [],
          audioCount: audioFiles.length,
          stageFiles,
        });
      } catch (err) {
        console.error(`Failed to read manifest for ${dir}:`, err);
      }
    }

    // Sort by lastModified descending
    posts.sort((a, b) => {
      const dateA = new Date(a.lastModified).getTime();
      const dateB = new Date(b.lastModified).getTime();
      return dateB - dateA;
    });

    res.json(posts);
  } catch (err) {
    console.error('[GET /posts] Error:', err);
    res.status(500).json({ error: 'Failed to list posts' });
  }
});

// GET /api/posts/:slug - Get detailed post information
router.get('/posts/:slug', async (req: Request, res: Response) => {
  try {
    const repoRoot = getRepoRoot(req);
    const { slug } = req.params;

    const audioNotesPath = path.join(repoRoot, 'audio-notes', slug);
    const manifestPath = path.join(audioNotesPath, 'manifest.json');

    if (!await fs.pathExists(manifestPath)) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const manifest = await fs.readJSON(manifestPath);
    const audioFiles = await getAudioFiles(audioNotesPath);
    const stageFiles = await getStageFiles(repoRoot, slug);

    // Read content of key files
    let outline, transcript, draft, review, notes;

    const outlinePath = path.join(repoRoot, 'output/outline', slug, 'outline.md');
    if (await fs.pathExists(outlinePath)) {
      outline = await fs.readFile(outlinePath, 'utf-8');
    }

    const transcriptPath = path.join(repoRoot, 'output/transcribe', slug, 'transcript.md');
    if (await fs.pathExists(transcriptPath)) {
      transcript = await fs.readFile(transcriptPath, 'utf-8');
    }

    const draftPath = path.join(repoRoot, 'output/draft', slug, 'draft.md');
    if (await fs.pathExists(draftPath)) {
      draft = await fs.readFile(draftPath, 'utf-8');
    }

    const reviewPath = path.join(repoRoot, 'output/review', slug, 'review.md');
    if (await fs.pathExists(reviewPath)) {
      review = await fs.readFile(reviewPath, 'utf-8');
    }

    const notesPath = path.join(audioNotesPath, 'notes.md');
    if (await fs.pathExists(notesPath)) {
      notes = await fs.readFile(notesPath, 'utf-8');
    }

    res.json({
      slug: manifest.slug,
      title: manifest.title || '(Untitled)',
      category: manifest.category,
      stage: manifest.stage,
      created: manifest.created,
      lastModified: manifest.lastModified,
      tags: manifest.tags || [],
      audioCount: audioFiles.length,
      audioFiles,
      stageFiles,
      content: {
        outline,
        transcript,
        draft,
        review,
        notes,
      },
    });
  } catch (err) {
    console.error(`[GET /posts/:slug] Error:`, err);
    res.status(500).json({ error: 'Failed to get post details' });
  }
});

// POST /api/posts - Create new post
router.post('/posts', async (req: Request, res: Response) => {
  try {
    const repoRoot = getRepoRoot(req);
    const { slug, category } = req.body;

    // Validate input
    if (!slug || !category) {
      return res.status(400).json({ error: 'slug and category are required' });
    }

    if (!validateSlug(slug)) {
      return res.status(400).json({ error: 'slug must contain only lowercase letters, numbers, and hyphens' });
    }

    // Check if post already exists
    const audioNotesPath = path.join(repoRoot, 'audio-notes', slug);
    if (await fs.pathExists(audioNotesPath)) {
      return res.status(409).json({ error: 'Post already exists' });
    }

    // Run new-post.sh script
    const scriptPath = path.join(repoRoot, 'pipeline/scripts/new-post.sh');
    try {
      execFileSync('bash', [scriptPath, slug, category], {
        cwd: repoRoot,
        stdio: 'pipe',
      });
    } catch (err: any) {
      console.error('Script error:', err);
      return res.status(500).json({ error: 'Failed to create post' });
    }

    // Read the created manifest
    const manifestPath = path.join(audioNotesPath, 'manifest.json');
    if (!await fs.pathExists(manifestPath)) {
      return res.status(500).json({ error: 'Post created but manifest not found' });
    }

    const manifest = await fs.readJSON(manifestPath);

    res.status(201).json({
      message: 'Post created successfully',
      manifest,
    });
  } catch (err) {
    console.error('[POST /posts] Error:', err);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

export default router;
