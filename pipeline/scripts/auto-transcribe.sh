#!/bin/bash

# auto-transcribe.sh — cron-friendly script that finds audio-notes folders
# with audio files, ensures they have a manifest, and transcribes them.
#
# Three passes:
#   Pass 1:   Folders at stage "capture" → full transcription
#   Pass 1.5: Any folder with new audio files → incremental transcription
#   Pass 2:   Posts needing preprocessing or outline updates
#
# This lets the Apple Shortcut skip manifest creation entirely — just drop
# audio into a slug folder and this script handles the rest.
#
# Usage:
#   bash pipeline/scripts/auto-transcribe.sh
#
# Cron example (every 2 hours):
#   0 */2 * * * cd /path/to/blog && bash pipeline/scripts/auto-transcribe.sh >> /tmp/blog-auto-transcribe.log 2>&1

set -euo pipefail

# Ensure Homebrew tools (jq, claude, etc.) are on PATH.
# launchd runs with a minimal PATH that doesn't include /opt/homebrew/bin.
export PATH="/opt/homebrew/bin:${PATH}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
AUDIO_NOTES_DIR="${REPO_ROOT}/audio-notes"
OUTPUT_DIR="${REPO_ROOT}/output/transcribe"

# Load environment variables
if [[ -f "${REPO_ROOT}/pipeline/.env" ]]; then
    set -a
    source "${REPO_ROOT}/pipeline/.env"
    set +a
fi

# --- Sync from iCloud Drive ---
# The Blog Note shortcut on iPhone saves to iCloud Drive/blog-audio-notes/.
# brctl download forces iCloud to materialize any stub files before rsync runs.
# The Finder "Keep Downloaded" setting on this folder handles most cases, but
# brctl catches files that just arrived from iPhone.
ICLOUD_AUDIO="${HOME}/Library/Mobile Documents/com~apple~CloudDocs/blog-audio-notes"
if [[ -d "$ICLOUD_AUDIO" ]]; then
    brctl download "$ICLOUD_AUDIO" 2>/dev/null || true

    # Wait for iCloud to finish materializing files (up to 60s).
    # Stubs show up as .filename.icloud — once downloaded, the real file replaces them.
    WAIT_LIMIT=60
    WAITED=0
    while [[ $WAITED -lt $WAIT_LIMIT ]]; do
        STUBS=$(find "$ICLOUD_AUDIO" -maxdepth 2 -name ".*.icloud" 2>/dev/null | wc -l | tr -d ' ')
        [[ "$STUBS" -gt 0 ]] || break
        echo "[$(date '+%Y-%m-%d %H:%M')] Waiting for ${STUBS} iCloud file(s) to download..."
        sleep 5
        WAITED=$((WAITED + 5))
    done

    rsync -av --ignore-existing "$ICLOUD_AUDIO/" "${AUDIO_NOTES_DIR}/"
    echo "[$(date '+%Y-%m-%d %H:%M')] Synced from iCloud Drive (waited ${WAITED}s for downloads)"
else
    echo "[$(date '+%Y-%m-%d %H:%M')] iCloud audio dir not found (${ICLOUD_AUDIO}), skipping sync"
fi

# Check for jq
command -v jq &>/dev/null || {
    echo "[$(date '+%Y-%m-%d %H:%M')] ERROR: jq is required but not installed"
    exit 1
}

PROCESSED=0
SKIPPED=0
MANIFESTS_CREATED=0

for post_dir in "${AUDIO_NOTES_DIR}"/*/; do
    [[ -d "$post_dir" ]] || continue

    SLUG=$(basename "$post_dir")
    MANIFEST="${post_dir}/manifest.json"
    TRANSCRIPT="${OUTPUT_DIR}/${SLUG}/transcript.md"

    # Count audio files in this folder
    AUDIO_COUNT=$(find "$post_dir" -maxdepth 1 \( -name "*.m4a" -o -name "*.mp3" -o -name "*.wav" -o -name "*.webm" -o -name "*.mp4" \) -type f 2>/dev/null | wc -l | tr -d ' ')

    # Skip folders with no audio
    [[ "$AUDIO_COUNT" -gt 0 ]] || continue

    # --- Create manifest if missing ---
    if [[ ! -f "$MANIFEST" ]]; then
        # Derive created date from the oldest audio file in the folder
        OLDEST_FILE=$(find "$post_dir" -maxdepth 1 \( -name "*.m4a" -o -name "*.mp3" -o -name "*.wav" -o -name "*.webm" -o -name "*.mp4" \) -type f -print0 2>/dev/null | xargs -0 stat -f '%m %N' 2>/dev/null | sort -n | head -1 | cut -d' ' -f2-)

        if [[ -n "$OLDEST_FILE" ]]; then
            # macOS stat for modification time in ISO format
            CREATED_DATE=$(stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%SZ' "$OLDEST_FILE" 2>/dev/null || date -u +'%Y-%m-%dT%H:%M:%SZ')
        else
            CREATED_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
        fi

        cat > "$MANIFEST" << MANIFEST_EOF
{
  "slug": "${SLUG}",
  "category": "",
  "title": "",
  "created": "${CREATED_DATE}",
  "lastModified": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "stage": "capture",
  "tags": []
}
MANIFEST_EOF

        echo "[$(date '+%Y-%m-%d %H:%M')] Created manifest for: ${SLUG} (${AUDIO_COUNT} audio files, oldest: $(basename "${OLDEST_FILE:-unknown}"))"
        MANIFESTS_CREATED=$((MANIFESTS_CREATED + 1))
    fi

    # --- Check stage ---
    STAGE=$(jq -r '.stage // "unknown"' "$MANIFEST" 2>/dev/null)
    [[ "$STAGE" == "capture" ]] || { SKIPPED=$((SKIPPED + 1)); continue; }

    # --- Skip if already transcribed ---
    [[ ! -f "$TRANSCRIPT" ]] || { SKIPPED=$((SKIPPED + 1)); continue; }

    # --- Transcribe ---
    echo "[$(date '+%Y-%m-%d %H:%M')] Transcribing: ${SLUG} (${AUDIO_COUNT} files)"
    bash "${SCRIPT_DIR}/transcribe.sh" "$SLUG" && PROCESSED=$((PROCESSED + 1)) || { echo "  ERROR: transcription failed for ${SLUG}"; continue; }
done

echo "[$(date '+%Y-%m-%d %H:%M')] Pass 1 done. Manifests created: ${MANIFESTS_CREATED}, Transcribed: ${PROCESSED}, Skipped: ${SKIPPED}"

# =============================================================================
# Pass 1.5: Incremental transcription — detect new audio files at ANY stage
# =============================================================================
# Posts that already passed "capture" may get follow-up recordings. Compare
# audio files in the source folder against individual JSONs in the output
# directory to find untranscribed files.

INCREMENTAL=0

for post_dir in "${AUDIO_NOTES_DIR}"/*/; do
    [[ -d "$post_dir" ]] || continue
    SLUG=$(basename "$post_dir")
    TRANSCRIPT_OUT="${OUTPUT_DIR}/${SLUG}"

    # Only check posts that have already been transcribed at least once
    [[ -d "$TRANSCRIPT_OUT" ]] || continue

    # Count audio files in source folder
    AUDIO_COUNT=$(find "$post_dir" -maxdepth 1 \( -name "*.m4a" -o -name "*.mp3" -o -name "*.wav" -o -name "*.webm" -o -name "*.mp4" \) -type f 2>/dev/null | wc -l | tr -d ' ')

    # Count JSON transcripts in output directory
    JSON_COUNT=$(find "$TRANSCRIPT_OUT" -maxdepth 1 -name "*.json" -type f 2>/dev/null | wc -l | tr -d ' ')

    if [[ "$AUDIO_COUNT" -gt "$JSON_COUNT" ]]; then
        echo "[$(date '+%Y-%m-%d %H:%M')] New audio detected for ${SLUG} (${AUDIO_COUNT} audio, ${JSON_COUNT} transcribed)"
        bash "${SCRIPT_DIR}/increment-transcribe.sh" "$SLUG" && INCREMENTAL=$((INCREMENTAL + 1)) || echo "  ERROR: incremental transcription failed for ${SLUG}"
    fi
done

echo "[$(date '+%Y-%m-%d %H:%M')] Pass 1.5 done. Incremental transcriptions: ${INCREMENTAL}"

# =============================================================================
# Pass 2: Auto-preprocess (new outlines) and auto-update (existing outlines)
# =============================================================================
# After transcription, run the preprocess agent via the claude CLI to generate
# an outline. Uses your existing Claude Code credentials — no extra API costs.

if ! command -v claude &> /dev/null; then
    echo "[$(date '+%Y-%m-%d %H:%M')] Skipping auto-preprocess (claude CLI not found)"
    exit 0
fi

PREPROCESSED=0
UPDATED=0

for post_dir in "${AUDIO_NOTES_DIR}"/*/; do
    [[ -d "$post_dir" ]] || continue
    SLUG=$(basename "$post_dir")
    MANIFEST="${post_dir}/manifest.json"

    [[ -f "$MANIFEST" ]] || continue

    TRANSCRIPT="${REPO_ROOT}/output/transcribe/${SLUG}/transcript.md"
    [[ -f "$TRANSCRIPT" ]] || continue

    OUTLINE="${REPO_ROOT}/output/outline/${SLUG}/outline.md"

    STAGE=$(jq -r '.stage // "unknown"' "$MANIFEST" 2>/dev/null)

    # Case 1: No outline yet, post is at "transcribe" stage → create outline
    if [[ "$STAGE" == "transcribe" && ! -f "$OUTLINE" ]]; then
        echo "[$(date '+%Y-%m-%d %H:%M')] Preprocessing: ${SLUG}"
        bash "${SCRIPT_DIR}/preprocess.sh" "$SLUG" && PREPROCESSED=$((PREPROCESSED + 1)) || echo "  ERROR: preprocess failed for ${SLUG}"
        continue
    fi

    # Case 2: Outline exists but transcript is newer → update outline
    if [[ -f "$OUTLINE" ]]; then
        # Compare modification times (macOS stat -f '%m' returns epoch seconds)
        TRANSCRIPT_MTIME=$(stat -f '%m' "$TRANSCRIPT" 2>/dev/null || echo 0)
        OUTLINE_MTIME=$(stat -f '%m' "$OUTLINE" 2>/dev/null || echo 0)

        if [[ "$TRANSCRIPT_MTIME" -gt "$OUTLINE_MTIME" ]]; then
            echo "[$(date '+%Y-%m-%d %H:%M')] Updating outline for: ${SLUG} (transcript newer than outline)"
            bash "${SCRIPT_DIR}/preprocess.sh" "$SLUG" --update && UPDATED=$((UPDATED + 1)) || echo "  ERROR: outline update failed for ${SLUG}"
        fi
    fi
done

echo "[$(date '+%Y-%m-%d %H:%M')] Pass 2 done. New outlines: ${PREPROCESSED}, Updated: ${UPDATED}"
