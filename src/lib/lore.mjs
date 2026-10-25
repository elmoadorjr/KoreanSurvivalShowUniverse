import lore from "../data/lore.json";
import { people, shows, findSeason, sharedSeasons, headToHeadText } from "./universe.mjs";

// Every id in the lore must exist, so a typo fails the build instead of a page.
const showIds = new Set(shows.map((s) => s.id));
function check(where, ids) {
  for (const id of ids) if (!people[id]) throw new Error(`lore: unknown person "${id}" in ${where}`);
}
for (const m of lore.moments) {
  check(`moment ${m.id}`, m.people);
  if (m.season && !findSeason(m.season)) throw new Error(`lore: unknown season "${m.season}" in moment ${m.id}`);
}
for (const b of lore.bonds) check(`bond ${b.id}`, b.people);
for (const n of lore.nicknames) check("nicknames", [n.person]);
for (const a of lore.architects) for (const s of a.shows) if (!showIds.has(s)) throw new Error(`lore: unknown show "${s}" for ${a.name}`);

export const eras = lore.eras;
export const architects = lore.architects;
export const nicknames = lore.nicknames;

// Moments, oldest first, with their show and season attached.
export const moments = lore.moments
  .map((m, order) => ({ ...m, order, ...(m.season ? findSeason(m.season) : {}) }))
  .sort((a, b) => a.year - b.year || a.order - b.order);

// Bonds, with the seasons each pair or group actually shared.
export const bonds = lore.bonds.map((b) => {
  const [a, c] = b.people;
  const together = b.people.length === 2 ? sharedSeasons(a, c) : sharedSeasons(a, c).filter((t) => b.people.every((id) => t.season.cast.some((e) => e.person === id)));
  return { ...b, together, record: b.people.length === 2 ? headToHeadText(a, c) : "" };
});

export const eraOf = (year) => eras.find((e) => year >= e.years[0] && year <= e.years[1]);

export function loreForPerson(id) {
  return {
    moments: moments.filter((m) => m.people.includes(id)),
    bonds: bonds.filter((b) => b.people.includes(id)),
    nicknames: nicknames.filter((n) => n.person === id),
  };
}

export const loreForShow = (showId) => moments.filter((m) => m.show?.id === showId);
