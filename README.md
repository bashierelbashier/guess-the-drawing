# Guess the Drawing 🎨

A real-time multiplayer party game where **the computer is the artist**. Each
round it sketches a real human doodle (from Google's *Quick, Draw!* dataset),
stroke by stroke, and everyone races the 45-second clock to guess what it is.

Because no human draws, nobody can throw a round — it's a fair, pure guessing
race. No database; all state lives in memory.

## Features

- **Create a party**, share the invite link, friends join with a room code.
- **The computer draws** a random doodle live on an HTML5 canvas.
- **45 seconds** per round, **5 guesses** per player, **8 rounds** per game.
- **20% letter hint** revealed in order, spaces preserved (e.g. `h___`).
- Faster correct guesses score more (10–100 pts); live scoreboard and guess feed.
- The word is never sent to clients until the round ends (no peeking).
- Fully offline: a sample of doodles is bundled in `data/doodles.json`.

## Run

```bash
npm install
npm start                # http://localhost:3000
# PORT=3100 npm start    # if 3000 is taken
```

Open the URL, create a party, share the `?room=CODE` link, and hit **Start**.
The computer draws, so you can even play solo.

## Project layout

| Path | Purpose |
| --- | --- |
| `server.js` | Express + Socket.io game server (rooms, rounds, timer, hints, scoring) |
| `public/index.html` | Single-page client: stroke animation, lobby, guessing, results |
| `data/doodles.json` | Bundled offline doodle pack (Google *Quick, Draw!* sample) |
| `tools/fetch-doodles.js` | Rebuild/expand the doodle pack: `node tools/fetch-doodles.js` |

## Configuration

Tweak the constants at the top of `server.js`:

| Constant | Default | Meaning |
| --- | --- | --- |
| `ROUND_SECONDS` | 45 | Seconds per round |
| `GUESSES_PER_ROUND` | 5 | Guesses per player per round |
| `TOTAL_ROUNDS` | 8 | Rounds per game |
| `HINT_FRACTION` | 0.2 | Fraction of letters revealed as a hint |
| `DRAW_MS` | 18000 | How long the doodle takes to "draw" on the client |

## Credits

Doodle data from Google's [Quick, Draw! dataset](https://github.com/googlecreativelab/quickdraw-dataset)
(Creative Commons Attribution 4.0).
