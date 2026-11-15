// A QR code as an inline SVG, made here (with the shop's own Symbology library) so the address in it
// never goes to another service. Symbology writes byte mode at error-correction level M, versions 1
// to 10, which holds up to 213 bytes: far more than a join link.
import { loadQr } from '@journey-to-code/symbology';

const qr = await loadQr();
export const QR_MAX_BYTES = 213;

/** The code for `text` as an <svg>, or null when it is too long to fit one. */
export function qrSvg(text, { label = 'QR code' } = {}) {
  const bytes = new TextEncoder().encode(String(text));
  if (!bytes.length || bytes.length > QR_MAX_BYTES) return null;
  return qr.svg(qr.encode(bytes), { title: String(label) });
}

/** Read a code back from a grayscale frame (used to check what we draw can be scanned). */
export const qrReadFrame = (frame) => qr.decodeText(frame);
