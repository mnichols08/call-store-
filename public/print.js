(() => {
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-print]')) window.print();
});
if (new URLSearchParams(location.search).has('auto')) addEventListener('load', () => setTimeout(() => window.print(), 300));
})();
