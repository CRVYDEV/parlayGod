// THE MENTOR (omerta-first-contact-and-events-design.md, MOVE 1) — the positive first interaction.
//
// The ROLODEX lets a newcomer FIND people and crews let them GROUP, but nothing gave two strangers a
// reason to HELP each other in session one — and the first real-player contact is almost always someone
// TAKING (a jump, a robbery, a contract). THE MENTOR is the positive-sum handshake: a veteran takes a
// newcomer under their wing, ASYNC (an offer + an accept — never sync matchmaking, which a low-pop game
// cannot do; that is the very cold-start we're solving).
//
// The mentor's reward is STATUS ONLY (`proteges_raised` — Sybil-proof by the game's own posture: no
// payout attaches, so farming alts as protégés buys the mentor nothing). The protégé gets a bounded
// onboarding cash faucet at level milestones. ACCOUNT-keyed → the tie SURVIVES DEATH (the referral /
// marriage / contacts posture; not estate-wiped, outside the migrate DISPOSITION guard by construction).
//
// §10.4: one faucet, `mentor:protege` (character_id'd → the per-character cash check reconciles). The
// legend, the seeking flag and graduation move no value. The test proves the vocabulary is closed.
import { GameError, notify, notifyOnce } from './game.js';
import { MENTOR, mentorRankOf, levelOf } from './rules.js';

const lvlOf = (respect) => levelOf(Number(respect));
// resolve a character id → { account_id, name, respect, agent, human }. A plain read.
async function whoIs(client, charId) {
  const r = (await client.query(
    `SELECT c.account_id, c.name, c.respect, c.is_npc, a.agent_flag
       FROM characters c JOIN account_persistent a ON a.account_id=c.account_id
      WHERE c.id=$1 AND c.alive`, [charId])).rows[0];
  return r ? { account_id: r.account_id, name: r.name, respect: r.respect, human: !r.is_npc && !r.agent_flag } : null;
}
const hasMentor = async (client, acct) =>
  !!(await client.query('SELECT 1 FROM mentorships WHERE protege_account=$1', [acct])).rows[0];

// ── SEEKING A MENTOR — the newcomer flags they're open to a wing (the LFG pattern: a boolean + a
// freshness stamp, direct SQL; dies with the street). §10.4-free. ──
export async function seekMentor(ch, on, client, h) {
  if (lvlOf(ch.respect) > MENTOR.PROTEGE_MAX_LVL) throw new GameError('too_high', `Only players level ${MENTOR.PROTEGE_MAX_LVL} and under can seek a mentor.`);
  if (await hasMentor(client, ch.account_id)) throw new GameError('have_mentor', 'You already have a mentor.');
  const flag = !!on;
  await client.query('UPDATE characters SET seeking_mentor=$2, seeking_mentor_at = CASE WHEN $2 THEN now() ELSE seeking_mentor_at END WHERE id=$1', [ch.id, flag]);
  return { ok: true, mentor: flag ? 'seeking' : 'not_seeking', seeking: flag };
}

// ── OFFER TO MENTOR — a veteran puts a word in for a specific newcomer. A pending offer row (the
// crew-invite pattern); the target isn't locked (nothing moves until they accept), so single-party. ──
export async function offerMentor(ch, targetCharId, client, h) {
  if (lvlOf(ch.respect) < MENTOR.MIN_LVL) throw new GameError('level', `You must be level ${MENTOR.MIN_LVL} to take on a protégé.`);
  const me = await whoIs(client, ch.id);
  if (!me || !me.human) throw new GameError('no', 'Not available.');   // agents don't mentor
  const t = await whoIs(client, targetCharId);
  if (!t) throw new GameError('gone', 'No such player.');
  if (t.account_id === ch.account_id) throw new GameError('self', "You can't mentor yourself.");
  if (!t.human) throw new GameError('not_human', 'You can only mentor a real newcomer.');
  if (lvlOf(t.respect) > MENTOR.PROTEGE_MAX_LVL) throw new GameError('too_high', `${t.name} is past level ${MENTOR.PROTEGE_MAX_LVL} — no longer a newcomer.`);
  if (await hasMentor(client, t.account_id)) throw new GameError('taken', `${t.name} already has a mentor.`);
  const active = Number((await client.query('SELECT COUNT(*) n FROM mentorships WHERE mentor_account=$1 AND NOT graduated', [ch.account_id])).rows[0].n);
  if (active >= MENTOR.ACTIVE_MAX) throw new GameError('full', `You already have ${MENTOR.ACTIVE_MAX} protégés under your wing.`);
  await client.query('INSERT INTO mentor_offers (mentor_account, protege_account, from_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [ch.account_id, t.account_id, ch.name]);
  // notifyOnce, not notify: every gate above is on the TARGET's eligibility and none is consumed, so
  // the same call succeeds forever — a free, uncapped ping at a chosen newcomer, which is exactly the
  // audience an onboarding feature must not hand a megaphone at. (red-team F1)
  await notifyOnce(client, targetCharId, 'mentor_offer', { from: ch.name }).catch(() => {});
  return { ok: true, mentor: 'offered', to: t.name };
}

// ── ACCEPT — the newcomer takes the wing. Forms the tie (PK on protégé → one mentor ever); clears the
// offer + the seeking flag; notifies both. Single-party (the tie is on the protégé's account). ──
export async function acceptMentor(ch, mentorCharId, client, h) {
  if (await hasMentor(client, ch.account_id)) throw new GameError('have_mentor', 'You already have a mentor.');
  if (lvlOf(ch.respect) > MENTOR.PROTEGE_MAX_LVL) throw new GameError('too_high', 'You are past the newcomer window.');
  const m = await whoIs(client, mentorCharId);
  if (!m) throw new GameError('gone', 'That mentor is no longer around.');
  if (m.account_id === ch.account_id) throw new GameError('self', "You can't mentor yourself.");
  const offer = (await client.query('SELECT 1 FROM mentor_offers WHERE mentor_account=$1 AND protege_account=$2', [m.account_id, ch.account_id])).rows[0];
  if (!offer) throw new GameError('no_offer', 'They have to offer first.');
  // the tie — PK on protégé, so a race lands one row; the second sees the conflict
  const ins = await client.query('INSERT INTO mentorships (protege_account, mentor_account) VALUES ($1,$2) ON CONFLICT (protege_account) DO NOTHING RETURNING protege_account', [ch.account_id, m.account_id]);
  if (!ins.rows[0]) throw new GameError('have_mentor', 'You already have a mentor.');
  await client.query('DELETE FROM mentor_offers WHERE protege_account=$1', [ch.account_id]);   // all pending offers void
  await client.query('UPDATE characters SET seeking_mentor=false WHERE id=$1', [ch.id]);
  // notify the mentor's CURRENT living street
  const ms = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [m.account_id])).rows[0];
  if (ms) await notify(client, ms.id, 'mentor_accepted', { protege: ch.name }).catch(() => {});
  return { ok: true, mentor: m.name };
}

// ── CLAIM — the protégé collects their onboarding cash for every level milestone they've reached and
// not yet claimed (once-ever per milestone via a bitmask; level-real). The last milestone is GRADUATION:
// claiming it bumps the MENTOR's legend +1 (a claim, so the transition is transactional). §10.4: a
// `mentor:protege` cash faucet, character_id'd. ──
export async function claimMentor(ch, client, h) {
  const ms = (await client.query('SELECT * FROM mentorships WHERE protege_account=$1 FOR UPDATE', [ch.account_id])).rows[0];
  if (!ms) throw new GameError('no_mentor', 'You have no mentor.');
  // AN AGENT GATE AT FORMATION IS NOT A GATE (night red-team F2). `offerMentor` refuses a non-human
  // protégé — but `agent_flag` is set by the account's OWN call to /v1/auth/agent-key at any moment,
  // so that check reads mutable state and a tie formed as a human pays out fine after the flip. The
  // general rule, and the reason this is worth a comment rather than a line: **every agent exclusion
  // belongs at the POINT OF PAYMENT**, where the flag is read at the instant money moves. Every other
  // cash faucet in the tree already does it that way; this was the sole outlier.
  if (h?.acct?.agent_flag) throw new GameError('agent', 'Machines do not draw a newcomer\'s stake.');
  const lvl = lvlOf(ch.respect);
  let mask = Number(ms.claimed_mask), cash = 0, graduated = false;
  const hit = [];
  for (let i = 0; i < MENTOR.MILESTONES.length; i++) {
    const mDef = MENTOR.MILESTONES[i];
    if (lvl < mDef.lvl || (mask & (1 << i))) continue;   // not reached, or already claimed
    mask |= (1 << i);
    cash += mDef.cash;
    hit.push(mDef.lvl);
    if (mDef.graduate && !ms.graduated) graduated = true;
  }
  if (!hit.length) throw new GameError('nothing', 'Nothing to claim yet — keep climbing.');
  if (cash > 0) {
    ch.cash = Number(ch.cash) + cash;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: cash, reason: 'mentor:protege' });
  }
  await client.query('UPDATE mentorships SET claimed_mask=$2, graduated = graduated OR $3 WHERE protege_account=$1', [ch.account_id, mask, graduated]);
  if (graduated) {
    // status only — the mentor's legend +1 (Sybil-proof; no payout attaches). Direct SQL (survives persist).
    await client.query('UPDATE account_persistent SET proteges_raised = proteges_raised + 1 WHERE account_id=$1', [ms.mentor_account]);
    const mch = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [ms.mentor_account])).rows[0];
    if (mch) await notify(client, mch.id, 'protege_graduated', { protege: ch.name }).catch(() => {});
  } else {
    const mch = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [ms.mentor_account])).rows[0];
    if (mch && hit.length) await notify(client, mch.id, 'protege_milestone', { protege: ch.name, lvl: Math.max(...hit) }).catch(() => {});
  }
  return { ok: true, cash, milestones: hit, graduated };
}

// ── THE CARE PACKAGE (step two) — the mentor sends a protégé a bounded cash gift from their OWN pocket.
// A ledgered TRANSFER (`mentor:gift`, both legs character_id'd → the per-character cash check reconciles;
// §10.4-NEUTRAL, no faucet), once per protégé per GIFT_CD_MS. Two-party (it touches the protégé's cash).
// The had-my-back ACTION from the mentor's side. ──
export async function mentorGift(ch, protege, client, h) {
  const ms = (await client.query('SELECT * FROM mentorships WHERE mentor_account=$1 AND protege_account=$2 FOR UPDATE',
    [ch.account_id, protege.account_id])).rows[0];
  if (!ms) throw new GameError('not_mentor', "They're not your protégé.");
  // (red-team F1) the care package is an ONBOARDING aid, not a permanent transfer channel. Once the
  // protégé GRADUATES (level 20 — they've made it), the $5k/day rail closes; otherwise a maxed alt could
  // pull it forever, an untaxed unlimited-duration transfer inconsistent with every other P2P cash rail.
  if (ms.graduated) throw new GameError('graduated', `${protege.name} has graduated — they're on their own now.`);
  if (ms.gift_at && Date.now() - new Date(ms.gift_at).getTime() < MENTOR.GIFT_CD_MS) throw new GameError('cooldown', 'You sent a care package recently — one a day.');
  const amt = MENTOR.GIFT_CASH;
  if (Number(ch.cash) < amt) throw new GameError('cash', `A care package is $${amt.toLocaleString()}.`);
  ch.cash = Number(ch.cash) - amt;
  protege.cash = Number(protege.cash) + amt;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'mentor:gift', counterparty: protege.id });
  await h.ledger(client, { characterId: protege.id, currency: 'cash', amount: amt, reason: 'mentor:gift', counterparty: ch.id });
  await client.query('UPDATE mentorships SET gift_at=now() WHERE mentor_account=$1 AND protege_account=$2', [ch.account_id, protege.account_id]);
  await notify(client, protege.id, 'mentor_gift', { from: ch.name, amount: amt }).catch(() => {});
  return { ok: true, gifted: amt, to: protege.name };
}

// ── THE HAD-MY-BACK ALERT (step two) — when a protégé is attacked by a player, tell their MENTOR (naming
// the aggressor) so they can go settle it. A read + a notify to the mentor's CURRENT living street;
// §10.4-free. Called from the PvP paths (jump win, fire kill). Best-effort — never fails the action. ──
export async function alertMentor(client, protegeAccount, protegeName, aggressorName, what) {
  try {
    const m = (await client.query(
      `SELECT c.id FROM mentorships ms JOIN characters c ON c.account_id=ms.mentor_account AND c.alive
        WHERE ms.protege_account=$1`, [protegeAccount])).rows[0];
    if (m) await notify(client, m.id, 'protege_attacked', { protege: protegeName, from: aggressorName, what });
  } catch { /* an alert must never break the strike */ }
}

// ── THE BOARD — your mentor (their name + rank), your protégés (level + what they can claim), pending
// offers to accept, and your own claimable milestone cash. A read; single-party. ──
export async function mentorBoard(ch, client) {
  const acct = ch.account_id, lvl = lvlOf(ch.respect);
  // your mentor
  const mine = (await client.query(
    `SELECT m.mentor_account, m.claimed_mask, m.graduated, c.id AS char_id, c.name, c.respect, ap.proteges_raised
       FROM mentorships m
       LEFT JOIN characters c ON c.account_id=m.mentor_account AND c.alive
       LEFT JOIN account_persistent ap ON ap.account_id=m.mentor_account
      WHERE m.protege_account=$1`, [acct])).rows[0];
  // what YOU can claim right now (reached, not yet claimed)
  let claimable = 0;
  if (mine) {
    const mask = Number(mine.claimed_mask);
    MENTOR.MILESTONES.forEach((mDef, i) => { if (lvl >= mDef.lvl && !(mask & (1 << i))) claimable += mDef.cash; });
  }
  const mentor = mine ? {
    name: mine.name || 'a fallen mentor', charId: mine.char_id || null,
    rank: mentorRankOf(Number(mine.proteges_raised || 0)).name, graduated: !!mine.graduated, claimable,
  } : null;
  // your protégés (as a mentor) — each with their level + whether they've graduated
  const proteges = (await client.query(
    `SELECT c.id AS char_id, c.name, c.respect, m.graduated, m.gift_at
       FROM mentorships m JOIN characters c ON c.account_id=m.protege_account AND c.alive
      WHERE m.mentor_account=$1 ORDER BY m.started_at DESC LIMIT 24`, [acct]))
    .rows.map((r) => ({ charId: r.char_id, name: r.name, level: lvlOf(r.respect), graduated: !!r.graduated,
      giftReady: !r.gift_at || Date.now() - new Date(r.gift_at).getTime() >= MENTOR.GIFT_CD_MS }));
  // pending offers you (a newcomer) can accept — the mentor's current living street
  const offers = (await client.query(
    `SELECT o.from_name, o.mentor_account, c.id AS char_id, ap.proteges_raised
       FROM mentor_offers o
       LEFT JOIN characters c ON c.account_id=o.mentor_account AND c.alive
       LEFT JOIN account_persistent ap ON ap.account_id=o.mentor_account
      WHERE o.protege_account=$1 ORDER BY o.at DESC LIMIT 12`, [acct]))
    .rows.map((r) => ({ name: r.from_name, charId: r.char_id, rank: mentorRankOf(Number(r.proteges_raised || 0)).name }));
  const activeCount = proteges.filter((p) => !p.graduated).length;
  return {
    me: {
      level: lvl,
      canSeek: !mine && lvl <= MENTOR.PROTEGE_MAX_LVL,
      seeking: !!ch.seeking_mentor,
      canMentor: lvl >= MENTOR.MIN_LVL && activeCount < MENTOR.ACTIVE_MAX,
      atCap: activeCount >= MENTOR.ACTIVE_MAX,
      protegeMaxLvl: MENTOR.PROTEGE_MAX_LVL, minLvl: MENTOR.MIN_LVL, activeMax: MENTOR.ACTIVE_MAX,
      giftCash: MENTOR.GIFT_CASH,
    },
    mentor, proteges, offers,
    milestones: MENTOR.MILESTONES.map((m) => ({ lvl: m.lvl, cash: m.cash, graduate: !!m.graduate })),
  };
}

// ── THE MENTORS LEADERBOARD — by proteges_raised. Pure status, survives death; agents excluded (the
// hitman-rep board twin). Two-flat-queries + a JS pass (the /v1/gangs pg-mem precedent). ──
export async function mentorLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT ap.account_id, ap.proteges_raised, c.name
       FROM account_persistent ap
       LEFT JOIN characters c ON c.account_id=ap.account_id AND c.alive
      WHERE ap.proteges_raised > 0 AND NOT ap.agent_flag
      ORDER BY ap.proteges_raised DESC LIMIT 25`)).rows;
  return rows.map((r) => ({ name: r.name || 'a retired don', raised: Number(r.proteges_raised), rank: mentorRankOf(Number(r.proteges_raised)).name }));
}

// ── worker hygiene: lapse stale offers + stale seeking flags (the reads already filter, this is tidy). ──
export async function sweepMentorOffers(pool) {
  await pool.query(`DELETE FROM mentor_offers WHERE at < now() - ($1 || ' milliseconds')::interval`, [String(MENTOR.OFFER_TTL_MS)]).catch(() => {});
  await pool.query(`UPDATE characters SET seeking_mentor=false WHERE seeking_mentor AND seeking_mentor_at < now() - ($1 || ' milliseconds')::interval`, [String(MENTOR.SEEKING_TTL_MS)]).catch(() => {});
}
