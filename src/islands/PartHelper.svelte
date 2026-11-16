<script>
  // The customer's "tell us about the part" helper: photos, an AI look at them, and the measurements.
  // The AI only suggests. Everything it fills in is marked until the customer touches it, and nothing
  // is sent until they press Send. The same size rules as the server (src/domain/measure.js).
  import { untrack } from 'svelte';
  import { PART_TYPES, fieldProblem, parseNumber } from '../domain/measure.js';

  // The page sets these once, when it draws the helper; they never change afterwards.
  const props = $props();
  const config = untrack(() => props.config);
  const base = config.base;
  const limit = config.limit ?? 8;
  const MAX_EDGE = 1600;

  const parts = Object.entries(PART_TYPES).filter(([, t]) => !t.service);
  const jobs = Object.entries(PART_TYPES).filter(([, t]) => t.service);

  // ---- photos
  let photos = $state((config.photos ?? []).map((p) => ({ id: p.id, src: p.src, state: 'sent' })));
  let alreadyCount = config.count ?? photos.length;
  let photoNote = $state('');
  const sentCount = $derived(Math.max(alreadyCount, 0) + photos.filter((p) => p.state === 'sent' && p.local).length);
  const room = $derived(limit - sentCount);

  async function shrink(file) {
    if (!('createImageBitmap' in window)) return file.size <= 5.5 * 1024 * 1024 ? file : null;
    let bitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return null; }
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  }

  async function upload(item) {
    item.state = 'sending';
    const body = await shrink(item.file);
    if (!body) { item.state = 'failed'; item.why = 'That photo couldn’t be read. Try a JPEG or PNG.'; return; }
    try {
      const r = await fetch(`${base}/photo`, { method: 'POST', headers: { 'content-type': body.type || 'image/jpeg', accept: 'application/json' }, body });
      if (r.ok) { const j = await r.json(); item.id = j.id; item.state = 'sent'; item.why = ''; return; }
      const j = await r.json().catch(() => ({}));
      item.state = 'failed';
      item.why = r.status === 429 ? 'Slow down a little, then try again.' : j.error === 'photo-many' ? 'That’s the most photos we can take.' : 'That photo couldn’t be sent.';
    } catch {
      item.state = 'failed';
      item.why = 'No connection. Try again.';
    }
  }

  async function pick(event) {
    const files = [...event.target.files].slice(0, Math.max(room, 0));
    event.target.value = '';
    photoNote = event.target.files && files.length === 0 && room <= 0 ? 'That’s the most photos we can take.' : '';
    for (const file of files) {
      const item = $state({ file, src: URL.createObjectURL(file), state: 'queued', local: true, why: '' });
      photos.push(item);
      await upload(photos[photos.length - 1]);
    }
  }
  const retry = (item) => upload(item);
  const sendingNow = $derived(photos.some((p) => p.state === 'sending' || p.state === 'queued'));

  // ---- the part
  const initial = config.initial ?? {};
  let type = $state(initial.type ?? '');
  let unit = $state(initial.unit === 'in' ? 'in' : 'mm');
  let values = $state({ ...(initial.values ?? {}) });
  let suggested = $state({}); // field keys the AI filled and the customer hasn't touched
  let note = $state(initial.note ?? '');
  const spec = $derived(type ? PART_TYPES[type] : null);
  const hasLength = $derived(spec?.fields.some((f) => f.kind === 'length') ?? false);

  function choose(key) {
    if (key === type) return;
    type = key;
    values = {};
    suggested = {};
  }
  const problem = (f) => fieldProblem(f, values[f.key] ?? '', unit);
  const converted = (f) => {
    const text = values[f.key];
    if (f.kind !== 'length' || !text || problem(f)) return '';
    const n = parseNumber(text);
    return unit === 'in' ? `${Math.round(n * 25.4 * 10) / 10} mm` : `${Math.round((n / 25.4) * 1000) / 1000} in`;
  };
  const anyProblem = $derived(spec ? spec.fields.some((f) => problem(f)) : false);
  const touched = (key) => { delete suggested[key]; };

  // ---- the AI look
  let looking = $state(false);
  let ai = $state(null);
  let aiError = $state('');
  async function look() {
    looking = true; aiError = ''; ai = null;
    try {
      const r = await fetch(`${base}/assist`, { method: 'POST', headers: { accept: 'application/json' } });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.suggestion) ai = j.suggestion;
      else aiError = j.message || 'I couldn’t look at that just now. You can still fill it in yourself.';
    } catch {
      aiError = 'No connection. Try again.';
    }
    looking = false;
  }
  function apply() {
    if (!ai?.type) return;
    type = ai.type;
    unit = ai.unit === 'in' ? 'in' : 'mm';
    values = { ...ai.values };
    suggested = Object.fromEntries(Object.keys(ai.values).map((k) => [k, true]));
    if (ai.markings.length && !note) note = `Stamped on it: ${ai.markings.join(', ')}`;
    ai = null;
  }

  // ---- send
  let sending = $state(false);
  let sent = $state(Boolean(config.saved));
  let sendError = $state('');
  async function send(event) {
    event.preventDefault();
    if (!type || anyProblem) return;
    sending = true; sendError = ''; sent = false;
    const body = new URLSearchParams({ type, unit, note });
    for (const f of spec.fields) if (values[f.key]) body.set(`f_${f.key}`, values[f.key]);
    try {
      const r = await fetch(`${base}/details`, { method: 'POST', headers: { accept: 'application/json' }, body });
      if (r.ok) sent = true;
      else sendError = (await r.json().catch(() => ({}))).error === 'measure' ? 'A measurement doesn’t look right. Use numbers like 25, 25.4 or 1/2.' : 'That didn’t send. Try again.';
    } catch {
      sendError = 'No connection. Try again.';
    }
    sending = false;
  }
</script>

<div class="ph">
  <section aria-labelledby="ph-photos">
    <h2 id="ph-photos">1. Show us the part</h2>
    <p class="hint">A photo of the whole part, then close-ups of any numbers on it. Lay a ruler or tape measure next to it if you can. Please keep people and license plates out of the picture.</p>

    {#if photos.length}
      <ul class="thumbs">
        {#each photos as p, i (p.src + i)}
          <li class={p.state}>
            <img src={p.src} alt={`Photo ${i + 1}`} />
            {#if p.state === 'sending' || p.state === 'queued'}<span class="badge">Sending…</span>
            {:else if p.state === 'failed'}<button type="button" class="badge bad" onclick={() => retry(p)}>Try again</button>
            {:else}<span class="badge ok">Sent</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#each photos.filter((p) => p.state === 'failed') as p (p.src)}<p class="problem" role="alert">{p.why}</p>{/each}

    {#if room > 0}
      <label class="big">
        <span>{sentCount ? 'Add another photo' : 'Take or add a photo'}</span>
        <input type="file" accept="image/*" capture="environment" multiple onchange={pick} />
      </label>
    {:else}<p class="hint">That’s the most photos we can take.</p>{/if}
    <p class="hint" role="status">{photoNote}{sentCount ? ` ${sentCount} of ${limit} photos sent.` : ''}</p>
  </section>

  {#if config.assist && sentCount > 0}
    <section class="ai" aria-labelledby="ph-ai">
      <h2 id="ph-ai">Not sure what it is?</h2>
      <p class="hint">Our helper can look at your photos and suggest what it is and read any numbers on it. It only suggests. You check everything before you send. The photos are shown to an AI service to do this.</p>
      <button type="button" class="btn" onclick={look} disabled={looking || sendingNow}>{looking ? 'Looking…' : ai ? 'Look again' : 'Take a look at my photos'}</button>
      {#if aiError}<p class="problem" role="alert">{aiError}</p>{/if}
      {#if ai}
        <div class="card" role="status">
          {#if ai.type}
            <p><strong>This looks like: {ai.label}</strong> <span class="hint">({ai.confidence} confidence)</span></p>
            {#if ai.markings.length}<p>Numbers I could read: {#each ai.markings as m}<code>{m}</code> {/each}</p>{/if}
            {#if Object.keys(ai.values).length}<p class="hint">I’ll fill in the sizes I could read off the part. Please check them.</p>{/if}
            <button type="button" class="btn primary" onclick={apply}>Use this</button>
          {:else}
            <p>I couldn’t tell what this is. Pick it below, or add a clearer photo.</p>
          {/if}
          {#if ai.questions.length}<ul class="qs">{#each ai.questions as q}<li>{q}</li>{/each}</ul>{/if}
          {#if ai.note}<p class="hint">{ai.note}</p>{/if}
        </div>
      {/if}
    </section>
  {/if}

  <form onsubmit={send} aria-labelledby="ph-what">
    <h2 id="ph-what">2. What is it?</h2>
    <div class="types" role="radiogroup" aria-label="Kind of part">
      {#each parts as [key, t] (key)}
        <button type="button" role="radio" aria-checked={type === key} class:on={type === key} onclick={() => choose(key)}>{t.label}</button>
      {/each}
    </div>
    <p class="hint">Or a job we do:</p>
    <div class="types" role="radiogroup" aria-label="Kind of job">
      {#each jobs as [key, t] (key)}
        <button type="button" role="radio" aria-checked={type === key} class:on={type === key} onclick={() => choose(key)}>{t.label}</button>
      {/each}
    </div>

    {#if spec}
      <p class="help">{spec.help}</p>
      {#if hasLength}
        <div class="units" role="radiogroup" aria-label="Measured in">
          <button type="button" role="radio" aria-checked={unit === 'mm'} class:on={unit === 'mm'} onclick={() => (unit = 'mm')}>millimetres</button>
          <button type="button" role="radio" aria-checked={unit === 'in'} class:on={unit === 'in'} onclick={() => (unit = 'in')}>inches</button>
        </div>
      {/if}
      <div class="fields">
        {#each spec.fields as f (f.key)}
          <label>
            <span>{f.label}{#if suggested[f.key]} <em class="tag">from your photo, please check</em>{/if}</span>
            {#if f.kind === 'choice'}
              <select bind:value={values[f.key]} onchange={() => touched(f.key)}>
                <option value="">Choose…</option>
                {#each f.options as o}<option>{o}</option>{/each}
              </select>
            {:else}
              <input bind:value={values[f.key]} oninput={() => touched(f.key)} inputmode={f.kind === 'text' ? 'text' : 'decimal'} maxlength="40" autocomplete="off" aria-invalid={problem(f) ? 'true' : 'false'} />
              {#if problem(f)}<small class="problem">Use a number like 25, 25.4 or 1/2.</small>
              {:else if converted(f)}<small class="hint">= {converted(f)}</small>{/if}
            {/if}
          </label>
        {/each}
      </div>
    {/if}

    <label class="wide">
      <span>Anything else? (numbers stamped on it, where it goes)</span>
      <textarea rows="2" maxlength="400" bind:value={note}></textarea>
    </label>

    {#if type}
      <button class="btn primary" disabled={sending || anyProblem}>{sending ? 'Sending…' : 'Send these details'}</button>
    {:else}
      <p class="hint">Photos are already sent. Pick what it is above if you’d like to add sizes.</p>
    {/if}
    <p class="hint" role="status">{#if sent}<strong class="thanks">Thank you. We’ve got it.</strong>{/if}</p>
    {#if sendError}<p class="problem" role="alert">{sendError}</p>{/if}
  </form>
</div>

<style>
  .ph { display: grid; gap: 1.5rem; }
  section, form { display: grid; gap: .75rem; padding: 1.1rem 1.25rem; background: var(--cs-card, #fff); border: 1px solid var(--cs-border, #ccd); border-radius: 12px; }
  h2 { margin: 0; font-size: 1.05rem; }
  .hint { margin: 0; color: var(--cs-muted, #667); font-size: .9rem; }
  .help { margin: 0; }
  .problem { color: var(--cs-danger, #b42323); margin: 0; font-size: .9rem; }
  .thanks { color: var(--cs-ok, #0b7a4f); }
  .thumbs { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr)); gap: .5rem; }
  .thumbs li { position: relative; }
  .thumbs img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; display: block; border: 1px solid var(--cs-border, #ccd); }
  .thumbs li.sending img, .thumbs li.failed img { opacity: .55; }
  .badge { position: absolute; left: .3rem; bottom: .3rem; padding: .1rem .45rem; font-size: .72rem; border-radius: 999px; background: rgba(0,0,0,.7); color: #fff; border: 0; font-family: inherit; }
  .badge.ok { background: var(--cs-ok, #0b7a4f); color: #fff; }
  .badge.bad { background: var(--cs-danger, #b42323); cursor: pointer; }
  .big { display: grid; place-items: center; min-height: 4.5rem; border: 2px dashed var(--cs-border, #ccd); border-radius: 12px; cursor: pointer; font-weight: 650; position: relative; }
  .big:hover, .big:focus-within { border-color: var(--cs-primary, #1f5fd8); }
  .big input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .card { display: grid; gap: .5rem; padding: .9rem 1rem; border-radius: 10px; background: var(--cs-input, #f3f6ff); border: 1px solid var(--cs-border, #ccd); }
  .card p { margin: 0; }
  code { padding: .05rem .4rem; border-radius: 6px; background: rgba(127,127,127,.18); font-size: .9em; }
  .qs { margin: 0; padding-left: 1.2rem; }
  .types, .units { display: flex; flex-wrap: wrap; gap: .4rem; }
  .ph .types button, .ph .units button { min-height: 44px; padding: .4rem .9rem; border-radius: 999px; border: 1px solid var(--cs-border, #ccd); background: transparent; color: inherit; font: inherit; cursor: pointer; }
  .ph .types button.on, .ph .units button.on { background: var(--cs-primary, #1f5fd8); border-color: transparent; color: var(--cs-primary-fg, #fff); font-weight: 650; }
  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .8rem; }
  label { display: grid; gap: .25rem; font-weight: 600; font-size: .9rem; }
  label.wide { grid-column: 1 / -1; }
  input:not([type='file']), select, textarea { font: inherit; font-size: 16px; font-weight: 400; min-height: 44px; padding: .5rem .7rem; border-radius: 8px; border: 1px solid var(--cs-border, #ccd); background: var(--cs-input, #fff); color: inherit; }
  input[aria-invalid='true'] { border-color: var(--cs-danger, #b42323); }
  .tag { display: block; width: fit-content; margin-top: .15rem; font-style: normal; font-weight: 500; font-size: .75rem; padding: .05rem .45rem; border-radius: 999px; background: color-mix(in oklab, var(--cs-warn, #9a5b00) 20%, transparent); }
  .ph button.btn { min-height: 44px; padding: .5rem 1rem; border-radius: 8px; border: 1px solid var(--cs-border, #ccd); background: var(--cs-btn, #eef); color: inherit; font: inherit; font-weight: 600; cursor: pointer; justify-self: start; }
  .ph button.btn.primary { background: var(--cs-primary, #1f5fd8); color: var(--cs-primary-fg, #fff); border-color: transparent; }
  .ph button.btn:disabled { opacity: .6; cursor: not-allowed; }
  :global(.ph :focus-visible) { outline: 2px solid var(--cs-accent, #1f5fd8); outline-offset: 2px; }
</style>
