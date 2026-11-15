// What the public page and the app's opening hours say about the shop. Edit this file to change them.
// (Holiday closures are not here: managers add those from the Hours page.)

export const SHOP = Object.freeze({
  name: 'Southern Auto Supply',
  tagline: 'Your local auto parts supplier since 1981',
  phone: '(301) 334-1200',
  phoneLink: '+13013341200',
  email: 'southernauto@live.com',
  address: { street: '1450 Maryland Highway', city: 'Mt. Lake Park', state: 'MD', zip: '21550' },
  directions: 'On Maryland Route 135, easy to reach from Maryland and West Virginia.',
  // Parts are delivered across the service areas below. Set to false if that stops being true.
  delivers: true,
  napaOnline: 'https://www.napaonline.com/',
  afterHours: 'Browse 24/7 on NAPA Online and choose “Shop This Store” to see what’s available at our Oakland location. We often have access to more parts, and better pricing, than shows online, so for the best selection call us or stop in during store hours.',
  // Naming other businesses on a public page is the owner’s call: turn this on once they’ve agreed.
  showPartners: false,
  // Minutes after midnight, local time. A day left out is closed all day.
  hours: Object.freeze({
    mon: [450, 1080], tue: [450, 1080], wed: [450, 1080], thu: [450, 1080], fri: [450, 1080],
    sat: [450, 1020],
    sun: [540, 960],
  }),
  intro: 'For over four decades, Southern Auto Supply has been the trusted auto parts source for Mt. Lake Park, Oakland, and the greater Garrett County region. We’re proudly a NAPA Auto Parts store, and we’ve always been Southern Auto Supply.',
  why: [
    ['Four decades of experience', 'Serving the community since 1981.'],
    ['NAPA quality parts', 'Nationwide warranty support since our 2022 return to NAPA.'],
    ['Knowledgeable staff', 'Friendly, helpful people who know auto parts.'],
    ['Domestic and foreign', 'A complete selection for the vehicles around here.'],
  ],
  categories: [
    ['Engine', 'Filters, spark plugs, belts, gaskets, fluids'],
    ['Brakes', 'Pads, rotors, drums, hydraulic components'],
    ['Suspension and steering', 'Shocks, struts, springs, steering components'],
    ['Electrical', 'Batteries, starters, alternators, lighting'],
    ['Cooling', 'Radiators, pumps, thermostats, coolants'],
    ['Exhaust', 'Mufflers, converters, exhaust pipes'],
    ['Drivetrain', 'Transmission parts, CV joints, driveline'],
    ['Body and trim', 'Mirrors, lights, weatherstripping'],
  ],
  specialties: [
    ['Hydraulic hose assembly and repair', 'Made to length while you wait, or brought in for repair.'],
    ['Custom paint mixing', 'Matched and mixed in the shop.'],
    ['Battery sales and testing', 'We’ll test yours before you buy a new one.'],
    ['Special orders', 'Not on the shelf? We can usually get it.'],
  ],
  professionals: ['Volume pricing', 'Special ordering', 'Technical support', 'Fast turnaround'],
  history: [
    ['1981', 'Opened as Southern Auto Supply, with Big A Auto Parts.'],
    ['Later', 'Partnered with Auto Plus, then NAPA Auto Parts, then CarQuest.'],
    ['2022', 'Returned to NAPA Auto Parts, our current banner.'],
  ],
  historyNote: 'No matter the banner on the door, the name and the commitment have stayed the same: friendly service, fair advice, and the parts you need.',
  serviceAreas: [
    ['Maryland', 'Mountain Lake Park, Oakland, Deer Park, Loch Lynn Heights, Accident, Friendsville, Grantsville'],
    ['West Virginia', 'Terra Alta, Bayard, Gormania, Mount Storm, Elk Garden, Thomas, Keyser'],
  ],
  partners: {
    local: [
      ['Nu Finish Collision Center', 'The largest auto body repair center in town'],
      ['Loch Lynn Service Center', 'Full-service repair'],
      ['Rapid Repair', 'Quick turnaround'],
      ['Hutton Auto', 'Comprehensive repair'],
      ['Deer Park Automotive', 'Professional services'],
      ['Patriot Motors', 'Dodge, Jeep and RAM service'],
      ['Team One', 'GM service'],
      ['Timbrook Automotive', 'Ford service'],
      ['Glotfelty Enterprise', 'Automotive and equipment services'],
      ['Fleet Maintenance', 'Commercial and fleet'],
    ],
    regional: [
      ['Gormania Garage', 'Experienced repair'],
      ['Premium Collision', 'Auto body repair'],
      ['Pifer’s Auto Body', 'Collision repair and painting'],
      ['East Preston Tire', 'Tire sales and service'],
      ['Garrett Mine Supplies', 'Industrial supplies'],
      ['All Construction', 'Local services'],
      ['Beitzel Excavating', 'Excavation and construction'],
      ['Thomas Hardwoods', 'Lumber and materials'],
      ['Rigiply Rafters', 'Building supplies'],
      ['Garrett County Roads', 'Road services'],
    ],
  },
});
