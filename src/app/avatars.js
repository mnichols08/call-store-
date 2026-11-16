// A person's own picture. The browser shrinks it to a small square before sending, and what arrives
// is checked again here: only a real JPEG, PNG or WebP, and only a small one, is kept.
export const AVATAR_MAX_BYTES = 120_000;

const KINDS = [
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];

/** `data:image/jpeg;base64,...` to `{ mime, bytes }`, or `{ error }`. The type comes from the bytes, never the label. */
export function readPicture(dataUrl) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? '').trim());
  if (!m) return { error: 'picture' };
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length < 16) return { error: 'picture' };
  if (bytes.length > AVATAR_MAX_BYTES) return { error: 'picture-size' };
  const kind = KINDS.find(([, is]) => is(bytes));
  return kind ? { ok: true, mime: kind[0], bytes } : { error: 'picture' };
}

export function createAvatars({ db, now }) {
  const owned = (owner) => /^(staff|portal):[A-Za-z0-9]{1,80}$/.test(owner);
  return {
    /** When the picture last changed (for the address, so a new one shows at once), or 0 for initials. */
    version: (owner) => db.prepare('SELECT updated_at FROM avatars WHERE owner = ?').get(owner)?.updated_at ?? 0,
    get: (owner) => db.prepare('SELECT mime, bytes, updated_at FROM avatars WHERE owner = ?').get(owner) ?? null,
    set(owner, dataUrl) {
      if (!owned(owner)) return { error: 'forbidden' };
      const pic = readPicture(dataUrl);
      if (pic.error) return pic;
      db.prepare('INSERT INTO avatars (owner, mime, bytes, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (owner) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes, updated_at = excluded.updated_at').run(owner, pic.mime, pic.bytes, now());
      return { ok: true };
    },
    remove(owner) {
      db.prepare('DELETE FROM avatars WHERE owner = ?').run(owner);
      return { ok: true };
    },
  };
}
