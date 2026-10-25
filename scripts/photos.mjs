// Finds a freely licensed photo for each player on Wikimedia Commons, through
// Wikidata's "image" property, and saves a 400px copy to public/photos/ with
// its author, licence and source page in src/data/photos.json.
//   node scripts/photos.mjs              every player without a photo yet
//   node scripts/photos.mjs lee-se-dol   some players (refetch them)
//   node scripts/photos.mjs --build      what `npm run build` runs: uses the
//                                        cache, quietly does nothing offline,
//                                        and never fails the build.
//
// A player is matched only when exactly one person on Wikidata fits: their
// Korean name must equal `ko` when we have it, and the person's Wikidata
// description must agree with what the player is `known` for (an actress with
// an actress, a Go player with a Go player). Players with no `known`, and
// private people (students, employees), are never matched. Anything ambiguous
// is skipped and listed. In src/data/universe.json a player can pin the match with
// "wikidata": "Q123", name a Commons file with "photo": "File name.jpg", or opt
// out with "photo": false.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(root, "src/data/universe.json");
const OUT = path.join(root, "src/data/photos.json");
const DIR = path.join(root, "public/photos");
const CACHE = path.join(root, "node_modules/.cache/ksu-photos");

const WIKIDATA = "https://www.wikidata.org/w/api.php";
const COMMONS = "https://commons.wikimedia.org/w/api.php";
// Wikimedia asks for a descriptive user agent with a contact URL, and for unhurried requests.
const UA = { "user-agent": "SurvivalUniverseBuild/1.0 (https://github.com/elmoadorjr/KoreanSurvivalShowUniverse; fan site)" };
const WIDTH = 400;
const RETRY_DAYS = 7; // in --build, wait this long before asking about a miss again
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const build = argv.includes("--build");
const only = argv.filter((a) => !a.startsWith("--"));

async function api(base, params) {
  const url = `${base}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${url}`);
    await pause(2000 * (i + 1));
  }
  throw new Error(`gave up on ${url}`);
}

const plain = (name) => name.replace(/\s*\(.*?\)/g, "").trim();
const stripHtml = (s = "") => s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

// Wikidata people who could be this player, keyed by id.
async function candidates(person) {
  const ids = new Set();
  const searches = [[plain(person.name), "en"]];
  if (person.ko) searches.push([person.ko, "ko"]);
  for (const [search, language] of searches) {
    const r = await api(WIKIDATA, { action: "wbsearchentities", search, language, uselang: language, type: "item", limit: "10" });
    for (const hit of r.search ?? []) ids.add(hit.id);
    await pause(200);
  }
  if (!ids.size) return [];
  const r = await api(WIKIDATA, { action: "wbgetentities", ids: [...ids].join("|"), props: "labels|aliases|claims|descriptions", languages: "en|ko" });
  return Object.values(r.entities ?? {});
}

const claim = (entity, prop) => entity.claims?.[prop]?.map((c) => c.mainsnak?.datavalue?.value).filter(Boolean) ?? [];
const isHuman = (e) => claim(e, "P31").some((v) => v.id === "Q5");
const names = (e, lang) => [e.labels?.[lang]?.value, ...(e.aliases?.[lang] ?? []).map((a) => a.value)].filter(Boolean);
const squash = (s) => s.toLowerCase().replace(/[\s\-.]/g, "");

// What a player is known for, and words that confirm it in a Wikidata description.
const TRADES = [
  [/actor|actress/i, /actor|actress|배우/i],
  [/singer|rapper|songwriter|idol/i, /singer|rapper|musician|idol|vocalist|가수|래퍼|그룹/i],
  [/comedian/i, /comedian|개그맨|개그우먼|코미디언/i],
  [/host|presenter|broadcaster|announcer|personality/i, /presenter|host|announcer|broadcaster|personality|아나운서|방송인|진행자/i],
  [/politician|lawmaker/i, /politician|national assembly|정치인|국회의원/i],
  [/go player/i, /go player|baduk|바둑/i],
  [/starcraft|gamer/i, /starcraft|gamer|e-?sports|프로게이머/i],
  [/poker/i, /poker|포커/i],
  [/lawyer/i, /lawyer|attorney|변호사/i],
  [/youtuber|streamer|creator|influencer/i, /youtuber|streamer|influencer|internet personality|유튜버|스트리머|크리에이터/i],
  [/webtoon/i, /webtoon|cartoonist|manhwa|웹툰|만화/i],
  [/critic/i, /critic|commentator|평론가/i],
  [/chef/i, /chef|cook|셰프|요리사/i],
  [/illusionist|magician/i, /magician|illusionist|마술사/i],
  [/surgeon|doctor/i, /surgeon|physician|doctor|의사/i],
  [/dancer/i, /dancer|choreographer|댄서|안무가/i],
  [/model/i, /model|모델/i],
  [/programmer|hacker/i, /programmer|hacker|engineer|프로그래머|해커/i],
  [/science communicator/i, /science|communicator|youtuber|과학/i],
  [/skeleton/i, /skeleton|스켈레톤/i],
  [/gymnast/i, /gymnast|체조/i],
  [/wrestler/i, /wrestl|레슬링|씨름/i],
  [/judoka/i, /judo|유도/i],
  [/footballer/i, /football|soccer|축구/i],
  [/basketball/i, /basketball|농구/i],
  [/baseball/i, /baseball|야구/i],
  [/boxer/i, /box|복싱|권투/i],
  [/martial/i, /martial|mma|ufc|격투/i],
  [/cyclist/i, /cycl|사이클|경륜/i],
  [/snowboard/i, /snowboard|스노보드/i],
  [/luger/i, /luge|루지/i],
  [/rugby/i, /rugby|럭비/i],
  [/bodybuilder/i, /bodybuild|보디빌/i],
  [/climber/i, /climb|클라이밍/i],
  [/kabaddi/i, /kabaddi|카바디/i],
  [/ssireum/i, /ssireum|씨름/i],
  [/crossfit/i, /crossfit|크로스핏/i],
];
// Private people: never matched to a public figure who shares their name.
const PRIVATE = /student|employee|officer|firefighter|soldier|rescuer|stuntwoman|car dealer|farmer|^lg /i;

const descriptions = (e) => [e.descriptions?.en?.value, e.descriptions?.ko?.value].filter(Boolean).join(" ");

function agrees(person, entity) {
  const known = person.known ?? "";
  if (!known || PRIVATE.test(known)) return false;
  const text = descriptions(entity);
  if (!text) return false;
  const trades = TRADES.filter(([k]) => k.test(known));
  return trades.length > 0 && trades.some(([, d]) => d.test(text));
}

function pick(person, entities) {
  const humans = entities.filter((e) => isHuman(e) && claim(e, "P18").length);
  const named = humans.filter((e) =>
    person.ko
      ? names(e, "ko").some((n) => squash(n) === squash(person.ko))
      : names(e, "en").some((n) => squash(n) === squash(plain(person.name)))
  );
  return named.filter((e) => agrees(person, e));
}

async function fileFor(id, person) {
  if (typeof person.photo === "string") return { file: person.photo.replace(/^File:/, "") };
  if (person.wikidata) {
    const r = await api(WIKIDATA, { action: "wbgetentities", ids: person.wikidata, props: "claims" });
    const file = claim(r.entities?.[person.wikidata] ?? {}, "P18")[0];
    return file ? { file, wikidata: person.wikidata } : { skip: `${person.wikidata} has no image` };
  }
  if (!person.known || PRIVATE.test(person.known)) return { skip: "private, or nothing to check a match against" };
  const fits = pick(person, await candidates(person));
  if (fits.length === 1) return { file: claim(fits[0], "P18")[0], wikidata: fits[0].id };
  return { skip: fits.length ? `ambiguous: ${fits.map((e) => e.id).join(", ")}` : "no match with a photo" };
}

async function download(id, file) {
  const r = await api(COMMONS, {
    action: "query", titles: `File:${file}`, prop: "imageinfo",
    iiprop: "url|extmetadata", iiurlwidth: String(WIDTH),
  });
  const info = r.query?.pages?.[0]?.imageinfo?.[0];
  if (!info?.thumburl) throw new Error(`no thumbnail for ${file}`);
  const meta = info.extmetadata ?? {};
  const ext = path.extname(new URL(info.thumburl).pathname).toLowerCase() || ".jpg";
  const name = `${id}${ext === ".jpeg" ? ".jpg" : ext}`;
  // Cached by Commons file, so a corrected match never reuses the old image.
  const cached = path.join(CACHE, "files", file.replace(/[^\w.-]+/g, "_") + (ext === ".jpeg" ? ".jpg" : ext));
  let bytes = await fs.readFile(cached).catch(() => null);
  if (!bytes) {
    const res = await fetch(info.thumburl, { headers: UA, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`${res.status} ${info.thumburl}`);
    bytes = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(path.dirname(cached), { recursive: true });
    await fs.writeFile(cached, bytes);
  }
  await fs.writeFile(path.join(DIR, name), bytes);
  return {
    src: `/photos/${name}`,
    credit: stripHtml(meta.Artist?.value) || "Unknown author",
    license: stripHtml(meta.LicenseShortName?.value) || "See source",
    source: info.descriptionurl,
  };
}

async function main() {
  const { people } = JSON.parse(await fs.readFile(DATA, "utf8"));
  const photos = JSON.parse(await fs.readFile(OUT, "utf8").catch(() => "{}"));
  await fs.mkdir(DIR, { recursive: true });

  // Offline (or blocked): leave everything as it is.
  try {
    await api(WIKIDATA, { action: "wbgetentities", ids: "Q5", props: "info" });
  } catch {
    console.log("photos: Wikimedia is not reachable, keeping the photos we have");
    return;
  }

  // Restore cached copies of photos we already know about (fresh build machines).
  for (const [id, p] of Object.entries(photos)) {
    const name = path.basename(p.src);
    const there = await fs.stat(path.join(DIR, name)).catch(() => null);
    if (!there) {
      const bytes = await fs.readFile(path.join(CACHE, name)).catch(() => null);
      if (bytes) await fs.writeFile(path.join(DIR, name), bytes);
      else delete photos[id];
    }
  }

  const missFile = path.join(CACHE, "misses.json");
  const misses = JSON.parse(await fs.readFile(missFile, "utf8").catch(() => "{}"));
  const fresh = (id) => misses[id] && Date.now() - misses[id] < RETRY_DAYS * 864e5;
  const ids = only.length ? only : Object.keys(people).filter((id) => !photos[id] && !(build && fresh(id)));
  const skipped = [];
  let added = 0;
  for (const id of ids) {
    const person = people[id];
    if (!person) { console.warn(`photos: no player ${id}`); continue; }
    if (person.photo === false) { delete photos[id]; continue; }
    try {
      const found = await fileFor(id, person);
      if (found.skip) { skipped.push(`${id} (${found.skip})`); misses[id] = Date.now(); continue; }
      photos[id] = { ...(await download(id, found.file)), ...(found.wikidata && { wikidata: found.wikidata }) };
      added++;
      delete misses[id];
      console.log(`photos: ${id} <- ${found.file}`);
    } catch (err) {
      skipped.push(`${id} (${err.message})`);
    }
    await pause(300);
  }

  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(missFile, JSON.stringify(misses));
  const sorted = Object.fromEntries(Object.entries(photos).sort(([a], [b]) => a.localeCompare(b)));
  await fs.writeFile(OUT, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`photos: ${added} added, ${Object.keys(sorted).length} in total, ${skipped.length} without one`);
  if (!build && skipped.length) console.log("  " + skipped.join("\n  "));
}

main().catch((err) => {
  console.warn(`photos: ${err.message}`);
  if (!build) process.exitCode = 1;
});
