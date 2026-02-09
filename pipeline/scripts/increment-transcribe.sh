#!/bin/bash
# increment-transcribe.sh — Transcribe only NEW audio files for an existing post
#
# Detects untranscribed audio by comparing audio files in the source folder
# against individual JSON transcripts in the output directory. Appends new
# transcriptions to the existing transcript.md without overwriting.
#
# Does NOT change the manifest stage — this is designed for posts that have
# already progressed past "capture".
#
# Usage: increment-transcribe.sh <slug>
# Exit codes: 0 = new files transcribed, 1 = nothing to do or error

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REPO_ROOT="$(git rev-parse --show-toplevel)"
PIPELINE_DIR="${REPO_ROOT}/pipeline"
AUDIO_NOTES_DIR="${REPO_ROOT}/audio-notes"
OUTPUT_DIR="${REPO_ROOT}/output/transcribe"

# Load environment variables
if [[ -f "${PIPELINE_DIR}/.env" ]]; then
    set -a
    source "${PIPELINE_DIR}/.env"
    set +a
fi

# Validate arguments
if [[ $# -lt 1 ]]; then
    echo -e "${RED}Usage: $0 <slug>${NC}"
    exit 1
fi

SLUG="$1"
POST_DIR="${AUDIO_NOTES_DIR}/${SLUG}"
TRANSCRIPT_DIR="${OUTPUT_DIR}/${SLUG}"
TRANSCRIPT_PATH="${TRANSCRIPT_DIR}/transcript.md"

# Load metadata helper
source "${REPO_ROOT}/pipeline/scripts/lib/metadata.sh"

# Validate post exists
if [[ ! -d "${POST_DIR}" ]]; then
    echo -e "${RED}Error: Post '${SLUG}' not found in ${AUDIO_NOTES_DIR}${NC}"
    exit 1
fi

# Check for API key
if [[ -z "${ELEVENLABS_API_KEY:-}" ]]; then
    echo -e "${RED}Error: ELEVENLABS_API_KEY not set${NC}"
    exit 1
fi

# Check for required tools
for tool in jq curl; do
    command -v "$tool" &> /dev/null || {
        echo -e "${RED}Error: $tool is required but not installed${NC}"
        exit 1
    }
done

# Find all audio files
AUDIO_FILES=()
while IFS= read -r -d '' file; do
    AUDIO_FILES+=("$file")
done < <(find "${POST_DIR}" -maxdepth 1 \( -name "*.m4a" -o -name "*.mp3" -o -name "*.wav" -o -name "*.webm" -o -name "*.mp4" \) -type f -print0 | sort -z)

if [[ ${#AUDIO_FILES[@]} -eq 0 ]]; then
    exit 1  # No audio files at all
fi

# Find which files are NEW (no corresponding JSON in output dir)
NEW_FILES=()
for audio_file in "${AUDIO_FILES[@]}"; do
    FILENAME=$(basename "$audio_file")
    BASENAME="${FILENAME%.*}"
    JSON_PATH="${TRANSCRIPT_DIR}/${BASENAME}.json"

    if [[ ! -f "$JSON_PATH" ]]; then
        NEW_FILES+=("$audio_file")
    fi
done

if [[ ${#NEW_FILES[@]} -eq 0 ]]; then
    echo "[$(date '+%Y-%m-%d %H:%M')] No new audio files for ${SLUG}"
    exit 1  # Nothing to do
fi

echo -e "${BLUE}Found ${#NEW_FILES[@]} new audio file(s) to transcribe for ${SLUG}${NC}"

# Ensure output directory exists
mkdir -p "$TRANSCRIPT_DIR"

# Transcribe each new file
NEW_TRANSCRIPT=""
FILE_COUNT=0
TRANSCRIBE_START=$(date +%s)
NEW_AUDIO_DURATION=0
NEW_AUDIO_SIZE=0
NEW_WORD_COUNT=0
NEW_FILE_METADATA="[]"

for audio_file in "${NEW_FILES[@]}"; do
    FILE_COUNT=$((FILE_COUNT + 1))
    FILENAME=$(basename "$audio_file")

    echo -e "${YELLOW}Transcribing [${FILE_COUNT}/${#NEW_FILES[@]}]: ${FILENAME}${NC}"

    # Call ElevenLabs Speech-to-Text API (Scribe v2)
    RESPONSE=$(curl -s -X POST \
        -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
        -F "file=@${audio_file}" \
        -F "model_id=scribe_v2" \
        -F "language_code=en" \
        -F "tag_audio_events=false" \
        "https://api.elevenlabs.io/v1/speech-to-text")

    # Check for errors
    if echo "$RESPONSE" | jq -e '.detail' &> /dev/null; then
        ERROR_MSG=$(echo "$RESPONSE" | jq -r '.detail.message // .detail')
        echo -e "${RED}Error transcribing ${FILENAME}: ${ERROR_MSG}${NC}"
        continue  # Don't exit — try the other files
    fi

    # Extract transcript text
    TRANSCRIPT=$(echo "$RESPONSE" | jq -r '.text // empty')

    if [[ -z "$TRANSCRIPT" ]]; then
        echo -e "${RED}Error: Empty transcript returned for ${FILENAME}${NC}"
        continue
    fi

    # Save individual JSON (same as transcribe.sh)
    INDIVIDUAL_PATH="${TRANSCRIPT_DIR}/${FILENAME%.*}.json"
    echo "$RESPONSE" | jq '.' > "${INDIVIDUAL_PATH}" 2>/dev/null || true

    # Extract metadata from response
    AUDIO_DURATION=$(echo "$RESPONSE" | jq '[.words[-1].end // 0] | max')
    AUDIO_SIZE=$(stat -f%z "$audio_file" 2>/dev/null || stat -c%s "$audio_file" 2>/dev/null || echo "0")
    FILE_WORD_COUNT=$(echo "$TRANSCRIPT" | wc -w | tr -d ' ')

    NEW_AUDIO_DURATION=$(echo "$NEW_AUDIO_DURATION + $AUDIO_DURATION" | bc)
    NEW_AUDIO_SIZE=$((NEW_AUDIO_SIZE + AUDIO_SIZE))
    NEW_WORD_COUNT=$((NEW_WORD_COUNT + FILE_WORD_COUNT))

    NEW_FILE_METADATA=$(echo "$NEW_FILE_METADATA" | jq \
        --arg name "$FILENAME" \
        --argjson dur "$AUDIO_DURATION" \
        --argjson size "$AUDIO_SIZE" \
        '. + [{"name": $name, "duration_seconds": $dur, "size_bytes": $size}]')

    # Build the new section
    NEW_TRANSCRIPT+="## ${FILENAME}"$'\n'
    NEW_TRANSCRIPT+="${TRANSCRIPT}"$'\n\n'

    echo -e "${GREEN}✓ Transcribed: ${FILENAME}${NC}"
done

if [[ -z "$NEW_TRANSCRIPT" ]]; then
    echo -e "${RED}All new files failed to transcribe${NC}"
    exit 1
fi

# Append to existing transcript.md
if [[ -f "$TRANSCRIPT_PATH" ]]; then
    # Append with a separator
    cat >> "$TRANSCRIPT_PATH" << EOF

---

# Follow-up recordings (added $(date -u +'%Y-%m-%d %H:%M:%S UTC'))

${NEW_TRANSCRIPT}
EOF
    echo -e "${GREEN}✓ Appended ${FILE_COUNT} new transcription(s) to ${TRANSCRIPT_PATH}${NC}"
else
    # No existing transcript — create one (edge case: transcript was deleted)
    cat > "$TRANSCRIPT_PATH" << EOF
# Transcript: ${SLUG}

Generated: $(date -u +'%Y-%m-%d %H:%M:%S UTC')
Audio files: ${#NEW_FILES[@]} (incremental)
Model: ElevenLabs Scribe v2

---

${NEW_TRANSCRIPT}
EOF
    echo -e "${GREEN}✓ Created transcript with ${FILE_COUNT} file(s): ${TRANSCRIPT_PATH}${NC}"
fi

# Write metadata (incremental — merges with existing audio data)
TRANSCRIBE_END=$(date +%s)
TRANSCRIBE_DURATION=$((TRANSCRIBE_END - TRANSCRIBE_START))

# Read existing totals and add new amounts
EXISTING_META=$(metadata_read "$SLUG")
PREV_DURATION=$(echo "$EXISTING_META" | jq '.audio.total_duration_seconds // 0')
PREV_SIZE=$(echo "$EXISTING_META" | jq '.audio.total_size_bytes // 0')
PREV_FILE_COUNT=$(echo "$EXISTING_META" | jq '.audio.file_count // 0')
PREV_WORD_COUNT=$(echo "$EXISTING_META" | jq '.transcription.word_count // 0')

UPDATED_DURATION=$(echo "$PREV_DURATION + $NEW_AUDIO_DURATION" | bc)
UPDATED_SIZE=$((PREV_SIZE + NEW_AUDIO_SIZE))
UPDATED_FILE_COUNT=$((PREV_FILE_COUNT + ${#NEW_FILES[@]}))
UPDATED_WORD_COUNT=$((PREV_WORD_COUNT + NEW_WORD_COUNT))

ESTIMATED_COST=$(echo "scale=4; $UPDATED_DURATION * 0.0001" | bc)

metadata_merge "$SLUG" "$(jq -n \
    --argjson file_count "$UPDATED_FILE_COUNT" \
    --argjson total_dur "$UPDATED_DURATION" \
    --argjson total_size "$UPDATED_SIZE" \
    --argjson files "$NEW_FILE_METADATA" \
    --arg completed "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
    --argjson dur "$TRANSCRIBE_DURATION" \
    --argjson words "$UPDATED_WORD_COUNT" \
    --arg lang "eng" \
    --argjson cost "$ESTIMATED_COST" \
    '{
        audio: { file_count: $file_count, total_duration_seconds: $total_dur, total_size_bytes: $total_size, files: $files },
        transcription: { completed_at: $completed, duration_seconds: $dur, word_count: $words, language: $lang, estimated_cost_usd: $cost }
    }')"

echo -e "${GREEN}✓ Metadata updated${NC}"

exit 0
