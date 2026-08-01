import { ComputeEngine } from '../../src/compute-engine';
import { executeCortex } from '../../src/cortex/execute-cortex';

import type { MathJsonExpression } from '../../src/math-json/types';
import {
  errorFrames,
  errorWhere,
} from '../../src/compute-engine/boxed-expression/error-value';

/**
 * Rungs 1 and 2 of the error-propagation design
 * (`docs/plans/2026-07-31-error-propagation-design.md`), plus the `Nothing`
 * route-parity ruling (§4).
 *
 * - **Rung 1** — `Match` DECIDES on an error subject (it is the rescue
 *   construct), and the new `IsError` predicate observes one.
 * - **Rung 2** — a FUNCTION APPLICATION whose strict argument is, or embeds,
 *   an `Error` evaluates to that error: `f(err)`, `Apply(f, err)` and
 *   `err |> f` all yield the bare error and never run the body.
 * - **Rung 3** — an OPERATOR bubbles too (`err + 1` → err, `Sin(err)` → err),
 *   and the bubbled error carries a BREADCRUMB of `(operator, operand index)`
 *   frames (§2a). Two carve-outs: a COLLECTION head freezes with the failed
 *   cell in place, and the `inspectsErrors` observers still run.
 */

/** A fresh engine with a call counter, a user function `f` and `g` whose
 * bodies call the counted `probe`, so "the body never ran" is observable. */
function setup(): { ce: ComputeEngine; calls: () => number } {
  const ce = new ComputeEngine();
  let calls = 0;
  ce.declare('probe', {
    signature: '(any) -> number',
    evaluate: () => {
      calls += 1;
      return ce.number(99);
    },
  });
  ce.box(['Assign', 'f', ['Function', ['probe', 'x'], 'x']]).evaluate();
  ce.box(['Assign', 'g', ['Function', ['probe', 'y'], 'y']]).evaluate();
  return { ce, calls: () => calls };
}

/** An `Error`-headed value. */
const ERR: MathJsonExpression = ['Error', { str: 'oops' }];

/** An expression whose CANONICAL form merely EMBEDS an error: `"a" + 1` is an
 * invalid frozen `Add` carrying an `incompatible-type` error. This is the
 * motivating case of the design's spec refinement. */
const BAD: MathJsonExpression = ['Add', { str: 'a' }, 1];

/** Run a Cortex program on a fresh engine. */
function cortex(source: string): string {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression => ce.parse(latex).json;
  const { value, diagnostics } = executeCortex(ce, source, { parseLatex });
  // These programs are deliberately bad, and `"a" + 1` is detectable at
  // canonicalization time: `executeCortex` reports it as a
  // `static-type-error` diagnostic before running the program (design §5),
  // then evaluates it anyway. What this helper pins is what *evaluation*
  // does with the error, so only non-static diagnostics are unexpected.
  expect(
    diagnostics.filter(
      (x) =>
        (Array.isArray(x.message) ? x.message[0] : x.message) !==
        'static-type-error'
    )
  ).toEqual([]);
  return value.toString();
}

describe('ERROR PROPAGATION — rung 2: bubbling at application', () => {
  test('all three application routes yield the bare error, body never runs', () => {
    const { ce, calls } = setup();
    // Direct call, `Apply`, and `Pipe` agree — the pipe is application sugar.
    expect(ce.box(['f', ERR]).evaluate().toString()).toBe('Error("oops")');
    expect(ce.box(['Apply', 'f', ERR]).evaluate().toString()).toBe(
      'Error("oops")'
    );
    expect(ce.box(['Pipe', ERR, 'f']).evaluate().toString()).toBe(
      'Error("oops")'
    );
    expect(calls()).toBe(0);
  });

  test('a chain short-circuits without running either stage', () => {
    const { ce, calls } = setup();
    expect(
      ce.box(['Pipe', ['Pipe', ERR, 'f'], 'g']).evaluate().toString()
    ).toBe('Error("oops")');
    expect(calls()).toBe(0);
  });

  test('an operand that merely EMBEDS an error bubbles its first error', () => {
    const { ce, calls } = setup();
    const expected =
      'Error(ErrorCode("incompatible-type", "number", "string"))';
    expect(ce.box(['f', BAD]).evaluate().toString()).toBe(expected);
    expect(ce.box(['Pipe', BAD, 'f']).evaluate().toString()).toBe(expected);
    expect(calls()).toBe(0);
  });

  test('the motivating case: ("a" + 1) |> (x |-> 99) is the embedded error', () => {
    const ce = new ComputeEngine();
    // Not `99` (the body must not run) and not a frozen `Apply`.
    expect(
      ce
        .box(['Pipe', BAD, ['Function', 99, 'x']])
        .evaluate()
        .toString()
    ).toBe('Error(ErrorCode("incompatible-type", "number", "string"))');
  });

  test('an argument that only FAILS when evaluated bubbles too', () => {
    const { ce, calls } = setup();
    // `h()` evaluates to an error value; `f(h())` is a valid tree until the
    // argument is evaluated inside the application.
    ce.declare('h', {
      signature: '() -> unknown',
      evaluate: () => ce.box(['Error', { str: 'boom' }]),
    });
    expect(ce.box(['f', ['h']]).evaluate().toString()).toBe('Error("boom")');
    expect(calls()).toBe(0);
  });

  test('applying something that IS an error bubbles it', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Apply', ERR, 5]).evaluate().toString()).toBe(
      'Error("oops")'
    );
  });

  test('the numericApproximation route behaves identically', () => {
    const { ce, calls } = setup();
    expect(ce.box(['f', ERR]).N().toString()).toBe('Error("oops")');
    expect(ce.box(['Pipe', ERR, 'f']).N().toString()).toBe('Error("oops")');
    expect(calls()).toBe(0);
  });

  test('route parity: box, ce.function and Cortex agree', () => {
    const { ce } = setup();
    const boxed = ce.box(ERR);
    expect(ce.function('f', [boxed]).evaluate().toString()).toBe(
      'Error("oops")'
    );
    expect(ce.box(['f', ERR]).evaluate().toString()).toBe('Error("oops")');
    expect(cortex('let f = x |-> x + 1; f("a" + 1)')).toBe(
      'Error(ErrorCode("incompatible-type", "number", "string"))'
    );
    expect(cortex('let f = x |-> x + 1; ("a" + 1) |> f')).toBe(
      'Error(ErrorCode("incompatible-type", "number", "string"))'
    );
  });
});

describe('ERROR PROPAGATION — rung 3: operators bubble', () => {
  test('`err + 1` bubbles to the bare error', () => {
    const ce = new ComputeEngine();
    const sum = ce.box(['Add', ERR, 1]);
    expect(sum.evaluate().operator).toBe('Error');
    expect(sum.evaluate().toString()).toBe('Error("oops")');
  });

  test('a built-in operator bubbles on both the direct and the pipe route', () => {
    // `x |> f ≡ f(x)` must hold for EVERY callee (§3): rung 3 makes both
    // spellings bubble, exactly as rung 2 already did for user functions.
    const ce = new ComputeEngine();
    expect(ce.box(['Sin', ERR]).evaluate().toString()).toBe('Error("oops")');
    expect(ce.box(['Pipe', ERR, 'Sin']).evaluate().toString()).toBe(
      'Error("oops")'
    );
  });

  test('an operator bubbles an error EMBEDDED in an operand', () => {
    const ce = new ComputeEngine();
    // `"a" + 1` is an invalid frozen `Add`; `Sin` of it bubbles the embedded
    // validation error, not the frozen tree.
    expect(ce.box(['Sin', BAD]).evaluate().toString()).toBe(
      'Error(ErrorCode("incompatible-type", "number", "string"))'
    );
  });
});

describe('ERROR PROPAGATION — rung 3: the breadcrumb (§2a)', () => {
  test('a bubbled error carries an `ErrorTrace` of frames, innermost first', () => {
    const ce = new ComputeEngine();
    const err = ce
      .box(['Add', ['Power', 'x', 2], ['Ln', { str: 'a' }], ['Multiply', 2, 'x']])
      .evaluate();
    expect(err.json).toEqual([
      'Error',
      ['ErrorCode', "'incompatible-type'", "'number'", "'string'"],
      ['ErrorTrace', ['ErrorFrame', "'Ln'", 1], ['ErrorFrame', "'Add'", 2]],
    ]);
  });

  test('frames accumulate across nested bubbling hops', () => {
    const ce = new ComputeEngine();
    // `Sin("a" + 1)`: the walk records `Add` argument 1, the bubbling `Sin`
    // node records itself.
    expect(ce.box(['Sin', BAD]).evaluate().json).toEqual([
      'Error',
      ['ErrorCode', "'incompatible-type'", "'number'", "'string'"],
      ['ErrorTrace', ['ErrorFrame', "'Add'", 1], ['ErrorFrame', "'Sin'", 1]],
    ]);
  });

  test('`errorFrames()`/`errorWhere()` decode the breadcrumb', () => {
    const ce = new ComputeEngine();
    const err = ce.box(['Sin', BAD]).evaluate();
    expect(errorFrames(err)).toEqual([
      { operator: 'Add', index: 1 },
      { operator: 'Sin', index: 1 },
    ]);
    // The `where` slot is EMPTY here: the breadcrumb occupies operand 2, and
    // reading it positionally would misreport it as the error context.
    expect(errorWhere(err)).toBeUndefined();
    const withWhere = ce.expr(['Negate', 2.5, 1.1]).evaluate();
    expect(errorWhere(withWhere)?.toString()).toBe('"1.1"');
  });

  test('an error raised in place carries NO breadcrumb (historical shape)', () => {
    const ce = new ComputeEngine();
    expect(ce.box(ERR).evaluate().json).toEqual(['Error', "'oops'"]);
  });

  test('the breadcrumb survives a `box()`/`evaluate()` round trip', () => {
    const ce = new ComputeEngine();
    const err = ce.box(['Sin', BAD]).evaluate();
    expect(ce.box(err.json).evaluate().json).toEqual(err.json);
  });

  test('the breadcrumb is not displayed: `toString()` and LaTeX stay compact', () => {
    const ce = new ComputeEngine();
    const bubbled = ce.box(['Sin', ERR]).evaluate();
    const raw = ce.box(ERR);
    expect(bubbled.toString()).toBe(raw.toString());
    expect(bubbled.latex).toBe(raw.latex);
  });

  test('an `Error(c)` pattern destructures a bubbled error like a raw one', () => {
    // The breadcrumb is provenance, not payload: it must not change how a
    // `match` case sees the error.
    expect(
      cortex('match Sin("a" + 1) {\n  Error(c) => "caught"\n  _ => "no"\n}')
    ).toBe('"caught"');
  });

  test('the Cortex runtime-error diagnostic renders the frame chain', () => {
    const ce = new ComputeEngine();
    const { diagnostics } = executeCortex(
      ce,
      'let y = Sin("a" + 1)\n1 + 1',
      {}
    );
    const runtime = diagnostics
      .map((x) => x.message)
      .filter((m): m is string[] => Array.isArray(m) && m[0] === 'runtime-error');
    expect(runtime.length).toBe(1);
    expect(runtime[0][2]).toBe('in Add argument 1, in Sin argument 1');
  });
});

describe('ERROR PROPAGATION — rung 3: collections freeze, they never bubble', () => {
  test('a `List` keeps the failed cell in place', () => {
    const ce = new ComputeEngine();
    const list = ce.box(['List', 1, ['Ln', { str: 'a' }], 3]).evaluate();
    expect(list.operator).toBe('List');
    expect(list.count).toBe(3);
    expect(list.toString()).toBe(
      '[1,ln(Error(ErrorCode("incompatible-type", "number", "string"))),3]'
    );
  });

  test('a `Tuple` keeps the failed cell in place', () => {
    // Measured regression of the naive rung-3 prototype (§6a.2): `Tuple`
    // bubbled because its exemption had ridden on laziness.
    const ce = new ComputeEngine();
    const tuple = ce.box(['Tuple', 1, ['Ln', { str: 'a' }]]).evaluate();
    expect(tuple.operator).toBe('Tuple');
    expect(tuple.count).toBe(2);
  });

  test('a dictionary keeps the failed VALUE in place', () => {
    // `Dictionary` has no operator definition (§6a.2 open question): its
    // values take the ordinary per-value evaluation path, so the error
    // bubbles WITHIN the cell and the dictionary survives.
    const ce = new ComputeEngine();
    const dict = ce
      .box(['Dictionary', ['KeyValuePair', { str: 'k' }, BAD]])
      .evaluate();
    expect(dict.get('k')?.toString()).toBe(
      'Error(ErrorCode("incompatible-type", "number", "string"))'
    );
  });

  test('`Length` of a list with a failed cell is unchanged by rung 3', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Length', ['List', 1, ['Ln', { str: 'a' }], 3]]).evaluate().json
    ).toEqual([
      'Length',
      ['List', 1, ['Ln', ['Error', ['ErrorCode', "'incompatible-type'", "'number'", "'string'"]]], 3],
    ]);
  });
});

describe('ERROR PROPAGATION — NaN does not short-circuit', () => {
  test('`NaN |> f` RUNS f (§3: NaN is a number, not a failure)', () => {
    const { ce, calls } = setup();
    expect(ce.box(['Pipe', 'NaN', 'f']).evaluate().toString()).toBe('99');
    expect(calls()).toBe(1);
  });

  test('`f(NaN)` runs f too', () => {
    const { ce, calls } = setup();
    expect(ce.box(['f', 'NaN']).evaluate().toString()).toBe('99');
    expect(calls()).toBe(1);
  });

  test('the rescue idiom still reaches the inspecting function', () => {
    // The gap-handling idiom §3.1 names: a NaN short-circuit would make this
    // impossible, because the predicate would never be applied.
    const ce = new ComputeEngine();
    expect(ce.box(['Pipe', 'NaN', 'IsMissing']).evaluate().symbol).toBe('True');
    expect(ce.box(['IsMissing', 'NaN']).evaluate().symbol).toBe('True');
  });

  test('`IsError` is False on NaN', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['IsError', 'NaN']).evaluate().symbol).toBe('False');
  });
});

describe('ERROR PROPAGATION — rung 1: IsError', () => {
  test('True on an error value and on a value embedding one', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['IsError', ERR]).evaluate().symbol).toBe('True');
    expect(ce.box(['IsError', BAD]).evaluate().symbol).toBe('True');
  });

  test('False on numbers, symbols, strings, NaN and Nothing', () => {
    const ce = new ComputeEngine();
    for (const x of [5, 'x', { str: 'a' }, 'NaN', 'Nothing', 'Pi'] as const)
      expect(ce.box(['IsError', x]).evaluate().symbol).toBe('False');
  });

  test('reports a failure that only happens at EVALUATION', () => {
    const ce = new ComputeEngine();
    // A `Match` with no matching case evaluates to `Error("match-no-case", …)`.
    expect(
      ce
        .box(['IsError', ['Match', 5, ['MatchCase', 0, 1]]])
        .evaluate().symbol
    ).toBe('True');
  });

  test('route parity: box, ce.function and Cortex agree', () => {
    const ce = new ComputeEngine();
    expect(ce.function('IsError', [ce.box(BAD)]).evaluate().symbol).toBe(
      'True'
    );
    expect(cortex('IsError("a" + 1)')).toBe('"True"');
    expect(cortex('IsError(5)')).toBe('"False"');
  });

  /**
   * THE SUBTLE SEAM. `|>` is an application route, so one might expect rung 2
   * to bubble the error BEFORE `IsError` ever sees it, making
   * `("a" + 1) |> IsError` an error while `IsError("a" + 1)` is `True`.
   *
   * It does not, and must not: §3 pins `x |> f ≡ f(x)` as inviolable, so the
   * pipe cannot mean something different from the direct call. The rule is
   * therefore stated on the CALLEE, not on the route — bubbling happens when
   * the callee is a user function, and an OBSERVER that holds its operand
   * (`IsError`, `Type`, `Match`) inspects the error on every route alike.
   */
  test('`("a" + 1) |> IsError` is True — the observer sees the error', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Pipe', BAD, 'IsError']).evaluate().symbol).toBe('True');
    expect(ce.box(['IsError', BAD]).evaluate().symbol).toBe('True');
    expect(cortex('("a" + 1) |> IsError')).toBe('"True"');
  });

  test('`Type` is likewise an observer on both routes', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Type', BAD]).evaluate().toString()).toBe('"error"');
    expect(ce.box(['Pipe', BAD, 'Type']).evaluate().toString()).toBe('"error"');
  });
});

describe('ERROR PROPAGATION — Nothing: argument-list erasure, route parity', () => {
  // §4: `Nothing` is ERASURE, not failure. It is erased from the call argument
  // list uniformly, so every route behaves as `f()` under the existing
  // nullary-application contract (for a one-parameter literal, that contract
  // curries: the result is the literal with a fresh parameter).
  test('the three routes agree for a named function', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'f', ['Function', ['Add', 'x', 1], 'x']]).evaluate();
    const nullary = ce.box(['f']).evaluate().toString();
    expect(ce.box(['f', 'Nothing']).evaluate().toString()).toBe(nullary);
    expect(ce.box(['Pipe', 'Nothing', 'f']).evaluate().toString()).toBe(
      nullary
    );
    expect(ce.box(['Apply', 'f', 'Nothing']).evaluate().toString()).toBe(
      nullary
    );
  });

  test('the three routes agree for a `Function` literal callee', () => {
    const ce = new ComputeEngine();
    const lit: MathJsonExpression = ['Function', ['Add', 'x', 1], 'x'];
    const nullary = ce.box(['Apply', lit]).evaluate().toString();
    expect(ce.box(['Apply', lit, 'Nothing']).evaluate().toString()).toBe(
      nullary
    );
    expect(ce.box(['Pipe', 'Nothing', lit]).evaluate().toString()).toBe(
      nullary
    );
    expect(cortex('(x |-> x + 1)(Nothing)')).toBe(nullary);
    expect(cortex('Nothing |> (x |-> x + 1)')).toBe(nullary);
  });
});

describe('ERROR PROPAGATION — collection-embedded errors do not bubble', () => {
  // An error inside a collection literal is an error in one ELEMENT, not a
  // failure of the collection: bubbling it would discard the whole list (and
  // every valid element in it) to report one cell. So `errorValue()` does not
  // descend into `List`/`Set`/`Tuple`/`Dictionary`, and such an application
  // freezes exactly as it did before rung 2.
  test('`f([1, "a" + 1])` freezes, keeping the collection; the body never runs', () => {
    const { ce, calls } = setup();
    const list: MathJsonExpression = ['List', 1, BAD];
    const frozen =
      'f([1,Error(ErrorCode("incompatible-type", "number", "string")) + 1])';
    expect(ce.box(['f', list]).evaluate().toString()).toBe(frozen);
    expect(ce.box(['Pipe', list, 'f']).evaluate().toString()).toBe(frozen);
    expect(calls()).toBe(0);
  });

  test('a Tuple operand behaves the same', () => {
    const { ce } = setup();
    expect(ce.box(['f', ['Tuple', 1, BAD]]).evaluate().operator).toBe('f');
  });

  test('an invalid NON-collection tree still bubbles its first error', () => {
    const { ce } = setup();
    // `Error(…) + 1` is an invalid `Add`, not a collection: rung 2 applies.
    expect(
      ce.box(['f', ['Add', ERR, 1]]).evaluate().toString()
    ).toBe('Error("oops")');
    expect(ce.box(['f', BAD]).evaluate().toString()).toBe(
      'Error(ErrorCode("incompatible-type", "number", "string"))'
    );
  });

  test('`IsError` follows the same rule (it asks the same question)', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['IsError', ['List', 1, BAD]]).evaluate().symbol).toBe(
      'False'
    );
    expect(ce.box(['IsError', ['Add', ERR, 1]]).evaluate().symbol).toBe('True');
  });
});

describe('ERROR PROPAGATION — a non-callable value def reports the CALLEE', () => {
  // `a := 5; a(err)` is not a function application at all. The callee problem
  // must win over the argument's error — the same gate `applyFunctionLiteral`
  // makes before beta-reducing (`value.type.matches('function')`).
  test('`a := 5; a("x" + 1)` reports the non-callable callee', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'a', 5]).evaluate();
    const calleeError =
      'Error(ErrorCode("incompatible-type", "function", "finite_integer"), "5")';
    expect(ce.box(['a', BAD]).evaluate().toString()).toBe(calleeError);
    // …and it is the SAME diagnostic a valid argument gets.
    expect(ce.box(['a', 5]).evaluate().toString()).toBe(calleeError);
  });

  test('a function-typed value def still bubbles the argument error', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'b', ['Function', ['Add', 'x', 1], 'x']]).evaluate();
    expect(ce.box(['b', BAD]).evaluate().toString()).toBe(
      'Error(ErrorCode("incompatible-type", "number", "string"))'
    );
    expect(ce.box(['b', 2]).evaluate().toString()).toBe('3');
  });
});

describe('ERROR PROPAGATION — IsError arity and purity', () => {
  test('`IsError()` is an arity error, not a boolean', () => {
    const ce = new ComputeEngine();
    // Without the arity guard the missing-operand marker would be inspected
    // like any other operand and answer `True`.
    expect(ce.box(['IsError']).evaluate().toString()).toBe('Error("missing")');
    expect(ce.box(['IsError', 1, 2]).evaluate().toString()).toBe(
      'Error("unexpected-argument", "2")'
    );
  });

  test('purity follows the `N`/`Evaluate` convention for lazy wrappers', () => {
    // `IsError` evaluates its held operand, exactly as `N` and `Evaluate` do.
    // Neither of those declares `pure`, so all three take the definition
    // default. This pins the CONSISTENCY, not the value.
    const ce = new ComputeEngine();
    const pure = (name: string): boolean | undefined =>
      (ce.lookupDefinition(name) as any)?.operator?.pure;
    expect(pure('IsError')).toBe(pure('Evaluate'));
    expect(pure('IsError')).toBe(pure('N'));
  });
});

describe('ERROR PROPAGATION — async, first-error and partial application', () => {
  test('the async route mirrors the sync gate (bubble and freeze)', async () => {
    const { ce, calls } = setup();
    // Bubble: a user-function application.
    expect((await ce.box(['f', BAD]).evaluateAsync()).toString()).toBe(
      'Error(ErrorCode("incompatible-type", "number", "string"))'
    );
    expect((await ce.box(['Pipe', ERR, 'f']).evaluateAsync()).toString()).toBe(
      'Error("oops")'
    );
    // Rung 3: a built-in operator bubbles too, on the async route as well.
    expect((await ce.box(['Sin', ERR]).evaluateAsync()).toString()).toBe(
      'Error("oops")'
    );
    // Freeze: a collection keeps the failed cell in place.
    expect(
      (await ce.box(['List', 1, ERR]).evaluateAsync()).operator
    ).toBe('List');
    expect(calls()).toBe(0);
  });

  test('with several error arguments, the FIRST one bubbles', () => {
    const ce = new ComputeEngine();
    const two: MathJsonExpression = ['Function', ['Add', 'x', 'y'], 'x', 'y'];
    ce.box(['Assign', 'h', two]).evaluate();
    expect(
      ce
        .box(['h', ['Error', { str: 'first' }], ['Error', { str: 'second' }]])
        .evaluate()
        .toString()
    ).toBe('Error("first")');
  });

  test('a PARTIAL application bubbles instead of currying', () => {
    const { ce, calls } = setup();
    ce.declare('boom', {
      signature: '() -> unknown',
      evaluate: () => ce.box(['Error', { str: 'boom' }]),
    });
    ce.box(['Assign', 'h', ['Function', ['probe', 'x'], 'x', 'y']]).evaluate();
    // One argument for a two-parameter literal: the curry branch. A literal
    // error argument and one that only fails when EVALUATED both bubble.
    expect(ce.box(['h', ERR]).evaluate().toString()).toBe('Error("oops")');
    expect(ce.box(['h', ['boom']]).evaluate().toString()).toBe('Error("boom")');
    expect(calls()).toBe(0);
  });
});

describe('ERROR PROPAGATION — rung 3: the §8a route-divergence residue is closed', () => {
  /**
   * The §3 equivalence `x |> f ≡ f(x)` used to hold only for the five
   * original `inspectsErrors` operators (`Match`, `Type`, `IsError`, `Apply`,
   * `Pipe`): every other lazy built-in diverged by route, because its held
   * operand is raw (and therefore valid) on the `ce.box`/parse route but
   * arrives already canonical — and thus invalid — through `Pipe`.
   *
   * Rung 3 closes it for the TRANSFORMERS by opting them into
   * `inspectsErrors` (audited one by one, see the design's §8a table): they
   * report on the expression they are given rather than consuming it, so the
   * handler must run on both routes.
   */
  const embedded =
    'Error(ErrorCode("incompatible-type", "number", "string")) + 1';

  test.each([
    ['Expand', embedded],
    ['ExpandAll', embedded],
    ['Factor', embedded],
    ['Together', embedded],
    ['Distribute', embedded],
  ])('`%s` agrees on the direct and the pipe route', (op, expected) => {
    const ce = new ComputeEngine();
    expect(ce.box([op, BAD]).evaluate().toString()).toBe(expected);
    expect(ce.box(['Pipe', BAD, op]).evaluate().toString()).toBe(expected);
  });

  test('`Simplify` agrees on both routes (it evaluates, so it bubbles)', () => {
    // `Simplify`'s handler EVALUATES its operand before simplifying, and that
    // evaluation bubbles on its own terms — so both routes yield the bare
    // error rather than the frozen tree.
    const ce = new ComputeEngine();
    const bare = 'Error(ErrorCode("incompatible-type", "number", "string"))';
    expect(ce.box(['Simplify', BAD]).evaluate().toString()).toBe(bare);
    expect(ce.box(['Pipe', BAD, 'Simplify']).evaluate().toString()).toBe(bare);
  });

  test('`Hold` holds a failed expression on both routes', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Hold', BAD]).evaluate().operator).toBe('Hold');
    expect(ce.box(['Pipe', BAD, 'Hold']).evaluate().operator).toBe('Hold');
  });

  test('`Assume` of a non-predicate is a VALUE, not a throw', () => {
    // §6a.4: the throw was inside `assume()`'s own dispatcher, so it escaped
    // to the host on the direct route while Cortex turned it into a value.
    const ce = new ComputeEngine();
    expect(() => ce.box(['Assume', ['Ln', { str: 'a' }]]).evaluate()).not.toThrow();
    expect(() => ce.box(['Assume', 5]).evaluate()).not.toThrow();
    expect(ce.assume(ce.box(['Ln', { str: 'a' }]))).toBe('not-a-predicate');
    expect(cortex('Assume(Ln("a"))')).not.toContain('Unsupported assumption');
  });
});

describe('ERROR PROPAGATION — Nothing: erasure is a rule on the WRITTEN argument', () => {
  /**
   * §4 erases `Nothing` from the call argument list. Erasure keys on the
   * argument as WRITTEN — a literal `Nothing` — not on the value it computes
   * to: `Apply` is strict, so by evaluation time an argument that merely
   * *evaluated* to `Nothing` is indistinguishable from a literal one, and
   * erasing it there made `Apply(f, g())` differ from `f(g())` (which binds
   * it) and, through `apply()`, from the `Pipe` route that holds its topic.
   * §3 pins `x |> f ≡ f(x)`, so the erasure lives in `Apply`'s CANONICAL
   * handler — the same place the direct route erases (`flattenOps`).
   */
  const NOTHING_FN: MathJsonExpression = ['Function', ['Type', 'x'], 'x'];

  /** A fresh engine with `g() = Nothing` and `f = x |-> Type(x)`; the body
   * reports whether the argument was BOUND (`"nothing"`) or ERASED (the
   * nullary contract curries, giving the literal back). */
  function nothingSetup(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'g', ['Function', 'Nothing']]).evaluate();
    ce.box(['Assign', 'f', NOTHING_FN]).evaluate();
    return ce;
  }

  test('a LITERAL `Nothing` is erased on all five routes', () => {
    const ce = nothingSetup();
    const nullary = ce.box(['f']).evaluate().toString();
    expect(ce.box(['f', 'Nothing']).evaluate().toString()).toBe(nullary);
    expect(ce.box(['Apply', 'f', 'Nothing']).evaluate().toString()).toBe(
      nullary
    );
    expect(ce.box(['Pipe', 'Nothing', 'f']).evaluate().toString()).toBe(
      nullary
    );
    expect(ce.box(['Apply', NOTHING_FN, 'Nothing']).evaluate().toString()).toBe(
      nullary
    );
    expect(ce.box(['Pipe', 'Nothing', NOTHING_FN]).evaluate().toString()).toBe(
      nullary
    );
  });

  test('an argument that only EVALUATES to Nothing is bound — on every route', () => {
    const ce = nothingSetup();
    // Named callee.
    expect(ce.box(['f', ['g']]).evaluate().toString()).toBe('"nothing"');
    expect(ce.box(['Apply', 'f', ['g']]).evaluate().toString()).toBe(
      '"nothing"'
    );
    expect(ce.box(['Pipe', ['g'], 'f']).evaluate().toString()).toBe(
      '"nothing"'
    );
    // `Function`-literal callee (the route that never reaches `flattenOps`).
    expect(ce.box(['Apply', NOTHING_FN, ['g']]).evaluate().toString()).toBe(
      '"nothing"'
    );
    expect(ce.box(['Pipe', ['g'], NOTHING_FN]).evaluate().toString()).toBe(
      '"nothing"'
    );
    expect(cortex('let g = () |-> Nothing; (x |-> Type(x))(g())')).toBe(
      '"nothing"'
    );
  });

  test('a middle-position `Nothing` erases, shifting later arguments left', () => {
    const ce = new ComputeEngine();
    // `Apply(x, y |-> x + y, Nothing, 5)`: the `Nothing` is erased, so `5`
    // binds the FIRST parameter and the second stays unapplied (curried).
    const lit: MathJsonExpression = ['Function', ['Add', 'x', 'y'], 'x', 'y'];
    expect(ce.box(['Apply', lit, 'Nothing', 5]).evaluate().toString()).toBe(
      ce.box(['Apply', lit, 5]).evaluate().toString()
    );
  });
});
