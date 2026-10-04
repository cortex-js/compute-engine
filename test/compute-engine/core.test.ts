import { ComputeEngine } from '../../src/compute-engine';

export const ce = new ComputeEngine();

describe('TAUTOLOGY a = 1', () => {
  test(`a.value`, () => {
    expect(ce.expr('a').evaluate()).toMatchInlineSnapshot(`"a"`);
  });
});

describe('ReplaceAll', () => {
  test('single symbol rule substitutes and evaluates', () => {
    const r = ce.parse('\\mathrm{ReplaceAll}(x^2+x, x\\to 2)').evaluate();
    expect(r.re).toBe(6);
  });

  test('a Set of rules is applied simultaneously (order-independent)', () => {
    const r = ce.parse('\\mathrm{ReplaceAll}(x+y, \\{x\\to 1, y\\to 2\\})').evaluate();
    expect(r.re).toBe(3);
    const r2 = ce.parse('\\mathrm{ReplaceAll}(x+y, \\{y\\to 2, x\\to 1\\})').evaluate();
    expect(r2.re).toBe(3);
  });

  test('Rule form is accepted', () => {
    const r = ce.box(['ReplaceAll', ['Add', ['Power', 'x', 2], 'x'], ['Rule', 'x', 3]]).evaluate();
    expect(r.re).toBe(12);
  });

  test('with no matching symbol the target is returned evaluated', () => {
    const r = ce.box(['ReplaceAll', ['Add', 'y', 1], ['To', 'x', 2]]).evaluate();
    expect(r.isSame(ce.box(['Add', 'y', 1]))).toBe(true);
  });
});

describe('N / Evaluate nesting collapse', () => {
  // Shape pins use `.json` (no evaluation): evaluating `N(x, p)` with p above
  // the engine's precision raises the process-global precision and leaves it
  // raised.

  test('N(Evaluate(x)) keeps the OUTER N (the numericization)', () => {
    expect(ce.box(['N', ['Evaluate', 'Pi']]).json).toEqual(['N', 'Pi']);
    // …and still numericizes: collapsing to `Evaluate(x)` returned exact pi.
    expect(ce.box(['N', ['Evaluate', 'Pi']]).evaluate().isNumberLiteral).toBe(
      true
    );
  });

  test('N(Evaluate(x), p) drops the redundant Evaluate, keeps the precision', () => {
    expect(ce.box(['N', ['Evaluate', 'Pi'], 50]).json).toEqual(['N', 'Pi', 50]);
  });

  test('N(N(x)) collapses; N(N(x), p) does not (different rounding)', () => {
    expect(ce.box(['N', ['N', 'Pi']]).json).toEqual(['N', 'Pi']);
    expect(ce.box(['N', ['N', 'Pi'], 5]).json).toEqual(['N', ['N', 'Pi'], 5]);
  });

  test('Evaluate(Evaluate(x)) and Evaluate(N(x)) keep the INNER node', () => {
    expect(ce.box(['Evaluate', ['Evaluate', 'Pi']]).json).toEqual([
      'Evaluate',
      'Pi',
    ]);
    expect(ce.box(['Evaluate', ['N', 'Pi']]).json).toEqual(['N', 'Pi']);
  });

  test('mixed chains normalize to a single wrapper', () => {
    expect(ce.box(['N', ['Evaluate', ['N', 'Pi']]]).json).toEqual(['N', 'Pi']);
    expect(ce.box(['Evaluate', ['N', ['Evaluate', 'Pi']]]).json).toEqual([
      'N',
      'Pi',
    ]);
  });
});

describe('N gives an inexact result', () => {
  // `N` asks for a numeric approximation, so a number that it returns is a
  // float even when its value is an integer. Later exact arithmetic must not
  // use that value as exact (GitHub issue #409).
  //
  // A separate engine: `N(x, p)` with `p` above the working precision raises
  // the working precision of the engine and keeps it raised.
  const ce = new ComputeEngine();

  test('N(2) is an inexact 2', () => {
    const r = ce.box(['N', 2]).evaluate();
    expect(r.isNumberLiteral).toBe(true);
    expect(r.isExact).toBe(false);
    expect(r.re).toBe(2);
    expect(r.json).toEqual({ num: '2.0' });
  });

  test('N(2)/3 is a float, not the rational 2/3', () => {
    const r = ce.box(['Divide', ['N', 2], 3]).evaluate();
    expect(r.isExact).toBe(false);
    expect(r.re).toBeCloseTo(2 / 3, 15);
  });

  test('the mean of an N list is the inexact 2.5', () => {
    const r = ce.box(['Mean', ['N', ['List', 1, 2, 3, 4], 30]]).evaluate();
    expect(r.isExact).toBe(false);
    expect(r.re).toBe(2.5);
  });

  test('the elements of an N list are inexact, also when nested', () => {
    const r = ce.box(['N', ['List', 1, 2, 3, 4], 30]).evaluate();
    expect(r.operator).toBe('List');
    expect(r.ops!.map((x) => x.isExact)).toEqual([false, false, false, false]);
    expect(r.ops!.map((x) => x.re)).toEqual([1, 2, 3, 4]);

    const t = ce.box(['N', ['Tuple', 1, ['List', 2, 3]]]).evaluate();
    expect(t.operator).toBe('Tuple');
    expect(t.op1.isExact).toBe(false);
    expect(t.op2.ops!.map((x) => x.isExact)).toEqual([false, false]);
  });

  test('N(1/3) is unchanged', () => {
    const r = ce.box(['N', ['Rational', 1, 3]]).evaluate();
    expect(r.isExact).toBe(false);
    expect(r.re).toBeCloseTo(1 / 3, 15);
  });

  test('N(x + 1) is unchanged: the constants of a symbolic result stay exact', () => {
    const r = ce.box(['N', ['Add', 'x', 1]]).evaluate();
    expect(r.json).toEqual(['Add', 'x', 1]);
  });

  test('N(list, p) rounds each element to p significant digits', () => {
    expect(
      ce.box(['N', ['List', ['Rational', 1, 3], 'Pi'], 4]).evaluate().json
    ).toEqual(['List', 0.3333, 3.142]);
    const t = ce
      .box(['N', ['Tuple', ['Rational', 1, 3], ['List', ['Rational', 2, 3], 7]], 3])
      .evaluate();
    expect(t.json).toEqual(['Tuple', 0.333, ['List', 0.667, { num: '7.0' }]]);
  });

  test('the elements of N of a lazy collection are inexact when they are read', () => {
    // `Range` is lazy: `N` makes each element inexact when it is read, and
    // does not walk the collection (it can be infinite).
    const r = ce.box(['Divide', ['N', ['Range', 1, 4]], 3]).evaluate();
    expect(r.ops!.map((x) => x.isExact)).toEqual([false, false, false, false]);
    expect(r.ops!.map((x) => x.re)).toEqual([1 / 3, 2 / 3, 1, 4 / 3]);

    const mean = ce.box(['Mean', ['N', ['Range', 1, 4]]]).evaluate();
    expect(mean.isExact).toBe(false);
    expect(mean.re).toBe(2.5);

    const third = ce
      .box(['At', ['N', ['Range', 1, 'PositiveInfinity']], 3])
      .evaluate();
    expect(third.isExact).toBe(false);
    expect(third.re).toBe(3);

    const rounded = ce.box(['N', ['Range', 1, 3], 2]).evaluate();
    expect([...rounded.each()].map((x) => x.isExact)).toEqual([
      false,
      false,
      false,
    ]);
  });

  test('N(list, p) rounds the elements of a lazy collection in the list', () => {
    // The digits apply to a lazy collection in a list as they do to a lazy
    // collection alone.
    const alone = ce.box(['N', ['Range', 123, 125], 2]).evaluate();
    expect([...alone.each()].map((x) => x.re)).toEqual([120, 120, 120]);

    const range = ce.box(['N', ['List', ['Range', 123, 125]], 2]).evaluate();
    expect(range.operator).toBe('List');
    expect([...range.op1.each()].map((x) => x.re)).toEqual([120, 120, 120]);
    expect([...range.op1.each()].map((x) => x.isExact)).toEqual([
      false,
      false,
      false,
    ]);

    const map = ce
      .box([
        'N',
        ['List', ['Map', ['Function', ['Divide', 'x', 3], 'x'], ['Range', 1, 3]]],
        2,
      ])
      .evaluate();
    expect([...map.op1.each()].map((x) => x.re)).toEqual([0.33, 0.67, 1]);
    expect([...map.op1.each()].map((x) => x.isExact)).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('N in the body of a Map, and the `.N()` method of a lazy Map', () => {
  // A user-written `N` in the body of a `Map` gives inexact elements on every
  // route. The `.N()` method of a lazy `Map` puts a different marker,
  // `NumericApproximation`, around the body: its elements are the values of
  // the `.N()` method, where an integer stays exact (GitHub issue #409).
  const inexact = [false, false, false];
  const exactness = (xs: any) => [...xs.each()].map((x: any) => x.isExact);
  const values = (xs: any) => [...xs.each()].map((x: any) => x.re);

  test('box, parse and function routes give inexact elements', () => {
    const ce = new ComputeEngine();
    const fn = ['Function', ['N', ['Power', 'x', 2]], 'x'] as const;
    const routes = [
      ce.box(['Map', fn, ['Range', 1, 3]]),
      ce.parse('\\operatorname{Map}(x \\mapsto N(x^2), [1, 2, 3])'),
      ce.function('Map', [ce.box(fn as any), ce.box(['Range', 1, 3])]),
    ];
    for (const route of routes) {
      const r = route.evaluate();
      expect(values(r)).toEqual([1, 4, 9]);
      expect(exactness(r)).toEqual(inexact);
      // `.N()` of a body that is already in `N` keeps the `N` operator.
      expect(exactness(route.N())).toEqual(inexact);
    }
  });

  test('the compiled route gives inexact elements', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.declare('L', {
      value: ce.box(['List', ...Array.from({ length: 200 }, (_, i) => i + 1)]),
    });
    const hits = ce._mapAutoCompileStats.compiledHits;
    const r = ce
      .box(['Map', ['Function', ['N', ['Power', 'x', 2]], 'x'], 'L'])
      .evaluate();
    const xs = [...r.each()];
    expect(ce._mapAutoCompileStats.compiledHits).toBeGreaterThan(hits);
    expect(xs.slice(0, 3).map((x) => x.json)).toEqual([
      { num: '1.0' },
      { num: '4.0' },
      { num: '9.0' },
    ]);
    expect(xs.every((x) => x.isExact === false)).toBe(true);
  });

  test('the compiled route computes an exact input above the safe integers as the interpreter does', () => {
    // The compiled code converts an exact input to a float before the
    // computation, and the float of 9007199254740993 is 9007199254740992.
    // The interpreter computes such an element with the exact value.
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const big = { num: '9007199254740993' };
    ce.declare('L', {
      value: ce.box([
        'List',
        big,
        ...Array.from({ length: 199 }, (_, i) => i + 1),
      ] as any),
    });

    // A user-written `N`: `3x` at the exact `9007199254740993` is
    // `27021597764222979`, and its float is `27021597764222980`.
    const hits = ce._mapAutoCompileStats.compiledHits;
    const user = ce
      .box(['Map', ['Function', ['N', ['Multiply', 3, 'x']], 'x'], 'L'])
      .evaluate();
    const xs = [...user.each()];
    expect(ce._mapAutoCompileStats.compiledHits).toBeGreaterThan(hits);
    const expected = ce.box(['N', ['Multiply', 3, big]]).evaluate();
    expect(expected.isExact).toBe(false);
    expect(xs[0].isExact).toBe(false);
    expect(xs[0].isSame(expected)).toBe(true);
    expect(xs[1].json).toEqual({ num: '3.0' });

    // The `.N()` method: `x/2` at the exact `9007199254740993` is not an
    // integer. The compiled code gives the integer `4503599627370496`.
    const half = ce
      .box(['Map', ['Function', ['Divide', 'x', 2], 'x'], 'L'])
      .evaluate()
      .N();
    const first = [...half.each()][0];
    const reference = ce.box(['Divide', big, 2]).evaluate().N();
    expect(first.isExact).toBe(false);
    expect(first.isSame(reference)).toBe(true);
  });

  test('the `.N()` method of a lazy Map keeps an integer exact', () => {
    const ce = new ComputeEngine();
    const m = ce
      .box(['Map', ['Function', ['Power', 'x', 2], 'x'], ['Range', 1, 3]])
      .N();
    expect(values(m)).toEqual([1, 4, 9]);
    expect(exactness(m)).toEqual([true, true, true]);

    // `Sec(1e-13·x)` is the exact `1` at `0`, and the float `1.0` at `1`.
    const sec = ce
      .box([
        'Map',
        ['Function', ['Sec', ['Multiply', 1e-13, 'x']], 'x'],
        ['List', 0, 1, 2],
      ])
      .N();
    expect(exactness(sec)).toEqual([true, false, false]);
  });

  test('the marker of the `.N()` method survives a MathJSON and a LaTeX round trip', () => {
    const ce = new ComputeEngine();
    const m = ce
      .box(['Map', ['Function', ['Power', 'x', 2], 'x'], ['Range', 1, 3]])
      .N();
    for (const copy of [ce.box(m.json), ce.parse(m.latex)]) {
      const r = copy.evaluate();
      expect(values(r)).toEqual([1, 4, 9]);
      expect(exactness(r)).toEqual([true, true, true]);
    }

    // The marker gives the value of the `.N()` method: the exact 2.
    const two = ce.box(['NumericApproximation', 2]).evaluate();
    expect(two.isExact).toBe(true);
    expect(two.json).toBe(2);
  });
});
