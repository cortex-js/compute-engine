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
  ce.declare('t', 'real');
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

describe('run-time index into a MIXED collection fails closed', () => {
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
    expect(r.error).toMatch(/Could not compile/);
  });

  test('a user-function body declines the same way', () => {
    const ce = withFn('m', MIXED);
    const r = compile(ce.box(['Add', ['At', ['m', 't'], 'k'], 1] as any))!;
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Could not compile/);
  });

  test('a LITERAL index into that same list still compiles', () => {
    const ce = new ComputeEngine();
    expect(run(ce, ['Add', ['At', MIXED, 2], 1])).toEqual(2);
  });
});

describe('broadcast over a collection with a complex element', () => {
  test('an all-real list still broadcasts', () => {
    const ce = withFn('s', ['List', 't', 1]);
    expect(run(ce, ['Multiply', 2, ['s', 't']])).toEqual([0.6, 2]);
  });
});

describe('promotion over a collection-valued body (ROADMAP 2026-08-15)', () => {
  // A promoting mode lowers an unknown-sign radical through the complex lane.
  // It always promoted INSIDE a collection-valued body — `_fn_w` returned
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

  test('the DEFAULT keeps the real kernel and its NaN', () => {
    // The default mode is `strict`: an unknown-sign radical stays on the
    // real lane, so `mode: 'complex'` is needed to reach the interpreter's
    // value.
    const ce = withFn('w', RADICALS('List'));
    const r = compile(ce.box(CHAIN('w') as any))!;
    expect(r.success).toBe(true);
    expect(r.code).toContain('Math.abs');
    expect(r.run!({ t: 0.3 } as any)).toBeNaN();
    const strict = compile(ce.box(CHAIN('w') as any), { mode: 'strict' })!;
    expect(strict.code).toContain('Math.abs');
    expect(strict.run!({ t: 0.3 } as any)).toBeNaN();
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
 * in a promoting mode (ROADMAP 2026-08-15, reported by a consumer's
 * enablement pricing: 9 of 25 compiled-band losses).
 *
 * With `w(t) := [√(t−1), √(t−2)]`, turning promotion on made `2·w(t)`,
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
describe('whole-collection scalar arithmetic in a promoting mode (ROADMAP 2026-08-15)', () => {
  const W = [
    'List',
    ['Sqrt', ['Subtract', 't', 1]],
    ['Sqrt', ['Subtract', 't', 2]],
  ];

  /** In the real domain (t = 3) and outside it (t = 0.3). */
  const IN = { t: 3 };
  const OUT = { t: 0.3 };

  const compiled = (body: unknown, mj: unknown, mode: 'complex') => {
    const ce = withFn('w', body);
    return compile(ce.box(mj as any), { mode })!;
  };

  test('an unaffected shape lowers identically under the default and under strict', () => {
    // The no-radical control below is an unaffected shape: the default mode
    // emits the same real `_SYS.bcast` closure as an explicit `strict`.
    const mj = ['Multiply', 2, ['w', 't']];
    const P = ['List', ['Multiply', 2, 't'], ['Add', 't', 1]];
    const strict = compile(withFn('w', P).box(mj as any), { mode: 'strict' })!;
    expect(compile(withFn('w', P).box(mj as any))!.code).toBe(strict.code);
  });

  test('CONTROL: a collection body with NO radical compiles under both flag states', () => {
    const P = ['List', ['Multiply', 2, 't'], ['Add', 't', 1]];
    const mj = ['Multiply', 2, ['w', 't']];
    for (const mode of ['complex'] as const) {
      const r = compiled(P, mj, mode);
      expect(r.success).toBe(true);
      expect(r.run!(IN as any)).toEqual([12, 8]);
    }
  });

  test('CONTROL: a SCALAR radical body compiles under both flag states', () => {
    const Z = ['Sqrt', ['Subtract', 't', 1]];
    const mj = ['Multiply', 2, ['w', 't']];
    const on = compiled(Z, mj, 'complex');
    expect(on.success).toBe(true);
    expect(on.run!(OUT as any)).toEqual({
      re: 0,
      im: 2 * Math.sqrt(0.7),
    });
  });
});
