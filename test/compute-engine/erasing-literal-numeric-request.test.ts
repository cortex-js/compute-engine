import { ComputeEngine } from '../../src/compute-engine';

// A list literal with an element that may evaluate to `Nothing`
// (`[If(c, 1, Nothing), …]`) is read through its value by its collection
// handlers and by a broadcast, so that a count or a walk sees the elements
// the literal keeps. The handlers follow the numeric request of the
// evaluation that calls them (user decision 2026-10-17;
// `IComputeEngine._numericRequest`): under `.N()` only the element that may
// erase is evaluated, and the other elements are kept as written for the
// caller to approximate, as for a literal with no such element. Before, the
// value was an EXACT evaluation of every element whatever the caller asked:
// with `H = Sum(1/k, k, 1, 6000)`, `Count(Map(Sin, [If(c, 1, Nothing), H]))
// .N()` took 11 s and `Floor([If(c, 1, Nothing), H]).N()` 7 s, where the same
// expressions without the erasing element take less than 0.1 s.
//
// `Slow(n)` counts its exact and its numeric evaluations: the exact value is
// the rational `n + 1/3`, the numeric value its float.

// The exact `q = (25! − 1)/24!`: its 21-digit float is `25.0`, its floor 24.
const q = ['Divide', ['Subtract', ['Factorial', 25], 1], ['Factorial', 24]];
const ERASED = ['If', 'c', 1, 'Nothing'];
const ID = ['Function', 'x', 'x'];

function engine() {
  const ce = new ComputeEngine();
  ce.assign('c', false);
  const n = { exact: 0, numeric: 0 };
  ce.declare('Slow', {
    signature: '(integer) -> real',
    evaluate: ([x], { numericApproximation }) => {
      if (numericApproximation) {
        n.numeric += 1;
        return ce.number((x.re ?? 0) + 1 / 3);
      }
      n.exact += 1;
      return ce.number([3 * (x.re ?? 0) + 1, 3]);
    },
  });
  const reset = () => {
    n.exact = 0;
    n.numeric = 0;
  };
  return { ce, n, reset };
}

describe('the handlers of an erasing literal follow the numeric request', () => {
  test('a count under .N() evaluates no kept element', () => {
    const { ce, n } = engine();
    const e = ce.box(['Count', ['Map', 'Sin', ['List', ERASED, ['Slow', 4]]]]);
    expect(e.N().toString()).toBe('1');
    expect(n.exact).toBe(0);
    const length = ce.box([
      'Length',
      ['Map', ID, ['List', ERASED, ['Slow', 4]]],
    ]);
    expect(length.N().toString()).toBe('1');
    expect(n.exact).toBe(0);
  });

  test('the exact route still reads the value of the literal', () => {
    const { ce } = engine();
    const e = ce.box(['Count', ['Map', 'Sin', ['List', ERASED, ['Slow', 4]]]]);
    expect(e.evaluate().toString()).toBe('1');
    // The element the erasure keeps.
    ce.assign('c', true);
    expect(e.evaluate().toString()).toBe('2');
    expect(e.N().toString()).toBe('2');
  });

  test('the elements read under .N() are the approximated elements', () => {
    const { ce } = engine();
    const first = ce
      .box(['First', ['Map', 'Sin', ['List', ERASED, ['Slow', 4]]]])
      .N();
    const expected = ce.box(['Sin', ['Rational', 13, 3]]).N();
    expect(first.re).toBeCloseTo(expected.re, 15);
  });

  test('a jump callback still reads the exact element under .N()', () => {
    const { ce } = engine();
    for (const json of [
      ['Map', 'Floor', ['Map', ID, ['List', ERASED, q]]],
      ['Map', 'Floor', ['List', ERASED, q]],
      ['Floor', ['Map', ID, ['List', ERASED, q]]],
    ])
      expect(ce.box(json).N().toString()).toBe('[24]');
  });

  test('an erasure that cannot be resolved reads the operands', () => {
    const { ce } = engine();
    const e = ce.box([
      'Count',
      ['Map', 'Sin', ['List', ['If', 'd', 1, 'Nothing'], 2]],
    ]);
    expect(e.N().toString()).toBe('2');
    expect(e.evaluate().toString()).toBe('2');
  });

  test('async route: the same answer', async () => {
    const { ce } = engine();
    const e = ce.box(['Count', ['Map', 'Sin', ['List', ERASED, ['Slow', 4]]]]);
    const v = await e.evaluateAsync({ numericApproximation: true });
    expect(v.toString()).toBe('1');
  });
});

describe('a jump operator over an erasing literal resolves only the erasure', () => {
  test('Floor evaluates the kept elements as it does without the erasure', () => {
    const { ce, n, reset } = engine();
    expect(
      ce
        .box(['Floor', ['List', ['Slow', 4]]])
        .N()
        .toString()
    ).toBe('[4]');
    const plain = { ...n };
    reset();
    expect(
      ce
        .box(['Floor', ['List', ERASED, ['Slow', 4]]])
        .N()
        .toString()
    ).toBe('[4]');
    expect(n).toEqual(plain);
  });

  test('the kept elements stay exact for the jump rule', () => {
    const { ce } = engine();
    expect(
      ce
        .box(['Floor', ['List', ERASED, q]])
        .N()
        .toString()
    ).toBe('[24]');
    expect(
      ce
        .box(['Mod', ['List', ERASED, q], 1])
        .N()
        .toString()
    ).toBe('[1]');
    ce.assign('c', true);
    expect(
      ce
        .box(['Floor', ['List', ERASED, q]])
        .N()
        .toString()
    ).toBe('[1,24]');
  });

  test('async route: the same answer', async () => {
    const { ce } = engine();
    const v = await ce
      .box(['Floor', ['List', ERASED, q]])
      .evaluateAsync({ numericApproximation: true });
    expect(v.toString()).toBe('[24]');
  });
});

// The selective resolution evaluates the elements that may erase before the
// elements that come before them, and evaluates the whole literal again when
// the erasure stays undecided. So it applies only to a literal that is
// transitively pure: any other literal is evaluated once, in order.
describe('an impure erasing literal is evaluated once, in order', () => {
  function impureEngine() {
    const ce = new ComputeEngine();
    ce.assign('c', true);
    // `Tick()` sets `c` to `False` and returns 1.
    ce.declare('Tick', {
      signature: '() -> integer',
      pure: false,
      evaluate: () => {
        ce.assign('c', false);
        return ce.number(1);
      },
    });
    const draws = { n: 0 };
    ce.declare('Draw', {
      signature: '() -> integer',
      pure: false,
      evaluate: () => {
        draws.n += 1;
        return ce.number(1);
      },
    });
    return { ce, draws };
  }
  const TICKED = ['Floor', ['List', ['Tick'], ['If', 'c', 2, 'Nothing']]];
  // `d` has no value: the erasure of the second element stays undecided.
  const DRAWN = [
    'Floor',
    [
      'List',
      ['If', ['Greater', ['Draw'], 0], 1, 'Nothing'],
      ['If', 'd', 2, 'Nothing'],
    ],
  ];

  test('an element runs before the elements after it', async () => {
    expect(impureEngine().ce.box(TICKED).N().toString()).toBe('[1]');
    const { ce } = impureEngine();
    const v = await ce
      .box(TICKED)
      .evaluateAsync({ numericApproximation: true });
    expect(v.toString()).toBe('[1]');
  });

  test('an undecided erasure runs each element once', async () => {
    const sync = impureEngine();
    sync.ce.box(DRAWN).N();
    expect(sync.draws.n).toBe(1);
    const async = impureEngine();
    await async.ce.box(DRAWN).evaluateAsync({ numericApproximation: true });
    expect(async.draws.n).toBe(1);
  });
});

describe('the async route of an erasing literal', () => {
  test('a condition with only an evaluateAsync handler is awaited', async () => {
    const ce = new ComputeEngine();
    ce.declare('AsyncFalse', {
      signature: '() -> boolean',
      evaluateAsync: async () => ce.False,
    } as never);
    ce.declare('AsyncTrue', {
      signature: '() -> boolean',
      evaluateAsync: async () => ce.True,
    } as never);
    const N = { numericApproximation: true };
    // The erased element is dropped, not passed to `Floor` as `Nothing`.
    expect(
      (
        await ce
          .box(['Floor', ['List', ['If', ['AsyncFalse'], 1, 'Nothing'], q]])
          .evaluateAsync(N)
      ).toString()
    ).toBe('[24]');
    // The kept element stays exact for the jump rule.
    expect(
      (
        await ce
          .box(['Floor', ['List', ['If', ['AsyncTrue'], q, 'Nothing'], 2]])
          .evaluateAsync(N)
      ).toString()
    ).toBe('[24,2]');
  });

  test('a count under evaluateAsync with a numeric request evaluates no kept element', async () => {
    const { ce, n } = engine();
    const e = ce.box(['Count', ['Map', 'Sin', ['List', ERASED, ['Slow', 4]]]]);
    const v = await e.evaluateAsync({ numericApproximation: true });
    expect(v.toString()).toBe('1');
    expect(n.exact).toBe(0);
  });
});
