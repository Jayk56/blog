import express from 'express';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import request from 'supertest';
import filesRouter from '../api/files';

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6lL9kAAAAASUVORK5CYII=',
  'base64'
);

function createApp(repoRoot: string) {
  const app = express();
  app.locals.repoRoot = repoRoot;
  app.use(express.json());
  app.use(express.text({ type: 'text/plain' }));
  app.use('/api', filesRouter);
  return app;
}

async function createPostManifest(repoRoot: string, slug: string) {
  const manifestPath = path.join(repoRoot, 'audio-notes', slug, 'manifest.json');
  await fs.ensureDir(path.dirname(manifestPath));
  await fs.writeJSON(manifestPath, {
    slug,
    category: 'test',
    stage: 'collect',
    created: new Date().toISOString(),
  });
}

describe('Asset upload API', () => {
  let tempDir: string;
  let app: ReturnType<typeof createApp>;
  const slug = 'test-post';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-upload-test-'));
    await createPostManifest(tempDir, slug);
    app = createApp(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  test('POST /api/posts/:slug/assets/upload uploads a single PNG and updates assets.json', async () => {
    const response = await request(app)
      .post(`/api/posts/${slug}/assets/upload`)
      .attach('files', ONE_BY_ONE_PNG, {
        filename: 'Photo.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.uploaded).toHaveLength(1);
    expect(response.body.uploaded[0]).toMatchObject({
      id: 'upload-1',
      file: 'assets/photo.png',
      originalName: 'Photo.png',
    });

    const uploadedFilePath = path.join(tempDir, 'output', 'collect', slug, 'assets', 'photo.png');
    expect(await fs.pathExists(uploadedFilePath)).toBe(true);

    const manifestPath = path.join(tempDir, 'output', 'collect', slug, 'assets.json');
    const manifest = await fs.readJSON(manifestPath);
    expect(manifest.slug).toBe(slug);
    expect(manifest.total_successful).toBe(1);
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]).toMatchObject({
      id: 'upload-1',
      status: 'success',
      type: 'image',
      file: 'assets/photo.png',
      originalName: 'Photo.png',
    });
  });

  test('POST /api/posts/:slug/assets/upload uploads multiple image files', async () => {
    const response = await request(app)
      .post(`/api/posts/${slug}/assets/upload`)
      .attach('files', ONE_BY_ONE_PNG, {
        filename: 'first.png',
        contentType: 'image/png',
      })
      .attach('files', ONE_BY_ONE_PNG, {
        filename: 'second.webp',
        contentType: 'image/webp',
      });

    expect(response.status).toBe(200);
    expect(response.body.uploaded).toHaveLength(2);

    const firstFilePath = path.join(tempDir, 'output', 'collect', slug, 'assets', 'first.png');
    const secondFilePath = path.join(tempDir, 'output', 'collect', slug, 'assets', 'second.webp');
    expect(await fs.pathExists(firstFilePath)).toBe(true);
    expect(await fs.pathExists(secondFilePath)).toBe(true);

    const manifestPath = path.join(tempDir, 'output', 'collect', slug, 'assets.json');
    const manifest = await fs.readJSON(manifestPath);
    expect(manifest.total_successful).toBe(2);
    expect(manifest.assets).toHaveLength(2);
    expect(manifest.assets[1]).toMatchObject({
      id: 'upload-2',
      file: 'assets/second.webp',
    });
  });

  test('POST /api/posts/:slug/assets/upload rejects non-image files with 400', async () => {
    const response = await request(app)
      .post(`/api/posts/${slug}/assets/upload`)
      .attach('files', Buffer.from('not an image'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('image');
  });

  test('POST /api/posts/:slug/assets/upload appends suffix for duplicate filenames', async () => {
    const firstResponse = await request(app)
      .post(`/api/posts/${slug}/assets/upload`)
      .attach('files', ONE_BY_ONE_PNG, {
        filename: 'photo.png',
        contentType: 'image/png',
      });

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.uploaded[0].file).toBe('assets/photo.png');

    const secondResponse = await request(app)
      .post(`/api/posts/${slug}/assets/upload`)
      .attach('files', ONE_BY_ONE_PNG, {
        filename: 'photo.png',
        contentType: 'image/png',
      });

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.uploaded[0].file).toBe('assets/photo-1.png');

    const duplicatePath = path.join(tempDir, 'output', 'collect', slug, 'assets', 'photo-1.png');
    expect(await fs.pathExists(duplicatePath)).toBe(true);
  });

  test('POST /api/posts/:slug/assets/upload creates assets directory and assets.json when missing', async () => {
    const collectDirPath = path.join(tempDir, 'output', 'collect', slug);
    expect(await fs.pathExists(collectDirPath)).toBe(false);

    const response = await request(app)
      .post(`/api/posts/${slug}/assets/upload`)
      .attach('files', ONE_BY_ONE_PNG, {
        filename: 'new-image.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(200);
    expect(await fs.pathExists(path.join(collectDirPath, 'assets'))).toBe(true);
    expect(await fs.pathExists(path.join(collectDirPath, 'assets.json'))).toBe(true);
  });

  test('GET /api/posts/:slug/assets/file/:filename serves an existing image file', async () => {
    const assetsDir = path.join(tempDir, 'output', 'collect', slug, 'assets');
    await fs.ensureDir(assetsDir);
    await fs.writeFile(path.join(assetsDir, 'thumb.png'), ONE_BY_ONE_PNG);

    const response = await request(app).get(`/api/posts/${slug}/assets/file/thumb.png`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
  });

  test('GET /api/posts/:slug/assets/file/:filename returns 404 for missing file', async () => {
    const response = await request(app).get(`/api/posts/${slug}/assets/file/missing.png`);
    expect(response.status).toBe(404);
  });

  test('GET /api/posts/:slug/assets/file/:filename rejects filenames with path separators', async () => {
    const malicious = encodeURIComponent('../secret.png');
    const response = await request(app).get(`/api/posts/${slug}/assets/file/${malicious}`);
    expect(response.status).toBe(400);
  });
});
