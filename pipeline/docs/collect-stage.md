# Collect Stage Guide

The collect stage gathers screenshots, social embeds, and code output for your
blog posts. It sits between review and publish in the pipeline.

## Two Modes

### Headless (automated)

```bash
make collect SLUG=my-post-slug
```

Runs `collect.sh`, which:

1. Parses `[SCREENSHOT: ...]` and `[EMBED: ...]` markers from the review or
   draft markdown
2. For screenshots with a URL: launches headless Chromium via Playwright,
   navigates to the page, and captures a 1280×720 viewport screenshot
3. For embeds: detects the platform (Bluesky, Twitter, YouTube) and fetches
   the oEmbed response via curl
4. For `[CODE: ...]` markers: logs them as needing interactive collection
5. Writes `output/collect/<slug>/assets.json` with results

### Interactive (Cowork)

Open a Cowork session and use the prompt at `pipeline/prompts/collect.md`.
This is for anything the headless path can't handle: login-required pages,
complex UI interactions, code execution, or screenshots that need judgment.

The Cowork agent reads `assets.json` to see what failed, then uses Claude in
Chrome to collect the remaining items.

## Setup

Playwright needs to be installed once on your Mac:

```bash
cd ~/Code/blog/pipeline
npm install
npx playwright install chromium
```

This installs a local Chromium binary (~200 MB) that `collect.sh` uses for
screenshots. If Playwright isn't installed, the script will skip screenshots
and mark them as failures.

## Supported Platforms (oEmbed)

| Platform | Detection | oEmbed Endpoint |
|----------|-----------|-----------------|
| Bluesky  | `bsky.app` or `bluesky` in URL | `https://embed.bsky.app/oembed` |
| Twitter/X | `twitter.com` or `x.com` in URL | `https://publish.twitter.com/oembed` |
| YouTube  | `youtube.com` or `youtu.be` in URL | `https://www.youtube.com/oembed` |
| GitHub Gist | `gist.github.com` in URL | Stored as URL (manual embed tag) |

Other platforms are flagged for Cowork/manual collection.

## Output Structure

```
output/collect/<slug>/
├── assets.json         # What was collected and what failed
├── collect.log         # Timestamped log
└── assets/
    ├── screenshot-1.png
    ├── screenshot-2.png
    ├── embed-1.json    # oEmbed response
    ├── code-1.json     # Command output (from Cowork)
    └── code-1.png      # Terminal screenshot (from Cowork)
```

## assets.json Format

```json
{
  "slug": "my-post-slug",
  "collected_at": "2026-02-06T10:00:00Z",
  "total_requested": 5,
  "total_successful": 3,
  "assets": [
    {
      "id": "screenshot-1",
      "type": "screenshot",
      "url": "https://example.com",
      "description": "The dashboard showing results",
      "status": "success",
      "file": "assets/screenshot-1.png",
      "size_bytes": 150000
    }
  ],
  "failures": [
    {
      "marker": "[SCREENSHOT: My terminal showing the codex output]",
      "reason": "No URL in marker — screenshot requires manual capture or Cowork session"
    }
  ]
}
```

## Marker Format Reference

These are the markers the prompts produce in the draft and review stages:

- `[SCREENSHOT: description or URL]` — screenshot to capture
- `[SCREENSHOT: https://example.com "HuggingFace leaderboard"]` — screenshot with URL
- `[EMBED: https://bsky.app/profile/user/post/id]` — social embed to fetch
- `[CODE: codex --help]` — command to run and capture output
- `[LINK NEEDED: description]` — blocks publish until resolved (not collected, must be fixed in draft)

## Troubleshooting

**"Playwright not installed"**: Run `cd pipeline && npm install && npx playwright install chromium`

**Screenshot times out**: The page may be slow or require JavaScript.
Try running Cowork instead — the browser tools handle dynamic pages better.

**oEmbed returns error**: The post may have been deleted, or the platform may
be rate-limiting. Try again later, or use Cowork to manually grab the embed HTML.

**"No URL in marker"**: The `[SCREENSHOT]` description doesn't contain a URL.
This means it's a personal screenshot (like "my terminal") that only Jay can capture,
or it should be collected via Cowork.
