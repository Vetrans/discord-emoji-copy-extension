/**
 * Discord Injected Page-World Script (Runs in MAIN world)
 * Interfaces with Discord's internal webpack chunk, Flux stores,
 * and passively intercepts the authorization token for zero-friction access.
 */
(() => {
  if (window.__DISCORD_EMOJI_DOWNLOADER_INJECTED__) return;
  window.__DISCORD_EMOJI_DOWNLOADER_INJECTED__ = true;

  const state = {
    token: null,
    wreq: null,
    stores: {}
  };

  /**
   * 1. Passive Token Interceptor
   * Intercepts Discord's own client API calls to capture the active Authorization token.
   */
  function captureAuthToken(candidate) {
    if (candidate && typeof candidate === 'string' && candidate.length > 20) {
      const clean = candidate.replace(/^Bot\s+/i, '').trim();
      if (!state.token || state.token !== clean) {
        state.token = clean;
        try {
          window.postMessage({
            type: 'DISCORD_EMOJI_DOWNLOADER_RESPONSE',
            action: 'TOKEN_DETECTED',
            token: state.token
          }, '*');
        } catch (_) {}
      }
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    try {
      const [resource, config] = args;
      // 1. Check config.headers
      if (config && config.headers) {
        let auth = null;
        if (config.headers instanceof Headers) {
          auth = config.headers.get('Authorization') || config.headers.get('authorization');
        } else if (typeof config.headers === 'object') {
          auth = config.headers['Authorization'] || config.headers['authorization'];
        }
        if (auth) captureAuthToken(auth);
      }
      // 2. Check resource if it is a Request object
      if (resource && typeof resource === 'object' && resource.headers) {
        let auth = null;
        if (typeof resource.headers.get === 'function') {
          auth = resource.headers.get('Authorization') || resource.headers.get('authorization');
        } else if (typeof resource.headers === 'object') {
          auth = resource.headers['Authorization'] || resource.headers['authorization'];
        }
        if (auth) captureAuthToken(auth);
      }
    } catch (_) {}
    return originalFetch.apply(this, args);
  };

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (...args) {
    this._headers = {};
    return originalXHROpen.apply(this, args);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
    if (header && typeof header === 'string' && header.toLowerCase() === 'authorization') {
      captureAuthToken(value);
    }
    return originalXHRSetHeader.apply(this, args);
  };

  /**
   * 2. Webpack Chunk & Store Hook
   */
  function initWebpack() {
    if (state.wreq && state.wreq.c) return state.wreq;
    try {
      if (window.webpackChunkdiscord_app) {
        window.webpackChunkdiscord_app.push([
          [Math.random()],
          {},
          (r) => {
            state.wreq = r;
          }
        ]);
      }
    } catch (e) {
      console.warn('[EmojiDownloader] Webpack hook error:', e);
    }
    return state.wreq;
  }

  function findModule(filterFn) {
    const wreq = initWebpack();
    if (!wreq || !wreq.c) return null;
    for (const id in wreq.c) {
      const entry = wreq.c[id];
      if (!entry) continue;
      const exports = entry.exports;
      if (!exports) continue;

      try {
        if (filterFn(exports)) return exports;
      } catch (_) {}

      try {
        if (exports.default && filterFn(exports.default)) return exports.default;
      } catch (_) {}
    }
    return null;
  }

  function getGuildStore() {
    return (
      findModule((m) => typeof m.getGuilds === 'function' && typeof m.getGuild === 'function') ||
      findModule((m) => m.getName && m.getName() === 'GuildStore') ||
      findModule((m) => m?.constructor?.displayName === 'GuildStore')
    );
  }

  function getSelectedGuildStore() {
    return (
      findModule((m) => typeof m.getGuildId === 'function' && typeof m.getLastSelectedGuildId === 'function') ||
      findModule((m) => typeof m.getGuildId === 'function') ||
      findModule((m) => m.getName && m.getName() === 'SelectedGuildStore')
    );
  }

  function getEmojiStore() {
    return (
      findModule((m) => typeof m.getGuildEmoji === 'function') ||
      findModule((m) => typeof m.getUsableCustomGuildEmoji === 'function') ||
      findModule((m) => m.getName && (m.getName() === 'GuildEmojiStore' || m.getName() === 'EmojiStore'))
    );
  }

  function getStickerStore() {
    return (
      findModule((m) => typeof m.getStickersByGuildId === 'function') ||
      findModule((m) => m.getName && m.getName() === 'StickerStore')
    );
  }

  /**
   * Robust Token Extraction
   * Tries network cache -> Webpack cache -> Direct storage -> Hidden iframe storage
   */
  function getToken() {
    if (state.token) return state.token;

    // 1. Try Webpack module cache
    try {
      const wreq = initWebpack();
      if (wreq && wreq.c) {
        for (const id in wreq.c) {
          const m = wreq.c[id]?.exports;
          if (!m) continue;
          try {
            if (typeof m.getToken === 'function') {
              const t = m.getToken();
              if (t && typeof t === 'string' && t.length > 20) {
                state.token = t;
                return t;
              }
            }
            if (m.default && typeof m.default.getToken === 'function') {
              const t = m.default.getToken();
              if (t && typeof t === 'string' && t.length > 20) {
                state.token = t;
                return t;
              }
            }
          } catch (_) {}
        }
      }
    } catch (_) {}

    // 2. Try direct localStorage
    try {
      let t = window.localStorage.getItem('token');
      if (t) {
        try { t = JSON.parse(t); } catch (_) {}
        if (typeof t === 'string' && t.length > 20) {
          state.token = t;
          return t;
        }
      }
    } catch (_) {}

    // 3. Try clean hidden iframe localStorage
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      (document.body || document.documentElement).appendChild(iframe);
      let ifToken = iframe.contentWindow?.localStorage?.getItem('token');
      if (ifToken) {
        try { ifToken = JSON.parse(ifToken); } catch (_) {}
        if (typeof ifToken === 'string' && ifToken.length > 20) {
          state.token = ifToken;
        }
      }
      iframe.remove();
      if (state.token) return state.token;
    } catch (_) {}

    return null;
  }

  /**
   * Extract active guild ID from Discord store or current URL
   */
  function getCurrentGuildId() {
    // 1. Try SelectedGuildStore
    try {
      const selStore = getSelectedGuildStore();
      if (selStore) {
        const id = (selStore.getGuildId && selStore.getGuildId()) ||
                   (selStore.getLastSelectedGuildId && selStore.getLastSelectedGuildId());
        if (id && id !== '@me' && typeof id === 'string') {
          return id;
        }
      }
    } catch (_) {}

    // 2. Parse from window.location.pathname (/channels/{guildId}/{channelId})
    const match = window.location.pathname.match(/\/channels\/(\d{16,21})/);
    if (match && match[1]) {
      return match[1];
    }

    const fallbackMatch = window.location.pathname.match(/\/channels\/(\d+)/);
    if (fallbackMatch && fallbackMatch[1]) {
      return fallbackMatch[1];
    }

    return null;
  }

  function getServerNameFromDom() {
    try {
      const headerTitle = document.querySelector(
        'header h1, [class*="headerContent"] h1, [class*="guildName"], [data-list-item-id^="channels___"] h2'
      );
      if (headerTitle && headerTitle.textContent) {
        const text = headerTitle.textContent.trim();
        if (text) return text;
      }
      const title = document.title;
      if (title && title.includes('|')) {
        return title.split('|')[0].trim();
      }
    } catch (_) {}
    return null;
  }

  /**
   * Extract list of servers (guilds)
   */
  function getGuilds() {
    const list = [];
    const seen = new Set();

    // 1. Try GuildStore
    try {
      const guildStore = getGuildStore();
      if (guildStore && typeof guildStore.getGuilds === 'function') {
        const rawGuilds = guildStore.getGuilds();
        const rawList = rawGuilds instanceof Map ? Array.from(rawGuilds.values()) : Object.values(rawGuilds || {});
        for (const g of rawList) {
          if (g && g.id && !seen.has(g.id)) {
            seen.add(g.id);
            list.push({
              id: g.id,
              name: g.name || `Server ${g.id}`,
              icon: g.icon,
              ownerId: g.ownerId
            });
          }
        }
      }
    } catch (e) {
      console.warn('[EmojiDownloader] getGuilds store error:', e);
    }

    // 2. Ensure current guild is in the list
    const activeId = getCurrentGuildId();
    if (activeId && !seen.has(activeId)) {
      const domName = getServerNameFromDom() || 'Current Server';
      list.unshift({
        id: activeId,
        name: domName,
        icon: null
      });
      seen.add(activeId);
    }

    return list;
  }

  /**
   * Fetch emojis directly from Discord REST API
   */
  async function fetchGuildEmojisFromApi(guildId, token) {
    if (!guildId) return [];
    const authToken = token || getToken();
    const headers = {};
    if (authToken) headers['Authorization'] = authToken;

    const res = await originalFetch(`/api/v9/guilds/${guildId}/emojis`, {
      headers,
      credentials: 'include'
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return await res.json();
  }

  /**
   * Fetch stickers directly from Discord REST API
   */
  async function fetchGuildStickersFromApi(guildId, token) {
    if (!guildId) return [];
    const authToken = token || getToken();
    const headers = {};
    if (authToken) headers['Authorization'] = authToken;

    const res = await originalFetch(`/api/v9/guilds/${guildId}/stickers`, {
      headers,
      credentials: 'include'
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return await res.json();
  }

  /**
   * Comprehensive getter for guild emojis and stickers
   */
  async function getGuildAssets(guildId) {
    if (!guildId) {
      return { guildId: null, emojis: [], stickers: [] };
    }

    let emojis = [];
    let stickers = [];

    // 1. Check Guild object directly in GuildStore (in-memory)
    try {
      const guildStore = getGuildStore();
      if (guildStore && typeof guildStore.getGuild === 'function') {
        const guild = guildStore.getGuild(guildId);
        if (guild) {
          if (Array.isArray(guild.emojis) && guild.emojis.length > 0) {
            emojis = guild.emojis;
          }
          if (Array.isArray(guild.stickers) && guild.stickers.length > 0) {
            stickers = guild.stickers;
          }
        }
      }
    } catch (e) {
      console.warn('[EmojiDownloader] GuildStore assets lookup error:', e);
    }

    // 2. Check EmojiStore if emojis still empty
    if (!emojis || emojis.length === 0) {
      try {
        const emojiStore = getEmojiStore();
        if (emojiStore) {
          if (typeof emojiStore.getGuildEmoji === 'function') {
            const res = emojiStore.getGuildEmoji(guildId);
            if (res) {
              const list = Array.isArray(res) ? res : Object.values(res);
              if (list.length > 0) emojis = list;
            }
          }
          if ((!emojis || emojis.length === 0) && typeof emojiStore.getUsableCustomGuildEmoji === 'function') {
            const res = emojiStore.getUsableCustomGuildEmoji(guildId);
            if (res && res.length > 0) emojis = res;
          }
        }
      } catch (e) {
        console.warn('[EmojiDownloader] EmojiStore lookup error:', e);
      }
    }

    // 3. Check StickerStore if stickers still empty
    if (!stickers || stickers.length === 0) {
      try {
        const stickerStore = getStickerStore();
        if (stickerStore && typeof stickerStore.getStickersByGuildId === 'function') {
          const res = stickerStore.getStickersByGuildId(guildId);
          if (res && Array.isArray(res) && res.length > 0) {
            stickers = res;
          }
        }
      } catch (e) {
        console.warn('[EmojiDownloader] StickerStore lookup error:', e);
      }
    }

    // 4. Fallback to Discord REST API
    const token = getToken();
    if ((!emojis || emojis.length === 0) && guildId) {
      try {
        emojis = await fetchGuildEmojisFromApi(guildId, token);
      } catch (err) {
        console.warn('[EmojiDownloader] Fallback API emoji fetch failed:', err);
      }
    }
    if ((!stickers || stickers.length === 0) && guildId) {
      try {
        stickers = await fetchGuildStickersFromApi(guildId, token);
      } catch (err) {
        console.warn('[EmojiDownloader] Fallback API sticker fetch failed:', err);
      }
    }

    return {
      guildId,
      emojis: (emojis || []).map((e) => ({
        id: e.id,
        name: e.name,
        animated: Boolean(e.animated),
        available: e.available !== false
      })),
      stickers: (stickers || []).map((s) => ({
        id: s.id,
        name: s.name,
        format_type: s.format_type || s.formatType || 1,
        description: s.description || ''
      }))
    };
  }

  /**
   * Upload an emoji to a target Discord guild
   * @param {string} guildId
   * @param {{ name: string, image: string }} emojiData - image must be data URI
   * @returns {Promise<{ success: boolean, emoji?: object, rateLimited?: boolean, retryAfter?: number, error?: string, forbidden?: boolean }>}
   */
  async function uploadGuildEmoji(guildId, emojiData) {
    if (!guildId) throw new Error('Missing target guild ID');
    if (!emojiData || !emojiData.name || !emojiData.image) {
      throw new Error('Missing emoji name or image data');
    }

    const token = getToken();
    const headers = {
      'Content-Type': 'application/json'
    };
    if (token) headers['Authorization'] = token;

    const payload = JSON.stringify({
      name: emojiData.name,
      image: emojiData.image,
      roles: []
    });

    const res = await originalFetch(`/api/v9/guilds/${guildId}/emojis`, {
      method: 'POST',
      headers,
      body: payload,
      credentials: 'include'
    });

    let json = {};
    try {
      json = await res.json();
    } catch (_) {}

    if (res.status === 201 || res.status === 200) {
      return {
        success: true,
        emoji: {
          id: json.id,
          name: json.name,
          animated: Boolean(json.animated)
        }
      };
    }

    if (res.status === 429) {
      const retryAfter = (json && (json.retry_after || json.retryAfter)) || 1.5;
      return {
        success: false,
        rateLimited: true,
        retryAfter: typeof retryAfter === 'number' ? retryAfter : parseFloat(retryAfter) || 2,
        error: `Rate limited by Discord. Retrying in ${retryAfter}s...`
      };
    }

    if (res.status === 403) {
      return {
        success: false,
        forbidden: true,
        error: 'Missing Permissions: You need "Manage Expressions" on this server.'
      };
    }

    const errMsg = json?.message || `Discord API error (${res.status})`;
    return {
      success: false,
      error: errMsg
    };
  }

  /**
   * Message Listener for Content Script requests
   */
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'DISCORD_EMOJI_DOWNLOADER_REQUEST') return;

    const { requestId, action, guildId } = data;

    try {
      if (action === 'GET_STATE') {
        const currentGuildId = getCurrentGuildId();
        const guilds = getGuilds();
        const token = getToken();

        let currentAssets = { emojis: [], stickers: [] };
        if (currentGuildId) {
          currentAssets = await getGuildAssets(currentGuildId);
        }

        window.postMessage({
          type: 'DISCORD_EMOJI_DOWNLOADER_RESPONSE',
          requestId,
          success: true,
          currentGuildId,
          guilds,
          hasToken: Boolean(token),
          emojis: currentAssets.emojis,
          stickers: currentAssets.stickers
        }, '*');
      } else if (action === 'GET_GUILD_DATA') {
        const targetGuildId = guildId || getCurrentGuildId();
        if (!targetGuildId) {
          throw new Error('No target guild selected or available.');
        }
        const assets = await getGuildAssets(targetGuildId);
        window.postMessage({
          type: 'DISCORD_EMOJI_DOWNLOADER_RESPONSE',
          requestId,
          success: true,
          guildId: targetGuildId,
          emojis: assets.emojis,
          stickers: assets.stickers
        }, '*');
      } else if (action === 'UPLOAD_EMOJI') {
        const { targetGuildId, emojiData } = data;
        const uploadRes = await uploadGuildEmoji(targetGuildId, emojiData);
        window.postMessage({
          type: 'DISCORD_EMOJI_DOWNLOADER_RESPONSE',
          requestId,
          ...uploadRes
        }, '*');
      }
    } catch (error) {
      window.postMessage({
        type: 'DISCORD_EMOJI_DOWNLOADER_RESPONSE',
        requestId,
        success: false,
        error: error.message || 'Unknown error occurred in page world.'
      }, '*');
    }
  });

  // Signal that injected script is ready
  window.postMessage({
    type: 'DISCORD_EMOJI_DOWNLOADER_READY'
  }, '*');
})();
