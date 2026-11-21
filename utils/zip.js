/**
 * Zero-Dependency In-Browser PKZip Generator
 * Generates standard PKZip 2.0 archives with full UTF-8 filename support,
 * subdirectories, and CRC32 checksums.
 * 
 * Works in both Content Script and Extension Popup contexts.
 */
class MiniZip {
  constructor() {
    this.files = [];
  }

  /**
   * Add a file to the archive
   * @param {string} path - Relative file path inside the ZIP (e.g. 'emojis/pepe.png')
   * @param {Uint8Array|ArrayBuffer|Blob|string} data - File binary data or string
   */
  async addFile(path, data) {
    let uint8;
    if (data instanceof Uint8Array) {
      uint8 = data;
    } else if (data instanceof ArrayBuffer) {
      uint8 = new Uint8Array(data);
    } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
      const buffer = await data.arrayBuffer();
      uint8 = new Uint8Array(buffer);
    } else if (typeof data === 'string') {
      uint8 = new TextEncoder().encode(data);
    } else {
      throw new Error(`Unsupported data type for MiniZip file: ${typeof data}`);
    }

    // Normalize path: replace backslashes with forward slashes and remove leading slash
    const cleanPath = path.replace(/\\/g, '/').replace(/^\/+/, '');
    this.files.push({ name: cleanPath, data: uint8 });
  }

  /**
   * Standard CRC32 table & computation
   */
  static getCrcTable() {
    if (!MiniZip._crcTable) {
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
          c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        table[i] = c >>> 0;
      }
      MiniZip._crcTable = table;
    }
    return MiniZip._crcTable;
  }

  static crc32(buf) {
    const table = MiniZip.getCrcTable();
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }

  /**
   * Generates the raw ZIP binary data as Uint8Array
   * @param {Function} [progressCallback] - Optional callback(percent, current, total)
   * @returns {Uint8Array}
   */
  generateUint8Array(progressCallback) {
    const parts = [];
    const central = [];
    let offset = 0;
    const textEnc = new TextEncoder();

    // Standard DOS timestamp
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

    const total = this.files.length;
    for (let i = 0; i < total; i++) {
      const file = this.files[i];
      const nameBytes = textEnc.encode(file.name);
      const crc = MiniZip.crc32(file.data);
      const size = file.data.length;

      // Local file header (30 bytes + filename)
      const local = new Uint8Array(30 + nameBytes.length);
      const lView = new DataView(local.buffer);
      lView.setUint32(0, 0x04034b50, true); // Local file header signature
      lView.setUint16(4, 20, true);         // Version needed: 2.0
      lView.setUint16(6, 0x0800, true);      // UTF-8 flag
      lView.setUint16(8, 0, true);           // Compression: Store (0)
      lView.setUint16(10, dosTime, true);    // Mod time
      lView.setUint16(12, dosDate, true);    // Mod date
      lView.setUint32(14, crc, true);        // CRC-32
      lView.setUint32(18, size, true);       // Compressed size
      lView.setUint32(22, size, true);       // Uncompressed size
      lView.setUint16(26, nameBytes.length, true); // Filename length
      lView.setUint16(28, 0, true);          // Extra field length
      local.set(nameBytes, 30);

      parts.push(local);
      parts.push(file.data);

      // Central directory file header (46 bytes + filename)
      const cd = new Uint8Array(46 + nameBytes.length);
      const cdView = new DataView(cd.buffer);
      cdView.setUint32(0, 0x02014b50, true); // Central header signature
      cdView.setUint16(4, 20, true);         // Version made by
      cdView.setUint16(6, 20, true);         // Version needed: 2.0
      cdView.setUint16(8, 0x0800, true);      // UTF-8 flag
      cdView.setUint16(10, 0, true);         // Compression: Store (0)
      cdView.setUint16(12, dosTime, true);
      cdView.setUint16(14, dosDate, true);
      cdView.setUint32(16, crc, true);
      cdView.setUint32(20, size, true);
      cdView.setUint32(24, size, true);
      cdView.setUint16(28, nameBytes.length, true);
      cdView.setUint16(30, 0, true);          // Extra field length
      cdView.setUint16(32, 0, true);          // File comment length
      cdView.setUint16(34, 0, true);          // Disk number start
      cdView.setUint16(36, 0, true);          // Internal file attributes
      cdView.setUint32(38, 0, true);          // External file attributes
      cdView.setUint32(42, offset, true);     // Relative offset of local header
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length + file.data.length;

      if (progressCallback && i % 10 === 0) {
        progressCallback(Math.round(((i + 1) / total) * 100), i + 1, total);
      }
    }

    const centralOffset = offset;
    const centralSize = central.reduce((sum, c) => sum + c.length, 0);

    // End of Central Directory Record (22 bytes)
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
    eocdView.setUint16(4, 0, true);          // Disk number
    eocdView.setUint16(6, 0, true);          // Disk with start of central directory
    eocdView.setUint16(8, this.files.length, true);  // Number of entries on this disk
    eocdView.setUint16(10, this.files.length, true); // Total number of entries
    eocdView.setUint32(12, centralSize, true);       // Central directory size
    eocdView.setUint32(16, centralOffset, true);     // Offset of central directory
    eocdView.setUint16(20, 0, true);                 // Comment length

    // Assemble final output
    const totalBytes = offset + centralSize + 22;
    const finalBuffer = new Uint8Array(totalBytes);
    let pointer = 0;
    for (const p of parts) {
      finalBuffer.set(p, pointer);
      pointer += p.length;
    }
    for (const c of central) {
      finalBuffer.set(c, pointer);
      pointer += c.length;
    }
    finalBuffer.set(eocd, pointer);

    if (progressCallback) {
      progressCallback(100, total, total);
    }
    return finalBuffer;
  }

  /**
   * Generates a Blob ready for browser download
   * @param {string} [mimeType='application/zip']
   * @param {Function} [progressCallback]
   * @returns {Blob}
   */
  generateBlob(mimeType = 'application/zip', progressCallback) {
    const bytes = this.generateUint8Array(progressCallback);
    return new Blob([bytes], { type: mimeType });
  }

  /**
   * Triggers a direct download in the browser
   * @param {string} filename - e.g. 'emojis.zip'
   * @param {Function} [progressCallback]
   */
  download(filename, progressCallback) {
    const blob = this.generateBlob('application/zip', progressCallback);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'discord_emojis.zip';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MiniZip;
}
