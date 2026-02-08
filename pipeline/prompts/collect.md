# Blog Pipeline: Collect Agent

## Purpose
Complete the collection of screenshots, embeds, and media that the headless collector couldn't handle automatically. This runs as an interactive Cowork session where you have browser tools, code execution, and Jay's guidance.

## When to Use
Run this prompt when `assets.json` has failures — items that need login, interaction, judgment, or code execution to collect.

## Input
You will receive:
- **assets.json**: Manifest from the headless `collect.sh` run showing what succeeded and what failed
- **review.md** or **draft.md**: The post content with `[SCREENSHOT]`, `[EMBED]`, and `[CODE]` markers
- **callouts.md** (if available): Review-stage callouts with context about what's needed

## Output
- Additional assets saved to `output/collect/<slug>/assets/`
- Updated `assets.json` with new entries for collected items
- Summary of what was collected vs. what still needs Jay's manual attention

## Workflow

### Step 1: Read the Failures
Load `output/collect/<slug>/assets.json` and identify what needs interactive collection:
- **Auth required**: Sites that need login (use Claude in Chrome)
- **Complex UI**: Pages that need scrolling, clicking, or interaction before screenshot
- **Code execution**: CLI commands or scripts to run and capture output
- **Manual only**: Items only Jay can provide (personal screenshots, specific device states)

### Step 2: Collect Screenshots (Browser)
For each failed screenshot that has a URL:

1. Navigate to the URL using Claude in Chrome
2. If login is required, ask Jay to authenticate — then take the screenshot
3. For complex pages, scroll to the right section, expand content, dismiss popups
4. Capture the screenshot and save to `output/collect/<slug>/assets/screenshot-N.png`
5. Name the file to match the ID in assets.json (e.g., `screenshot-3.png` for the 3rd screenshot marker)

**Screenshot quality tips:**
- Use 1280x720 viewport for consistency
- Dismiss cookie banners and popups before capturing
- Crop to the relevant content area when possible
- If the page is very long, capture just the relevant section

### Step 3: Collect Embeds
For embed markers where oEmbed failed:

1. Navigate to the URL
2. Look for an embed/share button on the page
3. Copy the embed HTML
4. Save to `output/collect/<slug>/assets/embed-N.json` as:
   ```json
   {
     "platform": "manual",
     "url": "https://...",
     "html": "<blockquote>...</blockquote><script>...</script>"
   }
   ```

### Step 4: Run Code Blocks
For `[CODE: ...]` markers:

1. Read the command or code snippet from the marker
2. Ask Jay if it's safe and appropriate to run
3. Execute the command and capture:
   - stdout/stderr text
   - A screenshot of the terminal output (if visual)
4. Save results to `output/collect/<slug>/assets/code-N.json`:
   ```json
   {
     "command": "codex --help",
     "stdout": "...",
     "stderr": "",
     "exit_code": 0,
     "screenshot": "assets/code-N.png"
   }
   ```

### Step 5: Update assets.json
After collecting, update `output/collect/<slug>/assets.json`:
- Add new entries to the `assets` array for successfully collected items
- Move resolved failures out of the `failures` array
- Add any items that still can't be collected to failures with clear notes for Jay

### Step 6: Report
Summarize:
- What was collected in this session
- What still needs Jay's manual attention (and why)
- Any issues or concerns about the collected assets

## Important Notes

- **Don't force it**: If something truly needs Jay's personal screenshot (e.g., their specific terminal setup), mark it as manual and move on
- **Ask before executing code**: Always confirm with Jay before running any commands
- **Match IDs**: Use the same numbering scheme as the headless collector (screenshot-1, embed-2, etc.)
- **Quality over speed**: Take clean, well-framed screenshots rather than rushing through
- **Save incrementally**: Update assets.json after each successful collection, not just at the end

## Asset Naming Convention
```
output/collect/<slug>/
├── assets.json          # Manifest
├── collect.log          # Collection log
└── assets/
    ├── screenshot-1.png # Matches [SCREENSHOT: ...] marker #1
    ├── screenshot-2.png # Matches [SCREENSHOT: ...] marker #2
    ├── embed-1.json     # Matches [EMBED: ...] marker #1
    ├── code-1.json      # Matches [CODE: ...] marker #1
    └── code-1.png       # Terminal screenshot for code block #1
```
