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
AUDIO_NOTES_DIR="${REPO_ROOT}/audio-notes"
OUTPUT_DIR="${REPO_ROOT}/output"

# Check for required tools
command -v jq &> /dev/null || {
    echo -e "${RED}Error: jq is required but not installed${NC}"
    exit 1
}

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
    echo -e "${RED}Error: Post '${SLUG}' not found${NC}"
    exit 1
fi

if [[ ! -f "${MANIFEST_PATH}" ]]; then
    echo -e "${RED}Error: manifest.json not found for post '${SLUG}'${NC}"
    exit 1
fi

# Read current stage
CURRENT_STAGE=$(jq -r '.stage' "${MANIFEST_PATH}")

# Stage progression helpers (Bash 3.2 compatible — no associative arrays)
get_stage_output() {
    case "$1" in
        capture)    echo "audio-notes/${SLUG}/*.m4a" ;;
        transcribe) echo "output/transcribe/${SLUG}/transcript.md" ;;
        preprocess) echo "output/outline/${SLUG}/*.md" ;;
        draft)      echo "output/draft/${SLUG}/*.md" ;;
        review)     echo "output/review/${SLUG}/*.md" ;;
        collect)    echo "output/collect/${SLUG}/assets.json" ;;
        publish)    echo "jkerschner.com/content/posts/${SLUG}/index.md" ;;
        *)          echo "" ;;
    esac
}

get_next_stage() {
    case "$1" in
        capture)    echo "transcribe" ;;
        transcribe) echo "preprocess" ;;
        preprocess) echo "draft" ;;
        draft)      echo "review" ;;
        review)     echo "collect" ;;
        collect)    echo "publish" ;;
        publish)    echo "published" ;;
        *)          echo "" ;;
    esac
}

NEXT=$(get_next_stage "${CURRENT_STAGE}")

# Validate current stage
if [[ -z "${NEXT}" ]]; then
    echo -e "${RED}Error: Unknown stage '${CURRENT_STAGE}' in manifest${NC}"
    exit 1
fi

# Check if we're at the end
if [[ "${CURRENT_STAGE}" == "published" ]]; then
    echo -e "${YELLOW}Post '${SLUG}' is already published${NC}"
    exit 0
fi

# Validate that current stage output exists
PATTERN=$(get_stage_output "${CURRENT_STAGE}")
PATTERN_EXPANDED="${REPO_ROOT}/${PATTERN}"

# Check if output exists
if ! compgen -G "${PATTERN_EXPANDED}" > /dev/null; then
    echo -e "${RED}Error: Expected output not found for stage '${CURRENT_STAGE}'${NC}"
    echo "Looking for: ${PATTERN}"
    exit 1
fi

# Update manifest
MANIFEST_UPDATED=$(jq \
    --arg stage "$NEXT" \
    --arg lastModified "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
    '.stage = $stage | .lastModified = $lastModified' \
    "${MANIFEST_PATH}")

echo "$MANIFEST_UPDATED" > "${MANIFEST_PATH}"

# Log stage transition to metadata
metadata_log_transition "$SLUG" "$CURRENT_STAGE" "$NEXT"

echo -e "${GREEN}✓ Advanced '${SLUG}' from '${CURRENT_STAGE}' to '${NEXT}'${NC}"
echo
echo -e "${BLUE}Current stage: ${NEXT}${NC}"

# Print next steps based on stage
case "$NEXT" in
    "preprocess")
        echo "Process and organize the transcript into structured content"
        echo "Create or update files in: ${REPO_ROOT}/output/outline/${SLUG}/"
        ;;
    "draft")
        echo "Write the draft blog post based on processed content"
        echo "Create or update files in: ${REPO_ROOT}/output/draft/${SLUG}/"
        ;;
    "review")
        echo "Review the draft for accuracy, tone, and completeness"
        echo "Make edits or approvals in: ${REPO_ROOT}/output/review/${SLUG}/"
        ;;
    "collect")
        echo "Collect screenshots, embeds, and code output"
        echo "  Headless: make collect SLUG=${SLUG}"
        echo "  Interactive: use Cowork with pipeline/prompts/collect.md"
        echo "Output: ${REPO_ROOT}/output/collect/${SLUG}/"
        ;;
    "publish")
        echo "Build page bundle and publish to Hugo content directory"
        echo "  make publish SLUG=${SLUG}"
        echo "Output: ${REPO_ROOT}/jkerschner.com/content/posts/${SLUG}/"
        ;;
    "published")
        echo "Post is ready to be published!"
        ;;
esac

echo
echo "Advance again with: make advance SLUG=${SLUG}"
