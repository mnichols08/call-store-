// The quick-entry panel on a call: type what the caller asks for the way you'd say it, press Enter,
// and it becomes one line under the vehicle. A VIN is decoded, paint fills in a paint card, and each
// part line gets part-number suggestions from the queue. Each line is worked down the list: found,
// need to order, can't get. The island (src/islands/QuickEntry.svelte) draws the live version; this
// is what a browser without JavaScript gets, and what the island starts from.
import { esc } from '../html.js';
import { sayPaint, sayVehicle } from '../../domain/quickline.js';

const label = (l) => [l.qty > 1 ? `${l.qty} ×` : '', l.paint ? sayPaint(l.paint) : l.part || (l.partNumbers ? `Part ${l.partNumbers}` : '')].filter(Boolean).join(' ');

/** The four places a line can be, in the order they are offered. */
export const STATUS_WORDS = { open: 'Open', found: 'Found it', order: 'Need to order', cant: 'Can’t get' };
/** What the suggestion queue is doing for a line, in words. */
export const SUGGEST_WORDS = {
  queued: 'Looking for part numbers…',
  working: 'Looking for part numbers…',
  none: 'No part numbers found. Use the part finder below, or teach one.',
  vehicle: 'Part numbers wait for the vehicle: type the year and model, or the VIN.',
  limited: 'The shop’s AI limit is reached for now. Saved answers only.',
  off: 'No saved answers yet, and the AI isn’t set up.',
  failed: 'The part number search didn’t work this time.',
};

function paintCard(p) {
  const rows = [['Code', p.code || '—'], ['Type', p.type || '—'], ['Brand', p.brand || '—'], ['Amount', p.amount !== null && p.amount !== undefined ? `${p.amount} ${p.unit}` : '—']];
  return `<dl class="qe-paint">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

function suggestionList(l) {
  if (l.kind !== 'part') return '';
  if (l.suggest === 'ready') return `<ul class="plain qe-suggest">${l.suggestions.map((s) => `<li><strong>${esc(s.partNumber)}</strong> ${esc(s.brand)}${s.description ? ` · ${esc(s.description)}` : ''}${s.source === 'ai' && !s.worked ? ' <small>(AI, not checked)</small>' : ''}</li>`).join('')}</ul>`;
  return SUGGEST_WORDS[l.suggest] ? `<p class="muted qe-suggest-state">${esc(SUGGEST_WORDS[l.suggest])}</p>` : '';
}

function statusForm(callId, l) {
  return `<form method="post" action="/calls/${callId}/lines" class="qe-status" aria-label="Where ${esc(label(l))} stands"><input type="hidden" name="action" value="status"><input type="hidden" name="line" value="${l.id}">
    ${Object.entries(STATUS_WORDS).map(([value, words]) => `<button name="status" value="${value}"${l.status === value ? ' aria-pressed="true" class="on"' : ''}>${words}</button>`).join('')}</form>`;
}

export function quickEntry(ctx, call, data, closed) {
  const lines = data.lines ?? [];
  const config = { callId: call.id, closed, lines, revision: data.revision, application: data.application };
  let last = '';
  const list = lines.map((l) => {
    const car = sayVehicle(l.vehicle);
    const vin = l.vin ? ` <small>VIN ${esc(l.vin)}${l.vinDecoded ? '' : ' (not decoded)'}</small>` : '';
    const head = car !== last || (l.kind === 'vehicle' && l.vin) ? `<li class="qe-car"><strong>${esc(car || 'No vehicle yet')}</strong>${l.kind === 'vehicle' ? vin : ''}</li>` : '';
    last = car;
    if (l.kind === 'vehicle') return head;
    return `${head}<li class="qe-line qe-${l.status}${l.done ? ' done' : ''}"><div class="qe-what"><span>${esc(label(l))}${l.guessed.length ? ' <small>(guess)</small>' : ''}${l.status !== 'open' ? ` <small class="qe-badge">${esc(STATUS_WORDS[l.status])}</small>` : ''}</span>
      ${closed ? '' : `<form method="post" action="/calls/${call.id}/lines"><input type="hidden" name="action" value="remove"><input type="hidden" name="line" value="${l.id}"><button class="link" type="submit">Remove</button></form>`}</div>
      ${l.paint ? paintCard(l.paint) : suggestionList(l)}
      ${closed ? '' : statusForm(call.id, l)}</li>`;
  }).join('');
  return `<link rel="stylesheet" href="/assets/islands/quick-entry.css">
<section class="panel stack" id="quick"><h2>What do they need?</h2>
<div id="quick-entry" data-config="${esc(JSON.stringify(config))}">
${closed ? '' : `<form method="post" action="/calls/${call.id}/lines" class="row"><label class="sr" for="qe-text">Type a part, a vehicle, a VIN or paint</label>
<input id="qe-text" name="text" autocomplete="off" placeholder="90 eclipse front brakes" maxlength="200"><button type="submit">Add</button></form>
<p class="muted">Say it the way they do: “front struts for 2000 tacoma”, a VIN, or “1qt d3 valspar single stage”. Enter adds the line.</p>`}
<ul class="plain qe-list">${list}</ul></div></section>
<script src="/assets/islands/quick-entry.js" type="module"></script>`;
}
