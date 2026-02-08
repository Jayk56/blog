import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs-extra';

// Debounce helper
function debounce(func: Function, wait: number) {
  let timeout: NodeJS.Timeout;
  return function (...args: any[]) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Start the file watcher
 * @param broadcast - Function to broadcast events to connected clients
 * @param repoRoot - Root directory of the blog repository
 */
export function startWatcher(broadcast: Function, repoRoot: string) {
  // Paths to watch
  const watchPaths = [
    path.join(repoRoot, 'audio-notes'),
    path.join(repoRoot, 'output'),
    path.join(repoRoot, 'jkerschner.com/content'),
  ];

  console.log('[Watcher] Starting file watcher on paths:', watchPaths);

  const watcher = chokidar.watch(watchPaths, {
    ignored: /(^|[\/\\])\.|node_modules/,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  // Extract slug from a path
  function extractSlug(filePath: string): string | null {
    // Match audio-notes/[slug]/ or output/*/[slug]/
    const audioNotesMatch = filePath.match(/audio-notes\/([^\/]+)\//);
    if (audioNotesMatch) return audioNotesMatch[1];

    const outputMatch = filePath.match(/output\/(?:[^\/]+\/)?([^\/]+)\//);
    if (outputMatch) return outputMatch[1];

    return null;
  }

  // Handle manifest changes (debounced)
  const handleManifestChange = debounce((filePath: string) => {
    const slug = extractSlug(filePath);
    if (!slug) return;

    console.log('[Watcher] manifest.json changed:', filePath, 'slug:', slug);

    // Try to read the manifest to get the current stage
    const manifestPath = path.join(repoRoot, 'audio-notes', slug, 'manifest.json');
    fs.readJSON(manifestPath)
      .then((manifest) => {
        broadcast({
          type: 'manifest-changed',
          slug,
          stage: manifest.stage,
          manifest,
        });
      })
      .catch((err) => {
        console.error('[Watcher] Failed to read manifest:', err);
        broadcast({
          type: 'manifest-changed',
          slug,
        });
      });
  }, 500);

  // Handle output file changes (debounced)
  const handleOutputChange = debounce((filePath: string) => {
    const slug = extractSlug(filePath);
    if (!slug) return;

    // Get relative path from repo root
    const relativePath = path.relative(repoRoot, filePath);

    console.log('[Watcher] File changed:', relativePath, 'slug:', slug);

    broadcast({
      type: 'file-changed',
      slug,
      path: relativePath,
    });
  }, 500);

  // Watch manifest files
  watcher.on('all', (event, filePath) => {
    if (filePath.endsWith('manifest.json')) {
      if (event === 'add' || event === 'change') {
        handleManifestChange(filePath);
      }
    }

    // Watch output files (transcripts, outlines, drafts, reviews, etc.)
    if (
      filePath.includes('/output/') &&
      (filePath.endsWith('.md') || filePath.endsWith('.json'))
    ) {
      if (event === 'add' || event === 'change') {
        handleOutputChange(filePath);
      }
    }

    // Watch Hugo content
    if (filePath.includes('jkerschner.com/content/')) {
      if (event === 'add' || event === 'change' || event === 'unlink') {
        const relativePath = path.relative(repoRoot, filePath);
        console.log('[Watcher] Hugo content changed:', relativePath);

        broadcast({
          type: 'hugo-content-changed',
          path: relativePath,
          event,
        });
      }
    }
  });

  // Log watcher events for debugging
  watcher
    .on('add', (path) => {
      console.log('[Watcher] File added:', path);
    })
    .on('change', (path) => {
      console.log('[Watcher] File changed:', path);
    })
    .on('unlink', (path) => {
      console.log('[Watcher] File deleted:', path);
    })
    .on('error', (error) => {
      console.error('[Watcher] Error:', error);
    });

  console.log('[Watcher] File watcher started');

  return watcher;
}
