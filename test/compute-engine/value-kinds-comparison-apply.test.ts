// Value kinds, step 4b: the dispatch of the comparisons to the `compare`
// hooks, the `apply` dispatch at the apply sites, their typing, and the
// `simplify()` barrier at the apply sites
// (`docs/plans/2026-10-26-value-kinds.md`, sections 4.3 to 4.7).
//
// The kinds (`value-kinds-helpers.ts`):
// - `GF8` (`gf8`, `admittedAs: 'none'`): arithmetic hooks, no `compare`, no
//   `apply`;
// - `MyMod` (`residue`): `add`, `multiply`, `negate`; no `eq`, no `compare`;
// - the library `ResidueClass` (`residue`): no `compare`, an `eq` handler;
// - `UserMeasurement` (`umeasurement`, `admittedAs: 'number'`): every hook,
//   `compare` by nominal, `apply` by first-order propagation.

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import {
  isFunction,
  isString,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';
import type { MathJsonExpression } from '../../src/math-json/types';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import {
  describe as describeOperand,
  describeType,
} from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { typeToString } from '../../src/common/type/serialize';
import {
  APPLY_CALLS,
  declareGF8,
  declareMyMod,
  declareUserMeasurement,
} from './value-kinds-helpers';

type Json = MathJsonExpression;

function kindEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  declareGF8(ce);
  declareMyMod(ce);
  declareUserMeasurement(ce);
  return ce;
}

const ce = kindEngine();
const box = (x: Json) => ce.box(x);
const evaluate = (x: Json) => box(x).evaluate();
const typeOf = (x: Json) => box(x).type.toString();

const RC = (k: number, n: number): Json => ['ResidueClass', k, n];
const GF = (k: number): Json => ['GF8', k];
const M = (k: number, n: number): Json => ['MyMod', k, n];
const U = (nominal: Json, sigma: Json): Json => [
  'UserMeasurement',
  nominal,
  sigma,
];
const U1 = U(1, 0.1);
const U2 = U(2, 0.1);
const U3 = U(3, 0.1);
// The nominal of `U1`, another uncertainty.
const U5 = U(1, 0.5);

/** The code of the error `x`, or `undefined` when `x` is not an error. */
function errorCode(x: Expression): string | undefined {
  if (!isFunction(x, 'Error')) return undefined;
  const code = x.op1;
  return isFunction(code, 'ErrorCode') ? stringOf(code.op1) : stringOf(code);
}

/** The content of the string literal `x`, or `undefined`. */
function stringOf(x: Expression): string | undefined {
  return isString(x) ? x.string : undefined;
}

/** The nominal and the uncertainty of the measurement `x`, as numbers. */
function measurementOf(x: Expression): [number, number] {
  expect(x.operator).toBe('UserMeasurement');
  if (!isFunction(x)) throw new Error('not a measurement');
  return [x.op1.N().re, x.op2.N().re];
}

describe('VALUE KINDS COMPARISON: kinds without `compare`', () => {
  test('Less(c1, c2) stays unevaluated, typed boolean', () => {
    const expr = box(['Less', RC(1, 5), RC(2, 5)]);
    expect(expr.type.toString()).toBe('boolean');
    expect(expr.evaluate().operator).toBe('Less');
  });

  test('the identity shortcut: Less(c, c) is False, LessEqual(c, c) is True', () => {
    expect(evaluate(['Less', RC(1, 5), RC(1, 5)]).json).toBe('False');
    expect(evaluate(['LessEqual', RC(1, 5), RC(1, 5)]).json).toBe('True');
  });

  test('Max(c, x) and Max(GF8(1), GF8(2)) are typed error', () => {
    for (const json of [
      ['Max', RC(1, 5), 'x'],
      ['Max', GF(1), GF(2)],
    ] as Json[]) {
      expect(typeOf(json)).toBe('error');
      expect(errorCode(evaluate(json))).toBe('incompatible-type');
    }
  });

  test('Equal(c, c) is True', () => {
    expect(evaluate(['Equal', RC(1, 5), RC(1, 5)]).json).toBe('True');
  });

  test('an `eq` that declines is final: the comparison stays unevaluated', () => {
    for (const json of [
      ['Equal', RC(1, 5), 2],
      ['Equal', RC(1, 5), RC(1, 6)],
      ['Equal', M(2, 5), RC(2, 5)],
      ['Equal', RC(2, 5), M(2, 5)],
    ] as Json[])
      expect(evaluate(json).operator).toBe('Equal');
  });

  test('two forms of one class of a kind without `eq` stay unevaluated', () => {
    expect(evaluate(['Equal', M(7, 5), M(2, 5)]).operator).toBe('Equal');
    expect(evaluate(['Equal', M(2, 5), M(2, 5)]).json).toBe('True');
  });

  test('values of provably disjoint types are not equal', () => {
    expect(evaluate(['Equal', GF(1), { str: 'abc' }]).json).toBe('False');
    expect(evaluate(['NotEqual', GF(1), { str: 'abc' }]).json).toBe('True');
  });

  test('Sort([GF8(1), GF8(2)]) stays unevaluated', () => {
    expect(evaluate(['Sort', ['List', GF(1), GF(2)]]).operator).toBe('Sort');
  });

  test('Clamp(GF8(1), 0, 3) is typed error', () => {
    expect(typeOf(['Clamp', GF(1), 0, 3])).toBe('error');
  });

  test('(GF8(1) + GF8(2)).is(GF8(3)) compares the values by `isSame`', () => {
    expect(box(['Add', GF(1), GF(2)]).is(box(GF(3)))).toBe(true);
    expect(box(GF(3)).is(box(['Add', GF(1), GF(2)]))).toBe(true);
    expect(box(['Add', GF(1), GF(2)]).is(box(GF(2)))).toBe(false);
  });
});

describe('VALUE KINDS COMPARISON: a kind with `compare`', () => {
  test('the order operators read the nominal', () => {
    expect(evaluate(['Less', U1, U2]).json).toBe('True');
    expect(evaluate(['Less', U2, U1]).json).toBe('False');
    expect(evaluate(['Less', U2, 3]).json).toBe('True');
    expect(evaluate(['Greater', U2, 3]).json).toBe('False');
    expect(evaluate(['LessEqual', U1, U5]).json).toBe('True');
    expect(box(['Less', U1, U2]).type.toString()).toBe('boolean');
  });

  test('Equal: `compare` decides, also for two uncertainties', () => {
    expect(evaluate(['Equal', U2, 2]).json).toBe('True');
    expect(evaluate(['Equal', U1, U5]).json).toBe('True');
    expect(evaluate(['NotEqual', U1, U2]).json).toBe('True');
    expect(evaluate(['Equal', U1, U2]).json).toBe('False');
  });

  test('a chain is decided pair by pair', () => {
    expect(evaluate(['Less', U1, U2, U3]).json).toBe('True');
    expect(evaluate(['Less', U1, U3, U2]).json).toBe('False');
  });

  test('a pair that is not comparable leaves the comparison unevaluated', () => {
    expect(evaluate(['Less', U1, 'w']).operator).toBe('Less');
    expect(evaluate(['Less', U1, U2, 'w']).operator).toBe('Less');
    expect(evaluate(['Less', U1, GF(1)]).operator).toBe('Less');
  });

  test('Max keeps the first of a tie and returns the chosen operand', () => {
    expect(evaluate(['Max', U1, U5]).isSame(box(U1))).toBe(true);
    expect(evaluate(['Max', U5, U1]).isSame(box(U5))).toBe(true);
    expect(evaluate(['Max', U2, 2]).isSame(box(U2))).toBe(true);
    expect(evaluate(['Min', U1, U2, U3]).isSame(box(U1))).toBe(true);
    expect(evaluate(['Max', ['List', U1, U3, U2]]).isSame(box(U3))).toBe(true);
    expect(typeOf(['Max', U1, U5])).toBe('umeasurement');
  });

  test('Max(U, 3) is typed by the kind arm and the number operand', () => {
    const t = box(['Max', U2, 3]).type;
    expect(t.matches(ce.type('integer | umeasurement'))).toBe(true);
    expect(ce.type('umeasurement').matches(t)).toBe(true);
    expect(evaluate(['Max', U2, 3]).isSame(3)).toBe(true);
  });

  test('Max with a value that is not comparable stays unevaluated', () => {
    expect(evaluate(['Max', U1, 'w']).operator).toBe('Max');
  });

  test('Sort orders by `compare`, and stays unevaluated otherwise', () => {
    const sorted = evaluate(['Sort', ['List', U2, U1]]);
    expect(sorted.isSame(box(['List', U1, U2]))).toBe(true);
    expect(evaluate(['Sort', ['List', U1, 'w', U2]]).operator).toBe('Sort');
  });

  test('Sort with an `order` callback runs the callback', () => {
    const sorted = evaluate([
      'Sort',
      ['List', U1, U3, U2],
      ['Function', ['Greater', 'a', 'b'], 'a', 'b'],
    ]);
    expect(sorted.isSame(box(['List', U3, U2, U1]))).toBe(true);
  });

  test('Clamp returns the bound as written', () => {
    expect(evaluate(['Clamp', U(5, 0.1), 0, 3]).isSame(3)).toBe(true);
    expect(evaluate(['Clamp', U2, 0, 3]).isSame(box(U2))).toBe(true);
    const t = box(['Clamp', U(5, 0.1), 0, 3]).type;
    expect(ce.type('umeasurement').matches(t)).toBe(true);
  });

  test('`.is()` uses `Equal`, and ignores a tolerance', () => {
    expect(box(U2).is(2)).toBe(true);
    expect(ce.number(2).is(box(U2))).toBe(true);
    expect(box(U(2.3, 0.1)).is(2)).toBe(false);
    expect(box(U(2.3, 0.1)).is(2, 0.5)).toBe(false);
    expect(box(U1).is(box(U5))).toBe(true);
  });

  test('the comparison methods', () => {
    const [a, b] = [box(U1), box(U2)];
    expect(a.isLess(b)).toBe(true);
    expect(a.isGreater(b)).toBe(false);
    expect(b.isGreaterEqual(a)).toBe(true);
    expect(a.isEqual(box(U5))).toBe(true);
    expect(a.isLess(box('w'))).toBe(undefined);
  });

  test('under .N(), two values whose nominals round to one float stay distinct', () => {
    // At the working precision, the floats of `1/3` and `1/3 + 10⁻³⁰` are
    // equal within the engine tolerance: the comparison reads the exact
    // nominals.
    const A = U(['Rational', 1, 3], 0.1);
    const B = U(['Add', ['Rational', 1, 3], ['Power', 10, -30]], 0.1);
    expect(box(A).N().isEqual(box(B).N())).toBe(true);
    const N = (x: Json) => box(x).N().json;
    expect(N(['Equal', A, B])).toBe('False');
    expect(N(['NotEqual', A, B])).toBe('True');
    expect(N(['Less', A, B])).toBe('True');
    expect(N(['Greater', A, B])).toBe('False');
    expect(N(['LessEqual', B, A])).toBe('False');
    expect(N(['Less', A, B, U2])).toBe('True');
    expect(N(['Equal', A, B, B])).toBe('False');
    expect(N(['Equal', A, A])).toBe('True');
    expect(N(['Less', A, A])).toBe('False');
  });

  test('evaluateAsync dispatches the same way', async () => {
    expect((await box(['Less', U1, U2]).evaluateAsync()).json).toBe('True');
    expect((await box(['Equal', U1, U5]).evaluateAsync()).json).toBe('True');
  });

  test('a kind with `compare` and `admittedAs: none` is admitted at Clamp', () => {
    const e = kindEngine();
    e.declareType('ord', 'value', { mint: false });
    e.declare('O', {
      signature: '(integer) -> ord',
      arithmetic: {
        compare: (a, b) => {
          const v = (x: Expression) => (isFunction(x, 'O') ? x.op1.re : x.re);
          const [p, q] = [v(a.evaluated), v(b.evaluated)];
          if (!Number.isFinite(p) || !Number.isFinite(q)) return undefined;
          return p < q ? -1 : p > q ? 1 : 0;
        },
      },
    });
    const clamp = e.box(['Clamp', ['O', 5], 0, 3]);
    expect(clamp.isValid).toBe(true);
    expect(clamp.evaluate().isSame(3)).toBe(true);
    expect(
      e
        .box(['Max', ['O', 1], ['O', 2]])
        .evaluate()
        .toString()
    ).toBe('O(2)');
  });
});

describe('VALUE KINDS APPLY: the hook answers at an apply site', () => {
  test('Sin(U) is typed umeasurement and propagates the uncertainty', () => {
    expect(typeOf(['Sin', U1])).toBe('umeasurement');
    const [nominal, sigma] = measurementOf(evaluate(['Sin', U1]));
    expect(nominal).toBeCloseTo(Math.sin(1), 12);
    expect(sigma).toBeCloseTo(Math.abs(Math.cos(1)) * 0.1, 12);
  });

  test('Factorial(U) is propagated as Gamma(a + 1)', () => {
    expect(typeOf(['Factorial', U3])).toBe('umeasurement');
    const [nominal, sigma] = measurementOf(evaluate(['Factorial', U3]));
    expect(nominal).toBe(6);
    // Γ′(4) = Γ(4)·ψ(4) = 6·(1 + 1/2 + 1/3 − γ)
    const digamma4 = 1 + 1 / 2 + 1 / 3 - 0.5772156649015329;
    expect(sigma).toBeCloseTo(6 * digamma4 * 0.1, 12);
  });

  test('Floor(U) reads the exact nominal and keeps the uncertainty', () => {
    expect(typeOf(['Floor', U(2.5, 0.1)])).toBe('umeasurement');
    expect(evaluate(['Floor', U(2.5, 0.1)]).isSame(box(U(2, 0.1)))).toBe(true);
  });

  test('Floor(U) with a complex nominal is an incompatible-type error', () => {
    expect(errorCode(evaluate(['Floor', U(['Complex', 2, 3], 0.1)]))).toBe(
      'incompatible-type'
    );
  });

  test('a threadable operator maps over a list first', () => {
    expect(typeOf(['Sin', ['List', U1, U2]])).toBe('list<umeasurement^2>');
    const result = evaluate(['Sin', ['List', U1, U2]]);
    expect(result.operator).toBe('List');
    if (!isFunction(result)) throw new Error('not a list');
    expect(result.nops).toBe(2);
    expect(measurementOf(result.op1)[0]).toBeCloseTo(Math.sin(1), 12);
    expect(measurementOf(result.op2)[0]).toBeCloseTo(Math.sin(2), 12);
    expect(
      evaluate(['Floor', ['List', U(1.5, 0.1), 2.5]]).isSame(
        box(['List', U(1, 0.1), 2])
      )
    ).toBe(true);
  });

  test('Abs(U) is not folded by a numeric property read', () => {
    const u = box(U2);
    expect(u.isPositive).toBe(undefined);
    expect(u.isNegative).toBe(undefined);
    expect(u.sgn).toBe(undefined);
    expect(u.isInteger).toBe(undefined);
    expect(u.isFinite).toBe(undefined);
    // The canonical form keeps the call; `apply` gives the value.
    expect(box(['Abs', U2]).operator).toBe('Abs');
    expect(typeOf(['Abs', U2])).toBe('umeasurement');
    expect(evaluate(['Abs', U(-2, 0.1)]).isSame(box(U2))).toBe(true);
  });

  test('an operator whose result is not a number keeps its type', () => {
    // `IsOdd: (number) -> boolean`; the plan names `IsInteger`, which is not
    // a library operator.
    expect(typeOf(['IsOdd', U3])).toBe('boolean');
  });

  test('evaluateAsync dispatches the same way', async () => {
    const result = await box(['Sin', U1]).evaluateAsync();
    expect(result.isSame(evaluate(['Sin', U1]))).toBe(true);
  });
});

describe('VALUE KINDS APPLY: an operator whose parameter is a collection', () => {
  test('Mean([U, U]) is typed umeasurement and answered by `apply`', () => {
    expect(typeOf(['Mean', ['List', U1, U3]])).toBe('umeasurement');
    const [nominal, sigma] = measurementOf(
      evaluate(['Mean', ['List', U1, U3]])
    );
    expect(nominal).toBe(2);
    expect(sigma).toBeCloseTo(Math.sqrt(0.02) / 2, 12);
  });

  test('a lazy collection is enumerated once', () => {
    const e = kindEngine();
    let ticks = 0;
    e.declare('Tick', {
      signature: '(integer) -> umeasurement',
      evaluate: ([k]) => {
        ticks += 1;
        return e.function('UserMeasurement', [k, e.number(0.1)]);
      },
    });
    const mean = e.box([
      'Mean',
      ['Map', ['Function', ['Tick', 'k'], 'k'], ['Range', 1, 3]],
    ]);
    expect(mean.type.toString()).toBe('umeasurement');
    APPLY_CALLS.length = 0;
    const [nominal, sigma] = measurementOf(mean.evaluate());
    expect(ticks).toBe(3);
    expect(APPLY_CALLS).toEqual(['Mean']);
    expect(nominal).toBe(2);
    expect(sigma).toBeCloseTo(Math.sqrt(0.03) / 3, 12);
  });

  test('a collection of kind-free type is not enumerated', () => {
    APPLY_CALLS.length = 0;
    expect(evaluate(['Mean', ['Range', 1, ['Power', 10, 20]]]).toString()).toBe(
      '100000000000000000001/2'
    );
    expect(APPLY_CALLS).toEqual([]);
  });

  test('a collection larger than maxCollectionSize is left to the handler', () => {
    const e = kindEngine();
    e.declare('Tick', {
      signature: '(integer) -> umeasurement',
      evaluate: ([k]) => e.function('UserMeasurement', [k, e.number(0.1)]),
    });
    e.maxCollectionSize = 5;
    APPLY_CALLS.length = 0;
    const result = e
      .box([
        'Mean',
        ['Map', ['Function', ['Tick', 'k'], 'k'], ['Range', 1, 10]],
      ])
      .evaluate();
    expect(APPLY_CALLS).toEqual([]);
    // The handler of `Mean` refuses a measurement.
    expect(errorCode(result)).toBe('incompatible-type');
  });
});

describe('VALUE KINDS APPLY: the other answers of the dispatch', () => {
  test('a kind without `apply`: the handler runs, the call is typed by it', () => {
    const e = kindEngine();
    e.declareType('kk', 'value', { mint: false });
    e.declare('K', {
      signature: '(real) -> kk',
      arithmetic: { admittedAs: 'real' },
    });
    let runs = 0;
    e.declare('hk', {
      signature: '(real) -> real',
      evaluate: () => {
        runs += 1;
        return e.number(7);
      },
    });
    expect(e.box(['Sin', ['K', 1]]).type.toString()).toBe('real');
    expect(e.box(['Sin', ['K', 1]]).evaluate().operator).toBe('Sin');
    expect(e.box(['hk', ['K', 1]]).type.toString()).toBe('real');
    expect(
      e
        .box(['hk', ['K', 1]])
        .evaluate()
        .isSame(7)
    ).toBe(true);
    expect(runs).toBe(1);
  });

  test('`apply` answers undefined: the call stays, the handler does not run', () => {
    const e = kindEngine();
    let runs = 0;
    e.declare('h', {
      signature: '(real) -> real',
      evaluate: () => {
        runs += 1;
        return e.number(42);
      },
    });
    const call = e.box(['h', U2]);
    expect(call.type.toString()).toBe('umeasurement');
    expect(call.evaluate().isSame(call)).toBe(true);
    expect(runs).toBe(0);
  });

  test('an operator that names the kind type runs its own handler', () => {
    const e = kindEngine();
    e.declare('h2', {
      signature: '(real | umeasurement) -> real',
      evaluate: () => e.number(43),
    });
    expect(e.box(['h2', U2]).type.toString()).toBe('real');
    expect(e.box(['h2', U2]).evaluate().isSame(43)).toBe(true);
  });

  test('an operator that names the kind type: `resultType` can answer', () => {
    const e = kindEngine();
    e.declareType('wk', 'value', { mint: false });
    e.declare('W', {
      signature: '(integer) -> wk',
      arithmetic: {
        resultType: (operator) => (operator === 'hw' ? 'integer' : undefined),
      },
    });
    e.declare('hw', {
      signature: '(real | wk) -> real',
      evaluate: () => e.number(1),
    });
    e.declare('hv', {
      signature: '(real | wk) -> real',
      evaluate: () => e.number(1),
    });
    expect(e.box(['hw', ['W', 1]]).type.toString()).toBe('integer');
    // The hook does not answer for `hv`: its declared result applies.
    expect(e.box(['hv', ['W', 1]]).type.toString()).toBe('real');
  });

  test('a hook that throws propagates its error as a handler does', () => {
    const e = kindEngine();
    e.declareType('boom', 'value', { mint: false });
    e.declare('Boom', {
      signature: '(real) -> boom',
      arithmetic: {
        admittedAs: 'real',
        apply: () => {
          throw new Error('kaboom');
        },
      },
    });
    e.declare('thrower', {
      signature: '(real) -> real',
      evaluate: () => {
        throw new Error('kaboom');
      },
    });
    expect(() => e.box(['thrower', 2]).evaluate()).toThrow('kaboom');
    expect(() => e.box(['Sin', ['Boom', 1]]).evaluate()).toThrow('kaboom');
  });

  test('two kinds at one apply site: the first answer wins', () => {
    const e = kindEngine();
    e.declareType('vk', 'value', { mint: false });
    e.declare('V', {
      signature: '(real) -> vk',
      arithmetic: {
        admittedAs: 'number',
        apply: (operator, _ops, { engine }) => engine.string(`V:${operator}`),
      },
    });
    e.declare('two', {
      signature: '(real, real) -> real',
      evaluate: () => e.number(99),
    });
    // `V` comes first and answers.
    expect(stringOf(e.box(['two', ['V', 1], U2]).evaluate())).toBe('V:two');
    // `UserMeasurement` comes first, does not know `two`, and `V` answers.
    expect(stringOf(e.box(['two', U2, ['V', 1]]).evaluate())).toBe('V:two');
  });

  test('a lazy operator is not an apply site and evaluates only its branch', () => {
    const e = kindEngine();
    let draws = 0;
    e.declare('Draw', {
      signature: '() -> real',
      evaluate: () => {
        draws += 1;
        return e.number(0.5);
      },
    });
    e.declare('Choose2', {
      signature: '(boolean, real, real) -> real',
      lazy: true,
      evaluate: ([c, a, b]) =>
        isSymbol(c.evaluate(), 'True') ? a.evaluate() : b.evaluate(),
    });
    const result = e.box(['Choose2', 'True', U2, ['Draw']]).evaluate();
    expect(result.isSame(e.box(U2))).toBe(true);
    expect(draws).toBe(0);
  });
});

describe('VALUE KINDS: the simplify() barrier at the apply sites', () => {
  const identity = (x: Json): Json => [
    'Add',
    ['Power', ['Sin', x], 2],
    ['Power', ['Cos', x], 2],
  ];

  test('Sin(U)^2 + Cos(U)^2 is not simplified to 1', () => {
    const result = box(identity(U1)).simplify();
    expect(result.isSame(1)).toBe(false);
    const [nominal, sigma] = measurementOf(result);
    expect(nominal).toBeCloseTo(1, 12);
    // The two terms propagate independent errors: the uncertainty is not 0.
    expect(sigma).toBeGreaterThan(0.1);
  });

  test('a body over `real | umeasurement` is not simplified to 1', () => {
    const e = kindEngine();
    e.declare('u', 'real | umeasurement');
    const body = e.box(identity('u')).simplify();
    expect(body.isSame(1)).toBe(false);
    const value = body.subs({ u: e.box(U1) }).evaluate();
    expect(value.operator).toBe('UserMeasurement');
  });

  test('a node that is not an apply site simplifies as before', () => {
    expect(box(['Equal', RC(1, 5), RC(1, 5)]).simplify().json).toBe('True');
    expect(
      box(['Tuple', RC(1, 5), identity('y')])
        .simplify()
        .isSame(box(['Tuple', RC(1, 5), 1]))
    ).toBe(true);
  });
});

describe('VALUE KINDS APPLY: the route from operand types', () => {
  // The type of `op(x)` derived from the descriptor of `x` alone
  // (`deriveApplicationType()`), as a mapping body or a callback result is
  // typed. It must be the type of the boxed call.
  const derived = (op: string, x: Json): string => {
    const t = deriveApplicationType(ce, op, [describeOperand(box(x))]);
    return t === undefined ? 'undefined' : typeToString(t);
  };

  test.each(['Sin', 'Ln', 'Log', 'Exp', 'Abs', 'Floor', 'Factorial'])(
    '%s(U) has the type of the boxed call',
    (op) => {
      expect(typeOf([op, U1])).toBe('umeasurement');
      expect(derived(op, U1)).toBe(typeOf([op, U1]));
    }
  );

  test('a descriptor known only by its type, and a list of kind values', () => {
    const t = deriveApplicationType(ce, 'Sin', [
      describeType(ce.type('umeasurement').type),
    ]);
    expect(t === undefined ? 'undefined' : typeToString(t)).toBe(
      'umeasurement'
    );
    expect(derived('Sin', ['List', U1, U2])).toBe('list<umeasurement^2>');
  });

  test('an operand that may be a number keeps the number arm', () => {
    const e = kindEngine();
    e.declare('v', 'real | umeasurement');
    const t = deriveApplicationType(e, 'Sin', [describeOperand(e.box('v'))]);
    expect(t === undefined ? 'undefined' : typeToString(t)).toBe(
      e.box(['Sin', 'v']).type.toString()
    );
  });

  test('an operator whose result is not a number keeps its type', () => {
    expect(derived('IsOdd', U3)).toBe('boolean');
  });
});

describe('VALUE KINDS APPLY: a bare operator name as a callback', () => {
  test.each(['Sin', 'Ln', 'Exp'])(
    'Map(%s, [U1, U2]) is valid, typed and evaluated by `apply`',
    (op) => {
      const expr = box(['Map', op, ['List', U1, U2]]);
      expect(expr.isValid).toBe(true);
      expect(expr.type.toString()).toBe('list<umeasurement^2>');
      // The value of `Map` is a lazy collection: its elements are read.
      const elements = [...expr.evaluate().each()];
      expect(elements.length).toBe(2);
      expect(elements[0].isSame(evaluate([op, U1]))).toBe(true);
      expect(elements[1].isSame(evaluate([op, U2]))).toBe(true);
      expect(elements[0].operator).toBe('UserMeasurement');
    }
  );

  test('Map(Sin, [U1, U2]) gives the values of the apply hook', () => {
    const [e1, e2] = [...evaluate(['Map', 'Sin', ['List', U1, U2]]).each()];
    const [n1, s1] = measurementOf(e1);
    expect(n1).toBeCloseTo(Math.sin(1), 12);
    expect(s1).toBeCloseTo(Math.abs(Math.cos(1)) * 0.1, 12);
    expect(measurementOf(e2)[0]).toBeCloseTo(Math.sin(2), 12);
  });

  test('a kind admitted as `none` is still refused', () => {
    const expr = box(['Map', 'Sin', ['List', GF(1)]]);
    expect(expr.isValid).toBe(false);
    expect(errorCode(isFunction(expr) ? expr.op1 : expr)).toBe(
      'incompatible-type'
    );
  });
});
