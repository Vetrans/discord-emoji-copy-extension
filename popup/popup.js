/**
 * Discord Emoji Downloader - Popup Script
 * Communicates with the active Discord tab's content script,
 * manages UI state, filters, and orchestrates ZIP creation.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const state = {
    activeTabId: null,
    guilds: [],
    currentGuildId: null,
    emojis: [],
    stickers: [],
    hasToken: false,
    selectedItems: new Set(),
    activeFilterTab: 'all',
    searchQuery: '',
    isDownloading: false,
    quality: 256,
    organizeFolders: true
  };

  // DOM Elements
  const discordView = document.getElementById('discord-view');
  const notDiscordView = document.getElementById('not-discord-view');
  const statusLabel = document.getElementById('status-label');
  const statusDot = document.querySelector('.status-dot');
  const serverSelect = document.getElementById('server-select');
  const refreshBtn = document.getElementById('refresh-btn');
  const searchInput = document.getElementById('search-input');
  const assetGrid = document.getElementById('asset-grid');
  const loadingState = document.getElementById('loading-state');
  const countAll = document.getElementById('count-all');
  const countStatic = document.getElementById('count-static');
  const countAnimated = document.getElementById('count-animated');
  const countStickers = document.getElementById('count-stickers');
  const selectedCount = document.getElementById('selected-count');
  const totalCount = document.getElementById('total-count');
  const selectAllBtn = document.getElementById('select-all-btn');
  const deselectAllBtn = document.getElementById('deselect-all-btn');
  const btnDlAll = document.getElementById('btn-dl-all');
  const btnDlSelected = document.getElementById('btn-dl-selected');
  const btnCopyServer = document.getElementById('btn-copy-server');
  const optFolders = document.getElementById('opt-folders');
  const optQuality = document.getElementById('opt-quality');
  const progressSection = document.getElementById('progress-section');
  const progressStatus = document.getElementById('progress-status');
  const progressPercent = document.getElementById('progress-percent');
  const progressFill = document.getElementById('progress-fill');
  const btnOpenDiscord = document.getElementById('btn-open-discord');

  // Check active browser tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || !activeTab.url || !activeTab.url.includes('discord.com')) {
    showNotDiscordView();
    return;
  }
  state.activeTabId = activeTab.id;

  // Initialize
  await loadData();

  async function loadData(targetGuildId = null) {
    showLoading(true);
    statusLabel.innerText = 'Connecting...';
    try {
      let response;
      try {
        response = await chrome.tabs.sendMessage(state.activeTabId, {
          action: 'POPUP_GET_DATA',
          guildId: targetGuildId
        });
      } catch (sendErr) {
        // Attempt on-demand injection if tab hasn't been refreshed yet
        try {
          await chrome.scripting.executeScript({
            target: { tabId: state.activeTabId },
            files: ['content/injected.js'],
            world: 'MAIN'
          });
          await chrome.scripting.executeScript({
            target: { tabId: state.activeTabId },
            files: ['utils/zip.js', 'utils/discord-api.js', 'content/content.js']
          });
          await new Promise((r) => setTimeout(r, 400));
          response = await chrome.tabs.sendMessage(state.activeTabId, {
            action: 'POPUP_GET_DATA',
            guildId: targetGuildId
          });
        } catch (_) {
          throw new Error('Please refresh your Discord tab (F5) once to connect the downloader.');
        }
      }

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to communicate with Discord tab.');
      }

      state.guilds = response.guilds || [];
      state.currentGuildId = response.currentGuildId;
      state.emojis = response.emojis || [];
      state.stickers = response.stickers || [];
      state.hasToken = response.hasToken;

      // Select all by default
      state.selectedItems.clear();
      state.emojis.forEach((e) => state.selectedItems.add(`emoji_${e.id}`));
      state.stickers.forEach((s) => state.selectedItems.add(`sticker_${s.id}`));

      updateServerDropdown();
      updateCounts();
      renderGrid();

      statusLabel.innerText = 'Connected';
      statusDot.className = 'status-dot online';
    } catch (err) {
      console.warn('Load data error:', err);
      statusLabel.innerText = 'Error';
      statusDot.className = 'status-dot offline';
      loadingState.innerHTML = `
        <p style="color:#f23f43; text-align:center; padding: 10px 16px; line-height: 1.4;">
          ${escapeHtml(err.message || 'Could not load emojis.')}<br />
          <span style="font-size:11px; color:#949ba4;">Make sure you are on a Discord server and logged in.</span>
        </p>
      `;
    } finally {
      showLoading(false);
    }
  }

  function showNotDiscordView() {
    discordView.style.display = 'none';
    notDiscordView.style.display = 'flex';
    statusLabel.innerText = 'Discord Inactive';
    statusDot.className = 'status-dot offline';

    btnOpenDiscord.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://discord.com/app' });
      window.close();
    });

    const manualFetchBtn = document.getElementById('btn-manual-fetch');
    const manualGuildInput = document.getElementById('manual-guild-id');
    const manualTokenInput = document.getElementById('manual-token');
    manualFetchBtn.addEventListener('click', async () => {
      const guildId = manualGuildInput.value.trim();
      const token = manualTokenInput.value.trim();
      if (!guildId) {
        alert('Please enter a Guild ID.');
        return;
      }
      try {
        manualFetchBtn.disabled = true;
        manualFetchBtn.innerText = 'Fetching...';
        const headers = token ? { Authorization: token } : {};
        const emojiRes = await fetch(`https://discord.com/api/v9/guilds/${guildId}/emojis`, { headers });
        const emojis = await emojiRes.json();
        const stickerRes = await fetch(`https://discord.com/api/v9/guilds/${guildId}/stickers`, { headers });
        const stickers = await stickerRes.json();

        state.guilds = [{ id: guildId, name: `Server ${guildId}` }];
        state.currentGuildId = guildId;
        state.emojis = Array.isArray(emojis) ? emojis : [];
        state.stickers = Array.isArray(stickers) ? stickers : [];
        state.selectedItems.clear();
        state.emojis.forEach((e) => state.selectedItems.add(`emoji_${e.id}`));
        state.stickers.forEach((s) => state.selectedItems.add(`sticker_${s.id}`));

        notDiscordView.style.display = 'none';
        discordView.style.display = 'flex';
        updateServerDropdown();
        updateCounts();
        renderGrid();
      } catch (err) {
        alert(`Failed to fetch guild data: ${err.message}`);
      } finally {
        manualFetchBtn.disabled = false;
        manualFetchBtn.innerText = 'Fetch Emojis';
      }
    });
  }

  function showLoading(isLoading) {
    if (isLoading) {
      loadingState.style.display = 'flex';
      assetGrid.style.display = 'none';
    } else {
      loadingState.style.display = 'none';
      assetGrid.style.display = 'grid';
    }
  }

  function updateServerDropdown() {
    serverSelect.innerHTML = '';
    if (state.guilds.length === 0) {
      const opt = document.createElement('option');
      opt.value = state.currentGuildId || '';
      opt.textContent = state.currentGuildId ? `Server (${state.currentGuildId})` : 'Active Server';
      serverSelect.appendChild(opt);
      return;
    }

    state.guilds.forEach((g) => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      if (g.id === state.currentGuildId) {
        opt.selected = true;
      }
      serverSelect.appendChild(opt);
    });
  }

  function updateCounts() {
    const total = state.emojis.length + state.stickers.length;
    const staticCount = state.emojis.filter((e) => !e.animated).length;
    const animCount = state.emojis.filter((e) => e.animated).length;
    const stickerCount = state.stickers.length;

    countAll.innerText = total;
    countStatic.innerText = staticCount;
    countAnimated.innerText = animCount;
    countStickers.innerText = stickerCount;

    selectedCount.innerText = state.selectedItems.size;
    totalCount.innerText = total;

    btnDlAll.innerText = `Download All (${total})`;
    btnDlSelected.innerText = `Download Selected (${state.selectedItems.size})`;
    btnDlSelected.disabled = state.selectedItems.size === 0 || state.isDownloading;
    btnDlAll.disabled = total === 0 || state.isDownloading;
    if (btnCopyServer) {
      btnCopyServer.innerText = `Copy (${state.selectedItems.size})`;
      btnCopyServer.disabled = state.selectedItems.size === 0 || state.isDownloading;
    }
  }

  function getFilteredItems() {
    const query = state.searchQuery.toLowerCase().trim();
    const items = [];

    if (
      state.activeFilterTab === 'all' ||
      state.activeFilterTab === 'static' ||
      state.activeFilterTab === 'animated'
    ) {
      for (const e of state.emojis) {
        if (state.activeFilterTab === 'static' && e.animated) continue;
        if (state.activeFilterTab === 'animated' && !e.animated) continue;
        if (query && !e.name.toLowerCase().includes(query)) continue;
        items.push({
          type: 'emoji',
          id: e.id,
          name: e.name,
          animated: e.animated,
          key: `emoji_${e.id}`,
          url: DiscordApi.getEmojiUrl(e.id, e.animated, 128),
          downloadUrl: DiscordApi.getEmojiUrl(e.id, e.animated, state.quality),
          ext: e.animated ? 'gif' : 'png',
          badge: e.animated ? 'GIF' : 'PNG'
        });
      }
    }

    if (state.activeFilterTab === 'all' || state.activeFilterTab === 'stickers') {
      for (const s of state.stickers) {
        if (query && !s.name.toLowerCase().includes(query)) continue;
        const info = DiscordApi.getStickerInfo(s.id, s.format_type, state.quality);
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

  function renderGrid() {
    const filtered = getFilteredItems();
    assetGrid.innerHTML = '';

    if (filtered.length === 0) {
      assetGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; color: #949ba4; padding: 30px 10px;">
          No matching emojis or stickers found.
        </div>
      `;
      return;
    }

    filtered.forEach((item) => {
      const isSelected = state.selectedItems.has(item.key);
      const card = document.createElement('div');
      card.className = `grid-card ${isSelected ? 'selected' : ''}`;
      card.setAttribute('data-key', item.key);

      card.innerHTML = `
        <input type="checkbox" class="card-checkbox" ${isSelected ? 'checked' : ''} data-key="${item.key}" />
        <span class="card-badge ${item.badge.toLowerCase()}">${item.badge}</span>
        <div class="card-img-wrap">
          <img src="${item.url}" alt="${escapeHtml(item.name)}" loading="lazy" />
        </div>
        <span class="card-name" title=":${item.name}:">:${item.name}:</span>
        <button class="card-dl-single" title="Download single item" data-key="${item.key}">⬇</button>
      `;

      // Click card to toggle
      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-dl-single')) return;
        const key = item.key;
        if (state.selectedItems.has(key)) {
          state.selectedItems.delete(key);
        } else {
          state.selectedItems.add(key);
        }
        updateCounts();
        renderGrid();
      });

      // Single item download
      const dlBtn = card.querySelector('.card-dl-single');
      dlBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await downloadSingleItem(item);
      });

      assetGrid.appendChild(card);
    });
  }

  async function downloadSingleItem(item) {
    try {
      const data = await DiscordApi.fetchBinary(item.downloadUrl);
      const safeName = DiscordApi.sanitizeFilename(item.name);
      const blob = new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}.${item.ext}`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (err) {
      alert(`Download error for ${item.name}: ${err.message}`);
    }
  }

  async function startZipDownload(downloadAll = false) {
    if (state.isDownloading) return;
    state.isDownloading = true;
    updateCounts();

    progressSection.style.display = 'flex';
    progressStatus.innerText = 'Preparing items...';
    progressPercent.innerText = '0%';
    progressFill.style.width = '0%';

    try {
      const allItems = [];
      for (const e of state.emojis) {
        allItems.push({
          type: 'emoji',
          id: e.id,
          name: e.name,
          animated: e.animated,
          key: `emoji_${e.id}`,
          url: DiscordApi.getEmojiUrl(e.id, e.animated, state.quality),
          ext: e.animated ? 'gif' : 'png'
        });
      }
      for (const s of state.stickers) {
        const info = DiscordApi.getStickerInfo(s.id, s.format_type, state.quality);
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
        alert('No items selected.');
        state.isDownloading = false;
        progressSection.style.display = 'none';
        updateCounts();
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
        return { name: item.name, url: item.url, path };
      });

      const results = await DiscordApi.batchDownload(
        downloadTasks,
        6,
        (current, total, currentName) => {
          const pct = Math.round((current / total) * 90);
          progressStatus.innerText = `Downloading ${current}/${total}: ${currentName}`;
          progressPercent.innerText = `${pct}%`;
          progressFill.style.width = `${pct}%`;
        }
      );

      progressStatus.innerText = 'Building ZIP file...';
      progressPercent.innerText = '95%';
      progressFill.style.width = '95%';

      const zip = new MiniZip();
      for (const res of results) {
        await zip.addFile(res.path, res.data);
      }

      const currentGuild = state.guilds.find((g) => g.id === state.currentGuildId);
      const safeServerName = DiscordApi.sanitizeFilename(currentGuild?.name || 'Discord');
      const zipName = `${safeServerName}_emojis.zip`;

      zip.download(zipName, (pct) => {
        progressFill.style.width = `${90 + Math.round(pct * 0.1)}%`;
      });

      progressStatus.innerText = 'Complete!';
      progressPercent.innerText = '100%';
      progressFill.style.width = '100%';

      setTimeout(() => {
        progressSection.style.display = 'none';
        state.isDownloading = false;
        updateCounts();
      }, 1500);
    } catch (err) {
      alert(`Download failed: ${err.message}`);
      progressSection.style.display = 'none';
      state.isDownloading = false;
      updateCounts();
    }
  }

  // Event Listeners
  serverSelect.addEventListener('change', async (e) => {
    const targetGuildId = e.target.value;
    await loadData(targetGuildId);
  });

  refreshBtn.addEventListener('click', async () => {
    await loadData(state.currentGuildId);
  });

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderGrid();
  });

  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
      e.currentTarget.classList.add('active');
      state.activeFilterTab = e.currentTarget.getAttribute('data-tab');
      renderGrid();
    });
  });

  selectAllBtn.addEventListener('click', () => {
    const filtered = getFilteredItems();
    filtered.forEach((i) => state.selectedItems.add(i.key));
    updateCounts();
    renderGrid();
  });

  deselectAllBtn.addEventListener('click', () => {
    state.selectedItems.clear();
    updateCounts();
    renderGrid();
  });

  optFolders.addEventListener('change', (e) => {
    state.organizeFolders = e.target.checked;
  });

  optQuality.addEventListener('change', (e) => {
    state.quality = parseInt(e.target.value, 10);
  });

  btnDlSelected.addEventListener('click', () => {
    startZipDownload(false);
  });

  btnDlAll.addEventListener('click', () => {
    startZipDownload(true);
  });

  if (btnCopyServer) {
    btnCopyServer.addEventListener('click', async () => {
      if (state.selectedItems.size === 0) return;
      const targetGuildId = prompt('Enter the destination Server (Guild) ID to copy to:', state.currentGuildId || '');
      if (!targetGuildId || !targetGuildId.trim()) return;

      btnCopyServer.disabled = true;
      btnCopyServer.innerText = 'Copying...';
      try {
        await chrome.tabs.sendMessage(state.activeTabId, {
          action: 'POPUP_CLONE_EMOJIS',
          targetGuildId: targetGuildId.trim(),
          keys: Array.from(state.selectedItems)
        });
        alert('Copy process initiated in your Discord tab! Check the progress banner.');
      } catch (err) {
        alert(`Error starting copy: ${err.message}`);
      } finally {
        updateCounts();
      }
    });
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
});
