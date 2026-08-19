import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import type { Type } from '../../src/common/type/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';
import { formatDiagnostics } from '../../src/cli/format';

//
// STATIC CALLBACK-ARITY CHECK (2026-08-15).
//
// Partial application is a designed feature of an ordinary positional call:
// `f(1)` on a two-parameter `f` yields a function awaiting the rest. Inside a
// collection operator it never is, because the OPERATOR decides how many
// arguments the callback receives — so a callback declaring more parameters
// than the operator supplies can never be applied, and the leftover closures
// it would produce are not what the author meant.
//
// Before this check the family disagreed about it, several members silently:
// `Map((p, q) => p + q, [1,2,3])` answered three closures typed `vector<3>`,
// `Sort(xs, (a, b, c) => a < b)` returned `xs` UNSORTED, `Fold` buried an
// `Error` inside a nested closure, `Filter`/`Any`/`All`/`FlatMap`/`TakeWhile`/
// `Reduce` stayed inert, and `Map(p => p, xs, ys)` threw `Too many arguments`
// only once something forced an element.
//
// The check lives in each operator's CANONICAL handler
// (`library/callback-arity.ts` + the wiring in `library/collections.ts`), so
// it fires on every route into the engine, and it DECLINES — never guesses —
// whenever the callback's parameter count is not statically readable.
//

const LIST: MathJsonExpression = ['List', 1, 2, 3];
/** `(p) => p > 1` — a unary predicate. */
const UNARY: MathJsonExpression = ['Function', ['Greater', 'p', 1], 'p'];
/** `(p, q) => p + q` — two parameters. */
const BINARY: MathJsonExpression = ['Function', ['Add', 'p', 'q'], 'p', 'q'];
/** `(a, b, c) => a < b` — three parameters. */
const TERNARY: MathJsonExpression = [
  'Function',
  ['Less', 'a', 'b'],
  'a',
  'b',
  'c',
];

/** `[(1, 2), (3, 4)]` — a source whose elements ARE pairs, so the
 * tuple-pattern hint applies to it (unlike the scalar `LIST`). */
const PAIRS: MathJsonExpression = [
  'List',
  ['Tuple', 1, 2],
  ['Tuple', 3, 4],
];

/** True when `expr` carries the `callback-arity` diagnostic. */
function hasArityError(expr: { toString(): string }): boolean {
  return expr.toString().includes('callback-arity');
}

/** True when `expr` carries the pipe's own `pipe-stage-arity` diagnostic —
 * a DIFFERENT code from `callback-arity`, since a pipe stage is not a
 * callback slot and its remedy is the call form, not a tuple pattern. */
function hasPipeArityError(expr: { toString(): string }): boolean {
  return expr.toString().includes('pipe-stage-arity');
}

describe('CALLBACK ARITY — the per-element family (1 argument supplied)', () => {
  // Every one of these applies its callback to ONE element at a time, so a
  // binary callback is refused and a unary one goes through untouched. Both
  // halves are asserted together: the second is the guard against the check
  // firing where it must not.
  test.each([
    'Any',
    'All',
    'Count',
    'CountIf',
    'Filter',
    'TakeWhile',
    'DropWhile',
    'FlatMap',
    'Find',
    'IndexWhere',
    'Position',
    'MaxBy',
    'MinBy',
    'ArgMax',
    'ArgMin',
    'GroupBy',
    'ChunkBy',
    'Partition',
  ])(
    '%s rejects a 2-parameter callback and accepts a 1-parameter one',
    (op) => {
      const ce = new ComputeEngine();
      const bad = ce.box([op, LIST, BINARY] as MathJsonExpression);
      expect(bad.type.toString()).toBe('error');
      expect(bad.toString()).toContain(
        `${op} calls its callback with 1 argument (each element of the collection); \`(p, q) => p + q\` declares 2 parameters`
      );

      const good = ce.box([op, LIST, UNARY] as MathJsonExpression);
      expect(hasArityError(good)).toBe(false);
      expect(good.type.toString()).not.toBe('error');
    }
  );

  test('Map over ONE source supplies one argument', () => {
    const ce = new ComputeEngine();
    const bad = ce.box(['Map', BINARY, LIST]);
    expect(bad.type.toString()).toBe('error');
    expect(bad.toString()).toContain(
      'Map calls its callback with 1 argument (each element of the collection); `(p, q) => p + q` declares 2 parameters'
    );
    // Before the check this evaluated to a list of three CLOSURES, statically
    // typed `vector<3>` — a type lie the error short-circuits.
    expect(bad.evaluate().type.toString()).toBe('error');

    expect(ce.box(['Map', UNARY, LIST]).evaluate().toString()).toBe(
      '["False","True","True"]'
    );
  });

  test('the tuple-pattern hint rides on the 1-supplied / 2-declared case', () => {
    // The commonest way to reach this error is a callback that expects the
    // element to arrive already taken apart. The language spells that with a
    // tuple pattern parameter, which is ONE parameter.
    const ce = new ComputeEngine();
    expect(ce.box(['Map', BINARY, PAIRS]).toString()).toContain(
      'To take a pair apart, use a tuple pattern parameter: ((p, q)) => …'
    );
    // …and nowhere else: `Tabulate`'s single argument is an integer index,
    // which cannot be destructured.
    const tabulate = ce.box(['Tabulate', BINARY, 3]);
    expect(hasArityError(tabulate)).toBe(true);
    expect(tabulate.toString()).not.toContain('tuple pattern');
  });

  test('the hint is gated on the ELEMENT TYPE, not on the shape alone', () => {
    // A hint that names a rewrite which cannot work is worse than no hint.
    // The arity error itself is a fact about the callback and always stands;
    // only the suggested fix depends on what the elements actually are.
    const ce = new ComputeEngine();

    // Elements are NUMBERS — there is nothing to take apart, so no hint.
    const scalars = ce.box(['Map', BINARY, LIST]);
    expect(hasArityError(scalars)).toBe(true);
    expect(scalars.toString()).not.toContain('tuple pattern');

    // Elements are pairs but the callback declares THREE parameters, so
    // `((a, b, c)) => …` would not fit them either.
    const wrongWidth = ce.box(['Map', TERNARY, PAIRS]);
    expect(hasArityError(wrongWidth)).toBe(true);
    expect(wrongWidth.toString()).not.toContain('tuple pattern');

    // An element type that is not statically known is not a guess to make —
    // and the error itself still fires, which is what makes this a real
    // assertion about the hint rather than about the check declining.
    ce.declare('unknownXs', 'collection');
    const opaque = ce.box(['Map', BINARY, 'unknownXs']);
    expect(hasArityError(opaque)).toBe(true);
    expect(opaque.toString()).not.toContain('tuple pattern');
  });

  // The gate reads the SOURCE's element type, so every operator must hand it a
  // source that HAS one. A `lazy: true` operator's operands arrive unbound,
  // where the type reads `unknown`, so passing the raw `ops[i]` silently cost
  // the hint — `MaxBy`/`MinBy`/`ArgMax`/`ArgMin` lost it even for an inline
  // literal, while `Filter` happened to keep it because its generic
  // `collection<T>` signature had already bound the operand. The handlers pass
  // the canonicalized collection instead. This sweeps the whole family so a
  // new operator wired to `PER_ELEMENT_SUPPLY` cannot quietly repeat it.
  test.each([
    'Any',
    'All',
    'Count',
    'CountIf',
    'Filter',
    'TakeWhile',
    'DropWhile',
    'FlatMap',
    'Find',
    'IndexWhere',
    'Position',
    'MaxBy',
    'MinBy',
    'ArgMax',
    'ArgMin',
    'GroupBy',
    'ChunkBy',
    'Partition',
  ])('%s offers the hint over a tuple-element source', (op) => {
    const ce = new ComputeEngine();
    expect(
      ce.box([op, PAIRS, BINARY] as MathJsonExpression).toString()
    ).toContain('use a tuple pattern parameter: ((p, q)) => …');
  });

  test('the hint survives a SYMBOL source with a declared tuple element type', () => {
    // The everyday spelling is a variable, not an inline literal. A lazy
    // operator holds that symbol unbound, so this is the case the raw-operand
    // bug above hid behind: the declared element type is right there, and the
    // hint must reach it.
    const ce = new ComputeEngine();
    ce.declare('pairsXs', 'list<tuple<integer, integer>>');
    for (const expr of [
      ce.box(['Map', BINARY, 'pairsXs']),
      ce.box(['Filter', 'pairsXs', BINARY]),
      ce.box(['MaxBy', 'pairsXs', BINARY]),
    ]) {
      expect(hasArityError(expr)).toBe(true);
      expect(expr.toString()).toContain(
        'use a tuple pattern parameter: ((p, q)) => …'
      );
    }
  });

  test('the hint is actionable — the suggested rewrite works', () => {
    // A tuple pattern is ONE parameter, so it fits the slot and destructures
    // the element. Written out, this is the fix the diagnostic proposes.
    const ce = new ComputeEngine();
    const result = executeEpsil(
      ce,
      'let pairs = [(1,2),(3,4)]\nMap(((p, q)) => p + q, pairs)',
      { parseLatex: (latex: string) => ce.parse(latex).json }
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value.toString()).toBe('[3,7]');
    // The two-parameter spelling of the same intent is the error.
    expect(
      executeEpsil(ce, 'Map((p, q) => p + q, [(1,2),(3,4)])', {
        parseLatex: (latex: string) => ce.parse(latex).json,
      }).value.toString()
    ).toContain('callback-arity');
  });
});

describe('CALLBACK ARITY — the accumulating family (2 arguments supplied)', () => {
  test('Reduce rejects a 3-parameter reducer and accepts a binary one', () => {
    const ce = new ComputeEngine();
    const bad = ce.box(['Reduce', LIST, TERNARY, 0]);
    expect(bad.type.toString()).toBe('error');
    expect(bad.toString()).toContain(
      'Reduce calls its callback with 2 arguments (the accumulator and the current element); `(a, b, c) => a < b` declares 3 parameters'
    );
    expect(
      ce
        .box(['Reduce', LIST, ['Function', ['Add', 'a', 'b'], 'a', 'b'], 0])
        .evaluate()
        .toString()
    ).toBe('6');
  });

  test('Reduce rejects a UNARY reducer too (too few parameters)', () => {
    const ce = new ComputeEngine();
    const bad = ce.box(['Reduce', LIST, UNARY, 0]);
    expect(bad.type.toString()).toBe('error');
    expect(bad.toString()).toContain('`(p) => 1 < p` declares 1 parameter');
  });

  test('Scan rejects a 3-parameter reducer and accepts a binary one', () => {
    const ce = new ComputeEngine();
    const bad = ce.box(['Scan', LIST, TERNARY, 0]);
    expect(bad.type.toString()).toBe('error');
    expect(bad.toString()).toContain(
      'Scan calls its callback with 2 arguments (the accumulator and the current element)'
    );
    expect(
      ce
        .box(['Scan', LIST, ['Function', ['Add', 'a', 'b'], 'a', 'b'], 0])
        .evaluate()
        .toString()
    ).toBe('[1,3,6]');
  });

  test('Fold (callback-first) rejects a 3-parameter reducer', () => {
    const ce = new ComputeEngine();
    const bad = ce.box(['Fold', TERNARY, 0, LIST]);
    expect(bad.type.toString()).toBe('error');
    expect(bad.toString()).toContain(
      'Fold calls its callback with 2 arguments (the accumulator and the current element); `(a, b, c) => a < b` declares 3 parameters'
    );
    // Before the check this produced a nested closure with an `Error` buried
    // inside it, and typed `number`.
    expect(
      ce
        .box(['Fold', ['Function', ['Add', 'a', 'b'], 'a', 'b'], 0, LIST])
        .evaluate()
        .toString()
    ).toBe('6');
  });

  test('Fill supplies the row and column indexes', () => {
    const ce = new ComputeEngine();
    const bad = ce.box(['Fill', UNARY, ['Tuple', 2, 2]]);
    expect(bad.type.toString()).toBe('error');
    expect(bad.toString()).toContain(
      'Fill calls its callback with 2 arguments (the 1-based row and column indexes of the cell); `(p) => 1 < p` declares 1 parameter'
    );
    const good = ce.box([
      'Fill',
      ['Function', ['Add', 'i', 'j'], 'i', 'j'],
      ['Tuple', 2, 2],
    ]);
    expect(good.evaluate().toString()).toBe('[[2,3],[3,4]]');
  });
});

describe('CALLBACK ARITY — a supply count that depends on the call', () => {
  test('Map(f, xs, ys) supplies one element from EACH source', () => {
    const ce = new ComputeEngine();
    // Too FEW parameters. Before the check this threw
    // `Too many arguments for function "(p) => p"` — at evaluation, on every
    // materializing route, never statically.
    const bad = ce.box([
      'Map',
      ['Function', 'p', 'p'],
      LIST,
      ['List', 4, 5, 6],
    ]);
    expect(bad.type.toString()).toBe('error');
    expect(bad.toString()).toContain(
      'Map calls its callback with 2 arguments (one element from each of the 2 collections); `(p) => p` declares 1 parameter'
    );
    expect(() => bad.at(1)).not.toThrow();

    // The matching arity is the zipWith success path.
    expect(
      ce
        .box(['Map', BINARY, LIST, ['List', 4, 5, 6]])
        .evaluate()
        .toString()
    ).toBe('[5,7,9]');
  });

  test('Map with three sources reports three arguments', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Map', BINARY, LIST, LIST, LIST]).toString()).toContain(
      'Map calls its callback with 3 arguments (one element from each of the 3 collections); `(p, q) => p + q` declares 2 parameters'
    );
  });

  test('Tabulate supplies one index per dimension', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Tabulate', BINARY, 3]).toString()).toContain(
      'Tabulate calls its callback with 1 argument (the 1-based index of the element); `(p, q) => p + q` declares 2 parameters'
    );
    // Two dimensions: the binary generator is exactly right, the unary one is
    // now short.
    expect(hasArityError(ce.box(['Tabulate', BINARY, 2, 2]))).toBe(false);
    expect(ce.box(['Tabulate', UNARY, 2, 2]).toString()).toContain(
      'Tabulate calls its callback with 2 arguments (the 2 1-based indexes of the element, one per dimension); `(p) => 1 < p` declares 1 parameter'
    );
  });
});

describe('CALLBACK ARITY — the MODE-SELECTOR operators accept either arity', () => {
  // `Sort`/`Ordering` read a unary callback as a sort KEY and a binary one as
  // a COMPARATOR (see `sortedIndices`); `Iterate` applies a unary function to
  // the accumulator alone and a binary one to `(index, accumulator)` (see
  // `iterateArgs`). Both arities are by design, so only a callback matching
  // NEITHER is an error.
  test('Sort takes a unary key or a binary comparator, and rejects a ternary', () => {
    const ce = new ComputeEngine();
    // Before the check this returned the input UNSORTED, with no error at all.
    const bad = ce.box(['Sort', ['List', 3, 1, 2], TERNARY]);
    expect(bad.type.toString()).toBe('error');
    expect(bad.toString()).toContain(
      'Sort calls its callback with 1 argument (a sort key for one element) or 2 arguments (the two elements being compared); `(a, b, c) => a < b` declares 3 parameters'
    );

    // Key form (unary) and comparator form (binary) both still work.
    expect(
      ce
        .box(['Sort', ['List', 3, 1, 2], ['Function', ['Negate', 'a'], 'a']])
        .evaluate()
        .toString()
    ).toBe('[3,2,1]');
    expect(
      ce
        .box([
          'Sort',
          ['List', 3, 1, 2],
          ['Function', ['Less', 'a', 'b'], 'a', 'b'],
        ])
        .evaluate()
        .toString()
    ).toBe('[1,2,3]');
  });

  test('Ordering takes either arity too', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Ordering', LIST, TERNARY]).type.toString()).toBe('error');
    expect(hasArityError(ce.box(['Ordering', LIST, UNARY]))).toBe(false);
    expect(
      hasArityError(
        ce.box(['Ordering', LIST, ['Function', ['Less', 'a', 'b'], 'a', 'b']])
      )
    ).toBe(false);
  });

  test('Iterate takes f(previous) or f(index, previous)', () => {
    const ce = new ComputeEngine();
    const bad = ce.box(['Iterate', TERNARY, 1]);
    expect(bad.type.toString()).toBe('error');
    expect(bad.toString()).toContain(
      'Iterate calls its callback with 1 argument (the previous value) or 2 arguments (the 1-based index and the previous value); `(a, b, c) => a < b` declares 3 parameters'
    );
    // The documented unary shorthand `Iterate(2 * _, 1)` and the declared
    // two-argument contract both stay admissible.
    expect(
      ce
        .box([
          'Take',
          ['Iterate', ['Function', ['Multiply', 2, 'a'], 'a'], 1],
          4,
        ])
        .evaluate()
        .toString()
    ).toBe('[2,4,8,16]');
    expect(
      hasArityError(
        ce.box(['Iterate', ['Function', ['Add', 'n', 'acc'], 'n', 'acc'], 1])
      )
    ).toBe(false);
  });
});

describe('CALLBACK ARITY — the check DECLINES when the arity is not readable', () => {
  // Every one of these pairs an undecidable operand (which must go through
  // untouched) with a decidable one (which must be caught), so the test as a
  // whole fails without the check as well as with a check that over-fires.
  test('a NULLARY literal is a constant callback and is never an arity error', () => {
    // Applying `["Function", 42]` ignores every argument (the historical
    // contract in `function-utils.ts` `invoke`), which is what lets a constant
    // stand in for a predicate or a generator. `timeout.test.ts` relies on it
    // (`CountIf(Range(100), () => True)` counts 100); Map/Iterate/Fill do too.
    const ce = new ComputeEngine();
    const TRUE: MathJsonExpression = ['Function', 'True'];
    expect(hasArityError(ce.box(['CountIf', ['Range', 100], TRUE]))).toBe(
      false
    );
    expect(ce.box(['CountIf', ['Range', 100], TRUE]).evaluate().re).toBe(100);
    expect(
      ce
        .box(['Map', ['Function', 7], LIST])
        .evaluate()
        .toString()
    ).toBe('[7,7,7]');
    expect(
      hasArityError(ce.box(['Fill', ['Function', 0], ['Tuple', 2, 2]]))
    ).toBe(false);
    // …while a unary literal at a two-argument slot is still caught.
    expect(hasArityError(ce.box(['Fill', UNARY, ['Tuple', 2, 2]]))).toBe(true);
  });

  test('a bare `function`-typed symbol declines; a bound binary lambda is checked', () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    // The `function` wildcard promises callers nothing about arity.
    expect(hasArityError(ce.box(['Map', 'f', LIST]))).toBe(false);

    ce.assign('g', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b']));
    expect(ce.box(['Map', 'g', LIST]).toString()).toContain(
      'Map calls its callback with 1 argument (each element of the collection); `g` declares 2 parameters'
    );
    // A multi-character name is spelled by its NAME, not by the ASCII-math
    // rendering (which double-quotes it: `"plusTail"`).
    ce.declare('plusTail', '(number, number) -> number');
    expect(ce.box(['Map', 'plusTail', LIST]).toString()).toContain(
      '`plusTail` declares 2 parameters'
    );
  });

  test('the retired `callback<…>` spelling fails to parse; a plain arrow is checked', () => {
    const ce = new ComputeEngine();
    // Design E §7 (`docs/TYPE-SYSTEM.md`):
    // the constructor is gone from the type grammar, with a migration hint.
    expect(() =>
      ce.declare('cb', 'callback<(number, number) -> boolean>')
    ).toThrow(/retired: write the arrow directly/);

    ce.declare('h', '(number, number) -> boolean');
    expect(ce.box(['Filter', LIST, 'h']).toString()).toContain(
      'Filter calls its callback with 1 argument (each element of the collection); `h` declares 2 parameters'
    );
  });

  test('a GENERIC signature declines; its monomorphic twin is checked', () => {
    const ce = new ComputeEngine();
    // A generic arity is a pattern until the signature is instantiated.
    ce.declare('gen', '(T, T) -> boolean where T');
    expect(hasArityError(ce.box(['Filter', LIST, 'gen']))).toBe(false);

    ce.declare('mono', '(number, number) -> boolean');
    expect(hasArityError(ce.box(['Filter', LIST, 'mono']))).toBe(true);
  });

  test('a VARIADIC signature that admits one argument declines', () => {
    const ce = new ComputeEngine();
    ce.declare('v', '(number+) -> number');
    // `(number+)` accepts one argument, so `Map`'s single element fits.
    expect(hasArityError(ce.box(['Map', 'v', LIST]))).toBe(false);
    // …and it does NOT decline for a slot it provably cannot fill.
    ce.declare('w', '(number, number, number+) -> number');
    expect(ce.box(['Map', 'w', LIST]).toString()).toContain(
      '`w` requires at least 3 parameters'
    );
  });

  test('a signature mixing an OPTIONAL parameter with a `+` tail is not declarable', () => {
    const ce = new ComputeEngine();
    // `(number, number?, number+)` has no meaning to give: argument validation
    // fills every optional slot before it feeds the variadic parameter, so the
    // optional slot is not optional at all. The type-string grammar has always
    // refused the combination; since 2026-08-15 the type-OBJECT route refuses
    // it too, on the same rule, so a type that serializes to a string the
    // parser cannot read back can no longer be declared.
    const PLUS_TAIL: Type = {
      kind: 'signature',
      args: [{ type: 'number' }],
      optArgs: [{ type: 'number' }],
      variadicArg: { type: 'number' },
      variadicMin: 1,
      result: 'number',
    };
    expect(() => ce.declare('q', PLUS_TAIL)).toThrow(
      'Variadic arguments cannot be used with optional arguments'
    );
    expect(() =>
      ce.declare('q2', '(number, number?, number+) -> number')
    ).toThrow('Variadic arguments cannot be used with optional arguments');

    // A `*` tail imposes no minimum of its own, so one required parameter is
    // the whole minimum and `Reduce`'s two arguments fit.
    ce.declare('u', '(number, number*) -> number');
    expect(hasArityError(ce.box(['Reduce', LIST, 'u', 0]))).toBe(false);

    // An optional parameter with no variadic tail widens the MAXIMUM: two
    // arguments fit `(number, number?)`, at any of the slots that supply them.
    ce.declare('z', '(number, number?) -> number');
    expect(hasArityError(ce.box(['Reduce', LIST, 'z', 0]))).toBe(false);
    expect(hasArityError(ce.box(['Fill', 'z', ['Tuple', 2, 2]]))).toBe(false);
    // …and one argument still fits it, since the optional slot may go unfilled.
    expect(hasArityError(ce.box(['Map', 'z', LIST]))).toBe(false);
  });

  test('an UNDECLARED forward reference declines; a declared one is checked', () => {
    const ce = new ComputeEngine();
    // Nothing is known about the name yet — the forward-reference contract.
    expect(hasArityError(ce.box(['Filter', LIST, 'later']))).toBe(false);

    ce.declare('now', '(number, number) -> boolean');
    expect(hasArityError(ce.box(['Filter', LIST, 'now']))).toBe(true);
  });

  test('an ordinary call still CURRIES — only callback slots are checked', () => {
    // Partial application is a designed feature of positional calls, and the
    // check must not have leaked into `apply()`.
    const ce = new ComputeEngine();
    ce.assign('add', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b']));
    const curried = ce.box(['add', 1]).evaluate();
    expect(curried.type.toString()).toBe('(unknown) -> number');
    expect(hasArityError(curried)).toBe(false);
    // The same callback at a callback slot is refused.
    expect(hasArityError(ce.box(['Filter', LIST, 'add']))).toBe(true);
  });
});

describe('CALLBACK ARITY — the pipe stage (1 argument supplied)', () => {
  // `x |> f` hands its stage exactly one value, so the same reasoning that
  // wires the collection operators covers it: a stage declaring more
  // parameters than that can never be applied. Before this, `Pipe` fell
  // through to `apply()` and silently CURRIED — the pipe answered a residual
  // closure with no diagnostic at all, which is never what the author meant
  // in a pipeline. The documented spelling for a multi-argument stage is a
  // CALL with `_` in the piped value's slot (`src/epsil/docs/operators.md`).
  const PIPE_MESSAGE = 'A pipe passes its stage exactly 1 value';
  /** The remedy a pipe points at — the CALL form, not a tuple pattern. */
  const PIPE_REMEDY =
    "A stage that takes several arguments is written as a call, with `_` in the piped value's slot";

  const epsil = (source: string) => {
    const ce = new ComputeEngine();
    return executeEpsil(ce, source, {
      parseLatex: (latex: string) => ce.parse(latex).json,
    });
  };

  test('a multi-parameter lambda stage is refused, not curried', () => {
    const ce = new ComputeEngine();
    const bad = ce.box(['Pipe', LIST, BINARY]);
    expect(bad.toString()).toContain(
      `${PIPE_MESSAGE}; \`(p, q) => p + q\` declares 2 parameters`
    );
    expect(bad.evaluate().type.toString()).toBe('error');

    const worse = ce.box(['Pipe', LIST, TERNARY]);
    expect(worse.toString()).toContain('declares 3 parameters');

    // The unary stage still maps, and the nullary constant is never an error
    // (it ignores every argument — the `callbackArity` exception).
    expect(hasPipeArityError(ce.box(['Pipe', LIST, UNARY]))).toBe(false);
    expect(ce.box(['Pipe', LIST, UNARY]).evaluate().toString()).toBe(
      '["False","True","True"]'
    );
    expect(hasPipeArityError(ce.box(['Pipe', LIST, ['Function', 5]]))).toBe(
      false
    );
  });

  test('it is NOT the callback-arity error — different code, different remedy', () => {
    // A pipe stage is not an operator-owned callback slot: `x |> f` is an
    // application whose argument is written to the left. Calling it a
    // "callback" describes a mechanism the language does not have at this
    // spelling, and the fix is the call form rather than a tuple pattern —
    // which the canonical handler could not honestly suggest anyway, since
    // the topic is a HELD operand whose element type it cannot read.
    const ce = new ComputeEngine();
    const bad = ce.box(['Pipe', LIST, BINARY]);
    expect(hasPipeArityError(bad)).toBe(true);
    expect(hasArityError(bad)).toBe(false);
    expect(bad.toString()).toContain(PIPE_REMEDY);
    expect(bad.toString()).not.toContain('tuple pattern');

    // Even over a collection of pairs, where a tuple pattern WOULD work, the
    // pipe points at the call form and leaves the rewrite to the explanation.
    const overPairs = ce.box(['Pipe', PAIRS, BINARY]);
    expect(hasPipeArityError(overPairs)).toBe(true);
    expect(overPairs.toString()).not.toContain('tuple pattern');
  });

  test('the Epsil route reports it, and the tuple-pattern rewrite still works', () => {
    const table = '[(True, True), (True, False), (False, True), (False, False)]';
    const bad = epsil(`${table} |> (p, q) => p && q`);
    const messages = bad.diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message.join(' | ') : String(d.message)
    );
    expect(messages.some((m) => m.includes(PIPE_MESSAGE))).toBe(true);
    expect(messages.some((m) => m.includes('pipe-stage-arity'))).toBe(true);

    // The rewrite the explanation names is the working spelling of the intent.
    const fixed = epsil(`${table} |> ((p, q)) => p && q`);
    expect(fixed.diagnostics).toEqual([]);
    expect(fixed.value.toString()).toBe('["True","False","False","False"]');
  });

  test('a NAMED multi-parameter stage is refused too', () => {
    // `5 |> add` on a binary `add` produced a partial application. A named
    // stage "always receives the whole value" per the pipe documentation, so
    // there is no arity for it to curry into here either.
    const ce = new ComputeEngine();
    ce.declare('add2', '(number, number) -> number');
    expect(hasPipeArityError(ce.box(['Pipe', 5, 'add2']))).toBe(true);
    // A stage that ACCEPTS one argument is untouched, whatever else it takes:
    // an optional or `*`-variadic tail still admits a single-argument call.
    ce.declare('opt', '(number, number?) -> number');
    ce.declare('vararg', '(number*) -> number');
    expect(hasPipeArityError(ce.box(['Pipe', 5, 'opt']))).toBe(false);
    expect(hasPipeArityError(ce.box(['Pipe', 5, 'vararg']))).toBe(false);
  });

  test('the pipe stage forms that must NOT be touched still work', () => {
    // Each of these is a documented pipe spelling; none may be refused.
    expect(epsil('[3, 1, 2] |> Sort |> Reverse').value.toString()).toBe(
      '[3,2,1]'
    );
    // A CALL stage — the documented way to write a multi-argument stage —
    // is not a callback operand and is never arity-checked here.
    expect(
      epsil(
        '1..10 |> Filter(_, n => n % 2 == 1) |> Map(n => n^2, _) |> Sum'
      ).value.toString()
    ).toBe('165');
    expect(epsil('[1,2,3] |> Take(2)').value.toString()).toBe('[1,2]');
    expect(epsil('[1,2,3] |> Map(n => n^2)').value.toString()).toBe('[1,4,9]');
    // The placeholder shorthand is a nullary literal until canonicalization
    // supplies its parameter, so the check must not read it as arity 0-that-errors.
    expect(epsil('[1,2,3] |> _^2').value.toString()).toBe('[1,4,9]');
    // An undeclared stage still defers to a definition that may yet arrive.
    const ce = new ComputeEngine();
    expect(hasPipeArityError(ce.box(['Pipe', 5, 'notYetDefined']))).toBe(false);
  });
});

describe('CALLBACK ARITY — every route into the engine', () => {
  // The lazy-operator trap (CLAUDE.md): a `lazy: true` operator holds its
  // operands RAW, so a check that only works through `ce.function(pre-boxed)`
  // misses the `ce.box` and parse routes entirely. `Map` is lazy, `Filter` is
  // lazy, and both are probed on all four routes.
  const MESSAGE_MAP =
    'Map calls its callback with 1 argument (each element of the collection); `(p, q) => p + q` declares 2 parameters';
  const MESSAGE_FILTER =
    'Filter calls its callback with 1 argument (each element of the collection); `(p, q) => p + q` declares 2 parameters';

  test('the MathJSON box route', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Map', BINARY, LIST]).toString()).toContain(MESSAGE_MAP);
    expect(ce.box(['Filter', LIST, BINARY]).toString()).toContain(
      MESSAGE_FILTER
    );
  });

  test('the ce.function route (pre-boxed operands)', () => {
    const ce = new ComputeEngine();
    const fn = ce.box(BINARY);
    const xs = ce.box(LIST);
    expect(ce.function('Map', [fn, xs]).toString()).toContain(MESSAGE_MAP);
    expect(ce.function('Filter', [xs, fn]).toString()).toContain(
      MESSAGE_FILTER
    );
  });

  test('the LaTeX parse route', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .parse(
          '\\operatorname{Map}((p, q) \\mapsto p+q, \\lbrack 1,2,3\\rbrack)'
        )
        .toString()
    ).toContain(MESSAGE_MAP);
    expect(
      ce
        .parse(
          '\\operatorname{Filter}(\\lbrack 1,2,3\\rbrack, (p, q) \\mapsto p+q)'
        )
        .toString()
    ).toContain(MESSAGE_FILTER);
  });

  test('the Epsil route — a runtime diagnostic with the call located', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(
      ce,
      'let xs = [1,2,3]\nlet r = Map((p, q) => p + q, xs)\nr',
      { parseLatex: (latex: string) => ce.parse(latex).json }
    );
    const messages = result.diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message.join(' | ') : String(d.message)
    );
    expect(messages.some((m) => m.includes(MESSAGE_MAP))).toBe(true);
    expect(messages.some((m) => m.includes('callback-arity'))).toBe(true);
  });
});

describe('CALLBACK ARITY — the Epsil static tier and its rendering', () => {
  const run = (source: string) => {
    const ce = new ComputeEngine();
    const [ast] = parseEpsil(source);
    return staticDiagnostics(ce, ast!, source);
  };

  test('`epsil check` reports it before anything runs', () => {
    const diagnostics = run('Map((p, q) => p + q, [1,2,3])');
    expect(diagnostics).toHaveLength(1);
    const [code, description, , engineCode] = diagnostics[0]
      .message as string[];
    expect(code).toBe('static-type-error');
    expect(engineCode).toBe('callback-arity');
    expect(description).toContain(
      'Map calls its callback with 1 argument (each element of the collection)'
    );
  });

  test('the anchor narrows onto the callback, not the whole statement', () => {
    const source =
      'let pairs = [(1,2),(3,4)]\nlet r = Map((p, q) => p + q, pairs)';
    const diagnostics = run(source);
    expect(diagnostics).toHaveLength(1);
    const [from, to] = diagnostics[0].range;
    expect(source.slice(from, to)).toBe('(p, q) => p + q');
  });

  test('the CLI renders a readable block with the `epsil doc` footer', () => {
    const source = 'let r = Sort([3,1,2], (a, b, c) => a < b)';
    const rendered = formatDiagnostics(
      run(source) as never,
      source,
      undefined,
      false
    );
    expect(rendered).toContain(
      'Sort calls its callback with 1 argument (a sort key for one element) or 2 arguments (the two elements being compared)'
    );
    // The location line, the underlined span, and the extended-doc pointer
    // (`callback-arity` has an `ERROR_EXPLANATIONS` entry, so the footer is
    // never a dead-end reference).
    expect(rendered).toContain(' --> 1:23');
    expect(rendered).toContain('^^^^^^^^^^^^^^^^^');
    expect(rendered).toContain(
      '`epsil doc callback-arity` explains this error'
    );
  });
});
