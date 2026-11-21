/**
 * Discord Emoji Downloader - Service Worker (Background Script)
 * Manages extension lifecycle, in-tab script injection on reload,
 * and file downloads via chrome.downloads API.
 */

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Discord Emoji Downloader] Installed/Updated:', details.reason);

  // Automatically inject content scripts into already-opened Discord tabs
  try {
    const tabs = await chrome.tabs.query({
      url: [
        'https://discord.com/*',
        'https://canary.discord.com/*',
        'https://ptb.discord.com/*'
      ]
    });

    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/injected.js'],
          world: 'MAIN'
        });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['utils/zip.js', 'utils/discord-api.js', 'content/content.js']
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content/overlay.css']
        });
      } catch (err) {
        // Tab might be restricted or unloaded
        console.warn(`[Discord Emoji Downloader] Could not auto-inject tab ${tab.id}:`, err.message);
      }
    }
  } catch (err) {
    console.warn('[Discord Emoji Downloader] Error querying Discord tabs on install:', err);
  }
});

// Listener for background actions
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'TRIGGER_DOWNLOAD') {
    const { url, filename } = message;
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId });
        }
      }
    );
    return true; // Keep channel open
  }
});
