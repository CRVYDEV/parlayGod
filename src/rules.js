// THE RULES — the game's numbers, in two halves that are deliberately separate files.
//
//   rules.generated.js  MACHINE-OWNED. Only the prototype's data tables. `tools/extract-rules.js`
//                       overwrites it wholesale, so there is nothing hand-written in it to lose.
//   rules.tail.js       HAND-WRITTEN. Every helper, catalog, ladder and founder-signed lever.
//                       The extractor never touches it.
//
// Everything imports from HERE, so no caller needs to know which half a name lives in, and moving a
// name between halves is not a breaking change. test/rules.js enforces the separation: the generated
// file may hold only table exports and may not import anything, and the two halves may not both
// export the same name (an ambiguous star re-export fails at access time, not at boot).
export * from './rules.generated.js';
export * from './rules.tail.js';
