#!/usr/bin/env bash
# Run the OMERTÀ Foundry suite on any machine with open internet.
# The NATIVE-toolchain run (belt-and-braces for the third-party audit). The sandboxed build
# environment has its own runner — ./run-forge-test-sandboxed.sh (npm forge + solc-js shim),
# first green 2026-07-23: 73/73 incl. two 512-run fuzzes.
#
#   chmod +x run-forge-test.sh && ./run-forge-test.sh
#
# Pins: solc 0.8.26 (foundry.toml), OpenZeppelin v5.6.1 (the API the contracts target),
# forge-std v1.9.6 (Test.sol). Drop the @tags to float to latest if you prefer.
set -euo pipefail
cd "$(dirname "$0")"

# 1. Foundry toolchain (installs to ~/.foundry/bin) ---------------------------------
if ! command -v forge >/dev/null 2>&1; then
  echo "▸ installing Foundry…"
  curl -L https://foundry.paradigm.xyz | bash
  export PATH="$HOME/.foundry/bin:$PATH"
  foundryup
fi
echo "▸ $(forge --version)"

# 2. Dependencies into lib/ (idempotent) --------------------------------------------
# omerta-contracts lives inside the parlayGod git repo, so tell forge NOT to touch git
# (submodules/commits) — a plain checkout into lib/ is all the compiler needs.
NOGIT=""; forge install --help 2>&1 | grep -q -- "--no-git" && NOGIT="--no-git"
[ -d lib/forge-std ]             || forge install $NOGIT foundry-rs/forge-std@v1.9.6
[ -d lib/openzeppelin-contracts ] || forge install $NOGIT OpenZeppelin/openzeppelin-contracts@v5.6.1

# 3. Build + test -------------------------------------------------------------------
echo "▸ forge build" && forge build
echo "▸ forge test" && forge test -vvv --fuzz-runs 512
echo "✅ done — if every test above reads [PASS], the suite is green and the contracts are ready for the third-party audit."
