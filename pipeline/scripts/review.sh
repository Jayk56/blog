#!/bin/bash
# review.sh — Run the review agent via Claude Code CLI
#
# Reads the draft + transcript + outline for a post, sends them to the
# claude CLI in print mode (-p) with the review prompt, and saves the
# reviewed output with inline comments, callouts, readiness score, and
# collect-stage markers ([SCREENSHOT:], [EMBED:], etc.).
#
# Usage: review.sh <slug>
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

# Load metadata helper
source "${REPO_ROOT}/pipeline/scripts/lib/metadata.sh"

DRAFT_PATH="${OUTPUT_DIR}/draft/${SLUG}/draft.md"
TRANSCRIPT_PATH="${OUTPUT_DIR}/transcribe/${SLUG}/transcript.md"
OUTLINE_PATH="${OUTPUT_DIR}/outline/${SLUG}/outline.md"
MANIFEST_PATH="${AUDIO_NOTES_DIR}/${SLUG}/manifest.json"
PROMPT_PATH="${PIPELINE_DIR}/prompts/review.md"
REVIEW_DIR="${OUTPUT_DIR}/review/${SLUG}"
REVIEW_PATH="${REVIEW_DIR}/review.md"

echo -e "${BLUE}=== Review: ${SLUG} ===${NC}"

# Validate inputs exist
if [[ ! -f "$DRAFT_PATH" ]]; then
    echo -e "${RED}Error: Draft not found at ${DRAFT_PATH}${NC}"
    exit 1
fi

if [[ ! -f "$TRANSCRIPT_PATH" ]]; then
    echo -e "${RED}Error: Transcript not found at ${TRANSCRIPT_PATH}${NC}"
    exit 1
fi

if [[ ! -f "$OUTLINE_PATH" ]]; then
    echo -e "${RED}Error: Outline not found at ${OUTLINE_PATH}${NC}"
    exit 1
fi

if [[ ! -f "$MANIFEST_PATH" ]]; then
    echo -e "${RED}Error: Manifest not found at ${MANIFEST_PATH}${NC}"
    exit 1
fi

if [[ ! -f "$PROMPT_PATH" ]]; then
    echo -e "${RED}Error: Review prompt not found at ${PROMPT_PATH}${NC}"
    exit 1
fi

# Read inputs
DRAFT=$(cat "$DRAFT_PATH")
TRANSCRIPT=$(cat "$TRANSCRIPT_PATH")
OUTLINE=$(cat "$OUTLINE_PATH")
MANIFEST=$(cat "$MANIFEST_PATH")

# Build the user message with all context
USER_MESSAGE="Please review the following blog post draft.

## Manifest
\`\`\`json
${MANIFEST}
\`\`\`

## Draft
${DRAFT}

## Transcript
${TRANSCRIPT}

## Outline
${OUTLINE}"

echo "Running claude CLI in print mode (this may take 30-60 seconds)..."

# Create output directory
mkdir -p "$REVIEW_DIR"

REVIEW_START=$(date +%s)

# Run claude in print mode with JSON output to capture metadata:
#   -p                    = non-interactive, print response to stdout
#   --system-prompt-file  = use our review prompt as the system instructions
#   --output-format json  = JSON wrapper with token usage and cost data
#   --allowedTools ""     = no tool use — all context is piped in, just generate text
CLAUDE_JSON=$(echo "$USER_MESSAGE" | claude -p \
    --system-prompt-file "$PROMPT_PATH" \
    --output-format json \
    --allowedTools "" \
    2>"${REVIEW_DIR}/claude-stderr.log")

# Save full Claude response for debugging/reference
echo "$CLAUDE_JSON" > "${REVIEW_DIR}/claude-response.json"

# Extract the actual review content from the JSON wrapper
REVIEW_CONTENT=$(echo "$CLAUDE_JSON" | jq -r '.result // empty')

if [[ -z "$REVIEW_CONTENT" ]]; then
    echo -e "${RED}Error: Empty response from claude CLI${NC}"
    echo "Check ${REVIEW_DIR}/claude-response.json for details"
    exit 1
fi

REVIEW_END=$(date +%s)
REVIEW_DURATION=$((REVIEW_END - REVIEW_START))

# Extract metadata from Claude CLI JSON response
DURATION_API_MS=$(echo "$CLAUDE_JSON" | jq '.duration_api_ms // 0')
COST_USD=$(echo "$CLAUDE_JSON" | jq '.total_cost_usd // 0')
MODEL=$(echo "$CLAUDE_JSON" | jq -r '.modelUsage | keys[0] // "unknown"')
INPUT_TOKENS=$(echo "$CLAUDE_JSON" | jq '.usage.input_tokens // 0')
OUTPUT_TOKENS=$(echo "$CLAUDE_JSON" | jq '.usage.output_tokens // 0')
CACHE_CREATION=$(echo "$CLAUDE_JSON" | jq '.usage.cache_creation_input_tokens // 0')
CACHE_READ=$(echo "$CLAUDE_JSON" | jq '.usage.cache_read_input_tokens // 0')

metadata_merge "$SLUG" "$(jq -n \
    --arg started "$(date -u -r "$REVIEW_START" +'%Y-%m-%dT%H:%M:%SZ')" \
    --arg completed "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
    --argjson dur "$REVIEW_DURATION" \
    --argjson api_ms "$DURATION_API_MS" \
    --arg model "$MODEL" \
    --argjson input "$INPUT_TOKENS" \
    --argjson output "$OUTPUT_TOKENS" \
    --argjson cache_create "$CACHE_CREATION" \
    --argjson cache_read "$CACHE_READ" \
    --argjson cost "$COST_USD" \
    '{
        review: {
            started_at: $started,
            completed_at: $completed,
            duration_seconds: $dur,
            duration_api_ms: $api_ms,
            model: $model,
            input_tokens: $input,
            output_tokens: $output,
            cache_creation_tokens: $cache_create,
            cache_read_tokens: $cache_read,
            cost_usd: $cost
        }
    }')"

echo -e "${GREEN}✓ Metadata saved (cost: \$$(printf '%.4f' "$COST_USD"), tokens: ${INPUT_TOKENS}in/${OUTPUT_TOKENS}out)${NC}"

# Save the review
echo "$REVIEW_CONTENT" > "$REVIEW_PATH"

echo -e "${GREEN}✓ Review saved: ${REVIEW_PATH}${NC}"

# Advance the manifest
PREV_STAGE=$(jq -r '.stage // "draft"' "$MANIFEST_PATH" 2>/dev/null)
MANIFEST_UPDATED=$(jq \
    --arg stage "review" \
    --arg lastModified "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
    '.stage = $stage | .lastModified = $lastModified' \
    "$MANIFEST_PATH")
echo "$MANIFEST_UPDATED" > "$MANIFEST_PATH"

# Log stage transition to metadata
metadata_log_transition "$SLUG" "$PREV_STAGE" "review"

echo -e "${GREEN}✓ Manifest updated: stage → review (was ${PREV_STAGE})${NC}"
echo
echo -e "${BLUE}Review complete! Open the editor to see inline comments and callouts.${NC}"
echo "  Next: Address callouts, then run 'make advance SLUG=${SLUG}' to move to collect"
