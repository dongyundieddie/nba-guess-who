# NBA Guess Who

A daily NBA player guessing game, inspired by Wordle / Poeltl. Guess the
mystery player of the day in up to 8 tries. Every guess reveals how close
you are across team, conference, position, height, age, country, and
per-game stats.

## Tech stack

- **Frontend:** React + Vite
- **Backend:** Node.js + Express
- **Data:** local `players.json` file (no database)
- **Styling:** plain CSS

## Project structure

```
nba project/
├── server/              # Express API
│   ├── data/players.json
│   ├── server.js
│   └── package.json
├── client/               # React + Vite frontend
│   ├── src/
│   │   ├── App.jsx
│   │   ├── App.css
│   │   ├── index.css
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── README.md
```

## How the game works

- Every day, the server picks an answer deterministically by hashing
  today's date (UTC) and using it as an index into `players.json`. The
  same date always produces the same answer, and it changes automatically
  at midnight UTC.
- The frontend never receives the answer directly — it POSTs a guessed
  player name to `/api/guess` and the backend returns a field-by-field
  comparison.
- When you guess correctly, or run out of 8 guesses, the frontend calls
  `/api/reveal` to display the correct player.
- Progress for the current day is saved in the browser's `localStorage`,
  so refreshing the page keeps your guesses.

### Color coding

| Color  | Meaning                                            |
| ------ | --------------------------------------------------- |
| Green  | Exact match                                          |
| Yellow | Close (same conference for team, same position group, or numeric value within a small range) |
| Grey   | Not correct / not close                              |

Numeric fields (height, age, PPG, RPG, APG) also show `↑` if the answer's
value is higher than your guess, or `↓` if it's lower.

## Running the project locally

You need two terminals: one for the backend, one for the frontend.

### 1. Install dependencies

```bash
cd "server"
npm install

cd "../client"
npm install
```

### 2. Start the backend (port 10000)

```bash
cd server
npm run dev
```

You should see:

```
NBA Guess Who API listening on http://localhost:10000
```

### 3. Start the frontend (port 5173)

In a second terminal:

```bash
cd client
npm run dev
```

Vite will print a local URL, typically `http://localhost:5173`. Open it
in your browser — the frontend calls the backend using an absolute URL
built from `VITE_API_URL` (see [Environment variables](#environment-variables)
below), so the backend can run on a different host/port or be deployed
separately without any code changes.

## Environment variables

The frontend never hardcodes `localhost` in its API calls. Instead it
reads `VITE_API_URL` at build time and falls back to
`http://localhost:10000` if it's not set:

```js
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:10000";
```

This is wired up via two Vite env files in `client/`:

- `.env.development` → `VITE_API_URL=http://localhost:10000` (used by `npm run dev`)
- `.env.production` → `VITE_API_URL=https://nba-guess-who.onrender.com` (used by `npm run build`)

If you deploy the frontend to a host that builds from source (Vercel,
Netlify, etc.), set `VITE_API_URL` as a build environment variable there
too — a real environment variable always overrides the committed
`.env.production` value.

The deployed backend lives at `https://nba-guess-who.onrender.com`
(Render). Locally the backend still defaults to port `10000`
(`process.env.PORT || 10000` in `server/server.js`), matching the
frontend's local default so the two line up out of the box.

## Player data

`server/data/players.json` is generated, not hand-edited. It's built by
`server/scripts/updatePlayers.js`, which pulls live rosters, bios, and
2025-26 per-game averages from ESPN's public NBA API (no key required)
and writes a validated `players.json`.

### Refreshing the data

```bash
cd server
npm run update-players
```

This re-fetches all 30 teams, keeps each team's ~15 most active players
(ranked by real games played, so injured stars are kept over
never-debuted two-way players), and prints a summary:

```
Players loaded: 450
Teams covered: 30/30
Players missing images: 8
Players missing stats: 12
Duplicate players removed: 0
```

The script exits with a non-zero status (and doesn't touch
`players.json`) if it can't reach at least 30 teams or 300 players, so a
bad run never silently corrupts the live dataset. Any player missing a
field (usually a rookie or an injured player with no 2025-26 games yet)
gets `null` for that field rather than a guessed value - the game
handles `null` stats gracefully (shown as "N/A", never selected as the
mystery answer).

### Player schema

```json
{
  "id": 1,
  "name": "Jayson Tatum",
  "team": "Boston Celtics",
  "teamAbbr": "BOS",
  "conference": "East",
  "division": "Atlantic",
  "position": "F",
  "secondaryPosition": null,
  "heightInches": 80,
  "heightDisplay": "6'8\"",
  "birthDate": "1998-03-03",
  "age": 28,
  "country": "USA",
  "ppg": 26.8,
  "rpg": 8.7,
  "apg": 5.9,
  "gamesPlayed": 72,
  "image": "https://a.espncdn.com/i/headshots/nba/players/full/4065648.png",
  "teamLogo": "https://a.espncdn.com/i/teamlogos/nba/500/bos.png",
  "season": "2025-26",
  "active": true
}
```

- `position` is ESPN's 3-way Guard/Forward/Center (`G`/`F`/`C`) - the
  free data source doesn't expose the 5-way PG/SG/SF/PF split, so
  `secondaryPosition` is always `null` for now.
- `age` in the file is a point-in-time snapshot from generation time.
  The server never trusts it directly - `server.js` recomputes age from
  `birthDate` on every request (see `calculateAge()`), so it can't go
  stale between data refreshes.
- `server.js`'s `normalizePlayer()` runs on every player before it's used
  anywhere (guesses, hints, the players list), coercing types and filling
  in safe defaults - so an older or hand-edited `players.json` degrades
  gracefully instead of crashing the API.

## Game modes

- **Daily Challenge**: same answer for everyone, picked deterministically from
  the date. Progress is stored under `nbaGuessWho_daily_<date>` in
  `localStorage` and there is no way to reset it from the UI — once you've
  played, that's your result for the day.
- **Unlimited Mode**: picks a random player each round (avoiding the last 5
  answers), identified by a signed `roundId` token so the server stays
  stateless. Progress for the round in flight is stored under
  `nbaGuessWho_unlimited_current`; recent answers used for the no-repeat rule
  are stored under `nbaGuessWho_unlimited_recent`.

## Leaderboard

Nickname is stored in `localStorage` (`nbaGuessWho_nickname`) and prompted
for on first visit. When a round ends (win or lose), a **Submit Score**
button appears once per round — the score is computed **server-side** (never
trusted from the client) as:

```
score = win ? max(0, 1000 - (guesses - 1) * 80 - hintsUsed * 100) : 0
```

Daily and Unlimited each have their own top-20 leaderboard, stored in
`server/data/leaderboard.json` (auto-created if missing).

> **Heads up if you deploy the backend to Render (or similar):** the default
> web service filesystem is ephemeral — `leaderboard.json` will reset on every
> redeploy or restart unless you attach a persistent disk (or move storage to
> a real database later). Fine for a demo/hobby project, just don't be
> surprised when scores disappear after a redeploy.

## API reference

| Method | Endpoint             | Description                                      |
| ------ | -------------------- | ------------------------------------------------- |
| GET    | `/api/players`       | List of all players (id, name, team, position, image) for autocomplete |
| POST   | `/api/unlimited/new` | Body `{ "excludeIds": [...] }` → `{ roundId }` for a new Unlimited Mode round |
| POST   | `/api/guess`         | Body `{ "name", "roundId"? }` → comparison result. Omit `roundId` for Daily Mode |
| GET    | `/api/hint/:index`   | `index` is 1, 2, or 3. Add `?roundId=...` for Unlimited Mode |
| GET    | `/api/reveal`        | Returns the round's answer (used at game end). Add `?roundId=...` for Unlimited Mode |
| POST   | `/api/leaderboard`   | Body `{ "nickname", "mode", "guesses", "hintsUsed", "win" }` → submits a score |
| GET    | `/api/leaderboard?mode=daily\|unlimited` | Top 20 scores for that mode |

## Deployment

**Backend (Render):** already deployed at
`https://nba-guess-who.onrender.com`. To redeploy after changes: push to
GitHub, then Render auto-deploys from the connected branch (or trigger a
manual deploy from the Render dashboard). Root directory `server/`, build
command `npm install`, start command `npm start`.

**Frontend (Vercel or similar):**
1. Push this repo to GitHub.
2. Import it in Vercel, set the project root to `client/`.
3. Build command `npm run build`, output directory `dist`.
4. Add a `VITE_API_URL` environment variable in the Vercel project settings
   pointing at the Render backend (`https://nba-guess-who.onrender.com`) —
   this is required because Vite bakes env vars in at build time, and
   Vercel's own build environment variable takes priority over the
   committed `client/.env.production` file.
5. Redeploy whenever `VITE_API_URL` or the backend URL changes.
# nba-guess-who
