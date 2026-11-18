/**
 * The interpreter fallback of `interval-js` at a point box
 * (`compilation/interval-fallback.ts`): a number is a point interval only
 * when the interpreter's value is exactly that double. The double of any
 * other value (a special function, a quadrature, `1/3`) is not the value,
 * so the answer is `entire`; a draw differs from call to call, and is
 * `entire` too. Also: the kind decline of an `enclosure` input whatever
 * `fallback` says.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { KindDeclineError } from '../../src/compute-engine/compilation/diagnostics';

const ce = new ComputeEngine();
// `Gamma` of an undeclared input compiles (it is read as a real): a
// declared `complex` input declines.
ce.declare('z', 'complex');
const at = (v: number) => ({ x: { lo: v, hi: v }, z: { lo: v, hi: v } });
const point = (v: number) => ({ kind: 'interval', value: { lo: v, hi: v } });

let warn: jest.SpyInstance;
beforeAll(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => warn.mockRestore());

/** A declined compilation of `json` (the input `x` is not declared, `z`
 *  is a complex). */
function declined(json: unknown) {
  const r = compile(ce.box(json as never), { to: 'interval-js' }) as {
    success: boolean;
    run: (vars: unknown) => unknown;
  };
  expect(r.success).toBe(false);
  return r;
}

describe('the interval fallback at a point box', () => {
  test('Gamma(0.3): no double is the value, so the answer is entire', () => {
    expect(declined(['Gamma', 'z']).run(at(0.3))).toEqual({ kind: 'entire' });
  });

  test('a quadrature: entire', () => {
    const r = declined([
      'Integrate',
      ['Gamma', ['Add', 't', 1]],
      ['Limits', 't', 0, 'x'],
    ]);
    expect(r.run(at(1))).toEqual({ kind: 'entire' });
  });

  test('an integer is a point', () => {
    expect(declined(['Gamma', 'z']).run(at(3))).toEqual(point(2));
    expect(declined(['Fibonacci', 'x']).run(at(10))).toEqual(point(55));
  });

  test('a rational is a point when its double is its value', () => {
    expect(declined(['Divide', ['Fibonacci', 'x'], 4]).run(at(10))).toEqual(
      point(13.75)
    );
    expect(declined(['Divide', ['Fibonacci', 'x'], 3]).run(at(10))).toEqual({
      kind: 'entire',
    });
  });

  test('a draw is entire', () => {
    const r = declined(['Add', ['Fibonacci', 'x'], ['Random']]);
    expect(r.run(at(5))).toEqual({ kind: 'entire' });
  });

  test('a boolean at a point box stays decided', () => {
    expect(declined(['Greater', ['Fibonacci', 'x'], 3]).run(at(5))).toBe(
      'true'
    );
  });

  test('a relation of an inexact value is undecided', () => {
    // The interpreter compares with a tolerance: these read as equal, and
    // `Less` and `Greater` both as `False`.
    for (const json of [
      ['Less', ['Gamma', 'z'], 2.991568987687591],
      ['Greater', ['Gamma', 'z'], 2.991568987687591],
      ['Equal', ['Gamma', 'z'], 2.9915689876875],
    ])
      expect(declined(json).run(at(0.3))).toBe('maybe');
  });

  test('a relation of exact values is decided', () => {
    expect(declined(['Less', ['Fibonacci', 'x'], 56]).run(at(10))).toBe('true');
    expect(
      declined(['And', ['Equal', 'x', 1], ['Less', ['Fibonacci', 'x'], 2]]).run(
        at(1)
      )
    ).toBe('true');
    // Over a box wider than a point: undecided.
    expect(
      declined(['Less', ['Fibonacci', 'x'], 56]).run({ x: { lo: 9, hi: 10 } })
    ).toBe('maybe');
  });

  test('each element of a list is read on its own', () => {
    expect(
      declined([
        'List',
        ['Fibonacci', 'x'],
        ['Gamma', ['Divide', 'x', 10]],
      ]).run(at(3))
    ).toEqual([point(2), { kind: 'entire' }]);
  });
});

describe('a decline with an enclosure input on interval-js is a kind decline', () => {
  const ceE = new ComputeEngine();
  ceE.declare('y', 'enclosure');
  test.each([true, false])('with fallback: %s', (fallback) => {
    // `y + 1` compiles; `Factorial` of an enclosure declines (the
    // interpreter leaves it unevaluated), and has no fallback.
    expect(() =>
      compile(ceE.box(['Factorial', 'y']), { to: 'interval-js', fallback })
    ).toThrow(KindDeclineError);
  });
});

describe('the variables object and the arguments of a function', () => {
  test('variables named lo and hi are bound, on the fallback and the compiled route', () => {
    const ceV = new ComputeEngine();
    ceV.declare('lo', 'integer');
    ceV.declare('hi', 'integer');
    const fallback = compile(
      ceV.box(['Add', ['Fibonacci', 'lo'], ['Fibonacci', 'hi']]),
      { to: 'interval-js' }
    ) as { success: boolean; run: (v: unknown) => unknown };
    expect(fallback.success).toBe(false);
    // The interpreter's value is Fibonacci(5) + Fibonacci(5) = 10.
    expect(fallback.run({ lo: 5, hi: 5 })).toEqual(point(10));
    const compiled = compile(ceV.box(['Add', 'lo', ['Multiply', 2, 'hi']]), {
      to: 'interval-js',
    }) as { success: boolean; run: (v: unknown) => unknown };
    expect(compiled.success).toBe(true);
    expect(compiled.run({ lo: 5, hi: 6 })).toEqual(point(17));
    expect(compiled.run({ lo: { lo: 1, hi: 2 }, hi: 6 })).toEqual({
      kind: 'interval',
      value: { lo: 13, hi: 14 },
    });
  });

  test('a declined Function literal reads its boolean parameter', () => {
    const f = ce.box([
      'Function',
      ['Block', ['If', 'b', ['Fibonacci', 'x'], 0]],
      ['Typed', 'b', "'boolean'"],
      ['Typed', 'x', "'integer'"],
    ]);
    const r = compile(f, { to: 'interval-js' }) as {
      success: boolean;
      run: (...args: unknown[]) => unknown;
    };
    expect(r.success).toBe(false);
    expect(r.run('true', 5)).toEqual(point(5));
    expect(r.run('false', 5)).toEqual(point(0));
    // `'maybe'` is either branch: the answer holds both 5 and 0.
    const maybe = r.run('maybe', 5) as {
      kind: string;
      value?: { lo: number; hi: number };
    };
    if (maybe.kind !== 'entire') {
      expect(maybe.value!.lo).toBeLessThanOrEqual(0);
      expect(maybe.value!.hi).toBeGreaterThanOrEqual(5);
    }
  });
});
