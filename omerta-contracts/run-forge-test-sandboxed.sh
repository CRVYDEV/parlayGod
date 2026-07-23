#!/usr/bin/env bash
# Run the OMERTÀ Foundry suite in the SANDBOXED build environment (GitHub releases +
# binaries.soliditylang.org egress-blocked; npm open). First green run: 2026-07-23 — 73/73.
#
# How it works around the blocks:
#   forge      → the official npm distribution (@foundry-rs/forge → forge-linux-amd64 binary)
#   forge-std  → vendored copy inside @layerzerolabs/toolbox-foundry (v1.9.7) → lib/forge-std/src
#   OpenZeppelin → @openzeppelin/contracts@5.6.1 (npm) → lib/openzeppelin-contracts/contracts
#   solc       → a stdio shim over solc-js 0.8.26 (the emscripten build of the SAME compiler,
#                same commit 8a97fa7a). forge talks --standard-json with every source inlined,
#                so the shim needs no filesystem resolution. Output must be written with
#                fs.writeSync (an async pipe write truncates at 64 KiB on process.exit).
#
# On an open-internet machine prefer ./run-forge-test.sh (native toolchain). Re-running with
# NATIVE solc is part of the third-party audit's own verification either way.
set -euo pipefail
cd "$(dirname "$0")"

WORK="${FORGE_SANDBOX_DIR:-/tmp/forge-sandbox}"
mkdir -p "$WORK" && pushd "$WORK" >/dev/null
[ -f package.json ] || npm init -y >/dev/null
npm i --no-audit --no-fund @foundry-rs/forge @layerzerolabs/toolbox-foundry @openzeppelin/contracts@5.6.1 solc@0.8.26 >/dev/null
FORGE="$WORK/node_modules/@foundry-rs/forge-linux-amd64/bin/forge"

cat > "$WORK/solc-0.8.26" <<SHIM
#!/usr/bin/env node
const solc = require('$WORK/node_modules/solc');
if (process.argv.includes('--version')) {
  process.stdout.write('solc, the solidity compiler commandline interface\nVersion: ' + solc.version() + '\n');
  process.exit(0);
}
const fs = require('fs');
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  try {
    const out = Buffer.from(solc.compile(input), 'utf8');
    let off = 0;
    while (off < out.length) off += fs.writeSync(1, out, off, out.length - off);
    process.exit(0);
  } catch (e) { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); }
});
SHIM
chmod +x "$WORK/solc-0.8.26"
popd >/dev/null

# deps into lib/ (gitignored), idempotent
if [ ! -f lib/forge-std/src/Test.sol ]; then
  mkdir -p lib/forge-std/src
  cp -r "$WORK/node_modules/@layerzerolabs/toolbox-foundry/lib/forge-std/." lib/forge-std/src/
fi
if [ ! -f lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol ]; then
  mkdir -p lib/openzeppelin-contracts/contracts
  cp -r "$WORK/node_modules/@openzeppelin/contracts/." lib/openzeppelin-contracts/contracts/
fi

echo "▸ $($FORGE --version | head -1)"
FOUNDRY_OFFLINE=true "$FORGE" test --use "$WORK/solc-0.8.26" --fuzz-runs 512 "$@"
