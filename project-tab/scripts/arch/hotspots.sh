#!/usr/bin/env bash
#
# hotspots.sh — Identify code hotspots in project-tab/server/src/
#
# Hotspot score = churn (number of commits touching a file) x complexity (LOC).
# Files with high churn AND high complexity are the riskiest to maintain.

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")/../../.." rev-parse --show-toplevel)"
SRC_PREFIX="project-tab/server/src"
SRC_DIR="$REPO_ROOT/$SRC_PREFIX"

# Module classification
classify_module() {
    local f="$1"
    local rel="${f#${SRC_PREFIX}/}"
    case "$rel" in
        intelligence/*)  echo "intelligence" ;;
        gateway/*)       echo "gateway" ;;
        registry/*)      echo "registry" ;;
        routes/*)        echo "routes" ;;
        auth/*)          echo "auth" ;;
        types/*)         echo "types" ;;
        validation/*)    echo "validation" ;;
        *)               echo "top-level" ;;
    esac
}

cd "$REPO_ROOT"

# ── Check for git history ──────────────────────────────────────────
total_commits=$(git log --oneline -- "$SRC_PREFIX/" 2>/dev/null | wc -l | tr -d ' ')
if [ "$total_commits" -eq 0 ]; then
    echo "No commits found touching $SRC_PREFIX/. (Shallow clone?)"
    exit 0
fi

# ── Gather churn per file ──────────────────────────────────────────
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

# Get commit count per file
git log --format=format: --name-only --diff-filter=ACRM -- "$SRC_PREFIX/" \
    | grep -v '^$' \
    | sort \
    | uniq -c \
    | sort -rn \
    > "$tmpdir/churn"

# ── Compute hotspot scores ─────────────────────────────────────────
# For each file with churn, check if it still exists and get its LOC.
> "$tmpdir/hotspots"

while read -r churn filepath; do
    if [ -f "$REPO_ROOT/$filepath" ]; then
        loc=$(wc -l < "$REPO_ROOT/$filepath" | tr -d ' ')
        score=$((churn * loc))
        module=$(classify_module "$filepath")
        relpath="${filepath#${SRC_PREFIX}/}"
        echo "$score $churn $loc $module $relpath"
    fi
done < "$tmpdir/churn" | sort -rn -k1,1 > "$tmpdir/hotspots"

# ── Output report ───────────────────────────────────────────────────
echo "================================================================"
echo "  Hotspot Report — project-tab/server/src"
echo "================================================================"
echo ""
echo "Total commits analyzed: $total_commits"
echo "Hotspot score = churn (commits) x complexity (LOC)"
echo ""

echo "── All Files by Hotspot Score ──────────────────────────────────"
printf "  %-8s %6s %6s  %-14s %s\n" "Score" "Churn" "LOC" "Module" "File"
printf "  %-8s %6s %6s  %-14s %s\n" "-----" "-----" "---" "------" "----"

while read -r score churn loc module relpath; do
    printf "  %-8d %6d %6d  %-14s %s\n" "$score" "$churn" "$loc" "$module" "$relpath"
done < "$tmpdir/hotspots"

echo ""

# ── Group by module ─────────────────────────────────────────────────
echo "── Module Aggregates ───────────────────────────────────────────"
printf "  %-14s %8s %8s %10s %6s\n" "Module" "Tot.Score" "Tot.Churn" "Tot.LOC" "Files"
printf "  %-14s %8s %8s %10s %6s\n" "------" "---------" "---------" "-------" "-----"

awk '{
    mod=$4
    score[mod]+=$1
    churn[mod]+=$2
    loc[mod]+=$3
    files[mod]++
}
END {
    for (m in score) {
        printf "  %-14s %8d %8d %10d %6d\n", m, score[m], churn[m], loc[m], files[m]
    }
}' "$tmpdir/hotspots" | sort -rn -k2,2

echo ""
echo "── Interpretation ────────────────────────────────────────────"
echo "  High hotspot score = file changes often AND is large."
echo "  Top hotspots are prime candidates for refactoring or splitting."
echo "  Compare module aggregates to spot systemic complexity."
echo ""
