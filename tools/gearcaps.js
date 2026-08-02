#!/usr/bin/env node
// THE GEAR-CAP TABLE — every tokenId the Safe has to cap before cars and boats can be extracted.
//
// `npm run gearcaps` prints it; CHAIN-DEPLOY.md §0.6 is the runbook step that consumes it.
//
// WHY THIS IS A TOOL AND NOT A DOCUMENT. GearVault caps each id for life and fails CLOSED at zero,
// so an id nobody capped simply cannot mint — which is the safe direction, and also the direction
// that makes an omission invisible until a player tries to extract the one car nobody thought about.
// There are 60 cars and 6 boats across 4 tiers, so the table is 264 rows. A hand-typed table of 264
// numbers is wrong the first time a car is added to the catalog; a generated one cannot be, and the
// generation is one loop over the same catalogs the game already reads.
//
// It derives from `nftTokenId` rather than recomputing the arithmetic, so this table and the ids the
// server actually signs can never disagree — the whole failure mode being guarded against is a deploy
// that caps 264 ids and misses the one the voucher names.
import { CARS, PORT, RARITY, nftTokenId } from '../src/rules.js';

const rows = [];
for (const [kind, catalog] of [['car', CARS], ['boat', PORT.BOATS]])
  for (const item of catalog)
    for (const tier of RARITY.TIERS)
      rows.push({
        kind,
        id: item.id,
        name: item.name,
        rarity: tier.id,
        tokenId: nftTokenId(kind, item.id, tier.id),
        cap: RARITY.SUPPLY_CAP[tier.id],
      });

// A duplicate tokenId would mean two classes sharing one lifetime cap — the ranges are designed to
// make that impossible, so assert it here rather than trusting the design note. Cheap, and it fires
// the day someone widens a catalog past STRIDE or re-bases a range.
const seen = new Map();
for (const r of rows) {
  const prev = seen.get(r.tokenId);
  if (prev) {
    console.error(`FATAL: tokenId ${r.tokenId} is claimed by BOTH ${prev.kind}/${prev.id}/${prev.rarity} `
      + `and ${r.kind}/${r.id}/${r.rarity} — the id spaces collide, so one class would silently share `
      + `the other's lifetime cap. Fix RARITY.TOKEN before deploying.`);
    process.exit(1);
  }
  seen.set(r.tokenId, r);
}

const arg = process.argv[2];
if (arg === '--json') {
  console.log(JSON.stringify(rows, null, 2));
} else if (arg === '--csv') {
  console.log('tokenId,kind,classId,rarity,cap,name');
  for (const r of rows) console.log(`${r.tokenId},${r.kind},${r.id},${r.rarity},${r.cap},"${r.name}"`);
} else {
  console.log(`▸ GEAR-CAP TABLE — ${rows.length} tokenIds across ${CARS.length} cars and ${PORT.BOATS.length} boats`);
  console.log(`  caps: ${RARITY.TIERS.map((t) => `${t.name} ${RARITY.SUPPLY_CAP[t.id]}`).join(' · ')}`);
  console.log(`  ranges: cars ${RARITY.TOKEN.CAR_BASE}+ · boats ${RARITY.TOKEN.BOAT_BASE}+ · stride ${RARITY.TOKEN.STRIDE}`);
  console.log('');
  for (const r of rows) console.log(`  ${String(r.tokenId).padStart(7)}  ${r.rarity.padEnd(10)} cap ${String(r.cap).padStart(5)}   ${r.name}`);
  console.log('');
  console.log('  --json / --csv for a machine-readable table to drive the Safe transaction batch.');
  console.log('  Nothing mints until each of these is capped: GearVault fails CLOSED at 0.');
}
