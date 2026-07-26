// The Speakeasy — the club, the back-room table, the buyout and the standover
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as G from '../game.js';
import * as Speakeasy from '../speakeasy.js';

export function register(app, { pool, auth }) {
    // THE SPEAKEASY — the social hub: a club per district, the proprietor's front + the being-seen economy.
    app.get('/v1/speakeasy', { preHandler: auth }, async (req) => {
      const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
      return Speakeasy.speakeasyBoard(pool, cid || '');
    });
    app.post('/v1/speakeasy/:districtId/open', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.openSpeakeasy(ch, req.params.districtId, client, h)));
    app.post('/v1/speakeasy/collect', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.collectSpeakeasy(ch, client, h)));
    app.post('/v1/speakeasy/upgrade', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.upgradeSpeakeasy(ch, client, h)));
    app.post('/v1/speakeasy/name', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.nameSpeakeasy(ch, req.body?.name, client, h)));
    app.post('/v1/speakeasy/:districtId/bottle', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.bottleService(ch, req.params.districtId, req.body?.bottle, client, h)));
    // buy a round: two-party (patron → owner) — look up the club's owner first, then withTwoCharacters
    // locks both sides in sorted order (the shakedown precedent).
    app.post('/v1/speakeasy/:districtId/round', { preHandler: auth }, async (req) => {
      const club = (await pool.query('SELECT owner_character FROM speakeasies WHERE district_id=$1', [req.params.districtId])).rows[0];
      if (!club) throw new G.GameError('no_club', "There's no club in that district.");
      return G.withTwoCharacters(pool, req.user.sub, club.owner_character, (ch, owner, client, h) =>
        Speakeasy.visitSpeakeasy(ch, owner, req.params.districtId, req.body?.round, client, h));
    });
    // the back-room table: two-party (patron plays, owner takes the rake)
    app.post('/v1/speakeasy/:districtId/table', { preHandler: auth }, async (req) => {
      const club = (await pool.query('SELECT owner_character FROM speakeasies WHERE district_id=$1', [req.params.districtId])).rows[0];
      if (!club) throw new G.GameError('no_club', "There's no club in that district.");
      return G.withTwoCharacters(pool, req.user.sub, club.owner_character, (ch, owner, client, h) =>
        Speakeasy.playTable(ch, owner, req.params.districtId, req.body?.bet, client, h));
    });
    // step three — the P2P buyout: list / unlist your club, buy out a listed one (two-party)
    app.post('/v1/speakeasy/list', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.listSpeakeasy(ch, req.body?.price, client, h)));
    app.post('/v1/speakeasy/unlist', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.unlistSpeakeasy(ch, client, h)));
    app.post('/v1/speakeasy/:districtId/buy', { preHandler: auth }, async (req) => {
      const club = (await pool.query('SELECT owner_character, sale_price FROM speakeasies WHERE district_id=$1', [req.params.districtId])).rows[0];
      if (!club) throw new G.GameError('no_club', "There's no club in that district.");
      if (club.sale_price == null) throw new G.GameError('not_for_sale', "That club isn't on the market.");
      return G.withTwoCharacters(pool, req.user.sub, club.owner_character, (ch, seller, client, h) =>
        Speakeasy.buySpeakeasy(ch, seller, req.params.districtId, client, h));
    });
    // step three — apply an owned/renown-earned cosmetic decor style to your club (null clears to stock)
    app.post('/v1/speakeasy/decor', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Speakeasy.applyDecor(ch, req.body?.style, client, h)));
    // step four — the STANDOVER: a hostile forced-sale (two-party muscle contest), the challenger leans on the owner
    app.post('/v1/speakeasy/:districtId/standover', { preHandler: auth }, async (req) => {
      const club = (await pool.query('SELECT owner_character FROM speakeasies WHERE district_id=$1', [req.params.districtId])).rows[0];
      if (!club) throw new G.GameError('no_club', "There's no club in that district.");
      return G.withTwoCharacters(pool, req.user.sub, club.owner_character, (ch, owner, client, h) =>
        Speakeasy.standoverSpeakeasy(ch, owner, req.params.districtId, client, h));
    });
}
