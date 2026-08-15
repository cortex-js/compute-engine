import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * An indexed read out of a collection with COMPLEX elements.
 *
 * A list is emitted element by element, and each element picks its own
 * real-vs-complex lowering, so the run-time array is heterogeneous: `[i·t, 1]`
 * lowers to `[{re, im}, 1]`. Before `isComplexValuedElementAt`, an indexed read
 * was classified from the WHOLE collection — `ops.some(isComplexValued)` for a
 * literal list, and a flat decline for a call to a user function with a
 * collection body — and that verdict describes no individual element. It was
 * wrong in both directions, and both directions ran to a silently wrong value
 * behind `success: true`. Measured on the DEFAULT path, no compile option set:
 *
 * | shape             | compiled before        | interpreter |
 * | ----------------- | ---------------------- | ----------- |
 * | `[i·t, 1][2] + 1` | `{re: NaN}`            | `2`         |
 * | `h(t)[1] + 1`     | the STRING `"…1"`      | `1 + 0.3i`  |
 *
 * The first OVER-claims: the list holds a complex element, so the plain number
 * `1` pulled out of it is read as `{re, im}` and `.re` is `undefined`. The
 * second UNDER-claims: the call is classified real, so the `{re, im}` pulled out
 * of it is added to a number and JavaScript concatenates the object instead.
 *
 * `t = 0.3` throughout, so `i·t` is `0.3i`.
 */

const T = { t: 0.3 };

/** `f(t) := <body>` built as MathJSON — the shapes here have no LaTeX spelling
 * that survives `strict: false` parsing (`w(t)` reads as a product of symbols).
 */
function withFn(name: string, body: unknown): ComputeEngine {
  const ce = new ComputeEngine();
  ce.box(['Assign', name, ['Function', body, 't']] as any).evaluate();
  return ce;
}

function run(
  ce: ComputeEngine,
  mj: unknown,
  args: Record<string, unknown> = T
) {
  const r = compile(ce.box(mj as any))!;
  expect(r.success).toBe(true);
  return r.run!(args as any);
}

describe('indexed read of a literal list with a complex element', () => {
  const LIST = ['List', ['Multiply', 'ImaginaryUnit', 't'], 1];

  test('a REAL element is not read as a complex object', () => {
    // The over-claim: `{re: NaN}` before the fix.
    const ce = new ComputeEngine();
    expect(run(ce, ['Add', ['At', LIST, 2], 1])).toEqual(2);
  });

  test('a COMPLEX element still reads as one', () => {
    const ce = new ComputeEngine();
    expect(run(ce, ['Add', ['At', LIST, 1], 1])).toEqual({ re: 1, im: 0.3 });
  });

  test('an all-complex list answers complex at every index', () => {
    const ce = new ComputeEngine();
    const all = ['List', ['Multiply', 'ImaginaryUnit', 't'], 'ImaginaryUnit'];
    expect(run(ce, ['Add', ['At', all, 1], 1])).toEqual({ re: 1, im: 0.3 });
    expect(run(ce, ['Add', ['At', all, 2], 1])).toEqual({ re: 1, im: 1 });
  });

  test('a NEGATIVE index counts back from the end', () => {
    // `At([10, 20, 30], -1)` compiles to `30`, so `-1` names the last element.
    // Treating a negative index as invalid left the read on the whole-list
    // verdict and reproduced the original over-claim: this ran to `{re: NaN}`.
    const ce = new ComputeEngine();
    expect(run(ce, ['Add', ['At', LIST, -1], 1])).toEqual(2);
    expect(run(ce, ['Add', ['At', LIST, -2], 1])).toEqual({ re: 1, im: 0.3 });
  });

  test('an index that selects nothing yields a plain NaN, not an object', () => {
    // Zero, fractional, and past-the-end indices all lower to the plain number
    // `NaN`, so the read is REAL. Answering complex wrapped that `NaN` in
    // `{re, im}` and the caller read `undefined` off `.re`.
    const ce = new ComputeEngine();
    for (const bad of [0, 5, -5]) {
      const v = run(ce, ['Add', ['At', LIST, bad], 1]);
      expect(typeof v).toBe('number');
      expect(v).toBeNaN();
    }
  });

  test('a GATHER index still compiles — it selects a sub-list, not an element', () => {
    // `At(L, [2])` returns `[L[2]]`. Neither the per-element answer nor the
    // mixed-element decline applies to it; treating a collection index as an
    // unknown scalar made this fail to compile, a pure regression against the
    // all-real case (`At([10, 20, 30], [2])` → `[20]`), which never stopped.
    const ce = new ComputeEngine();
    expect(run(ce, ['At', LIST, ['List', 2]])).toEqual([1]);
    expect(run(ce, ['At', ['List', 10, 20, 30], ['List', 2]])).toEqual([20]);
  });
});

describe('indexed read of a DIRECT PointList value', () => {
  // Not routed through a user function: `PointList(i·t, 1)` used as a value.
  const PL = ['PointList', ['Multiply', 'ImaginaryUnit', 't'], 1];

  test('each component reads with its own complex-ness', () => {
    const ce = new ComputeEngine();
    expect(run(ce, ['Add', ['At', PL, 1], 1])).toEqual({ re: 1, im: 0.3 });
    expect(run(ce, ['Add', ['At', PL, 2], 1])).toEqual(2);
  });
});

describe('indexed read of a call to a collection-valued user function', () => {
  test('a List body: the complex element is not string-concatenated', () => {
    // The under-claim: the STRING "[object Object]1" before the fix.
    const ce = withFn('h', ['List', ['Multiply', 'ImaginaryUnit', 't'], 1]);
    expect(run(ce, ['Add', ['At', ['h', 't'], 1], 1])).toEqual({
      re: 1,
      im: 0.3,
    });
  });

  test('...and the real element of that same body still reads real', () => {
    const ce = withFn('h', ['List', ['Multiply', 'ImaginaryUnit', 't'], 1]);
    expect(run(ce, ['Add', ['At', ['h', 't'], 2], 1])).toEqual(2);
  });

  test('a PointList body is covered too — the shape the consumer uses', () => {
    // An ALL-SCALAR `PointList` is one point whose component k is operand k,
    // the equivalence the JavaScript target already relies on. A component that
    // may be a collection is a SOURCE, zipped across points, and is excluded.
    const ce = withFn('q', [
      'PointList',
      ['Multiply', 'ImaginaryUnit', 't'],
      1,
    ]);
    expect(run(ce, ['Add', ['At', ['q', 't'], 1], 1])).toEqual({
      re: 1,
      im: 0.3,
    });
    expect(run(ce, ['Add', ['At', ['q', 't'], 2], 1])).toEqual(2);
  });

  test('a RUN-TIME index is answered when every element agrees', () => {
    // No single element can be named, but a verdict they all share holds
    // whichever one the index selects. `u(t)[k] + 1` compiled to the string
    // "[object Object]1" before the fix.
    const ce = withFn('u', [
      'List',
      ['Multiply', 'ImaginaryUnit', 't'],
      'ImaginaryUnit',
    ]);
    expect(
      run(ce, ['Add', ['At', ['u', 't'], 'k'], 1], { t: 0.3, k: 1 })
    ).toEqual({ re: 1, im: 0.3 });
  });

  test('a self-recursive body terminates rather than looping', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'r',
      ['Function', ['List', ['r', 't'], 1], 't'],
    ] as any).evaluate();
    // The only requirement is that the ANALYSIS terminates; whether this
    // compiles is decided elsewhere.
    expect(() => compile(ce.box(['At', ['r', 't'], 2] as any))).not.toThrow();
  });
});

describe('run-time index into a MIXED collection fails closed (D6)', () => {
  // Element 1 is complex and element 2 is not, so the read is a `{re, im}`
  // object for one index and a plain number for the other, decided at run time.
  // No lowering is correct for both. Before this, `[i·t, 1][k] + 1` at `k = 2`
  // ran to `{re: NaN}` where the interpreter answers `2`. User-ruled
  // 2026-08-15: decline rather than emit a coin flip.
  const MIXED = ['List', ['Multiply', 'ImaginaryUnit', 't'], 1];

  test('a literal list declines', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Add', ['At', MIXED, 'k'], 1] as any))!;
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/mixes complex-valued and real-valued elements/);
    expect(r.error).toMatch(/Fail closed \(D6\)/);
  });

  test('a user-function body declines the same way', () => {
    const ce = withFn('m', MIXED);
    const r = compile(ce.box(['Add', ['At', ['m', 't'], 'k'], 1] as any))!;
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Fail closed \(D6\)/);
  });

  test('a LITERAL index into that same list still compiles', () => {
    const ce = new ComputeEngine();
    expect(run(ce, ['Add', ['At', MIXED, 2], 1])).toEqual(2);
  });

  test('an all-real collection is untouched by the guard', () => {
    const ce = new ComputeEngine();
    expect(
      run(ce, ['Add', ['At', ['List', 10, 20, 30], 'k'], 1], { t: 0.3, k: 2 })
    ).toEqual(21);
  });

  test('a COMPLEX index is left to its own handling, not this guard', () => {
    // `At(List(10, 20, 30), Complex(1, 2))` must keep reporting complex from
    // the INDEX and stay unfolded — the elements say nothing about it.
    const ce = new ComputeEngine();
    const r = compile(
      ce.box(['At', ['List', 10, 20, 30], ['Complex', 1, 2]] as any)
    )!;
    expect(r.success).toBe(true);
    expect(r.code).toEqual('_SYS.at([10, 20, 30], ({ re: 1, im: 2 }))');
  });
});

describe('broadcast over a collection with a complex element', () => {
  test('scalar·list declines instead of mapping real codegen over objects', () => {
    // The broadcast closure binds bare element parameters and cannot carry
    // complex scalar codegen, so it must defer. Its complex-element test was
    // TYPE-based, and a list mixing a complex and a real element unifies to a
    // wide element type that is neither — so the test answered `false`.
    // Measured before: `2·h(t)` ran to `[NaN, 2]` against `[0.6i, 2]`.
    const ce = withFn('h', ['List', ['Multiply', 'ImaginaryUnit', 't'], 1]);
    const r = compile(ce.box(['Multiply', 2, ['h', 't']] as any))!;
    expect(r.success).toBe(false);
  });

  test('an all-real list still broadcasts', () => {
    const ce = withFn('s', ['List', 't', 1]);
    expect(run(ce, ['Multiply', 2, ['s', 't']])).toEqual([0.6, 2]);
  });
});

describe('complexPromotion over a collection-valued body (ROADMAP 2026-08-15)', () => {
  // The opt-in promotes an unknown-sign radical to the complex lane. It always
  // promoted INSIDE a collection-valued body — `_fn_w` returned
  // `[{re, im}, {re, im}]` — but the call site read that array's elements as
  // plain numbers, so the item's witness stayed NaN with the option ON,
  // indistinguishable from OFF. Classifying the element fixes it; nothing about
  // the promotion rule itself changed.
  const PROMOTED = 1.08397416943394;

  const RADICALS = (head: string) => [
    head,
    ['Sqrt', ['Subtract', 't', 1]],
    ['Sqrt', ['Subtract', 't', 2]],
  ];
  // `|f(t)[1]/2 − 1|`
  const CHAIN = (name: string) => [
    'Abs',
    ['Subtract', ['Divide', ['At', [name, 't'], 1], 2], 1],
  ];

  test.each([['List'], ['PointList']])(
    'ON: a %s body promotes and matches the interpreter',
    (head) => {
      const ce = withFn('w', RADICALS(head));
      const r = compile(ce.box(CHAIN('w') as any), {
        complexPromotion: true,
      })!;
      expect(r.success).toBe(true);
      expect(r.run!({ t: 0.3 } as any)).toBeCloseTo(PROMOTED, 12);
    }
  );

  test('OFF: the default is unchanged — still the real kernel and its NaN', () => {
    const ce = withFn('w', RADICALS('List'));
    const r = compile(ce.box(CHAIN('w') as any))!;
    expect(r.success).toBe(true);
    expect(r.code).toContain('Math.abs');
    expect(r.run!({ t: 0.3 } as any)).toBeNaN();
  });

  test('ON: a MIXED body still hands back its real element as a number', () => {
    // The guard `isComplexValuedUserCall` carries for a collection body is not
    // relaxed by any of this: element 2 of `[√(t−1), 1]` is the plain `1`, and
    // reading it must not inherit element 1's promotion.
    const ce = withFn('g', ['List', ['Sqrt', ['Subtract', 't', 1]], 1]);
    const r = compile(ce.box(['Add', ['At', ['g', 't'], 2], 1] as any), {
      complexPromotion: true,
    })!;
    expect(r.success).toBe(true);
    expect(r.run!({ t: 0.3 } as any)).toEqual(2);
  });

  test('ON: an ordering over a promoted element fails closed, as for a scalar', () => {
    // The documented cost of the option, now reaching indexed reads as well:
    // once the operand may be complex the comparison has no truth value. What
    // it replaces is not a working comparison — before the element
    // classification, `Less(w(t)[k], 2)` compiled to a CONSTANT `false`
    // (`{re, im} < 2` is never true), wrong at t = 2 where the interpreter
    // answers True.
    const ce = withFn('w', RADICALS('List'));
    const r = compile(ce.box(['Less', ['At', ['w', 't'], 1], 2] as any), {
      complexPromotion: true,
    })!;
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Fail closed \(D6\)/s);
  });

  test('OFF: that same ordering still compiles', () => {
    const ce = withFn('w', RADICALS('List'));
    const r = compile(ce.box(['Less', ['At', ['w', 't'], 1], 2] as any))!;
    expect(r.success).toBe(true);
  });
});
