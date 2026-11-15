(() => {
// Pages that show shared work reload when a coworker changes it. A call you are typing into never
// reloads under you: it says so and lets you choose.
const callForm = document.getElementById('call-form');
const callId = callForm?.dataset.call;
const watching = document.getElementById('watch-view')?.dataset.call;
let timer;
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') && document.activeElement.type !== 'checkbox';

function banner() {
  if (document.getElementById('stale-banner')) return;
  const note = document.createElement('p');
  note.id = 'stale-banner';
  note.className = 'flash problem';
  note.setAttribute('role', 'status');
  note.append('A coworker just changed this call. ');
  const link = document.createElement('a');
  link.href = '';
  link.textContent = 'Reload to see it';
  note.append(link);
  document.getElementById('main').prepend(note);
}

new EventSource('/events').addEventListener('message', (message) => {
  let event;
  try {
    event = JSON.parse(message.data);
  } catch {
    return;
  }
  if (watching) {
    if (event.type === 'call' && String(event.id) === watching && !typing()) { clearTimeout(timer); timer = setTimeout(() => location.reload(), 400); }
    return;
  }
  if (callForm) {
    if (event.type === 'watch' && String(event.id) === callId) { window.refreshWatchers?.(); return; }
    if (event.type !== 'call' || String(event.id) !== callId) return;
    if (event.why === 'parts' && event.by === callForm.dataset.me) return; // my own search, already on my page
    if (window.callBusy?.()) return;
    banner();
    return;
  }
  if (!['call', 'customer'].includes(event.type) || typing()) return;
  clearTimeout(timer);
  timer = setTimeout(() => location.reload(), 500);
});
})();
