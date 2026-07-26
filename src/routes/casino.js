// Casino — the Gambling Den, the tables, the tournaments and the track
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as Casino from '../casino.js';
import * as G from '../game.js';
import * as Ring from '../ring.js';

export function register(app, { pool, auth }) {
    // THE GAMBLING DEN (Neon Mile, cash only — never $OMR): street craps + the daily Numbers.
    app.post('/v1/casino/dice', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.playDice(ch, req.body?.amount, client, h)));
    app.post('/v1/casino/numbers', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.playNumbers(ch, req.body?.pick, req.body?.amount, client, h)));
    app.post('/v1/casino/numbers/claim', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.claimNumbers(ch, client, h)));
    // step two: back-room PvP dice (consent-by-listing), the weekly fight book + the neon fix
    app.post('/v1/casino/fade', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch) => Casino.setFadeLimit(ch, req.body?.limit)));
    app.post('/v1/casino/dice/:targetId', { preHandler: auth }, async (req) =>
      G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, fader, client, h) =>
        Casino.pvpDice(ch, fader, req.body?.amount, client, h)));
    app.post('/v1/casino/fight', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.betFight(ch, req.body?.side, req.body?.amount, client, h)));
    app.post('/v1/casino/fight/claim', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.claimFight(ch, client, h)));
    app.post('/v1/casino/fight/fix', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.fixFight(ch, req.body?.winner, client, h)));
    // THE TRACK: the dogs & the ponies — a daily race card, one WIN bet per race per day
    app.post('/v1/casino/track', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.betTrack(ch, req.body?.race, req.body?.runner, req.body?.amount, client, h)));
    app.post('/v1/casino/track/claim', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.claimTrack(ch, client, h)));
    // step three — RUN IN THE CARD: enter one of your racers into today's card (the town bets on it)
    app.post('/v1/casino/track/enter/:racerId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.enterTrackRace(ch, req.params.racerId, client, h)));
    // Track step four: THE FUTURITY — nominate a player racer + bet parimutuel on the field (crowd-bet marquee)
    app.post('/v1/casino/futurity/nominate/:racerId', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.nominateFuturity(ch, req.params.racerId, client, h)));
    app.post('/v1/casino/futurity/bet', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.betFuturity(ch, req.body?.racerId, req.body?.amount, client, h)));
    // step three: BLACKJACK (stateful PvE — deal/hit/stand/double) + heads-up HOLD'EM (PvP showdown)
    app.post('/v1/casino/blackjack', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.blackjackDeal(ch, req.body?.amount, client, h)));
    app.post('/v1/casino/blackjack/hit', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.blackjackHit(ch, client, h)));
    app.post('/v1/casino/blackjack/stand', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.blackjackStand(ch, client, h)));
    app.post('/v1/casino/blackjack/double', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.blackjackDouble(ch, client, h)));
    app.post('/v1/casino/poker/deal', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch) => Casino.setPokerLimit(ch, req.body?.limit)));
    app.post('/v1/casino/poker/:targetId', { preHandler: auth }, async (req) =>
      G.withTwoCharacters(pool, req.user.sub, req.params.targetId, (ch, dealer, client, h) =>
        Casino.playPoker(ch, dealer, req.body?.amount, client, h)));
    // the scheduled POKER TOURNAMENT — buy in during the open window; the worker deals + settles
    app.post('/v1/casino/tournament', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Casino.enterTournament(ch, client, h, { bracket: !!req.body?.bracket })));
    // step five — RING POKER: the multi-way stateful table (the table is an escrow; see src/ring.js)
    app.get('/v1/casino/ring', { preHandler: auth }, async (req) => {
      const ch = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0];
      return Ring.ringLobby(pool, ch);
    });
    app.get('/v1/casino/ring/:id', { preHandler: auth }, async (req) => {
      const ch = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0];
      return Ring.viewOf(pool, req.params.id, ch?.id);
    });
    app.post('/v1/casino/ring/open', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Ring.openTable(ch, req.body, client, h)));
    app.post('/v1/casino/ring/:id/sit', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Ring.sitAt(ch, req.params.id, req.body?.buyin, client, h)));
    app.post('/v1/casino/ring/:id/leave', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Ring.leaveTable(ch, req.params.id, client, h)));
    app.post('/v1/casino/ring/:id/deal', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Ring.dealHand(ch, req.params.id, client, h)));
    app.post('/v1/casino/ring/:id/act', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Ring.actAt(ch, req.params.id, req.body, client, h)));
    app.get('/v1/casino', { preHandler: auth }, async (req) => {
      const cid = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [req.user.sub])).rows[0]?.id;
      if (!cid) throw new G.GameError('no_character', 'Create a character first.');
      return Casino.denInfo(pool, cid);
    });
}
