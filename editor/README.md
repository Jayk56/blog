# Blog Editor

A local web app for managing the blog audio-notes pipeline and drafting posts. Built with React + Express + WebSocket.

## Quick Start

```bash
cd editor
npm install
npm run dev
```

This starts both the Express API server (port 3000) and the Vite dev server (port 5173). Open http://localhost:5173.

You can also start it from the pipeline Makefile:

```bash
make editor
```

## Architecture

The editor runs entirely on your local machine — no cloud services, no accounts. It connects directly to the blog repo's file system.

```
┌─────────────────────────────────────────────────┐
│  Browser (localhost:5173)                        │
│  ┌───────────┐ ┌───────────┐ ┌───────────────┐  │
│  │ Dashboard  │ │ Workspace │ │   Terminal     │  │
│  │ (post grid)│ │ (3-panel) │ │ (script logs) │  │
│  └───────────┘ └───────────┘ └───────────────┘  │
│         │              │              │          │
│         ▼              ▼              ▼          │
│       REST API (/api)          WebSocket (:3001) │
└─────────────────────────────────────────────────┘
         │                              │
┌────────┴──────────────────────────────┴─────────┐
│  Express Server (localhost:3000)                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Posts API │ │Files API │ │  Pipeline API    │ │
│  │ (CRUD)   │ │(read/    │ │  (run scripts,   │ │
│  │          │ │ write)   │ │   stream output) │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────────────┐  ┌───────────────────┐    │
│  │ File Watcher      │  │ Hugo Manager      │    │
│  │ (chokidar)        │  │ (start/stop/      │    │
│  │                   │  │  status on :1314)  │    │
│  └──────────────────┘  └───────────────────┘    │
└─────────────────────────────────────────────────┘
         │
         ▼
   Blog repo filesystem
   (audio-notes/, output/, jkerschner.com/)
```

### Frontend (`src/`)

- **Dashboard** — Grid of post cards showing slug, stage, category, and dates. "New Post" button to create a post with slug and category.
- **Workspace** — Three-panel layout for editing a single post:
  - *Left (25%):* Reference panel with tabs for Outline, Transcript, and Notes (notes are editable with auto-save).
  - *Center (50%):* CodeMirror 6 markdown editor. Auto-saves with 1-second debounce. Active during preprocess, draft, and review stages.
  - *Right (25%):* Asset gallery showing collected screenshots and embeds.
- **PipelineBar** — Bottom bar with stage progress indicator (numbered circles with tooltips), panel toggles, terminal toggle, and a "next action" button that runs scripts or advances the manifest.
- **Terminal** — Expandable drawer that streams script stdout/stderr in real time via WebSocket.

### Backend (`server/`)

- **Posts API** (`/api/posts`) — List posts by reading `audio-notes/*/manifest.json`, get post detail with content from all stages, create new posts.
- **Files API** (`/api/posts/:slug/file`) — Read/write any file in the repo via GET/PUT with `?path=` query param. Includes path traversal protection and auto-creates parent directories on write.
- **Pipeline API** (`/api/posts/:slug/pipeline/:action`) — Spawn pipeline scripts asynchronously, stream stdout/stderr via WebSocket, track job status by ID.
- **Hugo API** (`/api/hugo`) — Start/stop/status of a local Hugo dev server on port 1314.
- **Watcher** (`watcher.ts`) — Uses chokidar to watch `audio-notes/`, `output/`, and Hugo content directories. Broadcasts `file-changed`, `manifest-changed`, and `hugo-content-changed` events over WebSocket so the UI updates in real time.

## Pipeline Stages

The editor maps to the blog's 7-stage pipeline:

| # | Stage | Type | What happens |
|---|-------|------|-------------|
| 1 | **Capture** | Manual | Record voice memos on iPhone |
| 2 | **Transcribe** | Automated | Audio → text via ElevenLabs Scribe v2 |
| 3 | **Preprocess** | Automated | Transcript → structured outline via Claude CLI |
| 4 | **Draft** | Manual | Write the blog post in the editor |
| 5 | **Review** | Manual | Revise and refine the draft |
| 6 | **Collect** | Automated | Gather screenshots and embeds via Playwright |
| 7 | **Publish** | Automated | Build Hugo page bundle and deploy |

Clicking the action button in the pipeline bar runs the corresponding script for automated stages, or advances the manifest for manual stages (draft/review).

## Pipeline Script Integration

The editor's Pipeline API maps each stage action to a shell script in `pipeline/scripts/`:

| Action | Script | What it does |
|--------|--------|-------------|
| `transcribe` | `transcribe.sh` | Sends audio files to ElevenLabs Scribe v2, produces `output/transcribe/<slug>/transcript.md` and per-file JSONs |
| `increment-transcribe` | `increment-transcribe.sh` | Transcribes only new audio files (compares audio count vs JSON count), appends to existing transcript without resetting stage |
| `preprocess` | `preprocess.sh` | Runs Claude CLI (`claude -p --allowedTools ""`) with `prompts/preprocess.md` to generate a structured outline from the transcript |
| `update-preprocess` | `preprocess.sh --update` | Merges new transcript content into an existing outline using `prompts/update-preprocess.md`, tagging sections as [NEW]/[EXPANDED]/[REVISED] |
| `draft` | `advance.sh` | Advances manifest from preprocess → draft (manual stage, editing happens in the UI) |
| `review` | `advance.sh` | Advances manifest from draft → review (manual stage, editing happens in the UI) |
| `collect` | `collect.sh` | Runs Playwright headless browser to capture screenshots and embeds, outputs to `output/collect/<slug>/` |
| `publish` | `publish.sh` | Builds a Hugo leaf page bundle at `jkerschner.com/content/posts/<slug>/index.md` with co-located assets |
| `advance` | `advance.sh` | Generic stage advancement — validates current stage output exists, then bumps `manifest.json` to the next stage |

The `advance.sh` script enforces stage gates: it checks that the expected output for the current stage exists before allowing advancement (e.g., `output/outline/<slug>/*.md` must exist before moving past preprocess).

### Background Automation

A launchd job (`pipeline/launchd/com.jkerschner.blog-transcribe.plist`) runs `auto-transcribe.sh` every 15 minutes when the Mac is awake. This script does three passes:

1. **Pass 1** — Full transcription for posts at the "capture" stage
2. **Pass 1.5** — Incremental transcription for posts at any stage that have new audio files (compares audio file count to JSON transcript count)
3. **Pass 2** — Outline updates for posts where the transcript is newer than the outline (uses file mtime comparison)

This means you can record new voice memos at any point in the pipeline and they'll be automatically transcribed and merged into the outline.

## Features

### Editable Notes

The Notes tab in the Reference Panel is a live editor for `audio-notes/<slug>/notes.md`. Changes auto-save with a 1-second debounce. A status indicator in the bottom-right shows Saving/Saved/Unsaved state. The save uses a guard ref to prevent chokidar's file-changed event from reloading the content and overwriting in-progress edits.

### Stage-Aware Editor

The center CodeMirror editor loads the appropriate file based on the current stage:

- **preprocess/draft** stages → edits `output/draft/<slug>/draft.md`
- **review** stage → edits `output/review/<slug>/review.md`

The editor is read-only at other stages. Auto-save with 1-second debounce, word count, and estimated reading time shown in the footer.

### Real-Time Updates

The file watcher broadcasts WebSocket events whenever files change on disk, so the UI stays in sync whether changes come from the editor, the pipeline scripts, or external tools. Event types:

- `file-changed` — An output or notes file was modified (triggers tab reload in ReferencePanel)
- `manifest-changed` — A post's `manifest.json` was updated (triggers post data refresh in Workspace)
- `pipeline-output` — A line of stdout/stderr from a running script (streams into Terminal)
- `pipeline-complete` — A pipeline job finished (clears running state, refreshes post)
- `hugo-started` / `hugo-stopped` — Hugo dev server state changes

### Pipeline Progress Bar

The bottom bar shows a visual progress indicator with numbered stage circles. Completed stages are green, the current stage is blue, and future stages are gray. Each circle has a tooltip on hover showing the stage name and description. The action button on the right shows the next available action and disables while a job is running.

### Hugo Dev Server

The editor can start and manage a local Hugo server on port 1314 via the Hugo API endpoints. This lets you preview the final rendered site while editing.

## File Layout

The editor reads from and writes to these repo directories:

```
blog/
├── audio-notes/<slug>/
│   ├── manifest.json          # Stage tracking, metadata
│   ├── notes.md               # Editable notes (Reference Panel)
│   └── *.m4a                  # Voice recordings
├── output/
│   ├── transcribe/<slug>/
│   │   ├── transcript.md      # Combined transcript (Reference Panel)
│   │   └── *.json             # Per-file transcription results
│   ├── outline/<slug>/
│   │   └── outline.md         # Structured outline (Reference Panel)
│   ├── draft/<slug>/
│   │   └── draft.md           # Blog post draft (Editor)
│   ├── review/<slug>/
│   │   └── review.md          # Reviewed draft (Editor)
│   └── collect/<slug>/
│       ├── assets.json        # Asset manifest
│       └── assets/            # Screenshots, embeds (Asset Gallery)
├── jkerschner.com/content/
│   └── posts/<slug>/
│       └── index.md           # Final Hugo page bundle
└── pipeline/
    ├── scripts/               # Shell scripts called by Pipeline API
    ├── prompts/               # Claude CLI system prompts
    └── launchd/               # macOS launchd job config
```

## npm Scripts

```
npm run dev           # Start both servers (Express + Vite) via concurrently
npm run dev:server    # Express API only (tsx watch)
npm run dev:client    # Vite frontend only
npm run build         # Production build (TypeScript + Vite)
npm start             # Run production build
```

## Key Files

```
editor/
├── server/
│   ├── index.ts          # Express + WebSocket setup, CORS, middleware
│   ├── watcher.ts        # chokidar file watcher → WebSocket broadcasts
│   └── api/
│       ├── posts.ts      # GET/POST /api/posts, GET /api/posts/:slug
│       ├── files.ts      # GET/PUT /api/posts/:slug/file, GET /api/posts/:slug/assets
│       ├── pipeline.ts   # POST /api/posts/:slug/pipeline/:action, GET /api/pipeline/jobs/:id
│       └── hugo.ts       # POST /api/hugo/start, POST /api/hugo/stop, GET /api/hugo/status
├── src/
│   ├── App.tsx           # Routes: / (Dashboard) and /post/:slug (Workspace)
│   ├── lib/
│   │   ├── api.ts        # REST API client (fetchPosts, readFile, writeFile, runPipeline, etc.)
│   │   └── ws.ts         # WebSocket client with auto-reconnect and subscribe()
│   └── components/
│       ├── Dashboard.tsx      # Post grid with search/filter
│       ├── PostCard.tsx       # Stage badge, category, dates
│       ├── NewPostDialog.tsx  # Modal with slug validation and category select
│       ├── Workspace.tsx      # Three-panel layout, post data loading
│       ├── ReferencePanel.tsx # Outline/Transcript/Notes tabs with editable Notes
│       ├── Editor.tsx         # CodeMirror 6 markdown editor with auto-save
│       ├── AssetGallery.tsx   # Collected screenshots and embeds
│       ├── PipelineBar.tsx    # Stage progress, tooltips, action button
│       └── Terminal.tsx       # Script output streaming drawer
└── vite.config.ts        # Vite config with /api proxy to :3000
```

## Tech Stack

React 18, TypeScript, Vite 5, Tailwind CSS (dark theme), CodeMirror 6, Express 4, WebSocket (ws), chokidar, concurrently.
