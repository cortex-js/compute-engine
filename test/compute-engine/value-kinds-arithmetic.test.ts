// Value kinds, step 4a: the dispatch of the arithmetic operators to the hooks
// of the kinds, and the result typing
// (`docs/plans/2026-10-26-value-kinds.md`, sections 4.3, 4.4 and 4.5, and the
// phase-1 rows of section 3).
//
// Two user kinds with REAL hooks, defined in `value-kinds-helpers.ts`:
// - `GF8: (integer) -> gf8`, the field with 8 elements: an element is a
//   polynomial of degree < 3 over GF(2), held as its 3-bit representative.
//   Addition is the XOR of the representatives, multiplication is the
//   product of the polynomials modulo x³ + x + 1, `negate` is the identity,
//   `divide` multiplies by the inverse and declines a zero divisor, `power`
//   multiplies repeatedly and declines an exponent that is not a
//   non-negative integer (`Sqrt` reaches it with `1/2`).
// - `MyMod: (integer, integer) -> residue` (the head of issue #477): a
//   class of ℤ/nℤ. `add` and `multiply` fold the `MyMod` operands of one
//   modulus, one fold per modulus, and the exact integer and rational
//   literals when there is one modulus only. They read `exact(i)`, so that
//   under `.N()` a rational operand is read exactly.

import { ComputeEngine } from '../../src/compute-engine';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { GF8_ARITHMETIC, MYMOD_ARITHMETIC } from './value-kinds-helpers';
import type { MathJsonExpression } from '../../src/math-json/types';

type Json = MathJsonExpression;

/** An engine with `GF8`, `MyMod`, a quantity-like kind `Q` whose quotient
 * can be a number, two kinds `A` and `B` of which only `A` declares
 * `resultType`, and `UserMeasurement`, a kind admitted as a number. */
function kindEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declareType('gf8', 'value', { mint: false });
  ce.declare('GF8', {
    signature: '(integer) -> gf8',
    arithmetic: GF8_ARITHMETIC,
  });
  ce.declare('MyMod', {
    signature: '(integer, integer) -> residue',
    arithmetic: MYMOD_ARITHMETIC,
  });

  ce.declareType('uq', 'value', { mint: false });
  ce.declare('Q', {
    signature: '(real, string) -> uq',
    arithmetic: {
      add: () => undefined,
      negate: () => undefined,
      multiply: () => undefined,
      // Two quantities of one unit: their ratio is a plain number.
      divide: (a, b, { engine }) => {
        const [x, y] = [a.evaluated, b.evaluated];
        if (!isFunction(x, 'Q') || !isFunction(y, 'Q')) return undefined;
        if (!x.op2.isSame(y.op2)) return undefined;
        return engine.number(x.op1.re / y.op1.re);
      },
      resultType: (op) => (op === 'Divide' ? 'number | uq' : undefined),
    },
  });

  ce.declareType('ka', 'value', { mint: false });
  ce.declareType('kb', 'value', { mint: false });
  ce.declare('A', {
    signature: '(integer) -> ka',
    arithmetic: {
      divide: () => undefined,
      resultType: (op) => (op === 'Divide' ? 'number | ka' : undefined),
    },
  });
  ce.declare('B', {
    signature: '(integer) -> kb',
    arithmetic: { divide: () => undefined },
  });

  ce.declareType('umeasurement', 'value', { mint: false });
  ce.declare('UserMeasurement', {
    signature: '(real, real) -> umeasurement',
    arithmetic: {
      admittedAs: 'number',
      add: () => undefined,
      negate: () => undefined,
      multiply: () => undefined,
      divide: () => undefined,
      power: () => undefined,
    },
  });
  return ce;
}

const ce = kindEngine();
const box = (x: Json) => ce.box(x);
const typeOf = (x: Json) => box(x).type.toString();
/** `x` and `y` denote the same type (the order of the arms of a union is
 * not significant). */
const sameType = (x: string, y: string) =>
  ce.type(x).matches(ce.type(y)) && ce.type(y).matches(ce.type(x));

const M = (k: number, n: number): Json => ['MyMod', k, n];
const GF = (k: number): Json => ['GF8', k];
const RC = (k: number, n: number): Json => ['ResidueClass', k, n];

describe('VALUE KINDS: Add and Multiply dispatch to the hooks', () => {
  const expected = box(['Add', 'x', M(3, 4)]);

  test('x + MyMod(2, 4) + MyMod(1, 4) on every route', () => {
    const json: Json = ['Add', 'x', M(2, 4), M(1, 4)];
    const parsed = ce.parse(
      'x + \\operatorname{MyMod}(2, 4) + \\operatorname{MyMod}(1, 4)'
    );
    const fn = ce.function('Add', [ce.symbol('x'), box(M(2, 4)), box(M(1, 4))]);
    const method = ce
      .symbol('x')
      .add(box(M(2, 4)))
      .add(box(M(1, 4)));
    for (const [route, result] of [
      ['box evaluate', box(json).evaluate()],
      ['box N', box(json).N()],
      ['parse evaluate', parsed.evaluate()],
      ['parse N', parsed.N()],
      ['function evaluate', fn.evaluate()],
      ['function N', fn.N()],
      ['method', method],
      ['method N', method.N()],
      // `simplify()` reaches the value through the evaluation of the sum.
      ['box simplify', box(json).simplify()],
      ['parse simplify', parsed.simplify()],
    ] as const)
      expect([route, result.isSame(expected)]).toEqual([route, true]);
  });

  test('MyMod(2, 4) - MyMod(2, 4) is MyMod(0, 4)', () => {
    const d: Json = ['Subtract', M(2, 4), M(2, 4)];
    expect(
      box(d)
        .evaluate()
        .isSame(box(M(0, 4)))
    ).toBe(true);
    expect(
      box(d)
        .simplify()
        .isSame(box(M(0, 4)))
    ).toBe(true);
    expect(
      box(M(2, 4))
        .add(box(M(2, 4)).neg())
        .evaluate()
        .toString()
    ).toBe('MyMod(0, 4)');
  });

  test('two moduli, and two heads of one kind type, do not combine', () => {
    const twoModuli = box(['Add', M(2, 4), M(1, 6)]);
    expect(twoModuli.evaluate().isSame(twoModuli)).toBe(true);
    const twoHeads = box(['Add', M(2, 4), RC(1, 4)]);
    expect(twoHeads.evaluate().isSame(twoHeads)).toBe(true);
  });

  test('(MyMod(5, 7) + 1/3).N() reads the exact operands', () => {
    // 1/3 is 5 in ℤ/7ℤ (3 · 5 = 15 = 1), and 5 + 5 = 3.
    expect(
      box(['Add', M(5, 7), ['Rational', 1, 3]])
        .N()
        .isSame(box(M(3, 7)))
    ).toBe(true);
  });

  test('two folds in one answer: one per modulus', () => {
    const r = box(['Add', M(1, 4), M(1, 6), M(2, 4), M(2, 6)]).evaluate();
    expect(r.isSame(box(['Add', M(3, 4), M(3, 6)]))).toBe(true);
  });

  test('the remainder that holds no kind value is summed (deliberate change)', () => {
    // Before step 4, the residue handler kept the remainder unsummed.
    expect(
      box(['Add', 'x', 'x', RC(1, 5)])
        .evaluate()
        .toString()
    ).toBe('2x + ResidueClass(1, 5)');
    const n = box(['Add', ['Sqrt', 2], 'Pi', RC(1, 5)]).N();
    if (!isFunction(n, 'Add')) throw new Error(`not a sum: ${n}`);
    expect(n.nops).toBe(2);
    const float = n.ops.find((x) => isNumber(x))!;
    expect(float.re).toBeCloseTo(Math.SQRT2 + Math.PI, 12);
    expect(n.ops.some((x) => x.operator === 'ResidueClass')).toBe(true);
  });

  test('a valueless symbol of a kind type joins no sub-sum', () => {
    const e = kindEngine();
    e.declare('r', 'residue');
    const sum = e.box(['Add', 'r', 'r', RC(1, 5)]);
    expect(sum.evaluate().isSame(sum)).toBe(true);
    e.declare('L', 'list<residue>');
    const ll = e.box(['Add', 'L', 'L']);
    expect(ll.isValid).toBe(true);
    expect(ll.type.toString()).toBe('list<residue>');
    expect(ll.evaluate().isSame(ll)).toBe(true);
  });

  test('GF(8): sum, product, quotient, power and square root', () => {
    expect(
      box(['Add', GF(1), GF(2)])
        .evaluate()
        .toString()
    ).toBe('GF8(3)');
    expect(
      box(['Add', GF(1), GF(2)])
        .simplify()
        .toString()
    ).toBe('GF8(3)');
    // (x + 1)(x² + 1) = x³ + x² + x + 1 = x² modulo x³ + x + 1.
    expect(
      box(['Multiply', GF(3), GF(5)])
        .evaluate()
        .toString()
    ).toBe('GF8(4)');
    // `divide` declines a zero divisor: the quotient stays as it is.
    const byZero = box(['Divide', GF(1), GF(0)]);
    expect(byZero.evaluate().isSame(byZero)).toBe(true);
    // x³ = x + 1.
    expect(
      box(['Power', GF(2), 3])
        .evaluate()
        .toString()
    ).toBe('GF8(3)');
    expect(
      box(['Power', GF(2), 3])
        .N()
        .toString()
    ).toBe('GF8(3)');
    // The methods give the same values.
    expect(
      box(GF(1))
        .add(box(GF(2)))
        .toString()
    ).toBe('GF8(3)');
    expect(
      box(GF(3))
        .mul(box(GF(5)))
        .toString()
    ).toBe('GF8(4)');
    expect(box(GF(2)).pow(3).toString()).toBe('GF8(3)');
    expect(
      box(GF(6))
        .div(box(GF(3)))
        .toString()
    ).toBe(
      box(['Divide', GF(6), GF(3)])
        .evaluate()
        .toString()
    );
  });

  test('Sqrt reaches `power` with the exponent 1/2', () => {
    const seen: string[] = [];
    const e = new ComputeEngine();
    e.declareType('gf8', 'value', { mint: false });
    e.declare('GF8', {
      signature: '(integer) -> gf8',
      arithmetic: {
        ...GF8_ARITHMETIC,
        power: (base, exponent, context) => {
          seen.push(exponent.exact().toString());
          return GF8_ARITHMETIC.power!(base, exponent, context);
        },
      },
    });
    const root = e.box(['Sqrt', GF(4)]);
    expect(root.evaluate().isSame(root)).toBe(true);
    expect(seen).toEqual(['1/2']);
    seen.length = 0;
    e.box(['Root', GF(4), 3]).evaluate();
    expect(seen).toEqual(['1/3']);
    seen.length = 0;
    // `Square` is canonically a `Power` with the exponent 2.
    expect(
      e
        .box(['Square', GF(3)])
        .evaluate()
        .toString()
    ).toBe(
      e
        .box(['Multiply', GF(3), GF(3)])
        .evaluate()
        .toString()
    );
    expect(seen).toEqual(['2']);
  });

  test('the operands arrive in canonical order, a difference with a Negate', () => {
    const written: (string | undefined)[][] = [];
    const e = new ComputeEngine();
    e.declareType('w', 'value', { mint: false });
    e.declare('W', {
      signature: '(integer) -> w',
      arithmetic: {
        add: (ops) => {
          written.push(ops.written.map((x) => x?.operator));
          return undefined;
        },
        negate: () => undefined,
      },
    });
    const d = e.box(['Subtract', ['W', 1], ['W', 2]]);
    if (!isFunction(d)) throw new Error(`not a function: ${d}`);
    d.evaluate();
    expect(written).toHaveLength(1);
    const negated = written[0].indexOf('Negate');
    expect(negated).toBeGreaterThanOrEqual(0);
    expect(written[0].filter((x) => x === 'Negate')).toHaveLength(1);
    expect(negated).toBe(d.ops.findIndex((x) => x.operator === 'Negate'));
  });

  test('a fold that names an index out of range, or twice, throws', () => {
    const e = new ComputeEngine();
    e.declareType('bad', 'value', { mint: false });
    e.declare('Bad', {
      signature: '(integer) -> bad',
      arithmetic: {
        add: (_ops, { engine }) => [
          { value: engine.box(['Bad', 0]), operands: [0, 7] },
        ],
        multiply: (_ops, { engine }) => [
          { value: engine.box(['Bad', 0]), operands: [0] },
          { value: engine.box(['Bad', 1]), operands: [0] },
        ],
        negate: () => undefined,
      },
    });
    expect(() => e.box(['Add', ['Bad', 1], ['Bad', 2]]).evaluate()).toThrow(
      /"Bad".*index 7.*out of range/
    );
    expect(() =>
      e.box(['Multiply', ['Bad', 1], ['Bad', 2]]).evaluate()
    ).toThrow(/"Bad".*index 0.*another fold/);
    expect(() => e.box(['Bad', 1]).add(e.box(['Bad', 2]))).toThrow(
      /out of range/
    );
  });

  test('a hook that throws propagates the error', () => {
    const e = new ComputeEngine();
    e.declareType('oops', 'value', { mint: false });
    e.declare('Oops', {
      signature: '(integer) -> oops',
      arithmetic: {
        add: () => {
          throw new Error('add failed');
        },
        negate: () => {
          throw new Error('negate failed');
        },
      },
    });
    expect(() => e.box(['Add', ['Oops', 1], ['Oops', 2]]).evaluate()).toThrow(
      'add failed'
    );
    expect(() => e.box(['Negate', ['Oops', 1]]).evaluate()).toThrow(
      'negate failed'
    );
  });
});

describe('VALUE KINDS: result typing', () => {
  test('a kind type whose `resultType` answers for the operator', () => {
    expect(
      sameType(
        typeOf(['Divide', ['Q', 6, "'m'"], ['Q', 3, "'m'"]]),
        'number | uq'
      )
    ).toBe(true);
    const e = kindEngine();
    e.declare('q1', 'uq');
    e.declare('q2', 'uq');
    expect(
      sameType(e.box(['Divide', 'q1', 'q2']).type.toString(), 'number | uq')
    ).toBe(true);
    expect(e.box(['Add', 'q1', 'q2']).type.toString()).toBe('uq');
    // The value is a number.
    expect(
      box(['Divide', ['Q', 6, "'m'"], ['Q', 3, "'m'"]]).evaluate().re
    ).toBe(2);
  });

  test('each kind type contributes independently', () => {
    expect(
      sameType(typeOf(['Divide', ['A', 1], ['B', 1]]), 'number | ka | kb')
    ).toBe(true);
  });

  test('the shape is derived, the cells are the kind type', () => {
    expect(typeOf(['Multiply', GF(1), ['Tuple', 1, 2]])).toBe(
      'tuple<gf8, gf8>'
    );
    expect(typeOf(['Multiply', RC(2, 5), ['Tuple', 1, 2]])).toBe(
      'tuple<residue, residue>'
    );
  });

  test('the kind-free arms keep the ordinary result', () => {
    const e = kindEngine();
    e.declare('u', 'real | umeasurement');
    e.declare('v', 'integer | umeasurement');
    expect(
      sameType(e.box(['Negate', 'u']).type.toString(), 'real | umeasurement')
    ).toBe(true);
    expect(
      sameType(
        e.box(['Divide', 'v', 2]).type.toString(),
        'rational | umeasurement'
      )
    ).toBe(true);
  });

  test('Sum, Reduce and Map over a list of classes', () => {
    const L: Json = ['List', RC(1, 5), RC(2, 5)];
    const sum = box(['Sum', L]);
    expect(sum.type.toString()).toBe('residue');
    expect(sum.evaluate().toString()).toBe('ResidueClass(3, 5)');
    const reduce = box(['Reduce', L, 'Add']);
    expect(reduce.type.toString()).toBe('residue');
    expect(reduce.evaluate().toString()).toBe('ResidueClass(3, 5)');
    expect(box(['Product', L]).type.toString()).toBe('residue');
    expect(box(['Map', 'Negate', L]).type.toString()).toBe('list<residue^2>');
    // A list of unknown length can be empty: its sum can be 0.
    const e = kindEngine();
    e.declare('K', 'list<residue>');
    expect(
      sameType(e.box(['Sum', 'K']).type.toString(), 'integer | residue')
    ).toBe(true);
  });
});
