#!/usr/bin/env bash
# export-ratio.sh — Measure information hiding (export ratio) per module
#
# For each module directory under project-tab/server/src/, count:
#   - Total declarations (function, class, interface, type, const)
#   - Exported declarations (those with 'export' keyword)
#   - Ratio = exported / total
#
# A low ratio = deep module (good information hiding)
# A high ratio = shallow module (everything is public)

set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/../../server/src" && pwd)"

MODULES="intelligence gateway registry routes auth types validation core"

# Count declarations in a set of files
# Args: directory-or-file-list pattern
count_decls() {
  local target="$1"
  local pattern="$2"

  if [ -d "$target" ]; then
    (grep -rE "$pattern" "$target" --include='*.ts' 2>/dev/null || true) | wc -l | tr -d ' '
  else
    # target is a list of files (for "core")
    echo "0"
  fi
}

# Count declarations in a list of files passed via stdin
count_decls_files() {
  local pattern="$1"
  local count=0
  while IFS= read -r f; do
    local c
    c=$( (grep -cE "$pattern" "$f" 2>/dev/null || true) | tr -d ' ')
    count=$((count + c))
  done
  echo "$count"
}

# Patterns for declarations (start of line or after whitespace)
# We look for keyword at the start of a logical declaration
EXPORTED_PATTERN="^export (function|class|interface|type|const|enum|async function) "
TOTAL_PATTERN="^(export )?(function|class|interface|type|const|enum|async function) "

# Also count re-export lines: export { ... } from or export * from
REEXPORT_PATTERN="^export (\{|\\*) "

echo "============================================================"
echo "  Export Ratio Analysis — project-tab/server/src/"
echo "============================================================"
echo ""
printf "%-15s %8s %8s %8s %8s   %s\n" "Module" "Total" "Exported" "Re-exp" "Ratio" "Depth"
printf "%-15s %8s %8s %8s %8s   %s\n" "---------------" "--------" "--------" "--------" "--------" "----------"

for mod in $MODULES; do
  if [ "$mod" = "core" ]; then
    # Core = top-level .ts files
    total=0
    exported=0
    reexported=0
    for f in "$SRC_DIR"/*.ts; do
      [ -f "$f" ] || continue
      t=$( (grep -cE "$TOTAL_PATTERN" "$f" 2>/dev/null || true) | tr -d ' ')
      e=$( (grep -cE "$EXPORTED_PATTERN" "$f" 2>/dev/null || true) | tr -d ' ')
      r=$( (grep -cE "$REEXPORT_PATTERN" "$f" 2>/dev/null || true) | tr -d ' ')
      total=$((total + t))
      exported=$((exported + e))
      reexported=$((reexported + r))
    done
  else
    dir="$SRC_DIR/$mod"
    if [ ! -d "$dir" ]; then
      continue
    fi
    total=$( (grep -rE "$TOTAL_PATTERN" "$dir" --include='*.ts' 2>/dev/null || true) | wc -l | tr -d ' ')
    exported=$( (grep -rE "$EXPORTED_PATTERN" "$dir" --include='*.ts' 2>/dev/null || true) | wc -l | tr -d ' ')
    reexported=$( (grep -rE "$REEXPORT_PATTERN" "$dir" --include='*.ts' 2>/dev/null || true) | wc -l | tr -d ' ')
  fi

  if [ "$total" -gt 0 ]; then
    ratio=$(awk "BEGIN { printf \"%.0f%%\", ($exported / $total) * 100 }")
    ratio_num=$(awk "BEGIN { printf \"%.2f\", $exported / $total }")
  else
    ratio="N/A"
    ratio_num="0"
  fi

  # Classify depth
  if [ "$total" -eq 0 ]; then
    depth="(empty)"
  elif [ "$(awk "BEGIN { print ($ratio_num <= 0.40) ? 1 : 0 }")" = "1" ]; then
    depth="DEEP"
  elif [ "$(awk "BEGIN { print ($ratio_num <= 0.70) ? 1 : 0 }")" = "1" ]; then
    depth="moderate"
  else
    depth="SHALLOW"
  fi

  printf "%-15s %8d %8d %8d %8s   %s\n" "$mod" "$total" "$exported" "$reexported" "$ratio" "$depth"
done

echo ""

# Per-file breakdown for the largest modules
echo "------------------------------------------------------------"
echo "  Per-File Breakdown (files with 5+ declarations)"
echo "------------------------------------------------------------"
echo ""
printf "  %-45s %6s %6s %7s\n" "File" "Total" "Export" "Ratio"
printf "  %-45s %6s %6s %7s\n" "---------------------------------------------" "------" "------" "-------"

find "$SRC_DIR" -name '*.ts' -not -path '*/node_modules/*' | sort | while IFS= read -r f; do
  t=$( (grep -cE "$TOTAL_PATTERN" "$f" 2>/dev/null || true) | tr -d ' ')
  [ "$t" -ge 5 ] || continue
  e=$( (grep -cE "$EXPORTED_PATTERN" "$f" 2>/dev/null || true) | tr -d ' ')
  ratio=$(awk "BEGIN { printf \"%.0f%%\", ($e / $t) * 100 }")
  relpath="${f#"$SRC_DIR"/}"
  printf "  %-45s %6d %6d %7s\n" "$relpath" "$t" "$e" "$ratio"
done

echo ""
echo "Legend:"
echo "  Total    = All declarations (function, class, interface, type, const, enum)"
echo "  Exported = Declarations with 'export' keyword"
echo "  Re-exp   = Re-export lines (export { } from / export * from)"
echo "  Ratio    = Exported / Total (lower = deeper information hiding)"
echo "  Depth    = DEEP (<=40%), moderate (41-70%), SHALLOW (>70%)"
