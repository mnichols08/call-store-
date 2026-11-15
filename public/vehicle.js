// Makes the year / make / model / engine / drivetrain picker quicker: each field suggests what
// the one before it allows. Without this script the fields are plain text boxes and still work.
(() => {
const box = document.querySelector('[data-vehicle-picker]');
if (!box) return;
const field = (name) => box.querySelector(`[name="${name}"]`);
const list = (id, values) => {
  const dl = document.getElementById(id);
  if (!dl) return;
  dl.replaceChildren(...values.map((v) => Object.assign(document.createElement('option'), { value: v })));
};
const get = async (path, params) => {
  try {
    const response = await fetch(`${path}?${new URLSearchParams(params)}`, { headers: { accept: 'application/json' } });
    return response.ok ? await response.json() : {};
  } catch {
    return {};
  }
};
const year = () => Number(field('year').value);
const make = () => field('make').value.trim();
const model = () => field('model').value.trim();

const thisYear = new Date().getFullYear() + 1;
list('dl-year', Array.from({ length: thisYear - 1980 }, (_, i) => String(thisYear - i)));

const loadMakes = async () => { if (year() > 1949) list('dl-make', (await get('/api/vehicle/makes', { year: year() })).makes ?? []); };
const loadModels = async () => { if (year() && make()) list('dl-model', (await get('/api/vehicle/models', { year: year(), make: make() })).models ?? []); };
const loadOptions = async () => {
  if (!(year() && make() && model())) return;
  const r = await get('/api/vehicle/options', { year: year(), make: make(), model: model() });
  list('dl-engine', r.engines ?? []);
  list('dl-drive', r.drivetrains ?? []);
  if (r.engines?.length === 1 && !field('engine').value) field('engine').value = r.engines[0];
  if (r.drivetrains?.length === 1 && !field('drivetrain').value) field('drivetrain').value = r.drivetrains[0];
};
field('year').addEventListener('change', loadMakes);
field('make').addEventListener('change', loadModels);
field('make').addEventListener('focus', () => { if (!document.getElementById('dl-make').children.length) loadMakes(); });
field('model').addEventListener('focus', () => { if (!document.getElementById('dl-model').children.length) loadModels(); });
field('model').addEventListener('change', loadOptions);
field('engine').addEventListener('focus', loadOptions);
box.addEventListener('toggle', () => { if (box.open) { loadMakes(); } }, { once: true });
})();
