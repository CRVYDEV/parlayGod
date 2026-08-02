#!/usr/bin/env bash
# Run the OMERTÀ Foundry suite in the SANDBOXED build environment (GitHub releases +
# binaries.soliditylang.org egress-blocked; npm open). First green run: 2026-07-23 — 73/73.
#
# How it works around the blocks:
#   forge      → the official npm distribution (@foundry-rs/forge → forge-linux-amd64 binary)
#   forge-std  → vendored copy inside @layerzerolabs/toolbox-foundry (v1.9.7) → lib/forge-std/src
#   OpenZeppelin → @openzeppelin/contracts@5.6.1 (npm) → lib/openzeppelin-contracts/contracts
#   v4-core    → @uniswap/v4-core@1.0.2 (npm) → lib/v4-core. The npm package ships its own lib/
#                already populated, so OmertaHook's suite can deploy a REAL PoolManager and route
#                REAL swaps instead of talking to a mock.
#   solc       → the NATIVE linux-amd64 binary from binaries.soliditylang.org when that host is
#                reachable, else a stdio shim over solc-js 0.8.26 (the emscripten build of the SAME
#                compiler, same commit 8a97fa7a). forge talks --standard-json with every source
#                inlined, so the shim needs no filesystem resolution; its output must be written with
#                fs.writeSync (an async pipe write truncates at 64 KiB on process.exit).
#                ⚠ THE SHIM CANNOT COMPILE `PoolManager` — the wasm build runs out of heap ("memory
#                access out of bounds"), so on a box where only the shim is available every suite
#                still runs EXCEPT OmertaHook's. That is a limit of the emscripten compiler, not of
#                the contract; the native binary compiles it in ~4s.
#
# On an open-internet machine prefer ./run-forge-test.sh (native toolchain). Re-running with
# NATIVE solc is part of the third-party audit's own verification either way.
set -euo pipefail
cd "$(dirname "$0")"

WORK="${FORGE_SANDBOX_DIR:-/tmp/forge-sandbox}"
mkdir -p "$WORK" && pushd "$WORK" >/dev/null
[ -f package.json ] || npm init -y >/dev/null
npm i --no-audit --no-fund @foundry-rs/forge @layerzerolabs/toolbox-foundry @openzeppelin/contracts@5.6.1 \
  @uniswap/v4-core@1.0.2 solc@0.8.26 >/dev/null
FORGE="$WORK/node_modules/@foundry-rs/forge-linux-amd64/bin/forge"

# Prefer the native compiler — same version and commit, and the only one that can build PoolManager.
SOLC="$WORK/solc-native-0.8.26"
if [ ! -x "$SOLC" ]; then
  if curl -sS -m 180 -L -o "$SOLC.tmp" \
      https://binaries.soliditylang.org/linux-amd64/solc-linux-amd64-v0.8.26+commit.8a97fa7a 2>/dev/null \
      && [ -s "$SOLC.tmp" ]; then
    chmod +x "$SOLC.tmp" && mv "$SOLC.tmp" "$SOLC"
  else
    rm -f "$SOLC.tmp"
    echo "⚠ binaries.soliditylang.org unreachable — falling back to the solc-js shim."
    echo "  Every suite will run EXCEPT test/OmertaHook.t.sol, which needs to compile PoolManager."
  fi
fi

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
# The whole package, not just src/ — its own lib/ (solmate, forge-std, OZ) is what lets the vendored
# v4 test routers and PoolManager compile.
if [ ! -f lib/v4-core/src/PoolManager.sol ]; then
  mkdir -p lib/v4-core
  cp -r "$WORK/node_modules/@uniswap/v4-core/." lib/v4-core/
fi

USE="$WORK/solc-0.8.26"
[ -x "$SOLC" ] && USE="$SOLC"
echo "▸ $($FORGE --version | head -1)"
echo "▸ $("$USE" --version | tail -1)"
FOUNDRY_OFFLINE=true "$FORGE" test --use "$USE" --fuzz-runs 512 "$@"
