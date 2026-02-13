#!/usr/bin/env bash
#
# api-churn.sh
# Measures API churn for each module in project-tab/server/src/.
# For each module, compares total commits vs commits that touch export lines.
# High ratio = unstable contract, low ratio = stable boundary.
#
# Compatible with Bash 3.2+ (macOS).
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_REL="server/src"
SRC_DIR="$REPO_ROOT/$SRC_REL"
TMPDIR_WORK="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_WORK"' EXIT

# Define modules
MODULES="auth gateway intelligence registry routes types validation core"

# Get relative paths (from repo root) for a module's files
get_module_paths() {
  local mod="$1"
  if [ "$mod" = "core" ]; then
    find "$SRC_DIR" -maxdepth 1 -name '*.ts' -type f 2>/dev/null | while read -r f; do
      echo "$SRC_REL/$(basename "$f")"
    done
  else
    find "$SRC_DIR/$mod" -name '*.ts' -type f 2>/dev/null | while read -r f; do
      local rel="${f#$REPO_ROOT/}"
      echo "$rel"
    done
  fi
}

# Count total commits touching any file in the module
count_total_commits() {
  local mod="$1"
  local paths
  paths="$(get_module_paths "$mod")"
  if [ -z "$paths" ]; then
    echo 0
    return
  fi
  cd "$REPO_ROOT"
  echo "$paths" | xargs git log --oneline -- 2>/dev/null | sort -u | wc -l | tr -d ' '
}

# Count commits that touch export lines in the module
count_export_commits() {
  local mod="$1"
  local paths
  paths="$(get_module_paths "$mod")"
  if [ -z "$paths" ]; then
    echo 0
    return
  fi
  cd "$REPO_ROOT"
  # Get the full patch output, then use awk to find commits where
  # added/removed lines contain export declarations
  echo "$paths" | xargs git log --format="COMMIT:%H" -p -- 2>/dev/null \
    | awk '
      /^COMMIT:/ { current_commit = $0 }
      /^[-+].*export[[:space:]]+(interface|type|enum|class|function|const|async)/ {
        if (current_commit != "" && !seen[current_commit]) {
          seen[current_commit] = 1
          count++
        }
      }
      END { print count + 0 }
    '
}

# Get the most-changed export names
get_top_churned_exports() {
  local mod="$1"
  local paths
  paths="$(get_module_paths "$mod")"
  if [ -z "$paths" ]; then
    return
  fi
  cd "$REPO_ROOT"
  echo "$paths" | xargs git log -p -- 2>/dev/null \
    | grep -E '^[-+][[:space:]]*export[[:space:]]+(interface|type|enum|class)[[:space:]]+[A-Z]' \
    | sed -E 's/^[-+][[:space:]]*export[[:space:]]+(interface|type|enum|class)[[:space:]]+([A-Za-z0-9_]+).*/\2/' \
    | sort | uniq -c | sort -rn | head -5
}

echo "========================================"
echo "  API Churn Analysis"
echo "  $(date '+%Y-%m-%d %H:%M')"
echo "========================================"
echo ""
echo "Source: $SRC_DIR"
echo "Repository: $REPO_ROOT"
echo ""

echo "--- Per-Module API Churn ---"
echo ""
printf "  %-15s %8s %10s %8s\n" "MODULE" "COMMITS" "API-TOUCH" "RATIO"
echo "  -------------------------------------------------------"

# Store results for later sorting
results_file="$TMPDIR_WORK/churn_results.txt"
> "$results_file"

for mod in $MODULES; do
  total=$(count_total_commits "$mod")
  export_commits=$(count_export_commits "$mod")

  if [ "$total" -gt 0 ]; then
    ratio=$(awk "BEGIN { printf \"%.1f%%\", ($export_commits / $total) * 100 }")
    ratio_num=$(awk "BEGIN { printf \"%.4f\", ($export_commits / $total) }")
  else
    ratio="N/A"
    ratio_num="0.0000"
  fi

  printf "  %-15s %8d %10d %8s\n" "$mod" "$total" "$export_commits" "$ratio"
  echo "$ratio_num $mod $total $export_commits" >> "$results_file"
done

echo ""
echo "--- Highest Churn Modules ---"
echo ""

sort -rn "$results_file" | head -5 | while read -r ratio_num mod total export_c; do
  if [ "$total" -gt 0 ]; then
    pct=$(awk "BEGIN { printf \"%.1f%%\", $ratio_num * 100 }")
    echo "  $mod: $pct ($export_c/$total commits touch exports)"
  fi
done

echo ""
echo "--- Top Churned Export Names (per module) ---"
echo ""

for mod in $MODULES; do
  # Check if module has any commits
  total_line=$(grep " $mod " "$results_file" || true)
  if [ -z "$total_line" ]; then
    continue
  fi
  total=$(echo "$total_line" | awk '{print $3}')
  if [ "$total" -eq 0 ]; then
    continue
  fi

  churned="$(get_top_churned_exports "$mod")"
  if [ -n "$churned" ]; then
    echo "  $mod:"
    echo "$churned" | while read -r count name; do
      printf "    %3d changes: %s\n" "$count" "$name"
    done
    echo ""
  fi
done

echo "--- Interpretation ---"
echo ""
echo "  High API churn ratio (>50%) suggests:"
echo "    - Unstable module contract / frequently changing interface"
echo "    - Downstream modules must adapt often"
echo "    - Consider stabilizing the API before adding dependents"
echo ""
echo "  Low API churn ratio (<20%) suggests:"
echo "    - Stable, mature interface"
echo "    - Safe for other modules to depend on"
echo ""
echo "  Note: This analysis covers all git history for tracked files."
echo "  New modules with few commits may show artificially high ratios"
echo "  (initial commit creates all exports)."
echo ""
