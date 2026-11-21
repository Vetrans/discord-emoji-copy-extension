/**
 * Discord Emoji Downloader & Uploader - Content Script
 * Manages in-page UI injection, communication with page world (injected.js),
 * and handles downloads, 1-click server cloning, and local file/ZIP uploads.
 */

(() => {
  // Prevent duplicate execution
  if (window.__DISCORD_EMOJI_DOWNLOADER_CS__) return;
  window.__DISCORD_EMOJI_DOWNLOADER_CS__ = true;

  // In-memory state
  const state = {
    currentView: 'browse', // 'browse' | 'upload'
    guilds: [],
    currentGuildId: null,
    uploadTargetGuildId: null,
    emojis: [],
    stickers: [],
    hasToken: false,
    selectedItems: new Set(),
    activeTab: 'all', // 'all', 'static', 'animated', 'stickers'
    searchQuery: '',
    organizeFolders: true,
    isDownloading: false,
    isUploading: false,
    isLoading: false,
    connectionError: false,
    modalOpen: false,
    uploadQueue: [] // { id, name, ext, size, mimeType, dataUri, status, error }
  };

  // Extract Guild ID from URL if on Discord channels page
  function getUrlGuildId() {
    const match = window.location.pathname.match(/\/channels\/(\d{16,21})/);
    if (match && match[1]) return match[1];
    const fallback = window.location.pathname.match(/\/channels\/(\d+)/);
    if (fallback && fallback[1]) return fallback[1];
    return null;
  }

  // Promise registry for page-world requests
  const pendingRequests = new Map();

  function sendPageRequest(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const requestId = 'req_' + Math.random().toString(36).substring(2, 9);
      const timer = setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
          reject(new Error(`Request ${action} timed out after 8s`));
        }
      }, 8000);

      pendingRequests.set(requestId, { resolve, reject, timer });
      window.postMessage({
        type: 'DISCORD_EMOJI_DOWNLOADER_REQUEST',
        requestId,
        action,
        ...payload
      }, '*');
    });
  }

  // Listen for responses from injected.js
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data) return;

    if (data.type === 'DISCORD_EMOJI_DOWNLOADER_READY') {
      state.connectionError = false;
      return;
    }

    if (data.type === 'DISCORD_EMOJI_DOWNLOADER_RESPONSE') {
      if (data.action === 'TOKEN_DETECTED') {
        state.hasToken = true;
        return;
      }

      const { requestId, success, error } = data;
      if (requestId && pendingRequests.has(requestId)) {
        const { resolve, reject, timer } = pendingRequests.get(requestId);
        clearTimeout(timer);
        pendingRequests.delete(requestId);
        if (success) {
          resolve(data);
        } else {
          reject(new Error(error || 'Page script failed'));
        }
      }
    }
  });

  // 2. Fetch fresh state from Discord client
  async function refreshData(targetGuildId = null) {
    state.isLoading = true;
    state.connectionError = false;
    renderModalContent();

    try {
      const urlGuild = getUrlGuildId();
      const effectiveGuild = targetGuildId || urlGuild || state.currentGuildId;

      let res;
      if (targetGuildId || (effectiveGuild && effectiveGuild !== state.currentGuildId)) {
        res = await sendPageRequest('GET_GUILD_DATA', { guildId: effectiveGuild });
        state.currentGuildId = effectiveGuild;
        state.emojis = res.emojis || [];
        state.stickers = res.stickers || [];
      } else {
        res = await sendPageRequest('GET_STATE', { guildId: effectiveGuild });
        state.guilds = res.guilds || [];
        state.currentGuildId = res.currentGuildId || urlGuild || state.currentGuildId;
        state.hasToken = res.hasToken;
        state.emojis = res.emojis || [];
        state.stickers = res.stickers || [];
      }

      // If active guild not in guilds list, synthesize one
      if (state.currentGuildId && !state.guilds.some((g) => g.id === state.currentGuildId)) {
        state.guilds.unshift({
          id: state.currentGuildId,
          name: getDomServerName() || 'Current Server',
          icon: null
        });
      }

      if (!state.uploadTargetGuildId && state.guilds.length > 0) {
        state.uploadTargetGuildId = state.guilds[0].id;
      }

      // Default: select all items
      state.selectedItems.clear();
      state.emojis.forEach((e) => state.selectedItems.add(`emoji_${e.id}`));
      state.stickers.forEach((s) => state.selectedItems.add(`sticker_${s.id}`));
      state.connectionError = false;

      return {
        success: true,
        guilds: state.guilds,
        currentGuildId: state.currentGuildId,
        emojis: state.emojis,
        stickers: state.stickers,
        hasToken: state.hasToken
      };
    } catch (err) {
      console.warn('[EmojiDownloader] Refresh data error:', err);
      state.connectionError = true;
      if (!state.currentGuildId) {
        state.currentGuildId = getUrlGuildId();
      }
      return { success: false, error: err.message };
    } finally {
      state.isLoading = false;
      renderModalContent();
    }
  }

  function getDomServerName() {
    try {
      const headerTitle = document.querySelector(
        'header h1, [class*="headerContent"] h1, [class*="guildName"], [data-list-item-id^="channels___"] h2'
      );
      if (headerTitle && headerTitle.textContent) {
        return headerTitle.textContent.trim();
      }
      const title = document.title;
      if (title && title.includes('|')) {
        return title.split('|')[0].trim();
      }
    } catch (_) {}
    return null;
  }

  // 3. Floating In-Page Button & Modal Overlay UI
  function createFloatingButton() {
    if (document.getElementById('ded-floating-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'ded-floating-btn';
    btn.className = 'ded-floating-btn';
    btn.title = 'Discord Emoji & Sticker Downloader / Uploader';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5v-5h3l-4-4-4 4h3v5h2zm-7 1.5v2h12v-2H6z"/>
      </svg>
      <span>⚡ Emojis</span>
    `;

    btn.addEventListener('click', () => {
      openModal();
    });

    document.body.appendChild(btn);
  }

  function getFilteredItems() {
    const query = state.searchQuery.toLowerCase().trim();
    const items = [];

    if (state.activeTab === 'all' || state.activeTab === 'static' || state.activeTab === 'animated') {
      for (const e of state.emojis) {
        if (state.activeTab === 'static' && e.animated) continue;
        if (state.activeTab === 'animated' && !e.animated) continue;
        if (query && !e.name.toLowerCase().includes(query)) continue;
        items.push({
          type: 'emoji',
          id: e.id,
          name: e.name,
          animated: e.animated,
          key: `emoji_${e.id}`,
          url: DiscordApi.getEmojiUrl(e.id, e.animated, 128),
          downloadUrl: DiscordApi.getEmojiUrl(e.id, e.animated, 256),
          ext: e.animated ? 'gif' : 'png',
          badge: e.animated ? 'GIF' : 'PNG'
        });
      }
    }

    if (state.activeTab === 'all' || state.activeTab === 'stickers') {
      for (const s of state.stickers) {
        if (query && !s.name.toLowerCase().includes(query)) continue;
        const info = DiscordApi.getStickerInfo(s.id, s.format_type, 256);
        items.push({
          type: 'sticker',
          id: s.id,
          name: s.name,
          key: `sticker_${s.id}`,
          url: info.url,
          downloadUrl: info.url,
          ext: info.ext,
          badge: 'STICKER'
        });
      }
    }

    return items;
  }

  function openModal() {
    state.modalOpen = true;
    let backdrop = document.getElementById('ded-modal-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'ded-modal-backdrop';
      backdrop.className = 'ded-modal-backdrop';
      document.body.appendChild(backdrop);
    }
    backdrop.style.display = 'flex';

    refreshData();
  }

  function closeModal() {
    state.modalOpen = false;
    const backdrop = document.getElementById('ded-modal-backdrop');
    if (backdrop) backdrop.style.display = 'none';
  }

  // Render Modal (Routes to Browse view or Upload view)
  function renderModalContent() {
    const backdrop = document.getElementById('ded-modal-backdrop');
    if (!backdrop || !state.modalOpen) return;

    if (state.currentView === 'upload') {
      renderUploadView(backdrop);
    } else {
      renderBrowseView(backdrop);
    }
  }

  // -------------------------------------------------------------
  // VIEW 1: BROWSE & DOWNLOAD / COPY TO SERVER
  // -------------------------------------------------------------
  function renderBrowseView(backdrop) {
    const filtered = getFilteredItems();
    const currentGuild = state.guilds.find((g) => g.id === state.currentGuildId) || {
      name: getDomServerName() || 'Current Server',
      id: state.currentGuildId
    };

    const serverOptions = state.guilds.length
      ? state.guilds
          .map(
            (g) =>
              `<option value="${g.id}" ${g.id === state.currentGuildId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
          )
          .join('')
      : `<option value="${state.currentGuildId || ''}">${escapeHtml(currentGuild.name)}</option>`;

    let bodyContent = '';

    if (state.isLoading) {
      bodyContent = `
        <div class="ded-loading-state">
          <div class="ded-spinner"></div>
          <p>Scanning server emojis & stickers...</p>
        </div>
      `;
    } else if (state.connectionError && state.emojis.length === 0 && state.stickers.length === 0) {
      bodyContent = `
        <div class="ded-empty-state">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          <p style="color: #f23f43; font-weight: 600; font-size: 15px;">Connection to Discord client needed</p>
          <p style="font-size: 13px; max-width: 420px; line-height: 1.5; color: #949ba4;">
            If you just updated or loaded the extension, Discord needs a quick reload to establish the secure in-page connection.
          </p>
          <div style="display: flex; gap: 10px; margin-top: 8px;">
            <button class="ded-btn ded-btn-primary" id="ded-reload-page-btn">↻ Refresh Discord Page</button>
            <button class="ded-btn ded-btn-secondary" id="ded-retry-fetch-btn">Try Again</button>
          </div>
        </div>
      `;
    } else if (filtered.length > 0) {
      bodyContent = `
        <div class="ded-grid">
          ${filtered
            .map((item) => {
              const isSelected = state.selectedItems.has(item.key);
              return `
              <div class="ded-card ${isSelected ? 'selected' : ''}" data-key="${item.key}">
                <input type="checkbox" class="ded-card-checkbox" ${isSelected ? 'checked' : ''} data-key="${item.key}" />
                <span class="ded-card-badge ${item.badge.toLowerCase()}">${item.badge}</span>
                <div class="ded-card-img-wrap">
                  <img src="${item.url}" alt="${escapeHtml(item.name)}" loading="lazy" />
                </div>
                <span class="ded-card-name" title=":${item.name}:">:${item.name}:</span>
                <button class="ded-card-dl-single" title="Download single item" data-key="${item.key}">⬇</button>
              </div>
            `;
            })
            .join('')}
        </div>
      `;
    } else {
      const msg = state.searchQuery.trim()
        ? `No emojis or stickers found matching "${escapeHtml(state.searchQuery)}".`
        : 'No custom emojis or stickers found on this server.';
      bodyContent = `
        <div class="ded-empty-state">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5-9c.83 0 1.5-.67 1.5-1.5S7.83 8 7 8s-1.5.67-1.5 1.5S6.17 11 7 11zm10 0c.83 0 1.5-.67 1.5-1.5S17.83 8 17 8s-1.5.67-1.5 1.5.67 1.5 1.5 1.5zm-5 6c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>
          <p>${msg}</p>
        </div>
      `;
    }

    backdrop.innerHTML = `
      <div class="ded-modal" id="ded-modal-container">
        <!-- Header -->
        <div class="ded-header">
          <div class="ded-header-title">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5v-5h3l-4-4-4 4h3v5h2zm-7 1.5v2h12v-2H6z"/>
            </svg>
            <span>Discord Emoji Studio</span>
          </div>

          <!-- Top View Navigation -->
          <div class="ded-header-tabs">
            <button class="ded-nav-btn ${state.currentView === 'browse' ? 'active' : ''}" id="ded-nav-browse">
              📥 Browse & Download
            </button>
            <button class="ded-nav-btn ${state.currentView === 'upload' ? 'active' : ''}" id="ded-nav-upload">
              📤 Upload Emojis ${state.uploadQueue.length > 0 ? `(${state.uploadQueue.length})` : ''}
            </button>
          </div>

          <button class="ded-close-btn" id="ded-close-btn" title="Close">✕</button>
        </div>

        <!-- Controls Bar -->
        <div class="ded-controls">
          <select class="ded-server-select" id="ded-server-select" title="Selected Server">
            ${serverOptions}
          </select>
          <button class="ded-icon-btn" id="ded-refresh-btn" title="Refresh server assets">🔄</button>

          <input
            type="text"
            class="ded-search-input"
            id="ded-search-input"
            placeholder="Search emojis or stickers..."
            value="${escapeHtml(state.searchQuery)}"
          />

          <div class="ded-tabs">
            <button class="ded-tab ${state.activeTab === 'all' ? 'active' : ''}" data-tab="all">All (${state.emojis.length + state.stickers.length})</button>
            <button class="ded-tab ${state.activeTab === 'static' ? 'active' : ''}" data-tab="static">Static (${state.emojis.filter((e) => !e.animated).length})</button>
            <button class="ded-tab ${state.activeTab === 'animated' ? 'active' : ''}" data-tab="animated">GIF (${state.emojis.filter((e) => e.animated).length})</button>
            <button class="ded-tab ${state.activeTab === 'stickers' ? 'active' : ''}" data-tab="stickers">Stickers (${state.stickers.length})</button>
          </div>
        </div>

        <!-- Subtoolbar -->
        <div class="ded-subtoolbar">
          <div class="ded-select-actions">
            <span>Selected: <strong>${state.selectedItems.size}</strong> / ${state.emojis.length + state.stickers.length}</span>
            <button class="ded-btn-link" id="ded-select-all-btn">Select All</button>
            <button class="ded-btn-link" id="ded-deselect-all-btn">Deselect All</button>
          </div>
          <label class="ded-folder-option">
            <input type="checkbox" id="ded-organize-folders" ${state.organizeFolders ? 'checked' : ''} />
            <span>Organize into subfolders</span>
          </label>
        </div>

        <!-- Grid Container -->
        <div class="ded-grid-container">
          ${bodyContent}
        </div>

        <!-- Progress Banner (hidden by default) -->
        <div class="ded-progress-wrap" id="ded-progress-wrap" style="display: none;">
          <div class="ded-progress-label">
            <span id="ded-progress-text">Preparing assets...</span>
            <span id="ded-progress-pct">0%</span>
          </div>
          <div class="ded-progress-bar-bg">
            <div class="ded-progress-bar-fill" id="ded-progress-bar-fill"></div>
          </div>
        </div>

        <!-- Footer -->
        <div class="ded-footer">
          <div class="ded-footer-left">
            <span>Server: <strong>${escapeHtml(currentGuild.name)}</strong></span>
          </div>
          <div class="ded-actions">
            <button class="ded-btn ded-btn-clone" id="ded-copy-server-btn" ${state.isDownloading || state.isUploading || state.selectedItems.size === 0 ? 'disabled' : ''} title="Copy selected emojis directly to another server">
              📋 Copy to Server... (${state.selectedItems.size})
            </button>
            <button class="ded-btn ded-btn-secondary" id="ded-dl-all-btn" ${state.isDownloading || state.isUploading || (state.emojis.length + state.stickers.length === 0) ? 'disabled' : ''}>
              Download All (${state.emojis.length + state.stickers.length})
            </button>
            <button class="ded-btn ded-btn-primary" id="ded-dl-selected-btn" ${state.isDownloading || state.isUploading || state.selectedItems.size === 0 ? 'disabled' : ''}>
              Download Selected (${state.selectedItems.size})
            </button>
          </div>
        </div>
      </div>
    `;

    bindBrowseEvents(backdrop);
  }

  function bindBrowseEvents(backdrop) {
    document.getElementById('ded-close-btn').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    // Top Navigation Tabs
    document.getElementById('ded-nav-browse')?.addEventListener('click', () => {
      state.currentView = 'browse';
      renderModalContent();
    });
    document.getElementById('ded-nav-upload')?.addEventListener('click', () => {
      state.currentView = 'upload';
      renderModalContent();
    });

    const refreshBtn = document.getElementById('ded-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        refreshData(state.currentGuildId);
      });
    }

    const reloadPageBtn = document.getElementById('ded-reload-page-btn');
    if (reloadPageBtn) {
      reloadPageBtn.addEventListener('click', () => {
        window.location.reload();
      });
    }

    const retryFetchBtn = document.getElementById('ded-retry-fetch-btn');
    if (retryFetchBtn) {
      retryFetchBtn.addEventListener('click', () => {
        refreshData(state.currentGuildId);
      });
    }

    const serverSelect = document.getElementById('ded-server-select');
    if (serverSelect) {
      serverSelect.addEventListener('change', async (e) => {
        const newGuildId = e.target.value;
        await refreshData(newGuildId);
      });
    }

    const searchInput = document.getElementById('ded-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        renderModalContent();
      });
    }

    document.querySelectorAll('.ded-tab').forEach((tabBtn) => {
      tabBtn.addEventListener('click', (e) => {
        state.activeTab = e.currentTarget.getAttribute('data-tab');
        renderModalContent();
      });
    });

    document.getElementById('ded-select-all-btn')?.addEventListener('click', () => {
      const filtered = getFilteredItems();
      filtered.forEach((item) => state.selectedItems.add(item.key));
      renderModalContent();
    });

    document.getElementById('ded-deselect-all-btn')?.addEventListener('click', () => {
      state.selectedItems.clear();
      renderModalContent();
    });

    document.getElementById('ded-organize-folders')?.addEventListener('change', (e) => {
      state.organizeFolders = e.target.checked;
    });

    document.querySelectorAll('.ded-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.ded-card-dl-single')) return;
        const key = card.getAttribute('data-key');
        if (state.selectedItems.has(key)) {
          state.selectedItems.delete(key);
        } else {
          state.selectedItems.add(key);
        }
        renderModalContent();
      });
    });

    document.querySelectorAll('.ded-card-dl-single').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const key = btn.getAttribute('data-key');
        const allItems = getFilteredItems();
        const target = allItems.find((i) => i.key === key);
        if (target) {
          await downloadSingleItem(target);
        }
      });
    });

    document.getElementById('ded-dl-selected-btn')?.addEventListener('click', () => {
      startZipDownload(false);
    });

    document.getElementById('ded-dl-all-btn')?.addEventListener('click', () => {
      startZipDownload(true);
    });

    // 1-Click Server Clone
    document.getElementById('ded-copy-server-btn')?.addEventListener('click', () => {
      openCloneDialog();
    });
  }

  // -------------------------------------------------------------
  // VIEW 2: LOCAL FILE & ZIP UPLOADER WORKBENCH
  // -------------------------------------------------------------
  function renderUploadView(backdrop) {
    const uploadServerOptions = state.guilds
      .map(
        (g) =>
          `<option value="${g.id}" ${g.id === state.uploadTargetGuildId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
      )
      .join('');

    const queueCount = state.uploadQueue.length;

    let queueHtml = '';
    if (queueCount === 0) {
      queueHtml = `
        <div class="ded-empty-state" style="height: 180px;">
          <svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>
          <p>No files queued yet. Drag & drop images or a .zip archive above!</p>
        </div>
      `;
    } else {
      queueHtml = `
        <div class="ded-upload-grid">
          ${state.uploadQueue
            .map((item, idx) => {
              const isOver256K = item.size > 262144;
              const kbSize = Math.round(item.size / 1024);
              return `
              <div class="ded-upload-card ${item.status || ''}" data-idx="${idx}">
                <button class="ded-upload-remove-btn" data-idx="${idx}" title="Remove file">✕</button>
                <span class="ded-size-badge ${isOver256K ? 'warning' : ''}" title="${isOver256K ? 'Exceeds Discord 256KB limit!' : 'File size OK'}">
                  ${kbSize} KB ${isOver256K ? '⚠️' : ''}
                </span>
                <div class="ded-card-img-wrap">
                  <img src="${item.dataUri}" alt="${escapeHtml(item.name)}" />
                </div>
                <input
                  type="text"
                  class="ded-upload-name-input"
                  data-idx="${idx}"
                  value="${escapeHtml(item.name)}"
                  placeholder="emoji_name"
                  maxlength="32"
                  title="Emoji name (2-32 alphanumeric/underscore chars)"
                />
              </div>
            `;
            })
            .join('')}
        </div>
      `;
    }

    backdrop.innerHTML = `
      <div class="ded-modal" id="ded-modal-container">
        <!-- Header -->
        <div class="ded-header">
          <div class="ded-header-title">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5v-5h3l-4-4-4 4h3v5h2zm-7 1.5v2h12v-2H6z"/>
            </svg>
            <span>Discord Emoji Studio</span>
          </div>

          <!-- Top View Navigation -->
          <div class="ded-header-tabs">
            <button class="ded-nav-btn ${state.currentView === 'browse' ? 'active' : ''}" id="ded-nav-browse">
              📥 Browse & Download
            </button>
            <button class="ded-nav-btn ${state.currentView === 'upload' ? 'active' : ''}" id="ded-nav-upload">
              📤 Upload Emojis ${queueCount > 0 ? `(${queueCount})` : ''}
            </button>
          </div>

          <button class="ded-close-btn" id="ded-close-btn" title="Close">✕</button>
        </div>

        <div class="ded-grid-container" style="display: flex; flex-direction: column;">
          <!-- Dropzone -->
          <div class="ded-dropzone" id="ded-dropzone">
            <svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>
            <div class="ded-dropzone-title">Drag & drop emoji files or a .ZIP pack here</div>
            <div class="ded-dropzone-sub">Supports PNG, GIF, JPG, WEBP, and ZIP (Max 256 KB per emoji) • Click to browse files</div>
            <input type="file" id="ded-file-input" multiple accept=".png,.gif,.jpg,.jpeg,.webp,.zip" style="display: none;" />
          </div>

          <!-- Upload Toolbar -->
          <div class="ded-upload-toolbar">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span>Target Server:</span>
              <select class="ded-upload-server-select" id="ded-upload-server-select">
                ${uploadServerOptions || '<option value="">No manageable servers</option>'}
              </select>
            </div>

            <div style="display: flex; align-items: center; gap: 10px;">
              ${
                queueCount > 0
                  ? `<button class="ded-btn-link" id="ded-upload-clear-btn" style="color: #f23f43;">Clear All (${queueCount})</button>`
                  : ''
              }
              <button class="ded-btn ded-btn-secondary" id="ded-upload-add-btn">➕ Add Files</button>
              <button class="ded-btn ded-btn-primary" id="ded-upload-submit-btn" ${queueCount === 0 || state.isUploading ? 'disabled' : ''}>
                🚀 Upload All (${queueCount})
              </button>
            </div>
          </div>

          <!-- Queued Cards -->
          ${queueHtml}
        </div>

        <!-- Progress Banner -->
        <div class="ded-progress-wrap" id="ded-progress-wrap" style="display: none;">
          <div class="ded-progress-label">
            <span id="ded-progress-text">Uploading emojis...</span>
            <span id="ded-progress-pct">0%</span>
          </div>
          <div class="ded-progress-bar-bg">
            <div class="ded-progress-bar-fill" id="ded-progress-bar-fill"></div>
          </div>
        </div>

        <!-- Footer -->
        <div class="ded-footer">
          <div class="ded-footer-left">
            <span>Ready to upload <strong>${queueCount}</strong> custom emoji(s)</span>
          </div>
          <div class="ded-actions">
            <button class="ded-btn ded-btn-secondary" id="ded-back-browse-btn">Back to Browse</button>
          </div>
        </div>
      </div>
    `;

    bindUploadEvents(backdrop);
  }

  function bindUploadEvents(backdrop) {
    document.getElementById('ded-close-btn').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    document.getElementById('ded-nav-browse')?.addEventListener('click', () => {
      state.currentView = 'browse';
      renderModalContent();
    });
    document.getElementById('ded-back-browse-btn')?.addEventListener('click', () => {
      state.currentView = 'browse';
      renderModalContent();
    });

    const dropzone = document.getElementById('ded-dropzone');
    const fileInput = document.getElementById('ded-file-input');

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
      document.getElementById('ded-upload-add-btn')?.addEventListener('click', () => fileInput.click());

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
      });

      dropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files) {
          await handleIncomingFiles(e.dataTransfer.files);
        }
      });

      fileInput.addEventListener('change', async (e) => {
        if (e.target.files) {
          await handleIncomingFiles(e.target.files);
        }
      });
    }

    const uploadServerSelect = document.getElementById('ded-upload-server-select');
    if (uploadServerSelect) {
      uploadServerSelect.addEventListener('change', (e) => {
        state.uploadTargetGuildId = e.target.value;
      });
    }

    document.getElementById('ded-upload-clear-btn')?.addEventListener('click', () => {
      state.uploadQueue = [];
      renderModalContent();
    });

    // Remove single item from queue
    document.querySelectorAll('.ded-upload-remove-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        state.uploadQueue.splice(idx, 1);
        renderModalContent();
      });
    });

    // Inline edit name input
    document.querySelectorAll('.ded-upload-name-input').forEach((input) => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(input.getAttribute('data-idx'), 10);
        if (state.uploadQueue[idx]) {
          state.uploadQueue[idx].name = DiscordApi.sanitizeEmojiName(e.target.value);
        }
      });
    });

    // Submit batch upload
    document.getElementById('ded-upload-submit-btn')?.addEventListener('click', async () => {
      const targetGuildId = state.uploadTargetGuildId || document.getElementById('ded-upload-server-select')?.value;
      if (!targetGuildId) {
        alert('Please select a destination server.');
        return;
      }
      await startBatchUpload(targetGuildId);
    });
  }

  // Handle incoming dropped or selected files (images or ZIP)
  async function handleIncomingFiles(fileList) {
    state.isLoading = true;
    renderModalContent();

    for (const file of Array.from(fileList)) {
      if (file.name.toLowerCase().endsWith('.zip')) {
        // Extract ZIP
        try {
          const buffer = await file.arrayBuffer();
          const extracted = await DiscordApi.extractZipImages(new Uint8Array(buffer));
          for (const item of extracted) {
            const dataUri = DiscordApi.binaryToDataUri(item.data, item.mimeType);
            state.uploadQueue.push({
              name: item.name,
              size: item.data.byteLength,
              mimeType: item.mimeType,
              ext: item.ext,
              dataUri,
              status: 'pending'
            });
          }
        } catch (err) {
          alert(`Failed to extract ZIP ${file.name}: ${err.message}`);
        }
      } else if (/\.(png|gif|jpe?g|webp)$/i.test(file.name)) {
        // Single image file
        try {
          const dataUri = await DiscordApi.fileToDataUri(file);
          const ext = (file.name.split('.').pop() || 'png').toLowerCase();
          state.uploadQueue.push({
            name: DiscordApi.sanitizeEmojiName(file.name),
            size: file.size,
            mimeType: file.type || DiscordApi.getMimeType(file.name),
            ext,
            dataUri,
            status: 'pending'
          });
        } catch (err) {
          alert(`Failed to read file ${file.name}: ${err.message}`);
        }
      }
    }

    state.isLoading = false;
    renderModalContent();
  }

  // Batch upload execution with rate limiting
  async function startBatchUpload(targetGuildId) {
    if (state.isUploading || state.uploadQueue.length === 0) return;
    state.isUploading = true;

    const progressWrap = document.getElementById('ded-progress-wrap');
    const progressText = document.getElementById('ded-progress-text');
    const progressPct = document.getElementById('ded-progress-pct');
    const progressBar = document.getElementById('ded-progress-bar-fill');

    if (progressWrap) progressWrap.style.display = 'flex';

    const queue = [...state.uploadQueue];
    const total = queue.length;
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (let i = 0; i < total; i++) {
      const item = queue[i];
      const pct = Math.round((i / total) * 100);

      if (progressText) progressText.innerText = `Uploading ${i + 1}/${total}: :${item.name}:`;
      if (progressPct) progressPct.innerText = `${pct}%`;
      if (progressBar) progressBar.style.width = `${pct}%`;

      try {
        const res = await sendPageRequest('UPLOAD_EMOJI', {
          targetGuildId,
          emojiData: {
            name: item.name,
            image: item.dataUri
          }
        });

        if (res && res.success) {
          item.status = 'success';
          successCount++;
        } else if (res && res.rateLimited) {
          const delay = (res.retryAfter || 2) * 1000 + 300;
          if (progressText) progressText.innerText = `Rate limited. Pausing ${Math.round(delay / 1000)}s...`;
          await new Promise((r) => setTimeout(r, delay));

          const retryRes = await sendPageRequest('UPLOAD_EMOJI', {
            targetGuildId,
            emojiData: { name: item.name, image: item.dataUri }
          });

          if (retryRes && retryRes.success) {
            item.status = 'success';
            successCount++;
          } else {
            item.status = 'error';
            failCount++;
            errors.push(`:${item.name}: ${retryRes?.error || 'Rate limited'}`);
          }
        } else {
          item.status = 'error';
          failCount++;
          errors.push(`:${item.name}: ${res?.error || 'Failed'}`);
          if (res && res.forbidden) {
            alert(`Upload stopped: ${res.error}`);
            break;
          }
        }
      } catch (err) {
        item.status = 'error';
        failCount++;
        errors.push(`:${item.name}: ${err.message}`);
      }

      // Throttle sequential requests
      if (i < total - 1) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    if (progressText) progressText.innerText = `Upload complete! ${successCount} uploaded, ${failCount} failed.`;
    if (progressPct) progressPct.innerText = '100%';
    if (progressBar) progressBar.style.width = '100%';

    setTimeout(() => {
      if (progressWrap) progressWrap.style.display = 'none';
      state.isUploading = false;
      // Remove successfully uploaded items from queue
      state.uploadQueue = state.uploadQueue.filter((item) => item.status !== 'success');
      renderModalContent();

      if (failCount > 0) {
        alert(`Upload report: ${successCount} succeeded, ${failCount} failed.\n${errors.slice(0, 5).join('\n')}`);
      } else {
        alert(`Success! Uploaded ${successCount} custom emoji(s) to server.`);
      }
    }, 1200);
  }

  // -------------------------------------------------------------
  // 1-CLICK SERVER CLONE ("Copy to Server") DIALOG & RUNNER
  // -------------------------------------------------------------
  function openCloneDialog() {
    const targetItems = getFilteredItems().filter((i) => state.selectedItems.has(i.key));
    if (targetItems.length === 0) {
      alert('Please select at least one emoji to copy.');
      return;
    }

    const modalContainer = document.getElementById('ded-modal-container');
    if (!modalContainer) return;

    const existingDialog = document.getElementById('ded-clone-dialog-backdrop');
    if (existingDialog) existingDialog.remove();

    const options = state.guilds
      .map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`)
      .join('');

    const dialog = document.createElement('div');
    dialog.id = 'ded-clone-dialog-backdrop';
    dialog.className = 'ded-dialog-backdrop';
    dialog.innerHTML = `
      <div class="ded-dialog">
        <div class="ded-dialog-title">📋 Copy Emojis to Server</div>
        <div class="ded-dialog-body">
          <p>Copy <strong>${targetItems.length}</strong> selected emoji(s) directly to:</p>
          <select class="ded-server-select" id="ded-clone-server-select" style="width: 100%; margin: 12px 0;">
            ${options}
          </select>
          <p style="font-size: 11px; color: #949ba4; line-height: 1.4;">
            Note: You must have "Manage Expressions" permission on the destination server. Uploads are safely throttled (800ms) to prevent rate limits.
          </p>
        </div>
        <div class="ded-dialog-footer">
          <button class="ded-btn ded-btn-secondary" id="ded-clone-cancel-btn">Cancel</button>
          <button class="ded-btn ded-btn-clone" id="ded-clone-confirm-btn">Start Copying (${targetItems.length})</button>
        </div>
      </div>
    `;

    modalContainer.appendChild(dialog);

    document.getElementById('ded-clone-cancel-btn').addEventListener('click', () => {
      dialog.remove();
    });

    document.getElementById('ded-clone-confirm-btn').addEventListener('click', async () => {
      const destGuildId = document.getElementById('ded-clone-server-select').value;
      dialog.remove();
      await startCloneUpload(destGuildId, targetItems);
    });
  }

  async function startCloneUpload(targetGuildId, items) {
    if (state.isUploading) return;
    state.isUploading = true;

    const progressWrap = document.getElementById('ded-progress-wrap');
    const progressText = document.getElementById('ded-progress-text');
    const progressPct = document.getElementById('ded-progress-pct');
    const progressBar = document.getElementById('ded-progress-bar-fill');

    if (progressWrap) progressWrap.style.display = 'flex';

    const total = items.length;
    let successCount = 0;
    let failCount = 0;
    const errorMessages = [];

    for (let i = 0; i < total; i++) {
      const item = items[i];
      const pct = Math.round((i / total) * 100);

      if (progressText) progressText.innerText = `Copying ${i + 1}/${total}: :${item.name}:`;
      if (progressPct) progressPct.innerText = `${pct}%`;
      if (progressBar) progressBar.style.width = `${pct}%`;

      try {
        const binary = await DiscordApi.fetchBinary(item.downloadUrl);
        const mimeType = item.animated ? 'image/gif' : 'image/png';
        const dataUri = DiscordApi.binaryToDataUri(binary, mimeType);
        const cleanName = DiscordApi.sanitizeEmojiName(item.name);

        const res = await sendPageRequest('UPLOAD_EMOJI', {
          targetGuildId,
          emojiData: {
            name: cleanName,
            image: dataUri
          }
        });

        if (res && res.success) {
          successCount++;
        } else if (res && res.rateLimited) {
          const delay = (res.retryAfter || 2) * 1000 + 300;
          if (progressText) progressText.innerText = `Rate limited. Pausing ${Math.round(delay / 1000)}s...`;
          await new Promise((r) => setTimeout(r, delay));

          const retryRes = await sendPageRequest('UPLOAD_EMOJI', {
            targetGuildId,
            emojiData: { name: cleanName, image: dataUri }
          });

          if (retryRes && retryRes.success) {
            successCount++;
          } else {
            failCount++;
            errorMessages.push(`:${item.name}: ${retryRes?.error || 'Rate limited'}`);
          }
        } else {
          failCount++;
          errorMessages.push(`:${item.name}: ${res?.error || 'Failed'}`);
          if (res && res.forbidden) {
            alert(`Copy stopped: ${res.error}`);
            break;
          }
        }
      } catch (err) {
        failCount++;
        errorMessages.push(`:${item.name}: ${err.message}`);
      }

      if (i < total - 1) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    if (progressText) progressText.innerText = `Done! ${successCount} copied, ${failCount} failed.`;
    if (progressPct) progressPct.innerText = '100%';
    if (progressBar) progressBar.style.width = '100%';

    setTimeout(() => {
      if (progressWrap) progressWrap.style.display = 'none';
      state.isUploading = false;
      renderModalContent();

      if (failCount > 0) {
        alert(`Clone finished: ${successCount} copied, ${failCount} failed.\n${errorMessages.slice(0, 5).join('\n')}`);
      } else {
        alert(`Success! Copied ${successCount} emoji(s) directly to destination server.`);
      }
    }, 1200);
  }

  // -------------------------------------------------------------
  // ZIP DOWNLOAD & SINGLE ITEM HANDLERS
  // -------------------------------------------------------------
  async function downloadSingleItem(item) {
    try {
      const data = await DiscordApi.fetchBinary(item.downloadUrl);
      const safeName = DiscordApi.sanitizeFilename(item.name);
      const filename = `${safeName}.${item.ext}`;
      const blob = new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (err) {
      alert(`Failed to download ${item.name}: ${err.message}`);
    }
  }

  async function startZipDownload(downloadAll = false) {
    if (state.isDownloading) return;
    state.isDownloading = true;

    const progressWrap = document.getElementById('ded-progress-wrap');
    const progressText = document.getElementById('ded-progress-text');
    const progressPct = document.getElementById('ded-progress-pct');
    const progressBar = document.getElementById('ded-progress-bar-fill');

    if (progressWrap) progressWrap.style.display = 'flex';

    try {
      const allItems = [];
      for (const e of state.emojis) {
        allItems.push({
          type: 'emoji',
          id: e.id,
          name: e.name,
          animated: e.animated,
          key: `emoji_${e.id}`,
          url: DiscordApi.getEmojiUrl(e.id, e.animated, 256),
          ext: e.animated ? 'gif' : 'png'
        });
      }
      for (const s of state.stickers) {
        const info = DiscordApi.getStickerInfo(s.id, s.format_type, 512);
        allItems.push({
          type: 'sticker',
          id: s.id,
          name: s.name,
          key: `sticker_${s.id}`,
          url: info.url,
          ext: info.ext
        });
      }

      const targetItems = downloadAll
        ? allItems
        : allItems.filter((i) => state.selectedItems.has(i.key));

      if (targetItems.length === 0) {
        alert('No items selected for download.');
        state.isDownloading = false;
        if (progressWrap) progressWrap.style.display = 'none';
        return;
      }

      const downloadTasks = targetItems.map((item) => {
        const safeName = DiscordApi.sanitizeFilename(item.name);
        let path;
        if (state.organizeFolders) {
          if (item.type === 'emoji') {
            const folder = item.animated ? 'emojis/animated' : 'emojis/static';
            path = `${folder}/${safeName}.${item.ext}`;
          } else {
            path = `stickers/${safeName}.${item.ext}`;
          }
        } else {
          path = `${safeName}.${item.ext}`;
        }
        return {
          name: item.name,
          url: item.url,
          path
        };
      });

      const results = await DiscordApi.batchDownload(
        downloadTasks,
        6,
        (current, total, currentName) => {
          const pct = Math.round((current / total) * 90);
          if (progressText) progressText.innerText = `Downloading ${current}/${total}: ${currentName}`;
          if (progressPct) progressPct.innerText = `${pct}%`;
          if (progressBar) progressBar.style.width = `${pct}%`;
        }
      );

      if (progressText) progressText.innerText = 'Creating ZIP archive...';
      if (progressPct) progressPct.innerText = '95%';
      if (progressBar) progressBar.style.width = '95%';

      const zip = new MiniZip();
      for (const res of results) {
        await zip.addFile(res.path, res.data);
      }

      const currentGuild = state.guilds.find((g) => g.id === state.currentGuildId);
      const safeServerName = DiscordApi.sanitizeFilename(currentGuild?.name || 'Discord');
      const zipName = `${safeServerName}_emojis.zip`;

      zip.download(zipName, (pct) => {
        if (progressBar) progressBar.style.width = `${90 + Math.round(pct * 0.1)}%`;
      });

      if (progressText) progressText.innerText = 'Download complete!';
      if (progressPct) progressPct.innerText = '100%';
      if (progressBar) progressBar.style.width = '100%';

      setTimeout(() => {
        if (progressWrap) progressWrap.style.display = 'none';
        state.isDownloading = false;
        renderModalContent();
      }, 1500);
    } catch (err) {
      alert(`Download failed: ${err.message}`);
      state.isDownloading = false;
      if (progressWrap) progressWrap.style.display = 'none';
      renderModalContent();
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Extension Runtime Messaging (from popup)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'POPUP_GET_DATA') {
      refreshData(message.guildId || null).then((res) => {
        sendResponse(res);
      });
      return true;
    }

    if (message.action === 'POPUP_CLONE_EMOJIS') {
      const { targetGuildId, keys } = message;
      const targetItems = getFilteredItems().filter((i) => keys.includes(i.key));
      startCloneUpload(targetGuildId, targetItems).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }
  });

  // Wait for Discord interface to load before mounting the button
  function init() {
    createFloatingButton();
    const observer = new MutationObserver(() => {
      if (!document.getElementById('ded-floating-btn')) {
        createFloatingButton();
      }
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
