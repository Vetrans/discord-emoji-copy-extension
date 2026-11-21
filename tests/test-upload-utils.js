/**
 * Unit tests for DiscordApi Upload Utilities
 */
const assert = require('assert');
const DiscordApi = require('../utils/discord-api.js');
const MiniZip = require('../utils/zip.js');

console.log('--- Running Upload Utilities Tests ---');

// 1. Test sanitizeEmojiName
console.log('1. Testing sanitizeEmojiName...');
assert.strictEqual(DiscordApi.sanitizeEmojiName('pepe hype!'), 'pepe_hype');
assert.strictEqual(DiscordApi.sanitizeEmojiName('a'), 'a_'); // padded to at least 2 chars
assert.strictEqual(DiscordApi.sanitizeEmojiName(''), 'emoji'); // default fallback
assert.strictEqual(DiscordApi.sanitizeEmojiName('pepe-dance.gif'), 'pepe_dance');
assert.strictEqual(DiscordApi.sanitizeEmojiName('🔥🔥🔥'), 'emoji'); // pure unicode symbols fallback

const superLong = 'this_is_an_extremely_long_emoji_name_that_exceeds_thirty_two_characters_limit';
const sanitizedLong = DiscordApi.sanitizeEmojiName(superLong);
assert.strictEqual(sanitizedLong.length <= 32, true);
assert.strictEqual(/^[a-zA-Z0-9_]{2,32}$/.test(sanitizedLong), true);
console.log('✓ sanitizeEmojiName passed.');

// 2. Test binaryToDataUri
console.log('2. Testing binaryToDataUri...');
const testBytes = new Uint8Array([71, 73, 70, 56, 57, 97]); // "GIF89a"
const dataUri = DiscordApi.binaryToDataUri(testBytes, 'image/gif');
assert.strictEqual(dataUri.startsWith('data:image/gif;base64,'), true);
assert.strictEqual(dataUri.includes('R0lGOD'), true);
console.log('✓ binaryToDataUri passed.');

// 3. Test extractZipImages
console.log('3. Testing extractZipImages...');
(async () => {
  const zip = new MiniZip();
  await zip.addFile('emojis/smile.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])); // PNG magic
  await zip.addFile('readme.txt', 'This is not an image');

  const zipBuffer = zip.generateUint8Array();
  const extracted = await DiscordApi.extractZipImages(zipBuffer);

  assert.strictEqual(Array.isArray(extracted), true);
  assert.strictEqual(extracted.length, 1);
  assert.strictEqual(extracted[0].name, 'smile');
  assert.strictEqual(extracted[0].ext, 'png');
  assert.strictEqual(extracted[0].mimeType, 'image/png');
  assert.strictEqual(extracted[0].data instanceof Uint8Array, true);
  console.log('✓ extractZipImages passed.');

  console.log('ALL TESTS PASSED!');
})().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
