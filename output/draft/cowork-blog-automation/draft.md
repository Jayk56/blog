+++
title = 'Building a Blog Pipeline with Claude Code and Voice Memos'
date = 2026-02-08T02:30:38.640Z
draft = true
tags = ["ai", "claude cowork", "automation", "blogging", "workflow"]
+++

So, I built a pipeline yesterday for my blog and I want to share the process. You might be wondering why I need a pipeline for my blog, wouldn't I just write posts as I have time? The truth is I can come up with topics that I'd like to talk about faster than I can actually sit down to write all of the thoughts that I have down. (OR The truth is I have many ideas for blog posts, but not enough time to run them all down.) For the past year I have been trying to close the loop between having an idea for a topic, building out that idea through experimentation and collecting sources, and then sharing the findings here. This post and the process I'm developing is geared to help decrease the friction in that loop to hopefully close these gaps.

I recently organized my posts by 'inbox', 'next', and 'posted' - here are the counts:
{{< figure src="folders.jpeg" alt="Folders.jpeg" class="mx-auto" >}}
A majority of posts in the inbox have been sitting there for 9+ months. Just waiting to be finalized.

What part parts are high friction currently?
1. Collecting screenshots
2. Conducting experiments based on the idea
3. Pulling graphics from collected raw data
4. Outlining the structure of the post

Most of these can be achieved with some light-automation with agents, so that's what we're going to build!

The Idea: Use Claude Code + Voice Memos as a Pipeline

Instead of fighting the bottle neck of turning my voice memos into useable drafts I decided to do what any software developer would do when faced with a universal problem and build custom software! Joking aside, I had been inspired by some of the stories I had seen with ClawdBot/MoltBot/OpenClaw, but I'm not ready to hook up everything to an agent just yet, so this is an experiment in smaller automations as well as a tool to help me write.

As part of this proceess I tried a few different technologies, most of which I was familiar with, but also hadn't fully explored the limits of (and still haven't).
1. I used Claude cowork for the first time on a real project
2. I have a `claude` agent running when I’m not at the computer via a scheduled job
3. I limited myself to coding with Claude code or Claude Cowork using Opus 4.6 
4. I chose ElevenLabs Scribe V2 Speech-to-Text model for transcription

Eventually, I'd like the agent to do more magic behind the scenes, some ideas I'll be trying are:
1. Collecting screenshots in some cases
2. Autonomously running the experiments through tools like Codex and Claude Code
3. Transcribing voice thoughts into workable text that agents can then expand on and organize\*
4. Leading to a structured outline of the post
5. Identifying key graphics needed for the post outline and then pulling them from the available data

Here is version 1 of the flow I settled on:

```
CAPTURE               TRANSCRIBE              PRE-PROCESS            DRAFT
┌─────────────┐      ┌──────────────┐       ┌────────────────┐    ┌──────────┐
│  Voice      │  →   │  ElevenLabs  │  →    │  Agent: Parse  │ → │  Human   │
│  Memos      │      │  Scribe v2   │       │  + Outline     │   │  Create  │
│  + Links    │      │              │       │                │   │  Draft   │
└─────────────┘      └──────────────┘       └────────────────┘    └──────────┘
   QUEUE                 QUEUE                   QUEUE               QUEUE
audio-notes/            output/               output/             output/
<slug>/                 transcribe/           outline/            draft/
                        <slug>/               <slug>/             <slug>/


REVIEW                 COLLECT                PUBLISH
┌──────────────┐      ┌──────────────┐       ┌─────────────────┐
│  Agent:      │      │  Playwright  │       │  Move to site   │
│  Review &    │  →   │  + oEmbed +  │  →    │                 │
│  Callouts    │      │  Cowork      │       │ content/posts/  │
└──────────────┘      └──────────────┘       │ <slug>/         │
  QUEUE                 QUEUE                 └─────────────────┘
output/              output/
review/              collect/
<slug>/              <slug>/
```

Step 1 - Capture:
I was already capturing ideas and thoughts through voice memo on my phone, but sadly, the built-in transcription feature still struggles with a lot of the software related terms I use. So, I needed to get them to a device that could call a transcription endpoint. Enter iOS shortcuts: a feature I wasn't aware of is you can use the built in share feature to use files/media/text as input for your shortcuts. We use this to save our voice memos to a blog-specific folder in iCloud. The user is prompted for the folder name (in this case it is cowork-blog-automation) and the files are synced over to my macbook. 

This took some tinkering to get right and there are still frictions in using the system. Here are some notes if you want to setup a similar automation:
1. On the target computer you have to mark the folder as 'downloaded all the time' otherwise icloud just keeps a stub
2. If you use text input for the save location you have to remember where you saved the last file which can be difficult if you're working on multiple posts/ideas at once
3. AI can generate step by step instructions for setting this up that are detailed and you can chat with it as you go if you run into any questions

{{< figure src="ios-shortcut.jpeg" alt="ios-shortcut.jpeg" class="mx-auto" >}}

 
Step 2 — Transcribe:
On my macbook I now have a job that runs every 15 minutes and it syncs the audio-notes folder from iCloud to my blog's pipeline folder. It then calls out to Scribe v2 to get a transcript (about 1 cent per memo) and saves that for processing. 

One thing that excites me about this transcription is I expect the cost to continue to drop + accuracy improve so that by this time next year I should be able to transcribe 2 hours of 'thought' per day every day for a whole year and it would only cost ~$20. 

Step 3 — Preprocess:
Next we have another cron job that finds transcripts for specific blog posts and automatically starts preprocessing with the [Claude CLI]() to generate an outline. You've been able to run claude in the background like this for about a year, but this is my first automated use of it. The price per capabilities should again see at least a 10x improvement over the next year so even if we need to switch to an API it should again be cents or fractions of cents per post.

Step 4 — Manual Draft:
This is the part I'm working on now (well, the now when I write this, not the now when I post this, or the now when I review this). Here I sit down with the generated outline and write the first draft of the post. I clarify further what I've learned and what I'd like to say, armed with a structure that was laid out from a series of voice memos. Often this turns into a very different post than the one that I had started with as the process of writing / editing my thoughts forces me to probe my understanding to make sure I communicate clearly what I mean.

Step 5 — Post-processing:
Once I've written the first draft, we pass it off to agents again to review the content for clarity, grammar, and spelling mistakes. Here we're looking for feedback on how well we accomplished the translation from idea -> post and get insights for the next round of editing. To save time we also have the agents attempt to collect screenshots and other artifacts at this point. 

Step 6 — Iteration:
Then we go through the regular edit/review/rewrite process for posts, hopefully this will speed up as I practice more and the initial drafts start closer to final drafts.

For what I described above I worked through [Claude Cowork]() to build the scripts and provide the commands to setup the sync and preprocessing jobs. I'll go into a bit more detail on that process below because it was both magical and frustrating at times.

This post is actually the first test of this process, everything I've talked about was first spoken into a voice memo, copied/transcribed, and then drafted to an outline. Like I mentioned before, I had some friction with the iOS shortcut where I realized we need a better way to select the post folder than a simple text input. I also noticed that when it was time to work on a draft it would be good to have an editor with access to my notes / outline / transcripts, so I had claude code build one (and spent a few hours iterating on that to fix all the bugs/feature requests). That worked really well until I noticed I was taking screenshots and didn't have a quick way to put them into my draft, so we added a feature for that! I started this project Friday afternoon, and by the end of the weekend I have the automation mostly rolling: the automated process of copy the voice memo from my iCloud Drive to my MacBook, transcribe it with ElevenLabs, and then use the Claude CLI to pre-process those notes into an outline. The transcription is correct even with all of my lingo which is a big time save and I don't need to 'do' anything to get from voice memos to outline anymore. Will this actually save me time? I think so, but the answer is going to come in future posts, I'm certainly going to spend *more* time writing, but that's the important part, not putting it off because I know there are a hundred small tasks that stand between idea -> post.

Now for some observations on Claude Cowork:
As a tool, Anthropic describes cowork as: #pull a blurb from docs https://claude.com/blog/cowork-research-preview?open_in_browser=1

In the interface you are given a list of chats on the left, the main conversation in the center, and on the right you have the task list + working files + context. By default, the cowork agent has access to the folder you select along with some MCP connectors and the ability to search the web. It's not able to send data out except to a whitelist as it runs inside of a local VM which means it's not able to run scripts that depend on API access. They have built plugins and skills which are available for knowledge work and it seems to be fairly competent in editing Word / Excel / PowerPoint files in the same way Claude can. The framing they give is each conversation is a 'Task', which is a suggestion more than a rule, but the further you drift from this the more friction you'll start to notice. 

The good, I really enjoyed kicking off the project in the cowork tab and I think the fact it is able to work inside existing folders and still use most of the tools available to claude is useful. I also appreciate the security defaults preventing unwanted egress and limiting the blast radius if something goes wrong. There's a lot of potential for the claude desktop app to become *the* entry point for computer use, but I think there are some pieces missing.

The first point of friction that I noticed was there's no folder structure in the working files list, i.e. there's no grouping and no hierarchy to quickly understand which file is which if they have similar or the same name. Folders tend to help us reduce cognitive load since properly structured folders allow you to think a lot less about relationships. This is where I think keeping a conversation at the task level would give you some benefits. Limiting the files you're working on/with helps give you that same cognitive boost. I would have liked a similar interface but with the project level abstractions necessary to keep one conversation through idea -> implementation -> validation. Another interesting friction I noticed is that you can't manually edit files in Cowork, just view them. This had the effect of forcing me out of Cowork to write my draft blog posts and to edit files by hand. This is where I had the idea to have Claude Code build me an editor which it did (see below). Here again I found myself hitting some friction, I had the editor project started in Cowork and I wanted to use full Claude Code to work on implementing features and fixing bugs, but there is no 'transfer' to Claude Code option for conversations. Here again I had to have it create project docs in the file system and then load those into claude code when I launched a new session there. 

{{< figure src="image.png" alt="image.png" class="mx-auto" >}}


I think in the future we'll likely see a 'Project' tab that extends the project functionality that Anthropic has and extends it with agents the same way they are doing with Code and Cowork, but for now that's still something we get to do manually.

Unless... \[to be continued\]