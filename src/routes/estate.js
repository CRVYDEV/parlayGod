// The Estate — the compound, the staff, the gala and the auction block
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as Estate from '../estate.js';
import * as Made from '../made.js';
import * as G from '../game.js';

export function register(app, { pool, auth }) {
    // THE MADE MAN (economy v3 step 5) — the recurring $OMR subscription that buys STANDING. It sits
    // beside the estate because the upper compound is one of the things it opens, and because both
    // are the prestige layer rather than an earning loop.
    app.get('/v1/made', { preHandler: auth }, async (req) =>
      G.readCharacter(pool, req.user.sub, (ch, client, h) => Made.madeBoard(ch, h)));
    app.post('/v1/made', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Made.payDues(ch, client, h)));
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
