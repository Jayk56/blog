#!/bin/bash

# install-launchd.sh — Installs the blog auto-transcribe launchd job on macOS.
#
# Usage:
#   bash pipeline/scripts/install-launchd.sh          # install and start
#   bash pipeline/scripts/install-launchd.sh uninstall # stop and remove

set -euo pipefail

PLIST_NAME="com.jkerschner.blog-transcribe"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_PLIST="${SCRIPT_DIR}/../launchd/${PLIST_NAME}.plist"
TARGET_DIR="${HOME}/Library/LaunchAgents"
TARGET_PLIST="${TARGET_DIR}/${PLIST_NAME}.plist"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# --- Uninstall ---
if [[ "${1:-}" == "uninstall" ]]; then
    echo -e "${YELLOW}Uninstalling ${PLIST_NAME}...${NC}"
    launchctl bootout "gui/$(id -u)/${PLIST_NAME}" 2>/dev/null || true
    rm -f "${TARGET_PLIST}"
    echo -e "${GREEN}✓ Removed.${NC}"
    exit 0
fi

# --- Pre-flight checks ---
if [[ ! -f "${SOURCE_PLIST}" ]]; then
    echo -e "${RED}Error: plist not found at ${SOURCE_PLIST}${NC}"
    exit 1
fi

REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/pipeline/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
    echo -e "${RED}Error: pipeline/.env not found. Copy .env.example and add your ELEVENLABS_API_KEY.${NC}"
    exit 1
fi

if ! grep -q 'ELEVENLABS_API_KEY' "${ENV_FILE}" || grep -q 'your-key-here' "${ENV_FILE}"; then
    echo -e "${RED}Error: ELEVENLABS_API_KEY not configured in pipeline/.env${NC}"
    exit 1
fi

# Check jq is available
if ! command -v jq &>/dev/null; then
    echo -e "${RED}Error: jq is required. Install with: brew install jq${NC}"
    exit 1
fi

# --- Install ---
echo -e "${BLUE}Installing ${PLIST_NAME}...${NC}"

mkdir -p "${TARGET_DIR}"
cp "${SOURCE_PLIST}" "${TARGET_PLIST}"

# Unload if already loaded
launchctl bootout "gui/$(id -u)/${PLIST_NAME}" 2>/dev/null || true

# Load
launchctl bootstrap "gui/$(id -u)" "${TARGET_PLIST}"

echo
echo -e "${GREEN}✓ Installed and running.${NC}"
echo
echo -e "${BLUE}Details:${NC}"
echo "  Plist:     ${TARGET_PLIST}"
echo "  Interval:  Every 2 hours"
echo "  Log:       /tmp/blog-auto-transcribe.log"
echo "  Repo:      ~/Code/blog"
echo
echo -e "${BLUE}Commands:${NC}"
echo "  View log:    tail -f /tmp/blog-auto-transcribe.log"
echo "  Run now:     cd ~/Code/blog && bash pipeline/scripts/auto-transcribe.sh"
echo "  Uninstall:   bash pipeline/scripts/install-launchd.sh uninstall"
echo "  Check:       launchctl print gui/$(id -u)/${PLIST_NAME}"
