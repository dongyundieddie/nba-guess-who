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

### 2. Start the backend (port 3001)

```bash
cd server
npm run dev
```

You should see:

```
NBA Guess Who API listening on http://localhost:3001
```

### 3. Start the frontend (port 5173)

In a second terminal:

```bash
cd client
npm run dev
```

Vite will print a local URL, typically `http://localhost:5173`. Open it
in your browser — the dev server proxies `/api/*` requests to the
backend automatically (see `client/vite.config.js`), so no extra CORS
setup is needed.

## Adding / editing players

Edit `server/data/players.json`. Each player needs:

```json
{
  "id": 36,
  "name": "Player Name",
  "team": "Team Name",
  "conference": "East" | "West",
  "position": "PG" | "SG" | "SF" | "PF" | "C",
  "heightInches": 79,
  "age": 25,
  "country": "USA",
  "ppg": 20.0,
  "rpg": 5.0,
  "apg": 4.0
}
```

Restart the backend after editing the file.

## API reference

| Method | Endpoint       | Description                                      |
| ------ | -------------- | ------------------------------------------------- |
| GET    | `/api/players` | List of all players (id, name, team) for autocomplete |
| POST   | `/api/guess`   | Body `{ "name": "Player Name" }` → comparison result |
| GET    | `/api/reveal`  | Returns today's answer (used at game end)         |
