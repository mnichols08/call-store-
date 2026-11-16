import test from 'node:test';
import assert from 'node:assert/strict';
import { carryVehicle, parseLine, sayLine, sayVehicle } from '../src/domain/quickline.js';

const NOW = { now: new Date('2026-11-15T12:00:00') };
const read = (text) => parseLine(text, NOW);
const car = (text) => sayVehicle(read(text).vehicle);

test('the four lines from the counter, as typed', () => {
  let p = read('90 eclipse front brakes');
  assert.deepEqual(p.vehicle, { year: '1990', make: 'Mitsubishi', model: 'Eclipse' });
  assert.equal(p.part, 'Front brakes');
  assert.equal(p.kind, 'both');

  p = read('front struts for 2000 tacoma');
  assert.deepEqual(p.vehicle, { year: '2000', make: 'Toyota', model: 'Tacoma' });
  assert.equal(p.part, 'Front struts');

  p = read('universal joint for 2007 chevy 3/4 ton');
  assert.equal(p.part, 'U-joint');
  assert.equal(p.vehicle.year, '2007');
  assert.equal(p.vehicle.make, 'Chevrolet');
  assert.equal(p.vehicle.model, 'Silverado 2500');
  assert.deepEqual(p.guessed, ['model'], 'the truck is a guess from the weight class, and says so');

  p = read('07 cherokee 4.0');
  assert.deepEqual(p.vehicle, { year: '2007', make: 'Jeep', model: 'Cherokee', engine: '4.0L' });
  assert.equal(p.kind, 'vehicle', 'no part: this sets the vehicle for the lines that follow');
});

test('a run of parts under one vehicle, then a new vehicle', () => {
  let car1 = {};
  const lines = ['90 eclipse front brakes', 'rear brakes', 'wheel bearing x2', 'oil filter', '07 cherokee 4.0', 'front shocks', 'sway bar links'];
  const seen = [];
  for (const text of lines) {
    const p = read(text);
    car1 = carryVehicle(car1, p);
    seen.push(`${p.part || '(vehicle)'} | ${sayVehicle(car1)}`);
  }
  assert.deepEqual(seen, [
    'Front brakes | 1990 Mitsubishi Eclipse',
    'Rear brakes | 1990 Mitsubishi Eclipse',
    'Wheel bearing | 1990 Mitsubishi Eclipse',
    'Oil filter | 1990 Mitsubishi Eclipse',
    '(vehicle) | 2007 Jeep Cherokee 4.0L',
    'Front shocks | 2007 Jeep Cherokee 4.0L',
    'Sway bar links | 2007 Jeep Cherokee 4.0L',
  ]);
});

test('a line with only a year or an engine changes the current vehicle; a new make starts over', () => {
  let v = carryVehicle({}, read('2008 f150'));
  assert.equal(sayVehicle(v), '2008 Ford F-150');
  v = carryVehicle(v, read('5.4'));
  assert.equal(sayVehicle(v), '2008 Ford F-150 5.4L');
  v = carryVehicle(v, read('4x4'));
  assert.equal(sayVehicle(v), '2008 Ford F-150 5.4L 4WD');
  v = carryVehicle(v, read('2006 silverado'));
  assert.equal(sayVehicle(v), '2006 Chevrolet Silverado', 'nothing from the Ford is carried over');
});

test('years: four digits, two digits beside a vehicle, an apostrophe, a range', () => {
  assert.equal(read('2000 tacoma').vehicle.year, '2000');
  assert.equal(read("'05 f150").vehicle.year, '2005');
  assert.equal(read('99 civic').vehicle.year, '1999');
  assert.equal(read('26 civic').vehicle.year, '2026');
  assert.equal(read('27 civic').vehicle.year, '2027');
  assert.equal(read('28 civic').vehicle.year, '1928', 'next year and before; anything later is the last century');
  const range = read('99-04 silverado 1500 4x4 rear brakes');
  assert.equal(range.vehicle.year, '1999');
  assert.deepEqual(range.yearRange, [1999, 2004]);
  assert.equal(range.vehicle.drivetrain, '4WD');
  assert.equal(read('2 front struts').vehicle.year, undefined, 'a lone small number is a quantity, not a year');
  assert.equal(read('1500 silverado').vehicle.year, undefined, '1500 is not a year');
  assert.equal(read('2500 chevy').vehicle.year, undefined);
});

test('quantities', () => {
  assert.equal(read('2 front struts for 2000 tacoma').qty, 2);
  assert.equal(read('tie rod ends x2').qty, 2);
  assert.equal(read('4x oil filter').qty, 4);
  assert.equal(read('qty 6 spark plugs').qty, 6);
  assert.equal(read('a pair of wiper blades for a 2015 camry').qty, 2);
  assert.equal(read('front shocks').qty, null);
  assert.equal(read('90 eclipse front brakes').qty, null, '90 is the year');
  assert.equal(read('2 front struts for 2000 tacoma').part, 'Front struts');
});

test('where the part goes, and what it is called', () => {
  assert.equal(read('rear left wheel bearing').part, 'Rear left wheel bearing');
  assert.equal(read('left rear wheel bearing').part, 'Rear left wheel bearing', 'the order typed does not matter');
  assert.equal(read('06 silverado front driver side ball joint').position, 'front left');
  assert.equal(read('passenger side mirror').position, 'right');
  for (const said of ['u joint', 'u-joint', 'ujoint', 'universal joint']) assert.equal(read(said).part, 'U-joint', said);
  assert.equal(read('cv axle').part, 'CV axle');
  assert.equal(read('front brake pads and rotors').part, 'Front brake pads and rotors');
  assert.equal(read('something unusual').part, 'Something unusual', 'unknown parts are kept as typed');
});

test('makes, nicknames and models', () => {
  assert.equal(car('chevy silverado'), 'Chevrolet Silverado');
  assert.equal(car('vw jetta'), 'Volkswagen Jetta');
  assert.equal(car('2005 f-150'), '2005 Ford F-150');
  assert.equal(car('2005 f150'), '2005 Ford F-150');
  assert.equal(car('2005 f 150'), '2005 Ford F-150');
  assert.equal(car('07 jeep grand cherokee'), '2007 Jeep Grand Cherokee');
  assert.equal(car('grand cherokee'), 'Jeep Grand Cherokee', 'a model alone gives its make');
  assert.equal(car('2010 toyota rav4'), '2010 Toyota RAV4');
  assert.equal(car('mercedes c300'), 'Mercedes-Benz C300');
  assert.equal(car('94 crown vic'), '1994 Ford Crown Victoria');
  assert.equal(car('2003 chevy 2500'), '2003 Chevrolet Silverado 2500');
  assert.equal(car('98 f-250 4x4'), '1998 Ford F-250 4WD');
  assert.equal(car('2005 gmc 3/4 ton'), '2005 GMC Sierra 2500');
  assert.equal(car('audi 90'), 'Audi 90');
  assert.equal(car('90 audi 90'), '1990 Audi 90');
  assert.equal(car('07 jeep zzz brakes'), '2007 Jeep Zzz', 'a make with an unknown word after it: that word is the model');
  assert.deepEqual(read('07 jeep zzz brakes').guessed, ['model']);
});

test('Ram is a Dodge until the 2011 model year', () => {
  assert.equal(car('2005 ram 1500'), '2005 Dodge Ram 1500');
  assert.equal(car('2015 ram 1500'), '2015 Ram 1500');
  assert.equal(car('2008 dodge ram 2500'), '2008 Dodge Ram 2500');
  assert.equal(car('ram 2500'), 'Ram 2500');
});

test('words that are also vehicles are parts unless they sit beside a year or a make', () => {
  assert.equal(read('spark plugs for 2010 chevy cobalt').vehicle.model, 'Cobalt');
  assert.equal(read('spark plugs for 2010 chevy cobalt').part, 'Spark plugs');
  assert.equal(read('spark plugs').vehicle.model, undefined);
  assert.equal(read('2010 chevy spark brake pads').vehicle.model, 'Spark');
  assert.equal(read('2010 chevy spark brake pads').part, 'Brake pads');
  assert.equal(read('edge of the window regulator').vehicle.model, undefined);
});

test('engines and drivetrains', () => {
  assert.equal(read('04 silverado 5.3 front brakes').vehicle.engine, '5.3L');
  assert.equal(read('2008 f150 5.4l').vehicle.engine, '5.4L');
  assert.equal(read('2008 f150 5.4 l').vehicle.engine, '5.4L');
  assert.equal(read('07 jeep grand cherokee 4.7 v8 u joint').vehicle.engine, '4.7L V8');
  assert.equal(read('2008 dodge ram 2500 6.7 cummins turbo').vehicle.engine, '6.7L Cummins turbo');
  assert.equal(read('2012 ram 1500 5.7 hemi').vehicle.engine, '5.7L Hemi');
  assert.equal(read('2004 f250 7.3 powerstroke diesel').vehicle.engine, '7.3L Power Stroke diesel');
  assert.equal(read('4wd').vehicle.drivetrain, '4WD');
  assert.equal(read('4 x 4').vehicle.drivetrain, '4WD');
  assert.equal(read('awd').vehicle.drivetrain, 'AWD');
  assert.equal(read('4.0').kind, 'vehicle');
});

test('part numbers are picked out and kept with the part', () => {
  const p = read('alternator AW4066 for a 2008 f-150 5.4l');
  assert.deepEqual(p.partNumbers, ['AW4066']);
  assert.equal(p.part, 'Alternator');
  assert.equal(p.vehicle.model, 'F-150');
  assert.deepEqual(read('6205-2RS').partNumbers, ['6205-2RS']);
  assert.equal(read('6205-2RS').kind, 'part');
  assert.deepEqual(read('OP6603').partNumbers, ['OP6603']);
  assert.deepEqual(read('c1500 brakes').partNumbers, [], 'a model name is not a part number');
  assert.deepEqual(read('2 9496').partNumbers, []);
});

test('filler words and punctuation are ignored', () => {
  const p = read('Do you have a water pump for a 2012 Camry, please?');
  assert.equal(p.part, 'Water pump');
  assert.equal(sayVehicle(p.vehicle), '2012 Toyota Camry');
  assert.equal(read('  OIL   FILTER  ').part, 'Oil filter');
});

test('the read-back says what was understood', () => {
  const p = read('2 front struts for 2000 tacoma');
  assert.equal(sayLine(p, p.vehicle), '2 × Front struts for 2000 Toyota Tacoma');
  const q = read('alternator AW4066');
  assert.equal(sayLine(q, { year: '2008', make: 'Ford', model: 'F-150' }), 'Alternator (AW4066) for 2008 Ford F-150');
});

test('nothing breaks on odd input, and the same text always gives the same answer', () => {
  for (const text of ['', '   ', '!!!', '🙂', '1', '12345678901234567890', 'for the', 'x', '3/4 ton', 'a'.repeat(500), '\u0000\u0001 brakes', '07', '07 07 07', "'", '-', '4.0 4.0 4.0']) {
    const a = read(text);
    assert.deepEqual(read(text), a);
    assert.ok(['empty', 'vehicle', 'part', 'both'].includes(a.kind), JSON.stringify(text));
    assert.ok(a.raw.length <= 200);
  }
  assert.equal(read('').kind, 'empty');
  assert.equal(read('for the').kind, 'empty');
  assert.equal(read('rear').kind, 'part');
  assert.equal(read('rear').part, 'Rear', 'a place with no part: still one, flagged incomplete');
  assert.equal(read('rear').partIncomplete, true);
});

test('a VIN on its own sets the vehicle by its VIN, and is never taken for a part number', () => {
  let p = read('1FTFW1ET5DFC10312');
  assert.equal(p.vin, '1FTFW1ET5DFC10312');
  assert.equal(p.kind, 'vehicle');
  assert.deepEqual(p.partNumbers, []);

  p = read('vin 1ftfw1et5dfc10312 front brakes');
  assert.equal(p.vin, '1FTFW1ET5DFC10312', 'upper-cased');
  assert.equal(p.part, 'Front brakes');
  assert.equal(p.kind, 'both');

  // I, O and Q never appear in a VIN, so 17 characters with one of them is something else.
  assert.equal(read('1FTFW1ET5DFC1O312').vin, undefined);
  assert.equal(read('AW4066 alternator').vin, undefined);
});

test('paint lines, in any order: code, type, brand and amount', () => {
  let p = read('1qt d3 valspar single stage');
  assert.equal(p.kind, 'paint');
  assert.deepEqual(p.paint, { code: 'D3', type: 'Single stage', brand: 'Valspar', amount: 1, unit: 'qt' });
  assert.equal(p.part, 'Paint');

  p = read('paint');
  assert.equal(p.kind, 'paint');
  assert.deepEqual(p.paint, { code: '', type: '', brand: '', amount: null, unit: '' });

  p = read('paint WA8555');
  assert.deepEqual(p.paint, { code: 'WA8555', type: '', brand: '', amount: null, unit: '' });
  assert.deepEqual(p.partNumbers, [], 'a paint code is not a part number');

  p = read('paint wa8555 1 gallon');
  assert.equal(p.paint.code, 'WA8555');
  assert.equal(p.paint.amount, 1);
  assert.equal(p.paint.unit, 'gal');

  p = read('nason basecoat clearcoat 040 2 qts');
  assert.deepEqual(p.paint, { code: '040', type: 'Basecoat/clearcoat', brand: 'Nason', amount: 2, unit: 'qt' });

  p = read('touch up paint pw7 8 oz');
  assert.deepEqual(p.paint, { code: 'PW7', type: 'Touch-up', brand: '', amount: 8, unit: 'oz' });

  p = read('2 spray cans of paint ua');
  assert.equal(p.paint.type, 'Spray can');
  assert.equal(p.paint.code, 'UA');
  assert.equal(p.qty, 2, 'two cans');

  p = read('bc/cc valspar 1f7 half gallon');
  assert.equal(p.paint.type, 'Basecoat/clearcoat');
  assert.equal(p.paint.code, '1F7');
  assert.equal(p.paint.amount, 0.5);
  assert.equal(p.paint.unit, 'gal');
});

test('a paint line keeps the vehicle, and plain parts in quarts are not paint', () => {
  const p = read('paint for 2010 silverado WA8555 1qt');
  assert.equal(p.kind, 'paint');
  assert.equal(p.paint.code, 'WA8555');
  assert.equal(p.vehicle.year, '2010');
  assert.equal(p.vehicle.model, 'Silverado');

  const oil = read('5 qt motor oil');
  assert.equal(oil.kind, 'part');
  assert.equal(oil.paint, undefined);
  assert.equal(read('brake clean spray').paint, undefined);
});

test('the read-back of a paint line', () => {
  const p = read('1qt d3 valspar single stage');
  assert.equal(sayLine(p, {}), 'Paint D3 · Valspar single stage · 1 qt');
  assert.equal(sayLine(read('paint'), {}), 'Paint (code?)');
});
