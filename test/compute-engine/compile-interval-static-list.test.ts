/**
 * A `List` of STATIC width on the interval target.
 *
 * The interval target's values are one interval each: it has no lowering for
 * a `List`, and a list-valued expression declined whole. The fixed-width
 * pre-pass (`fixed-width-unroll.ts`) writes a literal list out into scalar
 * code — one node per element — but only for lists of five elements or more,
 * the width below which the other targets have a native lowering. The
 * interval target now asks the pass to write out a list of ANY width, a list
 * of number literals included (`CompileTarget.unrollMinWidth`,
 * `unrollConstantLists`), and inlines a helper whose value is a list at the
 * root call site first, so the pass sees the list through the call. The seven
 * `interval-js` declines of the Tycho code-generation audit of 0.128.9 that
 * named `List` (documents `1dee4lkte2` and `oeupgr064p`) compile.
 *
 * The spine of every case is that the compiled ENCLOSURE contains the
 * interpreter's value.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
for (const s of ['x', 'y', 'g']) ce.declare(s, 'real');
// f(x, y) = [−y, x] / (x² + y²): a list-valued helper (the audit's `f`/`F`).
ce.declare('f', 'function');
ce.assign(
  'f',
  ce.expr([
    'Function',
    [
      'Divide',
      ['List', ['Negate', 'y'], 'x'],
      ['Add', ['Square', 'x'], ['Square', 'y']],
    ],
    ['Typed', 'x', 'real'],
    ['Typed', 'y', 'real'],
  ])
);

const X = 0.3;
const Y = 0.7;

function encloses(json: unknown, vars: Record<string, number> = {}): void {
  const expr = ce.box(json);
  const r = compile(expr, { to: 'interval-js', fallback: false });
  expect(r.success).toBe(true);
  const point = { x: X, y: Y, ...vars };
  const input = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, { lo: v, hi: v }])
  );
  const v: any = r.run!(input);
  const { lo, hi } = v.value ?? v;
  const want = expr
    .subs(
      Object.fromEntries(
        Object.entries(point).map(([k, n]) => [k, ce.number(n)])
      )
    )
    .N()
    .valueOf() as number;
  expect(Number.isFinite(want)).toBe(true);
  expect(lo).toBeLessThanOrEqual(want);
  expect(hi).toBeGreaterThanOrEqual(want);
  // Tight: the enclosure of a point input is a few ulps wide.
  expect(hi - lo).toBeLessThan(1e-12);
}

const COLUMN = (a: unknown, b: unknown, c: unknown) => [
  'Divide',
  ['List', ['Negate', a], b],
  ['Add', ['Square', b], ['Square', a]],
];

describe('Interval target — a static-width list is written out', () => {
  test('list arithmetic under a total, written inline (audit 1dee4lkte2)', () => {
    encloses([
      'Subtract',
      1,
      [
        'Square',
        [
          'Sum',
          [
            'Add',
            COLUMN(['Add', 'y', 3], ['Subtract', 'x', 1], 0),
            COLUMN(['Add', 'y', 3], ['Add', 'x', 1], 0),
          ],
        ],
      ],
    ]);
  });

  test('list arithmetic under a total, through a list-valued helper', () => {
    encloses([
      'Subtract',
      1,
      [
        'Square',
        [
          'Sum',
          [
            'Add',
            ['f', ['Add', 'x', 1], ['Add', 'y', 3]],
            ['f', ['Subtract', 'x', 1], ['Add', 'y', 3]],
          ],
        ],
      ],
    ]);
    encloses([
      'Subtract',
      1,
      [
        'Square',
        [
          'Sum',
          [
            'Subtract',
            ['f', ['Add', 'x', 1], ['Subtract', 'y', 3]],
            ['f', ['Subtract', 'x', 1], ['Subtract', 'y', 3]],
          ],
        ],
      ],
    ]);
  });

  test('an element of a list-valued helper (audit oeupgr064p)', () => {
    encloses(['At', ['f', 'x', 'y'], 1]);
    encloses(['At', ['f', 'x', 'y'], 2]);
    encloses([
      'Subtract',
      [
        'Max',
        ['Square', ['At', ['f', 'x', 'y'], 2]],
        ['Square', ['At', ['f', 'x', 'y'], 1]],
      ],
      0.1,
    ]);
  });

  test('a constant list is written out too', () => {
    encloses(['Sum', ['Multiply', 'x', ['List', 1, 2, 3]]]);
    encloses(['Max', ['Add', ['List', 1, 2], 'y']]);
  });

  test('a global the inlined helper reads is a run-time input', () => {
    // h reads the global g, which the root expression never names.
    ce.declare('h', 'function');
    ce.assign(
      'h',
      ce.expr([
        'Function',
        ['List', ['Multiply', 'g', 'x'], 'x'],
        ['Typed', 'x', 'real'],
      ])
    );
    const r = compile(ce.box(['At', ['h', 'x'], 1]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    const v: any = r.run!({ x: { lo: X, hi: X }, g: { lo: 2.5, hi: 2.5 } });
    const { lo, hi } = v.value ?? v;
    // The first element is g·x.
    expect(lo).toBeLessThanOrEqual(2.5 * X);
    expect(hi).toBeGreaterThanOrEqual(2.5 * X);
    expect(hi - lo).toBeLessThan(1e-12);
  });

  test('a helper the caller overrode is not inlined', () => {
    // The caller's implementation of `f` replaces the emission and receives
    // the call's own operands; substituting the engine's body would drop it.
    const r = compile(ce.box(['At', ['f', 'x', 'y'], 1]), {
      to: 'interval-js',
      fallback: false,
      functions: { f: '_.myF' },
    });
    expect(r.success).toBe(true);
    expect((r.preamble ?? '') + r.code).toContain('_.myF(');
  });

  test('a list VALUE at the root still declines', () => {
    const r = compile(ce.box(['List', ['Less', 'x', 1], ['Less', 'x', 2]]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(false);
  });
});

describe('A literal index into a literal list folds on every target', () => {
  test('`At([a, b], 1)` compiles to `a`', () => {
    const r = compile(ce.box(['At', ['List', ['Sin', 'x'], 'y'], 1]), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('[');
    expect(r.run!({ x: X, y: Y })).toBeCloseTo(Math.sin(X), 14);
  });

  test('an index out of range is left to the target', () => {
    const r = compile(ce.box(['At', ['List', 'x', 'y'], 3]), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('[');
  });

  test('a discarded element reading a live-source `vars` splice keeps the list', () => {
    const r = compile(ce.box(['At', ['List', 'x', 'y'], 1]), {
      fallback: false,
      vars: { y: '_.counter()' },
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('[');
  });

  test('a complex index is left to the target', () => {
    const r = compile(ce.box(['At', ['List', 'x', 'y'], ['Complex', 1, 1]]), {
      fallback: false,
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('[');
  });

  test('a `List` head the caller overrode is left to the override', () => {
    const r = compile(ce.box(['At', ['List', 'x', 'y'], 1]), {
      fallback: false,
      functions: { List: '_.myList' },
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_.myList(');
  });

  test('a discarded element with an effect keeps the list', () => {
    const r = compile(ce.box(['At', ['List', 'x', ['Random']], 1]), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('[');
  });
});
