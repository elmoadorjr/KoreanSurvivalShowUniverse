import ForceGraph3D from "3d-force-graph";
import SpriteText from "three-spritetext";
import { forceX, forceY, forceZ } from "d3-force-3d";
import { CanvasTexture, Group, SRGBColorSpace, Sprite, SpriteMaterial } from "three";

const data = JSON.parse(document.getElementById("graph-data").textContent);
const el = document.getElementById("graph");
const css = getComputedStyle(document.documentElement);
const token = (name) => css.getPropertyValue(name).trim();
const theme = { bg: token("--bg"), ink: token("--ink"), muted: token("--muted"), gold: token("--gold"), line: token("--line") };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const plain = (name) => name.replace(/\s*\(.*\)/, "");

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
// Shortest chain of co-players between two people.
function shortestPath(from, to) {
  if (from === to) return [from];
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of mates(cur).keys()) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === to) {
        const path = [to];
        for (let at = cur; at !== null; at = prev.get(at)) path.unshift(at);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

// ---------- State ----------
const state = {
  view: "players",
  who: "veterans",
  shows: new Set(data.shows.map((s) => s.id)),
  group: null, // { ids: Set, label, except }
  ego: null, // player whose circle is shown
  path: null, // [ids]
  dims: 3,
  hover: null,
  selected: null, // node or link
  after: null, // runs once the layout settles
  settled: false,
};

const seasonOn = (sid) => state.shows.has(seasonById[sid].show) && sid !== state.group?.except;

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

function build() {
  const ids = visiblePeople();
  const keep = pathSeasons();
  const on = (sid) => seasonOn(sid) || keep.has(sid);
  const nodes = [];
  const links = [];
  // Each player takes the color of the show they played most.
  const color = (p) => showById[p.primary].color;
  for (const id of ids) {
    const p = personById[id];
    nodes.push({ id, kind: "person", ref: p, color: color(p), size: 1 + p.apps.length * 0.9 });
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
    for (const sid of showsUsed) nodes.push({ id: `show:${sid}`, kind: "show", ref: showById[sid], color: showById[sid].color, size: 14 });
    for (const sid of seasonsUsed) {
      const s = seasonById[sid];
      nodes.push({ id: `season:${sid}`, kind: "season", ref: s, color: showById[s.show].color, size: 5 });
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
  sprite.fontWeight = node.kind === "person" ? "500" : "700";
  sprite.color = node.kind === "person" ? theme.ink : node.color;
  sprite.textHeight = node.kind === "show" ? 7 : node.kind === "season" ? 3.6 : 2.6;
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
  .linkColor((l) => (lit.links.has(l) ? (lit.path ? theme.gold : l.color) : theme.muted))
  .linkOpacity(0.22)
  .linkWidth((l) => (lit.links.has(l) ? (l.kind === "mates" ? 0.8 + l.seasons.length * 0.5 : 1.1) : 0))
  .linkDirectionalParticles((l) => (lit.links.has(l) && lit.path ? 3 : 0))
  .linkDirectionalParticleWidth(1.6)
  .linkDirectionalParticleColor(() => theme.gold)
  .linkLabel((l) => {
    if (l.kind !== "mates") return "";
    const a = personById[l.source.id ?? l.source], b = personById[l.target.id ?? l.target];
    return `<div class="net-tip"><b>${esc(plain(a.name))} &amp; ${esc(plain(b.name))}</b><br>${l.seasons.map((s) => esc(seasonById[s].full)).join("<br>")}</div>`;
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
graph.d3Force("link").distance((l) => (l.kind === "spine" ? 30 : l.kind === "mates" ? 34 - Math.min(l.seasons.length, 4) * 4 : 22));
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
    .linkDirectionalParticles(graph.linkDirectionalParticles());
  const { nodes } = graph.graphData();
  const persons = nodes.filter((n) => n.kind === "person").length;
  for (const n of nodes) {
    if (n.pic) n.pic.material.opacity = dimmed(n) ? 0.18 : 1;
    if (!n.sprite) continue;
    // Labels: every name in a small view; in a big one, the lit names and the cross-show veterans.
    n.sprite.visible = n.kind !== "person" || lit.nodes.has(n) || persons <= 70 || (persons <= 220 && crossShow(n.ref) && !anyLit());
    n.sprite.material.opacity = dimmed(n) ? 0.15 : 1;
  }
}

const nodeFor = (id) => graph.graphData().nodes.find((n) => n.id === id) ?? null;

function render(after) {
  state.hover = null;
  const keepId = state.selected?.kind === "person" ? state.selected.id : null;
  state.settled = false;
  state.after = after ?? (() => graph.zoomToFit(700, 40));
  graph.graphData(build());
  state.selected = keepId ? nodeFor(keepId) : null;
  refresh();
  updateActive();
  updateCount();
}

function updateCount() {
  const { nodes, links } = graph.graphData();
  const people = nodes.filter((n) => n.kind === "person").length;
  $("count").textContent = state.view === "players"
    ? `${people} players · ${links.length} connections`
    : `${people} players · ${nodes.filter((n) => n.kind === "season").length} seasons`;
}

// ---------- Camera ----------
function flyTo(node) {
  const dist = node.kind === "show" ? 280 : 220;
  const cam = graph.cameraPosition();
  const d = { x: cam.x - node.x, y: cam.y - node.y, z: cam.z - node.z };
  const len = Math.hypot(d.x, d.y, d.z) || 1;
  graph.cameraPosition(
    { x: node.x + (d.x / len) * dist, y: node.y + (d.y / len) * dist, z: node.z + (d.z / len) * dist },
    { x: node.x, y: node.y, z: node.z },
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
  else if (target.kind === "mates") pairPanel(target);
  else seasonOrShowPanel(target);
  if (fly && !isLink(target)) flyTo(target);
  if (target.kind === "person") setUrl({ focus: target.id });
}

function clearSelection() {
  state.selected = null;
  refresh();
  if (state.path) pathPanel(state.path);
  else hideInfo();
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

function pairPanel(l) {
  const a = personById[l.source.id], b = personById[l.target.id];
  const all = together(a.id, b.id);
  const res = (p, sid) => p.apps.find((x) => x.season === sid)?.result || "Played";
  showInfo(`
    <div class="eyebrow">Played together</div>
    <h2>${esc(plain(a.name))} &amp; ${esc(plain(b.name))}</h2>
    <div class="stat">${all.length} season${all.length > 1 ? "s" : ""} together</div>
    <ul>${all.map((sid) => {
      const s = seasonById[sid];
      return `<li class="hop"><span><span class="chip" style="--show:${showById[s.show].color}">${esc(s.full)}</span></span>
        <span class="muted">${esc(plain(a.name))}: ${esc(res(a, sid))} · ${esc(plain(b.name))}: ${esc(res(b, sid))}</span></li>`;
    }).join("")}</ul>
    <div class="acts">
      <button type="button" class="act ghost" data-go="${a.id}">${esc(plain(a.name))}</button>
      <button type="button" class="act ghost" data-go="${b.id}">${esc(plain(b.name))}</button>
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
    const shared = together(prev, id);
    return `<li class="hop"><span class="who">${esc(plain(personById[prev].name))} → ${esc(plain(personById[id].name))}</span>
      <span>${shared.map((sid) => `<span class="chip" style="--show:${showById[seasonById[sid].show].color}">${esc(seasonById[sid].full)}</span>`).join("")}</span></li>`;
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

// Panel buttons.
body.addEventListener("click", (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  if (t.dataset.go) return focusPerson(t.dataset.go);
  if (t.dataset.circle) return toggleCircle(t.dataset.circle);
  if (t.dataset.from) {
    $("more").open = true;
    setPick("from", t.dataset.from);
    $("to").focus();
    return;
  }
  if (t.dataset.group) return setGroup(t.dataset.group);
  if (t.dataset.only) return onlyShow(t.dataset.only);
  if ("clearPath" in t.dataset) return clearPath();
});
$("close").addEventListener("click", () => {
  state.selected = null;
  refresh();
  hideInfo();
});

// ---------- Actions ----------
function focusPerson(id) {
  const p = personById[id];
  if (!p) return;
  personPanel(p);
  if (!visiblePeople().has(id)) {
    // Widen the view just enough to include them.
    state.group = null;
    state.ego = null;
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
    graph.zoomToFit(700, 60);
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
  setUrl({ group: seasonId });
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
  if (!path) {
    state.path = null;
    render();
    noPathPanel(from, to);
    return;
  }
  state.path = path;
  setUrl({ from, to });
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
  setUrl({});
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
  const box = $("active");
  box.hidden = !tags.length;
  box.innerHTML = tags.map(([k, t]) => `<div class="tag"><span>${esc(t)}</span><button type="button" data-clear="${k}" aria-label="Remove">×</button></div>`).join("");
}
$("active").addEventListener("click", (e) => {
  const k = e.target.closest("[data-clear]")?.dataset.clear;
  if (!k) return;
  if (k === "path") return clearPath();
  if (k === "group") { state.group = null; setUrl({}); }
  if (k === "ego") state.ego = null;
  if (k === "shows") { state.shows = new Set(data.shows.map((s) => s.id)); syncChips(); }
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
$("flat").addEventListener("change", (e) => {
  state.dims = e.target.checked ? 2 : 3;
  graph.numDimensions(state.dims);
  render();
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
  } else if (e.key === "Escape" && !typing) {
    if (state.selected) clearSelection();
    else if (state.path) clearPath();
    else if (state.ego) { state.ego = null; render(); }
  }
});

// ---------- URL ----------
function setUrl(params) {
  const q = new URLSearchParams(params).toString();
  history.replaceState(null, "", q ? `?${q}` : location.pathname);
}

// ---------- Start ----------
function size() {
  graph.width(el.clientWidth).height(el.clientHeight);
}
addEventListener("resize", size);
size();
if (matchMedia("(max-width: 760px)").matches) $("more").open = false;

const q = new URLSearchParams(location.search);
if (q.get("group") && seasonById[q.get("group")]) {
  setGroup(q.get("group"));
} else if (personById[q.get("from")] && personById[q.get("to")]) {
  setPick("from", q.get("from"));
  setPick("to", q.get("to"));
  runPath(q.get("from"), q.get("to"));
} else {
  render();
  if (q.get("focus")) focusPerson(q.get("focus"));
}
