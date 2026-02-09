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

# Load metadata helper
source "${REPO_ROOT}/pipeline/scripts/lib/metadata.sh"

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

# --- Copy only referenced assets into the bundle ---

# Build list of filenames actually referenced in the draft
# 1) Directly via figure shortcodes: {{< figure src="filename.ext" ... >}}
# 2) Indirectly via [SCREENSHOT] markers that map to assets in assets.json
REFERENCED_FILES=()

# Parse figure src= references
while IFS= read -r src; do
    [[ -n "$src" ]] && REFERENCED_FILES+=("$src")
done < <(grep -oE 'src="[^"]+"' "$DRAFT_MD" 2>/dev/null | sed 's/src="//;s/"//')

# Parse SCREENSHOT markers → map to asset filenames via assets.json
SCREENSHOT_MAP_IDX=0
while IFS= read -r _; do
    SCREENSHOT_MAP_IDX=$((SCREENSHOT_MAP_IDX + 1))
    MAPPED_FILE=$(jq -r --arg id "screenshot-${SCREENSHOT_MAP_IDX}" \
        '.assets[] | select(.id == $id) | .file' "$ASSETS_JSON" 2>/dev/null || true)
    if [[ -n "$MAPPED_FILE" && "$MAPPED_FILE" != "null" ]]; then
        REFERENCED_FILES+=("$(basename "$MAPPED_FILE")")
    fi
done < <(grep '\[SCREENSHOT:' "$DRAFT_MD" 2>/dev/null || true)

# Parse EMBED markers → map to asset filenames via assets.json
EMBED_MAP_IDX=0
while IFS= read -r _; do
    EMBED_MAP_IDX=$((EMBED_MAP_IDX + 1))
    MAPPED_FILE=$(jq -r --arg id "embed-${EMBED_MAP_IDX}" \
        '.assets[] | select(.id == $id) | .file' "$ASSETS_JSON" 2>/dev/null || true)
    if [[ -n "$MAPPED_FILE" && "$MAPPED_FILE" != "null" ]]; then
        REFERENCED_FILES+=("$(basename "$MAPPED_FILE")")
    fi
done < <(grep '\[EMBED:' "$DRAFT_MD" 2>/dev/null || true)

# Deduplicate
REFERENCED_UNIQUE=($(printf '%s\n' "${REFERENCED_FILES[@]}" | sort -u))

ASSET_COUNT=0
SKIPPED_COUNT=0
if [[ -d "$ASSETS_DIR" ]]; then
    for asset_file in "${ASSETS_DIR}"/*; do
        [[ -f "$asset_file" ]] || continue
        BASENAME=$(basename "$asset_file")

        # Check if this file is referenced
        IS_REFERENCED=false
        for ref in "${REFERENCED_UNIQUE[@]}"; do
            if [[ "$ref" == "$BASENAME" ]]; then
                IS_REFERENCED=true
                break
            fi
        done

        if $IS_REFERENCED; then
            cp "$asset_file" "${BUNDLE_DIR}/"
            ASSET_COUNT=$((ASSET_COUNT + 1))
        else
            SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
            echo -e "  ${YELLOW}Skipped: ${BASENAME} (not referenced in draft)${NC}"
        fi
    done
fi

echo "Copied: ${ASSET_COUNT} referenced assets into page bundle (skipped ${SKIPPED_COUNT} unreferenced)"

# --- Optimize large images ---
# Convert PNGs over 200KB to JPEG for smaller page bundles

IMAGE_SIZE_THRESHOLD=204800  # 200KB in bytes
CONVERTED_COUNT=0

for img_file in "${BUNDLE_DIR}"/*.png; do
    [[ -f "$img_file" ]] || continue
    FSIZE=$(stat -f%z "$img_file" 2>/dev/null || stat -c%s "$img_file" 2>/dev/null || echo "0")

    if [[ "$FSIZE" -gt "$IMAGE_SIZE_THRESHOLD" ]]; then
        PNG_NAME=$(basename "$img_file")
        JPG_NAME="${PNG_NAME%.png}.jpg"
        JPG_PATH="${BUNDLE_DIR}/${JPG_NAME}"

        # Convert: prefer sips (macOS native), fall back to ImageMagick convert
        if command -v sips &>/dev/null; then
            sips -s format jpeg -s formatOptions 85 "$img_file" --out "$JPG_PATH" &>/dev/null
        elif command -v convert &>/dev/null; then
            convert "$img_file" -quality 85 "$JPG_PATH" 2>/dev/null
        else
            echo -e "  ${YELLOW}No converter for ${PNG_NAME} (install sips or ImageMagick)${NC}"
            continue
        fi

        if [[ -f "$JPG_PATH" ]]; then
            NEW_SIZE=$(stat -f%z "$JPG_PATH" 2>/dev/null || stat -c%s "$JPG_PATH" 2>/dev/null || echo "0")
            # Only keep the JPEG if it's actually smaller
            if [[ "$NEW_SIZE" -lt "$FSIZE" ]]; then
                rm "$img_file"
                # Update references in index.md
                if [[ "$(uname)" == "Darwin" ]]; then
                    sed -i '' "s/${PNG_NAME}/${JPG_NAME}/g" "$BUNDLE_MD"
                else
                    sed -i "s/${PNG_NAME}/${JPG_NAME}/g" "$BUNDLE_MD"
                fi
                SAVINGS=$(( (FSIZE - NEW_SIZE) / 1024 ))
                echo -e "  ${GREEN}Converted: ${PNG_NAME} → ${JPG_NAME} (saved ${SAVINGS}KB)${NC}"
                CONVERTED_COUNT=$((CONVERTED_COUNT + 1))
            else
                # JPEG is larger (rare for photos, common for screenshots with text)
                rm "$JPG_PATH"
                echo -e "  Kept PNG: ${PNG_NAME} (JPEG was larger)"
            fi
        fi
    fi
done

if [[ "$CONVERTED_COUNT" -gt 0 ]]; then
    echo "Converted: ${CONVERTED_COUNT} images to JPEG"
fi

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

# --- Metadata ---

# Calculate bundle size
BUNDLE_SIZE=0
for f in "${BUNDLE_DIR}"/*; do
    [[ -f "$f" ]] || continue
    FSIZE=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo "0")
    BUNDLE_SIZE=$((BUNDLE_SIZE + FSIZE))
done

metadata_merge "$SLUG" "$(jq -n \
    --arg published "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
    --argjson size "$BUNDLE_SIZE" \
    --argjson assets "$ASSET_COUNT" \
    '{
        publish: {
            published_at: $published,
            bundle_size_bytes: $size,
            asset_count: $assets
        }
    }')"

# Compute summary from accumulated metadata
CURRENT_META=$(metadata_read "$SLUG")

TOTAL_AUTOMATION=$(echo "$CURRENT_META" | jq '
    [.transcription.duration_seconds // 0,
     .preprocess.duration_seconds // 0,
     .review.duration_seconds // 0,
     .collect.duration_seconds // 0] | add')

TOTAL_COST=$(echo "$CURRENT_META" | jq '
    [.transcription.estimated_cost_usd // 0,
     .preprocess.cost_usd // 0,
     .review.cost_usd // 0] | add')

TRANSCRIPT_WORDS=$(echo "$CURRENT_META" | jq '.transcription.word_count // 0')
FINAL_WORDS=$(cat "${BUNDLE_DIR}/index.md" | wc -w | tr -d ' ')

if [[ "$TRANSCRIPT_WORDS" -gt 0 ]]; then
    EXPANSION=$(echo "scale=2; $FINAL_WORDS / $TRANSCRIPT_WORDS" | bc)
else
    EXPANSION="0"
fi

TOTAL_EDITING=$(echo "$CURRENT_META" | jq '
    [.editing.sessions[]? |
        (((.last_save_at // .started_at) | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) - (.started_at | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)) / 60
    ] | add // 0 | round')

metadata_merge "$SLUG" "$(jq -n \
    --argjson auto "$TOTAL_AUTOMATION" \
    --argjson edit "$TOTAL_EDITING" \
    --argjson cost "$TOTAL_COST" \
    --argjson tw "$TRANSCRIPT_WORDS" \
    --argjson fw "$FINAL_WORDS" \
    --arg ratio "$EXPANSION" \
    '{
        summary: {
            total_automation_seconds: $auto,
            total_estimated_editing_minutes: $edit,
            total_estimated_cost_usd: $cost,
            transcript_words: $tw,
            final_words: $fw,
            expansion_ratio: ($ratio | tonumber)
        }
    }')"

echo -e "${GREEN}✓ Metadata and summary saved${NC}"

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
