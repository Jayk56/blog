# Automated Lab System

A design for an experiment-running agent built on the same folder-as-queue architecture as the blog pipeline.

## The Idea

You describe an experiment ("compare three embedding models on my dataset", "build a CLI that parses JIRA exports", "benchmark SQLite vs DuckDB for analytics queries"). The lab agent:

1. Creates a self-contained experiment directory
2. Scaffolds code, installs dependencies, writes tests
3. Iterates autonomously — running code, reading errors, fixing them
4. Stops when results look meaningful (or after hitting a budget/iteration cap)
5. Presents a summary and asks for your feedback

Then you either approve, give notes, or say "try a different approach" and it loops back.

## How It Maps to What Exists

The blog pipeline already solved the hard design problems. The lab reuses every pattern:

```
Blog Pipeline                    Lab System
─────────────                    ──────────
audio-notes/<slug>/        →     lab/specs/<slug>/
output/transcribe/         →     lab/runs/<slug>/scaffold/
output/outline/            →     lab/runs/<slug>/iterate/
output/draft/              →     lab/runs/<slug>/results/
output/review/             →     lab/runs/<slug>/review/
manifest.json              →     manifest.json (same shape, new stages)
auto-transcribe.sh         →     auto-lab.sh (same multi-pass structure)
pipeline/prompts/          →     pipeline/prompts/lab-*.md
make transcribe SLUG=x     →     make lab-run SLUG=x
```

### The Stage Machine

```
SPEC             SCAFFOLD            ITERATE              VALIDATE
┌─────────┐     ┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│  User    │  →  │  Agent:      │ →  │  Agent: Run,  │ →  │  Agent:      │
│  writes  │     │  Create repo │    │  fix, repeat  │    │  Check       │
│  spec.md │     │  + deps      │    │  until green  │    │  results     │
└─────────┘     └──────────────┘    └───────────────┘    └──────────────┘

PRESENT              REVIEW
┌──────────────┐    ┌──────────────┐
│  Agent:      │ →  │  Human:      │
│  Write       │    │  Approve /   │
│  summary.md  │    │  feedback    │
└──────────────┘    └──────────────┘
```

### Manifest Shape

Same structure as the blog, extended with lab-specific fields:

```json
{
  "slug": "embedding-model-comparison",
  "title": "Compare embedding models on FAQ dataset",
  "created": "2026-02-09T14:00:00Z",
  "lastModified": "2026-02-09T15:30:00Z",
  "stage": "iterate",
  "type": "lab",
  "config": {
    "language": "python",
    "max_iterations": 20,
    "budget_usd": 2.00,
    "timeout_minutes": 30,
    "notify": "summary"
  },
  "iterations": {
    "count": 7,
    "last_exit_code": 0,
    "last_error": null
  },
  "cost": {
    "total_usd": 0.42,
    "tokens_in": 45000,
    "tokens_out": 12000
  }
}
```

## Directory Layout

```
blog/
├── lab/
│   ├── specs/                          # Stage 1: SPEC (human writes these)
│   │   └── embedding-comparison/
│   │       ├── manifest.json
│   │       └── spec.md                 # What the experiment should do
│   │
│   └── runs/                           # Stages 2-5: Agent workspace
│       └── embedding-comparison/
│           ├── scaffold/               # Generated project files
│           │   ├── main.py
│           │   ├── requirements.txt
│           │   └── test_main.py
│           ├── iterate/                # Iteration logs
│           │   ├── iteration-001.log   # stdout/stderr from each run
│           │   ├── iteration-002.log
│           │   └── iteration-007.log
│           ├── results/                # Final outputs
│           │   ├── output.json         # Structured results
│           │   ├── output.txt          # Raw stdout from successful run
│           │   └── figures/            # Any generated plots/charts
│           └── review/
│               ├── summary.md          # Agent-written summary for human
│               └── feedback.md         # Human response (approve/revise)
│
├── pipeline/
│   ├── scripts/
│   │   ├── lab-init.sh                 # Create spec from description
│   │   ├── lab-run.sh                  # Scaffold + iterate + validate
│   │   ├── lab-present.sh              # Generate summary.md
│   │   ├── lab-status.sh               # Show all experiments
│   │   └── auto-lab.sh                 # Cron/launchd: run pending experiments
│   │
│   └── prompts/
│       ├── lab-scaffold.md             # System prompt: create project from spec
│       ├── lab-iterate.md              # System prompt: fix errors, improve code
│       ├── lab-validate.md             # System prompt: assess if results are meaningful
│       └── lab-present.md              # System prompt: write human-readable summary
```

## The Key Scripts

### lab-run.sh — The Iteration Engine

This is the core of the lab. It replaces the linear stage-advance model with a **loop**:

```bash
#!/bin/bash
# lab-run.sh <slug>
#
# Runs the scaffold → iterate → validate cycle.
# Exits when: results pass validation, iteration cap hit, or budget exceeded.

SLUG="$1"
SPEC="lab/specs/${SLUG}/spec.md"
MANIFEST="lab/specs/${SLUG}/manifest.json"
WORKSPACE="lab/runs/${SLUG}"

MAX_ITER=$(jq -r '.config.max_iterations // 20' "$MANIFEST")
BUDGET=$(jq -r '.config.budget_usd // 2.0' "$MANIFEST")

# ── Stage: Scaffold ──────────────────────────────────────────
# Claude reads spec.md and generates the initial project.
# Uses claude -p with lab-scaffold.md prompt.
# Output: workspace/scaffold/ with runnable code.

echo "$SPEC_CONTENT" | claude -p \
    --system-prompt-file pipeline/prompts/lab-scaffold.md \
    --output-format json \
    --allowedTools "" > scaffold-response.json

# ── Stage: Iterate ───────────────────────────────────────────
# Loop: run code → check exit code → if non-zero, send error
# back to Claude for a fix → repeat.

ITERATION=0
while [[ $ITERATION -lt $MAX_ITER ]]; do
    ITERATION=$((ITERATION + 1))

    # Run the experiment
    cd "$WORKSPACE/scaffold"
    RESULT=$(timeout 120 python main.py 2>&1) || EXIT_CODE=$?
    echo "$RESULT" > "../iterate/iteration-$(printf '%03d' $ITERATION).log"

    # Success? Move to validation.
    if [[ ${EXIT_CODE:-0} -eq 0 ]]; then
        # Ask Claude: "Are these results meaningful?"
        VALIDATION=$(echo "$RESULT" | claude -p \
            --system-prompt-file pipeline/prompts/lab-validate.md \
            --output-format json \
            --allowedTools "")

        MEANINGFUL=$(echo "$VALIDATION" | jq -r '.result' | grep -c "PASS")
        if [[ $MEANINGFUL -gt 0 ]]; then
            echo "$RESULT" > "../results/output.txt"
            break
        fi
    fi

    # Failure or not meaningful — send error to Claude for a fix
    echo "Iteration $ITERATION failed. Error: $RESULT" | claude -p \
        --system-prompt-file pipeline/prompts/lab-iterate.md \
        --output-format json \
        --allowedTools ""
    # Apply the fix (Claude outputs patched files)...

    # Check budget
    SPENT=$(jq '.cost.total_usd' "$MANIFEST")
    if (( $(echo "$SPENT > $BUDGET" | bc -l) )); then
        echo "Budget exceeded (\$${SPENT} > \$${BUDGET})"
        break
    fi
done

# Update manifest with final state
jq --argjson iter "$ITERATION" '.iterations.count = $iter' "$MANIFEST" > tmp && mv tmp "$MANIFEST"
```

### auto-lab.sh — The Daemon

Same multi-pass structure as `auto-transcribe.sh`:

```
Pass 1: Find specs at stage "spec" → run lab-run.sh
Pass 2: Find experiments at "present" stage → run lab-present.sh
Pass 3: Find experiments with feedback.md newer than results → re-iterate
```

This could run on the same launchd schedule or be triggered manually.

## Reaching Out to the User

The "reach out" part is the most interesting constraint. Several options, from simplest to most integrated:

### Option A: File-Based (matches current blog pattern exactly)

The agent writes `lab/runs/<slug>/review/summary.md` and stops. You check it when you check `make lab-status`. This is what the blog pipeline does — review stage waits for human.

```bash
make lab-status
# embedding-comparison    ● present    7 iterations, $0.42   → review summary.md
# sqlite-vs-duckdb       ◐ iterate    3/20 iterations       → running
```

### Option B: Git Commit + PR as Notification

After results pass validation, the agent:
1. Commits results to a `lab/<slug>` branch
2. Opens a draft PR with the summary as the PR body
3. You review the PR like any code review

This works well if you're already watching GitHub notifications.

### Option C: Webhook / Notification

Add a `notify` field to the manifest config. The present stage fires a notification:

```bash
# In lab-present.sh, after writing summary.md:
case "$(jq -r '.config.notify' "$MANIFEST")" in
    "pushover")  curl -s -X POST https://api.pushover.net/1/messages.json ... ;;
    "slack")     curl -s -X POST "$SLACK_WEBHOOK" ... ;;
    "ntfy")      curl -s -d "Lab done: $SLUG" ntfy.sh/your-topic ;;
    "summary")   echo "Results ready. Run: make lab-review SLUG=$SLUG" ;;
esac
```

### Option D: Editor Integration

Add a "Lab" tab to the existing editor UI. The WebSocket file watcher already monitors the filesystem — extend it to watch `lab/` and surface experiments alongside blog posts. The dashboard already shows post status; lab experiments would show up the same way.

## Feedback Loop

When you write `feedback.md`, the agent re-enters the iterate stage:

```
lab/runs/<slug>/review/feedback.md
```

```markdown
## Feedback

The results look directionally right but:
- The benchmark should run 3x and average, not just once
- Add latency measurements, not just accuracy
- Try the `nomic-embed-text` model too
```

`auto-lab.sh` Pass 3 detects that `feedback.md` is newer than `results/output.txt`, re-enters the iterate loop with the feedback as additional context, and runs again.

## Spec Format

The spec is the lab equivalent of an audio note. A markdown file you write (or dictate) describing what you want:

```markdown
# Experiment: Compare Embedding Models

## Goal
Find which embedding model gives the best retrieval accuracy on my FAQ dataset.

## Models to Compare
- OpenAI text-embedding-3-small
- Cohere embed-english-v3.0
- Nomic nomic-embed-text (local, free)

## Dataset
Use the 200 FAQ pairs in data/faqs.json (provided).

## Success Criteria
- Recall@5 for each model
- Latency per query (p50, p95)
- Cost per 1000 queries
- Output a comparison table

## Constraints
- Python 3.11+
- Use chromadb for the vector store
- Each model should be tested on the same 20 test queries
- Total runtime under 10 minutes
```

## Makefile Additions

```makefile
# Lab commands
lab-init: check-slug
	@$(SCRIPTS_DIR)/lab-init.sh "$(SLUG)"

lab-run: check-slug
	@$(SCRIPTS_DIR)/lab-run.sh "$(SLUG)"

lab-present: check-slug
	@$(SCRIPTS_DIR)/lab-present.sh "$(SLUG)"

lab-review: check-slug
	@echo "Open: lab/runs/$(SLUG)/review/summary.md"
	@echo "Write feedback to: lab/runs/$(SLUG)/review/feedback.md"

lab-status:
	@$(SCRIPTS_DIR)/lab-status.sh

auto-lab:
	@$(SCRIPTS_DIR)/auto-lab.sh
```

## Claude CLI Usage Pattern

The blog pipeline already established the right pattern. The lab uses it identically:

```bash
# No tool use — all context piped in, just generate text
echo "$CONTEXT" | claude -p \
    --system-prompt-file pipeline/prompts/lab-scaffold.md \
    --output-format json \
    --allowedTools ""
```

For the **iterate** stage, you have two options:

1. **Print mode (current pattern):** Claude outputs a patch/diff, your script applies it, runs again. Cheap, fast, stateless between iterations. This is what the blog pipeline does.

2. **Agentic mode (new):** Give Claude tool access and let it run commands itself:
   ```bash
   claude -p \
       --system-prompt-file pipeline/prompts/lab-iterate.md \
       --allowedTools "Bash(command:*),Read,Write,Edit" \
       --max-turns 20
   ```
   More powerful — Claude can run tests, read errors, edit files, and retry in a single session. Costs more per iteration but converges faster. This is the natural fit for the "iterate until it works" loop.

The choice depends on how much autonomy you want per iteration. You could start with print mode (matches what you have) and graduate to agentic mode for experiments that need it.

## What's Reusable vs. What's New

### Reuse directly (no changes)
- `manifest.json` schema and stage-tracking pattern
- `metadata.sh` library for logging transitions and costs
- `advance.sh` logic (stage validation gates)
- Makefile structure and conventions
- Editor WebSocket file watcher (just add `lab/` to watch paths)
- `.gitignore` patterns (add `lab/runs/*/iterate/*.log`)

### New scripts needed
- `lab-init.sh` — create spec directory + manifest from a slug
- `lab-run.sh` — scaffold + iterate + validate loop
- `lab-present.sh` — generate summary.md from results
- `lab-status.sh` — show all experiments and their state
- `auto-lab.sh` — daemon that processes pending experiments

### New prompts needed
- `lab-scaffold.md` — generate project files from a spec
- `lab-iterate.md` — fix errors given stdout/stderr
- `lab-validate.md` — assess whether results are meaningful
- `lab-present.md` — write a human-readable summary

### Optional extensions
- Editor UI "Lab" tab (React component + API routes)
- Notification hooks (pushover/ntfy/slack)
- Budget tracking dashboard

## Implementation Order

1. **Directory structure + manifest schema** — just `mkdir` and a JSON template
2. **lab-scaffold.md prompt** — the most important prompt to get right
3. **lab-run.sh** — start with print mode, single iteration, no budget tracking
4. **lab-validate.md prompt** — teach Claude what "meaningful results" means
5. **lab-present.sh + prompt** — generate the summary
6. **lab-status.sh** — reuse the pattern from `status.sh`
7. **Makefile targets** — wire it all together
8. **auto-lab.sh** — add the daemon loop last, once manual runs work
9. **Feedback loop** — detect feedback.md and re-iterate
10. **Notifications** — add webhook support to present stage

## Open Questions

- **Isolation:** Should each experiment run in a temp directory / venv / container? Venv is probably sufficient for Python. For other languages, a temp directory with its own deps.
- **Data files:** Where do input datasets live? Could add a `lab/data/` shared directory, or let each spec include its own data in `lab/specs/<slug>/data/`.
- **Agentic vs. print mode:** Start with print mode for safety, but the iterate loop is the strongest candidate for agentic mode with tool access. Could be a per-experiment config flag.
- **Multi-language:** The scaffold prompt needs to handle Python, Node, bash, etc. Start with Python, add others as needed.
- **Version control:** Should each iteration be a git commit? Useful for diffing but noisy. Maybe commit only on stage transitions (scaffold complete, results validated).
