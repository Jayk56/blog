#!/usr/bin/env bash
# fan-in-fan-out.sh — Analyze import coupling between modules in project-tab/server/src/
#
# Modules: intelligence, gateway, registry, routes, auth, types, validation, core
# "core" = top-level .ts files (bus.ts, ws-hub.ts, tick.ts, classifier.ts, app.ts, index.ts)
#
# Metrics per module:
#   Ca (fan-in)    = number of other modules that import from this module
#   Ce (fan-out)   = number of other modules this module imports from
#   Instability I  = Ce / (Ca + Ce)   [0 = maximally stable, 1 = maximally unstable]

set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/../../server/src" && pwd)"

MODULES="intelligence gateway registry routes auth types validation core"

# which_module: determine which module a source file belongs to
which_module() {
  local file="$1"
  local rel="${file#"$SRC_DIR"/}"
  local first="${rel%%/*}"
  case "$first" in
    intelligence|gateway|registry|routes|auth|types|validation)
      echo "$first"
      ;;
    *)
      echo "core"
      ;;
  esac
}

# classify_import: given a source file and a relative import path, return the target module name
classify_import() {
  local src_file="$1"
  local import_path="$2"

  # Skip external/node_modules imports
  case "$import_path" in
    .*) ;; # relative path, continue
    *)  echo ""; return ;;
  esac

  # Resolve relative path from the source file's directory
  local src_dir
  src_dir="$(dirname "$src_file")"
  local target_dir
  target_dir="$(dirname "$import_path")"
  local resolved
  if resolved="$(cd "$src_dir" && cd "$target_dir" 2>/dev/null && pwd)"; then
    resolved="$resolved/$(basename "$import_path")"
  else
    echo ""
    return
  fi

  # Strip SRC_DIR prefix to get relative-to-src path
  local rel="${resolved#"$SRC_DIR"/}"
  local first_component="${rel%%/*}"

  case "$first_component" in
    intelligence|gateway|registry|routes|auth|types|validation)
      echo "$first_component"
      ;;
    *)
      echo "core"
      ;;
  esac
}

# Build a temp file of all import edges: source_module -> target_module
EDGES_FILE="$(mktemp /tmp/fanin.XXXXXX)"
trap 'rm -f "$EDGES_FILE" "${EDGES_FILE}.dedup"' EXIT

# Process all TypeScript files
find "$SRC_DIR" -name '*.ts' -not -path '*/node_modules/*' | while IFS= read -r file; do
  src_mod="$(which_module "$file")"

  # Extract import paths from: import ... from './path' or import ... from "../path"
  # Handle both single and double quotes; || true to avoid pipefail on no-match files
  (grep -oE "(from '[^']+'|from \"[^\"]+\")" "$file" 2>/dev/null || true) | while read -r match; do
    # Strip the from prefix and quotes
    import_path="${match#from }"
    import_path="${import_path#\'}"
    import_path="${import_path%\'}"
    import_path="${import_path#\"}"
    import_path="${import_path%\"}"

    target_mod="$(classify_import "$file" "$import_path")"
    if [ -n "$target_mod" ] && [ "$target_mod" != "$src_mod" ]; then
      echo "$src_mod $target_mod"
    fi
  done
done >> "$EDGES_FILE"

# Deduplicate edges (unique source->target pairs)
sort -u "$EDGES_FILE" > "${EDGES_FILE}.dedup"
mv "${EDGES_FILE}.dedup" "$EDGES_FILE"

# Print report
echo "============================================================"
echo "  Fan-In / Fan-Out Analysis — project-tab/server/src/"
echo "============================================================"
echo ""
printf "%-15s %8s %8s %12s\n" "Module" "Ca(in)" "Ce(out)" "Instability"
printf "%-15s %8s %8s %12s\n" "---------------" "--------" "--------" "------------"

for mod in $MODULES; do
  # Fan-out: unique target modules this module imports from
  ce=$( (grep "^${mod} " "$EDGES_FILE" 2>/dev/null || true) | awk '{print $2}' | sort -u | wc -l | tr -d ' ')
  # Fan-in: unique source modules that import from this module
  ca=$( (grep " ${mod}$" "$EDGES_FILE" 2>/dev/null || true) | awk '{print $1}' | sort -u | wc -l | tr -d ' ')

  total=$((ca + ce))
  if [ $total -gt 0 ]; then
    instability=$(awk "BEGIN { printf \"%.2f\", $ce / $total }")
  else
    instability="N/A"
  fi
  printf "%-15s %8d %8d %12s\n" "$mod" "$ca" "$ce" "$instability"
done

echo ""
echo "Edge list (unique module-to-module dependencies):"
echo ""
printf "  %-15s --> %s\n" "Source" "Target"
printf "  %-15s     %s\n" "---------------" "---------------"
sort "$EDGES_FILE" | while read -r src tgt; do
  printf "  %-15s --> %s\n" "$src" "$tgt"
done

echo ""
echo "Legend:"
echo "  Ca = Afferent coupling (fan-in): how many modules depend ON this module"
echo "  Ce = Efferent coupling (fan-out): how many modules this module depends ON"
echo "  Instability = Ce/(Ca+Ce): 0=stable (many dependents), 1=unstable (many dependencies)"
