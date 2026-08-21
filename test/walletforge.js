// THE WALLET FORGE (depth B, founder-signed 2026-08-21 — omerta-wallet-forged-stats-design.md §6).
//
// The centre of the test, in order of what would hurt most if it broke:
//   • THE BUDGET LAW — a forged build is EXACTLY CREATE_STAT_TOTAL + budgetExtra + bonus, each
//     half hard-capped (BUDGET_MAX / BONUS_MAX), pinned against the LIVE constants (never
//     literals — a retune must move this test with it). The perk spreads round-robin, never
//     onto the boost stat alone (the wallet widens the build; the bonus is what re-aims it).
//   • ONCE PER WALLET, EVER — the wallet_rolls latch holds across ACCOUNTS (wallet-shopping buys
//     nothing), and only the BANDS are stored (no raw feature ever lands on a permanent table).
//   • FAIL-CLOSED — no reader refuses; a throwing reader refuses; neither guesses a history.
//   • §10.4 ZERO — the whole flow writes NOT ONE `transactions` row.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { WALLET_FORGE, FORGE_FAMILIES, REGIMEN, walletBands, forgeShape, forgeArchetype, forgeBonus, forgeBudgetExtra, disciplineLvlOf, CONSTANTS } from '../src/rules.js';
import { __setReader } from '../src/walletforge.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const me = (await call('GET', '/v1/me', { token })).body.character;
  return { token, id: me.id, name };
};
const acctOf = async (id) => (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [id])).rows[0].a;
const linkWallet = (acct, w) => pool.query('UPDATE account_persistent SET wallet_address=$2 WHERE account_id=$1', [acct, w]);
const driftOf = async (name) => Number((await runLedgerInvariants(pool, { alert: false })).checks.find((x) => x.name === name).drift);
const ledgerRows = async () => Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);

// ════════════ the pure half — bands, shape and bonus, driven at their boundaries ════════════
// (these are what the reader's raw features become; everything after only ever sees the bands)
assert.deepEqual(walletBands({ ageDays: 364, txCount: 19 }), { ageTier: 0, velTier: 0 }, 'just under both first tiers');
assert.deepEqual(walletBands({ ageDays: 365, txCount: 20 }), { ageTier: 1, velTier: 1 }, 'both first tiers at the boundary');
assert.deepEqual(walletBands({ ageDays: 1095, txCount: 1000 }), { ageTier: 2, velTier: 3 }, 'both top tiers');
assert.equal(forgeShape({ ageTier: 2, velTier: 3 }), 'wheelman', 'very high velocity wins whatever the age');
assert.equal(forgeShape({ ageTier: 2, velTier: 1 }), 'patient', 'old and quiet is the patient man');
assert.equal(forgeShape({ ageTier: 0, velTier: 2 }), 'workhorse', 'a working wallet is the workhorse');
assert.equal(forgeShape({ ageTier: 1, velTier: 0 }), 'fixer', 'a little history is a fixer');
assert.equal(forgeShape({ ageTier: 0, velTier: 0 }), null, 'a fresh empty wallet earns nothing');
assert.equal(forgeBonus({ ageTier: 2, velTier: 3 }), Math.min(WALLET_FORGE.BONUS_MAX, 3), 'the bonus is hard-capped at BONUS_MAX');
assert.equal(forgeBonus({ ageTier: 1, velTier: 0 }), 1, 'age alone pays its tier');
// THE BUDGET PERK (founder-directed 2026-08-21): every band past the first adds a whole-budget
// point, hard-capped at BUDGET_MAX — a fresh-but-real wallet gets the base 15, only depth widens it.
assert.equal(forgeBudgetExtra({ ageTier: 1, velTier: 0 }), 0, 'one band alone forges no budget perk');
assert.equal(forgeBudgetExtra({ ageTier: 0, velTier: 1 }), 0, '…in either direction');
assert.equal(forgeBudgetExtra({ ageTier: 2, velTier: 1 }), 2, 'depth pays: two bands past the first');
assert.equal(forgeBudgetExtra({ ageTier: 2, velTier: 3 }), WALLET_FORGE.BUDGET_MAX,
  'the budget perk is HARD-CAPPED at BUDGET_MAX — 2+3-1 would be 4, the wall holds it at the ceiling');
// THE SHAPE LAW, against the LIVE budget (the load guard enforces it at boot; this pins it here too)
for (const [k, a] of Object.entries(WALLET_FORGE.ARCHETYPES))
  assert.equal(a.muscle + a.cunning + a.speed, CONSTANTS.CREATE_STAT_TOTAL,
    `archetype ${k}'s BASE shape sums to the same budget every random roll gets — only the banded perk + bonus sit on top`);
// ── THE TWELVE (founder-directed 2026-08-21: "a total of 12 archetypes for variety") ──
assert.equal(Object.keys(WALLET_FORGE.ARCHETYPES).length, 12, 'the founder-directed catalog is TWELVE archetypes');
// four history families of three, covering every archetype exactly once, the original ids leading
// their families (backward compat: a stored `forged`/wallet_rolls value stays a live key)
{
  const members = Object.values(FORGE_FAMILIES).flat();
  assert.equal(new Set(members).size, 12, 'FORGE_FAMILIES covers every archetype exactly once');
  for (const fam of Object.keys(FORGE_FAMILIES))
    assert.equal(FORGE_FAMILIES[fam][0], fam, `the original id '${fam}' leads its family — no migration for stored rows`);
  // every affinity is a REAL regimen discipline (a typo'd one would school XP into a key nothing reads)
  const ids = new Set(REGIMEN.DISCIPLINES.map((d) => d.id));
  for (const [k, a] of Object.entries(WALLET_FORGE.ARCHETYPES))
    assert.ok(ids.has(a.affinity), `archetype ${k}'s affinity '${a.affinity}' is a regimen discipline`);
}
// the VARIANT is a stable hash of the wallet — deterministic per wallet forever (case-insensitive),
// NEVER a roll — and genuinely varied: two wallets in the same family land DIFFERENT variants
// (the mutation that collapses forgeArchetype to candidates[0] fails HERE by name).
const T_PATIENT = { ageTier: 2, velTier: 1 };
assert.equal(forgeArchetype(T_PATIENT, '0xAbC'), forgeArchetype(T_PATIENT, '0xabc'),
  'the variant is deterministic and case-insensitive — the same wallet forges the same face forever');
{
  const v1 = forgeArchetype(T_PATIENT, '0x01'), v2 = forgeArchetype(T_PATIENT, '0x03');
  assert.ok(FORGE_FAMILIES.patient.includes(v1) && FORGE_FAMILIES.patient.includes(v2),
    'both variants stay inside the bands\' family — the wallet picks the FACE, never the family');
  assert.notEqual(v1, v2, 'two wallets in one family land DIFFERENT variants — twelve archetypes, not four');
}
assert.equal(forgeArchetype({ ageTier: 0, velTier: 0 }, '0xabc'), null, 'a fresh empty wallet still earns nothing');

// ════════════ gates: no wallet linked, then fail-closed readers ════════════
const A = await mk('Forge Able');
const acctA = await acctOf(A.id);
let r = await call('POST', '/v1/character/forge', { token: A.token });
assert.equal(r.body.error, 'wallet', 'no linked wallet → the forge refuses');
const WALLET_A = '0xAAAA00000000000000000000000000000000f001';
await linkWallet(acctA, WALLET_A);
// no reader configured (no CHAIN_RPC_URL in the suite) → fail-closed, never a guessed history
r = await call('POST', '/v1/character/forge', { token: A.token });
assert.equal(r.body.error, 'chain_unconfigured', 'no reader → the forge refuses (fail-closed)');
__setReader(async () => { throw new Error('rpc down'); });
r = await call('POST', '/v1/character/forge', { token: A.token });
assert.equal(r.body.error, 'read_failed', 'a throwing reader refuses — it never falls back to a guess');

// ════════════ the forge: an old, worked wallet — deterministic archetype + capped bonus ════════════
const rowsBefore = await ledgerRows();
const cashBefore = await driftOf('character cash');
__setReader(async (w) => {
  assert.equal(w, WALLET_A.toLowerCase(), 'the reader is handed the LOWERCASED wallet');
  return { ageDays: 2000, txCount: 50 }; // ageTier 2, velTier 1 → patient, bonus 2
});
r = (await call('POST', '/v1/character/forge', { token: A.token })).body;
// old + quiet is the PATIENT family; this wallet's FNV hash picks 'graybeard' — a stable literal
// (the hash is math, not state), pinned alongside the family so a variant drift fails loudly.
assert.ok(FORGE_FAMILIES.patient.includes(r.forged), 'old + quiet forges into the PATIENT family');
assert.equal(r.forged, 'graybeard', "this wallet's stable variant is The Graybeard — deterministic forever");
assert.equal(r.name, WALLET_FORGE.ARCHETYPES.graybeard.name, 'the fictional name rides the reply');
assert.equal(r.bonus, 2, 'ageTier 2, velTier 1 → bonus 2 (age tiers alone)');
assert.equal(r.budgetExtra, 2, 'ageTier 2 + velTier 1 − 1 → budget perk 2');
assert.equal(r.spentCredit, false, 'at level 1 the forge is free');
// THE BUDGET LAW — pinned against the LIVE constants, never a literal
const total = r.stats.muscle + r.stats.cunning + r.stats.speed;
assert.equal(total, CONSTANTS.CREATE_STAT_TOTAL + r.budgetExtra + r.bonus,
  'a forged build is EXACTLY the base budget + the budget perk + the banded bonus — nothing else');
assert.ok(r.bonus <= WALLET_FORGE.BONUS_MAX, 'the bonus never exceeds BONUS_MAX');
assert.ok(r.budgetExtra <= WALLET_FORGE.BUDGET_MAX, 'the budget perk never exceeds BUDGET_MAX');
const P = WALLET_FORGE.ARCHETYPES[r.forged];
// the budget perk spreads ROUND-ROBIN (muscle, cunning, speed) — it widens the build, never
// re-aims it; the bonus alone lands on the boost stat. budgetExtra 2 → +1 muscle, +1 cunning.
assert.equal(r.stats.muscle, P.muscle + 1, 'the budget perk\'s first point lands on muscle (round-robin, never all on the boost)');
assert.equal(r.stats.cunning, P.cunning + 1 + r.bonus, 'cunning carries the perk\'s second point + the whole bonus');
assert.equal(r.stats.speed, P.speed, 'speed is the shape verbatim — the perk ran out before it');
// THE AFFINITY (founder-directed 2026-08-21): the archetype schools its regimen discipline with
// banded head-start XP — ageTier 2 + velTier 1 = 3 bands × AFFINITY_XP_PER_BAND. Ground truth is
// the DATABASE (character_disciplines), never the reply under test alone.
{
  const expXp = WALLET_FORGE.AFFINITY_XP_PER_BAND * 3;
  assert.equal(r.affinity?.discipline, P.affinity, "the reply names the archetype's own affinity discipline");
  assert.equal(r.affinity?.xp, expXp, 'the head start is banded — 3 bands × the lever');
  assert.equal(r.affinity?.name, REGIMEN.DISCIPLINES.find((d) => d.id === P.affinity).name,
    'the display NAME rides the reply (the F12 rule — a raw key never reaches a player)');
  const disc = (await pool.query('SELECT xp FROM character_disciplines WHERE character_id=$1 AND discipline=$2',
    [A.id, P.affinity])).rows[0];
  assert.equal(Number(disc?.xp), expXp, 'the XP genuinely LANDED in character_disciplines — schooling, through the regimen\'s own rail');
  assert.equal(r.affinity?.level, disciplineLvlOf(expXp), 'the reply states the level the curve gives that XP');
}
// the view carries the archetype; the database row matches the reply
const me = (await call('GET', '/v1/me', { token: A.token })).body.character;
assert.equal(me.forged, r.forged, 'the sheet names the archetype');
assert.equal(me.stats.cunning, r.stats.cunning, 'the sheet and the reply agree');
// the latch stores the BANDS and nothing rawer (ground truth is the DATABASE)
const roll = (await pool.query('SELECT * FROM wallet_rolls WHERE wallet=$1', [WALLET_A.toLowerCase()])).rows[0];
assert.ok(roll, 'the wallet_rolls latch exists, keyed on the LOWERCASED wallet');
assert.equal(roll.archetype, r.forged);
assert.equal(Number(roll.age_tier), 2); assert.equal(Number(roll.vel_tier), 1); assert.equal(Number(roll.bonus), 2);
assert.equal(Number(roll.budget), 2, 'the latch records the budget perk (a band, not a raw feature)');
for (const k of Object.keys(roll))
  assert.ok(!/age_days|tx_count|balance|volume/.test(k), `no raw feature column ever lands on the latch (found ${k})`);
// rng_audit: a deterministic archetype records roll 0 + '(deterministic)'
const aud = (await pool.query("SELECT roll, outcome FROM rng_audit WHERE character_id=$1 AND action='wallet_forge'", [A.id])).rows[0];
assert.equal(Number(aud.roll), 0, 'a deterministic forge audits roll 0');
assert.ok(/deterministic/.test(aud.outcome), 'the outcome says so');

// ════════════ once per wallet, EVER — across accounts ════════════
r = await call('POST', '/v1/character/forge', { token: A.token });
assert.equal(r.body.error, 'wallet_spent', 'the same account cannot forge the same wallet twice');
const B = await mk('Forge Baker');
// SIWE enforces wallet uniqueness across accounts, so a wallet MOVES: unlink A, then B links it
// (the realistic wallet-shopping shape — and exactly what the once-EVER latch exists to defeat).
await linkWallet(acctA, null);
await linkWallet(await acctOf(B.id), WALLET_A);
r = await call('POST', '/v1/character/forge', { token: B.token });
assert.equal(r.body.error, 'wallet_spent', 'a SECOND account linking the same wallet gets nothing — one forge per wallet, EVER');

// ════════════ the fresh empty wallet: an honest random roll, zero bonus ════════════
const WALLET_B = '0xBBBB00000000000000000000000000000000f002';
await linkWallet(await acctOf(B.id), WALLET_B);
__setReader(async () => ({ ageDays: 10, txCount: 3 })); // no tier anywhere → unknown
r = (await call('POST', '/v1/character/forge', { token: B.token })).body;
assert.equal(r.forged, 'unknown', 'a fresh empty wallet earns no archetype');
assert.equal(r.bonus, 0, '…and no bonus');
assert.equal(r.budgetExtra, 0, '…and no budget perk — an unknown wallet never rolls a bigger build');
assert.equal(r.affinity, null, '…and no affinity schooling — nothing to school from');
assert.equal(r.stats.muscle + r.stats.cunning + r.stats.speed, CONSTANTS.CREATE_STAT_TOTAL,
  'an unknown wallet rolls the ordinary fixed budget — exactly, no bonus, no perk');
const audB = (await pool.query("SELECT roll, outcome FROM rng_audit WHERE character_id=$1 AND action='wallet_forge'", [B.id])).rows[0];
assert.ok(Number(audB.roll) > 0, 'an unknown wallet audits a REAL roll (the build is random)');

// ════════════ the FREE_LVL gate: an established street pays a reroll credit ════════════
const C = await mk('Forge Charlie');
const acctC = await acctOf(C.id);
const WALLET_C = '0xCCCC00000000000000000000000000000000f003';
await linkWallet(acctC, WALLET_C);
// seed respect past FREE_LVL (levelOf = floor(sqrt(r/LEVEL_DIVISOR))+1 — 400 respect is level 7 at divisor 10)
await pool.query('UPDATE characters SET respect=400 WHERE id=$1', [C.id]);
__setReader(async () => ({ ageDays: 400, txCount: 500 })); // ageTier 1, velTier 2 → workhorse, bonus 2
r = await call('POST', '/v1/character/forge', { token: C.token });
assert.equal(r.body.error, 'no_reroll_credit', 'past FREE_LVL the forge takes a paid re-roll credit');
await pool.query('UPDATE account_persistent SET reroll_credits=1 WHERE account_id=$1', [acctC]);
r = (await call('POST', '/v1/character/forge', { token: C.token })).body;
assert.ok(FORGE_FAMILIES.workhorse.includes(r.forged), 'a working wallet forges into the WORKHORSE family');
assert.equal(r.forged, 'ironhand', "this wallet's stable variant is The Iron Hand");
assert.equal(r.budgetExtra, 2, 'ageTier 1 + velTier 2 − 1 → budget perk 2');
assert.equal(r.spentCredit, true, 'the credit was consumed');
assert.equal(Number((await pool.query('SELECT reroll_credits n FROM account_persistent WHERE account_id=$1', [acctC])).rows[0].n), 0,
  'the paid credit is genuinely gone');

// ════════════ the board — the client's card reads the true terms ════════════
const board = (await call('GET', '/v1/forge', { token: C.token })).body;
assert.equal(board.linked, true);
assert.equal(board.walletForged, true, 'the board says this wallet is spent');
assert.equal(board.forged, 'ironhand', 'the board names the living street\'s archetype');
assert.equal(board.free, false, 'past FREE_LVL the board says it costs a credit');
assert.equal(board.bonusMax, WALLET_FORGE.BONUS_MAX);
assert.equal(board.budgetMax, WALLET_FORGE.BUDGET_MAX, 'the board states the budget perk\'s ceiling');
assert.ok(board.archetypes.patient.name, 'the archetype catalog rides the board');
assert.equal(Object.keys(board.archetypes).length, 12, 'all twelve archetypes ride the board');
assert.equal(board.archetypes.graybeard.affinity, 'presence', "each archetype's affinity discipline rides the catalog");

// ════════════ a later paid re-roll REPLACES the forge — mark and bonus both ════════════
// (the codex says so, so the code must: a sheet claiming "forged" over a random build is a lie)
const beforeRe = (await call('GET', '/v1/me', { token: C.token })).body.character;
assert.equal(beforeRe.statTotal, CONSTANTS.CREATE_STAT_TOTAL + r.budgetExtra + r.bonus,
  'precondition: the forged street genuinely carries a bigger build — or the reset below proves nothing');
await pool.query('UPDATE account_persistent SET reroll_credits=1 WHERE account_id=$1', [acctC]);
r = (await call('POST', '/v1/character/reroll', { token: C.token })).body;
assert.equal(r.rerolled, true, 'the re-roll went through');
const after = (await call('GET', '/v1/me', { token: C.token })).body.character;
assert.equal(after.forged, null, 'a re-roll clears the forged mark — the sheet cannot claim a forge it replaced');
assert.equal(after.statTotal, CONSTANTS.CREATE_STAT_TOTAL, 'the bonus went with it — back to the ordinary budget');

// ════════════ §10.4 — the whole flow moved NO value ════════════
assert.equal(await ledgerRows(), rowsBefore, 'three forges + every refusal wrote NOT ONE transactions row');
assert.equal(await driftOf('character cash'), cashBefore, 'the cash identity is untouched');

console.log('walletforge: PASS — twelve archetypes (family + hashed variant), the affinity schooling, the budget law (+perk), the once-per-wallet latch, banded storage, fail-closed readers, the credit gate, §10.4 zero');
await app.close();
process.exit(0);
