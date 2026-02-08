#!/bin/bash
# collect.sh — Headless asset collector for blog posts
#
# Parses [SCREENSHOT: ...] and [EMBED: ...] markers from the review/draft stage,
# captures screenshots via Playwright, fetches embeds via oEmbed APIs,
# and generates an assets.json manifest.
#
# Usage: collect.sh <slug>
#
# For markers that require interactive collection (login pages, code execution),
# use the Cowork prompt at pipeline/prompts/collect.md instead.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REPO_ROOT="$(git rev-parse --show-toplevel)"
PIPELINE_DIR="${REPO_ROOT}/pipeline"
OUTPUT_DIR="${REPO_ROOT}/output"

# Load environment
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
COLLECT_DIR="${OUTPUT_DIR}/collect/${SLUG}"
ASSETS_DIR="${COLLECT_DIR}/assets"
ASSETS_JSON="${COLLECT_DIR}/assets.json"
LOG_FILE="${COLLECT_DIR}/collect.log"

# Find the source markdown to parse markers from
REVIEW_MD="${OUTPUT_DIR}/review/${SLUG}/review.md"
DRAFT_MD="${OUTPUT_DIR}/draft/${SLUG}/draft.md"

SOURCE_MD=""
if [[ -f "$REVIEW_MD" ]]; then
    SOURCE_MD="$REVIEW_MD"
elif [[ -f "$DRAFT_MD" ]]; then
    SOURCE_MD="$DRAFT_MD"
else
    echo -e "${RED}Error: No review.md or draft.md found for '${SLUG}'${NC}"
    exit 1
fi

echo -e "${BLUE}=== Collect Assets: ${SLUG} ===${NC}"
echo "Source: ${SOURCE_MD}"

# Create output directories
mkdir -p "$ASSETS_DIR"

# Initialize log
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting collection for: ${SLUG}" > "$LOG_FILE"
echo "Source: ${SOURCE_MD}" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# --- Extract markers ---

SCREENSHOT_COUNT=0
EMBED_COUNT=0
CODE_COUNT=0
ASSETS_ARRAY="[]"
FAILURES_ARRAY="[]"

# Check if Playwright + Node are available
HAS_PLAYWRIGHT=false
if command -v node &> /dev/null && [[ -d "${PIPELINE_DIR}/node_modules/playwright" ]]; then
    HAS_PLAYWRIGHT=true
fi

# --- Process [SCREENSHOT: ...] markers ---
echo -e "${BLUE}Scanning for [SCREENSHOT: ...] markers...${NC}"

while IFS= read -r line; do
    SCREENSHOT_COUNT=$((SCREENSHOT_COUNT + 1))
    ID="screenshot-${SCREENSHOT_COUNT}"
    OUTPUT_FILE="${ASSETS_DIR}/${ID}.png"

    # Extract the description (everything between [SCREENSHOT: and ])
    DESCRIPTION=$(echo "$line" | sed -E 's/.*\[SCREENSHOT:\s*//' | sed 's/\].*$//')

    # Try to extract a URL from the description
    URL=$(echo "$DESCRIPTION" | grep -oE 'https?://[^ "]+' | head -1 || true)

    echo "  [${ID}] ${DESCRIPTION}"
    echo "[$(date '+%H:%M:%S')] ${ID}: ${DESCRIPTION}" >> "$LOG_FILE"

    if [[ -z "$URL" ]]; then
        # No URL — this needs manual collection (e.g. "Screenshot of my terminal")
        echo -e "    ${YELLOW}→ No URL found, needs Cowork/manual${NC}"
        echo "  → No URL, marked for Cowork" >> "$LOG_FILE"
        FAILURES_ARRAY=$(echo "$FAILURES_ARRAY" | jq \
            --arg marker "$line" \
            --arg reason "No URL in marker — screenshot requires manual capture or Cowork session" \
            '. + [{"marker": $marker, "reason": $reason}]')
        continue
    fi

    if [[ "$HAS_PLAYWRIGHT" == "false" ]]; then
        echo -e "    ${YELLOW}→ Playwright not installed, skipping${NC}"
        echo "  → Playwright not available" >> "$LOG_FILE"
        FAILURES_ARRAY=$(echo "$FAILURES_ARRAY" | jq \
            --arg marker "$line" \
            --arg reason "Playwright not installed. Run: cd pipeline && npm install && npx playwright install chromium" \
            '. + [{"marker": $marker, "reason": $reason}]')
        continue
    fi

    # Attempt headless screenshot
    echo -n "    Capturing ${URL}..."
    CAPTURE_OUTPUT=$(node "${PIPELINE_DIR}/scripts/lib/capture.js" "$URL" "$OUTPUT_FILE" 2>&1) && CAPTURE_OK=true || CAPTURE_OK=false

    if [[ "$CAPTURE_OK" == "true" && -f "$OUTPUT_FILE" ]]; then
        FILE_SIZE=$(stat -f%z "$OUTPUT_FILE" 2>/dev/null || stat -c%s "$OUTPUT_FILE" 2>/dev/null || echo "0")
        echo -e " ${GREEN}✓${NC} (${FILE_SIZE} bytes)"
        echo "  → Success: ${OUTPUT_FILE} (${FILE_SIZE} bytes)" >> "$LOG_FILE"
        ASSETS_ARRAY=$(echo "$ASSETS_ARRAY" | jq \
            --arg id "$ID" \
            --arg url "$URL" \
            --arg desc "$DESCRIPTION" \
            --arg file "assets/${ID}.png" \
            --argjson size "$FILE_SIZE" \
            '. + [{"id": $id, "type": "screenshot", "url": $url, "description": $desc, "status": "success", "file": $file, "size_bytes": $size}]')
    else
        echo -e " ${RED}✗${NC}"
        ERROR_MSG=$(echo "$CAPTURE_OUTPUT" | tail -1)
        echo "  → Failed: ${ERROR_MSG}" >> "$LOG_FILE"
        FAILURES_ARRAY=$(echo "$FAILURES_ARRAY" | jq \
            --arg marker "$line" \
            --arg reason "Screenshot failed: ${ERROR_MSG}" \
            '. + [{"marker": $marker, "reason": $reason}]')
    fi

done < <(grep '\[SCREENSHOT:' "$SOURCE_MD" 2>/dev/null || true)

# --- Process [EMBED: ...] markers ---
echo -e "${BLUE}Scanning for [EMBED: ...] markers...${NC}"

while IFS= read -r line; do
    EMBED_COUNT=$((EMBED_COUNT + 1))
    ID="embed-${EMBED_COUNT}"
    OUTPUT_FILE="${ASSETS_DIR}/${ID}.json"

    # Extract the URL
    URL=$(echo "$line" | grep -oE 'https?://[^ \]]+' | head -1 || true)

    if [[ -z "$URL" ]]; then
        echo "  [${ID}] No URL found in marker"
        FAILURES_ARRAY=$(echo "$FAILURES_ARRAY" | jq \
            --arg marker "$line" \
            --arg reason "No URL found in embed marker" \
            '. + [{"marker": $marker, "reason": $reason}]')
        continue
    fi

    echo -n "  [${ID}] ${URL}..."

    # Detect platform and fetch oEmbed
    OEMBED_URL=""
    PLATFORM="unknown"

    case "$URL" in
        *bsky.app*|*bluesky*)
            PLATFORM="bluesky"
            OEMBED_URL="https://embed.bsky.app/oembed?url=$(printf '%s' "$URL" | jq -sRr @uri)"
            ;;
        *twitter.com*|*x.com*)
            PLATFORM="twitter"
            OEMBED_URL="https://publish.twitter.com/oembed?url=$(printf '%s' "$URL" | jq -sRr @uri)"
            ;;
        *youtube.com*|*youtu.be*)
            PLATFORM="youtube"
            OEMBED_URL="https://www.youtube.com/oembed?url=$(printf '%s' "$URL" | jq -sRr @uri)&format=json"
            ;;
        *github.com/*/gist/*|*gist.github.com*)
            PLATFORM="github-gist"
            # GitHub gists don't have a standard oEmbed, store URL for manual embed
            echo -e " ${YELLOW}→ Gist (manual embed)${NC}"
            echo '{"platform":"github-gist","url":"'"$URL"'","note":"Use GitHub gist embed script tag"}' > "$OUTPUT_FILE"
            ASSETS_ARRAY=$(echo "$ASSETS_ARRAY" | jq \
                --arg id "$ID" --arg url "$URL" --arg file "assets/${ID}.json" \
                '. + [{"id": $id, "type": "embed", "url": $url, "status": "success", "file": $file, "platform": "github-gist"}]')
            echo "  → Gist saved for manual embed" >> "$LOG_FILE"
            continue
            ;;
        *)
            echo -e " ${YELLOW}→ Unknown platform${NC}"
            FAILURES_ARRAY=$(echo "$FAILURES_ARRAY" | jq \
                --arg marker "$line" \
                --arg reason "Unknown embed platform — use Cowork to manually collect" \
                '. + [{"marker": $marker, "reason": $reason}]')
            echo "  → Unknown platform" >> "$LOG_FILE"
            continue
            ;;
    esac

    # Fetch oEmbed
    OEMBED_RESPONSE=$(curl -s --max-time 10 "$OEMBED_URL" 2>&1) && OEMBED_OK=true || OEMBED_OK=false

    if [[ "$OEMBED_OK" == "true" ]] && echo "$OEMBED_RESPONSE" | jq . &>/dev/null; then
        echo "$OEMBED_RESPONSE" > "$OUTPUT_FILE"
        echo -e " ${GREEN}✓${NC} (${PLATFORM})"
        echo "  → oEmbed success: ${PLATFORM}" >> "$LOG_FILE"
        ASSETS_ARRAY=$(echo "$ASSETS_ARRAY" | jq \
            --arg id "$ID" --arg url "$URL" --arg file "assets/${ID}.json" --arg platform "$PLATFORM" \
            '. + [{"id": $id, "type": "embed", "url": $url, "status": "success", "file": $file, "platform": $platform}]')
    else
        echo -e " ${RED}✗${NC}"
        echo "  → oEmbed failed: ${OEMBED_RESPONSE}" >> "$LOG_FILE"
        FAILURES_ARRAY=$(echo "$FAILURES_ARRAY" | jq \
            --arg marker "$line" \
            --arg reason "oEmbed fetch failed for ${PLATFORM}" \
            '. + [{"marker": $marker, "reason": $reason}]')
    fi

done < <(grep '\[EMBED:' "$SOURCE_MD" 2>/dev/null || true)

# --- Process [CODE: ...] markers ---
echo -e "${BLUE}Scanning for [CODE: ...] markers...${NC}"

while IFS= read -r line; do
    CODE_COUNT=$((CODE_COUNT + 1))
    COMMAND=$(echo "$line" | sed -E 's/.*\[CODE:\s*//' | sed 's/\].*$//')

    echo -e "  [code-${CODE_COUNT}] ${YELLOW}→ Needs Cowork:${NC} ${COMMAND}"
    FAILURES_ARRAY=$(echo "$FAILURES_ARRAY" | jq \
        --arg marker "$line" \
        --arg reason "Code execution requires interactive Cowork session" \
        '. + [{"marker": $marker, "reason": $reason}]')

done < <(grep '\[CODE:' "$SOURCE_MD" 2>/dev/null || true)

# --- Generate assets.json manifest ---

TOTAL_REQUESTED=$((SCREENSHOT_COUNT + EMBED_COUNT + CODE_COUNT))
TOTAL_SUCCESSFUL=$(echo "$ASSETS_ARRAY" | jq 'length')

jq -n \
    --arg slug "$SLUG" \
    --arg collected_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
    --argjson total_requested "$TOTAL_REQUESTED" \
    --argjson total_successful "$TOTAL_SUCCESSFUL" \
    --argjson assets "$ASSETS_ARRAY" \
    --argjson failures "$FAILURES_ARRAY" \
    '{
        slug: $slug,
        collected_at: $collected_at,
        total_requested: $total_requested,
        total_successful: $total_successful,
        assets: $assets,
        failures: $failures
    }' > "$ASSETS_JSON"

echo
echo -e "${GREEN}=== Collection Complete ===${NC}"
echo "Requested: ${TOTAL_REQUESTED} assets (${SCREENSHOT_COUNT} screenshots, ${EMBED_COUNT} embeds, ${CODE_COUNT} code)"
echo "Collected: ${TOTAL_SUCCESSFUL}"
echo "Failed:    $(echo "$FAILURES_ARRAY" | jq 'length')"
echo
echo "Manifest: ${ASSETS_JSON}"
echo "Log:      ${LOG_FILE}"

FAILURE_COUNT=$(echo "$FAILURES_ARRAY" | jq 'length')
if [[ "$FAILURE_COUNT" -gt 0 ]]; then
    echo
    echo -e "${YELLOW}Some assets need interactive collection via Cowork:${NC}"
    echo "$FAILURES_ARRAY" | jq -r '.[] | "  • \(.reason)"'
fi

echo
echo "Next: make advance SLUG=${SLUG}"
