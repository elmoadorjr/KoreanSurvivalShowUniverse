import ForceGraph3D from "3d-force-graph";
import SpriteText from "three-spritetext";
import { forceX, forceY, forceZ } from "d3-force-3d";

const data = JSON.parse(document.getElementById("graph-data").textContent);
const el = document.getElementById("graph");
const css = getComputedStyle(document.documentElement);
const token = (name) => css.getPropertyValue(name).trim();
const theme = { bg: token("--bg"), ink: token("--ink"), muted: token("--muted"), gold: token("--gold"), line: token("--line") };

const showById = Object.fromEntries(data.shows.map((s) => [s.id, s]));
const seasonById = Object.fromEntries(data.seasons.map((s) => [s.id, s]));
const personById = Object.fromEntries(data.people.map((p) => [p.id, p]));

const state = {
  who: "veterans",
  group: "seasons",
  hover: null,
  selected: null,
  pending: null, // a player to fly to once the layout settles
  fitted: false,
  settled: false,
};

const isVeteran = (p) => p.apps.length > 1;
const isCrossShow = (p) => p.shows.length > 1;

function build() {
  const people = data.people.filter((p) => state.who === "all" || isVeteran(p));
  const nodes = [];
  const links = [];

  for (const s of data.shows) nodes.push({ id: `show:${s.id}`, kind: "show", ref: s, color: s.color, size: 14 });

  if (state.group === "seasons") {
    for (const s of data.seasons) {
      nodes.push({ id: `season:${s.id}`, kind: "season", ref: s, color: showById[s.show].color, size: 5 });
      links.push({ source: `show:${s.show}`, target: `season:${s.id}`, kind: "spine" });
    }
  }

  for (const p of people) {
    const color = isCrossShow(p) ? theme.gold : showById[p.shows[0]].color;
    nodes.push({ id: `person:${p.id}`, kind: "person", ref: p, color, size: 1 + p.apps.length * 0.9 });
    const targets =
      state.group === "seasons"
        ? p.apps.map((a) => `season:${a.season}`)
        : p.shows.map((s) => `show:${s}`);
    for (const t of new Set(targets)) links.push({ source: `person:${p.id}`, target: t, kind: "played" });
  }

  // Neighbor lists for hover highlighting.
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    n.neighbors = new Set();
    n.links = new Set();
  }
  for (const l of links) {
    const a = byId[l.source], b = byId[l.target];
    a.neighbors.add(b); b.neighbors.add(a);
    a.links.add(l); b.links.add(l);
  }
  return { nodes, links };
}

const lit = { nodes: new Set(), links: new Set() };

function focusSet(node) {
  lit.nodes.clear();
  lit.links.clear();
  if (!node) return;
  lit.nodes.add(node);
  for (const n of node.neighbors) lit.nodes.add(n);
  for (const l of node.links) lit.links.add(l);
  // A person lights up their seasons' shows too, so the path reads clearly.
  if (node.kind === "person") {
    for (const n of node.neighbors) {
      for (const l of n.links) if (l.kind === "spine") { lit.links.add(l); lit.nodes.add(l.source); }
    }
  }
}

const active = () => state.hover ?? state.selected;
const dimmed = (node) => active() && !lit.nodes.has(node);

function label(node) {
  const showLabel =
    node.kind === "show" ||
    node.kind === "season" ||
    (node.kind === "person" && (state.who === "veterans" || isCrossShow(node.ref)));
  if (!showLabel) return null;
  const text = node.kind === "season" ? node.ref.name : node.ref.name.replace(/\s*\(.*\)/, "");
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

const graph = new ForceGraph3D(el, { controlType: "orbit" })
  .backgroundColor(theme.bg)
  .showNavInfo(false)
  .nodeRelSize(3)
  .nodeVal((n) => n.size)
  .nodeColor((n) => (dimmed(n) ? theme.line : n.color))
  .nodeOpacity(0.95)
  .nodeResolution(16)
  .nodeLabel((n) => {
    if (n.kind === "person") {
      const p = n.ref;
      return `<div class="net-tip"><b>${p.name}</b>${p.known ? `<br>${p.known}` : ""}<br>${p.apps.length} season${p.apps.length > 1 ? "s" : ""}</div>`;
    }
    return `<div class="net-tip"><b>${n.kind === "season" ? n.ref.full : n.ref.name}</b></div>`;
  })
  .nodeThreeObjectExtend(true)
  .nodeThreeObject(label)
  .linkColor((l) => (lit.links.has(l) ? (l.kind === "spine" ? l.source.color : theme.ink) : theme.muted))
  .linkOpacity(0.28)
  .linkWidth((l) => (lit.links.has(l) ? 1.1 : 0))
  .linkDirectionalParticles((l) => (lit.links.has(l) && l.kind === "played" ? 2 : 0))
  .linkDirectionalParticleWidth(1.4)
  .linkDirectionalParticleColor(() => theme.gold)
  .onNodeHover((node) => {
    el.style.cursor = node ? "pointer" : "";
    if (node === state.hover) return;
    state.hover = node;
    focusSet(active());
    refresh();
  })
  .onNodeClick((node) => select(node, true))
  .onBackgroundClick(() => select(null))
  .cooldownTime(4000)
  .onEngineStop(() => {
    state.settled = true;
    if (state.pending) {
      const node = graph.graphData().nodes.find((n) => n.id === `person:${state.pending}`);
      state.pending = null;
      if (node) {
        state.fitted = true; // the fly to the player is the framing
        return select(node, true);
      }
    }
    if (!state.fitted) {
      state.fitted = true;
      graph.zoomToFit(700, 30);
    }
  });

// Spread hubs apart and let players settle between them.
graph.d3Force("charge").strength((n) => (n.kind === "show" ? -260 : n.kind === "season" ? -90 : -30));
graph.d3Force("link").distance((l) => (l.kind === "spine" ? 30 : 22));
// A little gravity, so shows with no veterans stay in view instead of drifting off.
for (const [name, f] of [["x", forceX], ["y", forceY], ["z", forceZ]]) graph.d3Force(name, f(0).strength(0.035));

function refresh() {
  graph.nodeColor(graph.nodeColor()).linkColor(graph.linkColor()).linkWidth(graph.linkWidth())
    .linkDirectionalParticles(graph.linkDirectionalParticles());
  for (const n of graph.graphData().nodes) {
    if (n.sprite) n.sprite.material.opacity = dimmed(n) ? 0.15 : 1;
  }
}

function render() {
  state.hover = null;
  state.selected = null;
  state.fitted = false;
  state.settled = false;
  focusSet(null);
  hideInfo();
  graph.graphData(build());
}

// Info panel
const info = document.getElementById("info");
const body = document.getElementById("info-body");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function showInfo(node) {
  let html = "";
  if (node.kind === "person") {
    const p = node.ref;
    html = `<div class="eyebrow">${p.shows.length > 1 ? "Cross-show veteran" : p.apps.length > 1 ? "Veteran" : "Player"}</div>
      <h2>${esc(p.name)}</h2>${p.ko ? `<div class="ko" lang="ko">${esc(p.ko)}</div>` : ""}
      ${p.known ? `<div class="muted">${esc(p.known)}</div>` : ""}
      <ul>${p.apps.map((a) => {
        const s = seasonById[a.season];
        return `<li style="--c:${showById[s.show].color}"><b>${esc(s.full)}</b><span class="r${a.won ? " won" : ""}">${esc(a.result || s.aired)}</span></li>`;
      }).join("")}</ul>
      <a class="go" href="/contestants/${p.id}/">Read the bio</a>`;
  } else {
    const isSeason = node.kind === "season";
    const show = isSeason ? showById[node.ref.show] : node.ref;
    const cast = data.people.filter((p) =>
      isSeason ? p.apps.some((a) => a.season === node.ref.id) : p.shows.includes(show.id)
    );
    const vets = cast.filter((p) => p.shows.length > 1);
    html = `<div class="eyebrow">${isSeason ? "Season" : "Show"}</div>
      <h2>${esc(isSeason ? node.ref.full : show.name)}</h2>
      <div class="muted">${esc(show.network)} · ${esc(isSeason ? node.ref.aired : show.years)}</div>
      <p class="muted" style="margin:10px 0 0;font-size:14px">${cast.length} players on the site${vets.length ? `, ${vets.length} also played other shows:` : "."}</p>
      ${vets.length ? `<ul>${vets.map((p) => `<li style="--c:${theme.gold}"><a href="/contestants/${p.id}/">${esc(p.name)}</a><span class="r">${p.shows.filter((s) => s !== show.id).map((s) => esc(showById[s].name)).join(", ")}</span></li>`).join("")}</ul>` : ""}
      <a class="go" href="/shows/${show.id}/${isSeason ? `#${node.ref.id}` : ""}">Open the ${isSeason ? "season" : "show"}</a>`;
  }
  body.innerHTML = html;
  info.hidden = false;
}

function hideInfo() {
  info.hidden = true;
}

function select(node, fly = false) {
  state.selected = node;
  focusSet(active());
  refresh();
  if (!node) return hideInfo();
  showInfo(node);
  if (fly) {
    const dist = node.kind === "show" ? 260 : 150;
    // Keep the current viewing angle and move in until the node is `dist` away.
    const cam = graph.cameraPosition();
    const d = { x: cam.x - node.x, y: cam.y - node.y, z: cam.z - node.z };
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const to = { x: node.x + (d.x / len) * dist, y: node.y + (d.y / len) * dist, z: node.z + (d.z / len) * dist };
    graph.cameraPosition(to, { x: node.x, y: node.y, z: node.z }, 1200);
  }
}

document.getElementById("close").addEventListener("click", () => select(null));

// Controls
function setPressed(attr, value) {
  for (const b of document.querySelectorAll(`[data-${attr}]`)) b.setAttribute("aria-pressed", String(b.dataset[attr] === value));
}
for (const b of document.querySelectorAll("[data-who]")) {
  b.addEventListener("click", () => { state.who = b.dataset.who; setPressed("who", state.who); render(); });
}
for (const b of document.querySelectorAll("[data-group]")) {
  b.addEventListener("click", () => { state.group = b.dataset.group; setPressed("group", state.group); render(); });
}

function focusPerson(id) {
  const p = personById[id];
  if (!p) return;
  if (!isVeteran(p) && state.who !== "all") {
    state.who = "all";
    setPressed("who", "all");
    render();
    state.pending = id;
    return;
  }
  const node = graph.graphData().nodes.find((n) => n.id === `person:${id}`);
  if (node && state.settled) {
    select(node, true);
  } else {
    state.pending = id;
  }
}

document.getElementById("find").addEventListener("change", (e) => {
  const name = e.target.value.trim().toLowerCase();
  const p = data.people.find((x) => x.name.toLowerCase() === name || x.ko === e.target.value.trim());
  if (p) focusPerson(p.id);
});

function size() {
  graph.width(el.clientWidth).height(el.clientHeight);
}
addEventListener("resize", size);
size();
render();

const focus = new URLSearchParams(location.search).get("focus");
if (focus) focusPerson(focus);
