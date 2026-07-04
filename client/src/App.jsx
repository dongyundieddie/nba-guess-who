import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

const MAX_GUESSES = 8;
const MAX_HINTS = 3;
const FLIP_STEP_SECONDS = 0.12;
// DEBUG: unlimited guesses for testing. Set back to false to restore the 8-guess limit.
const DEBUG_UNLIMITED_GUESSES = true;

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
  Germany: "🇩🇪",
};

function getCountryFlag(country) {
  return COUNTRY_FLAGS[country] || "🏳️";
}

function formatCountry(country) {
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

function getStorageKey() {
  return `nba-guess-who-${getTodayDateString()}`;
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      guesses: (parsed.guesses || []).map((g, idx) => ({
        id: g.id ?? `restored-${idx}`,
        guessedPlayer: g.guessedPlayer,
        comparison: g.comparison,
        correct: g.correct,
        animate: false,
      })),
      status: parsed.status,
      revealPlayer: parsed.revealPlayer,
      unlockedHints: parsed.unlockedHints || [],
    };
  } catch {
    return null;
  }
}

function saveState(state) {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(state));
  } catch {
    // localStorage unavailable (private mode, etc.) - fail silently
  }
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

  useEffect(() => {
    fetch("/api/players")
      .then((r) => r.json())
      .then(setAllPlayers)
      .catch(() => setError("Could not load player list. Is the backend running?"));

    const saved = loadSavedState();
    if (saved) {
      setGuesses(saved.guesses || []);
      setStatus(saved.status || "playing");
      setRevealPlayer(saved.revealPlayer || null);
      setUnlockedHints(saved.unlockedHints || []);
    }
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
      const res = await fetch("/api/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
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

      if (data.correct) {
        newStatus = "won";
        newReveal = data.guessedPlayer;
      } else if (!DEBUG_UNLIMITED_GUESSES && newGuesses.length >= MAX_GUESSES) {
        newStatus = "lost";
        const revealRes = await fetch("/api/reveal");
        const revealData = await revealRes.json();
        newReveal = revealData.player;
      }

      setGuesses(newGuesses);
      setStatus(newStatus);
      setRevealPlayer(newReveal);
      saveState({ guesses: newGuesses, status: newStatus, revealPlayer: newReveal, unlockedHints });

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

  function handleReset() {
    try {
      localStorage.removeItem(getStorageKey());
    } catch {
      // localStorage unavailable - ignore
    }
    setGuesses([]);
    setStatus("playing");
    setRevealPlayer(null);
    setQuery("");
    setError("");
    setShowSuggestions(false);
    setActiveIndex(-1);
    setUnlockedHints([]);
  }

  async function handleUseHint() {
    if (status !== "playing" || unlockedHints.length >= MAX_HINTS || hintLoading) return;

    setHintLoading(true);
    setError("");
    try {
      const nextIndex = unlockedHints.length + 1;
      const res = await fetch(`/api/hint/${nextIndex}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Could not fetch hint. Try again.");
        return;
      }

      const newHints = [...unlockedHints, data.hint];
      setUnlockedHints(newHints);
      saveState({ guesses, status, revealPlayer, unlockedHints: newHints });
    } catch {
      setError("Could not reach the server for a hint.");
    } finally {
      setHintLoading(false);
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
    return field.format ? field.format(value) : value;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>NBA Guess Who</h1>
        <p className="subtitle">Guess today's mystery NBA player</p>
        <button type="button" className="reset-button" onClick={handleReset}>
          Reset (debug)
        </button>
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
          {DEBUG_UNLIMITED_GUESSES
            ? `Guess ${guesses.length} (unlimited - debug mode)`
            : `Guess ${Math.min(guesses.length, MAX_GUESSES)} / ${MAX_GUESSES}`}
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
      </main>
    </div>
  );
}
