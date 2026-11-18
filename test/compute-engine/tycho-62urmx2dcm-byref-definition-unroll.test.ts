import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Nested collection-valued calls substituted on the DEFINITION-EMISSION route
 * (`inlineCollectionValuedCallsInDefinitionBody` in
 * `compilation/base-compiler.ts`).
 *
 * The fixed-width unroll reads the width of a collection off a literal `List`.
 * A body such as `PointX(V(x, y))` hides that width behind a call, so an
 * emitted definition of it was runtime broadcast code — `_SYS.bcast` closures,
 * a `.map` over the points, a `reduce` for the minimum — where the same body
 * written with the list in place is straight-line scalar arithmetic. The call
 * SITE already substituted such a callee before compiling
 * (`tryInlineUserFunctionCall`); the definition route now does the same, with
 * the same soundness gates.
 *
 * The witness is the Voronoi chain of the Desmos state `62urmx2dcm`, written
 * as six named functions of `(x, y)`:
 *
 *   V(x, y)  = the nine lattice points of the 3×3 neighborhood
 *   d(x, y)  = the nine squared distances from (x, y) to those points
 *   m(x, y)  = min d
 *   d2(x, y) = d with its minimum replaced by 1e9
 *   m2(x, y) = min d2
 *   row(x,y) = (1/16)² − |m2 − m|
 *
 * Only `V`, `d` and `d2` are collection-valued; `m`, `m2` and `row` are
 * scalars and stay shared definitions.
 */

const N_CELLS = 16;
const N = 4;
const H_STEP = 1 / N;
const OFFSETS: Array<[number, number]> = [
  [-H_STEP, -H_STEP],
  [0, -H_STEP],
  [H_STEP, -H_STEP],
  [-H_STEP, 0],
  [0, 0],
  [H_STEP, 0],
  [-H_STEP, H_STEP],
  [0, H_STEP],
  [H_STEP, H_STEP],
];

const hash = (a: unknown) => [
  'Mod',
  ['Multiply', 10000, ['Sin', ['Multiply', 10000, a]]],
  1,
];
const S = (x: unknown, y: unknown, s: number) =>
  hash([
    'Add',
    ['Floor', ['Multiply', N, x]],
    ['Multiply', N, ['Floor', ['Multiply', N, y]]],
    s,
  ]);
const P = (x: unknown, y: unknown) => [
  'Add',
  [
    'Multiply',
    ['Divide', 1, N],
    ['PointList', ['Floor', ['Multiply', N, x]], ['Floor', ['Multiply', N, y]]],
  ],
  ['Multiply', ['Divide', 1, N], ['PointList', S(x, y, 0), S(x, y, 0.5)]],
];
const NEIGHBOURS = (x: unknown, y: unknown) => [
  'List',
  ...OFFSETS.map(([dx, dy]) => P(['Add', x, dx], ['Add', y, dy])),
];

/** The chain written INLINE: no named function anywhere. */
const D_INLINE = (x: unknown, y: unknown) => [
  'Add',
  ['Square', ['Subtract', x, ['PointX', NEIGHBOURS(x, y)]]],
  ['Square', ['Subtract', y, ['PointY', NEIGHBOURS(x, y)]]],
];
const M_INLINE = (x: unknown, y: unknown) => ['Min', D_INLINE(x, y)];
const ROW_INLINE = (x: unknown, y: unknown) => [
  'Subtract',
  ['Power', ['Divide', 1, N_CELLS], 2],
  [
    'Abs',
    [
      'Subtract',
      [
        'Min',
        [
          'Map',
          [
            'Function',
            ['Which', ['Equal', '_', M_INLINE(x, y)], 1e9, 'True', '_'],
            '_',
          ],
          D_INLINE(x, y),
        ],
      ],
      M_INLINE(x, y),
    ],
  ],
];

/**
 * The chain written as six named functions. `x` and `y` are DECLARED scalars,
 * as the Desmos state's own axes are.
 */
function byReferenceEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'number');
  ce.declare('y', 'number');
  const def = (name: string, body: unknown) =>
    ce.box(['DefineFunction', name, ['Function', body, 'x', 'y']]).evaluate();
  def('V', NEIGHBOURS('x', 'y'));
  def('d', [
    'Add',
    ['Square', ['Subtract', 'x', ['PointX', ['V', 'x', 'y']]]],
    ['Square', ['Subtract', 'y', ['PointY', ['V', 'x', 'y']]]],
  ]);
  def('m', ['Min', ['d', 'x', 'y']]);
  def('d2', [
    'Map',
    [
      'Function',
      ['Which', ['Equal', '_', ['m', 'x', 'y']], 1e9, 'True', '_'],
      '_',
    ],
    ['d', 'x', 'y'],
  ]);
  def('m2', ['Min', ['d2', 'x', 'y']]);
  def('row', [
    'Subtract',
    ['Power', ['Divide', 1, N_CELLS], 2],
    ['Abs', ['Subtract', ['m2', 'x', 'y'], ['m', 'x', 'y']]],
  ]);
  return ce;
}

/** Everything the artifact emits: the preamble definitions and the body. */
const sourceOf = (r: any): string => `${r.preamble ?? ''}${r.code ?? ''}`;

/** A five-element list of `u`-dependent scalars: the narrowest list the
 * fixed-width unroll rewrites. */
const FIVE_OF = (u: string) => [
  'List',
  ['Add', u, 1],
  ['Add', u, 2],
  ['Add', u, 3],
  ['Add', u, 4],
  ['Add', u, 5],
];

/** An engine with a declared scalar `u` and a `define` helper over it. */
function scalarEngine(): {
  ce: ComputeEngine;
  def: (name: string, body: unknown) => void;
} {
  const ce = new ComputeEngine();
  ce.declare('u', 'number');
  const def = (name: string, body: unknown) => {
    ce.box(['DefineFunction', name, ['Function', body, 'u']]).evaluate();
  };
  return { ce, def };
}

describe('BY-REFERENCE DEFINITION UNROLL — shadowing', () => {
  it('leaves a callee whose free symbol the definition BINDS alone', () => {
    // `Vcap`'s body reads the engine's `k`, and `fcap` binds a PARAMETER of
    // that name. Substituting the body into `fcap` would read the parameter
    // instead of the global — `min(t + 1, …)` for `k = 1` where the value is
    // `min(t + 100, …)`.
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.declare('k', 'number');
    ce.assign('k', ce.number(100));
    ce.box([
      'DefineFunction',
      'Vcap',
      [
        'Function',
        [
          'List',
          ['Add', 't', 'k'],
          ['Add', 't', 'k', 1],
          ['Add', 't', 'k', 2],
          ['Add', 't', 'k', 3],
          ['Add', 't', 'k', 4],
        ],
        't',
      ],
    ]).evaluate();
    ce.box([
      'DefineFunction',
      'fcap',
      ['Function', ['Min', ['Vcap', 't']], 'k', 't'],
    ]).evaluate();

    const r: any = compile(ce.box(['fcap', 'u', 'u']), {
      to: 'javascript',
      fallback: false,
      constantFold: false,
    } as any);
    expect(r.success).not.toBe(false);
    // The global `k`, as the interpreter reads it.
    expect(r.run({ u: 1 })).toBe(101);
    expect(ce.box(['fcap', 1, 1] as any).N().re).toBe(101);
  });

  it('leaves a callee that binds the colliding name with a NON-lambda binder alone', () => {
    // `Vsum`'s body binds `i` as a `Sum` index. Only a lambda parameter
    // counts as shadowing for the capture test (`freeSymbolNames`): a scoped
    // node's bindings are not visible in all of its operands, so its bound
    // names stay reported and the substitution into a definition that binds
    // `i` is declined. The value is right either way; the pin is that the
    // conservative rule declines rather than admits.
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.box([
      'DefineFunction',
      'Vsum',
      [
        'Function',
        [
          'List',
          ['Sum', ['Multiply', 'i', 't'], ['Limits', 'i', 1, 3]],
          ['Add', 't', 1],
          ['Add', 't', 2],
          ['Add', 't', 3],
          ['Add', 't', 4],
        ],
        't',
      ],
    ]).evaluate();
    ce.box([
      'DefineFunction',
      'fsum',
      ['Function', ['Min', ['Vsum', 't']], 'i', 't'],
    ]).evaluate();

    const r: any = compile(ce.box(['fsum', 'u', 'u']), {
      to: 'javascript',
      fallback: false,
      constantFold: false,
    } as any);
    expect(r.success).not.toBe(false);
    expect(r.run({ u: 1 })).toBe(2);
    expect(ce.box(['fsum', 1, 1] as any).N().re).toBe(2);
  });

  it('leaves a callee whose free symbol the definition BINDS alone, whichever argument it is passed', () => {
    // The same shadowing as above, with the colliding name PASSED as the
    // argument: `fcap2(k, t) := Min(Vcap2(k))`. Once `Vcap2`'s body is
    // substituted it reads `[k + k, …]`, where the first `k` is the
    // parameter the argument supplied and the second is the global — two
    // meanings of one name that no test AFTER the substitution can tell
    // apart. The decline is therefore decided on the callee's own body,
    // before the substitution.
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.declare('k', 'number');
    ce.assign('k', ce.number(100));
    ce.box([
      'DefineFunction',
      'Vcap2',
      [
        'Function',
        [
          'List',
          ['Add', 't', 'k'],
          ['Add', 't', 'k', 1],
          ['Add', 't', 'k', 2],
          ['Add', 't', 'k', 3],
          ['Add', 't', 'k', 4],
        ],
        't',
      ],
    ]).evaluate();
    ce.box([
      'DefineFunction',
      'fcap2',
      ['Function', ['Min', ['Vcap2', 'k']], 'k', 't'],
    ]).evaluate();

    const r: any = compile(ce.box(['fcap2', 1, 2] as any), {
      to: 'javascript',
      fallback: false,
      constantFold: false,
    } as any);
    expect(r.success).not.toBe(false);
    // The global `k = 100` added to the argument `1`, as the interpreter
    // reads it — not `1 + 1`.
    expect(r.run({})).toBe(101);
    expect(ce.box(['fcap2', 1, 2] as any).N().re).toBe(101);
  });
});

describe('BY-REFERENCE DEFINITION UNROLL — the angular unit', () => {
  // A callee's body comes from the engine definition, so it has never been
  // through the `rewriteAngularUnit` pass the public `compile()` entries
  // apply to the tree they are handed. Substituting it without that rewrite
  // emitted a radian `Math.sin` for a body the engine reads in degrees.

  it('scales a trig call inside a substituted callee — definition route', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    ce.declare('u', 'number');
    ce.box([
      'DefineFunction',
      'vdeg',
      ['Function', ['List', ['Sin', 't'], 2, 3, 4, 5], 't'],
    ]).evaluate();
    ce.box([
      'DefineFunction',
      'fdeg',
      ['Function', ['Min', ['vdeg', 'x']], 'x'],
    ]).evaluate();

    const r: any = compile(ce.box(['fdeg', 'u']), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);
    expect(sourceOf(r)).not.toContain('_fn_vdeg');
    // sin(30°) = 1/2, the smallest of the five.
    expect(r.run({ u: 30 })).toBeCloseTo(0.5, 12);
    expect(ce.box(['fdeg', 30] as any).N().re).toBeCloseTo(0.5, 12);
  });
});

describe('BY-REFERENCE DEFINITION UNROLL — the capture set', () => {
  it('records a substituted callee in `symbolDeps`', () => {
    // The generated code BAKES the substituted definition, so a cache keyed
    // on the capture set must know the artifact depends on it — even though
    // the emitted source no longer names it. `map-auto-compile.test.ts`
    // checks the recompile this drives.
    const { ce, def } = scalarEngine();
    def('Vdep', FIVE_OF('u'));
    def('ddep', ['Min', ['Vdep', 'u']]);
    const deps = new Set<string>();
    const r: any = compile(ce.box(['ddep', 'u']), {
      to: 'javascript',
      fallback: false,
      symbolDeps: deps,
    } as any);
    expect(r.success).not.toBe(false);

    expect(sourceOf(r)).not.toContain('_fn_Vdep');
    expect([...deps]).toContain('Vdep');
    expect([...deps]).toContain('ddep');
  });
});

describe('BY-REFERENCE DEFINITION UNROLL — numeric parity', () => {
  const SAMPLES: Array<[number, number]> = Array.from(
    { length: 20 },
    (_, i) => [-1 + (i % 5) * 0.37, -0.8 + Math.floor(i / 5) * 0.41]
  );

  it('the by-reference row agrees with the inlined row at 20 sample points', () => {
    const ce = byReferenceEngine();
    const byRef: any = compile(ce.box(['row', 'x', 'y']), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(byRef.success).not.toBe(false);

    const inlineEngine = new ComputeEngine();
    const inlined: any = compile(
      inlineEngine.box(ROW_INLINE('x', 'y') as any),
      {
        to: 'javascript',
        fallback: false,
      } as any
    );
    expect(inlined.success).not.toBe(false);

    for (const [x, y] of SAMPLES) {
      const got = byRef.run({ x, y }) as number;
      const want = inlined.run({ x, y }) as number;
      expect(Number.isFinite(got)).toBe(true);
      expect(Math.abs(got - want)).toBeLessThan(1e-9);
    }
  }, 60000);
});
