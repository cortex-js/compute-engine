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
  'runtime inputs keep a separate guarded helper, runtime first: %s, typed parameter: %s',
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
    expect(r.preamble?.match(/Array\.isArray/g)).toHaveLength(2);
    const expected = (v: unknown) => (runtimeFirst ? [v, 17] : [17, v]);
    expect(r.run!({ x: 4, W: [1, 2, 3] })).toEqual(expected(14));
    expect(
      r.run!({
        x: 4,
        W: [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
        ],
      })
    ).toEqual(expected([14, 32, 50]));
    expect(r.run!({ x: 4, W: [] })).toEqual(expected(NaN));
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
  expect(r.preamble?.match(/Array\.isArray/g)).toHaveLength(4);
  expect(
    r.run!({
      x: 1,
      W: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
    })
  ).toEqual([
    [14, 32, 50],
    [30, 36, 42],
  ]);
});

test('a caller-supplied function may mutate a point before its dot product', () => {
  const ce = fixture([
    'Block',
    ['mutate', 'p'],
    ['Dot', 'p', ['Tuple', 1, 2, 3]],
  ]);
  ce.declare('mutate', 'function');
  const r = compile(ce.box(constructed), {
    functions: { mutate: '(p => { p.push(4); return 0; })' },
  });
  expect(r.success).toBe(true);
  expect(source(r)).toContain('Array.isArray');
  expect(source(r)).toContain('_SYS.matmul');
  expect(r.run!({ x: 1 })).toBeNaN();
});
