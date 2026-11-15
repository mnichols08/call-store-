// Dark navy or pale blue, following the system until the person picks (the same behaviour as the
// drawer counter). Loaded in <head> without defer so the right theme is set before first paint.
(() => {
  const KEY = 'cs-theme'; // 'system' | 'light' | 'dark'
  const root = document.documentElement;
  const read = () => {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch {
      return 'system';
    }
  };
  const effective = (mode) => (mode === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : mode);
  function apply() {
    const theme = effective(read());
    root.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b132b' : '#f7f9ff');
    for (const button of document.querySelectorAll('.theme-toggle')) {
      button.textContent = theme === 'dark' ? '🌙' : '☀️';
      button.setAttribute('aria-label', theme === 'dark' ? 'Dark theme. Switch to light.' : 'Light theme. Switch to dark.');
    }
    window.dispatchEvent(new CustomEvent('cs-theme', { detail: theme }));
  }
  apply();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => read() === 'system' && apply());
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    for (const button of document.querySelectorAll('.theme-toggle')) {
      button.addEventListener('click', () => {
        try {
          localStorage.setItem(KEY, effective(read()) === 'dark' ? 'light' : 'dark');
        } catch {}
        apply();
      });
    }
  });
})();
