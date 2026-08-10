// THE MADE MAN — the bloodline portrait (identity-NFT design §5 phase 1, off-chain, ungated).
//
// The centre of this suite is NOT "does it draw" — it is the BRIGHT LINE. The design's own §4 states
// the constraint ("a free, permanently-public, indexed-by-every-marketplace blob must be at most as
// revealing as the paid one") and then §3's slot table breaks it, keying the backdrop on district
// (live position — what the Wire's PAID tap sells) and the figure on build (on no public surface at
// all). So the load-bearing assertion here is structural rather than a spot check: **the ONLY source
// the route feeds the compositor is `portraitRow`, and `portraitRow` may return no field
// `publicDossier` does not already return.** Add `loc` to it and this fails by name.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { portraitSvg, portraitStateOf, portraitTraits, portraitRow } from '../src/portrait.js';
import { publicDossier } from '../src/cards.js';
import * as Rules from '../src/rules.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, opts = {}) => {
  const r = await app.inject({ method, url, headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {}, payload: opts.body });
  let body = r.body; try { body = JSON.parse(r.body); } catch { /* svg */ }
  return { code: r.statusCode, body, headers: r.headers };
};

// ════════════ deterministic + distinct ════════════
const st = (d) => portraitStateOf(d);
assert.equal(portraitSvg(st({ id: 'a', name: 'Vito' })), portraitSvg(st({ id: 'a', name: 'Vito' })),
  'the same state always renders the same portrait — no Math.random anywhere');
assert.notEqual(portraitSvg(st({ id: 'a', name: 'Vito' })), portraitSvg(st({ id: 'b', name: 'Vito' })),
  'different characters get different portraits');
const looks = new Set(); for (let i = 0; i < 200; i++) looks.add(portraitSvg(st({ id: 's' + i, name: 'N' })));
assert.ok(looks.size > 180, `portraits vary across characters (got ${looks.size}/200 distinct)`);

// ════════════ well-formed, and never emits a broken value ════════════
const one = portraitSvg(st({ id: 'x1', name: 'Sal Moretti', level: 44, generation: 3 }));
assert.ok(one.startsWith('<svg') && one.trimEnd().endsWith('</svg>'), 'a well-formed <svg>');
assert.ok(!/undefined|NaN/.test(one), 'no undefined/NaN leaked into the markup');
// a missing/blank state must still render — a stale share link stays an image, never a broken one
assert.ok(portraitSvg(st({})).startsWith('<svg'), 'an empty state still renders the house plate');

// ════════════ SVG ids are seed-unique — the console renders these in a GRID ════════════
// Two portraits on one page sharing a `clipPath` id would clip each other; avatar.js never needed
// ids so this hazard is new here.
const idsOf = (svg) => (svg.match(/id="([a-z]+[0-9a-z]+)"/g) || []).sort().join(',');
assert.notEqual(idsOf(portraitSvg(st({ id: 'p1', name: 'A' }))), idsOf(portraitSvg(st({ id: 'p2', name: 'B' }))),
  'two portraits on one page carry distinct SVG ids, so their clip paths and gradients cannot collide');

// ════════════ INJECTION — this one renders text, unlike the avatar ════════════
const evil = portraitSvg(st({ id: 'e', name: '"><script>alert(1)</script>', dynasty: '<img onerror=x>', tag: '</text>' }));
assert.ok(!evil.includes('<script>'), 'a hostile street name is escaped, not rendered');
assert.ok(!evil.includes('alert(1)') || evil.includes('&lt;script&gt;'), 'the payload is entity-escaped');
assert.ok(!evil.includes('<img onerror'), 'a hostile dynasty name is escaped too');
assert.ok(!/<\/text>[^<]/.test(evil.replace(/&lt;\/text&gt;/g, '')), 'a tag that would close the text element is escaped');

// ════════════ WEALTH IS ABSENT IN ANY FORM (design §4's hard rule) ════════════
const rich = portraitSvg(st({ id: 'r', name: 'Rich Man', level: 99, generation: 8, dynasty: 'Gold', tag: 'AU' }));
assert.ok(!/\$[0-9]/.test(rich), 'no dollar figure anywhere in the portrait — it is not a wealth scanner');

// ════════════ it CHANGES with play — the whole reason the fee gets a thing ════════════
const lowRank = st({ id: 'same', name: 'Same Man', level: 2, generation: 1 });
const highRank = st({ id: 'same', name: 'Same Man', level: 95, generation: 1 });
assert.notEqual(lowRank.rank, highRank.rank, 'the coat climbs the RANKS ladder as the street levels');
assert.notEqual(portraitSvg(lowRank), portraitSvg(highRank), 'and the portrait visibly changes with it');
const gen1 = st({ id: 'same', name: 'Same Man', level: 20, generation: 1 });
const gen9 = st({ id: 'same', name: 'Same Man', level: 20, generation: 9 });
assert.notEqual(gen1.frame.name, gen9.frame.name, 'the FRAME deepens as the bloodline buries generations');
assert.equal(gen1.backdrop.name, gen9.backdrop.name, 'but the corner they came up on never moves — it is fixed at birth');

// ════════════ THE RETIRED-PORTFOLIO RE-SOURCE (the design's own flagged defect) ════════════
// §4's trait table and §3's frame slot both cite `dynastyTierOf`, which went with the Portfolio at
// D11. Assert it is genuinely gone, so nobody "restores" the frame to a dead dependency.
assert.equal(typeof Rules.dynastyTierOf, 'undefined', 'dynastyTierOf is retired (D11) — the frame must not be re-sourced to it');
// the frame ladder only ever moves FORWARD with generation — a deeper bloodline can never be handed
// a shallower frame, and the ladder must actually climb (a single frame for every generation would
// satisfy "never goes back" while making the feature a no-op).
const frameSeq = [1, 2, 3, 5, 8, 13, 40].map((g) => st({ id: 'f', name: 'F', generation: g }).frame);
for (let i = 1; i < frameSeq.length; i++) {
  assert.ok(frameSeq[i].upTo >= frameSeq[i - 1].upTo,
    `generation only deepens the frame — ${frameSeq[i - 1].name} → ${frameSeq[i].name} went backwards`);
}
assert.ok(new Set(frameSeq.map((f) => f.name)).size >= 5, 'and the ladder genuinely climbs across a bloodline\'s life');

// ════════════ the engraved generation is never a LIE ════════════
// The first cut clamped the roman-numeral INDEX, so a twelfth-generation line was engraved "GEN X".
// A plate is the one place a wrong number is permanent.
const g12 = portraitSvg(st({ id: 'g', name: 'Twelve', generation: 12 }));
assert.ok(g12.includes('GEN 12'), 'a twelfth-generation bloodline is engraved GEN 12');
assert.ok(!/GEN X[^I]/.test(g12), 'and never mis-engraved as GEN X');
assert.ok(portraitSvg(st({ id: 'g', name: 'Nine', generation: 9 })).includes('GEN IX'), 'roman where a reader parses it at a glance');

// ════════════ the plate CLAMPS rather than overflowing the frame ════════════
const longest = portraitSvg(st({
  id: 'L', name: 'Maximilian Thorncastle III', level: 99, generation: 10,
  dynasty: 'The Thorncastle Dynasty Of The Eastern Docks', tag: 'THN',
}));
assert.ok(longest.includes('…'), 'an unbounded dynasty + name is clamped with an ellipsis, not run off the plate');

// ════════════ THE BRIGHT LINE — the structural one ════════════
const guest = (await call('POST', '/v1/auth/guest')).body.token;
await call('POST', '/v1/character', { token: guest, body: { name: 'Portrait Pete' } });
const me = (await call('GET', '/v1/me', { token: guest })).body;
const charId = me.id || me.character?.id;
const acct = (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [charId])).rows[0].a;
await pool.query("UPDATE characters SET respect=1700, welsher=true WHERE id=$1", [charId]);
await pool.query("UPDATE account_persistent SET kills=7, hitman_rep=140, dynasty_name='The Pete Line', deaths=2 WHERE account_id=$1", [acct]);

const row = await portraitRow(pool, charId);
const dossier = await publicDossier(pool, 'Portrait Pete');
// `id` is the ROUTE PARAMETER — the caller supplied it to ask for this portrait at all, and it is
// used only as the art seed, so it discloses nothing. Every other field must be on the public dossier.
const SUPPLIED_BY_CALLER = new Set(['id']);
const extra = Object.keys(row).filter((k) => !(k in dossier) && !SUPPLIED_BY_CALLER.has(k));
assert.deepEqual(extra, [],
  `the portrait's ONLY data source may expose no field the public dossier does not — found: ${extra.join(', ')}. `
  + 'A keyless image keyed on anything the PAID Wire dossier sells (position, build, the rat flag) is a scanner.');
assert.ok(!('loc' in row) && !('muscle' in row) && !('cash' in row),
  'position, build and wealth are absent by name as well as by rule');

// the derived state carries the public facts through
assert.equal(row.generation, 3, 'generation is deaths + 1, exactly as the dossier computes it');
assert.equal(row.welsher, true, 'a public flag reaches the portrait');
assert.ok(row.hitmanRank, 'the assassin rank resolves to a title');

// ════════════ the routes ════════════
const svg = await call('GET', `/v1/identity/${charId}/portrait.svg`);
assert.equal(svg.code, 200, 'the portrait serves 200 with no auth (public + keyless, like the avatar)');
assert.match(svg.headers['content-type'], /image\/svg\+xml/, 'served as SVG');
assert.ok(svg.body.includes('Portrait Pete'), 'the plate is engraved with the street name');
assert.ok(!/\$[0-9]/.test(svg.body), 'the served portrait carries no dollar figure');
// cacheable, but NOT immutable — unlike an avatar this one changes as the street plays
assert.ok(/max-age/.test(svg.headers['cache-control']) && !/immutable/.test(svg.headers['cache-control']),
  'cached briefly, never immutably — the portrait is dynamic');
// an unknown id is an image, not a 404 — a stale share link must not break
const ghost = await call('GET', '/v1/identity/no-such-character/portrait.svg');
assert.equal(ghost.code, 200, 'an unknown character still serves the house plate rather than a broken image');

// metadata (design §5 phase 2 — reviewable, pointing at no token)
const meta = await call('GET', `/v1/identity/${charId}`);
assert.equal(meta.code, 200, 'the metadata route serves');
assert.ok(meta.body.name.includes('Portrait Pete') && meta.body.image.includes('/portrait.svg'),
  'ERC-721 metadata shape: name + image');
assert.ok(Array.isArray(meta.body.attributes) && meta.body.attributes.length > 0, 'attributes are the trait list');
const traitNames = meta.body.attributes.map((a) => a.trait_type);
assert.ok(traitNames.includes('Generation') && traitNames.includes('Rank'), 'the public traits are there');
assert.ok(!traitNames.some((t) => /wealth|cash|bank|omr|worth/i.test(t)), 'and no wealth trait, in any form');
assert.equal((await call('GET', '/v1/identity/no-such-character')).code, 404, 'metadata for nobody is a clean 404');

// The rat flag is a PAID Wire signal, and the design's §3 would have spent it for free ("a broken
// frame for a rat"). Asserted as INVARIANCE rather than by scanning for the word — `/rat/i` matches
// "gene-RAT-ion", which is how the first cut of this failed.
const beforeRat = (await call('GET', `/v1/identity/${charId}/portrait.svg`)).body;
const ratUpd = await pool.query("UPDATE account_persistent SET rat=true WHERE account_id=$1", [acct]);
assert.equal(ratUpd.rowCount, 1, 'the rat flag really was set — otherwise the check below is vacuous');
const afterRat = (await call('GET', `/v1/identity/${charId}/portrait.svg`)).body;
assert.equal(afterRat, beforeRat, 'turning a man into a rat changes his portrait not at all — that mark is sold on the Wire, never given away on a keyless image');

// ════════════ §10.4 — art moves no value ════════════
const tx0 = Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);
await call('GET', `/v1/identity/${charId}/portrait.svg`);
await call('GET', `/v1/identity/${charId}`);
assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n), tx0,
  'serving the portrait and its metadata writes no ledger rows');

console.log('✅ THE MADE MAN (identity phase 1) — the bloodline portrait composites six slots live from '
  + 'PUBLIC state only: the bright line is structural (its one data source may expose no field publicDossier '
  + 'does not, so the district/build/rat leaks the design\'s slot table would have shipped fail by name), the '
  + 'plate escapes every untrusted string and clamps rather than overflowing, the engraved generation is never '
  + 'a lie, ids are seed-unique so a grid cannot self-clip, the frame is re-sourced off the RETIRED dynastyTierOf '
  + 'to generation, wealth is absent in any form, and the whole surface moves no value.');
await app.close();
process.exit(0);
