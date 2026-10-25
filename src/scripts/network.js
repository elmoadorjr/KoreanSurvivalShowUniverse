import ForceGraph3D from "3d-force-graph";
import SpriteText from "three-spritetext";
import { forceX, forceY, forceZ } from "d3-force-3d";
import { CanvasTexture, Group, SRGBColorSpace, Sprite, SpriteMaterial, Vector3 } from "three";

const data = JSON.parse(document.getElementById("graph-data").textContent);
const el = document.getElementById("graph");
const css = getComputedStyle(document.documentElement);
const token = (name) => css.getPropertyValue(name).trim();
const theme = { bg: token("--bg"), ink: token("--ink"), muted: token("--muted"), gold: token("--gold"), line: token("--line") };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const plain = (name) => name.replace(/\s*\(.*\)/, "");
const narrow = () => matchMedia("(max-width: 760px)").matches;

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
  for (const a of p.apps) castOf[a.season].push(p.id);
}
const crossShow = (p) => p.showIds.length > 1;
const FIRST = Math.min(...data.seasons.map((s) => s.year));
const LAST = Math.max(...data.seasons.map((s) => s.year));
const appOf = (id, sid) => personById[id].apps.find((a) => a.season === sid);

// Seasons two players shared (all of them, whatever the filters).
function together(a, b) {
  const theirs = new Set(personById[b].apps.map((x) => x.season));
  return personById[a].apps.map((x) => x.season).filter((s) => theirs.has(s));
}
// Everyone a player has shared a season with, and in how many seasons.
function mates(id) {
  const n = new Map();
  for (const a of personById[id].apps) {
    for (const other of castOf[a.season]) if (other !== id) n.set(other, (n.get(other) ?? 0) + 1);
  }
  return n;
}
// Steps from one player to everyone reachable.
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
// Who finished higher each time two players met.
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

// ---------- State ----------
const defaultDims = narrow() ? 2 : 3;
const state = {
  view: "players",
  who: "veterans",
  shows: new Set(data.shows.map((s) => s.id)),
  year: LAST,
  strong: true,
  dims: defaultDims,
  group: null, // { ids: Set, label, except }
  ego: null, // player whose circle is shown
  path: null, // [ids]
  hover: null,
  selected: null, // node or link
  after: null, // runs once the layout settles
  settled: false,
  list: false,
};

const seasonOn = (sid) => state.shows.has(seasonById[sid].show) && sid !== state.group?.except && seasonById[sid].year <= state.year;

// Which players are in the current view.
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

// Seasons a connection runs through, kept in view even when filtered out.
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
    n = { id };
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
    // Each player takes the color of the show they played most.
    nodes.push(nodeObj(id, { kind: "person", ref: p, color: showById[p.primary].color, size: 1 + p.apps.length * 0.9 }));
  }

  if (state.view === "players") {
    const pairs = new Map();
    for (const s of data.seasons) {
      if (!on(s.id)) continue;
      const cast = castOf[s.id].filter((id) => ids.has(id));
      for (let i = 0; i < cast.length; i++) {
        for (let j = i + 1; j < cast.length; j++) {
          const key = linkKey(cast[i], cast[j]);
          if (!pairs.has(key)) pairs.set(key, { source: cast[i], target: cast[j], key, kind: "mates", seasons: [] });
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
        links.push({ source: id, target: `season:${a.season}`, key: `${id}>${a.season}`, kind: "played", color: showById[seasonById[a.season].show].color });
      }
    }
    const showsUsed = new Set([...seasonsUsed].map((s) => seasonById[s].show));
    for (const sid of showsUsed) nodes.push(nodeObj(`show:${sid}`, { kind: "show", ref: showById[sid], color: showById[sid].color, size: 14 }));
    for (const sid of seasonsUsed) {
      const s = seasonById[sid];
      nodes.push(nodeObj(`season:${sid}`, { kind: "season", ref: s, color: showById[s.show].color, size: 5 }));
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
      // In the seasons view, light each hop's shared season.
      for (let i = 1; i < state.path.length; i++) {
        const s = together(state.path[i - 1], state.path[i])[0];
        for (const l of links) {
          if (l.key === `${state.path[i - 1]}>${s}` || l.key === `${state.path[i]}>${s}`) {
            lit.links.add(l);
            lit.nodes.add(l.target);
          }
        }
      }
    }
  }
}

const anyLit = () => lit.nodes.size > 0;
const dimmed = (n) => anyLit() && !lit.nodes.has(n);

// ---------- Drawing ----------
const REL_SIZE = 3;

// A player with a photo is drawn as their face in a ring of their color.
function photoSprite(node) {
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
    // Cover the circle, favoring the top of the photo where faces usually are.
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
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  const r = Math.cbrt(node.size) * REL_SIZE * 1.25;
  sprite.scale.set(r * 2, r * 2, 1);
  node.pic = sprite;
  return sprite;
}

function label(node) {
  const text = node.kind === "season" ? node.ref.name : plain(node.ref.name);
  const sprite = new SpriteText(text);
  sprite.fontFace = "Inter, system-ui, sans-serif";
  sprite.fontWeight = node.kind === "person" ? "600" : "700";
  sprite.color = node.kind === "person" ? theme.ink : node.color;
  sprite.textHeight = node.kind === "show" ? 7 : node.kind === "season" ? 3.6 : 3;
  sprite.center.y = -0.6 - node.size * 0.04;
  sprite.material.depthWrite = false;
  sprite.material.transparent = true;
  node.sprite = sprite;
  return sprite;
}

const hasPhoto = (n) => n.kind === "person" && !!n.ref.photo;

function nodeObject(node) {
  const text = label(node);
  if (!hasPhoto(node)) return text;
  const group = new Group();
  group.add(photoSprite(node));
  group.add(text);
  return group;
}

const graph = new ForceGraph3D(el, { controlType: "orbit" })
  .backgroundColor(theme.bg)
  .showNavInfo(false)
  .numDimensions(state.dims)
  .nodeRelSize(REL_SIZE)
  .nodeVal((n) => n.size)
  .nodeColor((n) => (dimmed(n) ? theme.line : n.color))
  .nodeOpacity(0.95)
  .nodeResolution(14)
  .nodeLabel((n) => {
    if (n.kind !== "person") return `<div class="net-tip"><b>${esc(n.kind === "season" ? n.ref.full : n.ref.name)}</b></div>`;
    const p = n.ref;
    return `<div class="net-tip"><b>${esc(p.name)}</b>${p.known ? `<br>${esc(p.known)}` : ""}<br>${p.apps.length} season${p.apps.length > 1 ? "s" : ""}${p.titles ? `, ${p.titles} title${p.titles > 1 ? "s" : ""}` : ""}</div>`;
  })
  .nodeThreeObjectExtend((n) => !hasPhoto(n))
  .nodeThreeObject(nodeObject)
  .linkVisibility((l) => !weak(l) || lit.links.has(l))
  .linkColor((l) => (lit.links.has(l) ? (lit.path ? theme.gold : l.color) : theme.muted))
  .linkOpacity(0.24)
  .linkWidth((l) => (lit.links.has(l) ? (l.kind === "mates" ? 0.8 + l.seasons.length * 0.5 : 1.1) : 0))
  .linkDirectionalParticles((l) => (lit.links.has(l) && lit.path ? 3 : 0))
  .linkDirectionalParticleWidth(1.6)
  .linkDirectionalParticleColor(() => theme.gold)
  .linkLabel((l) => {
    if (l.kind !== "mates") return "";
    const a = l.source.id ?? l.source, b = l.target.id ?? l.target;
    const { score } = headToHead(a, b);
    const decided = score[a] + score[b] + score.tie;
    return `<div class="net-tip"><b>${esc(plain(personById[a].name))} &amp; ${esc(plain(personById[b].name))}</b><br>${l.seasons.map((s) => esc(seasonById[s].full)).join("<br>")}${decided ? `<br><i>Head to head ${score[a]}–${score[b]}</i>` : ""}</div>`;
  })
  .onNodeHover((node) => setHover(node))
  .onLinkHover((link) => setHover(link && link.kind === "mates" ? link : null))
  .onNodeClick((node) => select(node, true))
  .onLinkClick((link) => link.kind === "mates" && select(link))
  .onBackgroundClick(() => clearSelection())
  .cooldownTime(4000)
  .onEngineStop(() => {
    state.settled = true;
    const fn = state.after;
    state.after = null;
    if (fn) fn();
  });

// Spread hubs apart; players who shared more seasons sit closer together.
graph.d3Force("charge").strength((n) => (n.kind === "show" ? -260 : n.kind === "season" ? -90 : -36));
graph.d3Force("link")
  .distance((l) => (l.kind === "spine" ? 30 : l.kind === "mates" ? 34 - Math.min(l.seasons.length, 4) * 4 : 22))
  .strength((l) => {
    const base = 1 / Math.min(l.source.neighbors?.size || 1, l.target.neighbors?.size || 1);
    return weak(l) ? base * 0.15 : base;
  });
// A little gravity, so islands stay in view instead of drifting off.
for (const [name, f] of [["x", forceX], ["y", forceY], ["z", forceZ]]) graph.d3Force(name, f(0).strength(0.04));

function setHover(target) {
  el.style.cursor = target ? "pointer" : "";
  if (target === state.hover) return;
  state.hover = target;
  refresh();
}

function refresh() {
  computeLit();
  graph.nodeColor(graph.nodeColor()).linkColor(graph.linkColor()).linkWidth(graph.linkWidth())
    .linkVisibility(graph.linkVisibility()).linkDirectionalParticles(graph.linkDirectionalParticles());
  const { nodes } = graph.graphData();
  const persons = nodes.filter((n) => n.kind === "person");
  // The best-connected names stay labelled however big the view gets.
  const top = new Set([...persons].sort((a, b) => b.neighbors.size - a.neighbors.size).slice(0, 24));
  for (const n of nodes) {
    if (n.pic) n.pic.material.opacity = dimmed(n) ? 0.18 : 1;
    if (!n.sprite) continue;
    n.sprite.visible = n.kind !== "person" || lit.nodes.has(n) || persons.length <= 70 || (top.has(n) && !anyLit());
    n.sprite.material.opacity = dimmed(n) ? 0.15 : 1;
  }
}

const nodeFor = (id) => graph.graphData().nodes.find((n) => n.id === id) ?? null;
const fit = () => graph.zoomToFit(700, narrow() ? 20 : 40);

function render(after) {
  state.hover = null;
  const keepId = state.selected?.kind === "person" ? state.selected.id : null;
  state.settled = false;
  state.after = after === undefined ? fit : after;
  graph.graphData(build());
  state.selected = keepId ? nodeFor(keepId) : null;
  refresh();
  updateActive();
  updateCount();
  if (state.list) renderList();
  writeUrl();
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
  const dist = node.kind === "show" ? 280 : 220;
  const cam = graph.cameraPosition();
  // In the flat view nodes have no z, and the camera must keep looking straight down.
  const nz = state.dims === 2 ? 0 : node.z || 0;
  const d = state.dims === 2 ? { x: 0, y: 0, z: 1 } : { x: cam.x - node.x, y: cam.y - node.y, z: cam.z - nz };
  const len = Math.hypot(d.x, d.y, d.z) || 1;
  let look = { x: node.x, y: node.y, z: nz };
  // On a phone the details sheet covers the bottom, so keep the player in the top half.
  if (narrow()) {
    const up = new Vector3(0, 1, 0).applyQuaternion(graph.camera().quaternion);
    const shift = dist * 0.22;
    look = { x: look.x - up.x * shift, y: look.y - up.y * shift, z: look.z - up.z * shift };
  }
  graph.cameraPosition(
    { x: look.x + (d.x / len) * dist, y: look.y + (d.y / len) * dist, z: look.z + (d.z / len) * dist },
    look,
    1000
  );
}
const whenSettled = (fn) => (state.settled ? fn() : (state.after = fn));

// ---------- Selection and panels ----------
const info = $("info");
const body = $("info-body");

function select(target, fly = false) {
  state.selected = target;
  refresh();
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
    <div class="eyebrow">${crossShow(p) ? "Cross-show veteran" : p.apps.length > 1 ? "Veteran" : "Player"}</div>
    ${p.photo ? `<img class="pic" src="${esc(p.photo)}" alt="">` : ""}
    <h2>${esc(p.name)}</h2>${p.ko ? `<div class="ko" lang="ko">${esc(p.ko)}</div>` : ""}
    ${p.known ? `<div class="muted">${esc(p.known)}</div>` : ""}
    <div class="stat">${p.apps.length} season${p.apps.length > 1 ? "s" : ""} · ${p.showIds.length} show${p.showIds.length > 1 ? "s" : ""}${p.titles ? ` · ${p.titles} title${p.titles > 1 ? "s" : ""}` : ""} · played with ${list.length}</div>
    <div class="acts">
      <button type="button" class="act" data-circle="${p.id}">${state.ego === p.id ? "Back to everyone" : "Show their circle"}</button>
      <button type="button" class="act ghost" data-from="${p.id}">Connect from here</button>
      <a class="act ghost" href="/contestants/${p.id}/">Bio</a>
    </div>
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
  if (d.go) return focusPerson(d.go);
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
}

// ---------- Actions ----------
function focusPerson(id) {
  const p = personById[id];
  if (!p) return;
  closeList();
  personPanel(p);
  if (!visiblePeople().has(id)) {
    // Widen the view just enough to include them.
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
    graph.zoomToFit(800, 80, (n) => ids.has(n.id));
  });
}

function clearPath() {
  state.path = null;
  picks.from = picks.to = null;
  $("from").value = $("to").value = "";
  hideInfo();
  render();
}

// Tags for whatever narrows the view, each removable.
function updateActive() {
  const tags = [];
  if (state.group) tags.push(["group", `Showing: ${state.group.label}`]);
  if (state.ego) tags.push(["ego", `Circle of ${plain(personById[state.ego].name)}`]);
  if (state.path) tags.push(["path", `Connection: ${plain(personById[state.path[0]].name)} to ${plain(personById[state.path.at(-1)].name)}`]);
  if (state.shows.size < data.shows.length) tags.push(["shows", `${state.shows.size} of ${data.shows.length} shows`]);
  if (state.year < LAST) tags.push(["year", `Seasons up to ${state.year}`]);
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
// Watch the universe grow, one year at a time.
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
    setTimeout(() => graph.zoomToFit(900, 60), 700);
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
  }, 1600);
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
for (const b of document.querySelectorAll("#controls [data-who]")) {
  b.addEventListener("click", () => { state.who = b.dataset.who; setPressed("who", state.who); state.group = null; state.ego = null; render(); });
}

function syncChips() {
  for (const c of document.querySelectorAll(".show-chip")) c.setAttribute("aria-pressed", String(state.shows.has(c.dataset.show)));
}
let chipTimer = null;
for (const c of document.querySelectorAll(".show-chip")) {
  c.addEventListener("click", () => {
    // A double-tap means "only this show", so wait a moment before toggling.
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
// Rows are table rows, not buttons, so route their clicks here.
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
  const connected = data.people.map((p) => [p.id, mates(p.id).size]).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const titled = data.people.filter((p) => p.titles > 1).sort((a, b) => b.titles - a.titles || a.name.localeCompare(b.name));

  // Pairs of shows joined by exactly one player.
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

  // Steps from Hong Jin-ho.
  const HUB = "hong-jin-ho";
  const { dist } = distances(HUB);
  const counts = [];
  for (const [id, d] of dist) if (id !== HUB) counts[d] = (counts[d] ?? 0) + 1;
  const max = Math.max(...counts.filter(Boolean));
  const furthest = [...dist.entries()].filter(([, d]) => d === counts.length - 1).map(([id]) => id).slice(0, 6);
  const unreachable = data.people.length - dist.size;
  const avg = ([...dist.values()].reduce((s, d) => s + d, 0) / (dist.size - 1)).toFixed(1);

  $("insights-body").innerHTML = `
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
  } else if (e.key === "Escape" && !typing) {
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
  if (state.who !== "veterans") q.set("who", state.who);
  if (state.shows.size < data.shows.length) q.set("shows", [...state.shows].join(","));
  if (state.year < LAST) q.set("year", state.year);
  if (!state.strong) q.set("strong", "0");
  if (state.dims !== defaultDims) q.set("flat", state.dims === 2 ? "1" : "0");
  if (state.group) q.set("group", state.group.except);
  if (state.ego) q.set("circle", state.ego);
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
  setPressed("view", state.view);
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
} else {
  render();
  if (q.get("focus")) focusPerson(q.get("focus"));
}
