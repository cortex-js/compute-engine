import {
  getNumberValue,
  getStringValue,
  getSymbolName,
} from '../../common/utils';
import { Expression } from '../../math-json';
import type {
  ComputeEngine,
  Dictionary,
  Domain,
} from '../../math-json/compute-engine-interface';
import { joinLatex } from '../../math-json/core/tokenizer';
import { serializeLatex } from '../../math-json/definitions-core';

export const CORE_DICTIONARY: Dictionary = {
  Apply: {
    domain: 'Function',
    evalDomain: () => 'Anything',
  },
  About: {
    domain: 'Function',
    evalDomain: () => 'Dictionary',
  },
  BaseForm: {
    domain: 'Function',
    evalDomain: () => 'Integer',
  },
  /** Create a local scope. First argument is a dictionary of local variables.
   * They are evaluated in the context of the parent scope. The second argument
   * is an expression to be evaluated in the context of the new scope.
   * ["Block", ["List", ["Equal", "x", 1]], [...]]
   */
  Block: {
    domain: 'Function',
    evalDomain: () => 'Anything',
  },
  Delimiter: {
    domain: 'Function',
    evalDomain: (ce, arg: Expression) => ce.domain(arg),
    evaluate: (_ce: ComputeEngine, arg: Expression) => arg,
  },
  /** Return the domain of an expression */
  Domain: {
    domain: 'ParametricDomain',
    evalDomain: () => 'Domain',
  },
  Evaluate: {
    domain: 'Function',
    hold: 'all',
    evalDomain: () => 'Anything',
  },
  Error: {
    domain: 'Function',
    hold: 'all',
    evalDomain: () => 'Anything',
    /* Inert function. The first argument is typically a `LatexString` or 
      `LatexTokens` representing a parsing error. 
    */
  },
  Head: {
    domain: 'Function',
    evalDomain: (_ce, _arg: Domain) => 'Expression',
  },
  Html: {
    domain: 'Function',
    evalDomain: () => 'String',
    evaluate: (ce: ComputeEngine, ...args: Expression[]): Expression => {
      if (args.length === 0) return { str: '' };
      // @todo if head(arg[0]) === 'LatexString', call MathLive renderToMarkup()
      return { str: '' };
    },
  },
  Lambda: {
    domain: 'Function',
    wikidata: 'Q567612',
    hold: 'all',
    evalDomain: () => 'Anything',
  },
  Latex: {
    domain: 'Function',
    evalDomain: () => 'Function',
    evaluate: (ce: ComputeEngine, ...args: Expression[]): Expression => {
      if (args.length === 0) return ['LatexString'];
      return [
        'LatexString',
        { str: joinLatex(args.map((x) => ce.serialize(x))) },
      ];
    },
  },
  LatexString: {
    domain: 'Function',
    evalDomain: () => 'Function',
    evaluate: (ce: ComputeEngine, ...args: Expression[]): Expression => {
      if (args.length === 0) return ['LatexString'];
      return [
        'LatexString',
        joinLatex(args.map((x) => serializeLatex(ce.serializer, x))),
      ];
    },
  },
  LatexTokens: {
    domain: 'Function',
    evalDomain: () => 'Function',
    evaluate: (ce: ComputeEngine, ...args: Expression[]): Expression => {
      if (args.length === 0) return ['LatexString'];
      return [
        'LatexString',
        joinLatex(args.map((x) => serializeLatex(ce.serializer, x))),
      ];
    },
  },
  Parse: {
    domain: 'Function',
    evalDomain: () => 'Anything',
    evaluate: (ce: ComputeEngine, ...args: Expression[]): Expression => {
      if (args.length === 0) return 'Nothing';
      const latex = joinLatex(
        args.map((x) => serializeLatex(ce.serializer, x))
      );
      return ce.parse(latex);
    },
  },
  String: {
    domain: 'Function',
    threadable: true,
    evalDomain: () => 'String',
    evaluate: (ce: ComputeEngine, ...args: Expression[]): Expression => {
      if (args.length === 0) return { str: '' };
      return {
        str: args
          .map((x) => {
            const strValue = getStringValue(x);
            if (x !== null) return strValue;
            const numValue = getNumberValue(x);
            if (numValue !== null) return numValue.toString();
            return JSON.stringify(ce.format(x, 'json'));
          })
          .join(''),
      };
    },
  },
  Style: {
    domain: 'Function',
    evalDomain: (ce: ComputeEngine, expr: Domain) => expr,
    // @todo: simplify: merge Style(Style(x, s1), s2),  Style(x) -> x
    evaluate: (
      _ce: ComputeEngine,
      expr: Expression,
      _dic: Expression
    ): Expression => expr,
  },
  Symbol: {
    domain: 'Function',
    threadable: true,
    evalDomain: () => 'Symbol',
    evaluate: (_ce: ComputeEngine, ...args: Expression[]): Expression => {
      if (args.length === 0) return 'Nothing';
      const arg = args
        .map((x) => {
          const symName = getSymbolName(x);
          if (symName !== null) return symName;

          const stringValue = getStringValue(arg);
          if (stringValue !== null) return stringValue;

          const numValue = getNumberValue(arg);
          if (numValue !== null) return numValue.toString();

          return '';
        })
        .join('');

      if (arg.length > 0) return { sym: arg };

      return 'Nothing';
    },
  },
  Tail: {
    domain: 'Function',
    evalDomain: () => 'List',
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
