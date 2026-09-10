/**
 * A kernel could evaluate the same subexpression several times even though
 * both sharing passes were running over it. Two independent causes, one per
 * pass:
 *
 * 1. CSE subsumption — dropping a candidate whose occurrences all sit inside
 *    an occurrence of a larger one — took no part when either candidate also
 *    SERVED an occurrence in a descendant region. Nearly every candidate of a
 *    large body serves one, so the nested chains (`f`, `-f`, `-f/n`, `(…)^2`,
 *    …) all survived and the per-region binding cap spent its budget on them
 *    instead of on the small, frequently repeated terms. A nine-cell Voronoi
 *    distance bound 64 temporaries — exactly the cap — and still divided
 *    `floor(n·x)` by `n` three times.
 *
 * 2. Subsumption also ran BEFORE the benefit test, so a container that was
 *    about to be discarded for scoring too low could still drop the
 *    candidate inside it — and that candidate was then emitted in full at
 *    every occurrence.
 *
 * 3. The loop-invariant hoist records each MAXIMAL invariant node whole and
 *    never descends into it, so a subexpression two of those nodes share was
 *    emitted once inside each of them. A heat-map shader recomputed
 *    `fract(x)` six times and one `sin(dot(…))` hash twice in the block ahead
 *    of its loop.
 *
 * The compiled value must be the interpreter's value, so each shape is also
 * run against `.N()` at sample points, including one that answers NaN.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { harvestCse } from '../../src/compute-engine/compilation/cse';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();
for (const s of ['x', 'y', 'n', 'h', 'N', 'a', 'b', 'c', 'u'])
  ce.declare(s, 'real');
ce.declare('L', 'list<number>');

function js(expr: Expression, options: Record<string, unknown> = {}) {
  const r = compile(expr, { to: 'javascript', ...options }) as any;
  if (!r.success) throw new Error(`declined: ${String(r.error)}`);
  return r as { code: string; run: (vars: Record<string, unknown>) => any };
}

function glsl(expr: Expression) {
  const r = compile(expr, { to: 'glsl' } as any) as any;
  if (!r.success) throw new Error(`declined: ${String(r.error)}`);
  return r as { code: string };
}

const count = (s: string, needle: string) => s.split(needle).length - 1;

/** Every substring of `code` matching `re` that occurs more than once. */
function repeats(code: string, re: RegExp): string[] {
  const tally = new Map<string, number>();
  for (const m of code.match(re) ?? []) tally.set(m, (tally.get(m) ?? 0) + 1);
  return [...tally.entries()].filter(([, k]) => k > 1).map(([s]) => s);
}

/** The interpreter's value of `expr` at `vars`, as a JavaScript number. */
function interpret(expr: Expression, vars: Record<string, number>): number {
  return expr.subs(vars as any).N().re;
}

/** One cell of a Voronoi distance field: the squared distance from `(x, y)`
 * to the pseudo-random site of the grid cell containing `(ax, ay)`. */
const voronoiCell = (ax: string, ay: string) =>
  `\\left(x-\\frac{\\lfloor n${ax}\\rfloor}{n}-\\frac{(10000\\sin(10000(n\\lfloor n${ay}\\rfloor+\\lfloor n${ax}\\rfloor)))\\bmod 1}{n}\\right)^2` +
  `+\\left(y-\\frac{\\lfloor n${ay}\\rfloor}{n}-\\frac{(10000\\sin(10000(n\\lfloor n${ay}\\rfloor+\\lfloor n${ax}\\rfloor+0.5)))\\bmod 1}{n}\\right)^2`;

/**
 * The audit's Voronoi row: how far the second-nearest site is from the
 * nearest one. Every cell distance is written out again inside the mask that
 * removes the nearest site from the second `min`, so the body holds nine
 * inlined copies of a nine-way minimum — the size at which the per-region
 * binding cap used to bite.
 */
function voronoiSecondNearest(): Expression {
  const cells: string[] = [];
  for (const b of ['(y-h)', 'y', '(y+h)'])
    for (const a of ['(x-h)', 'x', '(x+h)']) cells.push(voronoiCell(a, b));
  const nearest = `\\min(${cells.join(', ')})`;
  const masked = cells.map(
    (c) => `\\begin{cases}10^9 & ${c}=${nearest}\\\\${c}\\end{cases}`
  );
  return ce.parse(
    `\\left(\\frac{1}{N}\\right)^2-\\left|\\min(${masked.join(', ')})-${nearest}\\right|`
  );
}

describe('item 280 — subsumption reaches a candidate that serves a descendant', () => {
  const F = ['Sin', ['Sin', ['Multiply', 6, 'u']]] as any;

  it('drops the inner candidate when the outer also serves an If arm', () => {
    // `sin(sin(6u))` occurs three times at the root and once more inside the
    // `If` arm, which the dominance rule credits to the root candidate as a
    // SERVED occurrence. `sin(6u)` occurs exactly where `sin(sin(6u))` does,
    // so the inner candidate is redundant and only the outer is bound.
    const harvest = harvestCse(
      ce.box(['Add', F, F, F, ['If', ['Greater', 'u', 0], F, 0]])
    );
    expect(harvest.candidates.map((c) => c.representative.toString())).toEqual([
      'sin(sin(6u))',
    ]);
    expect(harvest.candidates[0].served).toHaveLength(1);
    expect(harvest.diagnostics.droppedBySubsumption).toBe(1);
  });

  it('keeps both when the served occurrences make the counts differ', () => {
    // The `If` arm holds the INNER structure this time, so `sin(6u)` occurs
    // once more than `sin(sin(6u))` and earns a binding of its own.
    const harvest = harvestCse(
      ce.box([
        'Add',
        F,
        F,
        F,
        ['If', ['Greater', 'u', 0], ['Sin', ['Multiply', 6, 'u']], 0],
      ])
    );
    expect(
      harvest.candidates.map((c) => c.representative.toString()).sort()
    ).toEqual(['sin(6u)', 'sin(sin(6u))']);
  });
});

describe('item 280 — a nine-cell Voronoi distance shares every repeated term', () => {
  const expr = voronoiSecondNearest();
  const { code, run } = js(expr);

  it('divides each floor by n once', () => {
    expect(repeats(code, /-_cse\d+ \/ _\.n/g)).toEqual([]);
  });

  it('computes each pseudo-random site coordinate once', () => {
    expect(
      repeats(code, /_SYS\.fract\(10000 \* Math\.sin\([^;]*?\)\)\)/g)
    ).toEqual([]);
  });

  it('stays well under the per-region binding cap', () => {
    // 64 bindings — the cap exactly — was the symptom: the cap was reached
    // and the terms it could not fit emitted inline.
    expect(count(code, 'const _cse')).toBeLessThan(32);
  });

  it('returns the interpreter value, NaN included', () => {
    for (const vars of [
      { x: 0.37, y: 0.62, n: 5, h: 0.1, N: 3 },
      { x: -1.4, y: 2.75, n: 3, h: 0.25, N: 7 },
      { x: 0, y: 0, n: 8, h: 0.5, N: 2 },
    ]) {
      expect(run(vars)).toBeCloseTo(interpret(expr, vars), 10);
    }
    const nan = { x: NaN, y: 0.5, n: 5, h: 0.1, N: 3 };
    expect(run(nan)).toBeNaN();
    expect(interpret(expr, nan)).toBeNaN();
  });
});

describe('item 280 — the loop-invariant hoist shares its own subexpressions', () => {
  // `cos(sin(floor(x) + floor(y)))` and `sin(sin(floor(x) + floor(y)))` are
  // two maximal invariant nodes of the loop body. Each is bound ahead of the
  // loop, and the hash they share is bound ahead of both.
  const expr = ce.parse(
    '\\sum_{n=1}^{N}\\left(n\\cos(\\sin(\\lfloor x\\rfloor+\\lfloor y\\rfloor))' +
      '+\\frac{\\sin(\\sin(\\lfloor x\\rfloor+\\lfloor y\\rfloor))}{n}\\right)'
  );

  it('computes the shared hash once on the javascript target', () => {
    const { code } = js(expr);
    expect(count(code, 'Math.floor(_.x)')).toBe(1);
    expect(code).toMatch(
      /const _tv1 = Math\.sin\(Math\.floor\(_\.x\) \+ Math\.floor\(_\.y\)\);/
    );
    expect(code).toContain('Math.cos(_tv1)');
    expect(code).toContain('Math.sin(_tv1)');
  });

  it('computes the shared hash once on the glsl target', () => {
    const { code } = glsl(expr);
    expect(count(code, 'floor(x)')).toBe(1);
    expect(code).toMatch(/float _tv2 = sin\(floor\(x\) \+ floor\(y\)\);/);
    expect(code).toContain('cos(_tv2)');
    expect(code).toContain('sin(_tv2)');
  });

  it('returns the interpreter value, NaN included', () => {
    const { run } = js(expr);
    for (const vars of [
      { x: 1.3, y: 2.7, N: 4 },
      { x: -0.5, y: 0.5, N: 1 },
      { x: 6.25, y: -3.125, N: 7 },
    ]) {
      expect(run(vars)).toBeCloseTo(interpret(expr, vars), 10);
    }
    expect(run({ x: NaN, y: 2.7, N: 4 })).toBeNaN();
  });
});

describe('item 280 — a repeated variadic Min binds once', () => {
  it('binds a three-operand Math.min once, under a square too', () => {
    const expr = ce.parse('\\min(a,b,c)+\\min(a,b,c)^2');
    const { code, run } = js(expr);
    expect(count(code, 'Math.min(')).toBe(1);
    expect(code).toContain('_SYS.pow2(_cse1)');
    const vars = { a: 3, b: -1.5, c: 8 };
    expect(run(vars)).toBeCloseTo(interpret(expr, vars), 10);
  });

  it('binds a repeated Min over a list length once', () => {
    const expr = ce.parse(
      '\\min(\\mathrm{Length}(L), n) + \\min(\\mathrm{Length}(L), n)'
    );
    const { code, run } = js(expr);
    expect(count(code, 'Math.min(')).toBe(1);
    expect(run({ L: [1, 2, 3, 4], n: 2 })).toBe(4);
  });
});

describe('item 280 — a container that fails the benefit test cannot subsume', () => {
  it('binds the transcendental call when its container scores too low', () => {
    // `sin(u) + 1` occurs twice: size 4 times one saved evaluation is 4,
    // under `CSE_MIN_SCORE`, so it earns no binding of its own. `sin(u)`
    // occurs only inside it and just as often, but a transcendental call is
    // admitted whatever its score — so it must survive a container that is
    // itself discarded.
    const expr = ce.parse('(\\sin(u)+1)^2+\\frac{1}{\\sin(u)+1}');
    const { code, run } = js(expr);
    expect(count(code, 'Math.sin(')).toBe(1);
    for (const u of [0.4, -1.25, 3])
      expect(run({ u })).toBeCloseTo(interpret(expr, { u }), 10);
  });
});
