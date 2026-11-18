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

describe('A FOLD WHOSE ELEMENT SHAPE THE TYPE SETTLES (CE-805)', () => {
  test.each([
    ['Sum', 'list<real>', [1, 2, 3], false],
    ['Product', 'list<real>', [2, 3, 4], false],
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
});

describe('A FOLD WHOSE ELEMENT SHAPE THE TYPE DOES NOT SETTLE (CE-805)', () => {
  // The elements may be numbers or lists: the compilation declines, and the
  // interpreter gives the value.
  test.each([
    [['Sum', 'L'], 'list<unknown>', '[9,12]', 'unsettled-shape'],
    [['Sum', 'L'], 'list<real | list<real>>', '[9,12]', 'unsettled-shape'],
    [['Product', 'L'], 'list<unknown>', '[15,48]', 'unsettled-shape'],
    [['Reduce', 'L', 'Add', 0], 'list<unknown>', '[9,12]', 'unsettled-shape'],
    [
      ['Scan', 'L', 'Add'],
      'list<unknown>',
      '[[1,2],[4,6],[9,12]]',
      'outside-profile',
    ],
  ] as const)('%j with L: %s declines', (expr, type, value, code) => {
    const ce = new ComputeEngine();
    ce.declare('L', type);
    const r = compile(ce.box(expr as any), { to: 'javascript' } as any);
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe(code);
    ce.assign('L', ce.box(toJson(ROWS, false) as any));
    expect(
      ce
        .box(expr as any)
        .evaluate({ materialization: true })
        .toString()
    ).toBe(value);
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
