// The Pen — the yard, the commissary, the shank, the hole and the breakout
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as G from '../game.js';
import * as Pen from '../pen.js';

export function register(app, { pool, auth, closeSocketsOnKill }) {
    // THE PEN — the prison meta-game. Every action requires being in lockup; the shank is two-party.
    app.get('/v1/pen', { preHandler: auth }, async (req) =>
      G.readCharacter(pool, req.user.sub, (ch, client, h) => Pen.penBoard(ch, client, h)));
    app.post('/v1/pen/work', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.workYard(ch, client, h)));
    app.post('/v1/pen/buy/:item', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.buyContraband(ch, req.params.item, client, h)));
    app.post('/v1/pen/protection', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.payProtection(ch, client, h)));
    app.post('/v1/pen/bribe', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.bribeGuard(ch, req.body?.seconds, client, h)));
    app.post('/v1/pen/break', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.attemptBreak(ch, client, h)));
    // step four — the CO-OP BREAKOUT (the crew-heist pattern, inside)
    app.get('/v1/pen/breaks', { preHandler: auth }, async (req) => {
      const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
      if (!cid) throw new G.GameError('no_character', 'Create a character first.');
      return Pen.breakBoard(pool, cid);
    });
    app.post('/v1/pen/break/plan', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.planBreak(ch, client, h)));
    app.post('/v1/pen/break/:id/join', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.joinBreak(ch, req.params.id, client, h)));
    app.post('/v1/pen/break/:id/leave', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.leaveBreak(ch, req.params.id, client, h)));
    app.post('/v1/pen/break/:id/go', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.executeBreak(ch, req.params.id, client, h)));
    app.post('/v1/pen/shank/:targetId', { preHandler: auth }, async (req) => {
      const r = await G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => Pen.shank(ch, victim, client, h));
      await closeSocketsOnKill(r, req.params.targetId);
      return r;
    });
    // step two: the burner phone — call in an NPC hit from inside (two-party, consumes a burner)
    app.post('/v1/pen/burner/:targetId', { preHandler: auth }, async (req) =>
      G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, victim, client, h) => Pen.burnerHit(ch, victim, client, h, req.body?.tier)));
    // step five: prison factions (join/leave for cover) + the break RAT
    app.post('/v1/pen/faction/:id', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.joinFaction(ch, req.params.id, client, h)));
    app.post('/v1/pen/faction', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.leaveFaction(ch, client, h)));
    app.post('/v1/pen/break/:id/rat', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Pen.ratBreak(ch, req.params.id, client, h)));
}
