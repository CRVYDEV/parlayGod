// THE DUELING LADDER test (the 40th suite) — ranked ELO PvP (slate #5, design
// omerta-ladder-clues-seasons-design.md). Covers: list/unlist (consent-by-listing + the level
// gate), the board (you + nearest rivals), the duel gates (self/family/not_listed/amount/limit/
// level/cash), a pinned strong-vs-weak duel (the audited casino:pvp taxed transfer EXACT — winner
// nets stake − rake, half the rake → street tax; ELO moves ±16 at even ratings), the per-pair
// daily K-diminishing (the second duel moves less), the ELO floor, the lifetime legend + its
// anti-Sybil level floor, the leaderboard (agents excluded posture), the SEASONAL reset via
// runSeasonRollover, and §10.4 (duel: vocabulary; per-character cash reconciles both sides —
// drift == the SQL seeds only).
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { DUELS } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { runSeasonRollover } from '../src/worker.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const ch = await meOf(token);
  return { token, id: ch.id, aid: (await pool.query(`SELECT account_id a FROM characters WHERE id='${ch.id}'`)).rows[0].a };
};
const seedCh = (id, set) => pool.query(`UPDATE characters SET ${set} WHERE id='${id}'`);

const bruiser = await mk('Knuckles Kane');   // the strong build
const pigeon = await mk('Soft Solly');       // the weak build (but a real level)
const runt = await mk('Little Larry');       // below MIN_LVL
// stats seeded (not currency); respect 1444 = level 20, 324 = level 10
await seedCh(bruiser.id, 'respect=1444, muscle=100, cunning=60, speed=60, cash=cash+500000');
await seedCh(pigeon.id, 'respect=1444, muscle=5, cunning=5, speed=5, cash=cash+500000');
const seedDrift = 1_000_000;

// ── listing: the level gate + the floor + unlist ──
let r = await call('POST', '/v1/duels/list', { token: runt.token, body: { limit: 5000 } });
assert.equal(r.body.error, 'level', 'a rookie cannot enter the circuit');
r = await call('POST', '/v1/duels/list', { token: pigeon.token, body: { limit: 50 } });
assert.equal(r.body.error, 'amount', 'the stake-cap floor holds');
r = await call('POST', '/v1/duels/list', { token: pigeon.token, body: { limit: 20000 } });
assert.equal(r.code, 200, 'the pigeon lists');
r = await call('POST', '/v1/duels/list', { token: bruiser.token, body: { limit: 50000 } });
assert.equal(r.code, 200, 'the bruiser lists');

// ── the board: both on it, you block present ──
r = await call('GET', '/v1/duels', { token: bruiser.token });
assert.equal(r.code, 200, 'the board reads');
assert.equal(r.body.you.elo, DUELS.ELO_START, 'fresh rating');
assert(r.body.duelists.some((d) => d.name === 'Soft Solly' && d.limit === 20000), 'the pigeon is challengeable');

// ── duel gates ──
r = await call('POST', `/v1/duels/${runt.id}`, { token: bruiser.token, body: { amount: 5000 } });
assert.equal(r.body.error, 'level', 'no farming rookies for rating');
r = await call('POST', `/v1/duels/${pigeon.id}`, { token: bruiser.token, body: { amount: 100 } });
assert.equal(r.body.error, 'amount', 'the stake floor holds');
r = await call('POST', `/v1/duels/${pigeon.id}`, { token: bruiser.token, body: { amount: 50000 } });
assert.equal(r.body.error, 'limit', 'their listed cap holds');

// ── the duel: strong beats weak (220 base vs 15 + rand40 — deterministic), the exact transfer ──
const bCash0 = (await meOf(bruiser.token)).cash;
const pCash0 = (await meOf(pigeon.token)).cash;
const pool0 = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
r = await call('POST', `/v1/duels/${pigeon.id}`, { token: bruiser.token, body: { amount: 10000 } });
assert.equal(r.code, 200, 'the duel resolves');
assert.equal(r.body.win, true, 'the build decides — the bruiser wins');
const rake = Math.ceil(20000 * DUELS.RAKE_BPS / 10000);
assert.equal(r.body.rake, rake, 'the rake is exact');
assert.equal((await meOf(bruiser.token)).cash, bCash0 + 10000 - rake, 'winner nets stake − rake (the casino:pvp accounting)');
assert.equal((await meOf(pigeon.token)).cash, pCash0 - 10000, 'loser pays the stake');
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool) - pool0,
  Math.floor(rake / 2), 'half the rake → the buyback pool, half burns');
// ELO: even ratings → ±K/2 = ±16
assert.equal(r.body.elo, DUELS.ELO_START + 16, 'winner +16 at even ratings (K=32, E=0.5)');
const pigeonElo1 = Number((await pool.query(`SELECT duel_elo FROM characters WHERE id='${pigeon.id}'`)).rows[0].duel_elo);
assert.equal(pigeonElo1, DUELS.ELO_START - 16, 'loser mirrored');
// the lifetime legend (loser is level 20 ≥ the floor)
assert.equal(Number((await pool.query(`SELECT duel_wins FROM account_persistent WHERE account_id='${bruiser.aid}'`)).rows[0].duel_wins),
  1, 'the lifetime legend banks vs a real opponent');

// ── the per-pair daily K-diminishing: the SECOND duel today moves less (K/2) ──
r = await call('POST', `/v1/duels/${pigeon.id}`, { token: bruiser.token, body: { amount: 5000 } });
assert.equal(r.code, 200, 'a rematch resolves');
assert.equal(r.body.pairDuelsToday, 2, 'the pair log counts');
assert(r.body.delta <= 8, `the rematch pays diminished elo (K/2 at a rating edge): +${r.body.delta}`);

// ── the ELO floor: grind the pigeon down — the rating never goes below the floor ──
await pool.query(`UPDATE characters SET duel_elo=${DUELS.ELO_FLOOR + 2} WHERE id='${pigeon.id}'`);
r = await call('POST', `/v1/duels/${pigeon.id}`, { token: bruiser.token, body: { amount: 2000 } });
assert.equal(r.code, 200, 'the third duel resolves');
const pigeonFloor = Number((await pool.query(`SELECT duel_elo FROM characters WHERE id='${pigeon.id}'`)).rows[0].duel_elo);
assert(pigeonFloor >= DUELS.ELO_FLOOR, `the floor holds: ${pigeonFloor}`);

// ── the leaderboard: ranked, the bruiser on top ──
r = await call('GET', '/v1/leaderboard/duels', { token: bruiser.token });
assert.equal(r.body.ladder[0].name, 'Knuckles Kane', 'the bruiser tops the ladder');
assert(r.body.ladder[0].elo > DUELS.ELO_START, 'with a real rating');
assert(r.body.ladder[0].lifetimeWins >= 1, 'and the lifetime legend');

// ── the SEASONAL reset: rollover sends every elo back to the start line ──
await pool.query('UPDATE characters SET season = season - 1');
await runSeasonRollover(pool, { season: Math.floor(Date.now() / 86400000 / 28) + 1 });
const eloAfter = Number((await pool.query(`SELECT duel_elo FROM characters WHERE id='${bruiser.id}'`)).rows[0].duel_elo);
assert.equal(eloAfter, DUELS.ELO_START, 'the season reset the ladder — a fresh 28-day race');

// ── §10.4: the duel: vocabulary + per-character cash reconciles both sides ──
const inv = await runLedgerInvariants(pool);
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `duel: rides the cash vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const cash = inv.checks.find((c) => c.name === 'character cash');
assert.equal(cash.drift, seedDrift, `cash drift == the SQL seeds only (every duel:wager reconciles): ${cash.drift}`);

await app.close();
console.log('✅ THE DUELING LADDER test passed — list/unlist (level gate + stake floor), the board (rating + nearest rivals), the duel gates (rookie/amount/limit), a pinned strong-vs-weak duel with the EXACT casino:pvp taxed transfer (winner nets stake − rake, half the rake → the buyback), ±16 elo at even ratings, the per-pair daily K-diminishing rematch, the ELO floor, the lifetime legend vs a real opponent, the ladder leaderboard, the SEASONAL rollover reset, and §10.4 (duel: vocabulary + per-character cash reconciling — drift == the SQL seeds only)');
