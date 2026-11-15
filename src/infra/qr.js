// A QR code as an inline SVG, made here so the address in it never goes to another service.
import qrcode from 'qrcode-generator';

export function qrSvg(text, { label = 'QR code' } = {}) {
  const qr = qrcode(0, 'M'); // type 0 picks the smallest version that fits
  qr.addData(String(text), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const size = n + quiet * 2;
  let path = '';
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) if (qr.isDark(y, x)) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  }
  return `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label.replace(/[<>&"]/g, '')}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
