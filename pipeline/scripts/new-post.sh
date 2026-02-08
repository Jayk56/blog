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

# Check for required tools
command -v jq &> /dev/null || {
    echo -e "${RED}Error: jq is required but not installed${NC}"
    exit 1
}

# Validate arguments
if [[ $# -lt 2 ]]; then
    echo -e "${RED}Usage: $0 <slug> <category>${NC}"
    echo -e "Categories: found, learned, built"
    exit 1
fi

SLUG="$1"
CATEGORY="$2"

# Validate category
if [[ ! "$CATEGORY" =~ ^(found|learned|built)$ ]]; then
    echo -e "${RED}Error: Category must be one of: found, learned, built${NC}"
    exit 1
fi

# Validate slug format (alphanumeric and hyphens only)
if [[ ! "$SLUG" =~ ^[a-z0-9-]+$ ]]; then
    echo -e "${RED}Error: Slug must contain only lowercase letters, numbers, and hyphens${NC}"
    exit 1
fi

# Check if post already exists
if [[ -d "${AUDIO_NOTES_DIR}/${SLUG}" ]]; then
    echo -e "${RED}Error: Post '${SLUG}' already exists${NC}"
    exit 1
fi

# Create directories
mkdir -p "${AUDIO_NOTES_DIR}/${SLUG}"

# Create manifest.json
CREATED_DATE="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
MANIFEST_PATH="${AUDIO_NOTES_DIR}/${SLUG}/manifest.json"

cat > "${MANIFEST_PATH}" << EOF
{
  "slug": "${SLUG}",
  "category": "${CATEGORY}",
  "title": "",
  "created": "${CREATED_DATE}",
  "lastModified": "${CREATED_DATE}",
  "stage": "capture",
  "tags": []
}
EOF

# Create notes.md
NOTES_PATH="${AUDIO_NOTES_DIR}/${SLUG}/notes.md"
cat > "${NOTES_PATH}" << EOF
# Notes for: ${SLUG}

## Links

## Thoughts

## Key Points
EOF

# Output success message
echo -e "${GREEN}✓ Post '${SLUG}' initialized successfully${NC}"
echo
echo -e "${BLUE}Directory structure:${NC}"
echo "  ${AUDIO_NOTES_DIR}/${SLUG}/"
echo "  ├── manifest.json"
echo "  └── notes.md"
echo
echo -e "${BLUE}Next steps:${NC}"
echo "  1. Record voice notes as .m4a files in: ${AUDIO_NOTES_DIR}/${SLUG}/"
echo "  2. Update notes.md with relevant links and thoughts"
echo "  3. When ready, transcribe with: make transcribe SLUG=${SLUG}"
echo "  4. Check status anytime with: make status"
echo
echo -e "${YELLOW}Tip: Update the title in manifest.json as needed${NC}"
