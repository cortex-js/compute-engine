import { ComputeEngine, compile } from '../../src/compute-engine';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { provenPointWidth } from '../../src/compute-engine/compilation/javascript-value-facts';
import type { MathJsonExpression } from '../../src/math-json/types';

const source = (r: { code?: string; preamble?: string }) =>
  (r.preamble ?? '') + (r.code ?? '');

function engine() {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('W', 'list<real^2>');
  ce.parse('f(u,v):=\\frac{[-v,u]}{u^2+v^2}').evaluate();
  return ce;
}
function define(ce: ComputeEngine, name: string, body: MathJsonExpression) {
  ce.declare(name, 'function');
  ce.assign(name, ce.box(['Function', body, 'u', 'v']));
}

const f: MathJsonExpression = ['f', 'x', 'y'];
const scaled: MathJsonExpression = ['Multiply', 2, f];

test('a retained vector helper keeps width through arithmetic and reduction', () => {
  const ce = engine();
  const expr = ce.parse('1-(\\sum(f(x+1,y+3)+f(x-1,y+3)))^2');
  const r = compile(expr);
  expect(r.success).toBe(true);
  expect(source(r)).not.toMatch(/Array\.isArray|_SYS\.bcast\(|\.reduce\(/);
  expect(r.preamble?.match(/const _fn_f/g)).toHaveLength(1);
  for (const [x, y] of [
    [2, 3],
    [-2, 1],
    [0.3, 0.7],
  ]) {
    expect(r.run!({ x, y })).toBeCloseTo(expr.subs({ x, y }).N().re, 12);
  }
});

test('three scaled vectors add without shape guards', () => {
  const ce = engine();
  const expr = ce.box([
    'Add',
    scaled,
    ['Multiply', 3, ['f', ['Add', 'x', 1], 'y']],
    ['Multiply', -1, ['f', 'x', ['Add', 'y', 1]]],
  ]);
  const r = compile(expr);
  expect(r.success).toBe(true);
  expect(source(r)).not.toMatch(/Array\.isArray|_SYS\.bcast\(/);
  const actual = r.run!({ x: 3, y: 4 }) as number[];
  expr
    .subs({ x: 3, y: 4 })
    .N()
    .ops.forEach((op, i) => expect(actual[i]).toBeCloseTo(op.re, 12));
});

test('local vector assignments carry their widths to arithmetic and reduction', () => {
  const ce = engine();
  define(ce, 'local', [
    'Block',
    ['Declare', 'a'],
    ['Assign', 'a', ['f', 'u', 'v']],
    ['Declare', 'b'],
    ['Assign', 'b', ['Add', 'a', 'a']],
    ['Sum', 'b'],
  ]);
  const r = compile(ce.box(['local', 'x', 'y']));
  expect(r.success).toBe(true);
  expect(source(r)).not.toMatch(/Array\.isArray|_SYS\.bcast\(|\.reduce\(/);
  expect(r.preamble).toMatch(/let a/);
  expect(r.run!({ x: 3, y: 4 })).toBeCloseTo(-0.08, 12);
});

test('a local reassigned from a runtime input retains its reduction fallback', () => {
  const ce = engine();
  define(ce, 'local', [
    'Block',
    ['Declare', 'a'],
    ['Assign', 'a', ['List', 'u', 'v']],
    ['Assign', 'a', 'W'],
    ['Sum', 'a'],
  ]);
  const r = compile(ce.box(['local', 'x', 'y']));
  expect(r.success).toBe(true);
  expect(source(r)).toContain('.reduce(');
  expect(r.run!({ x: 1, y: 2, W: [10, 20, 30] })).toBe(60);
  expect(r.run!({ x: 1, y: 2, W: [] })).toBe(0);
});

test('a nested helper cannot mutate an array local behind a shape proof', () => {
  const ce = engine();
  ce.declare('mutate', 'function');
  ce.declare('mutator', 'function');
  ce.assign(
    'mutator',
    ce.box([
      'Function',
      ['Block', ['mutate', 'items']],
      ['Typed', 'items', "'list<real>'"],
    ])
  );
  define(ce, 'local', [
    'Block',
    ['Declare', 'a'],
    ['Assign', 'a', ['List', 'u', 'v']],
    ['Declare', 'ignored'],
    ['Assign', 'ignored', ['mutator', 'a']],
    ['Sum', 'a'],
  ]);
  const r = compile(ce.box(['local', 'x', 'y']), {
    functions: { mutate: '(a => {a.push(10); return 0;})' },
  });
  expect(r.success).toBe(true);
  expect(source(r)).toContain('.reduce(');
  expect(r.run!({ x: 1, y: 2 })).toBe(13);
});

test('lists passed to scalar helpers still broadcast instead of becoming whole points', () => {
  const ce = engine();
  define(ce, 's', ['Block', ['Add', 'u', 'v']]);
  const r = compile(ce.box(['s', ['List', 'x', 'y'], 1]));
  expect(r.success).toBe(true);
  expect(source(r)).toContain('_SYS.bcastFn');
  expect(r.run!({ x: 2, y: 4 })).toEqual([3, 5]);
});

test('an array-valued helper called with a list keeps its nested result', () => {
  const ce = engine();
  define(ce, 'pair', ['Block', ['List', 'u', 'v']]);
  const r = compile(ce.box(['pair', ['List', 'x', 'y'], 1]));
  expect(r.success).toBe(true);
  expect(r.run!({ x: 2, y: 4 })).toEqual([
    [2, 1],
    [4, 1],
  ]);
});

test.each(['Sum', 'Product'] as const)(
  '%s preserves identity, order, and non-finite arithmetic',
  (kind) => {
    const ce = engine();
    define(ce, 'pair', ['Block', ['List', 'u', 'v']]);
    const r = compile(ce.box([kind, ['pair', 'x', 'y']]));
    expect(r.success).toBe(true);
    expect(source(r)).not.toMatch(/Array\.isArray|\.reduce\(/);
    for (const [x, y] of [
      [-0, -0],
      [Infinity, -Infinity],
      [NaN, 1],
      [1e16, -1e16],
    ]) {
      const expected = [x, y].reduce(
        (a, b) => (kind === 'Sum' ? a + b : a * b),
        kind === 'Sum' ? 0 : 1
      );
      expect(r.run!({ x, y })).toBe(expected);
    }
  }
);

test('fixed-width sums keep left-to-right cancellation', () => {
  const ce = engine();
  define(ce, 'terms', ['Block', ['List', 'u', 1, ['Negate', 'u'], 1]]);
  const r = compile(ce.box(['Sum', ['terms', 'x', 'y']]));
  expect(r.success).toBe(true);
  expect(source(r)).not.toContain('.reduce(');
  expect(r.run!({ x: 1e16, y: 0 })).toBe(
    [1e16, 1, -1e16, 1].reduce((a, b) => a + b, 0)
  );
});

test('declared list inputs retain broadcasting and reduction guards', () => {
  const ce = engine();
  const sum = compile(ce.box(['Sum', 'W']));
  const plus = compile(ce.box(['Add', 'W', 1]));
  expect(source(sum)).toContain('Array.isArray');
  expect(source(plus)).toContain('_SYS.bcast');
  expect(sum.run!({ W: [] })).toBe(0);
  expect(sum.run!({ W: [1, 2, 3] })).toBe(6);
  expect(
    plus.run!({
      W: [
        [1, 2],
        [3, 4],
      ],
    })
  ).toEqual([
    [2, 3],
    [4, 5],
  ]);
  expect(plus.run!({ W: undefined })).toBeNaN();
});

test('list broadcasting cannot prove a nested coordinate scalar', () => {
  const ce = engine();
  define(ce, 'absolute', ['Block', ['Abs', 'u']]);
  define(ce, 'nested', [
    'Block',
    ['List', ['absolute', ['List', 'u', 'v'], 0], 1],
  ]);
  const expr = ce.box(['nested', 'x', 'y']);
  const target = new JavaScriptTarget().createTarget({
    cse: { enabled: false, instances: [], harvestOptions: {} },
    userFunctions: { defs: new Map(), compiling: new Set() },
  });
  target.userFunctions!.root = target;
  expect(provenPointWidth(expr, target)).toBeUndefined();
  const r = compile(expr);
  expect(r.success).toBe(true);
  expect(r.run!({ x: -2, y: 4 })).toEqual([[2, 4], 1]);
});

test.each(['Add', 'Multiply', 'Divide'] as const)(
  '%s keeps constructed list width with scalar broadcasting',
  (head) => {
    const ce = engine();
    const expr = ce.box(['Sum', [head, ['f', 'x', 'y'], 2]]);
    const r = compile(expr);
    expect(r.success).toBe(true);
    expect(source(r)).not.toMatch(/Array\.isArray|_SYS\.bcast\(|\.reduce\(/);
    expect(r.run!({ x: 3, y: 4 })).toBeCloseTo(
      expr.subs({ x: 3, y: 4 }).N().re,
      12
    );
  }
);

test.each<[string, MathJsonExpression]>([
  ['vector base', ['Power', f, 2]],
  ['vector exponent', ['Power', 2, f]],
])('Power keeps constructed list width with a %s', (_, power) => {
  const ce = engine();
  const expr = ce.box(power);
  const sum = ce.box(['Sum', power]);
  const target = new JavaScriptTarget().createTarget({
    cse: { enabled: false, instances: [], harvestOptions: {} },
    userFunctions: { defs: new Map(), compiling: new Set() },
  });
  target.userFunctions!.root = target;
  expect(provenPointWidth(expr, target)).toBe(2);
  const r = compile(expr);
  const reduced = compile(sum);
  for (const result of [r, reduced]) {
    expect(result.success).toBe(true);
    expect(source(result)).not.toMatch(/Array\.isArray|_SYS\.bcast\(/);
  }
  // Power can produce complex values, so its sum keeps complex-capable reduction.
  expect(source(reduced)).toContain('.reduce(');
  for (const [x, y] of [
    [3, 4],
    [-2, 1],
    [0.3, 0.7],
  ]) {
    const actual = r.run!({ x, y }) as number[];
    const expected = expr.subs({ x, y }).N().ops;
    expect(actual).toHaveLength(expected.length);
    expected.forEach((op, i) => expect(actual[i]).toBeCloseTo(op.re, 12));
    expect(reduced.run!({ x, y })).toBeCloseTo(sum.subs({ x, y }).N().re, 12);
  }
});
