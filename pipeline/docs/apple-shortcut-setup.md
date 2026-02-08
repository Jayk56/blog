# Apple Shortcut: "Blog Note"

A share-sheet shortcut that takes voice memos (or any audio) and drops them
into the right folder structure for the pipeline to pick up.

Verified against iOS 26 (Shortcuts app, February 2026).

## How It Works

1. Record in Voice Memos as usual (zero friction, 1-tap).
2. When done, tap Share → **Blog Note**.
3. The shortcut asks for a slug (e.g. `codex-first-impressions`).
4. It saves the audio to an iCloud Drive folder named after the slug.
5. iCloud syncs to your Mac → the launchd job creates the manifest and
   transcribes automatically.

You can share multiple voice memos to the same slug over hours or days.
Each one gets added to the folder. The Mac-side script only transcribes
once you stop adding files (or you can trigger it manually).

## Build the Shortcut (4 actions)

Open the **Shortcuts** app on your iPhone and tap the **+** button (top right)
to create a new shortcut.

### Step 1: Enable the Share Sheet

Before adding actions, configure the shortcut to appear in the Share Sheet:

1. Tap the **ⓘ** (info) button at the **bottom** of the shortcut editor.
2. Under **Share Sheet**, toggle it **ON**.
3. Tap **Any** next to "Types" and change it to only accept **Audio** and
   **Files**. This prevents the shortcut from showing up when sharing photos,
   URLs, etc. — it'll only appear for voice memos and audio files.
4. Tap **Done** to close the info panel.

You should now see a small bar at the top of the editor that says
**"Receive Audio and Files from Share Sheet"**. If there is an "If there is
no input" option, set it to **Stop and Respond**.

### Step 2: Ask for the slug

1. Tap **Add Action** (or the search bar at the bottom).
2. Search for **"Ask for Input"** and add it.
3. Configure:
   - **Text** as the input type
   - Prompt: `Post slug (lowercase-hyphens-only):`
   - Leave the default answer blank.

### Step 3: Create the folder + save the audio

1. Search for **"Create Folder"** and add it.
2. Service: **iCloud Drive**
3. Path: type `blog-audio-notes/` then tap the path field and insert the
   **Provided Input** (from Ask for Input) after the slash.
   - Final path should read: `blog-audio-notes/[Provided Input]`

> If the folder already exists (e.g. you're adding a second or third
> recording to the same post), this action succeeds silently.

4. Search for **"Save File"** and add it.
5. Input: tap and select **Shortcut Input** (the audio from the Share Sheet).
6. Destination path: `iCloud Drive/blog-audio-notes/[Provided Input]/`
   - Insert the Provided Input variable from Step 2.
7. **Ask Where to Save**: toggle **OFF** (critical — otherwise you get a
   file picker every time).
8. **Overwrite If File Exists**: leave **OFF** (so re-sharing the same
   recording doesn't clobber it).

### Step 4: Confirmation

1. Search for **"Show Notification"** and add it.
2. Body: type `Saved to blog-audio-notes/` and insert the Provided Input.

### Step 5: Name it

1. Tap the dropdown/name at the top of the shortcut editor.
2. Rename to **Blog Note**.
3. Optionally pick an icon (microphone works well).

### Done

Your shortcut is just 4 actions:

```
Receive [Audio, Files] from Share Sheet
  ↓
Ask for Input → "Post slug"
  ↓
Create Folder → iCloud Drive/blog-audio-notes/[slug]
  ↓
Save File → Shortcut Input → blog-audio-notes/[slug]/
  ↓
Show Notification → "Saved to blog-audio-notes/[slug]"
```

No manifest, no variables, no JSON. The Mac-side `auto-transcribe.sh`
script creates the manifest automatically when it finds a folder with
audio files.

## Multi-file workflow

The intended workflow for a post with multiple voice memo sections:

1. **Day 1**: Record intro thoughts → Share → Blog Note → slug: `my-post`
2. **Day 1**: Record section 2 → Share → Blog Note → slug: `my-post`
3. **Day 2**: Record more thoughts → Share → Blog Note → slug: `my-post`
4. **Day 2**: You're done recording → the next launchd run picks it all up

Each recording gets its own filename in the same folder. The transcription
script processes them all together into one combined `transcript.md`, ordered
by filename.

**Tip**: Voice Memos names files with timestamps, so they naturally sort in
recording order. If you want explicit ordering, rename them in Voice Memos
before sharing (e.g. `01-intro`, `02-skills`, `03-conclusion`).

## Gotchas

- **iCloud Drive path**: Shortcuts can only write to paths under
  `iCloud Drive/` — not arbitrary filesystem paths. That's why we use
  `blog-audio-notes/` in iCloud Drive and bridge to the git repo on Mac.
- **"Ask Where to Save" must be OFF**: If it's ON, you get a file browser
  every time, defeating the automation.
- **Offline recording**: Voice Memos saved to iCloud Drive while offline
  will have a cloud icon with "!" — they'll sync automatically when you
  get connectivity. The launchd job on Mac will pick them up on its next run.
- **Slug format**: Use lowercase with hyphens only (e.g. `codex-first-impressions`).
  Spaces in folder names cause issues with the bash scripts.

## Mac Side: Sync to Git Repo

The shortcut saves to `iCloud Drive/blog-audio-notes/`. Your git repo expects
files in `~/Code/blog/audio-notes/`. The rsync bridge in `auto-transcribe.sh`
handles this automatically.

Every time `auto-transcribe.sh` runs (via launchd every 2 hours, or manually),
it rsyncs new folders and files from iCloud Drive into the git repo before
processing. The `--ignore-existing` flag ensures files already in the repo
are never overwritten. Audio binaries are in `.gitignore` so they won't bloat
the repo.

No manual setup is needed — the rsync is built into the automation script.

## End-to-End Flow

```
iPhone                    Mac                         Pipeline
──────                    ───                         ────────
Voice Memos          iCloud Drive syncs            launchd job (every 2hr)
    │                     │                              │
    ▼                     ▼                              ▼
Share → Blog Note    ~/Library/Mobile Docs/       auto-transcribe.sh
    │                blog-audio-notes/                   │
    ▼                    <slug>/                    1. Rsync from iCloud
Creates folder           *.m4a                        → audio-notes/
+ saves audio            *.m4a                     2. Creates manifest.json
                         *.m4a                        if missing
                                                   3. Calls ElevenLabs
                                                      Scribe v2
                                                   4. Saves transcript.md
                                                         │
                                                  output/transcribe/
                                                  <slug>/transcript.md
                                                         │
                                                  (ready for preprocess)
```

## Testing

1. Build the shortcut on your iPhone.
2. Record a quick 10-second voice memo.
3. Tap the voice memo → Share → **Blog Note** → enter slug `test-shortcut`.
4. Wait for iCloud to sync (usually <30 seconds on wifi).
5. On Mac, verify the file arrived:
   ```bash
   ls ~/Library/Mobile\ Documents/com~apple~CloudDocs/blog-audio-notes/test-shortcut/
   ```
6. Test the auto-transcribe (it will rsync from iCloud, create the manifest, and transcribe):
   ```bash
   cd ~/Code/blog && bash pipeline/scripts/auto-transcribe.sh
   ```
7. Check the output:
   ```bash
   cat audio-notes/test-shortcut/manifest.json
   cat output/transcribe/test-shortcut/transcript.md
   ```
