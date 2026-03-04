// Generate a 256x256 PNG icon for the app
// Run: node generate-icon.js

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Try to find a way to convert SVG to PNG
// Option 1: Check if ImageMagick/convert is available
// Option 2: Use a pure JS approach with a minimal 1-pixel PNG as fallback

// Create a minimal valid PNG (256x256, solid #1e3a5f background)
// PNG file structure: signature + IHDR + IDAT + IEND

function createMinimalPNG(width, height, r, g, b) {
  const zlib = require('zlib');

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);   // width
  ihdrData.writeUInt32BE(height, 4);  // height
  ihdrData[8] = 8;                     // bit depth
  ihdrData[9] = 2;                     // color type (RGB)
  ihdrData[10] = 0;                    // compression
  ihdrData[11] = 0;                    // filter
  ihdrData[12] = 0;                    // interlace
  const ihdr = createChunk('IHDR', ihdrData);

  // Image data: each row = filter_byte + RGB pixels
  const rowSize = 1 + width * 3;
  const rawData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const offset = y * rowSize;
    rawData[offset] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const px = offset + 1 + x * 3;
      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuffer, data]));
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate 256x256 icon with color #1e3a5f
const png = createMinimalPNG(256, 256, 0x1e, 0x3a, 0x5f);
const outputPath = path.join(__dirname, 'assets', 'icon.png');
fs.writeFileSync(outputPath, png);
console.log(`Icon created: ${outputPath} (${png.length} bytes)`);
