+++
title = "Moving from Codex CLI to Codex App: What Actually Changed"
date = 2026-02-06T18:30:00Z
draft = true
summary = "After a month shipping 15k lines of code weekly with Codex CLI, I tested the new GUI app to see if it actually improves the workflow."
tags = ["AI", "Codex", "Developer Tools", "Claude", "agent-workflow", "CLI-vs-GUI", "productivity"]
categories = ["Things I've Learned"]

[params]
ai_assisted = true
+++

I found myself to be a pretty heavy user of the Codex CLI. Over the past month, I've churned out about 15,000 lines of code per week, working somewhere between three and six days a week. That's the kind of usage pattern that tells you whether a tool actually saves you time or just feels good in theory.

<!-- TONE: Strong opening. Personal, specific numbers, pragmatic framing. This is solidly your voice. -->

When OpenAI announced the Codex app, I was genuinely excited. A graphical interface? Better project navigation? Integrated skills and automations? It all sounded like it could smooth out the rough edges of my terminal workflow. So I decided to spend some time testing it—not with assumptions, but with actual work, to see what changes are good, what changes are bad, and whether I'm actually going to migrate fully or stick with the CLI.

<!-- TONE: Good hook structure. Sets up the evaluation framing clearly. -->

## How I've Been Using Codex (The Baseline)

Before diving into the app, I should explain how I've evolved my CLI workflow. It's become pretty deliberate.

My current approach to organizing agent conversations is all about threading strategy. I maintain a main thread—usually the longest-running one—where I work on major feature changes and architectural decisions. Think of it as the thread that keeps continuity across the project. The compaction feature in Codex is genuinely good enough that keeping a long conversation running actually *reduces* the amount of re-explaining and rediscovery the agent has to do. It lets me keep the thread of what we're working on fairly constrained and consistent, even across many back-and-forths.

<!-- SUGGESTION: This paragraph is strong but could be slightly more conversational. The transcript has more personality here—Jay talks about "the thread of what we're working on" with a directness that this captures well, but the explanation of compaction is a touch formal. Consider: "The compaction is good enough that long threads actually *reduce* re-explaining—which sounds backwards until you try it." -->

But I don't just live in one thread. I'll spin up secondary threads when I want to do a small, isolated change, or when I need a code review with completely fresh context—one that's not clouded by recent conversation history. Or, if I'm working in a monorepo and want to focus the agent on one subcomponent, I'll change the second or third thread to that specific directory and launch Codex in that limited scope.

<!-- REVIEW: Good detail here. This directly matches the transcript and shows evolved workflow thinking. The examples (small change, code review, monorepo scoping) are concrete. -->

This threading model is independent of whether I'm using CLI or app, but it shapes how I think about context and continuity.

## The App's Promise: Better Project Organization

One of the first things I noticed about the Codex app is how it handles projects. In the terminal, I have to manually track which terminal window I have open, and which folder that terminal is actually running in. When I want to switch between projects, I either launch a new terminal and tmux session, or do some manual jumping around. It's friction.

The app consolidates this. You can add projects directly in the interface, and it even imports conversation histories from those projects, so you can review work that's already been done. Parent projects show up as gray subheadings next to the folder names, which gives you a clearer visual hierarchy.

<!-- CONTENT: Screenshot placeholder here. The outline calls for this—Codex app sidebar showing multiple imported projects with parent projects as gray subheadings. This is specific enough to find. -->
[SCREENSHOT: The Codex app sidebar showing multiple imported projects with parent projects displayed as gray subheadings, demonstrating the project hierarchy feature]

<!-- SUGGESTION: The screenshot description is detailed enough that Jay should be able to take it. Consider: does Jay have access to the Codex app right now to capture this? If not, flag that explicitly. -->

Is this a win? Sure, but I need to be honest about what it actually solves. I don't have to navigate through folders in the terminal anymore—I navigate through the UI instead. That's a quality-of-life improvement. But here's the thing: given the context switching required to jump between projects anyway, I'm not entirely sure I'm gonna see much benefit from having them all consolidated.

<!-- TONE: This is excellent—the self-aware skepticism about whether the UX improvement actually matters functionally. This is distinctly your voice. -->

The real bottleneck isn't file navigation. It's keeping project context clear to the agent. The UI consolidation is nice, but it doesn't solve that problem.

## Skills, Worktrees, and Automations: Theoretical Promise, Practical Reality

The app comes with a few features that sound really useful in theory. Let me be honest about where they actually land for me.

### Skills

The app provides a skills page where you can install extensions from OpenAI's repository. You can create custom skills with a Codex conversation, or point it at a new repository using the skill installer. It's flexible.

Have I found them necessary for most of what I'm working on? Not yet. Skills are another piece of context you have to keep in mind when directing the agent, and that cognitive overhead doesn't feel worth it unless they unlock something genuinely new.

That said, there are things in the marketplace I'm genuinely interested in exploring. Image generation and audio generation for sprites, app assets, or background imagery sounds like a really interesting use case. The ability to generate those assets directly within Codex without context switching could be powerful. I just haven't taken the time to set it up yet.

<!-- QUESTION: The transcript mentions "image generation and audio generation for sprites, app assets, background imagery." You say it's interesting but haven't set it up. Is this something you plan to follow up on in a future post, or is it just exploratory interest? The outline flagged this—might be worth being clearer about whether this is "future deep dive" or just "on the radar." -->

### Worktrees

Worktrees are something I've seen a lot of people use, but I haven't used much myself. The app gives you access to local worktrees and cloud options for running Codex commands. My work has been 100% local with the CLI so far.

Here's the thing: I'm going to test out worktrees and cloud, but I'm skeptical about seeing the benefit. A lot of my best practices for source control have gone out the window, honestly. I mostly work on the main branch because the speed at which changes are happening makes it hard to juggle branch context on top of the project context I'm already trying to keep in mind.

(If you have a good example of where worktrees have unlocked something for you, I'd genuinely love to hear about it. You can point me to your blog or message me on Bluesky—I'm serious about learning.)

<!-- TONE: Strong voice here. The aside about best practices going out the window, working on main branch due to velocity—that's specific and credible. The open invitation for reader input is authentic to Jay. -->

### Automations

The automations tab is another feature I haven't really used much on my personal projects. But I can see potential.

The idea is background tasks running on a regular basis. Things like documentation updates, weekly code architecture reviews and cleanup, or other review and validation work that the agent can do and then suggest to you for review. You decide what's worth pulling in.

I could see documentation updates running automatically, especially as a project evolves. And architecture reviews with suggested refactoring? That's interesting. But it requires setting up the right prompts and automations to actually be useful, and I haven't invested that time yet.

<!-- SUGGESTION: This section is a bit thin compared to your voice elsewhere. In the transcript, you show more curiosity—"Some potential automations I could see being useful are..." The draft here is more passive. Could you add a sentence about what would make automations feel worth the setup cost? Right now it reads like "haven't tried it, could be useful, but also could be not." More specificity would help. -->

## The Real Tension: Context Switching Isn't a Terminal Problem

Here's the thing I keep coming back to: consolidating all my projects in one UI doesn't actually solve the hard problem of switching between them.

When I open a new project in the app, the agent loses the context of what I was working on before. I have to re-explain scope, goals, architecture decisions—or I have to maintain that context myself and be very explicit about it in my prompts. The app makes it *physically* easier to switch (I click instead of typing commands), but the cognitive load is still there.

That's not a bug in the app. It's just the reality of agent interaction. The solution isn't a better UI—it's better threading strategy, better project setup, and being disciplined about context.

<!-- TONE: This is the key insight section, and it's excellent. The realization that UI consolidation doesn't solve the fundamental problem—that's mature thinking and distinctly your voice. -->

The app does make that easier by letting me switch between long-running threads in different projects without terminal navigation. That's a genuine win. But it's more subtle than "look, everything in one place now."

## What's Still Uncertain

I'm still early in my evaluation of the app, and I want to be honest about what I haven't explored yet.

I'm planning to test worktrees and cloud features more systematically. I want to actually set up skills for asset generation and see what that workflow looks like. I might experiment with automations for documentation or architecture reviews.

But I'm also skeptical that any of these features will fundamentally change how I work. They might save friction here and there, but they're not going to solve the context-switching problem or change the fact that shipping code fast requires discipline and good threading strategy.

<!-- QUESTION: You mention testing these features "more systematically" and wanting to "actually set up skills." Does this post feel like Part 1 of an ongoing series, or is this a one-off evaluation? The outline flagged this ambiguity. Readers might want to know if/when to expect a follow-up. -->

That's not a knock on Codex—it's just what I've learned from actually using it heavily. The value comes from the agent's capabilities, not from UI consolidation.

## So, Will I Migrate?

I honestly don't know yet. The app is nicer to use. The UI is cleaner. Project organization is better. But these are incremental improvements, not transformative ones.

What I'm going to do is keep testing. I'll report back if I find killer use cases for skills or automations. I'll let you know if worktrees change my mind about branching strategy. And if I discover something that makes the app the obvious choice, I'll write about that too.

<!-- TONE: Good closing. Honest, open, invites reader collaboration. Consistent with your other posts. -->

In the meantime, if you're a heavy Codex user and you've found these features genuinely game-changing, I want to hear about it. Real examples, real workflows. I'm not being coy—I'd love to learn what I'm missing.

---

**Note**: This post was written with assistance from Claude as part of my content pipeline. I provided the raw transcript and thinking; Claude helped structure and draft it based on my voice and style. All opinions and experiences are my own.
