// Choosing a picture: it is cropped to a square and shrunk here, in the browser, so only a small
// image is ever sent.
(() => {
  const input = document.querySelector('[data-avatar-file]');
  if (!input) return;
  const form = input.form;
  const field = form.querySelector('input[name="picture"]');
  const status = form.querySelector('[data-avatar-status]');
  const say = (text) => { if (status) status.textContent = text; };
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return say('Choose a photo.');
    say('Getting it ready…');
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const side = Math.min(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 192;
      canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 192, 192);
      field.value = canvas.toDataURL('image/jpeg', 0.85);
      form.submit();
    } catch {
      say('That photo couldn’t be read. Try another one.');
    }
  });
})();
