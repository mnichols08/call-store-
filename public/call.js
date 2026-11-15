(() => {
// The call workspace: saves as you type, and looks the caller up as you type their number.
document.documentElement.classList.add('js');

const form = document.getElementById('call-form');
const state = document.getElementById('save-state');
let dirty = false;
let saving = false;
let lastSave = 0;
let timer;
let conflict = false;

window.callBusy = () => dirty || saving || Date.now() - lastSave < 2000;

function say(text, bad = false) {
  if (!state) return;
  state.textContent = text;
  state.classList.toggle('bad', bad);
}

async function save() {
  if (!form || saving || conflict) return;
  clearTimeout(timer);
  dirty = false;
  saving = true;
  say('Saving…');
  try {
    const body = new URLSearchParams(new FormData(form));
    const response = await fetch(form.action, { method: 'POST', body, headers: { Accept: 'application/json' }, credentials: 'same-origin', keepalive: true });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.ok) {
      form.elements.revision.value = result.revision;
      say('Saved');
    } else if (result.error === 'stale') {
      conflict = true;
      say('A coworker changed this call. Copy what you typed, then reload.', true);
    } else if (result.error === 'closed') {
      say('This call is closed.', true);
    } else if (response.status === 401) {
      say('You’ve been signed out. Sign in again; this page keeps what you typed.', true);
      dirty = true;
    } else {
      say('Couldn’t save that. Check the quantity.', true);
    }
  } catch {
    dirty = true;
    say('Offline. Will try again.', true);
    timer = setTimeout(save, 4000);
  } finally {
    saving = false;
    lastSave = Date.now();
    if (dirty && !conflict && !timer) timer = setTimeout(save, 800);
  }
}

form?.addEventListener('input', () => {
  dirty = true;
  say('Typing…');
  clearTimeout(timer);
  timer = setTimeout(save, 800);
});
form?.addEventListener('submit', (event) => {
  event.preventDefault();
  save();
});
addEventListener('pagehide', () => dirty && save());

// Caller lookup: phone in any format, a name, or an account.
const box = document.querySelector('[data-lookup]');
const results = document.getElementById('results');
const callId = box?.dataset.lookup;
let wait;
box?.addEventListener('input', () => {
  clearTimeout(wait);
  const q = box.value.trim();
  if (q.length < 2) {
    results.replaceChildren();
    return;
  }
  wait = setTimeout(async () => {
    const response = await fetch(`/api/customers?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }).catch(() => null);
    if (!response?.ok || box.value.trim() !== q) return;
    const { customers } = await response.json();
    results.replaceChildren(...customers.map((c) => row(c)));
    if (!customers.length) {
      const none = document.createElement('li');
      none.className = 'muted';
      none.textContent = 'No match. Keep going without one.';
      results.append(none);
    }
  }, 150);
});

function row(c) {
  const li = document.createElement('li');
  const who = document.createElement('span');
  const name = document.createElement('strong');
  name.textContent = c.name;
  const detail = document.createElement('small');
  detail.textContent = [c.account_no && `Account ${c.account_no}`, ...c.phones, c.open_calls && `${c.open_calls} open`].filter(Boolean).join(' · ');
  who.append(name, detail);
  const post = document.createElement('form');
  post.method = 'post';
  post.action = `/calls/${callId}/action`;
  for (const [key, value] of [['action', 'customer'], ['customer', c.id]]) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = value;
    post.append(input);
  }
  const use = document.createElement('button');
  use.textContent = 'This is them';
  post.append(use);
  li.append(who, post);
  return li;
}
})();

// Who is watching this call. Updated when a coworker opens or leaves it.
window.refreshWatchers = async () => {
  const line = document.getElementById('watchers');
  if (!line) return;
  try {
    const r = await fetch(`/calls/${line.dataset.call}/watchers`, { headers: { accept: 'application/json' } });
    const { names = [] } = await r.json();
    line.textContent = names.length ? `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} watching this call.` : '';
  } catch {}
};
