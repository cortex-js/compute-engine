/**
 * A literal index pushed through a list built by arithmetic or zipped from
 * columns, and a list-valued helper substituted at the compilation root.
 *
 * The three point-table rows of the 3-D art document `art/n7uhaaoq1q` in the
 * Tycho code-generation audit of 0.128.9 index a `PointList` zipped from three
 * COLUMNS (`PointList(0.1·PointX(P) + 0.4, 0.1·PointY(P), 2 − 0.3·PointZ(P))[x]`
 * with `P` a three-point list) inside a comprehension over `x`. Once the
 * comprehension is written out the index is a literal, but the base is not a
 * written-out `List`: it is a `PointList` whose columns are arithmetic over
 * lists. The literal index fold of the pre-pass (`fixed-width-unroll.ts`,
 * rule 5) now pushes the index through such a base — `(0.1·[a, b, c] +
 * 0.4)[2]` is `0.1·b + 0.4`, and `PointList([a₁, a₂], [b₁, b₂], 5)[2]` is
 * the point `(a₂, b₂, 5)` — so the shader targets compile the rows to a
 * fixed-size array of vectors.
 *
 * The same rows written BY REFERENCE call a helper whose value is the point
 * list. The shader entries now substitute a LIST-valued helper's body at the
 * root call site (`inlineCollectionValuedCallsAtRoot`, as the interval entry
 * already did; the JavaScript target keeps its retained helpers), so the row
 * compiles to the same array of vectors by reference as written out. The
 * substitution — at a root and inside an emitted definition body alike — now
 * descends into a node that binds names (a `Sum`, a comprehension) with the
 * bound names guarding against capture.
 *
 * A sum of two all-scalar points whose component types cross
 * (`(a, b, 2) + (0, 0, 0.8)`) typed as the UNION of the operand tuple types,
 * a type no value has; the shader targets read no component count from it.
 * It now types component-wise.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { unrollFixedWidthCollections } from '../../src/compute-engine/compilation/fixed-width-unroll';

const ce = new ComputeEngine();
for (const s of ['u', 'v', 'a', 'b', 'c', 'd', 's']) ce.declare(s, 'real');

const POINT = { u: 0.1, v: 0.5, a: 1.5, b: -2.5, c: 0.75, d: 3, s: 7 };

/**
 * Every number of a (nested) value, in reading order. A boxed collection is
 * read through `each()`: an evaluated comprehension is a lazy collection
 * whose operands are still the comprehension's own.
 */
function flat(e: any): number[] {
  if (Array.isArray(e)) return e.flatMap(flat);
  if (typeof e === 'number') return [e];
  if (e && typeof e === 'object' && e.isCollection === true)
    return [...e.each()].flatMap(flat);
  if (e && typeof e === 'object' && typeof e.re === 'number') return [e.re];
  return [Number(e)];
}

function interpreted(json: unknown): number[] {
  const expr = ce.box(json);
  const point = Object.fromEntries(
    Object.entries(POINT).map(([k, n]) => [k, ce.number(n)])
  );
  return flat(expr.subs(point).N());
}

function expectParity(json: unknown, code?: (c: string) => void): void {
  const r = compile(ce.box(json), { fallback: false });
  expect(r.success).toBe(true);
  code?.(r.code!);
  const got = flat(r.run!(POINT));
  const want = interpreted(json);
  expect(got.length).toBe(want.length);
  got.forEach((x, i) => expect(x).toBeCloseTo(want[i], 12));
}

/** The pre-pass alone, as the JavaScript entry runs it. */
function prepass(json: unknown): string {
  return JSON.stringify(unrollFixedWidthCollections(ce.box(json), {}).json);
}

describe('A literal index pushed through list arithmetic (rule 5)', () => {
  test('a scalar multiple plus a scalar', () => {
    expectParity(
      ['At', ['Add', ['Multiply', 0.1, ['List', 'a', 'b', 'c']], 0.4], 2],
      (code) => expect(code).not.toContain('[')
    );
  });

  test('two lists zipped by a product, and a scalar over a list', () => {
    expectParity(
      ['At', ['Multiply', ['List', 'a', 'b'], ['List', 'c', 'd']], 2],
      (code) => expect(code).not.toContain('[')
    );
    expectParity(['At', ['Divide', 's', ['List', 'a', 'b']], 1], (code) =>
      expect(code).not.toContain('[')
    );
    expectParity(['At', ['Negate', ['List', 'a', 'b']], 2], (code) =>
      expect(code).not.toContain('[')
    );
  });

  test('a point list zipped from columns: the k-th point', () => {
    expectParity(
      [
        'At',
        ['PointList', ['List', 'a', 'b'], ['Multiply', 2, ['List', 'c', 'd']], 5],
        2,
      ],
      (code) => {
        // One point, built directly: no list of points is constructed.
        expect(code).not.toContain('map(');
      }
    );
  });

  test('a point list of one point is left to the target', () => {
    // Every component a scalar: the value is ONE point, and an index into it
    // is a coordinate read — a different value from "the k-th point".
    const json = ['At', ['PointList', 'a', 'b', 'c'], 2];
    expect(prepass(json)).toBe(JSON.stringify(ce.box(json).json));
    expectParity(json);
  });

  test('columns of different widths are left to the target', () => {
    const json = ['At', ['PointList', ['List', 'a', 'b'], ['List', 'c', 'd', 's']], 1];
    expect(prepass(json)).toBe(JSON.stringify(ce.box(json).json));
  });

  test('an index past the width is left to the target', () => {
    const json = ['At', ['Multiply', 2, ['List', 'a', 'b']], 3];
    expect(prepass(json)).toBe(JSON.stringify(ce.box(json).json));
  });

  test('an index past the iteration budget is left to the target', () => {
    // The zip of a point list stops at the budget, so its second point is
    // out of range there.
    const json = ['At', ['PointList', ['List', 'a', 'b'], ['List', 'c', 'd']], 2];
    expect(
      JSON.stringify(
        unrollFixedWidthCollections(ce.box(json), { iterationBudget: 1 }).json
      )
    ).toBe(JSON.stringify(ce.box(json).json));
    expect(
      JSON.stringify(
        unrollFixedWidthCollections(ce.box(json), { iterationBudget: 2 }).json
      )
    ).not.toBe(JSON.stringify(ce.box(json).json));
  });

  test('a discarded element with an effect keeps the list', () => {
    const json = ['At', ['Multiply', 2, ['List', 'a', ['Random']]], 1];
    expect(prepass(json)).toBe(JSON.stringify(ce.box(json).json));
  });

  test('a head the caller overrode is left to the override', () => {
    const r = compile(
      ce.box(['At', ['PointList', ['List', 'a', 'b'], ['List', 'c', 'd']], 1]),
      { fallback: false, functions: { PointList: '_.myPL' } }
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('_.myPL(');
  });

  test('constant folding off keeps the written literals', () => {
    const r = compile(
      ce.box(['At', ['Add', ['Multiply', 2, ['List', 'a', 'b']], 1, 1], 2]),
      { fallback: false, constantFold: false }
    );
    expect(r.success).toBe(true);
    expect(r.run!(POINT)).toBeCloseTo(2 * POINT.b + 2, 12);
  });
});

// ── The audit rows ────────────────────────────────────────────────────────

const COLS = String.raw`\operatorname{PointList}(\sin(360u)\bigl\lbrack v, 1, v\bigr\rbrack, \cos(360u)\bigl\lbrack v, 1, v\bigr\rbrack, \bigl\lbrack0, v, 1\bigr\rbrack)`;
const ROWS: Record<string, string> = {
  'record 685': String.raw`\left[\operatorname{PointList}(0.4y+0.1\mathrm{PointX}(${COLS})+0.4, 0.1\mathrm{PointY}(${COLS}), 2-0.3y\mathrm{PointZ}(${COLS}))[x]+\operatorname{PointList}(0, 0, 0.8) \operatorname{for} y = \bigl\lbrack1, 2, 3\bigr\rbrack, x = \bigl\lbrack1, 2, 3\bigr\rbrack\right]`,
  'record 696': String.raw`\left[\operatorname{PointList}(-((0.025y+0.1)\mathrm{PointX}(${COLS})), (0.025y+0.1)\mathrm{PointY}(${COLS}), -((1.1-0.25y)\mathrm{PointZ}(${COLS})))[x]+\operatorname{PointList}(-2, 0, 3) \operatorname{for} y = 1..3, x = \bigl\lbrack1, 2, 3\bigr\rbrack\right]`,
  'record 723': String.raw`\left[\operatorname{PointList}(\mathrm{PointZ}(${COLS})\bigl\lbrack-0.45, -2, -0.45\bigr\rbrack[y], \mathrm{PointY}(${COLS})\bigl\lbrack0.2, 0.15, 0.2\bigr\rbrack[y], \mathrm{PointX}(${COLS})\bigl\lbrack0.2, 0.15, 0.2\bigr\rbrack[y])[x]+\operatorname{PointList}(\bigl\lbrack0, 0, -1.65\bigr\rbrack[y], 0, -2) \operatorname{for} y = \bigl\lbrack1, 2, 3\bigr\rbrack, x = 1..3\right]`,
};

describe.each(Object.entries(ROWS))(
  'The audit point table %s',
  (_label, latex) => {
    test('compiles to a fixed-size array of vectors on both shader targets', () => {
      const expr = ce.parse(latex);
      expect(expr.isValid).toBe(true);
      const glsl = compile(expr, { to: 'glsl', fallback: false });
      expect(glsl.success).toBe(true);
      expect(glsl.code).toContain('vec3[9](');
      expect(glsl.code).not.toContain('_fn_');
      const wgsl = compile(expr, { to: 'wgsl', fallback: false });
      expect(wgsl.success).toBe(true);
      expect(wgsl.code).toContain('array<vec3f, 9>(');
    });

    test('the JavaScript target agrees with the interpreter', () => {
      const expr = ce.parse(latex);
      const r = compile(expr, { fallback: false });
      expect(r.success).toBe(true);
      const got = flat(r.run!(POINT));
      const want = flat(expr.subs({ u: ce.number(POINT.u), v: ce.number(POINT.v) }).N());
      expect(got.length).toBe(27);
      got.forEach((x, i) => expect(x).toBeCloseTo(want[i], 10));
    });
  }
);

// ── A list-valued helper at the shader root ───────────────────────────────

describe('A list-valued helper is substituted at the shader root', () => {
  ce.declare('P', 'function');
  ce.assign('P', ce.parse(String.raw`(u, v) \mapsto ${COLS}`));
  ce.declare('sq', 'function');
  ce.assign('sq', ce.parse(String.raw`x \mapsto x^2 + 1`));
  ce.declare('g', 'real');
  ce.declare('H', 'function');
  ce.assign(
    'H',
    ce.expr(['Function', ['List', ['Multiply', 'g', 'x'], 'x'], ['Typed', 'x', 'real']])
  );
  ce.declare('pt', 'function');
  ce.assign('pt', ce.expr(['Function', ['Tuple', 'x', ['Square', 'x']], ['Typed', 'x', 'real']]));
  ce.declare('n', 'integer');

  test('the audit row by reference compiles to the same array of vectors', () => {
    const latex = ROWS['record 685'].split(COLS).join('P(u, v)');
    for (const to of ['glsl', 'wgsl'] as const) {
      const r = compile(ce.parse(latex), { to, fallback: false });
      expect(r.success).toBe(true);
      expect(r.code).not.toContain('_fn_P');
      expect(r.code).toContain(to === 'glsl' ? 'vec3[9](' : 'array<vec3f, 9>(');
    }
  });

  test('a coordinate read through the helper', () => {
    const r = compile(ce.box(['Add', ['At', ['PointX', ['P', 'u', 'v']], 2], 0.5]), {
      to: 'glsl',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_fn_P');
    expect(r.code).toContain('sin(');
  });

  test('a scalar helper and a point-valued helper stay calls by reference', () => {
    const scalar = compile(ce.box(['Add', ['sq', 'u'], 1]), { to: 'glsl', fallback: false });
    expect(scalar.success).toBe(true);
    expect(scalar.code).toContain('_fn_sq(');
    const point = compile(ce.box(['PointX', ['pt', 'u']]), { to: 'glsl', fallback: false });
    expect(point.success).toBe(true);
    expect(point.preamble).toMatch(/vec2 _fn_pt\(/);
  });

  test('a helper over a literal point argument is substituted', () => {
    ce.declare('Rows', 'function');
    ce.assign(
      'Rows',
      ce.expr(['Function', ['List', ['PointX', 'p'], ['PointY', 'p'], 1], 'p'])
    );
    const r = compile(ce.box(['At', ['Rows', ['Tuple', 'u', 'v']], 2]), {
      to: 'glsl',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_fn_Rows');
    // The second element is `PointY((u, v))`: a swizzle of the native vector.
    expect(r.code.trim()).toBe('vec2(u, v).y');
  });

  test('a global the substituted helper reads is a free symbol of the shader', () => {
    const r = compile(ce.box(['At', ['H', 'u'], 1]), { to: 'glsl', fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_fn_H');
    expect(r.code).toContain('g * u');
  });

  test('the JavaScript target keeps the helper by reference', () => {
    // The JavaScript target's retained helpers carry their own static-width
    // analysis (`docs/CALL-SHAPE-SPECIALIZATION.md`); the root substitution
    // is a shader and interval matter.
    const r = compile(ce.box(['At', ['H', 'u'], 1]), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.preamble).toContain('const _fn_H');
    expect(r.run!({ u: 0.3, g: 2.5 })).toBeCloseTo(0.75, 12);
  });
});

// ── The substitution descends into a binder inside a definition body ─────

describe('A list-valued helper called under a Sum inside a definition body', () => {
  test('is substituted, with the sum index in scope', () => {
    // Σₖ H(k)[2] over k = 1..n: the second element is k itself, so the sum is
    // n(n + 1)/2 whatever `g` holds.
    ce.declare('T', 'function');
    ce.assign(
      'T',
      ce.expr([
        'Function',
        ['Sum', ['At', ['H', 'k'], 2], ['Limits', 'k', 1, 'n']],
        ['Typed', 'n', 'integer'],
      ])
    );
    const r = compile(ce.box(['T', 'n']), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.preamble).not.toContain('const _fn_H');
    expect(r.run!({ n: 4, g: 2.5 })).toBeCloseTo(10, 12);
  });

  test('stays a call when the binder would capture a global the body reads', () => {
    // W's body reads the GLOBAL `w`; the sum inside U binds `w`. Substituting
    // W under that binder would read the bound `w` and answer Σ w·w.
    ce.declare('w', 'real');
    ce.assign('w', 2.5);
    ce.declare('W', 'function');
    ce.assign(
      'W',
      ce.expr(['Function', ['List', ['Multiply', 'w', 'x'], 'x'], ['Typed', 'x', 'real']])
    );
    ce.declare('U', 'function');
    ce.assign(
      'U',
      ce.expr([
        'Function',
        ['Sum', ['At', ['W', 'w'], 1], ['Limits', 'w', 1, 'n']],
        ['Typed', 'n', 'integer'],
      ])
    );
    expect(ce.box(['U', 3]).evaluate().toString()).toBe('15');
    const r = compile(ce.box(['U', 'n']), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.preamble).toContain('const _fn_W');
    expect(r.run!({ n: 3 })).toBeCloseTo(15, 12);
  });
});

describe('A sum of two points types component-wise', () => {
  test('crossing component types are joined per position, not unioned', () => {
    expect(
      ce.box(['Add', ['PointList', 'a', 'b', 2], ['PointList', 0, 0, 0.8]]).type.toString()
    ).toBe('tuple<real, real, real>');
    expect(
      ce.box(['Add', ['Tuple', 'a', 'b', 2], ['Tuple', 0, 0, 0.8]]).type.toString()
    ).toBe('tuple<real, real, real>');
    expect(
      ce.box(['Add', ['PointList', 'a', 'b', 2], ['PointList', 0, 0, 1]]).type.toString()
    ).toBe('tuple<real, real, integer>');
  });

  test('such a sum inside a list of points lowers as a vector array', () => {
    const r = compile(
      ce.box([
        'List',
        ['Add', ['PointList', 'a', 'b', 2], ['PointList', 0, 0, 0.8]],
        ['Add', ['PointList', 'a', 'b', 2.5], ['PointList', 0, 0, 0.8]],
      ]),
      { to: 'glsl', fallback: false }
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('vec3[2](');
  });
});
