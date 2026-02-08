#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Get repository root
REPO_ROOT="$(git rev-parse --show-toplevel)"
AUDIO_NOTES_DIR="${REPO_ROOT}/audio-notes"

# Check for required tools
command -v jq &> /dev/null || {
    echo -e "${RED}Error: jq is required but not installed${NC}"
    exit 1
}

# Function to format date for display
format_date() {
    local iso_date="$1"
    if [[ -z "$iso_date" ]]; then
        echo "—"
    else
        # Parse ISO 8601 date and format as YYYY-MM-DD HH:MM
        echo "$iso_date" | cut -d'T' -f1
    fi
}

# Function to color stage
color_stage() {
    local stage="$1"
    case "$stage" in
        "capture")
            echo -e "${YELLOW}${stage}${NC}"
            ;;
        "transcribe")
            echo -e "${BLUE}${stage}${NC}"
            ;;
        "preprocess")
            echo -e "${BLUE}${stage}${NC}"
            ;;
        "draft")
            echo -e "${BLUE}${stage}${NC}"
            ;;
        "review")
            echo -e "${YELLOW}${stage}${NC}"
            ;;
        "collect")
            echo -e "${YELLOW}${stage}${NC}"
            ;;
        "publish")
            echo -e "${GREEN}${stage}${NC}"
            ;;
        "published")
            echo -e "${GREEN}${BOLD}${stage}${NC}"
            ;;
        *)
            echo "$stage"
            ;;
    esac
}

# If a slug is provided, show detailed status for that post
if [[ $# -eq 1 ]]; then
    SLUG="$1"
    POST_DIR="${AUDIO_NOTES_DIR}/${SLUG}"
    MANIFEST_PATH="${POST_DIR}/manifest.json"

    if [[ ! -f "${MANIFEST_PATH}" ]]; then
        echo -e "${RED}Error: Post '${SLUG}' not found${NC}"
        exit 1
    fi

    # Read manifest
    MANIFEST=$(cat "${MANIFEST_PATH}")

    echo -e "${BOLD}${BLUE}Detailed Status: ${SLUG}${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo

    echo "Slug:          $(jq -r '.slug' <<< "$MANIFEST")"
    echo "Title:         $(jq -r '.title // "—"' <<< "$MANIFEST")"
    echo "Category:      $(jq -r '.category' <<< "$MANIFEST")"
    echo "Stage:         $(color_stage "$(jq -r '.stage' <<< "$MANIFEST")")"
    echo "Created:       $(format_date "$(jq -r '.created' <<< "$MANIFEST")")"
    echo "Last Modified: $(format_date "$(jq -r '.lastModified' <<< "$MANIFEST")")"
    echo
    echo "Tags:          $(jq -r '.tags | join(", ") // "—"' <<< "$MANIFEST")"
    echo
    echo "Files:"
    echo "  Notes:      ${MANIFEST_PATH%/*}/notes.md"

    # List audio files
    AUDIO_FILES=$(find "${POST_DIR}" -maxdepth 1 -name "*.m4a" -type f | sort)
    if [[ -n "$AUDIO_FILES" ]]; then
        echo "  Audio:"
        while IFS= read -r file; do
            echo "    • $(basename "$file")"
        done <<< "$AUDIO_FILES"
    fi

    # Show output files
    STAGE=$(jq -r '.stage' <<< "$MANIFEST")
    case "$STAGE" in
        "transcribe"|"preprocess"|"draft"|"review"|"publish")
            if [[ -d "${REPO_ROOT}/output/transcribe/${SLUG}" ]]; then
                echo "  Transcription:"
                find "${REPO_ROOT}/output/transcribe/${SLUG}" -type f | sort | sed 's|.*|    • &|'
            fi
            ;;
    esac

    exit 0
fi

# Show all posts
echo -e "${BOLD}${BLUE}Pipeline Status${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# Check if any posts exist
if [[ ! -d "$AUDIO_NOTES_DIR" ]] || [[ -z "$(find "$AUDIO_NOTES_DIR" -maxdepth 1 -type d ! -name audio-notes)" ]]; then
    echo -e "${YELLOW}No posts found in pipeline${NC}"
    echo "Create a new post with: make new SLUG=my-post CATEGORY=learned"
    exit 0
fi

# Find all posts and display table header
printf "%-20s %-12s %-12s %-10s %-10s\n" "SLUG" "CATEGORY" "STAGE" "CREATED" "MODIFIED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Iterate through all posts
for post_dir in "${AUDIO_NOTES_DIR}"/*; do
    if [[ ! -d "$post_dir" ]]; then
        continue
    fi

    SLUG=$(basename "$post_dir")
    MANIFEST_PATH="${post_dir}/manifest.json"

    if [[ ! -f "$MANIFEST_PATH" ]]; then
        continue
    fi

    # Read manifest values
    MANIFEST=$(cat "$MANIFEST_PATH")
    CATEGORY=$(jq -r '.category' <<< "$MANIFEST")
    STAGE=$(jq -r '.stage' <<< "$MANIFEST")
    CREATED=$(jq -r '.created' <<< "$MANIFEST" | cut -d'T' -f1)
    MODIFIED=$(jq -r '.lastModified' <<< "$MANIFEST" | cut -d'T' -f1)

    # Color the stage
    STAGE_COLORED=$(color_stage "$STAGE")

    # Print row (without colors in the formatted output, add them separately)
    printf "%-20s %-12s %-12s %-10s %-10s\n" \
        "$SLUG" \
        "$CATEGORY" \
        "$(echo -e "$STAGE_COLORED" | sed 's/\x1b\[[0-9;]*m//g')" \
        "$CREATED" \
        "$MODIFIED"
done

echo
echo -e "${BLUE}Legend:${NC}"
echo "  capture    - Recording audio notes"
echo "  transcribe - Converting audio to text"
echo "  preprocess - Organizing transcript content"
echo "  draft      - Writing the blog post"
echo "  review     - Reviewing and editing"
echo "  collect    - Gathering screenshots and embeds"
echo "  publish    - Ready for publication"
echo
echo -e "${BLUE}Commands:${NC}"
echo "  make new SLUG=slug CATEGORY=learned       - Create new post"
echo "  make transcribe SLUG=slug                 - Transcribe audio"
echo "  make advance SLUG=slug                    - Move to next stage"
echo "  make status SLUG=slug                     - Detailed status"
