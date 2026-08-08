// VAPID KEYGEN — one-time helper to switch Web Push ON.
//
// Web Push (src/push.js) is the highest-ROI retention primitive for a lazy-accrual game and ships
// DORMANT until VAPID keys are set. This prints a fresh keypair; set the two vars and redeploy, and
// the 🔔 button appears in-client. The private key is a SECRET — never commit it, never share it.
//
//   node tools/vapid.js
//
// Then set on the API (Render → Environment, or your .env):
//   VAPID_PUBLIC_KEY=<public>
//   VAPID_PRIVATE_KEY=<private>   ← keep secret
//   VAPID_SUBJECT=mailto:ops@omerta.fun   (optional; defaults to that)
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('\nWeb Push VAPID keys — set these on the API and redeploy.\n');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('VAPID_SUBJECT=mailto:ops@omerta.fun');
console.log('\n⚠  The PRIVATE key is a secret — never commit it or paste it anywhere public.');
console.log('   The PUBLIC key is client-embedded by design (safe to expose).\n');
