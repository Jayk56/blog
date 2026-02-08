/**
 * Utility functions for the blog editor server
 */

import path from 'path';

/**
 * Validate a slug format
 * Slug must contain only lowercase letters, numbers, and hyphens
 */
export function validateSlug(slug: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug);
}

/**
 * Validate a file path to prevent directory traversal attacks
 * Returns the validated full path or null if invalid
 */
export function validateFilePath(repoRoot: string, filePath: string): string | null {
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

/**
 * Extract slug from a file path
 * Handles both audio-notes and output directory structures
 */
export function extractSlugFromPath(filePath: string): string | null {
  // Match audio-notes/[slug]/
  const audioNotesMatch = filePath.match(/audio-notes\/([^\/]+)\//);
  if (audioNotesMatch) return audioNotesMatch[1];

  // Match output/[stage]/[slug]/ or output/[slug]/
  const outputMatch = filePath.match(/output\/(?:[^\/]+\/)?([^\/]+)\//);
  if (outputMatch) return outputMatch[1];

  return null;
}

/**
 * Get stage from a file path
 * Returns 'transcribe', 'preprocess', 'draft', 'review', 'collect', etc.
 */
export function getStageFromPath(filePath: string): string | null {
  if (filePath.includes('output/transcribe/')) return 'transcribe';
  if (filePath.includes('output/draft/')) return 'draft';
  if (filePath.includes('output/review/')) return 'review';
  if (filePath.includes('output/collect/')) return 'collect';

  // Preprocess files live directly in output/[slug]/
  if (filePath.includes('output/') && !filePath.includes('output/transcribe') &&
      !filePath.includes('output/draft') && !filePath.includes('output/review') &&
      !filePath.includes('output/collect')) {
    return 'preprocess';
  }

  return null;
}

/**
 * Format a WebSocket event with proper structure
 */
export function createWebSocketEvent(type: string, data: any = {}) {
  return {
    type,
    timestamp: new Date().toISOString(),
    ...data,
  };
}

/**
 * Check if a file extension is audio
 */
export function isAudioFile(filePath: string): boolean {
  const audioExtensions = ['.m4a', '.mp3', '.wav', '.aac', '.flac'];
  const ext = path.extname(filePath).toLowerCase();
  return audioExtensions.includes(ext);
}

/**
 * Check if a file extension is markdown
 */
export function isMarkdownFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.md';
}

/**
 * Check if a file extension is JSON
 */
export function isJsonFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.json';
}
