// Sovereignty — strongholds, vulnerability windows and sieges
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as G from '../game.js';
import * as Sov from '../sov.js';

export function register(app, { pool, auth }) {
    app.get('/v1/sov', { preHandler: auth }, async (req) =>
      G.readCharacter(pool, req.user.sub, (ch, client, h) => Sov.sovBoard(client, h)));
    app.post('/v1/sov/:district/build', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Sov.buildSov(ch, req.params.district, req.body?.windowHour, client, h)));
    app.post('/v1/sov/:district/upgrade', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Sov.upgradeSov(ch, req.params.district, client, h)));
    app.post('/v1/sov/upkeep', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Sov.paySovUpkeep(ch, client, h)));
    app.post('/v1/sov/:district/siege', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Sov.siegeSov(ch, req.params.district, client, h)));
    app.post('/v1/sov/collect', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Sov.collectSov(ch, client, h)));
}
