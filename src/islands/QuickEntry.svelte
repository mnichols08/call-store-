<script>
  // Quick entry: type a line the way you'd say it, see what it understood, press Enter. The same
  // reader as the server (src/domain/quickline.js), so what shows here is what gets saved. A VIN is
  // decoded, paint shows as a paint card, and each part line gets part-number suggestions from the
  // queue. Each line is worked down the list: found, need to order, can't get.
  import { untrack } from 'svelte';
  import { carryVehicle, parseLine, sayLine, sayPaint, sayVehicle } from '../domain/quickline.js';

  const props = $props();
  const config = untrack(() => props.config);
  const closed = config.closed;

  let lines = $state(config.lines ?? []);
  let application = $state(config.application ?? {});
  let text = $state('');
  let busy = $state(false);
  let problem = $state('');
  let editing = $state(null); // { id, text }
  let input = $state();

  const VEHICLE = ['year', 'make', 'model', 'engine', 'drivetrain'];
  const pick = (v) => Object.fromEntries(VEHICLE.filter((k) => v?.[k]).map((k) => [k, v[k]]));
  const current = $derived(lines.length ? lines.at(-1).vehicle : pick(application));
  const reading = $derived(text.trim() ? parseLine(text) : null);
  const preview = $derived(reading && reading.kind !== 'empty' ? sayLine(reading, carryVehicle(current, reading)) : '');

  // Lines grouped under the vehicle they are for. A VIN line starts a group and shows its VIN.
  const groups = $derived.by(() => {
    const out = [];
    for (const l of lines) {
      const car = sayVehicle(l.vehicle);
      if (!out.length || out.at(-1).car !== car || (l.kind === 'vehicle' && l.vin)) out.push({ car, vin: l.kind === 'vehicle' ? l.vin : '', decoded: l.vinDecoded, items: [] });
      if (l.kind !== 'vehicle') out.at(-1).items.push(l);
    }
    return out;
  });

  const say = (l) => [l.qty > 1 ? `${l.qty} ×` : '', l.paint ? sayPaint(l.paint) : l.part || (l.partNumbers ? `Part ${l.partNumbers}` : '')].filter(Boolean).join(' ');
  const WHY = { empty: 'Type a part, a vehicle, or both.', 'too-many': 'That’s the most lines one call can hold. Start a second call.', closed: 'This call is closed.', forbidden: 'You can’t change this call.', missing: 'That line is gone. Reload the page.', status: 'Pick found, need to order, can’t get or open.' };
  const STATUS = [['open', 'Open'], ['found', 'Found it'], ['order', 'Need to order'], ['cant', 'Can’t get']];
  const SUGGEST = {
    queued: 'Looking for part numbers…', working: 'Looking for part numbers…',
    none: 'No part numbers found. Use the part finder below, or teach one.',
    vehicle: 'Part numbers wait for the vehicle: type the year and model, or the VIN.',
    limited: 'The shop’s AI limit is reached for now. Saved answers only.',
    off: 'No saved answers yet, and the AI isn’t set up.',
    failed: 'The part number search didn’t work this time.',
  };
  const amount = (p) => (p.amount !== null && p.amount !== undefined ? `${p.amount} ${p.unit}` : '—');

  // The queue answers in the background: redraw when it does (the page's live events call this), and
  // look again every few seconds while a line is still waiting, in case an event was missed.
  async function refresh() {
    try {
      const response = await fetch(`/calls/${config.callId}/lines`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      const result = await response.json();
      if (response.ok && result.ok && !busy) lines = result.lines;
    } catch {}
  }
  window.refreshLines = refresh;
  const waiting = $derived(lines.some((l) => l.suggest === 'queued' || l.suggest === 'working'));
  $effect(() => {
    if (!waiting) return;
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  });

  // The page's own form saves the vehicle fields and the revision; after a line changes them, put the new values there.
  function syncForm(result) {
    const form = document.getElementById('call-form');
    if (!form) return;
    if (form.elements.revision) form.elements.revision.value = result.revision;
    for (const k of [...VEHICLE, 'vin', 'unit', 'freeform']) {
      const field = form.elements[`app_${k}`];
      if (field) field.value = result.application?.[k] ?? '';
    }
  }

  async function send(body) {
    busy = true;
    problem = '';
    try {
      await window.callFlush?.(); // anything typed in the form below goes first, so the revision is current
      const rev = document.getElementById('call-form')?.elements.revision;
      const response = await fetch(`/calls/${config.callId}/lines`, { method: 'POST', body: new URLSearchParams(body), headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) {
        lines = result.lines;
        application = result.application;
        syncForm(result);
        problem = result.vinProblem ?? '';
        return true;
      }
      problem = response.status === 401 ? 'You’ve been signed out. Sign in again; what you typed is still here.' : WHY[result.error] ?? 'Couldn’t save that line.';
      return false;
    } catch {
      problem = 'Offline. What you typed is still here; press Enter to try again.';
      return false;
    } finally {
      busy = false;
      void input?.focus();
    }
  }

  async function add(event) {
    event.preventDefault();
    if (busy || !text.trim()) return;
    if (await send({ action: 'add', text })) text = '';
  }
  async function saveEdit(event) {
    event.preventDefault();
    if (busy || !editing) return;
    if (await send({ action: 'edit', line: editing.id, text: editing.text })) editing = null;
  }
  const setStatus = (l, status) => send({ action: 'status', line: l.id, status });
  const remove = (l) => send({ action: 'remove', line: l.id });
  const onKey = (event) => { if (event.key === 'Escape') { text = ''; problem = ''; } };

  $effect(() => { if (!closed && !lines.length) input?.focus(); });
</script>

<div class="qe">
  {#if !closed}
    <form onsubmit={add} class="qe-form">
      <label class="sr" for="qe-text">Type a part, a vehicle, a VIN or paint</label>
      <div class="qe-row">
        <input id="qe-text" bind:this={input} bind:value={text} onkeydown={onKey} autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="200"
          placeholder={lines.length ? 'Next part, or a new vehicle…' : '90 eclipse front brakes'} enterkeyhint="send" />
        <button type="submit" class="btn primary" disabled={busy || !text.trim()}>Add</button>
      </div>
      <p class="qe-now" aria-live="polite">
        {#if reading && reading.kind !== 'empty'}
          <span class="qe-say">{preview}</span>
          {#if reading.guessed.length}<span class="qe-guess">a guess: check the {reading.guessed.join(' and ')}</span>{/if}
          {#if reading.partIncomplete}<span class="qe-guess">which part?</span>{/if}
          {#if reading.vin}<span class="qe-guess">VIN: it’s decoded when you press Enter</span>{/if}
          {#if reading.paint && !reading.paint.code}<span class="qe-guess">which paint code?</span>{/if}
        {:else if sayVehicle(current)}
          <span class="muted">On {sayVehicle(current)}. Type the next part, or a different vehicle.</span>
        {:else}
          <span class="muted">Say it the way they do: “front struts for 2000 tacoma”, a VIN, or “1qt d3 valspar single stage”. Enter adds the line.</span>
        {/if}
      </p>
      {#if reading && reading.tokens.length}
        <p class="qe-tokens" aria-hidden="true">{#each reading.tokens as t}<span class={`t-${t.role}`}>{t.text}</span>{/each}</p>
      {/if}
    </form>
  {/if}
  {#if problem}<p class="qe-problem" role="alert">{problem}</p>{/if}

  {#each groups as g}
    <div class="qe-group">
      <h3>{g.car || 'No vehicle yet'}{#if g.vin} <small class="qe-vin">VIN {g.vin}{g.decoded ? '' : ' (not decoded)'}</small>{/if}</h3>
      <ul class="plain">
        {#each g.items as l (l.id)}
          <li class={`qe-${l.status}`} class:done={l.done}>
            {#if editing?.id === l.id}
              <form onsubmit={saveEdit} class="qe-edit">
                <input bind:value={editing.text} aria-label="Change this line" maxlength="200" onkeydown={(e) => e.key === 'Escape' && (editing = null)} />
                <button class="btn primary" type="submit" disabled={busy}>Save</button>
                <button class="btn" type="button" onclick={() => (editing = null)}>Cancel</button>
              </form>
            {:else}
              <div class="qe-what">
                <span class="qe-name">{say(l)}{#if l.guessed.length} <small>(guess)</small>{/if}</span>
                {#if !closed}
                  <span class="qe-acts"><button class="btn" type="button" onclick={() => (editing = { id: l.id, text: l.raw })}>Change</button>
                  <button class="btn" type="button" onclick={() => remove(l)} disabled={busy} aria-label={`Remove ${say(l)}`}>Remove</button></span>
                {/if}
              </div>
              {#if l.paint}
                <dl class="qe-paint">
                  <div><dt>Code</dt><dd>{l.paint.code || '—'}</dd></div>
                  <div><dt>Type</dt><dd>{l.paint.type || '—'}</dd></div>
                  <div><dt>Brand</dt><dd>{l.paint.brand || '—'}</dd></div>
                  <div><dt>Amount</dt><dd>{amount(l.paint)}</dd></div>
                </dl>
              {:else if l.kind === 'part' && l.suggest === 'ready'}
                <ul class="plain qe-suggest">
                  {#each l.suggestions as s (s.id)}
                    <li><strong>{s.partNumber}</strong> {s.brand}{#if s.description} · {s.description}{/if}{#if s.source === 'ai' && !s.worked} <small>(AI, not checked)</small>{/if}</li>
                  {/each}
                </ul>
              {:else if l.kind === 'part' && SUGGEST[l.suggest]}
                <p class="qe-suggest-state" class:qe-wait={l.suggest === 'queued' || l.suggest === 'working'}>{SUGGEST[l.suggest]}</p>
              {/if}
              {#if !closed}
                <div class="qe-status" role="group" aria-label={`Where ${say(l)} stands`}>
                  {#each STATUS as [value, words]}
                    <button type="button" class:on={l.status === value} aria-pressed={l.status === value} disabled={busy} onclick={() => setStatus(l, value)}>{words}</button>
                  {/each}
                </div>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/each}
</div>

<style>
  .qe { display: grid; gap: 1rem; min-width: 0; max-width: 100%; }
  .qe-form { min-width: 0; }
  .qe-row { display: flex; gap: .5rem; }
  .qe-row input { flex: 1 1 0; width: 0; min-width: 0; min-height: 52px; font-size: 1.15rem; padding: .5rem .8rem; border-radius: 8px; border: 2px solid var(--cs-border, #ccd); background: var(--cs-field, transparent); color: inherit; }
  .qe-row input:focus { outline: 3px solid var(--cs-primary, #1f5fd8); outline-offset: 1px; }
  .qe button.btn { min-height: 44px; padding: .45rem 1rem; border-radius: 8px; border: 1px solid var(--cs-border, #ccd); background: var(--cs-btn, #eef); color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
  .qe button.btn.primary { background: var(--cs-primary, #1f5fd8); color: var(--cs-primary-fg, #fff); border-color: transparent; }
  .qe button:disabled { opacity: .55; cursor: default; }
  .qe-now { margin: .4rem 0 0; min-height: 1.5em; }
  .qe-say { font-weight: 650; }
  .qe-guess { margin-left: .6rem; padding: .1rem .5rem; border-radius: 999px; background: var(--cs-warn, #fff1c9); color: var(--cs-warn-fg, #5b4200); font-size: .85rem; }
  .qe-tokens { display: flex; flex-wrap: wrap; gap: .3rem; margin: .3rem 0 0; font-size: .85rem; }
  .qe-tokens span { padding: .05rem .45rem; border-radius: 6px; border: 1px solid var(--cs-border, #ccd); }
  .qe-tokens .t-part { background: #e6f0ff; } .qe-tokens .t-position { background: #e6f0ff; }
  .qe-tokens .t-year, .qe-tokens .t-make, .qe-tokens .t-model, .qe-tokens .t-engine, .qe-tokens .t-drive { background: #e9f7e9; }
  .qe-tokens .t-qty, .qe-tokens .t-number, .qe-tokens .t-amount { background: #fff1c9; }
  .qe-tokens .t-vin, .qe-tokens .t-paint, .qe-tokens .t-code { background: #f1e6ff; }
  .qe-tokens .t-skip { opacity: .55; }
  .qe-problem { color: var(--cs-bad, #a40000); font-weight: 600; margin: 0; }
  .qe-group h3 { margin: 0 0 .3rem; font-size: 1rem; }
  .qe-group ul { display: grid; gap: .3rem; margin: 0; padding: 0; list-style: none; }
  .qe-group > ul > li { display: grid; gap: .45rem; padding: .5rem .7rem; border: 1px solid var(--cs-border, #ccd); border-left-width: 4px; border-radius: 8px; }
  .qe-group > ul > li.qe-found { border-left-color: #2e8540; }
  .qe-group > ul > li.qe-order { border-left-color: #c77700; }
  .qe-group > ul > li.qe-cant { border-left-color: #a40000; }
  .qe-group li.qe-found .qe-name, .qe-group li.qe-cant .qe-name { opacity: .7; }
  .qe-vin { font-weight: 500; opacity: .75; font-size: .85rem; }
  .qe-what { display: flex; flex-wrap: wrap; gap: .25rem .5rem; align-items: center; justify-content: space-between; }
  .qe-name { font-weight: 600; min-height: 44px; display: flex; align-items: center; }
  .qe-acts { display: flex; gap: .3rem; margin-left: auto; }
  .qe-paint { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .4rem; margin: 0; }
  .qe-paint div { padding: .3rem .5rem; border-radius: 6px; background: var(--cs-btn, #eef); }
  .qe-paint dt { font-size: .75rem; opacity: .75; } .qe-paint dd { margin: 0; font-weight: 650; }
  .qe-suggest { display: grid; gap: .15rem; margin: 0; padding: 0; list-style: none; font-size: .95rem; }
  .qe-suggest-state { margin: 0; font-size: .9rem; opacity: .8; }
  .qe-wait::before { content: ''; display: inline-block; width: .7rem; height: .7rem; margin-right: .4rem; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: qe-spin 1s linear infinite; vertical-align: -1px; }
  @keyframes qe-spin { to { transform: rotate(1turn); } }
  @media (prefers-reduced-motion: reduce) { .qe-wait::before { animation: none; } }
  .qe-status { display: flex; flex-wrap: wrap; gap: .3rem; }
  .qe-status button { min-height: 40px; padding: .3rem .75rem; border-radius: 999px; border: 1px solid var(--cs-border, #ccd); background: transparent; color: inherit; font: inherit; font-size: .9rem; cursor: pointer; }
  .qe .qe-status button.on, .qe .qe-status button[aria-pressed='true'] { background: var(--cs-primary, #1f5fd8); color: var(--cs-primary-fg, #fff); border-color: transparent; font-weight: 650; }
  @media (max-width: 640px) { .qe-paint { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .qe-edit { display: flex; gap: .4rem; flex: 1; flex-wrap: wrap; }
  .qe-edit input { flex: 1; min-width: 10rem; min-height: 44px; padding: .3rem .6rem; border-radius: 8px; border: 2px solid var(--cs-border, #ccd); background: transparent; color: inherit; font: inherit; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
