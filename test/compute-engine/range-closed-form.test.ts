/**
 * Reducers over a `Range` with exact rational bounds and step use the closed
 * forms of an arithmetic sequence, not a walk of the elements
 * (`src/compute-engine/library/range-closed-form.ts`).
 *
 * A walk took a time proportional to the element count: `Sum(Range(1, 10^6))`
 * took about 3 s and `Sum(Range(1, 10^20))` did not finish. A test with a
 * range of 10^20 elements that finishes shows that there is no walk, so this
 * file has no time limits.
 *
 * The extremum of such a range was read in machine arithmetic, which rounded
 * a bound larger than 2^53 and made a rational element a float.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

const BIG = ['Power', 10, 20] as const;

function ev(op: string, range: any) {
  return ce.box([op, range]).evaluate();
}

describe('SUM OF A RANGE', () => {
  test('Range(1, 10^6)', () => {
    const v = ev('Sum', ['Range', 1, 1_000_000]);
    expect(v.isExact).toBe(true);
    expect(v.isSame(500000500000)).toBe(true);
  });

  test('Range(1, 10^20) is exact', () => {
    const v = ev('Sum', ['Range', 1, BIG]);
    expect(v.isExact).toBe(true);
    expect(v.isSame(5000000000000000000050000000000000000000n)).toBe(true);
  });

  test('a negative step: Range(10, 1, -3) is 10 + 7 + 4 + 1', () => {
    expect(ev('Sum', ['Range', 10, 1, -3]).toString()).toBe('22');
  });

  test('a rational step: Range(0, 1, 1/4) is 5/2', () => {
    expect(ev('Sum', ['Range', 0, 1, ['Rational', 1, 4]]).toString()).toBe(
      '5/2'
    );
  });

  test('rational bounds: Range(1/2, 7/2) is 1/2 + 3/2 + 5/2 + 7/2', () => {
    expect(
      ev('Sum', ['Range', ['Rational', 1, 2], ['Rational', 7, 2]]).toString()
    ).toBe('8');
  });

  test('the implicit step of Range(5, 1) is -1', () => {
    expect(ev('Sum', ['Range', 5, 1]).toString()).toBe('15');
  });

  test('an empty range sums to 0', () => {
    expect(ev('Sum', ['Range', 5, 1, 1]).toString()).toBe('0');
  });

  test('a symbolic bound stays unevaluated', () => {
    expect(ev('Sum', ['Range', 1, 'n']).operator).toBe('Sum');
  });

  test('float bounds keep the walk', () => {
    expect(ev('Sum', ['Range', 0.5, 10.5]).re).toBe(60.5);
  });

  test('a float operand with an integer value gives a float', () => {
    // The walk gives floats: 1.0 + 1.5 + 2.0 + 2.5 + 3.0.
    const v = ce
      .parse(
        String.raw`\operatorname{Sum}(\operatorname{Range}(1.0, 3, \frac12))`
      )
      .evaluate();
    expect(v.isExact).toBe(false);
    expect(v.re).toBe(10);
    const w = ev('Sum', ['Range', 1e20, 1e20]);
    expect(w.isExact).toBe(false);
    expect(w.re).toBe(1e20);
    // An empty range sums to the exact 0, as for a walk.
    expect(ev('Sum', ['Range', 1e20, 1, 1]).isExact).toBe(true);
  });

  test('.N() gives a number', () => {
    expect(ce.box(['Sum', ['Range', 1, 1_000_000]]).N().re).toBe(500000500000);
    const v = ce.box(['Sum', ['Range', 0, 1, ['Rational', 1, 4]]]).N();
    expect(v.isExact).toBe(false);
    expect(v.re).toBe(2.5);
  });

  test('evaluateAsync() uses the closed form too', async () => {
    const v = await ce.box(['Sum', ['Range', 1, BIG]]).evaluateAsync();
    expect(v.isSame(5000000000000000000050000000000000000000n)).toBe(true);
  });
});

describe('MEAN, MEDIAN AND VARIANCE OF A RANGE', () => {
  test('Mean(Range(1, 10^20)) is exact', () => {
    const v = ev('Mean', ['Range', 1, BIG]);
    expect(v.isSame(ce.number([100000000000000000001n, 2n]))).toBe(true);
  });

  test('Mean(Range(1, 10^20)).N() is a float', () => {
    const v = ce.box(['Mean', ['Range', 1, BIG]]).N();
    expect(v.isExact).toBe(false);
    expect(v.re).toBeCloseTo(5e19);
  });

  test('Median(Range(1, 10^20)) is the mean', () => {
    const v = ev('Median', ['Range', 1, BIG]);
    expect(v.isSame(ce.number([100000000000000000001n, 2n]))).toBe(true);
  });

  test('Mean and Median of Range(10, 1, -3)', () => {
    expect(ev('Mean', ['Range', 10, 1, -3]).toString()).toBe('11/2');
    expect(ev('Median', ['Range', 10, 1, -3]).toString()).toBe('11/2');
  });

  test('Variance and PopulationVariance', () => {
    // [10, 7, 4, 1]: the squared deviations from 11/2 add to 45.
    expect(ev('Variance', ['Range', 10, 1, -3]).toString()).toBe('15');
    expect(ev('PopulationVariance', ['Range', 10, 1, -3]).toString()).toBe(
      '45/4'
    );
    // [0, 1/4, 1/2, 3/4, 1]: the squared deviations from 1/2 add to 5/8.
    expect(ev('Variance', ['Range', 0, 1, ['Rational', 1, 4]]).toString()).toBe(
      '5/32'
    );
    // d²·n·(n + 1)/12 with d = 1 and n = 10^20
    expect(
      ev('Variance', ['Range', 1, BIG]).isSame(
        ce.number([100000000000000000000n * 100000000000000000001n, 12n])
      )
    ).toBe(true);
  });

  test('a float operand with an integer value gives a float', () => {
    const r = ['Range', 1e20, 1e20];
    for (const op of ['Mean', 'Median']) {
      const v = ev(op, r);
      expect(v.isExact).toBe(false);
      expect(v.re).toBe(1e20);
    }
    const parse = (op: string) =>
      ce
        .parse(
          String.raw`\operatorname{${op}}(\operatorname{Range}(1.0, 3, \frac12))`
        )
        .evaluate();
    // [1, 1.5, 2, 2.5, 3]: the squared deviations from 2 add to 2.5.
    expect(parse('Variance').isExact).toBe(false);
    expect(parse('Variance').re).toBe(0.625);
    expect(parse('PopulationVariance').re).toBe(0.5);
  });

  test('empty data keeps its answer', () => {
    expect(ev('Mean', ['Range', 5, 1, 1]).isNaN).toBe(true);
    expect(ev('Median', ['Range', 5, 1, 1]).isNaN).toBe(true);
    expect(ev('Variance', ['Range', 5, 1, 1]).isNaN).toBe(true);
  });
});

describe('MAX AND MIN OF A RANGE', () => {
  test('Range(1, 10^20)', () => {
    expect(ev('Max', ['Range', 1, BIG]).isSame(100000000000000000000n)).toBe(
      true
    );
    expect(ev('Min', ['Range', 1, BIG]).isSame(1)).toBe(true);
  });

  test('a bound larger than 2^53 is not rounded', () => {
    const top = ['Add', BIG, 1];
    const max = ev('Max', ['Range', 1, top]);
    expect(max.isExact).toBe(true);
    expect(max.isSame(100000000000000000001n)).toBe(true);
    // The machine reading of this range answered 0.
    expect(ev('Min', ['Range', top, 1, -1]).isSame(1)).toBe(true);
  });

  test('a rational element stays exact', () => {
    const r = ['Range', ['Rational', 1, 3], 1, ['Rational', 1, 3]];
    expect(ev('Min', r).toString()).toBe('1/3');
    expect(ev('Max', r).toString()).toBe('1');
  });

  test('a negative step', () => {
    expect(ev('Max', ['Range', 10, 1, -3]).toString()).toBe('10');
    expect(ev('Min', ['Range', 10, 1, -3]).toString()).toBe('1');
  });

  test('a float operand with an integer value gives a float', () => {
    const v = ce
      .parse(
        String.raw`\operatorname{Max}(\operatorname{Range}(1.0, 3, \frac12))`
      )
      .evaluate();
    expect(v.isExact).toBe(false);
    expect(v.re).toBe(3);
    const w = ev('Min', ['Range', 1e20, 1e20]);
    expect(w.isExact).toBe(false);
    expect(w.re).toBe(1e20);
  });

  test('an empty range contributes no value', () => {
    expect(ev('Max', ['Range', 5, 1, 1]).isNaN).toBe(true);
    expect(
      ce
        .box(['Min', 3, ['Range', 5, 1, 1]])
        .evaluate()
        .toString()
    ).toBe('3');
  });
});

describe('ONE COUNT FOR A RANGE WITH EXACT OPERANDS', () => {
  // The machine count of the walk applies a tolerance for rounding errors.
  // For exact operands it counted one element past the upper bound, and the
  // closed forms (which use the exact count) disagreed with the walk.
  test('Range(0, 99999999999999/10^14, 1/10) has 10 elements', () => {
    const r = [
      'Range',
      0,
      ['Divide', 99999999999999, ['Power', 10, 14]],
      ['Rational', 1, 10],
    ];
    const e = ce.box(r as any);
    expect(e.count).toBe(10);
    const walk = [...e.each()].map((x) => x.toString());
    expect(walk.length).toBe(10);
    expect(walk[9]).toBe('9/10');
    expect(e.at(10)?.toString()).toBe('9/10');
    expect(e.at(11)).toBeUndefined();
    expect(ev('Sum', r).toString()).toBe('9/2');
    expect(ev('Max', r).toString()).toBe('9/10');
    expect(
      ce
        .box(['Length', r] as any)
        .evaluate()
        .toString()
    ).toBe('10');
  });

  test('Range(0, 9999999999999/10^12, 1) has 10 elements', () => {
    const r = ['Range', 0, ['Divide', 9999999999999, 1000000000000], 1];
    const e = ce.box(r as any);
    expect(e.count).toBe(10);
    expect([...e.each()].map((x) => x.toString()).join(',')).toBe(
      '0,1,2,3,4,5,6,7,8,9'
    );
    expect(ev('Sum', r).toString()).toBe('45');
  });

  test('an empty exact range is empty', () => {
    // The machine count, with its tolerance, counted 1 element.
    const r = ['Range', 0, ['Rational', -1, 10000000000000], 1];
    expect(ce.box(r as any).count).toBe(0);
    expect(ce.box(r as any).isEmptyCollection).toBe(true);
  });

  test('float operands keep the machine count and its tolerance', () => {
    // 0.3 / 0.1 is 2.9999999999999996 in floating point.
    expect(ce.box(['Range', 0, 0.3, 0.1]).count).toBe(4);
  });
});

// Every reader of a `Range` with exact rational operands uses the count of
// the `count` handler, which is exact. The machine count `rangeCount()`,
// with its tolerance for rounding errors, counts one element more for these
// two ranges: the element 10 (or 1), which is past the upper bound.
describe('EVERY READER OF A RANGE USES THE EXACT COUNT', () => {
  const R1 = ['Range', 0, ['Rational', 9999999999999, 1000000000000], 1];
  const R2 = [
    'Range',
    0,
    ['Rational', 99999999999999, 100000000000000],
    ['Rational', 1, 10],
  ];
  // [name, range, the element past the upper bound, the last element, the
  //  step, the next grid point after the last element]
  const cases: [string, any, number, string, any, number][] = [
    ['Range(0, 9999999999999/10^12, 1)', R1, 10, '9', 1, 10],
    ['Range(0, 99999999999999/10^14, 1/10)', R2, 1, '9/10', R2[3], 1],
  ];

  let warnSpy: jest.SpyInstance;
  beforeAll(() => {
    // A compilation that declines prints a warning.
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warnSpy.mockRestore());

  describe.each(cases)('%s', (_name, r, past, last, step, next) => {
    test('the count is 10', () => {
      expect(ce.box(r).count).toBe(10);
    });

    test('the element past the upper bound is not an element', () => {
      expect(ce.box(['Element', past, r]).evaluate().symbol).toBe('False');
    });

    test('the last element is an element', () => {
      expect(ce.box(['Last', r]).evaluate().toString()).toBe(last);
      expect(
        ce.box(['Element', ce.box(['Last', r]).evaluate(), r]).evaluate().symbol
      ).toBe('True');
    });

    test('the type does not prove an 11th element', () => {
      // An access past the proved length has `nan` in its type.
      expect(ce.box(['At', r, 11]).type.toString()).toContain('nan');
    });

    test('a subset test agrees with the elements', () => {
      // The same 10 elements, with an upper bound on the last element.
      const same = ['Range', 0, ['Multiply', 9, step], step];
      // The 10 elements and the element past the upper bound.
      const more = ['Range', 0, next, step];
      expect(ce.box(['SubsetEqual', r, same]).evaluate().symbol).toBe('True');
      expect(ce.box(['SubsetEqual', same, r]).evaluate().symbol).toBe('True');
      expect(ce.box(['SubsetEqual', more, r]).evaluate().symbol).toBe('False');
      expect(ce.box(['Subset', r, more]).evaluate().symbol).toBe('True');
    });

    test.each(['Sum', 'Length', 'Last', 'Max', 'Mean'])(
      'compiled %s gives the value of the interpreter, or declines',
      (op) => {
        const e = ce.box([op, r]);
        const expected = e.evaluate().N().re;
        const c = compile(e);
        // The compiled code counts in machine arithmetic, so it declines,
        // and `run` is the interpreter.
        expect(c.success).toBe(false);
        expect(c.run!()).toBeCloseTo(expected, 12);
      }
    );
  });

  test('a range whose machine count is the exact count still compiles', () => {
    // 1 / 0.1 is 10 in floating point: 11 elements in both counts.
    const c = compile(ce.box(['Length', ['Range', 0, 1, ['Rational', 1, 10]]]));
    expect(c.success).toBe(true);
    expect(c.run!()).toBe(11);
  });

  test('a range whose machine upper bound is infinite does not compile', () => {
    // Range(1, 10^400) has 10^400 elements; compiled code counted Infinity.
    const c = compile(ce.box(['Length', ['Range', 1, ['Power', 10, 400]]]));
    expect(c.success).toBe(false);
  });

  test('a bound held by a symbol is read as the compiler reads it', () => {
    // The compiler folds the assigned value of `a` into the code, so the
    // range is declined. When the caller supplies `a` at run time (the
    // `vars` option), the compiled code reads `a` and the range compiles.
    const ce2 = new ComputeEngine();
    ce2.assign('a', ce2.box(['Rational', 9999999999999, 1000000000000]));
    const e = ce2.box(['Length', ['Range', 0, 'a', 1]]);
    expect(e.evaluate().toString()).toBe('10');
    const folded = compile(e);
    expect(folded.success).toBe(false);
    expect(folded.run!()).toBe(10);
    const live = compile(e, { vars: { a: '_.a' } });
    expect(live.success).toBe(true);
    expect(live.run!({ a: 3.5 })).toBe(4);
  });

  test('the sign of a draw from an empty exact range is not known', () => {
    // The machine count, with its tolerance, counted the element 0, and the
    // draw was said to be non-negative. The range is empty, and the draw is
    // an error.
    const e = ce.box([
      'Random',
      ['Range', 0, ['Rational', -1, 10000000000000], 1],
    ]);
    expect(e.isNonNegative).toBeUndefined();
  });
});
