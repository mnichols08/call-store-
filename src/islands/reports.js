import { mount } from 'svelte';
import Reports from './Reports.svelte';

const root = document.getElementById('reports');
if (root) {
  let config = null;
  try { config = JSON.parse(root.dataset.config || 'null'); } catch {}
  if (config) {
    root.replaceChildren(); // the plain tables inside were for browsers without JavaScript
    mount(Reports, { target: root, props: { config } });
  }
}
