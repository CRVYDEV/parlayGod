import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import crypto from 'node:crypto';
import { makeDb } from './db.js';
import * as G from './game.js';
import * as E from './economy.js';
import * as S from './social.js';
import * as K from './kitchen.js';
import * as W from './growth.js';
import * as A from './auth.js';
import * as Chain from './chain.js';
import * as Fees from './fees.js';
import { rateLimitsEnabled, initRateLimiter, checkRateLimit } from './ratelimit.js';
import { runLedgerInvariants } from './invariants.js';
import { dayOf, cityEventOf, priceBlock, goodPriceOf, demandOf, makingsPriceOf,
         levelOf, GOODS, DRUGS, DISTRICTS } from './rules.js';

const uid = () => crypto.randomUUID();

export async function buildServer() {
  // Never boot production on the public dev fallback secret — anyone could forge a
  // token for any account. Dev/test may use the fallback (in-memory db, no real value).
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET)
    throw new Error('JWT_SECRET must be set in production — refusing to boot on the dev fallback.');
  const app = Fastify({ logger: false });
  const pool = await makeDb();
  app.decorate('pool', pool);
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret-change-me' });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof G.GameError) return reply.code(400).send({ error: err.code, message: err.message });
    if (err.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER' || err.statusCode === 401) return reply.code(401).send({ error: 'auth' });
    req.log?.error?.(err); console.error(err);
    return reply.code(500).send({ error: 'internal' });
  });
  const auth = async (req, reply) => {
    await req.jwtVerify();
    // §10.3 — banned accounts are refused at the door
    const a = (await pool.query('SELECT status FROM accounts WHERE id=$1', [req.user.sub])).rows[0];
    if (!a || a.status === 'banned') return reply.code(403).send({ error: 'banned' });
  };
  // Mod endpoints (§10.3) authenticate with the MOD_KEY header, never a player JWT.
  const modAuth = async (req, reply) => {
    if (!process.env.MOD_KEY || req.headers['x-mod-key'] !== process.env.MOD_KEY)
      return reply.code(401).send({ error: 'mod_auth' });
  };

  // ── M5 hardening hooks: §10.2 rate limits + §5 idempotency keys ──
  // Applied to mutating player endpoints (auth/mod routes are excluded).
  await initRateLimiter();
  const guarded = (req) => (req.method === 'POST' || req.method === 'DELETE')
    && req.url.startsWith('/v1') && !req.url.startsWith('/v1/auth') && !req.url.startsWith('/v1/mod');
  app.addHook('preHandler', async (req, reply) => {
    if (!guarded(req)) return;
    try { await req.jwtVerify(); } catch { return; } // unauthenticated → the route 401s
    // Ban + agent status come from the DB, never the token: an agent-flagged account
    // could otherwise keep using its pre-flag token to dodge the harder agent throttle.
    const acct = (await pool.query(
      'SELECT a.status, ap.agent_flag FROM accounts a LEFT JOIN account_persistent ap ON ap.account_id=a.id WHERE a.id=$1',
      [req.user.sub])).rows[0];
    if (!acct || acct.status === 'banned') return reply.code(403).send({ error: 'banned' });
    if (rateLimitsEnabled()) {
      const limited = await checkRateLimit({ accountId: req.user.sub, agent: !!acct.agent_flag,
        path: req.routeOptions?.url || req.url });
      if (limited) return reply.code(429).header('retry-after', limited.retryAfter)
        .send({ error: 'rate_limited', retryAfter: limited.retryAfter });
    }
    // Idempotency: RESERVE the key transactionally before the handler runs, so two
    // concurrent requests with the same key can't both execute (a check-only guard
    // that stores in onSend does not stop the double-submit it exists to prevent).
    const idem = req.headers['idempotency-key'];
    if (idem) {
      const key = String(idem);
      const bodyHash = crypto.createHash('sha256')
        .update(req.method + '\n' + req.url + '\n' + JSON.stringify(req.body ?? null)).digest('hex');
      let reserved = false;
      try {
        await pool.query('INSERT INTO idempotency (account_id, key, status, body_hash, response) VALUES ($1,$2,0,$3,$4)',
          [req.user.sub, key, bodyHash, '']);
        reserved = true;
      } catch { /* PK conflict → the key already exists */ }
      if (reserved) { req._idem = { key, bodyHash }; return; }
      const row = (await pool.query('SELECT status, body_hash, response FROM idempotency WHERE account_id=$1 AND key=$2',
        [req.user.sub, key])).rows[0];
      if (!row) { req._idem = { key, bodyHash }; return; } // released between insert and read — proceed
      if (row.body_hash !== bodyHash)
        return reply.code(422).send({ error: 'idempotency_key_reuse', message: 'This Idempotency-Key was used with a different request.' });
      if (row.status === 0)
        return reply.code(409).header('retry-after', 1).send({ error: 'in_progress', message: 'A request with this key is still processing.' });
      return reply.code(row.status).header('x-idempotent-replay', 'true').type('application/json').send(row.response);
    }
  });
  app.addHook('onSend', async (req, reply, payload) => {
    if (!req._idem || reply.getHeader('x-idempotent-replay')) return payload;
    const { key } = req._idem;
    // Only a genuine success is stored (and thus replayed). A 4xx/5xx RELEASES the
    // reservation so the key isn't poisoned — a transient "jailed" or a 429 must not
    // permanently lock the key out.
    if (reply.statusCode >= 200 && reply.statusCode < 300) {
      await pool.query('UPDATE idempotency SET status=$3, response=$4 WHERE account_id=$1 AND key=$2',
        [req.user.sub, key, reply.statusCode, String(payload)]).catch(() => {});
    } else {
      await pool.query('DELETE FROM idempotency WHERE account_id=$1 AND key=$2 AND status=0',
        [req.user.sub, key]).catch(() => {});
    }
    return payload;
  });

  // ── auth (§4): guest, X, Privy — all behind the invite gate when INVITE_MODE=on ──
  app.post('/v1/auth/guest', async (req) => {
    await A.consumeInvite(pool, req.body?.inviteCode);
    const id = uid();
    await pool.query('INSERT INTO accounts (id, auth_provider, auth_subject, created_ip, last_ip) VALUES ($1,$2,$3,$4,$4)',
      [id, 'guest', id, req.ip || '0.0.0.0']);
    await pool.query('INSERT INTO account_persistent (account_id) VALUES ($1)', [id]);
    return { token: app.jwt.sign({ sub: id }, { expiresIn: '30d' }) };
  });
  const providerLogin = (verify) => async (req) => {
    const identity = await verify(req.body?.token);
    const existing = (await pool.query('SELECT id FROM accounts WHERE auth_provider=$1 AND auth_subject=$2',
      [identity.provider, identity.subject])).rows[0];
    if (!existing) await A.consumeInvite(pool, req.body?.inviteCode); // invites gate NEW accounts only
    const { accountId, created } = await A.accountForIdentity(pool, identity, req.ip || '0.0.0.0');
    return { token: app.jwt.sign({ sub: accountId }, { expiresIn: '30d' }), created };
  };
  app.post('/v1/auth/x', providerLogin(A.verifyX));
  app.post('/v1/auth/privy', providerLogin(A.verifyPrivy));
  // guest → provider upgrade preserves the account row and everything on it (§4)
  app.post('/v1/auth/upgrade', { preHandler: auth }, async (req) => {
    const verify = req.body?.provider === 'x' ? A.verifyX
      : req.body?.provider === 'privy' ? A.verifyPrivy : null;
    if (!verify) throw new G.GameError('bad_provider', 'Providers: x, privy.');
    const identity = await verify(req.body?.token);
    return A.upgradeAccount(pool, req.user.sub, identity);
  });
  // §4/§10.2 agent API keys: flags the account permanently (🤖 badge, referral
  // exclusion) and mints a token the rate limiter throttles at 1 action / 3 s.
  app.post('/v1/auth/agent-key', { preHandler: auth }, async (req) => {
    await pool.query('UPDATE account_persistent SET agent_flag=true WHERE account_id=$1', [req.user.sub]);
    return { token: app.jwt.sign({ sub: req.user.sub, agent: true }, { expiresIn: '90d' }), agent: true };
  });

  // ── character ──
  app.post('/v1/character', { preHandler: auth }, async (req) => {
    const name = String(req.body?.name || '').trim().slice(0, 24);
    if (name.length < 2) throw new G.GameError('name', 'Pick a name (2–24 chars).');
    const existing = await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub]);
    if (existing.rows.length) throw new G.GameError('exists', 'One living character per account.');
    // names must be unique among the living (referral codes resolve by name, §7.13);
    // the partial unique index ux_char_name_alive is the race backstop
    const nameClash = await pool.query('SELECT 1 FROM characters WHERE name=$1 AND alive', [name]);
    if (nameClash.rows.length) throw new G.GameError('name_taken', 'Someone on the streets already goes by that name.');
    const season = Math.floor(dayOf() / 28);
    const id = uid();
    await pool.query('INSERT INTO characters (id, account_id, name, season) VALUES ($1,$2,$3,$4)', [id, req.user.sub, name, season]);
    if (req.body?.referralCode) {
      // §7.13 — the referral code is the recruiter's character name
      const rec = await pool.query('SELECT account_id FROM characters WHERE name=$1 AND alive AND account_id<>$2 LIMIT 1', [String(req.body.referralCode), req.user.sub]);
      if (rec.rows.length) {
        await pool.query('UPDATE account_persistent SET referred_by=$1 WHERE account_id=$2 AND referred_by IS NULL', [rec.rows[0].account_id, req.user.sub]);
        const existing = await pool.query('SELECT 1 FROM referrals WHERE recruit_account=$1', [req.user.sub]);
        if (!existing.rows.length)
          await pool.query('INSERT INTO referrals (recruit_account, recruiter_account) VALUES ($1,$2)', [req.user.sub, rec.rows[0].account_id]);
      }
    }
    return { ok: true, id };
  });

  app.get('/v1/me', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, async () => ({})));

  // Lightweight pre-character session probe: a freshly-authed client can ask "am I set up?"
  // without eating a no_character 400 from /v1/me. Surfaces the whole gate state at a glance.
  app.get('/v1/session', { preHandler: auth }, async (req) => {
    const a = (await pool.query('SELECT minted, mint_credits, respawn_tokens, wallet_address, agent_flag FROM account_persistent WHERE account_id=$1', [req.user.sub])).rows[0] || {};
    const ch = (await pool.query('SELECT id, name, generation FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0] || null;
    return { authed: true, hasCharacter: !!ch, character: ch ? { id: ch.id, name: ch.name, generation: ch.generation } : null,
      minted: !!a.minted, mintCredits: Number(a.mint_credits || 0), respawnTokens: Number(a.respawn_tokens || 0),
      wallet: a.wallet_address || null, agent: !!a.agent_flag,
      canWithdraw: !!a.minted && !!a.wallet_address };
  });

  // ── M1 actions (crimes/gym/doc/checkin/bank/travel) ──
  app.post('/v1/crimes/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.doCrime(ch, req.params.id, client, h)));
  app.post('/v1/train/:stat', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.train(ch, req.params.stat, client, h)));
  app.post('/v1/heal', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.heal(ch, client, h)));
  app.post('/v1/checkin', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.checkin(ch, client, h)));
  app.post('/v1/bank/:dir', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.bank(ch, req.params.dir, req.body?.amount, client, h)));
  app.post('/v1/travel/:district', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.travel(ch, req.params.district, client, h)));

  // ── M2: garage (§7.5) ──
  app.post('/v1/garage/boost', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.boostCar(ch, client, h)));
  app.post('/v1/garage/:carId/melt', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.meltCar(ch, req.params.carId, client, h)));
  app.post('/v1/garage/:carId/repair', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.repairCar(ch, req.params.carId, client, h)));
  app.post('/v1/garage/:carId/fence', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.fenceCar(ch, req.params.carId, client, h)));

  // ── M2: workshop + consumables (§5.4) ──
  app.post('/v1/workshop/craft/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.craft(ch, req.params.id, client, h)));
  app.post('/v1/workshop/ammo', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.craftAmmo(ch, client, h)));
  app.post('/v1/items/:id/use', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.useItem(ch, req.params.id, client, h)));

  // ── M2: trade goods (§7.11) ──
  app.post('/v1/goods/buy', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.buyGood(ch, req.body?.goodId, req.body?.qty, client, h)));
  app.post('/v1/goods/sell', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.sellGood(ch, req.body?.goodId, req.body?.qty, client, h)));

  // ── M2: rackets & assets (§5.4) ──
  app.post('/v1/rackets/:id/buy', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.buyRacket(ch, req.params.id, client, h)));
  app.post('/v1/assets/:id/buy', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.buyAsset(ch, req.params.id, client, h)));
  app.post('/v1/assets/:id/sell', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.sellAsset(ch, req.params.id, client, h)));

  // ── M2: swap, staking, gear (§7.12 / §5.4) ──
  app.post('/v1/swap', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.swap(ch, req.body?.direction, req.body?.amount, client, h)));
  app.post('/v1/stake', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.stake(ch, req.body?.amount, client, h)));
  app.post('/v1/unstake', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.unstake(ch, client, h)));
  app.post('/v1/claim-rewards', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.claimRewards(ch, client, h)));
  app.post('/v1/gear/:id/mint', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.mintGear(ch, req.params.id, client, h)));

  // ── M3: armory (§5.2) ──
  app.post('/v1/armory/gun/:id/buy', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.buyGun(ch, req.params.id, client, h)));
  app.post('/v1/armory/gun/:id/equip', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.equipGun(ch, req.params.id, client, h)));
  app.post('/v1/armory/unequip', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.equipGun(ch, null, client, h)));
  app.post('/v1/armory/vest/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.buyVest(ch, req.params.id, client, h)));
  app.post('/v1/armory/ammo', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => E.buyAmmo(ch, client, h)));

  // ── M3: family (§5.5) ──
  app.post('/v1/gangs', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.createGang(ch, req.body?.name, req.body?.tag, client, h)));
  app.post('/v1/gangs/:id/join', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.joinGang(ch, req.params.id, client, h)));
  app.post('/v1/gangs/leave', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.leaveGang(ch, client, h)));
  app.post('/v1/gangs/kick', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.kickMember(ch, req.body?.characterId, client, h)));
  app.post('/v1/gangs/promote', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.promoteMember(ch, req.body?.characterId, req.body?.role, client, h)));
  app.post('/v1/gangs/tribute', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.tribute(ch, req.body?.amount, client, h)));
  app.post('/v1/gangs/war/:targetGangId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.declareWar(ch, req.params.targetGangId, client, h)));
  app.post('/v1/districts/:id/seize', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.seizeDistrict(ch, req.params.id, client, h)));

  app.get('/v1/gangs', async () => {
    const r = await pool.query(`SELECT g.id, g.name, g.tag, g.treasury, g.wars_won, g.lifetime_tribute,
      (SELECT COUNT(*) FROM gang_members m WHERE m.gang_id = g.id) AS members FROM gangs g`);
    return { gangs: r.rows.map((g) => ({ id: g.id, name: g.name, tag: g.tag,
      members: Number(g.members), warsWon: Number(g.wars_won),
      standing: Number(g.lifetime_tribute) + 10000 * Number(g.wars_won) })) };
  });
  app.get('/v1/gangs/:id', async (req) => {
    const client = await pool.connect();
    try { // war state resolves lazily on read
      await client.query('BEGIN');
      await S.resolveWarIfDue(client, req.params.id);
      const g = (await client.query('SELECT * FROM gangs WHERE id=$1', [req.params.id])).rows[0];
      if (!g) { await client.query('COMMIT'); return { gang: null }; }
      const members = (await client.query(
        'SELECT m.character_id, m.role, c.name FROM gang_members m JOIN characters c ON c.id = m.character_id WHERE m.gang_id=$1', [req.params.id])).rows;
      const held = (await client.query('SELECT id FROM districts WHERE holder_gang=$1', [req.params.id])).rows.map((d) => d.id);
      await client.query('COMMIT');
      return { gang: { id: g.id, name: g.name, tag: g.tag, treasury: Math.floor(Number(g.treasury)),
        ammoBank: Number(g.ammo_bank), omrReserve: Number(g.omr_reserve), warsWon: Number(g.wars_won),
        war: g.war_with ? { with: g.war_with, until: g.war_until, us: g.war_score_us, them: g.war_score_them } : null,
        weekly: { week: g.weekly_week, progress: Number(g.weekly_progress), done: g.weekly_done },
        members: members.map((m) => ({ id: m.character_id, name: m.name, role: m.role })), held } };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  });
  app.get('/v1/districts', async () => {
    const r = await pool.query('SELECT d.id, d.holder_gang, d.garrison, g.name AS gang_name, g.tag FROM districts d LEFT JOIN gangs g ON g.id = d.holder_gang');
    return { districts: r.rows.map((d) => ({ id: d.id, perk: DISTRICTS.find((x) => x.id === d.id)?.perk,
      holder: d.holder_gang ? { gangId: d.holder_gang, name: d.gang_name, tag: d.tag } : null,
      garrison: Math.floor(Number(d.garrison)) })) };
  });

  // ── M3: the streets (§5.2) ──
  app.get('/v1/streets', { preHandler: auth }, async () => {
    const r = await pool.query(`SELECT c.id, c.name, c.respect, c.loc, c.jail_until, c.hosp_until, g.tag
      FROM characters c LEFT JOIN gang_members m ON m.character_id = c.id LEFT JOIN gangs g ON g.id = m.gang_id
      WHERE c.alive ORDER BY c.respect DESC LIMIT 100`);
    return { streets: r.rows.map((c) => ({ id: c.id, name: c.name, level: levelOf(Number(c.respect)),
      respect: Number(c.respect), loc: c.loc, gangTag: c.tag || null,
      jailed: !!(c.jail_until && new Date(c.jail_until) > new Date()),
      hospitalized: !!(c.hosp_until && new Date(c.hosp_until) > new Date()) })) };
  });
  app.post('/v1/streets/:targetId/jump', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => S.jump(ch, victim, client, h)));
  app.post('/v1/streets/:targetId/bounty', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.postBounty(ch, req.params.targetId, req.body?.amount, client, h,
      { kind: req.body?.kind, reason: req.body?.reason, hours: req.body?.hours, anon: req.body?.anon,
        hitman: req.body?.hitman, exclusiveHours: req.body?.exclusiveHours })));
  // The contract board — browse open contracts, and pull your own funding back.
  app.get('/v1/contracts', { preHandler: auth }, async () => ({ contracts: await S.listContracts(pool) }));
  app.post('/v1/contracts/:targetId/:kind/cancel', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.cancelBounty(ch, req.params.targetId, req.params.kind, client, h)));
  // The feared-assassin leaderboard (M7 Phase 2): lifetime legend + this season's kill streak.
  app.get('/v1/leaderboard/hitmen', { preHandler: auth }, async () => S.hitmanLeaderboard(pool));
  // M7 Phase 3: hire an NPC contractor for a rolled hit on a target (a ledgered cash sink).
  app.post('/v1/streets/:targetId/npchit', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => S.npcHit(ch, victim, client, h, req.body?.tier)));
  // M7 Phase 4: go to ground in a safehouse — earnable defense (untargetable by fire/NPC-hit).
  app.post('/v1/safehouse', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.enterSafehouse(ch, client, h)));
  // M7 Phase 4: family contracts — the boss posts (and cancels) a contract funded from the treasury.
  app.post('/v1/gangs/contract/:targetId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.postFamilyContract(ch, req.params.targetId, req.body?.amount, client, h,
      { kind: req.body?.kind, reason: req.body?.reason, hours: req.body?.hours, anon: req.body?.anon })));
  app.post('/v1/gangs/contract/:targetId/:kind/cancel', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.cancelFamilyContract(ch, req.params.targetId, req.params.kind, client, h)));
  // M7 Phase 4: bodyguards — list yourself for hire; hire a listed guard (two-party, ledgered transfer).
  app.post('/v1/bodyguard/offer', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.offerBodyguard(ch, req.body?.price, client, h)));
  app.post('/v1/bodyguard/hire/:guardId', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.guardId, (ch, guard, client, h) => S.hireBodyguard(ch, guard, client, h)));
  app.post('/v1/streets/:targetId/search', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.startSearch(ch, req.params.targetId, client, h)));
  app.delete('/v1/streets/search', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client) => S.callOffSearch(ch, client)));
  app.post('/v1/streets/:targetId/fire', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => S.fire(ch, victim, client, h, req.body?.rounds)));
  app.post('/v1/streets/:targetId/bust', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => S.bust(ch, victim, client, h)));

  // ── M3: the exchange (§5.4, escrowed order book) ──
  app.get('/v1/exchange', async () => {
    const r = await pool.query('SELECT l.*, c.name AS seller_name FROM listings l JOIN characters c ON c.id = l.seller_character ORDER BY l.created_at');
    return { listings: r.rows.map((l) => ({ id: l.id, seller: l.seller_name, kind: l.item_kind,
      itemId: l.item_id, qty: Number(l.qty), unitPrice: Number(l.unit_price) })) };
  });
  app.post('/v1/exchange/list', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.listItem(ch, req.body?.kind, req.body?.itemId, req.body?.qty, req.body?.unitPrice, client, h)));
  app.delete('/v1/exchange/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => S.cancelListing(ch, req.params.id, client, h)));
  app.post('/v1/exchange/:id/buy', { preHandler: auth }, async (req) => {
    const l = (await pool.query('SELECT seller_character FROM listings WHERE id=$1', [req.params.id])).rows[0];
    if (!l) throw new G.GameError('gone', 'Too slow — someone else took that lot.');
    return G.withTwoCharacters(pool, req.user.sub, l.seller_character,
      (ch, seller, client, h) => S.buyListing(ch, seller, client, h, req.params.id));
  });

  // ── M3: notifications (§3.3) — reading marks delivered ──
  app.get('/v1/notifications', { preHandler: auth }, async (req) => {
    const me = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0];
    if (!me) return { notifications: [] };
    // flip-and-return in one statement: a plain SELECT-then-UPDATE would silently
    // drop any notification inserted between the two queries
    const r = await pool.query('UPDATE notifications SET delivered=true WHERE character_id=$1 AND NOT delivered RETURNING *', [me.id]);
    const rows = r.rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return { notifications: rows.map((n) => ({ id: n.id, type: n.type, payload: JSON.parse(n.payload), at: n.created_at })) };
  });

  // ── M3: websocket gateway (§5.6) — channels: me, streets, gang:{id} ──
  await app.register(websocket);
  app.get('/v1/ws', { websocket: true }, async (socket, req) => {
    let accountId;
    try { accountId = app.jwt.verify(String(req.query?.token || '')).sub; }
    catch { socket.close(4001, 'auth'); return; }
    // banned accounts must not keep a live intel feed (REST re-checks per request;
    // the socket is long-lived, so check status at connect)
    const acct = (await pool.query('SELECT status FROM accounts WHERE id=$1', [accountId])).rows[0];
    if (!acct || acct.status === 'banned') { socket.close(4003, 'banned'); return; }
    const me = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
    if (!me) { socket.close(4004, 'no_character'); return; }
    const gm = (await pool.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [me.id])).rows[0];
    const send = (channel) => (event) => { try { socket.send(JSON.stringify({ channel, ...event })); } catch { /* gone */ } };
    const subs = [[`me:${me.id}`, send('me')], ['streets', send('streets')]];
    if (gm?.gang_id) subs.push([`gang:${gm.gang_id}`, send('gang')]);
    for (const [ev, fn] of subs) G.bus.on(ev, fn);
    socket.on('close', () => { for (const [ev, fn] of subs) G.bus.off(ev, fn); });
    socket.send(JSON.stringify({ channel: 'hello', characterId: me.id }));
  });

  // ── M4: the Kitchen (§5.3, §7.10) ──
  app.post('/v1/kitchen/makings/:drugId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.buyMakings(ch, req.params.drugId, req.body?.qty, client, h)));
  app.post('/v1/kitchen/lab/upgrade', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.upgradeLab(ch, client, h)));
  app.post('/v1/kitchen/cook', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.cook(ch, req.body?.drugId, req.body?.qty, client, h)));
  app.post('/v1/kitchen/collect', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.collect(ch, client, h)));
  app.post('/v1/kitchen/deal', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.deal(ch, req.body?.drugId, req.body?.qty, client, h)));
  app.post('/v1/kitchen/crew/hire', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.hireCrew(ch, client, h)));
  app.post('/v1/kitchen/laylow', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.layLow(ch, client, h)));
  app.post('/v1/kitchen/cleanpapers', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => K.cleanPapers(ch, client, h)));

  // ── M4: growth (§5.1) ──
  app.post('/v1/path', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => W.choosePath(ch, req.body?.path, client, h)));
  app.post('/v1/heist', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => W.heist(ch, client, h)));
  app.post('/v1/missions/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => W.doMission(ch, req.params.id, client, h)));
  app.get('/v1/daily', { preHandler: auth }, async (req) => {
    const me = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0];
    if (!me) throw new G.GameError('no_character', 'Create a character first.');
    return W.getDaily(pool, me.id);
  });
  app.post('/v1/daily/:id/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => W.claimDaily(ch, req.params.id, client, h)));
  app.post('/v1/onboard/:taskId/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => W.claimOnboard(ch, req.params.taskId, client, h)));
  // Wallet linking is SIWE now (EVM migration): the base58/no-proof path is retired. A real
  // 0x link — the only thing that sets wallet_address and satisfies the ob_wallet reward —
  // goes through POST /v1/wallet/challenge → POST /v1/wallet/verify (chain.js).
  app.post('/v1/wallet', { preHandler: auth }, async () => {
    throw new G.GameError('use_siwe', 'Wallet linking moved to sign-in-with-Ethereum: call POST /v1/wallet/challenge, sign it, then POST /v1/wallet/verify.');
  });

  // ── M4: mod tools (§10.3) — X-Mod-Key header; disabled unless MOD_KEY is set ──
  app.post('/v1/mod/ban', { preHandler: modAuth }, async (req) => {
    const { accountId, reason } = req.body || {};
    if (!accountId) throw new G.GameError('args', 'accountId required.');
    await pool.query("UPDATE accounts SET status='banned' WHERE id=$1", [accountId]);
    await pool.query('INSERT INTO bans (account_id, kind, reason, by_mod) VALUES ($1,$2,$3,$4)',
      [accountId, 'ban', reason || null, 'mod']);
    return { ok: true };
  });
  app.post('/v1/mod/kill', { preHandler: modAuth }, async (req) => {
    // runs the §7.9 estate without a killer ("THE COMMISSION")
    const { characterId, reason } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const victim = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [characterId])).rows[0];
      if (!victim) throw new G.GameError('no_target', 'No living character by that id.');
      const victimAcct = (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [victim.account_id])).rows[0];
      const victimOwned = await G.loadOwned(client, victim);
      const h = { ledger: G.ledger, notify: G.notify, victimAcct, victimOwned };
      const estate = await S.runEstate(client, h, victim, 'THE COMMISSION'); // tracks the death itself
      await client.query('UPDATE account_persistent SET prestige=$2, deaths=$3 WHERE account_id=$1',
        [victim.account_id, victimAcct.prestige, victimAcct.deaths]);
      if (reason) await G.track(client, victim.account_id, 'mod_kill_reason', { reason });
      await client.query('COMMIT');
      return { ok: true, heirId: estate.heirId };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  });
  app.post('/v1/mod/confiscate', { preHandler: modAuth }, async (req) => {
    // seized cash recycles into the street-tax pool (next buyback)
    const { characterId, amount } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ch = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [characterId])).rows[0];
      if (!ch) throw new G.GameError('no_target', 'No living character by that id.');
      const amt = Math.min(Math.floor(Number(amount) || 0) || Math.floor(Number(ch.cash)), Math.floor(Number(ch.cash)));
      await client.query('UPDATE characters SET cash = cash - $2 WHERE id=$1', [characterId, amt]);
      await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [amt]);
      await G.ledger(client, { characterId, currency: 'cash', amount: -amt, reason: 'mod:confiscate' });
      await client.query('COMMIT');
      return { ok: true, confiscated: amt };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  });
  app.post('/v1/mod/invites', { preHandler: modAuth }, async (req) => {
    const count = Math.min(100, Math.max(1, Math.floor(Number(req.body?.count) || 1)));
    const uses = Math.max(1, Math.floor(Number(req.body?.uses) || 1));
    const codes = [];
    for (let i = 0; i < count; i++) {
      const code = crypto.randomBytes(6).toString('hex');
      await pool.query('INSERT INTO invite_codes (code, uses_left, created_by) VALUES ($1,$2,$3)', [code, uses, 'mod']);
      codes.push(code);
    }
    return { codes, uses };
  });
  app.get('/v1/mod/invariants', { preHandler: modAuth }, async () => runLedgerInvariants(pool));
  app.get('/v1/mod/audit', { preHandler: modAuth }, async (req) => {
    const cid = req.query?.characterId;
    const tx = await pool.query('SELECT * FROM transactions WHERE ($1::text IS NULL OR character_id=$1) ORDER BY at DESC LIMIT 100', [cid || null]);
    const rng = await pool.query('SELECT * FROM rng_audit WHERE ($1::text IS NULL OR character_id=$1) ORDER BY at DESC LIMIT 100', [cid || null]);
    return { transactions: tx.rows, rng: rng.rows };
  });

  // ── M6-B: the chain service (§11, EVM) — withdrawals, gear mint, SIWE wallet link ──
  app.post('/v1/wallet/challenge', { preHandler: auth }, async (req) => Chain.walletChallenge(pool, req.user.sub));
  app.post('/v1/wallet/verify', { preHandler: auth }, async (req) =>
    Chain.walletVerify(pool, req.user.sub, req.body?.address, req.body?.signature));
  app.post('/v1/withdraw', { preHandler: auth }, async (req) =>
    Chain.requestWithdraw(pool, req.user.sub, req.body?.amount, req.body?.address));
  app.post('/v1/gear/:id/withdraw', { preHandler: auth }, async (req) =>
    Chain.requestGearWithdraw(pool, req.user.sub, req.params.id, req.body?.address));
  app.get('/v1/withdraw/status', { preHandler: auth }, async (req) => {
    const mine = (await pool.query(
      'SELECT id, kind, amount, gear_id, nonce, status, claimed_onchain, signed_payload FROM vouchers WHERE account_id=$1 ORDER BY created_at DESC LIMIT 50',
      [req.user.sub])).rows;
    return { reserve: await Chain.reserveStatus(pool),
      vouchers: mine.map((v) => ({ id: v.id, kind: v.kind, amount: Number(v.amount), gearId: v.gear_id,
        nonce: Number(v.nonce), status: v.status, claimed: v.claimed_onchain,
        payload: v.signed_payload ? JSON.parse(v.signed_payload) : null })) };
  });
  // Mod/ops: mirror an on-chain tranche funding into the reserve (drains the queue),
  // read the reserve gauge, and (for tests/ops) mark a voucher claimed.
  app.post('/v1/mod/reserve/fund', { preHandler: modAuth }, async (req) => Chain.fundReserve(pool, req.body?.amount));
  app.get('/v1/mod/reserve', { preHandler: modAuth }, async () => Chain.reserveStatus(pool));
  app.post('/v1/mod/reserve/claimed', { preHandler: modAuth }, async (req) => Chain.markClaimed(pool, Number(req.body?.nonce)));

  // ── §11 entry/revive fees (paid on-chain to OmertaFees → dev wallet) ──
  // Spend a paid mint credit to make your character permanent (the two-tier upgrade).
  app.post('/v1/character/mint', { preHandler: auth }, async (req) => Fees.mintCharacter(pool, req.user.sub));
  app.get('/v1/fees/status', { preHandler: auth }, async (req) => Fees.feeStatus(pool, req.user.sub));
  // Ops/manual reconciliation of an on-chain payment (the worker's watcher does this live from
  // MintFeePaid/RespawnFeePaid events; this endpoint is the manual + test path for the same call).
  app.post('/v1/mod/fees/record', { preHandler: modAuth }, async (req) =>
    Fees.recordFeePayment(pool, { nonce: req.body?.nonce, kind: req.body?.kind,
      payer: req.body?.payer, amountWei: req.body?.amountWei, txHash: req.body?.txHash }));

  // ── M2: deterministic market board (§7.11) — public, server-computed ──
  app.get('/v1/market/prices', async () => {
    const block = priceBlock();
    return {
      block,
      goods: Object.fromEntries(DISTRICTS.map((d) =>
        [d.id, Object.fromEntries(GOODS.map((g) => [g.id, goodPriceOf(g.id, d.id, block)]))])),
      demand: Object.fromEntries(DISTRICTS.map((d) =>
        [d.id, Object.fromEntries(DRUGS.map((dr) => [dr.id, Math.round(demandOf(dr.id, d.id, block) * 100) / 100]))])),
      makings: Object.fromEntries(DRUGS.map((dr) => [dr.id, makingsPriceOf(dr.id, block)])),
    };
  });

  app.get('/v1/city', async () => ({ day: dayOf(), event: cityEventOf(dayOf()) }));
  return app;
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const app = await buildServer();
  const port = Number(process.env.PORT || 8787);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`OMERTÀ backend (M1–M5) listening on :${port}`);
}
