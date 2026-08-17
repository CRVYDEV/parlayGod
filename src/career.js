// THE CAREER — the post-First-Week progression ladder (task #308; the CAREER block in rules.tail).
//
// Five tiers, six tasks each, every task a SERVER-VERIFIED signal (ownership, an account legend,
// mastery XP — the road-to-30 clearing-signal discipline: any single action in a loop stamps it).
// Claims latch ONCE per ACCOUNT (career_claims PK — survives death, the heir keeps the ladder), so
// the whole faucet is bounded at the lifetime total. A tier unlocks at CAREER.NEED claims, never
// all six, so a declinable task (a family, blood) can't wall a solo player; the tier CAPSTONE pays
// only on the sixth claim, folded into that claim's ledger row (the First-Week capstone pattern).
//
// §10.4: every payout is a ledgered `career:<taskId>` cash FAUCET carrying the character_id, so the
// per-character cash check reconciles; `career:` joins the KNOWN_REASONS vocabulary.
import { CAREER, levelOf, masteryLvlOf } from './rules.js';
import { GameError } from './game.js';

// ── the task checks — keyed by id, reading the loadOwned cache + h.acct (two targeted queries).
// Every check answers "has this account's LIVING street provably done the thing" from state the
// server already trusts; nothing here is client-claimed.
const n = (x) => Number(x || 0);
const CHECKS = {
  // Associate
  ca_path:    (ch) => !!ch.path,
  ca_strap:   (ch, h) => (h.owned.guns || []).length >= 1,
  ca_wheels:  (ch, h) => (h.owned.cars || []).length >= 1,
  ca_bank:    (ch) => n(ch.bank) >= 25000,
  ca_regimen: (ch, h) => Object.values(h.owned.disciplines || {}).some((xp) => n(xp) > 0),
  ca_hustle:  (ch, h, x) => x.hustleDone,
  // Soldier
  so_jump:    (ch, h) => n(h.owned.mastery?.muscle) > 0,          // muscle XP fires on jump/shakedown WINS only
  so_earner:  (ch, h) => (h.owned.rackets || []).length >= 1 || (h.owned.assets || []).length >= 1,
  so_crew:    (ch, h) => n(h.acct?.heists_pulled) >= 1,
  so_product: (ch, h) => n(h.owned.mastery?.chemistry) > 0,       // cook/deal both school chemistry
  so_fight:   (ch, h) => n(h.owned.mastery?.fists) > 0,           // duel/bout wins school fists
  so_trade:   (ch, h) => n(h.owned.mastery?.commerce) > 0,        // a goods sale at a margin is commerce
  // Made Man
  md_front:   (ch, h) => (h.owned.businesses || []).length >= 1,
  md_family:  (ch, h) => !!h.owned.gang,
  md_freight: (ch, h) => n(h.acct?.smuggled) > 0 || n(h.acct?.freight_delivered) > 0,
  md_stable:  (ch, h, x) => (h.owned.fighters || []).length >= 1 || x.hasRacer,
  md_legit:   (ch, h) => n(h.acct?.staked) > 0,                   // D11: the paper book retired — staking IS going legit
  md_shield:  (ch, h, x) => x.boughtShield,
  // Capo
  cp_vice:    (ch, h) => n(h.owned.mastery?.gambling) > 0 || n(h.acct?.race_wins) >= 1 || n(h.acct?.boxing_wins) >= 1,
  cp_kingpin: (ch, h) => n(h.acct?.product_moved) >= 50000,
  cp_spy:     (ch, h) => n(h.acct?.intel_ops) >= 1,
  cp_blood:   (ch, h) => n(h.acct?.kills) >= 1 || n(h.owned.mastery?.wetwork) > 0,
  cp_empire:  (ch, h) => (h.owned.businesses || []).length + (h.owned.rackets || []).length + (h.owned.assets || []).length >= 3,
  cp_estate:  (ch, h) => !!h.owned.estate,
  // The Don
  dn_legend:  (ch, h) => n(h.acct?.smuggled) >= 250000 || n(h.acct?.product_moved) >= 250000 || n(h.acct?.tycoon_earned) >= 250000,
  dn_master:  (ch, h) => Object.values(h.owned.mastery || {}).some((xp) => masteryLvlOf(n(xp)) >= 25),
  dn_dynasty: (ch, h) => !!h.acct?.minted,                        // D11: dynasty naming retired — a minted identity is the bloodline made permanent
  dn_monument:(ch, h, x) => x.builtMonument,
  dn_champ:   (ch, h) => n(h.acct?.boxing_wins) >= 10 || n(h.acct?.race_wins) >= 10 || n(h.acct?.duel_wins) >= 5,
  dn_name:    (ch) => levelOf(n(ch.respect)) >= 40,
};

// the few signals loadOwned doesn't carry — one batched pass, PK/index lookups only
async function extraSignals(client, ch) {
  const [hustle, racer, shield, monument] = await Promise.all([
    client.query('SELECT 1 FROM hustles WHERE character_id=$1 AND step>=3 LIMIT 1', [ch.id]),
    client.query('SELECT 1 FROM racers WHERE character_id=$1 LIMIT 1', [ch.id]),
    client.query(`SELECT 1 FROM transactions WHERE character_id=$1 AND reason IN ('safehouse','bodyguard:hire') AND amount < 0 LIMIT 1`, [ch.id]),
    client.query('SELECT 1 FROM megaproject_contributions WHERE account_id=$1 LIMIT 1', [ch.account_id]),
  ]);
  return { hustleDone: !!hustle.rows[0], hasRacer: !!racer.rows[0],
    boughtShield: !!shield.rows[0], builtMonument: !!monument.rows[0] };
}

const claimedSet = async (client, accountId) => new Set((await client.query(
  'SELECT task_id FROM career_claims WHERE account_id=$1', [accountId])).rows.map((r) => r.task_id));

// which tiers are open: tier 0 always; tier i+1 once tier i has NEED claims
function tierStates(claimed) {
  return CAREER.TIERS.map((t, i) => {
    const done = t.tasks.filter((k) => claimed.has(k.id)).length;
    return { tier: t, done, open: i === 0 ? true : null }; // open resolved in a second pass below
  }).map((s, i, arr) => {
    if (i > 0) s.open = arr[i - 1].done >= CAREER.NEED;
    return s;
  });
}

// ── GET /v1/career — the ladder, server-computed ready/claimed per task ──
export async function careerBoard(ch, client, h) {
  const claimed = await claimedSet(client, ch.account_id);
  const x = await extraSignals(client, ch);
  const states = tierStates(claimed);
  return {
    need: CAREER.NEED,
    tiers: states.map(({ tier: t, done, open }) => ({
      id: t.id, name: t.name, capstone: t.capstone, open, done, of: t.tasks.length,
      complete: done >= t.tasks.length,
      tasks: t.tasks.map((k) => ({ id: k.id, name: k.name, cash: k.cash, how: k.how, tab: k.tab,
        claimed: claimed.has(k.id),
        ready: open && !claimed.has(k.id) && !!CHECKS[k.id]?.(ch, h, x) })),
    })),
  };
}

// ── POST /v1/career/:taskId — claim a done task (cash faucet, once ever per account) ──
export async function claimCareer(ch, taskId, client, h) {
  const tierIdx = CAREER.TIERS.findIndex((t) => t.tasks.some((k) => k.id === taskId));
  if (tierIdx < 0) throw new GameError('bad_task', 'No such rung on the ladder.');
  const tier = CAREER.TIERS[tierIdx];
  const task = tier.tasks.find((k) => k.id === taskId);
  const claimed = await claimedSet(client, ch.account_id);
  const states = tierStates(claimed);
  if (!states[tierIdx].open) throw new GameError('tier_locked', `Climb first — ${CAREER.NEED} claims in the tier below open ${tier.name}.`);
  // claimed BEFORE not_done: an heir who no longer holds the proving state (the gun died with the
  // street) must hear "already collected", never be asked to prove it again
  if (claimed.has(taskId)) throw new GameError('claimed', 'Already collected.');
  const x = await extraSignals(client, ch);
  // `Object.hasOwn`, not truthiness: a prototype key indexes truthy and `?.()` would then TypeError
  // on a non-function (red team #8). The task lookup above already gates it; this is the class fix.
  if (!Object.hasOwn(CHECKS, taskId) || !CHECKS[taskId](ch, h, x)) throw new GameError('not_done', `Not yet — ${task.how}`);
  // atomic latch: the PK is the once-ever (the account survives death, so does the claim)
  const ins = await client.query(
    'INSERT INTO career_claims (account_id, task_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [ch.account_id, taskId]);
  if (!ins.rowCount) throw new GameError('claimed', 'Already collected.');
  // the capstone rides the SIXTH claim's row (the First-Week pattern) — the tier NEEDs only 4 to
  // progress, so the capstone is the completionist's bonus, never the wall
  const doneNow = states[tierIdx].done + 1;
  const capstone = doneNow >= tier.tasks.length ? tier.capstone : 0;
  const pay = task.cash + capstone;
  ch.cash = n(ch.cash) + pay;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: pay, reason: `career:${taskId}` });
  await h.notify(client, ch.id, 'career_claim', { task: task.name, tier: tier.name, pay, capstone: capstone || undefined });
  return { ok: true, task: task.name, tier: tier.name, pay, capstone: capstone || undefined,
    tierDone: doneNow, tierOf: tier.tasks.length };
}
