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

/** The code and preamble of a successful compilation, together. */
function emitted(fn: { code: string; preamble?: string }): string {
  return `${fn.preamble ?? ''}\n${fn.code}`;
}

/** How many `_IA.point(` calls (one per lifted scalar constant) the
 * preamble declares — the count the ledger's instrument reads. */
function liftedPoints(fn: { preamble?: string }): number {
  return (fn.preamble?.match(/_IA\.point\(/g) ?? []).length;
}

describe('a literal list of numbers on interval-js', () => {
  test('is one constant of the table, not one per element', () => {
    const values = Array.from({ length: 200 }, (_, i) => 4 + i / 1024);
    const fn = compile(ce.box(['At', ['List', ...values], 'k']), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('_IA.at(_k1, _.k)');
    expect(fn.preamble).toBe(`const _k1 = _IA.points([${values.join(', ')}]);`);
    expect(liftedPoints(fn)).toBe(0);
    expect(fn.run!({ k: 3 })).toEqual({
      kind: 'interval',
      value: { lo: values[2], hi: values[2] },
    });
    // A wide index hulls the elements it can select.
    expect(fn.run!({ k: { lo: 1, hi: 2 } })).toEqual({
      kind: 'interval',
      value: { lo: values[0], hi: values[1] },
    });
  });

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
    expect(statements[0].startsWith('const _k1 = _IA.points([')).toBe(true);
    expect(statements[1]).toBe('const _k2 = _IA.point(99);');
    expect(liftedPoints(ia)).toBe(1);
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
    expect(fn.preamble).toBe(
      'const _k1 = _IA.points([0.5, 1.5, 2.5, 3.5]);\nconst _k2 = _IA.point(2);'
    );
    expect(fn.code).toBe('_IA.at(_k1, _IA.floor(_IA.scale(_k2, _.x)))');
    expect(fn.run!({ x: 1 })).toEqual({
      kind: 'interval',
      value: { lo: 1.5, hi: 1.5 },
    });
  });

  test('a negative element and exponent spellings are written as the numbers they are', () => {
    const fn = compile(ce.box(['At', ['List', -2, 1e21, 1e-7, 0], 'k']), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.preamble).toBe('const _k1 = _IA.points([-2, 1e+21, 1e-7, 0]);');
    expect(fn.run!({ k: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 1e21, hi: 1e21 },
    });
    expect(fn.run!({ k: -1 })).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 0 },
    });
  });

  test('a list-valued root answers fresh intervals, not numbers', () => {
    const fn = compile(ce.box(['List', 1, 2.5, 3]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('_k1');
    const a = fn.run!({}) as { lo: number; hi: number }[];
    const b = fn.run!({}) as { lo: number; hi: number }[];
    expect(a).toEqual([
      { lo: 1, hi: 1 },
      { lo: 2.5, hi: 2.5 },
      { lo: 3, hi: 3 },
    ]);
    // The constant is shared across calls, so the answer is a copy: a caller
    // who writes to it cannot change what the next call answers.
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    a[0].lo = -100;
    expect((fn.run!({}) as { lo: number }[])[0].lo).toBe(1);
  });

  test('the written-out elements of a literal Range are compact too', () => {
    const fn = compile(ce.box(['At', ['Range', 1, 50], 'k']), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    const numbers = Array.from({ length: 50 }, (_, i) => i + 1);
    expect(fn.preamble).toBe(
      `const _k1 = _IA.points([${numbers.join(', ')}]);`
    );
    expect(fn.run!({ k: 50 })).toEqual({
      kind: 'interval',
      value: { lo: 50, hi: 50 },
    });
  });

  test('the element-wise broadcast and Map read the list as before', () => {
    // The broadcast over a LITERAL list is written out per element, each
    // element a shared scalar constant; the compact spelling is for a list
    // consumed whole.
    const add = compile(ce.box(['Add', ['List', 1, 2, 3], 'x']), {
      to: 'interval-js',
    });
    expect(add.success).toBe(true);
    expect(add.code).toBe(
      '[_IA.add(_.x, _k1), _IA.add(_.x, _k2), _IA.add(_.x, _k3)]'
    );
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

describe('a list that is not all plain number literals', () => {
  test('a literal no double holds keeps the elementwise array and its enclosure', () => {
    const fn = compile(ce.box(['At', ['List', ['Rational', 1, 49], 2], 'k']), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(emitted(fn)).not.toContain('_IA.points(');
    // `1/49` is an enclosure, `2` a point; the array of the two names is
    // bound after them, as before.
    expect(fn.preamble).toMatch(
      /^const _k1 = \{ lo: 0\.0204081632653061\d+, hi: 0\.0204081632653061\d+ \};\nconst _k2 = _IA\.point\(2\);\nconst _k3 = \[_k1, _k2\];$/
    );
    expect(fn.code).toBe('_IA.at(_k3, _.k)');
    const r = fn.run!({ k: 1 }) as { value: { lo: number; hi: number } };
    expect(r.value.lo).toBeLessThan(1 / 49);
    expect(r.value.hi).toBeGreaterThan(1 / 49);
  });

  test('a run-time element keeps the array at the read site', () => {
    const fn = compile(ce.box(['At', ['List', 'x', 2, 3], 'k']), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('_IA.at([_.x, _k1, _k2], _.k)');
  });

  test('a loop index as an element keeps the elementwise array', () => {
    // `[i, 1]` read with a run-time index inside a loop-form sum, so the
    // list is emitted: `_IA.point(i)` over the loop index is not a constant.
    const expr = ce.parse('\\sum_{i=1}^{200} [i, 1]_{k}');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toContain('[_IA.point(i), ');
    expect(emitted(fn)).not.toContain('_IA.points(');
  });

  test('a tuple is a point and keeps its array spelling', () => {
    // Indexed with a run-time `k`, so the tuple is emitted whole.
    const fn = compile(ce.box(['At', ['Tuple', 1, 2], 'k']), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(emitted(fn)).not.toContain('_IA.points(');
    expect(fn.preamble!.endsWith('const _k3 = [_k1, _k2];')).toBe(true);
    expect(fn.code).toBe('_IA.at(_k3, _.k)');
    expect(fn.run!({ k: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
  });
});

describe('the compact spelling under the hoist exceptions', () => {
  test('with a caller-supplied function the list is not hoisted but is still one expression', () => {
    // A caller override turns the constant table off (the override may
    // write to an argument). The list is then built at the read site, on
    // every call, as the elementwise array was — but as one call.
    const fn = compile(ce.box(['At', ['List', 1, 2, 3], 'k']), {
      to: 'interval-js',
      functions: { Gamma: '(x) => x' },
    });
    expect(fn.success).toBe(true);
    expect(fn.preamble).toBeUndefined();
    expect(fn.code).toBe('_IA.at(_IA.points([1, 2, 3]), _.k)');
    expect(fn.run!({ k: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
  });

  test('a caller-spliced call over a name is not bound to the table', () => {
    // A `vars` entry may spell `_IA.points([…])` over a name declared in the
    // caller's own per-call preamble; the table is evaluated outside that
    // preamble, so such a call must stay where the name is in scope.
    const ceL = new ComputeEngine();
    ceL.declare('L', 'list<number>');
    const fn = compile(ceL.box(['At', 'L', 'k']), {
      to: 'interval-js',
      vars: { L: '_IA.points([a, 2])' },
      preamble: 'const a = 1;',
    });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('_IA.at(_IA.points([a, 2]), _.k)');
    expect(fn.preamble).toBe('const a = 1;');
    expect(fn.run!({ k: 1 })).toEqual({
      kind: 'interval',
      value: { lo: 1, hi: 1 },
    });
  });

  test("a caller's own object spelled like the library is not rewritten", () => {
    // `my_IA.points([1, 2])` and `my_IA.point(3)` continue an identifier:
    // they are the caller's object, declared in the per-call preamble, and
    // binding them to the table would leave the runner reading an undefined
    // name.
    const ceL = new ComputeEngine();
    ceL.declare('L', 'list<number>');
    ceL.declare('M', 'list<number>');
    const fn = compile(ceL.box(['Add', ['At', 'L', 'k'], ['At', 'M', 'k']]), {
      to: 'interval-js',
      vars: {
        L: 'my_IA.points([1, 2])',
        M: '[my_IA.point(3), my_IA.point(4)]',
      },
      preamble:
        'const my_IA = { points: (xs) => xs.map(_IA.point), point: _IA.point };',
    });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe(
      '_IA.add(_IA.at(my_IA.points([1, 2]), _.k), _IA.at([my_IA.point(3), my_IA.point(4)], _.k))'
    );
    expect(fn.run!({ k: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 6, hi: 6 },
    });
  });

  test('a user function reading a constant list sees the table', () => {
    const ceF = new ComputeEngine();
    ceF.assign(
      'f',
      ceF.box(['Function', ['At', ['List', 10, 20, 30], 'n'], 'n'])
    );
    const fn = compile(ceF.box(['f', 'k']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(emitted(fn)).toContain('_IA.points([10, 20, 30])');
    expect(fn.run!({ k: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 20, hi: 20 },
    });
  });
});
