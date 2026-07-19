// Rebuilds server/data/players.json from ESPN's public NBA data endpoints.
//
// Why ESPN: it's a free, no-API-key, no-signup public JSON API (the same
// one that powers espn.com) that exposes current rosters, bios, and
// per-season averages. No third-party API key is required, so there's
// nothing to keep secret/out of the frontend for this data source. If a
// key-gated provider is added later, wire its key through
// `process.env` here - never in client code.
//
// Pipeline: ESPN API -> this script -> server/data/players.json -> Express
// serves the static file. The frontend and every game request only ever
// talk to our own Express API, never to ESPN directly.
//
// Run with: npm run update-players (from server/)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "data", "players.json");

const SEASON_LABEL = "2025-26";
const SEASON_YEAR = 2026; // ESPN's season.year for "2025-26"
const MIN_TEAMS = 30;
const MIN_PLAYERS = 300;
const MAX_PLAYERS_PER_TEAM = 15; // standard NBA active-roster limit
const REQUEST_TIMEOUT_MS = 10000;
const STATS_CONCURRENCY = 6;

const DIVISION_CONFERENCE = {
  Atlantic: "East",
  Central: "East",
  Southeast: "East",
  Northwest: "West",
  Pacific: "West",
  Southwest: "West",
};

const warnings = [];
function warn(message) {
  warnings.push(message);
}

async function fetchJSON(url, { retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      await sleep(300 * (attempt + 1));
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs `worker` over `items` with at most `limit` in flight at once.
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function fetchTeams() {
  const data = await fetchJSON(
    "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=40"
  );
  const teams = data?.sports?.[0]?.leagues?.[0]?.teams || [];
  return teams.map((t) => ({
    espnId: t.team.id,
    abbr: t.team.abbreviation,
    name: t.team.displayName,
  }));
}

async function fetchTeamDivisionAndLogo(espnId) {
  const data = await fetchJSON(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}`
  );
  const team = data?.team;
  const summary = team?.standingSummary || "";
  const match = summary.match(/in (\w+) Division/);
  const division = match ? match[1] : null;
  const logo =
    team?.logos?.find((l) => l.rel?.includes("default"))?.href || team?.logos?.[0]?.href || null;
  return { division, logo };
}

async function fetchRoster(espnId) {
  const data = await fetchJSON(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}/roster`
  );
  return data?.athletes || [];
}

// Pulls this player's 2025-26 regular-season per-game averages. Returns
// null stats (with a warning) if the player has no games recorded for the
// season - never fabricated or backfilled from a different season.
// Returns a `warning` string instead of calling warn() directly - roughly
// a third of a team's roster gets trimmed out after this (see
// MAX_PLAYERS_PER_TEAM below), and warnings about players who don't make
// the final cut would just be noise. The caller flushes the warning only
// for players that survive trimming.
async function fetchPlayerSeasonStats(athleteId, label) {
  let data;
  try {
    data = await fetchJSON(
      `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${athleteId}/stats`
    );
  } catch (err) {
    return {
      ppg: null,
      rpg: null,
      apg: null,
      gamesPlayed: null,
      activityScore: 0,
      warning: `${label}: could not fetch stats (${err.message}) - stats set to null`,
    };
  }

  const averages = (data?.categories || []).find((c) => c.name === "averages");
  const rows = averages?.statistics || [];
  const gamesPlayedIdx = averages ? averages.names.indexOf("gamesPlayed") : -1;

  // Has this player ever appeared in an NBA regular-season game, in any
  // season? This is what separates an injured veteran (0 games *this*
  // season, but a real track record) from a true two-way/rookie who
  // hasn't debuted - both can show up on a team's roster listing.
  const hasAnyNbaHistory =
    gamesPlayedIdx >= 0 && rows.some((r) => toNumberOrNull(r.stats[gamesPlayedIdx]) > 0);

  const row = rows.find((s) => s.season?.year === SEASON_YEAR);
  if (!averages || !row) {
    return {
      ppg: null,
      rpg: null,
      apg: null,
      gamesPlayed: null,
      activityScore: hasAnyNbaHistory ? 500 : 0,
      warning: `${label}: no ${SEASON_LABEL} averages available - stats set to null`,
    };
  }

  const byName = Object.fromEntries(averages.names.map((n, i) => [n, row.stats[i]]));
  const gamesPlayed = toNumberOrNull(byName.gamesPlayed);
  if (!gamesPlayed) {
    return {
      ppg: null,
      rpg: null,
      apg: null,
      gamesPlayed: 0,
      activityScore: hasAnyNbaHistory ? 500 : 0,
      warning: `${label}: 0 games played in ${SEASON_LABEL} - stats set to null`,
    };
  }

  return {
    ppg: toNumberOrNull(byName.avgPoints),
    rpg: toNumberOrNull(byName.avgRebounds),
    apg: toNumberOrNull(byName.avgAssists),
    gamesPlayed,
    activityScore: 1000 + gamesPlayed,
    warning: null,
  };
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

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

function formatHeightDisplay(inches) {
  if (!Number.isFinite(inches)) return null;
  const feet = Math.floor(inches / 12);
  const remainder = inches % 12;
  return `${feet}'${remainder}"`;
}

async function buildPlayers() {
  console.log(`Fetching NBA team list...`);
  const teams = await fetchTeams();
  if (teams.length < MIN_TEAMS) {
    throw new Error(`Only found ${teams.length} teams from the data source (need ${MIN_TEAMS}).`);
  }

  const rawPlayers = [];
  let nextId = 1;
  const teamsCovered = new Set();

  for (const team of teams) {
    process.stdout.write(`  ${team.abbr.padEnd(4)} ${team.name}... `);

    const [{ division, logo }, roster] = await Promise.all([
      fetchTeamDivisionAndLogo(team.espnId),
      fetchRoster(team.espnId),
    ]);

    const conference = division ? DIVISION_CONFERENCE[division] || null : null;
    if (!division || !conference) {
      warn(`${team.name}: could not determine division/conference from data source`);
    }

    const statsList = await mapWithConcurrency(roster, STATS_CONCURRENCY, (athlete) =>
      fetchPlayerSeasonStats(athlete.id, `${team.name} - ${athlete.fullName}`)
    );

    // ESPN's roster listing includes everyone affiliated with the team,
    // which can run past the 15-man standard-contract limit into two-way
    // and not-yet-debuted rookies. Rank by real observed activity (this
    // season's games, falling back to "has an NBA track record at all")
    // and keep the top MAX_PLAYERS_PER_TEAM - this filters out
    // never-played fringe players without guessing at contract type.
    const candidates = roster
      .map((athlete, i) => ({ athlete, stats: statsList[i] }))
      .sort((a, b) => b.stats.activityScore - a.stats.activityScore)
      .slice(0, MAX_PLAYERS_PER_TEAM);

    let keptForTeam = 0;
    for (const { athlete, stats } of candidates) {
      const heightInches = toNumberOrNull(athlete.height);
      const position = athlete.position?.abbreviation || null;
      if (!position) warn(`${team.name} - ${athlete.fullName}: missing position`);
      if (heightInches === null) warn(`${team.name} - ${athlete.fullName}: missing height`);
      if (stats.warning) warn(stats.warning);

      rawPlayers.push({
        id: nextId++,
        name: athlete.fullName,
        team: team.name,
        teamAbbr: team.abbr,
        conference,
        division,
        position,
        secondaryPosition: null, // not exposed by this free data source
        heightInches,
        heightDisplay: formatHeightDisplay(heightInches),
        birthDate: athlete.dateOfBirth ? athlete.dateOfBirth.slice(0, 10) : null,
        age: calculateAge(athlete.dateOfBirth),
        country: athlete.birthPlace?.country || null,
        ppg: stats.ppg,
        rpg: stats.rpg,
        apg: stats.apg,
        gamesPlayed: stats.gamesPlayed,
        image: athlete.headshot?.href || null,
        teamLogo: logo,
        season: SEASON_LABEL,
        active: (athlete.status?.type || "active") === "active",
      });
      keptForTeam++;
    }

    if (keptForTeam < 8) {
      warn(`${team.name}: only ${keptForTeam} players kept (expected 8-12+)`);
    }
    teamsCovered.add(team.abbr);
    console.log(`${keptForTeam} players`);
  }

  return { rawPlayers, teamsCovered };
}

function dedupe(players) {
  const seenIds = new Set();
  const seenNameTeam = new Set();
  const deduped = [];
  let removed = 0;

  for (const p of players) {
    const nameTeamKey = `${p.name.toLowerCase()}::${p.team}`;
    if (seenIds.has(p.id) || seenNameTeam.has(nameTeamKey)) {
      removed++;
      continue;
    }
    seenIds.add(p.id);
    seenNameTeam.add(nameTeamKey);
    deduped.push(p);
  }

  return { deduped, removed };
}

function validate(players, teamsCovered) {
  const errors = [];

  if (teamsCovered.size < MIN_TEAMS) {
    errors.push(`Only ${teamsCovered.size}/${MIN_TEAMS} teams covered.`);
  }
  if (players.length < MIN_PLAYERS) {
    errors.push(`Only ${players.length} players (need at least ${MIN_PLAYERS}).`);
  }

  const ids = new Set();
  for (const p of players) {
    if (ids.has(p.id)) errors.push(`Duplicate id: ${p.id}`);
    ids.add(p.id);
    if (!p.team) errors.push(`${p.name}: missing team`);
    if (p.conference !== "East" && p.conference !== "West") {
      errors.push(`${p.name}: invalid conference "${p.conference}"`);
    }
    if (typeof p.heightInches !== "number" && p.heightInches !== null) {
      errors.push(`${p.name}: heightInches is not a number or null`);
    }
    for (const field of ["ppg", "rpg", "apg"]) {
      if (typeof p[field] !== "number" && p[field] !== null) {
        errors.push(`${p.name}: ${field} is not a number or null`);
      }
    }
    if (p.season !== SEASON_LABEL) errors.push(`${p.name}: season is not "${SEASON_LABEL}"`);
  }

  return errors;
}

async function main() {
  const { rawPlayers, teamsCovered } = await buildPlayers();
  const { deduped, removed } = dedupe(rawPlayers);

  const errors = validate(deduped, teamsCovered);

  const missingImages = deduped.filter((p) => !p.image).length;
  const missingStats = deduped.filter((p) => p.ppg === null || p.rpg === null || p.apg === null).length;

  console.log("");
  console.log(`Players loaded: ${deduped.length}`);
  console.log(`Teams covered: ${teamsCovered.size}/${MIN_TEAMS}`);
  console.log(`Players missing images: ${missingImages}`);
  console.log(`Players missing stats: ${missingStats}`);
  console.log(`Duplicate players removed: ${removed}`);

  if (warnings.length > 0) {
    console.log(`\nWarnings (${warnings.length}):`);
    warnings.slice(0, 50).forEach((w) => console.log(`  - ${w}`));
    if (warnings.length > 50) console.log(`  ...and ${warnings.length - 50} more`);
  }

  if (errors.length > 0) {
    console.error(`\nValidation FAILED (${errors.length} error(s)):`);
    errors.slice(0, 50).forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(deduped, null, 2) + "\n");
  console.log(`\nValidation passed. Wrote ${deduped.length} players to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("update-players failed:", err);
  process.exit(1);
});
