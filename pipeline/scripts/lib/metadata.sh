#!/bin/bash
# metadata.sh — Shared helpers for reading/writing per-post metadata.json
#
# Source this file from pipeline scripts:
#   source "$(dirname "$0")/lib/metadata.sh"
#
# Functions:
#   metadata_read <slug>                     — prints current metadata JSON (or empty object)
#   metadata_merge <slug> <json_fragment>    — deep-merges JSON fragment into metadata
#   metadata_log_transition <slug> <from> <to> — appends a stage transition entry

METADATA_BASE="${REPO_ROOT}/output/metadata"

metadata_read() {
    local slug="$1"
    local meta_path="${METADATA_BASE}/${slug}/metadata.json"
    if [[ -f "$meta_path" ]]; then
        cat "$meta_path"
    else
        echo '{"slug":"'"${slug}"'"}'
    fi
}

metadata_merge() {
    local slug="$1"
    local fragment="$2"
    local meta_dir="${METADATA_BASE}/${slug}"
    local meta_path="${meta_dir}/metadata.json"

    mkdir -p "$meta_dir"

    local current
    current=$(metadata_read "$slug")

    # Deep merge using jq:
    # - Scalars and plain objects: new values overwrite
    # - Known array keys (stage_transitions, sessions, files, pipeline_jobs): append
    echo "$current" | jq --argjson new "$fragment" '
        def deepmerge(b):
            reduce (b | to_entries[]) as $e (.;
                if ($e.value | type) == "object" and (.[$e.key] | type) == "object"
                then .[$e.key] |= deepmerge($e.value)
                elif ($e.key == "stage_transitions" or $e.key == "sessions" or $e.key == "files" or $e.key == "pipeline_jobs")
                     and (.[$e.key] | type) == "array"
                     and ($e.value | type) == "array"
                then .[$e.key] += $e.value
                else .[$e.key] = $e.value
                end
            );
        deepmerge($new)
    ' > "${meta_path}.tmp" && mv "${meta_path}.tmp" "$meta_path"
}

metadata_log_transition() {
    local slug="$1"
    local from_stage="$2"
    local to_stage="$3"
    local now
    now="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

    metadata_merge "$slug" '{"stage_transitions":[{"from":"'"$from_stage"'","to":"'"$to_stage"'","at":"'"$now"'"}]}'
}
