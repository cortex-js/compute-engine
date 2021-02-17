import type { Dictionary } from '../public';

export const CORE_DICTIONARY: Dictionary = {
  BaseForm: {
    domain: 'Function',
    signatures: [
      {
        args: [
          ['value', 'Integer'],
          ['base', ['Integer', 2, 16]],
        ],
        result: 'Integer',
      },
    ],
  },
  Block: {
    /** Create a local scope. First argument is a dictionary of local variables.
     * They are evaluated in the context of the parent scope. The second argument
     * is an expression to be evaluated in the context of the new scope.
     * ["Block", ["List", ["Equal", "x", 1]], [...]]
     */
    domain: 'Function',
  },
  Domain: {
    /** Return the domain of an expression */
    domain: 'Function',
    signatures: [{ args: ['Expression'], result: 'Domain' }],
  },
  Evaluate: {
    domain: 'Function',
    signatures: [{ args: ['Expression'], result: 'Expression' }],
  },
  Group: {
    domain: 'Function',
    threadable: true,
    // To support `((a,b),(c,d))`, group is considered non associative
    // and non-idempotent
    pure: false,
    signatures: [{ rest: ['expressions', 'Expression'], result: 'Expression' }],
  },
  Lambda: {
    domain: 'Function',
    wikidata: 'Q567612',
    hold: 'all',
  },
  Latex: {
    domain: 'Function',
    signatures: [{ rest: ['tokens', 'String'], result: 'String' }],
  },
  String: {
    domain: 'Function',
    threadable: true,
    signatures: [{ rest: ['string', 'String'], result: 'String' }],
  },
  // Pattern: {},
};

// https://www.mathworks.com/help/referencelist.html?type=function&listtype=cat&category=&blocktype=&capability=&s_tid=CRUX_lftnav        // list
// xcas/gias https://www-fourier.ujf-grenoble.fr/~parisse/giac/doc/en/cascmd_en/cascmd_en.html
// https://www.haskell.org/onlinereport/haskell2010/haskellch9.html#x16-1720009.1
// length(expr, depth:integer) (for a list, an expression, etc..)
// apply(expr:symbol, arguments) -> [expr, ...arguments] (but symbol is an expression that's evaluated...)
// shape
// length
// depth

// take(n, list) -> n first elements of the list
// repeat(x) -> infinite list with "x" as argument
// cycle(list) -> infinitely repeating list, i.e. cycle({1, 2, 3}) -> {1, 2, 3, 1, 2, 3, 1...}
// iterate(f, acc) -> {f(acc), f(f(acc)), f(f(f(acc)))...}
// == NestList ??

// identity
// range
// index
// evaluate
// bind // replace  ( x-> 1)
// domain
// min, max
// Nothing  -- constants, ignored in lists
// None -- constant for some options
// rule ->
// delayed-rule: :> (value of replacement is recalculated each time)
// set, set delayed
// join
// convert(expr, CONVERT_TO, OPTIONS) -- See Maple
// N
// set, delayed-set
// spread -> expand the elements of a list. If inside a list, insert the list into its parent
// compose (compose(f, g) -> a new function such that compose(f, g)(x) -> f(g(x))
// convert(expr, options), with options such as 'cos', 'sin, 'trig, 'exp', 'ln', 'latex', 'string', etc...)

// symbol(x) -> x as a symbol, e.g. symbol('x' + 'y') -> `xy` (and registers it)
// symbols() -> return list of all known symbols
// variables() -> return list of all free variables
