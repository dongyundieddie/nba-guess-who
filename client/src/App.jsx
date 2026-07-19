import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:10000";

const MAX_GUESSES = 8;
const MAX_HINTS = 3;
const MAX_RECENT_UNLIMITED = 5;
const FLIP_STEP_SECONDS = 0.12;

const FIELDS = [
  { key: "team", label: "Team" },
  { key: "conference", label: "Conf" },
  { key: "position", label: "Pos" },
  { key: "height", label: "Height", format: formatHeight },
  { key: "age", label: "Age" },
  { key: "country", label: "Country", format: formatCountry },
  { key: "ppg", label: "PPG" },
  { key: "rpg", label: "RPG" },
  { key: "apg", label: "APG" },
];

// Covers every country in the live ESPN-sourced roster (server/data/players.json).
// Unmapped countries still render fine via the 🏳️ fallback below.
const COUNTRY_FLAGS = {
  USA: "🇺🇸",
  Canada: "🇨🇦",
  France: "🇫🇷",
  Greece: "🇬🇷",
  Slovenia: "🇸🇮",
  Cameroon: "🇨🇲",
  Serbia: "🇷🇸",
  Lithuania: "🇱🇹",
  Turkey: "🇹🇷",
  "Türkiye": "🇹🇷",
  Germany: "🇩🇪",
  Australia: "🇦🇺",
  Bahamas: "🇧🇸",
  Netherlands: "🇳🇱",
  Nigeria: "🇳🇬",
  Switzerland: "🇨🇭",
  England: "🏴",
  Russia: "🇷🇺",
  Spain: "🇪🇸",
  "Dominican Republic": "🇩🇴",
  "Bosnia & Herzegovina": "🇧🇦",
  "Bosnia and Herzegovina": "🇧🇦",
  Georgia: "🇬🇪",
  Italy: "🇮🇹",
  Belgium: "🇧🇪",
  Senegal: "🇸🇳",
  Portugal: "🇵🇹",
  Guinea: "🇬🇳",
  Brazil: "🇧🇷",
  Latvia: "🇱🇻",
  "New Zealand": "🇳🇿",
  Japan: "🇯🇵",
  Sweden: "🇸🇪",
  "South Sudan": "🇸🇸",
  Israel: "🇮🇱",
  "Czech Republic": "🇨🇿",
  Czechia: "🇨🇿",
  Austria: "🇦🇹",
  Ukraine: "🇺🇦",
  Finland: "🇫🇮",
  Congo: "🇨🇩",
  "DR Congo": "🇨🇩",
  Mali: "🇲🇱",
  Egypt: "🇪🇬",
  China: "🇨🇳",
  Mexico: "🇲🇽",
  Angola: "🇦🇴",
  "South Korea": "🇰🇷",
  Poland: "🇵🇱",
  Montenegro: "🇲🇪",
  "North Macedonia": "🇲🇰",
  Croatia: "🇭🇷",
  Iran: "🇮🇷",
};

function getCountryFlag(country) {
  if (!country) return "🏳️";
  return COUNTRY_FLAGS[country] || "🏳️";
}

function formatCountry(country) {
  if (!country) return "Unknown";
  return `${getCountryFlag(country)} ${country}`;
}

const FALLBACK_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'>
      <rect width='40' height='40' rx='20' fill='#24334a'/>
      <circle cx='20' cy='16' r='7' fill='#9aa8c0'/>
      <path d='M6 35c0-8.5 6.5-14 14-14s14 5.5 14 14' fill='#9aa8c0'/>
    </svg>`
  );

function formatHeight(inches) {
  const feet = Math.floor(inches / 12);
  const remainder = inches % 12;
  return `${feet}'${remainder}"`;
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function getDailyStorageKey() {
  return `nbaGuessWho_daily_${getTodayDateString()}`;
}

const UNLIMITED_CURRENT_KEY = "nbaGuessWho_unlimited_current";
const UNLIMITED_RECENT_KEY = "nbaGuessWho_unlimited_recent";
const MODE_STORAGE_KEY = "nbaGuessWho_mode";
const NICKNAME_STORAGE_KEY = "nbaGuessWho_nickname";

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage unavailable (private mode, etc.) - fail silently
  }
}

function normalizeGuesses(guesses) {
  return (guesses || []).map((g, idx) => ({
    id: g.id ?? `restored-${idx}`,
    guessedPlayer: g.guessedPlayer,
    comparison: g.comparison,
    correct: g.correct,
    animate: false,
  }));
}

function loadDailyRound() {
  const parsed = readJSON(getDailyStorageKey());
  if (!parsed) return null;
  return {
    guesses: normalizeGuesses(parsed.guesses),
    status: parsed.status || "playing",
    revealPlayer: parsed.revealPlayer || null,
    unlockedHints: parsed.unlockedHints || [],
    scoreSubmitted: parsed.scoreSubmitted || false,
  };
}

function saveDailyRound(round) {
  writeJSON(getDailyStorageKey(), round);
}

function loadUnlimitedRound() {
  const parsed = readJSON(UNLIMITED_CURRENT_KEY);
  if (!parsed || !parsed.roundId) return null;
  return {
    roundId: parsed.roundId,
    guesses: normalizeGuesses(parsed.guesses),
    status: parsed.status || "playing",
    revealPlayer: parsed.revealPlayer || null,
    unlockedHints: parsed.unlockedHints || [],
    scoreSubmitted: parsed.scoreSubmitted || false,
  };
}

function saveUnlimitedRound(round) {
  writeJSON(UNLIMITED_CURRENT_KEY, round);
}

function loadRecentUnlimitedAnswers() {
  const parsed = readJSON(UNLIMITED_RECENT_KEY);
  return Array.isArray(parsed) ? parsed : [];
}

function saveRecentUnlimitedAnswers(ids) {
  writeJSON(UNLIMITED_RECENT_KEY, ids);
}

function loadSavedMode() {
  return readJSON(MODE_STORAGE_KEY) === "unlimited" ? "unlimited" : "daily";
}

function saveMode(mode) {
  writeJSON(MODE_STORAGE_KEY, mode);
}

function loadNickname() {
  try {
    return localStorage.getItem(NICKNAME_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function saveNickname(name) {
  try {
    localStorage.setItem(NICKNAME_STORAGE_KEY, name);
  } catch {
    // localStorage unavailable - ignore
  }
}

const PROFILE_STATS_KEY = "nbaGuessWho_profileStats";
const MAX_RECENT_GAMES = 10;

const EMPTY_PROFILE_STATS = {
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  totalGuesses: 0,
  totalHints: 0,
  currentStreak: 0,
  bestStreak: 0,
  highestScore: 0,
  recentGames: [],
};

function loadProfileStats() {
  const parsed = readJSON(PROFILE_STATS_KEY);
  return parsed ? { ...EMPTY_PROFILE_STATS, ...parsed } : { ...EMPTY_PROFILE_STATS };
}

function saveProfileStats(stats) {
  writeJSON(PROFILE_STATS_KEY, stats);
}

// Called once per completed round (from submitGuess's win/loss branch only,
// which itself only ever runs once per round) to fold the result into the
// player's running local stats.
function recordGameResult({ mode, win, guessCount, hintsUsedCount, score, playerName }) {
  const stats = loadProfileStats();

  stats.gamesPlayed += 1;
  stats.totalGuesses += guessCount;
  stats.totalHints += hintsUsedCount;
  stats.highestScore = Math.max(stats.highestScore, score);

  if (win) {
    stats.wins += 1;
    stats.currentStreak += 1;
    stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
  } else {
    stats.losses += 1;
    stats.currentStreak = 0;
  }

  stats.recentGames = [
    { mode, win, guesses: guessCount, hintsUsed: hintsUsedCount, score, playerName: playerName || null, date: new Date().toISOString() },
    ...stats.recentGames,
  ].slice(0, MAX_RECENT_GAMES);

  saveProfileStats(stats);
  return stats;
}

// score = win ? max(0, 1000 - (guesses-1)*80 - hintsUsed*100) : 0
// Mirrors the server's authoritative calculation, used only for instant
// on-screen feedback before the score is actually submitted.
function computeScore(win, guessCount, hintsUsedCount) {
  if (!win) return 0;
  return Math.max(0, 1000 - (guessCount - 1) * 80 - hintsUsedCount * 100);
}

function formatLeaderboardDate(isoString) {
  return new Date(isoString).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const RESULT_EMOJI = { correct: "🟩", close: "🟨", wrong: "⬛" };

// One emoji row per guess (oldest first, like Wordle), one square per
// FIELDS column, colored by that guess's comparison status. Built purely
// from data already on screen - never touches the actual answer.
function buildEmojiGrid(guesses) {
  return [...guesses]
    .reverse()
    .map((g) => FIELDS.map((f) => RESULT_EMOJI[g.comparison[f.key].status] || "⬛").join(""))
    .join("\n");
}

// Wordle-style shareable result text. Only reveals the player's name on a
// win - a loss never shows the answer, so it can't spoil the puzzle for
// friends who haven't played yet.
function buildShareText({ mode, status, guesses, hintsUsedCount, revealPlayer, siteUrl }) {
  const won = status === "won";
  const modeNote = mode === "unlimited" ? " (Unlimited Mode)" : "";
  const headline = won
    ? `I guessed ${mode === "unlimited" ? "a" : "today's"} mystery player!${modeNote}`
    : `I couldn't guess ${mode === "unlimited" ? "the" : "today's"} mystery player...${modeNote}`;

  const lines = ["🏀 NBA GUESS WHO", "", headline, ""];

  if (won && revealPlayer) {
    lines.push(`Player: ${revealPlayer.name}`);
  }
  lines.push(`Result: ${won ? "🟩 Win" : "🟥 Loss"}`);
  lines.push(`Guesses: ${guesses.length}/${MAX_GUESSES}`);
  lines.push(`Hints Used: ${hintsUsedCount}`);
  lines.push("");
  lines.push(buildEmojiGrid(guesses));
  lines.push("");
  lines.push("Play NBA Guess Who:");
  lines.push(siteUrl);

  return lines.join("\n");
}

function makeGuessId() {
  return `guess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function PlayerAvatar({ src, name, size = 32 }) {
  const [errored, setErrored] = useState(false);
  return (
    <img
      className="player-avatar"
      style={{ width: size, height: size }}
      src={!src || errored ? FALLBACK_AVATAR : src}
      alt={name}
      onError={() => setErrored(true)}
    />
  );
}

export default function App() {
  const [mode, setMode] = useState("daily");
  const [modeLoading, setModeLoading] = useState(false);
  const [allPlayers, setAllPlayers] = useState([]);
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [guesses, setGuesses] = useState([]);
  const [status, setStatus] = useState("playing");
  const [revealPlayer, setRevealPlayer] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [unlockedHints, setUnlockedHints] = useState([]);
  const [hintLoading, setHintLoading] = useState(false);
  const [unlimitedRoundId, setUnlimitedRoundId] = useState(null);
  const [recentUnlimitedAnswers, setRecentUnlimitedAnswers] = useState([]);
  const [scoreSubmitted, setScoreSubmitted] = useState(false);
  const [submittingScore, setSubmittingScore] = useState(false);
  const [nickname, setNickname] = useState("");
  const [nicknameInput, setNicknameInput] = useState("");
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [shareToastVisible, setShareToastVisible] = useState(false);
  const shareToastTimerRef = useRef(null);
  const [profileStats, setProfileStats] = useState(EMPTY_PROFILE_STATS);
  const [showProfile, setShowProfile] = useState(false);

  async function fetchLeaderboard(modeToFetch) {
    setLeaderboardLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/leaderboard?mode=${modeToFetch}`);
      const data = await res.json();
      if (res.ok) setLeaderboard(data.leaderboard || []);
    } catch {
      // leave the previous leaderboard state on screen
    } finally {
      setLeaderboardLoading(false);
    }
  }

  function openNicknameModal() {
    setNicknameInput(nickname);
    setShowNicknameModal(true);
  }

  function handleSaveNickname() {
    const trimmed = nicknameInput.trim().slice(0, 20);
    if (!trimmed) return;
    setNickname(trimmed);
    saveNickname(trimmed);
    setShowNicknameModal(false);
  }

  // Starts a fresh Unlimited Mode round: asks the backend for a random
  // answer (avoiding recent ones), then clears guesses/status/hints so the
  // player starts from 0/8 against the new mystery player.
  async function startNewUnlimitedGame(excludeIdsOverride) {
    setModeLoading(true);
    setError("");
    try {
      const excludeIds = excludeIdsOverride ?? recentUnlimitedAnswers;
      const res = await fetch(`${API_URL}/api/unlimited/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excludeIds }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Could not start a new round.");
        return;
      }

      setUnlimitedRoundId(data.roundId);
      setGuesses([]);
      setStatus("playing");
      setRevealPlayer(null);
      setUnlockedHints([]);
      setScoreSubmitted(false);
      setQuery("");
      setShowSuggestions(false);
      setActiveIndex(-1);

      saveUnlimitedRound({
        roundId: data.roundId,
        guesses: [],
        status: "playing",
        revealPlayer: null,
        unlockedHints: [],
        scoreSubmitted: false,
      });
    } catch {
      setError("Could not reach the server to start a new round.");
    } finally {
      setModeLoading(false);
    }
  }

  useEffect(() => {
    fetch(`${API_URL}/api/players`)
      .then((r) => r.json())
      .then(setAllPlayers)
      .catch(() => setError("Could not load player list. Is the backend running?"));

    const savedNickname = loadNickname();
    if (savedNickname) {
      setNickname(savedNickname);
    } else {
      setShowNicknameModal(true);
    }

    setProfileStats(loadProfileStats());

    const savedMode = loadSavedMode();
    const recent = loadRecentUnlimitedAnswers();
    setRecentUnlimitedAnswers(recent);

    if (savedMode === "unlimited") {
      setMode("unlimited");
      const savedRound = loadUnlimitedRound();
      if (savedRound) {
        setUnlimitedRoundId(savedRound.roundId);
        setGuesses(savedRound.guesses);
        setStatus(savedRound.status);
        setRevealPlayer(savedRound.revealPlayer);
        setUnlockedHints(savedRound.unlockedHints);
        setScoreSubmitted(savedRound.scoreSubmitted);
      } else {
        startNewUnlimitedGame(recent);
      }
    } else {
      const savedDaily = loadDailyRound();
      if (savedDaily) {
        setGuesses(savedDaily.guesses);
        setStatus(savedDaily.status);
        setRevealPlayer(savedDaily.revealPlayer);
        setUnlockedHints(savedDaily.unlockedHints);
        setScoreSubmitted(savedDaily.scoreSubmitted);
      }
    }

    fetchLeaderboard(savedMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => window.clearTimeout(shareToastTimerRef.current);
  }, []);

  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || status !== "playing") return [];
    const guessedIds = new Set(guesses.map((g) => g.guessedPlayer.id));
    return allPlayers
      .filter((p) => !guessedIds.has(p.id) && p.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, allPlayers, guesses, status]);

  async function submitGuess(name) {
    const trimmed = name.trim();
    if (!trimmed || status !== "playing" || submitting) return;

    setSubmitting(true);
    setError("");
    try {
      const body = { name: trimmed };
      if (mode === "unlimited") body.roundId = unlimitedRoundId;

      const res = await fetch(`${API_URL}/api/guess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Try again.");
        return;
      }

      const newGuess = {
        id: makeGuessId(),
        guessedPlayer: data.guessedPlayer,
        comparison: data.comparison,
        correct: data.correct,
        animate: true,
      };
      const newGuesses = [newGuess, ...guesses];

      let newStatus = status;
      let newReveal = revealPlayer;
      let finishedAnswerId = null;

      if (data.correct) {
        newStatus = "won";
        newReveal = data.guessedPlayer;
        finishedAnswerId = data.guessedPlayer.id;
      } else if (newGuesses.length >= MAX_GUESSES) {
        newStatus = "lost";
        const revealUrl =
          mode === "unlimited"
            ? `${API_URL}/api/reveal?roundId=${unlimitedRoundId}`
            : `${API_URL}/api/reveal`;
        const revealRes = await fetch(revealUrl);
        const revealData = await revealRes.json();
        newReveal = revealData.player;
        finishedAnswerId = revealData.player.id;
      }

      setGuesses(newGuesses);
      setStatus(newStatus);
      setRevealPlayer(newReveal);

      if (newStatus === "won" || newStatus === "lost") {
        const win = newStatus === "won";
        const updatedStats = recordGameResult({
          mode,
          win,
          guessCount: newGuesses.length,
          hintsUsedCount: unlockedHints.length,
          score: computeScore(win, newGuesses.length, unlockedHints.length),
          playerName: win ? newReveal?.name : null,
        });
        setProfileStats(updatedStats);
      }

      if (mode === "unlimited") {
        saveUnlimitedRound({
          roundId: unlimitedRoundId,
          guesses: newGuesses,
          status: newStatus,
          revealPlayer: newReveal,
          unlockedHints,
          scoreSubmitted,
        });
        if (finishedAnswerId != null) {
          const updatedRecent = [...recentUnlimitedAnswers, finishedAnswerId].slice(
            -MAX_RECENT_UNLIMITED
          );
          setRecentUnlimitedAnswers(updatedRecent);
          saveRecentUnlimitedAnswers(updatedRecent);
        }
      } else {
        saveDailyRound({
          guesses: newGuesses,
          status: newStatus,
          revealPlayer: newReveal,
          unlockedHints,
          scoreSubmitted,
        });
      }

      setQuery("");
      setShowSuggestions(false);
      setActiveIndex(-1);
    } catch {
      setError("Could not reach the server. Is the backend running?");
    } finally {
      setSubmitting(false);
    }
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    submitGuess(query);
  }

  function handleSuggestionClick(name) {
    submitGuess(name);
  }

  async function handleUseHint() {
    if (status !== "playing" || unlockedHints.length >= MAX_HINTS || hintLoading) return;

    setHintLoading(true);
    setError("");
    try {
      const nextIndex = unlockedHints.length + 1;
      const hintUrl =
        mode === "unlimited"
          ? `${API_URL}/api/hint/${nextIndex}?roundId=${unlimitedRoundId}`
          : `${API_URL}/api/hint/${nextIndex}`;
      const res = await fetch(hintUrl);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Could not fetch hint. Try again.");
        return;
      }

      const newHints = [...unlockedHints, data.hint];
      setUnlockedHints(newHints);

      if (mode === "unlimited") {
        saveUnlimitedRound({
          roundId: unlimitedRoundId,
          guesses,
          status,
          revealPlayer,
          unlockedHints: newHints,
          scoreSubmitted,
        });
      } else {
        saveDailyRound({ guesses, status, revealPlayer, unlockedHints: newHints, scoreSubmitted });
      }
    } catch {
      setError("Could not reach the server for a hint.");
    } finally {
      setHintLoading(false);
    }
  }

  function handleModeSwitch(newMode) {
    if (newMode === mode || modeLoading) return;

    if (mode === "daily") {
      saveDailyRound({ guesses, status, revealPlayer, unlockedHints, scoreSubmitted });
    } else {
      saveUnlimitedRound({
        roundId: unlimitedRoundId,
        guesses,
        status,
        revealPlayer,
        unlockedHints,
        scoreSubmitted,
      });
    }

    setQuery("");
    setShowSuggestions(false);
    setActiveIndex(-1);
    setError("");
    saveMode(newMode);
    fetchLeaderboard(newMode);

    if (newMode === "unlimited") {
      setMode("unlimited");
      const savedRound = loadUnlimitedRound();
      if (savedRound) {
        setUnlimitedRoundId(savedRound.roundId);
        setGuesses(savedRound.guesses);
        setStatus(savedRound.status);
        setRevealPlayer(savedRound.revealPlayer);
        setUnlockedHints(savedRound.unlockedHints);
        setScoreSubmitted(savedRound.scoreSubmitted);
      } else {
        startNewUnlimitedGame();
      }
    } else {
      setMode("daily");
      const savedDaily = loadDailyRound();
      setGuesses(savedDaily?.guesses || []);
      setStatus(savedDaily?.status || "playing");
      setRevealPlayer(savedDaily?.revealPlayer || null);
      setUnlockedHints(savedDaily?.unlockedHints || []);
      setScoreSubmitted(savedDaily?.scoreSubmitted || false);
    }
  }

  function handleNextPlayer() {
    startNewUnlimitedGame();
  }

  async function handleSubmitScore() {
    if (status === "playing" || scoreSubmitted || submittingScore) return;

    setSubmittingScore(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/leaderboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: nickname || "Guest",
          mode,
          guesses: guesses.length,
          hintsUsed: unlockedHints.length,
          win: status === "won",
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Could not submit score.");
        return;
      }

      setScoreSubmitted(true);
      if (mode === "unlimited") {
        saveUnlimitedRound({
          roundId: unlimitedRoundId,
          guesses,
          status,
          revealPlayer,
          unlockedHints,
          scoreSubmitted: true,
        });
      } else {
        saveDailyRound({ guesses, status, revealPlayer, unlockedHints, scoreSubmitted: true });
      }
      fetchLeaderboard(mode);
    } catch {
      setError("Could not reach the server to submit your score.");
    } finally {
      setSubmittingScore(false);
    }
  }

  async function handleShareResult() {
    if (status === "playing") return;

    const text = buildShareText({
      mode,
      status,
      guesses,
      hintsUsedCount: unlockedHints.length,
      revealPlayer,
      siteUrl: window.location.origin,
    });

    try {
      await navigator.clipboard.writeText(text);
      setShareToastVisible(true);
      window.clearTimeout(shareToastTimerRef.current);
      shareToastTimerRef.current = window.setTimeout(() => setShareToastVisible(false), 2200);
    } catch {
      setError("Could not copy to clipboard - your browser may not support this.");
    }
  }

  function handleInputKeyDown(e) {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        e.preventDefault();
        submitGuess(suggestions[activeIndex].name);
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setActiveIndex(-1);
    }
  }

  function formatCellValue(field, value) {
    if (value === null || value === undefined) return "N/A";
    return field.format ? field.format(value) : value;
  }

  const winRate =
    profileStats.gamesPlayed > 0 ? Math.round((profileStats.wins / profileStats.gamesPlayed) * 100) : 0;
  const avgGuesses =
    profileStats.gamesPlayed > 0 ? (profileStats.totalGuesses / profileStats.gamesPlayed).toFixed(1) : "0.0";
  const avgHints =
    profileStats.gamesPlayed > 0 ? (profileStats.totalHints / profileStats.gamesPlayed).toFixed(1) : "0.0";

  return (
    <div className="app">
      {showProfile && (
        <div className="modal-backdrop">
          <div className="profile-panel">
            <div className="profile-panel-header">
              <h2>Player Profile</h2>
              <button type="button" className="profile-close-button" onClick={() => setShowProfile(false)}>
                ✕
              </button>
            </div>

            <div className="profile-identity">
              <div className="profile-avatar-placeholder">👤</div>
              <div>
                <p className="profile-username">{nickname || "Guest"}</p>
                <p className="profile-subtitle">
                  {profileStats.gamesPlayed} game{profileStats.gamesPlayed === 1 ? "" : "s"} played
                </p>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-value">{profileStats.gamesPlayed}</span>
                <span className="stat-label">Games Played</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{profileStats.wins}</span>
                <span className="stat-label">Wins</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{profileStats.losses}</span>
                <span className="stat-label">Losses</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{winRate}%</span>
                <span className="stat-label">Win Rate</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{avgGuesses}</span>
                <span className="stat-label">Avg Guesses</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{avgHints}</span>
                <span className="stat-label">Avg Hints Used</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{profileStats.currentStreak}</span>
                <span className="stat-label">Current Streak</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{profileStats.bestStreak}</span>
                <span className="stat-label">Best Streak</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{profileStats.highestScore}</span>
                <span className="stat-label">Highest Score</span>
              </div>
            </div>

            <h3 className="profile-section-title">Recent Games</h3>
            {profileStats.recentGames.length === 0 ? (
              <p className="leaderboard-status">No games played yet — go guess someone!</p>
            ) : (
              <div className="table-wrapper">
                <table className="leaderboard-table">
                  <thead>
                    <tr>
                      <th>Result</th>
                      <th>Mode</th>
                      <th>Guesses</th>
                      <th>Hints</th>
                      <th>Score</th>
                      <th>Player</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profileStats.recentGames.map((g, idx) => (
                      <tr key={idx}>
                        <td className={g.win ? "recent-result-win" : "recent-result-loss"}>
                          {g.win ? "Win" : "Loss"}
                        </td>
                        <td>{g.mode === "unlimited" ? "∞" : "📅"}</td>
                        <td>
                          {g.guesses}/{MAX_GUESSES}
                        </td>
                        <td>{g.hintsUsed}</td>
                        <td>{g.score}</td>
                        <td>{g.playerName || "—"}</td>
                        <td>{formatLeaderboardDate(g.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {showNicknameModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>Enter your nickname</h2>
            <p className="modal-subtitle">This is how you'll appear on the leaderboard.</p>
            <input
              type="text"
              className="modal-input"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveNickname();
              }}
              placeholder="e.g. Steph4Ever"
              maxLength={20}
              autoFocus
            />
            <button
              type="button"
              className="modal-save-button"
              onClick={handleSaveNickname}
              disabled={!nicknameInput.trim()}
            >
              Save
            </button>
          </div>
        </div>
      )}

      <div className="nickname-bar">
        <span className="nickname-display">👤 {nickname || "Guest"}</span>
        <button type="button" className="profile-nav-button" onClick={() => setShowProfile(true)}>
          📊 Profile
        </button>
        <button type="button" className="change-name-button" onClick={openNicknameModal}>
          Change Name
        </button>
      </div>

      <header className="header">
        <h1>NBA Guess Who</h1>
        <p className="subtitle">
          {mode === "unlimited"
            ? "∞ Unlimited Mode — play as many rounds as you want"
            : "📅 Daily Challenge — guess today's mystery NBA player"}
        </p>

        <div className="mode-switcher">
          <button
            type="button"
            className={`mode-button ${mode === "daily" ? "active" : ""}`}
            onClick={() => handleModeSwitch("daily")}
            disabled={modeLoading}
          >
            📅 Daily Challenge
          </button>
          <button
            type="button"
            className={`mode-button ${mode === "unlimited" ? "active" : ""}`}
            onClick={() => handleModeSwitch("unlimited")}
            disabled={modeLoading}
          >
            ∞ Unlimited Play
          </button>
        </div>
      </header>

      <main className="main">
        {status === "playing" && (
          <form className="search-form" onSubmit={handleFormSubmit} autoComplete="off">
            <div className="search-box">
              <input
                type="text"
                value={query}
                placeholder="Enter a player name..."
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
                onKeyDown={handleInputKeyDown}
              />
              <button type="submit" disabled={submitting || !query.trim()}>
                Guess
              </button>
            </div>

            {showSuggestions && suggestions.length > 0 && (
              <ul className="suggestions">
                {suggestions.map((p, idx) => (
                  <li
                    key={p.id}
                    className={`suggestion-item ${idx === activeIndex ? "active" : ""}`}
                    onMouseDown={() => handleSuggestionClick(p.name)}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <PlayerAvatar src={p.image} name={p.name} size={32} />
                    <div className="suggestion-info">
                      <span className="suggestion-name">{p.name}</span>
                      <span className="suggestion-meta">
                        {p.team} · {p.position}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </form>
        )}

        {status === "playing" && (
          <div className="hint-card">
            <div className="hint-header">
              <button
                type="button"
                className="hint-button"
                onClick={handleUseHint}
                disabled={unlockedHints.length >= MAX_HINTS || hintLoading}
              >
                💡 Hint
              </button>
              <span className="hint-counter">
                Hints left: {MAX_HINTS - unlockedHints.length}
              </span>
            </div>

            {unlockedHints.length > 0 && (
              <ul className="hint-list">
                {unlockedHints.map((hint, idx) => (
                  <li key={idx} className="hint-item">
                    {hint}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <p className="error-message">{error}</p>}

        <p className="guess-counter">
          Guess {Math.min(guesses.length, MAX_GUESSES)} / {MAX_GUESSES}
        </p>

        {status !== "playing" && revealPlayer && (
          <div className={`result-banner ${status}`}>
            <PlayerAvatar src={revealPlayer.image} name={revealPlayer.name} size={56} />
            <div>
              {status === "won" ? <h2>You got it!</h2> : <h2>Out of guesses</h2>}
              <p>
                The answer was <strong>{revealPlayer.name}</strong> ({revealPlayer.team})
              </p>
            </div>
          </div>
        )}

        {status !== "playing" && (
          <div className="score-bar">
            <p className="score-line">
              Score: <strong>{computeScore(status === "won", guesses.length, unlockedHints.length)}</strong>
            </p>
            {scoreSubmitted ? (
              <p className="score-submitted-message">✓ Score submitted to the leaderboard</p>
            ) : (
              <button
                type="button"
                className="submit-score-button"
                onClick={handleSubmitScore}
                disabled={submittingScore}
              >
                {submittingScore ? "Submitting..." : "Submit Score"}
              </button>
            )}
          </div>
        )}

        {status !== "playing" && (
          <div className="share-bar">
            <button type="button" className="share-button" onClick={handleShareResult}>
              📤 Share Result
            </button>
          </div>
        )}

        {status !== "playing" && (
          <div className="next-round-bar">
            {mode === "unlimited" ? (
              <button
                type="button"
                className="next-player-button"
                onClick={handleNextPlayer}
                disabled={modeLoading}
              >
                Next Player →
              </button>
            ) : (
              <p className="come-back-message">Come back tomorrow for a new Daily Challenge!</p>
            )}
          </div>
        )}

        {guesses.length > 0 && (
          <>
            <div className="legend">
              <span className="legend-item">
                <span className="swatch swatch-correct" /> Correct
              </span>
              <span className="legend-item">
                <span className="swatch swatch-close" /> Close
              </span>
              <span className="legend-item">
                <span className="swatch swatch-wrong" /> Wrong
              </span>
            </div>

            <div className="table-wrapper">
              <table className="guess-table">
                <thead>
                  <tr>
                    <th className="player-col">Player</th>
                    {FIELDS.map((f) => (
                      <th key={f.key}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {guesses.map((g) => (
                    <tr
                      key={g.id}
                      className={`guess-row ${g.animate ? "guess-row-animate" : ""}`}
                    >
                      <td className="player-name-cell">
                        <div className="player-cell-content">
                          <PlayerAvatar src={g.guessedPlayer.image} name={g.guessedPlayer.name} size={28} />
                          <span>{g.guessedPlayer.name}</span>
                        </div>
                      </td>
                      {FIELDS.map((f, idx) => {
                        const cell = g.comparison[f.key];
                        const delay = g.animate
                          ? `${(idx + 1) * FLIP_STEP_SECONDS}s`
                          : undefined;
                        return (
                          <td
                            key={f.key}
                            className={`cell cell-${cell.status}`}
                            style={delay ? { animationDelay: delay } : undefined}
                          >
                            <span className="cell-value">
                              {formatCellValue(f, cell.value)}
                            </span>
                            {cell.direction && (
                              <span className={`arrow arrow-${cell.direction}`}>
                                {cell.direction === "up" ? "↑" : "↓"}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="leaderboard-card">
          <h2 className="leaderboard-title">
            {mode === "unlimited" ? "∞ Unlimited Leaderboard" : "📅 Daily Leaderboard"}
          </h2>
          {leaderboardLoading ? (
            <p className="leaderboard-status">Loading...</p>
          ) : leaderboard.length === 0 ? (
            <p className="leaderboard-status">No scores yet — be the first!</p>
          ) : (
            <div className="table-wrapper">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="leaderboard-name-col">Nickname</th>
                    <th>Score</th>
                    <th>Guesses</th>
                    <th>Hints</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry) => (
                    <tr
                      key={entry.id}
                      className={entry.nickname === nickname ? "leaderboard-row-me" : ""}
                    >
                      <td>{entry.rank}</td>
                      <td className="leaderboard-name-col">{entry.nickname}</td>
                      <td>{entry.score}</td>
                      <td>{entry.guesses}</td>
                      <td>{entry.hintsUsed}</td>
                      <td>{formatLeaderboardDate(entry.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {shareToastVisible && <div className="toast">Copied to clipboard!</div>}
    </div>
  );
}
