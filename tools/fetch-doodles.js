'use strict';
// Builds the offline drawing pack from the "Lucide" icon set — clean, human-
// designed line art (MIT licensed). Unlike crowd-sourced doodles, every icon is
// a precise, instantly recognizable sketch, so the computer's drawing is always
// accurate. We sample each icon's SVG outline into the same flat polyline format
// the client animates. Run: node tools/fetch-doodles.js
//
// Output: data/doodles.json  ->  { "<word>": [ [ [x0,y0,x1,y1,...], ... ] ] }
//   word -> list of drawings -> each drawing is a list of strokes -> flat coords (0..255)
//
// Needs a build-only dependency: npm install svg-path-properties

const fs = require('fs');
const path = require('path');
const { svgPathProperties } = require('svg-path-properties');

// Curated Lucide icons that read as real-world objects. Each entry is either
// "icon-name" (the word is the name with dashes turned into spaces) or
// ["icon-name", "guess word"] when a friendlier/harder word fits the picture.
// Icons that 404 (renamed/removed upstream) are skipped gracefully.
const CATEGORIES = [
  'album', 'ambulance', 'amphora', 'anchor', 'antenna', 'anvil', 'apple',
  'armchair', 'atom', 'award', 'axe', 'baby', 'backpack', 'balloon', 'banana',
  'bandage', 'banknote', 'barrel', 'bath', 'battery', 'beaker', 'bean', 'bed',
  ['beef', 'steak'], 'beer', 'bell', ['bike', 'bicycle'], 'binoculars',
  'biohazard', 'bird', 'birdhouse', 'blender', 'blinds', 'blocks', 'bolt',
  'bomb', 'bone', 'book', ['bot', 'robot'], 'box', 'brain', 'briefcase',
  'broccoli', 'brush', 'bubbles', ['bug', 'beetle'], 'building', 'bus',
  'cable', 'cake', 'calculator', 'calendar', 'camera', 'candy', 'cannabis',
  'car', 'caravan', 'carrot', 'castle', 'cat', 'cctv', ['cherry', 'cherries'],
  'church', 'cigarette', 'citrus', 'clapperboard', 'clipboard', 'clock',
  'cloud', 'clover', 'club', ['coffee', 'coffee cup'], ['cog', 'gear'],
  'coins', 'compass', 'computer', 'cone', 'cookie', 'croissant', 'cross',
  'crown', 'dam', 'dessert', 'diamond', ['dices', 'dice'],
  ['disc', 'compact disc'], ['dna', 'DNA helix'], 'dog', 'donut', 'drill',
  'drone', ['droplet', 'water drop'], 'drum',
  ['drumstick', 'chicken drumstick'], 'dumbbell', 'ear',
  ['earth', 'planet earth'], 'eclipse', 'egg', 'eye', 'factory', 'fan',
  'feather', 'fence', 'flag', 'flame', 'flashlight', 'flower', 'footprints',
  'forklift', ['fuel', 'gas pump'], ['gamepad', 'game controller'], 'gavel',
  ['gem', 'gemstone'], 'ghost', 'gift', 'glasses', 'globe', 'goal',
  ['grape', 'grapes'], 'guitar', 'ham', 'hamburger', 'hammer', 'hand',
  'handbag', 'handshake', 'headphones', 'headset', 'heart', 'heater',
  'helicopter', 'highlighter', 'hospital', 'hotel', 'hourglass', 'house',
  'joystick', 'kayak', 'key', 'keyboard', ['lamp', 'floor lamp'],
  ['landmark', 'monument'], 'laptop', 'leaf', 'lectern', 'library',
  ['lightbulb', 'light bulb'], 'lock', 'lollipop', ['luggage', 'suitcase'],
  'magnet', 'mailbox', 'map', 'martini', 'medal', 'megaphone', 'metronome',
  ['mic', 'microphone'], 'microchip', 'microscope', 'microwave', 'milk',
  'monitor', ['moon', 'crescent moon'], 'mountain', 'music', 'newspaper',
  'nut', 'origami', 'package', 'paintbrush', ['palette', 'paint palette'],
  'panda', 'paperclip', 'parasol', 'pen', 'pencil', 'piano', 'pickaxe',
  'pill', 'pipette', 'pizza', ['plane', 'airplane'], ['plug', 'power plug'],
  'podium', 'popcorn', 'popsicle', 'presentation', 'printer', 'projector',
  ['puzzle', 'jigsaw piece'], 'rabbit', 'radar', 'radio', 'rainbow', 'rat',
  'recycle', 'refrigerator', 'ribbon', 'road', 'rocket', 'rose', 'router',
  'ruler', 'sailboat', 'salad', 'sandwich', 'satellite',
  ['scale', 'balance scale'], 'school', 'scissors', 'scooter', 'scroll',
  ['shell', 'seashell'], 'shield', ['ship', 'cargo ship'],
  ['shirt', 't-shirt'], 'shovel', 'shredder', 'shrimp', 'shrub', 'signature',
  'signpost', 'siren', 'skull', 'slice', 'sofa', 'soup', 'spade', 'speaker',
  'spool', 'spotlight', ['sprout', 'seedling'], 'stamp', 'star',
  'stethoscope', 'sticker', 'stone', ['store', 'shop'], 'sun', 'sunrise',
  'sunset', 'sword', 'swords', 'syringe', 'table', 'tablet',
  ['target', 'dartboard'], 'telescope', 'tent', 'theater', 'thermometer',
  'ticket', 'toilet', 'toolbox', 'tornado', 'tractor', 'trees', 'trophy',
  'truck', 'turntable', 'turtle', ['tv', 'television'], 'umbrella',
  'university', 'utensils', 'van', 'vault', 'video', 'videotape',
  'volleyball', 'wallet', 'warehouse', ['washing-machine', 'washing machine'],
  ['watch', 'wristwatch'], 'webcam', 'weight', 'wheat', 'wind',
  ['wine', 'wine glass'], 'worm', 'wrench', ['alarm-clock', 'alarm clock'],
  ['air-vent', 'air vent'], ['alarm-smoke', 'smoke alarm'],
  ['bed-single', 'single bed'], ['bed-double', 'double bed'],
  ['boom-box', 'boombox'], ['bottle-wine', 'wine bottle'],
  ['brick-wall', 'brick wall'], ['cable-car', 'cable car'],
  ['cake-slice', 'slice of cake'], ['candy-cane', 'candy cane'],
  ['car-taxi-front', 'taxi'], ['card-sim', 'sim card'],
  ['cassette-tape', 'cassette tape'], ['chef-hat', 'chef hat'],
  ['chess-bishop', 'chess bishop'], ['chess-king', 'chess king'],
  ['chess-knight', 'chess knight'], ['chess-pawn', 'chess pawn'],
  ['chess-queen', 'chess queen'], ['chess-rook', 'chess rook'],
  ['circuit-board', 'circuit board'], ['cloud-drizzle', 'drizzle'],
  ['cloud-fog', 'fog'], ['cloud-hail', 'hailstorm'],
  ['cloud-lightning', 'thunderstorm'], ['cloud-rain', 'rain cloud'],
  ['cloud-snow', 'snow cloud'], ['cloud-sun', 'partly cloudy'],
  ['cloud-moon', 'night sky'], ['concierge-bell', 'service bell'],
  ['cooking-pot', 'cooking pot'], ['credit-card', 'credit card'],
  ['cup-soda', 'soda cup'], ['disc-album', 'vinyl record'],
  ['door-open', 'open door'], ['door-closed', 'door'],
  ['drafting-compass', 'drafting compass'], ['egg-fried', 'fried egg'],
  ['ev-charger', 'charging station'], ['ferris-wheel', 'ferris wheel'],
  ['fire-extinguisher', 'fire extinguisher'], ['fish-symbol', 'fish'],
  ['fishing-hook', 'fishing hook'], ['fishing-rod', 'fishing rod'],
  ['flame-kindling', 'campfire'], ['flask-conical', 'flask'],
  ['flask-round', 'round flask'], ['gallery-thumbnails', 'photo gallery'],
  ['glass-water', 'glass of water'], ['graduation-cap', 'graduation cap'],
  ['hand-coins', 'tip jar'], ['hand-metal', 'rock on'],
  ['hard-hat', 'hard hat'], ['hat-glasses', 'disguise'],
  ['house-plug', 'smart home'], ['ice-cream-bowl', 'ice cream'],
  ['ice-cream-cone', 'ice cream cone'], ['id-card', 'id card'],
  ['keyboard-music', 'music keyboard'], ['lamp-desk', 'desk lamp'],
  ['lamp-ceiling', 'ceiling lamp'], ['land-plot', 'land plot'],
  ['leafy-green', 'lettuce'], ['lens-convex', 'lens'],
  ['life-buoy', 'life buoy'], ['map-pinned', 'map pin'],
  ['memory-stick', 'usb stick'], 'motorbike',
  ['mountain-snow', 'snowy mountain'], ['notebook-pen', 'notebook'],
  ['paint-bucket', 'paint bucket'], ['paint-roller', 'paint roller'],
  ['party-popper', 'party popper'], ['paw-print', 'paw print'],
  ['pen-tool', 'pen tool'], ['pencil-ruler', 'pencil and ruler'],
  ['piggy-bank', 'piggy bank'], ['pill-bottle', 'pill bottle'],
  ['plane-landing', 'landing plane'], ['plane-takeoff', 'takeoff plane'],
  ['pocket-knife', 'pocket knife'], ['radio-tower', 'radio tower'],
  ['rocking-chair', 'rocking chair'], ['roller-coaster', 'roller coaster'],
  ['satellite-dish', 'satellite dish'], ['ship-wheel', 'ship wheel'],
  ['shopping-bag', 'shopping bag'], ['shopping-basket', 'shopping basket'],
  ['shopping-cart', 'shopping cart'], ['shower-head', 'shower head'],
  ['soap-dispenser-droplet', 'soap dispenser'], ['sport-shoe', 'sneaker'],
  ['spray-can', 'spray can'], ['swatch-book', 'color swatches'],
  ['tablets', 'pills'], ['tent-tree', 'campsite'], ['test-tube', 'test tube'],
  ['thermometer-snowflake', 'cold thermometer'], ['toy-brick', 'toy brick'],
  ['traffic-cone', 'traffic cone'], ['train-front', 'train'],
  ['tram-front', 'tram'], ['tree-deciduous', 'oak tree'],
  ['tree-palm', 'palm tree'], ['tree-pine', 'pine tree'],
  ['utensils-crossed', 'crossed utensils'], ['utility-pole', 'utility pole'],
  ['venetian-mask', 'venetian mask'], ['waves-ladder', 'pool ladder'],
  ['flag-triangle-right', 'pennant flag'], ['hand-fist', 'fist'],
  ['biceps-flexed', 'flexed arm'], ['person-standing', 'person'], 'squirrel',
  'snail', ['parking-meter', 'parking meter'], ['mirror-round', 'mirror'],
  ['shelving-unit', 'shelf'], ['towel-rack', 'towel rack'],
  ['radio-receiver', 'radio receiver'], ['app-window', 'app window'],
  ['briefcase-medical', 'medical kit'],
]

const BASE = 'https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/';
const VIEWBOX = 24;            // Lucide icons live in a 24x24 box
const OUT_SCALE = 255 / VIEWBOX; // map into the 0..255 space the client expects
const SAMPLE_STEP = 1.0;       // sample one point per ~1 unit of curve (24-space)
const EPS = 0.01;              // gap this big between segments means "pen up"

// Turn one <path d="..."> into one-or-more strokes (point lists). svg-path-
// properties splits the path into segments (lines/curves/arcs); a jump between a
// segment's end and the next one's start is a pen lift, so we start a new stroke.
function pathToStrokes(d) {
  const props = new svgPathProperties(d);
  const parts = props.getParts();
  const strokes = [];
  let cur = null;
  let prevEnd = null;

  for (const part of parts) {
    const lifted = !prevEnd ||
      Math.hypot(part.start.x - prevEnd.x, part.start.y - prevEnd.y) > EPS;
    if (lifted) {
      cur = [{ x: part.start.x, y: part.start.y }];
      strokes.push(cur);
    }
    const n = Math.max(1, Math.ceil(part.length / SAMPLE_STEP));
    // Skip i=0 (the segment start = previous end / stroke start already pushed).
    for (let i = 1; i <= n; i++) {
      cur.push(part.getPointAtLength((part.length * i) / n));
    }
    prevEnd = part.end;
  }
  return strokes;
}

function ringStroke(cx, cy, rx, ry) {
  const n = 40;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return [pts];
}

function rectStroke(x, y, w, h) {
  return [[
    { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }
  ]];
}

function pointsStroke(str, close) {
  const nums = (str.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  if (close && pts.length) pts.push(pts[0]);
  return pts.length ? [pts] : [];
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"'));
  return m ? m[1] : null;
};
const num = (tag, name) => {
  const v = attr(tag, name);
  return v == null ? 0 : parseFloat(v);
};

// Walk the SVG's drawable elements in document order (= draw order) and turn
// each into strokes. Lucide markup is simple and regular, so a tag scan is enough.
function svgToStrokes(svg) {
  const strokes = [];
  const tagRe = /<(path|circle|ellipse|line|rect|polyline|polygon)\b([^>]*)>/gi;
  let m;
  while ((m = tagRe.exec(svg))) {
    const tag = m[0];
    const type = m[1].toLowerCase();
    try {
      if (type === 'path') {
        const d = attr(tag, 'd');
        if (d) strokes.push(...pathToStrokes(d));
      } else if (type === 'circle') {
        const r = num(tag, 'r');
        strokes.push(...ringStroke(num(tag, 'cx'), num(tag, 'cy'), r, r));
      } else if (type === 'ellipse') {
        strokes.push(...ringStroke(num(tag, 'cx'), num(tag, 'cy'), num(tag, 'rx'), num(tag, 'ry')));
      } else if (type === 'line') {
        strokes.push([
          { x: num(tag, 'x1'), y: num(tag, 'y1') },
          { x: num(tag, 'x2'), y: num(tag, 'y2') }
        ]);
      } else if (type === 'rect') {
        strokes.push(...rectStroke(num(tag, 'x'), num(tag, 'y'), num(tag, 'width'), num(tag, 'height')));
      } else if (type === 'polyline' || type === 'polygon') {
        strokes.push(...pointsStroke(attr(tag, 'points') || '', type === 'polygon'));
      }
    } catch { /* skip a malformed element rather than fail the whole icon */ }
  }
  return strokes;
}

// Strokes (point lists, 24-space) -> client format (flat [x0,y0,...], 0..255).
function encode(strokes) {
  return strokes
    .map((pts) => {
      const flat = [];
      for (const p of pts) flat.push(Math.round(p.x * OUT_SCALE), Math.round(p.y * OUT_SCALE));
      return flat;
    })
    .filter((s) => s.length >= 2);
}

async function fetchIcon(name) {
  const res = await fetch(BASE + name + '.svg');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const svg = await res.text();
  const strokes = encode(svgToStrokes(svg));
  if (!strokes.length) throw new Error('no strokes');
  return strokes;
}

(async () => {
  const out = {};
  for (const entry of CATEGORIES) {
    const [icon, word] = Array.isArray(entry) ? entry : [entry, entry.replace(/-/g, ' ')];
    if (out[word]) continue; // de-dupe words
    try {
      const strokes = await fetchIcon(icon);
      out[word] = [strokes]; // one precise drawing per word
      console.log(`  ✓ ${word.padEnd(20)} ${strokes.length} strokes`);
    } catch (e) {
      console.log(`  ✗ ${word.padEnd(20)} ${e.message}`);
    }
  }

  const dir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'doodles.json');
  fs.writeFileSync(file, JSON.stringify(out));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`\nWrote ${Object.keys(out).length} words -> data/doodles.json (${kb} KB)`);
})();
