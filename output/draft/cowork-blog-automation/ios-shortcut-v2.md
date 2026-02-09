# Voice Memo to Blog — iOS Shortcut v2 (Folder Picker)

Replaces the text-input version. Instead of typing the folder name from memory, you pick from existing folders or create a new one.

## Prerequisites

- iCloud Drive enabled
- A root folder for your blog audio notes (e.g., `iCloud Drive/audio-notes/`)
- The shortcut set up to receive **audio files** from the Share Sheet

## Shortcut Actions (step by step)

### 1. Receive Input
- **Action:** `Receive [Any] input from [Share Sheet]`
- This captures the voice memo file when you tap Share → your shortcut.

### 2. Get existing blog folders
- **Action:** `Get Contents of Folder`
  - Folder: `/audio-notes/` (your iCloud Drive blog folder)
  - Toggle ON: **Only get folders** (not files)
- This returns a list of your existing blog topic folders.

### 3. Build the picker list
- **Action:** `Text` → type `+ Create New Folder`
- **Action:** `Add to Variable`
  - Variable name: `pickerList`
  - Value: the Text from above (`+ Create New Folder`)
- **Action:** `Add to Variable`
  - Variable name: `pickerList`
  - Value: output of step 2 (the folder contents)
- Adding to the same variable twice builds the list in order: "Create New" first, then all existing folders.

### 4. Show the picker
- **Action:** `Choose from List`
  - List: `pickerList`
  - Prompt: `Save voice memo to:`
- The user taps the folder they want, or taps "+ Create New Folder"

### 5. Handle "Create New Folder"
- **Action:** `If` → Chosen Item `equals` `+ Create New Folder`
  - **Action:** `Ask for Input`
    - Input type: Text
    - Prompt: `New folder name (use-dashes-like-this):`
  - **Action:** `Create Folder`
    - Path: `/audio-notes/[Ask for Input result]`
  - **Action:** `Set Variable`
    - Variable name: `targetFolder`
    - Value: the newly created folder
- **Otherwise** (existing folder selected):
  - **Action:** `Set Variable`
    - Variable name: `targetFolder`
    - Value: Chosen Item from step 4

### 6. Save the voice memo
- **Action:** `Save File`
  - File: Shortcut Input (the voice memo from step 1)
  - Destination: `targetFolder`
  - Ask Where to Save: OFF (we already chose)

### 7. Confirmation
- **Action:** `Show Notification`
  - Title: `Saved!`
  - Body: `Voice memo saved to [targetFolder name]`

## Notes

- The folder list is sorted alphabetically by default. If you want most-recent-first, you'd need to sort by date modified before building the picker — iOS Shortcuts supports this via the "Sort" filter on the Get Contents action.
- If you have a lot of folders, "Choose from List" handles scrolling natively.
- The `+ Create New Folder` option appears first because we add it to the variable before the folder contents.
- You could add a "Recent" section by saving the last-used folder name to a Shortcuts file/Data Jar and showing it as a second quick-pick option.
