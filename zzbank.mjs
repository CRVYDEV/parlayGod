import pg from 'pg';
const BASE='http://127.0.0.1:8099';
const pool=new pg.Pool({connectionString:'postgres://postgres@/playsession?host=/tmp&port=5433'});
// the content-type header rides ONLY with a body (bodyless POST + json header = Fastify 400)
const j=async(m,p,b,h={})=>{const r=await fetch(BASE+p,{method:m,headers:{...(b?{'content-type':'application/json'}:{}),...h},body:b?JSON.stringify(b):undefined});
  return {code:r.status, body:await r.json().catch(()=>({}))};};
const g=await j('POST','/v1/auth/guest');
const H={authorization:'Bearer '+g.body.token};
const nm='Banker'+Math.random().toString(36).slice(2,7);
const cr=await j('POST','/v1/character',{name:nm},H);
if (cr.code>=400) { console.log('create failed:',cr.code,JSON.stringify(cr.body)); process.exit(1); }
const cid=(await pool.query('SELECT id FROM characters WHERE name=$1',[nm])).rows[0].id;
// seed cash directly — we are testing the ESTATE, not the faucet
await pool.query('UPDATE characters SET cash=100000 WHERE id=$1',[cid]);
const dep=await j('POST','/v1/bank/deposit',{amount:60000},H);
console.log('deposit:',dep.code);
// CLEAR the deposit: push the in-transit marker well into the past
await pool.query("UPDATE characters SET bank_intransit_at = now() - interval '10 hours' WHERE id=$1",[cid]);
let me=(await j('GET','/v1/me',null,H)).body.character;
console.log('\nBEFORE DEATH: pocket $'+me.cash+' · bank $'+me.bank+' · inTransit $'+me.bankInTransit+'   (0 = fully CLEARED)');
const kill=await j('POST','/v1/mod/kill',{characterId:cid,reason:'estate test'},{'x-mod-key':'play-session-mod-key-long-enough'});
console.log('mod-kill:',kill.code, JSON.stringify(kill.body).slice(0,120));
const after=(await j('GET','/v1/me',null,H)).body.character;
console.log('AFTER DEATH (the heir): pocket $'+after.cash+' · bank $'+after.bank);
console.log('\nVERDICT — a CLEARED bank balance of $60,000:', after.bank===0
  ? 'GONE. The Codex lists "cleared bank cash" under WHAT IS SAFEST WHEN YOU DIE.'
  : 'SURVIVED ($'+after.bank+'). The Codex is right.');
await pool.end();
