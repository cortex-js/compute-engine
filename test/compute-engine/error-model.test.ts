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
 * every expectation below passes against the tree as it stands.
 *
 * The block at the bottom held the documented §7 GAPS — rows where the model
 * asked for something the engine did not yet do. The 2026-08-27 rulings
 * settled every one of them that this suite covered, so those rows are now
 * ordinary conformance pins, grouped under the rule that decides each. A new
 * gap, if one is opened again, goes back into a clearly labelled block naming
 * the eventual behavior.
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
        expect(expr.type.toString()).toBe('signed_infinity');
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

  test('~oo, NaN and the directed infinities all sit outside `complex`', () => {
    // The finite-by-default numeric flip (roadmap §8.2, ruling L1) replaced the
    // 2026-08-21 placement this used to pin: the bare numeric names hold only
    // finite values, so every non-finite value is outside `complex` and its
    // subtree, and each has a name of its own. The channel taxonomy of
    // ERROR-MODEL §1 rests on the separation, which is now sharper rather than
    // weaker.
    for (const value of [ce.ComplexInfinity, ce.NaN]) {
      expect(value.type.matches('number')).toBe(true);
      expect(value.type.matches('complex')).toBe(false);
      expect(value.type.matches('real')).toBe(false);
    }
    expect(ce.ComplexInfinity.type.matches('infinity')).toBe(true);
    expect(ce.NaN.type.matches('nan')).toBe(true);
    // The directed infinities are no longer ordinary values of `real`: they
    // inhabit `infinity`, through the signed pair `signed_infinity`.
    expect(ce.PositiveInfinity.type.matches('real')).toBe(false);
    expect(ce.PositiveInfinity.type.matches('signed_infinity')).toBe(true);
    expect(ce.PositiveInfinity.type.matches('infinity')).toBe(true);
    // The extended real line is spelled out as a union.
    expect(ce.PositiveInfinity.type.matches('real | infinity')).toBe(true);
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
// Rows CLOSED by the ratified numeric-lattice package
//
// Each row below was a documented §7 gap until the rulings of 2026-08-27
// (`docs/plans/2026-08-26-numeric-lattice-ratification-brief.md`) settled what
// the answer should be. They are ordinary conformance pins now: the comment on
// each says which rule decides it.
//

describe('ERROR-MODEL §4 — a NaN argument PROPAGATES through a numeric operator', () => {
  const ce = new ComputeEngine();
  const isTypeError = (e: any) => e.operator === 'Error';

  describe('Sin(NaN) evaluates to NaN, not just under N()', () => {
    for (const { route, expr } of routes(
      ce,
      ['Sin', 'NaN'],
      '\\sin(\\operatorname{NaN})',
      'Sin',
      () => [ce.NaN]
    )) {
      // `NaN` is a FLOAT, so by the exactness contract a numeric function of
      // it has no exactness to preserve and numericizes under plain
      // `evaluate()`; the per-slot `propagate` policy of ERROR-MODEL §4 says
      // the same, and the aggregates already did it (`Max(1, NaN, 3) → NaN`).
      // The fix is at the shared exactness test — `BoxedNumber.isExact` no
      // longer calls `NaN` exact — so the whole numeric family conforms at
      // once, not `Sin` alone (see the family row below).
      test(`[${route}] both evaluate() and N() answer NaN`, () => {
        expect(isNaNValue(ce, expr.evaluate())).toBe(true);
        expect(isNaNValue(ce, expr.N())).toBe(true);
      });
    }
  });

  test('the whole numeric family propagates NaN under evaluate(), not just Sin', () => {
    const ce2 = new ComputeEngine();
    for (const head of [
      'Sin',
      'Cos',
      'Tan',
      'Exp',
      'Ln',
      'Sqrt',
      'Arctan',
      'Sinh',
      'Abs',
      'Gamma',
      'Floor',
      'Round',
      'Erf',
    ]) {
      const value = ce2.box([head, 'NaN']).evaluate();
      expect([head, isNaNValue(ce2, value)]).toEqual([head, true]);
    }
  });

  test('the multi-argument heads propagate NaN too', () => {
    // These reach their kernels through `apply2`, whose real branch SKIPPED a
    // NaN operand outright: with no result to box, the application came back
    // as itself. That reads a propagated NaN as the kernels' "outside my
    // implemented domain" signal, which it is not — a NaN that was already in
    // an argument is the indeterminate value flowing through. `apply2` now
    // answers `NaN` up front, as `applyN` already did.
    const ce2 = new ComputeEngine();
    const cases: [string, any][] = [
      ['Root(NaN, 3)', ['Root', 'NaN', 3]],
      ['Mod(NaN, 2)', ['Mod', 'NaN', 2]],
      ['Binomial(NaN, 2)', ['Binomial', 'NaN', 2]],
      ['Power(2, NaN)', ['Power', 2, 'NaN']],
      ['Power(NaN, 2)', ['Power', 'NaN', 2]],
    ];
    for (const [label, json] of cases) {
      expect([label, isNaNValue(ce2, ce2.box(json).evaluate())]).toEqual([
        label,
        true,
      ]);
      expect([label, isNaNValue(ce2, ce2.box(json).N())]).toEqual([label, true]);
    }
  });

  test('the heads that compute without a kernel dispatcher carry their own NaN arm', () => {
    // `Factorial` computes Γ(x+1) itself and `GCD`/`LCM` fold integers
    // directly, so neither inherits the dispatcher guard above. Both used to
    // defer a NaN operand to their non-finite / non-integer symbolic tail and
    // come back inert.
    const ce2 = new ComputeEngine();
    for (const json of [
      ['Factorial', 'NaN'],
      ['Factorial2', 'NaN'],
      ['GCD', 'NaN', 2],
      ['LCM', 'NaN', 2],
    ] as any[]) {
      const label = JSON.stringify(json);
      expect([label, isNaNValue(ce2, ce2.box(json).evaluate())]).toEqual([
        label,
        true,
      ]);
    }
    // The counterweight: GCD/LCM still fold and still stay symbolic where they
    // should.
    expect(ce2.box(['GCD', 12, 18]).evaluate().isSame(6)).toBe(true);
    expect(ce2.box(['LCM', 4, 6]).evaluate().isSame(12)).toBe(true);
    expect(isUnreduced(ce2.box(['GCD', 'x', 2]).evaluate(), 'GCD')).toBe(true);
  });

  test('an EXACT argument still stays symbolic — the fix did not numericize everything', () => {
    // The counterweight to the row above: the exactness contract is unchanged
    // for values that HAVE exactness to preserve. Only `NaN` moved from the
    // exact side of the test to the inexact one.
    const ce2 = new ComputeEngine();
    expect(isUnreduced(ce2.box(['Sin', 2]).evaluate(), 'Sin')).toBe(true);
    expect(isUnreduced(ce2.box(['Ln', 2]).evaluate(), 'Ln')).toBe(true);
    expect(ce2.box(['Sin', 5.1]).evaluate().isNumberLiteral).toBe(true);
  });

  describe('Heaviside(NaN) answers NaN under evaluate() AND N()', () => {
    for (const { route, expr } of routes(
      ce,
      ['Heaviside', 'NaN'],
      '\\operatorname{Heaviside}(\\operatorname{NaN})',
      'Heaviside',
      () => [ce.NaN]
    )) {
      // Same propagate class as `Sin(NaN)`, but `Heaviside`'s handler is a
      // sign dispatch rather than a numeric kernel: all three of its sign
      // tests are `false` for `NaN`, so the shared exactness fix does not
      // reach it. The generic NaN-policy gate owns the answer now (the
      // Phase F flip declared `nanBehavior: 'propagate'` on the precise
      // carrier and the handler's own `NaN` arm was dropped). Leaving it
      // inert made inertness the terminal answer to a decidable question,
      // which ERROR-MODEL §1 forbids.
      test(`[${route}] both evaluate() and N() answer NaN`, () => {
        expect(isNaNValue(ce, expr.evaluate())).toBe(true);
        expect(isNaNValue(ce, expr.N())).toBe(true);
      });
    }
  });

  test('Sign(NaN) propagates too — the same sign-dispatch handler shape', () => {
    // `Sign` took the same Phase F flip as `Heaviside`: the precise carrier
    // `(real | signed_infinity)` with `nanBehavior: 'propagate'`, so the
    // generic gate — not a handler arm — answers `NaN` here.
    const ce2 = new ComputeEngine();
    expect(isNaNValue(ce2, ce2.box(['Sign', 'NaN']).evaluate())).toBe(true);
    // The finite and infinite arms are unchanged for both operators.
    expect(ce2.box(['Heaviside', -1]).evaluate().isSame(0)).toBe(true);
    expect(ce2.box(['Heaviside', 0]).evaluate().isSame(ce2.Half)).toBe(true);
    expect(
      ce2.box(['Heaviside', 'PositiveInfinity']).evaluate().isSame(1)
    ).toBe(true);
    expect(ce2.box(['Sign', -3]).evaluate().isSame(-1)).toBe(true);
    expect(ce2.box(['Sign', 'PositiveInfinity']).evaluate().isSame(1)).toBe(
      true
    );
  });

  test('the rounding family propagates NaN through the gate and rejects off-carrier operands', () => {
    // Phase F flip of the order-dependent family: each of
    // `Floor`/`Ceil`/`Round`/`Truncate` declares
    // `(real | signed_infinity)` with `nanBehavior: 'propagate'`, so a
    // `NaN` argument is admitted and propagated by the generic gate,
    // `±∞` maps to itself, and a proven off-carrier operand (a complex
    // value, `~oo`) is a boxing error.
    const ce2 = new ComputeEngine();
    for (const op of ['Floor', 'Ceil', 'Round', 'Truncate']) {
      expect(isNaNValue(ce2, ce2.box([op, 'NaN']).evaluate())).toBe(true);
      expect(isNaNValue(ce2, ce2.box([op, 'NaN']).N())).toBe(true);
      expect(
        ce2.box([op, 'PositiveInfinity']).evaluate().isInfinity
      ).toBe(true);
      expect(ce2.box([op, ['Complex', 1, 2]]).isValid).toBe(false);
      expect(ce2.box([op, 'ComplexInfinity']).isValid).toBe(false);
    }
    // The IEEE arm of the comparisons is a declared `handle` now — the
    // handler answers `False` for an unordered `NaN`, a success value.
    expect(ce2.box(['Less', 1, 'NaN']).evaluate().symbol).toBe('False');
    expect(ce2.box(['LessEqual', 'NaN', 1]).evaluate().symbol).toBe('False');
  });

  test('the complex-extension family: precise carriers; ~oo errors where there is no value, folds where there is', () => {
    // Phase F flip (ruled 2026-08-31): `Sqrt`/`Ln`/`Erf` declare
    // `(complex | signed_infinity)` (their values at ±∞ are genuine:
    // `√+∞ = +∞`, `Ln +∞ = +∞`, `Erf(±∞) = ±1`), and `Sin`/`Arcsin`
    // declare `(complex)` — no value at ANY infinity. `~oo` is
    // off-carrier for all five. Where the error lands differs by seam,
    // and the seam is part of the pin: `Erf` validates at BOXING;
    // `Sqrt`/`Ln` fast-path canonicalization, so the dispatch-time
    // conformance re-test answers the error at EVALUATION; `Sin`/`Arcsin`
    // have a `canonical` handler that bypasses both, so their factory
    // enforces the carrier in the evaluate handler (the tracked timing
    // deviation of `docs/SIGNATURE-GUIDELINES.md` §4).
    const ce2 = new ComputeEngine();
    // NaN propagates for the whole family, on evaluate AND N.
    for (const op of ['Sqrt', 'Ln', 'Erf', 'Sin', 'Arcsin']) {
      expect(isNaNValue(ce2, ce2.box([op, 'NaN']).evaluate())).toBe(true);
      expect(isNaNValue(ce2, ce2.box([op, 'NaN']).N())).toBe(true);
    }
    // ~oo where the head has NO value (`Erf` oscillates; `Sin`/`Arcsin`
    // have no limit): boxing error where validation runs, evaluate-time
    // error elsewhere — an Error either way, on both routes.
    expect(ce2.box(['Erf', 'ComplexInfinity']).isValid).toBe(false);
    for (const op of ['Sin', 'Arcsin']) {
      expect(isTypeError(ce2.box([op, 'ComplexInfinity']).evaluate())).toBe(
        true
      );
      expect(isTypeError(ce2.box([op, 'ComplexInfinity']).N())).toBe(true);
    }
    // ~oo where the head HAS a value: `√(~oo) = ~oo` and `Ln(~oo) = ~oo`
    // — the modulus grows without bound in every direction of approach
    // (ruled 2026-09-01, reversing the 2026-08-31 uniformity choice that
    // made them errors; the same rule gives `Power(~oo, 1/2) = ~oo`).
    // `Ln(~oo)` used to DIVERGE between routes (evaluate → NaN, N → an
    // arbitrary ∞ + iπ/4); both routes agree on the value now.
    for (const op of ['Sqrt', 'Ln']) {
      expect(
        ce2.box([op, 'ComplexInfinity']).evaluate().isSame(ce2.ComplexInfinity)
      ).toBe(true);
      expect(
        ce2.box([op, 'ComplexInfinity']).N().isSame(ce2.ComplexInfinity)
      ).toBe(true);
    }
    // Sin/Arcsin at ±∞: no value, no limit → error (was
    // symbolic-then-NaN).
    for (const op of ['Sin', 'Arcsin']) {
      expect(isTypeError(ce2.box([op, 'PositiveInfinity']).evaluate())).toBe(
        true
      );
      expect(isTypeError(ce2.box([op, 'NegativeInfinity']).N())).toBe(true);
    }
    // The genuine extended values are unchanged.
    expect(ce2.box(['Sqrt', 'PositiveInfinity']).evaluate().isSame(ce2.PositiveInfinity)).toBe(true);
    expect(ce2.box(['Erf', 'PositiveInfinity']).evaluate().isSame(1)).toBe(
      true
    );
    expect(ce2.box(['Erf', 'NegativeInfinity']).evaluate().isSame(-1)).toBe(
      true
    );
    expect(
      ce2.box(['Ln', 0]).evaluate().isSame(ce2.NegativeInfinity)
    ).toBe(true);
    // The sharp NaN types where the handler declines for a proven NaN.
    expect(ce2.box(['Sqrt', 'NaN']).type.toString()).toBe('nan');
    expect(ce2.box(['Erf', 'NaN']).type.toString()).toBe('nan');
  });

  test('the remaining complex-extension heads: per-head carriers from the mathematical domain', () => {
    // Phase F batch 5 (ruled 2026-09-01). Every head keeps NaN
    // propagation; the carrier — hence which infinities error and which
    // fold to genuine values — is decided per head:
    //
    // - `(complex)`: the circular functions and `Arccos` have no value at
    //   ANY infinity (they oscillate toward the real infinities; the
    //   inverses diverge). Enforced, like `Sin`, in the trig factory's
    //   evaluate arm (its `canonical` handler bypasses boxing validation).
    // - `(complex | signed_infinity)`: genuine values at `±∞` only —
    //   the hyperbolics and most inverse hyperbolics, plus
    //   `Erfc`/`Sinc`/`FresnelS`/`FresnelC` (which validate at BOXING —
    //   no canonical handler in the way).
    // - `(complex | infinity)`: `Arcsec`/`Arccsc`/`Arcoth`/`Arcsch` have
    //   the SAME genuine value in every direction of infinity (they
    //   compose through 1/x and the inner inverse head is continuous at
    //   0), so `~oo` is in-carrier too.
    const ce2 = new ComputeEngine();
    const POS = 'PositiveInfinity';
    const NEG = 'NegativeInfinity';
    const COO = 'ComplexInfinity';

    // Group 1 — no value at any infinity: error on both routes at the
    // evaluate seam (was symbolic-then-NaN).
    for (const op of ['Cos', 'Tan', 'Cot', 'Csc', 'Sec', 'Arccos']) {
      expect(isTypeError(ce2.box([op, POS]).evaluate())).toBe(true);
      expect(isTypeError(ce2.box([op, NEG]).N())).toBe(true);
      expect(isTypeError(ce2.box([op, COO]).evaluate())).toBe(true);
      expect(isNaNValue(ce2, ce2.box([op, 'NaN']).evaluate())).toBe(true);
    }
    // The circular poles are in-carrier finite points valued `~oo` still.
    expect(
      ce2.parse('\\tan(\\pi/2)').evaluate().isSame(ce2.ComplexInfinity)
    ).toBe(true);

    // Group 2 — genuine values at ±∞ (exact, on BOTH routes — several
    // were NaN-by-kernel-artifact before: `Arsinh(−∞)`, `Arcoth(±∞)`,
    // `Artanh(±∞)`, `Arsech(±∞)`); `~oo` errors.
    const expectVal = (op: string, arg: string, v: any) => {
      expect(ce2.box([op, arg]).evaluate().isSame(v)).toBe(true);
    };
    expectVal('Sinh', POS, ce2.PositiveInfinity);
    expectVal('Sinh', NEG, ce2.NegativeInfinity);
    expectVal('Cosh', NEG, ce2.PositiveInfinity);
    expectVal('Tanh', POS, 1);
    expectVal('Tanh', NEG, -1);
    expectVal('Coth', NEG, -1);
    expectVal('Sech', POS, 0);
    expectVal('Csch', NEG, 0);
    expectVal('Arsinh', NEG, ce2.NegativeInfinity);
    expectVal('Arccot', POS, 0);
    expectVal('Arccot', NEG, ce2.Pi);
    // The imaginary asymptote values (ruled 2026-09-01): continuations of
    // the engine's own principal branch.
    expect(
      ce2.box(['Artanh', POS]).evaluate().isSame(ce2.I.mul(ce2.Pi).div(-2))
    ).toBe(true);
    expect(
      ce2.box(['Arsech', NEG]).evaluate().isSame(ce2.I.mul(ce2.Pi).div(2))
    ).toBe(true);
    // `Arcosh(−∞) = ∞ + iπ` follows the `Ln(−∞)` treatment: symbolic
    // under evaluate(), machine complex under .N().
    expect(ce2.box(['Arcosh', NEG]).evaluate().operator).toBe('Arcosh');
    const acosh = ce2.box(['Arcosh', NEG]).N();
    expect(acosh.re).toBe(Infinity);
    expect(acosh.im).toBeCloseTo(Math.PI, 12);
    for (const op of ['Sinh', 'Tanh', 'Arsinh', 'Arcosh', 'Artanh', 'Arsech', 'Arccot']) {
      expect(isTypeError(ce2.box([op, COO]).evaluate())).toBe(true);
      expect(isNaNValue(ce2, ce2.box([op, 'NaN']).evaluate())).toBe(true);
    }

    // Group 3 — the same genuine value in EVERY direction of infinity:
    // `~oo` folds too (`Arcsec(~oo)` used to answer a machine float even
    // under evaluate(); it is the exact π/2 now).
    expectVal('Arcsec', COO, ce2.Pi.div(2));
    expectVal('Arcsec', POS, ce2.Pi.div(2));
    expectVal('Arccsc', COO, 0);
    expectVal('Arcoth', COO, 0);
    expectVal('Arcoth', POS, 0);
    expectVal('Arcsch', NEG, 0);
    expectVal('Arcsch', COO, 0);

    // The boxing-seam quartet: ±∞ values unchanged, `~oo` invalid at
    // boxing (was inert), NaN propagates.
    expectVal('Erfc', POS, 0);
    expectVal('Erfc', NEG, 2);
    expectVal('Sinc', POS, 0);
    expectVal('FresnelS', NEG, ce2.Half.neg());
    expectVal('FresnelC', POS, ce2.Half);
    for (const op of ['Erfc', 'Sinc', 'FresnelS', 'FresnelC']) {
      expect(ce2.box([op, COO]).isValid).toBe(false);
      expect(isNaNValue(ce2, ce2.box([op, 'NaN']).evaluate())).toBe(true);
    }
  });

  test('the simplify route agrees with the flipped evaluate semantics at infinities', () => {
    // The simplify rules used to rewrite these to NaN, contradicting the
    // carriers: a head with NO value at an infinity now DECLINES under
    // simplify (the evaluate route owns the incompatible-type error), and
    // a head WITH a value folds the same value on both routes.
    const ce2 = new ComputeEngine();
    // Declines — the expression stays put, no NaN claim.
    expect(ce2.box(['Cos', 'PositiveInfinity']).simplify().operator).toBe(
      'Cos'
    );
    expect(ce2.box(['Arccos', 'NegativeInfinity']).simplify().operator).toBe(
      'Arccos'
    );
    expect(ce2.box(['Arcosh', 'NegativeInfinity']).simplify().operator).toBe(
      'Arcosh'
    );
    expect(ce2.box(['Arccot', 'ComplexInfinity']).simplify().operator).toBe(
      'Arccot'
    );
    // Folds — the ruled values, identical to evaluate().
    expect(
      ce2
        .box(['Artanh', 'PositiveInfinity'])
        .simplify()
        .isSame(ce2.I.mul(ce2.Pi).div(-2))
    ).toBe(true);
    expect(
      ce2
        .box(['Arsech', 'NegativeInfinity'])
        .simplify()
        .isSame(ce2.I.mul(ce2.Pi).div(2))
    ).toBe(true);
    expect(ce2.box(['Arcoth', 'ComplexInfinity']).simplify().isSame(0)).toBe(
      true
    );
  });

  test('inverse-circular values at infinity are angles in the current angular unit', () => {
    // The finite folds already convert (`arctan(1)` answers 45 in degree
    // mode), so the infinite folds must too — they used to answer raw
    // radians. Inverse-HYPERBOLIC values are areas, not angles, and take
    // no conversion.
    const ce2 = new ComputeEngine();
    ce2.angularUnit = 'deg';
    expect(ce2.box(['Arctan', 'PositiveInfinity']).evaluate().isSame(90)).toBe(
      true
    );
    expect(ce2.box(['Arccot', 'NegativeInfinity']).evaluate().isSame(180)).toBe(
      true
    );
    expect(ce2.box(['Arcsec', 'ComplexInfinity']).evaluate().isSame(90)).toBe(
      true
    );
    // Radian mode is unchanged.
    const ce3 = new ComputeEngine();
    expect(
      ce3.box(['Arctan', 'NegativeInfinity']).evaluate().isSame(ce3.Pi.div(-2))
    ).toBe(true);
  });

  test('Power: per-slot carriers — the base admits every infinity, the exponent excludes ~oo', () => {
    // Power signature flip (ruled 2026-09-01):
    // `(complex | infinity, complex | signed_infinity) -> number`, with
    // `Exp`/`Exp2` riding along (they canonicalize to `Power`). `Power`
    // has a custom `canonical` handler, so — like the trig heads —
    // neither boxing validation nor the dispatch-time conformance re-test
    // runs for it: its own EVALUATE handler is the enforcement seam, and
    // the error lands at evaluation on both routes.
    const ce2 = new ComputeEngine();
    const POS = 'PositiveInfinity';
    const NEG = 'NegativeInfinity';
    const COO = 'ComplexInfinity';

    // The EXPONENT slot excludes `~oo`: `b^z` has no value at `z = ~oo`
    // for ANY base — the result depends on the direction of approach in
    // every case. These all answered NaN before the flip.
    for (const base of [2, 0.5, 0, -2, 'ImaginaryUnit', POS, COO]) {
      expect(isTypeError(ce2.box(['Power', base, COO]).evaluate())).toBe(true);
      expect(isTypeError(ce2.box(['Power', base, COO]).N())).toBe(true);
    }
    expect(isTypeError(ce2.box(['Exp', COO]).evaluate())).toBe(true);
    expect(isTypeError(ce2.box(['Exp2', COO]).evaluate())).toBe(true);

    // The BASE slot admits `~oo`: a positive power is `~oo` and a
    // negative power is 0 in every direction of approach. `(~oo)^-1`
    // used to answer NaN through `.inv()`, contradicting both
    // `(~oo)^-2 = 0` and the `Divide` route's `1/~oo = 0`.
    expect(
      ce2.box(['Power', COO, 2]).evaluate().isSame(ce2.ComplexInfinity)
    ).toBe(true);
    expect(ce2.box(['Power', COO, -1]).evaluate().isSame(0)).toBe(true);
    expect(ce2.box(['Power', COO, -2]).evaluate().isSame(0)).toBe(true);

    // A NON-REAL base at a ±∞ exponent folds by its modulus now (it used
    // to stay symbolic under evaluate() while .N() answered NaN — a route
    // divergence): |b| > 1 spirals out to `~oo`, |b| < 1 spirals into 0,
    // and |b| = 1 with b ≠ 1 oscillates on the unit circle — NaN.
    const onePlusI = ['Add', 1, 'ImaginaryUnit'];
    expect(
      ce2.box(['Power', onePlusI, POS]).evaluate().isSame(ce2.ComplexInfinity)
    ).toBe(true);
    expect(ce2.box(['Power', onePlusI, NEG]).evaluate().isSame(0)).toBe(true);
    expect(
      isNaNValue(ce2, ce2.box(['Power', 'ImaginaryUnit', POS]).evaluate())
    ).toBe(true);
    expect(
      isNaNValue(ce2, ce2.box(['Power', 'ImaginaryUnit', POS]).N())
    ).toBe(true);
    // The unit-circle boundary is decided EXACTLY for an exact base —
    // the machine doubles cannot: `(5+12i)/13` has modulus exactly 1
    // (re² + im² computes 1.0000000000000002 in doubles), while
    // `1 + 10⁻¹⁰i` has modulus > 1 (its re² + im² rounds to exactly 1).
    expect(
      isNaNValue(
        ce2,
        ce2
          .box(['Power', ['Divide', ['Complex', 5, 12], 13], POS])
          .evaluate()
      )
    ).toBe(true);
    expect(
      ce2
        .box([
          'Power',
          ['Add', 1, ['Multiply', ['Divide', 1, ['Power', 10, 10]], 'ImaginaryUnit']],
          POS,
        ])
        .evaluate()
        .isSame(ce2.ComplexInfinity)
    ).toBe(true);
    // A FLOAT base within a few ulps of the unit circle answers NaN on
    // both routes — at machine precision the power oscillates, and
    // classifying by the last ulp would amplify a representation
    // artifact into a definite value (√3/2 + 0.5i computes re² + im²
    // as 0.9999999999999999).
    expect(
      isNaNValue(
        ce2,
        ce2
          .box(['Power', ['Complex', Math.sqrt(3) / 2, 0.5], POS])
          .evaluate()
      )
    ).toBe(true);
    expect(
      isNaNValue(
        ce2,
        ce2.box(['Power', ['Complex', Math.sqrt(3) / 2, 0.5], NEG]).N()
      )
    ).toBe(true);

    // NaN PROPAGATES in either slot — never an error. That includes
    // `Power(NaN, ~oo)`, where a NaN base meets the off-carrier exponent:
    // the dispatch-time NaN-propagation gate runs before the evaluate
    // handler's carrier check, so the NaN wins over the domain error
    // (matching IEEE `pow(NaN, x) = NaN`).
    for (const [a, b] of [
      ['NaN', 2],
      [2, 'NaN'],
      ['NaN', 0],
      ['NaN', 'NaN'],
      ['NaN', COO],
      [COO, 'NaN'],
    ] as const) {
      expect(isNaNValue(ce2, ce2.box(['Power', a, b]).evaluate())).toBe(true);
      expect(isNaNValue(ce2, ce2.box(['Power', a, b]).N())).toBe(true);
    }

    // The indeterminate FORMS between admitted operands keep their NaN
    // value, and the genuine extended values are untouched.
    for (const [a, b] of [
      [0, 0],
      [1, POS],
      [POS, 0],
      [COO, 0],
      [-1, POS],
    ] as const) {
      expect(isNaNValue(ce2, ce2.box(['Power', a, b]).evaluate())).toBe(true);
    }
    expect(
      ce2.box(['Power', 2, POS]).evaluate().isSame(ce2.PositiveInfinity)
    ).toBe(true);
    expect(
      ce2.box(['Power', POS, POS]).evaluate().isSame(ce2.PositiveInfinity)
    ).toBe(true);
    expect(
      ce2.box(['Power', 0, -1]).evaluate().isSame(ce2.ComplexInfinity)
    ).toBe(true);
    expect(ce2.box(['Power', 2, NEG]).evaluate().isSame(0)).toBe(true);
    expect(ce2.box(['Exp', POS]).evaluate().isSame(ce2.PositiveInfinity)).toBe(
      true
    );
    expect(ce2.box(['Exp', NEG]).evaluate().isSame(0)).toBe(true);

    // The simplify route DECLINES at the off-carrier exponent (the
    // evaluate route owns the error) — the same route-agreement
    // convention as the trig heads. `Sqrt`/`Ln` FOLD `~oo` under
    // simplify, to the same `~oo` their evaluate route answers (ruled
    // 2026-09-01; between the Power flip and that ruling their simplify
    // twins declined).
    expect(ce2.box(['Power', 2, COO]).simplify().operator).toBe('Power');
    expect(ce2.box(['Sqrt', COO]).simplify().isSame(ce2.ComplexInfinity)).toBe(true);
    expect(ce2.box(['Ln', COO]).simplify().isSame(ce2.ComplexInfinity)).toBe(true);
  });

  test('the elementary remainder: Abs, Log, Arctan, Arctan2, Root declare their domains', () => {
    // Signature flips of 2026-09-01, with four rulings taken first:
    // (1) the modulus rule admits `~oo` wherever the modulus is infinite in
    // every direction — `√(~oo) = ∛(~oo) = ln(~oo) = ~oo`; (2) `Log(x, b)`
    // IS `Ln(x)/Ln(b)` at every point; (3) `Root(x, n)` IS `Power(x, 1/n)`
    // at every point; (4) `Arctan2` takes IEEE `atan2`'s values at the
    // infinite corners. Every pin below holds on evaluate() AND N(); the
    // simplify route agrees where noted.
    const ce2 = new ComputeEngine();
    const POS = 'PositiveInfinity';
    const NEG = 'NegativeInfinity';
    const COO = 'ComplexInfinity';
    const both = (expr: any, check: (v: any) => boolean) => {
      expect(check(ce2.box(expr).evaluate())).toBe(true);
      expect(check(ce2.box(expr).N())).toBe(true);
    };
    const isCoo = (v: any) => v.isSame(ce2.ComplexInfinity);
    const isNaNv = (v: any) => isNaNValue(ce2, v);
    const is = (n: any) => (v: any) => v.isSame(n);

    // Abs: every number except NaN is in the carrier; the modulus of every
    // infinity is +∞; NaN propagates.
    both(['Abs', COO], is(ce2.PositiveInfinity));
    both(['Abs', NEG], is(ce2.PositiveInfinity));
    both(['Abs', 'NaN'], isNaNv);

    // Sqrt / Ln at ~oo: values now (they were errors under the 2026-08-31
    // uniformity choice); `Ln(+∞)` folds under evaluate() (it used to stay
    // symbolic while N() answered +∞).
    both(['Sqrt', COO], isCoo);
    both(['Ln', COO], isCoo);
    both(['Ln', POS], is(ce2.PositiveInfinity));
    expect(ce2.box(['Ln', COO]).simplify().isSame(ce2.ComplexInfinity)).toBe(true);

    // Log(x, b) = Ln(x)/Ln(b): the quotient rule at every exceptional
    // point, identical on all three routes (they disagreed at most of
    // these before: e.g. `Log(8, 1)` was symbolic / +∞ / NaN).
    const logRows: Array<[any, any, (v: any) => boolean]> = [
      [8, 1, isCoo], // ln 8 / 0
      [8, 0, is(0)], // ln 8 / (−∞)
      [8, POS, is(0)],
      [8, NEG, is(0)],
      [8, COO, is(0)],
      [0, ['Rational', 1, 2], is(ce2.PositiveInfinity)], // (−∞)/(−ln 2); was −∞
      [POS, 2, is(ce2.PositiveInfinity)],
      [POS, ['Rational', 1, 2], is(ce2.NegativeInfinity)],
      [POS, POS, isNaNv], // ∞/∞; was 1
      [0, 0, isNaNv], // (−∞)/(−∞); was −∞
      [1, 1, isNaNv], // 0/0
      [COO, 2, isCoo],
      [8, 'NaN', isNaNv],
    ];
    for (const [x, b, check] of logRows) {
      both(['Log', x, b], check);
      expect(check(ce2.box(['Log', x, b]).simplify())).toBe(true);
    }
    // A negative base is a finite complex quotient (N() used to answer NaN).
    const negBase = ce2.box(['Log', 8, -2]).N();
    expect(negBase.re).toBeCloseTo(0.13926097, 6);
    expect(negBase.im).toBeCloseTo(-0.63118087, 6);
    // `Log(−∞, b)` follows `Ln(−∞)`: symbolic under evaluate(), the machine
    // complex `∞ + i·π/ln b` under N() (it used to answer `~oo`).
    expect(ce2.box(['Log', NEG, 10]).evaluate().operator).toBe('Log');
    const negArg = ce2.box(['Log', NEG, 10]).N();
    expect(negArg.re).toBe(Infinity);
    expect(negArg.im).toBeCloseTo(Math.PI / Math.LN10, 10);
    // The Log aliases canonicalize to Log and inherit the values.
    both(['Log2', COO], isCoo);
    both(['Lg', POS], is(ce2.PositiveInfinity));

    // Arctan: `~oo` has no value (the branch ends ±π/2 disagree) and is
    // rejected at BOXING (no canonical handler); `arctan(±i) = ~oo` folds
    // under evaluate() (it used to stay symbolic while N() answered ~oo).
    expect(ce2.box(['Arctan', COO]).isValid).toBe(false);
    both(['Arctan', 'ImaginaryUnit'], isCoo);
    both(['Arctan', ['Negate', 'ImaginaryUnit']], isCoo);
    both(['Arctan', 'NaN'], isNaNv);

    // Arctan2: the IEEE corners (were NaN), the `x = −∞` sign (evaluate()
    // answered π for a negative y), `~oo`/complex rejected at boxing,
    // NaN propagates. Values are angles in the current unit.
    const angle = (expr: any, exact: any, radians: number) => {
      expect(ce2.box(expr).evaluate().isSame(exact)).toBe(true);
      expect(ce2.box(expr).N().re).toBeCloseTo(radians, 12);
    };
    angle(['Arctan2', POS, POS], ce2.Pi.div(4), Math.PI / 4);
    angle(['Arctan2', POS, NEG], ce2.Pi.mul(3).div(4), (3 * Math.PI) / 4);
    angle(['Arctan2', NEG, POS], ce2.Pi.div(-4), -Math.PI / 4);
    angle(['Arctan2', NEG, NEG], ce2.Pi.mul(-3).div(4), (-3 * Math.PI) / 4);
    angle(['Arctan2', -1, NEG], ce2.Pi.neg(), -Math.PI);
    angle(['Arctan2', 0, NEG], ce2.Pi, Math.PI);
    expect(ce2.box(['Arctan2', POS, NEG]).simplify().isSame(ce2.Pi.mul(3).div(4))).toBe(true);
    expect(ce2.box(['Arctan2', 1, COO]).isValid).toBe(false);
    expect(ce2.box(['Arctan2', COO, 1]).isValid).toBe(false);
    both(['Arctan2', 'NaN', POS], isNaNv);
    const deg = new ComputeEngine();
    deg.angularUnit = 'deg';
    expect(deg.box(['Arctan2', POS, NEG]).evaluate().isSame(135)).toBe(true);
    expect(deg.box(['Arctan2', POS, NEG]).simplify().isSame(135)).toBe(true);
    expect(deg.box(['Arctan2', -1, NEG]).simplify().isSame(-180)).toBe(true);

    // Root(x, n) = Power(x, 1/n): index 0 is `x^~oo`, a violated
    // precondition (an Error on both routes; simplify declines); an
    // infinite index is `x^0`; an infinite radicand takes Power's arms.
    both(['Root', 2, 0], (v) => v.operator === 'Error');
    expect(ce2.box(['Root', 2, 0]).simplify().operator).toBe('Root');
    both(['Root', 2, POS], is(1));
    both(['Root', 2, COO], is(1));
    both(['Root', 0, POS], isNaNv); // 0^0; N() used to answer 1
    both(['Root', POS, POS], isNaNv); // ∞^0
    both(['Root', POS, 3], is(ce2.PositiveInfinity)); // used to stay symbolic
    both(['Root', NEG, 3], is(ce2.NegativeInfinity));
    both(['Root', COO, 3], isCoo); // was NaN
    both(['Root', COO, -2], is(0));
    both(['Root', 0, -2], isCoo);
    both(['Root', 2, ['Rational', 1, 2]], is(4)); // 2^2; used to stay symbolic
    both(['Root', 'NaN', 2], isNaNv);
    both(['Root', 2, 'NaN'], isNaNv);
    expect(ce2.box(['Root', 0, POS]).simplify().isSame(ce2.NaN)).toBe(true);

    // An "anonymous" infinity — a complex literal with an infinite
    // component (`∞ + i`), a member of the `infinity` type that neither
    // `isInfinity` nor `isFinite` reports — takes the same rules: its
    // modulus is infinite. A finite bignum beyond the double range
    // (`10^1000`) is NOT one, although its machine projection is
    // `Infinity` (dual-review catch, 2026-09-01).
    const anon = ['Complex', POS, 1];
    both(['Sqrt', anon], is(ce2.PositiveInfinity));
    both(['Sqrt', ['Complex', NEG, 1]], isCoo);
    both(['Log', anon, POS], isNaNv); // ∞/∞
    const huge = ['Power', 10, 1000];
    expect(ce2.box(['Log', NEG, huge]).N().im).toBeCloseTo(
      Math.PI / (1000 * Math.LN10),
      12
    );
    expect(ce2.box(['Sqrt', huge]).evaluate().isSame(ce2.box(['Power', 10, 500]).evaluate())).toBe(true);
    // The exact `i` folds; an exact value a hair off `i` — which projects
    // to the machine double `im === 1` — is a finite point.
    expect(
      ce2
        .box(['Arctan', ['Complex', 0, ['Subtract', 1, ['Power', 2, -54]]]])
        .evaluate().operator
    ).toBe('Arctan');
  });

  test('the Γ and special-function family declare their domains', () => {
    // Signature flips of 2026-09-01 (batch 8), with eight rulings taken
    // first: (1) the Γ-family convention for the whole batch — every
    // numeric slot takes the carrier `complex | infinity` and a point with
    // no limit answers NaN, never a boxing error; (2) the verified limit
    // table (polygammas, Zeta, LambertW, Bessel, Airy, EllipticK/E, Beta,
    // incomplete Γ); (3) LambertW outside a real branch stays symbolic;
    // (4) the Bessel ORDER slot is finite-only; (5) a limit that is an
    // infinite value in a non-real direction is spelled `~oo`; (6) an
    // anonymous infinity (`∞ + i`) answers NaN; (7) the parameter-heavy
    // heads stay symbolic at an infinite operand, except the two cusp
    // values; (8) Ci/Chi take the principal value on the negative axis.
    // Every pin below holds on evaluate() AND N().
    const ce2 = new ComputeEngine();
    const POS = 'PositiveInfinity';
    const NEG = 'NegativeInfinity';
    const COO = 'ComplexInfinity';
    const ANON = ['Complex', POS, 1];
    const both = (expr: any, check: (v: any) => boolean) => {
      expect(check(ce2.box(expr).evaluate())).toBe(true);
      expect(check(ce2.box(expr).N())).toBe(true);
    };
    const isCoo = (v: any) => v.isSame(ce2.ComplexInfinity);
    const isNaNv = (v: any) => isNaNValue(ce2, v);
    const is = (n: any) => (v: any) => v.isSame(n);
    const isPos = is(ce2.PositiveInfinity);
    const isNeg = is(ce2.NegativeInfinity);
    const symbolic = (head: string) => (v: any) => v.operator === head;

    // The Γ family keeps its 2026-08-31 values; an anonymous infinity is
    // NaN on every head now (Factorial2 used to stay inert there).
    for (const h of ['Gamma', 'GammaLn', 'Factorial', 'Factorial2']) {
      both([h, POS], isPos);
      both([h, NEG], isNaNv);
      both([h, COO], isNaNv);
      both([h, ANON], isNaNv);
      both([h, 'NaN'], isNaNv);
    }
    // The incomplete Γ(s, z): `Γ(s, +∞) = 0` (a symbolic s included),
    // `Γ(±∞, z)` for a positive finite z, NaN for the rest.
    both(['Gamma', 2, POS], is(0));
    expect(ce2.parse('\\Gamma(s, \\infty)').evaluate().isSame(0)).toBe(true);
    both(['Gamma', POS, 5], isPos);
    both(['Gamma', NEG, 5], is(0)); // z ≥ 1: the z^s factor vanishes
    both(['Gamma', NEG, 1], is(0));
    both(['Gamma', NEG, ['Rational', 1, 2]], isPos); // 0 < z < 1: it explodes
    both(['Gamma', 2, NEG], isNaNv);
    both(['Gamma', POS, POS], isNaNv);
    both(['Gamma', 2, COO], isNaNv);

    // The polygammas (the ROADMAP item): `ψ(+∞) = +∞`, `ψ⁽ⁿ⁾(+∞) = 0` for
    // n ≥ 1, `~oo` at every pole for every order (the pole used to fold
    // only under N() for Digamma and answered NaN for the others), NaN at
    // −∞, ~oo and an anonymous infinity.
    both(['Digamma', POS], isPos);
    both(['Trigamma', POS], is(0));
    both(['PolyGamma', 2, POS], is(0));
    both(['PolyGamma', 3, POS], is(0));
    for (const x of [0, -1, -7]) {
      both(['Digamma', x], isCoo);
      both(['Trigamma', x], isCoo);
      both(['PolyGamma', 2, x], isCoo);
      // The pole arm needs a KNOWN non-negative order: the kernels reject
      // a negative order, and a symbolic one may be negative.
      both(['PolyGamma', 'm', x], symbolic('PolyGamma'));
      both(['PolyGamma', -2, x], symbolic('PolyGamma'));
    }
    for (const h of [['Digamma'], ['Trigamma'], ['PolyGamma', 2]]) {
      both([...h, NEG], isNaNv);
      both([...h, COO], isNaNv);
      both([...h, ANON], isNaNv);
    }
    // A symbolic order at +∞ depends on the order: stays symbolic.
    both(['PolyGamma', 'm', POS], symbolic('PolyGamma'));
    // No complex kernel: a non-real argument stays symbolic on N() too
    // (PolyGamma(2, 1+2i).N() used to answer ψ₂(1), the imaginary part
    // silently dropped by the two-argument dispatcher).
    both(['PolyGamma', 2, ['Complex', 1, 2]], symbolic('PolyGamma'));

    // Zeta: the pole is `~oo` on both routes (N() answered +∞), `ζ(+∞) = 1`
    // (was NaN), no limit at −∞ (the trivial zeros alternate with huge
    // values), none at ~oo.
    both(['Zeta', 1], isCoo);
    both(['Zeta', POS], is(1));
    both(['Zeta', NEG], isNaNv);
    both(['Zeta', COO], isNaNv);
    both(['Zeta', ANON], isNaNv);

    // Beta: 0 at every infinity against a positive-integer partner (the
    // exact rational form; `Beta(~oo, 2)` answered NaN), 0 at +∞ against a
    // finite partner with a positive real part, NaN otherwise; a non-real
    // finite operand stays symbolic (N() used to answer B(1, 2) for
    // B(1+2i, 2)).
    both(['Beta', COO, 2], is(0));
    both(['Beta', 2, NEG], is(0));
    both(['Beta', POS, ['Rational', 1, 2]], is(0));
    both(['Beta', POS, ['Rational', -1, 2]], isNaNv);
    both(['Beta', NEG, ['Rational', 1, 2]], isNaNv);
    both(['Beta', ANON, 2], isNaNv);
    both(['Beta', ['Complex', 1, 2], 2], symbolic('Beta'));

    // LambertW: `W₀(+∞) = +∞` folds under evaluate() (it folded only under
    // N()); `W₀(−∞)` follows Ln(−∞) — symbolic under evaluate(), `∞ + iπ`
    // under N() (N() used to answer −∞); `W(~oo) = ~oo`; outside a real
    // branch the application stays symbolic (it used to answer NaN).
    both(['LambertW', POS], isPos);
    expect(ce2.box(['LambertW', NEG]).evaluate().operator).toBe('LambertW');
    const wNeg = ce2.box(['LambertW', NEG]).N();
    expect(wNeg.re).toBe(Infinity);
    expect(wNeg.im).toBeCloseTo(Math.PI, 12);
    both(['LambertW', COO], isCoo);
    both(['LambertW', ANON], isNaNv);
    both(['LambertW', -1], symbolic('LambertW'));
    both(['LambertW', ['Rational', 1, 2], -1], symbolic('LambertW'));
    both(['LambertW', NEG, -1], symbolic('LambertW'));

    // Bessel: the ORDER slot is finite-only (a boxing error at ±∞ and ~oo);
    // the argument slot has the verified limits, `~oo` for K at −∞ (the
    // value tends to −i·∞), the poles of Y and K at 0, and NaN at ~oo.
    // The kernels are real, integer-order kernels: a non-integer order, a
    // non-real argument and a negative real argument for Y/K stay
    // symbolic (they answered NaN; a complex argument was evaluated at its
    // real part).
    expect(ce2.box(['BesselJ', POS, 1]).isValid).toBe(false);
    expect(ce2.box(['BesselI', COO, 1]).isValid).toBe(false);
    for (const h of ['BesselJ', 'BesselY']) {
      both([h, 0, POS], is(0));
      both([h, 3, NEG], is(0));
    }
    both(['BesselI', 0, POS], isPos);
    both(['BesselI', 2, NEG], isPos);
    both(['BesselI', 1, NEG], isNeg);
    both(['BesselK', 0, POS], is(0));
    both(['BesselK', 0, NEG], isCoo);
    both(['BesselY', 0, 0], isNeg);
    both(['BesselK', 0, 0], isPos);
    both(['BesselY', 1, 0], isCoo);
    both(['BesselK', 2, 0], isCoo);
    for (const h of ['BesselJ', 'BesselY', 'BesselI', 'BesselK']) {
      both([h, 0, COO], isNaNv);
      both([h, 0, ANON], isNaNv);
      both([h, 0, 'NaN'], isNaNv);
      both([h, 0, ['Complex', 1, 2]], symbolic(h));
      both([h, ['Rational', 1, 2], 1], symbolic(h));
    }
    both(['BesselY', 0, -1], symbolic('BesselY'));
    both(['BesselK', 0, -1], symbolic('BesselK'));

    // Airy: Ai/Ai′ decay at +∞ and Bi/Bi′ grow; at −∞ Ai and Bi decay
    // (amplitude |x|^(−1/4)) while Ai′/Bi′ oscillate with a growing
    // amplitude (no limit); NaN at ~oo. All four answered NaN before.
    both(['AiryAi', POS], is(0));
    both(['AiryAiPrime', POS], is(0));
    both(['AiryBi', POS], isPos);
    both(['AiryBiPrime', POS], isPos);
    both(['AiryAi', NEG], is(0));
    both(['AiryBi', NEG], is(0));
    both(['AiryAiPrime', NEG], isNaNv);
    both(['AiryBiPrime', NEG], isNaNv);
    for (const h of ['AiryAi', 'AiryBi', 'AiryAiPrime', 'AiryBiPrime']) {
      both([h, COO], isNaNv);
      both([h, ANON], isNaNv);
    }

    // The trigonometric integrals: Si keeps ±π/2; Ci/Chi take the
    // PRINCIPAL value on the negative axis (`Ci(−x) = Ci(x) + iπ`; the
    // kernels returned the real part alone), so `Ci(−∞) = iπ` (N()
    // answered 0) and `Chi(−∞)` follows Ln(−∞) (it answered +∞); NaN at
    // ~oo and at an anonymous infinity (Shi/Chi answered ~oo there).
    // (The exact values numericize under N(), per the exactness contract.)
    expect(ce2.box(['SinIntegral', POS]).evaluate().isSame(ce2.Pi.div(2))).toBe(true);
    expect(ce2.box(['SinIntegral', POS]).N().re).toBeCloseTo(Math.PI / 2, 12);
    expect(ce2.box(['CosIntegral', NEG]).evaluate().isSame(ce2.I.mul(ce2.Pi))).toBe(true);
    const ciInf = ce2.box(['CosIntegral', NEG]).N();
    expect(ciInf.re).toBe(0);
    expect(ciInf.im).toBeCloseTo(Math.PI, 12);
    const ciNeg = ce2.box(['CosIntegral', -2]).N();
    expect(ciNeg.re).toBeCloseTo(0.4229808287748649, 12);
    expect(ciNeg.im).toBeCloseTo(Math.PI, 12);
    expect(ce2.box(['CoshIntegral', NEG]).evaluate().operator).toBe(
      'CoshIntegral'
    );
    const chiNeg = ce2.box(['CoshIntegral', NEG]).N();
    expect(chiNeg.re).toBe(Infinity);
    expect(chiNeg.im).toBeCloseTo(Math.PI, 12);
    for (const h of ['SinIntegral', 'CosIntegral', 'SinhIntegral', 'CoshIntegral']) {
      both([h, COO], isNaNv);
      both([h, ANON], isNaNv);
    }
    // A real operand of unknown sign no longer claims a real value for
    // Ci/Chi; a proven non-negative one keeps the extended real line.
    ce2.declare('sgnUnknown', 'real');
    ce2.declare('nonNeg', 'real<0..>');
    expect(ce2.box(['CosIntegral', 'sgnUnknown']).type.toString()).toBe('number');
    expect(ce2.box(['CosIntegral', 'nonNeg']).type.toString()).toBe(
      'real | signed_infinity'
    );

    // Ei and li: `Ei(~oo)` has no value (was symbolic); `li(−∞) = ~oo`
    // (both components of `Ei(ln x + iπ)` diverge; was symbolic).
    both(['ExpIntegralEi', POS], isPos);
    both(['ExpIntegralEi', NEG], is(0));
    both(['ExpIntegralEi', COO], isNaNv);
    both(['ExpIntegralEi', ANON], isNaNv);
    both(['LogIntegral', POS], isPos);
    both(['LogIntegral', NEG], isCoo);
    both(['LogIntegral', COO], isNaNv);
    both(['LogIntegral', -1], symbolic('LogIntegral'));

    // The elliptic integrals: K is 0 at every infinity (it stayed
    // symbolic); the complete E is +∞ at −∞ and `~oo` at +∞ (the value
    // tends to i·∞); the incomplete forms stay symbolic at an infinite
    // operand (`EllipticF(~oo, 1/2)` answered ~oo through the kernel).
    both(['EllipticK', POS], is(0));
    both(['EllipticK', NEG], is(0));
    both(['EllipticK', COO], is(0));
    both(['EllipticK', ANON], isNaNv);
    both(['EllipticE', NEG], isPos);
    both(['EllipticE', POS], isCoo);
    both(['EllipticE', COO], isCoo);
    both(['EllipticF', COO, ['Rational', 1, 2]], symbolic('EllipticF'));
    both(['EllipticE', POS, ['Rational', 1, 2]], symbolic('EllipticE'));
    both(['EllipticPi', COO, ['Rational', 1, 2]], symbolic('EllipticPi'));

    // AGM: +∞ against a positive real partner, `~oo` for a non-real
    // direction (−∞, or ~oo), 0 against a zero partner (zero annihilates
    // the AGM), NaN for two infinities.
    both(['AGM', 1, POS], isPos);
    both(['AGM', 1, NEG], isCoo);
    both(['AGM', 1, COO], isCoo);
    both(['AGM', 0, POS], is(0));
    both(['AGM', COO, 0], is(0));
    both(['AGM', POS, POS], isNaNv);
    // `Liₛ(0) = 0` for every order, an infinite one included; the
    // parameter-heavy heads stay symbolic for an invalid discrete
    // parameter even at an anonymous infinity.
    both(['PolyLog', POS, 0], is(0));
    both(['EisensteinE', 3, ANON], symbolic('EisensteinE'));
    both(['JacobiTheta', 9, ANON, 'ImaginaryUnit'], symbolic('JacobiTheta'));

    // The parameter-heavy heads stay symbolic at an infinite operand
    // (`₁F₁(1; 2; +∞)` answered +∞ by kernel overflow under N()); an
    // anonymous infinity is NaN; the two cusp values of the modular heads
    // (Fungrim 6b9935 and ad9ba2 — `i·∞` boxes to `~oo`).
    both(['Hypergeometric2F1', 1, 1, 2, POS], symbolic('Hypergeometric2F1'));
    both(['Hypergeometric1F1', 1, 2, POS], symbolic('Hypergeometric1F1'));
    both(['PolyLog', 2, COO], symbolic('PolyLog'));
    both(['PolyLog', 0, POS], symbolic('PolyLog')); // the reduction would answer ∞/(1−∞)
    both(['JacobiTheta', 3, POS, 'ImaginaryUnit'], symbolic('JacobiTheta'));
    both(['Hypergeometric2F1', 1, 1, 2, ANON], isNaNv);
    both(['DedekindEta', ['Multiply', 'ImaginaryUnit', POS]], is(0));
    both(['EisensteinE', 4, ['Multiply', 'ImaginaryUnit', POS]], is(1));
    both(['DedekindEta', POS], symbolic('DedekindEta'));
    both(['EisensteinE', 4, ANON], isNaNv);

    // Seams: no head of the batch has a `canonical` handler except
    // `Factorial`, so a proven off-carrier operand is rejected at BOXING
    // (the Bessel order slot above; a string anywhere), and NaN
    // propagates through the dispatch gate on every head.
    expect(ce2.box(['Zeta', { str: 'x' }]).isValid).toBe(false);
    expect(ce2.box(['Factorial', { str: 'x' }]).evaluate().operator).toBe('Error');
    both(['Beta', 'NaN', 2], isNaNv);
    both(['AGM', 1, 'NaN'], isNaNv);
    both(['PolyLog', 'NaN', ['Rational', 1, 2]], isNaNv); // used to stay inert
  });

  test('the complex accessors and the error-function remainder declare their domains', () => {
    // Signature flips of 2026-09-02 (batch 9), with four rulings taken
    // first: (1) the part extractors read the COMPONENTS of an anonymous
    // infinity (`∞ + i`): `Re = +∞`, `Im = 1`, `Arg = 0`, `Conjugate =
    // ∞ − i`; (2) `ComplexRoots` takes a FINITE radicand — an infinite one
    // is a boxing error (it used to answer `[NaN, ~oo]`) — and a positive
    // integer root count, decided by `requires`; (3) `ErfInv` stays
    // SYMBOLIC where the real kernel cannot compute the value (real
    // |x| > 1, a non-real finite x) and answers NaN at every infinity;
    // (4) `AbsArg(NaN)` is the bare marker `NaN`, not `(NaN, NaN)`.
    // Every pin below holds on evaluate() AND N().
    const ce2 = new ComputeEngine();
    const POS = 'PositiveInfinity';
    const NEG = 'NegativeInfinity';
    const COO = 'ComplexInfinity';
    const ANON = ['Complex', POS, 1];
    const ANON_NEG = ['Complex', NEG, 2];
    const both = (expr: any, check: (v: any) => boolean) => {
      expect(check(ce2.box(expr).evaluate())).toBe(true);
      expect(check(ce2.box(expr).N())).toBe(true);
    };
    const isNaNv = (v: any) => isNaNValue(ce2, v);
    const is = (n: any) => (v: any) => v.isSame(n);
    const isPos = is(ce2.PositiveInfinity);
    const isNeg = is(ce2.NegativeInfinity);
    const isCoo = is(ce2.ComplexInfinity);
    // `π` exactly under evaluate(), the float under N().
    const isPi = (v: any) =>
      v.isSame(ce2.Pi) || Math.abs(v.re - Math.PI) < 1e-12;
    const symbolic = (head: string) => (v: any) => v.operator === head;
    const boxError = (expr: any) => {
      const e = ce2.box(expr);
      expect(e.isValid).toBe(false);
      expect(e.evaluate().operator).toBe('Error');
    };

    // `~oo` has no direction, so no real part, no imaginary part and no
    // phase angle: NaN on all three (Real and Imaginary used to answer +∞).
    // The signed infinities keep their axis; an anonymous infinity reads
    // its components (ruling 1). NaN propagates (Imaginary(NaN) used to
    // answer 0).
    for (const h of ['Real', 'Imaginary', 'Argument']) {
      both([h, COO], isNaNv);
      both([h, 'NaN'], isNaNv);
      expect(ce2.box([h, COO]).type.toString()).toBe('nan');
    }
    both(['Real', POS], isPos);
    both(['Real', NEG], isNeg);
    both(['Real', ANON], isPos);
    both(['Real', ANON_NEG], isNeg);
    both(['Imaginary', POS], is(0));
    both(['Imaginary', ANON], is(1));
    both(['Imaginary', ANON_NEG], is(2));
    both(['Argument', POS], is(0));
    both(['Argument', NEG], isPi);
    both(['Argument', ANON], is(0));
    both(['Argument', ANON_NEG], isPi);
    // The aliases follow their targets on every route.
    both(['Re', COO], isNaNv);
    both(['Im', ANON], is(1));
    both(['Arg', ANON_NEG], isPi);

    // Conjugate: a polytype head (`(T) -> T where T: number`), the first to
    // declare `nanBehavior` explicitly (it used to answer an
    // `unexpected-argument` error for NaN, from the derived `reject` of a
    // bare type variable). Its bound stays `number` on purpose — see the
    // definition — so a `number`-typed operand is admitted as before.
    both(['Conjugate', 'NaN'], isNaNv);
    expect(ce2.box(['Conjugate', 'NaN']).type.toString()).toBe('nan');
    both(['Conjugate', POS], isPos);
    both(['Conjugate', NEG], isNeg);
    both(['Conjugate', COO], isCoo);
    const conjAnon = ce2.box(['Conjugate', ANON]).evaluate();
    expect(conjAnon.re).toBe(Infinity);
    expect(conjAnon.im).toBe(-1);
    expect(ce2.box(['Conjugate', ['Sinc', 'z9']]).isValid).toBe(true);
    // The NaN admission reaches the POLYTYPE boxing route too: a NaN
    // literal at a bound the generic solver refuses (`nan` is not below
    // `complex`) is admitted when the declared policy is `propagate`, and
    // the gate answers NaN. Pinned on a declared operator, since no
    // library head spells a strict bound with a NaN policy yet.
    ce2.declare('strictConj9', {
      signature: '(T) -> T where T: complex',
      nanBehavior: 'propagate',
      evaluate: ([x]) => x,
    } as any);
    expect(ce2.box(['strictConj9', 'NaN']).isValid).toBe(true);
    both(['strictConj9', 'NaN'], isNaNv);
    expect(ce2.box(['strictConj9', ['Complex', 1, 2]]).evaluate().im).toBe(2);
    expect(ce2.box(['strictConj9', POS]).isValid).toBe(false);

    // AbsArg: the pair follows Abs and Argument; NaN is the bare marker
    // (ruling 4), typed `nan`; the `~oo` pair is `(+∞, NaN)`, claimed
    // exactly; a may-NaN scalar operand widens the TUPLE codomain with a
    // top-level `| nan` arm, never per cell.
    both(['AbsArg', 'NaN'], isNaNv);
    expect(ce2.box(['AbsArg', 'NaN']).type.toString()).toBe('nan');
    const absArgCoo = ce2.box(['AbsArg', COO]).evaluate();
    expect(absArgCoo.operator).toBe('Tuple');
    expect(absArgCoo.op1.isSame(ce2.PositiveInfinity)).toBe(true);
    expect(isNaNValue(ce2, absArgCoo.op2)).toBe(true);
    expect(ce2.box(['AbsArg', COO]).type.toString()).toBe(
      'tuple<signed_infinity, nan>'
    );
    ce2.declare('u9', 'number');
    expect(ce2.box(['AbsArg', 'u9']).type.matches('nan')).toBe(false);
    expect(
      ce2.box(['AbsArg', 'u9']).type.matches('tuple<real | +oo, real> | nan')
    ).toBe(true);
    expect(
      ce2.box(['AbsArg', 'u9']).type.matches('tuple<number, number>')
    ).toBe(false);
    // Review catches: the sign handlers follow the NaN values (`Real(~oo)`
    // read `re = +∞` as `positive`; `Imaginary(NaN)` read `im = 0` as
    // `zero`); a NaN cell propagates through a broadcast and the lifted
    // claim admits it (`Imaginary([1, NaN])` was typed `vector<real^2>`);
    // and a tuple-valued head broadcast over a list keeps the TUPLE in
    // its type (the lift unwrapped it to a list of numbers, for
    // `NumeratorDenominator` too).
    expect(ce2.box(['Real', COO]).sgn).toBe('unsigned');
    expect(ce2.box(['Imaginary', COO]).sgn).toBe('unsigned');
    expect(ce2.box(['Imaginary', 'NaN']).sgn).toBe('unsigned');
    expect(ce2.box(['Real', 'NaN']).sgn).toBe('unsigned');
    const imList = ce2.box(['Imaginary', ['List', 1, 'NaN']]);
    expect(imList.evaluate().toString()).toBe('[0,NaN]');
    expect(imList.type.matches('list<number>')).toBe(true);
    expect(imList.type.matches('list<real>')).toBe(false);
    expect(ce2.box(['Real', ['List', 2, 3]]).type.toString()).toBe(
      'vector<real^2>'
    );
    expect(ce2.box(['AbsArg', ['List', 1, 2]]).type.toString()).toBe(
      'list<tuple<+oo | real, real>^2>'
    );
    const absArgList = ce2.box(['AbsArg', ['List', 1, 'NaN']]);
    expect(absArgList.evaluate().toString()).toBe('[(1, 0),NaN]');
    // The cell admits the bare NaN (and, for the reading in which the tuple
    // is the broadcast container, so do its fields).
    expect(absArgList.type.matches('list<tuple<number, number> | nan>')).toBe(
      true
    );
    expect(absArgList.type.matches('list<tuple<number, number>>')).toBe(false);
    expect(
      ce2
        .box(['NumeratorDenominator', ['List', ['Rational', 1, 2], 3]])
        .type.matches('list<tuple<number, number> | nothing>')
    ).toBe(true);

    // ComplexRoots (ruling 2): NaN radicand propagates to the bare marker
    // (it used to stay inert); an infinite radicand is a boxing error; a
    // NaN or non-positive root count is a contract violation.
    both(['ComplexRoots', 'NaN', 2], isNaNv);
    expect(ce2.box(['ComplexRoots', 'NaN', 2]).type.toString()).toBe('nan');
    for (const z of [POS, NEG, COO, ANON]) boxError(['ComplexRoots', z, 2]);
    boxError(['ComplexRoots', 8, 'NaN']);
    expect(ce2.box(['ComplexRoots', 8, 0]).evaluate().operator).toBe('Error');
    expect(ce2.box(['ComplexRoots', 8, -1]).evaluate().operator).toBe('Error');
    expect(ce2.box(['ComplexRoots', 8, 'n9']).evaluate().operator).toBe(
      'ComplexRoots'
    );
    expect(ce2.box(['ComplexRoots', 8, 3]).evaluate().nops).toBe(3);

    // Erfi: bounded on the imaginary axis (`erfi(iy) = i·erf(y)`), so no
    // limit at complex infinity — `~oo` and an anonymous infinity are
    // off-carrier (the `Erf` arrangement; `Erfi(~oo)` used to answer
    // `~oo`); the signed infinities keep their values; NaN propagates.
    both(['Erfi', POS], isPos);
    both(['Erfi', NEG], isNeg);
    both(['Erfi', 'NaN'], isNaNv);
    expect(ce2.box(['Erfi', 'NaN']).type.toString()).toBe('nan');
    boxError(['Erfi', COO]);
    boxError(['Erfi', ANON]);

    // ErfInv (ruling 3): NaN at every infinity — `~oo`, an anonymous
    // infinity and a non-real finite argument used to stay inert; the real
    // arguments outside [−1, 1] used to answer NaN and stay symbolic now.
    for (const x of [POS, NEG, COO, ANON]) both(['ErfInv', x], isNaNv);
    both(['ErfInv', 'NaN'], isNaNv);
    both(['ErfInv', 2], symbolic('ErfInv'));
    both(['ErfInv', -2], symbolic('ErfInv'));
    both(['ErfInv', ['Complex', 1, 2]], symbolic('ErfInv'));
    both(['ErfInv', 1], isPos);
    both(['ErfInv', -1], isNeg);
    both(['ErfInv', 0], is(0));

    // The type-variable carriers: a polytype parameter (`(T) -> T where
    // T: number`) used to derive `reject` for NaN because a bare variable
    // is not a subtype of anything — `Chop(NaN)`, `Remainder(NaN, 2)`,
    // `BaseForm(NaN)` and `Identity(NaN)` all answered an
    // `unexpected-argument` error. The bound is the carrier now: `T:
    // number` admits NaN, so these heads own it (inert policy) and answer
    // NaN from their own arms.
    both(['Chop', 'NaN'], isNaNv);
    both(['Remainder', 'NaN', 2], isNaNv);
    both(['Remainder', 7, 'NaN'], isNaNv);
    both(['BaseForm', 'NaN'], isNaNv);
    both(['Identity', 'NaN'], isNaNv);
  });

  test('the rational and parity family declares its domains', () => {
    // Signature flips of 2026-09-02 (batch 10), with four rulings taken
    // first: (1) `Fract` takes the `Floor` carrier (`real |
    // signed_infinity`) and answers NaN at ±∞ through `definedWhen`
    // (`x − floor(x)` has no limit there); (2) `Rationalize` takes a
    // finite real and a NON-NEGATIVE finite tolerance, spelled as the
    // range type `real<0..>`; (3) an inexact `ContinuedFraction` operand
    // is expanded as its best rational approximation, so both routes
    // agree; (4) `Numerator`, `Denominator` and `NumeratorDenominator`
    // are structural accessors that HANDLE NaN (`NaN` is `NaN/1`), and
    // they evaluate their held operand. By precedent: `Mod` takes the
    // `(real, real) -> real` declaration of `docs/ERROR-MODEL.md` §4, and
    // `IsOdd`/`IsEven` take the `IsPrime` arrangement, `IsEven` as its own
    // head. Every pin below holds on evaluate() AND N().
    const ce2 = new ComputeEngine();
    const POS = 'PositiveInfinity';
    const NEG = 'NegativeInfinity';
    const COO = 'ComplexInfinity';
    const ANON = ['Complex', POS, 1];
    const NONREAL = ['Complex', 2, 3];
    const both = (expr: any, check: (v: any) => boolean) => {
      expect(check(ce2.box(expr).evaluate())).toBe(true);
      expect(check(ce2.box(expr).N())).toBe(true);
    };
    const isNaNv = (v: any) => isNaNValue(ce2, v);
    const is = (n: any) => (v: any) => v.isSame(n);
    const isFalse = (v: any) => symbolName(v) === 'False';
    const isTrue = (v: any) => symbolName(v) === 'True';
    const isError = (v: any) => v.operator === 'Error';
    const boxError = (expr: any) => {
      const e = ce2.box(expr);
      expect(e.isValid).toBe(false);
      expect(e.evaluate().operator).toBe('Error');
    };
    const typeOf = (expr: any) => ce2.box(expr).type.toString();

    // Fract (ruling 1): NaN at the signed infinities, typed exactly `nan`;
    // a non-real operand or `~oo` is off-carrier (`Fract(2 + 3i)` used to
    // answer `0`); the sign handler follows the values (`Fract(+oo)` used
    // to report `non-negative`), and every finite real has its fractional
    // part in [0, 1), the negative ones included.
    both(['Fract', POS], isNaNv);
    both(['Fract', NEG], isNaNv);
    both(['Fract', 'NaN'], isNaNv);
    expect(typeOf(['Fract', 'NaN'])).toBe('nan');
    expect(typeOf(['Fract', POS])).toBe('nan');
    for (const x of [COO, ANON, NONREAL]) boxError(['Fract', x]);
    both(['Fract', ['Rational', -7, 2]], (v) => v.re === 0.5);
    expect(ce2.box(['Fract', POS]).sgn).toBe('unsigned');
    expect(ce2.box(['Fract', 'NaN']).sgn).toBe('unsigned');
    expect(ce2.box(['Fract', ['Rational', -7, 2]]).sgn).toBe('non-negative');
    ce2.declare('r10', 'real');
    ce2.declare('w10', 'number');
    expect(typeOf(['Fract', 'r10'])).toBe('real<0..1>');
    expect(typeOf(['Fract', ['Add', 'r10', 1]])).toBe('real<0..1>');
    expect(ce2.box(['Fract', 'w10']).type.matches('real | nan')).toBe(true);
    expect(ce2.box(['Fract', 'w10']).type.matches('real')).toBe(false);

    // Mod: the zero modulus is the marker (typed `nan`), NaN propagates in
    // either slot (typed `nan`; the type handler used to claim `number`),
    // and every infinity or non-real operand is a boxing error (each used
    // to answer NaN).
    both(['Mod', 7, 0], isNaNv);
    both(['Mod', 'NaN', 3], isNaNv);
    both(['Mod', 7, 'NaN'], isNaNv);
    expect(typeOf(['Mod', 7, 0])).toBe('nan');
    expect(typeOf(['Mod', 'NaN', 3])).toBe('nan');
    for (const x of [POS, NEG, COO, ANON, NONREAL]) {
      boxError(['Mod', x, 3]);
      boxError(['Mod', 7, x]);
    }
    both(['Mod', 7, -3], is(-2));
    ce2.declare('m10', 'integer');
    expect(ce2.box(['Mod', 7, 'm10']).type.matches('real | nan')).toBe(true);
    expect(ce2.box(['Mod', 7, 'm10']).type.matches('real')).toBe(false);
    expect(typeOf(['Mod', 'm10', 3])).toBe('integer');

    // Rationalize (ruling 2): NaN propagates (typed `nan`, the claim used
    // to be `rational`); every infinity and non-real value is a boxing
    // error (`Rationalize(+oo)` used to answer `+oo`); a negative, NaN or
    // infinite tolerance is refused at boxing (a negative one used to be
    // read as its absolute value, a NaN one ignored).
    both(['Rationalize', 'NaN'], isNaNv);
    expect(typeOf(['Rationalize', 'NaN'])).toBe('nan');
    for (const x of [POS, NEG, COO, ANON, NONREAL]) boxError(['Rationalize', x]);
    boxError(['Rationalize', 1.75, -0.01]);
    boxError(['Rationalize', 1.75, 'NaN']);
    boxError(['Rationalize', 1.75, POS]);
    both(['Rationalize', 1.75], is(ce2.number([7, 4])));
    both(['Rationalize', 1.75, 0], is(ce2.number([7, 4])));
    both(['Rationalize', 1.75, 0.3], is(2));

    // IsOdd / IsEven: the `IsPrime` arrangement — every non-integer
    // (NaN, a non-integer real, a non-real) is `False`, every infinity is
    // the carrier error, a symbol stays inert until its parity is decided.
    // `IsOdd(x)` used to answer `False` for an unknown `x` (and `IsEven(x)`
    // `True`), and `IsEven`, canonicalized to `Not(IsOdd(x))`, answered
    // `True` for every non-integer.
    for (const h of ['IsOdd', 'IsEven']) {
      both([h, 'NaN'], isFalse);
      both([h, 2.5], isFalse);
      both([h, ['Rational', -7, 2]], isFalse);
      both([h, NONREAL], isFalse);
      for (const x of [POS, NEG, COO, ANON]) both([h, x], isError);
      expect(ce2.box([h, 'u10']).evaluate().operator).toBe(h);
      expect(ce2.box([h, ['Add', 'u10', 1]]).evaluate().operator).toBe(h);
    }
    both(['IsOdd', -3], isTrue);
    both(['IsEven', -3], isFalse);
    both(['IsEven', 0], isTrue);
    both(['IsEven', 2.5], isFalse);
    expect(ce2.box(['IsEven', 3]).json).toEqual(['IsEven', 3]);
    expect(typeOf(['IsEven', 2.5])).toBe('false');
    expect(typeOf(['IsEven', 4])).toBe('true');
    ce2.assign('p10', 7);
    both(['IsOdd', 'p10'], isTrue);
    both(['IsEven', 'p10'], isFalse);

    // ContinuedFraction (ruling 3): a finite real only — NaN, every
    // infinity and a non-real value are boxing errors (`2 + 3i` used to be
    // expanded from its real part); a NaN term count is a contract
    // violation and a non-positive one an evaluation error (`requires`; it
    // used to stay inert); an inexact operand expands its best rational
    // approximation, so `7/3` answers `[2, 3]` under N() as well (it used
    // to answer `[2, 2, 1]`) and π to machine precision has no rounding
    // tail (thirteen terms, every one a term of π's own expansion).
    for (const x of ['NaN', POS, NEG, COO, ANON, NONREAL])
      boxError(['ContinuedFraction', x]);
    boxError(['ContinuedFraction', ['Rational', 43, 19], 'NaN']);
    for (const n of [0, -3])
      both(['ContinuedFraction', ['Rational', 43, 19], n], isError);
    expect(
      ce2.box(['ContinuedFraction', ['Rational', 43, 19], 'n10']).evaluate()
        .operator
    ).toBe('ContinuedFraction');
    both(
      ['ContinuedFraction', ['Rational', 7, 3]],
      (v) => v.toString() === '[2,3]'
    );
    expect(ce2.box(['ContinuedFraction', Math.PI]).evaluate().toString()).toBe(
      '[3,7,15,1,292,1,1,1,2,1,3,1,14]'
    );

    // The accessors (ruling 4): `NaN` and the infinities are their own
    // numerator over `1`; a held symbol is evaluated before its parts are
    // read (`Numerator(y)` for `y := 1/2` used to answer `y`), and the
    // canonical form of `NumeratorDenominator(y)` no longer depends on the
    // assignment (it used to evaluate at canonicalization).
    both(['Numerator', 'NaN'], isNaNv);
    both(['Denominator', 'NaN'], is(1));
    both(['Denominator', POS], is(1));
    const ndNaN = ce2.box(['NumeratorDenominator', 'NaN']).evaluate();
    expect(ndNaN.operator).toBe('Tuple');
    expect(isNaNValue(ce2, ndNaN.op1)).toBe(true);
    expect(ndNaN.op2.isSame(1)).toBe(true);
    ce2.assign('y10', ce2.box(['Rational', 1, 2]));
    both(['Numerator', 'y10'], is(1));
    both(['Denominator', 'y10'], is(2));
    expect(ce2.box(['NumeratorDenominator', 'y10']).operator).toBe(
      'NumeratorDenominator'
    );
    both(
      ['NumeratorDenominator', 'y10'],
      (v) => v.operator === 'Tuple' && v.op1.isSame(1) && v.op2.isSame(2)
    );
    ce2.assign('a10', 5);
    both(
      ['NumeratorDenominator', ['Divide', 'a10', 4]],
      (v) => v.operator === 'Tuple' && v.op1.isSame(5) && v.op2.isSame(4)
    );

    // Review catches. A value that arrives through a SYMBOL reaches the
    // partiality gate before the dispatch conformance re-test, so a
    // `definedWhen` or `requires` predicate must not decide an operand
    // OUTSIDE the carrier: `Fract` of a symbol holding `~oo`, `Mod(h, 0)`
    // for a symbol holding `+∞`, and a non-integer term count for
    // `ContinuedFraction` are the carrier's `incompatible-type` errors,
    // never the marker or the precondition error. The lazy accessors are
    // outside that re-test altogether and refuse a non-number themselves.
    // A symbol declared non-integer answers `False` to the parity
    // predicates; a `never`-typed operand makes `Fract` `never`.
    const held = (name: string, value: any) => {
      ce2.assign(name, value);
      return ce2.box(name);
    };
    const errorCodeOf = (v: any) => errorCode(v);
    expect(
      errorCodeOf(ce2.function('Fract', [held('hc10', COO)]).evaluate())
    ).toBe('incompatible-type');
    expect(
      errorCodeOf(
        ce2.function('Mod', [held('hp10', POS), ce2.box(0)]).evaluate()
      )
    ).toBe('incompatible-type');
    expect(
      errorCodeOf(
        ce2
          .function('ContinuedFraction', [
            ce2.box(['Rational', 43, 19]),
            held('hh10', 0.5),
          ])
          .evaluate()
      )
    ).toBe('incompatible-type');
    for (const h of ['Numerator', 'Denominator', 'NumeratorDenominator'])
      expect(
        errorCodeOf(ce2.function(h, [held('hs10', "'abc'")]).evaluate())
      ).toBe('incompatible-type');
    ce2.declare('im10', 'imaginary');
    both(['IsOdd', 'im10'], isFalse);
    both(['IsEven', 'im10'], isFalse);
    ce2.declare('nev10', 'integer<2<..<3>');
    expect(typeOf(['Fract', 'nev10'])).toBe('never');
  });

  test('compile(Heaviside)(NaN) agrees with the interpreter now', () => {
    // The compiled lane was fixed first (2026-08-28) under ratified Contract
    // B's derived `propagate` default, which left a route divergence: the
    // kernel answered `NaN` while the interpreter stayed inert. The
    // interpreter's `NaN` arm above closes it, so both lanes now answer the
    // same thing.
    const ce2 = new ComputeEngine();
    const result = compiled(ce2.box(['Heaviside', 'x']));
    expect(result.success).toBe(true);
    expect(result.run({ x: NaN })).toBeNaN();
    expect(result.run({ x: -1 })).toBe(0);
    expect(result.run({ x: 0 })).toBe(0.5);
    expect(result.run({ x: Infinity })).toBe(1);
    expect(isNaNValue(ce2, ce2.box(['Heaviside', 'NaN']).N())).toBe(true);
  });
});

test('compile(1/x)(0) answers Infinity — the ruled float projection of ~oo', () => {
  // Pole-encoding ruling (2026-08-28): a float-only compile target answers
  // the IEEE `Infinity` at a pole — the float projection of the
  // interpreter's projective `~oo` keeps the magnitude and drops the
  // missing direction. The constant fold agrees: a literal `1/0` folds to
  // the interpreter's `~oo` and embeds as `Infinity`, so both routes spell
  // the pole the same way (they used to disagree: fold `NaN`, runtime
  // `Infinity`). Documented as the float-target carve-out in
  // `docs/COMPILATION-MODEL.md`.
  const ce = new ComputeEngine();
  const result = compiled(ce.box(['Divide', 1, 'x']));
  expect(result.success).toBe(true);
  expect(result.run({ x: 0 })).toBe(Infinity);
  const folded = compiled(ce.box(['Divide', 1, 0]));
  expect(folded.run({})).toBe(Infinity);
  expect(ce.box(['Divide', 1, 0]).N().isSame(ce.ComplexInfinity)).toBe(true);
});

describe('SIGNATURE-GUIDELINES §3.3 — a membership predicate answers False for a non-member', () => {
  const ce = new ComputeEngine();

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
      // value: "3.5 is not prime" is a well-formed true sentence. Leaving
      // these inert made inertness the terminal answer to a decidable
      // question, which ERROR-MODEL §1 forbids. The predicate answers `False`
      // whenever the argument is PROVABLY not an integer — from its value
      // (`3.5`, `i`, `NaN`) or, for a constant with no literal integrality
      // answer, from its type not overlapping `integer` (`π`, `e`, `φ`).
      test(`[${route}] ${label} answers False under evaluate() and N()`, () => {
        expect(symbolName(expr.evaluate())).toBe('False');
        expect(symbolName(expr.N())).toBe('False');
        // Typed boolean: a literal argument (`3.5`) is decided by the type
        // handler itself (`false`), the others keep the bare `boolean`.
        expect(expr.type.matches('boolean')).toBe(true);
      });
    }
  }

  test('an infinite argument is an Error — it is outside the carrier (ruling L9)', () => {
    // Primality is a question about finite integers, so an infinite argument
    // is a provable contract violation, not a `False` answer. `~oo` is the row
    // ERROR-MODEL §7 named; the signed pair falls out of the same carrier.
    //
    // The carrier is enforced by the HANDLER, not by the declared signature,
    // so the error arrives at EVALUATION and the boxed form stays valid. The
    // signature stays the wide `(number)`: a declared parameter type is what
    // an undeclared argument symbol is inferred from, and spelling the
    // exclusion there stamped this predicate's implementation detail onto the
    // caller's own symbol (see the inference row below).
    const ce2 = new ComputeEngine();
    for (const name of [
      'ComplexInfinity',
      'PositiveInfinity',
      'NegativeInfinity',
    ]) {
      const expr = ce2.box(['IsPrime', name]);
      expect([name, expr.isValid]).toEqual([name, true]);
      expect([name, errorCode(expr.evaluate())]).toEqual([
        name,
        'incompatible-type',
      ]);
      // `IsComposite` shares the carrier and the enforcement.
      expect([
        name,
        errorCode(ce2.box(['IsComposite', name]).evaluate()),
      ]).toEqual([name, 'incompatible-type']);
    }
  });

  test('the carrier does not leak into the caller’s symbol inference', () => {
    // A use of a valueless symbol narrows it to the declared parameter type.
    // With a `complex | nan` signature that made `IsPrime(n)` declare
    // `n: complex | nan` — this predicate's private exclusion of the
    // infinities, written onto a name the program will use elsewhere. The wide
    // `(number)` carrier infers what every other numeric predicate does.
    const ce2 = new ComputeEngine();
    ce2.box(['IsPrime', 'n_zz']).evaluate();
    expect(ce2.symbol('n_zz').type.toString()).toBe('number');
    const ce3 = new ComputeEngine();
    ce3.box(['IsComposite', 'm_zz']).evaluate();
    expect(ce3.symbol('m_zz').type.toString()).toBe('number');
  });

  test('a string operand is still the wanted boxing Error, not a total-predicate False', () => {
    // The carrier does NOT widen to `any`: for a string the question is type
    // confusion, not membership (ERROR-MODEL §4, with Mathematica's
    // `PrimeQ["banana"] → False` as the cautionary tale).
    const ce2 = new ComputeEngine();
    const expr = ce2.box(['IsPrime', { str: 'banana' }]);
    expect(errorCode(operand(expr, 1))).toBe('incompatible-type');
  });

  test('IsPrime still decides the ordinary cases, and stays inert only where it must', () => {
    const ce2 = new ComputeEngine();
    expect(symbolName(ce2.box(['IsPrime', 7]).evaluate())).toBe('True');
    expect(symbolName(ce2.box(['IsPrime', 1]).evaluate())).toBe('False');
    // An unknown symbol could still turn out to be a prime, so it is the one
    // case inertness is the right answer to.
    expect(isUnreduced(ce2.box(['IsPrime', 'x']).evaluate(), 'IsPrime')).toBe(
      true
    );
  });

  describe('a negative integer is not prime (convention ruled 2026-08-29)', () => {
    for (const { route, expr } of routes(
      ce,
      ['IsPrime', -7],
      '\\operatorname{IsPrime}(-7)',
      'IsPrime',
      () => [ce.box(-7)]
    )) {
      // RULED 2026-08-29: this engine defines a prime as a positive integer
      // greater than 1, which is SymPy's convention for `isprime`.
      // Mathematica's `PrimeQ` takes the other one and accepts the negatives
      // of primes (primality up to units). The difference is definitional, not
      // a mathematical indeterminacy, so the engine picks one and says so
      // rather than declining — and `False` is the answer that keeps the
      // uniform set-membership reading every other decidable non-member gets.
      // This row used to pin INERTNESS, as the then-open §7 question.
      test(`[${route}] IsPrime(-7) answers False`, () => {
        expect(symbolName(expr.evaluate())).toBe('False');
        expect(symbolName(expr.N())).toBe('False');
      });
    }

    test('the whole negative range answers False, and IsComposite agrees', () => {
      const ce2 = new ComputeEngine();
      for (const n of [-1, -2, -4, -7, -2147483647])
        expect([n, symbolName(ce2.box(['IsPrime', n]).evaluate())]).toEqual([
          n,
          'False',
        ]);
      // `IsComposite` inherits the convention through its positivity test: a
      // composite number is a POSITIVE integer greater than 1 that is not
      // prime, so no negative integer is composite either.
      for (const n of [-1, -4, -7])
        expect([n, symbolName(ce2.box(['IsComposite', n]).evaluate())]).toEqual([
          n,
          'False',
        ]);
    });
  });

  test('IsComposite keeps the real definition, not the negation of IsPrime', () => {
    // `IsComposite` used to canonicalize to `Not(IsPrime(n))`, which called
    // `0` and `1` composite and would have called `3.5` and `NaN` composite
    // once `IsPrime` started answering `False` for them. A composite number is
    // a positive integer greater than 1 that is not prime, and nothing else
    // is composite.
    const ce2 = new ComputeEngine();
    const answers: [any, string][] = [
      [4, 'True'],
      [9, 'True'],
      [2, 'False'],
      [1, 'False'],
      [0, 'False'],
      [3.5, 'False'],
      ['NaN', 'False'],
      ['Pi', 'False'],
      [-4, 'False'],
    ];
    for (const [arg, want] of answers)
      expect([
        arg,
        symbolName(ce2.box(['IsComposite', arg]).evaluate()),
      ]).toEqual([arg, want]);
  });
});

describe('ERROR-MODEL §1 — an UNDECIDABLE condition is inert, never a host throw', () => {
  // Ruled 2026-08-31. A condition the engine cannot read as `True` or `False`
  // leaves the conditional unevaluated — the "not yet" channel — on both the
  // `If` and the `Which` handler, so the two cannot diverge. It is never a
  // JavaScript exception out of `evaluate()`: a caller that only asked for a
  // value must get one, and the condition may become decidable later.

  describe('If(x, 5) with an undeclared x', () => {
    const ce = new ComputeEngine();
    for (const { route, expr } of routes(
      ce,
      ['If', 'x', 5],
      '\\operatorname{If}(x, 5)',
      'If',
      () => [ce.box('x'), ce.box(5)]
    )) {
      test(`[${route}] stays inert under evaluate() AND N()`, () => {
        expect(() => expr.evaluate()).not.toThrow();
        expect(expr.evaluate().operator).toBe('If');
        expect(symbolName(operand(expr.evaluate(), 1))).toBe('x');
        expect(expr.N().operator).toBe('If');
      });
    }
  });

  describe('Which(x = 4, 1, True, 2) — an undecided guard holds the whole Which', () => {
    const ce = new ComputeEngine();
    for (const { route, expr } of routes(
      ce,
      ['Which', ['Equal', 'x', 4], 1, 'True', 2],
      '\\operatorname{Which}(x = 4, 1, \\operatorname{True}, 2)',
      'Which',
      () => [ce.box(['Equal', 'x', 4]), ce.box(1), ce.box('True'), ce.box(2)]
    )) {
      test(`[${route}] does not fall through to the True clause`, () => {
        expect(() => expr.evaluate()).not.toThrow();
        const r = expr.evaluate();
        expect(r.operator).toBe('Which');
        expect(operandsOf(r)).toHaveLength(4);
        expect(r.N().operator).toBe('Which');
      });
    }
  });

  test('a condition that is provably not a boolean is an error operand, never a throw', () => {
    // The number 10 and a `NaN` literal can never be read as `True`/`False`,
    // and their TYPE says so at boxing: the condition is an
    // `incompatible-type` error operand, propagated as the condition's error
    // at evaluation, never a host exception. A list of numbers is refused
    // too: its cells can never be condition values, so it can never select
    // element-wise, while a list of booleans selects and is never refused.
    const ce = new ComputeEngine();
    const ten = ce.box(['If', 10, 1, 2]);
    expect(ten.errors).toHaveLength(1);
    expect(ten.evaluate().operator).toBe('Error');
    expect(
      ce.box(['Which', ['List', 10, 20], 1, 'True', 0]).evaluate().operator
    ).toBe('Error');
    expect(
      ce.box(['Which', ['List', 'True', 'False'], 1, 'True', 0]).evaluate()
        .operator
    ).toBe('List');
    const nan = ce.box(['Which', ['Divide', 0, 0], 5, 'True', 9]);
    expect(nan.errors).toHaveLength(1);
    expect(nan.N().operator).toBe('Error');
  });

  test('a PARTIALLY decidable Which holds as a whole, keeping its earlier clauses', () => {
    // The first guard is `False` and the second is undecided. The walk cannot
    // pass the undecided guard, so the whole conditional is held — and it is
    // held AS WRITTEN, the already-`False` clause included, so nothing is lost
    // if `x` is bound later.
    const ce = new ComputeEngine();
    const r = ce
      .box(['Which', 'False', 1, ['Equal', 'x', 4], 2, 'True', 3])
      .evaluate();
    expect(r.operator).toBe('Which');
    expect(operandsOf(r)).toHaveLength(6);
    expect(symbolName(operand(r, 1))).toBe('False');
    // Fixpoint: a held conditional evaluates to itself.
    expect(r.evaluate().isSame(r)).toBe(true);
  });

  test('a decidable condition is still decided — inertness is not a new default', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['If', ['Equal', 2, 2], 1, 2]).evaluate().isSame(1)).toBe(
      true
    );
    expect(
      ce.box(['Which', ['Less', 3, 0], 1, 'True', 2]).evaluate().isSame(2)
    ).toBe(true);
    // An ABSENT condition is a different channel: `Missing` is a decided data
    // state that can never resolve, so it is a catchable Error, not inertness.
    expect(isErrorValue(ce.box(['If', 'Missing', 1, 2]).evaluate())).toBe(true);
  });
});

describe('ERROR-MODEL §3 — a lazy operator propagates only what it DEMANDS', () => {
  const ce = new ComputeEngine();

  describe('If(True, 5, err) takes the selected arm', () => {
    for (const { route, expr } of routes(
      ce,
      ['If', 'True', 5, ['Sin', { str: 'banana' }]],
      '\\operatorname{If}(\\operatorname{True}, 5, \\sin(\\text{banana}))',
      'If',
      () => [ce.box('True'), ce.box(5), ce.box(['Sin', { str: 'banana' }])]
    )) {
      // The demanded-operands rule (ERROR-MODEL §3, ratified with Contract B):
      // an error in an arm a selecting operator never demands is dead code —
      // static analysis sees it, evaluation does not execute it. The boxed
      // form is UNCHANGED and keeps the diagnostic: `isValid` is still
      // `false`, and the error is still in place as the third operand.
      test(`[${route}] the boxed form keeps the error, and evaluate() returns 5`, () => {
        expect(expr.operator).toBe('If');
        expect(operandsOf(expr)).toHaveLength(3);
        expect(expr.isValid).toBe(false);
        expect(expr.evaluate().isSame(5)).toBe(true);
        expect(expr.N().isSame(5)).toBe(true);
      });
    }
  });

  test('the dual obligation: an operand the selection DOES demand still bubbles', () => {
    // Deferring absorption past the handler is not skipping it. A demanded
    // operand comes back as the error (an `Error` node evaluates to itself),
    // so the error is embedded in the handler's result and bubbles from
    // there — for the selected arm and for the condition alike.
    const ce2 = new ComputeEngine();
    const err = ['Sin', { str: 'banana' }];
    expect(isErrorValue(ce2.box(['If', 'False', 5, err]).evaluate())).toBe(
      true
    );
    expect(isErrorValue(ce2.box(['If', 'True', err, 7]).evaluate())).toBe(true);
    expect(isErrorValue(ce2.box(['If', err, 5, 7]).evaluate())).toBe(true);
  });

  describe('route parity for the selection siblings', () => {
    // The three construction routes genuinely diverge for a LAZY operator: it
    // receives UNBOUND held operands through `ce.box`/`ce.parse` but pre-boxed
    // ones through `ce.function`. Deferred absorption runs on all three, so
    // each selecting operator is probed on each — the failure class this
    // suite exists to catch.
    const cases: [string, any, string, () => Expression[], string][] = [
      [
        'And(False, err)',
        ['And', 'False', ['Sin', { str: 'banana' }]],
        '\\operatorname{False} \\land \\sin(\\text{banana})',
        () => [ce.box('False'), ce.box(['Sin', { str: 'banana' }])],
        'False',
      ],
      [
        'Or(True, err)',
        ['Or', 'True', ['Sin', { str: 'banana' }]],
        '\\operatorname{True} \\lor \\sin(\\text{banana})',
        () => [ce.box('True'), ce.box(['Sin', { str: 'banana' }])],
        'True',
      ],
    ];
    for (const [label, json, latex, ops, want] of cases) {
      const head = (json as string[])[0];
      for (const { route, expr } of routes(ce, json, latex, head, ops)) {
        test(`[${route}] ${label} answers ${want}`, () => {
          expect(symbolName(expr.evaluate())).toBe(want);
        });
      }
    }

    for (const { route, expr } of routes(
      ce,
      ['Which', 'True', 5, 'True', ['Sin', { str: 'banana' }]],
      '\\operatorname{Which}(\\operatorname{True}, 5, \\operatorname{True}, \\sin(\\text{banana}))',
      'Which',
      () => [
        ce.box('True'),
        ce.box(5),
        ce.box('True'),
        ce.box(['Sin', { str: 'banana' }]),
      ]
    )) {
      test(`[${route}] Which takes the first matching clause past a later error`, () => {
        expect(expr.evaluate().isSame(5)).toBe(true);
      });
    }

    for (const { route, expr } of routes(
      ce,
      ['Coalesce', 5, ['Sin', { str: 'banana' }]],
      '\\operatorname{Coalesce}(5, \\sin(\\text{banana}))',
      'Coalesce',
      () => [ce.box(5), ce.box(['Sin', { str: 'banana' }])]
    )) {
      test(`[${route}] Coalesce stops at the first present operand`, () => {
        expect(expr.evaluate().isSame(5)).toBe(true);
      });
    }
  });

  test('Which selects past an error in an unreached clause, and bubbles a demanded one', () => {
    const ce2 = new ComputeEngine();
    const err = ['Sin', { str: 'banana' }];
    // An error in a later arm, and in a later GUARD, are both unreached once
    // an earlier guard has matched.
    expect(
      ce2.box(['Which', 'True', 5, 'True', err]).evaluate().isSame(5)
    ).toBe(true);
    expect(ce2.box(['Which', 'True', 5, err, 9]).evaluate().isSame(5)).toBe(
      true
    );
    // A skipped clause's arm is never demanded either.
    expect(
      ce2.box(['Which', 'False', err, 'True', 7]).evaluate().isSame(7)
    ).toBe(true);
    // The selected arm IS demanded.
    expect(isErrorValue(ce2.box(['Which', 'True', err]).evaluate())).toBe(true);
  });

  test('And/Or short-circuit past an error after the decisive operand', () => {
    const ce2 = new ComputeEngine();
    const err = ['Sin', { str: 'banana' }];
    expect(symbolName(ce2.box(['And', 'False', err]).evaluate())).toBe('False');
    expect(symbolName(ce2.box(['Or', 'True', err]).evaluate())).toBe('True');
    // Not decisive: the operand is demanded, so its error bubbles.
    expect(isErrorValue(ce2.box(['And', 'True', err]).evaluate())).toBe(true);
    expect(isErrorValue(ce2.box(['Or', 'False', err]).evaluate())).toBe(true);
  });

  test('Coalesce stops at the first present operand', () => {
    const ce2 = new ComputeEngine();
    const err = ['Sin', { str: 'banana' }];
    expect(ce2.box(['Coalesce', 5, err]).evaluate().isSame(5)).toBe(true);
    expect(isErrorValue(ce2.box(['Coalesce', err, 5]).evaluate())).toBe(true);
  });

  test('an EAGER operator keeps bubbling — the rule is scoped to selection', () => {
    // The rule is keyed on the operator CHOOSING among its operands, not on
    // laziness: most lazy operators demand every operand, and several answer
    // something else entirely when a demanded operand is unusable. They keep
    // the pre-handler absorption.
    const ce2 = new ComputeEngine();
    const err = ['Sin', { str: 'banana' }];
    expect(isErrorValue(ce2.box(['Add', err, 1]).evaluate())).toBe(true);
    expect(isErrorValue(ce2.box(['Sin', err]).evaluate())).toBe(true);
    expect(isErrorValue(ce2.box(['D', err, 'x']).evaluate())).toBe(true);
    expect(isErrorValue(ce2.box(['Numerator', err]).evaluate())).toBe(true);
    expect(isErrorValue(ce2.box(['Block', err]).evaluate())).toBe(true);
  });

  test('a collection still freezes its failed cell rather than bubbling', () => {
    const ce2 = new ComputeEngine();
    const list = ce2.box(['List', 1, ['Sin', { str: 'banana' }], 3]).evaluate();
    expect(list.operator).toBe('List');
    expect(operandsOf(list)).toHaveLength(3);
  });

  test('a lazy operator DOES take the selected arm when the unselected one is merely exceptional', () => {
    // Unchanged by the demanded-operands rule: an unselected arm that would
    // evaluate to `~oo` was never evaluated in the first place.
    const ce2 = new ComputeEngine();
    expect(
      ce2
        .box(['If', 'True', 5, ['Divide', 1, 0]])
        .evaluate()
        .isSame(5)
    ).toBe(true);
    expect(
      ce2
        .function('If', [
          ce2.box('True'),
          ce2.box(5),
          ce2.box(['Divide', 1, 0]),
        ])
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
    const ce2 = new ComputeEngine();
    expect(symbolName(ce2.box(['Which']).evaluate())).toBe('Missing');
    expect(symbolName(ce2.box(['If', 'False', 5]).evaluate())).toBe('Missing');
    expect(symbolName(ce2.box(['Which', 'False', 1]).evaluate())).toBe(
      'Missing'
    );
    expect(symbolName(ce2.box(['When', 5, 'False']).evaluate())).toBe(
      'Undefined'
    );
  });

  describe('the rule holds under COMPOSITION, not only at the root', () => {
    // An enclosing operator absorbs its operands' errors too, and it used to
    // do that by walking the WHOLE operand tree — straight through a selecting
    // head. So `If(True, 5, err)` answered `5` on its own and made every
    // expression it was nested in fail. The walks now treat a selecting
    // subtree as opaque, and the enclosing node evaluates it like any other
    // operand: what that evaluation RETURNS is what bubbles.
    const err = ['Sin', { str: 'banana' }];

    const cases: [string, any, any][] = [
      ['Add(1, If(True, 5, err))', ['Add', 1, ['If', 'True', 5, err]], 6],
      ['Negate(If(True, 5, err))', ['Negate', ['If', 'True', 5, err]], -5],
      ['Sin(If(True, 0, err))', ['Sin', ['If', 'True', 0, err]], 0],
      ['Block(If(True, 5, err))', ['Block', ['If', 'True', 5, err]], 5],
    ];
    for (const [label, json, want] of cases) {
      test(`${label} evaluates to ${want}`, () => {
        const ce2 = new ComputeEngine();
        expect(ce2.box(json).evaluate().isSame(want)).toBe(true);
      });
    }

    test('Not(And(False, err)) answers True', () => {
      const ce2 = new ComputeEngine();
      expect(
        symbolName(ce2.box(['Not', ['And', 'False', err]]).evaluate())
      ).toBe('True');
    });

    test('a collection cell whose only error is behind a selection is not frozen', () => {
      // The collection freeze is for a cell that FAILED. A cell that merely
      // holds a diagnostic in an arm no selection reaches has not failed, so
      // it evaluates like any other element.
      const ce2 = new ComputeEngine();
      const list = ce2.box(['List', ['If', 'True', 5, err]]).evaluate();
      expect(list.operator).toBe('List');
      expect(operandsOf(list)).toHaveLength(1);
      expect(operand(list, 1).isSame(5)).toBe(true);
    });

    test('a DEMANDED arm still bubbles out through the enclosing operator', () => {
      // The dual obligation, one level up: the selection demanded the failing
      // arm, so the error is the operand's value and the enclosing operator
      // absorbs it like any other error operand.
      const ce2 = new ComputeEngine();
      expect(
        isErrorValue(ce2.box(['Sin', ['If', 'False', 5, err]]).evaluate())
      ).toBe(true);
      expect(
        isErrorValue(ce2.box(['Add', 1, ['If', 'False', 5, err]]).evaluate())
      ).toBe(true);
      expect(
        isErrorValue(ce2.box(['List', ['If', 'False', 5, err]]).evaluate().op1)
      ).toBe(true);
    });

    test('an UNDECIDED selection stays inert and does not bubble', () => {
      // Nothing has demanded the failing arm yet, and nothing may ever. The
      // application keeps its unevaluated form with the diagnostic in place —
      // the "not yet" answer, not "no".
      const ce2 = new ComputeEngine();
      const cond = ce2.box(['If', ['Equal', 'x', 4], 5, err]).evaluate();
      expect(cond.operator).toBe('If');
      expect(cond.isValid).toBe(false);
      const coalesce = ce2.box(['Coalesce', 'y', err]).evaluate();
      expect(coalesce.operator).toBe('Coalesce');
      expect(coalesce.isValid).toBe(false);
    });
  });

  describe('§2a — a bubbled error records the selecting operator it passed', () => {
    // The selecting handlers return a demanded operand's error as a bare
    // value, so the frame `Sin(err)` and `Not(err)` record for free had to be
    // re-attached: the operand position is recovered by matching the returned
    // error against the operands' own. Without it the breadcrumb of
    // `If(err, 1, 2)` was silently shorter than `Sin(err)`'s.
    const err = ['Sin', { str: 'banana' }];
    const cases: [string, any, string][] = [
      ['If(err, 1, 2)', ['If', err, 1, 2], 'If'],
      ['And(err, True)', ['And', err, 'True'], 'And'],
      ['Coalesce(err, 5)', ['Coalesce', err, 5], 'Coalesce'],
      ['Which(err, 1)', ['Which', err, 1], 'Which'],
    ];
    for (const [label, json, head] of cases) {
      test(`${label} ends its breadcrumb with a ${head} frame`, () => {
        const ce2 = new ComputeEngine();
        const result = ce2.box(json).evaluate();
        expect(isErrorValue(result)).toBe(true);
        const frames = errorFrames(result);
        expect(frames[frames.length - 1]).toBe(head);
        // The operand INDEX is recorded too: every one of these demands its
        // first operand.
        const trace = operandsOf(result).find((op) =>
          isFunction(op, 'ErrorTrace')
        )!;
        const last = operandsOf(trace)[operandsOf(trace).length - 1];
        expect(operand(last, 2).isSame(1)).toBe(true);
      });
    }
  });

  test('And/Or error propagation is demand-ordered, so it is NOT commutative', () => {
    // `And`/`Or` declare `commutativeMatch` — the VALUE is commutative even
    // though the tree stays ordered. That claim does not extend to error
    // propagation. Canonicalization mints the same `incompatible-type`
    // diagnostic in both trees below (`1` is not a boolean) and both stay
    // invalid, but evaluation demands operands left to right and stops at the
    // first decisive one, so the error is dead code in one and demanded in the
    // other. Making it symmetric would mean either reporting an arm the
    // program never reaches or swallowing a genuine fault.
    const ce2 = new ComputeEngine();
    expect(symbolName(ce2.box(['And', 'False', 1]).evaluate())).toBe('False');
    expect(errorCode(ce2.box(['And', 1, 'False']).evaluate())).toBe(
      'incompatible-type'
    );
    expect(ce2.box(['And', 'False', 1]).isValid).toBe(false);
    expect(ce2.box(['And', 1, 'False']).isValid).toBe(false);
  });
});

describe('ERROR-MODEL §5 — the absence marker of a numeric slot types `nan`', () => {
  const ce = new ComputeEngine();

  test('an out-of-band-capable numeric accessor types `T | nan`, not bare `number`', () => {
    // `markerType`/`withMarker` (`library/collections.ts`) used to answer a
    // bare `number` for a numeric element type, on the reasoning that
    // `NaN ∈ number` absorbed the marker arm. The finite-by-default lattice
    // flip repealed the premise — the bare tiers are finite and `NaN` has its
    // own singleton type — so the marker is additive and the element tier
    // survives.
    expect(ce.box(['At', ['List', 1, 2, 3], 99]).type.toString()).toBe(
      'integer | nan'
    );
    expect(ce.box(['First', ['List', 1, 2, 3]]).type.toString()).toBe(
      'integer | nan'
    );
    expect(ce.box(['Last', ['List', 1, 2, 3]]).type.toString()).toBe(
      'integer | nan'
    );
    expect(ce.box(['At', ['List', 1.5, 2.5], 9]).type.toString()).toBe(
      'nan | real'
    );
  });

  test('the VALUE of an out-of-band numeric access is still NaN', () => {
    // The type sharpened; the value did not move. A numeric domain absorbs
    // absence into `NaN` (ERROR-MODEL §1), and `Missing` stays the marker for
    // the non-numeric domains.
    expect(
      isNaNValue(ce, ce.box(['At', ['List', 1, 2, 3], 99]).evaluate())
    ).toBe(true);
    expect(
      isMissingValue(
        ce.box(['At', ['List', ce.string('a'), ce.string('b')], 9]).evaluate()
      )
    ).toBe(true);
  });

  test('a non-numeric element type keeps the `| missing` arm', () => {
    expect(
      ce
        .box(['At', ['List', ce.string('a'), ce.string('b')], 9])
        .type.toString()
    ).toBe('missing | string');
  });
});

//
// §1 — a decided question is never answered by inertness: the size operators
//

describe('ERROR-MODEL §1 — the size operators refuse a decided non-collection', () => {
  // `Length` and `Count` answer the SAME `incompatible-type` diagnostic for an
  // operand that refutes the collection contract — a number, a boolean, or the
  // `Missing` absence marker (absence is decided, ERROR-MODEL §1). The two
  // mint it at different seams and that is deliberate: `Count` declares a
  // `collection<any>` parameter, so `validateArguments` wraps a statically
  // decided operand at BOXING, while `Length` declares the tolerant `(any)`
  // and its EVALUATE handler mints the error. `Length`'s parameter stays `any`
  // because a declared parameter type is also what an undeclared argument
  // symbol is inferred FROM, and its canonical handler does its own collection
  // narrowing (`test/compute-engine/lambda-param-collection-inference.test.ts`).
  // Either way the ANSWER after evaluation is one bare `Error` node with the
  // same code and the same expected type, which is what these rows pin.
  const operands: { name: string; json: any; latex: string }[] = [
    { name: '5', json: 5, latex: '5' },
    { name: 'True', json: 'True', latex: '\\operatorname{True}' },
    { name: 'Missing', json: 'Missing', latex: '\\operatorname{Missing}' },
    // `First([])` is decided only at EVALUATION: it boxes as an ordinary
    // application and evaluates to `Missing`, so the refusal cannot come from
    // the boxing-time argument check on either operator.
    {
      name: 'First([])',
      json: ['First', ['List']],
      latex: '\\operatorname{First}(\\bigl\\lbrack\\bigr\\rbrack)',
    },
  ];

  for (const head of ['Length', 'Count']) {
    for (const operand of operands) {
      describe(`${head}(${operand.name})`, () => {
        const ce = new ComputeEngine();
        for (const { route, expr } of routes(
          ce,
          [head, operand.json],
          `\\operatorname{${head}}(${operand.latex})`,
          head,
          () => [ce.box(operand.json)]
        )) {
          test(`[${route}] evaluates to Error(incompatible-type, collection)`, () => {
            const result = expr.evaluate();
            expect(isErrorValue(result)).toBe(true);
            expect(errorCode(result)).toBe('incompatible-type');
            expect(result.type.toString()).toBe('error');
            // The expected type in the diagnostic is spelled `collection` by
            // both operators, so the two never drift apart.
            expect(result.toString()).toContain('"collection"');
            // Never a number, and never the inert form.
            expect(isUnreduced(result, head)).toBe(false);
          });
        }
      });
    }
  }

  test('the two operators produce the identical diagnostic', () => {
    const ce = new ComputeEngine();
    for (const operand of operands) {
      expect(ce.box(['Count', operand.json]).evaluate().toString()).toBe(
        ce.box(['Length', operand.json]).evaluate().toString()
      );
    }
  });

  test("Count's 2-arg forms refuse the same sources", () => {
    const ce = new ComputeEngine();
    // The value form and the predicate form both read the SOURCE operand, so
    // the refusal is on `ops[0]` and is independent of the second operand.
    for (const second of [3, ['Function', ['Greater', '_', 2]]]) {
      expect(errorCode(ce.box(['Count', 5, second]).evaluate())).toBe(
        'incompatible-type'
      );
      expect(
        errorCode(ce.box(['Count', ['First', ['List']], second]).evaluate())
      ).toBe('incompatible-type');
    }
  });

  test('a string IS a collection — of characters', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Length', ce.string('abc')]).evaluate().re).toBe(3);
    expect(ce.box(['Count', ce.string('abc')]).evaluate().re).toBe(3);
    expect(ce.parse('\\operatorname{Length}(\\text{abc})').evaluate().re).toBe(
      3
    );
  });

  test('an UNDECLARED symbol stays inert — nothing about it is decided yet', () => {
    // Rule 7 inertness, not a refusal: `x` has no value and no declared type,
    // so it may still turn out to be a collection. `Length`'s canonical
    // handler in fact narrows it TO `collection` on this evidence, which is
    // the opposite of a refutation.
    const ce = new ComputeEngine();
    expect(isUnreduced(ce.box(['Length', 'x']).evaluate(), 'Length')).toBe(
      true
    );
    const ce2 = new ComputeEngine();
    expect(isUnreduced(ce2.box(['Count', 'y']).evaluate(), 'Count')).toBe(true);
  });

  test('a VALUELESS collection-typed symbol stays inert', () => {
    // `L` is declared a collection but holds no value, so its LENGTH is
    // undecided while its KIND is settled. Inertness is the right answer:
    // assigning a value later decides it.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    expect(isUnreduced(ce.box(['Length', 'L']).evaluate(), 'Length')).toBe(
      true
    );
    expect(isUnreduced(ce.box(['Count', 'L']).evaluate(), 'Count')).toBe(true);
  });
});

//
// Euclidean norms — an infinite leg dominates a NaN leg
//

describe('Euclidean norms: an infinite leg dominates a NaN leg', () => {
  // One rule covers every Euclidean norm the library computes: an infinite
  // leg makes the norm `+oo` whatever the other legs are, a NaN leg included;
  // with NO infinite leg, a NaN leg makes the norm NaN. "Infinite" means any
  // infinity — the signed `±∞`, the unsigned `~oo`, and an anonymous directed
  // infinity such as `∞ + i` — because the modulus of each of them is `+∞`.
  //
  // IEEE 754 states the same precedence for the primitive the compiled lane
  // emits: `Math.hypot(Infinity, NaN)` is `Infinity`, not NaN. Before the
  // ruling of 2026-09-02 the two norms disagreed in both corners —
  // `Norm((+oo, NaN))` answered NaN while `Hypot(+oo, NaN)` answered `+oo`,
  // and `Hypot(~oo, 3)` was an `incompatible-type` error although
  // `Norm((~oo, 3))` was already `+oo`.
  //
  // `Abs` of a fixed-arity point is the same norm under the single-bar
  // spelling, so it follows.

  const INF = { num: '+Infinity' };
  const NEG_INF = { num: '-Infinity' };

  /** Both evaluation routes of a probe answer `+oo`. */
  const expectPositiveInfinity = (expr: Expression, route: string) => {
    expect(`${route}: ${expr.evaluate().toString()}`).toBe(`${route}: +oo`);
    expect(`${route}: ${expr.N().toString()}`).toBe(`${route}: +oo`);
  };

  /** Both evaluation routes of a probe answer NaN. */
  const expectNaN = (ce: ComputeEngine, expr: Expression, route: string) => {
    expect(`${route}: ${isNaNValue(ce, expr.evaluate())}`).toBe(
      `${route}: true`
    );
    expect(`${route}: ${isNaNValue(ce, expr.N())}`).toBe(`${route}: true`);
  };

  test('Norm of a POINT with an infinite component is +oo, on all three routes', () => {
    const ce = new ComputeEngine();
    for (const { route, expr } of routes(
      ce,
      ['Norm', ['Tuple', INF, 'NaN']],
      '\\operatorname{Norm}((\\infty, \\operatorname{NaN}))',
      'Norm',
      () => [ce.box(['Tuple', INF, 'NaN'])]
    ))
      expectPositiveInfinity(expr, route);
  });

  test('the sign of the infinite component does not matter', () => {
    // A norm is non-negative, so `-∞` norms to `+∞` exactly as `+∞` does.
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Norm', ['Tuple', NEG_INF, 'NaN']])
        .evaluate()
        .toString()
    ).toBe('+oo');
  });

  test('`~oo` counts as an infinite component: its modulus is +oo', () => {
    const ce = new ComputeEngine();
    // Already true before the ruling, with no NaN sibling.
    expect(
      ce
        .box(['Norm', ['Tuple', 'ComplexInfinity', 3]])
        .evaluate()
        .toString()
    ).toBe('+oo');
    // New: a NaN sibling no longer defeats it.
    for (const { route, expr } of routes(
      ce,
      ['Norm', ['Tuple', 'ComplexInfinity', 'NaN']],
      '\\operatorname{Norm}((\\tilde\\infty, \\operatorname{NaN}))',
      'Norm',
      () => [ce.box(['Tuple', 'ComplexInfinity', 'NaN'])]
    ))
      expectPositiveInfinity(expr, route);
  });

  test('Norm of a LIST follows the same rule as Norm of a point', () => {
    const ce = new ComputeEngine();
    for (const { route, expr } of routes(
      ce,
      ['Norm', ['List', INF, 'NaN']],
      '\\operatorname{Norm}(\\lbrack \\infty, \\operatorname{NaN}\\rbrack)',
      'Norm',
      () => [ce.box(['List', INF, 'NaN'])]
    ))
      expectPositiveInfinity(expr, route);
  });

  test('Abs of a point is that norm, so it follows too', () => {
    // `|(x, y)|` is the single-bar spelling of the vector magnitude, and the
    // `Abs` handler delegates to `Norm` for a fixed-arity point.
    const ce = new ComputeEngine();
    for (const { route, expr } of routes(
      ce,
      ['Abs', ['Tuple', INF, 'NaN']],
      '\\left|(\\infty, \\operatorname{NaN})\\right|',
      'Abs',
      () => [ce.box(['Tuple', INF, 'NaN'])]
    ))
      expectPositiveInfinity(expr, route);
    expect(
      ce
        .box(['Abs', ['Tuple', 'ComplexInfinity', 'NaN']])
        .evaluate()
        .toString()
    ).toBe('+oo');
  });

  test('Hypot agrees with Norm in every corner', () => {
    const ce = new ComputeEngine();
    // Unchanged by the ruling, and the behavior the other norms were aligned
    // to: this is what `Math.hypot(Infinity, NaN)` answers.
    for (const { route, expr } of routes(
      ce,
      ['Hypot', INF, 'NaN'],
      '\\operatorname{Hypot}(\\infty, \\operatorname{NaN})',
      'Hypot',
      () => [ce.box(INF), ce.NaN]
    ))
      expectPositiveInfinity(expr, route);
    // New: `~oo` is inside the carrier now (`real | infinity`), where it used
    // to be refused as `incompatible-type`, and it norms to `+oo`.
    for (const { route, expr } of routes(
      ce,
      ['Hypot', 'ComplexInfinity', 3],
      '\\operatorname{Hypot}(\\tilde\\infty, 3)',
      'Hypot',
      () => [ce.box('ComplexInfinity'), ce.box(3)]
    )) {
      expect(`${route}: ${isErrorValue(expr.evaluate())}`).toBe(
        `${route}: false`
      );
      expectPositiveInfinity(expr, route);
    }
    // A `~oo` leg with a NaN leg: the infinite leg wins.
    expect(
      ce.box(['Hypot', 'ComplexInfinity', 'NaN']).evaluate().toString()
    ).toBe('+oo');
    expect(
      ce.box(['Hypot', 'NaN', 'ComplexInfinity']).evaluate().toString()
    ).toBe('+oo');
    // A point leg enters the sum of squares through its own norm, so it
    // carries the same precedence.
    expect(
      ce
        .box(['Hypot', ['Tuple', INF, 'NaN'], 2])
        .evaluate()
        .toString()
    ).toBe('+oo');
  });

  test('a NaN INSIDE a point leg makes Hypot NaN, and the sign says so', () => {
    // A point leg enters the sum of squares through its own norm, so a NaN
    // component makes the hypotenuse NaN exactly as a NaN scalar leg does —
    // there is no infinite sibling to dominate it here. The sign handler must
    // read the components too: `isNaN` is `false` for a tuple whatever it
    // holds, so a sign handler testing the top-level operands alone claimed
    // the non-negative sign of a `√(…)` for an application that answers NaN.
    const ce = new ComputeEngine();
    const nanPoint = ce.box(['Hypot', ['Tuple', 'NaN', 3], 5]);
    expectNaN(ce, nanPoint, 'Hypot');
    expect(nanPoint.sgn).toBe('unsigned');
    // The infinite component still dominates, and there the sign stands.
    const infPoint = ce.box(['Hypot', ['Tuple', INF, 'NaN'], 5]);
    expectPositiveInfinity(infPoint, 'Hypot');
    expect(infPoint.sgn).toBe('non-negative');
  });

  test('an unsupported norm order is inert whatever the entries are', () => {
    // The infinity dominance belongs INSIDE the orders the handler computes:
    // an entry must never be what makes an order the handler does not
    // implement answer. The matrix branch computes only the Frobenius norm,
    // the max column sum and the max row sum, so `Norm([[+oo]], 3)` stays
    // the inert application `Norm([[1]], 3)` stays.
    //
    // `p = 0` is not a norm at any rank, and that is now a declared
    // precondition of the operator (`requires`), so it is an Error for
    // every operand — the infinite entry included. The entry is still never
    // what decides the order.
    const ce = new ComputeEngine();
    const op = (expr: any) => ce.box(expr).evaluate().operator;
    expect(op(['Norm', ['List', 1], 0])).toBe('Error');
    expect(op(['Norm', ['List', INF], 0])).toBe('Error');
    expect(op(['Norm', ['List', ['List', 1]], 3])).toBe('Norm');
    expect(op(['Norm', ['List', ['List', INF]], 3])).toBe('Norm');
    // Every SUPPORTED order answers `+oo` for that same infinite entry: the
    // default L2, the L1 sum, a general Lp and the L∞ maximum, in both
    // spellings of the last one.
    const value = (expr: any) => ce.box(expr).evaluate().toString();
    expect(value(['Norm', ['List', INF]])).toBe('+oo');
    expect(value(['Norm', ['List', INF], 1])).toBe('+oo');
    expect(value(['Norm', ['List', INF], 3])).toBe('+oo');
    expect(value(['Norm', ['List', INF], INF])).toBe('+oo');
    expect(value(['Norm', ['List', INF], { str: 'Infinity' }])).toBe('+oo');
  });

  test('a NaN leg with NO infinite sibling still makes the norm NaN', () => {
    // The control for every row above: the ruling gives infinity precedence
    // over NaN, it does not retire NaN from the norms.
    const ce = new ComputeEngine();
    for (const { route, expr } of routes(
      ce,
      ['Norm', ['Tuple', 1, 'NaN']],
      '\\operatorname{Norm}((1, \\operatorname{NaN}))',
      'Norm',
      () => [ce.box(['Tuple', 1, 'NaN'])]
    ))
      expectNaN(ce, expr, route);
    for (const { route, expr } of routes(
      ce,
      ['Hypot', 'NaN', 1],
      '\\operatorname{Hypot}(\\operatorname{NaN}, 1)',
      'Hypot',
      () => [ce.NaN, ce.box(1)]
    ))
      expectNaN(ce, expr, route);
    expect(ce.box(['Norm', ['List', 1, 'NaN']]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Abs', ['Tuple', 1, 'NaN']]).evaluate().isNaN).toBe(true);
    // A FINITE point leg withholds the proof for `Hypot` too.
    expect(ce.box(['Hypot', ['Tuple', 3, 4], 'NaN']).evaluate().isNaN).toBe(
      true
    );
  });

  test('a matrix norm follows the same precedence', () => {
    // The Frobenius norm is the Euclidean norm of the flattened matrix, and a
    // column or row sum is infinite as soon as one term is, so an infinite
    // entry dominates for every matrix norm the handler computes.
    const ce = new ComputeEngine();
    const M = ['List', ['List', INF, 'NaN'], ['List', 1, 2]];
    expect(ce.box(['Norm', M]).evaluate().toString()).toBe('+oo');
    expect(ce.box(['Norm', M, 1]).evaluate().toString()).toBe('+oo');
    // With no infinite entry, a NaN entry makes the operator norms NaN. They
    // used to answer the maximum of the REMAINING columns/rows — 4 and 5 here
    // — because every comparison with NaN is false, so the NaN column was
    // silently skipped; the compiled lane propagated the NaN all along.
    const N = ['List', ['List', 'NaN', 1], ['List', 2, 3]];
    expect(ce.box(['Norm', N, 1]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Norm', N, INF]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Norm', N]).evaluate().isNaN).toBe(true);
    // The finite operator norms are unchanged: max column sum, max row sum.
    const F = ['List', ['List', 1, 2], ['List', 3, 4]];
    expect(ce.box(['Norm', F, 1]).evaluate().toString()).toBe('6');
    expect(ce.box(['Norm', F, INF]).evaluate().toString()).toBe('7');
  });

  test('Distance follows Norm at a non-finite point', () => {
    // `Distance(p, q)` is `Norm(p − q)`, so the same rule decides it: an
    // infinite coordinate difference — signed or `~oo` — makes the distance
    // `+oo` whatever the other differences are; otherwise a NaN difference
    // makes it NaN. Each of these used to answer the out-of-band
    // `Error("expected-value")`, from a `!isFinite` guard on the coordinates
    // (user ruling 2026-09-02: in-band values, not an error).
    const ce = new ComputeEngine();
    const at = (p: any, q: any) => ce.box(['Distance', p, q]);
    for (const [p, q] of [
      [
        ['Tuple', INF, 0],
        ['Tuple', 0, 0],
      ],
      [
        ['Tuple', NEG_INF, 0],
        ['Tuple', 0, 0],
      ],
      [
        ['Tuple', INF, 'NaN'],
        ['Tuple', 0, 0],
      ],
      [
        ['Tuple', 'ComplexInfinity', 0],
        ['Tuple', 0, 0],
      ],
    ] as any[]) {
      expect(at(p, q).evaluate().toString()).toBe('+oo');
      expect(at(p, q).N().toString()).toBe('+oo');
    }
    // A NaN coordinate with no infinite sibling: NaN, not an error.
    expect(at(['Tuple', 'NaN', 0], ['Tuple', 0, 0]).evaluate().isNaN).toBe(
      true
    );
    expect(at(['Tuple', 'NaN', 0], ['Tuple', 0, 0]).N().isNaN).toBe(true);
    // Two EQUAL infinite coordinates cancel to `∞ − ∞`, which is NaN — the
    // difference, not the coordinate, is what the rule reads. This is why the
    // type handler demotes to the top numeric type as soon as a coordinate is
    // not proven finite: a norm of extended-real components can claim
    // `real | +oo`, but a distance between them can be NaN.
    const cancel = at(['Tuple', INF, 0], ['Tuple', INF, 0]);
    expect(cancel.evaluate().isNaN).toBe(true);
    expect(cancel.type.matches('number')).toBe(true);
    expect(cancel.type.toString()).toBe('number');
    // The flat `List` spelling of a point, and the point-list broadcast,
    // follow too.
    expect(at(['List', INF, 0], ['List', 0, 0]).evaluate().toString()).toBe(
      '+oo'
    );
    expect(
      at(['List', ['Tuple', INF, 0], ['Tuple', 3, 4]], ['Tuple', 0, 0])
        .evaluate()
        .toString()
    ).toBe('[+oo,5]');
    // A finite pair is unchanged, exact under `evaluate()`.
    expect(at(['Tuple', 0, 0], ['Tuple', 3, 4]).evaluate().toString()).toBe(
      '5'
    );
    expect(at(['Tuple', 0, 0], ['Tuple', 1, 1]).evaluate().toString()).toBe(
      'sqrt(2)'
    );
    expect(at(['Tuple', 0, 0], ['Tuple', 1, 1]).N().re).toBeCloseTo(
      Math.SQRT2,
      12
    );
    // A non-NUMERIC coordinate is still a malformed point, and still the
    // out-of-band error: the ruling moved the non-finite case in-band, not
    // this one.
    const malformed = at(
      ['Tuple', { str: 'x' }, 0],
      ['Tuple', 0, 0]
    ).evaluate();
    expect(isErrorValue(malformed)).toBe(true);
    expect(errorCode(malformed)).toBe('expected-value');
  });

  test('the COMPILED lane answers the same in every corner', () => {
    // `Hypot` lowers to `Math.hypot`, which already carried the IEEE rule;
    // `Norm` lowers to `_SYS.norm`, whose accumulator turned `∞² + NaN²` into
    // `NaN` and had to gain the same infinite-entry scan. Constant folding is
    // disabled so the lowering is what runs, not the interpreter.
    const ce = new ComputeEngine();
    const run = (json: any) => {
      const r = compile(ce.box(json), { fallback: false, constantFold: false });
      if (r === undefined) throw new Error('compile() returned undefined');
      expect(r.success).toBe(true);
      return r.run!();
    };
    expect(run(['Norm', ['Tuple', INF, 'NaN']])).toBe(Infinity);
    expect(run(['Norm', ['List', INF, 'NaN']])).toBe(Infinity);
    expect(run(['Abs', ['Tuple', INF, 'NaN']])).toBe(Infinity);
    expect(run(['Hypot', INF, 'NaN'])).toBe(Infinity);
    expect(run(['Hypot', 'ComplexInfinity', 3])).toBe(Infinity);
    expect(run(['Norm', ['List', ['List', INF, 'NaN'], ['List', 1, 2]]])).toBe(
      Infinity
    );
    // The NaN controls, on the compiled lane too.
    expect(run(['Norm', ['List', 1, 'NaN']])).toBeNaN();
    expect(run(['Hypot', 'NaN', 1])).toBeNaN();
    expect(
      run(['Norm', ['List', ['List', 'NaN', 1], ['List', 2, 3]], 1])
    ).toBeNaN();
    // A matrix order this lane does not implement is NaN whatever the entries
    // are: the infinite-entry scan applies inside the orders it does, as it
    // does in the interpreter, so an entry cannot make an unsupported order
    // answer.
    expect(run(['Norm', ['List', ['List', 1, 2], ['List', 3, 4]], 3])).toBeNaN();
    expect(
      run(['Norm', ['List', ['List', INF, 2], ['List', 3, 4]], 3])
    ).toBeNaN();
    // A VECTOR order this lane does not implement is NaN for the same reason.
    // The orders it implements are the L∞ maximum and the p-norms for `p > 0`;
    // `p = 0` used to answer `+∞` for a two-element vector, and a negative `p`
    // a confident ordinary number, where the interpreter leaves the
    // application inert. The order decides before the infinite-entry scan, so
    // an entry cannot make an unsupported order answer.
    expect(run(['Norm', ['List', 1, 1], 0])).toBeNaN();
    expect(run(['Norm', ['List', 2], -1])).toBeNaN();
    expect(run(['Norm', ['List', INF], 0])).toBeNaN();
    // The orders it DOES implement are unchanged, including a fractional one.
    expect(run(['Norm', ['List', 3, 4], 1])).toBe(7);
    expect(run(['Norm', ['List', 3, 4], INF])).toBe(4);
    expect(run(['Norm', ['List', 1], 0.5])).toBe(1);
    // `Distance` lowers to `_SYS.distance`, whose accumulator had the same
    // problem as `_SYS.norm`'s.
    const D = (p: any, q: any) => run(['Distance', p, q]);
    expect(D(['Tuple', INF, 0], ['Tuple', 0, 0])).toBe(Infinity);
    expect(D(['Tuple', INF, 'NaN'], ['Tuple', 0, 0])).toBe(Infinity);
    expect(D(['Tuple', 'ComplexInfinity', 0], ['Tuple', 0, 0])).toBe(Infinity);
    expect(D(['Tuple', 'NaN', 0], ['Tuple', 0, 0])).toBeNaN();
    // And the finite values.
    expect(run(['Norm', ['List', 3, 4]])).toBe(5);
    expect(run(['Hypot', 3, 4])).toBe(5);
    expect(D(['Tuple', 0, 0], ['Tuple', 3, 4])).toBe(5);
  });

  test('the finite norms are unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Norm', ['Tuple', 3, 4]])
        .evaluate()
        .toString()
    ).toBe('5');
    expect(
      ce
        .box(['Norm', ['List', 3, 4]])
        .evaluate()
        .toString()
    ).toBe('5');
    expect(
      ce
        .box(['Abs', ['Tuple', 3, 4]])
        .evaluate()
        .toString()
    ).toBe('5');
    expect(ce.box(['Hypot', 3, 4]).evaluate().toString()).toBe('5');
    // A finite COMPLEX leg is still outside `Hypot`'s carrier: the carrier
    // gained the infinities, not the finite complex plane.
    expect(
      isErrorValue(operand(ce.box(['Hypot', 'ImaginaryUnit', 1]), 1))
    ).toBe(true);
  });
});

//
// Phase F batch 11 — the arithmetic core
//

describe('the arithmetic core declares its domains', () => {
  // Signature flips of 2026-09-02 (Phase F batch 11), decided by the
  // precedent of the earlier batches:
  //
  // - `Divide` and `Negate` take the EXTENDED COMPLEX plane in every slot
  //   (`complex | infinity`). Every point of that carrier has a value, or
  //   is an indeterminate FORM whose value is `NaN` (`0/0`, `∞/∞`,
  //   `~oo/~oo`, `~oo/∞`, `∞/~oo`) — the arrangement `Power` makes for
  //   `0^0` — so neither head has an off-carrier point and neither flip
  //   changes any answer. Both declarations are enforced by their
  //   `canonical` handler's `checkNumericArgs` rather than by the boxing
  //   signature validation, which a head with a `canonical` handler
  //   bypasses (with the dispatch-time conformance re-test).
  // - `Square` is NOT flipped: it canonicalizes to `Power(x, 2)`, so
  //   `Power`'s own base carrier governs every exceptional point (the
  //   `Exp` arrangement).
  // - `Clamp`, `ElementMax` and `ElementMin` take the EXTENDED REAL line
  //   (`real | signed_infinity`), because an extremum is defined by the
  //   ORDER of the real line. That is the batch's one behavior change: a
  //   non-real operand or `~oo` is an `incompatible-type` error at boxing
  //   where it used to leave the application inert forever, and `NaN` now
  //   propagates through the framework gate with the sharp `nan` type.
  //
  // Every value pin below holds on the box route and the parse route.

  const isNaNv = (ce: ComputeEngine, v: Expression) => isNaNValue(ce, v);

  test('Divide: the extended complex plane in every slot, no error point', () => {
    const ce = new ComputeEngine();
    const NANQ = ce.NaN;
    const OO = ce.PositiveInfinity;
    const NOO = ce.NegativeInfinity;
    const COO = ce.ComplexInfinity;
    // [numerator LaTeX, denominator LaTeX, MathJSON numerator, MathJSON
    // denominator, expected value]. `~oo` is an ordinary value of the
    // carrier, never governed by the NaN policy.
    const rows: [string, string, any, any, Expression][] = [
      ['1', '0', 1, 0, COO],
      ['0', '0', 0, 0, NANQ],
      ['\\infty', '\\infty', 'PositiveInfinity', 'PositiveInfinity', NANQ],
      ['\\infty', '0', 'PositiveInfinity', 0, COO],
      ['0', '\\infty', 0, 'PositiveInfinity', ce.Zero],
      ['1', '\\infty', 1, 'PositiveInfinity', ce.Zero],
      ['\\infty', '2', 'PositiveInfinity', 2, OO],
      ['\\infty', '-2', 'PositiveInfinity', -2, NOO],
      ['\\tilde\\infty', '2', 'ComplexInfinity', 2, COO],
      ['2', '\\tilde\\infty', 2, 'ComplexInfinity', ce.Zero],
      [
        '\\tilde\\infty',
        '\\tilde\\infty',
        'ComplexInfinity',
        'ComplexInfinity',
        NANQ,
      ],
      ['\\tilde\\infty', '0', 'ComplexInfinity', 0, COO],
      ['0', '\\tilde\\infty', 0, 'ComplexInfinity', ce.Zero],
      [
        '\\tilde\\infty',
        '\\infty',
        'ComplexInfinity',
        'PositiveInfinity',
        NANQ,
      ],
      [
        '\\infty',
        '\\tilde\\infty',
        'PositiveInfinity',
        'ComplexInfinity',
        NANQ,
      ],
      ['i', '\\infty', 'ImaginaryUnit', 'PositiveInfinity', ce.Zero],
      ['\\infty', 'i', 'PositiveInfinity', 'ImaginaryUnit', COO],
      ['i', '0', 'ImaginaryUnit', 0, COO],
    ];
    for (const [nTex, dTex, nJson, dJson, expected] of rows) {
      const boxed = ce.box(['Divide', nJson, dJson]);
      const parsed = ce.parse(`\\frac{${nTex}}{${dTex}}`);
      for (const e of [boxed, parsed]) {
        expect(e.evaluate().isSame(expected)).toBe(true);
        expect(e.N().isSame(expected)).toBe(true);
      }
    }

    // The enforcement seam is `checkNumericArgs` in the `canonical`
    // handler, not the signature: a non-numeric operand is refused at
    // canonicalization, as before the flip.
    for (const bad of [{ str: 'a' }, 'True'])
      expect(ce.box(['Divide', bad, 2]).isValid).toBe(false);

    // A `NaN` operand propagates. `canonicalDivide` folds it to the
    // literal at canonicalization instead of leaving the node for the
    // dispatch-time gate (the divergence from `Power`/`Multiply`/`Add` is
    // deliberate — see the note at that fold), so the type is the sharp
    // literal rather than the wide declared result.
    for (const nan of [
      ce.box(['Divide', 'NaN', 2]),
      ce.box(['Divide', 2, 'NaN']),
      ce.parse('\\frac{\\operatorname{NaN}}{2}'),
    ]) {
      expect(isNaNv(ce, nan.evaluate())).toBe(true);
      expect(nan.type.matches('nan')).toBe(true);
    }

    // Shapes the `Divide` handlers own are untouched by the flip: a point
    // scales component-wise, a list broadcasts, and a `Quantity` keeps its
    // unit (it types `value`, which only the canonical handler's own
    // admission lets through).
    expect(ce.box(['Divide', ['Tuple', 1, 2], 2]).evaluate().toString()).toBe(
      '(1/2, 1)'
    );
    expect(ce.box(['Divide', ['List', 1, 2], 2]).evaluate().toString()).toBe(
      '[1/2,1]'
    );
    expect(
      ce.box(['Divide', ['List', 1, 'NaN'], 2]).evaluate().toString()
    ).toBe('[1/2,NaN]');
    expect(
      ce
        .box(['Divide', ['Quantity', 5, { str: 'Meter' }], 2])
        .evaluate()
        .toString()
    ).toBe('2.5 Meter');

    // A fresh symbol is still inferred `number`, not the declared carrier:
    // the inference comes from `checkNumericArgs`, which the canonical
    // handler runs in place of the signature validation.
    expect(ce.box(['Divide', 'vB11', 2]).type.toString()).toBe('number');
    expect(ce.box('vB11').type.toString()).toBe('number');
    // A pole at a symbolic numerator is unchanged.
    expect(ce.box(['Divide', 'xB11', 0]).evaluate().isSame(COO)).toBe(true);
  });

  test('Negate: total on the extended complex plane', () => {
    const ce = new ComputeEngine();
    const rows: [any, string, Expression][] = [
      ['PositiveInfinity', '-\\infty', ce.NegativeInfinity],
      ['NegativeInfinity', '-(-\\infty)', ce.PositiveInfinity],
      // `−~oo = ~oo`: an unsigned infinity is its own negation, which is
      // why the carrier admits it and `partiality` is `total`.
      ['ComplexInfinity', '-\\tilde\\infty', ce.ComplexInfinity],
      ['NaN', '-\\operatorname{NaN}', ce.NaN],
    ];
    for (const [json, tex, expected] of rows) {
      for (const e of [ce.box(['Negate', json]), ce.parse(tex)]) {
        expect(e.evaluate().isSame(expected)).toBe(true);
        expect(e.N().isSame(expected)).toBe(true);
      }
    }

    // The admission seam is the canonical handler's `checkNumericArgs`,
    // exactly as before the flip.
    for (const bad of [{ str: 'a' }, 'True'])
      expect(ce.box(['Negate', bad]).isValid).toBe(false);

    // The missing-value behavior is no longer declared: with every
    // parameter numeric it DERIVES to `propagate`, so an absent operand
    // still yields `NaN` (§3.A of the missing-value typing design).
    expect(isNaNv(ce, ce.box(['Negate', 'Missing']).evaluate())).toBe(true);

    // A `Quantity` and a `Measurement` type `value` — disjoint from the
    // declared carrier — and keep working because the canonical handler,
    // not the signature validation, is what admits them.
    expect(
      ce
        .box(['Negate', ['Quantity', 5, { str: 'Meter' }]])
        .evaluate()
        .toString()
    ).toBe('-5 Meter');
    expect(
      ce
        .box(['Negate', ['Measurement', 5, 1]])
        .evaluate()
        .toString()
    ).toBe('-5.0 ± 1.0');

    // The type handler's echo — component-wise for a tuple, element-wise
    // for a collection, ranges reflected about zero — is unchanged.
    expect(ce.box(['Negate', ['Tuple', 1, 2]]).evaluate().toString()).toBe(
      '(-1, -2)'
    );
    expect(ce.box(['Negate', ['List', 1, 2]]).type.toString()).toBe(
      'vector<integer^2>'
    );
    expect(ce.box(['Negate', 'ImaginaryUnit']).type.toString()).toBe(
      'imaginary'
    );
  });

  test('Square: no carrier of its own — it rides on Power', () => {
    const ce = new ComputeEngine();
    // `Square(x)` canonicalizes to `Power(x, 2)`, so `Power`'s BASE
    // carrier (`complex | infinity`, `nanBehavior: 'propagate'`) decides
    // every exceptional point and no `Square` node survives to consult a
    // carrier declared here.
    expect(ce.box(['Square', 'sqB11']).json).toEqual(['Power', 'sqB11', 2]);
    const rows: [any, string, Expression][] = [
      ['NaN', '\\operatorname{Square}(\\operatorname{NaN})', ce.NaN],
      ['PositiveInfinity', '\\infty^2', ce.PositiveInfinity],
      ['NegativeInfinity', '(-\\infty)^2', ce.PositiveInfinity],
      // A positive power of `~oo` is `~oo` in every direction of approach.
      ['ComplexInfinity', '(\\tilde\\infty)^2', ce.ComplexInfinity],
    ];
    for (const [json, tex, expected] of rows) {
      for (const e of [ce.box(['Square', json]), ce.parse(tex)]) {
        expect(e.evaluate().isSame(expected)).toBe(true);
        expect(e.N().isSame(expected)).toBe(true);
      }
    }
    expect(ce.box(['Square', 'ImaginaryUnit']).evaluate().isSame(-1)).toBe(
      true
    );
  });

  test('Clamp / ElementMax / ElementMin: the extended REAL line', () => {
    const ce = new ComputeEngine();
    const OO = 'PositiveInfinity';
    const NOO = 'NegativeInfinity';
    const COO = 'ComplexInfinity';
    const both = (json: any, tex: string, check: (v: Expression) => boolean) => {
      for (const e of [ce.box(json), ce.parse(tex)]) {
        expect(check(e.evaluate())).toBe(true);
        expect(check(e.N())).toBe(true);
      }
    };
    const is = (n: any) => (v: Expression) => v.isSame(n);

    // The infinities are ordinary values of the carrier and keep theirs.
    both(['Clamp', OO, 0, 1], '\\operatorname{Clamp}(\\infty,0,1)', is(1));
    both(['Clamp', NOO, 0, 1], '\\operatorname{Clamp}(-\\infty,0,1)', is(0));
    both(
      ['Clamp', 0.5, NOO, OO],
      '\\operatorname{Clamp}(0.5,-\\infty,\\infty)',
      is(0.5)
    );
    both(
      ['ElementMax', OO, 1],
      '\\operatorname{ElementMax}(\\infty,1)',
      (v) => v.isSame(ce.PositiveInfinity)
    );
    both(['ElementMax', NOO, 1], '\\operatorname{ElementMax}(-\\infty,1)', is(1));
    both(['ElementMin', OO, 1], '\\operatorname{ElementMin}(\\infty,1)', is(1));
    // The order is total on the whole carrier, `lo > hi` included, which
    // is why `partiality` is `total`: `Clamp(5, 1, 0)` is `min(max(5, 1), 0)`.
    both(['Clamp', 5, 1, 0], '\\operatorname{Clamp}(5,1,0)', is(0));

    // `NaN` propagates through the framework gate, and the declared
    // NaN-free result lets the sharp `nan` claim show (the old wide
    // `number` handler answer hid it).
    for (const [json, tex] of [
      [['Clamp', 'NaN', 0, 1], '\\operatorname{Clamp}(\\operatorname{NaN},0,1)'],
      [
        ['ElementMax', 'NaN', 1],
        '\\operatorname{ElementMax}(\\operatorname{NaN},1)',
      ],
      [
        ['ElementMin', 'NaN', 1],
        '\\operatorname{ElementMin}(\\operatorname{NaN},1)',
      ],
    ] as [any, string][]) {
      for (const e of [ce.box(json), ce.parse(tex)]) {
        expect(isNaNv(ce, e.evaluate())).toBe(true);
        expect(e.type.toString()).toBe('nan');
      }
    }

    // A non-real operand and `~oo` are OFF the carrier — an
    // `incompatible-type` error at boxing, where each used to be admitted
    // and stay inert forever. These heads have no `canonical` handler and
    // no fast path, so the boxing signature validation is the seam.
    for (const [json, tex] of [
      [['Clamp', COO, 0, 1], '\\operatorname{Clamp}(\\tilde\\infty,0,1)'],
      [['Clamp', 'ImaginaryUnit', 0, 1], '\\operatorname{Clamp}(i,0,1)'],
      [
        ['ElementMax', COO, 1],
        '\\operatorname{ElementMax}(\\tilde\\infty,1)',
      ],
      [['ElementMax', 'ImaginaryUnit', 1], '\\operatorname{ElementMax}(i,1)'],
      [['ElementMin', 'ImaginaryUnit', 1], '\\operatorname{ElementMin}(i,1)'],
    ] as [any, string][]) {
      for (const e of [ce.box(json), ce.parse(tex)]) {
        expect(e.isValid).toBe(false);
        expect(errorCode(e.evaluate())).toBe('incompatible-type');
      }
    }
    // The re-test refutes an off-carrier value that only arrives later:
    // a symbol assigned `i` after the application was built.
    ce.assign('hB11', ce.box('ImaginaryUnit'));
    expect(
      errorCode(ce.function('ElementMax', [ce.box('hB11'), ce.box(1)]).evaluate())
    ).toBe('incompatible-type');

    // The slim type handler claims the operands' common tier — these heads
    // SELECT one of their operands, they never compute — and declines
    // wherever finiteness or realness is not proven, so the declared
    // `real | signed_infinity` shows instead of the old blanket `number`.
    expect(ce.box(['ElementMin', 2, 5]).type.toString()).toBe('integer');
    expect(ce.box(['Clamp', 5, 1, 0]).type.toString()).toBe('integer');
    expect(ce.box(['ElementMax', OO, 1]).type.toString()).toBe(
      'real | signed_infinity'
    );
    // Under the broadcast lift the handler reads the CELL type, so a list
    // of integers keeps a sharp per-cell claim.
    expect(ce.box(['Clamp', ['List', 1, 2], 0, 1]).type.toString()).toBe(
      'vector<integer^2>'
    );
    expect(
      ce.box(['Clamp', ['List', -1, 0.5, 2], 0, 1]).evaluate().toString()
    ).toBe('[0,0.5,1]');
    expect(
      ce.box(['ElementMax', ['List', 1, 'NaN'], 3]).evaluate().toString()
    ).toBe('[3,NaN]');

    // A fresh symbol IS inferred from the declared carrier here, unlike
    // `Divide`: these heads have no `canonical` handler, so the signature
    // validation — which is what infers — actually runs.
    expect(ce.box(['Clamp', 'cB11', 0, 1]).type.toString()).toBe(
      'real | signed_infinity'
    );
    expect(ce.box('cB11').type.toString()).toBe('real | signed_infinity');
  });
});
