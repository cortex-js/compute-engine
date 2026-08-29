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
    // inhabit `infinity`, through the signed-pair atom `non_finite_number`.
    expect(ce.PositiveInfinity.type.matches('real')).toBe(false);
    expect(ce.PositiveInfinity.type.matches('non_finite_number')).toBe(true);
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
      // reach it and it carries its own `NaN` arm. Leaving it inert made
      // inertness the terminal answer to a decidable question, which
      // ERROR-MODEL §1 forbids.
      test(`[${route}] both evaluate() and N() answer NaN`, () => {
        expect(isNaNValue(ce, expr.evaluate())).toBe(true);
        expect(isNaNValue(ce, expr.N())).toBe(true);
      });
    }
  });

  test('Sign(NaN) propagates too — the same sign-dispatch handler shape', () => {
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
