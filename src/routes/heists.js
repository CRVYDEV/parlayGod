// Crew heists — the big score, the roles, the rat and the inside job
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as G from '../game.js';
import * as Heists from '../heists.js';

export function register(app, { pool, auth }) {
    // CREW HEISTS — THE BIG SCORE: plan, crew up off the board, execute together (or rat).
    app.get('/v1/heists', { preHandler: auth }, async (req) => {
      const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
      if (!cid) throw new G.GameError('no_character', 'Create a character first.');
      return Heists.heistBoard(pool, cid);
    });
    app.post('/v1/heists/plan', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) =>
        Heists.planHeist(ch, req.body?.job, { role: req.body?.role, businessId: req.body?.businessId, fence: req.body?.fence }, client, h)));
    app.post('/v1/heists/:id/join', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Heists.joinHeist(ch, req.params.id, req.body?.role, client, h)));
    app.post('/v1/heists/:id/leave', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Heists.leaveHeist(ch, req.params.id, client, h)));
    app.post('/v1/heists/:id/fill', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Heists.fillHeist(ch, req.params.id, req.body?.role, client, h)));
    app.post('/v1/heists/:id/case', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Heists.caseJob(ch, req.params.id, client, h)));
    app.post('/v1/heists/:id/rat', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Heists.ratHeist(ch, req.params.id, client, h)));
    app.post('/v1/heists/:id/execute', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Heists.executeHeist(ch, req.params.id, client, h)));
    app.post('/v1/heists/fence', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Heists.fenceLoot(ch, client, h)));
}
