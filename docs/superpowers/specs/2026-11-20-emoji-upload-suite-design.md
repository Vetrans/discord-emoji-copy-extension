# Design Spec: Emoji & Sticker Upload & Server Clone Suite

## 1. Intent & Purpose
Empower users to not only download Discord emojis and stickers, but also upload custom emojis directly to their Discord servers in two seamless ways:
1. **1-Click Server Clone ("Emoji Stealer / Copy")**: Instantly copy selected emojis from any server they are currently viewing to another server they manage, with zero file management.
2. **Local File & ZIP Upload**: Drag-and-drop or select local images (`PNG`, `GIF`, `JPEG`, `WEBP`) or a `.zip` archive, preview them, auto-format names, and bulk upload them into any managed server.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **1-Click Clone**: Select items in the modal/popup, click "Copy to Server", pick target server, and watch real-time upload progress.
- **Local File & ZIP Upload**: Drag & drop image files or ZIP archive, auto-derive valid Discord emoji names (`:name:` between 2-32 alphanumeric/underscore characters), preview thumbnails, and batch upload.
- **Permission Awareness**: Detect and indicate which servers the user has permission to upload emojis to (servers where user is owner, has Administrator, or Manage Expressions permission), while handling 403 gracefully.
- **Discord API Compliance**:
  - Convert images to `data:image/<type>;base64,<data>` for emoji creation.
  - Comply with Discord 256 KB emoji file size limits with client-side canvas/image resizing or compression warning.
  - Safe rate-limiting queue (interval throttling + HTTP 429 `retry_after` handling) to prevent Discord account API locks.
- **Multi-Context Availability**: Works in both the In-Page Overlay Modal and the Extension Popup.

### Non-Goals
- Bypassing Discord server permissions (cannot upload to servers where user lacks Manage Expressions permission).
- Bypassing Discord guild emoji slot limits (free servers max 50 static / 50 animated; boosted servers up to 250). Clear error message displayed if slots are full.

### Anti-Goals
- Aggressive unthrottled API spamming that risks Discord account suspension or triggers Cloudflare bot challenges.
- Cluttering the clean download UI; uploading should be accessible via an "Upload" tab and a "Copy to Server" action without complicating the download workflow.

---

## 3. Approaches Considered

### Approach A: Local File & ZIP Upload Only
- **Pros**: Independent of other servers; simple file-picker workflow.
- **Cons**: Requires user to download emojis to disk first before re-uploading them to their server. Adds extra manual steps.

### Approach B: Server-to-Server Clone Only
- **Pros**: Zero friction for copying existing emojis between servers.
- **Cons**: Cannot upload new custom art, downloaded packs, or personal meme folders from computer.

### Approach C: The Complete Suite (Chosen)
- **Pros**: Best-in-class UX. Covers both copying emojis directly between servers AND uploading local collections / ZIP packs from disk.
- **Trade-off**: Requires building both a Clone Action Modal and an Upload / Queue view. Clean tabbed design makes this seamless.

---

## 4. Architectural Design

```
+---------------------------------------------------------------------------------+
|                                User Interface                                   |
|  [ Download Tab ]          [ Upload Tab ]          [ "Copy to Server" Button ]  |
+---------------------------------------------------------------------------------+
                                      |
                                      v
+---------------------------------------------------------------------------------+
|                              Upload Controller                                  |
|  - File Parser (Images / ZIP extraction)                                        |
|  - Name Normalizer (sanitize into 2-32 chars / alphanumeric / underscores)      |
|  - Image Processor (Base64 data URI encoder + Canvas 256KB resizing)            |
|  - Rate-Limited Queue Dispatcher (sequential upload with 800ms safety interval) |
+---------------------------------------------------------------------------------+
                                      |
                                      v
+---------------------------------------------------------------------------------+
|                        Discord API Client (injected.js)                         |
|  - POST /api/v9/guilds/{targetGuildId}/emojis                                  |
|  - Headers: { "Authorization": userToken, "Content-Type": "application/json" }  |
|  - Automatic 429 Backoff & Error Reporting                                      |
+---------------------------------------------------------------------------------+
```

### Discord API Contract
- **Endpoint**: `POST /api/v9/guilds/{guildId}/emojis`
- **Headers**:
  - `Authorization: <user_token>`
  - `Content-Type: application/json`
- **Body**:
  ```json
  {
    "name": "pepe_hype",
    "image": "data:image/png;base64,iVBORw0KGgo...",
    "roles": []
  }
  ```
- **Error Handling**:
  - `400 Bad Request`: Invalid name or file too large (>256KB).
  - `403 Forbidden`: User lacks "Manage Expressions" permission.
  - `429 Too Many Requests`: Extract `retry_after` and delay next request.
  - `50035 / Maximum Emojis Reached`: Notify user that guild emoji slots are full.

---

## 5. UI / UX Design

### A. Modal Layout (In-Page Overlay)
- **Top Bar Tabs**:
  - `📥 Browse & Download` (Current viewer)
  - `📤 Upload New Emojis` (New upload view)
- **Browse & Download Tab Enhancements**:
  - Next to "Download Selected", add a secondary action: **"Copy to Server..."**
  - Clicking opens a server selector modal → confirm → uploads selected emojis directly to that server with live progress.
- **Upload New Emojis Tab**:
  - Drag-and-drop dropzone supporting multiple image files (`.png`, `.gif`, `.jpg`, `.webp`) or a `.zip` archive.
  - Queue grid previewing each image, thumbnail, detected format (PNG/GIF), and an editable name input.
  - Destination Server dropdown (auto-filtered/marked with writable servers).
  - "Upload (N) Emojis" button with animated progress bar and detailed completion report (X succeeded, Y failed with reason).

---

## 6. Security & Safety
- **Throttling**: 800ms minimum delay between sequential uploads to respect Discord's rate limiter.
- **Authentication**: Uses the passive token already detected in `injected.js`.
- **Validation**: Enforces name regex `^[a-zA-Z0-9_]{2,32}$` before dispatching.
