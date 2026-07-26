// Every .js file under src/, walked RECURSIVELY.
//
// This exists because the same bug happened twice. Several guards work by scanning the source tree
// for a pattern — test/preflight.js looks for `process.env.X` reads to check each is classified,
// test/migrate.js looks for `DELETE FROM <table>` to check each estate-wiped table is really wiped —
// and both listed `src/` FLAT. So the first time code moved into a subdirectory (src/routes/, then
// src/social/), the guard went quiet about it rather than failing: an env var read from a route
// module became unclassifiable, and moving runEstate into src/social/estate.js made the entire
// estate wipe invisible to the check that exists to prove it happens.
//
// A guard that silently stops covering the thing it guards is worse than no guard, so the walk lives
// in one place now and every scanner uses it.
import fs from 'node:fs';
import path from 'node:path';

export function walkSrc(dir = 'src', { exclude = [] } = {}) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walkSrc(p, { exclude });
    return e.isFile() && e.name.endsWith('.js') && !exclude.includes(p) ? [p] : [];
  });
}

/** The whole of src/ as one string — for guards that only need to ask "does this appear anywhere?" */
export const srcText = (opts) => walkSrc('src', opts).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
