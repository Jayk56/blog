+++
title = "o4-mini and Gemini 2.5 Pro Saturate Aider's Polyglot Benchmark"
publishDate = 2025-05-10T02:00:00Z
date = 2025-05-10T02:00:00Z
draft = false
summary = "Aider's programming benchmark is saturated again - now what?"
+++

---

<blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:pp6c3h3op3dtud7qsm4ef6lc/app.bsky.feed.post/3lof3kzsmak2g" data-bluesky-cid="bafyreiakxeg262dufo3yr2v4tkdilcrmt7mblsmeg6ymel3jc4kpjqx3oa" data-bluesky-embed-color-mode="system"><p lang="en">what does it mean when a model can score 95%+ on  aider&#x27;s polyglot benchmark? how does it change what you can do with it vs the 70% gemini pro is at now?</p>&mdash; jayk56.bsky.social (<a href="https://bsky.app/profile/did:plc:pp6c3h3op3dtud7qsm4ef6lc?ref_src=embed">@jayk56.bsky.social</a>) <a href="https://bsky.app/profile/did:plc:pp6c3h3op3dtud7qsm4ef6lc/post/3lof3kzsmak2g?ref_src=embed">May 4, 2025 at 5:14 PM</a></blockquote><script async src="https://embed.bsky.app/static/embed.js" charset="utf-8"></script>

This question has been hounding me this week...by my estimates the saturtion of the latest programming benchmarks were coming a soon as the end of the year, but I stumbled onto something that makes me think we may already be there.

First, an important note on benchmarks: 
{{< alert "note" >}}
It's just as important to know HOW they produce the results as it is important to know WHAT they are testing. 
{{</ alert >}}

This is a lesson I had to re-learn this week when I attempted to replicate the Aider benchmarks. I was excited to try it with the incredibly cheap Gemini Pro Here are the current top results for the Aider leaderboard:

[[ image of top models on leaderboard ]] aider-leaderboard-may-8-2025.jpg

You see the report of scores between 70% and 80% for the top models and may think:
- The mini does pretty good for it's price!
- o3 is way too expensive!
- When you run the models against the 225 practice problems, they'll get x% of them right on the *first try*

This was my thinking at least, but that's not quite what the leaderboard is showing. Here is the chart showing what was just described (based on the data on the site):

[[ image of top models edited to show the pass rate 1 number ]]
(a fun aside is that when you show the pass at one like this, the cost matches the % correct pretty well)

The original graph is showing the pass rate at 2 attempts, where the models have a chance to correct any mistakes after their first attempt at passing the unit tests. They are given information about what tests failed and what the error logs where and asked to resolve the remaining issues. If they fail on this second pass the benchmark counts that as a failure. Fair enough, with this new knowledge though, you may also notice a sharp rise in performance when you go from 1 try to 2 and wonder:

{{< alert "note" >}}
Does the same pattern repeat when you go from 2 tries up to say, 4? 8? 16?
{{</ alert >}}

[[ image of chart showing dotted line ]]

[[ image of gemini going up to 8 tries ]]

Almost..it follows a sub-linear power of x scaling which is pretty common in the recent 'test-time compute' research where scaling the amount of tokens/thinking time/iterations provide large gains, but require exponentially more to get the last few % of possible improvement.

While the models don't quite get perfect scores, it does seem like this benchmark might be **effectively** saturated. (or may still have a ways to go, depending on what x you pick)

Which brings us back to the question of, "So what changes now that aider can get 95%?". Over the past month since these models were released, I've noticed that I can hand off more and more tasks to Github's CoPilot, and things just work! Whereas, before I had to wrangle context, specify the details of the change in detail and ensure to clean up any out of place code to avoid bad context tripping them up. Now, I can say 'The exclamation icon on the left side seems a little off, can you improve the style of the alerts blocks?' and 95% of the time can get what I want on the 2nd or 3rd try. 

Claims of software development agents coming in the second half of 2025 sound more reasonable to me today than they did a month ago. If the major labs can crack 2 or 3 more roadblocks I have no problems imagining a world where for $2-4k a month / agent you could have 1) a coder agent going to work on tasks for you with increasing prescision, 2) a project management agent digesting user requirements, helping create, plan, and track software iterations, 3) and a small team that keeps the agents on the rails and aligned with the business. I don't see the future where we don't have any work, at least not in the next 24 months, but I am excited to see what new software gets built now that it 'can'.

footnote: I got a bunch of interesting data from this experiment that I'm still sifting through. If you're interested in following along, you can subscribe to my RSS feed here: [link to rss feed], or follow me on bluesky where I'll be posting some more graphics and links. If you're interested in working on similar experiments but aren't sure where to start, get in touch! I have more ideas than time and would love to talk through the details with others that are interested.
