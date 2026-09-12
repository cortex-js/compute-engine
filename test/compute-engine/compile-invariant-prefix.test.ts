/**
 * INVARIANT PREFIXES of a user function, reused across the calls of a
 * repetition site.
 *
 * A definition body is compiled once and called from every term of a `Sum`,
 * so a subexpression of the body that reads one parameter only is evaluated
 * again on every call even when every call passes that parameter the same
 * value. An exoplanet transit kernel called `S(r_i, t)` forty times per sample
 * and recomputed the transcendental `m(t)` forty times (Tycho code-generation
 * audit of 0.128.9, records 178–183). Ordinary CSE cannot reach it: the
 * repetition is inside the callee.
 *
 * The compiler now reads the callee's INVARIANT PREFIXES — its expensive
 * subexpressions that depend on a strict subset of the parameters
 * (`BaseCompiler.invariantPrefixes`) — and, at a repetition site whose call
 * passes those parameters the same arguments on every repetition, evaluates
 * each prefix once before the repetitions and calls a VARIANT of the callee
 * (`_fn_S$inv0`) that takes the prefix values as extra parameters.
 *
 * The spine of every case is INTERPRETER PARITY; the emitted shape is
 * asserted where it is the point.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import type { CompileTarget } from '../../src/compute-engine/compilation/types';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('k', 'real');
ce.declare('n', 'integer');

const fn = (body: unknown, ...params: string[]) =>
  ce.expr(['Function', body, ...params.map((p) => ['Typed', p, 'real'])]);
const def = (name: string, body: unknown, ...params: string[]): void => {
  ce.declare(name, 'function');
  ce.assign(name, fn(body, ...params));
};

// The transit kernel: X(t), m(t) = √(0.81 + X(t)²), S(r, t) reads m(t) twice.
const TWO_PI_T = ['Divide', ['Multiply', 2, 'Pi', 't'], 100];
def('X', ['Multiply', -10, ['Cos', TWO_PI_T]], 't');
def('m', ['Sqrt', ['Add', 0.81, ['Square', ['X', 't']]]], 't');
def(
  'S',
  [
    'Multiply',
    2,
    [
      'Arccos',
      [
        'Clamp',
        [
          'Divide',
          [
            'Add',
            ['Multiply', 9, ['Square', 'r']],
            -1.69,
            ['Square', ['m', 't']],
          ],
          ['Multiply', 6, 'r', ['m', 't']],
        ],
        -1,
        1,
      ],
    ],
  ],
  'r',
  't'
);
const R_I = ['Divide', ['Subtract', 'i', 0.5], 40];
const TERM = [
  'Divide',
  [
    'Multiply',
    ['Subtract', 'i', 0.5],
    [
      'Subtract',
      1,
      [
        'Multiply',
        'k',
        ['Subtract', 1, ['Sqrt', ['Subtract', 1, ['Square', R_I]]]],
      ],
    ],
    ['S', R_I, 't'],
  ],
  1600,
];
def(
  'B',
  [
    'Divide',
    ['Sum', TERM, ['Limits', 'i', 1, 40]],
    ['Multiply', 'Pi', ['Subtract', 1, ['Divide', 'k', 3]]],
  ],
  't',
  'k'
);

function compiled(
  json: unknown,
  options: { to?: 'javascript' | 'interval-js'; cse?: boolean } = {}
) {
  const r = compile(ce.box(json), { fallback: false, ...options });
  if (r === undefined) throw new Error('compile() returned undefined');
  expect(r.success).toBe(true);
  return {
    source: (r.preamble ?? '') + r.code,
    preamble: r.preamble ?? '',
    run: r.run!,
  };
}

/** The interpreter's value of `json` with the given values substituted. */
function interpreted(json: unknown, vars: Record<string, number>): number {
  const substitution = Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [k, ce.number(v)])
  );
  return ce.box(json).subs(substitution).N().valueOf() as number;
}

const definitionOf = (preamble: string, name: string): string =>
  preamble.split('\n').find((l) => l.startsWith(`const ${name} =`)) ?? '';

describe('Invariant prefix reuse across the calls of a repetition site', () => {
  test('the transit kernel evaluates m(t) once per sample, not once per term', () => {
    const json = ['B', ['Multiply', 5, ['Add', 'x', 5]], 'k'];
    const { preamble, run } = compiled(json);
    const b = definitionOf(preamble, '_fn_B');
    expect(b).not.toBe('');
    // Forty calls of the variant, one evaluation of the prefix.
    expect(b.match(/_fn_S\$inv0\(/g)).toHaveLength(40);
    expect(b.match(/_fn_m\(/g)).toHaveLength(1);
    // The variant reads its third parameter where the body read m(t).
    const variant = definitionOf(preamble, '_fn_S$inv0');
    expect(variant).toMatch(/^const _fn_S\$inv0 = \(r, t, \w+\) =>/);
    expect(variant).not.toContain('_fn_m(');
    // The ordinary definition is no longer referenced and is not emitted.
    expect(definitionOf(preamble, '_fn_S')).toBe('');
    expect(run({ x: 0.3, k: 0.6 })).toBeCloseTo(
      interpreted(json, { x: 0.3, k: 0.6 }),
      12
    );
    expect(run({ x: -2, k: 0.1 })).toBeCloseTo(
      interpreted(json, { x: -2, k: 0.1 }),
      12
    );
  });

  test('a loop-form Sum binds the prefix behind the empty-range guard', () => {
    // A symbolic upper bound keeps the Sum a LOOP.
    const json = [
      'Sum',
      ['S', ['Divide', 'i', 'n'], 'x'],
      ['Limits', 'i', 1, 'n'],
    ];
    const { source, run } = compiled(json);
    expect(source).toContain('_fn_S$inv0(');
    expect(source.match(/_fn_m\(/g)).toHaveLength(1);
    expect(run({ x: 2, n: 0 })).toBe(0);
    expect(run({ x: 2, n: 5 })).toBeCloseTo(
      interpreted(json, { x: 2, n: 5 }),
      12
    );
  });

  test('interval-js takes the same variant', () => {
    const json = ['B', ['Multiply', 5, ['Add', 'x', 5]], 'k'];
    const { preamble, run } = compiled(json, { to: 'interval-js' });
    expect(
      definitionOf(preamble, '_fn_B').match(/_fn_S\$inv0\(/g)
    ).toHaveLength(40);
    expect(definitionOf(preamble, '_fn_B').match(/_fn_m\(/g)).toHaveLength(1);
    const v: any = run({ x: { lo: 0.3, hi: 0.3 }, k: { lo: 0.6, hi: 0.6 } });
    const { lo, hi } = v.value ?? v;
    const value = interpreted(json, { x: 0.3, k: 0.6 });
    expect(lo).toBeLessThanOrEqual(value);
    expect(hi).toBeGreaterThanOrEqual(value);
  });

  test('a prefix in a conditional arm reads the parameter too', () => {
    // m(t) is evaluated unconditionally in the first summand, so the
    // occurrence inside the If arm reads the same extra parameter.
    def(
      'C',
      ['Add', ['m', 't'], ['If', ['Greater', 'r', 0.5], ['m', 't'], 0]],
      'r',
      't'
    );
    const json = ['Sum', ['C', ['Divide', 'i', 4], 'x'], ['Limits', 'i', 1, 4]];
    const { preamble, run } = compiled(json);
    const variant = definitionOf(preamble, '_fn_C$inv0');
    expect(variant).not.toBe('');
    expect(variant).not.toContain('_fn_m(');
    expect(run({ x: 1.5 })).toBeCloseTo(interpreted(json, { x: 1.5 }), 12);
  });

  test('two prefixes over different parameters; a site hoists only the invariant ones', () => {
    // m(t)·r reads r, so m(t) and m(u) are two separate prefixes.
    def('G', ['Add', ['Multiply', ['m', 't'], 'r'], ['m', 'u']], 'r', 't', 'u');
    const both = ['Sum', ['G', 'i', 'x', 'k'], ['Limits', 'i', 1, 5]];
    const one = [
      'Sum',
      ['G', 'i', 'x', ['Multiply', 'i', 'k']],
      ['Limits', 'i', 1, 5],
    ];
    const a = compiled(both);
    expect(definitionOf(a.preamble, '_fn_G$inv0_1')).toMatch(
      /\(r, t, u, \w+, \w+\) =>/
    );
    expect(a.run({ x: 0.5, k: 0.7 })).toBeCloseTo(
      interpreted(both, { x: 0.5, k: 0.7 }),
      12
    );
    const b = compiled(one);
    const variant = definitionOf(b.preamble, '_fn_G$inv0');
    expect(variant).toMatch(/\(r, t, u, \w+\) =>/);
    // m(u) still varies with the term, so the variant computes it itself.
    expect(variant.match(/_fn_m\(/g)).toHaveLength(1);
    expect(b.run({ x: 0.5, k: 0.7 })).toBeCloseTo(
      interpreted(one, { x: 0.5, k: 0.7 }),
      12
    );
  });

  test('a maximal prefix is taken whole, so a site where part of it varies hoists nothing', () => {
    // m(t)·m(u) reads {t, u}, a strict subset of {r, t, u}: ONE prefix.
    def('P', ['Add', ['Multiply', ['m', 't'], ['m', 'u']], 'r'], 'r', 't', 'u');
    const both = ['Sum', ['P', 'i', 'x', 'k'], ['Limits', 'i', 1, 5]];
    const a = compiled(both);
    expect(definitionOf(a.preamble, '_fn_P$inv0')).toMatch(
      /\(r, t, u, \w+\) =>/
    );
    expect(a.run({ x: 0.5, k: 0.7 })).toBeCloseTo(
      interpreted(both, { x: 0.5, k: 0.7 }),
      12
    );
    const one = [
      'Sum',
      ['P', 'i', 'x', ['Multiply', 'i', 'k']],
      ['Limits', 'i', 1, 5],
    ];
    const b = compiled(one);
    expect(b.source).not.toContain('$inv');
  });

  test('a Map lambda binds the prefix on the first element, so an empty source evaluates nothing', () => {
    ce.declare('xs', 'list<real>');
    const json = ['Map', ['Function', ['S', 'e', 'x'], 'e'], 'xs'];
    const { source, run } = compiled(json);
    expect(source).toContain('_fn_S$inv0(');
    expect(run({ x: 2, xs: [] })).toEqual([]);
    const got = run({ x: 2, xs: [0.1, 0.2, 0.3] }) as number[];
    [0.1, 0.2, 0.3].forEach((e, i) =>
      expect(got[i]).toBeCloseTo(interpreted(['S', e, 2], {}), 12)
    );
  });

  test('a Comprehension binds the prefix on the first element', () => {
    const json = ['Comprehension', ['S', 'e', 'x'], ['Element', 'e', 'xs']];
    const { source, run } = compiled(json);
    expect(source).toContain('_fn_S$inv0(');
    expect(run({ x: 2, xs: [] })).toEqual([]);
    const got = run({ x: 2, xs: [0.1, 0.2] }) as number[];
    [0.1, 0.2].forEach((e, i) =>
      expect(got[i]).toBeCloseTo(interpreted(['S', e, 2], {}), 12)
    );
  });

  test('a call outside the repetition keeps the ordinary definition beside the variant', () => {
    const json = ['Add', ['B', 'x', 'k'], ['S', 'x', 'k']];
    const { preamble, run } = compiled(json);
    expect(definitionOf(preamble, '_fn_S')).not.toBe('');
    expect(definitionOf(preamble, '_fn_S$inv0')).not.toBe('');
    expect(run({ x: 0.3, k: 0.6 })).toBeCloseTo(
      interpreted(json, { x: 0.3, k: 0.6 }),
      12
    );
  });

  test('a collection-valued prefix reaches the variant whole, never broadcast over', () => {
    // The body indexes a list built from t alone: the list is the prefix,
    // and the variant must receive it as one argument.
    ce.declare('T2', 'function');
    ce.assign(
      'T2',
      ce.expr([
        'Function',
        ['At', ['List', ['Sin', 't'], ['Cos', 't']], 'r'],
        ['Typed', 'r', 'integer'],
        ['Typed', 't', 'real'],
      ])
    );
    const json = ['Sum', ['T2', 'i', 'x'], ['Limits', 'i', 1, 2]];
    const { source, run } = compiled(json);
    expect(source).toContain('_fn_T2$inv0(');
    expect(run({ x: 0.7 })).toBeCloseTo(Math.sin(0.7) + Math.cos(0.7), 12);
    // A list-returning helper as the prefix.
    ce.declare('pair', 'function');
    ce.assign(
      'pair',
      ce.expr([
        'Function',
        ['List', ['Sin', 't'], ['Cos', 't']],
        ['Typed', 't', 'real'],
      ])
    );
    ce.declare('T3', 'function');
    ce.assign(
      'T3',
      ce.expr([
        'Function',
        ['At', ['pair', 't'], 'r'],
        ['Typed', 'r', 'integer'],
        ['Typed', 't', 'real'],
      ])
    );
    const json3 = ['Sum', ['T3', 'i', 'x'], ['Limits', 'i', 1, 2]];
    const r3 = compiled(json3);
    expect(r3.run({ x: 0.7 })).toBeCloseTo(Math.sin(0.7) + Math.cos(0.7), 12);
  });

  test('a call outside a repetition site calls the ordinary definition', () => {
    const json = ['S', 'x', 'k'];
    const { source } = compiled(json);
    expect(source).toContain('_fn_S(');
    expect(source).not.toContain('$inv');
  });

  test('with `cse: false` nothing is hoisted', () => {
    const json = ['B', ['Multiply', 5, ['Add', 'x', 5]], 'k'];
    const { source, run } = compiled(json, { cse: false });
    expect(source).not.toContain('$inv');
    expect(run({ x: 0.3, k: 0.6 })).toBeCloseTo(
      interpreted(json, { x: 0.3, k: 0.6 }),
      12
    );
  });

  test.each(['glsl', 'wgsl'] as const)(
    'the %s target takes the prefix as an extra typed parameter',
    (to) => {
      const r = compile(ce.box(['B', 'x', 'k']), { to, fallback: false });
      expect(r.success).toBe(true);
      const source = (r.preamble ?? '') + r.code;
      const lines = source.split('\n');
      // The variant's signature carries the extra parameter, typed as the
      // hoisted value: `float _fn_S_inv0(float r, float t, float _tv3)` /
      // `fn _fn_S_inv0(r: f32, t: f32, _tv3: f32) -> f32`.
      const signature = lines.find(
        (l) => /_fn_S_inv0\(/.test(l) && /^(float|fn) /.test(l)
      );
      expect(signature).toMatch(
        to === 'glsl'
          ? /^float _fn_S_inv0\(float r, float t, float \w+\) \{/
          : /^fn _fn_S_inv0\(r: f32, t: f32, \w+: f32\) -> f32 \{/
      );
      // `_fn_B` binds m(t) once and calls the variant forty times; the
      // ordinary `_fn_S`, which nothing references, is not emitted.
      const bStart = lines.findIndex((l) => /^(float|fn) _fn_B\(/.test(l));
      const bBody = lines.slice(bStart).join('\n');
      expect(bBody.match(/_fn_m\(/g)).toHaveLength(1);
      expect(bBody.match(/_fn_S_inv0\(/g)).toHaveLength(40);
      expect(source).not.toMatch(/^(float|fn) _fn_S\(/m);
      // The statement structure the shader validity audit checks.
      expect(source).not.toContain(';;');
    }
  );

  test('a shader target keeps the ordinary call for a call outside a repetition', () => {
    const r = compile(ce.box(['S', 'x', 'k']), { to: 'glsl', fallback: false });
    expect(r.success).toBe(true);
    const source = (r.preamble ?? '') + r.code;
    expect(source).toMatch(/^float _fn_S\(float r, float t\)/m);
    expect(source).not.toContain('_inv');
  });
});

describe('Pruning of unreferenced variants and their bases', () => {
  type Registry = NonNullable<CompileTarget<any>['userFunctions']>;
  const registry = (
    defs: Record<string, string>,
    variants: Record<string, string>
  ): Registry => ({
    defs: new Map(Object.entries(defs)),
    compiling: new Set(),
    variantBases: new Map(Object.entries(variants)),
  });
  const DEFS = {
    _fn_g: 'const _fn_g = (t) => t + 1;',
    _fn_f: 'const _fn_f = (r, t) => r * _fn_g(t);',
    _fn_f$inv0: 'const _fn_f$inv0 = (r, t, _tv1) => r * _tv1;',
  };
  const VARIANTS = { _fn_f$inv0: '_fn_f' };

  test('a base every call of which took the variant is dropped', () => {
    const r = registry(DEFS, VARIANTS);
    BaseCompiler.pruneUnreferencedVariantBases(r, '_fn_f$inv0(1, x, _tv1)');
    expect([...r.defs.keys()]).toEqual(['_fn_g', '_fn_f$inv0']);
  });

  test('a variant no call site took is dropped, and the base stays', () => {
    const r = registry(DEFS, VARIANTS);
    BaseCompiler.pruneUnreferencedVariantBases(r, '_fn_f(1, x)');
    expect([...r.defs.keys()]).toEqual(['_fn_g', '_fn_f']);
  });

  test('a base referenced by another definition stays', () => {
    const r = registry(
      { ...DEFS, _fn_h: 'const _fn_h = (t) => _fn_f(2, t);' },
      VARIANTS
    );
    BaseCompiler.pruneUnreferencedVariantBases(r, '_fn_f$inv0(1, x, _tv1)');
    expect(r.defs.has('_fn_f')).toBe(true);
  });

  test('a definition whose name merely contains `_inv` is never a candidate', () => {
    const r = registry(
      {
        _fn_A: 'const _fn_A = (t) => t;',
        _fn_A_inv1: 'const _fn_A_inv1 = (t) => 1 / t;',
      },
      {}
    );
    BaseCompiler.pruneUnreferencedVariantBases(r, '_fn_A_inv1(x)');
    expect([...r.defs.keys()]).toEqual(['_fn_A', '_fn_A_inv1']);
  });
});

describe('Invariant prefix reuse — what is NOT hoisted', () => {
  test('an argument that varies with the term', () => {
    // The prefix reads t; here t receives the index.
    const json = [
      'Sum',
      ['S', 'x', ['Divide', 'i', 10]],
      ['Limits', 'i', 1, 5],
    ];
    const { source, run } = compiled(json);
    expect(source).not.toContain('$inv');
    expect(run({ x: 0.5 })).toBeCloseTo(interpreted(json, { x: 0.5 }), 12);
  });

  test('an impure argument', () => {
    const json = [
      'Sum',
      ['S', ['Divide', 'i', 10], ['Random']],
      ['Limits', 'i', 1, 5],
    ];
    const { source } = compiled(json);
    expect(source).not.toContain('$inv');
  });

  test('an impure prefix', () => {
    def('noise', ['Multiply', ['Random'], 't'], 't');
    def('N', ['Multiply', 'r', ['Cos', ['noise', 't']]], 'r', 't');
    const json = ['Sum', ['N', 'i', 'x'], ['Limits', 'i', 1, 5]];
    const { source } = compiled(json);
    expect(source).not.toContain('$inv');
  });

  test('a subexpression that reads every parameter', () => {
    def('A', ['Multiply', 2, ['Cos', ['m', ['Multiply', 'r', 't']]]], 'r', 't');
    const json = [
      'Sum',
      ['A', ['Divide', 'i', 10], 'x'],
      ['Limits', 'i', 1, 5],
    ];
    const { source, run } = compiled(json);
    expect(source).not.toContain('$inv');
    expect(run({ x: 0.5 })).toBeCloseTo(interpreted(json, { x: 0.5 }), 12);
  });

  test('a subexpression that reads a block local', () => {
    def(
      'L',
      [
        'Block',
        ['Declare', 'a', "'real'"],
        ['Assign', 'a', ['Add', 't', 'r']],
        ['Multiply', 'r', ['m', 'a']],
      ],
      'r',
      't'
    );
    const json = [
      'Sum',
      ['L', ['Divide', 'i', 10], 'x'],
      ['Limits', 'i', 1, 5],
    ];
    const { source, run } = compiled(json);
    expect(source).not.toContain('$inv');
    expect(run({ x: 0.5 })).toBeCloseTo(interpreted(json, { x: 0.5 }), 12);
  });

  test('a recursive callee', () => {
    def(
      'F',
      [
        'Add',
        ['m', 't'],
        ['If', ['LessEqual', 'r', 0], 0, ['F', ['Subtract', 'r', 1], 't']],
      ],
      'r',
      't'
    );
    const json = ['Sum', ['F', 'i', 'x'], ['Limits', 'i', 1, 3]];
    const { source, run } = compiled(json);
    expect(source).not.toContain('$inv');
    expect(run({ x: 0.5 })).toBeCloseTo(interpreted(json, { x: 0.5 }), 12);
  });

  test('a prefix reading a global the call site binds is not captured', () => {
    // H reads the GLOBAL g; the Sum index at the call site is also named g.
    ce.assign('g', 3);
    def('H', ['Add', 'r', ['Multiply', ['m', 't'], 'g']], 'r', 't');
    const json = ['Sum', ['H', 'g', 'x'], ['Limits', 'g', 1, 4]];
    const { source, run } = compiled(json);
    expect(source).not.toContain('$inv');
    expect(run({ x: 0.5 })).toBeCloseTo(interpreted(json, { x: 0.5 }), 12);
  });

  test('a one-parameter callee has no strict subset to hoist', () => {
    const json = ['Sum', ['m', ['Multiply', 'x', 'i']], ['Limits', 'i', 1, 5]];
    const { source } = compiled(json);
    expect(source).not.toContain('$inv');
  });
});
