// The Stable — owning the dogs and the ponies
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as G from '../game.js';
import * as Stable from '../stable.js';

export function register(app, { pool, auth }) {
    // ── THE STABLE — own the dogs & the ponies (buy/train/list/circuit(PvE)/match(PvP) + the legend) ──
    app.get('/v1/stable', { preHandler: auth }, async (req) => {
      const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
      return Stable.stableBoard(pool, cid || '');
    });
    app.post('/v1/stable/buy', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Stable.buyRacer(ch, req.body?.kind, req.body?.name, client, h)));
    app.post('/v1/stable/train/:racerId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Stable.trainRacer(ch, req.params.racerId, req.body?.stat, client, h)));
    app.post('/v1/stable/list/:racerId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Stable.listRacer(ch, req.params.racerId, req.body?.limit, client, h)));
    app.post('/v1/stable/circuit/:racerId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Stable.raceCircuit(ch, req.params.racerId, req.body?.meet, client, h)));
    app.post('/v1/stable/match/:opponentId', { preHandler: auth }, async (req) =>
      G.withTwoCharacters(pool, req.user.sub, req.params.opponentId, (ch, opponent, client, h) =>
        Stable.matchRace(ch, opponent, req.body, client, h)));
    // step two: breeding (two racers → a foal) + THE STAKES (a scheduled marquee race, worker-resolved)
    app.post('/v1/stable/breed', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Stable.breedRacers(ch, req.body?.sire, req.body?.dam, req.body?.name, client, h)));
    app.post('/v1/stable/stakes/:racerId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Stable.enterStakes(ch, req.params.racerId, client, h)));
}
