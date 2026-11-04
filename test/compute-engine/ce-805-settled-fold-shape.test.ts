import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// ROADMAP CE-805: a JavaScript fold (`Sum` or `Product` of one collection,
// `Reduce` or `Scan` by `Add` or `Multiply`) whose element shape the static
// type settles tests no shape at run time. Elements that are numbers combine
// with the scalar helper, elements that are lists or points with the tensor
// helper, and a source typed as a list is not tested with `Array.isArray`.
// Before, `Sum(L)` with `L: list<tuple<real, real>>` compiled to
// `((_c) => Array.isArray(_c) ? _c.reduce((_a, _b) => Array.isArray(_a) ||
// Array.isArray(_b) ? _SYS.add(_a, _b) : _SYS.sadd(_a, _b), 0) : _c)(_.L)`.
// The values do not change: the tensor helper takes the number seed (`0`
// or `1`) as its first operand, as the dispatching form gave it on the
// first step.
//
// A fold whose element shape the type does not settle (`list<unknown>`, a
// union of a number and a list, an element typed `expression` or
// `broadcastable<T>`, a source typed `any` or `unknown`) declines with
// `unsettled-shape`, and the interpreter evaluates it.

type C = { re: number; im: number };
type Value = number | C | Value[];

/** The MathJSON of a host value. `point` boxes the innermost arrays as
 * tuples. */
function toJson(v: Value, point: boolean): unknown {
  if (Array.isArray(v)) {
    const isPoint = point && v.every((x) => !Array.isArray(x));
    return [isPoint ? 'Tuple' : 'List', ...v.map((x) => toJson(x, point))];
  }
  if (typeof v === 'object') return ['Complex', v.re, v.im];
  return v;
}

/** The host value of a MathJSON result of `evaluate()`. */
function fromJson(json: unknown): unknown {
  if (typeof json === 'number') return json;
  if (Array.isArray(json)) {
    const [head, ...rest] = json;
    if (head === 'List' || head === 'Tuple') return rest.map(fromJson);
    if (head === 'Complex') return { re: rest[0], im: rest[1] };
  }
  throw new Error(`unexpected value ${JSON.stringify(json)}`);
}

function compiledAndEvaluated(
  expr: unknown,
  type: string,
  value: Value,
  point = false
): { code: string; compiled: unknown; evaluated: unknown } {
  const ce = new ComputeEngine();
  ce.declare('L', type);
  const r = compile(ce.box(expr as any), {
    to: 'javascript',
    fallback: false,
  } as any);
  expect(r.success).toBe(true);
  ce.assign('L', ce.box(toJson(value, point) as any));
  return {
    code: r.code,
    compiled: r.run!({ L: value } as never),
    evaluated: fromJson(ce.box(expr as any).evaluate({ materialization: true }).json),
  };
}

const ROWS = [
  [1, 2],
  [3, 4],
  [5, 6],
];
const MATRICES = [
  [
    [1, 2],
    [3, 4],
  ],
  [
    [0, 1],
    [1, 0],
  ],
];
const COMPLEX_ROWS = [
  [{ re: 1, im: 2 }, 3],
  [4, { re: 0, im: -1 }],
];

describe('A FOLD WHOSE ELEMENT SHAPE THE TYPE SETTLES (CE-805)', () => {
  test.each([
    ['Sum', 'list<real>', [1, 2, 3], false],
    ['Sum', 'list<tuple<real, real>>', ROWS, true],
    ['Sum', 'list<vector<real^2>>', ROWS, false],
    ['Sum', 'list<list<real>>', ROWS, false],
    ['Sum', 'matrix<real^3x2>', ROWS, false],
    ['Sum', 'list<list<real>>', [], false],
    ['Sum', 'list<tuple<real, real>>', [[1, 2]], true],
    ['Sum', 'list<list<real>>', [[1, 2]], false],
    ['Sum', 'list<list<complex>>', COMPLEX_ROWS, false],
    ['Product', 'list<real>', [2, 3, 4], false],
    ['Product', 'list<list<real>>', ROWS, false],
    ['Product', 'list<matrix<real^2x2>>', MATRICES, false],
    ['Product', 'list<matrix<real^2x2>>', [], false],
    ['Product', 'list<matrix<real^2x2>>', [MATRICES[0]], false],
    ['Product', 'list<list<complex>>', COMPLEX_ROWS, false],
  ] as const)(
    '%s(L) with L: %s, %j, has the interpreter value',
    (kind, type, value, point) => {
      const r = compiledAndEvaluated(
        [kind, 'L'],
        type,
        value as Value,
        point
      );
      expect(r.compiled).toEqual(r.evaluated);
      expect(r.code).not.toContain('Array.isArray');
    }
  );

  test.each([
    [['Reduce', 'L', 'Add', 0], 'list<list<real>>', ROWS],
    [['Reduce', 'L', 'Add', 0], 'list<list<real>>', []],
    [['Reduce', 'L', 'Add', 0], 'list<list<real>>', [[1, 2]]],
    [['Reduce', 'L', 'Add', 0], 'list<list<complex>>', COMPLEX_ROWS],
    [['Reduce', 'L', 'Multiply', 1], 'list<matrix<real^2x2>>', MATRICES],
    [['Scan', 'L', 'Add'], 'list<list<real>>', ROWS],
    [['Scan', 'L', 'Add'], 'list<list<real>>', [[1, 2]]],
    [['Scan', 'L', 'Multiply'], 'list<matrix<real^2x2>>', MATRICES],
  ] as const)('%j with L: %s, %j, has the interpreter value', (expr, type, value) => {
    const r = compiledAndEvaluated(expr, type, value as Value);
    expect(r.compiled).toEqual(r.evaluated);
    expect(r.code).not.toContain('Array.isArray');
  });

  test('the sum of a list of points is the tensor fold, with no test', () => {
    const r = compiledAndEvaluated(
      ['Sum', 'L'],
      'list<tuple<real, real>>',
      ROWS,
      true
    );
    expect(r.code).toBe('(_.L).reduce((_a, _b) => _SYS.add(_a, _b), 0)');
  });

  test('the sum of L: list<list> is the tensor fold, with no test', () => {
    const r = compiledAndEvaluated(['Sum', 'L'], 'list<list>', [
      [1, 2],
      [3, 4],
    ]);
    expect(r.compiled).toEqual(r.evaluated);
    expect(r.code).not.toContain('Array.isArray');
  });

  test('the sum of a mapped function that gives a vector is the tensor fold', () => {
    const expressions = [
      ['Sum', ['Map', 'g', 'xs']],
      ['Reduce', ['Map', 'g', 'xs'], 'Add', 0],
      ['Scan', ['Map', 'g', 'xs'], 'Add'],
    ];
    for (const expr of expressions) {
      // A fresh engine for each expression: `xs` is assigned only after the
      // expression has compiled, so the compilation sees a declared input
      // and not a constant collection that the interpreter could fold.
      const ce = new ComputeEngine();
      ce.declare('xs', 'list<real>');
      ce.declare('g', 'function');
      ce.assign(
        'g',
        ce.box(['Function', ['List', 't', ['Multiply', 2, 't']], 't'])
      );
      const r = compile(ce.box(expr as any), {
        to: 'javascript',
        fallback: false,
      } as any);
      expect(r.success).toBe(true);
      expect(r.code).not.toContain('Array.isArray');
      const compiled = r.run!({ xs: [1, 2, 3] } as never);
      ce.assign('xs', ce.box(['List', 1, 2, 3]));
      expect(compiled).toEqual(fromJson(ce.box(expr as any).evaluate({ materialization: true }).json));
    }
  });
});

describe('A FOLD WHOSE ELEMENT SHAPE THE TYPE DOES NOT SETTLE (CE-805)', () => {
  // The elements may be numbers or lists: the compilation declines, and the
  // interpreter gives the value.
  test.each([
    [['Sum', 'L'], 'list<unknown>', '[9,12]'],
    [['Sum', 'L'], 'list<real | list<real>>', '[9,12]'],
    [['Product', 'L'], 'list<unknown>', '[15,48]'],
    [['Reduce', 'L', 'Add', 0], 'list<unknown>', '[9,12]'],
    [['Scan', 'L', 'Add'], 'list<unknown>', '[[1,2],[4,6],[9,12]]'],
  ] as const)('%j with L: %s declines', (expr, type, value) => {
    const ce = new ComputeEngine();
    ce.declare('L', type);
    const r = compile(ce.box(expr as any), { to: 'javascript' } as any);
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
    ce.assign('L', ce.box(toJson(ROWS, false) as any));
    expect(
      ce
        .box(expr as any)
        .evaluate({ materialization: true })
        .toString()
    ).toBe(value);
  });

  test('a fold over a host function typed (real) -> any declines', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('g', '(real) -> any');
    const r = compile(ce.box(['Sum', ['g', 'x']]), {
      to: 'javascript',
      functions: { g: (t: number) => [t, 2 * t] },
    } as any);
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });

  test.each([
    ['(real) -> unknown', ['Sum', ['g', 'x']]],
    ['(real) -> unknown', ['Reduce', ['g', 'x'], 'Add', 0]],
  ] as const)('a fold over a host function typed %s declines: %j', (sig, expr) => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('g', sig);
    const r = compile(ce.box(expr as any), {
      to: 'javascript',
      functions: { g: (t: number) => [t, 2 * t] },
    } as any);
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });

  // A source that is a number or a list, with elements of a settled shape,
  // keeps one test of its own shape: a number is the fold of itself, as in
  // the interpreter. The elements are not tested.
  test('a fold over a host function typed (real) -> real | list<real> tests the source', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('g', '(real) -> real | list<real>');
    const r = compile(ce.box(['Sum', ['g', 'x']]), {
      to: 'javascript',
      fallback: false,
      functions: { g: (t: number) => (t > 0 ? [t, 2 * t] : t) },
    } as any);
    expect(r.code).not.toContain('Array.isArray(_a)');
    expect(r.run!({ x: 3 } as never)).toBe(9);
    expect(r.run!({ x: -3 } as never)).toBe(-3);
  });

  test.each(['list<broadcastable<real>>', 'collection<expression>'])(
    'Sum(L) with L: %s declines',
    (type) => {
      const ce = new ComputeEngine();
      ce.declare('L', type);
      const r = compile(ce.box(['Sum', 'L']), { to: 'javascript' } as any);
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('unsettled-shape');
      ce.assign('L', ce.box(toJson(ROWS, false) as any));
      expect(
        ce.box(['Sum', 'L']).evaluate({ materialization: true }).toString()
      ).toBe('[9,12]');
    }
  );

  test('a fold over an input with no type declines with untyped-input', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'any');
    const r = compile(ce.box(['Sum', 'a']), { to: 'javascript' } as any);
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('untyped-input');
  });
});
