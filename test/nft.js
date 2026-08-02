// THE RARITY NFTs (economy v3 step 7) — the 64th suite.
//
// Cars and boats carry a rarity, and an owned one can be extracted on-chain as a tradeable ERC-1155
// through the EXISTING GearVault rail (no contract change — cars and boats are a disjoint tokenId
// SPACE, and GearVault's id is a bare uint256 with a per-id cap).
//
// The assertions aim at the two ways this drop could be wrong, not at the happy path:
//
//   (1) THE LOOT-BOX LINE. "Sell deterministic, drop random" is the sentence that keeps this outside
//       a genuinely contested regulatory question, so it is asserted rather than promised: rarity is
//       rolled ONLY when an item is earned in play (and rng_audit'd, so the draw is replayable), and
//       the one thing money buys is a KNOWN tier for a KNOWN price.
//   (2) SAFE **AND** INERT. Extraction has to be both halves or the tradeoff collapses. A safe item
//       that still races is strictly dominant and nobody would ever leave one in play; an inert item
//       that still dies with the street is a purchase of nothing. Both are checked, in both
//       directions, against a control that is NOT extracted.
//
// pg-mem, plus the chain env test/chain.js uses (deterministic anvil keys — no live chain).
import assert from 'node:assert';
import { privateKeyToAccount } from 'viem/accounts';

const SIGNER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
process.env.VOUCHER_SIGNER_PK = SIGNER_PK;
process.env.VOUCHER_CLAIM_ADDRESS = '0x1111111111111111111111111111111111111111';
process.env.CHAIN_ID = '46630';
process.env.MOD_KEY = 'test-mod-key';

const { buildServer } = await import('../src/server.js');
const { RARITY, rollRarity, rarityIdx, nftTokenId, recyclesToDesk, CARS, PORT, MARKET, PACING } = await import('../src/rules.js');
const { runLedgerInvariants } = await import('../src/invariants.js');
const { reclaimExpiredVouchers } = await import('../src/chain.js');

const app = await buildServer();
const pool = app.pool;
const modH = { 'x-mod-key': 'test-mod-key' };
const call = async (method, url, { token, body, headers } = {}) => {
  const res = await app.inject({ method, url, payload: body,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) } });
  let json; try { json = res.json(); } catch { json = null; }
  return { code: res.statusCode, body: json };
};
const meOf = async (token) => (await call('GET', '/v1/me', { token })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const me = await meOf(token);
  return { token, id: me.id, acct: (await pool.query('SELECT account_id FROM characters WHERE id=$1', [me.id])).rows[0].account_id };
};
const checkOf = async (name) => {
  const r = await runLedgerInvariants(pool, { alert: false });
  const c = r.checks.find((x) => x.name === name);
  assert(c, `the ${name} check exists`);
  return c;
};
// Seeded cash rides a LEDGERED faucet row rather than a bare SQL write, so the final §10.4 sweep can
// be asserted ABSOLUTELY (every check at drift 0) instead of as a before/after delta — which matters
// here, because the question this suite has to answer is whether extraction moves value at all.
const grantCash = async (id, n) => {
  await pool.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [id, n]);
  await pool.query("INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,'cash',$3,'crime:pick')",
    [crypto.randomUUID(), id, n]);
};
const grantOmr = async (acct, n) => {
  await pool.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [acct, n]);
  await pool.query("INSERT INTO transactions (id, account_id, currency, amount, reason) VALUES ($1,$2,'omr',$3,'prize:omr')",
    [crypto.randomUUID(), acct, n]);
};

// ══ (1) THE TOKEN-ID SPACE — three catalogs, one uint256, and they must not collide ═════════════
{
  const gearMax = MARKET.length;                       // gear is 1..N (its 1-based catalog index)
  const carLo = nftTokenId('car', CARS[0].id, 'common');
  const carHi = nftTokenId('car', CARS[CARS.length - 1].id, RARITY.TIERS[RARITY.TIERS.length - 1].id);
  const boatLo = nftTokenId('boat', PORT.BOATS[0].id, 'common');
  assert(gearMax < carLo, 'gear ids sit below the car space');
  assert(carHi < boatLo, 'the whole car space sits below the boat space');
  // the RARITY is IN the id, which is what makes an upgrade a different NFT and is why an extracted
  // item can never be re-rolled (nft.js refuses it — asserted below).
  assert.notEqual(nftTokenId('car', CARS[0].id, 'common'), nftTokenId('car', CARS[0].id, 'rare'),
    'the tokenId encodes the rarity');
  // fail-closed on an unknown class rather than returning a plausible number — a wrong id here would
  // mint the wrong NFT into somebody's wallet.
  assert.throws(() => nftTokenId('car', 'not-a-car', 'common'), /no such car/);
  assert.throws(() => nftTokenId('spaceship', CARS[0].id, 'common'), /no such spaceship/);
}

// ══ (2) THE DRAW — random, weighted, and total-covering ═════════════════════════════════════════
{
  assert.equal(rollRarity(0), RARITY.TIERS[0].id, 'the bottom of the range is the commonest tier');
  assert.equal(rollRarity(0.999999), RARITY.TIERS[RARITY.TIERS.length - 1].id, 'the top is the rarest');
  // every roll in [0,1) lands on a real tier — a gap would silently produce an undefined rarity that
  // then fails nftTokenId at extraction time, i.e. long after the car was earned.
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(rollRarity(i / 1000));
  for (const t of RARITY.TIERS) assert(seen.has(t.id), `${t.id} is reachable`);
  assert.equal(seen.size, RARITY.TIERS.length, 'and nothing outside the table is');
}

// ══ (3) DROP RANDOM — a boosted car is rolled AND audited ═══════════════════════════════════════
const A = await mk('Rita Ragtop');
await pool.query("UPDATE characters SET energy=100, nerve=100, speed=40, cunning=40, respect=$2 WHERE id=$1",
  [A.id, PACING.LEVEL_DIVISOR * 40 * 40]);
await grantCash(A.id, 5000000);
let carId = null;
for (let i = 0; i < 60 && !carId; i++) {
  await pool.query('UPDATE characters SET gta_at=NULL, energy=100, jail_until=NULL WHERE id=$1', [A.id]);
  const r = await call('POST', '/v1/garage/boost', { token: A.token });
  if (r.body?.success) carId = r.body.car.id;
}
assert(carId, 'boosted a car');
{
  const car = (await pool.query('SELECT * FROM cars WHERE id=$1', [carId])).rows[0];
  assert(RARITY.TIERS.some((t) => t.id === car.rarity), `the car carries a real rarity (${car.rarity})`);
  const audit = (await pool.query("SELECT * FROM rng_audit WHERE character_id=$1 AND action='rarity:car'", [A.id])).rows;
  assert(audit.length >= 1, 'the rarity draw is rng_audit\'d — server-authoritative and replayable');
  assert.equal(audit[audit.length - 1].outcome, car.rarity, 'and the audited outcome is the rarity the car actually has');
}

// ══ (4) SELL DETERMINISTIC — the upgrade buys exactly the next tier, for exactly its price ══════
{
  // pin the car at the bottom so the ladder is walkable regardless of what the drop rolled
  await pool.query("UPDATE cars SET rarity='common' WHERE id=$1", [carId]);
  const board0 = (await call('GET', '/v1/nft', { token: A.token })).body;
  const mine = board0.items.find((i) => i.id === carId);
  assert(mine, 'the car is on the collection board');
  assert.equal(mine.rarity, 'common');
  assert.equal(mine.upgrade.to, RARITY.TIERS[1].id, 'the board names the NEXT tier, not a mystery box');
  const price = RARITY.UPGRADE_OMR[1];
  assert.equal(mine.upgrade.omr, price, 'and its exact price');

  const broke = await call('POST', `/v1/nft/car/${carId}/upgrade`, { token: A.token });
  assert.equal(broke.body.error, 'omr', 'you cannot upgrade on credit');

  await grantOmr(A.acct, 1000);
  const omr0 = Number((await pool.query('SELECT omr FROM account_persistent WHERE account_id=$1', [A.acct])).rows[0].omr);
  const up = await call('POST', `/v1/nft/car/${carId}/upgrade`, { token: A.token });
  assert.equal(up.code, 200, JSON.stringify(up.body));
  assert.equal(up.body.rarity, RARITY.TIERS[1].id, 'DETERMINISTIC: the tier you paid for is the tier you got');
  assert.equal(up.body.spent, price);
  const omr1 = Number((await pool.query('SELECT omr FROM account_persistent WHERE account_id=$1', [A.acct])).rows[0].omr);
  assert.equal(omr1, omr0 - price, 'charged exactly once, exactly the price');
  const rows = (await pool.query("SELECT amount FROM transactions WHERE account_id=$1 AND reason='rarity:upgrade'", [A.acct])).rows;
  assert.equal(rows.length, 1, 'one ledger row');
  assert.equal(Number(rows[0].amount), -price, 'a SINK, not a faucet');
  // …and since step 2 a sink hands the token to the desk rather than destroying it
  assert(recyclesToDesk('rarity:upgrade'), 'the upgrade recycles to the shelf');
  const shelf = Number((await pool.query('SELECT balance FROM desk_inventory WHERE id=1')).rows[0].balance);
  assert.equal(shelf, price, 'the shelf holds exactly what was spent');
  assert.equal((await checkOf('$OMR conservation')).drift, 0, 'conservation is unmoved by a recycled sink');
}

// ══ (5) EXTRACTION — the gate, then the voucher ═════════════════════════════════════════════════
const wallet = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d').address;
{
  const noMint = await call('POST', `/v1/nft/car/${carId}/withdraw`, { token: A.token });
  assert.equal(noMint.body.error, 'not_minted', 'a free-trial street plays everything and extracts nothing');
  await pool.query('UPDATE account_persistent SET minted=true, wallet_address=$2 WHERE account_id=$1', [A.acct, wallet]);

  const car = (await pool.query('SELECT * FROM cars WHERE id=$1', [carId])).rows[0];
  const w = await call('POST', `/v1/nft/car/${carId}/withdraw`, { token: A.token });
  assert.equal(w.code, 200, JSON.stringify(w.body));
  assert.equal(w.body.tokenId, nftTokenId('car', car.model_id, car.rarity), 'the voucher mints the id the item encodes');
  assert.equal(w.body.status, 'signed');
  assert.equal(Number(w.body.voucher.kind), 1, 'to the CONTRACT it is a gear-kind voucher — which is why no contract changed');
  assert.equal(String(w.body.voucher.gearId), String(w.body.tokenId));

  const again = await call('POST', `/v1/nft/car/${carId}/withdraw`, { token: A.token });
  assert.equal(again.body.error, 'already', 'and it cannot be minted twice');
}

// ══ (6) INERT — out of play at every surface, because loadOwned stopped returning it ════════════
{
  const me = await meOf(A.token);
  assert(!(me.cars || []).some((c) => c.id === carId), 'the extracted car is gone from the fleet');
  assert((me.nftCars || []).some((c) => c.id === carId), '…and shown as on-chain instead');

  const melt = await call('POST', `/v1/garage/${carId}/melt`, { token: A.token });
  assert.equal(melt.body.error, 'no_car', 'it cannot be melted');
  const fence = await call('POST', `/v1/garage/${carId}/fence`, { token: A.token });
  assert.equal(fence.body.error, 'no_car', 'or fenced');
  const list = await call('POST', `/v1/races/list/${carId}`, { token: A.token, body: { limit: 1000 } });
  assert.notEqual(list.code, 200, 'or put on the strip');
  // the upgrade refuses too — the tokenId encodes the rarity, so "upgrading" an extracted item would
  // silently mean a DIFFERENT NFT from the one the player holds.
  const reroll = await call('POST', `/v1/nft/car/${carId}/upgrade`, { token: A.token });
  assert.equal(reroll.body.error, 'extracted', 'and it cannot be re-tiered under a token already claimed');

  // it is still on the board, in the on-chain half — a player who paid to extract must still see it
  const board = (await call('GET', '/v1/nft', { token: A.token })).body;
  assert(board.onChain.some((i) => i.id === carId), 'the collection still shows it');
  assert(!board.items.some((i) => i.id === carId), 'but never as extractable');
}

// ══ (7) SAFE — it survives the street that extracted it, and a car in play does not ═════════════
{
  // a control car, in play, so "the estate still destroys things" is asserted rather than assumed
  let control = null;
  for (let i = 0; i < 60 && !control; i++) {
    await pool.query('UPDATE characters SET gta_at=NULL, energy=100, jail_until=NULL WHERE id=$1', [A.id]);
    const r = await call('POST', '/v1/garage/boost', { token: A.token });
    if (r.body?.success) control = r.body.car.id;
  }
  assert(control, 'boosted a control car');
  const carsBefore = Number((await pool.query('SELECT COUNT(*) c FROM cars')).rows[0].c);

  const kill = await call('POST', '/v1/mod/kill', { headers: modH, body: { characterId: A.id, reason: 'test' } });
  assert.equal(kill.code, 200, JSON.stringify(kill.body));
  const heir = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [A.acct])).rows[0];
  assert(heir, 'the bloodline goes on');

  const kept = (await pool.query('SELECT * FROM cars WHERE id=$1', [carId])).rows[0];
  assert(kept, 'THE EXTRACTED CAR SURVIVED THE STREET');
  assert.equal(kept.character_id, heir.id, 'and belongs to the heir');
  assert.equal((await pool.query('SELECT 1 FROM cars WHERE id=$1', [control])).rowCount, 0,
    'while the car still in play died with him — extraction is what bought the survival');
  assert.equal(Number((await pool.query('SELECT COUNT(*) c FROM cars')).rows[0].c), carsBefore - 1,
    'exactly one car left the world');
  // the invariant reads the destroyed fleet out of death telemetry, so the surviving row must NOT be
  // in that count or `car conservation` drifts by one for every extraction that ever outlives a death.
  assert.equal((await checkOf('car conservation')).drift, 0, 'car conservation holds across the death');
}

// ══ (8) A BOAT — the same rail, the other catalog, and it is inert at sea ═══════════════════════
{
  const B = await mk('Sal Seaworthy');
  await pool.query('UPDATE characters SET loc=$2, respect=$3 WHERE id=$1',
    [B.id, PORT.DISTRICT, PACING.LEVEL_DIVISOR * 30 * 30]);
  await grantCash(B.id, 50000000);
  const buy = await call('POST', '/v1/port/boat/dinghy', { token: B.token });
  assert.equal(buy.code, 200, JSON.stringify(buy.body));
  const boatId = buy.body.boat.id;
  assert(RARITY.TIERS.some((t) => t.id === buy.body.boat.rarity), 'the vessel is rolled at the yard');

  const wallet2 = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a').address;
  await pool.query('UPDATE account_persistent SET minted=true, wallet_address=$2 WHERE account_id=$1', [B.acct, wallet2]);
  const w = await call('POST', `/v1/nft/boat/${boatId}/withdraw`, { token: B.token });
  assert.equal(w.code, 200, JSON.stringify(w.body));
  const row = (await pool.query('SELECT * FROM boats WHERE id=$1', [boatId])).rows[0];
  assert.equal(w.body.tokenId, nftTokenId('boat', row.kind, row.rarity));
  assert(w.body.tokenId >= RARITY.TOKEN.BOAT_BASE, 'minted into the boat space');

  const run = await call('POST', `/v1/port/run/${boatId}`, { token: B.token, body: { route: 'coastal' } });
  assert.equal(run.body.error, 'extracted', 'she takes no more cargo');
  const sell = await call('POST', `/v1/port/boat/${boatId}/sell`, { token: B.token });
  assert.equal(sell.body.error, 'extracted', 'and the yard will not buy her back');
}

// ══ (9) THE WAY BACK — an expired, unclaimed voucher puts the item back in play ═════════════════
{
  // The optimistic flag is the whole reason this path has to exist: extraction flips the row BEFORE
  // the claim lands, so a voucher that expires unclaimed would otherwise strand the item out of play
  // forever — safe, inert, and worthless.
  await pool.query("UPDATE vouchers SET deadline = $1 WHERE kind IN ('car','boat')",
    [Math.floor(Date.now() / 1000) - 86400 * 7]);
  const before = (await pool.query('SELECT minted_onchain FROM cars WHERE id=$1', [carId])).rows[0];
  assert.equal(before.minted_onchain, true);

  // no on-chain reader → the sweep must SKIP, never refund blind (a delayed restore is recoverable,
  // handing back an item whose token was already claimed is not)
  const blind = await reclaimExpiredVouchers(pool, null);
  assert(blind.skipped >= 1, 'without a chain reader nothing is reclaimed');
  assert.equal((await pool.query('SELECT minted_onchain FROM cars WHERE id=$1', [carId])).rows[0].minted_onchain, true,
    'the item stays out of play until the chain confirms the nonce was never used');

  const res = await reclaimExpiredVouchers(pool, { usedNonce: async () => false });
  assert(res.gearRestored >= 1, 'a confirmed-unclaimed voucher restores the item');
  assert.equal((await pool.query('SELECT minted_onchain FROM cars WHERE id=$1', [carId])).rows[0].minted_onchain, false,
    'the car is back in play');
  // …and back in the fleet, which is the property that actually matters to the player
  const heirTok = A.token; // same account, the heir is this account's living character
  const me = await meOf(heirTok);
  assert((me.cars || []).some((c) => c.id === carId), 'and back in the garage');
}

// ══ (10) §10.4 — the whole drop moves value in exactly one way ══════════════════════════════════
{
  const r = await runLedgerInvariants(pool, { alert: false });
  const bad = r.checks.filter((c) => !c.ok).map((c) => `${c.name} drift ${c.drift}`);
  assert.equal(bad.length, 0, `every check holds: ${bad.join(', ')}`);
  // the ONLY new reason is the upgrade sink. Rarity is status and the extraction is an ownership
  // move, so neither writes a row — asserted, because "it moves no value" is the kind of claim that
  // is easy to write and easy to be wrong about.
  const reasons = (await pool.query(
    "SELECT DISTINCT reason FROM transactions WHERE reason LIKE 'rarity%' OR reason LIKE 'nft%'")).rows.map((x) => x.reason);
  assert.deepEqual(reasons.sort(), ['rarity:upgrade'], 'one reason, and it is a sink');
}

await app.close();
console.log('OK');
