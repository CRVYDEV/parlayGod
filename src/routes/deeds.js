// Street Deeds — the map as property (the Monopoly layer). Phase 1: claim a named deed mapped to a
// district, read its legend. Pure status (ZERO §10.4). The registrar takes the shared closure the
// sibling route files use (pool, auth), so nothing about what is mounted or how it is authenticated
// changes; test/routes.js asserts the mounted surface is identical.
import * as Deeds from '../deeds.js';
import * as G from '../game.js';

export function register(app, { pool, auth }) {
  app.get('/v1/deeds', { preHandler: auth }, async (req) =>
    G.readCharacter(pool, req.user.sub, (ch, client, h) => Deeds.deedBoard(ch, client, h)));
  app.post('/v1/deeds/claim', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) =>
      Deeds.claimDeed(ch, { name: req.body?.name, district: req.body?.district }, client, h)));
  // Phase 2 — CONTROL: collect the corner take off every deed you control; muscle in on a rival's corner.
  app.post('/v1/deeds/corner', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Deeds.collectCorner(ch, client, h)));
  app.post('/v1/deeds/shakedown/:targetCharacterId', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) =>
      Deeds.shakedownCorner(ch, req.params.targetCharacterId, client, h)));
  // Phase 3 — the secondary market: list/pull your street, or buy a listed one (two-party).
  app.post('/v1/deeds/list', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Deeds.listDeed(ch, req.body?.price, client, h)));
  app.post('/v1/deeds/unlist', { preHandler: auth }, async (req) =>
    G.withCharacter(pool, req.user.sub, (ch, client, h) => Deeds.unlistDeed(ch, client, h)));
  app.post('/v1/deeds/buy/:sellerCharacterId', { preHandler: auth }, async (req) =>
    G.withTwoCharacters(pool, req.user.sub, req.params.sellerCharacterId, (ch, seller, client, h) =>
      Deeds.buyDeed(ch, seller, client, h)));
}
