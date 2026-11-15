// Take a photo of a notebook page, shrink it, send it to be read, and show the lines to check.
// The photo is redrawn first, which also drops everything the camera wrote into it, such as location.
(() => {
  const MAX_EDGE = 1600;
  const input = document.getElementById('sheet-file');
  const status = document.getElementById('sheet-status');
  const preview = document.getElementById('sheet-preview');
  const review = document.getElementById('sheet-review');
  if (!input) return;

  async function shrink(file) {
    if (!('createImageBitmap' in window)) return file.size <= 5.5 * 1024 * 1024 ? file : null;
    let bitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return null; }
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  }
  const dataUrl = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => resolve(''); r.readAsDataURL(blob); });

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    review.textContent = '';
    status.textContent = 'Getting the photo ready…';
    const body = await shrink(file);
    if (!body) { status.textContent = 'That picture couldn’t be used. Try taking it again.'; return; }
    const url = await dataUrl(body);
    if (url) { preview.src = url; preview.hidden = false; }
    status.textContent = 'Reading the page… this takes about a quarter of a minute.';
    input.disabled = true;
    try {
      const res = await fetch(input.dataset.read, { method: 'POST', headers: { 'content-type': body.type || 'image/jpeg', accept: 'application/json' }, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.html) { status.textContent = data.message || 'That didn’t work. Try again.'; return; }
      status.textContent = 'Check each line against the photo, then save.';
      review.innerHTML = data.html; // built and escaped on the server
      review.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      status.textContent = 'Couldn’t reach the server. Check your connection and try again.';
    } finally {
      input.disabled = false;
      input.value = '';
    }
  });
})();
