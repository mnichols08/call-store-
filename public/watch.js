// Keeps "I'm watching" true while a watched call is open in a tab, and says so when the tab is closed.
(() => {
const view = document.getElementById('watch-view');
if (!view) return;
const id = view.dataset.call;
const ping = () => fetch(`/calls/${id}/watch/ping`, { method: 'POST', headers: { accept: 'application/json' } }).catch(() => {});
setInterval(() => { if (!document.hidden) ping(); }, 45000);
})();
