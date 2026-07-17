// THE UNDERWORLD (design: omerta-underworld-design.md). Four NAMED fixtures, one per loop —
// Doc Moretti (survival), Vinnie the Match (PvP/contracts), Bella Bang-Bang (gear), Big Tuna
// (trade). Per-character standing 0–100 (`npc_standing`) is a pure STATUS axis earned by DOING
// BUSINESS (actor-side bumps at the loop's touchpoints, via game.js `bumpStanding`); tiers at
// 25/60/90 unlock perks that are each a NEW single-touchpoint modifier (the skills/decree
// precedent), read via game.js `npcTier`/`npcMult`. Standing DIES WITH THE STREET.
//
// Money flows here are ledgered + vocabulary'd (`underworld:`): `gift` (a cash sink — money
// opens doors, but ONLY below GIFT_CAP: the top tiers are earned), `discharge` (a cash sink —
// the Doc's T2/T3 perk, priced per remaining hospital minute), `gunsale` (a small bounded
// FAUCET — Bella's T3 buyback at 30% of the gun's cash price, once per owned gun, flagged for
// the sim pass). Deliberately UNTOUCHED: $OMR burns, ammo prices (the D1-signed kill-EV
// anchor), heat deterrents, loot-exposure windows, extraction caps, income curves. All
// numbers are founder sign-off levers.
import { GameError, npcTier, bumpStanding } from './game.js';
import { UNDERWORLD, npcOf, GUNS } from './rules.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();

// The board — the cast, your standing with each, and what the next tier buys.
export function underworldBoard(ch, h) {
  return {
    thresholds: UNDERWORLD.THRESHOLDS,
    gift: { cost: UNDERWORLD.GIFT_COST, standing: UNDERWORLD.GIFT_STANDING, cap: UNDERWORLD.GIFT_CAP },
    npcs: UNDERWORLD.NPCS.map((n) => ({
      id: n.id, name: n.name, earn: n.earn, perks: n.perks,
      standing: Number(h.owned.npc[n.id] || 0), tier: npcTier(h, n.id),
    })),
  };
}

// GIFT — cash buys a foot in the door, never the inner circle (standing ≥ GIFT_CAP refuses).
export async function giftNpc(ch, npcId, client, h) {
  const n = npcOf(npcId);
  if (!n) throw new GameError('bad_npc', 'Nobody by that name works this town.');
  if (jailed(ch)) throw new GameError('jailed', 'No social calls from lockup.');
  const cur = Number(h.owned.npc[npcId] || 0);
  if (cur >= UNDERWORLD.GIFT_CAP)
    throw new GameError('earned', `${n.name} doesn't want your money — the rest is earned.`);
  if (Number(ch.cash) < UNDERWORLD.GIFT_COST) throw new GameError('cash', `A proper gift runs $${UNDERWORLD.GIFT_COST}.`);
  ch.cash = Number(ch.cash) - UNDERWORLD.GIFT_COST;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -UNDERWORLD.GIFT_COST, reason: 'underworld:gift' });
  // the bump is capped at GIFT_CAP — a gift can't vault you past the door
  const pts = Math.min(UNDERWORLD.GIFT_CAP, cur + UNDERWORLD.GIFT_STANDING) - cur;
  await bumpStanding(client, h, ch, npcId, pts);
  await h.track(client, ch.account_id, 'underworld_gift', { npc: npcId });
  return { ok: true, npc: npcId, standing: Number(h.owned.npc[npcId]), tier: npcTier(h, npcId) };
}

// EARLY DISCHARGE — Doc T2 halves a hospital stay, T3 releases in full. Priced per remaining
// minute (a cash sink); the Doc remembers the business (+2).
export async function discharge(ch, client, h) {
  const tier = npcTier(h, 'doc');
  if (tier < 2) throw new GameError('standing', 'Doc Moretti signs early papers for friends, not customers.');
  const now = Date.now();
  const until = ch.hosp_until ? new Date(ch.hosp_until).getTime() : 0;
  if (until <= now) throw new GameError('healthy', "You're not in a hospital bed.");
  const remainingMs = until - now;
  const cost = Math.ceil(remainingMs / 60000) * UNDERWORLD.DISCHARGE_PER_MIN;
  if (Number(ch.cash) < cost) throw new GameError('cash', `Doc's discretion runs $${cost}.`);
  ch.cash = Number(ch.cash) - cost;
  // T3: walk out now. T2: half the remaining stay is forgiven.
  ch.hosp_until = tier >= 3 ? new Date(now) : new Date(now + Math.floor(remainingMs / 2));
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'underworld:discharge' });
  await bumpStanding(client, h, ch, 'doc', 2);
  await h.track(client, ch.account_id, 'underworld_discharge', { cost, full: tier >= 3 });
  return { ok: true, cost, full: tier >= 3,
    hospSeconds: Math.max(0, Math.ceil((new Date(ch.hosp_until).getTime() - now) / 1000)) };
}

// GUN BUYBACK — Bella T3 buys a piece back at GUN_BUYBACK of its cash price. A small bounded
// faucet (once per owned gun — she won't buy what you don't hold), ledgered `underworld:gunsale`.
export async function sellGunBack(ch, gunId, client, h) {
  if (npcTier(h, 'armorer') < 3) throw new GameError('standing', 'Bella only buys from family.');
  const g = GUNS.find((x) => x.id === gunId);
  if (!g || !h.owned.guns.includes(gunId)) throw new GameError('none', "You don't own that piece.");
  if (jailed(ch)) throw new GameError('jailed', 'No deals from lockup.');
  const price = Math.floor(g.cash * UNDERWORLD.GUN_BUYBACK);
  await client.query('DELETE FROM character_guns WHERE character_id=$1 AND gun_id=$2', [ch.id, gunId]);
  h.owned.guns = h.owned.guns.filter((x) => x !== gunId);
  if (ch.gun === gunId) ch.gun = h.owned.guns[0] || null; // she takes it off your hip
  ch.cash = Number(ch.cash) + price;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: price, reason: 'underworld:gunsale' });
  await bumpStanding(client, h, ch, 'armorer', 1);
  await h.track(client, ch.account_id, 'underworld_gunsale', { gun: gunId, price });
  return { ok: true, gun: gunId, price, equipped: ch.gun };
}
