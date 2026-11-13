import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// ROADMAP CE-806: compiled code whose static type settles the shape of a
// value tests no shape at run time (rule R3 of "Shapes are settled at
// compile time", `docs/COMPILATION-MODEL.md`).
//
// - The accumulator of an indexed `Sum` or `Product` written as a loop: a
//   term typed as a list seeds the accumulator with a copy of itself, with
//   no `Array.isArray` test.
// - `Max` or `Min` of one list operand whose value may be the `NaN` of a
//   length mismatch (`P·(1 − v) + Q·v`): the operand is reduced as a list,
//   and only the absent values (`NaN`, `undefined`) are tested, by value.
// - The interval-js fold (`Sum`, `Product`, `Max`, `Min`) of an input typed
//   as a list of numbers reads the array with no test of its shape. A
//   source that can be a number or a list (`broadcastable<real>`, a
//   `Which` with a list branch and a number branch) declines with
//   `unsettled-shape`, and the interpreter evaluates the fold.
//
// The values do not change.

const DECLS: Record<string, string> = {
  L: 'list<real>',
  M: 'list<real>',
  n: 'integer',
  v: 'real',
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
  if (Array.isArray(json) && json[0] === 'List')
    return json.slice(1).map(fromJson);
  // An error of the interpreter (`incompatible-dimensions`).
  if (Array.isArray(json) && json[0] === 'Error') return 'error';
  throw new Error(`unexpected value ${JSON.stringify(json)}`);
}

type Inputs = { L: number[]; M?: number[]; n?: number; v?: number };

function compiledAndEvaluated(
  expr: unknown,
  inputs: Inputs,
  to: 'javascript' | 'interval-js' = 'javascript'
): { code: string; compiled: unknown; evaluated: unknown } {
  const r = compile(engine().box(expr as any), { to, fallback: false } as any);
  expect(r.success).toBe(true);
  const ev = engine();
  for (const [name, value] of Object.entries(inputs))
    ev.assign(
      name,
      ev.box(Array.isArray(value) ? ['List', ...value] : (value as any))
    );
  return {
    code: r.code,
    compiled: r.run!(inputs as never),
    evaluated: fromJson(ev.box(expr as any).evaluate().json),
  };
}

describe('THE LOOP OF AN INDEXED SUM OR PRODUCT WITH A LIST TERM (CE-806)', () => {
  test.each([
    [['Sum', ['Multiply', 'L', 'i'], ['Limits', 'i', 1, 'n']], 3],
    [['Sum', ['Multiply', 'L', 'i'], ['Limits', 'i', 1, 'n']], 1],
    [['Sum', ['Multiply', 'L', 'i'], ['Limits', 'i', 1, 'n']], 0],
    [['Product', ['Add', 'L', 'i'], ['Limits', 'i', 1, 'n']], 3],
    [['Product', ['Add', 'L', 'i'], ['Limits', 'i', 1, 'n']], 1],
    [['Product', ['Add', 'L', 'i'], ['Limits', 'i', 1, 'n']], 0],
    [['Sum', ['Add', 'L', ['Multiply', 'M', 'i']], ['Limits', 'i', 1, 'n']], 3],
    [['Sum', ['Multiply', 'L', 'i'], ['Limits', 'i', 1, 40]], 0],
  ] as const)('%j at n = %d has the interpreter value', (expr, n) => {
    const r = compiledAndEvaluated(expr, { L: [1, 2], M: [3, 4], n });
    expect(r.compiled).toEqual(r.evaluated);
    expect(r.code).not.toContain('Array.isArray');
  });

  test('an empty list term gives the empty list', () => {
    const r = compiledAndEvaluated(
      ['Sum', ['Multiply', 'L', 'i'], ['Limits', 'i', 1, 'n']],
      { L: [], n: 2 }
    );
    expect(r.compiled).toEqual([]);
    expect(r.compiled).toEqual(r.evaluated);
  });

  test('the seed is a copy of the term, tested only for an absent value', () => {
    const r = compile(
      engine().box([
        'Sum',
        ['Multiply', 'L', 'i'],
        ['Limits', 'i', 1, 'n'],
      ] as any),
      { to: 'javascript', fallback: false } as any
    );
    expect(r.code).toMatch(
      /(_tv\d+) = \1 === null \? \((_tv\d+) === undefined \|\| \2 !== \2 \? \2 : \2\.slice\(\)\)/
    );
  });

  test('a single term is not the array of the input', () => {
    const r = compile(
      engine().box([
        'Sum',
        ['Multiply', 'L', 'i'],
        ['Limits', 'i', 1, 'n'],
      ] as any),
      { to: 'javascript', fallback: false } as any
    );
    const L = [1, 2];
    const value = r.run!({ L, n: 1 } as never);
    expect(value).toEqual([1, 2]);
    expect(value).not.toBe(L);
  });

  test('a length mismatch in the term still gives NaN', () => {
    // The interpreter gives an `incompatible-dimensions` error; compiled
    // code gives `NaN`, as before.
    const r = compiledAndEvaluated(
      ['Sum', ['Add', 'L', ['Multiply', 'M', 'i']], ['Limits', 'i', 1, 'n']],
      { L: [1, 2], M: [3, 4, 5], n: 2 }
    );
    expect(r.compiled).toBeNaN();
    expect(r.evaluated).toBe('error');
  });
});

describe('MAX AND MIN OF ONE LIST OPERAND (CE-806)', () => {
  const blend = ['Add', ['Multiply', 'L', ['Subtract', 1, 'v']], ['Multiply', 'M', 'v']];
  test.each([
    ['Max', [1, 5, 2], [4, 0, 3]],
    ['Min', [1, 5, 2], [4, 0, 3]],
    ['Max', [7], [3]],
    ['Min', [7], [3]],
  ] as const)('%s(L·(1 − v) + M·v) at L = %j, M = %j', (kind, L, M) => {
    const r = compiledAndEvaluated([kind, blend], {
      L: [...L],
      M: [...M],
      v: 0.25,
    });
    expect(r.compiled).toBeCloseTo(r.evaluated as number, 12);
    expect(r.code).not.toContain('Array.isArray');
  });

  test('the operand is tested only for an absent value', () => {
    const r = compile(engine().box(['Max', ['Add', 'L', 'M']] as any), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.code).toBe(
      '((_v) => _v === undefined || _v !== _v ? NaN : ((_l) => _l.length === 0 ? NaN : _l.reduce((_a, _b) => Math.max(_a, _b), -Infinity))(_v))(_SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), _.L, _.M))'
    );
  });

  test.each(['Max', 'Min'] as const)('%s of an empty list is NaN', (kind) => {
    const r = compiledAndEvaluated([kind, ['Add', 'L', 'M']], { L: [], M: [] });
    expect(r.compiled).toBeNaN();
    expect(r.evaluated).toBeNaN();
  });

  test('a length mismatch still gives NaN', () => {
    // The interpreter gives an `incompatible-dimensions` error.
    const r = compiledAndEvaluated(['Min', ['Add', 'L', 'M']], {
      L: [1, 2],
      M: [1, 2, 3],
    });
    expect(r.compiled).toBeNaN();
    expect(r.evaluated).toBe('error');
  });
});

describe('THE INTERVAL-JS FOLD OF A LIST SYMBOL (CE-806)', () => {
  type IntervalResult = {
    kind: string;
    value?: { lo: number; hi: number };
  };
  test.each([
    ['Sum', [1, 2, 3.5]],
    ['Product', [2, 3, 4]],
    ['Max', [1, 5, 2]],
    ['Min', [1, 5, 2]],
    ['Sum', [4]],
    ['Max', [4]],
  ] as const)('%s(L) at L = %j encloses the interpreter value', (kind, L) => {
    const r = compiledAndEvaluated([kind, 'L'], { L: [...L] }, 'interval-js');
    const value = r.compiled as IntervalResult;
    expect(value.kind).toBe('interval');
    expect(value.value!.lo).toBeLessThanOrEqual(r.evaluated as number);
    expect(value.value!.hi).toBeGreaterThanOrEqual(r.evaluated as number);
    expect(r.code).not.toContain('Array.isArray');
  });

  test('Sum of an empty list is 0, and Max of an empty list is absent', () => {
    const sum = compiledAndEvaluated(['Sum', 'L'], { L: [] }, 'interval-js');
    expect(sum.compiled).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 0 },
    });
    const max = compile(engine().box(['Max', 'L'] as any), {
      to: 'interval-js',
      fallback: false,
    } as any);
    expect(max.code).not.toContain('Array.isArray');
    expect((max.run!({ L: [] } as never) as IntervalResult).kind).toBe(
      'empty'
    );
  });

  test.each([
    [['Max', ['Multiply', 2, 'b']], '2b'],
    [
      ['Sum', ['Which', ['Greater', 'x', 0], 'L', 'True', 'x']],
      'Which(0 < x, L, "True", x)',
    ],
  ] as const)(
    '%j, a source that can be a number or a list, declines',
    (expr, value) => {
      const ce = new ComputeEngine();
      ce.declare('b', 'broadcastable<real>');
      ce.declare('L', 'list<real>');
      ce.declare('x', 'real');
      const r = compile(ce.box(expr as any), {
        to: 'interval-js',
        fallback: false,
      } as any) as any;
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('unsettled-shape');
      expect(r.diagnostic?.value).toBe(value);
    }
  );

  test.each([['Max'], ['Sum']] as const)(
    '%s of a symbol typed broadcastable<real> declines like arithmetic over it',
    (kind) => {
      // `broadcastable<T>` is not an explicit union of shapes, so the
      // symbol has no declared dispatch (rule R2).
      const ce = new ComputeEngine();
      ce.declare('b', 'broadcastable<real>');
      const r = compile(ce.box([kind, 'b'] as any), {
        to: 'interval-js',
        fallback: false,
      } as any) as any;
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('unsettled-shape');
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const fb = compile(ce.box([kind, 'b'] as any), {
        to: 'interval-js',
      } as any);
      warn.mockRestore();
      expect(fb.success).toBe(false);
      const ev = new ComputeEngine();
      ev.declare('b', 'broadcastable<real>');
      ev.assign('b', ev.box(['List', 1, 5, 2] as any));
      const want = ev.box([kind, 'b'] as any).evaluate().re;
      const got = fb.run!({ b: [1, 5, 2] } as never) as IntervalResult;
      expect(got.kind).toBe('interval');
      expect(got.value!.lo).toBeLessThanOrEqual(want);
      expect(got.value!.hi).toBeGreaterThanOrEqual(want);
    }
  );

  test('a symbol declared real | list<real> is not declined by the unsettled-shape rule', () => {
    // The fold does not reach the exemption for a declared union: an
    // earlier check of `Sum` reads the operand type as `real` and declines
    // with `compile-error`. The exemption is for a union that the
    // dispatch of `unionShapeMembers()` accepts, and it is not the
    // `unsettled-shape` decline of `2b`.
    const ce = new ComputeEngine();
    ce.declare('u', 'real | list<real>');
    const r = compile(ce.box(['Sum', 'u'] as any), {
      to: 'interval-js',
      fallback: false,
    } as any) as any;
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).not.toBe('unsettled-shape');
  });

  test('the interpreter evaluates a declined fold', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    ce.declare('x', 'real');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const r = compile(
      ce.box([
        'Sum',
        ['Which', ['Greater', 'x', 0], 'L', 'True', 'x'],
      ] as any),
      { to: 'interval-js' } as any
    );
    warn.mockRestore();
    expect(r.success).toBe(false);
    expect(r.run!({ x: 1, L: [1, 2] } as never)).toEqual({
      kind: 'interval',
      value: { lo: 3, hi: 3 },
    });
    expect(r.run!({ x: -2, L: [1, 2] } as never)).toEqual({
      kind: 'interval',
      value: { lo: -2, hi: -2 },
    });
  });

  test('a broadcast source keeps the test of the absence marker', () => {
    // `P + Q` with lists of different lengths gives the absence marker of
    // interval-js, an interval and not an array.
    const r = compile(engine().box(['Sum', ['Add', 'L', 'M']] as any), {
      to: 'interval-js',
      fallback: false,
    } as any);
    expect(
      (r.run!({ L: [1, 2], M: [1, 2, 3] } as never) as IntervalResult).kind
    ).toBe('empty');
  });
});

describe('A LIST VALUE COMPUTED THROUGH AN INDEXED SUM KEEPS ITS TEST (CE-806)', () => {
  // An indexed `Sum` or `Product` over a list of unknown length gives the
  // number `0` or `1` for an empty range, as the interpreter does. A value
  // typed as a list that is computed through one can be a number at run
  // time, so its consumer keeps the run-time test of its shape. Only an
  // input typed as a list, a list literal, or arithmetic over one is an
  // array by its structure (`isGuaranteedArray()` in
  // `javascript-target.ts`).
  const DECLS_P: Record<string, string> = {
    L: 'list<real>',
    P: 'list<list<real>>',
    n: 'integer',
  };
  const INPUTS = { L: [1, 2], P: [[1, 2], [3, 4]] };

  function toJson(value: unknown): unknown {
    return Array.isArray(value) ? ['List', ...value.map(toJson)] : value;
  }

  function enginePL(): ComputeEngine {
    const ce = new ComputeEngine();
    for (const [name, type] of Object.entries(DECLS_P))
      ce.declare(name, type);
    return ce;
  }

  function codeOf(expr: unknown): string {
    const r = compile(enginePL().box(expr as any), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).toBe(true);
    return r.code;
  }

  /** The compiled value (or `'throw'`) and the value of `evaluate()`. */
  function bothValues(
    expr: unknown,
    n: number
  ): { compiled: unknown; evaluated: unknown } {
    const r = compile(enginePL().box(expr as any), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).toBe(true);
    let compiled: unknown;
    try {
      compiled = r.run!({ ...INPUTS, n } as never);
    } catch {
      compiled = 'throw';
    }
    const ce = enginePL();
    for (const [name, value] of Object.entries({ ...INPUTS, n }))
      ce.assign(name, ce.box(toJson(value) as any));
    return {
      compiled,
      evaluated: fromJson(ce.box(expr as any).evaluate().json),
    };
  }

  const innerSum = ['Sum', ['Multiply', 'L', 'i'], ['Limits', 'i', 1, 'n']];
  const innerRowSum = ['Sum', ['Multiply', 'P', 'i'], ['Limits', 'i', 1, 'n']];
  // `Sum(L·j, i, 1, n, j, 1, i − 1)`: at `i = 1` the inner range is empty,
  // and the inner sum is `0`.
  const triangular = [
    'Sum',
    ['Multiply', 'L', 'j'],
    ['Limits', 'i', 1, 'n'],
    ['Limits', 'j', 1, ['Subtract', 'i', 1]],
  ];
  const twoClauses = [
    'Sum',
    ['Add', 'L', ['Multiply', 'j', 'k']],
    ['Limits', 'j', 1, 2],
    ['Limits', 'k', 1, 'n'],
  ];

  test.each([
    [triangular, 1],
    [triangular, 2],
    [triangular, 3],
    [twoClauses, 0],
    [twoClauses, 2],
    [['Max', ['Multiply', 2, innerSum]], 0],
    [['Max', ['Multiply', 2, innerSum]], 2],
    [['Min', ['Multiply', 2, innerSum]], 0],
    [['Min', ['Multiply', 2, innerSum]], 2],
    [['Sum', ['Multiply', 2, innerRowSum]], 0],
    [['Sum', ['Multiply', 2, innerRowSum]], 2],
    [['Sum', innerRowSum], 0],
    [['Sum', innerRowSum], 2],
    [['Reduce', ['Multiply', 2, innerRowSum], 'Add', 0], 2],
  ] as const)('%j at n = %d has the interpreter value', (expr, n) => {
    const r = bothValues(expr, n);
    expect(r.compiled).toEqual(r.evaluated);
  });

  test('Reduce over an empty indexed sum throws where the interpreter gives an error', () => {
    // `Reduce` of a number is an `incompatible-type` error in the
    // interpreter. The caveats of compiled code allow a throw there.
    const r = bothValues(['Reduce', ['Multiply', 2, innerRowSum], 'Add', 0], 0);
    expect(r.compiled).toBe('throw');
    expect(r.evaluated).toBe('error');
  });

  test.each([
    ['the outer seed of a sum whose term is an inner sum', triangular],
    ['the outer seed of a sum with two clauses', twoClauses],
    ['Max of an inner sum', ['Max', ['Multiply', 2, innerSum]]],
    ['the fold of an inner sum of rows', ['Sum', ['Multiply', 2, innerRowSum]]],
    [
      'Max of a Block local',
      [
        'Block',
        ['Declare', 'K', "'unknown'", ['Add', 'L', 'L']],
        ['Max', ['Multiply', 2, 'K']],
      ],
    ],
  ] as const)('%s keeps the test of its shape', (_, expr) => {
    expect(codeOf(expr)).toContain('Array.isArray');
  });

  test('a Block local with the name of a vars key keeps its test', () => {
    // The local `K` shadows the `vars` key `K`: its value is the indexed
    // sum, a number at `n = 0`, and not the input.
    const expr = [
      'Block',
      ['Declare', 'K', "'unknown'", innerSum],
      ['Max', ['Multiply', 2, 'K']],
    ];
    const r = compile(enginePL().box(expr as any), {
      to: 'javascript',
      fallback: false,
      vars: { K: '_.K' },
    } as any);
    expect(r.success).toBe(true);
    expect(r.code).toContain('Array.isArray');
    const ev = enginePL();
    for (const [name, value] of Object.entries({ ...INPUTS, n: 0 }))
      ev.assign(name, ev.box(toJson(value) as any));
    expect(r.run!({ ...INPUTS, n: 0, K: [9] } as never)).toEqual(
      fromJson(ev.box(expr as any).evaluate().json)
    );
  });

  test.each([
    ['the seed of a sum whose term is an input', ['Sum', ['Multiply', 'L', 'i'], ['Limits', 'i', 1, 'n']]],
    ['Max of arithmetic over an input', ['Max', ['Multiply', 2, 'L']]],
    ['the fold of an input', ['Sum', 'P']],
    ['the fold of arithmetic over an input', ['Sum', ['Multiply', 2, 'P']]],
    ['Max of an element of an input', ['Max', ['Multiply', 2, ['At', 'P', 1]]]],
  ] as const)('%s tests no shape', (_, expr) => {
    expect(codeOf(expr)).not.toContain('Array.isArray');
  });
});
