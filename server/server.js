import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

const playersPath = path.join(__dirname, "data", "players.json");
const players = JSON.parse(fs.readFileSync(playersPath, "utf-8"));

// Guards+SG are "Guard", SF+PF are "Forward", C stands alone.
const POSITION_GROUP = {
  PG: "Guard",
  SG: "Guard",
  SF: "Forward",
  PF: "Forward",
  C: "Center",
};

// Deterministic string hash (djb2-ish) so the same date always
// produces the same index into the players array.
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
  const index = hashString(dateString) % players.length;
  return players[index];
}

function findPlayerByName(name) {
  const normalized = name.trim().toLowerCase();
  return players.find((p) => p.name.toLowerCase() === normalized);
}

function formatHeightInches(inches) {
  const feet = Math.floor(inches / 12);
  const remainder = inches % 12;
  return `${feet}'${remainder}"`;
}

const CONFERENCE_NAMES = { East: "Eastern", West: "Western" };

// Three progressively-specific clues about today's answer, generated from its
// own stats so nothing here reveals name, team, or exact numbers.
function generateHints(answer) {
  const conferenceName = CONFERENCE_NAMES[answer.conference] || answer.conference;
  const ageLower = Math.floor(answer.age / 5) * 5;
  const ageUpper = ageLower + 5;
  const heightThreshold = formatHeightInches(answer.heightInches - 3);
  const ppgThreshold = Math.floor(answer.ppg / 5) * 5;

  return [
    `This player is in the ${conferenceName} Conference and plays ${answer.position}.`,
    `This player is between ${ageLower}-${ageUpper} years old and taller than ${heightThreshold}.`,
    `This player is from ${answer.country} and averages more than ${ppgThreshold} PPG.`,
  ];
}

function compareNumeric(guessValue, answerValue, closeThreshold) {
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
    .map((p) => ({ id: p.id, name: p.name, team: p.team, position: p.position, image: p.image }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(list);
});

// Submit a guess for today's player.
app.post("/api/guess", (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Missing player name" });
  }

  const guessedPlayer = findPlayerByName(name);
  if (!guessedPlayer) {
    return res.status(404).json({ error: "Player not found" });
  }

  const dateString = getTodayDateString();
  const answer = getDailyAnswer(dateString);
  const comparison = buildComparison(guessedPlayer, answer);
  const correct = guessedPlayer.id === answer.id;

  res.json({
    date: dateString,
    correct,
    guessedPlayer,
    comparison,
  });
});

// Get one of today's 3 hints (index 1, 2, or 3) without revealing the answer.
app.get("/api/hint/:index", (req, res) => {
  const index = parseInt(req.params.index, 10);
  if (![1, 2, 3].includes(index)) {
    return res.status(400).json({ error: "Hint index must be 1, 2, or 3" });
  }

  const dateString = getTodayDateString();
  const answer = getDailyAnswer(dateString);
  const hints = generateHints(answer);

  res.json({ date: dateString, index, hint: hints[index - 1] });
});

// Reveal today's answer (used once the game ends, win or lose).
app.get("/api/reveal", (req, res) => {
  const dateString = getTodayDateString();
  const answer = getDailyAnswer(dateString);
  res.json({ date: dateString, player: answer });
});

app.listen(PORT, () => {
  console.log(`NBA Guess Who API listening on http://localhost:${PORT}`);
});
