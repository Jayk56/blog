#!/usr/bin/env bash
# fetch-project-state.sh — Fetch all project state from the project-tab server
#
# Usage:
#   ./fetch-project-state.sh [SERVER_URL] [--since ISO_DATETIME]
#
# Outputs combined JSON to stdout. Exits 0 even on partial failures.

set -euo pipefail

SERVER="${1:-http://localhost:3001}"
SINCE=""

# Parse --since flag
shift 2>/dev/null || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --since) SINCE="$2"; shift 2 ;;
    *) shift ;;
  esac
done

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# Phase 1: Core state (parallel)
curl -sf "$SERVER/api/health" -o "$TMPDIR/health.json" 2>/dev/null &
curl -sf "$SERVER/api/project" -o "$TMPDIR/project.json" 2>/dev/null &
curl -sf "$SERVER/api/agents" -o "$TMPDIR/agents.json" 2>/dev/null &
curl -sf "$SERVER/api/decisions" -o "$TMPDIR/decisions.json" 2>/dev/null &
curl -sf "$SERVER/api/coherence" -o "$TMPDIR/coherence.json" 2>/dev/null &
curl -sf "$SERVER/api/artifacts" -o "$TMPDIR/artifacts.json" 2>/dev/null &
curl -sf "$SERVER/api/control-mode" -o "$TMPDIR/control_mode.json" 2>/dev/null &
wait

# Phase 2: Events (with optional --since filter)
if [[ -n "$SINCE" ]]; then
  curl -sf "$SERVER/api/events?types=artifact,completion,coherence,decision,lifecycle,error&since=$SINCE&limit=500" \
    -o "$TMPDIR/events.json" 2>/dev/null || echo '{"events":[]}' > "$TMPDIR/events.json"
else
  curl -sf "$SERVER/api/events?limit=100" \
    -o "$TMPDIR/events.json" 2>/dev/null || echo '{"events":[]}' > "$TMPDIR/events.json"
fi

# Phase 3: Per-agent trust scores
if [[ -f "$TMPDIR/agents.json" ]]; then
  AGENT_IDS=$(python3 -c "
import json, sys
try:
    data = json.load(open('$TMPDIR/agents.json'))
    agents = data.get('agents', data) if isinstance(data, dict) else data
    for a in agents:
        aid = a.get('id', '')
        if aid: print(aid)
except: pass
" 2>/dev/null)

  TRUST_FILES=""
  for aid in $AGENT_IDS; do
    curl -sf "$SERVER/api/trust/$aid" -o "$TMPDIR/trust_${aid}.json" 2>/dev/null &
    TRUST_FILES="$TRUST_FILES $TMPDIR/trust_${aid}.json"
  done
  wait
fi

# Phase 4: Insights (parallel, best-effort)
curl -sf -X POST "$SERVER/api/insights/override-patterns" -H 'Content-Type: application/json' -d '{}' \
  -o "$TMPDIR/overrides.json" 2>/dev/null &
curl -sf -X POST "$SERVER/api/insights/rework-analysis" -H 'Content-Type: application/json' -d '{}' \
  -o "$TMPDIR/rework.json" 2>/dev/null &
curl -sf -X POST "$SERVER/api/insights/control-mode-roi" -H 'Content-Type: application/json' -d '{}' \
  -o "$TMPDIR/roi.json" 2>/dev/null &
curl -sf -X POST "$SERVER/api/insights/injection-efficiency" -H 'Content-Type: application/json' -d '{}' \
  -o "$TMPDIR/injection.json" 2>/dev/null &
wait

# Combine all JSON into a single output
python3 -c "
import json, glob, os, sys

result = {}
file_map = {
    'health': 'health.json',
    'project': 'project.json',
    'agents': 'agents.json',
    'decisions': 'decisions.json',
    'coherence': 'coherence.json',
    'artifacts': 'artifacts.json',
    'controlMode': 'control_mode.json',
    'events': 'events.json',
    'insights': {
        'overrides': 'overrides.json',
        'rework': 'rework.json',
        'roi': 'roi.json',
        'injection': 'injection.json',
    }
}

tmpdir = '$TMPDIR'

for key, fname in file_map.items():
    if isinstance(fname, dict):
        result[key] = {}
        for subkey, subfname in fname.items():
            path = os.path.join(tmpdir, subfname)
            try:
                with open(path) as f:
                    result[key][subkey] = json.load(f)
            except:
                result[key][subkey] = None
    else:
        path = os.path.join(tmpdir, fname)
        try:
            with open(path) as f:
                result[key] = json.load(f)
        except:
            result[key] = None

# Collect trust scores
trust = {}
for f in glob.glob(os.path.join(tmpdir, 'trust_*.json')):
    try:
        with open(f) as fh:
            data = json.load(fh)
            aid = data.get('agentId', os.path.basename(f).replace('trust_','').replace('.json',''))
            trust[aid] = data
    except:
        pass
result['trust'] = trust

json.dump(result, sys.stdout, indent=2)
print()
"
