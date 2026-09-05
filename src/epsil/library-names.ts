import { STANDARD_LIBRARIES } from '../compute-engine/library/library.js';

import { OPERATORS } from './operators.js';
import { HARD_RESERVED_WORDS } from './reserved-words.js';

//
// The Epsil spelling of the standard library.
//
// Every operator and constant of the Compute Engine standard library has a
// capitalized MathJSON name (`Sin`, `IsPrime`, `Pi`). Epsil gives most of
// them a second spelling with an initial lowercase letter (`sin`, `isPrime`,
// `pi`), the style of the language. The lowercase spelling is a property of
// the LANGUAGE, like `+` for `Add`: the parse tree keeps the spelling the
// author wrote, the resolution pass (`resolve-library-names.ts`) rewrites a
// free occurrence to the canonical name before the program is boxed, and the
// engine never sees the lowercase name. There is no engine binding for it.
//
// This module is the one place that knows which names have a spelling and
// what it is. `epsilNameOf` applies the rule and the exclusions;
// `canonicalLibraryName` is the reverse map, built once from the standard
// library definitions. The exclusion sets below are hand-curated;
// `test/epsil/library-names.test.ts` checks each name in them against the
// library, so a renamed operator fails a test instead of silently leaving a
// stale exclusion behind.
//

/**
 * Operators that Epsil writes with a dedicated syntax, so a function spelling
 * would be a second way to write a construct the language already has: the
 * statement forms (`let`, `type`, `protocol`, `function`, `if`/`else`,
 * `match`, the loops), the literal forms (tuples, `xs[i]`, `...xs`, `x: T`,
 * `name: value` arguments, `x^2`), the nodes the parser produces for its own
 * use (`Delimiter`, `Sequence`, `InvisibleOperator`, `Annotated`, the LaTeX
 * islands, spacing), and the pattern nodes (`Wildcard*`, `Condition`,
 * `Alternatives`, `Rule`).
 */
export const GRAMMAR_CONSTRUCTS: ReadonlySet<string> = new Set([
  'Alternatives',
  'Annotated',
  'At',
  'Block',
  'Colon',
  'Comprehension',
  'Condition',
  'Declare',
  'DeclareConformance',
  'DeclareProtocol',
  'DeclareSumType',
  'DeclareType',
  'DefineFunction',
  'Delimiter',
  'Hold',
  'HoldValues',
  'HorizontalSpacing',
  'IndexedSequence',
  'InvisibleOperator',
  'Latex',
  'LatexString',
  'Loop',
  'MatchCase',
  'MatchesType',
  'MemberCall',
  'NamedArgument',
  'OverParen',
  'Pair',
  'PreDecrement',
  'PreIncrement',
  'ReleaseHold',
  'Rule',
  'Sequence',
  'Single',
  'Spread',
  'Square',
  'Subscript',
  'Text',
  'Triple',
  'Typed',
  'Unevaluated',
  'Which',
  'Wildcard',
  'WildcardOptionalSequence',
  'WildcardSequence',
]);

/**
 * The literal constructors whose values Epsil writes with brackets and
 * quotes: `[…]` for `List`, `(a, b)` for `Tuple`, `{…}` for `Set`,
 * `{k: v}` for `Dictionary`, `"…"` for `String`.
 */
export const LITERAL_CONSTRUCTORS: ReadonlySet<string> = new Set([
  'Dictionary',
  'List',
  'Set',
  'String',
  'Tuple',
]);

/**
 * Relation operators that are LaTeX glyphs (`\approx`, `\sim`, `\prec`,
 * `\pm`, …) with no natural reading as a function call: `approx(a, b)` reads
 * poorly and `tilde(a, b)` means nothing. An Epsil author reaches them
 * through a LaTeX island. Relations with a verb reading (`Divides`,
 * `Implies`, `Subset`, `Congruent`, …) are NOT here and do get a spelling.
 */
export const RELATION_NOTATIONS: ReadonlySet<string> = new Set([
  'Approx',
  'ApproxEqual',
  'ApproxNotEqual',
  'NotApprox',
  'NotApproxEqual',
  'NotApproxNotEqual',
  'NotGreater',
  'NotGreaterNotEqual',
  'NotLess',
  'NotLessNotEqual',
  'NotPrecedes',
  'NotSubset',
  'NotSucceeds',
  'NotSuperset',
  'NotSupersetEqual',
  'NotTilde',
  'NotTildeEqual',
  'NotTildeFullEqual',
  'PlusMinus',
  'Precedes',
  'Succeeds',
  'Tilde',
  'TildeEqual',
  'TildeFullEqual',
]);

/**
 * Heads the engine produces for its own bookkeeping — error payloads,
 * protocol tables, signature values, the `Object` provenance head that wraps
 * the serialized snapshot of a mutable object (it is not a constructor) —
 * and the placeholder constants of the evaluator. They are not meant to be
 * written in a program.
 */
export const ENGINE_INTERNAL_NAMES: ReadonlySet<string> = new Set([
  'BuiltinFunction',
  'ContinuationPlaceholder',
  'ErrorCode',
  'Object',
  'Pin',
  'Predicate',
  'ProtocolMember',
  'ProtocolProperty',
  'RuntimeError',
  'Signature',
  'Subtype',
]);

/**
 * Constants that Epsil writes as literal words: `true`, `false`, `NaN`
 * (with `nan` naming the not-a-number TYPE), `Infinity` and `oo`.
 */
const LITERAL_CONSTANTS: ReadonlySet<string> = new Set([
  'True',
  'False',
  'NaN',
]);

const EPSIL_OPERATOR_NAMES: ReadonlySet<string> = new Set(
  OPERATORS.map((op) => op.name)
);

/**
 * The lowercase spelling of a capitalized name, by the rule alone (no
 * exclusions): lowercase the leading run of uppercase letters, and when that
 * run is followed by a lowercase letter keep the LAST letter of the run
 * uppercase, because it starts the next word. `Sin` → `sin`, `ArcSin` →
 * `arcSin`, `GCD` → `gcd`, `LUDecomposition` → `luDecomposition`,
 * `NDSolve` → `ndSolve`. A name that does not start with an uppercase
 * letter has no spelling.
 */
export function lowercaseSpelling(name: string): string | undefined {
  const m = /^([A-Z]+)(.*)$/s.exec(name);
  if (m === null) return undefined;
  const [, run, rest] = m;
  if (run.length === 1) return run.toLowerCase() + rest;
  if (/^[a-z]/.test(rest))
    return run.slice(0, -1).toLowerCase() + run.slice(-1) + rest;
  return run.toLowerCase() + rest;
}

/**
 * The Epsil spelling of a standard-library name, or `undefined` when the
 * name has none.
 *
 * A name has no spelling when it is a single letter (`D`, `N`: `d` and `n`
 * are variable names), when Epsil writes it as an operator symbol (`Add` is
 * `+`, `Pipe` is `|>`), when the spelling is a hard reserved word (`If`,
 * `Match`, `Function`), when the language has a syntax for it (the sets
 * above), or when the engine keeps it for itself.
 *
 * This is a rule over the NAME only; it does not check that the name exists
 * in the library. `canonicalLibraryName` is the checked reverse map.
 */
export function epsilNameOf(name: string): string | undefined {
  if (name.length <= 1) return undefined;
  const spelling = lowercaseSpelling(name);
  if (spelling === undefined) return undefined;
  if (EPSIL_OPERATOR_NAMES.has(name)) return undefined;
  if (HARD_RESERVED_WORDS.has(spelling)) return undefined;
  if (
    GRAMMAR_CONSTRUCTS.has(name) ||
    LITERAL_CONSTRUCTORS.has(name) ||
    RELATION_NOTATIONS.has(name) ||
    ENGINE_INTERNAL_NAMES.has(name) ||
    LITERAL_CONSTANTS.has(name)
  )
    return undefined;
  return spelling;
}

let reverseMap: Map<string, string> | undefined;

/**
 * Every standard-library name that has an Epsil spelling, keyed by the
 * spelling: `sin` → `Sin`, `pi` → `Pi`. Built once from the standard library
 * definitions (operators and constants alike); caller-authored libraries and
 * names declared later with `ce.declare` are not included, so the table is
 * the same for every engine.
 */
export function epsilLibraryNames(): ReadonlyMap<string, string> {
  if (reverseMap !== undefined) return reverseMap;
  const map = new Map<string, string>();
  for (const library of STANDARD_LIBRARIES) {
    const definitions = library.definitions;
    if (definitions === undefined) continue;
    const tables = Array.isArray(definitions) ? definitions : [definitions];
    for (const table of tables)
      for (const name of Object.keys(table)) {
        const spelling = epsilNameOf(name);
        if (spelling === undefined) continue;
        // Two library names with one spelling would make the spelling
        // ambiguous. The audit found none; a new operator that creates one
        // is a definition mistake, reported here and covered by the test.
        console.assert(
          !map.has(spelling) || map.get(spelling) === name,
          `Epsil spelling "${spelling}" names both "${map.get(spelling)}" and "${name}"`
        );
        map.set(spelling, name);
      }
  }
  reverseMap = map;
  return map;
}

/** The standard-library name an Epsil spelling stands for (`sin` → `Sin`,
 * `pi` → `Pi`), or `undefined` when the spelling names nothing. */
export function canonicalLibraryName(spelling: string): string | undefined {
  return epsilLibraryNames().get(spelling);
}
