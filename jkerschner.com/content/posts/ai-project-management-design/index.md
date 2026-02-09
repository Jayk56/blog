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

\[to be continued\]
