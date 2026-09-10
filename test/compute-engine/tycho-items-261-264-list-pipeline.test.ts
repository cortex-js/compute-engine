/**
 * Tycho items 261, 262 and 264 — the `javascript` target's list pipeline,
 * witnessed by a Game of Life step over a carrier read by reference:
 *
 *     S -> Which(n = 3, 1, n = 2, S, True, 0)
 *     n  = RotateLeft(S, 1) + RotateLeft(S, -1) + … (eight rotations)
 *
 * - **261** — a subexpression evaluated unconditionally in a region (the
 *   first `Which` condition) and again inside that region's lazy arms is
 *   bound ONCE at the region's top; the arms read the temporary (the CSE
 *   dominance rule, `cse.ts`). An expression that occurs only inside lazy
 *   arms still binds nothing, and a binder that rebinds a name the candidate
 *   mentions is never served across.
 * - **262** — a `RotateLeft`/`RotateRight` operand of a broadcast is emitted
 *   as an in-place view (`_SYS.rotv`) that the element loop reads by index
 *   arithmetic; the rotated list is never materialized. A rotation in value
 *   position stays a copy (`_SYS.rotl`/`_SYS.rotr`).
 * - **264** — the broadcast helper runs one explicit-read kernel per operand
 *   shape, `_SYS.eq` has a flat numeric path, `_SYS.select` applies a lifted
 *   scalar selector without reading cells, and the runner's result
 *   normalization copies numeric cells through. None of these change a
 *   result: every case below is checked against the interpreter.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { harvestCse } from '../../src/compute-engine/compilation/cse';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();
ce.precision = 'machine';

function run(json: any, vars: Record<string, unknown> = {}): unknown {
  const r = compile(ce.box(json), { to: 'javascript', fallback: false });
  expect(r.success).toBe(true);
  return (r.run as (v: Record<string, unknown>) => unknown)(vars);
}

function code(json: any): string {
  const r = compile(ce.box(json), { to: 'javascript', fallback: false });
  expect(r.success).toBe(true);
  return r.code;
}

/** The interpreter's answer in the compiled lane's shape: a `List`/`Tuple`
 * node becomes a plain array, recursively. */
function plain(json: any): unknown {
  if (Array.isArray(json) && (json[0] === 'List' || json[0] === 'Tuple'))
    return json.slice(1).map(plain);
  return json;
}

function interpreted(json: any): unknown {
  return plain(ce.box(json).evaluate({ materialization: true }).json);
}

const occurrences = (s: string, needle: string): number =>
  s.split(needle).length - 1;

// The Life stencil on a small periodic board.
const N = 6;
const M = N * N;
const ROTS = [1, -1, N, -N, N + 1, N - 1, -N + 1, -N - 1];
const nExpr: any = ['Add', ...ROTS.map((k) => ['RotateLeft', 'S', k])];
const stepExpr: any = [
  'Which',
  ['Equal', nExpr, 3],
  1,
  ['Equal', nExpr, 2],
  'S',
  'True',
  0,
];
const board = Array.from({ length: M }, (_, i) =>
  (i * 2654435761) % 100 < 35 ? 1 : 0
);

function lifeStep(s: number[]): number[] {
  const out = new Array(M);
  for (let i = 0; i < M; i++) {
    let n = 0;
    for (let k = 0; k < 8; k++) {
      let j = i + ROTS[k];
      if (j < 0) j += M;
      else if (j >= M) j -= M;
      n += s[j];
    }
    out[i] = n === 3 ? 1 : n === 2 ? s[i] : 0;
  }
  return out;
}

describe('TYCHO 261–264 — the Life step end to end', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('S', `list<integer^${M}>`);
  });
  afterAll(() => ce.popScope());

  test('the compiled step agrees with the hand-written one', () => {
    expect(run(stepExpr, { S: board })).toEqual(lifeStep(board));
  });

  test('261 — the neighbour sum is emitted once and read from a temporary in both clauses', () => {
    const c = code(stepExpr);
    expect(occurrences(c, '_SYS.bcast(')).toBe(1);
    expect(c).toMatch(/const (_cse\d+) = _SYS\.bcast\(/);
    const name = /const (_cse\d+) = _SYS\.bcast\(/.exec(c)![1];
    // The two `Equal` clauses read the name; the binding is its definition.
    expect(occurrences(c, `_SYS.eq((${name}), (3)`)).toBe(1);
    expect(occurrences(c, `_SYS.eq((${name}), (2)`)).toBe(1);
  });

  test('262 — every rotation is an in-place view of the carrier; nothing is copied', () => {
    const c = code(stepExpr);
    // The fused numeric loop reads the carrier by index arithmetic; the
    // generic branch behind its guard reads eight views of the carrier
    // (captured under a temporary name at the artifact's entry).
    expect(occurrences(c, '_SYS.rotv(')).toBe(8);
    expect(c).not.toContain('_SYS.rotl(');
    expect(c).not.toContain('.slice(');
  });

  test('a rotation in value position stays a materialized copy', () => {
    expect(code(['RotateLeft', 'S', 1])).toBe('_SYS.rotl(_.S, 1)');
    expect(code(['RotateRight', 'S', 2])).toBe('_SYS.rotr(_.S, 2)');
    expect(code(['RotateLeft', 'S'])).toBe('_SYS.rotl(_.S, 1)');
  });
});

describe('TYCHO 262 — rotation views agree with the interpreter', () => {
  const L = ['List', 1, 2, 3, 4, 5];
  test.each([
    ['RotateLeft by 1', ['RotateLeft', L, 1]],
    ['RotateLeft by 0', ['RotateLeft', L, 0]],
    ['RotateLeft by −1', ['RotateLeft', L, -1]],
    ['RotateLeft past the length', ['RotateLeft', L, 7]],
    ['RotateLeft by a negative multiple', ['RotateLeft', L, -12]],
    ['RotateLeft by default', ['RotateLeft', L]],
    ['RotateRight by 1', ['RotateRight', L, 1]],
    ['RotateRight by 4', ['RotateRight', L, 4]],
    ['RotateRight by −2', ['RotateRight', L, -2]],
  ])('%s: as a broadcast operand and in value position', (_name, rot) => {
    const expected = interpreted(['Add', rot, ['List', 10, 20, 30, 40, 50]]);
    expect(run(['Add', rot, ['List', 10, 20, 30, 40, 50]])).toEqual(expected);
    expect(run(rot)).toEqual(interpreted(rot));
  });

  test('a shift that is not finite falls back to the default 1, like the interpreter', () => {
    ce.pushScope();
    ce.declare('k', 'real');
    try {
      const r = compile(ce.box(['Add', ['RotateLeft', L, 'k'], 100]), {
        to: 'javascript',
        fallback: false,
      });
      const f = r.run as (v: Record<string, unknown>) => unknown;
      expect(f({ k: NaN })).toEqual([102, 103, 104, 105, 101]);
      expect(f({ k: Infinity })).toEqual([102, 103, 104, 105, 101]);
      expect(f({ k: 2 })).toEqual([103, 104, 105, 101, 102]);
    } finally {
      ce.popScope();
    }
  });

  test('an empty list rotates to an empty list, and an empty broadcast position answers NaN', () => {
    expect(run(['RotateLeft', ['List'], 3])).toEqual([]);
    ce.pushScope();
    ce.declare('E', 'list<number>');
    try {
      const r = compile(ce.box(['Add', ['RotateLeft', 'E', 3], 1]), {
        to: 'javascript',
        fallback: false,
      });
      expect(r.code).toContain('_SYS.rotv(_.E, 3, 1)');
      expect((r.run as (v: any) => unknown)({ E: [] })).toBeNaN();
      expect((r.run as (v: any) => unknown)({ E: [5, 6] })).toEqual([7, 6]);
    } finally {
      ce.popScope();
    }
  });

  test('a view is emitted only for a base that provably holds scalars', () => {
    ce.pushScope();
    ce.declare('P', 'list<list<number>>');
    ce.declare('Q', 'indexed_collection<number>');
    try {
      // A matrix: the broadcast descends into each row, so the base's cells
      // are not what the closure applies to.
      const rows = code(['Add', ['RotateLeft', 'P', 1], 1]);
      expect(rows).toContain('_SYS.rotl(');
      expect(rows).not.toContain('_SYS.rotv(');
      expect(
        run(['Add', ['RotateLeft', 'P', 1], 1], {
          P: [
            [1, 2],
            [3, 4],
          ],
        })
      ).toEqual([
        [4, 5],
        [2, 3],
      ]);
      // An `indexed_collection<number>` symbol may be bound to a point.
      const open = code(['Add', ['RotateLeft', 'Q', 1], 1]);
      expect(open).toContain('_SYS.rotl(');
      expect(open).not.toContain('_SYS.rotv(');
    } finally {
      ce.popScope();
    }
  });

  test('a rotation shared with a value position is bound once and read by name, not viewed', () => {
    ce.pushScope();
    ce.declare('S', 'list<number>');
    try {
      // Large enough to be a CSE candidate (`RotateLeft(S, 1)` alone is below
      // the minimum candidate size), and read three times.
      const rot = ['RotateLeft', ['Add', 'S', 1], 1];
      const expr = ['Add', ['Multiply', 2, rot], ['Length', rot], rot];
      const c = code(expr);
      // One materialized rotation, bound once; no view alongside it.
      expect(occurrences(c, '_SYS.rotl(')).toBe(1);
      expect(c).toMatch(/const _cse\d+ = _SYS\.rotl\(/);
      expect(c).not.toContain('_SYS.rotv(');
      expect(run(expr, { S: [1, 2, 3] })).toEqual(
        interpreted([
          'Add',
          ['Multiply', 2, ['RotateLeft', ['Add', ['List', 1, 2, 3], 1], 1]],
          ['Length', ['RotateLeft', ['Add', ['List', 1, 2, 3], 1], 1]],
          ['RotateLeft', ['Add', ['List', 1, 2, 3], 1], 1],
        ])
      );
    } finally {
      ce.popScope();
    }
  });

  test("a caller-mapped `RotateLeft` keeps the caller's implementation; no view", () => {
    ce.pushScope();
    ce.declare('S', 'list<number>');
    try {
      const expr = ce.box(['Add', ['RotateLeft', 'S', 1], 1]);
      const r = compile(expr, {
        to: 'javascript',
        fallback: false,
        functions: { RotateLeft: (l: number[]) => l.map((x) => x * 10) },
      } as any);
      expect(r.success).toBe(true);
      expect(r.code).not.toContain('_SYS.rotv(');
      expect((r.run as (v: any) => unknown)({ S: [1, 2, 3] })).toEqual([
        11, 21, 31,
      ]);
    } finally {
      ce.popScope();
    }
  });

  test('an impure operand beside the rotation disables the view', () => {
    // A view reads its base after every operand was evaluated; a
    // caller-supplied function may mutate that base, so the rotation is
    // materialized at its own evaluation, as before.
    ce.pushScope();
    ce.declare('S', 'list<number>');
    ce.declare('poke', '(list<number>) -> number');
    try {
      const expr = ce.box(['Add', ['RotateLeft', 'S', 1], ['poke', 'S']]);
      const r = compile(expr, {
        to: 'javascript',
        fallback: false,
        functions: {
          poke: (l: number[]) => {
            l[0] = 100;
            return 0;
          },
        },
      } as any);
      expect(r.success).toBe(true);
      expect(r.code).not.toContain('_SYS.rotv(');
      expect((r.run as (v: any) => unknown)({ S: [1, 2, 3] })).toEqual([
        2, 3, 1,
      ]);
    } finally {
      ce.popScope();
    }
  });

  test('a view inside a point broadcast is not used (the inner broadcast receives parameters)', () => {
    const c = code([
      'Multiply',
      ['RotateLeft', ['List', 1, 2, 3], 1],
      ['Tuple', 1, 2],
    ]);
    expect(c).not.toContain('_SYS.rotv(');
    expect(
      run(['Multiply', ['RotateLeft', ['List', 1, 2, 3], 1], ['Tuple', 1, 2]])
    ).toEqual(
      interpreted([
        'Multiply',
        ['RotateLeft', ['List', 1, 2, 3], 1],
        ['Tuple', 1, 2],
      ])
    );
  });
});

describe('TYCHO 264 — per-shape broadcast kernels keep the interpreter semantics', () => {
  const lists = (k: number): any[] =>
    Array.from({ length: k }, (_, j) => ['List', j + 1, j + 2, j + 3]);

  test.each([1, 2, 3, 4, 5, 8, 9])('an %i-operand `Add` over lists', (k) => {
    const expr = ['Add', ...lists(k)];
    expect(run(expr)).toEqual(interpreted(expr));
  });

  test('a mix of scalars, lists and views in one broadcast', () => {
    ce.pushScope();
    ce.declare('A', 'list<number>');
    ce.declare('B', 'list<number>');
    try {
      const expr = [
        'Add',
        2,
        'A',
        ['RotateLeft', 'B', 1],
        ['Multiply', 3, 'A'],
        ['RotateRight', 'B', 1],
      ];
      const c = code(expr);
      expect(occurrences(c, '_SYS.rotv(')).toBe(2);
      expect(run(expr, { A: [1, 2, 3], B: [10, 20, 30] })).toEqual(
        interpreted([
          'Add',
          2,
          ['List', 1, 2, 3],
          ['RotateLeft', ['List', 10, 20, 30], 1],
          ['Multiply', 3, ['List', 1, 2, 3]],
          ['RotateRight', ['List', 10, 20, 30], 1],
        ])
      );
    } finally {
      ce.popScope();
    }
  });

  test('a nested cell mid-list falls back to the per-position projection from there', () => {
    // Position 1 holds a list: the kernel stops there and the recursive path
    // finishes, so the result is what the interpreter's element-wise
    // projection answers at every position.
    const expr = ['Add', ['List', 1, ['List', 10, 20], 3], ['List', 1, 2, 3]];
    expect(run(expr)).toEqual(interpreted(expr));
    const withView = [
      'Add',
      ['RotateLeft', ['List', 1, ['List', 10, 20], 3], 1],
      ['List', 1, 2, 3],
    ];
    expect(run(withView)).toEqual(interpreted(withView));
  });

  test('a matrix operand broadcasts row by row', () => {
    const expr = [
      'Add',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      ['List', ['List', 10, 20], ['List', 30, 40]],
    ];
    expect(run(expr)).toEqual(interpreted(expr));
  });

  test('a length mismatch and an empty position answer NaN as before', () => {
    expect(run(['Add', ['List', 1, 2, 3], ['List', 1, 2]])).toBeNaN();
    expect(
      run(['Add', ['RotateLeft', ['List', 1, 2, 3], 1], ['List', 1, 2]])
    ).toBeNaN();
    ce.pushScope();
    ce.declare('E', 'list<number>');
    try {
      expect(run(['Add', 'E', 1], { E: [] })).toBeNaN();
      expect(run(['Add', 'E', ['List', 1, 2]], { E: [1] })).toBeNaN();
    } finally {
      ce.popScope();
    }
  });

  test('complex cells go through the complex lowering of the closure', () => {
    const expr = [
      'Multiply',
      ['List', ['Complex', 0, 1], 2],
      ['Complex', 0, 1],
    ];
    expect(run(expr)).toEqual([-1, { re: 0, im: 2 }]);
  });

  test('`Equal` over a list against a scalar, a complex scalar, and a list of lists', () => {
    ce.pushScope();
    ce.declare('L', 'list<number>');
    ce.declare('C', 'list<complex>');
    try {
      // Exact element test: a value within the engine tolerance is NOT
      // equal compiled (compiled-equality ruling, `docs/COMPILATION-MODEL.md`).
      expect(run(['Equal', 'L', 3], { L: [3, 3.5, 3 + 1e-12] })).toEqual([
        true,
        false,
        false,
      ]);
      expect(run(['Equal', 3, 'L'], { L: [3, 4] })).toEqual([true, false]);
      expect(
        run(['Equal', 'C', ['Complex', 0, 1]], { C: [{ re: 0, im: 1 }, 1] })
      ).toEqual([true, false]);
      expect(
        run(['Equal', 'C', 1], {
          C: [
            { re: 1, im: 0 },
            { re: 1, im: 1 },
          ],
        })
      ).toEqual([true, false]);
      // Two lists: collection equality, one boolean.
      expect(run(['Equal', 'L', ['List', 1, 2]], { L: [1, 2] })).toBe(true);
      expect(run(['Equal', 'L', ['List', 1, 2]], { L: [1, 3] })).toBe(false);
    } finally {
      ce.popScope();
    }
  });

  test('`Which` with a lifted `True` selector and with an array selector', () => {
    ce.pushScope();
    ce.declare('L', 'list<number>');
    try {
      const expr = [
        'Which',
        ['Equal', 'L', 3],
        1,
        ['Less', 'L', 2],
        'L',
        'True',
        0,
      ];
      const f = compile(ce.box(expr), { to: 'javascript', fallback: false })
        .run as (v: any) => unknown;
      expect(f({ L: [3, 1, 5, 3] })).toEqual([1, 1, 0, 1]);
      // No position undecided when the lifted `True` is reached.
      expect(f({ L: [9, 9] })).toEqual([0, 0]);
      // A NaN datum is a `false` condition cell, not an absent one.
      expect(f({ L: [NaN, 3] })).toEqual([0, 1]);
    } finally {
      ce.popScope();
    }
  });

  test('a list result with a complex cell is normalized at the boundary', () => {
    expect(run(['Sqrt', ['List', 4, -4]])).toEqual([2, { re: 0, im: 2 }]);
    expect(run(['List', 1, ['Complex', 2, 0], true])).toEqual([1, 2, true]);
  });

  test('a user-function application over an empty list still answers the empty list', () => {
    ce.pushScope();
    try {
      ce.assign('q', ce.parse('x \\mapsto x^2'));
      expect(run(['q', ['List']])).toEqual([]);
      expect(run(['q', ['List', 1, 2, 3]])).toEqual([1, 4, 9]);
    } finally {
      ce.popScope();
    }
  });
});

describe('TYCHO 261 — the CSE dominance rule', () => {
  const heavy = (v: string): any => [
    'Add',
    ['Sin', ['Multiply', 6, v]],
    ['Cos', ['Multiply', 7, v]],
  ];

  test('a candidate in the first condition serves the lazy arms and later conditions', () => {
    const expr = ce.box([
      'Which',
      ['Less', heavy('u'), 0],
      heavy('u'),
      ['Less', heavy('u'), 1],
      ['Negate', heavy('u')],
      'True',
      0,
    ]);
    const c = compile(expr, { fallback: false }).code;
    expect(occurrences(c, 'Math.sin(6 * _.u)')).toBe(1);
    expect(c).toMatch(/const _cse\d+ = /);
    const f = compile(expr, { fallback: false }).run as (v: any) => number;
    for (const u of [0.1, 0.4, 0.9])
      expect(f({ u })).toBeCloseTo(
        ce
          .box([
            'Which',
            ['Less', heavy(u), 0],
            heavy(u),
            ['Less', heavy(u), 1],
            ['Negate', heavy(u)],
            'True',
            0,
          ])
          .N().re,
        12
      );
  });

  test('the harvest records the served occurrences on the root candidate', () => {
    const expr = ce.box([
      'Which',
      ['Less', heavy('u'), 0],
      heavy('u'),
      'True',
      heavy('u'),
    ]);
    const harvest = harvestCse(expr as Expression);
    // The candidate is the one with exactly one own occurrence (the first
    // condition) and two served ones (the two arms). Its two summands occur
    // exactly where it does — same own count, same served count — so
    // subsumption keeps only the sum.
    const served = harvest.root.candidates.filter(
      (cand) => cand.occurrences.length === 1 && cand.served.length === 2
    );
    expect(served.map((cand) => cand.representative.toString()).sort()).toEqual(
      ['sin(6u) + cos(7u)']
    );
    for (const cand of served) {
      expect(cand.score).toBe(2 * cand.size);
      for (const occ of cand.served)
        expect(occ.region.kind).toBe('lazy-operand');
    }
  });

  test('a candidate that occurs only inside lazy arms still binds nothing', () => {
    const expr = ce.box([
      'Which',
      ['Less', 'x', 0],
      heavy('u'),
      ['Less', 'x', 1],
      heavy('u'),
      'True',
      heavy('u'),
    ]);
    const c = compile(expr, { fallback: false }).code;
    expect(c).not.toMatch(/_cse\d/);
    expect(occurrences(c, 'Math.sin(6 * _.u)')).toBe(3);
  });

  test('a served arm evaluates nothing new: the root occurrence already forced it', () => {
    // A getter counts every read of `u`. With the binding, `u` is read by the
    // definition only (D3 entry checks off, so the guard adds no read).
    const expr = ce.box([
      'Which',
      ['Less', heavy('u'), 0],
      heavy('u'),
      'True',
      heavy('u'),
    ]);
    const f = compile(expr, { fallback: false, entryChecks: false }).run as (
      v: any
    ) => number;
    let reads = 0;
    f({
      get u() {
        reads += 1;
        return 0.3;
      },
    });
    expect(reads).toBe(2); // sin(6u) and cos(7u), once each
  });

  test('a lambda that rebinds a name the candidate mentions is not served across', () => {
    // `heavy(u)` at the root and inside a `Function` whose parameter is `u`:
    // the inner one denotes a different value and must be emitted inline.
    const expr = ce.box([
      'Add',
      heavy('u'),
      ['Apply', ['Function', heavy('u'), 'u'], 2],
    ]);
    const harvest = harvestCse(expr as Expression);
    for (const cand of harvest.candidates) expect(cand.served).toHaveLength(0);
  });

  test('a loop body reads a binding evaluated once before the loop', () => {
    // `√(2 + heavy(u))` unconditionally at the root and inside a `Sum` body
    // that binds only `k`: the body region is served by the root binding.
    // (`Divide` keeps the root occurrence FIRST in operand order: the
    // binding is created when that occurrence is emitted, so a descendant
    // occurrence emitted earlier — a `Sum` that canonical ordering placed
    // first in an `Add` — would read nothing and emit inline.)
    const h = (v: string | number): any => ['Sqrt', ['Add', 2, heavy(v)]];
    const expr = ce.box([
      'Divide',
      h('u'),
      ['Sum', ['Multiply', 'k', h('u')], ['Limits', 'k', 1, 200]],
    ]);
    const harvest = harvestCse(expr as Expression);
    const served = harvest.root.candidates.filter(
      (cand) => cand.served.length > 0
    );
    expect(served.map((cand) => cand.served[0].region.kind)).toContain(
      'binder-body'
    );
    const c = compile(expr, { fallback: false }).code;
    expect(occurrences(c, 'Math.sin(6 * _.u)')).toBe(1);
    const f = compile(expr, { fallback: false }).run as (v: any) => number;
    expect(f({ u: 0.3 })).toBeCloseTo(
      ce
        .box([
          'Divide',
          h(0.3),
          ['Sum', ['Multiply', 'k', h(0.3)], ['Limits', 'k', 1, 200]],
        ])
        .N().re,
      9
    );
  });

  test('a descendant occurrence emitted before the root one is not served', () => {
    // Canonical ordering places the `Sum` first in the `Add`, so the loop
    // body is emitted before the root occurrence: nothing is served (the
    // harvest gate) and the code is what it was without the rule.
    const h = (v: string | number): any => ['Sqrt', ['Add', 2, heavy(v)]];
    const expr = ce.box([
      'Add',
      h('u'),
      ['Sum', ['Multiply', 'k', h('u')], ['Limits', 'k', 1, 200]],
    ]);
    expect(expr.op1.operator).toBe('Sum');
    const harvest = harvestCse(expr as Expression);
    for (const cand of harvest.candidates) expect(cand.served).toHaveLength(0);
    expect(
      occurrences(compile(expr, { fallback: false }).code, 'Math.sin(6 * _.u)')
    ).toBe(2);
  });
});
