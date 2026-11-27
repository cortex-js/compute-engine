/**
 * The sums and the short lists written out on JavaScript (batch G27;
 * README of `src/compute-engine/compilation/ir/`, "Lists" and "User
 * functions"): a `Sum` or a `Product` of constant bounds of at most 100
 * passes is lowered once per index, a list of a constant length of at most
 * 16 elements is the list of its elements, and the pass `inline` also
 * copies a function that its caller calls twice (the rule `'repeated'`).
 * The interval mode did this already; GLSL, the bigint mode and the complex
 * mode do not.
 *
 * A written-out sum computes the operations of its loop in the same order
 * (`compileSlice()` with `unrollSums: false` keeps the loop: the values are
 * the same bit for bit), and every program agrees with the interpreter.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';
import { compileSlice } from '../../src/compute-engine/compilation/ir/index';
import { CancellationError } from '../../src/common/interruptible';

type Json = unknown;
type Point = Record<string, number | number[]>;

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('L', 'list<real^3>');
ce.declare('m', 'integer');
ce.declare('g', 'function');
ce.assign(
  'g',
  ce.box(['Function', ['Add', ['Multiply', ['Sin', 'p'], 'q'], 'p'], 'p', 'q'])
);

const box = (json: Json): Expression => ce.box(json as never);
const IR = { profile: 'ir', fallback: false } as const;
const js = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, ...options } as never);
type Slice = { code: string; run: (p: object) => unknown; warnings: unknown };
/** `compileSlice()` with the sums written out or kept as loops. */
const slice = (json: Json, unrollSums: boolean) =>
  compileSlice(box(json), {
    target: 'javascript',
    unrollSums,
  } as never) as unknown as Slice;

function interpreted(json: Json, point: Point): unknown {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      Array.isArray(v) ? ce.box(['List', ...v]) : ce.number(v),
    ])
  );
  return ce.withValues(values as never, () => {
    const v = box(json).evaluate().N();
    if (isNumber(v)) return v.re;
    return (v as Expression & { ops: Expression[] }).ops.map((x) => x.re);
  });
}

const near = (a: unknown, b: unknown): boolean =>
  Array.isArray(a)
    ? Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, k) => near(x, b[k]))
    : typeof a === 'number' &&
      typeof b === 'number' &&
      (Object.is(a, b) || Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)));

const POINTS: Point[] = [
  { x: 0.3, L: [1.5, -2, 0.25] },
  { x: -1.75, L: [0, 3, -4.5] },
];

/** The text `s` with its values numbered in the order they appear: a
 *  refused attempt to write a sum out leaves gaps in the numbering. */
const renumbered = (s: string): string => {
  const names = new Map<string, string>();
  return s.replace(/\bv\d+/g, (v) => {
    if (!names.has(v)) names.set(v, `v${names.size}`);
    return names.get(v)!;
  });
};

/** The compilation of `json` by `compile()`: the interpreter's values. */
function check(json: Json, points: Point[] = POINTS) {
  const r = js(json);
  expect(r).toMatchObject({ success: true, profile: 'ir' });
  for (const p of points) {
    const [got, want] = [r.run!(p as never), interpreted(json, p)];
    if (!near(got, want))
      throw new Error(
        `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
      );
  }
  return r;
}

describe('IR profile, batch G27: sums written out on JavaScript', () => {
  test('the terms in ascending order from 0, the operations of the loop', () => {
    const json = [
      'Sum',
      ['Divide', ['Sin', ['Multiply', 'k', 'x']], 'k'],
      ['Limits', 'k', 1, 3],
    ];
    const r = check(json);
    expect(r.code).toContain(
      '(((0 + (Math.sin((1 * _.x)) / 1)) + (Math.sin((2 * _.x)) / 2)) + (Math.sin((3 * _.x)) / 3))'
    );
    const [on, off] = [slice(json, true), slice(json, false)];
    expect(on.code).not.toMatch(/for \(/);
    expect(off.code).toMatch(/for \(/);
    for (let k = 0; k < 50; k++) {
      const p = { x: Math.sin(k * 12.9898) * 40 };
      expect(Object.is(on.run(p), off.run(p))).toBe(true);
    }
  });

  test('a Product, and a Sum of 100 passes; one of 101 keeps its loop', () => {
    const product = ['Product', ['Add', 'x', 'k'], ['Limits', 'k', 1, 4]];
    expect(check(product).code).not.toMatch(/for \(/);
    const hundred = ['Sum', ['Divide', 'x', 'k'], ['Limits', 'k', 1, 100]];
    expect(check(hundred).code).not.toMatch(/for \(/);
    const more = ['Sum', ['Divide', 'x', 'k'], ['Limits', 'k', 1, 101]];
    expect(check(more).code).toMatch(/for \(/);
  });

  test('a seeded sum keeps its loop, its draw order, the interpreter’s sequence and its warnings', () => {
    const json = [
      'WithRandomSeed',
      3,
      ['Sum', ['Multiply', 'k', ['Random']], ['Limits', 'k', 1, 3]],
    ];
    const r = check(json, [{}]);
    expect(r.code).toMatch(/for \(/);
    expect(r.code.match(/drawNextRandomNumber/g)).toHaveLength(1);
    const [on, off] = [slice(json, true), slice(json, false)];
    expect(renumbered(on.code)).toBe(renumbered(off.code));
    expect(on.warnings).toEqual(off.warnings);
    // Two draw sites: the warning of the seeded order.
    const two = [
      'WithRandomSeed',
      3,
      [
        'Sum',
        ['Add', ['Multiply', 'k', ['Random']], ['Random']],
        ['Limits', 'k', 1, 3],
      ],
    ];
    const [a, b] = [slice(two, true), slice(two, false)];
    expect(renumbered(a.code)).toBe(renumbered(b.code));
    expect(a.warnings).toEqual(b.warnings);
    expect((a.warnings as { code: string }[]).map((w) => w.code)).toEqual([
      'seeded-draw-order',
    ]);
    expect(a.run({})).toBe(b.run({}));
  });

  test('a local declared with a value in the term is lowered at each term', () => {
    // `t` is k/2 at the term k: 7.5. The memo of the lowering read the
    // value of the first term (2.5).
    const json = [
      'Sum',
      [
        'Block',
        ['Declare', 't', ['Dictionary', ['KeyValuePair', "'value'", 'k']]],
        ['Assign', 't', ['Divide', 't', 2]],
        't',
      ],
      ['Limits', 'k', 1, 5],
    ];
    expect(js(json).run!({} as never)).toBe(7.5);
    expect(interpreted(json, {})).toBe(7.5);
    const i = js(json, { to: 'interval-js' }).run!({} as never) as {
      value: { lo: number; hi: number };
    };
    expect(i.value.lo <= 7.5 && 7.5 <= i.value.hi).toBe(true);
  });

  test('a function called at each term is copied (the rule repeated)', () => {
    const json = ['Sum', ['g', 'x', 'k'], ['Limits', 'k', 1, 8]];
    const r = check(json);
    expect(r.code).not.toMatch(/u\d+_g\(/);
    // `Sin(x)` of the eight copies, computed once.
    expect(r.code.match(/Math\.sin\(/g)).toHaveLength(1);
    // With the loop, the rule 'loop' copies the call in the loop body.
    const loop = slice(json, false);
    expect(loop.code).toMatch(/for \(/);
    expect(loop.code).not.toMatch(/u\d+_g\(/);
  });
});

describe('IR profile, batch G27: short lists written out on JavaScript', () => {
  test('an element-wise operation of a list of 3 is the list of its elements', () => {
    const r = check(['Add', 'L', ['Multiply', 'x', 'L']]);
    expect(r.code).toContain(
      'return [((v5 * _.x) + v5), ((v8 * _.x) + v8), ((v11 * _.x) + v11)];'
    );
    expect(r.code).not.toMatch(/new Array\(/);
  });

  test('a Sum of a short list starts from 0, as its loop; Product, Max and Min from the first element', () => {
    expect(check(['Sum', 'L']).code).toContain(
      '(((0 + _.L[0]) + _.L[1]) + _.L[2])'
    );
    expect(check(['Max', 'L']).code).toContain(
      'Math.max(Math.max(_.L[0], _.L[1]), _.L[2])'
    );
    check(['Min', 'L']);
    // `0 + -0` is 0: a Sum of -0 is 0, as the loop and the interpreter.
    const zeros = { L: [-0, -0, -0] };
    expect(Object.is(js(['Sum', 'L']).run!(zeros as never), 0)).toBe(true);
    expect(
      Object.is(
        js(['Sum', ['Multiply', 'x', 'L']]).run!({
          x: -1,
          L: [0, 0, 0],
        } as never),
        0
      )
    ).toBe(true);
    // `max(-∞, a)` and `1 · a` are `a`: the sign of zero, and NaN, are kept.
    expect(Object.is(js(['Max', 'L']).run!(zeros as never), -0)).toBe(true);
    expect(
      Object.is(js(['Product', 'L']).run!({ L: [-0, 2, 3] } as never), -0)
    ).toBe(true);
    expect(js(['Max', 'L']).run!({ L: [NaN, 1, 2] } as never)).toBeNaN();
  });

  test('a seeded list draws in order, with the interpreter’s sequence', () => {
    const json = [
      'WithRandomSeed',
      3,
      ['Add', 'L', ['List', ['Random'], ['Random'], ['Random']]],
    ];
    const r = js(json);
    expect(r.code).toMatch(
      /const (v\d+) = _SYS\.drawNextRandomNumber\(\);\n\s*const (v\d+) = _SYS\.drawNextRandomNumber\(\);\n\s*const (v\d+) = _SYS\.drawNextRandomNumber\(\);\n\s*v\d+ = \[\(_\.L\[0\] \+ \1\), \(_\.L\[1\] \+ \2\), \(_\.L\[2\] \+ \3\)\];/
    );
    expect(r.warnings?.map((w) => w.code)).toEqual(['seeded-draw-order']);
    const p = POINTS[0];
    expect(near(r.run!(p as never), interpreted(json, p))).toBe(true);
  });

  test('a list of 17 elements keeps its build', () => {
    ce.declare('L17', 'list<real^17>');
    const r = js(['Multiply', 'x', 'L17']);
    expect(r.code).toMatch(/new Array\(/);
  });
});

describe('IR profile, batch G27: the targets and modes that do not write out', () => {
  const sum = [
    'Sum',
    ['Divide', ['Sin', ['Multiply', 'k', 'x']], 'k'],
    ['Limits', 'k', 1, 3],
  ];

  test('GLSL keeps the loop of a Sum, and its own rule for a list', () => {
    const g = js(sum, { to: 'glsl' });
    expect(g.code).toContain('v13 = (v13 + (sin((v6 * x)) / v6));');
    expect(js(['Multiply', 'x', 'L'], { to: 'glsl' }).code).toBe('(L * x)');
  });

  test('the bigint mode keeps its loops', () => {
    const r = js(['Sum', ['Multiply', 'k', 'm'], ['Limits', 'k', 1, 3]], {
      mode: 'bigint',
    });
    expect(r.code).toMatch(/for \(/);
    expect(r.run!({ m: 2n } as never)).toBe(12n);
  });

  test('the complex mode keeps its loops and its builds', () => {
    const r = js(sum, { mode: 'complex' });
    expect(r.code).toMatch(/for \(/);
    expect(js(['Multiply', 'x', 'L'], { mode: 'complex' }).code).toMatch(
      /new Array\(/
    );
  });
});

// Round 2 of the review of batch G27.

/** A nest of `depth` constant sums of `count` terms. */
const nest = (depth: number, count: number): Json => {
  let body: Json = [
    'Sin',
    [
      'Add',
      'x',
      ...Array.from({ length: depth }, (_, i) => ['Divide', `k${i}`, 7 + i]),
    ],
  ];
  for (let i = 0; i < depth; i++)
    body = ['Sum', body, ['Limits', `k${i}`, 1, count]];
  return body;
};

describe('IR profile, batch G27: a nest of constant sums', () => {
  test.each([
    [4, 100, 1],
    [3, 100, 1],
    // Deep nests of few terms: a sum whose nest cannot all be written out
    // is not attempted; each inner sum written out is attempted once
    // (14 × 3: the 3^6 sums of the six inner levels).
    [6, 10, 111],
    [8, 6, 259],
    [10, 4, 341],
    [14, 3, 729],
  ] as const)(
    '%i sums of %i terms: the inner ones written out, the outer loops kept, each sum attempted at most once',
    (depth, count, most) => {
      // Each sum tried at each term of the sums around it made the time
      // grow as count^depth (14 × 3 took 21 s and 3.6 GB, 4 × 100 ran out
      // of memory).
      for (const mode of [undefined, 'interval'] as const) {
        let attempts = 0;
        const r = compileSlice(box(nest(depth, count)), {
          target: 'javascript',
          mode,
          attempted: () => void attempts++,
        } as never) as unknown as Slice;
        expect(r.code).toMatch(/for \(/);
        expect(attempts).toBeLessThanOrEqual(most);
      }
    }
  );

  test('a sum refused in one compilation is tried again in another', () => {
    // Under an iterationBudget of 10 the inner sum of 50 terms keeps its
    // loop, so the outer one is refused; without it both are written out.
    const json = [
      'Sum',
      ['Sum', ['Multiply', 'j', 'x', 'k'], ['Limits', 'j', 1, 50]],
      ['Limits', 'k', 1, 3],
    ];
    const shared = box(json);
    const budget = compile(shared, { ...IR, iterationBudget: 10 } as never);
    const open = compile(shared, IR);
    expect(budget.code).toMatch(/for \(/);
    expect(open.code).not.toMatch(/for \(/);
    expect(open.code).toBe(compile(box(json), IR).code);
    expect(budget.code).toBe(
      compile(box(json), { ...IR, iterationBudget: 10 } as never).code
    );
    const interval = compile(box(json), { ...IR, to: 'interval-js' });
    expect(compile(shared, { ...IR, to: 'interval-js' }).code).toBe(
      interval.code
    );
  });
});

describe('IR profile, batch G27: a lowering that declines with sums written out', () => {
  ce.assign(
    'gg',
    ce.box(['Function', ['Add', ['Multiply', ['Sin', 'p'], 'p'], 1], 'p'])
  );
  test('a term complex at a constant index: the loops are lowered (JavaScript and the interval mode)', () => {
    // At k = -1 the term `Floor(Sqrt(k))` is complex: written out, a decline
    // after the lowering of `gg` began; the loop's real kernel gives NaN
    // there, in an arm not taken.
    const json = [
      'Sum',
      ['If', ['Less', 'k', 0], ['gg', 'x'], ['Floor', ['Sqrt', 'k']]],
      ['Limits', 'k', -1, 3],
    ];
    const r = check(json, [{ x: 0.7 }]);
    expect(r.code).toMatch(/for \(/);
    const i = js(json, { to: 'interval-js' }).run!({
      x: { lo: 0.7, hi: 0.7 },
    } as never) as { value: { lo: number; hi: number } };
    const want = interpreted(json, { x: 0.7 }) as number;
    expect(i.value.lo <= want && want <= i.value.hi).toBe(true);
  });

  test('the limit of the nodes spent by sums written out: the loops are lowered', () => {
    ce.declare('y', 'real');
    const S = (body: Json): Json => ['Sum', body, ['Limits', 'k', 1, 100]];
    const wide = (n: number, salt: number): Json => [
      'Add',
      ...Array.from({ length: n }, (_, i) => [
        'Multiply',
        ['Sin', ['Multiply', 'k', 'x', i + 1 + salt]],
        ['Divide', 'k', i + 2],
      ]),
    ];
    const tail: Json = [
      'Add',
      ...Array.from({ length: 1000 }, (_, i) => [
        'Multiply',
        ['Cos', ['Multiply', 'x', i + 1.5]],
        ['Sin', ['Add', 'y', i + 0.25]],
      ]),
    ];
    const json = [
      'Tuple',
      ...[60, 30, 15, 8, 4, 2].map((w, i) => S(wide(w, i * 1000))),
      tail,
    ];
    const r = js(json);
    expect(r).toMatchObject({ success: true, profile: 'ir' });
    expect(r.code.match(/for \(/g)?.length).toBeGreaterThan(0);
  });
});

describe('IR profile, batch G27: a constant index selects the kernel of a constant operand', () => {
  test('Log(x, k) at k = 10 is log10(x), the interpreter’s value', () => {
    const json = ['Sum', ['Floor', ['Log', 'x', 'k']], ['Limits', 'k', 10, 10]];
    const r = js(json);
    expect(r.code).toContain('Math.log10(_.x)');
    expect(r.run!({ x: 1000 } as never)).toBe(3);
    expect(interpreted(json, { x: 1000 })).toBe(3);
    // The loop computes ln(x)/ln(10), 2.9999999999999996.
    expect(slice(json, false).run({ x: 1000 })).toBe(2);
  });
});

describe('IR profile, batch G27: the passes written out charge no deadline', () => {
  ce.assign('c0', ce.box(['Function', ['Sin', 'p'], 'p']));
  for (let i = 1; i <= 3; i++)
    ce.assign(
      `c${i}`,
      ce.box([
        'Function',
        [
          'Sum',
          [`c${i - 1}`, ['Add', 'p', ['Divide', 'k', 7]]],
          ['Limits', 'k', 1, 100],
        ],
        'p',
      ])
    );

  test('a chain of written-out sums returns its value under a time limit that its loops exceed', () => {
    // The user's decision of 2026-11-16: a host that needs a bound on the
    // run time runs the compiled function in a worker (README, "Lists").
    const json = ['c3', 'x'];
    const written = js(json);
    expect(written.code + (written.preambleOnce ?? '')).not.toMatch(
      /_SYS\.tick/
    );
    const v = ce.withTimeLimit(1, () => written.run!({ x: 0.3 } as never));
    expect(Number.isFinite(v)).toBe(true);
    const loops = slice(json, false);
    expect(() => ce.withTimeLimit(1, () => loops.run({ x: 0.3 }))).toThrow(
      CancellationError
    );
  });
});

describe('IR profile, batch G27: a build whose body has an effect keeps its loop', () => {
  test.each([
    ['list<real^1>', 'L1x'],
    ['list<real^3>', 'L3x'],
  ])('a seeded Map over %s: the warning of a draw in a loop', (type, name) => {
    ce.declare(name, type);
    const json = [
      'WithRandomSeed',
      3,
      ['Sum', ['Map', ['Function', ['Multiply', 'u', ['Random']], 'u'], name]],
    ];
    const r = js(json);
    expect(r.code).toMatch(/new Array\(/);
    expect(r.warnings?.map((w) => w.message)).toEqual([
      expect.stringMatching(/a draw in a loop or a per-element body/),
    ]);
  });
});
