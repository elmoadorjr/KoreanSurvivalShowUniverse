# Survival Universe

An unofficial fan site for Korean survival shows: every season's cast, a bio
page for each contestant, and the players who crossed from one show to another.

Shows covered: The Genius, Society Game, Money Game, The Bloody Game,
Physical: 100 (with Physical: Asia), Siren: Survive the Island,
The Devil's Plan and The Influencer.

Built with [Astro](https://astro.build) as a static site.

```bash
npm install
npm run dev       # local dev server
npm run build     # static site in dist/
```

## Pages

- `/`: the shows, the crossover players and the hall of champions
- `/shows/` and `/shows/<show>/`: each show with every season's cast
- `/contestants/`: every player, searchable (English or Korean) and filterable
- `/contestants/<id>/`: a bio, the full survival record and old rivals

## Editing the data

Everything lives in `src/data/universe.json`. Pages are generated from it, so
adding a show, a season or a player needs no code.

- `shows[].seasons[].cast`: `{ "person": "<id>", "place": 1, "result": "Winner" }`.
  `place` and `result` are optional; leave them out when unsure.
- `complete: false` marks a season whose roster is partial (shown as "in progress").
- `people.<id>`: `name`, optional `ko` (Hangul), `known` (what they do) and `bio`.
  Without a `bio`, the page writes one from the player's record.
- Use the same person id across shows to link a crossover player.

### Known gaps

- Physical: 100 seasons, Physical: Asia, Siren, The Influencer, Society Game and
  The Bloody Game X list featured players only; their full rosters are large.
- Some middle placements (The Genius seasons 1, 3 and 4, The Devil's Plan,
  The Bloody Game) are left blank because sources disagree.
