# Discord Emoji & Sticker Downloader - DiscordKit

A high-performance, local-first browser extension (Manifest V3) that allows you to easily preview, select, and bulk-download custom emojis and stickers from any Discord server into a neatly organized `.zip` file.

Reverse-engineered from the popular **Discord Emoji Downloader - DiscordKit** extension, built to be 100% self-contained, lightning-fast, and completely privacy-respecting (zero external tracking or third-party servers).

---

## ✨ Features

- **🚀 Dual Mode UI**:
  - **In-Page Floating Button (`📥 Emojis`)**: Floats neatly inside the Discord Web interface. Click to open a full modal viewer without ever leaving your chat.
  - **Toolbar Popup**: Quick-access popup window accessible right from your browser toolbar.
- **⚡ Automatic Server & Asset Detection**:
  - Automatically identifies the active server you are currently browsing.
  - Dropdown selector lets you switch between all servers you belong to on the fly.
- **🖼️ Full Emoji & Sticker Support**:
  - **Static Emojis**: Saved as high-resolution transparent `.png` files.
  - **Animated Emojis**: Preserves original animated frames as `.gif`.
  - **Stickers**: Supports PNG, APNG, animated GIF, and Lottie JSON (`.json`) stickers.
- **📦 Smart ZIP Packaging**:
  - Generates standard PKZip archives instantly in-browser using a zero-dependency streaming engine.
  - **Folder Organization Option**: Neatly separates assets into `emojis/static/`, `emojis/animated/`, and `stickers/`.
- **🔍 Real-Time Filter & Search**:
  - Instant fuzzy search by emoji/sticker name.
  - Filter tabs: **All**, **Static (PNG)**, **GIF (Animated)**, **Stickers**.
- **🎯 Selection Controls**:
  - One-click **Select All** / **Deselect All**.
  - Click any card or checkbox to toggle selection.
  - Download individual emojis with a single click (`⬇` on hover).
- **🎛️ Resolution / Quality Selector**:
  - Choose between Ultra (512px), High / Lossless (256px), Standard (128px), or Compact (64px).
- **📊 Real-Time Progress Bar**:
  - Shows live parallel download progress, current item being fetched, and percentage.
- **🔒 Privacy First & 100% Local**:
  - Runs directly within your browser session.
  - Does not send your token, messages, or metadata to any external server.

---

## 🛠️ Architecture & Reverse Engineering Details

How does the extension communicate with Discord Web?

1. **Discord Flux Store Extraction (`webpackChunkdiscord_app`)**:
   - Injected into the page world (`MAIN` world) to hook into Discord's internal Webpack module cache.
   - Extracts loaded stores: `GuildStore`, `GuildEmojiStore`, `EmojiStore`, `StickerStore`, and `SelectedGuildStore`.
   - Allows instant loading of emojis and stickers directly from browser memory with **0 API calls and 0 rate-limiting risk**.
2. **Passive Token Interception (Fallback)**:
   - Transparently captures Discord's internal API authorization header (`window.fetch` / `XMLHttpRequest`) to query `/api/v9/guilds/{id}/emojis` and `/api/v9/guilds/{id}/stickers` if stores have not yet cached a server's assets.
3. **Pure-JS In-Browser ZIP Generator (`MiniZip`)**:
   - Zero external libraries or heavy dependencies.
   - Implements binary PKZip 2.0 specifications with standard CRC-32 checksums and UTF-8 filename encoding.
   - 100% compatible with Windows Explorer, macOS Archive Utility, 7-Zip, WinRAR, and Linux `unzip`.

---

## 📥 Installation Guide

This extension can be loaded into any Chromium-based browser (**Google Chrome**, **Microsoft Edge**, **Brave**, **Opera**, **Arc**, **Vivaldi**) and **Mozilla Firefox**.

### For Chrome, Edge, Brave, & Chromium Browsers:
1. Open your browser and navigate to the Extensions management page:
   - Chrome / Brave: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable **Developer Mode** using the toggle switch (usually located in the top-right or top-left corner).
3. Click the **"Load unpacked"** button.
4. Select the project directory:
   ```
   C:\Users\hrish\Hrishabh\_myprojects\Extension\Discord Emoji Copy Extension
   ```
5. The extension will appear in your list of extensions with the Discord blurple icon!

### For Mozilla Firefox:
1. Navigate to `about:debugging#/runtime/this-firefox`.
2. Click **"Load Temporary Add-on..."**.
3. Select the `manifest.json` file inside this directory.

---

## 🎮 How to Use

1. Open Discord in your web browser: **[discord.com/app](https://discord.com/app)** (or Canary/PTB).
2. Navigate to any server whose emojis you want to download.
3. Choose either method:
   - **Method A (In-Page)**: Click the floating **`📥 Emojis`** button in the bottom right corner of Discord.
   - **Method B (Toolbar)**: Click the extension icon in your browser toolbar.
4. Preview the emojis/stickers, filter by static or animated, or search by name.
5. Click **"Download All"** or select specific emojis and click **"Download Selected"**.
6. A `.zip` file named `{Server_Name}_emojis.zip` will be saved directly to your Downloads folder!

---

## 📂 Project Structure

```
Discord Emoji Copy Extension/
├── manifest.json              # Manifest V3 configuration
├── README.md                  # Documentation & usage guide
├── icons/                     # Extension branding icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── utils/
│   ├── zip.js                 # Zero-dependency PKZip 2.0 generator with CRC32
│   └── discord-api.js         # Discord CDN URL formatters & batch download pool
├── content/
│   ├── injected.js            # Page-world script hooking Discord Webpack & Flux stores
│   ├── content.js             # Content script managing in-page UI & message bridging
│   └── overlay.css            # Discord-native dark theme styles for the in-page modal
├── popup/
│   ├── popup.html             # Extension toolbar popup layout
│   ├── popup.css              # Discord-themed popup styling
│   └── popup.js               # Popup state management, filter logic & download triggers
└── background/
    └── background.js          # Service worker for extension lifecycle & downloads
```

---

## ⚖️ Disclaimer
This extension is created for personal archiving and backup of custom emojis and stickers. It is not officially affiliated with or endorsed by Discord Inc.
