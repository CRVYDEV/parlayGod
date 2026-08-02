// THE RARITY NFTs — economy v3 step 7 (design §7, §9.7).
//
// Cars and boats carry a rarity rolled when they are EARNED, and an owned one can be EXTRACTED
// on-chain through the EXISTING GearVault rail. This module is the in-game half: the board a player
// reads, and the one deterministic $OMR sink that upgrades a rarity. The signing half lives in
// chain.js next to `requestGearWithdraw`, because that is where the reserve, the nonce and the
// EIP-712 signer already are.
//
// **NO CONTRACT CHANGE.** GearVault's `mint(to, gearId, amount)` takes a bare uint256 with a
// per-id lifetime cap, so "extend GearVault's pattern to cars/boats" is a TOKEN-ID SPACE decision
// off-chain, not a new contract: gear keeps 1..N, cars sit at 100000+, boats at 200000+
// (`RARITY.TOKEN`). That matters beyond convenience — the design says steps 6 and 7 "touch contracts
// and therefore reset the third-party audit clock", and step 7 turns out not to. Each new tokenId
// still needs its Safe-set `cap` at deploy (fail-closed at 0, so an un-capped class simply cannot
// mint), which is deploy config rather than code.
//
// WHAT IS DELIBERATELY NOT HERE: nothing sells a rarity for ETH, and nothing rolls one for money.
// `upgradeRarity` is a KNOWN outcome at a KNOWN price. See the RARITY block in rules.tail.js for
// why that line is load-bearing rather than fastidious.
import { GameError } from './game.js';
import { spendOmr } from './vanity.js';
import { RARITY, CARS, PORT, carOf, boatOf, rarityOf, rarityIdx, nftTokenId } from './rules.js';

// The two extractable classes, in one table so the board, the upgrade and the withdrawal cannot
// disagree about what "a car" means. `esc` names the escrow/at-sea states that must clear first —
// extracting a car parked in a Black Market auction would strand the bid.
const KINDS = {
  car: {
    table: 'cars',
    label: (row) => carOf(row.model_id)?.name || row.model_id,
    catalog: (row) => row.model_id,
    esc: (row) => (row.listed ? 'It\'s on the block — cancel the listing first.'
      : row.pledged ? "It's pledged as loan collateral — square the debt first." : null),
    // extraction takes it off every consent surface it was standing on: a car in a wallet is not
    // on the strip and is not up for pinks (races.js guards these too, belt and braces).
    clear: 'race_limit=NULL, pink_slip=false',
  },
  boat: {
    table: 'boats',
    label: (row) => boatOf(row.kind)?.name || row.kind,
    catalog: (row) => row.kind,
    esc: (row) => (row.run_until && new Date(row.run_until) > new Date()
      ? "She's out on a run — bring her in first." : null),
    clear: 'rendezvous=false',
  },
};
export const nftKind = (kind) => KINDS[String(kind || '')] || null;

// Every row of an extractable class this CHARACTER holds. Cars are read from the DB rather than
// `h.owned.cars` on purpose: loadOwned deliberately filters extracted cars OUT (that filter is what
// makes them inert everywhere), so the one screen that must SHOW them has to ask directly.
async function itemsOf(client, ch, kind) {
  const k = KINDS[kind];
  return (await client.query(`SELECT * FROM ${k.table} WHERE character_id=$1 ORDER BY created_at`, [ch.id])).rows;
}

const describe = (kind, row) => {
  const k = KINDS[kind];
  const rarity = String(row.rarity || 'common');
  const next = RARITY.TIERS[rarityIdx(rarity) + 1] || null;
  return {
    id: row.id, kind, name: k.label(row), rarity, rarityName: rarityOf(rarity).name,
    onChain: !!row.minted_onchain,
    tokenId: nftTokenId(kind, k.catalog(row), rarity),
    // what the NEXT tier costs, and null at the top — the client renders the button off this rather
    // than re-deriving the ladder (the tradeRank precedent: the server owns the curve).
    upgrade: next ? { to: next.id, toName: next.name, omr: RARITY.UPGRADE_OMR[rarityIdx(next.id)] } : null,
    blocked: k.esc(row) || null,
  };
};

// GET /v1/nft — the collection: what you hold, what it would mint as, what is already out there.
export async function nftBoard(ch, client, h) {
  const out = [];
  for (const kind of Object.keys(KINDS)) for (const row of await itemsOf(client, ch, kind)) out.push(describe(kind, row));
  return {
    tiers: RARITY.TIERS.map((t) => ({ id: t.id, name: t.name })),
    upgradeOmr: RARITY.UPGRADE_OMR,
    omr: Number(h.acct?.omr || 0),
    // The extraction gate is the SAME one $OMR withdrawal uses — a free-trial street plays the whole
    // game, it just cannot take anything off the board.
    minted: !!h.acct?.minted,
    wallet: h.acct?.wallet_address || null,
    items: out.filter((i) => !i.onChain),
    onChain: out.filter((i) => i.onChain),
  };
}

// POST /v1/nft/:kind/:id/upgrade — buy exactly the next tier for exactly its price. DETERMINISTIC,
// and that is the whole reason this sink is allowed to exist next to an OMR bridge people reach
// through ETH: a known item for a known price is a purchase, a random one would be a loot box.
export async function upgradeRarity(ch, kind, itemId, client, h) {
  const k = KINDS[String(kind || '')];
  if (!k) throw new GameError('bad_kind', 'Nothing of that sort to upgrade.');
  const row = (await client.query(
    `SELECT * FROM ${k.table} WHERE id=$1 AND character_id=$2 FOR UPDATE`, [String(itemId || ''), ch.id])).rows[0];
  if (!row) throw new GameError('not_yours', "That isn't yours.");
  // An extracted item is out of play in BOTH directions: we cannot re-roll a token somebody already
  // holds (its tokenId encodes the rarity, so an "upgrade" would silently mean a different NFT).
  if (row.minted_onchain) throw new GameError('extracted', "It's on-chain — what you hold is what it is.");
  const from = String(row.rarity || 'common');
  const next = RARITY.TIERS[rarityIdx(from) + 1];
  if (!next) throw new GameError('maxed', "There's nothing above that.");
  const cost = RARITY.UPGRADE_OMR[rarityIdx(next.id)];
  await spendOmr(client, h, cost, 'rarity:upgrade'); // a DESK sink — it recycles to the shelf, never burns
  await client.query(`UPDATE ${k.table} SET rarity=$2 WHERE id=$1`, [row.id, next.id]);
  // keep the loaded fleet honest so the same request's view doesn't render the old tier
  if (kind === 'car') { const c = (h.owned?.cars || []).find((x) => x.id === row.id); if (c) c.rarity = next.id; }
  await h.track(client, ch.account_id, 'rarity_upgrade', { kind, from, to: next.id, omr: cost });
  return { ok: true, kind, id: row.id, name: k.label(row), was: from, rarity: next.id,
    rarityName: next.name, spent: cost, tokenId: nftTokenId(kind, k.catalog(row), next.id) };
}
