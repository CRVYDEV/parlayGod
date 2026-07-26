// §4 social-task verification for the First Week. Three modes via SOCIAL_VERIFY_MODE:
//   'off'   (default) — social claims are rejected until verification is configured
//   'trust' — honor system for the invite-code alpha (rewards are cash-only anyway)
//   'live'  — real API checks; requires the provider credentials below
// Production MUST run 'live': X follow via the OAuth'd relationship check,
// Discord join via bot member lookup.
import { GameError } from './game.js';

// ── X-API bulletproofing (the X-integrations hardening pass) ──
// Every outbound call is TIME-BOXED: these verifications run inside a withCharacter txn holding
// the caller's char row lock, so a hung X API must never pin a DB lock — 8s and we bail. And a
// TRANSIENT failure (429 rate limit / 5xx / network / timeout) is 'verify_busy' — a clean
// retryable "X is busy" that keeps the player's registration standing — NEVER conflated with a
// definitive answer like post_gone/verify_failed (an X outage must not read as "your post is gone").
const X_TIMEOUT_MS = 8000;
export async function xfetch(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, { ...opts, signal: AbortSignal.timeout(X_TIMEOUT_MS) });
  } catch {
    throw new GameError('verify_busy', 'X is not answering right now — try again in a minute. Nothing is lost.');
  }
  if (res.status === 429 || res.status >= 500)
    throw new GameError('verify_busy', 'X is busy right now — try again in a few minutes. Nothing is lost.');
  return res;
}

// ── WHICH SOCIAL CHECKS THIS SERVER CAN ACTUALLY PERFORM ────────────────────────────────────────
// A live server can be configured for X, for Discord, for both, or (the case that shipped) for
// NEITHER while still running SOCIAL_VERIFY_MODE=live. The old behaviour was that every claim then
// threw `verify_unavailable` — so the First-Week checklist showed two rewards nobody could ever
// collect, which also made the all-done capstone unreachable, and the Spread-the-Word faucet paid
// nothing. The failure was invisible: no error at boot, no dashboard row, nothing in the game.
//
// So availability is now a QUESTION THE SERVER CAN ANSWER, asked in one place. Callers use it to
// degrade honestly — a task whose provider is unconfigured is not offered, rather than offered and
// refused. In `trust` mode outside production everything is claimable, which is the alpha posture.
// `off` pays nothing by design (a misconfigured server must never leak a faucet).
export function socialProviders() {
  const mode = process.env.SOCIAL_VERIFY_MODE || 'off';
  if (mode === 'off') return { mode, x: false, discord: false, posts: false };
  if (mode === 'trust') {
    const prod = process.env.NODE_ENV === 'production';   // trust is refused in production below
    return { mode, x: !prod, discord: !prod, posts: !prod };
  }
  return {
    mode,
    x: !!(process.env.X_BEARER_TOKEN && process.env.X_TARGET_USER_ID),
    discord: !!(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID),
    posts: !!process.env.X_BEARER_TOKEN,                  // verifyPostUp needs only the bearer token
  };
}

// which provider a First-Week social task needs, so one map serves the board, the claim and the coach
export const TASK_PROVIDER = { ob_x: 'x', ob_discord: 'discord' };
export const socialTaskAvailable = (taskId) => {
  const p = TASK_PROVIDER[taskId];
  return !p || !!socialProviders()[p];
};

export async function verifySocial(taskId, acct) {
  const mode = process.env.SOCIAL_VERIFY_MODE || 'off';
  // 'trust' is an honor-system faucet — never let it run in production, where it
  // would pay social-task cash to the whole player base with no proof.
  if (mode === 'trust') {
    if (process.env.NODE_ENV === 'production')
      throw new GameError('verify_unavailable', 'Honor-system verification is disabled in production.');
    return true;
  }
  if (mode !== 'live')
    throw new GameError('verify_unavailable', 'Social verification is not configured on this server yet.');

  if (taskId === 'ob_x') {
    // Requires the account to have signed in with X and X_BEARER_TOKEN set;
    // checks that auth_subject follows the handle in X_TARGET_USER_ID.
    if (!process.env.X_BEARER_TOKEN || !process.env.X_TARGET_USER_ID) throw new GameError('verify_unavailable', 'X verification not configured.');
    if (acct.auth_provider !== 'x') throw new GameError('verify_provider', 'Sign in with X to verify the follow.');
    // PAGINATE (the >1000-follows fix): a player following more than one page of accounts used to
    // get a false "Follow not found" — walk up to 5 pages (5000 follows) via pagination_token.
    let next = null;
    for (let page = 0; page < 5; page++) {
      const u = new URL(`https://api.x.com/2/users/${acct.auth_subject}/following`);
      u.searchParams.set('max_results', '1000');
      if (next) u.searchParams.set('pagination_token', next);
      const res = await xfetch(u, { headers: { authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } });
      if (!res.ok) throw new GameError('verify_failed', 'X could not confirm the follow right now.');
      const data = await res.json().catch(() => ({}));
      if ((data.data || []).some((x) => x.id === process.env.X_TARGET_USER_ID)) return true;
      next = data.meta?.next_token;
      if (!next) break;
    }
    throw new GameError('verify_failed', 'Follow not found.');
  }
  if (taskId === 'ob_discord') {
    // Bot member lookup: DISCORD_BOT_TOKEN + DISCORD_GUILD_ID; account must carry a Discord id.
    if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) throw new GameError('verify_unavailable', 'Discord verification not configured.');
    const res = await fetch(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${acct.auth_subject}`, {
      headers: { authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } });
    if (!res.ok) throw new GameError('verify_failed', 'Discord could not confirm membership.');
    return true;
  }
  throw new GameError('bad_task', 'Unknown social task.');
}

// THE 4-HOUR STAND (founder-directed anti-abuse for Spread-the-Word): when a matured share is
// claimed, live mode re-checks that the registered post STILL EXISTS on X — post-and-delete pays
// nothing. Trust mode skips the API check but the 4h clock itself is enforced in growth.js either
// way (deleting early still forfeits under live; under trust the time cost alone deters churn).
export async function verifyPostUp(proof, ctx = {}) {
  const mode = process.env.SOCIAL_VERIFY_MODE || 'off';
  if (mode !== 'live') return true;
  if (!process.env.X_BEARER_TOKEN) throw new GameError('verify_unavailable', 'X verification not configured.');
  const s = String(proof || '');
  const id = s.match(/status(?:es)?\/(\d{8,25})/)?.[1] || s.match(/^(\d{8,25})$/)?.[1];
  if (!id) throw new GameError('need_proof', 'Register the share with a link to your post so it can be verified.');
  // (D2) for an X-linked account we KNOW the player's X id, so bind the post to THEM — upgrades
  // "a post with this id exists" to "THIS player's post exists", blocking a payout for registering
  // a celebrity's (or anyone's) permanent tweet. Guest/Privy accounts keep the plain existence check.
  let wantAuthor = null;
  if (ctx.client && ctx.accountId) {
    const acc = (await ctx.client.query('SELECT auth_provider, auth_subject FROM accounts WHERE id=$1', [ctx.accountId])).rows[0];
    if (acc && acc.auth_provider === 'x' && acc.auth_subject) wantAuthor = String(acc.auth_subject);
  }
  const url = `https://api.x.com/2/tweets/${id}` + (wantAuthor ? '?tweet.fields=author_id' : '');
  // xfetch maps 429/5xx/network/timeout to 'verify_busy' BEFORE we get here — so the post_gone
  // below is only ever a DEFINITIVE answer (X responded and the tweet isn't there), never an
  // outage misread as a deleted post that would scare a legit sharer.
  const res = await xfetch(url, { headers: { authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.data || j.errors) throw new GameError('post_gone', 'That post is gone — it has to stand to pay.');
  if (wantAuthor && String(j.data.author_id || '') !== wantAuthor)
    throw new GameError('not_your_post', "That post has to come from your linked X account to pay.");
  return true;
}
