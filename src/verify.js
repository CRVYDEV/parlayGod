// §4 social-task verification for the First Week. Three modes via SOCIAL_VERIFY_MODE:
//   'off'   (default) — social claims are rejected until verification is configured
//   'trust' — honor system for the invite-code alpha (rewards are cash-only anyway)
//   'live'  — real API checks; requires the provider credentials below
// Production MUST run 'live': X follow via the OAuth'd relationship check,
// Discord join via bot member lookup, GitHub star via the REST API.
import { GameError } from './game.js';

export async function verifySocial(taskId, acct) {
  const mode = process.env.SOCIAL_VERIFY_MODE || 'off';
  if (mode === 'trust') return true;
  if (mode !== 'live')
    throw new GameError('verify_unavailable', 'Social verification is not configured on this server yet.');

  if (taskId === 'ob_x') {
    // Requires the account to have signed in with X and X_BEARER_TOKEN set;
    // checks that auth_subject follows the handle in X_TARGET_USER_ID.
    if (!process.env.X_BEARER_TOKEN || !process.env.X_TARGET_USER_ID) throw new GameError('verify_unavailable', 'X verification not configured.');
    if (acct.auth_provider !== 'x') throw new GameError('verify_provider', 'Sign in with X to verify the follow.');
    const res = await fetch(`https://api.x.com/2/users/${acct.auth_subject}/following?max_results=1000`, {
      headers: { authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } });
    if (!res.ok) throw new GameError('verify_failed', 'X could not confirm the follow right now.');
    const data = await res.json();
    if (!(data.data || []).some((u) => u.id === process.env.X_TARGET_USER_ID)) throw new GameError('verify_failed', 'Follow not found.');
    return true;
  }
  if (taskId === 'ob_discord') {
    // Bot member lookup: DISCORD_BOT_TOKEN + DISCORD_GUILD_ID; account must carry a Discord id.
    if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) throw new GameError('verify_unavailable', 'Discord verification not configured.');
    const res = await fetch(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${acct.auth_subject}`, {
      headers: { authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } });
    if (!res.ok) throw new GameError('verify_failed', 'Discord could not confirm membership.');
    return true;
  }
  if (taskId === 'ob_repo') {
    if (!process.env.GITHUB_REPO) throw new GameError('verify_unavailable', 'GitHub verification not configured.');
    // Stargazer check needs the player's GitHub login — collected at claim time in a
    // future client build; until then live mode rejects rather than trusting.
    throw new GameError('verify_unavailable', 'GitHub star verification needs a linked GitHub login.');
  }
  throw new GameError('bad_task', 'Unknown social task.');
}
