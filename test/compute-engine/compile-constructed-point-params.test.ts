import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import {
  provenScalarPointWidth,
  recordConstructedPointParams,
  recordScopeParent,
} from '../../src/compute-engine/compilation/javascript-value-facts';

const source = (r: { code?: string; preamble?: string }) =>
  (r.preamble ?? '') + (r.code ?? '');

function fixture(
  body: MathJsonExpression = ['Dot', 'p', ['Tuple', 1, 2, 3]],
  parameter: MathJsonExpression = 'p'
) {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('W', 'tuple<real, real, real>');
  ce.declare('hash', 'function');
  ce.assign('hash', ce.box(['Function', ['Block', body], parameter]));
  return ce;
}

const constructed: MathJsonExpression = ['hash', ['Tuple', 'x', 2, 3]];

test('constructed point calls share an unguarded helper without changing its public signature', () => {
  const ce = fixture();
  const signature = ce.box('hash').type.toString();
  const r = compile(
    ce.box(['Tuple', constructed, ['hash', ['Tuple', 4, 'x', 6]]])
  );
  expect(r.success).toBe(true);
  expect(source(r)).not.toMatch(/Array\.isArray|_SYS\.(?:matmul|bcast)/);
  expect(r.preamble?.match(/const _fn_hash/g)).toHaveLength(1);
  for (const x of [-2, 0, 4])
    expect(r.run!({ x })).toEqual([x + 13, 22 + 2 * x]);
  expect(ce.box('hash').type.toString()).toBe(signature);
});

test.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])(
  'runtime inputs keep a separate helper, runtime first: %s, typed parameter: %s',
  (runtimeFirst, typed) => {
    const ce = fixture(
      undefined,
      typed ? ['Typed', 'p', { str: 'tuple<real, real, real>' }] : 'p'
    );
    const calls: MathJsonExpression[] = [constructed, ['hash', 'W']];
    if (runtimeFirst) calls.reverse();
    const r = compile(ce.box(['Tuple', ...calls]));
    expect(r.success).toBe(true);
    expect(r.preamble?.match(/const _fn_hash/g)).toHaveLength(2);
    const expected = (v: unknown) => (runtimeFirst ? [v, 17] : [17, v]);
    // `W` is declared `tuple<real, real, real>`: the host supplies three
    // numbers.
    expect(r.run!({ x: 4, W: [1, 2, 3] })).toEqual(expected(14));
  }
);

test('proven point parameters propagate through retained helper calls and loop scopes', () => {
  const ce = fixture([
    'Sum',
    ['Dot', 'p', ['Tuple', 1, 2, 3]],
    ['Limits', 'i', 1, 2],
  ]);
  ce.declare('outer', 'function');
  ce.assign('outer', ce.box(['Function', ['Block', ['hash', 'q']], 'q']));
  const r = compile(ce.box(['outer', ['Tuple', 'x', 2, 3]]), {
    constantFold: false,
  });
  expect(r.success).toBe(true);
  expect(source(r)).not.toMatch(/Array\.isArray|_SYS\.(?:matmul|bcast)/);
  expect(r.preamble).toContain('const _fn_outer');
  expect(r.preamble).toContain('const _fn_hash');
  expect(r.run!({ x: 4 })).toBe(34);
});

// The proof that an argument is a constructed point states what the declared
// tuple already states, so a copy with the declared parameter types would have
// the text of the definition. `g` calls `P` with a coordinate of a wide type,
// and the sum calls it with a proven point: both calls take one definition.
describe('a proven point at a parameter declared as a tuple of numbers', () => {
  const inSum: MathJsonExpression = [
    'Sum',
    ['P', ['Tuple', ['Add', 'n', 's'], 'n', 'n']],
    ['Limits', 'n', 0, 'N'],
  ];
  const engine = (parameter: string) => {
    const ce = new ComputeEngine();
    const wide = 'real|signed_infinity|nan';
    ce.declare('s', 'real<-10..10>');
    ce.declare('N', 'integer<0..10>');
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.declare('P', `(${parameter}) -> number`);
    ce.declare('g', `(${wide}, ${wide}) -> ${wide}`);
    const at = (k: number): MathJsonExpression => [
      'Multiply',
      k + 2,
      ['At', 'p', k],
    ];
    ce.assign(
      'P',
      ce.box(['Function', ['Sin', ['Add', at(1), at(2), at(3)]], 'p'])
    );
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['P', ['Tuple', ['Floor', 'a'], ['Floor', 'b'], 's']],
        'a',
        'b',
      ])
    );
    return ce;
  };
  const definitionsOfP = (r: { preamble?: string }) =>
    (r.preamble ?? '').split('\n').filter((l) => l.startsWith('const _fn_P'));

  const wideCoordinate = 'real|signed_infinity|nan';
  test.each([
    ['tuple<real, real, real>'],
    ['tuple<number, number, number>'],
    [`tuple<${wideCoordinate}, ${wideCoordinate}, ${wideCoordinate}>`],
  ])(
    'a call in a sum and a call out of it share one definition: %s',
    (type) => {
      const ce = engine(type);
      const expr = ce.box(['Add', ['g', 'x', 'y'], inSum]);
      const r = compile(expr, { fallback: false });
      expect(definitionsOfP(r)).toEqual([
        'const _fn_P = (p) => Math.sin(3 * _SYS.at(p, 1) + 4 * _SYS.at(p, 2) + 5 * _SYS.at(p, 3));',
      ]);
      const vars = { x: 2.5, y: -1.5, s: 0.25, N: 3 };
      const value = r.run!(vars);
      for (const [name, v] of Object.entries(vars)) ce.assign(name, v);
      expect(value).toBeCloseTo(expr.evaluate().re, 12);
    }
  );

  test('the only call, a proven point, takes the definition', () => {
    const r = compile(engine('tuple<real, real, real>').box(inSum), {
      fallback: false,
    });
    expect(definitionsOfP(r)).toHaveLength(1);
    expect(definitionsOfP(r)[0]).toMatch(/^const _fn_P = /);
  });
});

// A parameter with an inferred tuple type can receive a list of any shape, so
// the definition tests each read. The copy for a proven point needs no test.
test('a proven point at a parameter with an inferred type keeps its copy', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.assign(
    'Q',
    ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'])
  );
  const r = compile(
    ce.box(['Q', ['Tuple', ['Add', 'x', 1], ['Multiply', 2, 'y']]]),
    { fallback: false }
  );
  expect(source(r)).not.toContain('_SYS.atNumeric');
  expect(r.run!({ x: 2, y: 3 })).toBe(9);
});

test('parameter writes do not inherit entry-point shape evidence', () => {
  const ce = fixture([
    'Block',
    ['Assign', 'p', 'W'],
    ['Dot', 'p', ['Tuple', 1, 2, 3]],
  ]);
  expect(() => compile(ce.box(constructed), { fallback: false })).toThrow(
    /parameter that receives it has no declared or inferred type/
  );
});

test('constructed scalar points retain NaN and infinity arithmetic', () => {
  const r = compile(fixture().box(constructed));
  for (const x of [NaN, Infinity, -Infinity]) expect(r.run!({ x })).toBe(x);
});

test('a nested binding masks a proven point parameter of the same name', () => {
  const ce = fixture();
  const parent = new Set(['W']);
  const target = new JavaScriptTarget().createTarget({ boundVars: parent });
  recordConstructedPointParams(target, new Map([['W', 3]]));
  expect(provenScalarPointWidth(ce.box('W'), target)).toBe(3);
  const loop = new Set(['W', 'i']);
  recordScopeParent(loop, parent, ['i']);
  expect(
    provenScalarPointWidth(ce.box('W'), { ...target, boundVars: loop })
  ).toBe(3);
  const shadow = new Set(['W', 'i']);
  recordScopeParent(shadow, loop, ['W']);
  expect(
    provenScalarPointWidth(ce.box('W'), { ...target, boundVars: shadow })
  ).toBeUndefined();
});

test('partial point proofs keep their argument positions in the helper cache', () => {
  const ce = fixture();
  ce.declare('pairdot', 'function');
  ce.assign(
    'pairdot',
    ce.box(['Function', ['Block', ['Dot', 'p', 'q']], 'p', 'q'])
  );
  const point: MathJsonExpression = ['Tuple', 'x', 2, 3];
  const r = compile(
    ce.box(['Tuple', ['pairdot', 'W', point], ['pairdot', point, 'W']])
  );
  expect(r.success).toBe(true);
  expect(r.preamble?.match(/const _fn_pairdot/g)).toHaveLength(2);
  expect(r.run!({ x: 1, W: [1, 2, 3] })).toEqual([14, 14]);
});

test.each([false, true])(
  'broad runtime point coordinates keep broadcasting, runtime first: %s',
  (runtimeFirst) => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const point = 'tuple<broadcastable<number>, broadcastable<number>>';
    ce.declare('P', point);
    ce.declare('dotPoint', {
      signature: `(${point}) -> broadcastable<number>`,
    });
    ce.assign(
      'dotPoint',
      ce.expr(['Function', ['Dot', 'p', ['Tuple', 3, 4]], 'p'])
    );
    const signature = ce.box('dotPoint').type.toString();
    const calls: MathJsonExpression[] = [
      ['dotPoint', ['Tuple', 'x', ['Add', 'x', 1]]],
      ['dotPoint', 'P'],
    ];
    if (runtimeFirst) calls.reverse();
    const result = compile(ce.expr(['Tuple', ...calls]), { fallback: false });
    expect(result.success).toBe(true);
    expect(result.preamble?.match(/const _fn_dotPoint/g)).toHaveLength(2);
    expect(source(result)).toContain('_SYS.bcast(');
    const expected = (value: unknown) =>
      runtimeFirst ? [value, 18] : [18, value];
    for (const [P, value] of [
      [[1, 2], 11],
      [
        [1, [1, 2]],
        [7, 11],
      ],
      [
        [[1, 2], 1],
        [7, 10],
      ],
      [
        [
          [1, 2],
          [3, 4],
        ],
        [15, 22],
      ],
      // A broadcast over a lone empty coordinate answers the empty list, as
      // the interpreter does (`docs/BROADCAST-MODEL.md`).
      [[1, []], []],
      [[[], 1], []],
      [[NaN, 2], NaN],
      [
        [1, [NaN, Infinity]],
        [NaN, Infinity],
      ],
    ] as [unknown, unknown][])
      expect(result.run!({ x: 2, P })).toEqual(expected(value));
    expect(ce.box('dotPoint').type.toString()).toBe(signature);
  }
);
