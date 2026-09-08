/**
 * A `List` built by `ce.list()` over a numeric store, and the `array` facet.
 *
 * Design: `docs/plans/2026-09-07-numeric-list-store-and-typed-array-boundary.md`.
 * The value is an ordinary canonical `List`; only WHEN the elements are boxed
 * differs (on the first read of `.ops`). Every facet that can answer from
 * the numbers does so without boxing, and every answer must agree with the
 * boxed list built by `ce.box(['List', ...])`.
 */
import { ComputeEngine, isFunction, isNumber } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

/** How many elements `ce.number` boxed during `f`. A store-backed list boxes
 * nothing until `.ops` is read, and this counter is how the tests see it. */
function boxedNumbersDuring(f: () => unknown): number {
  const original = ce.number.bind(ce);
  let count = 0;
  (ce as any).number = (...args: unknown[]) => {
    count++;
    return (original as any)(...args);
  };
  try {
    f();
  } finally {
    (ce as any).number = original;
  }
  return count;
}

const SAMPLES: Record<string, number[]> = {
  integers: [1, 0, 1, 5, -3],
  reals: [0.5, 2, -1.25],
  single: [7],
  singleReal: [0.5],
  pair: [1, 2],
  nan: [NaN, 1],
  infinity: [Infinity, 1],
  negativeInfinity: [-Infinity, 2.5],
  mixed: [1, 0.5, NaN, Infinity],
  large: [1e20, 2 ** 53 + 2, 3],
};

describe('ce.list() — construction and parity with the boxed list', () => {
  for (const [name, xs] of Object.entries(SAMPLES)) {
    describe(name, () => {
      const stored = ce.list(xs);
      const boxed = ce.box(['List', ...xs]);

      test('is a canonical List', () => {
        expect(stored.operator).toBe('List');
        expect(stored.isCanonical).toBe(true);
        expect(isFunction(stored)).toBe(true);
      });

      test('type equals the boxed list type', () => {
        expect(stored.type.toString()).toBe(boxed.type.toString());
      });

      test('count and nops', () => {
        expect(stored.count).toBe(xs.length);
        expect(isFunction(stored) && stored.nops).toBe(xs.length);
      });

      test('json equals the boxed list json', () => {
        expect(stored.json).toEqual(boxed.json);
      });

      test('hash equals the boxed list hash', () => {
        expect(stored.hash).toBe(boxed.hash);
      });

      test('isSame in both directions', () => {
        expect(stored.isSame(boxed)).toBe(true);
        expect(boxed.isSame(stored)).toBe(true);
        expect(stored.isSame(ce.list(xs))).toBe(true);
      });

      test('at(), including a negative index', () => {
        for (let i = 1; i <= xs.length; i++)
          expect(stored.at(i)!.isSame(boxed.at(i)!)).toBe(true);
        expect(stored.at(-1)!.isSame(boxed.at(-1)!)).toBe(true);
        expect(stored.at(0)).toBeUndefined();
        expect(stored.at(xs.length + 1)).toBeUndefined();
        // A fractional or NaN index names no element, as for the boxed list.
        expect(stored.at(1.5)).toBeUndefined();
        expect(stored.at(NaN)).toBeUndefined();
        expect(boxed.at(1.5)).toBeUndefined();
      });

      test('each() yields the boxed elements in order', () => {
        const a = [...stored.each()].map((e) => e.json);
        const b = [...boxed.each()].map((e) => e.json);
        expect(a).toEqual(b);
      });

      test('array is the numbers', () => {
        expect(stored.array).toEqual(xs);
        expect(Object.isFrozen(stored.array)).toBe(true);
      });

      test('evaluate() and N() return the node itself', () => {
        expect(stored.evaluate()).toBe(stored);
        expect(stored.N()).toBe(stored);
        expect(stored.evaluate({ materialization: true })).toBe(stored);
      });

      test('unknowns, symbols, isPure, isConstant, isValid', () => {
        expect(stored.unknowns).toEqual([]);
        expect(stored.symbols).toEqual([]);
        expect(stored.isPure).toBe(true);
        expect(stored.isConstant).toBe(true);
        expect(stored.isValid).toBe(true);
      });

      test('has() matches the operator name, not the elements', () => {
        expect(stored.has('List')).toBe(true);
        expect(stored.has(['List'])).toBe(true);
        expect(stored.has('x')).toBe(false);
        // And the same after the operands are boxed.
        void (stored as any).ops;
        expect(stored.has('List')).toBe(true);
        expect(stored.has('x')).toBe(false);
      });
    });
  }

  test('elttype parity with the boxed list', () => {
    const def = ce.lookupDefinition('List') as any;
    const elttype = (def.operator ?? def).collection.elttype as (
      e: unknown
    ) => unknown;
    for (const xs of Object.values(SAMPLES))
      expect(String(elttype(ce.list(xs)))).toBe(
        String(elttype(ce.box(['List', ...xs])))
      );
  });

  test('the empty input is the ordinary empty list', () => {
    const empty = ce.list([]);
    expect(empty.isSame(ce.box(['List']))).toBe(true);
    expect(empty.type.toString()).toBe(ce.box(['List']).type.toString());
    expect(isFunction(empty) && empty._numericStore).toBeUndefined();
  });

  test('-0 is stored as +0', () => {
    const l = ce.list([-0, 1]);
    expect(Object.is(l.array![0], 0)).toBe(true);
    expect(l.isSame(ce.box(['List', 0, 1]))).toBe(true);
  });

  test('a Float64Array input is accepted and copied', () => {
    const f = Float64Array.from([1, 2.5, 3]);
    const l = ce.list(f);
    expect(l.array).toEqual([1, 2.5, 3]);
    f[0] = 99;
    expect(l.array![0]).toBe(1);
  });

  test('the caller keeps ownership of a plain array input', () => {
    const xs = [1, 2, 3];
    const l = ce.list(xs);
    xs[0] = 99;
    expect(l.array![0]).toBe(1);
    expect(l.array).not.toBe(xs);
  });
});

describe('ce.list() — input validation', () => {
  test('a malformed length is a TypeError', () => {
    for (const length of [-1, 1.5, NaN, Infinity, 2 ** 53, '3'])
      expect(() => ce.list({ length } as any)).toThrow(TypeError);
  });

  test('a non-number element is a TypeError', () => {
    expect(() => ce.list([1, '2' as any, 3])).toThrow(TypeError);
    expect(() => ce.list([1, {} as any])).toThrow(TypeError);
    expect(() => ce.list([1, undefined as any])).toThrow(TypeError);
    // A hole.
    const holed = new Array<number>(3);
    holed[0] = 1;
    holed[2] = 3;
    expect(() => ce.list(holed)).toThrow(TypeError);
  });

  test('a throwing getter propagates', () => {
    const source = {
      length: 2,
      get 0() {
        return 1;
      },
      get 1(): number {
        throw new Error('getter failed');
      },
    };
    expect(() => ce.list(source as any)).toThrow('getter failed');
  });

  test('a Tuple or Set cannot carry a store', () => {
    const BoxedFunction = Object.getPrototypeOf(ce.list([1, 2])).constructor;
    for (const head of ['Tuple', 'Set', 'Add'])
      expect(
        () =>
          new BoxedFunction(ce, head, undefined, {
            canonical: true,
            numericStore: Object.freeze([1, 2]),
          })
      ).toThrow();
  });
});

describe('ce.list() — store equality', () => {
  test('NaN is contained in a list holding NaN', () => {
    const l = ce.list([1, NaN, 3]);
    expect(l.contains(ce.number(NaN))).toBe(true);
    expect(l.contains(ce.box(NaN))).toBe(true);
    expect(ce.list([1, 2]).contains(ce.number(NaN))).toBe(false);
  });

  test('a list with NaN isSame itself and the boxed list', () => {
    const l = ce.list([NaN, 1]);
    expect(l.isSame(ce.list([NaN, 1]))).toBe(true);
    expect(l.isSame(ce.box(['List', NaN, 1]))).toBe(true);
    expect(l.isSame(ce.list([NaN, 2]))).toBe(false);
  });

  test('contains with machine-number targets', () => {
    const l = ce.list([1, 0.5, Infinity]);
    expect(l.contains(ce.number(1))).toBe(true);
    expect(l.contains(ce.number(0.5))).toBe(true);
    expect(l.contains(ce.number(Infinity))).toBe(true);
    expect(l.contains(ce.number(2))).toBe(false);
    expect(l.contains(ce.number(-Infinity))).toBe(false);
  });

  test('contains with an exact-rational target answers as the boxed list', () => {
    const third = ce.parse('\\frac{1}{3}');
    expect(isNumber(third)).toBe(true);
    const xs = [1, 0.3333333333333333, 3];
    expect(ce.list(xs).contains(third)).toBe(
      ce.box(['List', ...xs]).contains(third)
    );
    expect(ce.list(xs).contains(third)).toBe(false);
  });
});

describe('ce.list() — laziness', () => {
  test('the facets that need only the numbers do not box the elements', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i * 0.5);
    let l!: ReturnType<typeof ce.list>;
    const boxedAtBuild = boxedNumbersDuring(() => {
      l = ce.list(xs);
    });
    expect(boxedAtBuild).toBe(0);
    const boxedByFacets = boxedNumbersDuring(() => {
      void l.array;
      void l.count;
      void (l as any).nops;
      void l.type.toString();
      void l.isConstant;
      void l.isPure;
      void l.has('x');
      void l.unknowns;
      void l.symbols;
      void l.evaluate();
      void l.isSame(ce.list(xs));
      void l.shape;
    });
    expect(boxedByFacets).toBe(0);
    // `at` boxes the one element it hands out.
    expect(boxedNumbersDuring(() => void l.at(3))).toBe(1);
    // `hash` boxes transiently; `ops` boxes once and later reads reuse it.
    expect(boxedNumbersDuring(() => void (l as any).ops)).toBe(xs.length);
    expect(boxedNumbersDuring(() => void (l as any).ops)).toBe(0);
  });

  test('assign, re-assign and symbol dereference do not box the elements', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i % 2);
    const first = ce.list(xs);
    expect(boxedNumbersDuring(() => ce.assign('lazyS', first))).toBe(0);
    // The write of the NEXT value is the path a consumer takes on every
    // frame: the previous value is compared and the new one stored.
    expect(boxedNumbersDuring(() => ce.assign('lazyS', ce.list(xs)))).toBe(0);
    expect(boxedNumbersDuring(() => void ce.box('lazyS').evaluate())).toBe(0);
    expect(boxedNumbersDuring(() => void ce.box('lazyS').N())).toBe(0);
    expect(
      boxedNumbersDuring(() => void ce.box('lazyS').evaluate().array)
    ).toBe(0);
    expect(boxedNumbersDuring(() => void ce.box('lazyS').type.toString())).toBe(
      0
    );
    // `count` through the symbol, the facet memo and its dependency snapshot.
    expect(
      boxedNumbersDuring(() => void ce.box('lazyS').evaluate().count)
    ).toBe(0);
    ce.forget('lazyS');
  });

  test('a store-backed list inside a larger expression is not boxed by a symbol walk', () => {
    const l = ce.list([1, 2, 3]);
    const expr = ce.function('Add', [ce.symbol('x'), l]);
    expect(boxedNumbersDuring(() => void expr.unknowns)).toBe(0);
    expect(expr.unknowns).toEqual(['x']);
    expect(boxedNumbersDuring(() => void expr.has('y'))).toBe(0);
  });
});

describe('array on an ordinary list', () => {
  test('a machine-number list computes, caches and freezes', () => {
    const l = ce.box(['List', 1, 0.5, NaN, Infinity, -Infinity, 1e20]);
    const a = l.array;
    expect(a).toEqual([1, 0.5, NaN, Infinity, -Infinity, 1e20]);
    expect(Object.isFrozen(a)).toBe(true);
    expect(l.array).toBe(a);
  });

  test('a list with a symbol has no array', () => {
    expect(ce.box(['List', 1, 'x']).array).toBeUndefined();
  });

  test('a nested list has no array', () => {
    expect(ce.box(['List', ['List', 1, 2]]).array).toBeUndefined();
  });

  test('a non-List has no array', () => {
    expect(ce.box(['Tuple', 1, 2]).array).toBeUndefined();
    expect(ce.number(3).array).toBeUndefined();
    expect(ce.string('abc').array).toBeUndefined();
  });

  test('an exact rational, a radical, a bignum or a complex element gives undefined', () => {
    const exact = [
      ce.parse('\\frac{1}{3}'),
      ce.parse('\\sqrt{2}'),
      ce.number(2n ** 70n + 1n),
      ce.parse('2 + 3i'),
      ce.parse('\\pi').N(),
    ];
    for (const e of exact) {
      const l = ce.function('List', [ce.number(1), e]);
      expect(l.array).toBeUndefined();
    }
  });

  test('a bignum that a double holds exactly is a machine number', () => {
    // 2^70 is a power of two, so the double is exact.
    const l = ce.function('List', [ce.number(2n ** 70n)]);
    expect(l.array).toEqual([2 ** 70]);
  });

  test('reading array changes nothing about an exact list', () => {
    const l = ce.function('List', [ce.number(1), ce.parse('\\frac{1}{3}')]);
    const before = {
      type: l.type.toString(),
      json: JSON.stringify(l.json),
      value: l.evaluate().toString(),
    };
    expect(l.array).toBeUndefined();
    expect(l.type.toString()).toBe(before.type);
    expect(JSON.stringify(l.json)).toBe(before.json);
    expect(l.evaluate().toString()).toBe(before.value);
    expect(
      l.isSame(ce.function('List', [ce.number(1), ce.parse('\\frac{1}{3}')]))
    ).toBe(true);
  });

  test('-0 in a boxed list reads as +0', () => {
    expect(Object.is(ce.box(['List', -0])!.array![0], 0)).toBe(true);
  });

  test('the frozen array rejects a write in strict mode', () => {
    const a = ce.list([1, 2]).array as number[];
    expect(() => {
      'use strict';
      a[0] = 9;
    }).toThrow();
  });
});

describe('ce.list() — assign, interpreter parity and the compiled round trip', () => {
  test('assign stores the given object and keeps its identity', () => {
    const l = ce.list([1, 0, 1, 0]);
    ce.assign('board', l);
    const def = ce.lookupDefinition('board') as any;
    expect(def.value.value).toBe(l);
    expect(ce.box('board').evaluate()).toBe(l);
    ce.forget('board');
  });

  test('a large integer beyond the safe range stays exact in a packed kernel', () => {
    // The tensor kernels pack an unsafe integer as an exact expression cell;
    // the store fast path must not float it under exact evaluation.
    const xs = [2 ** 53 + 2, 0.5];
    const stored = ce.list(xs);
    const boxed = ce.box(['List', ...xs]);
    const a = ce.box(['HadamardProduct', stored, stored]).evaluate();
    const b = ce.box(['HadamardProduct', boxed, boxed]).evaluate();
    expect(a.json).toEqual(b.json);
    expect(a.isSame(b)).toBe(true);
    // Under a numeric approximation both float.
    expect(ce.box(['HadamardProduct', stored, stored]).N().json).toEqual(
      ce.box(['HadamardProduct', boxed, boxed]).N().json
    );
  });

  test('interpreter parity: arithmetic, RotateLeft, Sum, Max, Sort', () => {
    const xs = [3, 1, 2, 5, 4];
    const stored = ce.list(xs);
    const boxed = ce.box(['List', ...xs]);
    const forms: ((l: unknown) => unknown[])[] = [
      (l) => ['Add', l, 1],
      (l) => ['Multiply', 2, l],
      (l) => ['RotateLeft', l, 2],
      (l) => ['Sum', l],
      (l) => ['Max', l],
      (l) => ['Sort', l],
      (l) => ['Length', l],
      (l) => ['At', l, 2],
      (l) => ['Reverse', l],
      (l) => ['Dot', l, l],
    ];
    for (const form of forms) {
      const a = ce.box(form(stored)).evaluate({ materialization: true });
      const b = ce.box(form(boxed)).evaluate({ materialization: true });
      expect(a.json).toEqual(b.json);
    }
  });

  test('compiled by-reference round trip through array', () => {
    const N = 10;
    const board = Array.from({ length: N }, (_, i) => (i % 3 === 0 ? 1 : 0));
    const value = ce.list(board);
    ce.assign('S', value);
    // Tycho's by-reference route: the symbol is declared valueless at its
    // value's type in a pushed scope, so the body reads it from the bag.
    ce.pushScope();
    let out: unknown;
    try {
      ce.declare('S', { type: value.type.toString() });
      const r = compile(
        ce.box(['Add', ['RotateLeft', 'S', 1], ['RotateLeft', 'S', -1], 'S']),
        { to: 'javascript' }
      ) as any;
      expect(typeof r.run).toBe('function');
      out = r.run({ S: value.array });
    } finally {
      ce.popScope();
    }
    const expected = board.map(
      (v, i) => board[(i + 1) % N] + board[(i - 1 + N) % N] + v
    );
    expect(out).toEqual(expected);
    const next = ce.list(out as number[]);
    expect(next.array).toEqual(expected);
    expect(next.type.toString()).toBe(
      ce.box(['List', ...expected]).type.toString()
    );
    ce.forget('S');
  });
});

// Last in the file on purpose: constructing an engine at another precision
// writes the module-global `BigDecimal.precision`, which the shared engine
// above reads at use; `afterAll` puts it back for any later block.
describe('array at machine precision', () => {
  const saved = ce.precision;
  afterAll(() => {
    ce.precision = saved;
  });

  test('an exact rational or radical element is not approximated', () => {
    const machine = new ComputeEngine({ precision: 'machine' });
    // At machine precision `isSame` compares by machine value, which is not
    // the admission test: the exact `1/3` has no machine number.
    expect(machine.number(1 / 3).isSame(machine.box(['Rational', 1, 3]))).toBe(
      true
    );
    expect(machine.box(['List', 1, ['Rational', 1, 3]]).array).toBeUndefined();
    expect(machine.box(['List', ['Sqrt', 2], 1]).array).toBeUndefined();
    expect(machine.box(['List', 1, 2.5]).array).toEqual([1, 2.5]);
  });

  test('an exact rational with a power-of-two denominator is a machine number', () => {
    const machine = new ComputeEngine({ precision: 'machine' });
    const L = (...xs: Parameters<typeof machine.function>[1]) =>
      machine.function('List', xs).array;
    // `0.5` is not an approximation of `1/2`: a double holds it exactly.
    expect(L(machine.box(['Rational', 1, 2]))).toEqual([0.5]);
    expect(L(machine.box(['Rational', 3, 4]))).toEqual([0.75]);
    expect(L(machine.box(['Rational', -7, 8]))).toEqual([-0.875]);
    // A subnormal is held exactly too, up to the smallest one.
    expect(L(machine.box(['Rational', 1, 2n ** 1030n]))).toEqual([2 ** -1030]);
    expect(L(machine.box(['Rational', 1, 2n ** 1074n]))).toEqual([2 ** -1074]);
    expect(L(machine.box(['Rational', 1, 2n ** 1075n]))).toBeUndefined();
    // An odd numerator past the significand rounds, so it is refused.
    expect(
      L(machine.box(['Rational', 2n ** 53n + 1n, 2n ** 60n]))
    ).toBeUndefined();
  });

  test('an unreduced exact rational is tested on its reduced value', () => {
    const machine = new ComputeEngine({ precision: 'machine' });
    // `n/d` with both parts past the significand: converting them to doubles
    // separately and dividing lands one double away from the exact quotient,
    // which is itself a double.
    const d = 26210383204970023963898n;
    const v = 5046685196530323137966149325553664n;
    expect(BigInt(Number(v))).toBe(v);
    const nv = machine._numericValue({ rational: [d * v, d] });
    expect(machine.function('List', [machine.number(nv)]).array).toEqual([
      Number(v),
    ]);
  });

  test('an exact integer is a machine number only when a double holds it', () => {
    const machine = new ComputeEngine({ precision: 'machine' });
    expect(machine.function('List', [machine.number(2n ** 70n)]).array).toEqual(
      [2 ** 70]
    );
    expect(
      machine.function('List', [machine.number(2n ** 53n + 2n)]).array
    ).toEqual([2 ** 53 + 2]);
    expect(
      machine.function('List', [machine.number(2n ** 53n + 1n)]).array
    ).toBeUndefined();
    expect(
      machine.function('List', [machine.number(-(2n ** 70n))]).array
    ).toEqual([-(2 ** 70)]);
    expect(
      machine.function('List', [machine.number(-(2n ** 53n + 1n))]).array
    ).toBeUndefined();
  });
});
