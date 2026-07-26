// The Port — boats, offshore runs, piracy and the contraband warehouse
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as G from '../game.js';
import * as Port from '../port.js';

export function register(app, { pool, auth }) {
    // ── THE PORT — maritime smuggling (boats + the run + the Coast Guard) ──
    app.get('/v1/port', { preHandler: auth }, async (req) =>
      G.readCharacter(pool, req.user.sub, (ch, client, h) => Port.portBoard(ch, client, h)));
    app.post('/v1/port/boat/:kind', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.buyBoat(ch, req.params.kind, client, h)));
    app.post('/v1/port/boat/:boatId/sell', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.sellBoat(ch, req.params.boatId, client, h)));
    app.post('/v1/port/run/:boatId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.launchRun(ch, req.params.boatId, req.body?.route, !!req.body?.escort, client, h)));
    app.post('/v1/port/collect/:boatId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.collectRun(ch, req.params.boatId, !!req.body?.warehouse, client, h)));
    app.post('/v1/port/fence', { preHandler: auth }, async (req) =>                    // step four: fence warehoused contraband
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.fenceContraband(ch, client, h)));
    app.post('/v1/port/berth', { preHandler: auth }, async (req) =>                     // step four: rent a harbor slip (+fleet cap)
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.rentBerth(ch, client, h)));
    app.post('/v1/port/upgrade/:boatId', { preHandler: auth }, async (req) =>          // step two: naval upgrade (hull/engine)
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.upgradeBoat(ch, req.params.boatId, req.body?.part, client, h)));
    app.post('/v1/port/intercept/:boatId', { preHandler: auth }, async (req) =>        // step two: PIRACY — run down a rival at sea
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.interceptRun(ch, req.params.boatId, client, h)));
    app.post('/v1/port/boat/:boatId/rendezvous', { preHandler: auth }, async (req) =>  // step two: flag a docked boat open to a handoff
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.setRendezvous(ch, req.params.boatId, req.body?.open !== false, client, h)));
    app.post('/v1/port/rendezvous/:boatId', { preHandler: auth }, async (req) =>       // step two: hand your run to a partner's boat
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Port.rendezvous(ch, req.params.boatId, req.body?.to, client, h)));
}
