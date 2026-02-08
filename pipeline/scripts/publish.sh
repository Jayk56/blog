#!/bin/bash
# publish.sh — Build Hugo page bundle from draft + collected assets
#
# Reads the draft, replaces [SCREENSHOT] and [EMBED] markers with Hugo shortcodes,
# copies assets into the page bundle, and advances the manifest.
#
# Usage: publish.sh <slug>

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REPO_ROOT="$(git rev-parse --show-toplevel)"
OUTPUT_DIR="${REPO_ROOT}/output"
POSTS_DIR="${REPO_ROOT}/jkerschner.com/content/posts"

if [[ $# -lt 1 ]]; then
    echo -e "${RED}Usage: $0 <slug>${NC}"
    exit 1
fi

SLUG="$1"
DRAFT_MD="${OUTPUT_DIR}/draft/${SLUG}/draft.md"
ASSETS_JSON="${OUTPUT_DIR}/collect/${SLUG}/assets.json"
ASSETS_DIR="${OUTPUT_DIR}/collect/${SLUG}/assets"
BUNDLE_DIR="${POSTS_DIR}/${SLUG}"
MANIFEST="${REPO_ROOT}/audio-notes/${SLUG}/manifest.json"

echo -e "${BLUE}=== Publish: ${SLUG} ===${NC}"

# --- Validate inputs ---

if [[ ! -f "$DRAFT_MD" ]]; then
    echo -e "${RED}Error: Draft not found at ${DRAFT_MD}${NC}"
    exit 1
fi

if [[ ! -f "$ASSETS_JSON" ]]; then
    echo -e "${RED}Error: assets.json not found at ${ASSETS_JSON}${NC}"
    echo "Run 'make collect SLUG=${SLUG}' first"
    exit 1
fi

# --- Check for blocking markers ---

LINK_NEEDED=$(grep -c '\[LINK NEEDED:' "$DRAFT_MD" 2>/dev/null || true)
if [[ "$LINK_NEEDED" -gt 0 ]]; then
    echo -e "${RED}Error: ${LINK_NEEDED} [LINK NEEDED: ...] markers still in draft${NC}"
    grep '\[LINK NEEDED:' "$DRAFT_MD" | while read -r line; do
        echo -e "  ${RED}•${NC} ${line}"
    done
    echo
    echo "Resolve all [LINK NEEDED] markers before publishing."
    exit 1
fi

# --- Create page bundle ---

mkdir -p "$BUNDLE_DIR"

# Start with the draft content
cp "$DRAFT_MD" "${BUNDLE_DIR}/index.md"

echo "Created: ${BUNDLE_DIR}/index.md"

# --- Copy collected assets into the bundle ---

ASSET_COUNT=0
if [[ -d "$ASSETS_DIR" ]]; then
    for asset_file in "${ASSETS_DIR}"/*; do
        [[ -f "$asset_file" ]] || continue
        cp "$asset_file" "${BUNDLE_DIR}/"
        ASSET_COUNT=$((ASSET_COUNT + 1))
    done
fi

echo "Copied: ${ASSET_COUNT} assets into page bundle"

# --- Transform markers in index.md ---

BUNDLE_MD="${BUNDLE_DIR}/index.md"

# Replace [SCREENSHOT: ...] markers with Hugo figure shortcodes
# Uses the assets.json to map marker order → filename
SCREENSHOT_IDX=0
while IFS= read -r match_line; do
    SCREENSHOT_IDX=$((SCREENSHOT_IDX + 1))
    ID="screenshot-${SCREENSHOT_IDX}"

    # Check if this asset was collected
    ASSET_FILE=$(jq -r --arg id "$ID" '.assets[] | select(.id == $id) | .file' "$ASSETS_JSON" 2>/dev/null || true)

    if [[ -n "$ASSET_FILE" && "$ASSET_FILE" != "null" ]]; then
        # Extract just the filename from the asset path
        ASSET_FILENAME=$(basename "$ASSET_FILE")

        # Extract description for alt text
        DESCRIPTION=$(echo "$match_line" | sed -E 's/.*\[SCREENSHOT:\s*//' | sed 's/\].*$//' | sed 's/"/\\"/g')

        # Build the replacement shortcode
        SHORTCODE="{{< figure src=\"${ASSET_FILENAME}\" alt=\"${DESCRIPTION}\" class=\"mx-auto\" >}}"

        # Escape the match line for sed
        ESCAPED_MATCH=$(printf '%s\n' "$match_line" | sed 's/[[\.*^$()+?{|/]/\\&/g')
        ESCAPED_REPLACE=$(printf '%s\n' "$SHORTCODE" | sed 's/[&/\]/\\&/g')

        if [[ "$(uname)" == "Darwin" ]]; then
            sed -i '' "s/${ESCAPED_MATCH}/${ESCAPED_REPLACE}/" "$BUNDLE_MD" 2>/dev/null || true
        else
            sed -i "s/${ESCAPED_MATCH}/${ESCAPED_REPLACE}/" "$BUNDLE_MD" 2>/dev/null || true
        fi

        echo "  Transformed: ${ID} → {{< figure src=\"${ASSET_FILENAME}\" >}}"
    else
        echo -e "  ${YELLOW}Kept marker: ${ID} (no collected asset)${NC}"
    fi
done < <(grep '\[SCREENSHOT:' "$DRAFT_MD" 2>/dev/null || true)

# Replace [EMBED: ...] markers with embed HTML
EMBED_IDX=0
while IFS= read -r match_line; do
    EMBED_IDX=$((EMBED_IDX + 1))
    ID="embed-${EMBED_IDX}"

    ASSET_FILE=$(jq -r --arg id "$ID" '.assets[] | select(.id == $id) | .file' "$ASSETS_JSON" 2>/dev/null || true)

    if [[ -n "$ASSET_FILE" && "$ASSET_FILE" != "null" ]]; then
        EMBED_JSON="${OUTPUT_DIR}/collect/${SLUG}/${ASSET_FILE}"

        if [[ -f "$EMBED_JSON" ]]; then
            # Extract embed HTML from the oEmbed response
            EMBED_HTML=$(jq -r '.html // .embed_html // empty' "$EMBED_JSON" 2>/dev/null || true)

            if [[ -n "$EMBED_HTML" ]]; then
                # Write the embed HTML to a temp file and use it for replacement
                # (Complex HTML is hard to sed-replace inline)
                # Instead, use a marker-based approach: replace the line entirely
                TEMP_FILE=$(mktemp)
                while IFS= read -r draft_line; do
                    if echo "$draft_line" | grep -q "\[EMBED:.*${ID}\|${match_line}" 2>/dev/null; then
                        echo "$EMBED_HTML"
                    else
                        echo "$draft_line"
                    fi
                done < "$BUNDLE_MD" > "$TEMP_FILE"
                mv "$TEMP_FILE" "$BUNDLE_MD"

                echo "  Transformed: ${ID} → embed HTML"
            else
                echo -e "  ${YELLOW}Kept marker: ${ID} (no HTML in oEmbed response)${NC}"
            fi
        fi
    else
        echo -e "  ${YELLOW}Kept marker: ${ID} (no collected asset)${NC}"
    fi
done < <(grep '\[EMBED:' "$DRAFT_MD" 2>/dev/null || true)

# --- Update manifest ---

if [[ -f "$MANIFEST" ]]; then
    MANIFEST_UPDATED=$(jq \
        --arg stage "publish" \
        --arg lastModified "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
        '.stage = $stage | .lastModified = $lastModified' \
        "$MANIFEST")
    echo "$MANIFEST_UPDATED" > "$MANIFEST"
fi

# --- Summary ---

echo
echo -e "${GREEN}=== Published: ${SLUG} ===${NC}"
echo "Page bundle: ${BUNDLE_DIR}/"
echo "  index.md + ${ASSET_COUNT} assets"
echo
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Review the published bundle: ${BUNDLE_DIR}/index.md"
echo "2. Run 'hugo server' to preview"
echo "3. Git add, commit, and push to deploy:"
echo "   git add jkerschner.com/content/posts/${SLUG}/"
echo "   git commit -m \"Publish: ${SLUG}\""
echo "   git push origin main"
