import data from "../data/universe.json";

export const shows = data.shows;
export const people = data.people;

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function seasonLabel(show, season) {
  if (show.seasons.length === 1 && season.title === show.name) return show.name;
  return `${show.name}: ${season.title}`;
}

// The line under a name: "Winner", "3rd place", "Eliminated in episode 2"
export function resultText(entry) {
  if (entry.result) return entry.result;
  if (entry.place) return `${ordinal(entry.place)} place`;
  return "";
}

export function initials(name) {
  const clean = name.replace(/\(.*?\)/g, "").trim();
  const parts = clean.split(/[\s-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Every season a person played, in show order.
export const appearances = {};
for (const show of shows) {
  for (const season of show.seasons) {
    for (const entry of season.cast) {
      (appearances[entry.person] ??= []).push({ show, season, entry });
    }
  }
}

export function showsOf(id) {
  return [...new Map(appearances[id].map((a) => [a.show.id, a.show])).values()];
}

export function isWinner(entry) {
  return entry.place === 1;
}

export const contestants = Object.entries(people)
  .map(([id, p]) => ({ id, ...p, apps: appearances[id], shows: showsOf(id) }))
  .sort((a, b) => a.name.localeCompare(b.name));

// People who crossed between seasons or shows, most appearances first.
export const crossovers = contestants
  .filter((c) => c.apps.length > 1)
  .sort((a, b) => b.apps.length - a.apps.length || a.name.localeCompare(b.name));

// A bio from the record when no one has written one yet.
export function recordBio(c) {
  const seasons = c.apps.map(({ show, season, entry }) => {
    const r = resultText(entry);
    return `${seasonLabel(show, season)}${r ? ` (${r.charAt(0).toLowerCase() + r.slice(1)})` : ""}`;
  });
  const list =
    seasons.length === 1
      ? seasons[0]
      : seasons.slice(0, -1).join(", ") + " and " + seasons.at(-1);
  return `${c.name} competed on ${list}.`;
}
