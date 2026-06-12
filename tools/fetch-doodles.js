'use strict';
// Builds a compact, offline doodle pack from Google's "Quick, Draw!" dataset.
// For each category we grab a small sample of *recognized* doodles and store
// their pen strokes as flat integer arrays. Run: node tools/fetch-doodles.js
//
// Output: data/doodles.json  ->  { "<word>": [ [ [x0,y0,x1,y1,...], ... ], ... ] }
//   word -> list of doodles -> each doodle is a list of strokes -> flat coords (0..255)

const fs = require('fs');
const path = require('path');

// All names below are exact "Quick, Draw!" category names. Any that fail to
// fetch are skipped gracefully, so the final pack contains only valid words.
const CATEGORIES = [
  // Animals
  'cat', 'dog', 'fish', 'elephant', 'octopus', 'spider', 'snake', 'penguin',
  'dragon', 'butterfly', 'bird', 'duck', 'owl', 'frog', 'bear', 'lion',
  'tiger', 'monkey', 'horse', 'cow', 'pig', 'sheep', 'rabbit', 'mouse',
  'squirrel', 'whale', 'dolphin', 'shark', 'crab', 'lobster', 'snail', 'bee',
  'ant', 'mosquito', 'scorpion', 'crocodile', 'sea turtle', 'kangaroo',
  'camel', 'giraffe', 'zebra', 'rhinoceros', 'hedgehog', 'bat', 'flamingo',
  'parrot', 'swan', 'raccoon', 'panda', 'mermaid',
  // Food & drink
  'apple', 'banana', 'pizza', 'hamburger', 'ice cream', 'cake', 'donut',
  'cookie', 'bread', 'carrot', 'broccoli', 'strawberry', 'grapes', 'pineapple',
  'watermelon', 'mushroom', 'peanut', 'hot dog', 'sandwich', 'popsicle',
  'lollipop', 'birthday cake', 'cup', 'coffee cup', 'wine bottle', 'wine glass',
  'teapot', 'mug', 'frying pan', 'fork', 'spoon', 'knife', 'steak', 'onion',
  'potato', 'pear', 'blueberry', 'blackberry', 'asparagus', 'peas',
  // Nature & weather
  'tree', 'flower', 'mountain', 'rainbow', 'cloud', 'lightning', 'sun', 'moon',
  'star', 'snowflake', 'snowman', 'cactus', 'palm tree', 'leaf', 'grass',
  'river', 'ocean', 'campfire', 'tornado', 'hurricane', 'feather', 'beach',
  // Vehicles & transport
  'car', 'bicycle', 'airplane', 'helicopter', 'hot air balloon', 'sailboat',
  'bus', 'train', 'truck', 'motorbike', 'van', 'ambulance', 'police car',
  'tractor', 'submarine', 'canoe', 'speedboat', 'school bus', 'pickup truck',
  'firetruck', 'skateboard', 'roller coaster', 'cruise ship', 'parachute',
  'flying saucer', 'bulldozer', 'cannon',
  // Buildings & places
  'house', 'castle', 'lighthouse', 'church', 'barn', 'skyscraper', 'bridge',
  'windmill', 'tent', 'hospital', 'garden', 'pool', 'fence', 'door', 'stairs',
  'mailbox', 'jail', 'fireplace',
  // Objects & tools
  'guitar', 'computer', 'umbrella', 'clock', 'crown', 'key', 'ladder', 'sword',
  'eye', 'hand', 't-shirt', 'traffic light', 'anvil', 'axe', 'hammer', 'saw',
  'screwdriver', 'pliers', 'scissors', 'paintbrush', 'pencil', 'marker',
  'crayon', 'book', 'envelope', 'camera', 'telephone', 'cell phone',
  'television', 'radio', 'headphones', 'microphone', 'piano', 'drums',
  'trumpet', 'violin', 'saxophone', 'harp', 'clarinet', 'cello', 'trombone',
  'light bulb', 'flashlight', 'candle', 'lantern', 'compass', 'binoculars',
  'eyeglasses', 'hat', 'shoe', 'sock', 'backpack', 'suitcase', 'basket',
  'bucket', 'broom', 'shovel', 'rake', 'fan', 'lighter', 'matches',
  'toothbrush', 'toothpaste', 'toilet', 'sink', 'bathtub', 'bed', 'couch',
  'chair', 'table', 'floor lamp', 'vase', 'picture frame', 'wristwatch',
  'alarm clock', 'calendar', 'calculator', 'laptop', 'keyboard', 'microwave',
  'oven', 'toaster', 'stove', 'dishwasher', 'washing machine', 'remote control',
  'power outlet', 'paper clip', 'nail', 'drill', 'megaphone', 'stethoscope',
  'syringe', 'bandage', 'lipstick', 'necklace', 'bracelet', 'purse', 'belt',
  'pants', 'shorts', 'jacket', 'sweater', 'helmet', 'crown', 'bowtie',
  // Body & people
  'face', 'smiley face', 'mouth', 'nose', 'ear', 'foot', 'leg', 'arm', 'skull',
  'brain', 'tooth', 'moustache', 'beard', 'finger', 'elbow', 'knee',
  // Symbols, sports & misc
  'diamond', 'square', 'circle', 'triangle', 'hexagon', 'octagon', 'star',
  'dumbbell', 'baseball', 'baseball bat', 'tennis racquet', 'golf club',
  'soccer ball', 'basketball', 'hockey stick', 'hourglass', 'map', 'stop sign',
  'wheel', 'anchor', 'boomerang', 'hot tub', 'sleeping bag', 'swing set',
  'see saw', 'kite', 'rollerskates'
];

const PER_CATEGORY = 18;     // doodles kept per word
const FETCH_BYTES = 900000;  // how much of each (huge) ndjson file to pull
const BASE = 'https://storage.googleapis.com/quickdraw_dataset/full/simplified/';

async function fetchCategory(word) {
  const url = BASE + encodeURIComponent(word) + '.ndjson';
  const res = await fetch(url, { headers: { Range: `bytes=0-${FETCH_BYTES}` } });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();

  const doodles = [];
  for (const line of text.split('\n')) {
    if (doodles.length >= PER_CATEGORY) break;
    const trimmed = line.trim();
    if (!trimmed || !trimmed.endsWith('}')) continue; // skip the last partial line
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; }
    if (!obj.recognized || !Array.isArray(obj.drawing)) continue;

    const strokes = obj.drawing
      .map((s) => {
        const xs = s[0], ys = s[1];
        const flat = [];
        for (let i = 0; i < xs.length; i++) flat.push(xs[i] | 0, ys[i] | 0);
        return flat;
      })
      .filter((s) => s.length >= 2);
    if (strokes.length) doodles.push(strokes);
  }
  return doodles;
}

(async () => {
  const out = {};
  for (const word of CATEGORIES) {
    try {
      const doodles = await fetchCategory(word);
      if (doodles.length) {
        out[word] = doodles;
        console.log(`  ✓ ${word.padEnd(18)} ${doodles.length} doodles`);
      } else {
        console.log(`  · ${word.padEnd(18)} no recognized doodles, skipped`);
      }
    } catch (e) {
      console.log(`  ✗ ${word.padEnd(18)} ${e.message}`);
    }
  }

  const dir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'doodles.json');
  fs.writeFileSync(file, JSON.stringify(out));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`\nWrote ${Object.keys(out).length} categories -> data/doodles.json (${kb} KB)`);
})();
