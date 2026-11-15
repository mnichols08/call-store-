// Photo upload and the copy button. A photo is redrawn at a sensible size before it is sent (that
// also drops everything the camera wrote into it, such as location) and sent as the image itself.
(() => {
const MAX_EDGE = 1600;
const status = (box, text) => { const el = box.closest('section, .panel')?.querySelector('[data-upload-status]'); if (el) el.textContent = text; };

async function shrink(file) {
  if (!('createImageBitmap' in window)) return file.size <= 5.5 * 1024 * 1024 ? file : null;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

for (const input of document.querySelectorAll('input[data-upload]')) {
  input.addEventListener('change', async () => {
    const files = [...input.files];
    let sent = 0;
    for (const [i, file] of files.entries()) {
      status(input, `Sending photo ${i + 1} of ${files.length}…`);
      const body = await shrink(file);
      if (!body) { status(input, 'That photo couldn’t be read. Try a JPEG or PNG.'); continue; }
      try {
        const r = await fetch(input.dataset.upload, { method: 'POST', headers: { 'content-type': body.type || 'image/jpeg', accept: 'application/json' }, body });
        if (r.ok) sent += 1;
        else status(input, r.status === 429 ? 'Slow down a little, then try again.' : (await r.json().catch(() => ({}))).error === 'photo-many' ? 'That’s the most photos we can take.' : 'That photo couldn’t be sent.');
      } catch {
        status(input, 'No connection. Try again.');
      }
    }
    input.value = '';
    if (sent) location.reload();
  });
}

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const field = document.getElementById(button.dataset.copy);
    field.select();
    try { await navigator.clipboard.writeText(field.value); button.textContent = 'Copied'; } catch { button.textContent = 'Press Ctrl+C'; }
  });
}
})();
