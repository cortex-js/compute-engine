/**
 * The `interval-js` spelling of a constant list of numbers.
 *
 * A `List` whose every element is a plain number literal is emitted as ONE
 * call over the array of numbers, `_IA.points([4, 4.5, …])`, and the
 * constant-table pass binds it to one name. Before, every element was a
 * point constant of its own, bound to a name before the array of those names
 * was: a list of N numbers cost N + 1 declarations and some 50 bytes per
 * element, and a 9,540-element list a graphing document inlines compiled to a
 * 508 KB preamble of 9,541 statements (Tycho ledger row 368, filed
 * 2026-10-07 on 0.149.0). The run-time value is unchanged: the same array of
 * degenerate intervals.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

const ce = new ComputeEngine();
// Boxing declares nothing: an input that a test reads as a list element has
// no type unless it is declared.
ce.declare('x', 'real');

/** The code and preamble of a successful compilation, together. */
function emitted(fn: { code: string; preamble?: string }): string {
  return `${fn.preamble ?? ''}\n${fn.code}`;
}

describe('a literal list of numbers on interval-js', () => {
  test('the row 368 shape: the preamble holds no per-element statement and costs about what the javascript target does', () => {
    // The ledger's instrument: `At(L, Floor(99x))` for a literal `L` of
    // 9,540 distinct numbers; READY needs at most 4 lifted scalar constants
    // and at most twice the javascript bytes per element.
    const N = 9540;
    const values = Array.from({ length: N }, (_, i) => 4 + i / 1024);
    const body = ce.box([
      'At',
      ['List', ...values],
      ['Floor', ['Multiply', 99, 'x']],
    ]);
    const ia = compile(body, { to: 'interval-js' });
    const js = compile(body, { to: 'javascript' });
    expect(ia.success).toBe(true);
    expect(js.success).toBe(true);
    const statements = ia.preamble!.split('\n');
    expect(statements).toHaveLength(2);
    const iaBytes = emitted(ia).length;
    const jsBytes = emitted(js).length;
    expect(iaBytes / N).toBeLessThanOrEqual((2 * jsBytes) / N);
    expect(ia.run!({ x: 0.5 })).toEqual({
      kind: 'interval',
      value: { lo: values[48], hi: values[48] },
    });
  });

  test('a list held as a symbol value takes the same spelling', () => {
    const ceT = new ComputeEngine();
    ceT.assign('T', ceT.box(['List', 0.5, 1.5, 2.5, 3.5]));
    const fn = compile(ceT.box(['At', 'T', ['Floor', ['Multiply', 2, 'x']]]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.run!({ x: 1 })).toEqual({
      kind: 'interval',
      value: { lo: 1.5, hi: 1.5 },
    });
  });

  test('a list-valued root answers fresh intervals, not numbers', () => {
    const fn = compile(ce.box(['List', 1, 2.5, 3]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    type Point = { kind: 'interval'; value: { lo: number; hi: number } };
    const a = fn.run!({}) as Point[];
    const b = fn.run!({}) as Point[];
    expect(a).toEqual([
      { kind: 'interval', value: { lo: 1, hi: 1 } },
      { kind: 'interval', value: { lo: 2.5, hi: 2.5 } },
      { kind: 'interval', value: { lo: 3, hi: 3 } },
    ]);
    // The constant is shared across calls, so the answer is a copy: a caller
    // who writes to it cannot change what the next call answers.
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    a[0].value.lo = -100;
    expect((fn.run!({}) as Point[])[0].value.lo).toBe(1);
  });

  test('the element-wise broadcast and Map read the list as before', () => {
    // The broadcast over a LITERAL list is written out per element, each
    // element a shared scalar constant; the compact spelling is for a list
    // consumed whole.
    const add = compile(ce.box(['Add', ['List', 1, 2, 3], 'x']), {
      to: 'interval-js',
    });
    expect(add.success).toBe(true);
    expect(add.run!({ x: 10 })).toEqual([
      { kind: 'interval', value: { lo: 11, hi: 11 } },
      { kind: 'interval', value: { lo: 12, hi: 12 } },
      { kind: 'interval', value: { lo: 13, hi: 13 } },
    ]);
    // A `Map` over a literal list is written out per element at compile
    // time (a closed body folds, an open one is unrolled); the value is
    // unchanged.
    const map = compile(
      ce.box([
        'Map',
        ['Function', ['Multiply', 'x', 'u'], 'u'],
        ['List', 1, 2, 3],
      ]),
      { to: 'interval-js' }
    );
    expect(map.success).toBe(true);
    const mapped = map.run!({ x: 2 }) as {
      value?: { lo: number; hi: number };
    }[];
    expect(mapped.map((r) => r.value ?? r)).toEqual([
      { lo: 2, hi: 2 },
      { lo: 4, hi: 4 },
      { lo: 6, hi: 6 },
    ]);
  });
});

describe('a literal list read with an integer index (values)', () => {
  const ceK = new ComputeEngine();
  ceK.declare('k', 'integer');
  const at = (list: unknown[]) =>
    compile(ceK.box(['At', list, 'k'] as never), { to: 'interval-js' }) as {
      success: boolean;
      code: string;
      preamble?: string;
      run: (vars: unknown) => unknown;
    };
  const point = (v: number) => ({ kind: 'interval', value: { lo: v, hi: v } });

  test('is one constant of the table, not one per element', () => {
    const values = Array.from({ length: 200 }, (_, i) => 4 + i / 1024);
    const fn = at(['List', ...values]);
    expect(fn.success).toBe(true);
    expect(emitted(fn)).toContain('_IA.points(');
    expect(fn.run({ k: 3 })).toEqual(point(values[2]));
    expect(fn.run({ k: 200 })).toEqual(point(values[199]));
    // A wide index hulls the elements it can select.
    expect(fn.run({ k: { lo: 1, hi: 2 } })).toEqual({
      kind: 'interval',
      value: { lo: values[0], hi: values[1] },
    });
  });

  test('a negative element and exponent spellings are the numbers they are', () => {
    const fn = at(['List', -2, 1e21, 1e-7, 0, -0]);
    expect(fn.success).toBe(true);
    expect(emitted(fn)).toContain('_IA.points(');
    expect(fn.run({ k: 1 })).toEqual(point(-2));
    expect(fn.run({ k: 2 })).toEqual(point(1e21));
    expect(fn.run({ k: 3 })).toEqual(point(1e-7));
    expect(fn.run({ k: 4 })).toEqual(point(0));
    // The boxed list holds `0` for `-0` (`_IA.points([…, 0, 0])`): the sign
    // of a zero is not part of the contract, since the intervals `[-0, -0]`
    // and `[0, 0]` are the same set.
    expect(fn.run({ k: 5 })).toEqual(point(0));
    expect(fn.run({ k: -1 })).toEqual(fn.run({ k: 5 }));
  });

  test('the written-out elements of a literal Range are compact too', () => {
    const fn = at(['Range', 1, 50]);
    expect(fn.success).toBe(true);
    expect(fn.run({ k: 50 })).toEqual(point(50));
    expect(fn.run({ k: 7 })).toEqual(point(7));
  });

  test('a list with an element that is not a point is not one table', () => {
    // `π` and `1/3` have no double: each is an enclosure of its own, and
    // the list is not `_IA.points` of numbers.
    for (const [list, value] of [
      [['List', 'Pi', 2], Math.PI],
      [['List', ['Rational', 1, 3], 2], 1 / 3],
    ] as const) {
      const fn = at(list as unknown as unknown[]);
      expect(fn.success).toBe(true);
      expect(emitted(fn)).not.toContain('_IA.points(');
      const first = fn.run({ k: 1 }) as { value: { lo: number; hi: number } };
      expect(first.value.lo).toBeLessThanOrEqual(value);
      expect(first.value.hi).toBeGreaterThanOrEqual(value);
      expect(first.value.lo).toBeLessThan(first.value.hi);
      expect(fn.run({ k: 2 })).toEqual(point(2));
    }
  });
});

describe('the compact spelling under the hoist exceptions', () => {
  test('a user function reading a constant list sees the table', () => {
    const ceF = new ComputeEngine();
    ceF.declare('k', 'real');
    ceF.assign(
      'f',
      ceF.box(['Function', ['At', ['List', 10, 20, 30], 'n'], 'n'])
    );
    const fn = compile(ceF.box(['f', 'k']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.run!({ k: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 20, hi: 20 },
    });
  });
});
