import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// ROADMAP CE-808: an indexed `Sum` or `Product` over a list of unknown
// length is the number `0` or `1` for an empty range, as in the
// interpreter, so a value typed as a list can be a number at run time. The
// fold of `Sum` or `Product` over a list of numbers, and `Max` or `Min` of a
// list operand, alone or beside other operands, test the shape of a value
// that can be such a number (`foldNeedsNoShapeTest()` in
// `compilation/javascript-target.ts`): a number is the fold or the extremum
// of itself. An input typed as a list, a declared parameter, a `Take`, and
// an `If` or `Which` of such values get no test.

const DECLS: Record<string, string> = {
  L: 'list<real>',
  V: 'vector<3>',
  n: 'integer',
};

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries(DECLS)) ce.declare(name, type);
  return ce;
}

/** The host value of a MathJSON result of `evaluate()`. */
function fromJson(json: unknown): unknown {
  if (typeof json === 'number') return json;
  if (json === 'NaN') return NaN;
  if (typeof json === 'object' && json !== null && 'num' in json)
    return Number((json as { num: string }).num);
  throw new Error(`unexpected value ${JSON.stringify(json)}`);
}

const INPUTS = { L: [1, 2, 3], V: [1, 2, 3] };

function compiledAndEvaluated(
  expr: unknown,
  n: number
): { code: string; compiled: unknown; evaluated: unknown } {
  const r = compile(engine().box(expr as any), {
    to: 'javascript',
    fallback: false,
  } as any);
  expect(r.success).toBe(true);
  const ev = engine();
  ev.assign('L', ev.box(['List', ...INPUTS.L]));
  ev.assign('V', ev.box(['List', ...INPUTS.V]));
  ev.assign('n', n);
  return {
    code: r.code,
    compiled: r.run!({ ...INPUTS, n } as never),
    evaluated: fromJson(ev.box(expr as any).evaluate().json),
  };
}

const S = ['Sum', ['Multiply', 'L', 'i'], ['Limits', 'i', 1, 'n']];
const P = ['Product', ['Add', 'L', 'i'], ['Limits', 'i', 1, 'n']];
const S2 = ['Multiply', 2, S];

describe('A FOLD OR AN EXTREMUM OF AN EMPTY INDEXED SUM (CE-808)', () => {
  const witnesses: unknown[] = [
    ['Block', ['Assign', 'K', S], ['Sum', 'K']],
    ['Sum', S],
    ['Sum', S2],
    ['Product', S],
    ['Product', P],
    ['Block', ['Assign', 'K', S], ['Max', 'K']],
    ['Max', S],
    ['Min', S],
    ['Max', S2],
    ['Max', S2, 1],
    ['Min', S2, 1],
    ['Max', S, S2],
    ['Block', ['Assign', 'K', S], ['Max', 'K', -1]],
  ];
  test.each(witnesses.flatMap((w) => [0, 2].map((n) => [w, n] as const)))(
    '%j at n = %d has the interpreter value',
    (expr, n) => {
      const { code, compiled, evaluated } = compiledAndEvaluated(expr, n);
      expect(code).toContain('Array.isArray');
      expect(compiled).toEqual(evaluated);
    }
  );

  // An indexed `Sum` whose term has a width in its type is a list of that
  // width for an empty range, so the fold written term by term needs no
  // test of its shape.
  test.each([0, 2])(
    'the term-by-term fold of a sum of vector<3> terms at n = %d',
    (n) => {
      const expr = [
        'Sum',
        ['Sum', ['Multiply', 'V', 'i'], ['Limits', 'i', 1, 'n']],
      ];
      const { code, compiled, evaluated } = compiledAndEvaluated(expr, n);
      expect(code).not.toContain('Array.isArray');
      expect(code).toContain('[0] + ');
      expect(compiled).toEqual(evaluated);
    }
  );
});

describe('AN INPUT TYPED AS A LIST TESTS NO SHAPE (CE-808)', () => {
  test.each([
    [['Sum', 'L'], '(_.L).reduce((_a, _b) => _a + _b, 0)'],
    [
      ['Sum', ['Multiply', 2, 'L']],
      '(_SYS.bcast((_tv1, _tv2) => (_tv1 * _tv2), 2, _.L)).reduce((_a, _b) => _a + _b, 0)',
    ],
    [
      ['Max', 'L'],
      '((_l) => _l.length === 0 ? NaN : _l.reduce((_a, _b) => Math.max(_a, _b), -Infinity))(_.L)',
    ],
    [
      ['Max', 'L', 1],
      '((_p0, _p1) => { let _a = -Infinity; for (const _x of _p0) { _a = Math.max(_a, _x); } _a = Math.max(_a, _p1); return _a; })(_.L, 1)',
    ],
  ] as const)('%j', (expr, expected) => {
    const { code, compiled, evaluated } = compiledAndEvaluated(expr, 0);
    expect(code).toBe(expected);
    expect(compiled).toEqual(evaluated);
  });
});

describe('A VALUE THAT CANNOT BE AN EMPTY INDEXED SUM TESTS NO SHAPE (CE-808)', () => {
  // `Take` of a lazy stream gives an array (`_SYS.takeIter`).
  test('a Sum of a Take of an infinite Map', () => {
    const ce = new ComputeEngine();
    const r = compile(
      ce.box([
        'Sum',
        [
          'Take',
          [
            'Map',
            ['Function', ['Square', 'x'], 'x'],
            ['Range', 1, 'PositiveInfinity'],
          ],
          10,
        ],
      ] as any),
      { constantFold: false }
    )!;
    expect(r.code).not.toContain('Array.isArray');
    expect(r.code).toContain('_SYS.takeIter(');
    expect(r.run!({} as never)).toBe(385);
  });

  // Each value branch of the `Which` is a list literal.
  test.each([true, false])('a Sum of a Which of list literals, c = %s', (c) => {
    const ce = engine();
    ce.declare('c', 'boolean');
    const expr = ['Sum', ['Which', 'c', ['List', 1, 2], 'True', ['List', 3]]];
    const r = compile(ce.box(expr as any), { to: 'javascript' } as any);
    expect(r.code).not.toContain('Array.isArray');
    expect(r.run!({ c } as never)).toBe(3);
  });

  // A declared parameter: the interpreter gives an `incompatible-type`
  // error for a number argument, and the compiled fold throws.
  test('a declared parameter of a function literal', () => {
    const ce = engine();
    const fn = ['Function', ['Sum', 'xs'], ['Typed', 'xs', 'list<number>']];
    const r = compile(ce.box(fn as any), { constantFold: false })!;
    expect(r.code).not.toContain('Array.isArray');
    expect(r.run!([1, 2, 3] as never)).toBe(6);

    const applied = ['Apply', fn, S];
    const c = compile(engine().box(applied as any), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(c.code).not.toContain('Array.isArray');
    expect(() => c.run!({ ...INPUTS, n: 0 } as never)).toThrow();
    const ev = engine();
    ev.assign('L', ev.box(['List', ...INPUTS.L]));
    ev.assign('n', 0);
    expect(JSON.stringify(ev.box(applied as any).evaluate().json)).toContain(
      'incompatible-type'
    );
  });

  // A branch computed through an indexed `Sum` keeps the test.
  test.each([0, 2])('a Which with an indexed Sum branch at n = %d', (n) => {
    const expr = ['Sum', ['Which', ['Greater', 'n', -1], S, 'True', ['List', 3]]];
    const { code, compiled, evaluated } = compiledAndEvaluated(expr, n);
    expect(code).toContain('Array.isArray');
    expect(compiled).toEqual(evaluated);
  });
});
