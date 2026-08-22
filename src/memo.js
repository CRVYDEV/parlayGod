// A TTL + single-flight memo for SERVER-WIDE reads — boards whose answer is identical for every
// player, so computing one per caller is the same scan N times over.
//
// WHY THIS EXISTS AS A SHARED HELPER rather than a third hand-rolled copy: /health already carries
// this pattern and citywide carries two more, and a fourth written by hand is how twenty subtle lines
// come to disagree (this codebase spent a session collapsing sixty-nine private copies of three gate
// predicates for exactly that reason). If a fifth board needs it, call this — do not copy it.
//
// THE TWO PARTS EARN THEIR PLACE SEPARATELY, and the second is the one people leave out:
//   • the TTL bounds the SUSTAINED cost — one computation per window however many callers arrive;
//   • single-flight bounds the CONCURRENT one — without it the whole first-hit window is uncovered,
//     so a burst of 200 arrivals opens 200 scans, which is precisely the shape a flood produces.
// The /health cache was measured doing exactly that: 400 concurrent hits → 2 queries with both, 400
// without.
//
// The TTL is read PER CALL, never captured at import (the ratelimit.js discipline), so a test can set
// it to 0 and assert against a live computation instead of fighting a stale one.
//
// WHAT MUST NEVER GO IN HERE: anything that differs per player. This memo has no idea who is asking,
// so a payload holding one player's own figures would be served to the next caller — the classic cache
// leak. Memoize the shared half and compute the personal half from it.
export function memo(compute, ttlMs) {
  let at = 0, value = null, inFlight = null;
  const fn = async (...args) => {
    const ttl = ttlMs();
    if (value !== null && ttl > 0 && Date.now() - at < ttl) return value;
    // `||=` is the whole single-flight: the first miss starts the work and every arrival during it
    // awaits that same promise. finally() clears the slot whether it resolved or threw, so a failed
    // computation is retried by the next caller rather than cached as a permanent error.
    const flight = inFlight ||= Promise.resolve(compute(...args))
      .then((v) => { value = v; at = Date.now(); return v; })
      .finally(() => { inFlight = null; });
    return flight;
  };
  // For tests and for any caller that must not read a stale answer after it has just written.
  fn.clear = () => { at = 0; value = null; };
  return fn;
}
