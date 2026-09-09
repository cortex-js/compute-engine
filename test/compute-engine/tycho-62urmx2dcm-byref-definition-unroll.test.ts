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

/** The preamble line that defines the emitted function `name`. */
function definitionOf(preamble: string, name: string): string {
  const line = (preamble ?? '')
    .split('\n')
    .find((l) => l.includes(`const _fn_${name} =`));
  expect(line).toBeDefined();
  return line!;
}

/**
 * The preamble from the definition of `name` onwards. A definition whose body
 * is a multi-statement `Block` spans several lines, so it cannot be read with
 * `definitionOf`; the definitions the tests below look for are emitted after
 * it, so the whole tail is the right window.
 */
function definitionFrom(preamble: string, name: string): string {
  const at = (preamble ?? '').indexOf(`const _fn_${name} =`);
  expect(at).toBeGreaterThanOrEqual(0);
  return preamble.slice(at);
}

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

describe('BY-REFERENCE DEFINITION UNROLL — the emitted shapes', () => {
  it('emits `d` as straight-line scalar code', () => {
    const ce = byReferenceEngine();
    const r: any = compile(ce.box(['d', 'x', 'y']), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);

    const d = definitionOf(r.preamble, 'd');
    // The three shapes the runtime collection lowering emits, all gone: the
    // broadcast closure, the point-accessor map and the reduction.
    expect(d).not.toContain('_SYS.bcast');
    expect(d).not.toContain('.map((_pt');
    expect(d).not.toContain('reduce(');
    // `V` was substituted into `d`, so it is not emitted at all.
    expect(r.preamble).not.toContain('const _fn_V =');
  });

  it('emits `m` as an n-ary `Math.min`', () => {
    const ce = byReferenceEngine();
    const r: any = compile(ce.box(['m', 'x', 'y']), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);

    const m = definitionOf(r.preamble, 'm');
    expect(m).toContain('Math.min(');
    expect(m).not.toContain('reduce(');
    expect(m).not.toContain('_SYS.bcast');
  });

  it('leaves a SCALAR callee by reference', () => {
    // A scalar-valued helper compiles by reference on every target, and
    // substituting it would copy a shared definition into each of its
    // callers for nothing.
    const { ce, def } = scalarEngine();
    def('gs', ['Add', ['Multiply', 2, 'u'], 1]);
    def('Vs', FIVE_OF('u'));
    def('fs', ['Add', ['gs', 'u'], ['Min', ['Vs', 'u']]]);
    const r: any = compile(ce.box(['fs', 'u']), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);

    const fs = definitionOf(r.preamble, 'fs');
    // The scalar `gs` stays a call of the shared definition…
    expect(fs).toContain('_fn_gs(');
    expect(r.preamble).toContain('const _fn_gs =');
    // …while the collection-valued `Vs` is substituted and unrolled.
    expect(sourceOf(r)).not.toContain('_fn_Vs');
    expect(fs).toContain('Math.min(');
    expect(r.run({ u: 3 })).toBe(2 * 3 + 1 + Math.min(4, 5, 6, 7, 8));
  });

  it('keeps the whole by-reference row free of runtime collection code', () => {
    const ce = byReferenceEngine();
    const r: any = compile(ce.box(['row', 'x', 'y']), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);

    const source = sourceOf(r);
    expect(source).not.toContain('.map(');
    expect(source).not.toContain('reduce(');
    // Only the three SCALAR definitions of the chain survive.
    expect(r.preamble).not.toContain('const _fn_V =');
    expect(r.preamble).not.toContain('const _fn_d =');
    expect(r.preamble).not.toContain('const _fn_d2 =');
    expect(r.preamble).toContain('const _fn_m =');
    expect(r.preamble).toContain('const _fn_m2 =');
    expect(r.preamble).toContain('const _fn_row =');
  });
});

describe('BY-REFERENCE DEFINITION UNROLL — what stays by reference', () => {
  it('leaves an IMPURE collection-valued callee alone', () => {
    // Substitution repeats the body at every occurrence of the call, so a
    // `Random()` inside it would be drawn once per occurrence where the
    // by-reference call draws once.
    const { ce, def } = scalarEngine();
    def('Vimp', [
      'List',
      ['Random'],
      ['Add', 'u', 1],
      ['Add', 'u', 2],
      ['Add', 'u', 3],
      ['Add', 'u', 4],
    ]);
    def('dimp', ['Min', ['Vimp', 'u']]);
    const r: any = compile(ce.box(['dimp', 'u']), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);

    expect(r.preamble).toContain('const _fn_Vimp =');
    expect(definitionOf(r.preamble, 'dimp')).toContain('_fn_Vimp');
  });

  it('leaves a RECURSIVE collection-valued callee alone', () => {
    const { ce, def } = scalarEngine();
    def('Vrec', [
      'If',
      ['LessEqual', 'u', 0],
      ['List', 1, 2, 3, 4, 5],
      ['Vrec', ['Subtract', 'u', 1]],
    ]);
    def('drec', ['Min', ['Vrec', 'u']]);
    const r: any = compile(ce.box(['drec', 'u']), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);

    expect(r.preamble).toContain('const _fn_Vrec =');
    expect(definitionOf(r.preamble, 'drec')).toContain('_fn_Vrec');
  });

  it('leaves a GENERIC collection-valued callee alone', () => {
    // A polytype's parameters are open type variables: there are no ground
    // types to substitute into.
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.declare('Vgen', '(x: T) -> list<T> where T: number');
    ce.assign('Vgen', ce.box(['Function', FIVE_OF('x'), 'x'] as any));
    ce.box([
      'DefineFunction',
      'dgen',
      ['Function', ['Min', ['Vgen', 'u']], 'u'],
    ]).evaluate();
    const r: any = compile(ce.box(['dgen', 'u']), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);

    expect(r.preamble).toContain('const _fn_Vgen =');
    expect(definitionOf(r.preamble, 'dgen')).toContain('_fn_Vgen');
    expect(r.run({ u: 3 })).toBe(4);
  });
});

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
    expect(r.preamble).toContain('const _fn_Vcap =');
    expect(definitionOf(r.preamble, 'fcap')).toContain('_fn_Vcap');
    // The global `k`, as the interpreter reads it.
    expect(r.run({ u: 1 })).toBe(101);
    expect(ce.box(['fcap', 1, 1] as any).N().re).toBe(101);
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
    expect(r.preamble).toContain('const _fn_Vcap2 =');
    expect(definitionOf(r.preamble, 'fcap2')).toContain('_fn_Vcap2');
    // The global `k = 100` added to the argument `1`, as the interpreter
    // reads it — not `1 + 1`.
    expect(r.run({})).toBe(101);
    expect(ce.box(['fcap2', 1, 2] as any).N().re).toBe(101);
  });

  it('fails closed on a callee that is a PARAMETER of the definition', () => {
    // `qsh` takes its callee as its first parameter, and an engine-level
    // `Vsh` of the same name exists beside it. `subs` rewrites symbol
    // occurrences and never a head, so a substituted body would call the
    // engine's `Vsh` and ignore the argument. The compiler has no lowering
    // for a call of a bound parameter, so the whole compilation declines and
    // the interpreter evaluates it instead (user ruling 2026-08-14, whose
    // scalar case is pinned in `compile-cse.test.ts`).
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.box([
      'DefineFunction',
      'Vsh',
      ['Function', FIVE_OF('t'), 't'],
    ]).evaluate();
    ce.assign(
      'qsh',
      ce.box(['Function', ['Min', ['Vsh', 't']], 'Vsh', 't'] as any)
    );

    expect(() =>
      compile(ce.box(['qsh', 'u', 'u']), {
        to: 'javascript',
        fallback: false,
      } as any)
    ).toThrow(/^Vsh: cannot compile/);

    const fallback: any = compile(ce.box(['qsh', 'u', 'u']), {
      to: 'javascript',
    } as any);
    expect(fallback.success).toBe(false);
    expect(fallback.code ?? '').not.toContain('Math.min(');
  });

  it('leaves a callee whose free symbol a BLOCK-LOCAL shadows alone', () => {
    // A block-local shadows the engine exactly as a parameter does. `Vblk`
    // reads the global `k = 100`, and `fblk` declares a LOCAL of that name
    // holding `x + 1`. A substituted body would read the local for both
    // occurrences — `min((x + 1) + (x + 1), …)`, which is 2 at `x = 0` where
    // the value is 101.
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.declare('k', 'number');
    ce.assign('k', ce.number(100));
    ce.box([
      'DefineFunction',
      'Vblk',
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
    ce.assign(
      'fblk',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'k', 'number'],
          ['Assign', 'k', ['Add', 'x', 1]],
          ['Min', ['Vblk', 'k']],
        ],
        'x',
      ] as any)
    );

    const r: any = compile(ce.box(['fblk', 'u']), {
      to: 'javascript',
      fallback: false,
      constantFold: false,
    } as any);
    expect(r.success).not.toBe(false);
    expect(r.preamble).toContain('const _fn_Vblk =');
    expect(definitionFrom(r.preamble, 'fblk')).toContain('_fn_Vblk');
    expect(r.run({ u: 0 })).toBe(101);
    expect(ce.box(['fblk', 0] as any).N().re).toBe(101);
  });
});

describe('BY-REFERENCE DEFINITION UNROLL — a multi-statement body', () => {
  it('substitutes a nested call in every statement of a `Block` body', () => {
    // A function body of several statements is a `Block` that binds the
    // parameters and its own locals. Each statement is substituted on its
    // own and the `Block` is rebuilt onto its own scope, so a nested
    // collection-valued call reached through a local is unrolled like any
    // other.
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.box([
      'DefineFunction',
      'Vloc',
      ['Function', FIVE_OF('t'), 't'],
    ]).evaluate();
    ce.assign(
      'floc',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'w', 'number'],
          ['Assign', 'w', ['Add', 'x', 1]],
          ['Min', ['Vloc', 'w']],
        ],
        'x',
      ] as any)
    );

    const r: any = compile(ce.box(['floc', 'u']), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);

    const floc = definitionFrom(r.preamble, 'floc');
    expect(floc).toContain('Math.min(');
    expect(floc).not.toContain('reduce(');
    expect(floc).not.toContain('_SYS.bcastFn');
    expect(sourceOf(r)).not.toContain('_fn_Vloc');
    // `min(w + 1, …, w + 5)` for `w = u + 1`.
    expect(r.run({ u: 3 })).toBe(5);
    expect(ce.box(['floc', 3] as any).N().re).toBe(5);
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

  it('scales a trig call inside a substituted callee — inline route', () => {
    // A point-typed parameter has no static GLSL type, so the definition
    // cannot be emitted and the CALL is inlined instead
    // (`tryInlineUserFunctionCall`, Tycho item 216). That route substitutes
    // the same body and needs the same rewrite.
    const withUnit = (unit: 'deg' | 'rad') => {
      const ce = new ComputeEngine();
      ce.angularUnit = unit;
      ce.parse(String.raw`f(P) := \sin(P.x) + P.y`).evaluate();
      const viaCall: any = compile(ce.parse(String.raw`f((x,y))`), {
        to: 'glsl',
      } as any);
      // The same body written with no user function at all: the reference
      // this route has to reproduce.
      const direct = new ComputeEngine();
      direct.angularUnit = unit;
      const written: any = compile(direct.parse(String.raw`\sin(x) + y`), {
        to: 'glsl',
      } as any);
      return { viaCall: String(viaCall.code), written: String(written.code) };
    };

    const deg = withUnit('deg');
    expect(deg.viaCall).toContain('0.017453292519943295');
    expect(deg.viaCall).toBe(deg.written);

    // Radian mode is the no-op case: no factor, and nothing changed.
    const rad = withUnit('rad');
    expect(rad.viaCall).not.toContain('0.017453292519943295');
    expect(rad.viaCall).toBe(rad.written);
    expect(rad.viaCall).toBe('y + sin(x)');
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
