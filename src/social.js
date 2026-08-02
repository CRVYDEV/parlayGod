// M3 social systems — gangs, wars, turf, jumps, bounties, hit contracts, death,
// busting, plus the escrowed Exchange (§5.4, deferred from M2 pending notifications).
// Every formula cites spec §7 / prototype v24. Two-party actions run under
// withTwoCharacters (game.js) which locks both rows in stable order (§10.1).
//
// This file was 2,003 lines and held all of the above; it is now the FACADE over src/social/, which
// holds the same code split by domain. Everything still imports from here, so no call site changed.
//
// The package is layered, and the layering is what keeps it acyclic:
//
//   combat      jumps, the search, the shot, NPC hits, busting     ← reaches down into all of these
//   estate      death, the heir, grudges, blood feuds              ← reaches into gangs + contracts
//   contracts   the board, escrow, the assassin ladder             ← reaches into gangs (canCommand)
//   defense     the safehouse and the bodyguard market
//   gangs       families, tribute, wars, turf
//   exchange    the escrowed cb/ammo market (self-contained)
//   shared      the PvP predicates and the house take (leaf)
//
// Nothing lower imports anything higher. The re-exports below are explicit rather than `export *`
// so the package's private helpers stay private and the public surface is legible in one place.
export { bust, callOffSearch, fire, huntWanted, jump, npcHit, startSearch, stealCar, robTrunk, stealBoat, sabotage } from './social/combat.js';
export { cancelBounty, cancelFamilyContract, claimBounty, hitmanLeaderboard, listContracts, peekContracts, postBounty, postFamilyContract, sweepExpiredBounties } from './social/contracts.js';
export { enterSafehouse, hireBodyguard, offerBodyguard } from './social/defense.js';
export { acceptPeace, feudLeaderboard, proposePeace, runEstate } from './social/estate.js';
export { buyListing, cancelListing, listItem } from './social/exchange.js';
export { createGang, declareWar, joinGang, kickMember, leaveGang, promoteMember, removeMember, resolveWarIfDue, seizeDistrict, setWatch, onWatch, watchMult, stakeClaim, resolveContest, sweepContests, turfQuote, tribute, tributeOmr } from './social/gangs.js';
