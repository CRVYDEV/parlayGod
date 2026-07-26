// The Underworld — the fixers, gifts, penance, favors and errands
// Extracted verbatim from server.js — handler bodies are unchanged. The registrar takes the shared
// closure it used to read directly (pool, auth), so nothing about what is mounted or how it is
// authenticated moves with it; test/routes.js asserts the mounted surface is identical either way.
import * as G from '../game.js';
import * as Underworld from '../underworld.js';

export function register(app, { pool, auth }) {
    // THE UNDERWORLD — named NPCs: standing earned by doing business, perks at 25/60/90.
    app.get('/v1/underworld', { preHandler: auth }, async (req) =>
      G.readCharacter(pool, req.user.sub, (ch, client, h) => Underworld.underworldBoard(ch, client, h)));
    app.post('/v1/underworld/discharge', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Underworld.discharge(ch, client, h)));
    app.post('/v1/underworld/gun/:gunId/sell', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Underworld.sellGunBack(ch, req.params.gunId, client, h)));
    app.post('/v1/underworld/:npc/gift', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Underworld.giftNpc(ch, req.params.npc, client, h)));
    // step four: square a grudge (a ledgered cash sink) / claim the weekly favor (resources, never money)
    app.post('/v1/underworld/:npc/penance', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Underworld.payPenance(ch, req.params.npc, client, h)));
    app.post('/v1/underworld/:npc/favor', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Underworld.claimFavor(ch, req.params.npc, client, h)));
    // step five: the errand chain — a fixture's storyline (drawn task on N separate days → big standing jump)
    app.post('/v1/underworld/:npc/errand', { preHandler: auth }, async (req) =>
      G.withCharacter(pool, req.user.sub, (ch, client, h) => Underworld.startErrand(ch, req.params.npc, client, h)));
}
