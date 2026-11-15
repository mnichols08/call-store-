// Keyboard shortcuts for the counter: N starts a new call, / jumps to search.
document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (target.closest('input, textarea, select, [contenteditable]')) return;
  if (event.key === 'n') {
    document.querySelector('.new-call')?.click();
    event.preventDefault();
  } else if (event.key === '/') {
    const search = document.querySelector('input[type=search], #find');
    if (search) {
      search.focus();
      event.preventDefault();
    }
  }
});
