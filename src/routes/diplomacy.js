// Diplomacy — pacts and anti-hegemon coalitions between families
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as Diplomacy from '../diplomacy.js';
import * as G from '../game.js';

export function register(app, { pool, auth }) {
    // ── FIVE PILLARS: diplomacy (#2), sovereignty (#3), campaigns (#4), the bloodline (#5) ──
    app.get('/v1/diplomacy', { preHandler: auth }, async (req) =>
      G.readCharacter(pool, req.user.sub, (ch, client, h) => Diplomacy.diplomacyBoard(client, h)));
    app.post('/v1/diplomacy/pact/:gangId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Diplomacy.proposePact(ch, req.params.gangId, client, h)));
    app.post('/v1/diplomacy/pact/:gangId/accept', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Diplomacy.acceptPact(ch, req.params.gangId, client, h)));
    app.delete('/v1/diplomacy/pact/:gangId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Diplomacy.breakPact(ch, req.params.gangId, client, h)));
    app.post('/v1/diplomacy/coalition/:gangId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Diplomacy.formCoalition(ch, req.params.gangId, client, h)));
    app.post('/v1/diplomacy/coalition/:id/join', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Diplomacy.joinCoalition(ch, req.params.id, client, h)));
    app.delete('/v1/diplomacy/coalition/:id', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Diplomacy.leaveCoalition(ch, req.params.id, client, h)));
}
