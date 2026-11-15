// Nudges that reach you while a page is open (a toast), and the switch for browser notifications
// when it's closed. A nudge is also kept on Today until you say "Got it".
(() => {
const toasts = document.getElementById('toasts');
const post = (path, body) => fetch(path, { method: 'POST', headers: { accept: 'application/json' }, body: new URLSearchParams(body) });

function toast(nudge) {
  if (!toasts) return;
  const box = document.createElement('div');
  box.className = 'toast';
  box.setAttribute('role', 'alert');
  const text = document.createElement('span');
  const who = document.createElement('strong');
  who.textContent = nudge.from;
  text.append(who, ` ${nudge.message || (nudge.callId ? 'wants you to look at this call.' : 'wants a word.')} `);
  if (nudge.callId) {
    const link = document.createElement('a');
    link.href = `/calls/${nudge.callId}`;
    link.textContent = `Call #${nudge.callId}`;
    text.append(link);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'link';
  close.textContent = 'Got it';
  close.addEventListener('click', () => {
    post(`/nudges/${nudge.id}/dismiss`, {}).catch(() => {});
    box.remove();
  });
  box.append(text, close);
  toasts.append(box);
}

new EventSource('/events').addEventListener('message', (message) => {
  try {
    const event = JSON.parse(message.data);
    if (event.type === 'nudge') toast(event);
  } catch {}
});

// Browser notifications (Web Push).
const panel = document.getElementById('push-panel');
if (panel && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
  const button = document.getElementById('push-toggle');
  const state = document.getElementById('push-state');
  const key64 = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const registration = navigator.serviceWorker.register('/sw.js');
  async function refresh() {
    const sub = await (await registration).pushManager.getSubscription();
    panel.hidden = false;
    button.textContent = sub ? 'Turn off' : 'Turn on';
    state.textContent = Notification.permission === 'denied' ? 'Notifications are blocked for this site in your browser settings.' : sub ? 'On. You’ll be notified here even when this tab is closed.' : 'Get a nudge even when this tab is closed.';
    button.disabled = Notification.permission === 'denied';
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const reg = await registration;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await post('/push/unsubscribe', { endpoint: existing.endpoint });
        await existing.unsubscribe();
      } else if ((await Notification.requestPermission()) === 'granted') {
        const { key } = await (await fetch('/push/key', { headers: { accept: 'application/json' } })).json();
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key64(key) });
        await post('/push/subscribe', { subscription: JSON.stringify(sub) });
      }
    } catch {
      state.textContent = 'That didn’t work on this browser.';
    }
    button.disabled = false;
    refresh().catch(() => {});
  });
  refresh().catch(() => {});
}
})();
