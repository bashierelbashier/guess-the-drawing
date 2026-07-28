'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS) || 60;      // each round lasts 60 seconds
const GUESSES_PER_ROUND = Number(process.env.GUESSES_PER_ROUND) || 5; // each player gets 5 tries per round
const TOTAL_ROUNDS = Number(process.env.TOTAL_ROUNDS) || 10;       // rounds per game
const HINT_FRACTION = 0.2;     // reveal ~20% of the non-space letters
const INTERMISSION_MS = Number(process.env.INTERMISSION_MS) || 5000;  // pause between rounds to show the answer
const DRAW_MS = 18000;         // how long the computer "draws" the doodle (client-side)
const MIN_PLAYERS = 1;         // computer draws, so even a solo player can play

// Always the 10th puzzle — text prompt, not a doodle.
const SPECIAL_ROUND = 10;
const SPECIAL_PUZZLE = {
  prompt: 'The most beautiful girl ever',
  answer: 'wiba'
};

// ---------------------------------------------------------------------------
// Drawing pack (clean "Lucide" line-art icons, bundled offline)
//   word -> [ drawing, ... ];  drawing -> [ stroke, ... ];  stroke -> [x0,y0,x1,y1,...]
// ---------------------------------------------------------------------------
const DOODLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'doodles.json'), 'utf8'));
const WORDS = Object.keys(DOODLES);
console.log(`Loaded ${WORDS.length} drawings.`);

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
const rooms = new Map();        // roomId -> room
const socketRooms = new Map();  // socketId -> roomId

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = '';
    for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(id));
  return id;
}

function pickWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

function pickDoodle(word) {
  const set = DOODLES[word];
  return set[Math.floor(Math.random() * set.length)];
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Reveal ~20% of the non-space letters, spread evenly, in their correct
// positions. Spaces are preserved; hidden letters become '_'.
function makeHint(word) {
  const chars = [...word];
  const letterIdx = [];
  chars.forEach((c, i) => { if (c !== ' ') letterIdx.push(i); });

  const revealCount = Math.max(1, Math.round(letterIdx.length * HINT_FRACTION));
  const reveal = new Set();
  const step = letterIdx.length / revealCount;
  for (let i = 0; i < revealCount; i++) reveal.add(letterIdx[Math.floor(i * step)]);

  return chars.map((c, i) => (c === ' ' ? ' ' : reveal.has(i) ? c : '_')).join('');
}

function publicPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected,
    isHost: p.id === room.hostId,
    guessedCorrectly: p.guessedCorrectly,
    guessesLeft: p.guessesLeft
  }));
}

function broadcastPlayers(room) {
  io.to(room.id).emit('player-list', {
    players: publicPlayers(room),
    hostId: room.hostId,
    state: room.state
  });
}

function connectedPlayers(room) {
  return [...room.players.values()].filter((p) => p.connected);
}

// ---------------------------------------------------------------------------
// Game flow  (the computer is always the artist)
// ---------------------------------------------------------------------------
function startGame(room) {
  if (room.state === 'playing') return;
  if (connectedPlayers(room).length < MIN_PLAYERS) return;

  for (const p of room.players.values()) p.score = 0;
  room.state = 'playing';
  room.round = 0;
  nextRound(room);
}

function nextRound(room) {
  clearRoomTimer(room);
  if (connectedPlayers(room).length < MIN_PLAYERS) return endGame(room);

  room.round++;
  if (room.round > TOTAL_ROUNDS) return endGame(room);

  const isSpecial = room.round === SPECIAL_ROUND;
  const word = isSpecial ? SPECIAL_PUZZLE.answer : pickWord();
  room.word = word;
  room.hint = makeHint(word);
  room.isSpecial = isSpecial;

  for (const p of room.players.values()) {
    p.guessedCorrectly = false;
    p.guessesLeft = GUESSES_PER_ROUND;
  }

  const payload = {
    round: room.round,
    totalRounds: TOTAL_ROUNDS,
    hint: room.hint,
    duration: ROUND_SECONDS,
    guessesPerRound: GUESSES_PER_ROUND,
    drawMs: DRAW_MS,
    // Guesses are private: never include other players' guess history here.
  };

  if (isSpecial) {
    // Text puzzle instead of a computer doodle.
    payload.specialPuzzle = SPECIAL_PUZZLE.prompt;
    payload.drawing = null;
  } else {
    payload.drawing = pickDoodle(word); // strokes for the client to animate
  }

  if (process.env.TEST_REVEAL === '1') payload.__word = word; // test hook only

  io.to(room.id).emit('round-start', payload);

  broadcastPlayers(room);
  startRoundTimer(room);
}

function startRoundTimer(room) {
  room.remaining = ROUND_SECONDS;
  io.to(room.id).emit('timer', { remaining: room.remaining });
  room.timer = setInterval(() => {
    room.remaining--;
    io.to(room.id).emit('timer', { remaining: room.remaining });
    if (room.remaining <= 0) endRound(room, 'time');
  }, 1000);
}

function clearRoomTimer(room) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
}

function endRound(room, reason) {
  if (room.state !== 'playing') return;
  clearRoomTimer(room);

  io.to(room.id).emit('round-end', {
    word: room.word,
    reason: reason || 'time',
    players: publicPlayers(room).sort((a, b) => b.score - a.score)
  });
  room.word = null;

  room.intermission = setTimeout(() => {
    room.intermission = null;
    if (room.state === 'playing') nextRound(room);
  }, INTERMISSION_MS);
}

function endGame(room) {
  clearRoomTimer(room);
  if (room.intermission) { clearTimeout(room.intermission); room.intermission = null; }
  room.state = 'ended';
  room.word = null;
  io.to(room.id).emit('game-end', {
    players: publicPlayers(room).sort((a, b) => b.score - a.score)
  });
  broadcastPlayers(room);
}

// ---------------------------------------------------------------------------
// Socket handlers
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  function currentRoom() {
    const roomId = socketRooms.get(socket.id);
    return roomId ? rooms.get(roomId) : null;
  }

  function addPlayer(room, sock, name) {
    const cleanName = (name || '').toString().trim().slice(0, 20) || 'Player';
    room.players.set(sock.id, {
      id: sock.id,
      name: cleanName,
      score: 0,
      connected: true,
      guessedCorrectly: false,
      guessesLeft: GUESSES_PER_ROUND
    });
    socketRooms.set(sock.id, room.id);
    sock.join(room.id);

    sock.emit('room-joined', {
      roomId: room.id,
      playerId: sock.id,
      hostId: room.hostId,
      state: room.state
    });
    broadcastPlayers(room);
    io.to(room.id).emit('system-message', { text: `${cleanName} joined the party.` });
  }

  socket.on('create-room', ({ name } = {}, cb) => {
    const roomId = makeRoomId();
    rooms.set(roomId, {
      id: roomId,
      hostId: socket.id,
      players: new Map(),
      state: 'waiting',
      round: 0,
      word: null,
      hint: null,
      remaining: 0,
      timer: null,
      intermission: null
    });
    addPlayer(rooms.get(roomId), socket, name);
    if (typeof cb === 'function') cb({ ok: true, roomId, playerId: socket.id });
  });

  socket.on('join-room', ({ roomId, name } = {}, cb) => {
    const room = rooms.get((roomId || '').toUpperCase());
    if (!room) {
      if (typeof cb === 'function') cb({ ok: false, error: 'Room not found.' });
      return;
    }
    addPlayer(room, socket, name);
    if (typeof cb === 'function') cb({ ok: true, roomId: room.id, playerId: socket.id, state: room.state });
  });

  socket.on('start-game', () => {
    const room = currentRoom();
    if (!room || socket.id !== room.hostId || room.state === 'playing') return;
    if (connectedPlayers(room).length < MIN_PLAYERS) {
      socket.emit('error-msg', { message: 'Need at least one player to start.' });
      return;
    }
    startGame(room);
  });

  socket.on('guess', ({ text } = {}) => {
    const room = currentRoom();
    if (!room || room.state !== 'playing') return;
    const player = room.players.get(socket.id);
    if (!player || player.guessedCorrectly || player.guessesLeft <= 0) return;

    const guess = normalize(text);
    if (!guess) return;

    // Guesses are private: only the guessing player ever sees their own guess text
    // (correct or wrong). Other players never receive guess-made events for peers.
    if (guess === normalize(room.word)) {
      player.guessedCorrectly = true;
      const points = Math.max(10, Math.round((room.remaining / ROUND_SECONDS) * 100));
      player.score += points;

      socket.emit('guess-made', {
        name: player.name,
        text: String(text).slice(0, 60),
        correct: true,
        points,
        guessesLeft: player.guessesLeft
      });
      broadcastPlayers(room);

      const guessers = connectedPlayers(room);
      if (guessers.length > 0 && guessers.every((p) => p.guessedCorrectly)) {
        endRound(room, 'all-guessed');
      }
    } else {
      player.guessesLeft--;
      socket.emit('guess-made', {
        name: player.name,
        text: String(text).slice(0, 60),
        correct: false,
        guessesLeft: player.guessesLeft
      });
      // Still refresh scores / guesses-left badges for everyone (no guess text).
      broadcastPlayers(room);
    }
  });

  socket.on('play-again', () => {
    const room = currentRoom();
    if (!room || socket.id !== room.hostId || room.state !== 'ended') return;
    room.state = 'waiting';
    for (const p of room.players.values()) {
      p.score = 0;
      p.guessedCorrectly = false;
      p.guessesLeft = GUESSES_PER_ROUND;
    }
    io.to(room.id).emit('back-to-lobby');
    broadcastPlayers(room);
  });

  socket.on('disconnect', () => {
    const room = currentRoom();
    socketRooms.delete(socket.id);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    const name = player.name;
    room.players.delete(socket.id);
    io.to(room.id).emit('system-message', { text: `${name} left the party.` });

    if (room.players.size === 0) {
      clearRoomTimer(room);
      if (room.intermission) clearTimeout(room.intermission);
      rooms.delete(room.id);
      return;
    }

    if (room.hostId === socket.id) {
      room.hostId = [...room.players.values()][0].id;
    }

    if (room.state === 'playing') {
      if (connectedPlayers(room).length < MIN_PLAYERS) { endGame(room); return; }
      const guessers = connectedPlayers(room);
      if (guessers.length > 0 && guessers.every((p) => p.guessedCorrectly)) {
        endRound(room, 'all-guessed');
        return;
      }
    }
    broadcastPlayers(room);
  });
});

server.listen(PORT, () => {
  console.log(`🎨 Guess the Drawing running at http://localhost:${PORT}`);
});
