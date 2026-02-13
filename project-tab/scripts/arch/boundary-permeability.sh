#!/usr/bin/env bash
#
# boundary-permeability.sh
# Measures type boundary permeability between modules in project-tab/server/src/.
# For each module pair (A -> B), counts how many of A's exported types/interfaces
# are referenced in B. High count = wide/permeable boundary.
#
# Compatible with Bash 3.2+ (macOS).
#

set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/../../server/src" && pwd)"
TMPDIR_WORK="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_WORK"' EXIT

# Define modules: directory-based modules + "core" for top-level files
MODULES="auth gateway intelligence registry routes types validation core"

# Get the source files for a module
get_module_files() {
  local mod="$1"
  if [ "$mod" = "core" ]; then
    find "$SRC_DIR" -maxdepth 1 -name '*.ts' -type f 2>/dev/null
  else
    find "$SRC_DIR/$mod" -name '*.ts' -type f 2>/dev/null
  fi
}

# Extract exported type/interface/enum/class names from a module, save to file
extract_exported_names() {
  local mod="$1"
  local outfile="$TMPDIR_WORK/names_${mod}.txt"
  local files
  files="$(get_module_files "$mod")"
  if [ -z "$files" ]; then
    touch "$outfile"
    return
  fi
  echo "$files" | xargs grep -h -E '^[[:space:]]*export[[:space:]]+(interface|type|enum|class)[[:space:]]+[A-Z]' 2>/dev/null \
    | sed -E 's/^[[:space:]]*export[[:space:]]+(interface|type|enum|class)[[:space:]]+([A-Za-z0-9_]+).*/\2/' \
    | sort -u > "$outfile"
}

# Count how many names from source module are referenced in target module
count_references() {
  local source_mod="$1"
  local target_mod="$2"
  local names_file="$TMPDIR_WORK/names_${source_mod}.txt"

  if [ ! -s "$names_file" ]; then
    echo 0
    return
  fi

  local target_files
  target_files="$(get_module_files "$target_mod")"
  if [ -z "$target_files" ]; then
    echo 0
    return
  fi

  local count=0
  while IFS= read -r name; do
    if echo "$target_files" | xargs grep -q "\b${name}\b" 2>/dev/null; then
      count=$((count + 1))
    fi
  done < "$names_file"
  echo "$count"
}

# List which names from source are referenced in target
list_referenced_names() {
  local source_mod="$1"
  local target_mod="$2"
  local names_file="$TMPDIR_WORK/names_${source_mod}.txt"

  if [ ! -s "$names_file" ]; then
    return
  fi

  local target_files
  target_files="$(get_module_files "$target_mod")"
  if [ -z "$target_files" ]; then
    return
  fi

  while IFS= read -r name; do
    if echo "$target_files" | xargs grep -q "\b${name}\b" 2>/dev/null; then
      echo "  $name"
    fi
  done < "$names_file"
}

echo "========================================"
echo "  Type Boundary Permeability Analysis"
echo "  $(date '+%Y-%m-%d %H:%M')"
echo "========================================"
echo ""
echo "Source: $SRC_DIR"
echo ""

# First pass: extract and count exported types per module
echo "--- Exported Types Per Module ---"
echo ""
for mod in $MODULES; do
  extract_exported_names "$mod"
  if [ -s "$TMPDIR_WORK/names_${mod}.txt" ]; then
    count=$(wc -l < "$TMPDIR_WORK/names_${mod}.txt" | tr -d ' ')
  else
    count=0
  fi
  printf "  %-15s %3d types\n" "$mod" "$count"
done

echo ""
echo "--- Cross-Module Type References ---"
echo ""
printf "  %-15s -> %-15s  %s\n" "SOURCE" "TARGET" "TYPES REFERENCED"
echo "  ------------------------------------------------------"

# Collect all pairs with counts into a results file for sorting later
results_file="$TMPDIR_WORK/results.txt"
> "$results_file"
total_pairs=0
total_refs=0

for source_mod in $MODULES; do
  if [ ! -s "$TMPDIR_WORK/names_${source_mod}.txt" ]; then
    continue
  fi

  for target_mod in $MODULES; do
    if [ "$source_mod" = "$target_mod" ]; then
      continue
    fi

    ref_count=$(count_references "$source_mod" "$target_mod")
    if [ "$ref_count" -gt 0 ]; then
      printf "  %-15s -> %-15s  %3d\n" "$source_mod" "$target_mod" "$ref_count"
      echo "$ref_count $source_mod $target_mod" >> "$results_file"
      total_pairs=$((total_pairs + 1))
      total_refs=$((total_refs + ref_count))
    fi
  done
done

echo ""
echo "--- Summary ---"
echo ""
echo "  Module pairs with cross-references: $total_pairs"
echo "  Total type references across boundaries: $total_refs"

# Find the most permeable boundaries (top 5)
if [ "$total_pairs" -gt 0 ]; then
  echo ""
  echo "--- Most Permeable Boundaries (top 5) ---"
  echo ""

  sort -rn "$results_file" | head -5 > "$TMPDIR_WORK/top5.txt"
  while read -r cnt source_mod target_mod; do
    printf "  %3d types: %-15s -> %s\n" "$cnt" "$source_mod" "$target_mod"
    list_referenced_names "$source_mod" "$target_mod"
  done < "$TMPDIR_WORK/top5.txt"
fi

echo ""
echo "--- Interpretation ---"
echo ""
echo "  High permeability (many types crossing boundary) suggests:"
echo "    - Wide contract surface between modules"
echo "    - Tight coupling that may hinder independent evolution"
echo "    - Consider narrowing the interface with facade patterns"
echo ""
echo "  Low permeability suggests:"
echo "    - Narrow, well-encapsulated module boundary"
echo "    - Modules can evolve independently"
echo ""
