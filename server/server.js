import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 10000;

const app = express();
app.use(cors());
app.use(express.json());

const playersPath = path.join(__dirname, "data", "players.json");
// `players` holds the raw records exactly as written by
// scripts/updatePlayers.js (birthDate as the source of truth for age, real
// per-game stats or null - never guessed values). Anything returned to a
// client or used in comparisons goes through normalizePlayer() first.
const players = JSON.parse(fs.readFileSync(playersPath, "utf-8"));

const leaderboardPath = path.join(__dirname, "data", "leaderboard.json");
const MAX_GUESSES = 8;
const MAX_HINTS = 3;
const LEADERBOARD_LIMIT = 20;
const MAX_NICKNAME_LENGTH = 20;

// Guards/G are "Guard", Forwards/F are "Forward", Centers stand alone.
// PG/SG/SF/PF are kept for backward compatibility with any older
// hand-authored player data using the 5-way position split; the live
// dataset from updatePlayers.js only uses the 3-way G/F/C ESPN exposes.
const POSITION_GROUP = {
  PG: "Guard",
  SG: "Guard",
  G: "Guard",
  SF: "Forward",
  PF: "Forward",
  F: "Forward",
  C: "Center",
};

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

// Computed fresh on every call rather than trusted from a stored `age`
// field, so age never goes stale between data updates (birthdays happen
// while the server keeps running).
function calculateAge(birthDateStr) {
  if (!birthDateStr) return null;
  const birth = new Date(birthDateStr);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const hasHadBirthdayThisYear =
    now.getUTCMonth() > birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() >= birth.getUTCDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

// Normalizes a raw players.json record into the shape the rest of the app
// expects, tolerating older/partial schemas (missing teamAbbr, a
// pre-computed age instead of birthDate, string-typed stats, etc.) so a
// manual edit or an out-of-date file doesn't take the whole API down.
function normalizePlayer(raw) {
  if (!raw) return raw;
  const heightInches = toNumberOrNull(raw.heightInches);
  return {
    ...raw,
    team: raw.team || "Unknown",
    teamAbbr: raw.teamAbbr || null,
    position: raw.position || null,
    heightInches,
    heightDisplay: raw.heightDisplay || (heightInches !== null ? formatHeightInches(heightInches) : null),
    age: raw.birthDate ? calculateAge(raw.birthDate) : toNumberOrNull(raw.age),
    ppg: toNumberOrNull(raw.ppg),
    rpg: toNumberOrNull(raw.rpg),
    apg: toNumberOrNull(raw.apg),
  };
}

// Only players with a full stat line can be selected as the mystery
// answer, so every numeric comparison the answer takes part in is always
// well-defined. Players missing stats (e.g. injured all season) are still
// fully guessable - just not pickable as the answer.
function getAnswerPool() {
  return players.filter(
    (p) => p.ppg != null && p.rpg != null && p.apg != null && p.country != null
  );
}

// Deterministic string hash (djb2-ish) so the same date always
// produces the same index into the answer pool.
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function getDailyAnswer(dateString) {
  const pool = getAnswerPool();
  const index = hashString(dateString) % pool.length;
  return normalizePlayer(pool[index]);
}

function findPlayerByName(name) {
  const normalized = name.trim().toLowerCase();
  const raw = players.find((p) => p.name.toLowerCase() === normalized);
  return raw ? normalizePlayer(raw) : null;
}

// Unlimited Mode rounds have no server-side session storage - instead, the
// round's answer id is signed into an opaque "roundId" token the client
// holds and echoes back on every guess/hint/reveal call. This keeps the
// server stateless (fine for a serverless/Render dyno) while still hiding
// the answer from the client until they win, lose, or reveal it.
const ROUND_SECRET = process.env.ROUND_SECRET || "nba-guess-who-unlimited-secret";

function signRoundToken(playerId) {
  const signature = crypto.createHmac("sha256", ROUND_SECRET).update(String(playerId)).digest("hex");
  return `${playerId}.${signature}`;
}

function verifyRoundToken(token) {
  if (!token || typeof token !== "string") return null;
  const [playerId, signature] = token.split(".");
  if (!playerId || !signature) return null;

  const expected = crypto.createHmac("sha256", ROUND_SECRET).update(playerId).digest("hex");
  if (signature !== expected) return null;

  const raw = players.find((p) => String(p.id) === playerId);
  return raw ? normalizePlayer(raw) : null;
}

// Picks a random player from the answer pool, avoiding recent Unlimited
// Mode answers when possible.
function pickRandomPlayer(excludeIds = []) {
  const excludeSet = new Set(excludeIds.map(String));
  const pool = getAnswerPool();
  let candidates = pool.filter((p) => !excludeSet.has(String(p.id)));

  if (candidates.length === 0) {
    // Exclusion list covers the whole pool - fall back to just avoiding an
    // immediate repeat of the very last answer.
    const lastId = excludeIds[excludeIds.length - 1];
    candidates = pool.filter((p) => String(p.id) !== String(lastId));
  }
  if (candidates.length === 0) candidates = pool;

  return normalizePlayer(candidates[Math.floor(Math.random() * candidates.length)]);
}

function formatHeightInches(inches) {
  const feet = Math.floor(inches / 12);
  const remainder = inches % 12;
  return `${feet}'${remainder}"`;
}

const CONFERENCE_NAMES = { East: "Eastern", West: "Western" };
const POSITION_NAMES = {
  PG: "Point Guard",
  SG: "Shooting Guard",
  G: "Guard",
  SF: "Small Forward",
  PF: "Power Forward",
  F: "Forward",
  C: "Center",
};

// Three progressively-specific clues about today's answer, generated from its
// own stats so nothing here reveals name, team, or exact numbers.
function generateHints(answer) {
  const conferenceName = CONFERENCE_NAMES[answer.conference] || answer.conference;
  const positionName = POSITION_NAMES[answer.position] || answer.position;
  const ageLower = Math.floor(answer.age / 5) * 5;
  const ageUpper = ageLower + 5;
  const heightThreshold = formatHeightInches(answer.heightInches - 3);
  const ppgThreshold = Math.floor(answer.ppg / 5) * 5;

  return [
    `This player is in the ${conferenceName} Conference and plays ${positionName}.`,
    `This player is between ${ageLower}-${ageUpper} years old and taller than ${heightThreshold}.`,
    `This player is from ${answer.country} and averages more than ${ppgThreshold} PPG.`,
  ];
}

// Real season data means some guessed players (e.g. out all year with an
// injury) legitimately have a null stat. There's nothing to compare in
// that case - show it as "wrong" with no arrow rather than guessing.
function compareNumeric(guessValue, answerValue, closeThreshold) {
  if (guessValue === null || guessValue === undefined || answerValue === null || answerValue === undefined) {
    return { status: "wrong", direction: null, value: guessValue ?? null };
  }
  if (guessValue === answerValue) {
    return { status: "correct", direction: null, value: guessValue };
  }
  const direction = guessValue < answerValue ? "up" : "down";
  const status = Math.abs(guessValue - answerValue) <= closeThreshold ? "close" : "wrong";
  return { status, direction, value: guessValue };
}

function compareTeam(guess, answer) {
  if (guess.team === answer.team) return { status: "correct", value: guess.team };
  if (guess.conference === answer.conference) return { status: "close", value: guess.team };
  return { status: "wrong", value: guess.team };
}

function compareConference(guess, answer) {
  return {
    status: guess.conference === answer.conference ? "correct" : "wrong",
    value: guess.conference,
  };
}

function comparePosition(guess, answer) {
  if (guess.position === answer.position) return { status: "correct", value: guess.position };
  if (POSITION_GROUP[guess.position] === POSITION_GROUP[answer.position]) {
    return { status: "close", value: guess.position };
  }
  return { status: "wrong", value: guess.position };
}

function compareCountry(guess, answer) {
  return {
    status: guess.country === answer.country ? "correct" : "wrong",
    value: guess.country,
  };
}

// Resolves which answer a request is playing against: an Unlimited Mode
// round (identified by a signed roundId) if one is supplied, otherwise the
// daily answer. Returns null if a roundId was supplied but is invalid.
function resolveAnswer(roundId) {
  if (roundId) return verifyRoundToken(roundId);
  return getDailyAnswer(getTodayDateString());
}

// Leaderboard entries live in a flat JSON file (no database). The file is
// created on first read/write if it doesn't exist yet.
function loadLeaderboard() {
  try {
    if (!fs.existsSync(leaderboardPath)) {
      fs.writeFileSync(leaderboardPath, "[]\n");
      return [];
    }
    const parsed = JSON.parse(fs.readFileSync(leaderboardPath, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLeaderboard(entries) {
  fs.writeFileSync(leaderboardPath, JSON.stringify(entries, null, 2) + "\n");
}

// Score is computed server-side (never trusted from the client) so the
// public leaderboard can't be gamed via devtools: base 1000, -80 per guess
// past the first, -100 per hint used, 0 on a loss.
function computeScore({ win, guesses, hintsUsed }) {
  if (!win) return 0;
  return Math.max(0, 1000 - (guesses - 1) * 80 - hintsUsed * 100);
}

function buildComparison(guess, answer) {
  return {
    team: compareTeam(guess, answer),
    conference: compareConference(guess, answer),
    position: comparePosition(guess, answer),
    height: compareNumeric(guess.heightInches, answer.heightInches, 2),
    age: compareNumeric(guess.age, answer.age, 2),
    country: compareCountry(guess, answer),
    ppg: compareNumeric(guess.ppg, answer.ppg, 3),
    rpg: compareNumeric(guess.rpg, answer.rpg, 2),
    apg: compareNumeric(guess.apg, answer.apg, 2),
  };
}

// List of players for the autocomplete search box.
app.get("/api/players", (req, res) => {
  const list = players
    .map(normalizePlayer)
    .map((p) => ({ id: p.id, name: p.name, team: p.team, position: p.position, image: p.image }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(list);
});

// Start a new Unlimited Mode round: picks a random player (avoiding recent
// answers) and returns only a signed roundId - never the player itself.
app.post("/api/unlimited/new", (req, res) => {
  const excludeIds = Array.isArray(req.body?.excludeIds) ? req.body.excludeIds : [];
  const answer = pickRandomPlayer(excludeIds);
  res.json({ roundId: signRoundToken(answer.id) });
});

// Submit a guess. Pass `roundId` (from /api/unlimited/new) to guess against
// an Unlimited Mode round; omit it to guess against today's daily answer.
app.post("/api/guess", (req, res) => {
  const { name, roundId } = req.body;
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Missing player name" });
  }

  const guessedPlayer = findPlayerByName(name);
  if (!guessedPlayer) {
    return res.status(404).json({ error: "Player not found" });
  }

  const answer = resolveAnswer(roundId);
  if (!answer) {
    return res.status(400).json({ error: "Invalid or expired round" });
  }

  const comparison = buildComparison(guessedPlayer, answer);
  const correct = guessedPlayer.id === answer.id;

  res.json({
    date: getTodayDateString(),
    correct,
    guessedPlayer,
    comparison,
  });
});

// Get one of a round's 3 hints (index 1, 2, or 3) without revealing the
// answer. Pass ?roundId=... for Unlimited Mode, omit it for the daily round.
app.get("/api/hint/:index", (req, res) => {
  const index = parseInt(req.params.index, 10);
  if (![1, 2, 3].includes(index)) {
    return res.status(400).json({ error: "Hint index must be 1, 2, or 3" });
  }

  const answer = resolveAnswer(req.query.roundId);
  if (!answer) {
    return res.status(400).json({ error: "Invalid or expired round" });
  }

  const hints = generateHints(answer);
  res.json({ date: getTodayDateString(), index, hint: hints[index - 1] });
});

// Reveal a round's answer (used once the game ends, win or lose). Pass
// ?roundId=... for Unlimited Mode, omit it for the daily round.
app.get("/api/reveal", (req, res) => {
  const answer = resolveAnswer(req.query.roundId);
  if (!answer) {
    return res.status(400).json({ error: "Invalid or expired round" });
  }

  res.json({ date: getTodayDateString(), player: answer });
});

// Submit a finished round's result. The score is recomputed here from
// guesses/hintsUsed/win rather than trusted from the client.
app.post("/api/leaderboard", (req, res) => {
  const { nickname, mode, guesses, hintsUsed, win } = req.body;

  if (!nickname || typeof nickname !== "string" || !nickname.trim()) {
    return res.status(400).json({ error: "Nickname is required" });
  }
  if (mode !== "daily" && mode !== "unlimited") {
    return res.status(400).json({ error: "Mode must be 'daily' or 'unlimited'" });
  }

  const guessesNum = Number(guesses);
  const hintsNum = Number(hintsUsed);
  if (!Number.isInteger(guessesNum) || guessesNum < 1 || guessesNum > MAX_GUESSES) {
    return res.status(400).json({ error: "Invalid guesses count" });
  }
  if (!Number.isInteger(hintsNum) || hintsNum < 0 || hintsNum > MAX_HINTS) {
    return res.status(400).json({ error: "Invalid hints count" });
  }

  const entry = {
    id: crypto.randomUUID(),
    nickname: nickname.trim().slice(0, MAX_NICKNAME_LENGTH),
    score: computeScore({ win: !!win, guesses: guessesNum, hintsUsed: hintsNum }),
    guesses: guessesNum,
    hintsUsed: hintsNum,
    mode,
    createdAt: new Date().toISOString(),
  };

  const leaderboard = loadLeaderboard();
  leaderboard.push(entry);
  saveLeaderboard(leaderboard);

  res.status(201).json({ entry });
});

// Top 20 scores for a mode, highest score first (ties broken by fewer
// guesses, then fewer hints used).
app.get("/api/leaderboard", (req, res) => {
  const { mode } = req.query;
  if (mode !== "daily" && mode !== "unlimited") {
    return res.status(400).json({ error: "Query param 'mode' must be 'daily' or 'unlimited'" });
  }

  const leaderboard = loadLeaderboard()
    .filter((entry) => entry.mode === mode)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.guesses !== b.guesses) return a.guesses - b.guesses;
      return a.hintsUsed - b.hintsUsed;
    })
    .slice(0, LEADERBOARD_LIMIT)
    .map((entry, idx) => ({ rank: idx + 1, ...entry }));

  res.json({ mode, leaderboard });
});

app.listen(PORT, () => {
  console.log(`NBA Guess Who API listening on http://localhost:${PORT}`);
});
