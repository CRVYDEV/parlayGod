// Regenerate src/rules.generated.js from a prototype build:
//   node tools/extract-rules.js reference-prototype-v24.jsx
//
// This writes ONE file and that file holds nothing but data tables, so a regeneration cannot destroy
// hand-written code. It used to: the old version rebuilt all of src/rules.js by re-emitting the
// tables and then re-appending everything from `export const CONSTANTS` onward, which meant anything
// living in the gap between the last table and CONSTANTS was silently deleted. That gap really did
// hold live code (recruitRankOf, used by the recruiters leaderboard), and the resurrection worked in
// the other direction too — re-emitting ONBOARD_TASKS from the prototype brought back the retired
// "Star the repo" task, undoing a founder decision without a word.
//
// Now the seam is a file boundary: the extractor owns rules.generated.js and never opens
// rules.tail.js. test/rules.js enforces the other side of the deal — the generated file may contain
// only these table exports and may not import anything, so nothing hand-written can drift into it.
//
// Table CONTENT is edited in the PROTOTYPE, then re-extracted (the car-catalog precedent) — never in
// the generated file, which the next run would overwrite.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// The table list is the contract between this script and test/rules.js, so it is exported as data and
// the extraction below runs only when this file is invoked as a script. Importing it must have no
// side effects — the test reads TABLES to assert the generated file exports exactly these and nothing
// else, and it should not have to hand a prototype path to a module it only wants a constant from.
export const TABLES = ['CRIMES', 'MISSIONS', 'RACKETS', 'CITY_EVENTS', 'CARS', 'TRIMS', 'GUNS', 'VESTS',
  'CONSUMABLES', 'GOODS', 'ASSETS', 'MARKET', 'DAILY_POOL', 'FAMILY_TASKS', 'DRUGS', 'KITCHENS',
  'TRADE_RANKS', 'PATHS', 'RANKS', 'DISTRICTS', 'ONBOARD_TASKS', 'RECRUIT_MILESTONES'];

const header = `// AUTO-GENERATED — do not hand-edit. Regenerate with:
//   node tools/extract-rules.js <path-to-prototype>.jsx
//
// This file is MACHINE-OWNED and holds nothing but the prototype's data tables. That is the whole
// point of it being separate: the extractor overwrites it wholesale, so nothing hand-written can
// live here to be destroyed. Every helper, override and hand-authored constant lives in
// rules.tail.js, which the extractor never touches. test/rules.js enforces both halves of that —
// this file may contain only these table exports, and it may not import anything.
//
// Ground rule #2 ("src/rules.js is generated, never edited") is now mechanically true rather than
// remembered: edit the PROTOTYPE and re-extract, exactly as the car-catalog expansion did.
`;

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const protoPath = process.argv[2];
  if (!protoPath) { console.error('usage: node tools/extract-rules.js <prototype>.jsx'); process.exit(1); }
  const proto = fs.readFileSync(protoPath, 'utf8');
  const grab = (n) => {
    const m = proto.match(new RegExp('const ' + n + ' = (\\[[\\s\\S]*?\\n\\]);'));
    if (!m) throw new Error(`table not found in prototype: ${n}`);
    return m[1];
  };
  const out = header + TABLES.map((t) => `export const ${t} = ${grab(t)}\n`).join('\n');
  fs.writeFileSync(new URL('../src/rules.generated.js', import.meta.url), out);
  console.log(`src/rules.generated.js regenerated from ${protoPath} — ${TABLES.length} tables, `
    + `${out.split('\n').length} lines. rules.tail.js was not touched.`);
}
