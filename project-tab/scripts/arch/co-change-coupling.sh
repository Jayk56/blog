#!/usr/bin/env bash
#
# co-change-coupling.sh — Analyze git co-change coupling between modules
# in project-tab/server/src/.
#
# For every commit that touches files under src/, count how many times
# pairs of modules appear together. Normalize by total commits touching
# each module to produce a coupling ratio.

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")/../../.." rev-parse --show-toplevel)"
SRC_PREFIX="project-tab/server/src"

# Module classification: map a file path to its module name
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

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cd "$REPO_ROOT"

# ── Gather raw log ─────────────────────────────────────────────────
git log --format=format:"__COMMIT__" --name-only --diff-filter=ACRM -- "$SRC_PREFIX/" \
    > "$tmpdir/raw_log"

total_commits=$(grep -c '^__COMMIT__$' "$tmpdir/raw_log" 2>/dev/null || echo 0)
if [ "$total_commits" -eq 0 ]; then
    echo "No commits found touching $SRC_PREFIX/. (Shallow clone?)"
    exit 0
fi

# ── Parse commits: for each commit, emit the unique modules touched ─
# Output: one line per commit with space-separated sorted unique modules
> "$tmpdir/commit_modules"
current_modules=""

while IFS= read -r line; do
    if [ "$line" = "__COMMIT__" ]; then
        if [ -n "$current_modules" ]; then
            echo "$current_modules" | tr ' ' '\n' | sort -u | tr '\n' ' '
            echo ""
        fi
        current_modules=""
    elif [ -n "$line" ]; then
        mod=$(classify_module "$line")
        current_modules="$current_modules $mod"
    fi
done < "$tmpdir/raw_log" >> "$tmpdir/commit_modules"

# Handle last commit
if [ -n "$current_modules" ]; then
    echo "$current_modules" | tr ' ' '\n' | sort -u | tr '\n' ' '
    echo ""
fi >> "$tmpdir/commit_modules"

# Remove blank lines
grep -v '^[[:space:]]*$' "$tmpdir/commit_modules" > "$tmpdir/commit_modules_clean" 2>/dev/null || true
mv "$tmpdir/commit_modules_clean" "$tmpdir/commit_modules"

# ── Count per-module commits ──────────────────────────────────────
# Flatten all modules across commits, count each
tr ' ' '\n' < "$tmpdir/commit_modules" \
    | grep -v '^$' \
    | sort \
    | uniq -c \
    | sort -rn \
    > "$tmpdir/module_counts"

# ── Count co-change pairs ─────────────────────────────────────────
# For each commit line, generate all unique pairs (alphabetically sorted)
> "$tmpdir/pairs"
while IFS= read -r line; do
    # Convert to array
    set -- $line
    mods=("$@")
    n=${#mods[@]}
    for (( i=0; i<n; i++ )); do
        for (( j=i+1; j<n; j++ )); do
            a="${mods[$i]}"
            b="${mods[$j]}"
            # Already sorted within commit line, but ensure order
            if [[ "$a" > "$b" ]]; then
                echo "$b $a"
            else
                echo "$a $b"
            fi
        done
    done
done < "$tmpdir/commit_modules" >> "$tmpdir/pairs"

sort "$tmpdir/pairs" | uniq -c | sort -rn > "$tmpdir/pair_counts"

# ── Helper: look up module commit count ────────────────────────────
get_module_count() {
    local mod="$1"
    awk -v m="$mod" '$2 == m { print $1 }' "$tmpdir/module_counts"
}

# ── Output report ──────────────────────────────────────────────────
echo "================================================================"
echo "  Co-Change Coupling Report — project-tab/server/src"
echo "================================================================"
echo ""
echo "Total commits analyzed: $total_commits"
echo ""

echo "── Per-Module Commit Counts ──────────────────────────────────"
printf "  %-20s %s\n" "Module" "Commits"
printf "  %-20s %s\n" "------" "-------"
while read -r count mod; do
    printf "  %-20s %d\n" "$mod" "$count"
done < "$tmpdir/module_counts"
echo ""

echo "── Co-Change Coupling Matrix ─────────────────────────────────"
echo "  (Reads: A and B changed together N times."
echo "   Ratio = N / min(commits_A, commits_B))"
echo ""
printf "  %-15s %-15s %8s %8s\n" "Module A" "Module B" "Co-chg" "Ratio"
printf "  %-15s %-15s %8s %8s\n" "--------" "--------" "------" "-----"

while read -r count mod_a mod_b; do
    ca=$(get_module_count "$mod_a")
    cb=$(get_module_count "$mod_b")
    min_c=$ca
    [ "$cb" -lt "$min_c" ] && min_c=$cb
    if [ "$min_c" -gt 0 ]; then
        ratio=$(awk "BEGIN { printf \"%.2f\", $count / $min_c }")
    else
        ratio="0.00"
    fi
    printf "  %-15s %-15s %8d %8s\n" "$mod_a" "$mod_b" "$count" "$ratio"
done < "$tmpdir/pair_counts"

echo ""
echo "── Interpretation ────────────────────────────────────────────"
echo "  Ratio 1.00 = every commit to one module also touches the other."
echo "  High coupling (>0.70) suggests tight dependency or shared concern."
echo "  Low coupling (<0.30) suggests good module isolation."
echo ""
