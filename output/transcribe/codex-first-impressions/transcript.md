# Transcript: codex-first-impressions

Generated: 2026-02-06 18:09:41 UTC
Audio files: 8
Model: ElevenLabs Scribe v2

---

## New Recording 4.m4a
In the Codex app, it lets you add projects, and it will even import conversation histories from those, um, projects, so you can review work that has gone on in the past, which is a nice quality of life thing. Um, to accomplish the same scoping that I talked about in the terminal, you do have to import it as a separate project. Um, they show you the parent projects as sort of this gray, um, gray subheading next to the folder. Um, one nice thing is, um, in my terminal, I'd have to double-check which terminal I have open and which folder that terminal was running in. Um, when I wanted to switch between projects, I'd have to either launch up a new terminal and tmux section for that, or, you know, do something, some manual, um, jumping around, which made it harder to jump between projects. But given the context switching required to jump between projects, I don't know that I'm gonna see much benefit from having them all consolidated, other than I don't have to navigate through the folders, um, in the terminal. I'll do that instead through the UI.

## recording-1.m4a
The app provides a automations page where you can install, or no, sorry, skills. A skills page, where you can install skills from a repository. Um, OpenAI has a skills repo that it links to by default, but you can also create new skills with a Codex conversation, or, um, pointing it at a new repository using the skill installer skill.

## recording-2.m4a
Like WorkTree, skills and MCP servers are not something I've been able to get much value out of in my workflows. Um, again, it's another piece of context you have to keep in mind when you're directing the agents, and I haven't found skills necessary, um, to accomplish most of what I've been working on. There are certain things like image generation and audio generation that are in the marketplace, and I'm interested in exploring, especially for things like sprites or, um, app assets or background imagery. Having the ability to generate those assets within Codex seems like a really interesting use case that I just haven't taken the time to set up. So more to come on this in a future post.

## recording-3.m4a
One thing I've seen a lot of people use, and have not used myself much, are worktrees. The app gives you access to local worktrees and cloud for running the Codex commands, conversation, and a hundred percent of my work has been local with the CLI. I'm going to be testing out worktrees and cloud, but I don't think I see the benefit to worktree and cloud. Uh, if you have a good example, feel free to point me to your blog or message me on Blue Sky. Contact me. Link to contact page. I'd love to learn, but, um, my workflow so far has been, I, uh, work on them. A lot of the, uh, best practices for source control have gone out the window, and I just work on main branch most of the time, because the speed at which changes are happening makes it hard to juggle branch worktree context on top of the other project context we're trying to keep in mind as we're developing.

## recording-4.m4a
That said, I do find myself opening up other threads when I wanna do a small change, or I wanna do a, um, code review with a fresh context, one that's not clouded by recent conversation. Or if, for example, in the monorepo, I wanna focus the agent on one subcomponent, I'll change the second or third thread to that directory, launch Codex, and then have it work in that limited scope.

## recording-5.m4a
My current way of organizing agents is to have fairly long-running threads. One would be my main thread, where I'm working on major feature changes and architectural review. I found that the compaction that gets provided is good enough that keeping the conversation running in the long thread reduces the amount of re-explaining and rediscovery the agent has to do, and allows me to keep the thread of what we're working on fairly constrained and consistent.

## recording-6.m4a
I found myself to be a pretty heavy user of the Codex CLI, and I have churned out about fifteen thousand lines of code per week for the past month, working somewhere between three and six days per week. When they announced the release of the Codex app, I was excited to see what improvements a graphical interface could bring to the workflow, and I'm gonna be testing it out today to see what changes are good and what changes are bad, and if I will be migrating here fully or continuing with my current workflow.

## recording.m4a
Automations is another tab provided in the Codex app that I haven't really been using on my personal projects. Some potential automations I could see being useful are documentation updates running on a regular basis, weekly code architecture reviews and cleanup, uh, and other background work where the agent can do some sort of review and validation, and then suggest updates for documentation, test cases, um, refactoring for me to review, and then decide what would be worth it to pull into the project.


