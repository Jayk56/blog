#!/bin/bash
# preprocess.sh — Run the preprocess agent via Claude Code CLI
#
# Reads the transcript + notes + manifest for a post, sends them to the
# claude CLI in print mode (-p) with the preprocess prompt, and saves
# the outline. Uses your existing Claude Code credentials — no extra
# API key or costs.
#
# Usage: preprocess.sh <slug> [--update]
#
# Flags:
#   --update  Update an existing outline with new transcript content
#             (uses update-preprocess.md prompt, does NOT advance manifest)
#
# Requires: claude CLI installed and authenticated

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REPO_ROOT="$(git rev-parse --show-toplevel)"
PIPELINE_DIR="${REPO_ROOT}/pipeline"
OUTPUT_DIR="${REPO_ROOT}/output"
AUDIO_NOTES_DIR="${REPO_ROOT}/audio-notes"

# Validate claude CLI is available
if ! command -v claude &> /dev/null; then
    echo -e "${RED}Error: claude CLI not found. Install Claude Code first.${NC}"
    exit 1
fi

# Validate arguments
if [[ $# -lt 1 ]]; then
    echo -e "${RED}Usage: $0 <slug>${NC}"
    exit 1
fi

SLUG="$1"
UPDATE_MODE=false
if [[ "${2:-}" == "--update" ]]; then
    UPDATE_MODE=true
fi

TRANSCRIPT_PATH="${OUTPUT_DIR}/transcribe/${SLUG}/transcript.md"
MANIFEST_PATH="${AUDIO_NOTES_DIR}/${SLUG}/manifest.json"
NOTES_PATH="${AUDIO_NOTES_DIR}/${SLUG}/notes.md"
OUTLINE_DIR="${OUTPUT_DIR}/outline/${SLUG}"
OUTLINE_PATH="${OUTLINE_DIR}/outline.md"

# Use the appropriate prompt based on mode
if [[ "$UPDATE_MODE" == true ]]; then
    PROMPT_PATH="${PIPELINE_DIR}/prompts/update-preprocess.md"
    echo -e "${BLUE}=== Update Outline: ${SLUG} ===${NC}"
else
    PROMPT_PATH="${PIPELINE_DIR}/prompts/preprocess.md"
    echo -e "${BLUE}=== Preprocess: ${SLUG} ===${NC}"
fi

# Validate inputs exist
if [[ ! -f "$TRANSCRIPT_PATH" ]]; then
    echo -e "${RED}Error: Transcript not found at ${TRANSCRIPT_PATH}${NC}"
    exit 1
fi

if [[ ! -f "$MANIFEST_PATH" ]]; then
    echo -e "${RED}Error: Manifest not found at ${MANIFEST_PATH}${NC}"
    exit 1
fi

if [[ ! -f "$PROMPT_PATH" ]]; then
    echo -e "${RED}Error: Preprocess prompt not found at ${PROMPT_PATH}${NC}"
    exit 1
fi

# Read inputs
TRANSCRIPT=$(cat "$TRANSCRIPT_PATH")
MANIFEST=$(cat "$MANIFEST_PATH")
CATEGORY=$(jq -r '.category // "unknown"' "$MANIFEST_PATH")

NOTES=""
if [[ -f "$NOTES_PATH" ]]; then
    NOTES=$(cat "$NOTES_PATH")
fi

# Build the user message with all context
USER_MESSAGE="Please preprocess the following content for my blog post.

## Manifest
\`\`\`json
${MANIFEST}
\`\`\`

## Category
${CATEGORY}

## Transcript
${TRANSCRIPT}"

if [[ -n "$NOTES" ]]; then
    USER_MESSAGE="${USER_MESSAGE}

## Notes
${NOTES}"
fi

# In update mode, include the existing outline for context
if [[ "$UPDATE_MODE" == true ]]; then
    if [[ ! -f "$OUTLINE_PATH" ]]; then
        echo -e "${RED}Error: --update requires an existing outline at ${OUTLINE_PATH}${NC}"
        exit 1
    fi
    EXISTING_OUTLINE=$(cat "$OUTLINE_PATH")
    USER_MESSAGE="${USER_MESSAGE}

## Existing Outline
${EXISTING_OUTLINE}"
fi

echo "Running claude CLI in print mode (this may take 30-60 seconds)..."

# Create output directory
mkdir -p "$OUTLINE_DIR"

# Run claude in print mode:
#   -p                    = non-interactive, print response to stdout
#   --system-prompt-file  = use our preprocess prompt as the system instructions
#   --output-format text  = clean markdown output (no JSON wrapper)
#   --allowedTools ""     = no tool use — all context is piped in, just generate text
OUTLINE_CONTENT=$(echo "$USER_MESSAGE" | claude -p \
    --system-prompt-file "$PROMPT_PATH" \
    --output-format text \
    --allowedTools "" \
    2>"${OUTLINE_DIR}/claude-stderr.log")

if [[ -z "$OUTLINE_CONTENT" ]]; then
    echo -e "${RED}Error: Empty response from claude CLI${NC}"
    exit 1
fi

# Save the outline
echo "$OUTLINE_CONTENT" > "$OUTLINE_PATH"

echo -e "${GREEN}✓ Outline saved: ${OUTLINE_PATH}${NC}"

# Advance the manifest (only for initial preprocess, not updates)
if [[ "$UPDATE_MODE" == true ]]; then
    echo -e "${GREEN}✓ Outline updated (manifest stage unchanged)${NC}"
else
    MANIFEST_UPDATED=$(jq \
        --arg stage "preprocess" \
        --arg lastModified "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
        '.stage = $stage | .lastModified = $lastModified' \
        "$MANIFEST_PATH")
    echo "$MANIFEST_UPDATED" > "$MANIFEST_PATH"

    echo -e "${GREEN}✓ Manifest updated: stage → preprocess${NC}"
    echo
    echo -e "${BLUE}Next: Review the outline, then${NC}"
    echo "  make advance SLUG=${SLUG}   (to move to draft)"
fi
