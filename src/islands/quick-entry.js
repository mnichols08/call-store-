import { mount } from 'svelte';
import QuickEntry from './QuickEntry.svelte';

const root = document.getElementById('quick-entry');
if (root) {
  let config = {};
  try { config = JSON.parse(root.dataset.config || '{}'); } catch {}
  root.replaceChildren(); // the plain form inside was for browsers without JavaScript
  mount(QuickEntry, { target: root, props: { config } });
}
