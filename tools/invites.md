# Minting invite codes for a seeded launch night

`INVITE_MODE=on` closes the doors to anyone without a code — a controlled first cohort and a real
Sybil bound. This is the whole procedure; it takes two minutes and needs only the production
`MOD_KEY`. (I — the developer session — do not hold the production key, which is why this is a
runnable recipe rather than a done deed.)

## 1. Turn the door on

Set `INVITE_MODE=on` on the **API** service (Render → Environment) and redeploy. From that moment
a new account needs a code; existing accounts are untouched.

## 2. Mint a batch

One call, up to 100 codes at a time. `uses` is how many accounts each code admits — for a launch
night, single-use codes are the honest bound (a multi-use code posted in a Discord is an open door):

```bash
curl -s -X POST https://www.omerta.fun/v1/mod/invites \
  -H "x-mod-key: $MOD_KEY" -H "content-type: application/json" \
  -d '{"count": 50, "uses": 1}' | python3 -m json.tool
```

The response is `{"codes": ["a1b2c3d4e5f6", ...], "uses": 1}`. Save it — codes are not listed
anywhere afterwards (there is deliberately no "list all invites" surface).

For a friends-of-friends tier, mint a second, smaller batch with `"uses": 3` and label it as such
in your notes, so an over-shared code is identifiable by which batch it came from.

## 3. Hand them out

A code is entered on the entry screen (the field reveals itself when the server answers `invite`),
and it rides through **both** doors — guest sign-in and X one-click — so recipients need no
instructions beyond the code itself. One line to send with each:

> Doors open Saturday night. Your code: `a1b2c3d4e5f6` — enter it at https://www.omerta.fun when
> it asks. One use, so it's yours.

## 4. On the night

- Codes running low is one more `curl` away — minting is instant and additive.
- `INVITE_MODE=off` (and a redeploy) opens the doors to everyone; the codes simply stop being
  asked for. Opening up mid-night is a one-way decision worth making deliberately, not under
  pressure.

## Notes

- Consumption is atomic with account creation (one code burned per created account, race-proof —
  the red-team B2 fix), so a code cannot be double-spent by two simultaneous signups.
- Agents need codes too while the mode is on (`omerta_start` passes `OMERTA_INVITE`) — decide
  whether the launch cohort includes machines, and mint their batch separately if so.
