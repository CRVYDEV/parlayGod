// THE CITY WIRE — the Discord organic-marketing loop. Read-only side-effect (posts a curated,
// public-safe subset of the streets feed); DORMANT unless CITY_WIRE_WEBHOOK_URL is set; §10.4-free.
// This proves: the allowlist formats the dramatic events, drops everything else, carries NO exact
// dollar figure (the info-economy / anti-precise-kill-EV rule), is dormant without the env, throttles,
// and reaches the delivery seam with the right content — all without a network call (the push.js seam).
import assert from 'node:assert';
import { cityWireLine, postCityWire, __setDeliver } from '../src/citywire.js';

// ── the allowlist formats the marquee dramatic events (names + the event, never money) ──
const kill = cityWireLine({ type: 'kill', by: 'Don Vito', victim: 'Sonny' });
assert(kill && /Don Vito/.test(kill) && /Sonny/.test(kill), 'a player kill posts both names');
const hired = cityWireLine({ type: 'kill', by: 'a hired gun', victim: 'Sonny' });
assert(hired && /hired gun/.test(hired) && !/Don Vito/.test(hired), 'an anonymous hit stays anonymous — the killer is not named (info-economy rule)');
assert(cityWireLine({ type: 'sacked', by: 'A', on: 'B', front: 'Casino' }), 'an empire sacking posts');
assert(cityWireLine({ type: 'family_war_declared', who: 'A', family: 'The Corvinos' }), 'a war declaration posts');
assert(cityWireLine({ type: 'megaproject_complete', monument: 'The Cathedral', architect: 'A' }), 'a monument completion posts');
assert(cityWireLine({ type: 'breakout', crew: 3 }), 'a prison break posts');
assert(cityWireLine({ type: 'boxing_title_fight', card: 'A vs B' }), 'a title fight posts');

// ── everything OUTSIDE the curated set is dropped — the wire is a highlight reel, not the full feed ──
assert.equal(cityWireLine({ type: 'speakeasy_round' }), null, 'a mundane event is not on the wire');
assert.equal(cityWireLine({ type: 'convoy' }), null, 'a convoy departing is not a highlight');
assert.equal(cityWireLine({ type: 'errand_done', who: 'A', npc: 'doc' }), null, 'an errand is not a highlight');
assert.equal(cityWireLine(null), null, 'a null event is handled');
assert.equal(cityWireLine({ foo: 1 }), null, 'a malformed event (no type) is handled');
// a formatter that throws on a missing field must degrade to null, never crash the emitter
assert.equal(cityWireLine({ type: 'sacked' }), null, 'a curated event with a missing field degrades cleanly, not a throw');

// ── NO curated line ever carries an exact dollar figure (the anti-precise-kill-EV rule on a public channel) ──
const samples = [
  { type: 'kill', by: 'A', victim: 'B' }, { type: 'sacked', by: 'A', on: 'B', front: 'Casino' },
  { type: 'scandal', killer: 'A', victim: 'B' }, { type: 'vendetta_settled', by: 'A', on: 'B', for: 'C' },
  { type: 'family_war_declared', who: 'A', family: 'F' }, { type: 'family_war_won', who: 'A', family: 'F' },
  { type: 'frontier_seized', gang: 'F', npc: 'the Dockrats' }, { type: 'megaproject_complete', monument: 'M', architect: 'A' },
  { type: 'sov_built', gang: 'F', district: 'docks' }, { type: 'breakout', crew: 2 }, { type: 'boxing_title_fight', card: 'A vs B' },
];
for (const s of samples) {
  const line = cityWireLine(s);
  assert(line, `${s.type} formats`);
  assert(!/\$[0-9]/.test(line), `${s.type} never carries a dollar figure on the public wire`);
}

// ── DORMANT by default: with no CITY_WIRE_WEBHOOK_URL set, postCityWire posts nothing ──
let delivered = [];
__setDeliver(async (url, content) => { delivered.push({ url, content }); });
delete process.env.CITY_WIRE_WEBHOOK_URL;
postCityWire({ type: 'kill', by: 'A', victim: 'B' });
assert.equal(delivered.length, 0, 'dormant without the webhook env — nothing is posted');

// ── configured: a curated event reaches the delivery seam with the right content + url ──
process.env.CITY_WIRE_WEBHOOK_URL = 'https://discord.example/webhook/xyz';
postCityWire({ type: 'kill', by: 'Don Vito', victim: 'Sonny' });
assert.equal(delivered.length, 1, 'a configured wire posts a curated event');
assert.equal(delivered[0].url, 'https://discord.example/webhook/xyz', 'to the configured webhook');
assert(/Don Vito/.test(delivered[0].content) && /Sonny/.test(delivered[0].content), 'with the formatted line');
// a non-curated event still posts nothing even when configured
postCityWire({ type: 'speakeasy_round', who: 'A' });
assert.equal(delivered.length, 1, 'a mundane event never reaches the wire, configured or not');

// ── the throttle: a flood over the window cap is dropped (Discord rate-limits; a wall reads as noise) ──
delivered = [];
for (let i = 0; i < 60; i++) postCityWire({ type: 'kill', by: `K${i}`, victim: `V${i}` });
assert(delivered.length <= 20 && delivered.length > 0, `the wire is throttled to the window cap (got ${delivered.length})`);

delete process.env.CITY_WIRE_WEBHOOK_URL;
__setDeliver(async () => {}); // restore a no-op so nothing lingers
console.log('✅ THE CITY WIRE test passed — the curated allowlist formats the marquee drama (a kill names both, an anonymous hit stays anonymous), drops everything mundane and every malformed/missing-field event cleanly, NEVER carries a dollar figure on the public channel, is DORMANT without the webhook env, reaches the delivery seam with the right content + url when configured, and throttles a flood to the window cap — all §10.4-free, no network.');
