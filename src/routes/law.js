// The Law — the rap sheet, the bribe, the courtroom and the informant's door
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as G from '../game.js';
import * as Law from '../law.js';

export function register(app, { pool, auth }) {
    // THE LAW — the state antagonist. GET /v1/law is the rap sheet + docket; the sinks are the
    // escapes (bribe/lawyer), the courtroom is plea/jury/trial, and the flip turns state's evidence.
    app.get('/v1/law', { preHandler: auth }, async (req) =>
      G.readCharacter(pool, req.user.sub, (ch, client, h) => Law.lawBoard(ch, h)));
    app.post('/v1/law/bribe', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Law.bribe(ch, client, h)));
    app.post('/v1/law/retainer', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Law.retainer(ch, client, h)));
    app.post('/v1/law/envelope', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Law.payEnvelope(ch, client, h)));
    app.post('/v1/law/plea', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Law.plea(ch, client, h)));
    app.post('/v1/law/jury', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Law.buyJury(ch, client, h)));
    app.post('/v1/law/trial', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Law.demandTrial(ch, client, h)));
    app.post('/v1/law/witpro', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Law.enterWitpro(ch, client, h)));
    // the flip is two-party — you name a rival, seeding THEIR case. Look up the target, lock both.
    app.post('/v1/law/flip/:targetId', { preHandler: auth }, async (req) =>
      G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => Law.flip(ch, victim, client, h)));
}
