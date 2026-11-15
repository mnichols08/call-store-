import { mount } from 'svelte';
import PartHelper from './PartHelper.svelte';

const root = document.getElementById('part-helper');
if (root) {
  let config = {};
  try { config = JSON.parse(root.dataset.config || '{}'); } catch {}
  root.replaceChildren(); // the plain form inside was for browsers without JavaScript
  mount(PartHelper, { target: root, props: { config } });
}
