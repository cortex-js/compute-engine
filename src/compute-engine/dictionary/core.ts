import type { Dictionary } from '../public';

export const CORE_DICTIONARY: Dictionary = {
  Apply: {
    domain: 'Function',
    range: 'Anything',
  },
  About: {
    domain: 'Function',
    range: 'Dictionary',
  },
  BaseForm: {
    domain: 'Function',
    range: 'Integer',
  },
  /** Create a local scope. First argument is a dictionary of local variables.
   * They are evaluated in the context of the parent scope. The second argument
   * is an expression to be evaluated in the context of the new scope.
   * ["Block", ["List", ["Equal", "x", 1]], [...]]
   */
  Block: {
    domain: 'Function',
    range: 'Anything',
  },
  /** Return the domain of an expression */
  Domain: {
    domain: 'ParametricDomain',
    range: 'Domain',
  },
  Evaluate: {
    domain: 'Function',
    range: 'Anything',
  },
  Parentheses: {
    domain: 'Function',
    threadable: true,
    pure: false,
    range: 'Anything',
  },
  Head: {
    domain: 'Function',
    range: 'Anything',
  },
  Lambda: {
    domain: 'Function',
    wikidata: 'Q567612',
    hold: 'all',
    range: 'Anything',
  },
  Latex: {
    domain: 'Function',
    range: 'String',
  },
  String: {
    domain: 'Function',
    threadable: true,
    range: 'String',
  },
  Symbol: {
    domain: 'Function',
    threadable: true,
    range: 'Symbol',
  },
  Tail: {
    domain: 'Function',
    range: 'List',
  },
  // Pattern: {},
};

// xcas/gias https://www-fourier.ujf-grenoble.fr/~parisse/giac/doc/en/cascmd_en/cascmd_en.html
// https://www.haskell.org/onlinereport/haskell2010/haskellch9.html#x16-1720009.1
// length(expr, depth:integer) (for a list, an expression, etc..)
// shape
// length
// depth

/*
 DICTIONARY
 aka Association in Wolfram, Dictionary in Python and Swift, Record in Maple,
 Map Containers in mathlab, Map in Javascript
 Dictionary("field1", "value1", "field2", "value2"...)
 Need a new atomic 'dict' MathJSON type?
  {dict: {"field1": "value1", "field2": "value2"}}
*/

// LISTS
// take(n, list) -> n first elements of the list
// https://www.mathworks.com/help/referencelist.html?type=function&listtype=cat&category=&blocktype=&capability=&s_tid=CRUX_lftnav        // list
// repeat(x) -> infinite list with "x" as argument
// cycle(list) -> infinitely repeating list, i.e. cycle({1, 2, 3}) -> {1, 2, 3, 1, 2, 3, 1...}
// iterate(f, acc) -> {f(acc), f(f(acc)), f(f(f(acc)))...}
// == NestList ??
// Append (python) / Push
// Insert(i, x)
// Pop(): remove last, Pop(i): remove item at [i]

// Range
// index
// Evaluate
// Bind // replace  ( x-> 1)
// Domain
// min, max
// None -- constant for some options
// rule ->
// delayed-rule: :> (value of replacement is recalculated each time)
// set, set delayed
// join
// convert(expr, CONVERT_TO, OPTIONS) -- See Maple
// convert(expr, options), with options such as 'cos', 'sin, 'trig, 'exp', 'ln', 'latex', 'string', etc...)
// N
// set, delayed-set
// spread -> expand the elements of a list. If inside a list, insert the list into its parent
// compose (compose(f, g) -> a new function such that compose(f, g)(x) -> f(g(x))

// Symbol(x) -> x as a symbol, e.g. symbol('x' + 'y') -> `xy` (and registers it)
// Symbols() -> return list of all known symbols
// variables() -> return list of all free variables
