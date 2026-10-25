import ForceGraph3D from "3d-force-graph";
import SpriteText from "three-spritetext";
import { forceX, forceY, forceZ, forceRadial } from "d3-force-3d";
import {
  AdditiveBlending, BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, Group, LineBasicMaterial,
  LineLoop, Mesh, MeshStandardMaterial, NormalBlending, Points, PointsMaterial, SphereGeometry, SRGBColorSpace,
  Sprite, SpriteMaterial, Vector3,
} from "three";

const data = JSON.parse(document.getElementById("graph-data").textContent);
const el = document.getElementById("graph");
const css = getComputedStyle(document.documentElement);
const token = (name) => css.getPropertyValue(name).trim();
const theme = { bg: token("--bg"), ink: token("--ink"), muted: token("--muted"), gold: token("--gold"), line: token("--line") };
const dark = matchMedia("(prefers-color-scheme: dark)").matches;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const plain = (name) => name.replace(/\s*\(.*\)/, "");
const narrow = () => matchMedia("(max-width: 760px)").matches;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function rgba(hex, a) {
  const c = new Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}

// ---------- Indexes ----------
const showById = Object.fromEntries(data.shows.map((s) => [s.id, s]));
const seasonById = Object.fromEntries(data.seasons.map((s) => [s.id, s]));
const personById = Object.fromEntries(data.people.map((p) => [p.id, p]));
const castOf = Object.fromEntries(data.seasons.map((s) => [s.id, []]));
for (const p of data.people) {
  p.showIds = [...new Set(p.apps.map((a) => seasonById[a.season].show))];
  p.titles = p.apps.filter((a) => a.won).length;
  const count = {};
  for (const a of p.apps) count[seasonById[a.season].show] = (count[seasonById[a.season].show] ?? 0) + 1;
  p.primary = p.showIds.reduce((best, s) => (count[s] > count[best] ? s : best), p.showIds[0]);
  p.debut = Math.min(...p.apps.map((a) => seasonById[a.season].year));
  for (const a of p.apps) castOf[a.season].push(p.id);
}
for (const s of data.shows) s.debut = Math.min(...data.seasons.filter((x) => x.show === s.id).map((x) => x.year));
const crossShow = (p) => p.showIds.length > 1;
const FIRST = Math.min(...data.seasons.map((s) => s.year));
const LAST = Math.max(...data.seasons.map((s) => s.year));
const appOf = (id, sid) => personById[id].apps.find((a) => a.season === sid);

// The four tiers of a career, used by the Rings layout and the panel.
const TIERS = [
  { name: "Legend", test: (p) => p.titles >= 2 || p.showIds.length >= 3, r: 70 },
  { name: "Crossover", test: (p) => p.showIds.length === 2, r: 170 },
  { name: "Veteran", test: (p) => p.apps.length >= 2, r: 260 },
  { name: "One season", test: () => true, r: 350 },
];
const tierOf = (p) => TIERS.find((t) => t.test(p));

function together(a, b) {
  const theirs = new Set(personById[b].apps.map((x) => x.season));
  return personById[a].apps.map((x) => x.season).filter((s) => theirs.has(s));
}
function mates(id) {
  const n = new Map();
  for (const a of personById[id].apps) {
    for (const other of castOf[a.season]) if (other !== id) n.set(other, (n.get(other) ?? 0) + 1);
  }
  return n;
}
const mateCount = Object.fromEntries(data.people.map((p) => [p.id, mates(p.id).size]));
const connectedRank = Object.fromEntries(Object.entries(mateCount).sort((a, b) => b[1] - a[1]).map(([id], i) => [id, i + 1]));

function distances(from) {
  const dist = new Map([[from, 0]]);
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of mates(cur).keys()) {
      if (dist.has(next)) continue;
      dist.set(next, dist.get(cur) + 1);
      prev.set(next, cur);
      queue.push(next);
    }
  }
  return { dist, prev };
}
function shortestPath(from, to) {
  const { prev } = distances(from);
  if (!prev.has(to)) return null;
  const path = [];
  for (let at = to; at !== null; at = prev.get(at)) path.unshift(at);
  return path;
}
function headToHead(a, b) {
  const rows = together(a, b).map((sid) => {
    const pa = appOf(a, sid).place, pb = appOf(b, sid).place;
    const decided = !seasonById[sid].upcoming && pa && pb;
    return { sid, better: decided ? (pa < pb ? a : pb < pa ? b : "tie") : null };
  });
  const score = { [a]: 0, [b]: 0, tie: 0 };
  for (const r of rows) if (r.better) score[r.better]++;
  return { rows, score };
}

// ---------- Analytics: bridges and families ----------
const adjacency = Object.fromEntries(data.people.map((p) => [p.id, mates(p.id)]));

// Bridging (betweenness): how many shortest chains between other players run through each one.
const bridging = (() => {
  const ids = data.people.map((p) => p.id);
  const cb = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const src of ids) {
    const stack = [];
    const pred = new Map();
    const sigma = new Map([[src, 1]]);
    const dist = new Map([[src, 0]]);
    const queue = [src];
    for (let i = 0; i < queue.length; i++) {
      const v = queue[i];
      stack.push(v);
      for (const w of adjacency[v].keys()) {
        if (!dist.has(w)) { dist.set(w, dist.get(v) + 1); queue.push(w); }
        if (dist.get(w) === dist.get(v) + 1) {
          sigma.set(w, (sigma.get(w) ?? 0) + sigma.get(v));
          if (!pred.has(w)) pred.set(w, []);
          pred.get(w).push(v);
        }
      }
    }
    const delta = new Map();
    while (stack.length) {
      const w = stack.pop();
      for (const v of pred.get(w) ?? []) delta.set(v, (delta.get(v) ?? 0) + (sigma.get(v) / sigma.get(w)) * (1 + (delta.get(w) ?? 0)));
      if (w !== src) cb[w] += delta.get(w) ?? 0;
    }
  }
  const max = Math.max(...Object.values(cb)) || 1;
  return Object.fromEntries(Object.entries(cb).map(([k, v]) => [k, v / max]));
})();
const bridgeRank = Object.fromEntries(Object.entries(bridging).sort((a, b) => b[1] - a[1]).map(([id], i) => [id, i + 1]));

// Families: groups who keep meeting, found from the graph itself (Louvain), not from show labels.
// Small casts bind harder than big ones, so a shared 8-player game counts for more than a 24-player one.
const families = (() => {
  const w = Object.fromEntries(data.people.map((p) => [p.id, new Map()]));
  for (const [sid, cast] of Object.entries(castOf)) {
    const x = 1 / Math.max(1, cast.length - 1);
    for (const a of cast) for (const b of cast) if (a !== b) w[a].set(b, (w[a].get(b) ?? 0) + x);
  }
  const nodes = Object.keys(w).sort();
  const comm = Object.fromEntries(nodes.map((n) => [n, n]));
  const k = Object.fromEntries(nodes.map((n) => [n, [...w[n].values()].reduce((s2, v) => s2 + v, 0)]));
  const m2 = Object.values(k).reduce((s2, v) => s2 + v, 0) || 1;
  const tot = { ...k };
  for (let it = 0, moved = true; moved && it < 50; it++) {
    moved = false;
    for (const n of nodes) {
      const c0 = comm[n];
      tot[c0] -= k[n];
      const links = new Map();
      for (const [o, v] of w[n]) links.set(comm[o], (links.get(comm[o]) ?? 0) + v);
      let best = c0, gain = (links.get(c0) ?? 0) - tot[c0] * k[n] / m2;
      for (const [c, v] of links) {
        const g = v - (tot[c] ?? 0) * k[n] / m2;
        if (g > gain + 1e-12) { gain = g; best = c; }
      }
      comm[n] = best;
      tot[best] = (tot[best] ?? 0) + k[n];
      if (best !== c0) moved = true;
    }
  }
  const groups = {};
  for (const [id, c] of Object.entries(comm)) (groups[c] ??= []).push(id);
  const PALETTE = ["#ff6b6b", "#4ecdc4", "#ffd166", "#a78bfa", "#06d6a0", "#f78c6b", "#60a5fa", "#f472b6", "#c3e88d", "#ffb4a2", "#89ddff", "#e9c46a", "#b392f0", "#ff9f1c"];
  const list = Object.values(groups).sort((a, b) => b.length - a.length).map((members, i) => {
    const shows = {};
    for (const id of members) for (const a of personById[id].apps) {
      const sh = seasonById[a.season].show;
      shows[sh] = (shows[sh] ?? 0) + 1;
    }
    const top = Object.entries(shows).sort((a, b) => b[1] - a[1]).map(([sh]) => showById[sh].name);
    const cross = members.filter((id) => personById[id].showIds.length > 1).length;
    return { id: i, members, shows: top, cross, name: top.slice(0, 2).join(" × "), color: members.length > 1 ? PALETTE[i % PALETTE.length] : theme.muted };
  });
  const of = {};
  for (const f of list) for (const id of f.members) of[id] = f;
  return { list, of };
})();

// ---------- State ----------
const defaultDims = narrow() ? 2 : 3;
const state = {
  view: "players",
  layout: "web",
  who: "veterans",
  shows: new Set(data.shows.map((s) => s.id)),
  year: LAST,
  strong: true,
  dims: defaultDims,
  group: null,
  ego: null,
  path: null,
  hover: null,
  selected: null,
  after: null,
  settled: false,
  list: false,
  first: true,
  colorBy: "show",
  sizeBy: "connections",
  compare: [],
};

// Color and size of a player, by the chosen measure.
const DEBUT_COLORS = ["#60a5fa", "#a78bfa", "#f472b6", "#fb923c", "#facc15"];
function debutColor(year) {
  const t = (year - FIRST) / Math.max(1, LAST - FIRST);
  const i = Math.min(DEBUT_COLORS.length - 2, Math.floor(t * (DEBUT_COLORS.length - 1)));
  const f = t * (DEBUT_COLORS.length - 1) - i;
  return "#" + new Color(DEBUT_COLORS[i]).lerp(new Color(DEBUT_COLORS[i + 1]), f).getHexString();
}
const TIER_COLORS = { Legend: "#facc15", Crossover: "#4ecdc4", Veteran: "#818cf8", "One season": "#8b8698" };
function colorOf(p) {
  if (state.colorBy === "tier") return TIER_COLORS[tierOf(p).name];
  if (state.colorBy === "debut") return debutColor(p.debut);
  if (state.colorBy === "family") return families.of[p.id].color;
  return showById[p.primary].color;
}
function sizeOf(p) {
  if (state.sizeBy === "bridging") return 1 + bridging[p.id] * 26;
  if (state.sizeBy === "titles") return 1 + p.titles * 6;
  if (state.sizeBy === "seasons") return 1 + p.apps.length * 2.4;
  return 1 + mateCount[p.id] / 6 + p.apps.length * 0.6;
}

const seasonOn = (sid) => state.shows.has(seasonById[sid].show) && sid !== state.group?.except && seasonById[sid].year <= state.year;

function visiblePeople() {
  let ids;
  if (state.ego) {
    ids = new Set([state.ego]);
    for (const a of personById[state.ego].apps) if (seasonOn(a.season)) for (const o of castOf[a.season]) ids.add(o);
  } else if (state.group) {
    ids = new Set(state.group.ids);
  } else {
    ids = new Set();
    for (const p of data.people) {
      const on = p.apps.filter((a) => seasonOn(a.season)).length;
      if (on && (state.who === "all" || on > 1)) ids.add(p.id);
    }
  }
  for (const id of state.path ?? []) ids.add(id);
  return ids;
}

function pathSeasons() {
  const out = new Set();
  const path = state.path ?? [];
  for (let i = 1; i < path.length; i++) for (const s of together(path[i - 1], path[i])) out.add(s);
  return out;
}

const linkKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Node objects are reused between builds, so the layout grows instead of restarting.
const nodeCache = new Map();
function nodeObj(id, props) {
  let n = nodeCache.get(id);
  if (!n) {
    n = { id, anim: { alpha: 0, scale: 0.2, label: 0 } };
    nodeCache.set(id, n);
  }
  return Object.assign(n, props);
}

function build() {
  const ids = visiblePeople();
  const keep = pathSeasons();
  const on = (sid) => seasonOn(sid) || keep.has(sid);
  const nodes = [];
  const links = [];
  for (const id of ids) {
    const p = personById[id];
    nodes.push(nodeObj(id, { kind: "person", ref: p, color: colorOf(p), size: sizeOf(p) }));
  }

  if (state.view === "players") {
    const pairs = new Map();
    for (const s of data.seasons) {
      if (!on(s.id)) continue;
      const cast = castOf[s.id].filter((id) => ids.has(id));
      for (let i = 0; i < cast.length; i++) {
        for (let j = i + 1; j < cast.length; j++) {
          const key = linkKey(cast[i], cast[j]);
          if (!pairs.has(key)) {
            // Light flows from the earlier debut to the later one.
            const [x, y] = personById[cast[i]].debut <= personById[cast[j]].debut ? [cast[i], cast[j]] : [cast[j], cast[i]];
            pairs.set(key, { source: x, target: y, key, kind: "mates", seasons: [] });
          }
          pairs.get(key).seasons.push(s.id);
        }
      }
    }
    for (const l of pairs.values()) {
      const showsShared = new Set(l.seasons.map((s) => seasonById[s].show));
      l.color = showsShared.size > 1 ? theme.gold : showById[[...showsShared][0]].color;
      links.push(l);
    }
  } else {
    const seasonsUsed = new Set();
    for (const id of ids) {
      for (const a of personById[id].apps) {
        if (!on(a.season)) continue;
        seasonsUsed.add(a.season);
        links.push({ source: `season:${a.season}`, target: id, key: `${id}>${a.season}`, kind: "played", color: showById[seasonById[a.season].show].color });
      }
    }
    const showsUsed = new Set([...seasonsUsed].map((s) => seasonById[s].show));
    for (const sid of showsUsed) nodes.push(nodeObj(`show:${sid}`, { kind: "show", ref: showById[sid], color: showById[sid].color, size: 16 }));
    for (const sid of seasonsUsed) {
      const s = seasonById[sid];
      nodes.push(nodeObj(`season:${sid}`, { kind: "season", ref: s, color: showById[s.show].color, size: 6 }));
      links.push({ source: `show:${s.show}`, target: `season:${sid}`, key: `spine:${sid}`, kind: "spine", color: showById[s.show].color });
    }
  }

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  for (const n of nodes) { n.neighbors = new Set(); n.links = new Set(); }
  for (const l of links) {
    const a = byId[l.source], b = byId[l.target];
    a.neighbors.add(b); b.neighbors.add(a);
    a.links.add(l); b.links.add(l);
  }
  // Importance within this view decides how big a name is and how soon it shows.
  const persons = nodes.filter((n) => n.kind === "person")
    .sort((a, b) => (b.neighbors.size + b.ref.titles * 4 + b.ref.apps.length * 2) - (a.neighbors.size + a.ref.titles * 4 + a.ref.apps.length * 2));
  persons.forEach((n, i) => { n.rank = persons.length <= 40 ? 0 : i < 8 ? 0 : i < 32 ? 1 : 2; });
  for (const n of nodes) if (n.kind !== "person") n.rank = 0;
  return { nodes, links };
}

const weak = (l) => state.view === "players" && state.strong && l.kind === "mates" && l.seasons.length < 2;

// ---------- Highlighting ----------
const lit = { nodes: new Set(), links: new Set(), path: false };
const isLink = (t) => !!t && (t.kind === "mates" || t.kind === "played" || t.kind === "spine");

function computeLit() {
  lit.nodes.clear();
  lit.links.clear();
  lit.path = false;
  const { nodes, links } = graph.graphData();
  const target = state.hover ?? (state.selected?.neighbors || isLink(state.selected) ? state.selected : null);
  if (isLink(target)) {
    lit.links.add(target);
    lit.nodes.add(target.source);
    lit.nodes.add(target.target);
    return;
  }
  if (target) {
    lit.nodes.add(target);
    for (const n of target.neighbors) lit.nodes.add(n);
    for (const l of target.links) lit.links.add(l);
    return;
  }
  if (state.path && state.path.length > 1) {
    lit.path = true;
    const ids = new Set(state.path);
    for (const n of nodes) if (ids.has(n.id)) lit.nodes.add(n);
    if (state.view === "players") {
      const want = new Set(state.path.slice(1).map((id, i) => linkKey(state.path[i], id)));
      for (const l of links) if (want.has(l.key)) lit.links.add(l);
    } else {
      for (let i = 1; i < state.path.length; i++) {
        const s = together(state.path[i - 1], state.path[i])[0];
        for (const l of links) {
          if (l.key === `${state.path[i - 1]}>${s}` || l.key === `${state.path[i]}>${s}`) {
            lit.links.add(l);
            lit.nodes.add(l.source);
          }
        }
      }
    }
    return;
  }
  // Comparing players: light them and the co-players they have in common.
  if (state.compare.length >= 2) {
    const ids = new Set([...state.compare, ...commonMates(state.compare)]);
    for (const n of nodes) if (ids.has(n.id)) lit.nodes.add(n);
    const pick = new Set(state.compare);
    for (const l of links) {
      const a = l.source.id ?? l.source, b = l.target.id ?? l.target;
      if ((pick.has(a) && ids.has(b)) || (pick.has(b) && ids.has(a))) lit.links.add(l);
    }
  }
}

function commonMates(ids) {
  const sets = ids.map((id) => new Set(adjacency[id].keys()));
  return [...sets[0]].filter((x) => !ids.includes(x) && sets.every((st) => st.has(x)));
}

const anyLit = () => lit.nodes.size > 0;
const dimmed = (n) => anyLit() && !lit.nodes.has(n);

// ---------- Drawing: glowing nodes ----------
const REL = 3.2;
const radius = (n) => Math.cbrt(n.size) * REL;
const sphere = new SphereGeometry(1, 24, 18);

function canvasTexture(draw, px = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  draw(c.getContext("2d"), px);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
const glowTex = canvasTexture((g, px) => {
  const grd = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.18, "rgba(255,255,255,.55)");
  grd.addColorStop(0.5, "rgba(255,255,255,.12)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, px, px);
});
const ringTex = canvasTexture((g, px) => {
  g.strokeStyle = "#fff";
  g.lineWidth = px * 0.06;
  g.beginPath();
  g.arc(px / 2, px / 2, px * 0.42, 0, Math.PI * 2);
  g.stroke();
});
const noPick = (o) => { o.raycast = () => {}; return o; };

function photoTexture(node) {
  const px = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext("2d");
    const ring = 8;
    ctx.save();
    ctx.beginPath();
    ctx.arc(px / 2, px / 2, px / 2 - ring / 2, 0, Math.PI * 2);
    ctx.clip();
    const scale = Math.max(px / img.width, px / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, (px - w) / 2, Math.min(0, (px - h) * 0.25), w, h);
    ctx.restore();
    ctx.lineWidth = ring;
    ctx.strokeStyle = node.color;
    ctx.beginPath();
    ctx.arc(px / 2, px / 2, px / 2 - ring / 2, 0, Math.PI * 2);
    ctx.stroke();
    texture.needsUpdate = true;
  };
  img.src = node.ref.photo;
  return texture;
}

const LABEL_SIZES = [5.2, 3.6, 2.8];

function makeNode(n) {
  const r = radius(n);
  const g = new Group();
  const parts = {};
  const halo = noPick(new Sprite(new SpriteMaterial({
    map: glowTex, color: n.color, transparent: true, depthWrite: false,
    blending: dark ? AdditiveBlending : NormalBlending, opacity: 0,
  })));
  halo.scale.setScalar(r * (n.kind === "show" ? 6 : 4.2));
  parts.halo = halo;
  g.add(halo);

  if (n.kind === "person" && n.ref.photo) {
    const pic = new Sprite(new SpriteMaterial({ map: photoTexture(n), transparent: true, depthWrite: false, opacity: 0 }));
    pic.scale.setScalar(r * 2.5);
    parts.core = pic;
    g.add(pic);
  } else {
    const core = new Mesh(sphere, new MeshStandardMaterial({
      color: n.color, emissive: new Color(n.color), emissiveIntensity: dark ? 0.32 : 0.12,
      roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0,
    }));
    core.scale.setScalar(r);
    parts.core = core;
    g.add(core);
  }

  if (n.kind === "person" && n.ref.titles) {
    const ring = noPick(new Sprite(new SpriteMaterial({ map: ringTex, color: theme.gold, transparent: true, depthWrite: false, opacity: 0 })));
    ring.scale.setScalar(r * 3.1);
    parts.ring = ring;
    g.add(ring);
  }

  const text = n.kind === "season" ? n.ref.name : plain(n.ref.name);
  const label = noPick(new SpriteText(text));
  label.fontFace = "Inter, system-ui, sans-serif";
  label.fontWeight = n.kind === "person" ? "600" : "700";
  label.color = n.kind === "person" ? theme.ink : n.color;
  label.textHeight = n.kind === "show" ? 8 : n.kind === "season" ? 3.8 : LABEL_SIZES[n.rank ?? 2];
  label.center.y = -0.55 - r * 0.09;
  label.material.depthWrite = false;
  label.material.transparent = true;
  label.material.opacity = 0;
  if (dark) label.strokeWidth = 0;
  parts.label = label;
  g.add(label);

  parts.color = n.color;
  parts.size = n.size;
  n.parts = parts;
  n.labelSize = label.textHeight;
  return g;
}

// Recolor and resize a node that already exists, when the measures change.
function applyLook(n) {
  const p = n.parts;
  if (!p || (p.color === n.color && p.size === n.size)) return;
  const r = radius(n);
  p.halo.material.color.set(n.color);
  p.halo.scale.setScalar(r * (n.kind === "show" ? 6 : 4.2));
  if (p.core.isMesh) {
    p.core.material.color.set(n.color);
    p.core.material.emissive.set(n.color);
    p.core.scale.setScalar(r);
  } else {
    p.core.scale.setScalar(r * 2.5);
  }
  if (p.ring) p.ring.scale.setScalar(r * 3.1);
  p.label.center.y = -0.55 - r * 0.09;
  p.color = n.color;
  p.size = n.size;
}

// ---------- The graph ----------
const graph = new ForceGraph3D(el, { controlType: "orbit", rendererConfig: { antialias: true, alpha: false, preserveDrawingBuffer: true } })
  .backgroundColor(theme.bg)
  .showNavInfo(false)
  .numDimensions(state.dims)
  .nodeVal((n) => n.size)
  .nodeRelSize(REL)
  .nodeThreeObject(makeNode)
  .nodeLabel((n) => {
    if (n.kind !== "person") return `<div class="net-tip"><b>${esc(n.kind === "season" ? n.ref.full : n.ref.name)}</b></div>`;
    const p = n.ref;
    return `<div class="net-tip"><b>${esc(p.name)}</b>${p.known ? `<br>${esc(p.known)}` : ""}<br>${p.apps.length} season${p.apps.length > 1 ? "s" : ""}${p.titles ? `, ${p.titles} title${p.titles > 1 ? "s" : ""}` : ""} · ${tierOf(p).name}</div>`;
  })
  .linkVisibility((l) => !weak(l) || lit.links.has(l))
  .linkCurvature((l) => (l.kind === "mates" ? 0.18 : 0))
  .linkCurveRotation((l) => (l.key.length % 7) / 7 * Math.PI)
  .linkOpacity(1)
  .linkColor((l) => {
    if (lit.links.has(l)) return lit.path ? theme.gold : rgba(l.color, 0.95);
    if (anyLit()) return rgba(theme.muted, 0.05);
    const w = l.kind === "mates" ? Math.min(l.seasons.length, 4) : 2;
    return rgba(l.kind === "mates" && l.seasons.length < 2 ? theme.muted : l.color, dark ? 0.1 + w * 0.09 : 0.12 + w * 0.08);
  })
  .linkWidth((l) => (lit.links.has(l) ? (l.kind === "mates" ? 0.6 + l.seasons.length * 0.45 : 1) : l.kind === "mates" && l.seasons.length >= 3 ? 0.5 : 0))
  .linkDirectionalParticles((l) => {
    if (reduceMotion) return 0;
    if (lit.links.has(l)) return 4;
    if (anyLit() || weak(l)) return 0;
    return l.kind === "mates" ? Math.min(l.seasons.length - 1, 3) : 0;
  })
  .linkDirectionalParticleSpeed((l) => (lit.links.has(l) ? 0.009 : 0.0028))
  .linkDirectionalParticleWidth((l) => (lit.links.has(l) ? 2.2 : 1.3))
  .linkDirectionalParticleColor((l) => (lit.path ? theme.gold : l.color))
  .linkLabel((l) => {
    if (l.kind !== "mates") return "";
    const a = l.source.id ?? l.source, b = l.target.id ?? l.target;
    const { score } = headToHead(a, b);
    const decided = score[a] + score[b] + score.tie;
    return `<div class="net-tip"><b>${esc(plain(personById[a].name))} &amp; ${esc(plain(personById[b].name))}</b><br>${l.seasons.map((s) => esc(seasonById[s].full)).join("<br>")}${decided ? `<br><i>Head to head ${score[a]}–${score[b]}</i>` : ""}</div>`;
  })
  .onNodeHover((node) => setHover(node))
  .onLinkHover((link) => setHover(link && link.kind === "mates" ? link : null))
  .onNodeClick((node, event) => {
    state.stepFrom = null;
    if (event?.shiftKey && node.kind === "person") toggleCompare(node.id);
    else select(node, true);
  })
  .onLinkClick((link) => link.kind === "mates" && select(link))
  .onBackgroundClick(() => clearSelection())
  .d3VelocityDecay(0.32)
  .cooldownTime(5000)
  .onEngineStop(() => {
    state.settled = true;
    const fn = state.after;
    state.after = null;
    if (fn) fn();
  });

// A faint field of stars far behind everything.
if (dark) {
  const pts = [];
  for (let i = 0; i < 1400; i++) {
    const v = new Vector3().randomDirection().multiplyScalar(1600 + Math.random() * 1800);
    pts.push(v.x, v.y, v.z);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
  const stars = new Points(geo, new PointsMaterial({ color: theme.muted, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false }));
  stars.name = "stars";
  graph.scene().add(stars);
}

// ---------- Layouts ----------
const yearX = (y) => (y - (FIRST + LAST) / 2) * 62;
const nodeYear = (n) => (n.kind === "person" ? n.ref.debut : n.kind === "season" ? n.ref.year : n.ref.debut);

const decor = new Group();
graph.scene().add(decor);

function clearDecor() {
  for (const c of [...decor.children]) {
    decor.remove(c);
    c.geometry?.dispose?.();
    c.material?.dispose?.();
  }
}

function addGuideText(text, x, y, size, color = theme.muted, opacity = 0.7) {
  const s = noPick(new SpriteText(text));
  s.fontFace = "Inter, system-ui, sans-serif";
  s.fontWeight = "700";
  s.color = color;
  s.textHeight = size;
  s.material.transparent = true;
  s.material.opacity = opacity;
  s.material.depthWrite = false;
  s.position.set(x, y, 0);
  decor.add(s);
}

function drawGuides() {
  clearDecor();
  if (state.layout === "rings" && state.view === "players") {
    for (const t of TIERS) {
      const pts = [];
      for (let i = 0; i < 128; i++) {
        const a = (i / 128) * Math.PI * 2;
        pts.push(Math.cos(a) * t.r, Math.sin(a) * t.r, 0);
      }
      const geo = new BufferGeometry();
      geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
      decor.add(noPick(new LineLoop(geo, new LineBasicMaterial({ color: theme.muted, transparent: true, opacity: 0.18 }))));
      addGuideText(`${t.name}s`.replace("One seasons", "One season"), 0, t.r + 12, 13, theme.muted, 0.8);
    }
  }
  if (state.layout === "flow") {
    const pts = [yearX(FIRST) - 30, -230, 0, yearX(LAST) + 30, -230, 0];
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
    decor.add(noPick(new LineLoop(geo, new LineBasicMaterial({ color: theme.muted, transparent: true, opacity: 0.3 }))));
    for (let y = FIRST; y <= LAST; y++) addGuideText(String(y), yearX(y), -252, y === FIRST || y === LAST || y % 2 === 1 ? 14 : 10, theme.muted, 0.85);
  }
}

function applyLayout() {
  const L = state.layout;
  graph.d3Force("charge").strength((n) => (n.kind === "show" ? -300 : n.kind === "season" ? -100 : L === "web" ? -40 : -22));
  graph.d3Force("radial", null);
  if (L === "web") {
    for (const [name, f] of [["x", forceX], ["y", forceY], ["z", forceZ]]) graph.d3Force(name, f(0).strength(0.04));
  } else if (L === "rings") {
    graph.d3Force("radial", forceRadial((n) => (n.kind === "person" ? tierOf(n.ref).r : n.kind === "show" ? 0 : 30), 0, 0, 0).strength(0.85));
    graph.d3Force("x", null);
    graph.d3Force("y", null);
    graph.d3Force("z", forceZ(0).strength(0.6));
  } else {
    graph.d3Force("x", forceX((n) => yearX(nodeYear(n))).strength(1));
    graph.d3Force("y", forceY(0).strength(0.06));
    graph.d3Force("z", forceZ(0).strength(0.25));
  }
  graph.d3Force("link")
    .distance((l) => (l.kind === "spine" ? 34 : l.kind === "mates" ? 38 - Math.min(l.seasons.length, 4) * 5 : 24))
    .strength((l) => {
      const base = 1 / Math.min(l.source.neighbors?.size || 1, l.target.neighbors?.size || 1);
      const k = L === "web" ? 1 : L === "rings" ? 0.35 : 0.06;
      return (weak(l) ? base * 0.15 : base) * k;
    });
  drawGuides();
  const hints = {
    web: "Players pulled together by the seasons they shared.",
    rings: "Legends at the center (2+ titles or 3+ shows), then crossovers, veterans, and one-season players outside.",
    flow: "Left to right by debut year. Lines arc forward in time from the earlier debut.",
  };
  $("layout-hint").textContent = hints[L];
}

// ---------- Nebulae: a soft cloud behind each show's cluster ----------
const nebulae = new Map();
function syncNebulae() {
  for (const n of nebulae.values()) graph.scene().remove(n.glow);
  nebulae.clear();
  if (state.view !== "players" || state.layout !== "web") return;
  const members = {};
  for (const n of graph.graphData().nodes) (members[n.ref.primary] ??= []).push(n);
  for (const [sid, list] of Object.entries(members)) {
    if (list.length < 3) continue;
    const glow = noPick(new Sprite(new SpriteMaterial({ map: glowTex, color: showById[sid].color, transparent: true, depthWrite: false, opacity: 0, blending: dark ? AdditiveBlending : NormalBlending })));
    graph.scene().add(glow);
    nebulae.set(sid, { glow, list });
  }
}

// ---------- Animation: everything eases toward its target ----------
const camPos = new Vector3();
const tmp = new Vector3();
let lastFrame = performance.now();

function targets(n) {
  const hovered = state.hover === n;
  const selected = state.selected === n;
  const dim = dimmed(n);
  return {
    alpha: dim ? 0.1 : 1,
    scale: hovered ? 1.4 : selected ? 1.3 : 1,
    halo: dim ? 0.02 : lit.nodes.has(n) ? 0.75 : n.kind === "person" ? (n.rank === 0 ? 0.5 : n.rank === 1 ? 0.34 : 0.22) : 0.42,
  };
}

function labelWanted(n, dist) {
  if (lit.nodes.has(n)) return dimmed(n) ? 0 : 1;
  if (anyLit()) return 0;
  if (n.kind !== "person") return 1;
  // Semantic zoom: legends always, the next tier as you come closer, everyone up close.
  const reach = [Infinity, 520, 230][n.rank ?? 2];
  return dist < reach ? 1 : 0;
}

function animate(now) {
  const dt = Math.min(64, now - lastFrame);
  lastFrame = now;
  const k = 1 - Math.pow(0.001, dt / 450); // ease factor
  graph.camera().getWorldPosition(camPos);
  const { nodes } = graph.graphData();
  for (const n of nodes) {
    const p = n.parts;
    if (!p) continue;
    const t = targets(n);
    const a = n.anim;
    a.alpha += (t.alpha - a.alpha) * k;
    a.scale += (t.scale - a.scale) * k;
    tmp.set(n.x || 0, n.y || 0, n.z || 0);
    const want = labelWanted(n, camPos.distanceTo(tmp));
    a.label += (want - a.label) * k;
    p.core.material.opacity = a.alpha;
    p.halo.material.opacity = t.halo * a.alpha;
    if (p.ring) p.ring.material.opacity = a.alpha * 0.95;
    p.label.material.opacity = a.label * Math.max(a.alpha, 0.15);
    p.label.visible = a.label > 0.02;
    const obj = n.__threeObj;
    if (obj) obj.scale.setScalar(a.scale);
  }
  // Nebulae follow their clusters.
  for (const neb of nebulae.values()) {
    let cx = 0, cy = 0, cz = 0;
    for (const n of neb.list) { cx += n.x || 0; cy += n.y || 0; cz += n.z || 0; }
    const c = neb.list.length;
    cx /= c; cy /= c; cz /= c;
    let spread = 0;
    for (const n of neb.list) spread = Math.max(spread, Math.hypot((n.x || 0) - cx, (n.y || 0) - cy, (n.z || 0) - cz));
    neb.glow.position.set(cx, cy, cz - 10);
    neb.glow.scale.setScalar(Math.max(70, spread * 2.4));
    const show = anyLit() ? 0 : dark ? 0.05 : 0.05;
    neb.glow.material.opacity += (show - neb.glow.material.opacity) * k;
  }
  const stars = graph.scene().getObjectByName("stars");
  if (stars && !reduceMotion) stars.rotation.y += dt * 0.000008;
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// Drift slowly when nobody is touching it.
let idleTimer = null;
function wake() {
  const c = graph.controls();
  if (c) c.autoRotate = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (reduceMotion || state.dims === 2 || state.layout === "flow" || state.selected || state.path) return;
    const ctl = graph.controls();
    if (ctl) { ctl.autoRotate = true; ctl.autoRotateSpeed = 0.35; }
  }, 9000);
}
for (const ev of ["pointerdown", "wheel", "keydown", "touchstart"]) el.addEventListener(ev, wake, { passive: true });

function setHover(target) {
  el.style.cursor = target ? "pointer" : "";
  if (target === state.hover) return;
  state.hover = target;
  refresh();
}

function refresh() {
  computeLit();
  graph.linkColor(graph.linkColor()).linkWidth(graph.linkWidth())
    .linkVisibility(graph.linkVisibility()).linkDirectionalParticles(graph.linkDirectionalParticles());
}

const nodeFor = (id) => graph.graphData().nodes.find((n) => n.id === id) ?? null;
const fit = (ms = 900) => graph.zoomToFit(ms, narrow() ? 20 : 50);

function render(after) {
  state.hover = null;
  const keepId = state.selected?.kind === "person" ? state.selected.id : null;
  state.settled = false;
  state.after = after === undefined ? () => fit() : after;
  const built = build();
  for (const n of built.nodes) applyLook(n);
  // Labels resize with their importance in the new view.
  for (const n of built.nodes) {
    if (n.parts && n.kind === "person") {
      const size = LABEL_SIZES[n.rank ?? 2];
      if (n.labelSize !== size) { n.parts.label.textHeight = size; n.labelSize = size; }
    }
  }
  graph.graphData(built);
  applyLayout();
  syncNebulae();
  state.selected = keepId ? nodeFor(keepId) : null;
  refresh();
  updateActive();
  updateCount();
  if (state.list) renderList();
  updateKey();
  writeUrl();
  wake();
}

function updateCount() {
  const { nodes, links } = graph.graphData();
  const people = nodes.filter((n) => n.kind === "person").length;
  const shown = links.filter((l) => !weak(l)).length;
  $("count").textContent = state.view === "players"
    ? `${people} players · ${shown} connection${shown === 1 ? "" : "s"}${shown < links.length ? ` shown of ${links.length}` : ""}${state.year < LAST ? ` · up to ${state.year}` : ""}`
    : `${people} players · ${nodes.filter((n) => n.kind === "season").length} seasons${state.year < LAST ? ` · up to ${state.year}` : ""}`;
}

// ---------- Camera ----------
function flyTo(node) {
  const dist = node.kind === "show" ? 300 : 230;
  const cam = graph.cameraPosition();
  const nz = state.dims === 2 ? 0 : node.z || 0;
  const d = state.dims === 2 || state.layout !== "web" ? { x: 0, y: 0, z: 1 } : { x: cam.x - node.x, y: cam.y - node.y, z: cam.z - nz };
  const len = Math.hypot(d.x, d.y, d.z) || 1;
  let look = { x: node.x, y: node.y, z: nz };
  if (narrow()) {
    const up = new Vector3(0, 1, 0).applyQuaternion(graph.camera().quaternion);
    const shift = dist * 0.22;
    look = { x: look.x - up.x * shift, y: look.y - up.y * shift, z: look.z - up.z * shift };
  }
  graph.cameraPosition(
    { x: look.x + (d.x / len) * dist, y: look.y + (d.y / len) * dist, z: look.z + (d.z / len) * dist },
    look,
    1100
  );
}
const whenSettled = (fn) => (state.settled ? fn() : (state.after = fn));

// ---------- Selection and panels ----------
const info = $("info");
const body = $("info-body");

function select(target, fly = false) {
  state.selected = target;
  refresh();
  wake();
  if (!target) return hideInfo();
  if (target.kind === "person") personPanel(target.ref);
  else if (target.kind === "mates") pairPanel(target.source.id, target.target.id);
  else seasonOrShowPanel(target);
  if (fly && !isLink(target)) flyTo(target);
  writeUrl();
}

function clearSelection() {
  state.selected = null;
  refresh();
  if (state.path) pathPanel(state.path);
  else hideInfo();
  writeUrl();
}

function hideInfo() {
  info.hidden = true;
}

function showInfo(html) {
  body.innerHTML = html;
  info.hidden = false;
  info.scrollTop = 0;
}

// A career on one line: a dot for each season, gold for a title.
function careerStrip(people) {
  const W = 300, rowH = 22, H = people.length * rowH + 16;
  const x = (y) => 10 + ((y - FIRST) / Math.max(1, LAST - FIRST)) * (W - 20);
  const rows = people.map((p, i) => {
    const y0 = 10 + i * rowH;
    const perYear = {};
    const dots = p.apps.map((a) => {
      const s = seasonById[a.season];
      const k = (perYear[s.year] = (perYear[s.year] ?? 0) + 1) - 1;
      const cx = x(s.year) + k * 7;
      const fill = showById[s.show].color;
      return `<circle cx="${cx}" cy="${y0}" r="${a.won ? 5.5 : 4.5}" fill="${fill}" ${a.won ? `stroke="${theme.gold}" stroke-width="2"` : ""} ${s.upcoming ? 'fill-opacity=".35" stroke-dasharray="2 2" stroke="' + fill + '"' : ""}><title>${esc(s.full)}: ${esc(a.result || (s.upcoming ? "Announced" : "Played"))}</title></circle>`;
    }).join("");
    const name = people.length > 1 ? `<text x="0" y="${y0 - 8}">${esc(plain(p.name))}</text>` : "";
    return `<line x1="10" x2="${W - 10}" y1="${y0}" y2="${y0}" stroke="${theme.line}" stroke-width="1"/>${name}${dots}`;
  }).join("");
  const axis = `<text x="10" y="${H}">${FIRST}</text><text x="${W / 2}" y="${H}" text-anchor="middle">${Math.round((FIRST + LAST) / 2)}</text><text x="${W - 10}" y="${H}" text-anchor="end">${LAST}</text>`;
  return `<svg class="strip" viewBox="0 -6 ${W} ${H + 8}" role="img" aria-label="Career timeline">${rows}${axis}</svg>`;
}

function recordList(p) {
  return `<ul class="rec">${p.apps.map((a) => {
    const s = seasonById[a.season];
    return `<li style="--c:${showById[s.show].color}"><span>${esc(s.full)}</span><span class="r${a.won ? " won" : ""}">${esc(a.result || (s.upcoming ? "Announced" : "Played"))}</span></li>`;
  }).join("")}</ul>`;
}

function mateButtons(list, limit) {
  return list.slice(0, limit).map(([id, n]) => {
    const m = personById[id];
    return `<button type="button" class="mate${crossShow(m) ? " cross" : ""}" data-go="${id}">${esc(plain(m.name))}${n > 1 ? ` <b>${n}</b>` : ""}</button>`;
  }).join("");
}

function personPanel(p) {
  const list = [...mates(p.id).entries()].sort((a, b) => b[1] - a[1] || personById[a[0]].name.localeCompare(personById[b[0]].name));
  const repeat = list.filter(([, n]) => n > 1);
  const LIMIT = 40;
  showInfo(`
    <div class="eyebrow">${crossShow(p) ? "Cross-show veteran" : p.apps.length > 1 ? "Veteran" : "Player"}<span class="tier">${tierOf(p).name}</span></div>
    ${p.photo ? `<img class="pic" src="${esc(p.photo)}" alt="">` : ""}
    <h2>${esc(p.name)}</h2>${p.ko ? `<div class="ko" lang="ko">${esc(p.ko)}</div>` : ""}
    ${p.known ? `<div class="muted">${esc(p.known)}</div>` : ""}
    <div class="stat">${p.apps.length} season${p.apps.length > 1 ? "s" : ""} · ${p.showIds.length} show${p.showIds.length > 1 ? "s" : ""}${p.titles ? ` · ${p.titles} title${p.titles > 1 ? "s" : ""}` : ""} · played with ${list.length} (#${connectedRank[p.id]} most connected)</div>
    <div class="stat">${bridging[p.id] > 0.001 ? `Bridge #${bridgeRank[p.id]}: on ${Math.round(bridging[p.id] * 100)}% as many shortest chains as the top bridge` : "Not on any shortest chain between others"} · Family: <button type="button" class="link" data-family="${families.of[p.id].id}" style="color:${families.of[p.id].color}">${esc(families.of[p.id].name)}</button></div>
    ${careerStrip([p])}
    <div class="acts">
      <button type="button" class="act" data-circle="${p.id}">${state.ego === p.id ? "Back to everyone" : "Show their circle"}</button>
      <button type="button" class="act ghost" data-from="${p.id}">Connect from here</button>
      <button type="button" class="act ghost" data-compare="${p.id}">${state.compare.includes(p.id) ? "Remove from compare" : "Compare"}</button>
      <a class="act ghost" href="/contestants/${p.id}/">Bio</a>
    </div>
    <p class="muted" style="font-size:12px;margin:8px 0 0">Tip: ← → step through their strongest connections. Shift-click players to compare.</p>
    <h3>Survival record</h3>
    ${recordList(p)}
    ${repeat.length ? `<h3>Played with more than once</h3><div class="mates">${mateButtons(repeat, LIMIT)}</div>` : ""}
    <h3>Everyone they played with</h3>
    <div class="mates" id="all-mates">${mateButtons(list, LIMIT)}</div>
    ${list.length > LIMIT ? `<p><button type="button" class="link" id="more-mates">Show all ${list.length}</button></p>` : ""}
  `);
  $("more-mates")?.addEventListener("click", (e) => {
    $("all-mates").innerHTML = mateButtons(list, list.length);
    e.target.remove();
  });
}

function pairPanel(a, b) {
  const pa = personById[a], pb = personById[b];
  const { rows, score } = headToHead(a, b);
  const decided = score[a] + score[b] + score.tie;
  const na = esc(plain(pa.name)), nb = esc(plain(pb.name));
  let verdict = "";
  if (decided) {
    verdict = score[a] === score[b]
      ? `Level at ${score[a]}–${score[b]}`
      : `<span class="gold">${score[a] > score[b] ? na : nb}</span> leads ${Math.max(score[a], score[b])}–${Math.min(score[a], score[b])}`;
    if (score.tie) verdict += `, ${score.tie} tied`;
  }
  const res = (p, sid) => esc(appOf(p.id, sid)?.result || (seasonById[sid].upcoming ? "Announced" : "Played"));
  showInfo(`
    <div class="eyebrow">Head to head</div>
    <h2>${na} &amp; ${nb}</h2>
    <div class="stat">${rows.length} season${rows.length > 1 ? "s" : ""} together${decided < rows.length ? ` · ${rows.length - decided} without a placement for both` : ""}</div>
    ${verdict ? `<div class="score">${verdict}</div>` : ""}
    ${careerStrip([pa, pb])}
    <ul>${rows.map(({ sid, better }) => {
      const s = seasonById[sid];
      return `<li class="hop"><span><span class="chip" style="--show:${showById[s.show].color}">${esc(s.full)}</span></span>
        <span class="muted"><span class="${better === a ? "better" : ""}">${na}: ${res(pa, sid)}</span> · <span class="${better === b ? "better" : ""}">${nb}: ${res(pb, sid)}</span></span></li>`;
    }).join("")}</ul>
    <div class="acts">
      <button type="button" class="act ghost" data-go="${a}">${na}</button>
      <button type="button" class="act ghost" data-go="${b}">${nb}</button>
    </div>
  `);
}

function seasonOrShowPanel(node) {
  const isSeason = node.kind === "season";
  const show = isSeason ? showById[node.ref.show] : node.ref;
  const cast = isSeason ? castOf[node.ref.id] : data.people.filter((p) => p.showIds.includes(show.id)).map((p) => p.id);
  const vets = cast.filter((id) => crossShow(personById[id]));
  showInfo(`
    <div class="eyebrow">${isSeason ? "Season" : "Show"}</div>
    <h2>${esc(isSeason ? node.ref.full : show.name)}</h2>
    <div class="muted">${esc(show.network)} · ${esc(isSeason ? node.ref.aired : show.years)}</div>
    <div class="stat">${cast.length} players on the site${vets.length ? `, ${vets.length} also on other shows` : ""}</div>
    <div class="acts">
      ${isSeason ? `<button type="button" class="act" data-group="${node.ref.id}">Show this cast</button>` : `<button type="button" class="act" data-only="${show.id}">Only this show</button>`}
      <a class="act ghost" href="/shows/${show.id}/${isSeason ? `#${node.ref.id}` : ""}">Open</a>
    </div>
    ${vets.length ? `<h3>Also on other shows</h3><div class="mates">${mateButtons(vets.map((id) => [id, 1]), 60)}</div>` : ""}
  `);
}

function pathPanel(path) {
  const a = personById[path[0]], b = personById[path.at(-1)];
  const hops = path.slice(1).map((id, i) => {
    const prev = path[i];
    return `<li class="hop"><span class="who">${esc(plain(personById[prev].name))} → ${esc(plain(personById[id].name))}</span>
      <span>${together(prev, id).map((sid) => `<span class="chip" style="--show:${showById[seasonById[sid].show].color}">${esc(seasonById[sid].full)}${seasonById[sid].upcoming ? " (announced)" : ""}</span>`).join("")}</span></li>`;
  }).join("");
  const steps = path.length - 1;
  showInfo(`
    <div class="eyebrow">Connection</div>
    <h2>${esc(plain(a.name))} to ${esc(plain(b.name))}</h2>
    <div class="stat">${steps === 1 ? "They played together directly." : `${steps} steps apart, through ${steps - 1} other player${steps - 1 > 1 ? "s" : ""}.`}</div>
    ${careerStrip(path.map((id) => personById[id]))}
    <ul>${hops}</ul>
    <div class="acts"><button type="button" class="act ghost" data-clear-path>Clear</button></div>
  `);
}

function noPathPanel(a, b) {
  showInfo(`
    <div class="eyebrow">Connection</div>
    <h2>${esc(plain(personById[a].name))} to ${esc(plain(personById[b].name))}</h2>
    <p class="muted">No chain of co-players links them yet: their worlds have never shared a player.</p>
  `);
}

// One handler for every button that acts on the graph: panel, insights, try chips.
function handleAction(e) {
  const t = e.target.closest("button, a");
  if (!t) return;
  const d = t.dataset;
  if (d.go) { state.stepFrom = null; return focusPerson(d.go); }
  if (d.circle) return toggleCircle(d.circle);
  if (d.from) {
    $("more").open = true;
    setPick("from", d.from);
    $("to").focus();
    return;
  }
  if (d.group) return setGroup(d.group);
  if (d.only) return onlyShow(d.only);
  if (d.path) {
    const [from, to] = d.path.split(":");
    setPick("from", from);
    setPick("to", to);
    return runPath(from, to);
  }
  if (d.compare) return toggleCompare(d.compare);
  if (d.family !== undefined && d.family !== "") return showFamily(+d.family);
  if (d.action) return runAction(d.action);
  if ("clearPath" in d) return clearPath();
}
body.addEventListener("click", handleAction);
$("insights-body").addEventListener("click", handleAction);
document.querySelector(".try").addEventListener("click", handleAction);
$("close").addEventListener("click", () => {
  state.selected = null;
  refresh();
  hideInfo();
  writeUrl();
});

function runAction(action) {
  const [kind, a, b] = action.split(":");
  if (kind === "circle") {
    if (state.ego !== a) toggleCircle(a);
  } else if (kind === "path") {
    setPick("from", a);
    setPick("to", b);
    runPath(a, b);
  } else if (kind === "group") setGroup(a);
  else if (kind === "focus") focusPerson(a);
  else if (kind === "timeline") play();
  else if (kind === "tour") startTour();
}

// ---------- Compare ----------
function toggleCompare(id) {
  const i = state.compare.indexOf(id);
  if (i >= 0) state.compare.splice(i, 1);
  else {
    state.compare.push(id);
    if (state.compare.length > 4) state.compare.shift();
  }
  state.selected = null;
  state.path = null;
  if (state.compare.length >= 2) {
    // Make sure everyone being compared, and what they share, is on screen.
    const need = new Set([...state.compare, ...commonMates(state.compare)]);
    const vis = visiblePeople();
    if ([...need].some((x) => !vis.has(x))) {
      state.group = null;
      state.ego = null;
      state.who = "all";
      setPressed("who", "all");
      state.shows = new Set(data.shows.map((x) => x.id));
      syncChips();
      state.year = LAST;
      syncYear();
    }
    comparePanel(state.compare);
    render(() => {
      refresh();
      const ids = new Set(state.compare);
      graph.zoomToFit(900, 80, (n) => ids.has(n.id));
    });
  } else {
    if (state.compare.length === 1) personPanel(personById[state.compare[0]]);
    else hideInfo();
    render(null);
  }
}

function comparePanel(ids) {
  const people = ids.map((id) => personById[id]);
  const common = commonMates(ids).sort((a, b) => mateCount[b] - mateCount[a]);
  const pairs = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const t = together(ids[i], ids[j]);
    if (t.length) pairs.push([ids[i], ids[j], t]);
  }
  showInfo(`
    <div class="eyebrow">Compare</div>
    <h2>${people.map((p) => esc(plain(p.name))).join(" · ")}</h2>
    <div class="stat">${common.length} co-player${common.length === 1 ? "" : "s"} in common${pairs.length ? ` · ${pairs.length} pair${pairs.length === 1 ? "" : "s"} played together` : " · none of them played together"}</div>
    ${careerStrip(people)}
    <table class="cmp"><thead><tr><th></th>${people.map((p) => `<th>${esc(plain(p.name))}</th>`).join("")}</tr></thead><tbody>
      <tr><td>Seasons</td>${people.map((p) => `<td>${p.apps.length}</td>`).join("")}</tr>
      <tr><td>Shows</td>${people.map((p) => `<td>${p.showIds.length}</td>`).join("")}</tr>
      <tr><td>Titles</td>${people.map((p) => `<td>${p.titles}</td>`).join("")}</tr>
      <tr><td>Played with</td>${people.map((p) => `<td>${mateCount[p.id]}</td>`).join("")}</tr>
      <tr><td>Bridge rank</td>${people.map((p) => `<td>#${bridgeRank[p.id]}</td>`).join("")}</tr>
      <tr><td>Tier</td>${people.map((p) => `<td>${tierOf(p).name}</td>`).join("")}</tr>
    </tbody></table>
    ${pairs.length ? `<h3>Played together</h3><ul>${pairs.map(([a, b, t]) => `<li class="hop"><span class="who">${esc(plain(personById[a].name))} &amp; ${esc(plain(personById[b].name))}</span><span>${t.map((sid) => `<span class="chip" style="--show:${showById[seasonById[sid].show].color}">${esc(seasonById[sid].full)}</span>`).join("")}</span></li>`).join("")}</ul>` : ""}
    ${common.length ? `<h3>Co-players in common</h3><div class="mates">${mateButtons(common.map((id) => [id, 1]), 60)}</div>` : ""}
    <div class="acts">${people.map((p) => `<button type="button" class="act ghost" data-compare="${p.id}">Remove ${esc(plain(p.name))}</button>`).join("")}</div>
  `);
}

function showFamily(i) {
  const f = families.list[i];
  if (!f) return;
  state.colorBy = "family";
  $("color-by").value = "family";
  updateKey();
  state.ego = null;
  state.compare = [];
  state.group = { ids: new Set(f.members), label: `${f.name} family`, except: null };
  state.selected = null;
  render();
  showInfo(`
    <div class="eyebrow">Family</div>
    <h2 style="color:${f.color}">${esc(f.name)}</h2>
    <div class="stat">${f.members.length} players who keep meeting${f.cross ? `, ${f.cross} of them on more than one show` : ""}. Found from the graph itself, not from show labels.</div>
    <h3>Shows they met on</h3>
    <p class="muted">${f.shows.slice(0, 6).map(esc).join(", ")}</p>
    <h3>Members</h3>
    <div class="mates">${mateButtons(f.members.sort((a, b) => mateCount[b] - mateCount[a]).map((id) => [id, 1]), 80)}</div>
  `);
}

// ← → walk through the selected player's strongest connections.
function stepConnection(dir) {
  const cur = state.selected?.kind === "person" ? state.selected.id : null;
  if (!cur) return;
  if (!adjacency[cur].size) return;
  state.stepFrom ??= cur;
  const base = state.stepFrom;
  const order = [...adjacency[base].entries()].sort((a, b) => b[1] - a[1] || mateCount[b[0]] - mateCount[a[0]]).map(([id]) => id);
  const at = order.indexOf(cur);
  const next = order[(at + dir + order.length) % order.length] ?? order[0];
  focusPerson(next);
}

// ---------- Actions ----------
function focusPerson(id) {
  const p = personById[id];
  if (!p) return;
  closeList();
  personPanel(p);
  if (!visiblePeople().has(id)) {
    state.group = null;
    state.ego = null;
    state.year = LAST;
    syncYear();
    if (!p.apps.some((a) => seasonOn(a.season))) {
      state.shows = new Set(data.shows.map((s) => s.id));
      syncChips();
    }
    if (!visiblePeople().has(id)) {
      state.who = "all";
      setPressed("who", "all");
    }
    state.selected = null;
    render(() => { const n = nodeFor(id); if (n) select(n, true); });
    return;
  }
  whenSettled(() => { const n = nodeFor(id); if (n) select(n, true); });
}

function toggleCircle(id) {
  state.ego = state.ego === id ? null : id;
  state.group = null;
  state.selected = null;
  render(() => {
    fit();
    const n = nodeFor(id);
    if (n) select(n);
  });
  personPanel(personById[id]);
}

function setGroup(seasonId) {
  const s = seasonById[seasonId];
  if (!s) return;
  state.ego = null;
  state.group = { ids: new Set(castOf[seasonId]), label: `${s.full} cast`, except: seasonId };
  state.selected = null;
  hideInfo();
  render();
}

function onlyShow(showId) {
  state.shows = new Set([showId]);
  syncChips();
  state.group = null;
  state.ego = null;
  render();
}

function runPath(from, to) {
  if (!from || !to) return;
  const path = shortestPath(from, to);
  state.selected = null;
  closeList();
  if (!path) {
    state.path = null;
    render();
    noPathPanel(from, to);
    return;
  }
  state.path = path;
  pathPanel(path);
  render(() => {
    refresh();
    const ids = new Set(path);
    graph.zoomToFit(900, 90, (n) => ids.has(n.id));
  });
}

function clearPath() {
  state.path = null;
  picks.from = picks.to = null;
  $("from").value = $("to").value = "";
  hideInfo();
  render();
}

function updateActive() {
  const tags = [];
  if (state.group) tags.push(["group", `Showing: ${state.group.label}`]);
  if (state.ego) tags.push(["ego", `Circle of ${plain(personById[state.ego].name)}`]);
  if (state.path) tags.push(["path", `Connection: ${plain(personById[state.path[0]].name)} to ${plain(personById[state.path.at(-1)].name)}`]);
  if (state.shows.size < data.shows.length) tags.push(["shows", `${state.shows.size} of ${data.shows.length} shows`]);
  if (state.year < LAST) tags.push(["year", `Seasons up to ${state.year}`]);
  if (state.compare.length) tags.push(["compare", `Comparing ${state.compare.map((id) => plain(personById[id].name)).join(", ")}`]);
  const box = $("active");
  box.hidden = !tags.length;
  box.innerHTML = tags.map(([k, t]) => `<div class="tag"><span>${esc(t)}</span><button type="button" data-clear="${k}" aria-label="Remove">×</button></div>`).join("");
}
$("active").addEventListener("click", (e) => {
  const k = e.target.closest("[data-clear]")?.dataset.clear;
  if (!k) return;
  if (k === "path") return clearPath();
  if (k === "group") state.group = null;
  if (k === "ego") state.ego = null;
  if (k === "shows") { state.shows = new Set(data.shows.map((s) => s.id)); syncChips(); }
  if (k === "year") { stop(); state.year = LAST; syncYear(); }
  if (k === "compare") { state.compare = []; hideInfo(); }
  render();
});

// ---------- Timeline ----------
let timer = null;
function syncYear() {
  $("year").value = state.year;
  $("year-out").textContent = state.year;
}
function stop() {
  clearInterval(timer);
  timer = null;
  $("play").textContent = "▶";
  $("play").setAttribute("aria-label", "Play the timeline");
}
function play() {
  if (timer) return stop();
  state.group = null;
  state.ego = null;
  state.path = null;
  state.selected = null;
  hideInfo();
  state.year = FIRST;
  syncYear();
  $("play").textContent = "❚❚";
  $("play").setAttribute("aria-label", "Pause the timeline");
  const step = () => {
    render(null);
    setTimeout(() => fit(1200), 600);
  };
  step();
  timer = setInterval(() => {
    if (state.year >= LAST) {
      stop();
      return;
    }
    state.year++;
    syncYear();
    step();
  }, 1700);
}
$("play").addEventListener("click", play);
$("year").addEventListener("input", (e) => {
  stop();
  state.year = +e.target.value;
  syncYear();
  render();
});

// ---------- Controls ----------
function setPressed(attr, value) {
  for (const b of document.querySelectorAll(`#controls [data-${attr}]`)) b.setAttribute("aria-pressed", String(b.dataset[attr] === value));
}
for (const b of document.querySelectorAll("#controls [data-view]")) {
  b.addEventListener("click", () => { state.view = b.dataset.view; setPressed("view", state.view); render(); });
}
for (const b of document.querySelectorAll("#controls [data-layout]")) {
  b.addEventListener("click", () => {
    state.layout = b.dataset.layout;
    setPressed("layout", state.layout);
    // Rings and Flow read best face-on.
    if (state.layout !== "web") graph.cameraPosition({ x: 0, y: 0, z: 900 }, { x: 0, y: 0, z: 0 }, 900);
    render();
  });
}
for (const b of document.querySelectorAll("#controls [data-who]")) {
  b.addEventListener("click", () => { state.who = b.dataset.who; setPressed("who", state.who); state.group = null; state.ego = null; render(); });
}

function syncChips() {
  for (const c of document.querySelectorAll(".show-chip")) c.setAttribute("aria-pressed", String(state.shows.has(c.dataset.show)));
}
let chipTimer = null;
for (const c of document.querySelectorAll(".show-chip")) {
  c.addEventListener("click", () => {
    clearTimeout(chipTimer);
    chipTimer = setTimeout(() => {
      const id = c.dataset.show;
      if (state.shows.has(id)) state.shows.delete(id);
      else state.shows.add(id);
      syncChips();
      render();
    }, 230);
  });
  c.addEventListener("dblclick", () => {
    clearTimeout(chipTimer);
    onlyShow(c.dataset.show);
  });
}
$("all-shows").addEventListener("click", () => {
  state.shows = new Set(data.shows.map((s) => s.id));
  syncChips();
  render();
});
$("strong").addEventListener("change", (e) => {
  state.strong = e.target.checked;
  render();
});
$("flat").addEventListener("change", (e) => {
  state.dims = e.target.checked ? 2 : 3;
  graph.numDimensions(state.dims);
  render();
});

$("color-by").addEventListener("change", (e) => { state.colorBy = e.target.value; render(null); updateKey(); });
$("size-by").addEventListener("change", (e) => { state.sizeBy = e.target.value; render(null); });

// A small key for the current coloring.
function updateKey() {
  const box = $("color-key");
  let items = [];
  if (state.colorBy === "tier") items = Object.entries(TIER_COLORS);
  else if (state.colorBy === "debut") items = [[String(FIRST), debutColor(FIRST)], [String(Math.round((FIRST + LAST) / 2)), debutColor((FIRST + LAST) / 2)], [String(LAST), debutColor(LAST)]];
  else if (state.colorBy === "family") {
    // Only the families on screen, biggest first.
    const count = new Map();
    for (const n of graph.graphData().nodes) if (n.kind === "person") count.set(families.of[n.id], (count.get(families.of[n.id]) ?? 0) + 1);
    items = [...count.entries()].filter(([f, c]) => c >= 2 && f.members.length > 1).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([f]) => [f.name, f.color, f.id]);
  }
  box.hidden = !items.length;
  box.innerHTML = items.map(([t, c, fid]) => (fid !== undefined
    ? `<button type="button" class="key-item" data-family="${fid}"><span style="background:${c}"></span>${esc(t)}</button>`
    : `<span class="key-item"><span style="background:${c}"></span>${esc(t)}</span>`)).join("");
}
$("color-key").addEventListener("click", handleAction);

// Save the current view as a picture, with a caption.
$("save-image").addEventListener("click", () => {
  const src = graph.renderer().domElement;
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height + 64;
  const g = out.getContext("2d");
  g.fillStyle = theme.bg;
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(src, 0, 0);
  g.fillStyle = theme.ink;
  g.font = "600 22px Inter, system-ui, sans-serif";
  g.fillText("Survival Universe", 24, src.height + 40);
  g.fillStyle = theme.muted;
  g.font = "16px Inter, system-ui, sans-serif";
  const caption = $("active").innerText.replace(/×/g, "").replace(/\s+/g, " ").trim() || $("count").textContent;
  g.fillText(caption.slice(0, 120), 230, src.height + 40);
  const a = document.createElement("a");
  a.download = "survival-universe.png";
  a.href = out.toDataURL("image/png");
  a.click();
});

// ---------- List view ----------
function renderList() {
  const { nodes, links } = graph.graphData();
  const LIMIT = 400;
  let html;
  if (state.view === "players") {
    const rows = links.filter((l) => !weak(l) || lit.links.has(l))
      .sort((x, y) => y.seasons.length - x.seasons.length || plain(personById[x.source.id ?? x.source].name).localeCompare(plain(personById[y.source.id ?? y.source].name)));
    $("list-title").textContent = `${rows.length} connection${rows.length === 1 ? "" : "s"} in this view`;
    html = `<table><thead><tr><th>Players</th><th>Together</th><th>Head to head</th></tr></thead><tbody>${rows.slice(0, LIMIT).map((l) => {
      const a = l.source.id ?? l.source, b = l.target.id ?? l.target;
      const { score } = headToHead(a, b);
      const decided = score[a] + score[b] + score.tie;
      return `<tr class="pick" data-pair="${a}:${b}"><td><b>${esc(plain(personById[a].name))}</b> &amp; <b>${esc(plain(personById[b].name))}</b></td>
        <td>${l.seasons.map((s) => `<span class="chip" style="--show:${showById[seasonById[s].show].color}">${esc(seasonById[s].full)}</span>`).join("")}</td>
        <td>${decided ? `${score[a]}–${score[b]}` : "–"}</td></tr>`;
    }).join("")}</tbody></table>${rows.length > LIMIT ? `<p class="note">Showing the first ${LIMIT}. Narrow the view to see the rest.</p>` : ""}`;
  } else {
    const people = nodes.filter((n) => n.kind === "person").sort((x, y) => y.ref.apps.length - x.ref.apps.length || x.ref.name.localeCompare(y.ref.name));
    $("list-title").textContent = `${people.length} players in this view`;
    html = `<table><thead><tr><th>Player</th><th>Seasons</th></tr></thead><tbody>${people.slice(0, LIMIT).map((n) => `
      <tr class="pick" data-go-row="${n.id}"><td><b>${esc(n.ref.name)}</b>${n.ref.known ? `<br><span class="muted">${esc(n.ref.known)}</span>` : ""}</td>
      <td>${n.ref.apps.filter((a) => seasonOn(a.season)).map((a) => `<span class="chip" style="--show:${showById[seasonById[a.season].show].color}">${esc(seasonById[a.season].full)}</span>`).join("")}</td></tr>`).join("")}</tbody></table>`;
  }
  $("list-body").innerHTML = html;
}
$("list-body").addEventListener("click", (e) => {
  const row = e.target.closest("tr.pick");
  if (!row) return;
  if (row.dataset.pair) {
    const [a, b] = row.dataset.pair.split(":");
    closeList();
    const link = graph.graphData().links.find((l) => l.key === linkKey(a, b));
    if (link) select(link);
    else pairPanel(a, b);
  } else if (row.dataset.goRow) focusPerson(row.dataset.goRow);
});
function openList() {
  state.list = true;
  $("list").hidden = false;
  renderList();
}
function closeList() {
  state.list = false;
  $("list").hidden = true;
}
$("list-open").addEventListener("click", openList);
$("list-close").addEventListener("click", closeList);

// ---------- Insights ----------
function renderInsights() {
  const connected = Object.entries(mateCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const titled = data.people.filter((p) => p.titles > 1).sort((a, b) => b.titles - a.titles || a.name.localeCompare(b.name));
  const legends = data.people.filter((p) => tierOf(p).name === "Legend").sort((a, b) => b.titles - a.titles || b.apps.length - a.apps.length);

  const bridges = new Map();
  for (const p of data.people) {
    for (let i = 0; i < p.showIds.length; i++) {
      for (let j = i + 1; j < p.showIds.length; j++) {
        const key = [p.showIds[i], p.showIds[j]].sort().join("|");
        if (!bridges.has(key)) bridges.set(key, []);
        bridges.get(key).push(p.id);
      }
    }
  }
  const only = [...bridges.entries()].filter(([, ids]) => ids.length === 1)
    .map(([key, [id]]) => ({ id, shows: key.split("|").map((s) => showById[s].name) }))
    .sort((a, b) => personById[a.id].name.localeCompare(personById[b.id].name));

  const HUB = "hong-jin-ho";
  const { dist } = distances(HUB);
  const counts = [];
  for (const [id, d] of dist) if (id !== HUB) counts[d] = (counts[d] ?? 0) + 1;
  const max = Math.max(...counts.filter(Boolean));
  const furthest = [...dist.entries()].filter(([, d]) => d === counts.length - 1).map(([id]) => id).slice(0, 6);
  const unreachable = data.people.length - dist.size;
  const avg = ([...dist.values()].reduce((s, d) => s + d, 0) / (dist.size - 1)).toFixed(1);

  // Families that cross shows first: they are the ones show labels would never reveal.
  const bigFamilies = families.list.filter((f) => f.members.length > 2).sort((a, b) => b.cross - a.cross || b.members.length - a.members.length).slice(0, 12);
  const loadBearing = Object.entries(bridgeRank).sort((a, b) => a[1] - b[1]).slice(0, 8).map(([id]) => id);
  $("insights-body").innerHTML = `
    <h4>Load-bearing players</h4>
    <p>The most shortest chains between other players run through them. Take one away and the universe drifts apart.</p>
    <ol>${loadBearing.map((id) => `<li><button type="button" class="row-btn" data-go="${id}">${esc(plain(personById[id].name))}</button> <span class="n">${Math.round(bridging[id] * 100)}</span></li>`).join("")}</ol>
    <h4>Hidden families</h4>
    <p>Groups who keep meeting, found from the graph itself rather than show labels.</p>
    <ol>${bigFamilies.map((f) => `<li><button type="button" class="row-btn" data-family="${f.id}"><span style="color:${f.color}">●</span> ${esc(f.name)}</button> <span class="n">${f.members.length}${f.cross ? `, ${f.cross} cross-show` : ""}</span></li>`).join("")}</ol>
    <h4>Legends</h4>
    <p>Two or more titles, or three or more shows. They sit at the center of the Rings layout.</p>
    <ol>${legends.map((p) => `<li><button type="button" class="row-btn" data-go="${p.id}">${esc(plain(p.name))}</button> <span class="n">${p.showIds.length} shows${p.titles ? `, ${p.titles} title${p.titles > 1 ? "s" : ""}` : ""}</span></li>`).join("")}</ol>
    <h4>Most connected</h4>
    <ol>${connected.map(([id, n]) => `<li><button type="button" class="row-btn" data-go="${id}">${esc(plain(personById[id].name))}</button> <span class="n">played with ${n}</span></li>`).join("")}</ol>
    <h4>Most titles</h4>
    <ol>${titled.map((p) => `<li><button type="button" class="row-btn" data-go="${p.id}">${esc(plain(p.name))}</button> <span class="n">${p.titles}</span></li>`).join("")}</ol>
    <h4>Steps from Hong Jin-ho</h4>
    <p>How many co-players separate everyone from the genre's most familiar face. On average: ${avg}.</p>
    <div class="dist">${counts.map((n, d) => (d ? `<div class="bar" style="height:${Math.round((n / max) * 100)}%" title="${n} players at ${d} step${d > 1 ? "s" : ""}"><span>${d}</span></div>` : "")).join("")}</div>
    <div class="dist-gap"></div>
    <p>Furthest away: ${furthest.map((id) => `<button type="button" class="row-btn" data-path="${HUB}:${id}">${esc(plain(personById[id].name))}</button>`).join(", ")}.${unreachable ? ` ${unreachable} players have no link to him at all.` : ""}</p>
    <h4>Only links between shows</h4>
    <p>Pairs of shows joined by a single player.</p>
    <ol>${only.map(({ id, shows: s }) => `<li><button type="button" class="row-btn" data-go="${id}">${esc(plain(personById[id].name))}</button> <span class="n">${esc(s[0])} and ${esc(s[1])}</span></li>`).join("")}</ol>
  `;
}

// ---------- The guided tour ----------
function resetView() {
  stop();
  Object.assign(state, {
    view: "players", layout: "web", who: "veterans", year: LAST, strong: true,
    group: null, ego: null, path: null, selected: null, compare: [], colorBy: "show", sizeBy: "connections", stepFrom: null,
  });
  state.shows = new Set(data.shows.map((x) => x.id));
  setPressed("view", "players");
  setPressed("layout", "web");
  setPressed("who", "veterans");
  syncChips();
  syncYear();
  $("strong").checked = true;
  $("color-by").value = "show";
  $("size-by").value = "connections";
  updateKey();
  hideInfo();
  closeList();
}

const HUB = "hong-jin-ho";
const titleKing = data.people.reduce((a, b) => (b.titles > a.titles ? b : a));
const legendsN = data.people.filter((x) => tierOf(x).name === "Legend").length;
const topBridges = Object.entries(bridgeRank).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([id]) => plain(personById[id].name));
const circuit = families.list.filter((f) => f.members.length > 4).sort((a, b) => b.cross - a.cross)[0];

const TOUR = [
  {
    title: "The universe",
    text: `${data.people.length} players across ${data.shows.length} shows. Every light is a player, colored by the show they played most; a line means two people shared a season, and light flows from the earlier debut to the later.`,
    run: () => render(() => fit(1600)),
  },
  {
    title: "Where it began",
    text: "2013: The Genius puts thirteen players in a room with one game a week and a death match for the loser. Hong Jin-ho wins the first season.",
    run: () => { state.year = FIRST; state.who = "all"; setPressed("who", "all"); syncYear(); render(() => fit(1400)); },
  },
  {
    title: "The great bridge",
    text: `Hong Jin-ho has played ${personById[HUB].apps.length} seasons on ${personById[HUB].showIds.length} shows with ${mateCount[HUB]} different people, more than anyone. Light up his circle and most of the universe turns on.`,
    run: () => toggleCircle(HUB),
  },
  {
    title: "The champion",
    text: `${plain(titleKing.name)} has won ${titleKing.titles} titles on ${new Set(titleKing.apps.filter((a) => a.won).map((a) => seasonById[a.season].show)).size} different shows: the genre's most decorated player, and back for The Devil's Plan season 3.`,
    run: () => focusPerson(titleKing.id),
  },
  {
    title: "Legends at the core",
    text: `${legendsN} legends (two or more titles, or three or more shows) sit at the center. Crossovers circle them, then veterans of one show.`,
    run: () => { state.layout = "rings"; setPressed("layout", "rings"); graph.cameraPosition({ x: 0, y: 0, z: 900 }, { x: 0, y: 0, z: 0 }, 1200); render(() => fit(1400)); },
  },
  {
    title: "A decade in motion",
    text: "Everyone placed by the year they debuted. The Genius generation on the left; the arcs show how its players kept turning up in the shows that followed.",
    run: () => { state.layout = "flow"; setPressed("layout", "flow"); graph.cameraPosition({ x: 0, y: 0, z: 900 }, { x: 0, y: 0, z: 0 }, 1200); render(() => fit(1400)); },
  },
  {
    title: "Hidden families",
    text: `Colored by family: groups found from who keeps meeting whom, not from show labels. The busiest circuit, ${circuit ? circuit.name : "the crossover crowd"}, has ${circuit ? circuit.members.length : 0} players who keep crossing paths.`,
    run: () => { state.colorBy = "family"; $("color-by").value = "family"; updateKey(); render(() => fit(1400)); },
  },
  {
    title: "Who holds it together",
    text: `Sized by bridging: how many shortest chains between other players run through each one. ${topBridges.join(", ")} are the universe's load-bearing players.`,
    run: () => { state.sizeBy = "bridging"; $("size-by").value = "bridging"; render(() => fit(1400)); },
  },
  {
    title: "Six degrees",
    text: "A Go legend and a CrossFit champion: four steps apart, through The Devil's Plan and Synchro Game.",
    run: () => { setPick("from", "lee-se-dol"); setPick("to", "amotti"); runPath("lee-se-dol", "amotti"); },
  },
  {
    title: "The reunion",
    text: "The Devil's Plan: Dead Again brings sixteen players together on November 10. Here is everyone they have already met.",
    run: () => setGroup("devils-plan-3"),
  },
];

const tour = { active: false, i: 0, timer: null, auto: true };
function showStep(i) {
  tour.i = Math.max(0, Math.min(TOUR.length - 1, i));
  const step = TOUR[tour.i];
  resetView();
  step.run();
  $("tour-title").textContent = step.title;
  $("tour-text").textContent = step.text;
  $("tour-step").textContent = `${tour.i + 1} / ${TOUR.length}`;
  $("tour-prev").disabled = tour.i === 0;
  $("tour-next").textContent = tour.i === TOUR.length - 1 ? "Finish" : "Next";
  $("tour-bar").style.width = `${((tour.i + 1) / TOUR.length) * 100}%`;
  clearTimeout(tour.timer);
  if (tour.auto && tour.i < TOUR.length - 1) tour.timer = setTimeout(() => showStep(tour.i + 1), 10000);
}
function startTour() {
  tour.active = true;
  tour.auto = !reduceMotion;
  $("tour-auto").setAttribute("aria-pressed", String(tour.auto));
  $("tour").hidden = false;
  if (narrow()) $("more").open = false;
  showStep(0);
}
function endTour() {
  tour.active = false;
  clearTimeout(tour.timer);
  $("tour").hidden = true;
  resetView();
  render();
}
$("tour-next").addEventListener("click", () => (tour.i === TOUR.length - 1 ? endTour() : showStep(tour.i + 1)));
$("tour-prev").addEventListener("click", () => showStep(tour.i - 1));
$("tour-exit").addEventListener("click", endTour);
$("tour-auto").addEventListener("click", () => {
  tour.auto = !tour.auto;
  $("tour-auto").setAttribute("aria-pressed", String(tour.auto));
  showStep(tour.i);
});

// ---------- Search with suggestions ----------
const fold = (s) => s.toLowerCase().replace(/[\s\-.]/g, "");
const multiSeason = new Set(data.shows.filter((s) => data.seasons.filter((x) => x.show === s.id).length > 1).map((s) => s.id));
const index = [
  ...data.people.map((p) => ({ type: "person", id: p.id, label: p.name, sub: p.known || `${p.apps.length} season${p.apps.length > 1 ? "s" : ""}`, color: showById[p.primary].color, keys: [fold(p.name), fold(p.ko), fold(p.known)], weight: p.apps.length })),
  ...data.shows.map((s) => ({ type: "show", id: s.id, label: s.name, sub: "Show", color: s.color, keys: [fold(s.name)], weight: 100 })),
  ...data.seasons.filter((s) => multiSeason.has(s.show)).map((s) => ({ type: "season", id: s.id, label: s.full, sub: "Season cast", color: showById[s.show].color, keys: [fold(s.full)], weight: 50 })),
];

function search(term, types) {
  const t = fold(term);
  if (!t) return [];
  return index
    .filter((x) => types.includes(x.type))
    .map((x) => ({ x, rank: Math.min(...x.keys.map((k) => { const at = k.indexOf(t); return at < 0 ? 99 : at; })) }))
    .filter((r) => r.rank < 99)
    .sort((a, b) => a.rank - b.rank || b.x.weight - a.x.weight || a.x.label.localeCompare(b.x.label))
    .slice(0, 9)
    .map((r) => r.x);
}

function suggest(input, list, types, onPick) {
  let items = [];
  let at = -1;
  const draw = () => {
    list.hidden = !items.length;
    list.innerHTML = items.map((x, i) => `<li role="option" data-i="${i}" aria-selected="${i === at}"><span class="dot" style="background:${x.color}"></span>${esc(x.label)}<span class="meta">${esc(x.sub)}</span></li>`).join("");
  };
  const choose = (x) => {
    items = [];
    draw();
    onPick(x, input);
  };
  input.addEventListener("input", () => { items = search(input.value, types); at = items.length ? 0 : -1; draw(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length) return;
      e.preventDefault();
      at = (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      draw();
    } else if (e.key === "Enter" && at >= 0) {
      e.preventDefault();
      choose(items[at]);
    } else if (e.key === "Escape") {
      items = [];
      draw();
      input.blur();
    }
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (li) { e.preventDefault(); choose(items[+li.dataset.i]); }
  });
  input.addEventListener("blur", () => setTimeout(() => { items = []; draw(); }, 120));
}

suggest($("find"), $("find-list"), ["person", "show", "season"], (x, input) => {
  input.value = "";
  input.blur();
  if (x.type === "person") focusPerson(x.id);
  else if (x.type === "show") onlyShow(x.id);
  else setGroup(x.id);
});

const picks = { from: null, to: null };
function setPick(which, id) {
  picks[which] = id;
  $(which).value = plain(personById[id].name);
}
suggest($("from"), $("from-list"), ["person"], (x) => { setPick("from", x.id); if (picks.to) runPath(picks.from, picks.to); else $("to").focus(); });
suggest($("to"), $("to-list"), ["person"], (x) => { setPick("to", x.id); if (picks.from) runPath(picks.from, picks.to); });
$("go").addEventListener("click", () => runPath(picks.from, picks.to));

document.addEventListener("keydown", (e) => {
  const typing = /input|textarea/i.test(document.activeElement?.tagName ?? "");
  if (e.key === "/" && !typing) {
    e.preventDefault();
    $("find").focus();
  } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !typing && state.selected?.kind === "person") {
    e.preventDefault();
    stepConnection(e.key === "ArrowRight" ? 1 : -1);
  } else if (e.key === "Escape" && !typing) {
    if (tour.active) return endTour();
    if (state.list) closeList();
    else if (state.selected) clearSelection();
    else if (state.path) clearPath();
    else if (state.ego) { state.ego = null; render(); }
  }
});

// ---------- URL: the whole view is shareable ----------
function writeUrl() {
  const q = new URLSearchParams();
  if (state.view !== "players") q.set("view", state.view);
  if (state.layout !== "web") q.set("layout", state.layout);
  if (state.who !== "veterans") q.set("who", state.who);
  if (state.shows.size < data.shows.length) q.set("shows", [...state.shows].join(","));
  if (state.year < LAST) q.set("year", state.year);
  if (!state.strong) q.set("strong", "0");
  if (state.dims !== defaultDims) q.set("flat", state.dims === 2 ? "1" : "0");
  if (state.group?.except) q.set("group", state.group.except);
  if (state.ego) q.set("circle", state.ego);
  if (state.colorBy !== "show") q.set("color", state.colorBy);
  if (state.sizeBy !== "connections") q.set("size", state.sizeBy);
  if (state.compare.length) q.set("compare", state.compare.join(","));
  if (state.path) {
    q.set("from", state.path[0]);
    q.set("to", state.path.at(-1));
  } else if (state.selected?.kind === "person") q.set("focus", state.selected.id);
  const s = q.toString();
  history.replaceState(null, "", s ? `?${s}` : location.pathname);
}

function readUrl() {
  const q = new URLSearchParams(location.search);
  if (q.get("view") === "seasons") state.view = "seasons";
  if (["rings", "flow"].includes(q.get("layout"))) state.layout = q.get("layout");
  if (q.get("who") === "all") state.who = "all";
  if (q.get("shows")) {
    const want = q.get("shows").split(",").filter((s) => showById[s]);
    if (want.length) state.shows = new Set(want);
  }
  const year = +q.get("year");
  if (year >= FIRST && year < LAST) state.year = year;
  if (q.get("strong") === "0") state.strong = false;
  if (q.get("flat") === "1") state.dims = 2;
  if (q.get("flat") === "0") state.dims = 3;
  if (q.get("circle") && personById[q.get("circle")]) state.ego = q.get("circle");
  if (["tier", "debut", "family"].includes(q.get("color"))) state.colorBy = q.get("color");
  if (["bridging", "titles", "seasons"].includes(q.get("size"))) state.sizeBy = q.get("size");
  $("color-by").value = state.colorBy;
  $("size-by").value = state.sizeBy;
  setPressed("view", state.view);
  setPressed("layout", state.layout);
  setPressed("who", state.who);
  syncChips();
  syncYear();
  $("strong").checked = state.strong;
  $("flat").checked = state.dims === 2;
  graph.numDimensions(state.dims);
  return q;
}

// ---------- Start ----------
function size() {
  graph.width(el.clientWidth).height(el.clientHeight);
}
addEventListener("resize", size);
size();
if (narrow()) $("more").open = false;
renderInsights();
updateKey();

// Open from far away and glide in once the layout settles.
graph.cameraPosition({ x: 0, y: 0, z: 2600 });
const q = readUrl();
if (q.get("group") && seasonById[q.get("group")]) {
  setGroup(q.get("group"));
} else if (personById[q.get("from")] && personById[q.get("to")]) {
  setPick("from", q.get("from"));
  setPick("to", q.get("to"));
  runPath(q.get("from"), q.get("to"));
} else if (state.ego) {
  const id = state.ego;
  state.ego = null;
  toggleCircle(id);
} else if (q.get("compare")) {
  render(null);
  for (const id of q.get("compare").split(",").filter((x) => personById[x]).slice(0, 4)) toggleCompare(id);
} else if (q.has("tour")) {
  startTour();
} else {
  render(() => fit(1800));
  if (q.get("focus")) focusPerson(q.get("focus"));
}
