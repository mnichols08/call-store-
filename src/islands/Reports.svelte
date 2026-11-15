<script>
  // Reports: pick a range, see calls per day against the period before, and the speed numbers beside what
  // they were. Numbers come from the server (/reports.json); this only draws them.
  import { untrack } from 'svelte';

  const props = $props();
  const first = untrack(() => props.config);
  let data = $state(first);
  let days = $state(first.days);
  let loading = $state(false);
  let failed = $state(false);
  let hover = $state(null);

  const RANGES = [7, 14, 30, 90];

  async function pick(n) {
    if (n === days && !failed) return;
    days = n;
    loading = true;
    failed = false;
    try {
      const response = await fetch(`/reports.json?days=${n}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error('no');
      data = result;
      history.replaceState(null, '', `/reports?days=${n}`);
      document.querySelectorAll('a[href^="/reports.csv"], a[href^="/reports/timing.csv"]').forEach((a) => { a.href = a.href.replace(/days=\d+/, `days=${n}`); });
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  }

  const duration = (ms) => {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} m`;
  };
  const percent = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

  const total = (rows) => rows.reduce((n, r) => n + r.count, 0);
  const now = $derived(data.now);
  const before = $derived(data.before);
  const sum = $derived(total(now.rows));
  const sumBefore = $derived(total(before.rows));
  const top = $derived(Math.max(1, ...now.rows.map((r) => r.count), ...before.rows.map((r) => r.count)));
  const outcomeTop = $derived(Math.max(1, ...now.outcomes.map((o) => o[1])));

  const W = 720;
  const H = 220;
  const PAD = { l: 30, r: 8, t: 10, b: 26 };
  const step = $derived((W - PAD.l - PAD.r) / Math.max(1, now.rows.length));
  const y = (n) => PAD.t + (H - PAD.t - PAD.b) * (1 - n / top);
  const ticks = $derived([0, Math.ceil(top / 2), top].filter((v, i, a) => a.indexOf(v) === i));
  const label = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;
  const every = $derived(now.rows.length > 45 ? 10 : now.rows.length > 20 ? 5 : now.rows.length > 10 ? 2 : 1);

  const cards = $derived([
    { name: 'Calls', value: String(sum), was: String(sumBefore) },
    { name: 'Median wait to pick up', value: duration(now.timing.waitMedian), was: duration(before.timing.waitMedian) },
    { name: '90% picked up within', value: duration(now.timing.waitP90), was: duration(before.timing.waitP90) },
    { name: `Picked up in ${data.targetMinutes} min`, value: percent(now.timing.withinTarget), was: percent(before.timing.withinTarget) },
    { name: 'Median time to finish', value: duration(now.timing.handleMedian), was: duration(before.timing.handleMedian) },
    { name: 'Longest waiting now', value: now.timing.longestWaiting ? duration(now.timing.longestWaiting) : 'None', was: null },
  ]);
</script>

<div class="rp" class:busy={loading}>
  <div class="rp-bar">
    <div class="rp-range" role="group" aria-label="Range">
      {#each RANGES as n}<button type="button" class:on={n === days} aria-pressed={n === days} onclick={() => pick(n)}>Last {n} days</button>{/each}
    </div>
    {#if failed}<span class="rp-bad" role="alert">Couldn’t load that range. Try again.</span>{:else if loading}<span class="muted">Loading…</span>{/if}
  </div>

  <div class="rp-cards">
    {#each cards as c}
      <div class="rp-card"><span class="rp-name">{c.name}</span><strong>{c.value}</strong>{#if c.was != null}<small>Before: {c.was}</small>{/if}</div>
    {/each}
  </div>

  <section class="rp-panel">
    <h2>Calls taken per day</h2>
    <p class="rp-key"><span class="k-now"></span> This period <span class="k-before"></span> The {days} days before</p>
    {#if sum === 0 && sumBefore === 0}
      <p class="muted">No calls in this range yet.</p>
    {:else}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Calls per day for the last ${days} days: ${sum} in all`} onmouseleave={() => (hover = null)}>
        {#each ticks as t}
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} class="grid" />
          <text x={PAD.l - 6} y={y(t) + 4} text-anchor="end" class="axis">{t}</text>
        {/each}
        {#each now.rows as r, i}
          {@const x = PAD.l + i * step}
          {@const prev = before.rows[i]?.count ?? 0}
          <rect x={x + step * 0.12} width={step * 0.76} y={y(prev)} height={Math.max(0, y(0) - y(prev))} class="before" />
          <rect x={x + step * 0.22} width={step * 0.56} y={y(r.count)} height={Math.max(r.count ? 2 : 1, y(0) - y(r.count))} class="now" class:hot={hover === i} />
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <rect x={x} width={step} y={PAD.t} height={H - PAD.t - PAD.b} class="hit" role="img" tabindex="0" aria-label={`${r.day}: ${r.count} calls, ${prev} the same day before`}
            onmouseenter={() => (hover = i)} onfocus={() => (hover = i)} onblur={() => (hover = null)} />
          {#if i % every === 0}<text x={x + step / 2} y={H - 8} text-anchor="middle" class="axis">{label(r.day)}</text>{/if}
        {/each}
        {#if hover != null}
          {@const r = now.rows[hover]}
          {@const tx = Math.min(W - 150, Math.max(PAD.l, PAD.l + hover * step - 60))}
          <g class="tip" transform={`translate(${tx} ${PAD.t})`}><rect width="150" height="44" rx="6" /><text x="8" y="18">{r.day}</text><text x="8" y="35">{r.count} calls · before: {before.rows[hover]?.count ?? 0}</text></g>
        {/if}
      </svg>
    {/if}
  </section>

  <div class="rp-two">
    <section class="rp-panel">
      <h2>What came of them</h2>
      {#if now.outcomes.length}
        <ul class="rp-out">{#each now.outcomes as [name, n]}<li><span>{name}</span><span class="rp-track"><span style={`width:${Math.round((n / outcomeTop) * 100)}%`}></span></span><b>{n}</b></li>{/each}</ul>
      {:else}<p class="muted">Nothing finished in this range.</p>{/if}
    </section>
    <section class="rp-panel">
      <h2>By person</h2>
      {#if now.people.length}
        <table><thead><tr><th>Who</th><th>Finished</th><th>Median time to finish</th></tr></thead>
          <tbody>{#each now.people as p}<tr><td>{p.name}</td><td>{p.finished}</td><td>{duration(p.handleMedian)}</td></tr>{/each}</tbody></table>
      {:else}<p class="muted">Nobody has finished a call in this range.</p>{/if}
    </section>
  </div>
  {#if now.timing.neverPickedUp}<p class="muted">{now.timing.neverPickedUp} call{now.timing.neverPickedUp === 1 ? ' was' : 's were'} never picked up by anyone in this range.</p>{/if}
</div>

<style>
  .rp { display: grid; gap: 1rem; min-width: 0; }
  .rp.busy { opacity: .7; }
  @media (max-width: 480px) { .rp .rp-range button { padding: .4rem .5rem; font-size: .9rem; } }
  .rp-bar { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
  .rp-range { display: inline-flex; border: 1px solid var(--cs-border, #ccd); border-radius: 10px; overflow: hidden; background: var(--cs-card, #fff); }
  .rp .rp-range button { min-height: 44px; padding: .4rem .9rem; border: 0; border-radius: 0; box-shadow: none; border-right: 1px solid var(--cs-border, #ccd); background: transparent; color: inherit; font: inherit; cursor: pointer; }
  .rp .rp-range button:last-child { border-right: 0; }
  .rp .rp-range button.on { background: var(--cs-primary, #1f5fd8); color: var(--cs-primary-fg, #fff); font-weight: 650; }
  .rp-bad { color: var(--cs-bad, #a40000); font-weight: 600; }
  .rp-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr)); gap: .75rem; }
  .rp-card { display: grid; gap: .15rem; padding: .9rem 1rem; border: 1px solid var(--cs-border, #dde); border-radius: 10px; background: var(--cs-card, #fff); }
  .rp-name { font-size: .85rem; color: var(--cs-muted, #556); }
  .rp-card strong { font-size: 1.7rem; line-height: 1.15; }
  .rp-card small { color: var(--cs-muted, #556); }
  .rp-panel { padding: 1rem 1.1rem; border: 1px solid var(--cs-border, #dde); border-radius: 10px; background: var(--cs-card, #fff); min-width: 0; }
  .rp-panel h2 { margin: 0 0 .5rem; font-size: 1.05rem; }
  .rp-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: 1rem; }
  .rp-key { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; margin: 0 0 .5rem; font-size: .85rem; color: var(--cs-muted, #556); }
  .rp-key span { display: inline-block; width: .9rem; height: .9rem; border-radius: 3px; }
  .rp-key .k-now { background: var(--cs-primary, #1f5fd8); }
  .rp-key .k-before { background: #c9d4ee; margin-left: .8rem; }
  svg { width: 100%; height: auto; display: block; }
  .grid { stroke: var(--cs-border, #dde); stroke-width: 1; }
  .axis { font-size: 11px; fill: var(--cs-muted, #556); }
  .now { fill: var(--cs-primary, #1f5fd8); }
  .now.hot { fill: #123f99; }
  .before { fill: #c9d4ee; }
  .hit { fill: transparent; cursor: default; }
  .hit:focus { outline: 2px solid var(--cs-primary, #1f5fd8); }
  .tip rect { fill: #1b2233; }
  .tip text { fill: #fff; font-size: 12px; }
  .rp-out { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; }
  .rp-out li { display: grid; grid-template-columns: minmax(5rem, 9rem) 1fr 2rem; gap: .6rem; align-items: center; }
  .rp-track { height: .7rem; background: #e8ecf6; border-radius: 6px; overflow: hidden; }
  .rp-track span { display: block; height: 100%; background: var(--cs-primary, #1f5fd8); }
  .rp-out b { text-align: right; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: .45rem .3rem; border-bottom: 1px solid var(--cs-border, #e3e6f0); }
  th { font-size: .85rem; color: var(--cs-muted, #556); font-weight: 600; }
</style>
