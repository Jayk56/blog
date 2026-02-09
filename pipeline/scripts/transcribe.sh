#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get repository root
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

# Check for required tools
for tool in jq curl; do
    command -v "$tool" &> /dev/null || {
        echo -e "${RED}Error: $tool is required but not installed${NC}"
        exit 1
    }
done

# Validate arguments
if [[ $# -lt 1 ]]; then
    echo -e "${RED}Usage: $0 <slug>${NC}"
    exit 1
fi

SLUG="$1"
POST_DIR="${AUDIO_NOTES_DIR}/${SLUG}"
MANIFEST_PATH="${POST_DIR}/manifest.json"

# Load metadata helper
source "${REPO_ROOT}/pipeline/scripts/lib/metadata.sh"

# Validate post exists
if [[ ! -d "${POST_DIR}" ]]; then
    echo -e "${RED}Error: Post '${SLUG}' not found in ${AUDIO_NOTES_DIR}${NC}"
    exit 1
fi

if [[ ! -f "${MANIFEST_PATH}" ]]; then
    echo -e "${RED}Error: manifest.json not found for post '${SLUG}'${NC}"
    exit 1
fi

# Check for API key
if [[ -z "${ELEVENLABS_API_KEY:-}" ]]; then
    echo -e "${RED}Error: ELEVENLABS_API_KEY not set${NC}"
    echo "Set it in ${PIPELINE_DIR}/.env or export ELEVENLABS_API_KEY=your-key"
    exit 1
fi

# Find all audio files (.m4a, .mp3, .wav, .webm, .mp4)
# Use null-delimited find + while-read for Bash 3.2 (macOS) compatibility
AUDIO_FILES=()
while IFS= read -r -d '' file; do
    AUDIO_FILES+=("$file")
done < <(find "${POST_DIR}" -maxdepth 1 \( -name "*.m4a" -o -name "*.mp3" -o -name "*.wav" -o -name "*.webm" -o -name "*.mp4" \) -type f -print0 | sort -z)

if [[ ${#AUDIO_FILES[@]} -eq 0 ]]; then
    echo -e "${RED}Error: No audio files found in ${POST_DIR}${NC}"
    exit 1
fi

echo -e "${BLUE}Found ${#AUDIO_FILES[@]} audio file(s) to transcribe via ElevenLabs Scribe v2${NC}"

# Create output directory
mkdir -p "${OUTPUT_DIR}/${SLUG}"

# Transcribe each file
COMBINED_TRANSCRIPT=""
FILE_COUNT=0
TRANSCRIBE_START=$(date +%s)
TOTAL_AUDIO_DURATION=0
TOTAL_AUDIO_SIZE=0
TOTAL_WORD_COUNT=0
AUDIO_FILE_METADATA="[]"

for audio_file in "${AUDIO_FILES[@]}"; do
    FILE_COUNT=$((FILE_COUNT + 1))
    FILENAME=$(basename "$audio_file")

    echo -e "${YELLOW}Transcribing [${FILE_COUNT}/${#AUDIO_FILES[@]}]: ${FILENAME}${NC}"

    # Call ElevenLabs Speech-to-Text API (Scribe v2)
    RESPONSE=$(curl -s -X POST \
        -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
        -F "file=@${audio_file}" \
        -F "model_id=scribe_v2" \
        -F "language_code=en" \
        -F "tag_audio_events=false" \
        "https://api.elevenlabs.io/v1/speech-to-text")

    # Check for errors (ElevenLabs returns detail field on error)
    if echo "$RESPONSE" | jq -e '.detail' &> /dev/null; then
        ERROR_MSG=$(echo "$RESPONSE" | jq -r '.detail.message // .detail')
        echo -e "${RED}Error transcribing ${FILENAME}: ${ERROR_MSG}${NC}"
        exit 1
    fi

    # Extract transcript text from ElevenLabs response
    TRANSCRIPT=$(echo "$RESPONSE" | jq -r '.text // empty')

    if [[ -z "$TRANSCRIPT" ]]; then
        echo -e "${RED}Error: Empty transcript returned for ${FILENAME}${NC}"
        echo "Raw response:"
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        exit 1
    fi

    # Save individual transcript with word-level data if available
    INDIVIDUAL_PATH="${OUTPUT_DIR}/${SLUG}/${FILENAME%.*}.json"
    echo "$RESPONSE" | jq '.' > "${INDIVIDUAL_PATH}" 2>/dev/null || true

    # Extract metadata from response
    AUDIO_DURATION=$(echo "$RESPONSE" | jq '[.words[-1].end // 0] | max')
    AUDIO_SIZE=$(stat -f%z "$audio_file" 2>/dev/null || stat -c%s "$audio_file" 2>/dev/null || echo "0")
    FILE_WORD_COUNT=$(echo "$TRANSCRIPT" | wc -w | tr -d ' ')

    TOTAL_AUDIO_DURATION=$(echo "$TOTAL_AUDIO_DURATION + $AUDIO_DURATION" | bc)
    TOTAL_AUDIO_SIZE=$((TOTAL_AUDIO_SIZE + AUDIO_SIZE))
    TOTAL_WORD_COUNT=$((TOTAL_WORD_COUNT + FILE_WORD_COUNT))

    AUDIO_FILE_METADATA=$(echo "$AUDIO_FILE_METADATA" | jq \
        --arg name "$FILENAME" \
        --argjson dur "$AUDIO_DURATION" \
        --argjson size "$AUDIO_SIZE" \
        '. + [{"name": $name, "duration_seconds": $dur, "size_bytes": $size}]')

    # Add to combined transcript with file header
    COMBINED_TRANSCRIPT+="## ${FILENAME}"$'\n'
    COMBINED_TRANSCRIPT+="${TRANSCRIPT}"$'\n\n'

    echo -e "${GREEN}✓ Transcribed: ${FILENAME}${NC}"
done

# Save combined transcript
TRANSCRIPT_PATH="${OUTPUT_DIR}/${SLUG}/transcript.md"
cat > "${TRANSCRIPT_PATH}" << EOF
# Transcript: ${SLUG}

Generated: $(date -u +'%Y-%m-%d %H:%M:%S UTC')
Audio files: ${#AUDIO_FILES[@]}
Model: ElevenLabs Scribe v2

---

${COMBINED_TRANSCRIPT}
EOF

echo
echo -e "${GREEN}✓ Combined transcript saved${NC}"
echo "  ${TRANSCRIPT_PATH}"

# Write metadata
TRANSCRIBE_END=$(date +%s)
TRANSCRIBE_DURATION=$((TRANSCRIBE_END - TRANSCRIBE_START))
ESTIMATED_COST=$(echo "scale=4; $TOTAL_AUDIO_DURATION * 0.0001" | bc)

metadata_merge "$SLUG" "$(jq -n \
    --argjson file_count "${#AUDIO_FILES[@]}" \
    --argjson total_dur "$TOTAL_AUDIO_DURATION" \
    --argjson total_size "$TOTAL_AUDIO_SIZE" \
    --argjson files "$AUDIO_FILE_METADATA" \
    --arg started "$(date -u -r "$TRANSCRIBE_START" +'%Y-%m-%dT%H:%M:%SZ')" \
    --arg completed "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
    --argjson dur "$TRANSCRIBE_DURATION" \
    --argjson words "$TOTAL_WORD_COUNT" \
    --arg lang "eng" \
    --argjson cost "$ESTIMATED_COST" \
    '{
        audio: { file_count: $file_count, total_duration_seconds: $total_dur, total_size_bytes: $total_size, files: $files },
        transcription: { started_at: $started, completed_at: $completed, duration_seconds: $dur, word_count: $words, language: $lang, estimated_cost_usd: $cost }
    }')"

echo -e "${GREEN}✓ Metadata saved${NC}"

# Update manifest.json
MANIFEST_UPDATED=$(jq \
    --arg stage "transcribe" \
    --arg lastModified "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
    '.stage = $stage | .lastModified = $lastModified' \
    "${MANIFEST_PATH}")

echo "$MANIFEST_UPDATED" > "${MANIFEST_PATH}"

echo -e "${GREEN}✓ Manifest updated: stage -> transcribe${NC}"
echo
echo -e "${BLUE}Next steps:${NC}"
echo "  1. Review the transcript: ${TRANSCRIPT_PATH}"
echo "  2. Preprocess and organize content"
echo "  3. Advance stage with: make advance SLUG=${SLUG}"
