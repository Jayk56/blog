#!/bin/bash
# migrate-to-bundles.sh — One-time migration from single-file posts to Hugo page bundles
#
# Converts: content/posts/my-post.md → content/posts/my-post/index.md
# Moves: theme static images → page bundle (co-located)
# Rewrites: {{< figure src="/images/file.jpg" >}} → {{< figure src="file.jpg" >}}

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REPO_ROOT="$(git rev-parse --show-toplevel)"
POSTS_DIR="${REPO_ROOT}/jkerschner.com/content/posts"
STATIC_IMAGES="${REPO_ROOT}/jkerschner.com/themes/wholelattesyntax/static/images"

# Image → post mapping (only posts with images need special handling)
# All other posts just get moved to index.md

echo -e "${BLUE}=== Hugo Page Bundle Migration ===${NC}"
echo

MIGRATED=0
SKIPPED=0

for post_file in "${POSTS_DIR}"/*.md; do
    [[ -f "$post_file" ]] || continue

    FILENAME=$(basename "$post_file" .md)
    BUNDLE_DIR="${POSTS_DIR}/${FILENAME}"

    # Skip if already migrated (directory exists with index.md)
    if [[ -d "$BUNDLE_DIR" && -f "${BUNDLE_DIR}/index.md" ]]; then
        echo -e "${YELLOW}Skipping ${FILENAME} — already a page bundle${NC}"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    echo -e "${BLUE}Migrating: ${FILENAME}${NC}"

    # Create the bundle directory
    mkdir -p "$BUNDLE_DIR"

    # Find image references in this post: /images/filename.jpg
    IMAGES=()
    while IFS= read -r img; do
        IMAGES+=("$img")
    done < <(grep -oP '(?<=src="/images/)[^"]+' "$post_file" 2>/dev/null || true)

    # Copy the post as index.md
    cp "$post_file" "${BUNDLE_DIR}/index.md"

    # If this post has images, copy them into the bundle and rewrite paths
    if [[ ${#IMAGES[@]} -gt 0 ]]; then
        for img in "${IMAGES[@]}"; do
            SRC="${STATIC_IMAGES}/${img}"
            if [[ -f "$SRC" ]]; then
                cp "$SRC" "${BUNDLE_DIR}/${img}"
                echo "  Copied: ${img}"
            else
                echo -e "  ${YELLOW}Warning: ${img} not found in static/images/${NC}"
            fi
        done

        # Rewrite image paths: /images/filename.jpg → filename.jpg
        if [[ "$(uname)" == "Darwin" ]]; then
            sed -i '' 's|src="/images/|src="|g' "${BUNDLE_DIR}/index.md"
        else
            sed -i 's|src="/images/|src="|g' "${BUNDLE_DIR}/index.md"
        fi
        echo "  Rewrote image paths to relative"
    fi

    # Remove the original single file
    rm "$post_file"
    echo -e "  ${GREEN}✓ ${FILENAME} → ${FILENAME}/index.md${NC}"

    MIGRATED=$((MIGRATED + 1))
done

echo
echo -e "${GREEN}=== Migration Complete ===${NC}"
echo "Migrated: ${MIGRATED} posts"
echo "Skipped:  ${SKIPPED} posts (already bundles)"
echo
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Run 'hugo server' to verify all posts render correctly"
echo "2. Check image paths in the browser"
echo "3. The original images in themes/.../static/images/ are still there"
echo "   (avatar.jpg and favicon.ico are site-wide and should stay)"
echo "4. Once verified, you can remove the post-specific images from static/images/"
