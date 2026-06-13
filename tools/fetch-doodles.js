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
  // Animals
  'cat', 'dog', 'bird', ['bug', 'beetle'], 'fish', 'rabbit', 'rat', 'snail',
  'squirrel', 'turtle', 'worm', 'shrimp', ['shell', 'seashell'], 'feather',
  'bone', 'egg', ['paw-print', 'paw print'],
  // Transport
  'anchor', 'sailboat', ['ship', 'cargo ship'], 'rocket', ['plane', 'airplane'],
  ['car-front', 'car'], 'bus', ['train-front', 'train'], ['bike', 'bicycle'],
  'tractor', 'truck', 'ambulance', ['fuel', 'gas pump'], 'tent',
  ['tent-tree', 'campsite'], 'caravan', 'forklift', 'crane',
  // Buildings & places
  'castle', 'church', 'factory', 'warehouse', 'hotel', 'house', 'school',
  ['store', 'shop'], ['landmark', 'monument'], 'fence', 'mailbox',
  // Food & drink
  'apple', 'banana', ['cherry', 'cherries'], ['grape', 'grapes'], 'carrot',
  'croissant', 'cookie', ['cake-slice', 'slice of cake'], 'candy', 'candy-cane',
  ['ice-cream-cone', 'ice cream cone'], 'pizza', 'sandwich', 'soup', 'salad',
  'popcorn', 'popsicle', 'ham', ['beef', 'steak'],
  ['drumstick', 'chicken drumstick'], 'wheat', ['milk', 'milk carton'], 'beer',
  ['wine', 'wine glass'], 'martini', ['coffee', 'coffee cup'], 'donut',
  // Music, games & entertainment
  'guitar', 'piano', 'drum', ['mic', 'microphone'], 'headphones', 'radio',
  'speaker', ['disc', 'compact disc'], ['cassette-tape', 'cassette tape'],
  'clapperboard', ['film', 'film reel'], 'camera', ['tv', 'television'],
  ['gamepad', 'game controller'], ['dice-6', 'dice'], ['puzzle', 'jigsaw piece'],
  'crown', ['gem', 'gemstone'], 'medal', 'trophy', 'ribbon',
  ['swords', 'crossed swords'], 'sword', 'shield', ['target', 'dartboard'],
  // Tools & objects
  'anvil', 'hammer', 'wrench', 'drill', 'pickaxe', 'shovel', 'scissors',
  'paintbrush', ['palette', 'paint palette'], 'pen-tool', 'pencil', 'ruler',
  'compass', 'magnet', 'flashlight', ['lightbulb', 'light bulb'],
  ['lamp', 'desk lamp'], ['plug', 'power plug'], 'battery', 'key',
  ['lock', 'padlock'], 'bell', 'briefcase', 'backpack', ['luggage', 'suitcase'],
  'umbrella', 'glasses', ['watch', 'wristwatch'], ['shirt', 't-shirt'],
  ['flask-conical', 'flask'], ['test-tube', 'test tube'], 'microscope',
  'telescope', 'syringe', 'pill', 'stethoscope', 'thermometer', 'bandage',
  ['dna', 'DNA helix'], 'atom', 'satellite', ['satellite-dish', 'satellite dish'],
  // Nature & weather
  ['tree-pine', 'pine tree'], ['tree-palm', 'palm tree'],
  ['tree-deciduous', 'oak tree'], 'flower', 'clover', ['sprout', 'seedling'],
  'leaf', 'mountain', ['mountain-snow', 'snowy mountain'], 'tornado', 'cloud',
  ['cloud-lightning', 'thunderstorm'], 'rainbow', 'snowflake', 'sun',
  ['moon', 'crescent moon'], 'star', 'sunrise', ['droplet', 'water drop'],
  'flame', 'wind',
  // Body & misc
  'ghost', 'skull', 'brain', 'ear', 'eye', 'hand', 'heart', 'footprints',
  'hourglass', ['alarm-clock', 'alarm clock'], 'clock', 'map', 'globe', 'flag',
  'binoculars', ['scale', 'balance scale'], 'dumbbell', 'volleyball', 'axe',
  'origami', ['bot', 'robot']
];

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
