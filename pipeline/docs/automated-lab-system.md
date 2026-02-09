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
SPEC              PLAN                 SCAFFOLD            ITERATE
┌─────────┐     ┌──────────────┐     ┌──────────────┐    ┌───────────────┐
│  User    │  →  │  Agent:      │  →  │  Agent:      │ →  │  Agent: Run,  │
│  writes  │     │  Assess spec │     │  Create repo │    │  fix, repeat  │
│  spec.md │     │  + make plan │     │  + deps      │    │  until green  │
└─────────┘     └──────────────┘     └──────────────┘    └───────────────┘
                  ↓ if unclear                              ↓
                  questions.md                              VALIDATE
                  (STOP, wait                             ┌──────────────┐
                   for human)                             │  Agent:      │
                                                         │  Check       │
PRESENT              REVIEW                              │  results     │
┌──────────────┐    ┌──────────────┐                     └──────────────┘
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

## Handling Ambiguous Specs: The Plan Stage

The first version of this design skipped straight from spec to scaffold. That's the
equivalent of skipping the preprocess stage in the blog pipeline and going straight
from transcript to draft. It would work for perfect specs and fail for everything else.

### The Problem

Experiment specs exist on a spectrum:

```
VAGUE                                                           PRECISE
"do something with          "compare embedding        "benchmark text-embedding-3-small
 embeddings"                 models on my FAQ data"     vs nomic-embed-text on the 200
                                                        FAQ pairs in data/faqs.json,
                                                        measuring recall@5, p50/p95
                                                        latency, and cost per 1k queries
                                                        using chromadb, Python 3.11"
```

The agent needs different strategies for each:

| Spec quality | What happens | Blog pipeline analog |
|---|---|---|
| **Precise** | Plan stage confirms, advances immediately | Transcript with clear structure → outline is quick |
| **Moderate** | Plan stage fills in implementation details, asks 1-2 clarifying questions | Typical transcript → outline with a few callouts |
| **Vague** | Plan stage can't proceed — writes questions.md and stops | Thin transcript → "Content Assessment" flags it |
| **Exploratory** | Needs interactive discovery session before spec exists | Recording more voice memos before processing |

### The Plan Stage (Async, Cheap)

The plan agent reads the spec and produces **two files**:

**plan.md** — A concrete implementation plan the scaffold agent can execute:
```markdown
# Plan: embedding-model-comparison

## Interpretation
User wants to compare retrieval quality across 3 embedding models
using their existing FAQ dataset.

## Implementation
- Language: Python 3.11
- Dependencies: chromadb, openai, cohere, sentence-transformers
- Structure: single main.py with model-specific adapters
- Data: load from lab/specs/embedding-comparison/data/faqs.json

## Steps the Code Will Execute
1. Load FAQ pairs, split into corpus (180) and test queries (20)
2. For each model: embed corpus, build chromadb collection, query with test set
3. Measure: recall@5, latency per query (p50/p95), estimated cost
4. Output: comparison table (stdout) + results.json

## Assumptions Made
- FAQ pairs are {question, answer} objects (will validate at runtime)
- "Recall@5" means the correct answer appears in top 5 results
- Cost calculated from published API pricing, not metered

## Estimated Runtime
~3-5 minutes (dominated by API calls to OpenAI and Cohere)

## Estimated Cost
~$0.30 in API calls + ~$0.15 in Claude iteration costs
```

**questions.md** (only if needed) — Blocking questions the agent can't resolve:
```markdown
# Questions: embedding-comparison

These need answers before the experiment can proceed.
Update spec.md with the answers and the plan stage will re-run.

## Must Answer
- [ ] Where is the FAQ dataset? (expected: lab/specs/embedding-comparison/data/faqs.json)
- [ ] What format are the FAQ pairs? ({question, answer}? CSV? something else?)

## Could Go Either Way (agent will pick a default if not answered)
- [ ] Which OpenAI model — text-embedding-3-small or text-embedding-3-large?
      → Default: small (cheaper, good baseline)
- [ ] How many test queries to hold out?
      → Default: 20 (10% of 200)
```

### The Decision Logic

The plan agent categorizes the spec and acts accordingly:

```
Read spec.md
    ├── Has blocking ambiguities?
    │   ├── YES → write questions.md, stage stays at "plan", STOP
    │   └── NO  → write plan.md
    │               ├── Has non-blocking defaults to pick?
    │               │   ├── YES → document them in plan.md "Assumptions Made"
    │               │   └── NO  → plan.md is straightforward
    │               └── advance to "scaffold"
```

This mirrors the blog preprocess prompt's "Content Assessment" section exactly:
- **Coverage: Complete** → advance
- **Coverage: Needs more depth** → flag but continue
- **Thin Content Warning** → stop and ask for more input

### The Discovery Session (Interactive, For Vague Specs)

When the spec is too vague for even the plan stage to work ("do something with
embeddings"), async questions won't cut it. You'd get a questions.md with 15
items and the back-and-forth would take longer than a conversation.

This is where an interactive discovery agent earns its keep. The blog pipeline
has the same pattern: **Cowork shortcuts** for interactive, in-context processing
when the async pipeline isn't enough.

For the lab, the discovery session would be a Claude Code conversation (or Cowork
session) with a system prompt focused on spec refinement:

```bash
# Interactive: co-author a spec with the discovery agent
claude --system-prompt-file pipeline/prompts/lab-discover.md
```

The discovery agent's job:
1. Ask what you're trying to learn (not what you want built)
2. Propose a concrete experiment design
3. Check: "Does this capture what you're after?"
4. Write the spec.md when you say yes

It's a **conversation that produces a file**, not a file that produces a conversation.

**When to use which:**

| Signal | Use plan stage (async) | Use discovery session (interactive) |
|---|---|---|
| You know what you want | Yes | No |
| You can describe success criteria | Yes | No |
| You have a dataset/input ready | Yes | Doesn't matter |
| You're exploring a problem space | No | Yes |
| The idea came from a voice memo | No | Yes |
| You could write the spec in 5 min | Yes | Overkill |

### Why Not Always Interactive?

The whole point of the lab is **fire-and-forget autonomy**. If every experiment
needs a 10-minute discovery conversation, you've just built a fancy REPL. The
plan stage exists so that 80% of experiments — the ones where you know roughly
what you want — can run without interruption.

The discovery session is the escape hatch for the other 20%, and it produces
spec.md as its output, which feeds right back into the normal pipeline.

### Spec Quality as a Dial, Not a Gate

The plan stage doesn't require perfection. It requires enough to start:

**Minimum viable spec:**
- What are you trying to find out? (1 sentence)
- What does "it worked" look like? (success criteria)
- Any constraints? (language, data, budget)

Everything else — which libraries, how to structure the code, what edge cases
to handle — is the plan agent's job to figure out. The spec is the *what*,
the plan is the *how*, and the scaffold is the *code*.

This is the same division the blog pipeline uses:
- **Audio note** = what Jay wants to say (the what)
- **Outline** = how the post should be structured (the how)
- **Draft** = the actual written post (the artifact)

## Directory Layout

```
blog/
├── lab/
│   ├── specs/                          # Stage 1: SPEC (human writes these)
│   │   └── embedding-comparison/
│   │       ├── manifest.json
│   │       └── spec.md                 # What the experiment should do
│   │
│   └── runs/                           # Stages 2-6: Agent workspace
│       └── embedding-comparison/
│           ├── plan/                   # Plan agent output
│           │   ├── plan.md            # Concrete implementation plan
│           │   └── questions.md       # Blocking questions (if any)
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
│   │   ├── lab-plan.sh                 # Assess spec, produce plan or questions
│   │   ├── lab-run.sh                  # Scaffold + iterate + validate
│   │   ├── lab-present.sh              # Generate summary.md
│   │   ├── lab-status.sh               # Show all experiments
│   │   └── auto-lab.sh                 # Cron/launchd: run pending experiments
│   │
│   └── prompts/
│       ├── lab-discover.md             # System prompt: interactive spec co-authoring
│       ├── lab-plan.md                 # System prompt: assess spec, write plan
│       ├── lab-scaffold.md             # System prompt: create project from plan
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
2. **lab-plan.md prompt** — the gatekeeper; get this right and everything downstream benefits
3. **lab-plan.sh** — assess spec, write plan.md or questions.md, gate advancement
4. **lab-scaffold.md prompt** — reads plan.md (not spec.md) to generate code
5. **lab-run.sh** — start with print mode, single iteration, no budget tracking
6. **lab-validate.md prompt** — teach Claude what "meaningful results" means
7. **lab-present.sh + prompt** — generate the summary
8. **lab-status.sh** — reuse the pattern from `status.sh`
9. **Makefile targets** — wire it all together
10. **auto-lab.sh** — add the daemon loop last, once manual runs work
11. **Feedback loop** — detect feedback.md and re-iterate
12. **lab-discover.md prompt** — interactive spec co-authoring (for vague ideas)
13. **Notifications** — add webhook support to present stage

## Open Questions

- **Isolation:** Should each experiment run in a temp directory / venv / container? Venv is probably sufficient for Python. For other languages, a temp directory with its own deps.
- **Data files:** Where do input datasets live? Could add a `lab/data/` shared directory, or let each spec include its own data in `lab/specs/<slug>/data/`.
- **Agentic vs. print mode:** Start with print mode for safety, but the iterate loop is the strongest candidate for agentic mode with tool access. Could be a per-experiment config flag.
- **Multi-language:** The scaffold prompt needs to handle Python, Node, bash, etc. Start with Python, add others as needed.
- **Version control:** Should each iteration be a git commit? Useful for diffing but noisy. Maybe commit only on stage transitions (scaffold complete, results validated).
- **Plan stage budget:** The plan stage should be cheap (one Claude call, no tools). But if the spec references external URLs or datasets, should the plan agent be allowed to fetch/inspect them? Probably yes — give it read-only access to spec data files.
- **Discovery → Spec handoff:** When using the interactive discovery agent, should it write spec.md directly, or produce a draft the user edits? Direct-write is faster; draft-then-edit is safer for complex experiments.
- **Voice memo specs:** Could pipe audio notes through the existing transcribe stage and feed the transcript to the plan agent. Reuses the capture→transcribe infrastructure for lab specs too.
