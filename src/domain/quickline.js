// Reading one typed line at the counter, with fixed rules and no AI, so it gives the same answer
// every time and works offline: "90 eclipse front brakes", "front struts for 2000 tacoma",
// "universal joint for 2007 chevy 3/4 ton", "07 cherokee 4.0". It finds the vehicle (year, make,
// model, engine, drivetrain), the part (with front/rear/left/right), a quantity and any part
// numbers. A line with a vehicle and no part sets the vehicle for the lines that follow.
import { MAKES, TON_MODEL, TRUCK_NUMBER, WEIGHT_CLASS } from './vehicle-names.js';
import { drivetrainOf } from './vehicle.js';

const squash = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// ---------------------------------------------------------------- what the parts are called
const PARTS = {
  'Brake pads': ['brake pads', 'brake pad', 'pads', 'pad', 'brake pad set', 'disc pads', 'front pads', 'rear pads'],
  Rotors: ['rotors', 'rotor', 'brake rotors', 'brake rotor', 'discs', 'disc', 'brake discs'],
  Brakes: ['brakes', 'brake', 'brake job', 'brake kit'],
  'Brake shoes': ['brake shoes', 'brake shoe', 'shoes'],
  'Brake drums': ['drums', 'drum', 'brake drums', 'brake drum'],
  Calipers: ['calipers', 'caliper', 'brake caliper', 'brake calipers'],
  'Brake hose': ['brake hose', 'brake hoses', 'brake line', 'brake lines'],
  'Master cylinder': ['master cylinder', 'master'],
  'Wheel cylinder': ['wheel cylinder', 'wheel cylinders'],
  Struts: ['struts', 'strut', 'strut assembly', 'strut assemblies', 'quick struts', 'quick strut', 'complete struts'],
  Shocks: ['shocks', 'shock', 'shock absorbers', 'shock absorber'],
  'Strut mounts': ['strut mounts', 'strut mount', 'strut bearings', 'strut bearing'],
  'Coil springs': ['coil springs', 'coil spring', 'springs', 'spring'],
  'Leaf springs': ['leaf springs', 'leaf spring', 'leafs', 'leaf'],
  'Control arm': ['control arm', 'control arms', 'a arm', 'a arms', 'a-arm', 'a-arms'],
  'Ball joints': ['ball joints', 'ball joint', 'balljoints', 'balljoint', 'ball jts'],
  'Tie rod ends': ['tie rod ends', 'tie rod end', 'tie rods', 'tie rod', 'tierods', 'tierod', 'tie rod ends'],
  'Sway bar links': ['sway bar links', 'sway bar link', 'stabilizer links', 'stabilizer link', 'sway links', 'sway link', 'end links', 'end link'],
  'Sway bar bushings': ['sway bar bushings', 'sway bar bushing', 'stabilizer bushings'],
  Bushings: ['bushings', 'bushing'],
  'U-joint': ['u joint', 'u joints', 'u-joint', 'u-joints', 'ujoint', 'ujoints', 'universal joint', 'universal joints', 'universal'],
  'CV axle': ['cv axle', 'cv axles', 'axle shaft', 'axle shafts', 'cv shaft', 'axle'],
  'CV boot': ['cv boot', 'cv boots', 'axle boot', 'axle boots'],
  'CV joint': ['cv joint', 'cv joints'],
  'Wheel bearing': ['wheel bearing', 'wheel bearings', 'bearing', 'bearings'],
  'Hub assembly': ['hub assembly', 'hub assemblies', 'hub', 'hubs', 'wheel hub', 'wheel hubs', 'hub bearing', 'hub and bearing'],
  'Wheel studs': ['wheel studs', 'wheel stud', 'studs', 'stud'],
  'Lug nuts': ['lug nuts', 'lug nut', 'lugs'],
  'Water pump': ['water pump', 'water pumps'],
  Thermostat: ['thermostat', 'thermostats', 'stat'],
  Radiator: ['radiator', 'radiators', 'rad'],
  'Radiator hose': ['radiator hose', 'radiator hoses', 'upper hose', 'lower hose', 'upper radiator hose', 'lower radiator hose'],
  'Heater hose': ['heater hose', 'heater hoses'],
  'Heater core': ['heater core'],
  'Coolant reservoir': ['coolant reservoir', 'overflow tank', 'coolant tank', 'expansion tank'],
  'Radiator cap': ['radiator cap', 'rad cap'],
  Fan: ['fan', 'radiator fan', 'cooling fan'],
  'Fan clutch': ['fan clutch'],
  Alternator: ['alternator', 'alternators', 'alt'],
  Starter: ['starter', 'starters'],
  Battery: ['battery', 'batteries'],
  'Battery cable': ['battery cable', 'battery cables', 'battery terminal', 'battery terminals'],
  'Spark plugs': ['spark plugs', 'spark plug', 'plugs', 'plug'],
  'Plug wires': ['plug wires', 'plug wire', 'spark plug wires', 'wires', 'wire set'],
  'Ignition coil': ['ignition coil', 'ignition coils', 'coil', 'coils', 'coil pack', 'coil packs'],
  Distributor: ['distributor', 'dist'],
  'Distributor cap': ['distributor cap', 'dist cap', 'cap and rotor'],
  'Oil filter': ['oil filter', 'oil filters'],
  'Air filter': ['air filter', 'air filters', 'air cleaner', 'engine air filter'],
  'Cabin air filter': ['cabin filter', 'cabin air filter', 'pollen filter', 'ac filter', 'a/c filter'],
  'Fuel filter': ['fuel filter', 'fuel filters', 'gas filter'],
  'Transmission filter': ['transmission filter', 'trans filter', 'filter kit'],
  'Fuel pump': ['fuel pump', 'fuel pumps', 'gas pump'],
  'Fuel injector': ['fuel injector', 'fuel injectors', 'injector', 'injectors'],
  'Serpentine belt': ['serpentine belt', 'serpentine', 'serp belt', 'drive belt', 'accessory belt', 'fan belt'],
  Belt: ['belt', 'belts'],
  'Timing belt': ['timing belt', 'timing belt kit', 'timing kit'],
  'Timing chain': ['timing chain', 'timing chain kit'],
  Tensioner: ['tensioner', 'belt tensioner'],
  'Idler pulley': ['idler pulley', 'idler'],
  'Wiper blades': ['wiper blades', 'wiper blade', 'wipers', 'wiper', 'wiper insert', 'wiper inserts'],
  'Headlight bulb': ['headlight bulb', 'headlight bulbs', 'headlight', 'headlights', 'head light', 'head lights'],
  Bulb: ['bulb', 'bulbs', 'light bulb', 'light bulbs'],
  Taillight: ['taillight', 'tail light', 'taillights', 'tail lights'],
  'Oxygen sensor': ['oxygen sensor', 'o2 sensor', 'o2 sensors', 'oxygen sensors', 'o2'],
  'Catalytic converter': ['catalytic converter', 'cat converter', 'cat', 'catalytic'],
  Muffler: ['muffler', 'mufflers'],
  'Exhaust pipe': ['exhaust pipe', 'tailpipe', 'tail pipe'],
  'Exhaust manifold': ['exhaust manifold', 'manifold'],
  'Gasket set': ['gasket set', 'gasket kit', 'gaskets', 'gasket'],
  'Head gasket': ['head gasket', 'head gaskets'],
  'Valve cover gasket': ['valve cover gasket', 'valve cover gaskets'],
  'Intake gasket': ['intake gasket', 'intake gaskets', 'intake manifold gasket'],
  'Oil pan gasket': ['oil pan gasket'],
  'Oil pan': ['oil pan'],
  'Oil pump': ['oil pump'],
  'Oil pressure sensor': ['oil pressure sensor', 'oil pressure switch', 'oil sending unit'],
  'Rear main seal': ['rear main seal', 'rear main'],
  Clutch: ['clutch', 'clutch kit'],
  Flywheel: ['flywheel'],
  'Throw-out bearing': ['throw out bearing', 'throwout bearing', 'throw-out bearing', 'release bearing'],
  'Slave cylinder': ['slave cylinder', 'slave'],
  'Motor mount': ['motor mount', 'motor mounts', 'engine mount', 'engine mounts'],
  'Transmission mount': ['transmission mount', 'trans mount'],
  'Drive shaft': ['drive shaft', 'driveshaft', 'prop shaft', 'drive shafts'],
  'Carrier bearing': ['carrier bearing', 'center support bearing', 'center bearing', 'center support'],
  'Slip yoke': ['slip yoke', 'yoke'],
  'Pinion seal': ['pinion seal'],
  'Axle seal': ['axle seal', 'axle seals'],
  'Power steering pump': ['power steering pump', 'ps pump'],
  'Power steering hose': ['power steering hose', 'ps hose'],
  'Steering rack': ['steering rack', 'rack and pinion', 'rack'],
  'Steering box': ['steering box', 'gear box', 'gearbox'],
  'Idler arm': ['idler arm'],
  'Pitman arm': ['pitman arm'],
  'Drag link': ['drag link'],
  'Track bar': ['track bar', 'panhard bar'],
  'Steering stabilizer': ['steering stabilizer', 'steering damper'],
  'Window regulator': ['window regulator', 'window regulators', 'regulator'],
  'Window motor': ['window motor'],
  'Door handle': ['door handle', 'door handles'],
  'Door lock actuator': ['door lock actuator', 'lock actuator', 'actuator'],
  'Blower motor': ['blower motor', 'blower'],
  'Blower resistor': ['blower resistor', 'blower motor resistor'],
  'AC compressor': ['ac compressor', 'a/c compressor', 'compressor'],
  'AC condenser': ['ac condenser', 'condenser'],
  'AC hose': ['ac hose', 'a/c hose'],
  Refrigerant: ['refrigerant', 'freon', 'r134a', 'r134'],
  'Mass air flow sensor': ['mass air flow sensor', 'maf sensor', 'maf', 'mass air'],
  'Throttle body': ['throttle body'],
  'Throttle position sensor': ['throttle position sensor', 'tps'],
  'Crankshaft sensor': ['crankshaft sensor', 'crank sensor', 'crank position sensor'],
  'Camshaft sensor': ['camshaft sensor', 'cam sensor', 'cam position sensor'],
  'ABS sensor': ['abs sensor', 'wheel speed sensor', 'speed sensor'],
  'Knock sensor': ['knock sensor'],
  'Coolant temperature sensor': ['coolant temp sensor', 'coolant temperature sensor', 'temp sensor'],
  'EGR valve': ['egr valve', 'egr'],
  'PCV valve': ['pcv valve', 'pcv'],
  Relay: ['relay', 'relays'],
  Fuse: ['fuse', 'fuses'],
  Horn: ['horn'],
  Mirror: ['mirror', 'mirrors', 'side mirror'],
  'Hood strut': ['hood strut', 'hood struts', 'hood lift support', 'hood lift supports'],
  'Trunk strut': ['trunk strut', 'trunk struts', 'liftgate strut', 'liftgate struts', 'hatch strut', 'hatch struts'],
  'Gas cap': ['gas cap', 'fuel cap'],
  'Oil cap': ['oil cap'],
  'Brake fluid': ['brake fluid'],
  'Motor oil': ['motor oil', 'oil'],
  Coolant: ['coolant', 'antifreeze'],
  'Transmission fluid': ['transmission fluid', 'trans fluid', 'atf'],
  'Power steering fluid': ['power steering fluid', 'ps fluid'],
  Grease: ['grease'],
  'Hydraulic hose': ['hydraulic hose'],
  Hose: ['hose', 'hoses'],
  Fitting: ['fitting', 'fittings'],
};
const POSITIONS = {
  front: 'front', rear: 'rear', back: 'rear',
  left: 'left', lh: 'left', driver: 'left', drivers: 'left', "driver's": 'left', 'driver side': 'left',
  right: 'right', rh: 'right', passenger: 'right', passengers: 'right', "passenger's": 'right', pass: 'right', 'passenger side': 'right',
  upper: 'upper', lower: 'lower', inner: 'inner', outer: 'outer',
};
const FILLER = new Set(['for', 'a', 'an', 'the', 'need', 'needs', 'needed', 'i', 'we', 'me', 'my', 'want', 'wants', 'looking', 'look', 'do', 'you', 'have', 'got', 'on', 'to', 'fit', 'fits', 'with', 'please', 'some', 'any', 'of', 'in', 'is', 'are', 'it', 'its', 'and a', 'also', 'next', 'then', 'plus', 'pair', 'pairs', 'pr']);

const PHRASES = new Map(); // squashed words → canonical part name
const PART_WORDS = new Set();
for (const [canonical, names] of Object.entries(PARTS)) {
  for (const name of [canonical, ...names]) {
    PHRASES.set(name.toLowerCase().split(/\s+/).join(' '), canonical);
    for (const word of name.toLowerCase().split(/\s+/)) PART_WORDS.add(word);
  }
}
const SIDE_ORDER = ['front', 'rear', 'left', 'right', 'upper', 'lower', 'inner', 'outer'];

// ---------------------------------------------------------------- paint
// A line is paint when it says "paint", names a paint brand or a paint type. "1qt d3 valspar single
// stage", "paint WA8555", "nason basecoat clearcoat 040 2 qts". What's left is the paint code.
const PAINT_TYPES = [
  [/^(touch ?up|touch-up|touchup)$/, 'Touch-up', true],
  [/^(spray cans?|rattle cans?|aerosol)$/, 'Spray can', true],
  [/^(single stage|singlestage)$/, 'Single stage', true],
  [/^(base ?coat|clear ?coat|basecoat|clearcoat|bc\/cc|base\/clear|basecoat\/clearcoat|base clear)$/, 'Basecoat/clearcoat', true],
  // Short forms count only on a line that is already paint.
  [/^ss$/, 'Single stage', false],
  [/^(bc|cc)$/, 'Basecoat/clearcoat', false],
  [/^spray$/, 'Spray can', false],
];
const PAINT_BRANDS = { nason: 'Nason', valspar: 'Valspar' };
const PAINT_UNITS = { oz: 'oz', ounce: 'oz', ounces: 'oz', qt: 'qt', qts: 'qt', quart: 'qt', quarts: 'qt', gal: 'gal', gals: 'gal', gallon: 'gal', gallons: 'gal' };
const PAINT_WORDS = new Set(['paint', 'paints', 'code', 'color', 'colour', 'of', 'can', 'cans', 'coat']);
const paintType = (t, strongOnly) => PAINT_TYPES.find(([re, , strong]) => (strong || !strongOnly) && re.test(t))?.[1] ?? '';
const amountOf = (text) => {
  if (text === 'half') return 0.5;
  const m = /^(\d+(?:\.\d+)?)$|^(\d+)\/(\d+)$/.exec(text);
  if (!m) return null;
  return m[1] ? Number(m[1]) : Number(m[2]) / Number(m[3]);
};

// ---------------------------------------------------------------- what the vehicles are called
const MAKE_BY_ALIAS = new Map(); // squashed alias → make
const MODELS = new Map(); // squashed alias → [{ make, model, weak }]
const PRIORITY = Object.keys(MAKES);
for (const [make, { aliases, models }] of Object.entries(MAKES)) {
  for (const a of aliases) MAKE_BY_ALIAS.set(squash(a), make);
  MAKE_BY_ALIAS.set(squash(make), make);
  for (const entry of models) {
    const weak = entry.includes('*');
    const [display, ...rest] = entry.replace('*', '').split('|');
    for (const alias of [display, ...rest]) {
      const key = squash(alias);
      if (!key) continue;
      const list = MODELS.get(key) ?? [];
      if (!list.some((m) => m.make === make && m.model === display)) list.push({ make, model: display, weak });
      MODELS.set(key, list);
    }
  }
}
const ALL_MODEL_WORDS = new Set([...MODELS.keys()]);

const clampYear = (n, nowYear) => (n <= (nowYear + 1) % 100 ? 2000 + n : 1900 + n);
const isYear = (n, nowYear) => n >= 1950 && n <= nowYear + 1;

/** Read one line. `now` only supplies the current year. Never throws; an empty or unreadable line has kind "empty". */
export function parseLine(text, { now = new Date() } = {}) {
  const nowYear = now.getFullYear();
  const raw = String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const result = { raw, kind: 'empty', vehicle: {}, guessed: [], part: '', position: '', qty: null, partNumbers: [], tokens: [] };
  if (!raw) return result;

  let toks = raw.replace(/&/g, ' and ').split(' ').filter(Boolean).map((word) => ({ word, t: word.toLowerCase().replace(/^[("]+|[,;:)"!?]+$/g, '').replace(/\.$/, ''), role: '' }));

  // ---- glue words that mean one thing: "3/4 ton", "4 x 4", "5.3 l"
  for (let i = 0; i < toks.length; i += 1) {
    const a = toks[i];
    const b = toks[i + 1];
    const c = toks[i + 2];
    const glue = (n, t) => { toks.splice(i, n, { word: toks.slice(i, i + n).map((x) => x.word).join(' '), t, role: '' }); };
    if (b && /^tons?$/.test(b.t) && WEIGHT_CLASS[`${a.t} ton`]) glue(2, `${a.t} ton`);
    else if (/^(3\/4|1\/2|1)[- ]?ton$/.test(a.t)) a.t = `${a.t.replace(/[- ]?ton$/, '')} ton`;
    else if (a.t === 'three' && b?.t === 'quarter' && c && /^tons?$/.test(c.t)) glue(3, 'three quarter ton');
    else if (b && c && /^[24]$/.test(a.t) && b.t === 'x' && /^[24]$/.test(c.t)) glue(3, `${a.t}x${c.t}`);
    else if (b && /^\d\.\d\d?$/.test(a.t) && /^(l|liter|litre|liters|litres)$/.test(b.t)) glue(2, `${a.t}l`);
    else if (b && /^v$/.test(a.t) && /^(6|8|10|12)$/.test(b.t)) glue(2, `v${b.t}`);
    else if (b && /^\d$/.test(a.t) && /^cyl(inder)?s?$/.test(b.t)) glue(2, `${a.t}cyl`);
  }

  const vehicle = result.vehicle;
  const say = (token, role) => { token.role = role; };

  // ---- a VIN: 17 letters and digits, never I, O or Q ("vin" before it is just a label)
  for (const k of toks) {
    if (!/^[a-hj-npr-z0-9]{17}$/.test(k.t) || !/\d/.test(k.t) || !/[a-z]/.test(k.t)) continue;
    result.vin = k.t.toUpperCase();
    say(k, 'vin');
    for (const label of toks) if (!label.role && label.t === 'vin') say(label, 'skip');
    break;
  }

  // ---- paint: "paint", a brand or a type makes it a paint line; then the amount, and the code is what's left
  for (let i = 0; i < toks.length - 1; i += 1) {
    const two = `${toks[i].t} ${toks[i + 1].t}`;
    if (paintType(two, true)) toks.splice(i, 2, { word: `${toks[i].word} ${toks[i + 1].word}`, t: two, role: '' });
  }
  const isPaint = toks.some((k) => /^paints?$/.test(k.t) || PAINT_BRANDS[k.t] || paintType(k.t, true));
  let paint = null;
  if (isPaint) {
    paint = { code: '', type: '', brand: '', amount: null, unit: '' };
    for (let i = 0; i < toks.length; i += 1) {
      const k = toks[i];
      if (k.role) continue;
      const type = paintType(k.t, false);
      if (type) { if (!paint.type) paint.type = type; say(k, 'paint'); continue; }
      if (PAINT_BRANDS[k.t]) { paint.brand = PAINT_BRANDS[k.t]; say(k, 'paint'); continue; }
      // "1qt", "8oz", "2 qts", "1 gallon", "half gallon", "1/2 gal"
      const glued = /^(\d+(?:\.\d+)?|\d+\/\d+)([a-z]+)$/.exec(k.t);
      if (glued && PAINT_UNITS[glued[2]] && paint.amount === null) { paint.amount = amountOf(glued[1]); paint.unit = PAINT_UNITS[glued[2]]; say(k, 'amount'); continue; }
      const next = toks[i + 1];
      if (next && !next.role && PAINT_UNITS[next.t] && amountOf(k.t) !== null && paint.amount === null) { paint.amount = amountOf(k.t); paint.unit = PAINT_UNITS[next.t]; say(k, 'amount'); say(next, 'amount'); i += 1; continue; }
      if (PAINT_WORDS.has(k.t)) say(k, 'skip');
    }
    // "2 spray cans": a count of cans
    if (paint.type === 'Spray can') {
      const count = toks.find((k) => !k.role && /^\d{1,2}$/.test(k.t) && Number(k.t) > 0);
      if (count) { result.qty = Number(count.t); say(count, 'qty'); }
    }
  }

  // ---- weight class, drivetrain, engine
  let weight = '';
  let liters = '';
  let cylinders = '';
  const extras = [];
  for (const k of toks) {
    if (WEIGHT_CLASS[k.t]) { weight = WEIGHT_CLASS[k.t]; say(k, 'model'); continue; }
    if (/^(4x4|4wd|awd|2wd|fwd|rwd|4x2|2x4)$/.test(k.t)) { vehicle.drivetrain = drivetrainOf(k.t.replace('2x4', '4x2')); say(k, 'drive'); continue; }
    const l = /^(\d\.\d\d?)l?$/.exec(k.t);
    if (l && Number(l[1]) >= 0.6 && Number(l[1]) <= 8.4 && !liters) { liters = `${Number(l[1]).toFixed(1)}L`; say(k, 'engine'); continue; }
    const v = /^v(6|8|10|12)$/.exec(k.t);
    if (v) { cylinders = `V${v[1]}`; say(k, 'engine'); continue; }
    const cyl = /^(3|4|5|6|8)cyl$/.exec(k.t) ?? /^i(3|4|5|6)$/.exec(k.t);
    if (cyl) { cylinders = cylinders || (Number(cyl[1]) >= 8 ? `V${cyl[1]}` : `${cyl[1]}-cyl`); say(k, 'engine'); continue; }
    const ci = /^(\d{3})(ci|cid|cu)$/.exec(k.t);
    if (ci) { extras.push(`${ci[1]} ci`); say(k, 'engine'); continue; }
    if (/^(diesel|turbo|turbodiesel|hemi|duramax|cummins|powerstroke|ecoboost|supercharged)$/.test(k.t)) { extras.push(k.t === 'turbodiesel' ? 'turbo diesel' : k.t === 'ecoboost' ? 'EcoBoost' : k.t === 'powerstroke' ? 'Power Stroke' : k.t === 'duramax' ? 'Duramax' : k.t === 'cummins' ? 'Cummins' : k.t === 'hemi' ? 'Hemi' : k.t); say(k, 'engine'); }
  }
  for (let i = 0; i < toks.length - 1; i += 1) {
    if (toks[i].t === 'power' && toks[i + 1].t === 'stroke') { extras.push('Power Stroke'); say(toks[i], 'engine'); say(toks[i + 1], 'engine'); }
  }

  // ---- years: 2000, '05, 99-04
  let year = 0;
  for (const k of toks) {
    if (k.role) continue;
    let m = /^'?(\d{4})$/.exec(k.t);
    if (m && isYear(Number(m[1]), nowYear) && !year) { year = Number(m[1]); say(k, 'year'); continue; }
    m = /^'(\d\d)$/.exec(k.t);
    if (m && !year) { year = clampYear(Number(m[1]), nowYear); say(k, 'year'); continue; }
    m = /^(\d{2}|\d{4})-(\d{2}|\d{4})$/.exec(k.t);
    if (m && !year) {
      const [a, b] = [m[1], m[2]].map((s) => (s.length === 2 ? clampYear(Number(s), nowYear) : Number(s)));
      if (isYear(a, nowYear) && isYear(b, nowYear) && a <= b) { year = a; say(k, 'year'); result.yearRange = [a, b]; }
    }
  }

  // ---- make and model: the longest run of words that is one, and a model gives its make
  let make = '';
  let model = '';
  let modelEntry = null;
  const claim = (from, n, role) => { for (let j = from; j < from + n; j += 1) say(toks[j], role); };
  const free = (j) => toks[j] && !toks[j].role;
  const near = (i, n) => [toks[i - 1], toks[i + n]].some((x) => x && (x.role === 'year' || x.role === 'make'));
  let modelAt = null;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < toks.length; i += 1) {
      if (!free(i)) continue;
      for (const n of [3, 2, 1]) {
        if (i + n > toks.length || ![...Array(n).keys()].every((d) => free(i + d))) continue;
        const key = squash(toks.slice(i, i + n).map((x) => x.t).join(' '));
        if (pass === 0 && !make && MAKE_BY_ALIAS.has(key)) { make = MAKE_BY_ALIAS.get(key); claim(i, n, 'make'); break; }
        const list = MODELS.get(key);
        if (!list || modelEntry) continue;
        if (/^\d+$/.test(key)) {
          // A number alone is a model only straight after its make ("audi 90", "volvo 240"), never a year.
          if (pass === 1 && toks[i - 1]?.role === 'make' && list.some((m) => m.make === make)) { modelEntry = list; modelAt = { i, n }; claim(i, n, 'model'); break; }
        } else if (pass === 0 && list.some((m) => !m.weak)) { modelEntry = list; modelAt = { i, n }; claim(i, n, 'model'); break; }
        else if (pass === 1 && near(i, n)) { modelEntry = list; modelAt = { i, n }; claim(i, n, 'model'); break; }
      }
    }
  }
  if (modelEntry) {
    const pick = modelEntry.find((m) => m.make === make) ?? modelEntry[0];
    model = pick.model;
    if (!make || make !== pick.make) make = pick.make;
    // "Dodge Ram 2500", "Silverado 1500": the number after the name belongs to it.
    const after = toks[modelAt.i + modelAt.n];
    if (['Ram', 'Silverado', 'Sierra'].includes(model) && after && !after.role && /^(1500|2500|3500|4500|5500)(hd)?$/.test(after.t)) { model += ` ${after.t.toUpperCase()}`; say(after, 'model'); }
  }
  // "3/4 ton" with a make is that maker's truck; a bare 1500/2500/3500 after Chevy/GMC/Dodge is too.
  if (!model && weight) {
    model = (make && TON_MODEL[make]?.[weight]) || { half: '1/2 ton', 'three-quarter': '3/4 ton', one: '1 ton' }[weight];
    if (make && TON_MODEL[make]) result.guessed.push('model');
  }
  if (!model && make && make in TRUCK_NUMBER) {
    for (const k of toks) {
      if (!k.role && /^(1500|2500|3500|4500|5500)$/.test(k.t)) { model = `${TRUCK_NUMBER[make] ? `${TRUCK_NUMBER[make]} ` : ''}${k.t}`.trim(); say(k, 'model'); if (make === 'Chevrolet' || make === 'GMC') result.guessed.push('model'); break; }
    }
  }
  // A make with a word after it that is not a part, a place or a number: that is probably the model.
  if (make && !model) {
    const at = toks.findIndex((k) => k.role === 'make');
    const next = toks[at + 1];
    if (next && !next.role && !FILLER.has(next.t) && !POSITIONS[next.t] && !PART_WORDS.has(next.t) && !/^\d/.test(next.t) && /^[a-z][a-z0-9-]{1,}$/.test(next.t)) {
      model = next.word.replace(/[,;:.]+$/, '').replace(/^./, (c) => c.toUpperCase());
      say(next, 'model');
      result.guessed.push('model');
    }
  }

  // ---- a bare two-digit number beside a make or model is a year: "90 eclipse", "07 cherokee"
  if (!year) {
    for (let i = 0; i < toks.length; i += 1) {
      const k = toks[i];
      if (k.role || !/^\d\d$/.test(k.t)) continue;
      const side = [toks[i - 1], toks[i + 1]].some((x) => x && (x.role === 'make' || x.role === 'model'));
      if (side) { year = clampYear(Number(k.t), nowYear); say(k, 'year'); break; }
    }
  }

  // ---- a paint line's code is what's left: "d3", "WA8555", "040"
  if (paint) {
    const code = toks.filter((k) => !k.role && !FILLER.has(k.t) && /^[a-z0-9-]{1,10}$/.test(k.t));
    paint.code = code.map((k) => k.t.toUpperCase()).join(' ');
    for (const k of code) say(k, 'code');
    for (const k of toks) if (!k.role) say(k, 'skip');
    result.paint = paint;
  }

  // ---- part numbers: letters and digits together, or a long number
  for (const k of toks) {
    if (k.role) continue;
    const bare = k.t.replace(/-/g, '');
    const mixed = /[a-z]/.test(bare) && /\d/.test(bare) && bare.length >= 5;
    const dashed = /^\d{1,3}-\d{3,7}$/.test(k.t);
    const long = /^\d{5,}$/.test(bare);
    if ((mixed || dashed || long) && !ALL_MODEL_WORDS.has(squash(k.t))) { result.partNumbers.push(k.word.replace(/[,;:.]+$/, '').toUpperCase()); say(k, 'number'); }
  }

  // ---- quantity: "2 front struts", "x2", "2x", "(2) shocks", "a pair of", "qty 4"
  const firstFree = toks.findIndex((k) => !k.role && !FILLER.has(k.t));
  for (let i = 0; i < toks.length; i += 1) {
    const k = toks[i];
    if (k.role) continue;
    let m = /^x(\d{1,2})$|^(\d{1,2})x$/.exec(k.t);
    if (m) { result.qty = Number(m[1] ?? m[2]); say(k, 'qty'); break; }
    if (/^(qty|quantity)$/.test(k.t) && toks[i + 1] && /^\d{1,2}$/.test(toks[i + 1].t)) { result.qty = Number(toks[i + 1].t); say(k, 'qty'); say(toks[i + 1], 'qty'); break; }
    if (/^(pair|pr)$/.test(k.t)) { result.qty = 2; say(k, 'qty'); break; }
    if (i === firstFree && /^\d{1,2}$/.test(k.t) && Number(k.t) > 0 && toks.slice(i + 1).some((x) => !x.role && !FILLER.has(x.t))) { result.qty = Number(k.t); say(k, 'qty'); break; }
  }

  // ---- what is left is the part: where it goes (front, left…) and what it is
  const words = [];
  const places = new Set();
  for (let i = 0; i < toks.length; i += 1) {
    const k = toks[i];
    if (k.role) continue;
    if (FILLER.has(k.t)) { say(k, 'skip'); continue; }
    const two = toks[i + 1] && !toks[i + 1].role ? `${k.t} ${toks[i + 1].t}` : '';
    if (two && POSITIONS[two]) { places.add(POSITIONS[two]); say(k, 'position'); say(toks[i + 1], 'position'); i += 1; continue; }
    if (POSITIONS[k.t]) { places.add(POSITIONS[k.t]); say(k, 'position'); continue; }
    words.push({ t: k.t, k });
  }
  const core = [];
  for (let i = 0; i < words.length; i += 1) {
    let hit = null;
    for (const n of [3, 2, 1]) {
      const phrase = words.slice(i, i + n).map((w) => w.t).join(' ');
      if (words.length >= i + n && PHRASES.has(phrase)) { hit = { n, canonical: PHRASES.get(phrase) }; break; }
    }
    if (hit) { core.push(hit.canonical); for (let j = i; j < i + hit.n; j += 1) say(words[j].k, 'part'); i += hit.n - 1; } else { core.push(words[i].t); say(words[i].k, 'part'); }
  }
  const position = SIDE_ORDER.filter((p) => places.has(p)).join(' ');
  const lowerFirst = (s) => (/^[A-Z]{2}|^[A-Z]-/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  const joined = core.map((w, i) => (i === 0 ? w : lowerFirst(w))).join(' ').replace(/\s+/g, ' ').trim();
  const label = joined && position ? `${position.charAt(0).toUpperCase()}${position.slice(1)} ${lowerFirst(joined)}` : joined ? joined.charAt(0).toUpperCase() + joined.slice(1) : position ? `${position.charAt(0).toUpperCase()}${position.slice(1)} (what?)` : '';
  result.part = joined || position ? label.replace(/ \(what\?\)$/, '') : '';
  result.position = position;
  result.partIncomplete = !joined && Boolean(position);
  if (paint) result.part = 'Paint';

  // ---- the vehicle, assembled
  // Ram became its own make with the 2011 model year; before that it was a Dodge.
  if (/^Ram( |$)/.test(model) && (make === 'Dodge' || make === 'Ram')) {
    const dodge = toks.some((k) => k.role === 'make' && squash(k.t) === 'dodge');
    if (year >= 2011 || (!year && !dodge)) { make = 'Ram'; model = model.replace(/^Ram ?/, '') || ''; } else { make = 'Dodge'; }
  }
  if (year) vehicle.year = String(year);
  if (make) vehicle.make = make;
  if (model) vehicle.model = model;
  const engine = [liters, cylinders, ...extras].filter(Boolean).join(' ');
  if (engine) vehicle.engine = engine;
  const hasVehicle = Object.keys(vehicle).length > 0 || Boolean(result.vin);
  const hasPart = Boolean(result.part || result.partNumbers.length || result.partIncomplete);
  result.kind = paint ? 'paint' : hasVehicle && hasPart ? 'both' : hasVehicle ? 'vehicle' : hasPart ? 'part' : 'empty';
  result.tokens = toks.map((k) => ({ text: k.word, role: k.role || 'part' }));
  return result;
}

/** "2007 Jeep Cherokee 4.0L": a vehicle as the counter says it. */
export const sayVehicle = (v) => [v?.year, v?.make, v?.model, v?.engine, v?.drivetrain].filter(Boolean).join(' ');

/**
 * What vehicle the next line is about. A line with a VIN, make or model starts a new vehicle (nothing is
 * carried over from the last one); a line with only a year, engine or drivetrain changes the current
 * vehicle; a line with none of them stays on the current vehicle.
 */
export function carryVehicle(current, parsed) {
  const v = parsed.vehicle;
  // A VIN is a vehicle of its own: until it is decoded it is only the VIN, never the last one typed.
  if (parsed.vin || v.make || v.model) return { ...v };
  if (Object.keys(v).length) return { ...(current ?? {}), ...v };
  return { ...(current ?? {}) };
}

/** "Paint D3 · Valspar single stage · 1 qt" */
export function sayPaint(paint) {
  const kind = [paint.brand, paint.brand ? paint.type.toLowerCase() : paint.type.charAt(0).toLowerCase() + paint.type.slice(1)].filter(Boolean).join(' ');
  const amount = paint.amount !== null && paint.amount !== undefined ? `${paint.amount} ${paint.unit}` : '';
  return [`Paint ${paint.code || '(code?)'}`, kind, amount].filter(Boolean).join(' · ');
}

/** The one-line summary of a parsed line, for the read-back. */
export function sayLine(parsed, vehicle) {
  if (parsed.paint) {
    const on = sayVehicle(vehicle);
    return `${parsed.qty > 1 ? `${parsed.qty} × ` : ''}${sayPaint(parsed.paint)}${on ? ` for ${on}` : ''}`;
  }
  const bits = [];
  if (parsed.qty && parsed.qty > 1) bits.push(`${parsed.qty} ×`);
  bits.push(parsed.part || (parsed.partNumbers.length ? `Part ${parsed.partNumbers.join(', ')}` : ''));
  if (parsed.part && parsed.partNumbers.length) bits.push(`(${parsed.partNumbers.join(', ')})`);
  const what = bits.filter(Boolean).join(' ');
  const on = sayVehicle(vehicle);
  return what && on ? `${what} for ${on}` : what || on;
}
