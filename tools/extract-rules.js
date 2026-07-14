// Regenerate src/rules.js from a prototype build: node tools/extract-rules.js ../omerta-game-v24.jsx
import fs from 'node:fs';
const proto = fs.readFileSync(process.argv[2], 'utf8');
const grab = (n) => { const m = proto.match(new RegExp('const ' + n + ' = (\\[[\\s\\S]*?\\n\\]);')); if (!m) throw new Error(n); return m[1]; };
const tables = ['CRIMES','MISSIONS','RACKETS','CITY_EVENTS','CARS','TRIMS','GUNS','VESTS','CONSUMABLES','GOODS','ASSETS','MARKET','DAILY_POOL','FAMILY_TASKS','DRUGS','KITCHENS','TRADE_RANKS','PATHS','RANKS','DISTRICTS','ONBOARD_TASKS','RECRUIT_MILESTONES'];
const cur = fs.readFileSync(new URL('../src/rules.js', import.meta.url), 'utf8');
const tail = cur.slice(cur.indexOf('export const CONSTANTS'));
let out = `// AUTO-GENERATED from ${process.argv[2].split('/').pop()} — do not hand-edit.\n`;
for (const t of tables) out += `export const ${t} = ${grab(t)}\n\n`;
fs.writeFileSync(new URL('../src/rules.js', import.meta.url), out + tail);
console.log('rules.js regenerated from', process.argv[2]);
