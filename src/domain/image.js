// Photos from customers are untrusted bytes. Before one is kept it must really be a JPEG, PNG or
// WebP, and the metadata that can carry a location (EXIF, XMP, text chunks) is removed. Nothing
// here decodes pixels, so a hostile picture can't hurt the server.

export function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** The same picture without metadata, or null if the file is damaged. */
export function stripMetadata(buf, mime) {
  try {
    if (mime === 'image/jpeg') return stripJpeg(buf);
    if (mime === 'image/png') return stripPng(buf);
    if (mime === 'image/webp') return stripWebp(buf);
  } catch {}
  return null;
}

function stripJpeg(buf) {
  const out = [buf.subarray(0, 2)];
  let i = 2;
  let sawFrame = false;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    while (buf[i] === 0xff) i += 1; // fill bytes
    const marker = buf[i];
    i += 1;
    if (marker === 0xd9) { out.push(Buffer.from([0xff, 0xd9])); return sawFrame ? Buffer.concat(out) : null; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(Buffer.from([0xff, marker])); continue; }
    if (i + 2 > buf.length) return null;
    const length = buf.readUInt16BE(i);
    if (length < 2 || i + length > buf.length) return null;
    const segment = buf.subarray(i - 2, i + length);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) sawFrame = true;
    if (marker === 0xda) { // start of scan: the rest is compressed data, kept as it is
      out.push(buf.subarray(i - 2));
      return sawFrame ? Buffer.concat(out) : null;
    }
    const metadata = (marker >= 0xe1 && marker <= 0xed) || marker === 0xef || marker === 0xfe; // keeps JFIF (E0) and Adobe colour (EE)
    if (!metadata) out.push(segment);
    i += length;
  }
  return null;
}

const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'acTL', 'fcTL', 'fdAT']);
function stripPng(buf) {
  const out = [buf.subarray(0, 8)];
  let i = 8;
  let first = true;
  while (i + 12 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + length;
    if (end > buf.length || length > 0x7fffffff) return null;
    if (first && type !== 'IHDR') return null;
    first = false;
    if (PNG_KEEP.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') return Buffer.concat(out);
  }
  return null;
}

function stripWebp(buf) {
  const total = buf.readUInt32LE(4) + 8;
  if (total > buf.length || total < 20) return null;
  const chunks = [];
  let i = 12;
  while (i + 8 <= total) {
    const tag = buf.subarray(i, i + 4).toString('latin1');
    const size = buf.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);
    if (end > total + 1) return null;
    if (tag !== 'EXIF' && tag !== 'XMP ') {
      const chunk = Buffer.from(buf.subarray(i, Math.min(end, buf.length)));
      if (tag === 'VP8X') chunk[8] &= ~(0x08 | 0x04); // no EXIF, no XMP
      chunks.push(chunk);
    }
    i = end;
  }
  if (!chunks.length) return null;
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}
