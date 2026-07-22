// ── src/cardpng.js — rasterize a BROADCAST card SVG → PNG for social unfurls ──
// X/Twitter (and most feeds) won't render an SVG og:image, so a shared profile needs a real PNG.
// resvg (@resvg/resvg-js) is a lightweight native SVG→PNG rasterizer — no headless browser in the
// game backend. It's an OPTIONAL dependency: if it isn't installed (or fails to load), renderPng
// returns null and the /card route falls back to serving the SVG, so nothing ever 500s.
// Rendered PNGs are cached by the SVG's content hash (the SVG encodes name+stats+ref, so an
// identical card → an identical key) with a TTL — an OG crawler hits a share a handful of times.

let _render = null;       // an async SVG→PNG renderer (svg, opts) → Promise<Buffer>, once loaded
let _tried = false;       // load attempted (don't re-import on every miss)
async function loadResvg() {
  if (_tried) return _render;
  _tried = true;
  try {
    const m = await import('@resvg/resvg-js');
    // (red-team R13 F1) prefer renderAsync — it rasterizes on a WORKER THREAD, so a flood of card
    // requests can't pin the single libuv event loop (the sync `.render()` blocked it for tens of
    // ms/call). Fall back to the sync path only if renderAsync isn't present in this resvg build.
    if (typeof m.renderAsync === 'function') _render = async (svg, opts) => (await m.renderAsync(svg, opts)).asPng();
    else if (m.Resvg) _render = async (svg, opts) => new m.Resvg(svg, opts).render().asPng();
    else _render = null;
  } catch { _render = null; /* optional dep absent — degrade to SVG */ }
  return _render;
}

// tiny FNV-1a over the svg → a stable cache key
function keyOf(svg) {
  let h = 0x811c9dc5;
  for (let i = 0; i < svg.length; i++) { h ^= svg.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

const CACHE = new Map();          // key → { png: Buffer, at: ms }
const TTL_MS = 5 * 60 * 1000;     // an OG re-crawl within 5 min serves the cached PNG
const CAP = 256;                  // bounded — evict oldest

// Render an SVG string to a PNG Buffer at 1200px wide (the card is authored 1200×630).
// Returns a Buffer, or null when no rasterizer is available (caller falls back to SVG).
export async function renderPng(svg) {
  const now = Date.now();
  const key = keyOf(svg);
  const hit = CACHE.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.png;
  const render = await loadResvg();
  if (!render) return null;
  let png;
  try {
    png = await render(svg, { fitTo: { mode: 'width', value: 1200 }, font: { loadSystemFonts: true } });
  } catch { return null; }        // a malformed SVG must never crash the route
  CACHE.set(key, { png, at: now });
  if (CACHE.size > CAP) CACHE.delete(CACHE.keys().next().value);   // evict oldest
  return png;
}

// Is a rasterizer available? (for diagnostics / the ops view; loads lazily)
export async function pngAvailable() { return !!(await loadResvg()); }
