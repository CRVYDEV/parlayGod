// The Fight Circuit — the stable, the exhibition, the belt and the main event
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as Boxing from '../boxing.js';
import * as G from '../game.js';

export function register(app, { pool, auth }) {
    // THE FIGHT CIRCUIT — sign a contender, train them, stake them in PvP bouts (the casino:pvp pattern).
    app.get('/v1/boxing', { preHandler: auth }, async (req) => {
      const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
      return Boxing.boxingBoard(pool, cid || '');
    });
    app.post('/v1/boxing/recruit', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Boxing.recruitFighter(ch, req.body?.name, client, h)));
    app.post('/v1/boxing/train', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Boxing.trainFighter(ch, req.body?.fighter, req.body?.stat, client, h)));
    app.post('/v1/boxing/list', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Boxing.listBout(ch, req.body?.fighter, req.body?.stake, client, h)));
    // NPC exhibition — a bounded PvE purse: your fighter vs a server card (step two)
    app.post('/v1/boxing/exhibition', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Boxing.exhibitionBout(ch, req.body?.fighter, req.body?.tier, client, h)));
    app.post('/v1/boxing/fight/:opponentId', { preHandler: auth }, async (req) =>
      G.withTwoCharacters(pool, req.user.sub, req.params.opponentId, (ch, opponent, client, h) =>
        Boxing.fightBout(ch, opponent, req.body, client, h)));
    // THE MAIN EVENT (step three) — book a scheduled card the crowd bets on; place a CASH bet; worker resolves.
    app.post('/v1/boxing/announce/:opponentId', { preHandler: auth }, async (req) =>
      G.withTwoCharacters(pool, req.user.sub, req.params.opponentId, (ch, opponent, client, h) =>
        Boxing.announceMainEvent(ch, opponent, req.body, client, h)));
    app.post('/v1/boxing/bout/:id/bet', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Boxing.placeBoutBet(ch, req.params.id, req.body, client, h)));
    // THE CALLOUT (step five) — the #1 contender forces a title fight; the champ accepts or forfeits.
    app.post('/v1/boxing/callout/:fighterId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Boxing.callOutChamp(ch, req.params.fighterId, client, h)));
    app.post('/v1/boxing/callout/accept', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Boxing.acceptCallout(ch, client, h)));
}
