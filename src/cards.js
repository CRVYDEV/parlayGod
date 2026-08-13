// ── src/cards.js — THE BROADCAST: the organic-growth surface on top of §7.13 referrals ──
// Players champion the game by SHARING things they're proud of. Two multipliers over the existing
// referral system:
//   (1) frictionless attribution — every share links to /u/<name>?ref=<name>, and the client auto-fills
//       that as the referralCode on sign-up (no more typing a code), so word-of-mouth actually credits.
//   (2) shareable VISUAL content — gorgeous 1200×630 noir posters (a WANTED poster, a LEGEND card, a
//       KILL notice) that unfurl in a feed and pull clicks a text link never would.
// PUBLIC + keyless + read-only; ZERO §10.4 surface (status/marketing only). Wealth is never exact
// (the anti-precise-kill-EV rule) — a card flexes rank/level/kills/family, never a dollar figure.
import { readFileSync } from 'node:fs';
import { levelOf, hitmanRankOf, SOCIAL_X_HANDLE } from './rules.js';

const GOLD = '#c9a24b', DIM = '#8f7433', TEAL = '#4fd6c2', BLOOD = '#9b2f2f', INK = '#e8e2d4', BG = '#0c0d11';
// ONE escape for every public surface. Exported because `portrait.js` engraves untrusted names
// onto a keyless image and a second private copy is the class this project has been bitten by: a
// fix to an escaping gap must reach every site that escapes, not just the one it was found in.
export const esc = (s) => String(s == null ? '' : s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

// ── the safe public dossier (by living name; falls back to the most recent bearer) ──
export async function publicDossier(pool, name) {
  const row = (await pool.query(
    `SELECT c.id, c.name, c.respect, c.alive, c.wanted_until, c.welsher, c.season_kills, c.bio,
            ap.hitman_rep, ap.kills, ap.dynasty_name, ap.deaths,
            g.name AS gang, g.tag AS tag, cr.name AS crew
       FROM characters c
       LEFT JOIN account_persistent ap ON ap.account_id = c.account_id
       LEFT JOIN gang_members gm ON gm.character_id = c.id
       LEFT JOIN gangs g ON g.id = gm.gang_id
       LEFT JOIN crew_members cm ON cm.account_id = c.account_id
       LEFT JOIN crews cr ON cr.id = cm.crew_id
      WHERE lower(c.name) = lower($1)
      ORDER BY c.alive DESC LIMIT 1`, [String(name || '')])).rows[0];
  if (!row) return { found: false, name: String(name || '') };
  let bounty = 0;
  try { bounty = Number((await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS s FROM bounty_contributors WHERE target_character=$1 AND kind='kill'`, [row.id])).rows[0].s) || 0; } catch { /* pre-schema */ }
  const wanted = row.wanted_until && new Date(row.wanted_until) > new Date();
  return {
    found: true, name: row.name, level: levelOf(Number(row.respect) || 0), alive: !!row.alive,
    gang: row.gang || null, tag: row.tag || null, crew: row.crew || null,
    kills: Number(row.kills) || 0, hitmanRank: hitmanRankOf(Number(row.hitman_rep) || 0).title,
    wanted: !!wanted, welsher: !!row.welsher, bounty,
    dynasty: row.dynasty_name || null,
    bio: row.bio || null,   // IDENTITY — the free "about me" blurb (status text; the profile funnel)
    // the bloodline's depth (generations before this street) — a status flex, never a currency
    generation: (Number(row.deaths) || 0) + 1,
  };
}

// ── THE BEEF — the rivalry dossier. The genre's viral unit is not a stat card, it's BEEF: "look what
// this guy did to me, come help me end him." kill_log is already public (it drives the feud ledger),
// so counting the bodies between two bloodlines is public-safe by construction — no wealth, no exact
// figures, just who has put whom in the river and how many times. Resolves two living names.
export async function beefDossier(pool, nameA, nameB) {
  const one = async (n) => (await pool.query(
    `SELECT c.account_id, c.name, c.respect, g.tag
       FROM characters c LEFT JOIN gang_members gm ON gm.character_id = c.id
       LEFT JOIN gangs g ON g.id = gm.gang_id
      WHERE lower(c.name) = lower($1) ORDER BY c.alive DESC LIMIT 1`, [String(n || '')])).rows[0];
  const a = await one(nameA), b = await one(nameB);
  if (!a || !b || a.account_id === b.account_id) return { found: false, a: { name: String(nameA || '') }, b: { name: String(nameB || '') } };
  const between = async (k, v) => Number((await pool.query(
    'SELECT count(*) c FROM kill_log WHERE killer_account=$1 AND victim_account=$2', [k, v])).rows[0].c) || 0;
  const aKills = await between(a.account_id, b.account_id);
  const bKills = await between(b.account_id, a.account_id);
  const info = (r) => ({ name: r.name, tag: r.tag || null, level: levelOf(Number(r.respect) || 0) });
  return { found: true, a: info(a), b: info(b), aKills, bKills, total: aKills + bKills,
    // who's ahead — the tension the share carries
    leader: aKills > bKills ? 'a' : bKills > aKills ? 'b' : 'even' };
}

// ── shared poster frame (1200×630 — the OG-image ratio; unfurls in a feed) ──
const W = 1200, H = 630;

// THE PLATE. These are the highest-leverage art in the game: a share on X unfurls this, so it is
// what someone who has never heard of OMERTÀ sees first. Each type gets its own generated plate
// (docs/ART.md), read ONCE at boot and inlined as a data URI — the SVG has to be self-contained
// because resvg rasterises it to PNG for feeds that will not unfurl an SVG, and it cannot fetch.
//
// The plates were generated with a deliberately EMPTY middle so the name and stat line land on
// darkness. The scrim below is belt-and-braces on top of that: a photograph that is merely dim is
// still busier than a flat fill, and legibility beats atmosphere on a card nobody chose to look at.
// A missing file degrades to the old flat background rather than throwing — art is decoration here,
// never a dependency.
const PLATES = {};
for (const [type, file] of Object.entries({
  legend: 'card-legend', wanted: 'card-wanted', whacked: 'card-whacked', join: 'card-join',
})) {
  try {
    const p = new URL(`../public/art/${file}.jpg`, import.meta.url);
    PLATES[type] = `data:image/jpeg;base64,${readFileSync(p).toString('base64')}`;
  } catch { /* no plate — the flat fill stands in */ }
}

function frame(inner, opts = {}) {
  const accent = opts.accent || GOLD;
  const plate = PLATES[opts.plate];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Georgia,'Times New Roman',serif">
    <rect width="${W}" height="${H}" fill="${BG}"/>
    ${plate ? `<image href="${plate}" x="0" y="0" width="${W}" height="${H}"
        preserveAspectRatio="xMidYMid slice" opacity="0.62"/>
      <rect width="${W}" height="${H}" fill="${BG}" opacity="0.42"/>` : ''}
    <rect x="8" y="8" width="${W - 16}" height="${H - 16}" fill="none" stroke="${accent}" stroke-width="2" opacity="0.35"/>
    <rect x="20" y="20" width="${W - 40}" height="${H - 40}" fill="none" stroke="${DIM}" stroke-width="1" opacity="0.4"/>
    <g fill="${accent}" opacity="0.5">
      <path d="M40 40 h34 M40 40 v34" stroke="${accent}" stroke-width="2" fill="none"/>
      <path d="M${W - 40} 40 h-34 M${W - 40} 40 v34" stroke="${accent}" stroke-width="2" fill="none"/>
      <path d="M40 ${H - 40} h34 M40 ${H - 40} v-34" stroke="${accent}" stroke-width="2" fill="none"/>
      <path d="M${W - 40} ${H - 40} h-34 M${W - 40} ${H - 40} v-34" stroke="${accent}" stroke-width="2" fill="none"/>
    </g>
    <text x="60" y="86" fill="${GOLD}" font-size="26" letter-spacing="10">OMERTÀ</text>
    <text x="${W - 60}" y="86" text-anchor="end" fill="${DIM}" font-size="15" letter-spacing="4">A NOIR MOB RPG</text>
    ${inner}
    ${opts.cta ? `<text x="${W / 2}" y="${H - 48}" text-anchor="middle" fill="${accent}" font-size="24" letter-spacing="1">${esc(opts.cta)}</text>` : ''}
  </svg>`;
}
const fedora = (cx, cy, s = 1, col = GOLD) => `<g transform="translate(${cx} ${cy}) scale(${s})" stroke="${col}" stroke-width="4" fill="none" stroke-linejoin="round" stroke-linecap="round">
  <path d="M-70 20 Q0 44 70 20"/><path d="M-52 18 Q-50 -22 0 -24 Q50 -22 52 18"/><path d="M-40 -2 Q0 12 40 -2" stroke="${DIM}"/></g>`;
const mug = (cx, cy) => `<g transform="translate(${cx} ${cy})" stroke="${GOLD}" stroke-width="3" fill="none">
  <circle cx="0" cy="-24" r="34"/><path d="M-52 70 Q-52 6 0 6 Q52 6 52 70"/><path d="M-58 -34 Q-30 -58 0 -56 Q30 -58 58 -34" stroke="${DIM}"/></g>`;

// ── the cards ──
export function card(type, d, ref) {
  const cta = ref ? `${esc(ref)} sent you  ·  claim your street at omertà` : 'claim your street  ·  omertà';
  const fam = d.gang ? `${esc(d.gang)}${d.tag ? ` [${esc(d.tag)}]` : ''}` : 'no family — a lone wolf';
  if (type === 'wanted') {
    const price = d.bounty > 0 ? `$${Number(d.bounty).toLocaleString('en-US')} ON THEIR HEAD`
      : d.wanted ? 'MARKED FOR THE RIVER' : 'A NAME WORTH KNOWING';
    return frame(`
      ${mug(W / 2, 250)}
      <text x="${W / 2}" y="170" text-anchor="middle" fill="${BLOOD}" font-size="84" letter-spacing="14" font-weight="bold">WANTED</text>
      <text x="${W / 2}" y="380" text-anchor="middle" fill="${INK}" font-size="64">${esc(d.name)}</text>
      <text x="${W / 2}" y="428" text-anchor="middle" fill="${GOLD}" font-size="30" letter-spacing="3">${price}</text>
      <text x="${W / 2}" y="470" text-anchor="middle" fill="${DIM}" font-size="22">${fam} · dead or alive</text>`,
      { accent: BLOOD, cta, plate: 'wanted' });
  }
  if (type === 'whacked') {
    return frame(`
      <text x="${W / 2}" y="200" text-anchor="middle" fill="${BLOOD}" font-size="72" letter-spacing="8">ANOTHER BODY</text>
      <text x="${W / 2}" y="320" text-anchor="middle" fill="${INK}" font-size="52">${esc(d.name)}</text>
      <text x="${W / 2}" y="372" text-anchor="middle" fill="${DIM}" font-size="26">${esc(d.subject || 'put in the river')}</text>
      ${fedora(W / 2, 470, 1.1, BLOOD)}`, { accent: BLOOD, cta, plate: 'whacked' });
  }
  if (type === 'join') {
    return frame(`
      ${fedora(W / 2, 220, 1.5)}
      <text x="${W / 2}" y="360" text-anchor="middle" fill="${INK}" font-size="52">${esc(d.name)} runs with ${fam}.</text>
      <text x="${W / 2}" y="418" text-anchor="middle" fill="${GOLD}" font-size="34" letter-spacing="2">Think you can take the city?</text>`,
      { cta, plate: 'join' });
  }
  // legend (default) — the proud-player flex + the profile's unfurl image
  const accent = GOLD;
  const title = `${esc(d.hitmanRank)}${d.gang ? ` of ${esc(d.gang)}` : ''}`;
  const stat = (x, big, lab) => `<text x="${x}" y="430" text-anchor="middle" fill="${accent}" font-size="58">${esc(big)}</text>
    <text x="${x}" y="470" text-anchor="middle" fill="${DIM}" font-size="20" letter-spacing="3">${esc(lab)}</text>`;
  return frame(`
    ${fedora(W / 2, 175, 1.15, accent)}
    <text x="${W / 2}" y="300" text-anchor="middle" fill="${INK}" font-size="70">${esc(d.name)}</text>
    <text x="${W / 2}" y="344" text-anchor="middle" fill="${accent}" font-size="28" letter-spacing="2">${title}${!d.alive ? ' · a ghost' : ''}</text>
    ${stat(W * 0.28, 'LVL ' + d.level, 'RESPECT')}
    ${stat(W * 0.5, d.kills, d.kills === 1 ? 'KILL' : 'KILLS')}
    ${stat(W * 0.72, d.wanted ? 'WANTED' : d.welsher ? 'WELSHER' : 'CLEAN', 'STANDING')}`,
    { accent, cta, plate: 'legend' });
}

// ── THE BEEF CARD — a rivalry poster. Two mugs, the body count between them, and who's ahead.
// The shareable "come help me end him" artifact. Public-safe: kill counts only, never wealth. ──
export function beefCard(d, ref) {
  const cta = ref ? `${esc(ref)} sent you  ·  pick a side at omertà` : 'pick a side  ·  omertà';
  if (!d.found) {
    return frame(`
      <text x="${W / 2}" y="240" text-anchor="middle" fill="${BLOOD}" font-size="64" letter-spacing="8">NO BLOOD SPILLED</text>
      <text x="${W / 2}" y="330" text-anchor="middle" fill="${INK}" font-size="40">${esc(d.a?.name || '?')} &amp; ${esc(d.b?.name || '?')}</text>
      <text x="${W / 2}" y="386" text-anchor="middle" fill="${DIM}" font-size="26">— not yet, anyway.</text>`,
      { accent: BLOOD, cta, plate: 'whacked' });
  }
  const nameOf = (x) => `${esc(x.name)}${x.tag ? ` [${esc(x.tag)}]` : ''}`;
  const aWin = d.leader === 'a', bWin = d.leader === 'b';
  return frame(`
    <text x="${W / 2}" y="150" text-anchor="middle" fill="${BLOOD}" font-size="60" letter-spacing="8" font-weight="bold">BLOOD BETWEEN THEM</text>
    ${mug(W * 0.26, 300)}
    ${mug(W * 0.74, 300)}
    <text x="${W / 2}" y="300" text-anchor="middle" fill="${GOLD}" font-size="44" letter-spacing="4">VS</text>
    <text x="${W * 0.26}" y="410" text-anchor="middle" fill="${aWin ? INK : DIM}" font-size="34">${nameOf(d.a)}</text>
    <text x="${W * 0.74}" y="410" text-anchor="middle" fill="${bWin ? INK : DIM}" font-size="34">${nameOf(d.b)}</text>
    <text x="${W * 0.26}" y="474" text-anchor="middle" fill="${aWin ? BLOOD : DIM}" font-size="56" font-weight="bold">${d.aKills}</text>
    <text x="${W * 0.74}" y="474" text-anchor="middle" fill="${bWin ? BLOOD : DIM}" font-size="56" font-weight="bold">${d.bKills}</text>
    <text x="${W / 2}" y="520" text-anchor="middle" fill="${DIM}" font-size="24" letter-spacing="2">${d.total} ${d.total === 1 ? 'body' : 'bodies'} · ${d.leader === 'even' ? 'a dead-even feud' : `${esc((aWin ? d.a : d.b).name)} is ahead`}</text>`,
    { accent: BLOOD, cta, plate: 'whacked' });
}

// ── the public profile page — the "champion" destination; a shared link lands here ──
export function profilePage(d, baseUrl, ref) {
  // og:image points at the PNG variant — X/Twitter/most feeds won't unfurl an SVG (server rasterizes,
  // falling back to SVG bytes if no rasterizer is installed).
  const cardUrl = `${baseUrl}/card/legend/${encodeURIComponent(d.name)}.png`;
  const enter = `${baseUrl}/?ref=${encodeURIComponent(ref || d.name)}`;
  const title = d.found ? `${d.name} — ${d.hitmanRank}` : 'OMERTÀ — the city';
  const desc = d.found
    ? `${d.hitmanRank} · Level ${d.level} · ${d.kills} ${d.kills === 1 ? 'kill' : 'kills'} · ${d.gang ? d.gang : (d.crew ? d.crew : 'a lone wolf')}${d.dynasty ? ` · the ${d.dynasty} dynasty` : ''}${d.wanted ? ' · WANTED' : ''}. Come take the city.`
    : 'A noir mob RPG. Build a family, run the rackets, and try to survive the street.';
  const inline = d.found ? card('legend', d, ref || d.name) : card('join', { name: 'The City', gang: null }, ref);
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(cardUrl)}"><meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@${esc(SOCIAL_X_HANDLE)}"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(cardUrl)}">
<style>:root{color-scheme:dark}body{margin:0;background:#0c0d11;
  color:${INK};font-family:'Helvetica Neue',Arial,sans-serif;min-height:100vh;display:grid;place-items:center;padding:32px;position:relative}
/* THE BACKDROP. This page is the referral LANDING — every share link points here — so it was the one
   surface where a flat gradient cost real conversion.
   ROOT-RELATIVE on purpose, unlike og:image above. og:image is fetched by a CRAWLER with no page
   context, so it has to be absolute off baseUrl; this is fetched by the VISITOR'S browser from the
   origin it is already on, so a relative path is strictly more robust — it works whether or not
   PUBLIC_URL happens to be set, and cannot point at a different host than the one serving the page.
   If the file is ever missing the scrim below still stands on its own and nothing breaks. */
body::before{content:'';position:fixed;inset:0;z-index:-2;
  background:url('/art/hero-poster.jpg') center 62%/cover no-repeat;opacity:.5}
body::after{content:'';position:fixed;inset:0;z-index:-1;
  background:radial-gradient(120% 90% at 50% 40%,rgba(12,13,17,.70),rgba(12,13,17,.93) 62%,#0c0d11 100%)}
.wrap{max-width:780px;width:100%;text-align:center;position:relative}
.what{color:${DIM};font-size:13.5px;line-height:1.65;max-width:56ch;margin:20px auto 0}
.what b{color:${GOLD};font-weight:400}
.card{width:100%;border:1px solid #2a2d37;border-radius:6px;overflow:hidden;box-shadow:0 20px 60px #0009;margin-bottom:26px}
.card svg{display:block;width:100%;height:auto}
h1{font-family:Georgia,serif;font-size:15px;letter-spacing:.3em;color:${GOLD};text-transform:uppercase;margin:0 0 18px}
.enter{display:inline-block;font-family:Georgia,serif;font-size:20px;letter-spacing:.04em;color:${BG};
  background:${GOLD};padding:15px 40px;border-radius:4px;text-decoration:none;font-weight:600}
.enter:hover{background:#dab55e}
.sub{color:${DIM};font-size:13px;margin-top:16px;max-width:52ch;margin-left:auto;margin-right:auto;line-height:1.5}
/* THE DOSSIER STRIP — a visitor should see a SPECIFIC, impressive person, not a generic pitch. Banded
   status only (rank/level/kills/family/crew/dynasty) — never a dollar figure (the anti-precise-kill-EV
   rule holds on a public, marketplace-indexed page exactly as on the paid Wire dossier). */
.dossier{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:0 0 22px}
.dtile{border:1px solid #2a2d37;border-radius:5px;padding:9px 15px;min-width:78px;background:rgba(20,16,10,.45)}
.dtile .v{font-family:Georgia,serif;font-size:21px;color:${GOLD};line-height:1.1}
.dtile .l{font-size:10px;letter-spacing:.18em;color:${DIM};text-transform:uppercase;margin-top:3px}
.dtile.warn .v{color:#d98a3a}</style>
</head><body><div class="wrap">
<h1>Omertà · the wire</h1>
<div class="card">${inline}</div>
${d.found ? `<div class="dossier">
  <div class="dtile"><div class="v">${d.level}</div><div class="l">Level</div></div>
  <div class="dtile"><div class="v">${d.kills}</div><div class="l">${d.kills === 1 ? 'Kill' : 'Kills'}</div></div>
  <div class="dtile"><div class="v" style="font-size:15px">${esc(d.hitmanRank)}</div><div class="l">Reputation</div></div>
  ${d.gang ? `<div class="dtile"><div class="v" style="font-size:15px">${esc(d.gang)}</div><div class="l">Family</div></div>` : ''}
  ${d.crew ? `<div class="dtile"><div class="v" style="font-size:15px">${esc(d.crew)}</div><div class="l">Crew</div></div>` : ''}
  ${d.dynasty ? `<div class="dtile"><div class="v" style="font-size:15px">${esc(d.dynasty)}</div><div class="l">Dynasty · Gen ${d.generation}</div></div>` : (d.generation > 1 ? `<div class="dtile"><div class="v">Gen ${d.generation}</div><div class="l">Bloodline</div></div>` : '')}
  ${d.wanted ? '<div class="dtile warn"><div class="v" style="font-size:15px">WANTED</div><div class="l">Standing</div></div>' : (d.welsher ? '<div class="dtile warn"><div class="v" style="font-size:15px">WELSHER</div><div class="l">Standing</div></div>' : '')}
</div>` : ''}
${d.found && d.bio ? `<p class="what" style="font-style:italic">“${esc(d.bio)}”</p>` : ''}
<a class="enter" href="${esc(enter)}">ENTER THE CITY →</a>
<p class="sub">${d.found ? `You're looking at ${esc(d.name)}'s sheet. Start your own street — free, no wallet needed${ref || d.name ? `, and ${esc(ref || d.name)} gets credit for bringing you in.` : '.'}` : 'A noir mob RPG — build a family, run the rackets, survive the street.'}</p>
${d.found ? `<p class="what">A noir mafia RPG. Pull jobs, run a kitchen, take turf, and put a rival in the river —
or <b>go legit</b> and die in bed. <b>Death is real</b>: your street dies, but the bloodline carries on.
Everything runs on one honest ledger, and the city never stops moving.</p>` : ''}
</div></body></html>`;
}

// ── THE BEEF PAGE — the shareable rivalry destination. A link to /beef/A/B unfurls the beef card
// (og:image) and lands a visitor on "pick a side". The genre's viral unit: come help me end him. ──
export function beefPage(d, baseUrl, ref) {
  const A = d.a?.name || '?', B = d.b?.name || '?';
  const cardUrl = `${baseUrl}/card/beef/${encodeURIComponent(A)}/${encodeURIComponent(B)}.png`;
  const enter = `${baseUrl}/?ref=${encodeURIComponent(ref || A)}`;
  const title = `${A} vs ${B} — a feud in OMERTÀ`;
  const desc = d.found
    ? `${d.total} ${d.total === 1 ? 'body' : 'bodies'} between them${d.leader === 'even' ? ' — dead even' : ` · ${(d.leader === 'a' ? d.a : d.b).name} is ahead`}. Pick a side.`
    : `${A} and ${B} — no blood spilled yet. Start something.`;
  const inline = beefCard(d, ref || A);
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(cardUrl)}"><meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@${esc(SOCIAL_X_HANDLE)}"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(cardUrl)}">
<style>:root{color-scheme:dark}body{margin:0;background:#0c0d11;color:${INK};font-family:'Helvetica Neue',Arial,sans-serif;min-height:100vh;display:grid;place-items:center;padding:32px;position:relative}
body::before{content:'';position:fixed;inset:0;z-index:-2;background:url('/art/hero-poster.jpg') center 62%/cover no-repeat;opacity:.5}
body::after{content:'';position:fixed;inset:0;z-index:-1;background:radial-gradient(120% 90% at 50% 40%,rgba(12,13,17,.70),rgba(12,13,17,.93) 62%,#0c0d11 100%)}
.wrap{max-width:780px;width:100%;text-align:center;position:relative}
.card{width:100%;border:1px solid #2a2d37;border-radius:6px;overflow:hidden;box-shadow:0 20px 60px #0009;margin-bottom:26px}
.card svg{display:block;width:100%;height:auto}
h1{font-family:Georgia,serif;font-size:15px;letter-spacing:.3em;color:${BLOOD};text-transform:uppercase;margin:0 0 18px}
.enter{display:inline-block;font-family:Georgia,serif;font-size:20px;letter-spacing:.04em;color:${BG};background:${GOLD};padding:15px 40px;border-radius:4px;text-decoration:none;font-weight:600}
.sub{color:${DIM};font-size:13px;margin-top:16px;max-width:52ch;margin-left:auto;margin-right:auto;line-height:1.5}</style>
</head><body><div class="wrap">
<h1>Omertà · blood between them</h1>
<div class="card">${inline}</div>
<a class="enter" href="${esc(enter)}">ENTER THE CITY →</a>
<p class="sub">${d.found ? `${esc(A)} and ${esc(B)} have a feud in OMERTÀ — ${d.total} ${d.total === 1 ? 'body' : 'bodies'} and counting. Start your own street — free, no wallet needed${ref ? `, and ${esc(ref)} gets credit for bringing you in.` : '.'}` : 'A noir mob RPG — build a family, run the rackets, survive the street.'}</p>
</div></body></html>`;
}
