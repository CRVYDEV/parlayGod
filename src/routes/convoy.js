// Smuggling convoys — loading, guards, insurance, the road and the ambush
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as Convoy from '../convoy.js';
import * as G from '../game.js';

export function register(app, { pool, auth }) {
    app.post('/v1/convoy', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Convoy.openConvoy(ch, req.body?.to, req.body?.goodId, req.body?.qty, client, h)));
    app.post('/v1/convoy/load', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Convoy.loadConvoy(ch, req.body?.goodId, req.body?.qty, client, h)));
    app.post('/v1/convoy/depart', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Convoy.departConvoy(ch, req.body?.guards, !!req.body?.insure, client, h)));
    app.post('/v1/convoy/cancel', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Convoy.cancelConvoy(ch, client, h)));
    app.post('/v1/convoy/:id/ambush', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Convoy.ambushConvoy(ch, req.params.id, client, h)));
    app.post('/v1/convoy/:id/collect', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Convoy.collectConvoy(ch, req.params.id, client, h)));
    // ── CONVOYS → Tier 4 ──
    app.post('/v1/convoy/rig/:kind', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Convoy.buyRig(ch, req.params.kind, client, h)));
    app.post('/v1/convoy/rig/upgrade', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Convoy.upgradeRig(ch, req.body?.track, client, h)));
}
