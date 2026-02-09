+++
title = 'Designing the Project Tab: Project Management When Half the Work Does Itself'
date = 2026-02-09T12:00:00.000Z
tags = ["ai", "project management", "organization theory", "automation", "design"]
draft = true
+++

In the [last post](/posts/cowork-blog-automation/) I ended with a tease: "I think in the future we'll likely see a 'Project' tab that takes the project functionality that Anthropic has and extends it with agents the same way they are doing with Code and Cowork." Then I said "unless..." and left it hanging.

Well, here's the "unless" — what if we designed that thing ourselves? Not as production software (yet), but as a design exploration. What would a Project Management workspace look like when more than half of the actual production work is being done by automated agents that can grow, specialize, and modify their own processes?

To answer that, I want to start somewhere that might seem unusual for a blog about AI tooling: organization theory. Because every project management tool is, at its core, an embodiment of assumptions about how work gets organized. And those assumptions are about to get very, very stale.

## Why Start with Organization Theory?

Every PM tool you've ever used — Jira, Asana, Linear, Monday, Notion — is built on a set of assumptions about work that were formalized between 1950 and 1990. These aren't arbitrary design choices. They're the crystallized output of decades of research into how humans organize to produce things.

Here are the big ideas that shape the tools we have today:

**Mintzberg's Coordination Mechanisms.** Henry Mintzberg identified five ways organizations coordinate work: direct supervision, standardization of work processes, standardization of outputs, standardization of skills, and mutual adjustment (informal communication). Most PM tools are built around the first three — you assign tasks (supervision), define workflows (process standardization), and set acceptance criteria (output standardization). Mutual adjustment gets relegated to Slack.

**Thompson's Interdependence Types.** James Thompson described three types of task interdependence: pooled (shared resources, independent work), sequential (output of one feeds input of another), and reciprocal (back-and-forth iteration). Traditional PM tools handle sequential well (Gantt charts, Kanban boards), pooled okay (resource views), and reciprocal poorly (we just... have meetings).

**Galbraith's Information Processing View.** Jay Galbraith argued that organizations exist to process information, and the more uncertainty in the work, the more information processing capacity you need. PM tools are essentially information processing aids — they reduce uncertainty about who is doing what, when, and whether it's done.

**Simon's Bounded Rationality.** Herbert Simon showed that humans can't process all available information, so we "satisfice" — we make decisions that are good enough rather than optimal. Organizations exist partly to partition complexity so that each person deals with a manageable chunk. Every time you create a project board with swimlanes, you're partitioning complexity.

**Weick's Sensemaking.** Karl Weick showed that organizations make sense of ambiguity through retrospective interpretation — we understand what we did after we did it, and that understanding shapes what we do next. This is why status reports exist, why we have retrospectives, why PMs spend so much time synthesizing what happened.

I bring all of this up because these ideas explain *why* PM tools look the way they do. And they also reveal what breaks when the nature of work fundamentally changes.

## What Changes When 50%+ of Work Is Automated?

Let me be concrete about what I mean by "50%+ of work is automated." I'm not talking about automating email reminders or auto-assigning tickets. I mean:

- An agent writes the first draft of a design doc and you review it
- An agent implements a feature across four files and opens a PR
- An agent runs an experiment, collects data, and produces an analysis
- An agent reviews someone else's agent's output and flags issues
- An agent breaks down a high-level goal into a work plan, then executes parts of it

This is already happening in my workflow. The [blog pipeline](/posts/cowork-blog-automation/) I built has agents doing transcription, outlining, review, and asset collection. I do the drafting, the direction-setting, and the final calls. In software projects with Claude Code or Codex, agents write substantial portions of the code. The ratio will only shift further.

So what happens to our organizational assumptions?

**The coordination problem inverts.** In traditional organizations, the hard problem is getting humans to coordinate — to communicate, to share context, to align on goals. With agent-heavy work, coordination between agents is cheap (they can share files, read each other's output, follow specifications precisely). The new hard problem is coordination between *human intent* and *agent execution*. Did the agent do what I actually meant, not just what I literally said?

**Supervision becomes review.** Direct supervision assumes you watch someone work and correct course in real time. With agents, you specify intent, let them execute, and then review the output. This is fundamentally different. The skill shifts from managing process to evaluating results — and evaluating results at scale when agents produce work faster than you can read it.

**Standardization of process becomes specification of intent.** When agents follow instructions precisely, the process is the prompt. The quality of the output depends almost entirely on the quality of the specification. This makes "intent specification" the central activity of project management, not scheduling or resource allocation.

**Sequential interdependence becomes the default.** Agents naturally work in pipelines — the output of one stage becomes the input of the next. My blog pipeline is a literal example: CAPTURE → TRANSCRIBE → PREPROCESS → DRAFT → REVIEW → COLLECT → PUBLISH. This isn't a coincidence. It's the natural coordination pattern when workers are fast, reliable, and don't need coffee breaks.

**Sensemaking becomes the bottleneck.** When agents produce volumes of work quickly, the human's job shifts to understanding what was produced and deciding if it's right. This is Weick's sensemaking problem amplified by 10x. The Project tab needs to be, first and foremost, a sensemaking tool.

**Bounded rationality expands, but doesn't disappear.** Agents extend what a single person can manage. But new bounds appear: context windows, hallucination risk, goal drift over long agent sessions, and the cognitive load of tracking what multiple agents are doing across a project. The complexity just moved.

## Five Personas, Five Stories

To ground this in reality, let me walk through five personas and their use case stories. Each one reveals features we'd need.

### 1. Maya — Solo Creator

Maya runs a one-person content studio. She produces video essays, written articles, and social media content for three clients. Before agents, she spent 60% of her time on production (editing, formatting, research, scheduling) and 40% on creative work (writing, ideation, strategy). Now her agents handle most of the production work.

**Maya's Monday morning:**

She opens the Project tab and sees three client projects. Each has a status that she didn't manually update — the system synthesized it from what the agents actually did over the weekend. Client A's monthly article series has two posts in "draft review" and one that an agent flagged because it couldn't find a source for a claim she made. Client B's social calendar has next week's posts generated and awaiting her voice/tone review. Client C has a problem — the research agent found conflicting data on a market trend and doesn't know how to proceed.

Maya clicks into Client C. She sees the *decision queue* — a prioritized list of places where agents are blocked on her judgment. The conflicting data issue is at the top. She reads the agent's summary of the conflict: two sources disagree on market size, here's the data from each, here's the agent's confidence assessment. Maya makes the call (use the more conservative number), types a two-sentence rationale, and the agent continues.

She then moves to Client A's flagged post. The *provenance view* shows her exactly which agent produced which sections, what sources were used, and what the review agent thought. She spots that the review agent was right to flag the unsourced claim — it came from her original voice memo and she was misremembering a statistic. She corrects it and approves the post.

Total time: 20 minutes. Three projects advanced.

**What features does Maya's story reveal?**

- **Synthesized project status** — not "what tasks are done" but "what state is the project in, and what needs my attention"
- **Decision queue** — a prioritized list of places where human judgment is needed, with context to make the decision quickly
- **Provenance tracking** — understanding what was produced by which agent, from which inputs, so you can evaluate quality
- **Rationale capture** — when a human makes a decision, recording why, so agents can learn the pattern and the project has an audit trail

### 2. David — Small Team Lead

David leads a team of four developers building a SaaS product. Each developer uses coding agents extensively — roughly 60-70% of their committed code is agent-generated. David himself codes less now and spends more time on architecture decisions, code review, and stakeholder communication.

**David's problem isn't productivity — it's coherence.**

Last sprint, two developers' agents both generated utility functions for date formatting. One used Luxon, the other used date-fns. Neither developer noticed because the agents handled the implementation details. The code worked, shipped, and now they have two date libraries in their bundle. This is a minor example, but it represents a class of problems that David thinks about constantly: when work is distributed across many agents that don't share context, how do you maintain architectural coherence?

David opens the Project tab and navigates to the *architecture view*. This isn't a class diagram that someone drew and forgot to update. It's a living view that's computed from the actual codebase, updated by agents that analyze commits and PRs. He can see that the dependency graph branched this week — two new libraries were added that serve overlapping purposes. The system flagged this as a potential coherence issue.

He drills into the *integration view*, which shows how this sprint's work from all four developers (and their agents) fits together. He sees that the API contract between the frontend and backend teams drifted — the frontend agent generated types based on an older API spec while the backend agent updated the endpoints. The system detected the mismatch during its nightly coherence scan.

David writes a two-paragraph *architectural decision record* (ADR) directly in the Project tab: "We use date-fns for all date operations. Luxon should be removed in the next cleanup pass." He marks it as a project constraint. Now, when any team member's agent generates code that touches dates, the constraint is included in the agent's context.

**What features does David's story reveal?**

- **Coherence detection** — automated scanning for inconsistencies across agent-produced work (duplicate dependencies, API contract drift, style divergence)
- **Living architecture views** — computed from actual code, not maintained by hand
- **Project constraints** — decisions and rules that are automatically injected into agent context across the team
- **Integration views** — seeing how work from multiple contributors (human and agent) fits together before it's too late

### 3. Priya — Product Manager

Priya manages a product with 12 developers across three teams. She doesn't write code, but she's responsible for making sure the right things get built in the right order and that stakeholders are happy with progress.

**Priya's challenge: she can't attend every agent's conversation.**

In the old world, she could join standups, read PRs, and occasionally pair with a developer to understand a complex feature. Now each developer has 3-5 agent sessions running daily, producing code, docs, and tests. The volume of output has tripled but her ability to process it hasn't.

Priya opens the Project tab to the *portfolio view*. She sees the three teams and their current initiatives. Each initiative shows a *comprehension summary* — not a progress bar (which requires someone to estimate total work, an increasingly meaningless exercise), but a narrative generated by an agent that read the week's commits, PRs, design docs, and agent conversations. It's three paragraphs that tell her what happened, what decisions were made, what's blocked, and what she should pay attention to.

She notices Team B's summary mentions that they made a significant architectural change to the authentication flow. This wasn't in the plan. She clicks through to the *decision log* and sees that Team B's lead made the call on Wednesday because an agent discovered during implementation that the planned approach had a security flaw. The decision is logged with context, rationale, and the agent's security analysis.

Priya doesn't need to reverse the decision — it was the right call. But she needs to update the stakeholder brief that goes out Friday. She tells her own writing agent to draft an update that incorporates the auth change, and it pulls the relevant context directly from Team B's decision log.

She then switches to the *dependency map* — a view showing how work across all three teams interconnects. There's a red edge: Team A's new API endpoint depends on Team C's database migration, but Team C pushed their migration to next sprint. This means Team A will be blocked in three days. Priya drops a note to both leads and the system creates the coordination task.

**What features does Priya's story reveal?**

- **Comprehension summaries** — AI-generated narratives that synthesize large volumes of agent-produced work into human-readable status
- **Decision logs** — automatic capture of significant decisions with context, not just what was decided but why and what the agent analysis showed
- **Cross-team dependency tracking** — computed from actual work items and code dependencies, not manually maintained
- **Context flow** — the ability for one person's agent to pull context from another team's project artifacts without copy-pasting

### 4. Rosa — Research Director

Rosa leads a team of six researchers at a biotech firm. They're exploring three drug interaction pathways, and each researcher has agents running literature reviews, statistical analyses, and experiment simulations.

**Rosa's problem: she needs to see the forest.**

Each researcher is deep in their pathway. Their agents produce daily summaries of literature findings, flag potentially relevant papers, and run correlation analyses on experimental data. The output is enormous and highly specialized.

Rosa opens the Project tab to a view that doesn't exist in any current PM tool: the *knowledge graph*. It's a visual map of concepts, findings, and open questions across all three research pathways, built and maintained by agents that read every paper, every experiment log, and every researcher's notes. It's not a static diagram — it updates as new information comes in.

She notices something the individual researchers couldn't have seen — there's a cluster of recent papers that touch on the intersection of Pathway A and Pathway C. The agents working on each pathway independently flagged some of these papers, but neither team connected them. The knowledge graph made the cross-cutting pattern visible.

Rosa creates an *exploration task* — not a traditional task with a due date and assignee, but a directive: "Investigate the relationship between Pathway A's receptor binding mechanism and Pathway C's metabolic findings, particularly the papers from Chen et al. and Bakker et al." She assigns it to an agent, gives it access to both teams' project contexts, and sets a checkpoint: "Produce a preliminary analysis. I'll review before any further work."

The next morning, the analysis is in her *review queue*. The agent found a potential interaction effect that neither team had considered. Rosa marks it for discussion at the weekly research meeting and the system automatically adds it to the agenda with the relevant context attached.

**What features does Rosa's story reveal?**

- **Knowledge graphs** — automated mapping of concepts and relationships across project artifacts
- **Cross-context pattern detection** — finding connections that span teams, projects, or domains
- **Exploration tasks** — work items that are investigative rather than productive, with checkpoints rather than deadlines
- **Review queues with context** — surfacing agent-produced analysis with enough context to evaluate it without switching tools

### 5. Sam — Independent Consultant

Sam takes on 4-6 client projects at a time, ranging from strategic consulting to hands-on implementation. Client isolation is critical — code, documents, and context from one client must never leak to another. But Sam's agents need to use patterns and skills learned across engagements.

**Sam's tension: isolation vs. learning.**

Sam opens the Project tab and sees the *project isolation view*. Each client project is a walled garden. Agents working on Client X cannot access Client Y's files, conversations, or context. This is enforced at the system level, not by convention. Sam's clients require this, and for good reason.

But Sam has noticed that the agent working on Client D's data pipeline keeps solving the same class of problem that was solved two months ago for Client B. The solution pattern is generic — it's about retry logic and backpressure handling — but the agent can't access Client B's implementation.

This is where *patterns* come in. Sam reviews a suggested pattern that an agent extracted from Client B's project (proposed before the project closed): "Backpressure-aware retry with exponential backoff for streaming data pipelines." The pattern is abstracted — no client-specific details, no proprietary code, just the architectural approach. Sam approves it into the *shared pattern library*, and now all future agents across all projects can reference it.

Sam also uses the *client handoff package* feature. When a consulting engagement ends, Sam generates a package that includes: every decision made and why, the current state of all deliverables, open questions, and suggested next steps. The agent builds this from the project's decision log and work history. What used to take Sam a full day now takes 15 minutes of review.

**What features does Sam's story reveal?**

- **Project isolation with system-level enforcement** — not just ACLs but true context separation between projects
- **Pattern extraction and sharing** — the ability to learn from one project and apply to another without leaking proprietary information
- **Handoff packages** — automated generation of project knowledge transfer documents from the actual project history
- **Audit trails for compliance** — every agent action logged, every human decision recorded, exportable for client review

## The Feature Map

Pulling these stories together, here's what the Project tab needs, organized by the organizational theory concepts they address:

### Coordination & Integration

| Feature | Org Theory Root | What It Replaces |
|---------|----------------|-----------------|
| Decision Queue | Simon's bounded rationality | Status meetings, Slack pings |
| Project Constraints | Mintzberg's standardization | Style guides, tribal knowledge |
| Comprehension Summaries | Weick's sensemaking | Status reports, standups |
| Integration Views | Lawrence & Lorsch's integration | Architecture review meetings |
| Coherence Detection | Galbraith's information processing | Manual code review for consistency |

### Work Orchestration

| Feature | Org Theory Root | What It Replaces |
|---------|----------------|-----------------|
| Pipeline Builder | Thompson's sequential interdependence | Kanban boards, workflow engines |
| Exploration Tasks | March's exploration vs. exploitation | Research spike tickets |
| Checkpoint Gates | Mintzberg's mutual adjustment | Milestone reviews |
| Parallel Workstreams | Thompson's pooled interdependence | Resource allocation matrices |

### Knowledge & Context

| Feature | Org Theory Root | What It Replaces |
|---------|----------------|-----------------|
| Knowledge Graphs | Nonaka's knowledge creation | Documentation wikis |
| Provenance Tracking | Weick's retrospective sensemaking | Git blame, manual attribution |
| Context Flow | Galbraith's lateral relations | Copy-paste, project docs |
| Pattern Library | Nelson & Winter's organizational routines | Best practices documents |
| Decision Logs | Simon's decision-making model | Meeting notes, institutional memory |

### Governance & Control

| Feature | Org Theory Root | What It Replaces |
|---------|----------------|-----------------|
| Project Isolation | Thompson's boundaries | Separate tool instances |
| Review Queues | Ouchi's output control | Pull request reviews |
| Audit Trails | Weber's bureaucratic accountability | Compliance documentation |
| Cost Dashboards | Resource dependency theory | Spreadsheet tracking |
| Handoff Packages | March & Simon's organizational memory | Manual knowledge transfer |

## The Deeper Design Question

But here's what makes this genuinely different from just "better project management software." Every feature I've described above could, in theory, be built as a traditional tool with manual inputs. The difference is that when 50%+ of work is agent-produced, **most of these features can be computed rather than curated.**

Let me explain what I mean:

**Status is observed, not reported.** In traditional PM, someone has to update the status. With agent work, the system can observe what actually happened — what code was committed, what documents were produced, what decisions were made — and synthesize status from reality. No more "update your tickets" reminders because the tickets update themselves.

**Dependencies are discovered, not declared.** Traditional PM requires someone to manually identify dependencies. When agents produce the actual work artifacts, the system can analyze the artifacts to find real dependencies — code that calls other code, documents that reference other documents, data that flows between systems.

**Quality is measured, not estimated.** Instead of asking "is this done?" and trusting the answer, the system can run the tests, check the specifications, compare against constraints, and give you an evidence-based quality assessment.

**Knowledge is extracted, not documented.** Instead of asking teams to write documentation (which they never do), agents can extract knowledge from the actual work — patterns, decisions, relationships — and maintain it as a living knowledge base.

This is the fundamental insight: **the Project tab isn't a place where humans record what happened; it's a place where the system shows humans what's happening and asks them what to do about it.**

## What Organization Theory Didn't Predict

There's one thing that classical organization theory didn't anticipate, and it's arguably the most important design consideration: **the workers can modify themselves.**

In every organizational theory I've referenced, the capabilities of workers are treated as relatively fixed. You can train people, sure, but humans learn slowly and have inherent cognitive limits. Organizations are designed around these limits — that's the whole point.

Agents are different. Between Monday and Tuesday, an agent can:

- Be given a new tool (MCP server) that gives it entirely new capabilities
- Have its context expanded with domain knowledge it didn't have before
- Be asked to generate its own training data from project history
- Be run in parallel — five instances of the same agent working five problems simultaneously
- Be "rolled back" to a previous state if it went off course

This is more like managing an organism than managing an employee. The Project tab needs to account for the fact that the capabilities of your "workers" are fluid. Some implications:

**Capability inventory matters.** You need to know what your agents can do *right now*, and what they could do with the right tools and context. Traditional PM assumes you know your team's skills. With agents, the skill set is configurable.

**Process improvement is continuous, not periodic.** Agents can reflect on their own performance and suggest process changes. The Project tab should support this — a feedback loop where agent performance data feeds back into process design.

**Specialization is cheap but coherence is expensive.** You can spin up a specialized agent for any task in seconds. The cost isn't in specialization — it's in making sure all those specialized agents produce work that fits together. This is Lawrence and Lorsch's differentiation/integration problem on hyperdrive.

**Institutional memory is explicit.** When a human leaves a company, their knowledge goes with them. When an agent session ends, the knowledge is in the conversation log. The Project tab should treat these logs as institutional memory — searchable, synthesizable, and available to future agents.

## What's Missing from This Design?

Let me be honest about what I haven't figured out:

**Trust calibration.** In some domains (writing a blog post), I'm comfortable letting agents run with minimal review. In others (financial analysis, medical research), every output needs careful human verification. The system needs a trust model that varies by domain, task type, and even by the specific agent's track record on similar tasks. I don't know what this looks like yet.

**The attention economy of review.** If agents produce work faster than humans can review it, how do you decide what to review carefully and what to approve quickly? This is a real problem. You can't review everything. But if you rubber-stamp most things, you'll miss important errors. There's a quality-of-review allocation problem here that I haven't seen anyone tackle well.

**Emergent behavior in multi-agent systems.** When you have multiple agents working on the same project, they can produce emergent results — outcomes that no single agent intended and no human directed. Sometimes this is serendipitous (Rosa's cross-pathway discovery). Sometimes it's problematic (David's duplicate dependencies). The system needs to detect emergence and surface it for human evaluation, but I'm not sure how to reliably distinguish good emergence from bad.

**The motivation question.** All of organization theory is built on assumptions about human motivation — we need autonomy, mastery, purpose, fair compensation. Agents don't have these needs, which simplifies some things but removes others. We can't "motivate" an agent to do better work by giving it a sense of purpose. We can only specify more clearly or give it better tools. This changes the nature of management fundamentally, and I'm still thinking through what it means for the PM interface.

## Where This Goes

If I had a magic wand, the Project tab would be a workspace where:

1. You define intent at the project level ("Build a customer feedback analysis system")
2. The system decomposes that into workstreams based on the project constraints you've set
3. Agents execute against those workstreams, producing artifacts and making small decisions autonomously
4. The system maintains a real-time understanding of the project state — not task completion percentages, but a genuine model of what's been built, what's coherent, and what needs attention
5. Human attention is directed precisely where it matters — decisions that require judgment, quality gates that need expert review, conflicts that need resolution
6. Knowledge flows freely within the project but is properly isolated between projects
7. Every decision, both human and agent, is logged with context so the project has an institutional memory that any participant can query

This is a different kind of project management. It's not about tracking tasks and timelines. It's about maintaining coherence and directing attention in a system where most of the work happens without you.

The closest analogy might be an air traffic control system. The planes (agents) mostly fly themselves. The controller (project manager) maintains awareness of the whole system, intervenes when there are conflicts or anomalies, and makes the judgment calls that the automated systems can't. The dashboard (Project tab) is designed not to show you everything, but to show you exactly what you need to see and nothing more.

I think this is where tools like Claude's ecosystem are heading. Code is for implementation. Cowork is for knowledge work. The Project tab would be for coherence — the thing that holds it all together and makes sure the pieces fit.

Whether Anthropic builds it or we build it ourselves... that's the "unless" I left hanging.

But there's something I've been glossing over. Everything above assumes a particular philosophy of control — one where the human is the orchestrator, directing agents step by step and reviewing their output. This feels natural because it mirrors how we manage human teams. But what if it's not the right model? What if there's a fundamentally different approach that works better when half your workforce can self-organize at machine speed?

This is where I think we need to get rigorous. Not just design features, but test competing assumptions.

## Two Philosophies of Control

When I step back and look at the design I sketched above, I realize I've been implicitly assuming one of two possible models. Let me make both explicit, because the choice between them determines almost everything about what the Project tab looks like.

### Philosophy A: The Orchestrator

In the Orchestrator model, the human retains directive control. This maps to what Burns and Stalker called a *mechanistic* organization — hierarchy, defined roles, formal coordination, centralized decision-making.

Here's how it works:

1. **The human creates the plan.** You decompose the project into phases, tasks, and subtasks. You decide what gets done in what order.
2. **The human assigns work.** Each task goes to an agent with specific instructions, scope, and acceptance criteria.
3. **Agents execute within bounds.** They do exactly what's asked, nothing more. If they encounter something unexpected, they stop and ask.
4. **The human reviews each output.** Nothing moves forward without explicit approval.
5. **All coordination flows through the human.** Agents don't know about each other's work except what the human provides as context.

The Orchestrator model is the natural extension of how most PM tools work today. You're the conductor; the agents are your orchestra. Every note is in the score you wrote.

**Organizational theory mapping:** This is Mintzberg's Machine Bureaucracy — coordination through standardization of work processes — combined with direct supervision at decision points. Thompson would call the interdependence sequential and mediated: the human is the mediating technology between agents.

**Where it excels:**
- High-stakes domains where errors are expensive
- Projects with well-understood requirements
- Situations where regulatory compliance requires human sign-off on every output
- Teams where the human has deep domain expertise that agents lack

**Where it struggles:**
- Scale — the human becomes the bottleneck as agent count increases
- Discovery — agents can't find what they're not looking for
- Speed — human review gates create latency in every pipeline

### Philosophy B: The Ecosystem

In the Ecosystem model, the human sets direction and boundaries but agents self-organize their execution. This maps to an *organic* organization — flat, flexible, adaptive, with distributed decision-making.

Here's how it works:

1. **The human writes a project brief.** Goals, constraints, quality standards, architectural preferences, and a definition of done. Not a plan — a specification of intent.
2. **Agents propose their own work breakdown.** A coordinating agent reads the brief and suggests how to decompose the work, which the human reviews and approves (or adjusts).
3. **Agents execute and coordinate with each other.** They share artifacts through the project filesystem, read each other's outputs, and solve integration problems autonomously.
4. **The system monitors for anomalies.** Rather than human review at every gate, the system watches for coherence issues, quality failures, blocked decisions, and unexpected behavior — and surfaces only what needs human attention.
5. **The human intervenes selectively.** At scheduled checkpoints and when the system flags something. Otherwise, the agents run.

The Ecosystem model is more like managing a garden than conducting an orchestra. You prepare the soil, plant the seeds, set up the trellises, and then mostly watch things grow — intervening when something needs pruning or when a plant is growing in the wrong direction.

**Organizational theory mapping:** This is Mintzberg's Adhocracy — coordination through mutual adjustment between agents. It borrows from complex adaptive systems theory: simple rules, local interactions, emergent global behavior. It also echoes Nonaka and Takeuchi's concept of *ba* — a shared space where knowledge creation happens organically.

**Where it excels:**
- Projects with high novelty or uncertainty
- Situations where the human doesn't know the optimal approach in advance
- Large projects where human bottlenecks would be unacceptable
- Discovery-oriented work (research, exploration, creative projects)

**Where it struggles:**
- When agents make coordinated mistakes that compound before detection
- High-compliance environments where every output needs a human signature
- When the human doesn't have enough domain knowledge to evaluate emergent results
- Early trust-building — you have to know your agents well before you let go

### The Real Difference: Where Attention Goes

The most practical difference between these two philosophies is what the human spends their time on:

| | Orchestrator | Ecosystem |
|---|---|---|
| **Primary activity** | Reviewing agent outputs | Evaluating system state |
| **Decision frequency** | Many small decisions (approve/reject each task) | Few large decisions (adjust direction, resolve conflicts) |
| **Information flow** | Pull (human requests status) | Push (system surfaces what matters) |
| **Failure mode** | Bottleneck (human can't review fast enough) | Drift (agents go off course without human noticing) |
| **Trust model** | Verify everything | Trust but verify selectively |
| **Feedback loop** | Tight (after each task) | Wide (at checkpoints) |
| **Human knowledge required** | Deep (must evaluate each output) | Broad (must evaluate whole-system coherence) |

Here's the thing — I genuinely don't know which model is better. I suspect it depends on the project, the domain, the phase of work, and the maturity of the human-agent relationship. Which is why I think the right move is to test both.

## The A/B Test

I want to propose a structured experiment. Not a thought experiment — an actual test you could run with today's tools (Claude Code, Codex, or similar agent-capable systems) and real projects.

### Hypotheses

**H-A (Orchestrator):** When the project manager maintains explicit control over work decomposition, agent assignment, and review gates, projects produce higher quality output with fewer coherence issues, at the cost of slower throughput and higher human time investment.

**H-B (Ecosystem):** When agents are given goals and constraints but allowed to self-organize their execution, projects achieve higher throughput and discover more novel solutions, at the cost of more coherence issues and occasional significant rework.

**H-null:** There is no significant difference in project outcomes; the management approach matters less than the quality of initial specifications and constraints.

If H-null is true, that's actually the most interesting result — it would mean the specification layer is what matters, and the control model is just preference.

### Test Setup

Pick a project type that's repeatable enough to compare but complex enough to stress both models. I'll walk through three scenarios below, but the basic framework is:

**Participants:** Same human PM, same agent system (e.g., Claude Code with Opus 4.6), same base project requirements.

**Group A runs the Orchestrator model:**
- PM creates a detailed project plan with explicit phases
- PM decomposes each feature into agent tasks with specific instructions
- Agent completes task → PM reviews → PM approves or sends back → next task
- PM manages all cross-task coordination manually
- Agents have no knowledge of each other's work except what the PM provides

**Group B runs the Ecosystem model:**
- PM writes a project brief: goals, constraints, quality standards, key architectural decisions
- PM launches a coordinating agent that proposes a work breakdown
- PM reviews and approves (or modifies) the proposed breakdown
- Agents execute, coordinating through shared project artifacts (filesystem, shared context docs)
- System monitors for coherence issues, quality failures, and decisions needing human input
- PM intervenes only when surfaced an issue or at pre-defined checkpoints
- Agents can read each other's outputs and shared project state

**Measurements (collected for both groups):**

| Metric | What It Measures | How to Collect |
|--------|-----------------|---------------|
| Wall-clock time | Total time from start to acceptance | Timestamps |
| Human-hours | Active time the PM spent on the project | Time tracking |
| Quality score | Functional correctness, test pass rate, adherence to spec | Automated tests + human rubric |
| Coherence score | Consistency of style, dependencies, API contracts, naming | Automated linting + manual review |
| Rework rate | % of work that had to be redone due to misalignment | Git history analysis |
| Novel solution count | Approaches or solutions the PM didn't specify | PM self-report + code review |
| Decision count | Number of decisions the PM made during the project | Activity log |
| Surprise count | Unexpected outcomes (positive or negative) | PM journal |
| PM confidence | Did the PM feel they understood the project state at all times? | Survey (1-10 scale, daily) |
| Final satisfaction | Is the PM happy with the end result? | Survey |

### Scenario 1: Content Production (Maya's World)

**The project:** Produce four blog posts for a client over one week. Each post requires research, drafting, image sourcing, and SEO optimization. One of the four posts involves a controversial topic that requires careful tone management.

**Under Orchestrator:**

Maya starts Monday morning by creating four task chains, one per post:

```
Post 1: Research → Outline → Draft → Image sourcing → SEO → Review → Revise → Deliver
Post 2: Research → Outline → Draft → Image sourcing → SEO → Review → Revise → Deliver
Post 3: Research → Outline → Draft → Image sourcing → SEO → Review → Revise → Deliver
Post 4: Research → Outline → Draft → Image sourcing → SEO → Review → Revise → Deliver (controversial)
```

She writes detailed prompts for each research phase, reviews each research output, writes prompts for each outline phase, reviews each outline... and so on. By Tuesday evening, she has four outlines approved and two first drafts in review. She's been in and out of agent sessions for about 5 hours.

Post 4 (the controversial topic) hits a snag — the research agent surfaced arguments from both sides and Maya needs to decide the framing before the outline can proceed. She spends 30 minutes reading the research and writes a positioning document. Then she prompts the outline accordingly.

By Friday, all four posts are delivered. Maya spent approximately 12 human-hours across the week. The posts are consistent in quality because she reviewed every stage. No surprises — every output was exactly what she asked for.

**Under Ecosystem:**

Maya starts Monday morning by writing a client brief:

> Four blog posts due Friday. Topics: [list]. Client brand voice: [doc]. SEO requirements: keyword density 1-2%, meta descriptions, H2 structure. Quality bar: factually accurate, sourced claims, engaging but professional. Special note on Post 4: this is a sensitive topic, route all framing decisions to me before drafting.

She launches a project agent that proposes: "I'll run research on all four topics in parallel, produce outlines by end of day Monday, share them for your review Tuesday morning, then proceed with drafts while you review. Image sourcing will happen in parallel with drafting. SEO optimization will be a final pass."

Maya approves. She checks in Tuesday morning — four outlines are waiting, plus a flag: "Post 4's research surfaced a strong framing question. Here are three possible angles with pros/cons. Which direction?" Same decision as Orchestrator, but it was surfaced to her as a structured choice rather than her having to discover it in raw research output.

She makes the call, approves the outlines (tweaking one), and goes about her other work. By Wednesday evening, four drafts are ready. Thursday is revision. Friday morning, all four posts are delivered.

Maya spent approximately 5 human-hours across the week. Three of the posts are comparable quality to Orchestrator. But one post (Post 2) used a metaphor that doesn't quite match the client's brand voice — the agent tried something creative that Maya might have caught if she'd reviewed the outline more carefully. It needs a revision pass. Still ships on time.

And here's the surprise: Post 3 included a data visualization the agent produced on its own by pulling public data related to the topic. Maya didn't ask for this. It's good. The client will love it. This wouldn't have happened under Orchestrator because Maya wouldn't have thought to request it.

**What this scenario tests:**
- Human-hours tradeoff (Orchestrator: 12h, Ecosystem: 5h + revision time)
- Quality consistency vs. quality upside
- Whether the decision queue model (Ecosystem) surfaces critical choices as effectively as human-directed review (Orchestrator)
- The value of unexpected agent initiative

### Scenario 2: Software Feature (David's World)

**The project:** Add a real-time notification system to an existing SaaS app. Requires: WebSocket backend, notification preference API, frontend notification center component, integration with existing auth system, database migration for notification storage.

**Under Orchestrator:**

David spends Monday morning decomposing the feature:

```
1. Database migration: notification_preferences + notifications tables
2. Backend: WebSocket server with auth integration
3. Backend: Notification preference CRUD API
4. Backend: Notification dispatch service
5. Frontend: Notification center component
6. Frontend: Preference settings panel
7. Integration: Wire frontend to WebSocket + REST endpoints
8. Testing: Unit + integration tests for all components
```

He writes specs for each task: "For task 1, use the existing migration framework, follow the naming conventions in the schema doc, add appropriate indexes for user_id lookups." Then he feeds them to his agent one by one (or a few in parallel where there are no dependencies, like tasks 2 and 3).

He reviews each output before allowing dependent tasks to start. He catches an issue: the agent used a different WebSocket library than what's already in the codebase for the chat feature. He corrects this and the agent regenerates. By Wednesday, the backend is done. Thursday is frontend. Friday is integration and testing.

Total: 4 days wall-clock, ~8 human-hours of active management. Zero coherence issues because David caught them during review. Test pass rate: 94% on first run.

**Under Ecosystem:**

David writes a project brief:

> Add real-time notification system. Requirements: [spec]. Architectural constraints: use existing WebSocket infrastructure from chat feature (see /src/lib/ws/), follow existing migration patterns, match current frontend component library. All new endpoints need auth middleware. Test coverage target: 90%+.

He launches a project agent. It comes back in 20 minutes with a proposed breakdown — similar to David's manual decomposition, but it also proposes a step David hadn't considered: "Audit existing chat WebSocket code for reusability before building notification WebSocket layer." David likes this and approves.

Agents proceed. David checks in at lunch — three of eight subtasks are done. The monitoring system flags something: "Two different notification payload schemas detected between the dispatch service and the frontend component. Recommending alignment before integration." David reviews the mismatch, picks one schema, and the agents realign.

By Wednesday afternoon, the feature is functionally complete. But Thursday morning, the coherence scan finds something: the notification preferences API returns data in a different format than the existing user preferences API. Both work, but it's inconsistent for the frontend. David has to decide: retrofit the new endpoint to match the old format (clean, but costs a few hours of rework), or accept the inconsistency (ships faster, creates tech debt).

Under Orchestrator, this inconsistency wouldn't have happened because David would have specified the response format explicitly. Under Ecosystem, it emerged from agents independently implementing to spec without cross-referencing existing patterns. The coherence scan caught it, but the cost is a decision + rework.

Total: 3.5 days wall-clock, ~4 human-hours of active management. One coherence issue caught and resolved. Test pass rate: 91% on first run. The agent also auto-generated API documentation that David didn't request — pulled from the existing documentation patterns in the codebase.

**What this scenario tests:**
- Whether Orchestrator's upfront decomposition catches issues that Ecosystem only finds at integration time
- The coherence gap: specified constraints (Orchestrator) vs. inferred constraints (Ecosystem)
- Wall-clock speed advantage of parallel self-organization
- Whether the "audit existing code for reuse" step (agent-proposed) represents genuine value over human decomposition

### Scenario 3: Research Synthesis (Rosa's World)

**The project:** Analyze 50 recent papers on CRISPR delivery mechanisms and produce a literature review identifying key themes, contradictions, gaps, and a recommendation for the lab's next research direction.

**Under Orchestrator:**

Rosa creates a structured research pipeline:

```
1. Categorize 50 papers by delivery mechanism type (viral, lipid nanoparticle, electroporation, other)
2. For each category: extract key findings, methods, sample sizes, outcomes
3. Cross-reference findings to identify agreements and contradictions
4. Identify gaps: what mechanisms are understudied? What combinations haven't been tried?
5. Synthesize into a literature review with standard sections
6. Produce recommendation memo
```

Rosa reviews each phase. She has deep domain expertise, so she catches nuances the agent misses — one paper's methodology is known to be unreliable in the field, something the agent wouldn't know. She annotates this during the cross-referencing review. The final literature review takes 2 weeks of intermittent work, ~15 human-hours.

The output is thorough and accurate. Rosa trusts every claim because she reviewed the evidence chain.

**Under Ecosystem:**

Rosa writes a research brief:

> Analyze the attached 50 papers on CRISPR delivery mechanisms. I need: (1) thematic categorization, (2) findings extraction with methodology assessment, (3) contradiction mapping, (4) gap analysis, (5) a literature review suitable for our quarterly research meeting, (6) your recommendation for where we should focus next and why. Flag any papers where the methodology looks questionable — I'll want to validate those assessments. Checkpoint: after categorization and initial findings extraction, show me what you have before proceeding to synthesis.

Agents process all 50 papers in parallel — categorization and extraction happen within hours rather than days. At the checkpoint, Rosa reviews the categorization (correct, with one she'd reclassify) and the methodology flags (agent flagged four papers, including two of the three she would have flagged — but missed the one with the controversial methodology that only an insider would question). She adds her annotation and approves continuation.

The synthesis comes back in two days: a 30-page literature review with a recommendation. It's 85% of the quality of the Orchestrator output. Two of the contradictions it identified are actually methodological artifacts, not real disagreements — something Rosa catches in her review. But the gap analysis found something she hadn't considered: a cluster of papers on combined viral/nanoparticle approaches that none of the individual category analyses would have surfaced because they span categories. The agent discovered the cross-cutting theme because it wasn't constrained to Rosa's predefined categories.

Total: 4 days wall-clock, ~6 human-hours. Lower floor quality, but a discovery that justified the approach.

**What this scenario tests:**
- Domain expertise gap: agents miss what only an insider knows (Orchestrator catches this through exhaustive review; Ecosystem catches it through selective human verification)
- Category-spanning discovery: rigid categorization (Orchestrator) vs. emergent pattern recognition (Ecosystem)
- The fundamental tradeoff: breadth of coverage vs. depth of human verification
- Whether the checkpoint model is sufficient for catching critical errors

### Reading the Results

If we ran these three scenarios (and ideally, many more) with disciplined measurement, here's what I'd predict we'd find:

**Orchestrator wins on:**
- Coherence (fewer inconsistencies because the human catches them at every gate)
- Accuracy floor (fewer errors that slip through, especially domain-specific ones)
- PM confidence ("I knew exactly what was happening at all times")
- Predictability (output closely matches expectations)

**Ecosystem wins on:**
- Throughput (less wall-clock time, dramatically less human-time)
- Novel discovery (agents find things they weren't asked to find)
- Scalability (approach works the same for 4 tasks or 40)
- Agent initiative (useful outputs that weren't requested)

**And the critical insight: neither dominates.**

The Orchestrator is better when you know exactly what you want and the cost of errors is high. The Ecosystem is better when you're exploring, when speed matters more than perfection, and when agent-originated discovery has value.

This shouldn't surprise anyone who's read Burns and Stalker. They proved in 1961 that mechanistic organizations outperform in stable environments and organic organizations outperform in dynamic environments. The same principle holds — we just need to apply it to human-agent teams rather than human-human teams.

## The Spectrum, Not the Binary

The real design insight isn't "pick A or B." It's that the Project tab needs to support fluid movement along the spectrum between them. And more importantly, it should help you know *where on the spectrum you should be* for any given project, phase, or task.

Here's my attempt at mapping the control topology:

```
                    ORCHESTRATOR                              ECOSYSTEM
                    ◄────────────────────────────────────────►

By project phase:
  Kickoff           ████████░░░░░░░░░░░░  ← Define scope carefully
  Exploration       ░░░░░░░░░░░░████████  ← Let agents discover
  Execution         ░░░░████████░░░░░░░░  ← Structured but parallel
  Integration       ████████████░░░░░░░░  ← Human coherence review
  Polish            ░░░░░░░░████████░░░░  ← Agent thoroughness, human taste

By risk level:
  Patient safety    ████████████████░░░░  ← Review everything
  Production code   ░░░░████████████░░░░  ← Review architecture, trust implementation
  Internal docs     ░░░░░░░░░░░░████████  ← Trust heavily, spot-check
  Prototypes        ░░░░░░░░░░░░░░░░████  ← Let agents run

By domain expertise:
  You're the expert  ░░░░████████░░░░░░░░  ← Guide direction, trust execution
  Shared expertise   ░░░░░░░░████████░░░░  ← Collaborate, checkpoint
  Agent is expert    ░░░░░░░░░░░░████████  ← Set goals, evaluate results

By team maturity:
  First project      ████████████░░░░░░░░  ← Build trust, learn patterns
  Established team   ░░░░░░░░████████░░░░  ← Proven agents, targeted review
  High-trust team    ░░░░░░░░░░░░░░████░░  ← Exception-based management
```

This means the Project tab needs a **control mode** that's configurable per project, per phase, and even per task. And ideally, the system would *recommend* the control mode based on signals:

- "This task touches the payments system. I've shifted to Orchestrator mode and added a mandatory review gate."
- "This task is generating test fixtures for a feature you already approved. Running in Ecosystem mode — I'll flag if anything unusual comes up."
- "You're two weeks into this project and your rework rate is 3%. I recommend loosening the review gates on low-risk tasks to improve throughput."

This is the feature I'm most excited about, and I think it's the one that's genuinely novel. Not a static PM tool, not a static control model, but an **adaptive control system** that shifts management style based on observed project dynamics.

## What This Adds to the Feature Map

The A/B test analysis adds several features that weren't in the original design:

### Adaptive Control Features

| Feature | What It Does | Triggered By |
|---------|-------------|-------------|
| Control Mode Selector | Sets orchestrator/ecosystem balance per project, phase, or task | Human choice or system recommendation |
| Risk-Aware Gating | Automatically tightens review requirements when agents touch high-risk systems | Code analysis, domain tagging |
| Trust Score | Per-agent track record: rework rate, error rate, human override rate on past tasks | Historical measurement |
| Throughput vs. Quality Dial | Explicit tradeoff control — "I need this fast" vs. "I need this right" | Human choice |
| Control Shift Recommendations | System suggests loosening or tightening control based on project data | Rework rate, error rate, phase detection |
| Checkpoint Designer | Human defines when they want to intervene in an ecosystem-mode pipeline | Human choice during planning |

### Agent Coordination Features (Ecosystem-specific)

| Feature | What It Does | Org Theory Root |
|---------|-------------|----------------|
| Shared Project State | A filesystem or context document that all agents can read and update | Galbraith's lateral relations |
| Agent-to-Agent Handoff | Structured way for one agent to pass work to another with context | Thompson's sequential interdependence |
| Cross-Agent Coherence Monitor | Continuous check for inconsistencies across agent outputs | Lawrence & Lorsch's integration |
| Emergent Pattern Detection | Identifies when agents produce unexpected cross-cutting results | Complex adaptive systems |
| Agent Work Proposal | Agents propose their own task breakdown before executing | Adhocracy's mutual adjustment |

### Human Override Features (Both models)

| Feature | What It Does | Why It Matters |
|---------|-------------|---------------|
| Emergency Brake | Stop all agents on a project immediately | When drift is detected |
| Retroactive Review | Flag previously-approved work for re-examination | When you learn something that changes your evaluation |
| Context Injection | Push new information to all active agent sessions on a project | When requirements change mid-flight |
| Decision Reversal | Undo a previous decision and cascade the change through dependent work | When a human decision turns out to be wrong |

## The Real Open Question

After working through this, I think the deepest open question isn't about features — it's about **how you build trust in the Ecosystem model fast enough to actually use it.**

In Maya's ecosystem scenario, the agent produced a creative data visualization she didn't request. Wonderful. But it also drifted on brand voice in another post. The same property — agent initiative — produced both the win and the miss. The question is: does the value of unexpected good outputs outweigh the cost of unexpected bad ones? And how does that calculation change over time as agents get better and humans get better at specifying constraints?

This is fundamentally a question about learning. Not just agent learning, but *organizational* learning — the human-agent system learning what level of control is appropriate for what circumstances. The Project tab needs to support this learning explicitly:

1. **Track outcomes by control mode.** Did ecosystem-mode tasks have higher rework? Did orchestrator-mode tasks take longer without quality improvement? Let the data tell you.
2. **Make trust visible.** Show the PM their own trust patterns — "You review 95% of code outputs but only 40% of documentation outputs. Your documentation error rate is still low. You could probably review 20% and maintain quality."
3. **Support graduated autonomy.** Start every new project in orchestrator mode. As the PM gains confidence and the data supports it, suggest loosening controls. Make it easy to tighten them again if something goes wrong.
4. **Preserve the escape hatch.** No matter how ecosystem-mode a project gets, the PM should always be one click away from pulling everything back to orchestrator mode. The freedom to let go requires the certainty that you can grab back.

I think this graduated autonomy pattern is the key design principle for the Project tab. Not "here's the best way to manage AI-augmented projects" but "here's a system that helps you discover the best way *for you, for this project, right now* — and helps you adapt as conditions change."

The air traffic control analogy from earlier still holds, but I'd update it: the Project tab is more like a flight control system with a manual override. Most of the time, autopilot is fine. But the pilot always has their hands near the controls, and the system is designed to make the handoff between automated and manual control as smooth as possible.

That's the thing I'd want to build.

\[to be continued\]
