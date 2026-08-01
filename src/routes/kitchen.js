// The Kitchen — makings, the lab, cooking, the corner and the crew
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as G from '../game.js';
import * as K from '../kitchen.js';

export function register(app, { pool, auth }) {
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
      G.withCharacter(pool, req.user.sub, (ch, client, h) => K.deal(ch, req.body?.drugId, req.body?.qty, client, h, req.body?.play)));
    app.post('/v1/kitchen/crew/hire', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => K.hireCrew(ch, client, h)));
    // recurring sinks: pay the crew's nut (wages) — an unpaid crew downs tools until covered
    app.post('/v1/kitchen/crew/wages', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => K.payCrewWages(ch, client, h)));
    // the door out of the nut: square up and let one go, or let a downed crew walk for nothing
    app.delete('/v1/kitchen/crew', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => K.layOffCrew(ch, client, h)));
    app.post('/v1/kitchen/laylow', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => K.layLow(ch, client, h)));
    app.post('/v1/kitchen/cleanpapers', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => K.cleanPapers(ch, client, h)));
    // ── THE KITCHEN → Tier 4 ──
    app.post('/v1/kitchen/module/:mod', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => K.upgradeModule(ch, req.params.mod, client, h)));
    app.post('/v1/kitchen/cut/:drugId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => K.cutStash(ch, req.params.drugId, client, h)));
}
