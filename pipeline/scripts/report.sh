#!/bin/bash
# report.sh — Display metadata report for a blog post
#
# Reads output/metadata/{slug}/metadata.json and prints a formatted
# summary of time, cost, and content stats for the post.
#
# Usage: report.sh <slug>
#        report.sh           (summary table for all posts with metadata)

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

REPO_ROOT="$(git rev-parse --show-toplevel)"
METADATA_DIR="${REPO_ROOT}/output/metadata"

command -v jq &> /dev/null || {
    echo -e "${RED}Error: jq is required but not installed${NC}"
    exit 1
}

# --- Formatting helpers ---

format_duration() {
    local seconds="$1"
    if [[ "$seconds" == "0" || "$seconds" == "null" || -z "$seconds" ]]; then
        echo "—"
        return
    fi
    # Handle decimal seconds by truncating
    seconds=$(printf '%.0f' "$seconds")
    if [[ "$seconds" -ge 3600 ]]; then
        printf '%dh %dm %ds' $((seconds/3600)) $((seconds%3600/60)) $((seconds%60))
    elif [[ "$seconds" -ge 60 ]]; then
        printf '%dm %ds' $((seconds/60)) $((seconds%60))
    else
        printf '%ds' "$seconds"
    fi
}

format_cost() {
    local cost="$1"
    if [[ "$cost" == "0" || "$cost" == "null" || -z "$cost" ]]; then
        echo "—"
        return
    fi
    printf '$%.4f' "$cost"
}

format_bytes() {
    local bytes="$1"
    if [[ "$bytes" == "0" || "$bytes" == "null" || -z "$bytes" ]]; then
        echo "—"
        return
    fi
    if [[ "$bytes" -ge 1048576 ]]; then
        printf '%.1f MB' "$(echo "scale=1; $bytes / 1048576" | bc)"
    elif [[ "$bytes" -ge 1024 ]]; then
        printf '%.0f KB' "$(echo "scale=0; $bytes / 1024" | bc)"
    else
        printf '%d B' "$bytes"
    fi
}

format_number() {
    local num="$1"
    if [[ "$num" == "0" || "$num" == "null" || -z "$num" ]]; then
        echo "—"
    else
        printf '%s' "$num"
    fi
}

# --- Detailed report for a single post ---

show_detail() {
    local slug="$1"
    local meta_path="${METADATA_DIR}/${slug}/metadata.json"

    if [[ ! -f "$meta_path" ]]; then
        echo -e "${RED}No metadata found for '${slug}'${NC}"
        echo "Run pipeline stages first to generate metadata."
        exit 1
    fi

    local M
    M=$(cat "$meta_path")

    echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${BLUE}║  Post Report: ${slug}$(printf '%*s' $((34 - ${#slug})) '')║${NC}"
    echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════╝${NC}"
    echo

    # --- Audio ---
    local audio_count audio_duration audio_size
    audio_count=$(echo "$M" | jq '.audio.file_count // 0')
    audio_duration=$(echo "$M" | jq '.audio.total_duration_seconds // 0')
    audio_size=$(echo "$M" | jq '.audio.total_size_bytes // 0')

    if [[ "$audio_count" != "0" ]]; then
        echo -e "${BOLD}🎙  Audio${NC}"
        echo -e "   Files:     ${audio_count} recording(s)"
        echo -e "   Duration:  $(format_duration "$audio_duration")"
        echo -e "   Size:      $(format_bytes "$audio_size")"

        # Per-file breakdown
        local file_count
        file_count=$(echo "$M" | jq '.audio.files | length // 0')
        if [[ "$file_count" -gt 0 ]]; then
            echo -e "   ${DIM}───────────────────────────────${NC}"
            echo "$M" | jq -r '.audio.files[]? | "   \(.name)  \(.duration_seconds)s  \(.size_bytes) bytes"' | while read -r line; do
                # Parse and reformat each line
                local name dur size_b
                name=$(echo "$line" | sed -E 's/^\s+(.+)\s+[0-9.]+s\s+[0-9]+ bytes$/\1/')
                dur=$(echo "$line" | grep -oE '[0-9.]+s' | head -1)
                size_b=$(echo "$line" | grep -oE '[0-9]+ bytes' | grep -oE '[0-9]+')
                echo -e "   ${DIM}• ${name}  (${dur}, $(format_bytes "${size_b:-0}"))${NC}"
            done
        fi
        echo
    fi

    # --- Transcription ---
    local tx_duration tx_words tx_cost
    tx_duration=$(echo "$M" | jq '.transcription.duration_seconds // 0')
    tx_words=$(echo "$M" | jq '.transcription.word_count // 0')
    tx_cost=$(echo "$M" | jq '.transcription.estimated_cost_usd // 0')

    if [[ "$tx_words" != "0" ]]; then
        echo -e "${BOLD}📝 Transcription${NC}"
        echo -e "   Words:     ${tx_words}"
        echo -e "   Time:      $(format_duration "$tx_duration")"
        echo -e "   Cost:      $(format_cost "$tx_cost")  ${DIM}(ElevenLabs Scribe v2)${NC}"
        echo
    fi

    # --- Preprocess ---
    local pp_duration pp_cost pp_model pp_input pp_output
    pp_duration=$(echo "$M" | jq '.preprocess.duration_seconds // 0')
    pp_cost=$(echo "$M" | jq '.preprocess.cost_usd // 0')
    pp_model=$(echo "$M" | jq -r '.preprocess.model // empty')
    pp_input=$(echo "$M" | jq '.preprocess.input_tokens // 0')
    pp_output=$(echo "$M" | jq '.preprocess.output_tokens // 0')

    if [[ -n "$pp_model" && "$pp_model" != "null" ]]; then
        echo -e "${BOLD}🔧 Preprocessing${NC}"
        echo -e "   Time:      $(format_duration "$pp_duration")"
        echo -e "   Model:     ${pp_model}"
        echo -e "   Tokens:    ${pp_input} in → ${pp_output} out"
        echo -e "   Cost:      $(format_cost "$pp_cost")"
        echo
    fi

    # --- Review ---
    local rv_duration rv_cost rv_model rv_input rv_output
    rv_duration=$(echo "$M" | jq '.review.duration_seconds // 0')
    rv_cost=$(echo "$M" | jq '.review.cost_usd // 0')
    rv_model=$(echo "$M" | jq -r '.review.model // empty')
    rv_input=$(echo "$M" | jq '.review.input_tokens // 0')
    rv_output=$(echo "$M" | jq '.review.output_tokens // 0')

    if [[ -n "$rv_model" && "$rv_model" != "null" ]]; then
        echo -e "${BOLD}🔍 Review${NC}"
        echo -e "   Time:      $(format_duration "$rv_duration")"
        echo -e "   Model:     ${rv_model}"
        echo -e "   Tokens:    ${rv_input} in → ${rv_output} out"
        echo -e "   Cost:      $(format_cost "$rv_cost")"
        echo
    fi

    # --- Editing sessions ---
    local session_count
    session_count=$(echo "$M" | jq '.editing.sessions | length // 0')

    if [[ "$session_count" -gt 0 ]]; then
        echo -e "${BOLD}✏️  Editing${NC}"
        echo -e "   Sessions:  ${session_count}"

        local total_saves total_editing_min
        total_saves=$(echo "$M" | jq '[.editing.sessions[]?.save_count // 0] | add // 0')
        total_editing_min=$(echo "$M" | jq '
            [.editing.sessions[]? |
                (((.last_save_at // .started_at) | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) - (.started_at | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)) / 60
            ] | add // 0 | round')

        echo -e "   Saves:     ${total_saves}"
        echo -e "   Time:      ~${total_editing_min} min"

        # Word count progression across sessions
        local first_wc last_wc
        first_wc=$(echo "$M" | jq '.editing.sessions[0]?.word_count_start // 0')
        last_wc=$(echo "$M" | jq '.editing.sessions[-1]?.word_count_end // 0')
        if [[ "$last_wc" != "0" ]]; then
            echo -e "   Words:     ${first_wc} → ${last_wc}"
        fi
        echo
    fi

    # --- Asset collection ---
    local col_duration col_requested col_collected col_bytes
    col_duration=$(echo "$M" | jq '.collect.duration_seconds // 0')
    col_requested=$(echo "$M" | jq '.collect.assets_requested // 0')
    col_collected=$(echo "$M" | jq '.collect.assets_collected // 0')
    col_bytes=$(echo "$M" | jq '.collect.total_asset_bytes // 0')

    if [[ "$col_collected" != "0" || "$col_requested" != "0" ]]; then
        echo -e "${BOLD}📸 Assets${NC}"
        echo -e "   Collected: ${col_collected}/${col_requested}"
        echo -e "   Size:      $(format_bytes "$col_bytes")"
        echo -e "   Time:      $(format_duration "$col_duration")"
        echo
    fi

    # --- Publish ---
    local pub_date bundle_size pub_assets
    pub_date=$(echo "$M" | jq -r '.publish.published_at // empty')
    bundle_size=$(echo "$M" | jq '.publish.bundle_size_bytes // 0')
    pub_assets=$(echo "$M" | jq '.publish.asset_count // 0')

    if [[ -n "$pub_date" && "$pub_date" != "null" ]]; then
        echo -e "${BOLD}🚀 Published${NC}"
        echo -e "   Date:      $(echo "$pub_date" | cut -d'T' -f1)"
        echo -e "   Bundle:    $(format_bytes "$bundle_size") (${pub_assets} assets)"
        echo
    fi

    # --- Stage transitions ---
    local transition_count
    transition_count=$(echo "$M" | jq '.stage_transitions | length // 0')

    if [[ "$transition_count" -gt 0 ]]; then
        echo -e "${BOLD}📋 Stage History${NC}"
        echo "$M" | jq -r '.stage_transitions[]? | "   \(.at | split("T")[0])  \(.from) → \(.to)"'
        echo
    fi

    # --- Pipeline jobs ---
    local job_count
    job_count=$(echo "$M" | jq '.pipeline_jobs | length // 0')

    if [[ "$job_count" -gt 0 ]]; then
        echo -e "${BOLD}⚙️  Pipeline Jobs${NC}"
        echo "$M" | jq -r '.pipeline_jobs[]? | "   \(.started_at | split("T") | .[0] + " " + (.[1] | split(".")[0]))  \(.action)  \(.duration_seconds)s  exit:\(.exit_code)"' | while read -r line; do
            echo -e "   ${DIM}$(echo "$line" | sed 's/^\s*//')${NC}"
        done
        echo
    fi

    # --- Summary ---
    local has_summary
    has_summary=$(echo "$M" | jq 'has("summary")')

    echo -e "${BOLD}${CYAN}━━━ Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo

    local sum_auto sum_editing sum_cost sum_tw sum_fw sum_ratio
    sum_auto=$(echo "$M" | jq '.summary.total_automation_seconds // (
        [.transcription.duration_seconds // 0,
         .preprocess.duration_seconds // 0,
         .review.duration_seconds // 0,
         .collect.duration_seconds // 0] | add)')
    sum_editing=$(echo "$M" | jq '.summary.total_estimated_editing_minutes // (
        [.editing.sessions[]? |
            (((.last_save_at // .started_at) | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) - (.started_at | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)) / 60
        ] | add // 0 | round)')
    sum_cost=$(echo "$M" | jq '.summary.total_estimated_cost_usd // (
        [.transcription.estimated_cost_usd // 0,
         .preprocess.cost_usd // 0,
         .review.cost_usd // 0] | add)')
    sum_tw=$(echo "$M" | jq '.summary.transcript_words // .transcription.word_count // 0')
    sum_fw=$(echo "$M" | jq '.summary.final_words // 0')
    sum_ratio=$(echo "$M" | jq '.summary.expansion_ratio // 0')

    echo -e "   ${BOLD}Automation time:${NC}   $(format_duration "$sum_auto")"
    echo -e "   ${BOLD}Editing time:${NC}      ~${sum_editing} min"
    echo -e "   ${BOLD}Estimated cost:${NC}    $(format_cost "$sum_cost")"
    echo
    echo -e "   ${BOLD}Transcript words:${NC}  $(format_number "$sum_tw")"
    echo -e "   ${BOLD}Final words:${NC}       $(format_number "$sum_fw")"
    if [[ "$sum_ratio" != "0" && "$sum_ratio" != "null" ]]; then
        echo -e "   ${BOLD}Expansion ratio:${NC}   ${sum_ratio}x"
    fi
    echo
}

# --- Summary table for all posts ---

show_all() {
    if [[ ! -d "$METADATA_DIR" ]]; then
        echo -e "${YELLOW}No metadata found yet.${NC}"
        echo "Run pipeline stages to start collecting metadata."
        exit 0
    fi

    local found=false
    for meta_dir in "${METADATA_DIR}"/*/; do
        [[ -d "$meta_dir" ]] || continue
        [[ -f "${meta_dir}metadata.json" ]] || continue
        found=true
        break
    done

    if [[ "$found" == "false" ]]; then
        echo -e "${YELLOW}No metadata found yet.${NC}"
        echo "Run pipeline stages to start collecting metadata."
        exit 0
    fi

    echo -e "${BOLD}${BLUE}Pipeline Metadata Report${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo
    printf "  ${BOLD}%-25s %8s %8s %8s %8s %10s${NC}\n" "SLUG" "AUDIO" "WORDS" "AUTO" "EDITING" "COST"
    echo -e "  ${DIM}─────────────────────────────────────────────────────────────────────────────────${NC}"

    for meta_dir in "${METADATA_DIR}"/*/; do
        [[ -d "$meta_dir" ]] || continue
        local meta_path="${meta_dir}metadata.json"
        [[ -f "$meta_path" ]] || continue

        local M slug audio_dur words auto_dur edit_min cost
        M=$(cat "$meta_path")
        slug=$(echo "$M" | jq -r '.slug // "?"')
        audio_dur=$(echo "$M" | jq '.audio.total_duration_seconds // 0')
        words=$(echo "$M" | jq '.transcription.word_count // 0')
        auto_dur=$(echo "$M" | jq '
            [.transcription.duration_seconds // 0,
             .preprocess.duration_seconds // 0,
             .review.duration_seconds // 0,
             .collect.duration_seconds // 0] | add')
        edit_min=$(echo "$M" | jq '
            [.editing.sessions[]? |
                (((.last_save_at // .started_at) | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) - (.started_at | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)) / 60
            ] | add // 0 | round')
        cost=$(echo "$M" | jq '
            [.transcription.estimated_cost_usd // 0,
             .preprocess.cost_usd // 0,
             .review.cost_usd // 0] | add')

        local audio_fmt auto_fmt edit_fmt cost_fmt words_fmt
        audio_fmt=$(format_duration "$audio_dur")
        words_fmt=$(format_number "$words")
        auto_fmt=$(format_duration "$auto_dur")
        if [[ "$edit_min" == "0" || "$edit_min" == "null" ]]; then
            edit_fmt="—"
        else
            edit_fmt="~${edit_min}m"
        fi
        cost_fmt=$(format_cost "$cost")

        printf "  %-25s %8s %8s %8s %8s %10s\n" "$slug" "$audio_fmt" "$words_fmt" "$auto_fmt" "$edit_fmt" "$cost_fmt"
    done

    echo
    echo -e "${DIM}  Run 'make report SLUG=<slug>' for a detailed breakdown.${NC}"
    echo
}

# --- Main ---

if [[ $# -eq 1 ]]; then
    show_detail "$1"
else
    show_all
fi
