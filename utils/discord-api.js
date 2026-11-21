/**
 * Discord CDN & Asset Utilities
 * Formats, fetches, sanitizes, and batches emoji and sticker downloads.
 */

const DiscordApi = {
  CDN_URL: 'https://cdn.discordapp.com',
  MEDIA_URL: 'https://media.discordapp.net',

  /**
   * Generates direct Discord CDN URL for an emoji
   * @param {string} id - Emoji snowflake ID
   * @param {boolean} animated - Whether emoji is animated (GIF)
   * @param {number} size - Desired resolution: 32, 64, 128, 256, 512, 1024, 2048, 4096
   * @returns {string}
   */
  getEmojiUrl(id, animated = false, size = 256) {
    const ext = animated ? 'gif' : 'png';
    return `${this.CDN_URL}/emojis/${id}.${ext}?size=${size}&quality=lossless`;
  },

  /**
   * Generates direct Discord CDN URL for a server sticker
   * @param {string} id - Sticker snowflake ID
   * @param {number} formatType - 1 = PNG, 2 = APNG, 3 = LOTTIE, 4 = GIF
   * @param {number} size - Resolution
   * @returns {{ url: string, ext: string }}
   */
  getStickerInfo(id, formatType = 1, size = 512) {
    switch (formatType) {
      case 3: // LOTTIE JSON
        return {
          url: `${this.CDN_URL}/stickers/${id}.json`,
          ext: 'json'
        };
      case 4: // GIF
        return {
          url: `${this.MEDIA_URL}/stickers/${id}.gif?size=${size}`,
          ext: 'gif'
        };
      case 2: // APNG (served with .png)
      case 1: // PNG
      default:
        return {
          url: `${this.CDN_URL}/stickers/${id}.png?size=${size}`,
          ext: 'png'
        };
    }
  },

  /**
   * Generates server icon URL
   * @param {string} guildId
   * @param {string} iconHash
   * @param {number} size
   * @returns {string}
   */
  getGuildIconUrl(guildId, iconHash, size = 128) {
    if (!iconHash) return '';
    const isAnimated = iconHash.startsWith('a_');
    const ext = isAnimated ? 'gif' : 'png';
    return `${this.CDN_URL}/icons/${guildId}/${iconHash}.${ext}?size=${size}`;
  },

  /**
   * Sanitizes string into a safe file name across all operating systems
   * @param {string} name
   * @returns {string}
   */
  sanitizeFilename(name) {
    if (!name) return 'unnamed';
    return name
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, '_')
      .trim();
  },

  /**
   * Fetches an asset with retry logic and returns binary Uint8Array
   * @param {string} url
   * @param {number} retries
   * @returns {Promise<Uint8Array>}
   */
  async fetchBinary(url, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          cache: 'force-cache',
          credentials: 'omit'
        });
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status} fetching ${url}`);
        }
        const arrayBuf = await response.arrayBuffer();
        return new Uint8Array(arrayBuf);
      } catch (err) {
        if (attempt === retries) throw err;
        // Exponential backoff
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  },

  /**
   * Sanitizes string to conform to Discord's custom emoji naming rules:
   * 2 to 32 characters, strictly alphanumeric and underscores [a-zA-Z0-9_].
   * @param {string} rawName
   * @returns {string}
   */
  sanitizeEmojiName(rawName) {
    if (!rawName) return 'emoji';
    // 1. Remove file extension if present (e.g. .png, .gif)
    let clean = rawName.replace(/\.[a-zA-Z0-9]{2,5}$/, '');
    // 2. Replace spaces, hyphens, and dots with underscores
    clean = clean.replace(/[\s\-\.]+/g, '_');
    // 3. Keep only alphanumeric and underscore characters
    clean = clean.replace(/[^a-zA-Z0-9_]/g, '');
    // 4. Remove leading/trailing underscores and collapse multiples
    clean = clean.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    // 5. If empty, fallback
    if (!clean) clean = 'emoji';
    // 6. Enforce minimum 2 characters
    while (clean.length < 2) {
      clean += '_';
    }
    // 7. Enforce maximum 32 characters
    if (clean.length > 32) {
      clean = clean.slice(0, 32);
    }
    return clean;
  },

  /**
   * Converts a Uint8Array into a base64 Data URI string
   * @param {Uint8Array} uint8Array
   * @param {string} mimeType - e.g. 'image/png', 'image/gif'
   * @returns {string}
   */
  binaryToDataUri(uint8Array, mimeType = 'image/png') {
    let base64 = '';
    if (typeof Buffer !== 'undefined') {
      base64 = Buffer.from(uint8Array).toString('base64');
    } else {
      let binary = '';
      const len = uint8Array.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      base64 = btoa(binary);
    }
    return `data:${mimeType};base64,${base64}`;
  },

  /**
   * Reads a File or Blob as a Base64 Data URL
   * @param {File|Blob} file
   * @returns {Promise<string>}
   */
  fileToDataUri(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  },

  /**
   * Detects MIME type from file extension
   * @param {string} filename
   * @returns {string}
   */
  getMimeType(filename) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    switch (ext) {
      case 'gif': return 'image/gif';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'webp': return 'image/webp';
      case 'png':
      default: return 'image/png';
    }
  },

  /**
   * Extracts image files from a ZIP archive Uint8Array
   * @param {Uint8Array} zipBytes
   * @returns {Promise<Array<{ name: string, ext: string, mimeType: string, data: Uint8Array }>>}
   */
  async extractZipImages(zipBytes) {
    const results = [];
    const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
    let offset = 0;
    const len = zipBytes.length;
    const decoder = new TextDecoder('utf-8');

    while (offset + 30 <= len) {
      const sig = view.getUint32(offset, true);
      // 0x04034b50 is Local File Header
      if (sig === 0x04034b50) {
        const method = view.getUint16(offset + 8, true);
        const compSize = view.getUint32(offset + 18, true);
        const uncompSize = view.getUint32(offset + 22, true);
        const nameLen = view.getUint16(offset + 26, true);
        const extraLen = view.getUint16(offset + 28, true);

        const nameBytes = zipBytes.subarray(offset + 30, offset + 30 + nameLen);
        const rawPath = decoder.decode(nameBytes);
        const filename = rawPath.split('/').pop() || '';

        const dataStart = offset + 30 + nameLen + extraLen;
        const compressedData = zipBytes.subarray(dataStart, dataStart + compSize);

        const isImage = /\.(png|gif|jpe?g|webp)$/i.test(filename);
        if (isImage && compSize > 0) {
          let decompressed;
          if (method === 0) {
            // Store (uncompressed)
            decompressed = compressedData;
          } else if (method === 8 && typeof DecompressionStream !== 'undefined') {
            // Deflate compression
            try {
              const stream = new Response(compressedData).body.pipeThrough(new DecompressionStream('deflate-raw'));
              const buf = await new Response(stream).arrayBuffer();
              decompressed = new Uint8Array(buf);
            } catch (_) {
              decompressed = compressedData;
            }
          } else {
            decompressed = compressedData;
          }

          const ext = (filename.split('.').pop() || 'png').toLowerCase();
          const cleanName = DiscordApi.sanitizeEmojiName(filename);
          results.push({
            name: cleanName,
            ext,
            mimeType: DiscordApi.getMimeType(filename),
            data: decompressed
          });
        }

        offset = dataStart + compSize;
      } else {
        // Not a local file header; advance
        offset++;
      }
    }

    return results;
  },

  /**
   * Downloads multiple assets in parallel with a bounded concurrency pool
   * @param {Array<{ name: string, url: string, path: string }>} items
   * @param {number} concurrency - Max concurrent network requests (default: 5)
   * @param {Function} onProgress - Callback (current, total, currentItemName)
   * @returns {Promise<Array<{ path: string, data: Uint8Array, error?: Error }>>}
   */
  async batchDownload(items, concurrency = 5, onProgress = null) {
    const results = [];
    let completed = 0;
    const total = items.length;
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < total) {
        const index = nextIndex++;
        const item = items[index];
        try {
          if (onProgress) onProgress(completed, total, item.name);
          const data = await DiscordApi.fetchBinary(item.url);
          results[index] = { path: item.path, data };
        } catch (err) {
          console.warn(`Failed to download ${item.name} (${item.url}):`, err);
          results[index] = { path: item.path, error: err };
        }
        completed++;
        if (onProgress) onProgress(completed, total, item.name);
      }
    }

    const workers = [];
    const poolSize = Math.min(concurrency, total);
    for (let i = 0; i < poolSize; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return results.filter((r) => r && !r.error);
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DiscordApi;
}
