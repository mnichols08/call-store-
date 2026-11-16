// The quick-entry panel on a call: type what the caller asks for the way you'd say it, press Enter,
// and it becomes one line under the vehicle. The island (src/islands/QuickEntry.svelte) draws the live
// version; this is what a browser without JavaScript gets, and what the island starts from.
import { esc } from '../html.js';
import { sayVehicle } from '../../domain/quickline.js';

const label = (l) => [l.qty > 1 ? `${l.qty} ×` : '', l.part || (l.partNumbers ? `Part ${l.partNumbers}` : '')].filter(Boolean).join(' ');

export function quickEntry(ctx, call, data, closed) {
  const lines = data.lines ?? [];
  const config = { callId: call.id, closed, lines, revision: data.revision, application: data.application };
  let last = '';
  const list = lines.map((l) => {
    const car = sayVehicle(l.vehicle);
    const head = car !== last ? `<li class="qe-car"><strong>${esc(car || 'No vehicle yet')}</strong></li>` : '';
    last = car;
    return `${head}${l.kind === 'vehicle' ? '' : `<li class="qe-line${l.done ? ' done' : ''}"><span>${esc(label(l))}${l.guessed.length ? ' <small>(guess)</small>' : ''}</span>
      ${closed ? '' : `<form method="post" action="/calls/${call.id}/lines"><input type="hidden" name="action" value="remove"><input type="hidden" name="line" value="${l.id}"><button class="link" type="submit">Remove</button></form>`}</li>`}`;
  }).join('');
  return `<link rel="stylesheet" href="/assets/islands/quick-entry.css">
<section class="panel stack" id="quick"><h2>What do they need?</h2>
<div id="quick-entry" data-config="${esc(JSON.stringify(config))}">
${closed ? '' : `<form method="post" action="/calls/${call.id}/lines" class="row"><label class="sr" for="qe-text">Type a part, a vehicle, or both</label>
<input id="qe-text" name="text" autocomplete="off" placeholder="90 eclipse front brakes" maxlength="200"><button type="submit">Add</button></form>`}
<ul class="plain qe-list">${list}</ul></div></section>
<script src="/assets/islands/quick-entry.js" type="module"></script>`;
}
