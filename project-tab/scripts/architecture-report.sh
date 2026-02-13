#!/usr/bin/env bash
# architecture-report.sh — Run clean architecture metrics for project-tab
# Usage: ./scripts/architecture-report.sh [--server-only | --frontend-only]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

run_server=true
run_frontend=true
if [[ "${1:-}" == "--server-only" ]]; then run_frontend=false; fi
if [[ "${1:-}" == "--frontend-only" ]]; then run_server=false; fi

header() { echo -e "\n${BOLD}=== $1 ===${RESET}\n"; }
ok()     { echo -e "${GREEN}✔${RESET} $1"; }
warn()   { echo -e "${YELLOW}⚠${RESET} $1"; }
fail()   { echo -e "${RED}✖${RESET} $1"; }

# ── 1. Circular Dependencies (madge) ────────────────────────────────

header "CIRCULAR DEPENDENCIES (madge)"

if $run_server; then
  echo -e "${BOLD}Server:${RESET}"
  cd "$SERVER_DIR"
  output=$(npx --yes madge --circular --ts-config tsconfig.json src/ 2>&1) || true
  if echo "$output" | grep -q "No circular dependency"; then
    ok "No circular dependencies"
  else
    warn "Circular dependencies found:"
    echo "$output"
  fi
  echo
fi

if $run_frontend; then
  echo -e "${BOLD}Frontend:${RESET}"
  cd "$PROJECT_ROOT"
  output=$(npx --yes madge --circular --ts-config tsconfig.json src/ 2>&1) || true
  if echo "$output" | grep -q "No circular dependency"; then
    ok "No circular dependencies"
  else
    warn "Circular dependencies found:"
    echo "$output"
  fi
  echo
fi

# ── 2. Circular Dependencies (dpdm, server only) ────────────────────

if $run_server; then
  header "CIRCULAR DEPENDENCIES (dpdm cross-check)"
  cd "$SERVER_DIR"
  output=$(npx --yes dpdm --circular --no-tree src/index.ts 2>&1) || true
  circular_section=$(echo "$output" | sed -n '/Circular Dependencies/,/Warnings/p' | head -30)
  if echo "$circular_section" | grep -q "src/"; then
    warn "dpdm found circular chains (may be barrel-file false positives):"
    echo "$circular_section"
  else
    ok "No circular dependencies"
  fi
  echo
fi

# ── 3. Unused Code (knip) ───────────────────────────────────────────

header "UNUSED CODE (knip)"

if $run_server; then
  echo -e "${BOLD}Server:${RESET}"
  cd "$SERVER_DIR"
  output=$(npx --yes knip 2>&1) || true

  unused_files=$(echo "$output" | grep -c "^Unused files" || true)
  file_count=$(echo "$output" | sed -n '/^Unused files/,/^[A-Z]/p' | grep -c "\.ts" || true)
  export_count=$(echo "$output" | sed -n '/^Unused exports/,/^[A-Z]/p' | grep -c "\.ts" || true)
  type_count=$(echo "$output" | sed -n '/^Unused exported types/,/^$/p' | grep -c "\.ts" || true)
  dep_count=$(echo "$output" | sed -n '/^Unused dependencies/,/^[A-Z]/p' | grep -c "package" || true)

  echo "  Unused files:          $file_count"
  echo "  Unused exports:        $export_count"
  echo "  Unused exported types: $type_count"
  echo "  Unused dependencies:   $dep_count"

  if [[ $export_count -gt 20 || $type_count -gt 20 ]]; then
    warn "Significant interface bloat detected"
  elif [[ $export_count -eq 0 && $type_count -eq 0 ]]; then
    ok "No unused exports"
  fi
  echo

  echo -e "${BOLD}Server detail:${RESET}"
  echo "$output"
  echo
fi

if $run_frontend; then
  echo -e "${BOLD}Frontend (monorepo):${RESET}"
  cd "$PROJECT_ROOT"
  output=$(npx --yes knip 2>&1) || true

  file_count=$(echo "$output" | sed -n '/^Unused files/,/^[A-Z]/p' | grep -c "\.ts\|\.tsx\|\.css" || true)
  export_count=$(echo "$output" | sed -n '/^Unused exports/,/^[A-Z]/p' | grep -c "\.ts" || true)
  type_count=$(echo "$output" | sed -n '/^Unused exported types/,/^$/p' | grep -c "\.ts" || true)

  echo "  Unused files:          $file_count"
  echo "  Unused exports:        $export_count"
  echo "  Unused exported types: $type_count"

  if [[ $file_count -gt 0 || $export_count -gt 0 ]]; then
    warn "Dead code found in frontend"
  else
    ok "Frontend is clean"
  fi
  echo

  echo -e "${BOLD}Frontend detail:${RESET}"
  echo "$output"
  echo
fi

# ── 4. Layer Violation Check (grep-based) ────────────────────────────

if $run_server; then
  header "LAYER VIOLATION CHECK (import analysis)"
  cd "$SERVER_DIR"

  violations=0

  echo -e "${BOLD}intelligence/ importing from routes/:${RESET}"
  hits=$(grep -r "from.*['\"].*routes" src/intelligence/ 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    fail "VIOLATION: intelligence depends on routes"
    echo "$hits"
    violations=$((violations + 1))
  else
    ok "Clean"
  fi

  echo -e "${BOLD}intelligence/ importing from gateway/:${RESET}"
  hits=$(grep -r "from.*['\"].*gateway" src/intelligence/ 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    fail "VIOLATION: intelligence depends on gateway"
    echo "$hits"
    violations=$((violations + 1))
  else
    ok "Clean"
  fi

  echo -e "${BOLD}registry/ importing from routes/:${RESET}"
  hits=$(grep -r "from.*['\"].*routes" src/registry/ 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    fail "VIOLATION: registry depends on routes"
    echo "$hits"
    violations=$((violations + 1))
  else
    ok "Clean"
  fi

  echo -e "${BOLD}registry/ importing from gateway/:${RESET}"
  hits=$(grep -r "from.*['\"].*gateway" src/registry/ 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    fail "VIOLATION: registry depends on gateway"
    echo "$hits"
    violations=$((violations + 1))
  else
    ok "Clean"
  fi

  echo
  if [[ $violations -eq 0 ]]; then
    ok "No layer violations detected"
  else
    fail "$violations layer violation(s) found"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────

header "DONE"
echo "Report complete. Review warnings above for actionable items."
