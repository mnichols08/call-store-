// Fill the paste box from a chosen file, so a CSV never has to be opened and copied by hand.
(() => {
  const file = document.getElementById('import-file');
  const text = document.getElementById('import-text');
  if (!file || !text) return;
  file.addEventListener('change', async () => {
    const picked = file.files?.[0];
    if (!picked) return;
    if (picked.size > 600_000) { text.value = ''; alert('That file is too big for one import. Split it into smaller files.'); return; }
    text.value = await picked.text();
  });
})();
