// The sidebar on a narrow screen: the Menu button opens it, the scrim, Escape or a link closes it.
(() => {
  const button = document.querySelector('.menu-btn');
  const side = document.getElementById('side');
  if (!button || !side) return;
  const set = (open) => {
    document.body.classList.toggle('side-open', open);
    button.setAttribute('aria-expanded', String(open));
    if (!open) return;
    side.querySelector('a')?.focus();
  };
  button.addEventListener('click', () => set(!document.body.classList.contains('side-open')));
  document.querySelector('[data-shell-close]')?.addEventListener('click', () => set(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('side-open')) { set(false); button.focus(); }
  });
})();
