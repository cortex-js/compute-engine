import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';

// ROADMAP CE-806: compiled code whose static type settles the shape of a
// value tests no shape at run time (rule R3 of "Shapes are settled at
// compile time", `docs/COMPILATION-MODEL.md`).
//
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
/** The diagnostic of the decline that `f` throws. */
function thrownDiagnostic(f: () => unknown) {
  try {
    f();
  } catch (e) {
    return compileDiagnosticOf(e);
  }
  throw new Error('the compilation did not decline');
}

function fromJson(json: unknown): unknown {
  if (typeof json === 'number') return json;
  if (json === 'NaN') return NaN;
  if (typeof json === 'object' && json !== null && 'num' in json)
    return Number((json as { num: string }).num);
  if (Array.isArray(json) && json[0] === 'List')
    return json.slice(1).map(fromJson);
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

  test.each(['Max', 'Min'] as const)('%s of an empty list is NaN', (kind) => {
    const r = compiledAndEvaluated([kind, ['Add', 'L', 'M']], { L: [], M: [] });
    expect(r.compiled).toBeNaN();
    expect(r.evaluated).toBeNaN();
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
    // The input `b` is the node that declines.
    [['Max', ['Multiply', 2, 'b']], 'b'],
    [
      ['Sum', ['Which', ['Greater', 'x', 0], 'L', 'True', 'x']],
      'Which(Less(0, x), L, "True", x)',
    ],
  ] as const)(
    '%j, a source that can be a number or a list, declines',
    (expr, value) => {
      const ce = new ComputeEngine();
      ce.declare('b', 'broadcastable<real>');
      ce.declare('L', 'list<real>');
      ce.declare('x', 'real');
      const d = thrownDiagnostic(() =>
        compile(ce.box(expr as any), {
          to: 'interval-js',
          fallback: false,
        } as any)
      );
      expect(d.code).toBe('unsettled-shape');
      expect(d.value).toBe(value);
    }
  );

  test.each([['Max'], ['Sum']] as const)(
    '%s of a symbol typed broadcastable<real> declines like arithmetic over it',
    (kind) => {
      // `broadcastable<T>` is not an explicit union of shapes, so the
      // symbol has no declared dispatch (rule R2).
      const ce = new ComputeEngine();
      ce.declare('b', 'broadcastable<real>');
      const d = thrownDiagnostic(() =>
        compile(ce.box([kind, 'b'] as any), {
          to: 'interval-js',
          fallback: false,
        } as any)
      );
      expect(d.code).toBe('unsettled-shape');
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
    // The interval mode has no dispatch for a union of shapes at an input,
    // and declines it with `outside-profile`, not with the
    // `unsettled-shape` decline of `2b`.
    const ce = new ComputeEngine();
    ce.declare('u', 'real | list<real>');
    const d = thrownDiagnostic(() =>
      compile(ce.box(['Sum', 'u'] as any), {
        to: 'interval-js',
        fallback: false,
      } as any)
    );
    expect(d.code).toBe('outside-profile');
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

  test('a broadcast source compiles', () => {
    // `L + M` with lists of different lengths at run time is an error that
    // the static type does not show: its value is unspecified.
    const r = compile(engine().box(['Sum', ['Add', 'L', 'M']] as any), {
      to: 'interval-js',
      fallback: false,
    } as any);
    expect(r.success).toBe(true);
  });
});
