/**
 * The defects of the profile `ir` that a run of the test suite found with
 * every public `compile()` trying the profile first (batch G13; README of
 * `src/compute-engine/compilation/ir/`):
 *
 * - A product of a matrix (a list of rank 2 or more) with another list, and
 *   a power of a matrix, are the matrix product and power of the
 *   interpreter: they decline.
 * - A product with a rational constant `p/q` whose denominator is not a
 *   power of two is `(p · factors) / q`, so a quotient that is an integer
 *   in exact arithmetic is that integer under `Floor`, `Ceil`, `Round`,
 *   `Truncate` and `Mod` (`Floor(x/49)` at 49 is 1). A sweep against the
 *   interpreter on JavaScript, and a sample in WebGL2 (the headless
 *   Chromium of `scripts/glsl-check/glsl-driver.ts`; skipped without it).
 * - An integral has no Monte-Carlo fallback: where the quadrature would
 *   sample, it is NaN, the same at each run.
 * - A `Range` with an infinite operand declines, and so does a bound of a
 *   `Sum` or a `Product` that assigns a name outside it.
 * - The three robustness tests, with rational products.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Point = Record<string, number | number[] | number[][]>;

const ce = new ComputeEngine();
for (const name of ['x', 'y', 's', 'P']) ce.declare(name, 'real');
for (const name of ['k', 'j', 'n']) ce.declare(name, 'integer');
ce.declare('p', 'matrix<number^(2x2)>');
ce.declare('q', 'matrix<number^(2x2)>');
ce.declare('L', 'list<real^2>');
ce.declare('T', 'tensor<real^(2x2x2)>');
ce.assign('B', ce.box(['List', ['List', 1, 2], ['List', 3, 4]] as never));

const IR = { profile: 'ir', fallback: false } as const;
const js = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), { ...IR, ...options });
const glsl = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), { ...IR, to: 'glsl', ...options });

/** The diagnostic of a compilation that throws, or `undefined`. */
function failure(
  f: () => unknown
): { code: string; message: string } | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { code: string; message: string } }).diagnostic;
  }
  return undefined;
}

/** The interpreter's value: a list is an array. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  throw new Error(`no value: ${e.toString()}`);
}

const literal = (v: unknown): Expression =>
  Array.isArray(v)
    ? ce.function('List', v.map(literal))
    : ce.number(v as number);

/** The interpreter's value of `json` with the inputs of `point`. */
function interpreted(json: Json, point: Point): unknown {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, literal(v)])
  );
  return ce.withValues(values as never, () =>
    read(
      ce
        .box(json as never)
        .evaluate()
        .N()
    )
  );
}

/** `v` and `w` have one shape and agree within `tolerance`. */
function agree(v: unknown, w: unknown, tolerance = 1e-12): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, i) => agree(v[i], x, tolerance))
    );
  return (
    typeof v === 'number' &&
    typeof w === 'number' &&
    Math.abs(v - w) <= tolerance * Math.max(1, Math.abs(w))
  );
}

function check(json: Json, points: Point[], options: object = {}) {
  const r = js(json, options);
  expect(r).toMatchObject({ success: true, profile: 'ir' });
  for (const point of points) {
    const got = r.run!(point as never);
    const want = interpreted(json, point);
    expect([point, got, agree(got, want)]).toEqual([point, got, true]);
  }
  return r;
}

const M = [
  [1, 2],
  [3, 4],
];
const N = [
  [0, 1],
  [1, 0],
];

describe('IR profile, batch G13: a product or a power of matrices (D1)', () => {
  test('the interpreter: a matrix product and power, the other shapes element by element', () => {
    const at = { p: M, q: N, L: [5, 7], s: 3 };
    expect(interpreted(['Multiply', 'p', 'q'], at)).toEqual([
      [2, 1],
      [4, 3],
    ]);
    expect(interpreted(['Multiply', 'p', 'L'], at)).toEqual([19, 43]);
    expect(interpreted(['Multiply', 'L', 'p'], at)).toEqual([26, 38]);
    expect(interpreted(['Power', 'p', 's'], at)).toEqual([
      [37, 54],
      [81, 118],
    ]);
    expect(interpreted(['Multiply', 'L', 'L'], at)).toEqual([25, 49]);
    expect(interpreted(['Multiply', 's', 'p'], at)).toEqual([
      [3, 6],
      [9, 12],
    ]);
  });

  test.each([
    ['Multiply', 'p', 'q'],
    ['Multiply', 'q', 'p'],
    ['Multiply', 'p', 'p'],
    ['Multiply', 2, 'p', 'q'],
    ['Multiply', 'p', 'q', 'p'],
    ['Add', ['Multiply', 'p', 'q'], 1],
    ['Multiply', 'p', 'L'],
    ['Multiply', 'L', 'p'],
    ['Multiply', ['Rational', 1, 3], 'p', 'q'],
    ['Multiply', 'T', 'T'],
    ['Power', 'p', 's'],
    ['Power', 'T', 2],
    ['Power', 'p', 'q'],
  ])('%j declines on both targets', (...json) => {
    for (const compileTo of [js, glsl])
      expect(failure(() => compileTo(json))?.message).toMatch(
        /of a matrix .*: the interpreter's value is the matrix product or power, or element by element for some operands/
      );
  });

  test('a power of a matrix by a number is MatrixPower in the canonical form', () => {
    for (const json of [
      ['Power', 'p', 2],
      ['Power', 'B', 2],
    ])
      expect(failure(() => js(json))?.message).toMatch(
        /MatrixPower is not in the slice/
      );
  });

  test('a structural Power of a literal matrix declines or is the matrix power', () => {
    const json = ['Power', ['List', ['List', 1, 2], ['List', 3, 4]], 2];
    for (const constantFold of [true, false]) {
      const d = failure(() => js(json, { constantFold }));
      if (d === undefined)
        expect(js(json, { constantFold }).run!({} as never)).toEqual([
          [7, 10],
          [15, 22],
        ]);
      else expect(d.message).toMatch(/MatrixPower|of a matrix/);
    }
  });

  test('element-wise shapes still compile and agree', () => {
    const at = [{ p: M, q: N, L: [5, 7], s: 3, x: -1.5 }];
    check(['Multiply', 's', 'p'], at);
    check(['Multiply', ['Rational', 1, 3], 'p'], at);
    check(['Add', 'p', 'q'], at);
    check(['Divide', 'p', 's'], at);
    check(['Multiply', 'L', 'L'], at);
    check(['Multiply', 'x', 'L', 'L'], at);
    check(['Power', 'L', 's'], at);
  });
});

/** The non-powers of two of the sweep, the numerator of `p·k/q`. */
const DIVISORS = [3, 5, 7, 10, 49, 50, 98, 103, 161, 360];
const NUMERATOR = 29;
const JUMPS = ['Floor', 'Ceil', 'Round', 'Truncate', 'Mod'] as const;
const jump = (f: (typeof JUMPS)[number], inner: Json): Json =>
  f === 'Mod' ? ['Mod', inner, 1] : [f, inner];

describe('IR profile, batch G13: a rational factor is a division (D2)', () => {
  test('the witnesses', () => {
    const floor49 = check(
      ['Floor', ['Divide', 'x', 49]],
      [{ x: 49 }, { x: 98 }, { x: -49 }, { x: 48 }]
    );
    expect(floor49.code).toMatch(/_\.x \/ 49/);
    check(['Floor', ['Divide', 'x', 49]], [{ x: 49 }], { constantFold: false });
    const r = check(
      ['Floor', ['Multiply', ['Rational', 29, 50], 'k']],
      [{ k: 100 }, { k: -100 }, { k: 50 }]
    );
    expect(r.code).toMatch(/\(29 \* _\.k\) \/ 50/);
    expect(
      glsl(['Floor', ['Multiply', ['Rational', 29, 50], 'x']]).code
    ).toMatch(/floor\(_gpu_ir_quot\(\(29\.0 \* x\), 50\.0\)\)/);
    check(
      ['Floor', ['Multiply', ['Rational', -29, 50], 'k']],
      [{ k: 100 }, { k: 7 }]
    );
    check(
      ['Floor', ['Add', ['Multiply', ['Rational', 1, 3], 'j'], 'n']],
      [
        { j: 6, n: 2 },
        { j: -9, n: 1 },
      ]
    );
  });

  test('a point times p/q is divided by the same operation', () => {
    const json = [
      'Floor',
      ['PointX', ['Multiply', ['Rational', 29, 3], ['Tuple', 'x', 'y']]],
    ];
    check(json, [
      { x: -210, y: 1 },
      { x: 3, y: 0 },
      { x: -4, y: 0 },
    ]);
    expect(glsl(json).code).toMatch(/_gpu_ir_quot/);
  });

  test('a denominator of 49·2^32 is not a power of two', () => {
    const q = 49 * 2 ** 32;
    check(
      ['Floor', ['Divide', 'x', q]],
      [{ x: q }, { x: 2 * q }, { x: q - 1 }]
    );
  });

  test('a rational held by a name is a division, and a capture', () => {
    ce.assign('r49', ce.number([1, 49]));
    const symbolDeps = new Set<string>();
    const r = check(
      ['Floor', ['Multiply', 'r49', 'x']],
      [{ x: 49 }, { x: 48 }],
      {
        symbolDeps,
      }
    );
    expect(r.code).toMatch(/_\.x \/ 49/);
    expect([...symbolDeps]).toContain('r49');
  });

  test('p and the sign multiply the scalars before a list', () => {
    const r = check(
      ['Multiply', ['Rational', -2, 3], 'x', 'L'],
      [{ x: 1.5, L: [3, -6] }]
    );
    // L is a short list, written out ("Lists"): the product, then the
    // division, of each element, and no build.
    expect(r.code).not.toMatch(/new Array\(/);
    expect(r.code).toContain('[((v3 * _.L[0]) / 3), ((v3 * _.L[1]) / 3)]');
  });

  test('a power of two as the denominator stays a product by its double', () => {
    expect(js(['Multiply', ['Rational', 1, 4], 'x']).code).toMatch(
      /0\.25 \* _\.x/
    );
    expect(js(['Multiply', ['Rational', 3, 4], 'x', 'y']).code).toMatch(
      /0\.75 \* _\.x/
    );
  });

  test('a list, a complex factor, and the bigint mode', () => {
    check(['Multiply', ['Rational', 1, 3], 'L'], [{ L: [3, -6] }]);
    ce.declare('z', 'complex');
    const c = js(['Multiply', ['Rational', 1, 3], 'z']);
    expect(c.code).toMatch(/0\.3333333333333333/);
    expect(c.run!({ z: { re: 3, im: 6 } } as never)).toEqual({
      re: 1,
      im: 2,
    });
    expect(
      failure(() => js(['Floor', ['Divide', 'k', 3]], { mode: 'bigint' }))
        ?.message
    ).toMatch(/1\/3: a number that is not an integer \(the bigint mode\)/);
  });

  test('the fold gives the value of the unfolded code', () => {
    const json = ['Floor', ['Multiply', ['Rational', 29, 50], 'k']];
    for (const k of [100, -100, 51])
      expect(js(json).run!({ k } as never)).toBe(
        js(json, { constantFold: false }).run!({ k } as never)
      );
    // A closed product is the interpreter's exact value.
    expect(
      js(['Add', 'x', ['Floor', ['Multiply', ['Rational', 1, 49], 49]]]).run!({
        x: 0,
      } as never)
    ).toBe(1);
  });

  test('a sweep of x/q and 29·k/q from -200 to 200 against the interpreter', () => {
    let count = 0;
    const failures: string[] = [];
    for (const f of JUMPS)
      for (const q of DIVISORS)
        for (const [name, factor] of [
          ['x', ['Rational', 1, q]],
          ['k', ['Rational', NUMERATOR, q]],
        ] as const) {
          const json = jump(f, ['Multiply', factor, name]);
          const e = ce.box(json as never);
          const run = js(json).run!;
          for (let v = -200; v <= 200; v++) {
            const got = run({ [name]: v } as never) as unknown as number;
            const want = ce.withValues({ [name]: ce.number(v) } as never, () =>
              e.evaluate().N()
            ).re;
            count += 1;
            // Mod of a quotient that is not an integer is a real, within
            // 1e-12; a jump is an integer, exactly.
            if (Math.abs(got - want) > (f === 'Mod' ? 1e-12 : 0))
              failures.push(`${JSON.stringify(json)} at ${v}: ${got}, ${want}`);
          }
        }
    expect(failures).toEqual([]);
    expect(count).toBe(JUMPS.length * DIVISORS.length * 2 * 401);
  });

  test('the cases that stay wrong in doubles (known limitations)', () => {
    // A sum of fractions that is an integer only in exact arithmetic.
    const sum = js([
      'Floor',
      ['Add', ['Multiply', ['Rational', 1, 3], 'j'], 'n', ['Rational', 1, 3]],
    ]);
    expect(sum.run!({ j: 5, n: 5 } as never)).toBe(7);
    expect(sum.run!({ j: -46, n: -16 } as never)).toBe(-32);
    expect(
      interpreted(
        [
          'Floor',
          [
            'Add',
            ['Multiply', ['Rational', 1, 3], 'j'],
            'n',
            ['Rational', 1, 3],
          ],
        ],
        { j: -46, n: -16 }
      )
    ).toBe(-31);
    // A comparison at a zero of a transcendental function.
    const json = [
      'Which',
      ['Less', 0, ['Sin', ['Divide', ['Multiply', 2, 'Pi', 's'], 'P']]],
      1,
      'True',
      0,
    ];
    expect(js(json).run!({ s: 2, P: -2 } as never)).toBe(1);
    expect(interpreted(json, { s: 2, P: -2 })).toBe(0);
  });
});

describe('IR profile, batch G13: an integral whose fallback meets a value that is not finite (D3)', () => {
  const integral = (n: number) => [
    'Integrate',
    [
      'Function',
      [
        'Block',
        [
          'Multiply',
          ['Power', 'x', n],
          ['Power', 'ExponentialE', ['Negate', 'x']],
        ],
      ],
      'x',
    ],
    ['Limits', 'x', 0, 'PositiveInfinity'],
  ];

  test('an integrand that overflows gives NaN, the same at each run', () => {
    const r = js(integral(100));
    expect(r.code).toMatch(/_SYS\.irIntegrate\(/);
    expect(r.shippable).toBe(false);
    const values = Array.from({ length: 5 }, () => r.run!({} as never));
    expect(values).toEqual([NaN, NaN, NaN, NaN, NaN]);
    expect(js(integral(150)).run!({} as never)).toBeNaN();
  });

  test('a finite integrand keeps the estimate of the fallback', () => {
    const json = [
      'Integrate',
      ['Function', ['Mod', 't', 1], 't'],
      ['Limits', 't', 0, 1000],
    ];
    const v = js(json).run!({} as never) as unknown as number;
    expect(Math.abs(v - 500)).toBeLessThan(1);
  });

  test('x^10 and x^30 agree with the interpreter', () => {
    for (const n of [10, 30]) {
      const want = interpreted(integral(n), {}) as number;
      const got = js(integral(n)).run!({} as never) as unknown as number;
      expect([n, agree(got, want)]).toEqual([n, true]);
    }
  });

  test('an integral to a bound past the overflow is NaN', () => {
    const json = [
      'Function',
      [
        'Integrate',
        [
          'Function',
          [
            'Multiply',
            ['Power', 'x', 100],
            ['Power', 'ExponentialE', ['Negate', 'x']],
          ],
          'x',
        ],
        ['Limits', 'x', 0, 'y'],
      ],
      'y',
    ];
    const run = js(json).run as unknown as (y: number) => number;
    expect([run(1500), run(1500)]).toEqual([NaN, NaN]);
  });
});

describe('IR profile, batch G13: the declines of D4 and D6', () => {
  test('At over a Map of an infinite Range declines (D4)', () => {
    const json = [
      'At',
      [
        'Map',
        ['Function', ['Block', ['Multiply', 'x', 'y']], 'x'],
        ['Range', 1, 'PositiveInfinity'],
      ],
      3,
    ];
    expect(interpreted(json, { y: 5 })).toBe(15);
    expect(failure(() => js(json))?.message).toMatch(
      /a Range of an operand that is a constant infinity or NaN/
    );
  });

  test.each(['Sum', 'Product'])(
    'an assignment in a bound of a %s declines (D6)',
    (op) => {
      const first = [
        'Block',
        ['Declare', 'p', "'unknown'", 0],
        [op, 'i', ['Limits', 'i', 1, ['Block', ['Assign', 'p', 4], 2]]],
        'p',
      ];
      const later = [
        'Block',
        ['Declare', 'p', "'unknown'", 0],
        [
          op,
          ['Add', 'i', 'j'],
          ['Limits', 'i', 1, 2],
          ['Limits', 'j', 1, ['Block', ['Assign', 'p', ['Add', 'p', 1]], 2]],
        ],
        'p',
      ];
      for (const json of [first, later]) {
        expect(interpreted(json, {})).toBe(0);
        expect(failure(() => js(json))?.message).toMatch(
          new RegExp(`a bound of ${op} that assigns a name outside it`)
        );
      }
      // A local of the bound is not a name outside it (the interpreter
      // leaves a big operator over a bound with an effect unevaluated).
      const local = [
        op,
        'i',
        [
          'Limits',
          'i',
          1,
          ['Block', ['Declare', 'w', 'real', 0], ['Assign', 'w', 3], 'w'],
        ],
      ];
      expect(js(local).run!({} as never)).toBe(6);
    }
  );
});

describe('IR profile, batch G13: robustness', () => {
  const x = ce.box('x');
  const third = ce.number([1, 3]);

  test('a shared graph of 2^20 paths', () => {
    let e: Expression = x;
    for (let i = 0; i < 20; i++)
      e = ce.function('Add', [
        ce.function('Multiply', [third, e]),
        ce.function('Sin', [e]),
      ]);
    for (const to of ['javascript', 'glsl'] as const) {
      const start = performance.now();
      const r = compile(e, { ...IR, to });
      expect(r.code.length + (r.preamble ?? '').length).toBeLessThan(20_000);
      // A guard against a walk by paths (a hang), not a measure.
      expect(performance.now() - start).toBeLessThan(30_000);
    }
    let want = 0.5;
    for (let i = 0; i < 20; i++) want = want / 3 + Math.sin(want);
    expect(compile(e, IR).run!({ x: 0.5 } as never)).toBe(want);
  });

  test('a chain of 1,000 operands', () => {
    const sum = ce.function(
      'Add',
      Array.from({ length: 1_000 }, (_, i) =>
        ce.function('Floor', [
          ce.function('Multiply', [
            ce.number([1, 3 + (i % 7)]),
            ce.function('Add', [x, ce.number(i)]),
          ]),
        ])
      )
    );
    for (const to of ['javascript', 'glsl'] as const) {
      const start = performance.now();
      const r = compile(sum, { ...IR, to });
      expect(r.code.length).toBeLessThan(200_000);
      expect(performance.now() - start).toBeLessThan(30_000);
    }
    let want = 0;
    for (let i = 0; i < 1_000; i++) want += Math.floor((5 + i) / (3 + (i % 7)));
    expect(compile(sum, IR).run!({ x: 5 } as never)).toBe(want);
  });

  test('nested loops of rational products', () => {
    const json = [
      'Sum',
      [
        'Sum',
        ['Floor', ['Multiply', ['Rational', 1, 7], 'a', 'b']],
        ['Limits', 'b', 1, 'n'],
      ],
      ['Limits', 'a', 1, 'n'],
    ];
    const start = performance.now();
    const r = check(json, [{ n: 30 }, { n: 7 }, { n: 0 }]);
    expect(r.code).toMatch(/\/ 7/);
    // GLSL: a loop nested in a Sum of a run-time count compiles (each is
    // limited by its own count).
    expect(glsl(json).success).toBe(true);
    expect(performance.now() - start).toBeLessThan(30_000);
  });
});

//
// WebGL2
//

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** The fragment shader of a host that writes the result of `r`, whose
 *  inputs are `float` uniforms. */
function shader(r: ReturnType<typeof glsl>): string {
  const inputs = r.freeSymbols!;
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    ...inputs.map((n) => `uniform float u_${n};`),
    'out vec4 fragColor;',
    r.preamble ?? '',
    `float userFn(${inputs.map((n) => `float ${n}`).join(', ')}) {`,
    body,
    '}',
    'void main() {',
    `  fragColor = vec4(userFn(${inputs.map((n) => `u_${n}`).join(', ')}), 0.0, 0.0, 0.0);`,
    '}',
  ].join('\n');
}

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile, batch G13: the quotients in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('a sample of the sweep equals the interpreter', async () => {
      // A real input of integer values, within 2^24; the rounding
      // functions of x/q and 29·x/q at every multiple of q and next to it.
      const items = JUMPS.filter((f) => f !== 'Mod').flatMap((f) =>
        DIVISORS.flatMap((q) =>
          [1, NUMERATOR].flatMap((p) => {
            const json = jump(f, ['Multiply', ['Rational', p, q], 'x']);
            const r = glsl(json);
            return [-2 * q, -q - 1, -q, -1, 0, 1, q - 1, q, q + 1, 3 * q].map(
              (x) => ({
                name: `${JSON.stringify(json)} at ${x}`,
                source: shader(r),
                uniforms: { u_x: x },
                expected: interpreted(json, { x }) as number,
              })
            );
          })
        )
      );
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) failures.push(`${name}: ${v.log}`);
        else if (v.value !== expected)
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBe(4 * DIVISORS.length * 2 * 10);
    }, 180_000);

    test('a dividend from 2^23 is not repaired; a point times p/q is', async () => {
      // At 8388612 the quotient is 1677722.4: `m * q` is not exact there,
      // and a repair gave the half-integer 1677722.5, rounded to 1677723.
      const round = ['Round', ['Divide', 'x', 5]];
      const point = [
        'Floor',
        ['PointX', ['Multiply', ['Rational', 29, 3], ['Tuple', 'x', 'y']]],
      ];
      const items = [
        { json: round, point: { x: 8388612 } },
        { json: point, point: { x: -210, y: 1 } },
        { json: point, point: { x: 3, y: 1 } },
      ].map(({ json, point: p }) => ({
        name: `${JSON.stringify(json)} at ${JSON.stringify(p)}`,
        source: shader(glsl(json)),
        uniforms: Object.fromEntries(
          Object.entries(p).map(([n, v]) => [`u_${n}`, v])
        ),
        expected: interpreted(json, p) as number,
      }));
      expect(items.map((i) => i.expected)).toEqual([1677722, -2030, 29]);
      const values = await driver.evaluate(items);
      expect(values.map((v) => (v.ok ? v.value : v.log))).toEqual(
        items.map((i) => i.expected)
      );
    }, 60_000);
  }
);
