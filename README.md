# Survival Universe

An unofficial fan site for Korean survival shows: every season's cast, a bio
page for each contestant, and the players who crossed from one show to another.

Shows covered (19): The Genius, Society Game, Prison Life of Fools, Money Game,
Accomplice, The Bloody Game (including X), The Black Sheep Game, Physical: 100
(with Physical: Asia), The Time Hotel, Siren: Survive the Island, The Devil's
Plan (season 3 announced), University War, The Community, The Influencer,
Life's Game, Four Wishes, Death Game, Synchro Game and Betting on Fact.

Left out on purpose: mystery, escape and quiz shows with no elimination or
winner (Crime Scene, The Great Escape, Agents of Mystery, Problematic Men,
Brain Academy). Announced but not yet cast: Jang Dong-min's untitled Netflix
survival show.

Built with [Astro](https://astro.build) as a static site.

```bash
npm install
npm run dev       # local dev server
npm run build     # static site in dist/
```

## Hosting

`netlify.toml` holds the Netlify build settings (`npm run build`, publish
`dist/`). Any static host works: the build output is plain files.

## Pages

- `/`: the shows, the crossover players and the hall of champions
- `/shows/` and `/shows/<show>/`: each show with every season's cast
- `/contestants/`: every player, searchable (English or Korean) and filterable
- `/contestants/<id>/`: a bio, the full survival record and old rivals
- `/devils-plan-3/`: The Devil's Plan: Dead Again (November 2026): all sixteen
  players' records and every pair who has played together before
- `/network/`: the explorer (three.js via 3d-force-graph).
  - A guided tour (▶ Take the tour, or `?tour`): ten cinematic scenes with
    captions written from the data, auto-advancing or step by step.
  - Analytics computed in the browser: bridging (betweenness: how many
    shortest chains run through each player) and hidden families (Louvain
    communities, weighted so small casts bind harder than big ones).
  - Color by main show, career tier, debut year or family; size by
    connections, bridging, titles or seasons.
  - Compare up to four players (shift-click, or Compare in the panel): side
    by side stats, career strips, seasons together and co-players in common.
  - ← → step through the selected player's strongest connections; Save
    image exports the current view with a caption.
  - Three layouts, each with variants:
    - Web: players pulled together by shared seasons.
    - Rings by tier (legends at the center, then crossovers, veterans and
      one-season players), by seasons played, or by steps from any player
      (click someone to put them in the middle; `?rings=steps&center=<id>`).
    - Flow by debut year, by show lanes (a lane per show across the years,
      so players crossing lanes are players moving between shows), or as a
      spiral of time winding out from 2013.
  - Glowing nodes sized by connections, gold rings for champions, curved
    lines with light flowing from the earlier debut to the later, a faint
    glow behind each show's cluster, names that appear by importance as you
    zoom, eased highlights, an idle drift and a fly-in on load. Career strips
    in the panel show every season on a 2013 to 2026 line.
  - Players view links players who shared a season; Seasons view hangs them
    off show and season hubs. Strong ties (2+ seasons) by default; hovering a
    player brings back all their lines. Phones start in the flat 2D view.
  - One-tap starting points, search with suggestions, connect any two players
    (shortest chain of co-players), a player's circle, cast groups.
  - Head to head on every link: who finished higher each time they met.
  - Timeline slider and play button: the universe from 2013 onwards.
  - Insights: most connected, most titles, steps from Hong Jin-ho, and the
    players who are the only link between two shows.
  - Show filters grouped by kind, a sortable list view of the same data, and
    the whole view in the URL (`view`, `layout`, `rings`, `flow`, `center`, `who`, `shows`, `year`,
    `strong`, `flat`, `color`, `size`, `focus`, `from`/`to`, `group`,
    `circle`, `compare`, `tour`).

## Editing the data

Everything lives in `src/data/universe.json`. Pages are generated from it, so
adding a show, a season or a player needs no code.

- `shows[].seasons[].cast`: `{ "person": "<id>", "place": 1, "result": "Winner" }`.
  `place` and `result` are optional; leave them out when unsure.
- `complete: false` marks a season whose roster is partial (shown as "in progress").
- `people.<id>`: `name`, optional `ko` (Hangul), `known` (what they do) and `bio`.
  Without a `bio`, the page writes one from the player's record.
- Use the same person id across shows to link a crossover player.

## Player photos

Photos are freely licensed images from Wikimedia Commons, found through each
player's Wikidata "image" and credited on their bio page. `npm run build` runs
`node scripts/photos.mjs --build` first: it fetches any new photos (cached in
`node_modules/.cache/ksu-photos`), quietly does nothing offline, and never fails
the build. Players without a free photo keep their initials badge.

- `npm run photos` fetches photos locally and lists the players it skipped.
  Commit `public/photos/` and `src/data/photos.json` to keep them.
- `npm run photos -- lee-se-dol` refetches one player.
- A player is matched only when exactly one person on Wikidata fits (their
  Korean name must match `ko`). For a common name, pin it in
  `universe.json` with `"wikidata": "Q..."`, name a Commons file with
  `"photo": "File name.jpg"`, or opt out with `"photo": false`.

Promotional photos from networks are copyrighted, so they are never used.

### Known gaps

- Physical: 100 (100 players a season), Physical: Asia and The Influencer (77)
  list featured players only.
- Winners from fan records only: Accomplice 2 and Four Wishes.
- Some middle placements in The Bloody Game seasons 1 to 3 are still blank
  where sources disagree.
- Some middle placements (The Genius seasons 1, 3 and 4, The Devil's Plan,
  The Bloody Game) are left blank because sources disagree.
