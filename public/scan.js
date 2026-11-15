// Reading a customer's code: with the camera, from a photo, or typed in (the form works without any of this).
// The reader is Symbology's, run in the browser as WebAssembly; the picture never leaves the phone,
// only the code inside it is sent.
import { loadQr } from '/assets/vendor/qr.js';

const $ = (id) => document.getElementById(id);
const video = $('scan-video');
const status = $('scan-status');
const start = $('scan-start');
const photo = $('scan-photo');
const result = $('scan-result');
let qr = null;
let stream = null;
let timer = 0;
let busy = false;

const say = (text) => { status.textContent = text; };

try {
  qr = await loadQr();
} catch {
  say('Scanning isn’t available in this browser. Type or paste the code below.');
}

/** Read a QR code out of anything drawable (a video frame or a photo). Returns the text, or ''. */
function read(source, width, height) {
  const scale = Math.min(1, 1280 / width, 720 / height);
  const w = Math.max(1, Math.floor(width * scale));
  const h = Math.max(1, Math.floor(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, 0, 0, w, h);
  const { data } = g.getImageData(0, 0, w, h);
  const luma = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < luma.length; i += 1, p += 4) luma[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  try {
    return qr.decodeText({ width: w, height: h, luma });
  } catch {
    return '';
  }
}

function stop() {
  clearTimeout(timer);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.hidden = true;
}

function show(found) {
  result.replaceChildren();
  const box = document.createElement('div');
  box.className = 'stack';
  const who = document.createElement('p');
  const name = document.createElement('strong');
  name.textContent = found.name;
  who.append(name, ` · ${found.business}`);
  const row = document.createElement('div');
  row.className = 'row';
  const form = document.createElement('form');
  form.method = 'post';
  form.action = '/calls';
  const customer = document.createElement('input');
  customer.type = 'hidden';
  customer.name = 'customer';
  customer.value = String(found.customerId);
  const go = document.createElement('button');
  go.className = 'btn primary';
  go.textContent = 'Start a call for them';
  form.append(customer, go);
  const open = document.createElement('a');
  open.className = 'btn';
  open.href = `/customers/${found.customerId}`;
  open.textContent = 'Open customer';
  const again = document.createElement('a');
  again.className = 'btn';
  again.href = '/scan';
  again.textContent = 'Scan another';
  row.append(form, open, again);
  box.append(who, row);
  result.append(box);
  go.focus();
}

async function lookUp(code) {
  if (busy) return false;
  busy = true;
  try {
    const response = await fetch('/scan/badge', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ code }) });
    const body = await response.json();
    if (body.ok) { stop(); say(''); show(body); return true; }
    say(body.message || 'That code didn’t work.');
  } catch {
    say('Couldn’t reach the shop’s server. Check the connection and try again.');
  } finally {
    busy = false;
  }
  return false;
}

async function tick() {
  if (!stream) return;
  if (video.readyState >= 2 && !busy) {
    const text = read(video, video.videoWidth, video.videoHeight);
    if (text && (await lookUp(text))) return;
  }
  timer = setTimeout(tick, 180);
}

if (qr) {
  photo.closest('label').hidden = false;
  if (navigator.mediaDevices?.getUserMedia) start.hidden = false;
  start.addEventListener('click', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch {
      say('The camera isn’t available. Allow it for this site, or take a photo of the code instead.');
      return;
    }
    video.srcObject = stream;
    video.hidden = false;
    await video.play().catch(() => {});
    say('Point the camera at the code.');
    tick();
  });
  photo.addEventListener('change', async () => {
    const file = photo.files?.[0];
    if (!file) return;
    say('Reading…');
    try {
      const bitmap = await createImageBitmap(file);
      const text = read(bitmap, bitmap.width, bitmap.height);
      bitmap.close?.();
      if (!text) say('Couldn’t find a code in that photo. Try again, closer and in better light.');
      else await lookUp(text);
    } catch {
      say('Couldn’t read that photo.');
    }
    photo.value = '';
  });
}
addEventListener('pagehide', stop);
