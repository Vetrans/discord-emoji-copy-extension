# Emoji & Sticker Upload & Server Clone Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a comprehensive emoji upload system allowing users to upload local image files & ZIP archives directly to Discord servers they manage, and to 1-click clone ("copy") emojis directly between Discord servers.

**Architecture:** 
1. `utils/discord-api.js` provides image preprocessing, Base64 data URI conversion, name sanitization, and ZIP file extraction.
2. `content/injected.js` dispatches authenticated `POST /api/v9/guilds/{guildId}/emojis` requests inside Discord's main world with rate-limiting backoff.
3. `content/content.js` & `content/overlay.css` provide the UI: a "Copy to Server..." modal dialog in the Browse view, plus an "Upload Emojis" drag-and-drop workbench with editable queue and batch dispatch.
4. `popup/popup.html` and `popup/popup.js` integrate the new upload and copy actions.

**Tech Stack:** Vanilla JavaScript (ES6+), Chrome Extension Manifest V3, Discord v9 REST API, HTML5 Canvas API, Web PKZip binary manipulation.

**Spec:** `docs/superpowers/specs/2026-11-20-emoji-upload-suite-design.md`

## Global Constraints
- Discord emoji naming: `^[a-zA-Z0-9_]{2,32}$`. Any invalid character replaced with `_`, trimmed to 32 characters, padded if under 2 characters.
- Discord emoji image payload format: `data:image/<type>;base64,<base64_data>`.
- Discord emoji file size limit: maximum 256 KB (262,144 bytes).
- Throttling: Minimum 800ms safety interval between sequential emoji upload requests to respect Discord rate limits.
- Bounded concurrency: strictly sequential queue for uploads to the same guild to prevent triggering HTTP 429 rate limit freezes.

## Review Focus
1. Invalid file types dropped into uploader (e.g., .txt, .pdf, corrupt images) -> Filtered out gracefully with warning message.
2. Emoji name collision or naming violation (e.g. spaces, emojis, special characters) -> Sanitized automatically into clean `a-z0-9_` format.
3. File over 256 KB -> Flagged with visual warning indicator and resized using HTML5 Canvas if static PNG/JPEG.
4. HTTP 429 Rate Limit returned by Discord -> Parser reads `retry_after`, pauses queue, and resumes automatically without dropping items.
5. HTTP 403 Forbidden (Missing Permissions) or Guild Emoji Slots Full -> Halts queue immediately with plain human-readable explanation instead of raw error codes.

---

### Task 1: Upload Utilities & Image Processing (`utils/discord-api.js`)

**Files:**
- Modify: `utils/discord-api.js`
- Test: `tests/test-upload-utils.js`

- [x] **Step 1: Write failing unit test for emoji name sanitization and data URI encoding**
  Create `tests/test-upload-utils.js` testing `sanitizeEmojiName()`, `fileToDataUri()`, and name boundary cases (under 2 chars, over 32 chars, special characters, spaces).
- [x] **Step 2: Run test to verify it fails**
  Run `node tests/test-upload-utils.js` and confirm failure.
- [x] **Step 3: Implement upload utilities in `utils/discord-api.js`**
  - Implement `DiscordApi.sanitizeEmojiName(name)`: cleans names to `[a-zA-Z0-9_]`, length 2-32.
  - Implement `DiscordApi.binaryToDataUri(uint8Array, mimeType)`.
  - Implement `DiscordApi.canvasResizeImage(dataUri, maxBytes)`.
  - Implement `DiscordApi.extractZipImages(uint8Array)`: reads files from ZIP bytes and returns array of `{ name, data, mimeType }`.
- [x] **Step 4: Run test to verify it passes**
  Run `node tests/test-upload-utils.js` and verify all tests pass.

---

### Task 2: Page-World Discord Upload API in `content/injected.js`

**Files:**
- Modify: `content/injected.js`

- [x] **Step 1: Implement `uploadGuildEmoji` function in `injected.js`**
  - Add API caller for `POST /api/v9/guilds/{guildId}/emojis` sending `{ name, image: dataUri, roles: [] }`.
  - Parse responses: 201 Created (success), 429 Too Many Requests (read `retry_after`), 403 Missing Permissions, 400 Bad Request.
- [x] **Step 2: Implement `getManageableGuilds` in `injected.js`**
  - Iterate `GuildStore.getGuilds()` to identify servers where the user has permission to manage emojis (`permissions & 0x40000000` or `permissions & 0x8` or `ownerId === currentUserId`).
- [x] **Step 3: Register message actions for Content Script**
  - Add `UPLOAD_EMOJI` and `GET_MANAGEABLE_GUILDS` handlers to the `DISCORD_EMOJI_DOWNLOADER_REQUEST` listener in `injected.js`.
- [x] **Step 4: Verify syntax and message handling**
  Run `node -c content/injected.js` to ensure clean syntax.

---

### Task 3: 1-Click Server Clone ("Copy to Server") UI & Flow

**Files:**
- Modify: `content/content.js`
- Modify: `content/overlay.css`

- [x] **Step 1: Add "Copy to Server..." button to the Browse footer**
  Add a `"Copy to Server..."` secondary action button next to *"Download Selected"* in `renderModalContent()`.
- [x] **Step 2: Create Server Selection Modal Dialog**
  - When "Copy to Server..." is clicked, open a server selection prompt showing the user's available servers.
  - Provide confirmation with count of emojis to copy (e.g. "Copy 8 emojis to [Target Server]?").
- [x] **Step 3: Implement sequential upload queue runner**
  - For each selected emoji: download binary via `DiscordApi.fetchBinary`, convert to data URI via `DiscordApi.binaryToDataUri`, and send `UPLOAD_EMOJI` request to `injected.js`.
  - Enforce 800ms delay between items, or `retry_after` delay if 429 occurs.
  - Update progress banner: *"Copying 3/8: :pepe_hype:... (37%)"*.
- [x] **Step 4: Handle completion and failure reporting**
  Display summary notification showing successful and failed uploads.

---

### Task 4: Local File & ZIP Upload Tab in Overlay

**Files:**
- Modify: `content/content.js`
- Modify: `content/overlay.css`

- [x] **Step 1: Add view navigation tabs in `content/content.js`**
  Add header tabs: `Browse & Download` and `Upload Emojis`.
- [x] **Step 2: Build drag-and-drop dropzone & file picker**
  - Accept `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, and `.zip` files.
  - Handle drop events and manual file selection.
  - If `.zip` is uploaded, extract all images using `DiscordApi.extractZipImages`.
- [x] **Step 3: Build upload queue grid with live edit controls**
  - Each item shows: thumbnail, format badge (PNG/GIF), file size indicator (green if <256KB, orange/red if >256KB), editable emoji name input (`:name:`), and a delete item button.
  - Add "Clear All" and "Add More Files" buttons.
- [x] **Step 4: Implement destination server selector & Upload All action**
  - Dropdown to select destination server.
  - "Upload All (N)" button running the throttled upload queue with progress bar.

---

### Task 5: Extension Popup Integration

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.js`
- Modify: `popup/popup.css`

- [x] **Step 1: Add "Copy to Server" button to popup footer**
  Add "Copy to Server" button next to "Download Selected" in `popup/popup.html`.
- [x] **Step 2: Implement clone handler in `popup/popup.js`**
  Send clone request to active tab content script with selected item keys and target guild ID.
- [x] **Step 3: Style the new button in `popup/popup.css`**
  Ensure cohesive button styling matching Discord Dark theme.

---

### Task 6: End-to-End Verification

**Files:**
- Run test suite: `tests/test-upload-utils.js`
- Syntax check all workspace scripts: `node -c ...`

- [x] **Step 1: Run automated tests**
  Verify all unit tests pass with `node tests/test-upload-utils.js`.
- [x] **Step 2: Syntax check all files**
  Verify all JS files pass `node -c`.
- [x] **Step 3: Prepare user instructions**
  Document the new feature with screenshots and usage steps.
