'use strict';

/**
 * Integration tests for guess privacy + special 10th puzzle ("wiba").
 * Spawns the server with short timers and TEST_REVEAL=1.
 */

const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3099;
const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function waitFor(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timeout waiting for "${event}"`));
    }, timeoutMs);
    function onEvent(data) {
      clearTimeout(t);
      resolve(data);
    }
    socket.once(event, onEvent);
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(`http://127.0.0.1:${PORT}`, {
      transports: ['websocket'],
      forceNew: true
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => resolve(res));
  });
}

function collectEvents(socket, event, bag) {
  socket.on(event, (data) => bag.push(data));
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runTests() {
  // ---- Test 1: wrong + correct guesses are private ----
  console.log('\n[1] Guess privacy (players never see each others\' guesses)');
  const host = await connect();
  const guest = await connect();

  const hostGuesses = [];
  const guestGuesses = [];
  collectEvents(host, 'guess-made', hostGuesses);
  collectEvents(guest, 'guess-made', guestGuesses);

  const created = await emitAck(host, 'create-room', { name: 'Alice' });
  assert(created.ok, 'host creates room');
  const roomId = created.roomId;

  const joined = await emitAck(guest, 'join-room', { roomId, name: 'Bob' });
  assert(joined.ok, 'guest joins room');

  const roundP = waitFor(host, 'round-start');
  host.emit('start-game');
  const round1 = await roundP;
  assert(!!round1.__word, 'TEST_REVEAL exposes word for testing');
  assert(!round1.specialPuzzle, 'round 1 is a normal doodle round');
  assert(Array.isArray(round1.drawing) && round1.drawing.length > 0, 'round 1 has a drawing');

  // Alice wrong guess
  hostGuesses.length = 0;
  guestGuesses.length = 0;
  host.emit('guess', { text: 'definitely-wrong-xyz' });
  await sleep(150);

  assert(hostGuesses.length === 1, 'Alice receives her own wrong guess');
  assert(hostGuesses[0].correct === false, 'Alice guess marked incorrect');
  assert(hostGuesses[0].text.includes('definitely-wrong'), 'Alice sees her wrong guess text');
  assert(guestGuesses.length === 0, 'Bob does NOT receive Alice\'s wrong guess');

  // Bob wrong guess
  hostGuesses.length = 0;
  guestGuesses.length = 0;
  guest.emit('guess', { text: 'bob-secret-wrong' });
  await sleep(150);

  assert(guestGuesses.length === 1, 'Bob receives his own wrong guess');
  assert(guestGuesses[0].text.includes('bob-secret-wrong'), 'Bob sees his wrong guess text');
  assert(hostGuesses.length === 0, 'Alice does NOT receive Bob\'s wrong guess');

  // Alice correct guess — still private (no text leak to Bob)
  hostGuesses.length = 0;
  guestGuesses.length = 0;
  host.emit('guess', { text: round1.__word });
  await sleep(150);

  assert(hostGuesses.length === 1, 'Alice receives her own correct guess');
  assert(hostGuesses[0].correct === true, 'Alice correct guess marked correct');
  assert(hostGuesses[0].text.toLowerCase().includes(round1.__word.toLowerCase()) || hostGuesses[0].points > 0,
    'Alice sees her correct answer / points');
  assert(guestGuesses.length === 0, 'Bob does NOT receive Alice\'s correct guess text');

  // Bob finishes the round so game can continue
  guest.emit('guess', { text: round1.__word });
  await waitFor(host, 'round-end', 3000);

  // ---- Test 2: play through to round 10 special puzzle ----
  console.log('\n[2] Special 10th puzzle: "The most beautiful girl ever" → wiba');

  let special = null;
  const roundsSeen = [];

  const onRound = (d) => {
    roundsSeen.push(d.round);
    if (d.round === 10) special = d;
  };
  host.on('round-start', onRound);
  guest.on('round-start', onRound);

  // Advance rounds 2–9 by both guessing correctly
  for (let r = 2; r <= 9; r++) {
    const d = await waitFor(host, 'round-start', 5000);
    assert(d.round === r, `received round ${r}`);
    assert(!d.specialPuzzle, `round ${r} is not the special puzzle`);
    assert(typeof d.__word === 'string' && d.__word.length > 0, `round ${r} has a word`);
    assert(d.drawing != null && Array.isArray(d.drawing), `round ${r} has a doodle drawing`);
    host.emit('guess', { text: d.__word });
    guest.emit('guess', { text: d.__word });
    await waitFor(host, 'round-end', 3000);
  }

  // Round 10
  const r10 = await waitFor(host, 'round-start', 5000);
  assert(r10.round === 10, 'round 10 starts');
  assert(r10.totalRounds === 10, 'game has 10 total rounds');
  assert(r10.specialPuzzle === 'The most beautiful girl ever', 'special prompt is exact');
  assert(r10.__word === 'wiba', 'special answer is wiba');
  assert(r10.drawing === null, 'special round has no doodle drawing');

  // Wrong answer on special round stays private
  hostGuesses.length = 0;
  guestGuesses.length = 0;
  host.emit('guess', { text: 'not-wiba' });
  await sleep(150);
  assert(hostGuesses.length === 1 && hostGuesses[0].correct === false, 'Alice wrong guess on special round');
  assert(guestGuesses.length === 0, 'Bob does not see Alice wrong guess on special round');

  // Correct answer "wiba" (case-insensitive)
  hostGuesses.length = 0;
  guestGuesses.length = 0;
  host.emit('guess', { text: 'Wiba' });
  await sleep(150);
  assert(hostGuesses.length === 1 && hostGuesses[0].correct === true, 'Alice correct with "Wiba"');
  assert(guestGuesses.length === 0, 'Bob does not see Alice correct guess on special round');

  guest.emit('guess', { text: 'wiba' });
  const endRound = await waitFor(host, 'round-end', 3000);
  assert(endRound.word === 'wiba', 'round-end reveals wiba');

  const gameEnd = await waitFor(host, 'game-end', 5000);
  assert(Array.isArray(gameEnd.players) && gameEnd.players.length === 2, 'game ends with both players');

  host.off('round-start', onRound);
  guest.off('round-start', onRound);
  host.disconnect();
  guest.disconnect();

  // ---- Test 3: solo player can solve special puzzle ----
  console.log('\n[3] Solo player can complete special puzzle');
  const solo = await connect();
  const soloGuesses = [];
  collectEvents(solo, 'guess-made', soloGuesses);

  const soloRoom = await emitAck(solo, 'create-room', { name: 'Solo' });
  assert(soloRoom.ok, 'solo creates room');
  solo.emit('start-game');

  for (let r = 1; r <= 10; r++) {
    const d = await waitFor(solo, 'round-start', 5000);
    if (r === 10) {
      assert(d.specialPuzzle === 'The most beautiful girl ever', 'solo sees special prompt on round 10');
      assert(d.__word === 'wiba', 'solo round 10 answer is wiba');
      solo.emit('guess', { text: 'wiba' });
    } else {
      solo.emit('guess', { text: d.__word });
    }
    if (r < 10) await waitFor(solo, 'round-end', 3000);
  }
  await waitFor(solo, 'game-end', 5000);
  assert(soloGuesses.some((g) => g.correct && g.text.toLowerCase() === 'wiba'), 'solo got wiba privately');
  solo.disconnect();

  return { passed, failed };
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        TEST_REVEAL: '1',
        ROUND_SECONDS: '30',
        INTERMISSION_MS: '150',
        TOTAL_ROUNDS: '10',
        GUESSES_PER_ROUND: '5'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let ready = false;
    const onData = (buf) => {
      const s = buf.toString();
      if (s.includes('running at') && !ready) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (b) => process.stderr.write(b));
    child.on('exit', (code) => {
      if (!ready) reject(new Error(`Server exited early with code ${code}`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error('Server failed to start in time'));
    }, 8000);
  });
}

(async () => {
  let child;
  try {
    child = await startServer();
    console.log(`Server ready on port ${PORT}`);
    await runTests();
  } catch (err) {
    console.error('\nTest runner error:', err);
    failed++;
  } finally {
    if (child && !child.killed) child.kill('SIGTERM');
  }

  console.log(`\n==============================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`==============================\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
