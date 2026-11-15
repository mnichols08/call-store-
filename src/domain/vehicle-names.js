// The vehicles a parts counter hears about, so a typed line can be read without a network or an AI:
// each make with the names people call it, and its common models. A model ending in * is a word that
// is also an ordinary word or a part (Spark, Edge, Fit), so it only counts next to a year or a make.
// "Name|alias|alias" gives other ways it is said. This is a convenience, not a catalogue: a model
// that is not here is still kept as typed.

export const MAKES = {
  Acura: { aliases: ['acura'], models: ['ILX', 'Integra', 'Legend', 'MDX', 'NSX', 'RDX', 'RL', 'RSX', 'TL', 'TLX', 'TSX', 'CL', 'ZDX', 'Vigor', 'CSX'] },
  'Alfa Romeo': { aliases: ['alfa romeo', 'alfa'], models: ['Giulia', 'Stelvio', '4C', 'Spider'] },
  Audi: { aliases: ['audi'], models: ['A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q3', 'Q5', 'Q7', 'Q8', 'TT', 'S4', 'S6', 'RS5', 'Allroad', '80', '90', '100', '200'] },
  Buick: { aliases: ['buick'], models: ['Century*', 'Enclave', 'Encore', 'Envision', 'LaCrosse|la crosse', 'LeSabre|le sabre', 'Lucerne', 'Park Avenue', 'Regal', 'Rendezvous', 'Riviera', 'Roadmaster', 'Skylark', 'Terraza', 'Verano', 'Electra', 'Reatta'] },
  Cadillac: { aliases: ['cadillac', 'caddy', 'cady'], models: ['ATS', 'CTS', 'DTS', 'DeVille|de ville', 'Eldorado', 'Escalade', 'Seville', 'SRX', 'STS', 'XT5', 'XTS', 'Catera', 'Fleetwood', 'Brougham', 'Allante', 'CT6', 'Cimarron'] },
  Chevrolet: { aliases: ['chevrolet', 'chevy', 'chev'], models: ['Astro', 'Avalanche', 'Aveo', 'Beretta', 'Blazer', 'S10 Blazer|s-10 blazer', 'Camaro', 'Caprice', 'Cavalier', 'Celebrity', 'Chevelle', 'Chevette', 'Citation', 'Cobalt', 'Colorado', 'Corsica', 'Corvette', 'Cruze', 'El Camino', 'Equinox', 'Express*', 'HHR', 'Impala', 'Lumina', 'Malibu', 'Monte Carlo', 'Nova*', 'Orlando', 'S10|s-10', 'Silverado', 'Sonic', 'Spark*', 'Suburban', 'Tahoe', 'Tracker', 'TrailBlazer|trail blazer', 'Traverse', 'Trax', 'Uplander', 'Venture', 'Volt', 'Bolt*', 'Silverado 1500', 'Silverado 2500', 'Silverado 2500HD', 'Silverado 3500', 'Sierra 1500', 'C1500|c-1500|c 1500', 'K1500|k-1500|k 1500', 'C2500|c-2500|c 2500', 'K2500|k-2500|k 2500', 'C3500|c-3500|c 3500', 'K3500|k-3500|k 3500', 'G20', 'G30', 'Kodiak'] },
  Chrysler: { aliases: ['chrysler'], models: ['200', '300', '300M', 'Aspen', 'Cirrus', 'Concorde', 'Crossfire', 'Lebaron|le baron', 'New Yorker', 'Pacifica', 'PT Cruiser|pt cruiser|ptcruiser', 'Sebring', 'Town & Country|town and country|town & country', 'Voyager', 'Fifth Avenue', 'Imperial', 'Intrepid*', 'LHS', 'Prowler'] },
  Dodge: { aliases: ['dodge'], models: ['Avenger', 'Caliber', 'Caravan', 'Grand Caravan', 'Challenger', 'Charger', 'Dakota', 'Dart', 'Durango', 'Intrepid*', 'Journey*', 'Magnum', 'Neon', 'Nitro', 'Omni', 'Ram', 'Ram 1500', 'Ram 2500', 'Ram 3500', 'Ram 4500', 'Ram 5500', 'Ramcharger', 'Shadow', 'Spirit', 'Stealth', 'Stratus', 'Viper', 'Colt', 'Daytona', 'Aries', 'B150', 'B250', 'B350', 'D150', 'D250', 'D350', 'W150', 'W250', 'W350'] },
  Ford: { aliases: ['ford'], models: ['Aerostar', 'Bronco', 'Bronco II', 'Contour', 'Crown Victoria|crown vic|crownvic|crown victoria', 'E-150|e150|e 150', 'E-250|e250|e 250', 'E-350|e350|e 350', 'Econoline', 'Edge*', 'Escape', 'Escort', 'Excursion', 'Expedition', 'Explorer', 'Explorer Sport Trac', 'F-150|f150|f 150', 'F-250|f250|f 250', 'F-350|f350|f 350', 'F-450|f450|f 450', 'F-550|f550|f 550', 'Fiesta', 'Five Hundred|500', 'Flex*', 'Focus', 'Freestar', 'Freestyle', 'Fusion', 'Galaxie', 'Mustang', 'Pinto', 'Probe', 'Ranger', 'Taurus', 'Tempo', 'Thunderbird|t-bird', 'Transit', 'Transit Connect', 'Windstar', 'Maverick', 'Fairlane', 'LTD', 'Bronco Sport', 'EcoSport'] },
  GMC: { aliases: ['gmc', 'gm'], models: ['Acadia', 'Canyon', 'Envoy', 'Jimmy', 'S15', 'Safari*', 'Savana', 'Sierra', 'Sierra 1500', 'Sierra 2500', 'Sierra 2500HD', 'Sierra 3500', 'Sonoma', 'Suburban', 'Terrain', 'Typhoon', 'Vandura', 'Yukon', 'Yukon XL', 'C1500|c-1500|c 1500', 'K1500|k-1500|k 1500', 'C2500|c-2500|c 2500', 'K2500|k-2500|k 2500', 'Topkick'] },
  Honda: { aliases: ['honda'], models: ['Accord', 'Civic', 'Crosstour', 'CR-V|crv|cr v', 'CR-Z|crz', 'Element*', 'Fit*', 'HR-V|hrv', 'Insight', 'Odyssey', 'Passport', 'Pilot*', 'Prelude', 'Ridgeline', 'S2000', 'Del Sol', 'CRX'] },
  Hyundai: { aliases: ['hyundai'], models: ['Accent', 'Azera', 'Elantra', 'Entourage', 'Genesis', 'Ioniq', 'Kona', 'Palisade', 'Santa Fe|santafe', 'Sonata', 'Tiburon', 'Tucson', 'Veloster', 'Veracruz', 'XG300', 'Excel'] },
  Infiniti: { aliases: ['infiniti'], models: ['G35', 'G37', 'FX35', 'FX45', 'I30', 'I35', 'J30', 'M35', 'M45', 'Q45', 'Q50', 'QX4', 'QX56', 'QX60', 'EX35'] },
  Isuzu: { aliases: ['isuzu'], models: ['Amigo', 'Ascender', 'Axiom', 'Hombre', 'i-350|i350', 'Impulse', 'NPR', 'Oasis', 'Rodeo', 'Stylus', 'Trooper', 'VehiCross'] },
  Jaguar: { aliases: ['jaguar', 'jag'], models: ['F-Type', 'S-Type|s type', 'X-Type|x type', 'XF', 'XJ', 'XJ6', 'XJ8', 'XK8', 'XKR'] },
  Jeep: { aliases: ['jeep'], models: ['CJ5', 'CJ7', 'Cherokee', 'Commander', 'Compass*', 'Gladiator', 'Grand Cherokee|grand cherokee', 'Grand Wagoneer', 'Liberty', 'Patriot', 'Renegade', 'Wagoneer', 'Wrangler', 'Wrangler Unlimited', 'Comanche', 'YJ', 'TJ', 'JK'] },
  Kia: { aliases: ['kia'], models: ['Amanti', 'Borrego', 'Cadenza', 'Forte', 'Niro', 'Optima', 'Rio', 'Rondo', 'Sedona', 'Sephia', 'Sorento', 'Soul*', 'Spectra', 'Sportage', 'Stinger', 'Telluride', 'Seltos'] },
  'Land Rover': { aliases: ['land rover', 'landrover', 'rover'], models: ['Defender', 'Discovery', 'Freelander', 'LR2', 'LR3', 'LR4', 'Range Rover', 'Range Rover Sport', 'Evoque'] },
  Lexus: { aliases: ['lexus'], models: ['CT200h', 'ES300', 'ES330', 'ES350', 'GS300', 'GS350', 'GX460', 'GX470', 'IS250', 'IS300', 'IS350', 'LS400', 'LS430', 'LX470', 'LX570', 'RX300', 'RX330', 'RX350', 'RX400h', 'SC430', 'NX200t'] },
  Lincoln: { aliases: ['lincoln'], models: ['Aviator', 'Continental', 'LS', 'Mark VIII', 'Mark LT', 'MKC', 'MKS', 'MKT', 'MKX', 'MKZ', 'Navigator', 'Town Car|towncar', 'Zephyr', 'Blackwood'] },
  Mazda: { aliases: ['mazda'], models: ['323', '626', 'B2200', 'B2300', 'B3000', 'B4000', 'CX-5|cx5', 'CX-7|cx7', 'CX-9|cx9', 'Mazda2|mazda 2', 'Mazda3|mazda 3', 'Mazda5|mazda 5', 'Mazda6|mazda 6', 'Millenia', 'MPV', 'MX-3', 'MX-5 Miata|miata|mx5|mx-5', 'MX-6', 'Protege', 'RX-7|rx7', 'RX-8|rx8', 'Tribute', 'Navajo'] },
  'Mercedes-Benz': { aliases: ['mercedes-benz', 'mercedes benz', 'mercedes', 'benz', 'merc'], models: ['C230', 'C240', 'C280', 'C300', 'C320', 'CLK320', 'E320', 'E350', 'E430', 'G500', 'GL450', 'GLK350', 'ML320', 'ML350', 'ML430', 'S430', 'S500', 'SLK230', 'Sprinter', 'CLA250', 'GLA250'] },
  Mercury: { aliases: ['mercury'], models: ['Cougar', 'Grand Marquis', 'Marauder', 'Milan', 'Montego', 'Monterey', 'Mountaineer', 'Mystique', 'Sable', 'Topaz', 'Tracer', 'Villager', 'Lynx', 'Capri', 'Marquis'] },
  Mini: { aliases: ['mini'], models: ['Cooper', 'Cooper S', 'Clubman', 'Countryman', 'Paceman'] },
  Mitsubishi: { aliases: ['mitsubishi', 'mitsu'], models: ['3000GT', 'Diamante', 'Eclipse', 'Eclipse Cross', 'Endeavor', 'Galant', 'Lancer', 'Mirage', 'Montero', 'Montero Sport', 'Outlander', 'Raider', 'Starion', 'Precis', 'Expo', 'Cordia', 'Tredia'] },
  Nissan: { aliases: ['nissan', 'datsun'], models: ['200SX', '240SX', '300ZX', '350Z', '370Z', 'Altima', 'Armada', 'Cube', 'Frontier', 'Juke', 'Leaf', 'Maxima', 'Murano', 'NV200', 'Pathfinder', 'Pulsar', 'Quest', 'Rogue*', 'Sentra', 'Stanza', 'Titan', 'Versa', 'Xterra', 'Hardbody', 'D21'] },
  Oldsmobile: { aliases: ['oldsmobile', 'olds'], models: ['88', 'Achieva', 'Alero', 'Aurora', 'Bravada', 'Ciera', 'Cutlass', 'Cutlass Supreme', 'Delta 88', 'Intrigue', 'Silhouette', 'Toronado', 'Eighty-Eight', 'Ninety-Eight', 'Custom Cruiser', 'Firenza'] },
  Plymouth: { aliases: ['plymouth'], models: ['Acclaim', 'Breeze', 'Colt', 'Duster', 'Grand Voyager', 'Laser', 'Neon', 'Prowler', 'Reliant', 'Road Runner', 'Sundance', 'Voyager', 'Barracuda'] },
  Pontiac: { aliases: ['pontiac'], models: ['Aztek', 'Bonneville', 'Firebird', 'Fiero', 'G5', 'G6', 'G8', 'Grand Am', 'Grand Prix', 'GTO', 'LeMans', 'Montana', 'Solstice', 'Sunfire', 'Torrent', 'Trans Am', 'Trans Sport', 'Vibe', 'Catalina', 'Tempest', '6000', 'Sunbird', 'J2000'] },
  Porsche: { aliases: ['porsche'], models: ['911', '924', '944', 'Boxster', 'Cayenne', 'Cayman', 'Macan', 'Panamera'] },
  Ram: { aliases: ['ram'], models: ['1500', '2500', '3500', '4500', '5500', 'ProMaster', 'ProMaster City', 'Dakota'] },
  Saab: { aliases: ['saab'], models: ['9-2X', '9-3', '9-5', '900', '9000'] },
  Saturn: { aliases: ['saturn'], models: ['Aura', 'Ion', 'L100', 'L200', 'L300', 'Outlook', 'Relay', 'SC1', 'SC2', 'SL', 'SL1', 'SL2', 'Sky', 'SW1', 'SW2', 'Vue'] },
  Scion: { aliases: ['scion'], models: ['FR-S', 'iA', 'iM', 'tC', 'xA', 'xB', 'xD'] },
  Subaru: { aliases: ['subaru', 'subie'], models: ['Baja', 'BRZ', 'Crosstrek', 'Forester', 'Impreza', 'Justy', 'Legacy', 'Loyale', 'Outback', 'SVX', 'Tribeca', 'WRX', 'XV', 'Ascent', 'Brat'] },
  Suzuki: { aliases: ['suzuki'], models: ['Aerio', 'Equator', 'Esteem', 'Forenza', 'Grand Vitara', 'Reno', 'Samurai', 'Sidekick', 'Swift', 'SX4', 'Verona', 'Vitara', 'X-90', 'XL-7|xl7'] },
  Tesla: { aliases: ['tesla'], models: ['Model 3', 'Model S', 'Model X', 'Model Y'] },
  Toyota: { aliases: ['toyota'], models: ['4Runner|4 runner|4runner', 'Avalon', 'Camry', 'Celica', 'Corolla', 'Corona', 'Cressida', 'Echo', 'FJ Cruiser', 'Highlander', 'Land Cruiser|landcruiser', 'Matrix', 'MR2', 'Paseo', 'Previa', 'Prius', 'RAV4|rav 4|rav-4', 'Sequoia', 'Sienna', 'Solara', 'Supra', 'T100', 'Tacoma', 'Tercel', 'Tundra', 'Venza', 'Yaris', 'Pickup|pick up', 'Van', 'Starlet'] },
  Volkswagen: { aliases: ['volkswagen', 'vw', 'volks'], models: ['Atlas', 'Beetle|bug', 'CC', 'Eos', 'GTI', 'Golf', 'Jetta', 'Passat', 'Rabbit', 'Routan', 'Tiguan', 'Touareg', 'Vanagon', 'Cabrio', 'Corrado', 'Fox', 'Scirocco', 'Karmann Ghia', 'Thing', 'Type 2'] },
  Volvo: { aliases: ['volvo'], models: ['240', '740', '850', '940', 'C30', 'C70', 'S40', 'S60', 'S70', 'S80', 'S90', 'V40', 'V50', 'V70', 'XC60', 'XC70', 'XC90', '960', '850'] },
};

/** Words for a vehicle's weight class, as the counter says them: "3/4 ton", "half ton", "one ton". */
export const WEIGHT_CLASS = { 'half ton': 'half', '1/2 ton': 'half', '3/4 ton': 'three-quarter', 'three quarter ton': 'three-quarter', 'one ton': 'one', '1 ton': 'one' };

/** What a weight class is called by each maker (the model people mean when they only say the make and the ton). */
export const TON_MODEL = {
  Ford: { half: 'F-150', 'three-quarter': 'F-250', one: 'F-350' },
  Chevrolet: { half: 'Silverado 1500', 'three-quarter': 'Silverado 2500', one: 'Silverado 3500' },
  GMC: { half: 'Sierra 1500', 'three-quarter': 'Sierra 2500', one: 'Sierra 3500' },
  Dodge: { half: 'Ram 1500', 'three-quarter': 'Ram 2500', one: 'Ram 3500' },
  Ram: { half: '1500', 'three-quarter': '2500', one: '3500' },
};

/** A bare 1500, 2500 or 3500 after one of these makes names a truck. */
export const TRUCK_NUMBER = { Chevrolet: 'Silverado', GMC: 'Sierra', Dodge: 'Ram', Ram: '' };
