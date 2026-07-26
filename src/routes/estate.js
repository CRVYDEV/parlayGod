// The Estate — the compound, the staff, the gala and the auction block
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as Estate from '../estate.js';
import * as G from '../game.js';

export function register(app, { pool, auth }) {
    // THE ESTATE ("the compound"): the deep personal $OMR sink + a "home" that displays your legend.
    app.get('/v1/estate', { preHandler: auth }, async (req) =>
      G.readCharacter(pool, req.user.sub, (ch, client, h) => Estate.estateBoard(ch, client, h)));
    app.post('/v1/estate/upgrade', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.upgradeEstate(ch, client, h)));
    app.post('/v1/estate/feature/:id', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.unlockFeature(ch, req.params.id, client, h)));
    app.post('/v1/estate/name', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.nameEstate(ch, req.body?.name, client, h)));
    // step two — THE STAFF (recurring $OMR payroll) + THE GALA (design omerta-deep-deferred-design.md §A)
    app.post('/v1/estate/staff/:id', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.hireStaff(ch, req.params.id, client, h)));
    app.delete('/v1/estate/staff/:id', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.dismissStaff(ch, req.params.id, client, h)));
    app.post('/v1/estate/wages', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.payStaffWages(ch, client, h)));
    app.post('/v1/estate/gala', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.throwGala(ch, client, h)));
    app.post('/v1/estate/gala/attend', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Estate.attendGala(ch, req.body?.hostId, client, h)));
}
