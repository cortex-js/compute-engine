/**
 * Executable conformance suite for `docs/ERROR-MODEL.md`.
 *
 * The error model describes four response channels — `Error` (an out-of-band
 * diagnostic for a violated language or operation contract), `NaN` (the
 * in-band numeric indeterminacy value and the absence marker inside numeric
 * domains), `Missing` (the position-preserving absent datum for non-numeric
 * domains), and inertness ("not yet", never "no") — plus the rules that say
 * which channel answers which kind of wrongness, when it fires, and how it
 * propagates. ERROR-MODEL.md §7 carries a hand-probed snapshot of that
 * behavior and asks for an executable suite so "conforms" becomes checkable
 * instead of asserted.
 *
 * WHAT THIS SUITE IS. A regression gate that pins TODAY'S behavior of the
 * canonical error/absence kit, so a later change — the finite-by-default
 * numeric-lattice flip in particular (`docs/TYPE_SYSTEM_ROADMAP.md` §8) — can
 * MEASURE its blast radius instead of estimating it. It is not aspirational:
 * every expectation below passes against the tree as it stands. Where the
 * model says the behavior should eventually be different, the row lives in
 * the clearly labelled gaps block at the bottom, with a comment naming the
 * eventual behavior.
 *
 * THREE CONSTRUCTION ROUTES. Each probe family is built three ways —
 * `ce.box(json)`, `ce.parse(latex)`, and `ce.function(head, preBoxedOps)`.
 * The routes genuinely diverge for lazy operators: a lazy operator with no
 * `canonical` handler receives UNBOUND held operands on the box and parse
 * routes but pre-boxed ones through `ce.function`, so a suite that exercises
 * one route can miss a whole failure class. Route parity is therefore an
 * assertion here, not decoration.
 *
 * ENGINE HYGIENE. Each describe block builds its own `ComputeEngine`.
 * Evaluating a bare symbol in a boolean context retypes it for the engine's
 * lifetime, and assumptions persist, so a shared engine could let one block
 * change another block's answer.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  isFunction,
  isString,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../../src/compute-engine/global-types';

//
// Helpers
//

/** One construction of a probe expression, tagged with the route that built it. */
type Route = { route: string; expr: Expression };

/**
 * Build the same probe through all three public construction routes.
 *
 * `json` goes through `ce.box`, `latex` through `ce.parse`, and `head` +
 * `ops()` through `ce.function` with already-boxed operands. `ops` is a thunk
 * so the operands are boxed with the engine under test at call time.
 */
function routes(
  ce: ComputeEngine,
  json: any,
  latex: string,
  head: string,
  ops: () => Expression[]
): Route[] {
  return [
    { route: 'ce.box', expr: ce.box(json) },
    { route: 'ce.parse', expr: ce.parse(latex) },
    { route: 'ce.function', expr: ce.function(head, ops()) },
  ];
}

/** The operands of an application, or `[]` for anything that is not one. */
function operandsOf(x: Expression): ReadonlyArray<Expression> {
  return isFunction(x) ? x.ops : [];
}

/** The `n`-th operand of an application, counting from 1. */
function operand(x: Expression, n: number): Expression {
  const ops = operandsOf(x);
  if (n < 1 || n > ops.length)
    throw new Error(`No operand ${n} on ${x.toString()}`);
  return ops[n - 1];
}

/** The name of a symbol, or `undefined` for anything that is not one. */
function symbolName(x: Expression): string | undefined {
  return isSymbol(x) ? x.symbol : undefined;
}

/** True when the expression IS an `Error` node (not merely one that contains one). */
function isErrorValue(x: Expression): boolean {
  return isFunction(x, 'Error');
}

/**
 * The error code of an `Error` node — the first operand is either a bare code
 * string or an `ErrorCode(code, …)` application carrying the code plus the
 * expected and actual types.
 */
function errorCode(x: Expression): string | undefined {
  if (!isFunction(x, 'Error')) return undefined;
  const code = x.op1;
  if (isString(code)) return code.string;
  if (isFunction(code, 'ErrorCode') && isString(code.op1))
    return code.op1.string;
  return undefined;
}

/**
 * The operator names on an error's breadcrumb, outermost frame last. An
 * `Error` accumulates an `ErrorTrace` of `ErrorFrame(operator, position)` as
 * it is absorbed upward through the operators it passed (ERROR-MODEL §1, §3).
 */
function errorFrames(x: Expression): string[] {
  const trace = operandsOf(x).find((op) => isFunction(op, 'ErrorTrace'));
  if (trace === undefined) return [];
  return operandsOf(trace).map((frame) => {
    const name = isFunction(frame) ? frame.op1 : undefined;
    return name !== undefined && isString(name) ? name.string : '?';
  });
}

/** True when the expression is the `NaN` literal. */
function isNaNValue(ce: ComputeEngine, x: Expression): boolean {
  return x.isSame(ce.NaN);
}

/** True when the expression is the `Missing` symbol. */
function isMissingValue(x: Expression): boolean {
  return isSymbol(x, 'Missing');
}

/**
 * True when evaluating left the application in its own unevaluated form —
 * either rule-7 inertness or, for an exact argument, the decided exact
 * symbolic value awaiting numericization (ERROR-MODEL §1, §7). The two are
 * indistinguishable from the outside; the surrounding test says which one the
 * row is about.
 */
function isUnreduced(x: Expression, head: string): boolean {
  return isFunction(x, head);
}

/**
 * Compile to the JavaScript target. The result is never `undefined` for the
 * probes here, so this narrows once instead of at every call site.
 */
function compiled(expr: Expression) {
  const result = compile(expr);
  if (result === undefined) throw new Error('compile() returned undefined');
  return result;
}

//
// §2 rule 1 — provable contract violation produces an Error at boxing
//

describe('ERROR-MODEL §2 rule 1 — provable contract violation errors at boxing', () => {
  const ce = new ComputeEngine();

  // The offending operand is wrapped IN PLACE, so the surrounding structure
  // survives and diagnostics keep their position: `Sin("banana")` boxes as
  // `Sin(Error(…))`, never as a bare error value (ERROR-MODEL §2 rule 1).
  describe('Sin("banana") — string operand in a numeric slot', () => {
    for (const { route, expr } of routes(
      ce,
      ['Sin', { str: 'banana' }],
      '\\sin(\\text{banana})',
      'Sin',
      () => [ce.string('banana')]
    )) {
      test(`[${route}] boxes as Sin(Error(incompatible-type)), evaluates and numericizes to the Error`, () => {
        expect(expr.operator).toBe('Sin');
        expect(isErrorValue(operand(expr, 1))).toBe(true);
        expect(errorCode(operand(expr, 1))).toBe('incompatible-type');
        // Any tree containing an `Error` node is invalid and reports type
        // `error` without being evaluated (ERROR-MODEL §2 rule 1, §3).
        expect(expr.isValid).toBe(false);
        expect(expr.type.toString()).toBe('error');

        expect(isErrorValue(expr.evaluate())).toBe(true);
        expect(errorCode(expr.evaluate())).toBe('incompatible-type');
        expect(isErrorValue(expr.N())).toBe(true);
      });
    }
  });

  describe('Sin(True) — boolean operand in a numeric slot', () => {
    for (const { route, expr } of routes(
      ce,
      ['Sin', 'True'],
      '\\sin(\\operatorname{True})',
      'Sin',
      () => [ce.box('True')]
    )) {
      test(`[${route}] boxes as Sin(Error(incompatible-type))`, () => {
        expect(expr.operator).toBe('Sin');
        expect(errorCode(operand(expr, 1))).toBe('incompatible-type');
        expect(isErrorValue(expr.evaluate())).toBe(true);
        expect(isErrorValue(expr.N())).toBe(true);
      });
    }
  });

  describe('"banana" + 1 — the error is absorbed by Add at evaluation', () => {
    for (const { route, expr } of routes(
      ce,
      ['Add', { str: 'banana' }, 1],
      '\\text{banana}+1',
      'Add',
      () => [ce.string('banana'), ce.box(1)]
    )) {
      test(`[${route}] boxes as Error(…) + 1 and evaluates to the Error`, () => {
        expect(expr.operator).toBe('Add');
        expect(expr.isValid).toBe(false);
        // Boxing keeps the document form: one operand is an error node, the
        // sum still has two operands.
        expect(operandsOf(expr)).toHaveLength(2);

        const evaluated = expr.evaluate();
        expect(isErrorValue(evaluated)).toBe(true);
        expect(errorCode(evaluated)).toBe('incompatible-type');
        expect(isErrorValue(expr.N())).toBe(true);
      });
    }
  });

  test('a string operand of Heaviside is the same boxing Error (ERROR-MODEL §4 worked example)', () => {
    const expr = ce.box(['Heaviside', { str: 'banana' }]);
    expect(errorCode(operand(expr, 1))).toBe('incompatible-type');
    expect(isErrorValue(expr.evaluate())).toBe(true);
  });
});

//
// §2 rules 2 and 6 — admission for the uncertain, then a runtime Error
//

describe('ERROR-MODEL §2 rules 2 and 6 — admitted at boxing, Error at evaluation', () => {
  const ce = new ComputeEngine();

  // The list's element type is indeterminate at boxing, so the operand merely
  // OVERLAPS the parameter type and is admitted (rule 2). The same
  // `incompatible-type` check re-runs when evaluation settles the type against
  // the slot — the accumulator meets a string — and produces the Error then
  // (rule 6).
  describe('Sum(["a", "b"])', () => {
    for (const { route, expr } of routes(
      ce,
      ['Sum', ['List', { str: 'a' }, { str: 'b' }]],
      '\\sum(\\lbrack\\text{a},\\text{b}\\rbrack)',
      'Sum',
      () => [ce.box(['List', { str: 'a' }, { str: 'b' }])]
    )) {
      test(`[${route}] boxes inertly (valid), evaluates to Error(incompatible-type)`, () => {
        expect(expr.operator).toBe('Sum');
        expect(expr.isValid).toBe(true);
        expect(expr.type.toString()).toBe('number');

        const evaluated = expr.evaluate();
        expect(isErrorValue(evaluated)).toBe(true);
        expect(errorCode(evaluated)).toBe('incompatible-type');
        expect(isErrorValue(expr.N())).toBe(true);
      });
    }
  });
});

//
// §2 rule 3 — a value outside the naive domain with a standard extension
//

describe('ERROR-MODEL §2 rule 3 — standard mathematical extensions, no failure channel', () => {
  const ce = new ComputeEngine();

  describe('1/0 → ~oo (projective infinity)', () => {
    for (const { route, expr } of routes(
      ce,
      ['Divide', 1, 0],
      '\\frac{1}{0}',
      'Divide',
      () => [ce.box(1), ce.box(0)]
    )) {
      test(`[${route}] folds to ~oo already at boxing, and stays ~oo under evaluate and N`, () => {
        expect(expr.isSame(ce.ComplexInfinity)).toBe(true);
        expect(expr.evaluate().isSame(ce.ComplexInfinity)).toBe(true);
        expect(expr.N().isSame(ce.ComplexInfinity)).toBe(true);
      });
    }
  });

  describe('Factorial(-2) → ~oo (a pole of Gamma)', () => {
    for (const { route, expr } of routes(
      ce,
      ['Factorial', -2],
      '(-2)!',
      'Factorial',
      () => [ce.box(-2)]
    )) {
      // The §7 snapshot groups this row with `1/0` under a boxed `~oo`, but the
      // two differ: `1/0` folds at boxing while `Factorial(-2)` stays an
      // unevaluated application until `evaluate()`. Both reach `~oo`, which is
      // what rule 3 claims.
      test(`[${route}] stays an application at boxing and evaluates to ~oo`, () => {
        expect(expr.operator).toBe('Factorial');
        expect(expr.evaluate().isSame(ce.ComplexInfinity)).toBe(true);
        expect(expr.N().isSame(ce.ComplexInfinity)).toBe(true);
      });
    }
  });

  describe('Arcsin(2) — exact and unreduced, numericizing into the complex plane', () => {
    for (const { route, expr } of routes(
      ce,
      ['Arcsin', 2],
      '\\arcsin(2)',
      'Arcsin',
      () => [ce.box(2)]
    )) {
      // This is a DECIDED exact value awaiting numericization under the
      // exactness contract, not rule-7 inertness (ERROR-MODEL §1, §2).
      test(`[${route}] evaluate() keeps arcsin(2) exact; N() gives the complex value`, () => {
        expect(isUnreduced(expr.evaluate(), 'Arcsin')).toBe(true);
        expect(expr.evaluate().isSame(expr)).toBe(true);

        const n = expr.N();
        expect(n.re).toBeCloseTo(Math.PI / 2, 10);
        expect(n.im).toBeCloseTo(-1.3169578969248166, 10);
      });
    }
  });

  describe('Ln(0) → -oo', () => {
    for (const { route, expr } of routes(ce, ['Ln', 0], '\\ln(0)', 'Ln', () => [
      ce.box(0),
    ])) {
      test(`[${route}] boxes unreduced with a provably non-finite type and evaluates to -oo`, () => {
        expect(expr.operator).toBe('Ln');
        expect(expr.type.toString()).toBe('non_finite_number');
        expect(expr.evaluate().isSame(ce.NegativeInfinity)).toBe(true);
        expect(expr.N().isSame(ce.NegativeInfinity)).toBe(true);
      });
    }
  });

  describe('Sum over an empty index range → 0 (the empty-range convention)', () => {
    for (const { route, expr } of routes(
      ce,
      ['Sum', 'x', ['Tuple', 'n', 5, 1]],
      '\\sum_{n=5}^{1}x',
      'Sum',
      () => [ce.box('x'), ce.box(['Tuple', 'n', 5, 1])]
    )) {
      test(`[${route}] boxes inertly and evaluates to 0`, () => {
        expect(expr.operator).toBe('Sum');
        expect(expr.isValid).toBe(true);
        expect(expr.evaluate().isSame(0)).toBe(true);
        expect(expr.N().isSame(0)).toBe(true);
      });
    }
  });
});

//
// §2 rule 4 — a well-typed operation with no result in its codomain
//

describe('ERROR-MODEL §2 rule 4 — the codomain marker for a domain failure', () => {
  const ce = new ComputeEngine();

  // `Mod(1, 0)` is a well-formed question with both operands proven finite
  // integers: the failure is the mathematical domain condition `b ≠ 0`, so the
  // answer is the numeric codomain's marker, quietly and with no provenance.
  describe('Mod(1, 0) → NaN', () => {
    for (const { route, expr } of routes(
      ce,
      ['Mod', 1, 0],
      '\\operatorname{Mod}(1,0)',
      'Mod',
      () => [ce.box(1), ce.box(0)]
    )) {
      test(`[${route}] boxes inertly and both evaluate() and N() give NaN`, () => {
        expect(expr.operator).toBe('Mod');
        expect(expr.isValid).toBe(true);

        expect(isNaNValue(ce, expr.evaluate())).toBe(true);
        expect(isNaNValue(ce, expr.N())).toBe(true);
        // NaN is admitted only by the top type `number`; every carrier below
        // it excludes NaN (ERROR-MODEL §1, §5, ruled 2026-08-21).
        expect(expr.evaluate().type.matches('number')).toBe(true);
        expect(expr.evaluate().type.matches('real')).toBe(false);
        expect(expr.evaluate().type.matches('complex')).toBe(false);
      });
    }
  });

  test('0 · oo makes NaN out of NaN-free inputs (ERROR-MODEL §4: inside the carriers does not prove success)', () => {
    expect(
      isNaNValue(ce, ce.box(['Multiply', 0, 'PositiveInfinity']).evaluate())
    ).toBe(true);
  });
});

//
// §2 rule 5 — absent element or out-of-band access
//

describe('ERROR-MODEL §2 rule 5 — out-of-band access returns the element type marker', () => {
  const ce = new ComputeEngine();

  // The marker is type-directed: a numeric element type answers `NaN`, any
  // other settled type answers `Missing`. Never `Nothing` (which would splice
  // out and misalign positional data), never an `Error` (the access is
  // well-formed; there is simply nothing there).
  describe('At([1, 2], 99) → NaN (numeric elements)', () => {
    for (const { route, expr } of routes(
      ce,
      ['At', ['List', 1, 2], 99],
      '\\lbrack 1,2\\rbrack_{99}',
      'At',
      () => [ce.box(['List', 1, 2]), ce.box(99)]
    )) {
      test(`[${route}] boxes inertly and both evaluate() and N() give NaN`, () => {
        expect(expr.operator).toBe('At');
        expect(expr.isValid).toBe(true);
        expect(isNaNValue(ce, expr.evaluate())).toBe(true);
        expect(isNaNValue(ce, expr.N())).toBe(true);
      });
    }
  });

  describe('First([]) → Missing (no settled numeric element type)', () => {
    for (const { route, expr } of routes(
      ce,
      ['First', ['List']],
      '\\operatorname{First}(\\lbrack\\rbrack)',
      'First',
      () => [ce.box(['List'])]
    )) {
      test(`[${route}] boxes inertly and both evaluate() and N() give the Missing symbol`, () => {
        expect(expr.operator).toBe('First');
        expect(expr.isValid).toBe(true);
        expect(isMissingValue(expr.evaluate())).toBe(true);
        expect(expr.evaluate().type.toString()).toBe('missing');
        expect(isMissingValue(expr.N())).toBe(true);
      });
    }
  });
});

//
// §3 — propagation
//

describe('ERROR-MODEL §3 — Error propagation', () => {
  const ce = new ComputeEngine();

  test('an Error is the absorbing element of strict evaluation, and collects a breadcrumb', () => {
    // Absorption pushes each traversed frame onto the error's `ErrorTrace`, so
    // the value-consuming side is handed a failure certificate with the
    // evaluation path rather than having to search a tree for it.
    const evaluated = ce
      .box(['Add', ['Multiply', 2, ['Sin', { str: 'banana' }]], 1])
      .evaluate();
    expect(isErrorValue(evaluated)).toBe(true);
    expect(errorCode(evaluated)).toBe('incompatible-type');
    expect(errorFrames(evaluated)).toEqual(['Sin', 'Multiply', 'Add']);
  });

  describe('a collection freezes the failed cell instead of bubbling it', () => {
    for (const { route, expr } of routes(
      ce,
      ['List', 1, ['Sin', { str: 'banana' }], 3],
      '\\lbrack 1,\\sin(\\text{banana}),3\\rbrack',
      'List',
      () => [ce.box(1), ce.box(['Sin', { str: 'banana' }]), ce.box(3)]
    )) {
      test(`[${route}] [1, err, 3] stays a length-3 list with the error in place, but the tree is invalid`, () => {
        const evaluated = expr.evaluate();
        expect(evaluated.operator).toBe('List');
        expect(operandsOf(evaluated)).toHaveLength(3);
        expect(operand(evaluated, 1).isSame(1)).toBe(true);
        expect(operand(evaluated, 3).isSame(3)).toBe(true);
        // Preserved and iterable, yet still invalid: `isValid` is false for any
        // tree containing an `Error` node, container or not. Giving containers
        // a validity notion distinct from their cells is a possible future
        // refinement, not current behavior (ERROR-MODEL §3, and the open
        // question on container-vs-cell validity in §7).
        expect(evaluated.isValid).toBe(false);
      });
    }
  });

  test('absorption looks at operands, not through collection values: Sin([err]) stays inert', () => {
    const expr = ce.box(['Sin', ['List', ['Sin', { str: 'banana' }]]]);
    expect(expr.evaluate().operator).toBe('Sin');
    expect(isErrorValue(expr.evaluate())).toBe(false);
  });

  describe('observers see errors instead of bubbling them', () => {
    for (const { route, expr } of routes(
      ce,
      ['IsError', ['Sin', { str: 'banana' }]],
      '\\operatorname{IsError}(\\sin(\\text{banana}))',
      'IsError',
      () => [ce.box(['Sin', { str: 'banana' }])]
    )) {
      test(`[${route}] IsError(err) evaluates to True`, () => {
        expect(symbolName(expr.evaluate())).toBe('True');
      });
    }
  });

  test('Type(err) reports the type `error` rather than bubbling', () => {
    const evaluated = ce.box(['Type', ['Sin', { str: 'banana' }]]).evaluate();
    expect(isErrorValue(evaluated)).toBe(false);
    expect(evaluated.toString()).toContain('error');
  });
});

describe('ERROR-MODEL §3 — NaN propagates by IEEE', () => {
  const ce = new ComputeEngine();

  const numericAbsorption: [string, any, string, string, () => Expression[]][] =
    [
      [
        'Add(1, NaN)',
        ['Add', 1, 'NaN'],
        '1+\\operatorname{NaN}',
        'Add',
        () => [ce.box(1), ce.NaN],
      ],
      [
        'Multiply(2, NaN)',
        ['Multiply', 2, 'NaN'],
        '2\\operatorname{NaN}',
        'Multiply',
        () => [ce.box(2), ce.NaN],
      ],
      [
        'Max(1, NaN, 3)',
        ['Max', 1, 'NaN', 3],
        '\\max(1,\\operatorname{NaN},3)',
        'Max',
        () => [ce.box(1), ce.NaN, ce.box(3)],
      ],
      [
        'Min(1, NaN, 3)',
        ['Min', 1, 'NaN', 3],
        '\\min(1,\\operatorname{NaN},3)',
        'Min',
        () => [ce.box(1), ce.NaN, ce.box(3)],
      ],
    ];

  for (const [label, json, latex, head, ops] of numericAbsorption) {
    describe(`${label} absorbs to NaN`, () => {
      for (const { route, expr } of routes(ce, json, latex, head, ops)) {
        test(`[${route}] evaluate() and N() are both NaN`, () => {
          expect(isNaNValue(ce, expr.evaluate())).toBe(true);
          expect(isNaNValue(ce, expr.N())).toBe(true);
        });
      }
    });
  }

  describe('Equal(NaN, NaN) → False', () => {
    for (const { route, expr } of routes(
      ce,
      ['Equal', 'NaN', 'NaN'],
      '\\operatorname{NaN}=\\operatorname{NaN}',
      'Equal',
      () => [ce.NaN, ce.NaN]
    )) {
      test(`[${route}] IEEE says NaN is equal to nothing, itself included`, () => {
        expect(symbolName(expr.evaluate())).toBe('False');
      });
    }
  });

  test('an ordering involving NaN is False', () => {
    expect(symbolName(ce.box(['Less', 'NaN', 1]).evaluate())).toBe('False');
  });

  describe('IsMissing(NaN) → True', () => {
    for (const { route, expr } of routes(
      ce,
      ['IsMissing', 'NaN'],
      '\\operatorname{IsMissing}(\\operatorname{NaN})',
      'IsMissing',
      () => [ce.NaN]
    )) {
      // The absence-discharge operators treat NaN as absent. This is the
      // accepted information loss of ERROR-MODEL §1: the engine cannot
      // distinguish "a numeric datum was absent" from "a numeric computation
      // produced NaN", a trade made because compile targets are float-only.
      test(`[${route}] a NaN is indistinguishable from an absent numeric datum`, () => {
        expect(symbolName(expr.evaluate())).toBe('True');
      });
    }
  });

  test('IsMissing(Missing) → True as well — the two markers discharge alike', () => {
    expect(symbolName(ce.box(['IsMissing', 'Missing']).evaluate())).toBe(
      'True'
    );
  });
});

describe('ERROR-MODEL §3 — Missing propagates by Kleene, and is absorbed into NaN in numeric slots', () => {
  const ce = new ComputeEngine();

  describe('Less(Missing, 1) → Missing', () => {
    for (const { route, expr } of routes(
      ce,
      ['Less', 'Missing', 1],
      '\\operatorname{Less}(\\operatorname{Missing},1)',
      'Less',
      () => [ce.box('Missing'), ce.box(1)]
    )) {
      test(`[${route}] a comparison against an absent datum is absent, never False`, () => {
        expect(isMissingValue(expr.evaluate())).toBe(true);
      });
    }
  });

  describe('Sin(Missing) → NaN', () => {
    for (const { route, expr } of routes(
      ce,
      ['Sin', 'Missing'],
      '\\sin(\\operatorname{Missing})',
      'Sin',
      () => [ce.box('Missing')]
    )) {
      // Numeric domains absorb absence at the boundary, so numeric operators
      // never need a `missing` arm (the 2026-07-24 absence ruling).
      test(`[${route}] absence entering a numeric slot is normalized to NaN`, () => {
        expect(isNaNValue(ce, expr.evaluate())).toBe(true);
      });
    }
  });

  test('Missing + 1 is NaN, not Missing', () => {
    expect(isNaNValue(ce, ce.box(['Add', 'Missing', 1]).evaluate())).toBe(true);
  });
});

//
// §5 — the exceptional numeric points
//

describe('ERROR-MODEL §5 — ~oo is a definite point with defined arithmetic, not a failure', () => {
  const ce = new ComputeEngine();

  describe('1/~oo → 0', () => {
    for (const { route, expr } of routes(
      ce,
      ['Divide', 1, 'ComplexInfinity'],
      '\\frac{1}{\\operatorname{ComplexInfinity}}',
      'Divide',
      () => [ce.box(1), ce.ComplexInfinity]
    )) {
      test(`[${route}] folds to 0`, () => {
        expect(expr.evaluate().isSame(0)).toBe(true);
      });
    }
  });

  describe('2·~oo → ~oo', () => {
    for (const { route, expr } of routes(
      ce,
      ['Multiply', 2, 'ComplexInfinity'],
      '2\\operatorname{ComplexInfinity}',
      'Multiply',
      () => [ce.box(2), ce.ComplexInfinity]
    )) {
      test(`[${route}] evaluates to ~oo — unlike NaN, ~oo does not absorb into indeterminacy`, () => {
        expect(expr.evaluate().isSame(ce.ComplexInfinity)).toBe(true);
      });
    }
  });

  test('~oo + 1 → ~oo', () => {
    expect(
      ce
        .box(['Add', 'ComplexInfinity', 1])
        .evaluate()
        .isSame(ce.ComplexInfinity)
    ).toBe(true);
  });

  test('both ~oo and NaN are admitted only by the top type `number`', () => {
    // Ruled 2026-08-21 and pinned in `non-finite-typing.test.ts`; repeated here
    // because the whole channel taxonomy of ERROR-MODEL §1 rests on it.
    for (const value of [ce.ComplexInfinity, ce.NaN]) {
      expect(value.type.matches('number')).toBe(true);
      expect(value.type.matches('complex')).toBe(false);
      expect(value.type.matches('real')).toBe(false);
    }
    // The directed infinities, by contrast, are ordinary values of `real`.
    expect(ce.PositiveInfinity.type.matches('real')).toBe(true);
  });
});

//
// §6 — the compiled lane
//

describe('ERROR-MODEL §6 — compiled lane must agree with the interpreter (fail-closed)', () => {
  const ce = new ComputeEngine();

  test('Mod(x, y) compiles, and the compiled marker case agrees with the interpreter', () => {
    const result = compiled(ce.box(['Mod', 'x', 'y']));
    expect(result.success).toBe(true);
    // The interpreter answers the rule-4 numeric marker; the JavaScript target
    // reaches the same NaN through native IEEE arithmetic.
    expect(isNaNValue(ce, ce.box(['Mod', 1, 0]).N())).toBe(true);
    expect(result.run({ x: 1, y: 0 })).toBeNaN();
    expect(result.run({ x: 5, y: 3 })).toBe(2);
    // A NaN entering a propagating slot comes out as NaN, at no cost: IEEE
    // propagation is native to every float target (ERROR-MODEL §6).
    expect(result.run({ x: NaN, y: 2 })).toBeNaN();
  });

  test('NaN propagates through a compiled arithmetic expression exactly as it does in the interpreter', () => {
    const result = compiled(ce.box(['Add', ['Sin', 'x'], 1]));
    expect(result.success).toBe(true);
    expect(result.run({ x: NaN })).toBeNaN();
    expect(isNaNValue(ce, ce.box(['Add', ['Sin', 'NaN'], 1]).N())).toBe(true);
  });

  test('NaN absorbs through a compiled Max, as it does in the interpreter', () => {
    const result = compiled(ce.box(['Max', 'x', 3]));
    expect(result.success).toBe(true);
    expect(result.run({ x: NaN })).toBeNaN();
    expect(isNaNValue(ce, ce.box(['Max', 'NaN', 3]).N())).toBe(true);
  });

  test('an out-of-band access compiles to the interpreter NaN marker, not to undefined', () => {
    const result = compiled(ce.box(['At', ['List', 1, 2], 99]));
    expect(result.success).toBe(true);
    expect(result.run({})).toBeNaN();
    expect(isNaNValue(ce, ce.box(['At', ['List', 1, 2], 99]).N())).toBe(true);
  });

  test('an error-carrying expression DECLINES to compile rather than emitting plausible code', () => {
    // Fail-closed: the target cannot represent a boxed `Error`, so it declines
    // with a structured diagnostic instead of quietly reinterpreting the error
    // as a throw, a NaN, or an ordinary value (ERROR-MODEL §6).
    const result = compiled(ce.box(['Sin', { str: 'banana' }]));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot compile invalid expression');
  });

  test('IsPrime declines on the JavaScript target — a missing lowering fails closed', () => {
    const result = compiled(ce.box(['IsPrime', 'x']));
    expect(result.success).toBe(false);
    expect(result.error).toContain('no lowering');
  });

  test('Heaviside(0) agrees between the compiled lane and the interpreter', () => {
    const result = compiled(ce.box(['Heaviside', 'x']));
    expect(result.success).toBe(true);
    expect(result.run({ x: -1 })).toBe(0);
    expect(result.run({ x: 0 })).toBe(0.5);
    expect(result.run({ x: 1 })).toBe(1);
    expect(ce.box(['Heaviside', -1]).N().re).toBe(0);
    expect(ce.box(['Heaviside', 0]).N().re).toBe(0.5);
    expect(ce.box(['Heaviside', 1]).N().re).toBe(1);
  });
});

//
// Documented conformance gaps
//

describe('documented conformance gaps (ERROR-MODEL §7) — pinned as CURRENT behavior; changing these requires ratification', () => {
  const ce = new ComputeEngine();

  describe('Sin(NaN) stays inert under evaluate() and only numericizes under N()', () => {
    for (const { route, expr } of routes(
      ce,
      ['Sin', 'NaN'],
      '\\sin(\\operatorname{NaN})',
      'Sin',
      () => [ce.NaN]
    )) {
      // The model says this should be `NaN` under `evaluate()` too: NaN is a
      // float, and by the exactness contract a numeric function of an inexact
      // argument numericizes under plain `evaluate()`; the per-slot `propagate`
      // policy of ERROR-MODEL §4 says the same, and the aggregates already do
      // it (`Max(1, NaN, 3) → NaN`).
      test(`[${route}] evaluate() leaves sin(NaN) unreduced; N() gives NaN`, () => {
        expect(isUnreduced(expr.evaluate(), 'Sin')).toBe(true);
        expect(isNaNValue(ce, expr.N())).toBe(true);
      });
    }
  });

  describe('Heaviside(NaN) is inert even under N()', () => {
    for (const { route, expr } of routes(
      ce,
      ['Heaviside', 'NaN'],
      '\\operatorname{Heaviside}(\\operatorname{NaN})',
      'Heaviside',
      () => [ce.NaN]
    )) {
      // Same class as `Sin(NaN)` but a stricter symptom: the model says this
      // should evaluate to `NaN`, because leaving it inert makes inertness the
      // terminal answer to a decidable question, which ERROR-MODEL §1 forbids.
      test(`[${route}] both evaluate() and N() leave Heaviside(NaN) unreduced`, () => {
        expect(isUnreduced(expr.evaluate(), 'Heaviside')).toBe(true);
        expect(isUnreduced(expr.N(), 'Heaviside')).toBe(true);
      });
    }
  });

  test('compile(Heaviside)(NaN) answers 1 while the interpreter stays inert — a fail-closed violation', () => {
    // CONFIRMED here, having been only "reported, not yet reproduced" in
    // ERROR-MODEL §7. The JavaScript target lowers `Heaviside` to
    // `(x) => (x < 0 ? 0 : x === 0 ? 0.5 : 1)` (`javascript-target.ts`), whose
    // final branch catches NaN because both comparisons are false for it. The
    // compiled lane therefore produces a plausible but different value —
    // exactly the class ERROR-MODEL §6 and `docs/COMPILATION-MODEL.md`
    // prohibit. Pinned, not fixed: the fix belongs with the ratification of
    // the NaN-policy package, since it must decide whether the answer is `NaN`
    // (per-slot propagate) or a decline.
    const result = compiled(ce.box(['Heaviside', 'x']));
    expect(result.success).toBe(true);
    expect(result.run({ x: NaN })).toBe(1);

    const interpreted = ce.box(['Heaviside', 'NaN']).N();
    expect(isUnreduced(interpreted, 'Heaviside')).toBe(true);
    expect(isNaNValue(ce, interpreted)).toBe(false);
  });

  test('compile(1/x)(0) answers Infinity while the interpreter answers ~oo', () => {
    // A second compiled-lane divergence, not listed in ERROR-MODEL §7. The
    // interpreter's `1/0` is projective infinity (§2 rule 3); the JavaScript
    // target has only IEEE's signed `Infinity`, which is a different point.
    // Pinned so the eventual ruling on `~oo` (§7 open question "Where does ~oo
    // belong?") sees it.
    const result = compiled(ce.box(['Divide', 1, 'x']));
    expect(result.success).toBe(true);
    expect(result.run({ x: 0 })).toBe(Infinity);
    expect(ce.box(['Divide', 1, 0]).N().isSame(ce.ComplexInfinity)).toBe(true);
  });

  describe('the IsPrime family stays inert on arguments whose primality is decidable', () => {
    const probes: [string, any, string, () => Expression[]][] = [
      [
        'IsPrime(3.5)',
        ['IsPrime', 3.5],
        '\\operatorname{IsPrime}(3.5)',
        () => [ce.box(3.5)],
      ],
      [
        'IsPrime(pi)',
        ['IsPrime', 'Pi'],
        '\\operatorname{IsPrime}(\\pi)',
        () => [ce.box('Pi')],
      ],
      [
        'IsPrime(i)',
        ['IsPrime', 'ImaginaryUnit'],
        '\\operatorname{IsPrime}(i)',
        () => [ce.box('ImaginaryUnit')],
      ],
      [
        'IsPrime(NaN)',
        ['IsPrime', 'NaN'],
        '\\operatorname{IsPrime}(\\operatorname{NaN})',
        () => [ce.NaN],
      ],
    ];
    for (const [label, json, latex, ops] of probes) {
      for (const { route, expr } of routes(ce, json, latex, 'IsPrime', ops)) {
        // A membership predicate is a claim "x ∈ S", so `False` is a SUCCESS
        // value: "3.5 is not prime" is a well-formed true sentence. Under
        // ERROR-MODEL §4 all four of these should answer `False`. Today they
        // stay inert, which §1 forbids as a terminal answer to a decidable
        // question. (`IsPrime(~oo)` is the deliberate exception the model
        // wants as an `Error`, since `~oo` lies outside the `complex` carrier.)
        test(`[${route}] ${label} is inert under evaluate() and N(), where the model wants False`, () => {
          expect(isUnreduced(expr.evaluate(), 'IsPrime')).toBe(true);
          expect(isUnreduced(expr.N(), 'IsPrime')).toBe(true);
          expect(expr.type.toString()).toBe('boolean');
        });
      }
    }
  });

  test('IsPrime(~oo) is inert too, where the model wants an Error (outside the complex carrier)', () => {
    const expr = ce.box(['IsPrime', 'ComplexInfinity']);
    expect(isUnreduced(expr.evaluate(), 'IsPrime')).toBe(true);
  });

  test('IsPrime still decides the ordinary cases, so the inertness above is not a blanket decline', () => {
    expect(symbolName(ce.box(['IsPrime', 7]).evaluate())).toBe('True');
    expect(symbolName(ce.box(['IsPrime', 1]).evaluate())).toBe('False');
    // `IsPrime(-7)` is the §7 open question on per-operator conventions
    // (Mathematica accepts negatives, SymPy does not); CE currently decides
    // neither and stays inert.
    expect(isUnreduced(ce.box(['IsPrime', -7]).evaluate(), 'IsPrime')).toBe(
      true
    );
  });

  test('a string operand of IsPrime is still the wanted boxing Error, not a total-predicate False', () => {
    // The carrier does NOT widen to `any`: for a string the question is type
    // confusion, not membership (ERROR-MODEL §4, with Mathematica's
    // `PrimeQ["banana"] → False` as the cautionary tale). This part conforms.
    const expr = ce.box(['IsPrime', { str: 'banana' }]);
    expect(errorCode(operand(expr, 1))).toBe('incompatible-type');
  });

  describe('If(True, 5, err) evaluates to the error rather than taking the selected arm', () => {
    for (const { route, expr } of routes(
      ce,
      ['If', 'True', 5, ['Sin', { str: 'banana' }]],
      '\\operatorname{If}(\\operatorname{True}, 5, \\sin(\\text{banana}))',
      'If',
      () => [ce.box('True'), ce.box(5), ce.box(['Sin', { str: 'banana' }])]
    )) {
      // Under the demanded-operands amendment of ERROR-MODEL §3 this should
      // evaluate to `5`: an error in an arm a lazy operator never demands is
      // dead code — static analysis sees it, evaluation does not execute it —
      // and the boxed form keeps the diagnostic either way. Today the error
      // bubbles from the unselected arm.
      test(`[${route}] the boxed form keeps the error in place and evaluate() returns it`, () => {
        expect(expr.operator).toBe('If');
        expect(operandsOf(expr)).toHaveLength(3);
        expect(expr.isValid).toBe(false);
        expect(isErrorValue(expr.evaluate())).toBe(true);
        expect(isErrorValue(expr.N())).toBe(true);
      });
    }
  });

  test('a lazy operator DOES take the selected arm when the unselected one is merely exceptional', () => {
    // The bubbling above is specific to the `Error` channel: an unselected arm
    // that would evaluate to `~oo` is genuinely never evaluated, on both the
    // box and the ce.function route.
    expect(
      ce
        .box(['If', 'True', 5, ['Divide', 1, 0]])
        .evaluate()
        .isSame(5)
    ).toBe(true);
    expect(
      ce
        .function('If', [ce.box('True'), ce.box(5), ce.box(['Divide', 1, 0])])
        .evaluate()
        .isSame(5)
    ).toBe(true);
  });

  test('a selection with no selected value answers Missing, on both operators', () => {
    // Ruled 2026-08-27: a selection with no selected branch answers `Missing`,
    // the position-preserving absent datum — unconditionally, not the
    // type-directed marker of the arms. Before the ruling the two control
    // structures disagreed: `Which` answered `Undefined` (a "no answer"
    // citizen invented before the absence ruling) and the else-less `If`
    // answered `Nothing`, the splicing erasure marker §1 forbids for a failed
    // selection. The masking `Undefined` of the `When` operator is a separate,
    // deliberate contract (plot consumers skip masked points) and is
    // unchanged.
    expect(symbolName(ce.box(['Which']).evaluate())).toBe('Missing');
    expect(symbolName(ce.box(['If', 'False', 5]).evaluate())).toBe('Missing');
    expect(symbolName(ce.box(['Which', 'False', 1]).evaluate())).toBe(
      'Missing'
    );
    expect(symbolName(ce.box(['When', 5, 'False']).evaluate())).toBe(
      'Undefined'
    );
  });
});
