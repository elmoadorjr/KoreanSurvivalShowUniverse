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
- `/network/`: a 3D graph (three.js, via 3d-force-graph) of every player linked
  to every season they played; veterans who crossed shows glow gold.
  `/network/?focus=<id>` flies to a player.

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

- Physical: 100 seasons, Physical: Asia, Siren, The Influencer, University War,
  Death Game and Life's Game list featured players only (or none: Life's Game
  players are LG employees under aliases).
- Unconfirmed winners: The Black Sheep Game (not recorded), Accomplice 2 and
  Four Wishes (from fan records).
- Some middle placements (The Genius seasons 1, 3 and 4, The Devil's Plan,
  The Bloody Game) are left blank because sources disagree.
