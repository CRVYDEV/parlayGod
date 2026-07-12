import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import crypto from 'node:crypto';
import { makeDb } from './db.js';
import * as G from './game.js';
import { dayOf, cityEventOf } from './rules.js';

const uid = () => crypto.randomUUID();

export async function buildServer() {
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
  const auth = async (req) => { await req.jwtVerify(); };

  // ── auth ──
  app.post('/v1/auth/guest', async (req) => {
    const id = uid();
    await pool.query('INSERT INTO accounts (id, auth_provider, auth_subject, created_ip, last_ip) VALUES ($1,$2,$3,$4,$4)',
      [id, 'guest', id, req.ip || '0.0.0.0']);
    await pool.query('INSERT INTO account_persistent (account_id) VALUES ($1)', [id]);
    return { token: app.jwt.sign({ sub: id }, { expiresIn: '30d' }) };
  });

  // ── character ──
  app.post('/v1/character', { preHandler: auth }, async (req) => {
    const name = String(req.body?.name || '').trim().slice(0, 24);
    if (name.length < 2) throw new G.GameError('name', 'Pick a name (2–24 chars).');
    const existing = await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub]);
    if (existing.rows.length) throw new G.GameError('exists', 'One living character per account.');
    const season = Math.floor(dayOf() / 28);
    const id = uid();
    await pool.query('INSERT INTO characters (id, account_id, name, season) VALUES ($1,$2,$3,$4)', [id, req.user.sub, name, season]);
    if (req.body?.referralCode) {
      const rec = await pool.query('SELECT account_id FROM characters WHERE name=$1 AND alive AND account_id<>$2 LIMIT 1', [String(req.body.referralCode), req.user.sub]);
      if (rec.rows.length) await pool.query('UPDATE account_persistent SET referred_by=$1 WHERE account_id=$2 AND referred_by IS NULL', [rec.rows[0].account_id, req.user.sub]);
    }
    return { ok: true, id };
  });

  app.get('/v1/me', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, async () => ({})));

  // ── M1 actions ──
  app.post('/v1/crimes/:id', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.doCrime(ch, req.params.id, client, h)));
  app.post('/v1/train/:stat', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch) => G.train(ch, req.params.stat)));
  app.post('/v1/heal', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.heal(ch, client, h)));
  app.post('/v1/checkin', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.checkin(ch, client, h)));
  app.post('/v1/bank/:dir', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.bank(ch, req.params.dir, req.body?.amount, client, h)));
  app.post('/v1/travel/:district', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => G.travel(ch, req.params.district, client, h)));

  app.get('/v1/city', async () => ({ day: dayOf(), event: cityEventOf(dayOf()) }));
  return app;
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const app = await buildServer();
  const port = Number(process.env.PORT || 8787);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`OMERTÀ backend (M1) listening on :${port}`);
}
