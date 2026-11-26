import { ComputeEngine, compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// Two flat lists that an operation reads at each index must have one
// length: the interpreter's value of two lengths is the error
// `incompatible-dimensions`. Where the compiler does not prove the lengths
// equal (one value, or equal constants), the JavaScript code compares them
// once at run time, before the loops of the operation, and throws a
// `RangeError` where they differ (`agree()` of `lower-lists.ts`): an
// element-wise operation, a user function mapped over lists, and `Dot`. A
// check of two lengths proves them equal for the later operations of its
// scope. Each value must equal the interpreter's.

type Json = unknown;

const ce = new ComputeEngine();
ce.declare('L', 'list<real>');
ce.declare('M', 'list<real>');
ce.declare('N', 'list<real>');
ce.declare('K', 'list<real>');
ce.declare('n', 'integer');
ce.declare('x', 'real');
ce.declare('S', 'list<real^3>');
ce.declare('h', '(real, real) -> real');
ce.assign(
  'h',
  ce.box(['Function', ['Add', 'x', ['Multiply', 2, 'y']], 'x', 'y'])
);

const box = (json: Json): Expression => ce.box(json as never);

type Point = { L: number[]; M: number[]; N: number[] };

// Equal lengths, and each pair of the three lists of two lengths.
const POINTS: Point[] = [
  { L: [1, 2], M: [3, 4], N: [5, 6] },
  { L: [1.5, -2, 4], M: [0.5, 3, 2], N: [1, 1, 1] },
  { L: [], M: [], N: [] },
  { L: [1, 2], M: [1, 2, 3], N: [4, 5] },
  { L: [1, 2, 3], M: [1, 2], N: [4, 5, 6] },
  { L: [1, 2], M: [3, 4], N: [5, 6, 7] },
  { L: [1, 2, 3], M: [1, 2, 3], N: [1] },
];

/** The interpreter's value: a collection is an array (a `Map` is lazy). */
function read(e: Expression): unknown {
  if (e.symbol === 'True' || e.symbol === 'False') return e.symbol === 'True';
  if (e.isCollection) return [...e.each()].map(read);
  return e.N().re;
}

/** The interpreter's value of `json` at `p`, or `'error'` (also for an
 *  unevaluated form that holds an error: `Sum` of an error). */
function interpreted(json: Json, p: Point): unknown {
  const values = Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, box(['List', ...v])])
  );
  return ce.withValues(values as never, () => {
    const r = box(json).evaluate();
    if (
      r.operator === 'Error' ||
      !(
        r.isCollection ||
        r.isNumberLiteral ||
        r.symbol === 'True' ||
        r.symbol === 'False'
      )
    )
      return 'error';
    return read(r);
  });
}

/** The interpreter's value of `json` at the values `p` (a list is a list
 *  of numbers, another value a number), or `'error'`, as `interpreted()`;
 *  a list with an error as an element is `'error'` too. */
function interpretedAt(json: Json, p: Record<string, unknown>): unknown {
  const values = Object.fromEntries(
    Object.entries(p).map(([k, v]) => [
      k,
      Array.isArray(v) ? box(['List', ...v]) : ce.number(v as number),
    ])
  );
  return ce.withValues(values as never, () => {
    const r = box(json).evaluate();
    if (
      r.operator === 'Error' ||
      !(r.isCollection || r.isNumberLiteral) ||
      (r.isCollection && [...r.each()].some((x) => x.operator === 'Error'))
    )
      return 'error';
    return read(r);
  });
}

/** `v` and `w` have one shape and agree within 1e-12. */
function agree(v: unknown, w: unknown): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, i) => agree(v[i], x))
    );
  if (typeof w === 'boolean') return v === w;
  return (
    typeof v === 'number' &&
    typeof w === 'number' &&
    (Math.abs(v - w) <= 1e-12 * Math.max(1, Math.abs(w)) ||
      (Number.isNaN(v) && Number.isNaN(w)))
  );
}

/** `json` compiles, and its value at each point is the interpreter's, or a
 *  `RangeError` of `incompatible-dimensions` where the interpreter gives an
 *  error. */
function check(json: Json) {
  const r = compile(box(json), { fallback: false });
  expect(r.success).toBe(true);
  let errors = 0;
  for (const p of POINTS) {
    const want = interpreted(json, p);
    const run = () => r.run!(p as never);
    if (want === 'error') {
      expect(run).toThrow(
        /^incompatible-dimensions: lists of lengths \d+ and \d+$/
      );
      expect(run).toThrow(RangeError);
      errors += 1;
      continue;
    }
    const got = run();
    if (!agree(got, want))
      throw new Error(
        `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
      );
  }
  return { code: r.code, errors };
}

/** The message of the decline of `json`. */
function declines(json: Json, options: object = {}): string {
  try {
    const r = compile(box(json), { ...options, fallback: false } as never);
    return r.success ? '' : (r.diagnostic?.message ?? '');
  } catch (x) {
    return (
      (x as { diagnostic?: { message: string } }).diagnostic?.message ??
      (x as Error).message
    );
  }
}

/** The number of checks in `code`, each a statement of the body of the
 *  program, outside every loop (an indentation of two spaces). */
function checks(code: string): number {
  const all = code.match(/_agree\(/g)?.length ?? 0;
  const top = code.match(/\n {2}const v\d+ = _agree\(/g)?.length ?? 0;
  expect(top).toBe(all);
  return all;
}

const sub = (a: Json, c: Json) => ['Subtract', a, c];
const F = (body: Json, ...params: Json[]) => ['Function', body, ...params];

describe('lists of two run-time lengths: one check', () => {
  test.each([
    ['L + M', ['Add', 'L', 'M']],
    ['L − M', sub('L', 'M')],
    ['L · M', ['Multiply', 'L', 'M']],
    ['L / M', ['Divide', 'L', 'M']],
    ['L ^ M', ['Power', 'L', 'M']],
    ['L < M', ['Less', 'L', 'M']],
    ['Arctan2(L, M)', ['Arctan2', 'L', 'M']],
    ['L + [1, 2, 3]', ['Add', 'L', ['List', 1, 2, 3]]],
    ['[1, 2] · L', ['Multiply', ['List', 1, 2], 'L']],
    ['Sum((L − M)^2)', ['Sum', ['Power', sub('L', 'M'), 2]]],
    ['Mean(L · M)', ['Mean', ['Multiply', 'L', 'M']]],
    ['Dot(L, M)', ['Dot', 'L', 'M']],
    ['Dot(L, [1, 2, 3])', ['Dot', 'L', ['List', 1, 2, 3]]],
    ['h(L, M)', ['h', 'L', 'M']],
    ['h(L, [1, 2, 3])', ['h', 'L', ['List', 1, 2, 3]]],
    ['At(L + M, 1)', ['At', ['Add', 'L', 'M'], 1]],
    ['Length(L + M)', ['Length', ['Add', 'L', 'M']]],
    // One check for the pair, read again by the later operations.
    ['(L + M) · (L − M)', ['Multiply', ['Add', 'L', 'M'], sub('L', 'M')]],
    ['L · M + L', ['Add', ['Multiply', 'L', 'M'], 'L']],
    [
      'Dot(L, M) + Sum(L · M)',
      ['Add', ['Dot', 'L', 'M'], ['Sum', ['Multiply', 'L', 'M']]],
    ],
    ['h(L, M) + L · M', ['Add', ['h', 'L', 'M'], ['Multiply', 'L', 'M']]],
    ['And(L > 0, M > 0)', ['And', ['Greater', 'L', 0], ['Greater', 'M', 0]]],
    // An operand that is an element-wise operation is read element by
    // element in the build.
    [
      '(L + 1) · (M − 2) + M / 2',
      ['Add', ['Multiply', ['Add', 'L', 1], sub('M', 2)], ['Divide', 'M', 2]],
    ],
  ])('%s', (_, json) => {
    const { code, errors } = check(json);
    expect(errors).toBeGreaterThan(0);
    expect(checks(code)).toBe(1);
  });

  // One check per pair of lengths.
  test.each([
    ['L + M + N', ['Add', 'L', 'M', 'N']],
    ['h(L, M) + N', ['Add', ['h', 'L', 'M'], 'N']],
  ])('%s: two checks', (_, json) => {
    const { code, errors } = check(json);
    expect(errors).toBeGreaterThan(0);
    expect(checks(code)).toBe(2);
  });

  // A check of a length that an earlier check proved equal to another
  // reads that check too: the operation that relies on both equalities
  // keeps both checks (the result reads the later one only).
  test.each([
    [
      '(L + M) · (M − N)',
      ['Multiply', ['Add', 'L', 'M'], sub('M', 'N')],
      { L: [1, 2, 3], M: [3, 4], N: [1, 1] },
    ],
    [
      'Sum((L + M) · (M − N))',
      ['Sum', ['Multiply', ['Add', 'L', 'M'], sub('M', 'N')]],
      { L: [1, 2, 3], M: [3, 4], N: [1, 1] },
    ],
    [
      '(L + M) · (L + N)',
      ['Multiply', ['Add', 'L', 'M'], ['Add', 'L', 'N']],
      { L: [1, 2], M: [1, 2, 3], N: [4, 5] },
    ],
    [
      'L · M + L · N',
      ['Add', ['Multiply', 'L', 'M'], ['Multiply', 'L', 'N']],
      { L: [1, 2], M: [1, 2, 3], N: [4, 5] },
    ],
    [
      '(L + M) · (N + K)',
      ['Multiply', ['Add', 'L', 'M'], ['Add', 'N', 'K']],
      { L: [1, 2], M: [3, 4], N: [5, 6], K: [1, 2, 3] },
    ],
  ])('%s: every check that the result relies on', (_, json, p) => {
    const r = compile(box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(interpretedAt(json, p)).toBe('error');
    expect(() => r.run!(p as never)).toThrow(
      /^incompatible-dimensions: lists of lengths \d+ and \d+$/
    );
    // Each list in turn of another length, and all of one length.
    const names = Object.keys(p);
    const equal = Object.fromEntries(names.map((k) => [k, [1, -2]]));
    expect(agree(r.run!(equal as never), interpretedAt(json, equal))).toBe(
      true
    );
    for (const k of names) {
      const q = { ...equal, [k]: [1, 2, 3] };
      expect(() => r.run!(q as never)).toThrow(RangeError);
    }
    expect(checks(r.code)).toBe(names.length - 1);
  });

  test('the message', () => {
    const r = compile(box(['Add', 'L', 'M']), { fallback: false });
    expect(() => r.run!({ L: [1, 2], M: [1, 2, 3] } as never)).toThrow(
      new RangeError('incompatible-dimensions: lists of lengths 2 and 3')
    );
  });

  test('one loop for an operation of element-wise operations', () => {
    const { code } = check([
      'Add',
      ['Multiply', ['Add', 'L', 1], sub('M', 2)],
      ['Divide', 'M', 2],
    ]);
    expect(code.match(/new Array\(/g)).toHaveLength(1);
  });

  // The check moves out of a loop that can run no pass under the guard
  // that the loop runs one, and the sum that reads it moves after it: over
  // no pass the interpreter's value has no error, whatever `M` is.
  test.each([
    [
      'Sum(i · Dot(L, M), i, 1, n)',
      ['Sum', ['Multiply', 'i', ['Dot', 'L', 'M']], ['Tuple', 'i', 1, 'n']],
      { n: 0 },
      { n: 2 },
    ],
    [
      'Sum(i · Sum(L · M), i, 1, n)',
      [
        'Sum',
        ['Multiply', 'i', ['Sum', ['Multiply', 'L', 'M']]],
        ['Tuple', 'i', 1, 'n'],
      ],
      { n: 0 },
      { n: 2 },
    ],
    [
      'Map(x ↦ x · Dot(L, M), L)',
      ['Map', F(['Multiply', 'x', ['Dot', 'L', 'M']], 'x'), 'L'],
      { L: [] },
      {},
    ],
  ])(
    '%s: the check and the sum move out of the loop',
    (_, json, none, some) => {
      const r = compile(box(json), { fallback: false });
      expect(r.success).toBe(true);
      expect(r.code.match(/_agree\(/g)).toHaveLength(1);
      expect(r.code).toMatch(/if \(\(1 <= /);
      // The loop of the sum, before the outer loop.
      const outer = r.code.search(
        /Math\.floor\(_\.n - |new Array\(_\.L\.length\)|v\d+_n = _\.L\.length;/
      );
      expect(r.code.indexOf('_.M[')).toBeLessThan(outer);
      const at = (p: object) => ({ L: [1, 2], M: [3, 4, 5], ...p });
      expect(r.run!(at(none) as never)).toEqual(interpretedAt(json, at(none)));
      expect(() => r.run!(at(some) as never)).toThrow(RangeError);
      expect(r.run!({ ...at(some), M: [3, 4] } as never)).toEqual(
        interpretedAt(json, { ...at(some), M: [3, 4] })
      );
    }
  );

  test('the check is a statement before the loop of the operation', () => {
    const { code } = check(['Sum', ['Power', sub('L', 'M'), 2]]);
    const at = code.indexOf('_agree(');
    expect(code.slice(at).match(/for \(/g)).not.toBeNull();
    expect(code).toMatch(
      /\n {2}const (v\d+) = _agree\(_\.L\.length, _\.M\.length\);\n {2}const (v\d+) = \(_\.L\.length \+ \1\);/
    );
  });
});

describe('lengths that the compiler proves equal: no check', () => {
  test.each([
    ['L + L', ['Add', 'L', 'L']],
    ['2L + 1', ['Add', ['Multiply', 2, 'L'], 1]],
    ['Sum(L · L)', ['Sum', ['Multiply', 'L', 'L']]],
    ['Dot(L, L)', ['Dot', 'L', 'L']],
    ['h(L, L)', ['h', 'L', 'L']],
    ['h(L, 2)', ['h', 'L', 2]],
    ['[1, 2] + [3, 4]', ['Add', ['List', 1, 2], ['List', 3, 4]]],
    [
      'L + Map(x ↦ 2x, L)',
      ['Add', 'L', ['Map', F(['Multiply', 2, 'x'], 'x'), 'L']],
    ],
    // `Map` of two lists is over the shorter one, as the interpreter's.
    [
      'Map((x, y) ↦ x + y, L, M)',
      ['Map', F(['Add', 'x', 'y'], 'x', 'y'), 'L', 'M'],
    ],
  ])('%s', (_, json) => {
    const { code, errors } = check(json);
    expect(errors).toBe(0);
    expect(code).not.toMatch(/_agree/);
  });
});

describe('two stated lengths that differ decline', () => {
  test.each([
    [
      '[1, 2] + [1, 2, 3]',
      ['Add', ['List', 1, 2], ['List', 1, 2, 3]],
      /lists of different lengths or ranks|incompatible/,
    ],
    [
      'Dot([1, 2], [1, 2, 3])',
      ['Dot', ['List', 1, 2], ['List', 1, 2, 3]],
      /Dot of vectors of two lengths|incompatible/,
    ],
    [
      'h([1, 2], [1, 2, 3])',
      ['h', ['List', 1, 2], ['List', 1, 2, 3]],
      /list arguments of h whose lengths are not one value/,
    ],
  ])('%s', (_, json, cause) => {
    expect(declines(json)).toMatch(cause);
  });

  test('a length proved equal to a constant is that constant', () => {
    expect(
      declines(['Add', ['Multiply', ['List', 1, 2, 3], 'L'], ['List', 4, 5]])
    ).toMatch(/lists of different lengths or ranks/);
  });
});

describe('a selection at each position whose arm compares two lengths', () => {
  // The check of an arm is made once, before the selection: it throws also
  // where no position selects the arm, where the interpreter has a value
  // (`docs/COMPILATION-MODEL.md`, the known limitations).
  test.each([
    [
      'If(L > 0, L · M, 0)',
      ['If', ['Greater', 'L', 0], ['Multiply', 'L', 'M'], 0],
    ],
    [
      'Sum(If(L > 0, L · M, 0))',
      ['Sum', ['If', ['Greater', 'L', 0], ['Multiply', 'L', 'M'], 0]],
    ],
    [
      'Which(L > 0, L · M, True, 0)',
      ['Which', ['Greater', 'L', 0], ['Multiply', 'L', 'M'], 'True', 0],
    ],
  ])('%s', (_, json) => {
    const r = compile(box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(checks(r.code)).toBe(1);
    for (const p of [
      { L: [1, -2], M: [3, 4] },
      { L: [1.5, -2, 4], M: [0.5, 3, 2] },
      { L: [], M: [] },
    ])
      expect(r.run!(p as never)).toEqual(interpretedAt(json, p));
    // A position selects the arm: the interpreter's value is an error.
    const selected = { L: [1, -2], M: [3, 4, 5] };
    expect(interpretedAt(json, selected)).toBe('error');
    expect(() => r.run!(selected as never)).toThrow(RangeError);
    // No position selects it.
    const none = { L: [-1, -2], M: [3, 4, 5] };
    expect(interpretedAt(json, none)).not.toBe('error');
    expect(() => r.run!(none as never)).toThrow(RangeError);
  });

  // An arm that compares the lengths of its lists, of another length than
  // the mask: the mask's length is compared with the arm's too, before the
  // selection, and the result reads both checks.
  test.each([
    [
      'If(N > 0, L · M, 0)',
      ['If', ['Greater', 'N', 0], ['Multiply', 'L', 'M'], 0],
      ['L', 'M', 'N'],
    ],
    [
      'Which(N > 0, L · M, True, 0)',
      ['Which', ['Greater', 'N', 0], ['Multiply', 'L', 'M'], 'True', 0],
      ['L', 'M', 'N'],
    ],
    [
      'Sum(If(N > 0, L · M, 0))',
      ['Sum', ['If', ['Greater', 'N', 0], ['Multiply', 'L', 'M'], 0]],
      ['L', 'M', 'N'],
    ],
    [
      'If(L > 0, L + [1, 2, 3], 0)',
      ['If', ['Greater', 'L', 0], ['Add', 'L', ['List', 1, 2, 3]], 0],
      ['L'],
    ],
  ])('%s: a mask of another list', (_, json, names) => {
    const r = compile(box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(checks(r.code)).toBe(names.length === 1 ? 1 : 2);
    const n = names.length === 1 ? 3 : 2;
    for (const values of [
      [1, -2, 4],
      [-1.5, 2, 0.5],
    ]) {
      const equal = Object.fromEntries(
        names.map((k) => [k, values.slice(0, n)])
      );
      expect(agree(r.run!(equal as never), interpretedAt(json, equal))).toBe(
        true
      );
      // Each list in turn of another length, every position selected.
      for (const k of names) {
        const all = Object.fromEntries(
          names.map((m) => [m, [1, 2, 3, 4].slice(0, n)])
        );
        const q = { ...all, [k]: [1, 2, 3, 4, 5].slice(0, n === 2 ? 3 : 2) };
        expect(interpretedAt(json, q)).toBe('error');
        expect(() => r.run!(q as never)).toThrow(
          /^incompatible-dimensions: lists of lengths \d+ and \d+$/
        );
      }
    }
  });

  test('a mask and an arm of two stated lengths decline', () => {
    expect(
      declines([
        'If',
        ['Greater', ['List', 1, -1], 0],
        ['Add', 'L', ['List', 1, 2, 3]],
        0,
      ])
    ).toMatch(/lists of two lengths in a selection at each position/);
  });
});

// A list arm, or a later list condition, whose length is not proved equal
// to the mask's: the two lengths are compared once, before the selection.
// The interpreter gives `incompatible-dimensions` for a later list
// condition that it evaluates, and for an arm of another length where a
// position selects it.
describe('a selection at each position of a list of another length', () => {
  const G = ['Greater', 'N', 0];
  // prettier-ignore
  const PROGRAMS: [string, Json, string[], number][] = [
    ['If(N > 0, L, 0)', ['If', G, 'L', 0], ['L', 'N'], 1],
    ['If(N > 0, L, M)', ['If', G, 'L', 'M'], ['L', 'M', 'N'], 2],
    ['If(N > 0, 2L, 0)', ['If', G, ['Multiply', 2, 'L'], 0], ['L', 'N'], 1],
    ['Which(N > 0, L, True, 0)', ['Which', G, 'L', 'True', 0], ['L', 'N'], 1],
    ['If(N > 0, L, 0) + 1', ['Add', ['If', G, 'L', 0], 1], ['L', 'N'], 1],
    ['Sum(If(N > 0, L, 0))', ['Sum', ['If', G, 'L', 0]], ['L', 'N'], 1],
    ['Length(If(N > 0, L, 0))', ['Length', ['If', G, 'L', 0]], ['L', 'N'], 1],
    // Two selections of one mask and one arm: one check.
    ['If(N > 0, L, 0) + If(N > 0, L, 1)', ['Add', ['If', G, 'L', 0], ['If', G, 'L', 1]], ['L', 'N'], 1],
    // A later condition of another length.
    ['Which(N > 0, 1, L > 0, 2, True, 0)', ['Which', G, 1, ['Greater', 'L', 0], 2, 'True', 0], ['L', 'N'], 1],
    ['Which(N > 0, 1, L > 0, L, True, 0)', ['Which', G, 1, ['Greater', 'L', 0], 'L', 'True', 0], ['L', 'N'], 1],
  ];

  test.each(PROGRAMS)('%s', (_, json, names, count) => {
    const r = compile(box(json), { fallback: false });
    expect(r.success).toBe(true);
    expect(checks(r.code)).toBe(count);
    for (const values of [[1, -2, 4], [-1.5, 2, 0.5], [3, 3], []]) {
      const equal = Object.fromEntries(names.map((k) => [k, values]));
      const want = interpretedAt(json, equal);
      expect(want).not.toBe('error');
      expect(agree(r.run!(equal as never), want)).toBe(true);
    }
    // Each list in turn longer and shorter, a position selecting each arm
    // (the mask `[1, −1]` with two arms, the arm at every position with
    // one).
    const mask = names.includes('M') ? [1, -1] : [1, 2];
    for (const k of names)
      for (const other of [[1, 2, 3], [1]]) {
        const q = {
          ...Object.fromEntries(names.map((m) => [m, [1, 2]])),
          N: mask,
          [k]: other,
        };
        expect(interpretedAt(json, q)).toBe('error');
        expect(() => r.run!(q as never)).toThrow(
          /^incompatible-dimensions: lists of lengths \d+ and \d+$/
        );
      }
  });

  // A mask of a stated length and an arm of a run-time length, and the
  // reverse.
  test.each([
    ['If(N > 0, S, 0)', ['If', G, 'S', 0], 'N'],
    ['If(S > 0, L, 0)', ['If', ['Greater', 'S', 0], 'L', 0], 'L'],
  ])('%s: a stated length', (_, json, name) => {
    const r = compile(box(json), { fallback: false });
    expect(checks(r.code)).toBe(1);
    const S = [1, 2, 3];
    const equal = { S, [name]: [2, -1, 4] };
    expect(r.run!(equal as never)).toEqual(interpretedAt(json, equal));
    const q = { S, [name]: [1, 2] };
    expect(interpretedAt(json, q)).toBe('error');
    expect(() => r.run!(q as never)).toThrow(
      /^incompatible-dimensions: lists of lengths (2 and 3|3 and 2)$/
    );
  });

  test('the code of If(N > 0, L, 0)', () => {
    const { code } = compile(box(['If', G, 'L', 0]), { fallback: false });
    expect(code).toMatch(
      /\n {2}const (v\d+) = _agree\(_\.N\.length, _\.L\.length\);\n {2}const (v\d+)_n = \(_\.N\.length \+ \1\);/
    );
  });

  // The check moves out of a loop that can run no pass, under the guard
  // that it runs one.
  test('Sum(i · Sum(If(N > 0, L, 0)), i, 1, n)', () => {
    const json = [
      'Sum',
      ['Multiply', 'i', ['Sum', ['If', G, 'L', 0]]],
      ['Tuple', 'i', 1, 'n'],
    ];
    const r = compile(box(json), { fallback: false });
    const p = { N: [1, -1, 1], L: [1, 2] };
    expect(r.run!({ ...p, n: 0 } as never)).toBe(0);
    expect(interpretedAt(json, { ...p, n: 0 })).toBe(0);
    expect(() => r.run!({ ...p, n: 2 } as never)).toThrow(RangeError);
  });

  // The check is made once before the selection: it throws also where no
  // position selects the arm, and where a scalar condition that holds comes
  // before a later list condition, where the interpreter has a value
  // (`docs/COMPILATION-MODEL.md`, the known limitations).
  test.each([
    ['If(N > 0, L, 0)', ['If', G, 'L', 0], { N: [-1, -2, -3], L: [1, 2] }],
    ['If(N > 0, L, 0) of an empty mask', ['If', G, 'L', 0], { N: [], L: [1] }],
    ['If(N > 0, L, M)', ['If', G, 'L', 'M'], { N: [1, 1], L: [1, 2], M: [3] }],
    [
      'Which(N > 0, 1, x > 0, 2, L > 0, 3, True, 0)',
      ['Which', G, 1, ['Greater', 'x', 0], 2, ['Greater', 'L', 0], 3, 'True', 0],
      { N: [1, -1, 1], L: [1, 2], x: 1 },
    ],
  ])('%s: no position selects the list', (_, json, p) => {
    const r = compile(box(json), { fallback: false });
    expect(interpretedAt(json, p)).not.toBe('error');
    expect(() => r.run!(p as never)).toThrow(RangeError);
  });

  // An `If` with no else zips the mask with its arm, to the shorter
  // length, as the interpreter: no check.
  test('If(N > 0, L): a restriction', () => {
    const json = ['If', G, 'L'];
    const r = compile(box(json), { fallback: false });
    expect(r.code).not.toMatch(/_agree/);
    for (const p of [
      { N: [1, -1, 1], L: [1, 2] },
      { N: [1, -1], L: [1, 2, 3] },
    ])
      expect(agree(r.run!(p as never), interpretedAt(json, p))).toBe(true);
  });

  // Lengths that the compiler proves equal: no check.
  test.each([
    ['If(L > 0, L, 0)', ['If', ['Greater', 'L', 0], 'L', 0]],
    ['If(L > 0, 2L, L)', ['If', ['Greater', 'L', 0], ['Multiply', 2, 'L'], 'L']],
    ['If(S > 0, S, 0)', ['If', ['Greater', 'S', 0], 'S', 0]],
  ])('%s: no check', (_, json) => {
    const r = compile(box(json), { fallback: false });
    expect(r.code).not.toMatch(/_agree/);
  });

  test('two stated lengths decline', () => {
    expect(
      declines(['If', ['Greater', ['List', 1, -1], 0], ['List', 1, 2, 3], 0])
    ).toMatch(/incompatible-dimensions/);
  });

  test('interval-js and glsl decline the selection', () => {
    expect(declines(['If', G, 'L', 0], { to: 'interval-js' })).toMatch(
      /a selection at each position in the interval mode/
    );
    expect(declines(['If', G, 'L', 0], { to: 'glsl' })).toMatch(
      /run-time length/
    );
  });
});

describe('the other targets compare no length', () => {
  test('interval-js: no check', () => {
    for (const json of [
      ['Add', 'L', 'M'],
      ['Dot', 'L', 'M'],
    ]) {
      const r = compile(box(json), {
        to: 'interval-js',
        fallback: false,
      } as never);
      expect(r.success).toBe(true);
      expect(r.code).not.toMatch(/_agree/);
    }
  });

  test('interval-js and glsl: a call mapped over two lists declines', () => {
    for (const to of ['interval-js', 'glsl'])
      expect(declines(['h', 'L', 'M'], { to })).toMatch(
        /list arguments of h whose lengths are not one value/
      );
  });
});
