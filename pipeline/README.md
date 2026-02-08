# Blog Content Pipeline

A multi-stage, AI-assisted content pipeline for converting Voice Memos into published blog posts. Inspired by Gas Town's multi-agent orchestration and designed for incremental, distributed processing.

## Pipeline Overview

```
CAPTURE               TRANSCRIBE              PRE-PROCESS            DRAFT
┌─────────────┐      ┌──────────────┐       ┌────────────────┐    ┌──────────┐
│  Voice      │  →   │  ElevenLabs  │  →    │  Agent: Parse  │ → │  Agent   │
│  Memos      │      │  Scribe v2   │       │  + Outline     │   │  Create  │
│  + Links    │      │              │       │                │   │  Draft   │
└─────────────┘      └──────────────┘       └────────────────┘    └──────────┘
   QUEUE                 QUEUE                   QUEUE               QUEUE
audio-notes/            output/               output/             output/
<slug>/                 transcribe/           outline/            draft/
                        <slug>/               <slug>/             <slug>/


REVIEW                 COLLECT                PUBLISH
┌──────────────┐      ┌──────────────┐       ┌─────────────────┐
│  Agent:      │      │  Playwright  │       │  Move to site   │
│  Review &    │  →   │  + oEmbed +  │  →    │                 │
│  Callouts    │      │  Cowork      │       │ content/posts/  │
└──────────────┘      └──────────────┘       │ <slug>/         │
  QUEUE                 QUEUE                 └─────────────────┘
output/              output/
review/              collect/
<slug>/              <slug>/
```

## Core Concept: Folder Structure as Queue

The pipeline uses **folders as the state machine**. Each post progresses through these stages, with a `manifest.json` file tracking metadata and processing history:

```
blog/
├── audio-notes/                    # Stage 1: CAPTURE
│   └── my-post-slug/
│       ├── manifest.json           # Auto-created by auto-transcribe.sh
│       ├── Recording.m4a           # From Voice Memos via Blog Note shortcut
│       ├── Recording 2.m4a
│       └── notes.txt               # Optional: links, context
│
├── output/
│   ├── transcribe/                 # Stage 2: TRANSCRIBE
│   │   └── my-post-slug/
│   │       └── transcript.md       # Consolidated transcript
│   │
│   ├── outline/                    # Stage 3: PRE-PROCESS
│   │   └── my-post-slug/
│   │       └── outline.md          # Structured outline + callouts
│   │
│   ├── draft/                      # Stage 4: DRAFT
│   │   └── my-post-slug/
│   │       └── draft.md            # Full blog post in Hugo format
│   │
│   ├── review/                     # Stage 5: REVIEW
│   │   └── my-post-slug/
│   │       ├── review.md           # Inline review comments
│   │       └── callouts.md         # Human attention items
│   │
│   └── collect/                    # Stage 6: COLLECT
│       └── my-post-slug/
│           ├── assets.json         # Collection manifest
│           └── assets/             # Screenshots, embeds
│
├── pipeline/                       # Scripts, prompts, automation
│
└── jkerschner.com/
    └── content/
        └── posts/                  # Stage 7: PUBLISHED (page bundles)
            └── my-post-slug/
                ├── index.md
                └── screenshot-1.png
```

## Manifest File Structure

Each post folder contains a lightweight `manifest.json` that tracks the post's current stage. The manifest is auto-created by `auto-transcribe.sh` on your Mac when it finds a folder with audio files — you never need to create it manually.

```json
{
  "slug": "my-post-slug",
  "category": "",
  "title": "",
  "created": "2026-02-06T10:30:00Z",
  "lastModified": "2026-02-06T10:45:00Z",
  "stage": "capture",
  "tags": []
}
```

The `stage` field tracks where the post is in the pipeline: `capture` → `transcribe` → `preprocess` → `draft` → `review` → `collect` → `publish`. Scripts advance it automatically as each stage completes.

## Processing Stages

### Stage 1: CAPTURE
**Location:** `audio-notes/<slug>/`

Record voice memos on iPhone and share them via the **Blog Note** Apple Shortcut. The shortcut asks for a slug, creates a folder in iCloud Drive, and saves the audio. iCloud syncs to your Mac, where the launchd job picks up new folders automatically.

**Inputs:**
- Audio files (`.m4a`, `.mp3`, `.wav`, `.webm`, `.mp4`)
- Optional notes.txt with links, context, or quick thoughts

**Outputs:**
- Multiple audio recordings in the slug folder
- `manifest.json` auto-created by `auto-transcribe.sh` on Mac (not on iPhone)

**Workflow:**
1. Record in Voice Memos on iPhone
2. Share → **Blog Note** shortcut → enter a slug (e.g. `my-post-slug`)
3. Repeat for multiple recordings to the same slug over hours or days
4. iCloud syncs to Mac → rsync bridge copies to git repo → launchd job creates manifest and transcribes

### Stage 2: TRANSCRIBE
**Location:** `output/transcribe/<slug>/`

Converts audio to text using ElevenLabs Scribe v2 API.

**Inputs:**
- Audio files from `audio-notes/<slug>/`
- `manifest.json` (auto-created if missing)

**Outputs:**
- `transcript.md` — consolidated text from all audio files
- Per-file `.json` responses (in `.gitignore`)
- manifest updated: `stage` → `transcribe`

**Triggering:**
```bash
# Transcribe a single post
make transcribe SLUG=my-post-slug

# Auto-transcribe all pending posts (what launchd runs)
bash pipeline/scripts/auto-transcribe.sh
```

**Considerations:**
- ElevenLabs Scribe v2 pricing applies per minute of audio
- The launchd job runs this automatically every 2 hours
- Raw transcript may have context-specific errors; the preprocess stage refines them

### Stage 3: PRE-PROCESS / OUTLINE
**Location:** `output/outline/<slug>/`

AI agent reads transcript and optional notes, creates structured outline.

**Inputs:**
- `transcript.md` from transcribe stage
- `manifest.json` with context
- `notes.txt` (if present) with links and media hints

**Outputs:**
- `outline.md` — structured outline with sections, talking points, callouts, and screenshot suggestions
- manifest updated: `stage` → `preprocess`

**Triggering:**
```bash
# Process a single post outline (uses Claude)
make advance SLUG=my-post-slug

# Run via Cowork (recommended for interactive refinement)
```

**What the Agent Does:**
- Consolidates multiple voice memo streams into coherent narrative
- Identifies main sections and supporting points
- Suggests category based on content
- Flags missing information or gaps
- Recommends screenshots, embedded tweets, references
- Cleans up transcription errors in context

### Stage 4: DRAFT
**Location:** `output/draft/<slug>/`

AI agent creates the full blog post in Jay's conversational voice.

**Inputs:**
- `outline.md` from preprocess stage
- `transcript.md` for reference and voice patterns
- `manifest.json` (metadata, category)

**Outputs:**
- `draft.md` - full blog post in markdown
  - Hugo front matter (title, date, category, tags)
  - Post content in Jay's voice
  - Inline notes for screenshots/embeds
- manifest updated: `stage` → `draft`

**Triggering:**
```bash
# Create draft for a single post
make draft SLUG=my-post-slug

# Run via Cowork shortcut
# Cowork > Blog Draft > Select Post
```

**Voice & Style Guidelines:**
- Conversational, personal tone (not overly formal)
- Include attributions and links to referenced work
- Use embedded social posts where appropriate
- Add author commentary and personal perspective
- Follow existing post patterns from jkerschner.com/posts/

### Stage 5: REVIEW
**Location:** `output/review/<slug>/`

AI agent reviews draft for consistency, completeness, and quality.

**Inputs:**
- draft.md from draft stage
- outline.md for reference
- manifest.json

**Outputs:**
- `review.md` — draft with inline review comments
- `callouts.md` — items needing human attention (screenshots, embeds, fact-checks, tone issues)
- manifest updated: `stage` → `review`

**Triggering:**
```bash
# Review a single post
make review SLUG=my-post-slug

# Review all drafted posts
bash pipeline/scripts/review.sh --all
```

**Callout Types:**
- `[SCREENSHOT NEEDED]` - AI suggests what to capture
- `[EMBED NEEDED]` - social post or external content to embed
- `[VERIFY]` - fact or claim to double-check
- `[TONE]` - suggested rephrasing for consistency
- `[MISSING]` - outline talked about this, but draft didn't include it

### Stage 6: COLLECT
**Location:** `output/collect/<slug>/`

Collects screenshots, embeds, and code output identified in the review stage. Runs in two modes: headless (automated Playwright screenshots + oEmbed fetches) and interactive (Cowork session for login-required pages and code execution).

**Inputs:**
- `review.md` or `draft.md` with `[SCREENSHOT]`, `[EMBED]`, and `[CODE]` markers

**Outputs:**
- `assets/` directory with collected files
- `assets.json` manifest tracking what succeeded/failed
- manifest updated: `stage` → `collect`

**Triggering:**
```bash
# Headless: capture screenshots and fetch embeds
make collect SLUG=my-post-slug

# Interactive: use Cowork for login-required pages and code execution
# Run via Cowork > Blog Collect shortcut
```

**What the headless collector does:**
- Captures screenshots via Playwright for any `[SCREENSHOT]` marker with a URL
- Fetches oEmbed metadata for Bluesky, Twitter, YouTube, and other platforms
- Generates figure shortcodes with alt text
- Flags items needing login or code execution for Cowork

**What the Cowork collector does:**
- Handles login-required pages via Claude in Chrome
- Runs code blocks with your approval
- Collects screenshots and output the headless path couldn't capture
- Manually embeds or refines content as needed

### Stage 7: PUBLISH
**Location:** `jkerschner.com/content/posts/<slug>/` (page bundle)

Move finalized post to the published location and prepare for Hugo build.

**Inputs:**
- `draft.md` from draft stage (after human review of callouts)
- Collected assets from collect stage

**Outputs:**
- Page bundle at `jkerschner.com/content/posts/<slug>/`
  - `index.md` — finalized post content
  - `screenshot-1.png`, `screenshot-2.png`, etc. — collected assets
- manifest updated: `stage` → `publish`

**Process:**
1. Human reviews callouts in review stage and updates draft.md as needed
2. Run collect to gather screenshots and embeds:
   ```bash
   make collect SLUG=my-post-slug
   ```
3. Run publish command:
   ```bash
   make publish SLUG=my-post-slug
   ```
4. Publish script:
   - Transforms `[SCREENSHOT]` markers into Hugo figure shortcodes
   - Copies assets into the bundle
   - Creates `index.md` with front matter
   - Blocks publish if `[LINK NEEDED]` markers remain
5. Push to git and trigger Hugo deploy on Digital Ocean

**Auto-deploy (future):**
```bash
# Deploy to production
git push origin main
# GitHub Action triggers Hugo rebuild on Digital Ocean
```

## Incremental Processing

The pipeline is designed to run one stage at a time, per post or in batch. No post is forced through all stages—only advance when ready.

**Single post, one stage:**
```bash
make transcribe SLUG=codex-first-impressions
```

**All posts in a stage:**
```bash
bash pipeline/scripts/outline.sh --all
```

**Check status:**
```bash
make status                    # Show all posts and their stage
make status SLUG=my-post       # Detailed status for one post
```

## Getting Started

### Quick Start

1. **Capture Phase:**
   - Build the **Blog Note** shortcut on iPhone (see `pipeline/docs/apple-shortcut-setup.md`)
   - Record voice memos → Share → Blog Note → enter a slug
   - iCloud syncs to Mac automatically

2. **Local Processing (macOS):**
   ```bash
   cd ~/Code/blog

   # Configure API keys
   cp pipeline/.env.example pipeline/.env
   # Edit pipeline/.env with your ELEVENLABS_API_KEY and ANTHROPIC_API_KEY

   # Install the launchd job (auto-transcribes every 2 hours)
   bash pipeline/scripts/install-launchd.sh

   # Or process one post manually through all stages
   make transcribe SLUG=my-post-slug
   make advance SLUG=my-post-slug
   make draft SLUG=my-post-slug
   make review SLUG=my-post-slug
   ```

3. **Review & Collect:**
   - Open `output/review/my-post-slug/callouts.md`
   - Address each callout in `output/draft/my-post-slug/draft.md`
   - Collect screenshots and embeds:
   ```bash
   make collect SLUG=my-post-slug
   ```

4. **Publish:**
   - Review collected assets in `output/collect/my-post-slug/`
   - Run publish to create the page bundle:
   ```bash
   make publish SLUG=my-post-slug
   ```

5. **Deploy:**
   ```bash
   git add jkerschner.com/content/posts/my-post-slug/
   git commit -m "Publish: my-post-slug"
   git push origin main
   ```

### Apple Shortcut: Blog Note

A 4-action share-sheet shortcut for frictionless capture. See `pipeline/docs/apple-shortcut-setup.md` for full build instructions.

**How it works:**
1. Record in Voice Memos as usual
2. Share → **Blog Note** → enter a slug
3. Audio saved to `iCloud Drive/blog-audio-notes/<slug>/`
4. iCloud syncs to Mac → launchd job creates manifest and transcribes

The shortcut only handles audio capture. Manifest creation, transcription, and all processing happen on the Mac side via `auto-transcribe.sh`.

### Cowork Integration

Run stages via Claude Cowork shortcuts (interactive, in-context processing):

**Available Shortcuts:**
- `Blog Transcribe` - Process audio files
- `Blog Outline` - Create structured outline
- `Blog Draft` - Write full post
- `Blog Review` - Review and create callouts
- `Blog Status` - Check pipeline progress

Benefits:
- Real-time interaction (ask clarifying questions)
- Context window is fresh (see full transcript while outlining)
- Can edit output on-the-fly
- No local setup required

### GitHub Actions (Future)

Deploy processing to CI/CD pipeline:

```yaml
# .github/workflows/blog-pipeline.yml
name: Process Blog Posts

on:
  push:
    paths:
      - 'audio-notes/**'
      - 'output/**'

jobs:
  transcribe:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: bash pipeline/scripts/transcribe.sh --all
      - uses: EndBug/add-and-commit@v9
```

## Cross-Device Sync

The pipeline bridges iPhone → iCloud Drive → Mac git repo using rsync:

**Flow:**
1. **iPhone:** Record voice memos → Share → **Blog Note** shortcut → saved to `iCloud Drive/blog-audio-notes/<slug>/`
2. **Mac:** iCloud Drive syncs automatically
3. **rsync bridge:** `auto-transcribe.sh` rsyncs new files from iCloud Drive to `audio-notes/` in the git repo before processing
4. **Processing:** launchd job runs `auto-transcribe.sh` every 2 hours, or run manually / via Cowork
5. **Publish:** Git push triggers Hugo deploy on Digital Ocean

**What's in `.gitignore`:**
- Audio binaries (`audio-notes/**/*.m4a`, etc.) — too large for git
- `pipeline/.env` — API keys
- Per-file transcription JSON — raw Scribe output
- Keep `manifest.json` and `transcript.md` in git for history

## Implementation Notes

### Design Principles

- **Folder structure is the queue:** No separate database needed; folder existence indicates state
- **Manifest files are snapshots:** Each stage creates/updates manifest with completion time
- **Incremental processing:** Each stage is independent; posts can be in different stages
- **Human in the loop:** Review stage creates explicit callouts for human attention
- **Cloud-first for AI:** Transcription and AI stages can run locally or via Cowork
- **Git-friendly:** Markdown and JSON outputs version-control well

### Performance Considerations

- **Transcription:** ElevenLabs Scribe v2 pricing per minute of audio
- **AI Processing:** Claude API costs vary by model and context size
  - Outline: ~$0.01-0.05 per post
  - Draft: ~$0.05-0.20 per post (larger context)
  - Review: ~$0.02-0.10 per post
- **Batch Processing:** `auto-transcribe.sh` handles all pending posts in one run
- **Caching:** Transcripts and outlines are stored to avoid re-processing

### Error Handling

Each script should:
1. Validate manifest.json exists
2. Check dependencies (audio files for transcribe, transcript for outline, etc.)
3. Gracefully skip or report errors
4. Update manifest with `status: error` and error message
5. Preserve partial outputs for recovery

Example:
```json
{
  "status": "error",
  "error": "ElevenLabs API rate limit exceeded",
  "attempted_at": "2026-02-06T14:30:00Z",
  "retry_after": "2026-02-06T15:30:00Z"
}
```

### Future Enhancements

- **Batch Capture:** Multi-day voice memo consolidation
- **Metadata Extraction:** Auto-detect topics, people, references from transcript
- **Media Management:** Auto-screenshot suggestions with AI vision
- **Version Control:** Track edits between stages with diffs
- **Analytics:** Track which stages take longest, which posts iterate most
- **Multi-voice:** Separate narration by speaker (if recording interviews)
- **Refinement Loop:** Easy "re-draft" after human feedback

## Troubleshooting

### Post stuck in a stage
Check manifest.json for `status: error` and error details. Fix the issue and retry the stage.

### Transcript quality is poor
Common causes: background noise, audio quality, fast speech. Try:
- Re-record the section
- Edit raw transcript manually before moving to outline
- Add context in notes.txt to help AI agent

### Draft doesn't match outline
Outline stage may have gaps. Review outline.md and re-run draft with feedback in notes.

### Merge conflicts in git
Audio-notes are in .gitignore; most conflicts will be in manifest.json files. Resolve manually and retry processing.

## Commands Reference

```bash
# Status
make status                    # Show all posts and their stage
make status SLUG=my-post       # Detailed status for one post

# Processing
make new SLUG=my-post CATEGORY=learned      # Create new post
make transcribe SLUG=my-post                # Transcribe audio to text
make advance SLUG=my-post                   # Advance post to next processing stage
make preprocess SLUG=my-post                # Pre-process stage placeholder
make draft SLUG=my-post                     # Create draft from outline
make review SLUG=my-post                    # Review and create callouts
make collect SLUG=my-post                   # Collect screenshots + embeds (headless)
make publish SLUG=my-post                   # Publish to final location

# Batch processing
bash pipeline/scripts/transcribe.sh --all   # Transcribe all pending posts
bash pipeline/scripts/outline.sh --all      # Process outlines for all posts
bash pipeline/scripts/draft.sh --all        # Draft all outlined posts
bash pipeline/scripts/review.sh --all       # Review all drafted posts

# Utilities
bash pipeline/scripts/reset.sh <slug> <stage>   # Reset stage to pending
bash pipeline/scripts/export.sh --format csv    # Export all post metadata
bash pipeline/scripts/cleanup.sh                # Archive old outputs
```

## References

- **Gas Town:** Steve Yegge's multi-agent orchestrator (folder-based queues)
- **Simon Willison Framework:** Blog post categories (Found / Learned / Built)
- **Claude Cowork:** Interactive, multi-step agentic workflows
- **Hugo:** Static site generator used for jkerschner.com

---

**Last Updated:** 2026-02-06
**Maintainer:** Jay Kerschner (@Jayk56)
