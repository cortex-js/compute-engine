/**
 * ROADMAP CE-564.3 and CE-564.4: two rows of the Tycho code-generation
 * census that compiled on 2026-09-16 and declined at 0.171.0.
 *
 * CE-564.3. `f(x, n) := 1/mod(f(x, n - 1), 1)` with `f(x, 0) = x` declined
 * on interval-js with "an object-domain absent ('missing') position". In the
 * body, the recursive call `f(x, n - 1)` is typed `unknown`, so `Mod` over it
 * has the open form `R | tuple | list<R | tuple | list<any>>` with
 * `R = real | nan | missing`. The compiled lanes read that form as
 * `broadcastable<R>` (`resolveTypeForCompiledLanes`). The type is built with
 * nested unions, `(real | nan) | (tuple | missing) | list<…>`, and
 * `openDepthScalarArms` read the arm `tuple | missing` as a scalar arm, so
 * the lanes read `broadcastable<missing | nan | real | tuple>` and the
 * absence check refused the `tuple` arm.
 *
 * CE-564.4. `R(V, θ) := [Σ V·[cos θ, -sin θ], Σ V·[sin θ, cos θ]]` called with
 * a list `V`. Tycho declares `R` with the bare type `function` and assigns
 * the literal. The compiler read the parameter types from the parameter
 * symbols (`V: number`, narrowed by the use `V·[…]`), not from the
 * literal's signature (`V: collection<any> | value`): JavaScript emitted the
 * body as scalar arithmetic over the array and answered `NaN`, and GLSL
 * refused the `vec2` argument at a `float` parameter. GLSL now emits a copy
 * of `R` with a `vec2` parameter. A list argument that no specialization
 * takes is inlined, or the call fails closed: interval-js answered an empty
 * interval. interval-js now emits a copy of `R` typed by the list argument,
 * as javascript does (ROADMAP CE-564).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { parseType } from '../../src/common/type/parse';
import { widen } from '../../src/common/type/subtype';
import {
  openDepthScalarArms,
  resolveTypeForCompiledLanes,
} from '../../src/common/type/utils';
import { typeToString } from '../../src/common/type/serialize';
import type { Type } from '../../src/common/type/types';

const R_LITERAL = [
  'Function',
  [
    'Block',
    [
      'List',
      [
        'Sum',
        ['Multiply', 'V', ['List', ['Cos', 't'], ['Negate', ['Sin', 't']]]],
      ],
      ['Sum', ['Multiply', 'V', ['List', ['Sin', 't'], ['Cos', 't']]]],
    ],
  ],
  'V',
  't',
] as const;

const F_LITERAL = [
  'Function',
  [
    'Block',
    [
      'Which',
      ['Equal', 'n', 0],
      'x',
      'True',
      ['Divide', 1, ['Mod', ['f', 'x', ['Add', 'n', -1]], 1]],
    ],
  ],
  'x',
  'n',
] as const;

/** An engine with `R` defined by one of the two definition routes. */
function engineWithR(route: 'declared-function' | 'assigned'): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('phi', 'real');
  if (route === 'declared-function') ce.declare('R', 'function');
  ce.assign('R', ce.box(R_LITERAL as any));
  return ce;
}

describe('the join does not depend on the order of its operands', () => {
  // `widen(nan, real)` was `number`, the common supertype of the two, while
  // a union operand was joined as a whole and kept the `nan` arm, so
  // `widen(missing, nan, real)` gave `missing | nan | real` and
  // `widen(nan, real, missing)` gave `missing | number`. Now `nan` beside
  // another number type is an arm of its own in both steps, and the arms
  // of a union are joined one by one. An infinity still joins a finite
  // type at `number` (`lattice-phase0.test.ts`).
  const permutations = <T>(xs: T[]): T[][] =>
    xs.length <= 1
      ? [xs]
      : xs.flatMap((x, i) =>
          permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [
            x,
            ...p,
          ])
        );
  const cases: [string[], string][] = [
    [['missing', 'nan', 'real'], 'missing | nan | real'],
    [['integer', 'nan', 'missing'], 'integer | missing | nan'],
    [['real', 'complex', 'nan'], 'complex | nan'],
    [['real', 'nan', 'tuple<real, real>'], 'nan | real | tuple<real, real>'],
    [['integer', 'nan', 'list<integer>'], 'integer | list<integer> | nan'],
    [['integer', 'string', 'real'], 'real | string'],
    [['real', 'nan', 'missing', 'string'], 'missing | nan | real | string'],
    // A finite type joined with an infinity is `number`, which holds `nan`.
    [['integer', '+oo', 'nan'], 'number'],
    // Two arms of one union are not joined through a third arm: `integer`
    // is absorbed by `real`, and that `real` is not joined with `+oo` or
    // `-oo`, the other arms of the same union.
    [
      ['real | signed_infinity', 'integer | missing'],
      'missing | real | signed_infinity',
    ],
    [
      ['real | signed_infinity', 'integer | string'],
      'real | signed_infinity | string',
    ],
  ];
  for (const [arms, expected] of cases) {
    test(`every order of ${arms.join(', ')}`, () => {
      const results = new Set(
        permutations(arms).map((p) =>
          typeToString(widen(...p.map((t) => parseType(t))))
        )
      );
      expect([...results]).toEqual([expected]);
    });
  }

  test('an absence arm of a union is kept', () => {
    expect(
      typeToString(widen(parseType('integer | nothing'), parseType('string')))
    ).toMatch(/nothing/);
  });

  test('a non-finite number value and a string spelled like it are two arms', () => {
    // The de-duplication key of a union arm wrote a non-finite number as
    // the string `#Infinity`, which is also the key of the string literal
    // type `'#Infinity'`, so the union kept only one of the two.
    const num = (value: number): Type => ({ kind: 'value', value });
    const str = (value: string): Type => ({ kind: 'value', value });
    for (const [n, s] of [
      [Infinity, '#Infinity'],
      [-Infinity, '#-Infinity'],
      [NaN, '#NaN'],
    ] as [number, string][]) {
      for (const t of [widen(num(n), str(s)), widen(str(s), num(n))]) {
        expect(typeof t === 'object' && t.kind === 'union').toBe(true);
        if (typeof t === 'object' && t.kind === 'union')
          expect(t.types.length).toBe(2);
      }
    }
  });
});

describe('CE-564.3: the open form built with nested unions', () => {
  test('openDepthScalarArms reads the arms of a nested union', () => {
    const nested: Type = {
      kind: 'union',
      types: [
        { kind: 'union', types: ['real', 'nan'] },
        { kind: 'union', types: ['tuple', 'missing'] },
        {
          kind: 'list',
          elements: {
            kind: 'union',
            types: [
              { kind: 'union', types: ['real', 'nan'] },
              { kind: 'union', types: ['tuple', 'missing'] },
              { kind: 'list', elements: 'any' },
            ],
          },
        },
      ],
    };
    const flat = parseType(
      'list<list<any> | missing | nan | real | tuple> | missing | nan | real | tuple'
    );
    // Both spellings are of the open form, and neither has a `tuple` arm
    // among its scalar arms: the compiled lanes read each as a
    // `broadcastable<…>` of numbers that may be absent.
    for (const t of [nested, flat]) {
      const arms = openDepthScalarArms(t);
      expect(arms).toBeDefined();
      expect(typeToString(arms!)).not.toMatch(/tuple/);
      const lanes = typeToString(resolveTypeForCompiledLanes(t));
      expect(lanes).toMatch(/^broadcastable<missing \| /);
      expect(lanes).not.toMatch(/tuple/);
    }
  });

  for (const route of ['declared-function', 'assigned'] as const) {
    test(`a recursive call inside Mod compiles on interval-js (${route})`, () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      if (route === 'declared-function') ce.declare('f', 'function');
      ce.assign('f', ce.box(F_LITERAL as any));
      for (const [k, expected] of [
        [0, 0.3],
        [1, 1 / 0.3],
        [2, 3],
      ] as const) {
        const result = compile(ce.box(['f', 'x', k]) as any, {
          to: 'interval-js',
        });
        expect(result.success).toBe(true);
        const value = result.run!({ x: 0.3 }) as any;
        expect(value.kind).toBe('interval');
        expect(value.value.lo).toBeLessThanOrEqual(expected + 1e-9);
        expect(value.value.hi).toBeGreaterThanOrEqual(expected - 1e-9);
      }
    });
  }
});

describe('CE-564.4: a list argument at a parameter bound whole', () => {
  // `R([x, y] + [-0.57, 2.8], φ)` at x = 1, y = 2, φ = 0.5:
  // V = [0.43, 4.8], R = [V₁cos φ - V₂sin φ, V₁sin φ + V₂cos φ].
  const row = [
    'Add',
    [
      'Sum',
      [
        'Power',
        ['R', ['Add', ['List', 'x', 'y'], ['List', -0.57, 2.8]], 'phi'],
        2,
      ],
    ],
    -1,
  ];
  const at = { x: 1, y: 2, phi: 0.5 };
  const v1 = 0.43;
  const v2 = 4.8;
  const r1 = v1 * Math.cos(0.5) - v2 * Math.sin(0.5);
  const r2 = v1 * Math.sin(0.5) + v2 * Math.cos(0.5);
  const expected = r1 * r1 + r2 * r2 - 1;

  for (const route of ['declared-function', 'assigned'] as const) {
    test(`the interpreter binds the list whole (${route})`, () => {
      const ce = engineWithR(route);
      expect(
        ce
          .box(row as any)
          .subs(at)
          .evaluate().re
      ).toBeCloseTo(expected, 10);
    });

    test(`JavaScript computes the interpreter's value (${route})`, () => {
      const ce = engineWithR(route);
      const result = compile(ce.box(row as any) as any, { to: 'javascript' });
      expect(result.success).toBe(true);
      expect(result.run!(at) as number).toBeCloseTo(expected, 10);
    });

    test(`GLSL emits a copy of R with a vec2 parameter (${route})`, () => {
      const ce = engineWithR(route);
      const result = compile(ce.box(row as any) as any, { to: 'glsl' });
      expect(result.success).toBe(true);
      expect(result.preamble).toMatch(/vec2 _fn_R_\w+\(vec2 V, float t\) \{/);
      expect(result.code).toMatch(
        /_fn_R_\w+\(vec2\(x, y\) \+ vec2\(-0\.57, 2\.8\), phi\)/
      );
    });

    test(`WGSL emits a copy of R with a vec2f parameter (${route})`, () => {
      const ce = engineWithR(route);
      const result = compile(ce.box(row as any) as any, { to: 'wgsl' });
      expect(result.success).toBe(true);
      expect(result.preamble).toMatch(/fn _fn_R_\w+\(V: vec2f, t: f32\)/);
    });

    // interval-js compiled the generic definition of `R` against the scalar
    // arm of its parameter and answered an empty interval, then failed
    // closed. It now emits a copy of `R` typed by the list argument, as
    // javascript does (ROADMAP CE-564), and encloses the interpreter's value.
    test(`interval-js encloses the interpreter's value (${route})`, () => {
      const ce = engineWithR(route);
      const result = compile(ce.box(row as any) as any, {
        to: 'interval-js',
      });
      expect(result.success).toBe(true);
      expect(result.code).toMatch(/_fn_R_vector_real_2__number\(/);
      const point = result.run!({
        x: { lo: 1, hi: 1 },
        y: { lo: 2, hi: 2 },
        phi: { lo: 0.5, hi: 0.5 },
      }) as any;
      expect(point.kind).toBe('interval');
      expect(point.value.lo).toBeLessThanOrEqual(expected);
      expect(point.value.hi).toBeGreaterThanOrEqual(expected);
      expect(point.value.hi - point.value.lo).toBeLessThan(1e-9);
      // A small box: the enclosure holds the interpreter's value at the
      // corners and at the centre.
      const h = 0.01;
      const box = result.run!({
        x: { lo: 1 - h, hi: 1 + h },
        y: { lo: 2 - h, hi: 2 + h },
        phi: { lo: 0.5 - h, hi: 0.5 + h },
      }) as any;
      expect(box.kind).toBe('interval');
      for (const dx of [-h, 0, h])
        for (const dy of [-h, 0, h])
          for (const dp of [-h, 0, h]) {
            const v = ce
              .box(row as any)
              .subs({ x: 1 + dx, y: 2 + dy, phi: 0.5 + dp })
              .evaluate().re;
            expect(box.value.lo).toBeLessThanOrEqual(v);
            expect(box.value.hi).toBeGreaterThanOrEqual(v);
          }
    });
  }

  test('a list literal with an untyped scalar argument is not run as scalar code', () => {
    // `phi` has no type, so no specialization takes the call, and the
    // argument `phi` is not provably scalar, so the call is not inlined.
    // The emitted definition would read `V` as a scalar and answer `NaN`.
    const ce = new ComputeEngine();
    ce.declare('R', 'function');
    ce.assign('R', ce.box(R_LITERAL as any));
    const result = compile(ce.box(['R', ['List', 1, 2], 'phi']) as any, {
      to: 'javascript',
    });
    const value = result.run!({ phi: 0.5 }) as number[];
    expect(value[0]).toBeCloseTo(Math.cos(0.5) - 2 * Math.sin(0.5), 12);
    expect(value[1]).toBeCloseTo(Math.sin(0.5) + 2 * Math.cos(0.5), 12);
  });

  // The `vec2` copy declares its parameter with the element type of the
  // argument. Only finite real elements let the GPU finiteness proof emit
  // the built-in `sin(V)`: the built-in gives 0 for `sin(+∞)`, where the
  // interpreter gives NaN, so a `number` element keeps the NaN guard.
  const H_LITERAL = ['Function', ['Block', ['Sum', ['Sin', 'V']]], 'V'];
  function engineWithH(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.declare('x', 'real');
    ce.declare('h', 'function');
    ce.assign('h', ce.box(H_LITERAL as any));
    return ce;
  }

  test('a list with a `number` element keeps the NaN guard of sin on GLSL', () => {
    const ce = engineWithH();
    const result = compile(ce.box(['h', ['List', 'u', 1]]) as any, {
      to: 'glsl',
    });
    expect(result.success).toBe(true);
    expect(result.preamble).toMatch(/\(vec2 V\) \{/);
    expect(result.preamble).toMatch(/= _gpu_sin\w*\(V\);/);
    expect(result.preamble).not.toMatch(/= sin\(V\);/);
  });

  test('a list of finite reals uses the built-in sin on GLSL', () => {
    const ce = engineWithH();
    const result = compile(ce.box(['h', ['List', 'x', 1]]) as any, {
      to: 'glsl',
    });
    expect(result.success).toBe(true);
    expect(result.preamble).toMatch(/\(vec2 V\) \{/);
    expect(result.preamble).toMatch(/= sin\(V\);/);
    expect(result.preamble).not.toMatch(/_gpu_sin/);
  });
});
