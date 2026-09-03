import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Tycho items 245, 246 and 247 (filed 2026-09-03).
 *
 * 245 — the JavaScript target COMPILED point arithmetic the interpreter
 * rejects: a product of two point lists ran to the component-wise product,
 * a point list plus a scalar broadcast the scalar into both components,
 * and two comprehension shapes compiled and then threw at run time. Every
 * one of those now fails closed at compile time, matching the interpreter.
 *
 * 246 — three list-arithmetic gaps the interpreter answers: (a) a radical or
 * logarithm over a list was not admitted as a list operand of a sum or a
 * product; (b) arithmetic over a point list whose column carries a complex
 * element failed closed; (c) `point + (list, list)` typed as a union of two
 * layouts.
 *
 * 247 — `toLatex({ materialization: false })` evaluated the bound bodies of
 * a `Join`'s operands.
 */

const P = [
  [1, 2],
  [3, 4],
];
const P2 = [
  [10, 20],
  [30, 40],
];
const L = [2, 3];
const C = [5, 7];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  ce.declare('P', 'list<tuple<number, number>>');
  ce.declare('P2', 'list<tuple<number, number>>');
  ce.declare('L', 'list<number>');
  ce.declare('C', 'tuple<number, number>');
  ce.declare('s', 'number');
  return ce;
}

describe('Tycho item 245 — point arithmetic the interpreter rejects fails closed', () => {
  const ce = engine();
  test.each([
    ['P·P (two point lists)', ['Multiply', 'P', 'P']],
    ['P·P2 (two point lists)', ['Multiply', 'P', 'P2']],
    ['P + s (point list + scalar)', ['Add', 'P', 's']],
    ['P + L (point list + scalar list)', ['Add', 'P', 'L']],
    ['P − s', ['Subtract', 'P', 's']],
    ['s − P', ['Subtract', 's', 'P']],
    ['s / P (scalar over a point list)', ['Divide', 's', 'P']],
    ['literal point list · itself', [
      'Multiply',
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
    ]],
    ['literal point list + s', [
      'Add',
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      's',
    ]],
  ])('%s', (_label, json) => {
    const r = compile(ce.box(json as never), { to: 'javascript' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/list-valued operand/);
  });

  test('the point-list shapes the interpreter answers keep compiling', () => {
    const cases: [unknown, unknown][] = [
      [['Multiply', 'P', 'L'], [[2, 4], [9, 12]]],
      [['Multiply', 'P', 's'], [[10, 20], [30, 40]]],
      [['Multiply', 'C', 'L'], [[10, 14], [15, 21]]],
      [['Add', 'P', 'P2'], [[11, 22], [33, 44]]],
      [['Add', 'P', 'C'], [[6, 9], [8, 11]]],
      [['Subtract', 'P', 'C'], [[-4, -5], [-2, -3]]],
      [['Divide', 'P', 's'], [[0.1, 0.2], [0.3, 0.4]]],
      [['Divide', 'P', 'L'], [[0.5, 1], [1, 4 / 3]]],
      [['Negate', 'P'], [[-1, -2], [-3, -4]]],
    ];
    for (const [json, expected] of cases) {
      const r = compile(ce.box(json as never), { to: 'javascript' });
      expect(r.success).toBe(true);
      expect(r.run({ P, P2, L, C, s: 10 })).toEqual(expected);
    }
  });

  test('a comprehension whose binder shadows the list it iterates fails closed', () => {
    // Emitted `for (const P of P)`: a temporal-dead-zone read of the loop
    // variable. The interpreter leaves the form inert.
    const r = compile(
      ce.box([
        'Comprehension',
        ['Add', ['PointX', 'P'], 1],
        ['Element', 'P', 'P'],
      ] as never),
      { to: 'javascript' }
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/binder `P` occurs in the collection/);
    // A source whose own lambda reuses the binder's name binds it afresh
    // and never reads the loop variable: it keeps compiling.
    const shadowed = compile(
      ce.box([
        'Comprehension',
        ['Multiply', 'x', 2],
        ['Element', 'x', ['Filter', 'L', ['Function', ['Greater', 'x', 2], 'x']]],
      ] as never),
      { to: 'javascript' }
    );
    expect(shadowed.success).toBe(true);
    expect(shadowed.run({ L: [1, 2, 3, 4] })).toEqual([6, 8]);
  });

  test('a comprehension whose binder type contradicts the elements fails closed', () => {
    // Over a single point `C`, the loop binds each COMPONENT (a number); the
    // body's `PointX(q)` use typed the binder as a collection, and the
    // emitted `q.map(…)` threw at run time. The interpreter errors per
    // element.
    const r = compile(
      ce.box([
        'Comprehension',
        ['Add', ['PointX', 'q'], 1],
        ['Element', 'q', 'C'],
      ] as never),
      { to: 'javascript' }
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/binder `q` is typed/);
    // A scalar body over the same point iterates its components on both
    // routes, and keeps compiling.
    const ok = compile(
      ce.box(['Comprehension', ['Add', 'q', 1], ['Element', 'q', 'C']] as never),
      { to: 'javascript' }
    );
    expect(ok.success).toBe(true);
    expect(ok.run({ C })).toEqual([6, 8]);
  });
});

describe('Tycho item 246 (a) — a radical or logarithm over a list is a list operand', () => {
  const ce = engine();
  const Lv = [0.1, 0.2, 0.3];
  test.each([
    ['L + √L', ['Add', 'L', ['Sqrt', 'L']]],
    ['−√L', ['Negate', ['Sqrt', 'L']]],
    ['2·√L', ['Multiply', 2, ['Sqrt', 'L']]],
    ['L + ln L', ['Add', 'L', ['Ln', 'L']]],
    ['L + L^0.5', ['Add', 'L', ['Power', 'L', 0.5]]],
    ['√L + √L', ['Add', ['Sqrt', 'L'], ['Sqrt', 'L']]],
    ['sin √L', ['Sin', ['Sqrt', 'L']]],
  ])('%s compiles and agrees with the interpreter', (_label, json) => {
    const r = compile(ce.box(json as never), { to: 'javascript' });
    expect(r.success).toBe(true);
    const compiled = r.run({ L: Lv }) as number[];
    const ce2 = new ComputeEngine();
    ce2.precision = 'machine';
    ce2.assign('L', ce2.box(['List', ...Lv]));
    const expected = [...ce2.box(json as never).N().each()].map((x) => x.re);
    expect(compiled.length).toBe(expected.length);
    compiled.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 12));
  });

  test('the corpus witness N_k = (−√(1 − L²), L) compiles to a point list', () => {
    const r = compile(
      ce.box([
        'PointList',
        ['Negate', ['Sqrt', ['Subtract', 1, ['Power', 'L', 2]]]],
        'L',
      ] as never),
      { to: 'javascript' }
    );
    expect(r.success).toBe(true);
    const v = r.run({ L: [0.6] }) as number[][];
    expect(v[0][0]).toBeCloseTo(-0.8, 12);
    expect(v[0][1]).toBe(0.6);
  });

  test('a genuinely complex radical over a list keeps the complex lane', () => {
    // `√L` with a negative element is complex at that position: the
    // dispatching product answers the complex value the interpreter does.
    const r = compile(ce.box(['Multiply', 2, ['Sqrt', 'L']] as never), {
      to: 'javascript',
    });
    expect(r.success).toBe(true);
    const v = r.run({ L: [-4, 9] }) as [{ re: number; im: number }, number];
    expect(v[0].re).toBe(0);
    expect(v[0].im).toBeCloseTo(4, 12);
    expect(v[1]).toBeCloseTo(6, 12);
  });
});

describe('Tycho item 246 (b) — arithmetic over a point list with a complex column', () => {
  const ce = engine();
  // Desmos's `\sqrt{-1}` "undefined vertex" polygon separator: one column
  // element is complex, the rest are real.
  const separatorColumn = [
    'Comprehension',
    ['Which', ['Equal', ['Mod', 'n', 3], 0], ['Sqrt', -1], 'True', 5],
    ['Element', 'n', ['Range', 0, 2]],
  ];
  const Lv = [0.1, 0.2, 0.3];

  test('PointList(L, column) + (0, 0) compiles through the dispatching closure', () => {
    const r = compile(
      ce.box(['Add', ['PointList', 'L', separatorColumn], ['Tuple', 0, 0]] as never),
      { to: 'javascript' }
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.sadd');
    expect(r.run({ L: Lv })).toEqual([
      [0.1, { re: 0, im: 1 }],
      [0.2, 5],
      [0.3, 5],
    ]);
  });

  test('2 · PointList(L, column) compiles through the dispatching closure', () => {
    const r = compile(
      ce.box(['Multiply', 2, ['PointList', 'L', separatorColumn]] as never),
      { to: 'javascript' }
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.smul');
    expect(r.run({ L: Lv })).toEqual([
      [0.2, { re: 0, im: 2 }],
      [0.4, 10],
      [0.6, 10],
    ]);
  });

  test('a declared complex point list sums with a point', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('Z', 'list<tuple<complex, complex>>');
    const r = compile(ce2.box(['Add', 'Z', ['Tuple', 1, 2]] as never), {
      to: 'javascript',
    });
    expect(r.success).toBe(true);
    expect(
      r.run({
        Z: [
          [{ re: 1, im: 1 }, 0],
          [3, 4],
        ],
      })
    ).toEqual([
      [{ re: 2, im: 1 }, 2],
      [4, 6],
    ]);
  });

  test('arithmetic built on top of a point-plus-point-list sum keeps the mixed lane', () => {
    // The point-list sum is emitted as a nested closure (one level per
    // point); a further broadcast over it must still see a mixed lane and
    // dispatch. Both nestings agree with the interpreter.
    const ce2 = new ComputeEngine();
    ce2.declare('Z', 'list<tuple<complex, complex>>');
    ce2.declare('W', 'list<number>');
    const Z = [
      [{ re: 1, im: 1 }, 0],
      [3, 4],
    ];
    const product = compile(
      ce2.box(['Multiply', ['Add', 'Z', ['Tuple', 1, 2]], 'W'] as never),
      { to: 'javascript' }
    );
    expect(product.success).toBe(true);
    expect(product.run({ Z, W: [2, 3] })).toEqual([
      [{ re: 4, im: 2 }, 4],
      [12, 18],
    ]);
    const shifted = compile(
      ce2.box([
        'Add',
        ['Multiply', ['Add', 'Z', ['Tuple', 1, 2]], 2],
        ['Tuple', 0, 1],
      ] as never),
      { to: 'javascript' }
    );
    expect(shifted.success).toBe(true);
    expect(shifted.run({ Z })).toEqual([
      [{ re: 4, im: 2 }, 5],
      [8, 13],
    ]);
  });

  test('a head with no dispatching helper still fails closed on a mixed lane', () => {
    // `Divide` by a SYMBOL stays a `Divide`, which has no run-time
    // dispatching scalar helper; `Sin` has none either. (Division by a
    // literal canonicalizes to a product, which dispatches.)
    for (const json of [
      ['Divide', ['PointList', 'L', separatorColumn], 's'],
      ['Sin', ['PointList', 'L', separatorColumn]],
    ]) {
      const r = compile(ce.box(json as never), { to: 'javascript' });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/list-valued operand/);
    }
    const half = compile(
      ce.box(['Divide', ['PointList', 'L', separatorColumn], 2] as never),
      { to: 'javascript' }
    );
    expect(half.success).toBe(true);
    expect(half.run({ L: Lv })).toEqual([
      [0.05, { re: 0, im: 0.5 }],
      [0.1, 2.5],
      [0.15, 2.5],
    ]);
  });
});

describe('Tycho item 246 (c) — point + (list, list) types as the broadcast tuple', () => {
  const ce = engine();
  ce.declare('G', 'tuple<number, number>');
  ce.declare('L2', 'list<number>');

  test('G + (L, L2) is tuple<list<number>, list<number>>, not a union', () => {
    const e = ce.box(['Add', 'G', ['Tuple', 'L', 'L2']] as never);
    expect(e.type.toString()).toBe('tuple<list<number>, list<number>>');
    const r = compile(e, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run({ G: [10, 20], L: [0.1, 0.2], L2: [4, 5] })).toEqual([
      [10.1, 10.2],
      [24, 25],
    ]);
  });

  test('G + (−L2, L) and a mixed scalar/list tuple type component-wise', () => {
    expect(
      ce.box(['Add', 'G', ['Tuple', ['Negate', 'L2'], 'L']] as never).type.toString()
    ).toBe('tuple<list<number>, list<number>>');
    expect(
      ce.box(['Add', 'G', ['Tuple', 's', 'L']] as never).type.toString()
    ).toBe('tuple<number, list<number>>');
  });

  test('the interpreter answers the same tuple of lists', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('G', ce2.box(['Tuple', 10, 20]));
    ce2.assign('L', ce2.box(['List', 1, 2]));
    ce2.assign('L2', ce2.box(['List', 4, 5]));
    expect(
      ce2.box(['Add', 'G', ['Tuple', 'L', 'L2']] as never).evaluate().json
    ).toEqual(['Tuple', ['List', 11, 12], ['List', 24, 25]]);
  });

  test('all-scalar tuples keep their exact component-wise type', () => {
    expect(
      ce.box(['Add', 'G', ['Tuple', 1, 2]] as never).type.toString()
    ).toBe('tuple<number, number>');
  });
});

describe('Tycho item 247 — toLatex({ materialization: false }) never evaluates', () => {
  function setup(): { ce: ComputeEngine; calls: () => number } {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('g', {
      signature: '(number) -> number',
      evaluate: ([x]) => {
        calls++;
        return x;
      },
    });
    ce.declare('T', 'number'); // a valueless slider
    ce.assign('L', ce.box(['List', 1, 2, 3]));
    // m(P) = P + g(T): T is unbound, so the chain stays symbolic.
    ce.assign('m', ce.box(['Function', ['Add', 'P', ['g', 'T']], 'P']));
    ce.assign('q_1', ce.box(['m', 'L']));
    ce.assign('q_2', ce.box(['m', 'q_1']));
    return { ce, calls: () => calls };
  }

  test('Join over a symbolic carrier serializes as its name with zero evaluations', () => {
    const { ce, calls } = setup();
    expect(ce.box(['Join', 'q_2']).toLatex({ materialization: false })).toBe(
      '\\mathrm{Join}(q_2)'
    );
    expect(calls()).toBe(0);
    expect(
      ce.box(['Join', 'q_2', 'L']).toLatex({ materialization: false })
    ).toBe('\\mathrm{Join}(q_2, L)');
    expect(calls()).toBe(0);
  });

  test('the default serialization is unchanged', () => {
    const { ce, calls } = setup();
    expect(ce.box(['Join', 'q_2']).toLatex()).toBe('\\mathrm{Join}(q_2)');
    expect(calls()).toBe(0);
    // An explicit `materialization: true` still materializes a lazy
    // collection whose elements are available.
    expect(
      ce.box(['Join', ['List', 1, 2], ['List', 3]]).toLatex({
        materialization: true,
      })
    ).toBe('\\bigl\\lbrack1, 2, 3\\bigr\\rbrack');
  });

  test('a faithful lazy head keeps its operator form under the opt-out', () => {
    const ce = new ComputeEngine();
    const latex = ce
      .box(['Map', ['List', 1, 2, 3], ['Function', ['Add', 'x', 1], 'x']])
      .toLatex({ materialization: false });
    expect(latex).toContain('Map');
  });
});
