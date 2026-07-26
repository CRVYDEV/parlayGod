// Territory rackets — establish, upgrade, collect, fortify, raid, specialists
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as G from '../game.js';
import * as Territory from '../territory.js';

export function register(app, { pool, auth }) {
    // Risk-to-Earn Phase 3: territory rackets — establish/upgrade an operation on your turf, collect
    // its income, and lose it (with the district) to whoever seizes the turf.
    app.post('/v1/territory/:districtId/establish', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.establishRacket(ch, req.params.districtId, req.body?.kind, client, h)));
    app.post('/v1/territory/:districtId/upgrade', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.upgradeRacket(ch, req.params.districtId, client, h)));
    app.post('/v1/territory/collect', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.collectTerritory(ch, client, h)));
    // recurring sinks: a boss/underboss pays the pad on the family's operations from the treasury
    app.post('/v1/territory/upkeep', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.payTerritoryUpkeep(ch, client, h)));
    // step four — the racket-wars layer: fortify your own op (treasury sink) / raid a rival's for a cut
    app.post('/v1/territory/:districtId/fortify', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.fortifyRacket(ch, req.params.districtId, client, h)));
    app.post('/v1/territory/:districtId/raid', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.raidRivalRacket(ch, req.params.districtId, client, h)));
    // step five — racket specialists + special operations
    app.post('/v1/territory/:districtId/specialist', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.assignSpecialist(ch, req.params.districtId, req.body?.memberId, client, h)));
    app.delete('/v1/territory/:districtId/specialist', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.unassignSpecialist(ch, req.params.districtId, client, h)));
    app.post('/v1/territory/:districtId/op', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Territory.runTerritoryOp(ch, req.params.districtId, client, h)));
    app.get('/v1/territory', { preHandler: auth }, async (req) => {
      const gid = (await pool.query('SELECT gang_id FROM gang_members WHERE character_id=(SELECT id FROM characters WHERE account_id=$1 AND alive)', [req.user.sub])).rows[0]?.gang_id;
      if (!gid) return { territory: [], syndicate: null };
      return { territory: await Territory.territoryOf(pool, gid), ...(await Territory.territorySyndicate(pool, gid)) };
    });
}
