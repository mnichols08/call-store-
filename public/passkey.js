// Passkeys on the portal: set one up from a welcome link, or sign in with one. Shown only where the
// browser can make passkeys; everyone else uses the username and password form beside it.
(() => {
  const lib = window.SimpleWebAuthnBrowser;
  if (!lib || !lib.browserSupportsWebAuthn()) return;
  const post = async (url, fields) => {
    const body = new URLSearchParams(fields);
    const r = await fetch(url, { method: 'POST', body, headers: { accept: 'application/json' }, credentials: 'same-origin' });
    return r.json().catch(() => ({ error: 'network' }));
  };
  function wire(box, run) {
    box.hidden = false;
    const button = box.querySelector('[data-passkey-start]');
    const problem = box.querySelector('[data-passkey-problem]');
    const say = (text) => { problem.textContent = text; problem.hidden = !text; };
    button.addEventListener('click', async () => {
      button.disabled = true; say('');
      try {
        const done = await run(say);
        if (done && done.go) location.assign(done.go);
      } catch (error) {
        say(error && error.name === 'NotAllowedError' ? 'Cancelled. Try again when you’re ready.' : 'That didn’t work. Try again, or use a username and password.');
      } finally { button.disabled = false; }
    });
  }
  const join = document.querySelector('[data-passkey-join]');
  if (join) wire(join, async (say) => {
    const base = join.dataset.passkeyJoin;
    const name = document.getElementById('welcome-name');
    if (!name.value.trim()) { name.focus(); say('Please add your name first.'); return null; }
    const start = await post(`${base}/passkey-options`, { name: name.value });
    if (!start.options) { say(start.message || 'That didn’t work.'); return null; }
    const made = await lib.startRegistration({ optionsJSON: start.options });
    const done = await post(`${base}/passkey`, { handle: start.handle, response: JSON.stringify(made) });
    if (!done.ok) say(done.message || 'That didn’t work.');
    return done;
  });
  const login = document.querySelector('[data-passkey-login]');
  if (login) wire(login, async (say) => {
    const start = await post('/portal/passkey-options', {});
    if (!start.options) { say('Passkeys aren’t ready here. Use your username and password.'); return null; }
    const used = await lib.startAuthentication({ optionsJSON: start.options });
    const done = await post('/portal/passkey', { handle: start.handle, response: JSON.stringify(used) });
    if (!done.ok) say(done.message || 'That didn’t work.');
    return done;
  });
})();
