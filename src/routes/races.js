// Street Races — the circuit, the strip, pink slips, nitrous and the Grand Prix
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as G from '../game.js';
import * as Races from '../races.js';

export function register(app, { pool, auth }) {
    // ── STREET RACES — the deep car catalog as a competitive loop (PvE circuit + PvP wagers + tuning) ──
    app.get('/v1/races', { preHandler: auth }, async (req) =>
      G.readCharacter(pool, req.user.sub, (ch, client, h) => Races.raceBoard(ch, client, h)));
    app.post('/v1/races/npc', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Races.raceNpc(ch, req.body?.car, req.body?.tier, req.body?.nos, client, h)));
    app.post('/v1/races/tune/:carId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Races.tuneCar(ch, req.params.carId, client, h)));
    app.post('/v1/races/nos/:carId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Races.buyNos(ch, req.params.carId, client, h)));
    app.post('/v1/races/list/:carId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Races.listRace(ch, req.params.carId, req.body?.limit, client, h)));
    app.post('/v1/races/unlist/:carId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Races.unlistRace(ch, req.params.carId, client, h)));
    app.post('/v1/races/pinkslip/:carId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Races.pinkSlipList(ch, req.params.carId, req.body?.on, client, h)));
    app.post('/v1/races/challenge/:ownerId', { preHandler: auth }, async (req) =>
      G.withTwoCharacters(pool, req.user.sub, req.params.ownerId, (ch, opponent, client, h) =>
        Races.raceChallenge(ch, opponent, req.body, client, h)));
    app.post('/v1/races/pinks/:ownerId', { preHandler: auth }, async (req) =>
      G.withTwoCharacters(pool, req.user.sub, req.params.ownerId, (ch, opponent, client, h) =>
        Races.pinkSlipRace(ch, opponent, req.body, client, h)));
    app.post('/v1/races/gp', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Races.enterGrandPrix(ch, req.body?.car, client, h)));
}
