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
    // `At(List(10, 20, 30), Complex(1, 2))` must not DECLINE: the elements are
    // all real, so this guard has nothing to say about the index. The
    // structural lowering keeps the complex index as an object and defers to
    // `_SYS.at`, which is what `constantFold: false` shows.
    const ce = new ComputeEngine();
    const structural = compile(
      ce.box(['At', ['List', 10, 20, 30], ['Complex', 1, 2]] as any),
      { constantFold: false }
    )!;
    expect(structural.success).toBe(true);
    expect(structural.code).toEqual(
      '_SYS.at([10, 20, 30], ({ re: 1, im: 2 }))'
    );
    // On the DEFAULT path the read is a closed constant expression, so the
    // constant folder gets there first and inlines the interpreter's own
    // answer. It used to stay structural here too, because the read typed a
    // bare `number` and the complexness oracle hedged on it; the absence
    // marker now types `integer | nan`, which is provably real, so the fold is
    // admitted. Same value either way, which is the property that matters.
    const folded = compile(
      ce.box(['At', ['List', 10, 20, 30], ['Complex', 1, 2]] as any)
    )!;
    expect(folded.success).toBe(true);
    expect(folded.code).toEqual('10');
    expect(folded.run!({})).toEqual(
      ce.box(['At', ['List', 10, 20, 30], ['Complex', 1, 2]] as any).N().re
    );
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

  test('the DEFAULT now promotes too, and matches the interpreter', () => {
    // Was "OFF: still the real kernel and its NaN". The default mode is `auto`
    // since the compile-mode migration (step 4, 2026-08-16), and `auto`
    // promotes an unknown-sign radical — so no opt-in is needed to reach the
    // interpreter's value; `mode: 'strict'` is what keeps the real kernel.
    const ce = withFn('w', RADICALS('List'));
    const r = compile(ce.box(CHAIN('w') as any))!;
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.cabs');
    expect(r.promoted).toBe(true);
    expect(r.run!({ t: 0.3 } as any)).toBeCloseTo(PROMOTED, 12);
    const strict = compile(ce.box(CHAIN('w') as any), { mode: 'strict' })!;
    expect(strict.code).toContain('Math.abs');
    expect(strict.run!({ t: 0.3 } as any)).toBeNaN();
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

  test('an ordering over a promoted element takes the runtime rule, as for a scalar', () => {
    // Was the documented cost of the option: the comparison failed closed once
    // the operand might be complex. Since the compile-mode migration (step 4,
    // 2026-08-16) D2 makes it a RUNTIME question instead — `false` when the
    // value is complex at that point, the real comparison otherwise — so the
    // ordering compiles and agrees with the interpreter at both ends. What
    // this replaces is not a working comparison either: before the element
    // classification, `Less(w(t)[k], 2)` compiled to a CONSTANT `false`
    // (`{re, im} < 2` is never true), wrong at t = 2 where the interpreter
    // answers True.
    const ce = withFn('w', RADICALS('List'));
    const r = compile(ce.box(['Less', ['At', ['w', 't'], 1], 2] as any))!;
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.cisreal(');
    expect(r.run!({ t: 0.3 } as any)).toBe(false); // √(−0.7) is complex
    expect(r.run!({ t: 2 } as any)).toBe(true); // √1 = 1 < 2
    expect(r.run!({ t: 5 } as any)).toBe(false); // √4 = 2, not < 2
  });

  test('that same ordering compiles in the strict lane as well', () => {
    const ce = withFn('w', RADICALS('List'));
    const r = compile(ce.box(['Less', ['At', ['w', 't'], 1], 2] as any), {
      mode: 'strict',
    })!;
    expect(r.success).toBe(true);
  });
});

/**
 * Scalar arithmetic consuming a collection-valued call as a WHOLE operand,
 * under the `complexPromotion` opt-in (ROADMAP 2026-08-15, reported by a
 * consumer's enablement pricing: 9 of 25 compiled-band losses).
 *
 * With `w(t) := [√(t−1), √(t−2)]`, turning the opt-in on made `2·w(t)`,
 * `w(t)+1` and `w(t)/2` DECLINE with "cannot compile scalar arithmetic over a
 * list-valued operand", where with it off all three compiled — and compiled
 * correctly, at both ends of the domain. The loss was in `tryCompileBroadcast`,
 * not in the D6 guard the diagnostic comes from: promotion made every element
 * of the body complex, and the broadcast declined outright on any complex
 * element because its scalar closure took its element parameters as bare
 * symbols, which the head's codegen reads as real. Declaring each parameter's
 * complex-ness in a local frame lets the same closure carry the complex
 * lowering, so the shape broadcasts instead of falling through to D6.
 *
 * The trigger was a CONJUNCTION — a collection-valued body, containing a
 * radical, consumed whole — so both controls are pinned here alongside it, and
 * so is the indexed case, which compiled throughout and must keep doing so.
 */
describe('whole-collection scalar arithmetic under complexPromotion (ROADMAP 2026-08-15)', () => {
  const W = [
    'List',
    ['Sqrt', ['Subtract', 't', 1]],
    ['Sqrt', ['Subtract', 't', 2]],
  ];

  /** In the real domain (t = 3) and outside it (t = 0.3). */
  const IN = { t: 3 };
  const OUT = { t: 0.3 };

  const compiled = (body: unknown, mj: unknown, complexPromotion: boolean) => {
    const ce = withFn('w', body);
    return compile(ce.box(mj as any), { complexPromotion })!;
  };

  test.each([
    ['2·w(t)', ['Multiply', 2, ['w', 't']]],
    ['w(t)+1', ['Add', ['w', 't'], 1]],
    ['w(t)/2', ['Divide', ['w', 't'], 2]],
  ])('ON: %s compiles', (_label, mj) => {
    expect(compiled(W, mj, true).success).toBe(true);
    expect(compiled(W, mj, false).success).toBe(true);
  });

  test('ON: the values match the interpreter at both ends of the domain', () => {
    // `w(3) = [√2, 1]`, so `2·w(3) = [2√2, 2]`; `w(0.3) = [√−0.7, √−1.7]`,
    // which the opt-in promotes, so `2·w(0.3) = [1.673…i, 2.607…i]` — the
    // interpreter's answer, now reproduced element by element.
    const r = compiled(W, ['Multiply', 2, ['w', 't']], true);
    expect(r.success).toBe(true);
    // In-domain the elements are real: the result convention (design §5,
    // applied element by element) hands them back as plain numbers, never as
    // `{re, im: 0}`.
    expect(r.run!(IN as any)).toEqual([2 * Math.SQRT2, 2]);
    const out = r.run!(OUT as any) as unknown as { re: number; im: number }[];
    expect(out[0].re).toBe(0);
    expect(out[0].im).toBeCloseTo(2 * Math.sqrt(0.7), 12);
    expect(out[1].re).toBe(0);
    expect(out[1].im).toBeCloseTo(2 * Math.sqrt(1.7), 12);
  });

  test('the out-of-domain elements come back complex whether the opt-in is on or off', () => {
    const mj = ['Multiply', 2, ['w', 't']];
    for (const complexPromotion of [true, false]) {
      const ce = withFn('w', W);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const r = compile(ce.box(mj as any), { complexPromotion })!;
      warn.mockRestore();
      expect(r.success).toBe(true);
      expect(r.run!(IN as any)).toEqual([2 * Math.SQRT2, 2]);
      const out = r.run!(OUT as any) as unknown as { re: number; im: number }[];
      expect(out[0].im).toBeCloseTo(2 * Math.sqrt(0.7), 12);
      expect(out[1].im).toBeCloseTo(2 * Math.sqrt(1.7), 12);
    }
  });

  test('an unaffected shape lowers identically under the default and under strict', () => {
    // Promotion must not change what an unaffected shape compiles to. The
    // no-radical control below is that shape: its elements never promote, so
    // the default `auto` emits the same real `_SYS.bcast` closure as `strict`.
    // (The comparison used to be ON vs OFF of `complexPromotion`; that option
    // now maps to `mode: 'complex'`, whose single lane lifts wide symbols by
    // design — compile-mode step 4, 2026-08-16.)
    const mj = ['Multiply', 2, ['w', 't']];
    const P = ['List', ['Multiply', 2, 't'], ['Add', 't', 1]];
    const strict = compile(withFn('w', P).box(mj as any), { mode: 'strict' })!;
    expect(compiled(P, mj, false).code).toBe(strict.code);
  });

  test('CONTROL: a collection body with NO radical compiles under both flag states', () => {
    const P = ['List', ['Multiply', 2, 't'], ['Add', 't', 1]];
    const mj = ['Multiply', 2, ['w', 't']];
    for (const complexPromotion of [true, false]) {
      const r = compiled(P, mj, complexPromotion);
      expect(r.success).toBe(true);
      expect(r.run!(IN as any)).toEqual([12, 8]);
    }
  });

  test('CONTROL: a SCALAR radical body compiles under both flag states', () => {
    const Z = ['Sqrt', ['Subtract', 't', 1]];
    const mj = ['Multiply', 2, ['w', 't']];
    expect(compiled(Z, mj, false).success).toBe(true);
    const on = compiled(Z, mj, true);
    expect(on.success).toBe(true);
    expect(on.run!(OUT as any)).toEqual({
      re: 0,
      im: 2 * Math.sqrt(0.7),
    });
  });

  test('CONTROL: the INDEXED read keeps compiling — it was never scalar-over-a-list', () => {
    const mj = ['Multiply', 2, ['At', ['w', 't'], 1]];
    expect(compiled(W, mj, false).success).toBe(true);
    const on = compiled(W, mj, true);
    expect(on.success).toBe(true);
    expect(on.run!(OUT as any)).toEqual({ re: 0, im: 2 * Math.sqrt(0.7) });
  });

  test('an indexed read OF the broadcast result sees the complex elements', () => {
    // The broadcast now produces an array of `{re, im}`, so every enclosing
    // form has to classify it element-wise too. `isComplexValued` answers for
    // the whole `Multiply` — a scalar verdict that describes no element and
    // reads `false` here — so without the element route through the arithmetic
    // head, `(2·w(t))[1] + 1` would add `1` to an object and concatenate.
    const r = compiled(
      W,
      ['Add', ['At', ['Multiply', 2, ['w', 't']], 1], 1],
      true
    );
    expect(r.success).toBe(true);
    const v = r.run!(OUT as any) as unknown as { re: number; im: number };
    expect(v.re).toBe(1);
    expect(v.im).toBeCloseTo(2 * Math.sqrt(0.7), 12);
  });

  test('a broadcast wrapped around a broadcast stays element-wise', () => {
    const r = compiled(W, ['Multiply', 2, ['Add', ['w', 't'], 1]], true);
    expect(r.success).toBe(true);
    const out = r.run!(OUT as any) as unknown as { re: number; im: number }[];
    expect(out.map((e) => e.re)).toEqual([2, 2]);
    expect(out[0].im).toBeCloseTo(2 * Math.sqrt(0.7), 12);
    expect(out[1].im).toBeCloseTo(2 * Math.sqrt(1.7), 12);
  });

  test('a MIXED body still fails closed — one closure cannot fit both elements', () => {
    // `[√(t−1), 1]` promotes only its first element, so the run-time array is
    // `[{re, im}, 1]`. The broadcast wraps ONE scalar closure and maps it over
    // both positions, so neither convention fits: a complex closure reads
    // `.re` off the plain `1`. This is the shape that must keep declining.
    const r = compiled(
      ['List', ['Sqrt', ['Subtract', 't', 1]], 1],
      ['Multiply', 2, ['w', 't']],
      true
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/list-valued operand/);
  });
});
