// Value kinds, phase 3: `Enclosure` is a value kind
// (`docs/plans/2026-10-26-value-kinds.md`, sections 4.9.2 and 4.9.3).
//
// An enclosure `Enclosure(lo, hi)` is a closed interval that holds one real
// number. It is a value of the kind type `enclosure`, admitted where a real
// is admitted (`admittedAs: 'real'`, the hooks of `ENCLOSURE_ARITHMETIC`,
// `src/compute-engine/library/enclosure-arithmetic.ts`). This file checks the
// value, the arithmetic hooks, the order (`compare`, `eq`, `extremum`), the
// collections and the refusals, each row on the three routes `ce.function`,
// `ce.box` and `ce.parse`. The image of the numeric functions (`apply`) and
// the `.N()` route are in `enclosure-apply.test.ts`.

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { isInexactOperand } from '../../src/compute-engine/boxed-expression/type-guards';
import {
  orderAnswer,
  type KindCompareAnswer,
} from '../../src/compute-engine/boxed-expression/kind-compare';

type Json = MathJsonExpression;

const ce = new ComputeEngine();

const E = (lo: Json, hi?: Json): Json =>
  hi === undefined ? ['Enclosure', lo] : ['Enclosure', lo, hi];

/** `x` built with `ce.function()` from operands boxed one by one. */
function viaFunction(engine: ComputeEngine, x: Json): Expression {
  if (Array.isArray(x) && typeof x[0] === 'string')
    return engine.function(
      x[0],
      (x.slice(1) as Json[]).map((op) => viaFunction(engine, op))
    );
  return engine.box(x);
}

type Route = 'function' | 'box' | 'parse';
const ROUTES: Route[] = ['function', 'box', 'parse'];

/** `x` on the route `route`. The parse route reads the LaTeX of `x` boxed
 * raw, or `latex` when it is given. */
function onRoute(
  route: Route,
  x: Json,
  latex?: string,
  engine: ComputeEngine = ce
): Expression {
  if (route === 'function') return viaFunction(engine, x);
  if (route === 'box') return engine.box(x);
  return engine.parse(latex ?? engine.box(x, { form: 'raw' }).latex);
}

/** The error code of the first `Error` operand of `x`, or `undefined`. */
function errorCode(x: Expression): string | undefined {
  if (x.operator === 'Error') {
    const code = x.ops?.[0];
    if (code?.operator === 'ErrorCode') return code.ops?.[0]?.string;
    return code?.string;
  }
  for (const op of x.ops ?? []) {
    const c = errorCode(op);
    if (c !== undefined) return c;
  }
  return undefined;
}

/** A row whose value is the indeterminate value is checked with `isNaN`. */
const INDETERMINATE = 'indeterminate';

function expectValue(x: Expression, expected: string): void {
  const v = x.evaluate();
  if (expected === INDETERMINATE) expect(v.isNaN).toBe(true);
  else expect(v.symbol ?? v.toString()).toBe(expected);
}

describe('THE KIND TYPE `enclosure`', () => {
  test('an enclosure is typed `enclosure`', () => {
    expect(ce.box(E(0, 1)).type.toString()).toBe('enclosure');
    expect(ce.box(E(0, 1)).evaluate().type.toString()).toBe('enclosure');
  });

  test('`enclosure` is a subtype of `value`, disjoint from the numbers and the sets', () => {
    expect(ce.type('enclosure').matches('value')).toBe(true);
    expect(ce.type('enclosure').matches('real')).toBe(false);
    expect(ce.type('enclosure').matches('number')).toBe(false);
    expect(ce.type('real').matches('enclosure')).toBe(false);
    expect(ce.type('enclosure').matches('set<real>')).toBe(false);
  });

  test('the type `enclosure` round-trips through the type parser', () => {
    expect(ce.type('enclosure | nan').toString()).toBe('enclosure | nan');
    expect(ce.type('list<enclosure>').toString()).toBe('list<enclosure>');
  });

  test('LaTeX: `\\mathrm{Enclosure}(a, b)` round trip, `\\operatorname` parses', () => {
    expect(ce.box(E(0, 1)).latex).toBe('\\mathrm{Enclosure}(0, 1)');
    expect(ce.parse('\\mathrm{Enclosure}(0, 1)').json).toEqual([
      'Enclosure',
      0,
      1,
    ]);
    expect(ce.parse('\\operatorname{Enclosure}(0, 1)').json).toEqual([
      'Enclosure',
      0,
      1,
    ]);
  });
});

describe('THE VALUE', () => {
  const ROWS: [string, Json, string][] = [
    ['Enclosure(2, 1)', E(2, 1), 'Enclosure(1, 2)'],
    ['Enclosure(3)', E(3), 'Enclosure(3, 3)'],
    ['Enclosure(-oo, 0)', E('NegativeInfinity', 0), 'Enclosure(-oo, 0)'],
    ['Enclosure(Interval(0, 1))', E(['Interval', 0, 1]), 'Enclosure(0, 1)'],
    [
      'Enclosure(Interval(0, +oo))',
      E(['Interval', 0, 'PositiveInfinity']),
      'Enclosure(0, +oo)',
    ],
    [
      'Enclosure(Interval(Open(0), Open(1)))',
      E(['Interval', ['Open', 0], ['Open', 1]]),
      'Enclosure(0, 1)',
    ],
    ['Enclosure(Interval(2, 1))', E(['Interval', 2, 1]), INDETERMINATE],
    [
      'Enclosure(Interval(Open(1), Open(1)))',
      E(['Interval', ['Open', 1], ['Open', 1]]),
      INDETERMINATE,
    ],
    ['Enclosure(NaN, 2)', E('NaN', 2), INDETERMINATE],
    [
      'Enclosure(+oo, +oo)',
      E('PositiveInfinity', 'PositiveInfinity'),
      INDETERMINATE,
    ],
  ];
  for (const route of ROUTES)
    test.each(ROWS)(`${route}: %s`, (_, x, expected) =>
      expectValue(onRoute(route, x), expected)
    );

  test('the canonical form orders the endpoints', () => {
    for (const route of ROUTES)
      expect(onRoute(route, E(2, 1)).toString()).toBe('Enclosure(1, 2)');
  });

  test('an exact empty set is `Indeterminate`', () => {
    expect(ce.box(E(['Interval', 2, 1])).evaluate().isIndeterminate).toBe(true);
  });

  test('a pair of endpoints whose order is not decided is kept as written', () => {
    const x = ce.box(E(['Sin', ['Power', 10, 600]], 0));
    expect(x.operator).toBe('Enclosure');
    expect(x.op1.operator).toBe('Sin');
    expect(x.op2.isSame(0)).toBe(true);
  });

  test('an endpoint of class 2 and a float are ordered numerically', () => {
    for (const route of ROUTES)
      expect(onRoute(route, E('Pi', 3.5)).toString()).toBe(
        'Enclosure(pi, 3.5)'
      );
    expect(ce.box(E('Pi', 3.1)).toString()).toBe('Enclosure(3.1, pi)');
  });

  const REFUSED: [string, Json][] = [
    ['Enclosure(Interval(0, 1), 2)', E(['Interval', 0, 1], 2)],
    ['Enclosure(i, 2)', E('ImaginaryUnit', 2)],
    ['Enclosure(~oo, 2)', E('ComplexInfinity', 2)],
    ['Enclosure(Measurement(1, 0.1), 2)', E(['Measurement', 1, 0.1], 2)],
    ['Enclosure(Enclosure(0, 1), 2)', E(E(0, 1), 2)],
    ['Enclosure("a", 2)', E("'a'", 2)],
    ['Enclosure(Set(1, 2))', E(['Set', 1, 2])],
  ];
  for (const route of ROUTES)
    test.each(REFUSED)(
      `${route}: %s is incompatible-type at boxing`,
      (_, x) => {
        const boxed = onRoute(route, x);
        expect(errorCode(boxed)).toBe('incompatible-type');
        expect(boxed.isValid).toBe(false);
      }
    );

  test('`Enclosure(a, 2)` orders again after the substitution of `a`', () => {
    const ce2 = new ComputeEngine();
    for (const route of ROUTES) {
      const sum = onRoute(route, ['Add', E('a', 2), 1], undefined, ce2);
      // Before the assignment, the endpoint `a` is of class 3: the sum stays.
      const before = sum.evaluate();
      expect(before.operator).toBe('Add');
      expect(before.toString()).toBe('Enclosure(a, 2) + 1');
    }
    ce2.assign('a', 3);
    for (const route of ROUTES)
      expect(
        onRoute(route, E('a', 2), undefined, ce2).evaluate().toString()
      ).toBe('Enclosure(2, 3)');
  });

  test('`Enclosure(Interval(a, 2))` with `a := 3` is the empty set', () => {
    const ce2 = new ComputeEngine();
    const xs = ROUTES.map((route) =>
      onRoute(route, E(['Interval', 'a', 2]), undefined, ce2)
    );
    ce2.assign('a', 3);
    for (const x of xs) expect(x.evaluate().isNaN).toBe(true);
  });

  test('a symbol typed as a set is read at evaluation', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('S', 'set<real>');
    const x = ce2.box(E('S'));
    expect(x.isValid).toBe(true);
    ce2.assign('S', ce2.box(['Interval', 0, 1]));
    expect(x.evaluate().toString()).toBe('Enclosure(0, 1)');
    ce2.assign('S', ce2.box(['Set', 1, 2]));
    expect(errorCode(x.evaluate())).toBe('incompatible-type');
  });

  test('an endpoint whose value is a kind value is incompatible-type at evaluation', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('v', 'value');
    const x = ce2.box(E('v', 2));
    ce2.assign('v', ce2.box(['Measurement', 1, 0.1]));
    expect(errorCode(x.evaluate())).toBe('incompatible-type');
  });

  test('`Enclosure(f(1), 2) + 1` stays a sum (no numeric value: class 3)', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('f', '(real) -> real');
    for (const route of ROUTES) {
      const v = onRoute(route, ['Add', E(['f', 1], 2), 1], undefined, ce2);
      expect(v.evaluate().operator).toBe('Add');
    }
  });

  test('the asynchronous route gives the values of the synchronous route', async () => {
    const ce2 = new ComputeEngine();
    const xs = [E('a', 2), E(['Interval', 'a', 2]), ['Add', E('a', 2), 1]];
    const boxed = xs.map((x) => ce2.box(x));
    ce2.assign('a', 3);
    const values = await Promise.all(boxed.map((x) => x.evaluateAsync()));
    expect(values[0].toString()).toBe('Enclosure(2, 3)');
    expect(values[1].isNaN).toBe(true);
    expect(values[2].toString()).toBe('Enclosure(3, 4)');
  });

  test('`.N()` converts the endpoints outward to doubles', () => {
    for (const route of ROUTES) {
      const pi = onRoute(route, E(0, 'Pi')).N();
      expect(pi.op1.re).toBe(0);
      // The smallest double above π.
      expect(pi.op2.re).toBe(3.1415926535897936);
      const tenth = onRoute(route, E(0.1, 0.2)).N();
      expect(tenth.op1.re).toBe(0.09999999999999999);
      expect(tenth.op2.re).toBe(0.2);
    }
  });

  test('`.re` of an enclosure is `NaN`, `.N()` keeps the enclosure', () => {
    const x = ce.box(E(1, 2));
    expect(Number.isNaN(x.re)).toBe(true);
    expect(x.N().operator).toBe('Enclosure');
  });
});

describe('THE ARITHMETIC HOOKS', () => {
  const ROWS: [string, Json, string][] = [
    [
      'Enclosure(0, 1) + Enclosure(1/3, 2)',
      ['Add', E(0, 1), E(['Rational', 1, 3], 2)],
      'Enclosure(1/3, 3)',
    ],
    ['Enclosure(0, 1) + 2', ['Add', E(0, 1), 2], 'Enclosure(2, 3)'],
    [
      'Sin(Enclosure(0, 1)) + 1',
      ['Add', ['Sin', E(0, 1)], 1],
      'Enclosure(1, 1 + sin(1))',
    ],
    ['-Enclosure(1, 2)', ['Negate', E(1, 2)], 'Enclosure(-2, -1)'],
    [
      'Enclosure(1, 2) - Enclosure(1, 2)',
      ['Subtract', E(1, 2), E(1, 2)],
      'Enclosure(-1, 1)',
    ],
    [
      'Enclosure(-1, 2) * Enclosure(3, 4)',
      ['Multiply', E(-1, 2), E(3, 4)],
      'Enclosure(-4, 8)',
    ],
    [
      'Enclosure(0, +oo) * Enclosure(0, 1)',
      ['Multiply', E(0, 'PositiveInfinity'), E(0, 1)],
      'Enclosure(0, +oo)',
    ],
    [
      'Enclosure(1, 2) / Enclosure(4, 8)',
      ['Divide', E(1, 2), E(4, 8)],
      'Enclosure(1/8, 1/2)',
    ],
    ['1 / Enclosure(0, 1)', ['Divide', 1, E(0, 1)], 'Enclosure(1, +oo)'],
    ['1 / Enclosure(-1, 1)', ['Divide', 1, E(-1, 1)], 'Enclosure(-oo, +oo)'],
    ['1 / Enclosure(0, 0)', ['Divide', 1, E(0, 0)], INDETERMINATE],
    [
      'Enclosure(0, 1) + +oo',
      ['Add', E(0, 1), 'PositiveInfinity'],
      INDETERMINATE,
    ],
    [
      'Enclosure(-oo, 0) + +oo',
      ['Add', E('NegativeInfinity', 0), 'PositiveInfinity'],
      INDETERMINATE,
    ],
    [
      'Enclosure(0, 1) - 1/3',
      ['Subtract', E(0, 1), ['Rational', 1, 3]],
      'Enclosure(-1/3, 2/3)',
    ],
    ['Enclosure(0, 1) + Pi', ['Add', E(0, 1), 'Pi'], 'Enclosure(pi, 1 + pi)'],
  ];
  for (const route of ROUTES)
    test.each(ROWS)(`${route}: %s`, (_, x, expected) =>
      expectValue(onRoute(route, x), expected)
    );

  test('`Enclosure(Sin(10^600), 0) + 1` has float endpoints, ordered, and is not exact', () => {
    for (const route of ROUTES) {
      const v = onRoute(route, [
        'Add',
        E(['Sin', ['Power', 10, 600]], 0),
        1,
      ]).evaluate();
      expect(v.operator).toBe('Enclosure');
      expect(v.op1.re).toBeLessThan(v.op2.re);
      expect(v.op1.re).toBeLessThanOrEqual(1);
      expect(isInexactOperand(v)).toBe(true);
    }
  });

  test('an exact enclosure is exact', () => {
    expect(isInexactOperand(ce.box(E(0, ['Sin', 1])).evaluate())).toBe(false);
    expect(isInexactOperand(ce.box(E(0, 0.5)).evaluate())).toBe(true);
  });

  test('a complex number, a value of another kind, a symbol stay beside the enclosure', () => {
    for (const route of ROUTES) {
      const i = onRoute(route, ['Add', E(0, 1), 'ImaginaryUnit']).evaluate();
      expect(i.operator).toBe('Add');
      const m = onRoute(route, [
        'Add',
        E(0, 1),
        ['Measurement', 1, ['Rational', 1, 10]],
      ]).evaluate();
      expect(m.operator).toBe('Add');
      expect(m.type.toString()).toBe('enclosure | measurement');
      const z = onRoute(route, ['Add', E(0, 1), 'z', 2]).evaluate();
      expect(z.toString()).toBe('z + Enclosure(2, 3)');
    }
  });

  test('a set beside an enclosure is incompatible-type at evaluation', () => {
    for (const route of ROUTES)
      expect(
        errorCode(
          onRoute(route, ['Add', E(0, 1), ['Interval', 0, 1]]).evaluate()
        )
      ).toBe('incompatible-type');
  });

  test('`simplify()` folds a sum of enclosures', () => {
    for (const route of ROUTES)
      expect(
        onRoute(route, ['Add', E(0, 1), E(1, 2)])
          .simplify()
          .toString()
      ).toBe('Enclosure(1, 3)');
  });

  test('the public methods use the hooks', () => {
    const a = ce.box(E(0, 1));
    const b = ce.box(E(1, 2));
    expect(a.add(b).toString()).toBe('Enclosure(1, 3)');
    expect(a.mul(b).toString()).toBe('Enclosure(0, 2)');
    expect(b.neg().evaluate().toString()).toBe('Enclosure(-2, -1)');
  });
});

describe('THE TYPES', () => {
  const ce2 = new ComputeEngine();
  ce2.declare('x', 'enclosure');
  ce2.declare('y', 'number');
  ce2.declare('r', 'real');
  const typeOf = (x: Json): string => ce2.box(x).type.toString();

  test('`x + 1` with `x: enclosure` is `enclosure`; with `y: number`, `enclosure | nan`', () => {
    expect(typeOf(['Add', 'x', 1])).toBe('enclosure');
    expect(typeOf(['Add', 'x', 'r'])).toBe('enclosure');
    expect(typeOf(['Multiply', 'x', 2])).toBe('enclosure');
    expect(typeOf(['Add', 'x', 'y'])).toBe('enclosure | nan');
  });

  test('`Divide`, `Power` and the domain-restricted functions may be `NaN`', () => {
    expect(typeOf(['Divide', 'x', 2])).toBe('enclosure | nan');
    expect(typeOf(['Power', 'x', 2])).toBe('enclosure | nan');
    expect(typeOf(['Ln', 'x'])).toBe('enclosure | nan');
    expect(typeOf(['Tan', 'x'])).toBe('enclosure | nan');
  });

  test('the image of `Sin`, `Abs` is an enclosure', () => {
    expect(typeOf(['Sin', 'x'])).toBe('enclosure');
    expect(typeOf(['Abs', 'x'])).toBe('enclosure');
  });

  test('the extrema: `enclosure`, or with the arms of an infinite operand', () => {
    expect(typeOf(['Max', 'x', 3])).toBe('enclosure');
    expect(typeOf(['Max', 'x', 'y'])).toBe('enclosure | nan | signed_infinity');
    expect(typeOf(['ElementMin', 'x', 3])).toBe('enclosure');
    expect(typeOf(['Clamp', 'x', 0, 1])).toBe('enclosure');
  });

  test('`Sin([Enclosure(0, 1), 2])` is a list of an enclosure and a real', () => {
    for (const route of ROUTES) {
      const v = onRoute(route, ['Sin', ['List', E(0, 1), 2]]).evaluate();
      expect(v.toString()).toBe('[Enclosure(0, sin(1)),sin(2)]');
      expect(v.type.toString()).toBe('list<enclosure | real^2>');
    }
  });
});

describe('THE ORDER: `compare`, `eq`, `extremum`', () => {
  const ROWS: [string, Json, string][] = [
    ['Enclosure(0, 1) < Enclosure(2, 3)', ['Less', E(0, 1), E(2, 3)], 'True'],
    ['Enclosure(0, 1) < +oo', ['Less', E(0, 1), 'PositiveInfinity'], 'True'],
    [
      'Enclosure(0, +oo) <= +oo',
      ['LessEqual', E(0, 'PositiveInfinity'), 'PositiveInfinity'],
      'True',
    ],
    [
      'Enclosure(0, 2) < Enclosure(1, 3)',
      ['Less', E(0, 2), E(1, 3)],
      'Enclosure(0, 2) < Enclosure(1, 3)',
    ],
    [
      'Enclosure(0, 1) <= Enclosure(1, 2)',
      ['LessEqual', E(0, 1), E(1, 2)],
      'True',
    ],
    [
      'Enclosure(0, 1) > Enclosure(1, 2)',
      ['Greater', E(0, 1), E(1, 2)],
      'False',
    ],
    [
      'Enclosure(0, 1) < Enclosure(1, 2)',
      ['Less', E(0, 1), E(1, 2)],
      'Enclosure(0, 1) < Enclosure(1, 2)',
    ],
    [
      'Enclosure(1, 1) <= Enclosure(1, 2)',
      ['LessEqual', E(1, 1), E(1, 2)],
      'True',
    ],
    [
      'Enclosure(1, 2) >= Enclosure(0, 1)',
      ['GreaterEqual', E(1, 2), E(0, 1)],
      'True',
    ],
    [
      'Enclosure(0, 1) >= Enclosure(1, 2)',
      ['GreaterEqual', E(0, 1), E(1, 2)],
      'Enclosure(1, 2) <= Enclosure(0, 1)',
    ],
    ['Enclosure(1, 1) = 1', ['Equal', E(1, 1), 1], 'True'],
    [
      'Enclosure(0, 2) = Enclosure(1, 3)',
      ['Equal', E(0, 2), E(1, 3)],
      'Enclosure(0, 2) == Enclosure(1, 3)',
    ],
    ['Enclosure(0, 1) = Enclosure(2, 3)', ['Equal', E(0, 1), E(2, 3)], 'False'],
    ['Enclosure(0, 1) = Enclosure(0, 1)', ['Equal', E(0, 1), E(0, 1)], 'True'],
    [
      'LessEqual(Enclosure(0, 1), Enclosure(1, 2), Enclosure(2, 3))',
      ['LessEqual', E(0, 1), E(1, 2), E(2, 3)],
      'True',
    ],
    [
      'Max(Enclosure(0, 1), Enclosure(2, 3))',
      ['Max', E(0, 1), E(2, 3)],
      'Enclosure(2, 3)',
    ],
    [
      'Max(Enclosure(0, 2), Enclosure(1, 3))',
      ['Max', E(0, 2), E(1, 3)],
      'Enclosure(1, 3)',
    ],
    [
      'Max([Enclosure(0, 2), Enclosure(1, 3)])',
      ['Max', ['List', E(0, 2), E(1, 3)]],
      'Enclosure(1, 3)',
    ],
    [
      'ElementMax(Enclosure(0, 2), Enclosure(1, 3))',
      ['ElementMax', E(0, 2), E(1, 3)],
      'Enclosure(1, 3)',
    ],
    [
      'Min(Enclosure(0, 2), Enclosure(1, 3))',
      ['Min', E(0, 2), E(1, 3)],
      'Enclosure(0, 2)',
    ],
    ['Max(Enclosure(0, 1), +oo)', ['Max', E(0, 1), 'PositiveInfinity'], '+oo'],
    [
      'Min(Enclosure(0, 1), +oo)',
      ['Min', E(0, 1), 'PositiveInfinity'],
      'Enclosure(0, 1)',
    ],
    [
      'Clamp(Enclosure(0, 1), -oo, +oo)',
      ['Clamp', E(0, 1), 'NegativeInfinity', 'PositiveInfinity'],
      'Enclosure(0, 1)',
    ],
    [
      'Clamp(Enclosure(0, 5), 1, 3)',
      ['Clamp', E(0, 5), 1, 3],
      'Enclosure(1, 3)',
    ],
    ['Max(Enclosure(0, 1), 3)', ['Max', E(0, 1), 3], 'Enclosure(3, 3)'],
    ['Max(Enclosure(0, 1), NaN)', ['Max', E(0, 1), 'NaN'], 'NaN'],
  ];
  for (const route of ROUTES)
    test.each(ROWS)(`${route}: %s`, (_, x, expected) =>
      expectValue(onRoute(route, x), expected)
    );

  test('`.is()`: two points within the tolerance', () => {
    expect(ce.box(E(1, 1)).is(1.05, 0.1)).toBe(true);
    expect(ce.box(E(1, 1)).is(1.05)).toBe(false);
    expect(ce.box(E(1, 1)).is(1)).toBe(true);
  });

  test('identical operands: `c <= c` is `True`, `c < c` is `False`', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('c', ce2.box(E(0, 1)));
    for (const route of ROUTES) {
      expect(
        onRoute(route, ['LessEqual', 'c', 'c'], undefined, ce2).evaluate()
          .symbol
      ).toBe('True');
      expect(
        onRoute(route, ['Less', 'c', 'c'], undefined, ce2).evaluate().symbol
      ).toBe('False');
    }
  });

  test('the comparison methods read `<=` and `>=` by the truth table', () => {
    const a = ce.box(E(0, 1));
    const b = ce.box(E(1, 2));
    expect(a.isLessEqual(b)).toBe(true);
    expect(a.isGreater(b)).toBe(false);
    expect(a.isLess(b)).toBeUndefined();
    expect(a.isGreaterEqual(b)).toBeUndefined();
    expect(b.isGreaterEqual(a)).toBe(true);
    expect(b.isLess(a)).toBe(false);
  });

  test('`Sort` needs a total order: two enclosures that touch stay unsorted', () => {
    expect(
      ce
        .box(['Sort', ['List', E(2, 3), E(0, 1)]])
        .evaluate()
        .toString()
    ).toBe('[Enclosure(0, 1),Enclosure(2, 3)]');
    expect(
      ce.box(['Sort', ['List', E(1, 2), E(0, 1)]]).evaluate().operator
    ).toBe('Sort');
  });

  test('`x + Max(x, +oo)` with `x` an enclosure is indeterminate', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('x', 'enclosure');
    ce2.assign('x', ce2.box(E(0, 1)));
    for (const route of ROUTES)
      expect(
        onRoute(
          route,
          ['Add', 'x', ['Max', 'x', 'PositiveInfinity']],
          undefined,
          ce2
        ).evaluate().isNaN
      ).toBe(true);
  });

  test('`orderAnswer()`: the truth table of `<=` and `>=`', () => {
    const table: [KindCompareAnswer, (boolean | undefined)[]][] = [
      // Less, LessEqual, Greater, GreaterEqual
      [-1, [true, true, false, false]],
      [0, [false, true, false, true]],
      [1, [false, false, true, true]],
      ['<=', [undefined, true, false, undefined]],
      ['>=', [false, undefined, undefined, true]],
      ['unordered', [false, false, false, false]],
      ['incomparable', [undefined, undefined, undefined, undefined]],
    ];
    for (const [answer, verdicts] of table)
      expect(
        (['Less', 'LessEqual', 'Greater', 'GreaterEqual'] as const).map((r) =>
          orderAnswer(answer, r)
        )
      ).toEqual(verdicts);
    expect(orderAnswer('<=', 'order')).toBe('<=');
    expect(orderAnswer(-1, 'order')).toBe('<');
    expect(orderAnswer('<=', 'total')).toBeUndefined();
    expect(orderAnswer(1, 'total')).toBe(1);
  });
});

describe('COLLECTIONS', () => {
  const ROWS: [string, Json, string][] = [
    [
      'Sum([Enclosure(0, 1), Enclosure(1, 2), 3])',
      ['Sum', ['List', E(0, 1), E(1, 2), 3]],
      'Enclosure(4, 6)',
    ],
    [
      'Product([Enclosure(0, 1), Enclosure(1, 2), 3])',
      ['Product', ['List', E(0, 1), E(1, 2), 3]],
      'Enclosure(0, 6)',
    ],
    [
      'Mean([Enclosure(0, 1), Enclosure(1, 2), 3])',
      ['Mean', ['List', E(0, 1), E(1, 2), 3]],
      'Enclosure(4/3, 2)',
    ],
    [
      'Mean([Enclosure(0, 1), +oo])',
      ['Mean', ['List', E(0, 1), 'PositiveInfinity']],
      INDETERMINATE,
    ],
  ];
  for (const route of ROUTES)
    test.each(ROWS)(`${route}: %s`, (_, x, expected) =>
      expectValue(onRoute(route, x), expected)
    );

  test('`Median` of enclosures stays unevaluated', () => {
    for (const route of ROUTES)
      expect(
        onRoute(route, ['Median', ['List', E(0, 1), E(1, 2), 3]]).evaluate()
          .operator
      ).toBe('Median');
  });

  test('`Sum([])` is `0`', () => {
    expect(
      ce
        .box(['Sum', ['List']])
        .evaluate()
        .toString()
    ).toBe('0');
  });
});

describe('`Measurement` AND `Quantity` REFUSE AN ENCLOSURE', () => {
  for (const route of ROUTES) {
    test(`${route}: at boxing`, () => {
      expect(errorCode(onRoute(route, ['Measurement', E(0, 1), 0.1]))).toBe(
        'incompatible-type'
      );
      expect(errorCode(onRoute(route, ['Quantity', E(0, 1), 'm']))).toBe(
        'incompatible-type'
      );
    });
  }

  test('at evaluation, when a symbol is assigned an enclosure after boxing', async () => {
    const ce2 = new ComputeEngine();
    ce2.declare('v', 'value');
    const m = ce2.box(['Measurement', 'v', 0.1]);
    const q = ce2.box(['Quantity', 'v', 'm']);
    ce2.assign('v', ce2.box(E(0, 1)));
    expect(errorCode(m.evaluate())).toBe('incompatible-type');
    expect(errorCode(q.evaluate())).toBe('incompatible-type');
    expect(errorCode(await m.evaluateAsync())).toBe('incompatible-type');
    expect(errorCode(await q.evaluateAsync())).toBe('incompatible-type');
  });

  test('a set operand of `Measurement` is not changed', () => {
    expect(
      errorCode(ce.box(['Measurement', ['Interval', 0, 1], 0.1]))
    ).toBeUndefined();
  });
});

describe('THE SET `Interval` IS NOT CHANGED', () => {
  test('`Abs` of a set is its cardinality', () => {
    for (const route of ROUTES)
      expect(
        onRoute(route, ['Abs', ['Interval', -1, 2]])
          .evaluate()
          .toString()
      ).toBe('+oo');
  });
});

describe('A SETTING OF THE ENGINE CHANGES THE VALUE OF AN ENDPOINT', () => {
  // The numeric value of an endpoint (`Sin(1)`) depends on the angular
  // unit, so a value read from it is computed again when the unit changes,
  // also for one endpoint object shared by two enclosures.
  test('the angular unit', () => {
    const ce2 = new ComputeEngine();
    ce2.angularUnit = 'deg';
    const s = ce2.box(['Sin', 1]);
    // sin 1° ≈ 0.017
    expect(ce2.function('Enclosure', [ce2.Zero, s]).isLess(0.5)).toBe(true);
    expect(ce2.function('Enclosure', [s, ce2.One]).isGreater(0.5)).toBe(
      undefined
    );
    ce2.angularUnit = 'rad';
    // sin 1 ≈ 0.84
    expect(ce2.function('Enclosure', [ce2.Zero, s]).isLess(0.5)).toBe(
      undefined
    );
    expect(ce2.function('Enclosure', [s, ce2.One]).isGreater(0.5)).toBe(true);
    const [lo, hi] = [
      ce2.function('Enclosure', [s, s]).N().op1.re,
      ce2.function('Enclosure', [s, s]).N().op2.re,
    ];
    expect(lo).toBeLessThanOrEqual(Math.sin(1));
    expect(hi).toBeGreaterThanOrEqual(Math.sin(1));
    expect(hi - lo).toBeLessThan(1e-15);
  });

  test('the precision', () => {
    const ce2 = new ComputeEngine();
    const defaultPrecision = ce2.precision;
    const third = ce2.box(['Rational', 1, 3]);
    const check = () => {
      const e = ce2.function('Enclosure', [third, third]);
      expect(e.isGreater(0.3)).toBe(true);
      expect(e.isLess(0.4)).toBe(true);
      const v = e.N();
      expect(v.op1.re).toBeLessThanOrEqual(1 / 3);
      expect(v.op2.re).toBeGreaterThanOrEqual(1 / 3);
    };
    try {
      check();
      ce2.precision = 50;
      check();
    } finally {
      ce2.precision = defaultPrecision;
    }
  });
});
