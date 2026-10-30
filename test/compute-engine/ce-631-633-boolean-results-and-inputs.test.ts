import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { IntervalInput } from '../../src/compute-engine/compilation/types';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { createJavaScriptRuntime } from '../../src/runtime';
import { INTERVAL_KIND } from '../../src/compute-engine/compilation/broadcast';
import { createIntervalRuntime } from '../../src/compute-engine/compilation/interval-runtime';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';

// `scripts/typecheck.sh` type-checks this file (ts-jest does not), so
// `npm run typecheck` fails if `IntervalInput` refuses a JavaScript boolean
// or if the inputs of `broadcast()` refuse a boolean or an array of
// booleans: no call below needs a cast.

type Vars = Record<string, number | boolean | string>;

/** The interpreter's value of a boolean expression with these values
 * substituted: `true` or `false` when it is decided, `undefined` when it is
 * not (an unsupplied symbol, or a value that is not a boolean, which the
 * interpreter refuses). */
function interpretBoolean(
  ce: ComputeEngine,
  expr: Expression,
  vars: Vars
): boolean | undefined {
  const subs: Record<string, Expression> = {};
  for (const [k, v] of Object.entries(vars))
    subs[k] =
      v === true
        ? ce.True
        : v === false
          ? ce.False
          : typeof v === 'string'
            ? ce.box({ str: v })
            : ce.box(v);
  const r = expr.subs(subs).evaluate();
  if (isSymbol(r, 'True')) return true;
  if (isSymbol(r, 'False')) return false;
  return undefined;
}

/** The interpreter's numeric value, `NaN` when it is not a number. */
function interpretNumber(
  ce: ComputeEngine,
  expr: Expression,
  vars: Vars
): number {
  const subs: Record<string, Expression> = {};
  for (const [k, v] of Object.entries(vars))
    subs[k] =
      v === true ? ce.True : v === false ? ce.False : ce.box(v as number);
  const r = expr.subs(subs).evaluate();
  return isNumber(r) ? r.re : NaN;
}

// CE-631: a connective whose value is the result, over a symbol declared
// `boolean`, compiled to the plain `!`, `&&` and `||`: `Not(c)` gave `true`
// for an unsupplied `c` and `false` for `c = 1`. The interpreter has no
// value then, and the compiled value is now `undefined`, the absence marker
// of a boolean result (the Kleene lowering of `kleeneValueConnective`).
describe('CE-631 a connective as the result', () => {
  const ce = new ComputeEngine();
  ce.declare('c', 'boolean');
  ce.declare('d', 'boolean');
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('s', 'string');

  const values: Vars[] = [
    {},
    { c: true },
    { c: false },
    { c: 1 },
    { c: true, d: true },
    { c: true, d: false },
    { c: false, d: true },
    { c: false, d: false },
    { c: 1, d: false },
    { c: 1, d: true },
    { d: false },
    { d: true },
    { c: true, x: 1 },
    { c: true, x: -1 },
    { c: false, x: 1 },
    { x: 1 },
    { x: -1 },
    { x: 0.5, y: 0.5 },
    { x: 2, y: 3 },
    { y: 3 },
    { x: NaN },
    { c: 1, x: 1 },
    { s: 'a' },
    { s: 'b' },
    { s: 'a', c: true },
  ];

  const cases: [string, unknown][] = [
    ['Not(c)', ['Not', 'c']],
    ['And(c, d)', ['And', 'c', 'd']],
    ['Or(c, d)', ['Or', 'c', 'd']],
    ['And(c, False)', ['And', 'c', 'False']],
    ['Or(c, True)', ['Or', 'c', 'True']],
    ['Not(And(c, d))', ['Not', ['And', 'c', 'd']]],
    ['And(c, x > 0)', ['And', 'c', ['Greater', 'x', 0]]],
    ['Or(Not(c), d)', ['Or', ['Not', 'c'], 'd']],
    ['x > 0', ['Greater', 'x', 0]],
    ['Not(x > 0)', ['Not', ['Greater', 'x', 0]]],
    ['x = y', ['Equal', 'x', 'y']],
    ['x ≠ y', ['NotEqual', 'x', 'y']],
    ['0 < x < 1', ['Less', 0, 'x', 1]],
    ['And(x > 0, y < 1)', ['And', ['Greater', 'x', 0], ['Less', 'y', 1]]],
    [
      'And(c, x > 0, y < 1)',
      ['And', 'c', ['Greater', 'x', 0], ['Less', 'y', 1]],
    ],
    ['Not(c = True)', ['Not', ['Equal', 'c', 'True']]],
    ['Not(s = "a")', ['Not', ['Equal', 's', { str: 'a' }]]],
  ];

  test.each(cases)('%s agrees with the interpreter', (_name, json) => {
    const expr = ce.box(json as Parameters<typeof ce.box>[0]);
    const r = compile(expr);
    expect(r.success).toBe(true);
    for (const v of values) {
      // The interpreter refuses `c = 1` (an `incompatible-type` error for
      // the whole expression). Compiled code has no error value: it reads a
      // value that is not a boolean as a `c` with no value, so the
      // expected value is the interpreter's with `c` left out. A decisive
      // operand still settles the result: `Not(And(c, False))` is `true`.
      const { c, ...rest } = v;
      const expected = interpretBoolean(ce, expr, c === 1 ? rest : v);
      expect([v, r.run!(v)]).toEqual([v, expected]);
    }
  });

  test('Not(c) for c unsupplied, 1, true and false', () => {
    const r = compile(ce.box(['Not', 'c']));
    expect(r.run!({})).toBeUndefined();
    expect(r.run!({ c: 1 })).toBeUndefined();
    expect(r.run!({ c: true })).toBe(false);
    expect(r.run!({ c: false })).toBe(true);
  });

  test('a decisive operand settles the result', () => {
    expect(compile(ce.box(['And', 'c', 'False'])).run!({})).toBe(false);
    expect(compile(ce.box(['Or', 'c', 'True'])).run!({})).toBe(true);
  });

  test('a connective over comparisons of parameters keeps the plain code', () => {
    // A parameter is not read off the vars object, so a comparison over it
    // is a JavaScript comparison, which is always a boolean.
    const n = compile(ce.box(['Function', ['Not', ['Greater', 't', 0]], 't']));
    expect(n.code).toBe('(t) => !(0 < t)');
    const a = compile(
      ce.box(['Function', ['And', ['Greater', 't', 0], ['Less', 't', 3]], 't'])
    );
    expect(a.code).toBe('(t) => 0 < t && t < 3');
    expect(a.run!(1)).toBe(true);
  });

  test('a comparison tests each variable read once', () => {
    expect(compile(ce.box(['Greater', 'x', 0])).code).toBe(
      '((0 < _.x) || ((_.x !== undefined) ? false : undefined))'
    );
    // A variable declared `boolean` must hold a boolean.
    expect(compile(ce.box(['Equal', 'c', 'True'])).code).toContain(
      "typeof _.c === 'boolean'"
    );
    // A comparison in an arm whose condition tested `x` does not test it
    // again.
    const arm = compile(
      ce.box(['If', ['Greater', 'x', 0], ['Greater', 'x', 1], 'False'])
    );
    expect(arm.code).toBe(
      '((_.x !== undefined) ? ((0 < _.x) ? (1 < _.x) : (false)) : undefined)'
    );
  });

  test('a condition keeps its three-valued lowering', () => {
    const r = compile(ce.box(['If', ['Not', 'c'], 1, 2]));
    expect(r.run!({ c: false })).toBe(1);
    expect(r.run!({ c: true })).toBe(2);
    expect(r.run!({})).toBeNaN();
  });

  test('Xor, Implies and Equivalent agree with the interpreter on decided values', () => {
    // These have no `javascript` lowering: the result runs the
    // interpreter, which answers the decided cases.
    for (const head of ['Xor', 'Implies', 'Equivalent']) {
      const expr = ce.box([head, 'c', 'd']);
      const r = compile(expr);
      for (const c of [true, false])
        for (const d of [true, false])
          expect([head, c, d, r.run!({ c, d })]).toEqual([
            head,
            c,
            d,
            interpretBoolean(ce, expr, { c, d }),
          ]);
      // An unsupplied operand is not a confident answer.
      expect(typeof r.run!({})).not.toBe('boolean');
    }
  });
});

// CE-632: the interval runner reads a `boolean` variable as one of the
// strings `'true'`, `'false'`, `'maybe'`. A JavaScript boolean was read as
// `'maybe'`. It is now converted to `'true'`/`'false'` on the way in.
describe('CE-632 a JavaScript boolean for the interval runner', () => {
  const ce = new ComputeEngine();
  ce.declare('c', 'boolean');
  ce.declare('x', 'real');

  const ifc = compile(ce.box(['If', 'c', 1, 2]), { to: 'interval-js' });
  const when = compile(ce.box(['When', 'x', 'c']), { to: 'interval-js' });

  test('If(c, 1, 2) with a boolean and with the string form', () => {
    const one = { kind: 'interval', value: { lo: 1, hi: 1 } };
    const two = { kind: 'interval', value: { lo: 2, hi: 2 } };
    expect(ifc.run!({ c: true })).toEqual(one);
    expect(ifc.run!({ c: 'true' })).toEqual(one);
    expect(ifc.run!({ c: false })).toEqual(two);
    expect(ifc.run!({ c: 'false' })).toEqual(two);
    expect(ifc.run!({ c: 'maybe' })).toEqual({
      kind: 'interval',
      value: { lo: 1, hi: 2 },
    });
  });

  test('When(x, c) with a boolean and with the string form', () => {
    const two = { kind: 'interval', value: { lo: 2, hi: 2 } };
    expect(when.run!({ x: 2, c: true })).toEqual(two);
    expect(when.run!({ x: 2, c: 'true' })).toEqual(two);
    expect(when.run!({ x: 2, c: false })).toEqual({ kind: 'empty' });
    expect(when.run!({ x: 2, c: 'false' })).toEqual({ kind: 'empty' });
  });

  test('Not(c) and And(c, x > 0) read a boolean', () => {
    const n = compile(ce.box(['Not', 'c']), { to: 'interval-js' });
    expect(n.run!({ c: true })).toBe('false');
    expect(n.run!({ c: false })).toBe('true');
    const a = compile(ce.box(['And', 'c', ['Greater', 'x', 0]]), {
      to: 'interval-js',
    });
    expect(a.run!({ c: true, x: 2 })).toBe('true');
    expect(a.run!({ c: false, x: 2 })).toBe('false');
  });

  test('the enclosure contains the true value', () => {
    const r = compile(ce.box(['If', 'c', ['Power', 'x', 2], 0]), {
      to: 'interval-js',
    });
    const vars: Record<string, IntervalInput> = {
      c: true,
      x: { lo: 1.5, hi: 2.5 },
    };
    const v = r.run!(vars);
    expect(v).toMatchObject({ kind: 'interval' });
    const { lo, hi } = (v as { value: { lo: number; hi: number } }).value;
    for (const t of [1.5, 2, 2.5]) {
      expect(lo).toBeLessThanOrEqual(t * t);
      expect(hi).toBeGreaterThanOrEqual(t * t);
    }
    expect(r.run!({ c: false, x: { lo: 1.5, hi: 2.5 } })).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 0 },
    });
  });
});

// CE-633: `broadcast()` on `javascript` refused a `boolean` variable. It
// now takes a boolean (every cell) or a plain array of booleans (a column).
describe('CE-633 broadcast() with a boolean variable', () => {
  const ce = new ComputeEngine();
  ce.declare('c', 'boolean');
  ce.declare('x', 'real');
  const expr = ce.box(['If', 'c', ['Add', 'x', 1], ['Negate', 'x']]);
  const r = compile(expr);

  test('a boolean scalar agrees with the interpreter in each row', () => {
    const xs = [1, 2.5, -3];
    for (const c of [true, false]) {
      const out = r.broadcast!({ x: new Float64Array(xs), c });
      xs.forEach((x, i) =>
        expect(out[i]).toBe(interpretNumber(ce, expr, { x, c }))
      );
    }
  });

  test('a column of booleans agrees with the interpreter in each row', () => {
    const xs = [1, 2.5, -3, 4];
    const cs = [true, false, false, true];
    const out = r.broadcast!({ x: new Float64Array(xs), c: cs });
    xs.forEach((x, i) =>
      expect(out[i]).toBe(interpretNumber(ce, expr, { x, c: cs[i] }))
    );
  });

  test('a column of booleans as an axis of a grid', () => {
    const xs = [1, 2];
    const cs = [true, false];
    const out = r.broadcast!(
      { x: new Float64Array(xs), c: cs },
      { layout: 'grid' }
    );
    // The first input varies fastest.
    expect(Array.from(out)).toEqual([
      interpretNumber(ce, expr, { x: 1, c: true }),
      interpretNumber(ce, expr, { x: 2, c: true }),
      interpretNumber(ce, expr, { x: 1, c: false }),
      interpretNumber(ce, expr, { x: 2, c: false }),
    ]);
  });

  test('a boolean result is 1, 0, or NaN when it has no value', () => {
    const n = compile(ce.box(['Not', 'c']));
    expect(Array.from(n.broadcast!({ c: [true, false] }))).toEqual([0, 1]);
    expect(Array.from(n.broadcast!({}))).toEqual([NaN]);
  });

  test('broadcastAsync() reads a boolean column', async () => {
    const res = await r.broadcastAsync!({
      x: new Float64Array([1, 2]),
      c: [false, true],
    });
    expect(Array.from(res.out)).toEqual([-1, 3]);
  });

  test('the refusals of a wrong input are kept', () => {
    expect(() => r.broadcast!({ x: true })).toThrow(
      /"x" was compiled as a real number but received a boolean/
    );
    expect(() => r.broadcast!({ x: [true, false] })).toThrow(
      /"x" was compiled as a real number but received a boolean/
    );
    expect(() =>
      r.broadcast!({ x: 1, c: [true, 1] as unknown as boolean[] })
    ).toThrow(/a plain array is accepted only for a shared input/);
    expect(() =>
      r.broadcast!({ x: 1, c: new Uint8Array([1]) as unknown as boolean[] })
    ).toThrow(/must be a Float64Array, a number, a boolean or an array/);
    expect(() =>
      r.broadcast!({ x: new Float64Array([1, 2]), c: [true] })
    ).toThrow(/holds 1 cells, the first array 2/);
    const z = new ComputeEngine();
    z.declare('z', 'complex');
    expect(() =>
      compile(z.parse('z + 1'), { mode: 'complex' }).broadcast!({ z: true })
    ).toThrow(/"z" was compiled as a complex number but received a boolean/);
    // A `Uint8Array` is not a boolean column on interval-js either.
    const iv = compile(ce.box(['If', 'c', 1, 2]), { to: 'interval-js' });
    expect(() =>
      iv.broadcast!({ c: new Uint8Array([1]) as unknown as boolean[] })
    ).toThrow(/must be a Float64Array, a number, a boolean or an array/);
  });
});

// CE-634 (user decision 2026-10-30): a value that is not a string, for a
// variable declared `string`, throws a `TypeError` that names it. Before,
// `If(s = "a", 1, 2)` gave `2` for `s = 3`.
describe('CE-634 a value that is not a string for a string variable', () => {
  const ce = new ComputeEngine();
  ce.declare('s', 'string');
  ce.declare('c', 'boolean');
  ce.declare('L', 'list<string>');
  const r = compile(ce.parse('\\operatorname{If}(s = "a", 1, 2)'));

  test('a string is accepted', () => {
    expect(r.run!({ s: 'a' })).toBe(1);
    expect(r.run!({ s: 'b' })).toBe(2);
    expect(r.entryPlan?.texts).toEqual(['s']);
  });

  test('an unsupplied string variable is not refused', () => {
    expect(r.run!({})).toBeNaN();
  });

  test('a number, a boolean, null or an array throws', () => {
    expect(() => r.run!({ s: 3 })).toThrow(
      new TypeError(
        '"s" was compiled as a string but received 3. Pass a string.'
      )
    );
    expect(() => r.run!({ s: true })).toThrow(
      /"s" was compiled as a string but received true/
    );
    expect(() => r.run!({ s: null as unknown as string })).toThrow(
      /"s" was compiled as a string but received null/
    );
    expect(() => r.run!({ s: [1] })).toThrow(
      /"s" was compiled as a string but received an array/
    );
  });

  test('a lambda parameter annotated string', () => {
    const f = compile(
      ce.parse('(t: string) \\mapsto \\operatorname{If}(t = "a", 1, 2)')
    );
    expect(f.run!('a')).toBe(1);
    expect(() => f.run!(3)).toThrow(
      /argument 1 was compiled as a string but received 3/
    );
  });

  test('the cells of a list of strings are not read', () => {
    // The entry check never reads the entries of a list (its cost is
    // constant per binding), so a cell that is not a string is not refused.
    const l = compile(ce.box(['At', 'L', 2]));
    expect(() => l.run!({ L: ['a', 3] })).not.toThrow();
  });

  test('a boolean variable keeps its rule', () => {
    const w = compile(ce.box(['If', 'c', 1, 2]));
    expect(w.run!({ c: 1 })).toBeNaN();
    expect(w.run!({ c: 'true' })).toBeNaN();
  });

  test('entryChecks: false keeps the unchecked behavior', () => {
    const u = compile(ce.parse('\\operatorname{If}(s = "a", 1, 2)'), {
      entryChecks: false,
    });
    expect(u.run!({ s: 3 })).toBe(2);
  });
});

// A comparison whose value is the result has no value while a variable it
// reads has none, as in the interpreter and as in a branch condition (user
// decision 2026-10-20: `x > 0` is undecided for an unsupplied `x`).
describe('a bare comparison over an unsupplied variable', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('c', 'boolean');
  ce.declare('s', 'string');

  test('the reviewer probes', () => {
    expect(compile(ce.box(['Not', ['Greater', 'x', 0]])).run!({})).toBe(
      undefined
    );
    const nc = compile(ce.box(['Not', ['Equal', 'c', 'True']]));
    expect(nc.run!({})).toBeUndefined();
    expect(nc.run!({ c: 1 })).toBeUndefined();
    expect(nc.run!({ c: false })).toBe(true);
    expect(
      compile(ce.box(['Not', ['Equal', 's', { str: 'a' }]])).run!({})
    ).toBeUndefined();
    const and = compile(ce.box(['And', 'c', ['Greater', 'x', 0]]));
    expect(and.run!({ c: true })).toBeUndefined();
    expect(and.run!({ c: false })).toBe(false);
  });

  test('a NaN operand decides the comparison while the other has no value', () => {
    // The interpreter answers `False` for `NaN = y` and `True` for
    // `NaN ≠ y` whatever `y` holds.
    expect(compile(ce.box(['Equal', 'x', 'y'])).run!({ x: NaN })).toBe(false);
    expect(compile(ce.box(['NotEqual', 'x', 'y'])).run!({ x: NaN })).toBe(true);
    expect(compile(ce.box(['Less', 'x', 'y'])).run!({ y: NaN })).toBe(false);
    // Also as a branch condition.
    expect(
      compile(ce.box(['If', ['Equal', 'x', 'y'], 1, 2])).run!({ x: NaN })
    ).toBe(2);
    expect(compile(ce.box(['If', ['Equal', 'x', 'y'], 1, 2])).run!({})).toBe(
      NaN
    );
  });

  test('a condition that tests `c = True` needs a boolean', () => {
    const r = compile(ce.box(['If', ['Equal', 'c', 'True'], 5, -1]));
    expect(r.run!({ c: true })).toBe(5);
    expect(r.run!({ c: false })).toBe(-1);
    expect(r.run!({ c: 1 })).toBeNaN();
    expect(r.run!({})).toBeNaN();
  });

  test('an omitted lambda argument for a string parameter', () => {
    const f = compile(
      ce.parse('(t: string) \\mapsto \\operatorname{If}(t = "a", 1, 2)')
    );
    expect(f.run!()).toBeNaN();
    expect(f.run!('a')).toBe(1);
    expect(f.run!('b')).toBe(2);
    const g = compile(ce.parse('(t: string) \\mapsto t = "a"'));
    expect(g.run!()).toBeUndefined();
    expect(g.run!('a')).toBe(true);
  });
});

// The interpreter fallback of interval-js reads the strings `'true'`,
// `'false'` and `'maybe'` as booleans for a variable declared `boolean`
// only; a `string` variable keeps its text.
describe('interval-js interpreter fallback with a boolean variable', () => {
  const ce = new ComputeEngine();
  ce.declare('c', 'boolean');
  ce.declare('x', 'real');
  ce.declare('s', 'string');
  const quiet = jest.spyOn(console, 'warn').mockImplementation(() => {});
  afterAll(() => quiet.mockRestore());

  test('the string form and the boolean form', () => {
    // `Fibonacci` has no interval lowering: the result runs the
    // interpreter.
    const r = compile(ce.box(['If', 'c', ['Fibonacci', 'x'], 0]), {
      to: 'interval-js',
    });
    expect(r.success).toBe(false);
    const five = { kind: 'interval', value: { lo: 5, hi: 5 } };
    const zero = { kind: 'interval', value: { lo: 0, hi: 0 } };
    expect(r.run!({ c: 'true', x: 5 })).toEqual(five);
    expect(r.run!({ c: true, x: 5 })).toEqual(five);
    expect(r.run!({ c: 'false', x: 5 })).toEqual(zero);
    expect(r.run!({ c: false, x: 5 })).toEqual(zero);
    // `'maybe'` can be either value: the result bounds nothing.
    expect(r.run!({ c: 'maybe', x: 5 })).toEqual({ kind: 'entire' });
    const b = compile(
      ce.box(['And', 'c', ['Greater', ['Fibonacci', 'x'], 0]]),
      { to: 'interval-js' }
    );
    expect(b.run!({ c: 'true', x: 5 })).toBe('true');
    expect(b.run!({ c: 'false', x: 5 })).toBe('false');
    expect(b.run!({ c: 'maybe', x: 5 })).toBe('maybe');
  });

  test('a string variable keeps its text', () => {
    const r = compile(ce.box(['If', ['Equal', 's', { str: 'true' }], 1, 2]), {
      to: 'interval-js',
    });
    expect(r.success).toBe(false);
    expect(r.run!({ s: 'true' as unknown as IntervalInput })).toEqual({
      kind: 'interval',
      value: { lo: 1, hi: 1 },
    });
    expect(r.run!({ s: 'false' as unknown as IntervalInput })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
  });
});

describe('interval-js broadcast() with a boolean variable', () => {
  const ce = new ComputeEngine();
  ce.declare('c', 'boolean');
  ce.declare('x', 'real');
  const r = compile(ce.box(['If', 'c', ['Add', 'x', 1], 0]), {
    to: 'interval-js',
  });

  /** The `lo, hi, kind` triple of each cell. */
  const cells = (out: Float64Array): number[][] => {
    const rows: number[][] = [];
    for (let i = 0; i < out.length; i += 3)
      rows.push([out[i], out[i + 1], out[i + 2]]);
    return rows;
  };

  test('a boolean scalar and a boolean column agree with run()', () => {
    const xs = new Float64Array([1, 2, 3, 4]);
    for (const c of [true, false]) {
      const out = cells(r.broadcast!({ x: xs, c }));
      out.forEach((cell, i) => {
        const v = r.run!({ x: { lo: xs[2 * i], hi: xs[2 * i + 1] }, c }) as {
          value: { lo: number; hi: number };
        };
        expect(cell).toEqual([v.value.lo, v.value.hi, INTERVAL_KIND.interval]);
      });
    }
    const out = cells(r.broadcast!({ x: xs, c: [true, false] }));
    expect(out).toEqual([
      [2, 3, INTERVAL_KIND.interval],
      [0, 0, INTERVAL_KIND.interval],
    ]);
  });

  test('a boolean result, and a column as a grid axis', () => {
    const n = compile(ce.box(['Not', 'c']), { to: 'interval-js' });
    expect(cells(n.broadcast!({ c: [true, false] }))).toEqual([
      [NaN, NaN, INTERVAL_KIND.boolFalse],
      [NaN, NaN, INTERVAL_KIND.boolTrue],
    ]);
    const g = r.broadcast!(
      { x: new Float64Array([1, 1, 5, 5]), c: [true, false] },
      { layout: 'grid' }
    );
    expect(cells(g)).toEqual([
      [2, 2, INTERVAL_KIND.interval],
      [6, 6, INTERVAL_KIND.interval],
      [0, 0, INTERVAL_KIND.interval],
      [0, 0, INTERVAL_KIND.interval],
    ]);
  });

  test('broadcastAsync() reads a boolean column', async () => {
    const res = await r.broadcastAsync!({
      x: new Float64Array([1, 1]),
      c: [true],
    });
    expect(Array.from(res.out)).toEqual([2, 2, INTERVAL_KIND.interval]);
  });

  test('an empty boolean column is an empty batch', () => {
    expect(r.broadcast!({ x: new Float64Array(0), c: [] }).length).toBe(0);
  });
});

describe('broadcast() and a variable declared string (CE-634)', () => {
  const ce = new ComputeEngine();
  ce.declare('s', 'string');
  ce.declare('x', 'real');
  const r = compile(ce.parse('\\operatorname{If}(s = "a", x, 2)'));
  const message = /"s" was compiled as a string but received/;

  test('every batch input is refused, on each route', async () => {
    const x = new Float64Array([1, 2]);
    expect(() => r.broadcast!({ s: 3, x })).toThrow(
      new TypeError(
        '"s" was compiled as a string but received 3. Pass a string.'
      )
    );
    expect(() => r.broadcast!({ s: true, x })).toThrow(message);
    expect(() => r.broadcast!({ s: [true, false], x })).toThrow(message);
    expect(() => r.broadcast!({ s: new Float64Array([1, 2]), x })).toThrow(
      /received an array/
    );
    await expect(r.broadcastAsync!({ s: 3, x })).rejects.toThrow(message);
    const stored = createJavaScriptRuntime({}).loadBroadcast(r as never);
    expect(() => stored({ s: 3, x })).toThrow(message);
  });

  test('a variable declared `string | missing` refuses a number too', () => {
    const o = new ComputeEngine();
    o.declare('t', 'string | missing');
    const f = compile(o.parse('\\operatorname{If}(t = "a", 1, 2)'));
    expect(() => f.run!({ t: 3 })).toThrow(
      /"t" was compiled as a string but received 3/
    );
    expect(f.run!({ t: 'a' })).toBe(1);
  });
});

describe('an empty column for a variable declared boolean', () => {
  const ce = new ComputeEngine();
  ce.declare('c', 'boolean');
  ce.declare('x', 'real');
  const r = compile(ce.box(['If', 'c', ['Add', 'x', 1], ['Negate', 'x']]));

  test('is an empty batch, also as a grid axis and in broadcastAsync()', async () => {
    expect(r.broadcast!({ x: new Float64Array(0), c: [] }).length).toBe(0);
    expect(
      r.broadcast!({ x: new Float64Array([1, 2]), c: [] }, { layout: 'grid' })
        .length
    ).toBe(0);
    const res = await r.broadcastAsync!({ x: new Float64Array(0), c: [] });
    expect(res.out.length).toBe(0);
  });

  test('is still refused for a variable of another type', () => {
    expect(() => r.broadcast!({ x: [] as unknown as Float64Array })).toThrow(
      /a plain array is accepted only for a shared input/
    );
  });
});

// User decision 2026-10-30: a comparison whose value is the result has no
// value (`undefined`) while it reads an unsupplied variable. The plain
// comparison runs first; a NaN operand still decides it; a chain is the
// three-valued `And` of its links; a consumer that reads only truth gets
// the plain comparison.
describe('a comparison as the result: the cheap form and its decided cases', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('t', 'real');
  ce.declare('L', 'list<real>');
  const js = (json: unknown) =>
    compile(ce.box(json as never), { fallback: false });

  test('the emission runs the plain comparison first', () => {
    const gt = js(['Greater', 'x', 0]);
    expect(gt.code).toBe(
      '((0 < _.x) || ((_.x !== undefined) ? false : undefined))'
    );
    expect(gt.run!({})).toBeUndefined();
    expect(gt.run!({ x: 1 })).toBe(true);
    expect(gt.run!({ x: -1 })).toBe(false);
    const ne = js(['NotEqual', 'x', 0]);
    expect(ne.code).toContain('&& ((_.x !== undefined) ? true : undefined)');
    expect(ne.run!({})).toBeUndefined();
    expect(ne.run!({ x: 0 })).toBe(false);
    expect(ne.run!({ x: 1 })).toBe(true);
  });

  test('a NaN in an If arm decides the arm', () => {
    // `x ≠ 0` is true for `x = NaN`, so the arm `x = y` (or `x < y`) is
    // read, and its NaN operand makes it `false` whatever `y` holds.
    for (const arm of ['Equal', 'Less']) {
      const json = ['If', ['NotEqual', 'x', 0], [arm, 'x', 'y'], 'False'];
      expect(js(json).run!({ x: NaN })).toBe(false);
      expect(interpretBoolean(ce, ce.box(json as never), { x: NaN })).toBe(
        false
      );
    }
  });

  test('a chain with a computed operand keeps a decided false', () => {
    const cases: [unknown, Vars][] = [
      [['Less', 'x', ['Add', 'y', 1], 2], { y: 2 }],
      [['Less', 0, 'x', ['Add', 'y', 1]], { x: -1 }],
      [['Less', 5, ['Add', 'x', 1], 'y'], { x: 0 }],
    ];
    for (const [json, vars] of cases) {
      expect(js(json).run!(vars)).toBe(false);
      expect(interpretBoolean(ce, ce.box(json as never), vars)).toBe(false);
    }
    // Undecided while the variable that could decide it is unsupplied.
    expect(js(['Less', 'x', ['Add', 'y', 1], 2]).run!({ y: 0 })).toBe(
      undefined
    );
  });

  test('a computed NaN operand decides the comparison', () => {
    const r = js(['Less', ['Add', 'x', 1], 'y']);
    expect(r.run!({ x: NaN })).toBe(false);
    expect(r.run!({ x: 1 })).toBeUndefined();
    expect(r.run!({ x: 1, y: 3 })).toBe(true);
  });

  test('Boole reads only truth, so it gets the plain comparison', () => {
    const b = js(['Boole', ['Greater', 'x', 0]]);
    expect(b.code).toBe('((0 < _.x) ? 1 : 0)');
    expect(b.run!({})).toBe(0);
    const p = js(['Multiply', ['Boole', ['Greater', 'x', 0]], 'x']);
    expect(p.run!({ x: 2 })).toBe(2);
    // `NotEqual` keeps its test: `undefined !== 0` is `true`.
    expect(js(['Boole', ['NotEqual', 'x', 0]]).run!({})).toBe(0);
  });

  test('the mark lasts only while the consumer compiles', () => {
    // The same expression object, compiled by itself after `Boole`, keeps
    // its test.
    const c = ce.box(['Greater', 'x', 0]);
    compile(ce.function('Boole', [c]), { fallback: false });
    expect(compile(c, { fallback: false }).run!({})).toBeUndefined();
  });

  test('a selecting predicate gets the plain comparison', () => {
    const f = js(['Filter', 'L', ['Function', ['Less', 'k', 't'], 'k']]);
    expect(f.code).not.toContain('!== undefined');
    expect(f.run!({ L: [1, 5], t: 3 })).toEqual([1]);
    expect(f.run!({ L: [1, 5] })).toEqual([]);
    const both = js([
      'Filter',
      'L',
      ['Function', ['And', ['Less', 'k', 't'], ['Greater', 'k', 0]], 'k'],
    ]);
    expect(both.code).not.toContain('!== undefined');
    expect(both.run!({ L: [-1, 1, 5], t: 3 })).toEqual([1]);
    // `NotEqual` keeps its test, so an unsupplied `t` selects nothing.
    const ne = js(['Filter', 'L', ['Function', ['NotEqual', 'k', 't'], 'k']]);
    expect(ne.run!({ L: [1, 5] })).toEqual([]);
  });
});

describe('interval-js: boolean inputs on broadcast() and a loaded runtime', () => {
  const ce = new ComputeEngine();
  ce.declare('y', 'real | enclosure');
  ce.declare('c', 'boolean');
  ce.declare('x', 'real');
  const message =
    /"y" \(type `enclosure \| real`\) is compiled as a value of its kind type/;

  test('a boolean for a variable of a kind type is refused, as run() refuses it', async () => {
    const r = compile(ce.box(['Add', 'y', 1]), { to: 'interval-js' });
    expect(() => r.run!({ y: true })).toThrow(message);
    expect(() => r.broadcast!({ y: true })).toThrow(message);
    expect(() => r.broadcast!({ y: [true, false] })).toThrow(message);
    await expect(r.broadcastAsync!({ y: true })).rejects.toThrow(message);
  });

  test('the loaded runtime reads a boolean column', () => {
    const r = compile(ce.box(['If', 'c', ['Add', 'x', 1], 0]), {
      to: 'interval-js',
    });
    expect(r.booleanInputs).toEqual(['c']);
    const loaded = createIntervalRuntime().loadBroadcast(r as never);
    expect(loaded({ x: new Float64Array(0), c: [] }).length).toBe(0);
    expect(
      Array.from(
        loaded({ x: new Float64Array([1, 1, 2, 2]), c: [true, false] })
      )
    ).toEqual([2, 2, INTERVAL_KIND.interval, 0, 0, INTERVAL_KIND.interval]);
  });
});

describe('a variable declared `boolean | missing`', () => {
  test('an empty column is an empty batch, on javascript and interval-js', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean | missing');
    ce.declare('x', 'real');
    const expr = ce.box(['If', 'c', ['Add', 'x', 1], 0]);
    const r = compile(expr);
    expect(r.broadcast!({ x: new Float64Array(0), c: [] }).length).toBe(0);
    const i = compile(expr, { to: 'interval-js' });
    expect(i.booleanInputs).toEqual(['c']);
    expect(i.broadcast!({ x: new Float64Array(0), c: [] }).length).toBe(0);
  });
});

describe('an index axis for a variable declared string', () => {
  test('the refusal shows the axis length', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'string');
    ce.declare('x', 'real');
    const r = compile(ce.parse('\\operatorname{If}(s = "a", x, 2)'));
    expect(() =>
      r.broadcast!(
        { x: new Float64Array([1, 2]), s: 4 },
        { layout: 'grid', indexes: ['s'] }
      )
    ).toThrow(
      new TypeError(
        '"s" was compiled as a string but received 4. Pass a string.'
      )
    );
  });
});

// Review of the comparison lowering of 2026-10-30. Each case is checked
// against the interpreter's answer, named in the comment.
describe('a comparison as the result: the cases the review found', () => {
  const ce = new ComputeEngine();
  for (const name of ['x', 'y', 'n', 'm', 'a', 'b']) ce.declare(name, 'real');
  ce.declare('s', 'string');
  ce.declare('t', 'string');
  const js = (json: unknown) =>
    compile(ce.box(json as never), { fallback: false });

  test('a NaN literal decides the comparison', () => {
    // The interpreter: `NaN < x` is False and `NaN ≠ x` is True while `x`
    // has no value.
    expect(js(['Less', 'NaN', 'x']).run!({})).toBe(false);
    expect(js(['NotEqual', 'NaN', 'x']).run!({})).toBe(true);
    expect(js(['Equal', 'x', 'NaN']).run!({})).toBe(false);
    expect(js(['Less', 'x', 'NaN', 'y']).run!({})).toBe(false);
    expect(js(['NotEqual', 'x', 'NaN', 'y']).run!({})).toBe(true);
    // Also as a branch condition.
    expect(js(['If', ['Less', 'NaN', 'x'], 1, 2]).run!({})).toBe(2);
    expect(js(['If', ['NotEqual', 'NaN', 'x'], 1, 2]).run!({})).toBe(1);
  });

  test('an operand that reads an absent value as a number takes the tests first', () => {
    // The interpreter has no value for each of these while `x` has none.
    const cases: unknown[] = [
      ['Equal', ['Boole', ['Greater', 'x', 0]], 0],
      ['Less', ['Boole', ['Greater', 'x', 0]], 1],
      [
        'Equal',
        ['Count', ['List', 1, 2, 3], ['Function', ['Greater', 'k', 'x'], 'k']],
        0,
      ],
    ];
    for (const json of cases) {
      const r = js(json);
      expect(r.code.startsWith('((_.x !== undefined) ? (')).toBe(true);
      expect(r.run!({})).toBeUndefined();
    }
    expect(js(cases[0]).run!({ x: -1 })).toBe(true);
    expect(js(cases[2]).run!({ x: 5 })).toBe(true);
  });

  test('a truth test does not drop the test of a string comparison', () => {
    // `_SYS.eqt(undefined, undefined)` is `true`.
    expect(js(['Boole', ['Equal', 's', 't']]).run!({})).toBe(0);
    expect(
      js(['Count', ['List', 1, 2, 3], ['Function', ['Equal', 's', 't'], 'e']])
        .run!({})
    ).toBe(0);
    expect(js(['Boole', ['Equal', 's', 't']]).run!({ s: 'a', t: 'a' })).toBe(1);
  });

  test('a numeric block local that holds NaN, with an input absent', () => {
    const json = [
      'Block',
      ['Assign', 'a2', ['Add', 'n', 1]],
      ['Less', 'a2', 'm'],
    ];
    // The interpreter gives `False` (`NaN < m`). A comparison of a block
    // local tests every caller input of the block, `m` too, and a NaN local
    // does not escape that test: too strict, which is accepted (user
    // decision 2026-10-30).
    expect(js(json).run!({ n: NaN })).toBeUndefined();
    expect(js(json).run!({ n: NaN, m: 3 })).toBe(false);
    expect(js(json).run!({ n: 1, m: 3 })).toBe(true);
  });

  test('a complex operand that is not real decides an ordering only', () => {
    // `Less(√-1, m)` is False in the interpreter; `√-1 = m` has no value
    // while `m` has none.
    expect(js(['Less', ['Sqrt', 'n'], 'm']).run!({ n: -1 })).toBe(false);
    expect(js(['Less', ['Sqrt', 'n'], 'm']).run!({ n: 4, m: 3 })).toBe(true);
    expect(js(['Equal', ['Sqrt', 'n'], 'm']).run!({ n: -1 })).toBeUndefined();
    expect(
      js(['NotEqual', ['Sqrt', 'n'], 'm']).run!({ n: -1 })
    ).toBeUndefined();
  });

  test('a computed operand is not bound to a closure', () => {
    // Its NaN test repeats its code, which runs only when a read is absent.
    const r = js(['Equal', ['Add', 'a', 1], ['Multiply', 'b', 2]]);
    expect(r.code).not.toContain('=>');
    expect(r.run!({ a: 1, b: 1 })).toBe(true);
    expect(r.run!({ a: NaN })).toBe(false);
    expect(r.run!({ a: 1 })).toBeUndefined();
  });
});

describe('a variable with no declared type', () => {
  // An unsupplied variable gives no value, whatever its declared type
  // (user decision 2026-10-30). A comparison over an operand of type
  // `unknown` compiles to the scalar comparison, so it takes the same test.
  const ce = new ComputeEngine();
  const js = (json: unknown) =>
    compile(ce.box(json as never), { fallback: false });

  test('is tested for a value', () => {
    expect(js(['Greater', 'u', 0]).run!({})).toBeUndefined();
    expect(js(['Greater', 'u', 0]).run!({ u: 1 })).toBe(true);
    expect(js(['Equal', 'u', 0]).run!({})).toBeUndefined();
    expect(js(['Equal', 'u', 0]).run!({ u: 0 })).toBe(true);
    expect(js(['NotEqual', 'u', 0]).run!({})).toBeUndefined();
    // A NaN operand still decides.
    expect(js(['Less', 'u', 'v']).run!({ u: NaN })).toBe(false);
  });
});

describe('a boolean column is checked on every batch', () => {
  const ce = new ComputeEngine();
  ce.declare('c', 'boolean');
  ce.declare('x', 'real');
  const r = compile(ce.box(['If', 'c', ['Add', 'x', 1], 0]));
  const other = compile(ce.box(['If', 'c', 1, 2]));

  test('an element changed after a batch is refused by the next one', () => {
    const c: unknown[] = [true, false];
    const x = new Float64Array([1, 2]);
    expect(Array.from(r.broadcast!({ x, c: c as boolean[] }))).toEqual([2, 0]);
    for (const value of [5, 'a', undefined]) {
      c[1] = value;
      expect(() => r.broadcast!({ x, c: c as boolean[] })).toThrow(
        /a plain array/
      );
      expect(() => other.broadcast!({ c: c as boolean[] })).toThrow(
        /a plain array/
      );
    }
    c[1] = false;
    expect(Array.from(r.broadcast!({ x, c: c as boolean[] }))).toEqual([2, 0]);
  });
});

// A comparison that reads a block local tests the reads of the values
// assigned to it (`BaseCompiler.blockLocalValueFrame`): in the interpreter,
// `a2 < m` after `a2 := n + 1` has no value while `n` has none.
describe('a comparison that reads a block local', () => {
  const ce = new ComputeEngine();
  for (const name of ['n', 'm']) ce.declare(name, 'real');
  const js = (json: unknown) =>
    compile(ce.box(json as never), { fallback: false });
  /** The interpreter's value, as MathJSON. */
  const interpreted = (
    json: unknown,
    vars: Record<string, number>
  ): unknown => {
    const subs: Record<string, Expression> = {};
    for (const [k, v] of Object.entries(vars)) subs[k] = ce.box(v);
    return ce
      .box(json as never)
      .subs(subs)
      .evaluate().json;
  };
  /** The compiled value matches the interpreter's: `undefined` (`NaN` for
   * a branch) where the interpreter has no value. */
  const agrees = (
    json: unknown,
    vars: Record<string, number>,
    branch = false
  ) => {
    const c = js(json).run!(vars);
    const i = interpreted(json, vars);
    if (i === 'True') expect(c).toBe(true);
    else if (i === 'False') expect(c).toBe(false);
    else if (typeof i === 'number') expect(c).toBe(i);
    else if (branch) expect(c).toBeNaN();
    else expect(c).toBeUndefined();
  };

  const straight = [
    'Block',
    ['Assign', 'a2', ['Add', 'n', 1]],
    ['Less', 'a2', 'm'],
  ];
  const straightIf = [
    'Block',
    ['Assign', 'a2', ['Add', 'n', 1]],
    ['If', ['Less', 'a2', 'm'], 1, 2],
  ];
  const loop = (body: unknown) => [
    'Block',
    ['Assign', 'a2', 0],
    [
      'Loop',
      ['Assign', 'a2', ['Add', 'a2', 'n']],
      ['Element', 'k', ['Range', 1, 3]],
    ],
    body,
  ];
  const branch = [
    'Block',
    ['Assign', 'a2', 1],
    ['If', ['Greater', 'm', 0], ['Assign', 'a2', 'n']],
    ['Less', 'a2', 'm'],
  ];

  test('a local assigned once, before the read', () => {
    const runs: Record<string, number>[] = [
      {},
      { m: 5 },
      { n: 1, m: 5 },
      { n: 9, m: 5 },
      { n: NaN, m: 5 },
    ];
    for (const vars of runs) agrees(straight, vars);
    for (const vars of runs.slice(1)) agrees(straightIf, vars, true);
    // With `m` absent, the interpreter gives `False` for `NaN < m`; the
    // test of every caller input of the block gives no value (too strict,
    // user decision 2026-10-30).
    expect(js(straight).run!({ n: NaN })).toBeUndefined();
  });

  test('a local reassigned in a loop', () => {
    const runs: Record<string, number>[] = [
      { m: 5 },
      { n: 1, m: 5 },
      { n: 2, m: 5 },
    ];
    for (const vars of runs) agrees(loop(['Less', 'a2', 'm']), vars);
    for (const vars of runs)
      agrees(loop(['If', ['Less', 'a2', 'm'], 1, 2]), vars, true);
  });

  test('a local assigned in one branch only', () => {
    agrees(branch, { m: 5 });
    agrees(branch, { n: 2, m: 5 });
    // The test follows every value assigned to the local, so it requires
    // `n` also when the branch that reads it does not run: no value where
    // the interpreter has `False`. It never gives a value where the
    // interpreter has none.
    expect(interpreted(branch, { m: -5 })).toBe('False');
    expect(js(branch).run!({ m: -5 })).toBeUndefined();
  });

  test('a computed operand or a local that holds NaN decides a branch', () => {
    agrees(['If', ['Less', ['Add', 'n', 1], 'm'], 1, 2], { n: NaN }, true);
    agrees(['If', ['Less', ['Add', 'n', 1], 'm'], 1, 2], {}, true);
  });
});

// Review of the Block-local inputs (delta of 2026-10-30): the locals are
// matched by their definition, not their name, and a symbol is read through
// its value. Each case is compared with the interpreter.
describe('block locals matched by definition', () => {
  /** A fresh engine for each case: the interpreter's `Assign` writes. */
  const fresh = (): ComputeEngine => {
    const ce = new ComputeEngine();
    for (const name of ['n', 'm', 'x', 'y']) ce.declare(name, 'real');
    ce.declare('L', 'list<real>');
    return ce;
  };
  /** The compiled value and the interpreter's value (MathJSON) of `json`,
   * on the engine `ce` (a fresh one when not given). */
  const both = (
    json: unknown,
    vars: Record<string, unknown>,
    ce: ComputeEngine = fresh()
  ) => {
    const compiled = compile(ce.box(json as never), { fallback: false }).run!(
      vars as never
    );
    const subs: Record<string, Expression> = {};
    for (const [k, v] of Object.entries(vars))
      subs[k] = Array.isArray(v)
        ? ce.box(['List', ...v] as never)
        : ce.box(v as number);
    const interpreted = ce
      .box(json as never)
      .subs(subs)
      .evaluate().json;
    return { compiled, interpreted };
  };
  /** No value in the interpreter (it keeps a comparison or a `Boole`
   * unevaluated), and `undefined` compiled (`0` for a `Boole`, which reads
   * only truth). */
  const noValue = (
    json: unknown,
    vars: Record<string, unknown>,
    ce?: ComputeEngine,
    compiledValue: unknown = undefined
  ) => {
    const { compiled, interpreted } = both(json, vars, ce);
    expect(typeof interpreted).not.toBe('number');
    expect(['True', 'False']).not.toContain(interpreted);
    expect(compiled).toBe(compiledValue);
  };

  test('a nested binder with the name of a free variable does not hide it', () => {
    const local = ['Assign', 'p', ['Add', 'n', 1]];
    const read = ['Less', 'p', 'm'];
    noValue(
      [
        'Block',
        local,
        ['Assign', 'q', ['Sum', ['Multiply', 2, 'n'], ['Tuple', 'n', 1, 3]]],
        read,
      ],
      { m: 5 }
    );
    noValue(
      [
        'Block',
        local,
        ['Assign', 'gg', ['Function', ['Multiply', 2, 'n'], 'n']],
        read,
      ],
      { m: 5 }
    );
    noValue(
      [
        'Block',
        local,
        [
          'Loop',
          ['Assign', 'q', ['Multiply', 2, 'n']],
          ['Element', 'n', ['Range', 1, 3]],
        ],
        read,
      ],
      { m: 5 }
    );
  });

  test('the body of a block-local function is followed', () => {
    const json = [
      'Block',
      ['Assign', 'gg', ['Function', ['Add', 't', 'n'], 't']],
      ['Assign', 'p', ['gg', 1]],
      ['Less', 'p', 'm'],
    ];
    noValue(json, { m: 5 });
    expect(both(json, { m: 5, n: 1 })).toEqual({
      compiled: true,
      interpreted: 'True',
    });
  });

  test('a comparison of a call of a block-local function is tested', () => {
    // The call has a top type, and compiles to the run-time dispatch
    // (`_SYS.bcast`, `_SYS.eq`), which took no test.
    noValue(
      [
        'Block',
        ['Assign', 'c', ['Add', 'n', 1]],
        ['Assign', 'gg', ['Function', ['Add', 't', 'c'], 't']],
        ['Less', ['gg', 1], 'm'],
      ],
      { m: 5 }
    );
    const boole = [
      'Block',
      ['Assign', 'gg', ['Function', ['Boole', ['Greater', 'x', 't']], 't']],
      ['Equal', ['gg', 0], 0],
    ];
    noValue(boole, {});
    expect(both(boole, { x: 1 })).toEqual({
      compiled: false,
      interpreted: 'False',
    });
  });

  test('a parameter with the name of a local is not that local', () => {
    // `t` in the body of `gg` is its parameter, so `_.n` is not tested
    // there.
    const json = [
      'Block',
      ['Assign', 't', ['Add', 'n', 1]],
      ['Assign', 'gg', ['Function', ['If', ['Less', 't', 1], 0, 1], 't']],
      ['gg', 0],
    ];
    const ce = fresh();
    expect(compile(ce.box(json as never), { fallback: false }).code).toContain(
      '((t) => ((t < 1) ? (0) : (1)))'
    );
    expect(both(json, {})).toEqual({ compiled: 0, interpreted: 0 });
  });

  test('a destructured local keeps its inputs', () => {
    const json = [
      'Block',
      ['Assign', ['Tuple', 'p', 'q'], ['Tuple', ['Add', 'n', 1], 1]],
      ['Less', 'p', 'm'],
    ];
    noValue(json, { m: 5 });
    expect(both(json, { m: 5, n: 1 })).toEqual({
      compiled: true,
      interpreted: 'True',
    });
  });

  test('a local or an engine value that reads an absent value as a number', () => {
    const local = ['Assign', 'p', ['Boole', ['Greater', 'x', 0]]];
    noValue(['Block', local, ['Equal', 'p', 0]], {});
    expect(both(['Block', local, ['Equal', 'p', 0]], { x: 1 })).toEqual({
      compiled: false,
      interpreted: 'False',
    });
    // A truth test does not drop the test either.
    noValue(['Block', local, ['Boole', ['Equal', 'p', 0]]], {}, undefined, 0);
    const withValue = (): ComputeEngine => {
      const ce = fresh();
      ce.assign('aa', ce.box(['Boole', ['Greater', 'x', 0]]));
      return ce;
    };
    noValue(['Equal', 'aa', 0], {}, withValue());
    // The value of `aa` is read where it is defined, so the interpreter's
    // `x` is assigned, not substituted.
    const assigned = withValue();
    expect(
      compile(assigned.box(['Equal', 'aa', 0]), { fallback: false }).run!({
        x: 1,
      })
    ).toBe(false);
    assigned.assign('x', 1);
    expect(assigned.box(['Equal', 'aa', 0]).evaluate().json).toBe('False');
    noValue(['Boole', ['Equal', 'aa', 0]], {}, withValue(), 0);
  });

  test('a symbol found while reading a value is read through its own value', () => {
    // Each local reads one that is `Boole(x > 0)`, directly or through a
    // loop or a chain: `a = 1` is `true` for an absent `x` in the plain
    // comparison.
    noValue(
      [
        'Block',
        ['Assign', 'b', ['Boole', ['Greater', 'x', 0]]],
        ['Assign', 'a', ['Add', 'b', 1]],
        ['Equal', 'a', 1],
      ],
      {}
    );
    noValue(
      [
        'Block',
        ['Assign', 'a', 0],
        ['Assign', 'b', 0],
        [
          'Loop',
          [
            'Block',
            ['Assign', 'a', ['Add', 'b', 1]],
            ['Assign', 'b', ['Add', ['Boole', ['Greater', 'x', 0]], 'a']],
          ],
          ['Element', 'k', ['Range', 1, 3]],
        ],
        ['Equal', 'a', 3],
      ],
      {}
    );
    const chain: unknown[] = [['Assign', 'v0', ['Boole', ['Greater', 'x', 0]]]];
    for (let i = 1; i < 200; i++)
      chain.push(['Assign', `v${i}`, ['Add', `v${i - 1}`, 0]]);
    noValue(['Block', ...chain, ['Equal', 'v199', 0]], {});
  });

  test('Max and Min of a list take the tests first', () => {
    noValue(['Less', ['Max', 'L'], 1], {});
    noValue(['Less', ['Min', 'L'], 1], {});
    expect(both(['Less', ['Max', 'L'], 1], { L: [0, 0.5] })).toEqual({
      compiled: true,
      interpreted: 'True',
    });
    noValue(['Less', ['Max', 'x', 'y'], 1], { y: 0 });
  });

  test('a loop index read by a value of a local is not an input', () => {
    // `s` is assigned `s + k` inside `for k in …`: the loop condition reads
    // `s`, and must not test `_.k` (never supplied), or the loop never
    // ends.
    const source =
      'let s = 0\nwhile s < 10 { for k in [1, 2] { s = s + k } }\ns';
    const ce = fresh();
    const [program] = parseEpsil(source);
    const expr = ce.box(program);
    const r = compile(expr, { fallback: false });
    expect(r.code).not.toContain('_.k');
    expect(r.run!({})).toBe(12);
    expect(expr.evaluate().re).toBe(12);
  });

  test('a NaN operand of a negated relation decides the branch', () => {
    expect(both(['If', ['Not', ['Less', 'x', 'y']], 1, 2], { x: NaN })).toEqual(
      { compiled: 1, interpreted: 1 }
    );
  });

  test('a local that may be unset gets a JavaScript test only', () => {
    // `a2` is assigned only in a loop body: on JavaScript its read is
    // tested for `undefined`. Python, GLSL and WGSL check only that the
    // code compiles with no JavaScript syntax in it: their results are not
    // run in this test environment (no Python interpreter, no GPU), and they
    // have no unsupplied variable (every input is a parameter).
    const json = [
      'Block',
      ['Declare', 'a2', 'real'],
      ['Loop', ['Assign', 'a2', 'n'], ['Element', 'k', ['Range', 1, 3]]],
      ['If', ['Less', 'a2', 'm'], 1, 2],
    ];
    const ce = fresh();
    expect(compile(ce.box(json as never), { fallback: false }).code).toContain(
      'a2 !== undefined'
    );
    expect(both(json, { n: 1, m: 5 })).toEqual({
      compiled: 1,
      interpreted: 1,
    });
    for (const to of ['python', 'glsl', 'wgsl']) {
      const r = compile(ce.box(json as never), { to, fallback: false });
      expect(r.success).toBe(true);
      expect(r.code).not.toContain('!== undefined');
    }
  });

  test('a condition on a block local compares first, then tests', () => {
    // A comparison of a block local tests every caller input of the block
    // (user decision 2026-10-30), but in a branch condition it compares
    // first: `a < 1` is `true` with `a := 0`, so the branch is taken, as
    // in the interpreter, and `a` is then `n`, with no value.
    const branch = [
      'Block',
      ['Assign', 'a', 0],
      ['If', ['Less', 'a', 1], ['Assign', 'a', 'n']],
      'a',
    ];
    noValue(branch, {});
    expect(both(branch, { n: 2 })).toEqual({ compiled: 2, interpreted: 2 });
    // A `true` needs no test.
    expect(
      both(
        ['Block', ['Assign', 'a', 'n'], ['Assign', 'a', 0], ['Less', 'a', 1]],
        {}
      )
    ).toEqual({ compiled: true, interpreted: 'True' });
    // An assignment in one branch.
    const joined = [
      'Block',
      ['Assign', 'a', 0],
      ['If', ['Greater', 'x', 0], ['Assign', 'a', ['Add', 'n', 1]]],
      ['Less', 'a', 1],
    ];
    expect(both(joined, { x: -1 })).toEqual({
      compiled: true,
      interpreted: 'True',
    });
    noValue(joined, { x: 1 });
    // The same for the arms of a `Which`.
    const which = [
      'Block',
      ['Assign', 'a', 0],
      [
        'Which',
        ['Greater', 'x', 0],
        ['Assign', 'a', 'n'],
        'True',
        ['Assign', 'a', 1],
      ],
      ['Less', 'a', 5],
    ];
    expect(both(which, { x: -1 })).toEqual({
      compiled: true,
      interpreted: 'True',
    });
    noValue(which, { x: 1 });
    // A local read through another local.
    noValue(
      [
        'Block',
        ['Assign', 'b', 'n'],
        ['Assign', 'a', 'b'],
        ['Assign', 'b', 0],
        ['Less', 'a', 1],
      ],
      {}
    );
    expect(
      both(
        [
          'Block',
          ['Assign', 'b', 0],
          ['Assign', 'a', 'b'],
          ['Assign', 'b', 'n'],
          ['Less', 'a', 1],
        ],
        {}
      )
    ).toEqual({ compiled: true, interpreted: 'True' });
    // In a loop: the first iteration takes the first branch (`0 < 1`);
    // in the second, `a` is `n + 1` with no value. The value of `b`
    // depends on the branch taken.
    const loop = [
      'Block',
      ['Assign', 'a', 0],
      ['Assign', 'b', 0],
      [
        'Loop',
        [
          'Block',
          ['If', ['Less', 'a', 1], ['Assign', 'b', 1], ['Assign', 'b', 2]],
          ['Assign', 'a', ['Add', 'n', 1]],
        ],
        ['Element', 'k', ['Range', 1, 2]],
      ],
      'b',
    ];
    // In the second iteration `a` is NaN, and the test of the inputs of the
    // block fails while the comparison reads no other variable: the
    // interpreter may have a value there (it has, 1), so the whole run
    // gives no value (`poisonSlot`), never the else branch's 2.
    const looped = both(loop, {});
    expect(looped.interpreted).toBe(1);
    expect(looped.compiled).toBeNaN();
    expect(both(loop, { n: 5 })).toEqual({ compiled: 2, interpreted: 2 });
    // Too strict, which is accepted (user decision 2026-10-30): with `x =
    // -1`, `a` is 5, and the interpreter gives `False`, but the comparison
    // tests every caller input of the block, `n` too.
    const strict = [
      'Block',
      ['Assign', 'a', 5],
      ['If', ['Greater', 'x', 0], ['Assign', 'a', ['Add', 'n', 1]]],
      ['Less', 'a', 1],
    ];
    const r = both(strict, { x: -1 });
    expect(r.interpreted).toBe('False');
    expect(r.compiled).toBeUndefined();
    expect(both(strict, { x: -1, n: 0 })).toEqual({
      compiled: false,
      interpreted: 'False',
    });
  });

  test('a condition that only the strict test leaves undecided', () => {
    // `a` is 5 at `x = -1`, and the interpreter takes the second branch.
    // The test of every input of the block (`n`) fails, while the
    // comparison itself reads no other variable: the whole run gives no
    // value, not the definite 0 of taking no branch.
    const json = [
      'Block',
      ['Assign', 'a', 5],
      ['If', ['Greater', 'x', 0], ['Assign', 'a', ['Add', 'n', 1]]],
      ['Assign', 'b', 0],
      ['If', ['Less', 'a', 1], ['Assign', 'b', 1], ['Assign', 'b', 2]],
      'b',
    ];
    const absent = both(json, { x: -1 });
    expect(absent.interpreted).toBe(2);
    expect(absent.compiled).toBeNaN();
    expect(both(json, { x: -1, n: 3 })).toEqual({
      compiled: 2,
      interpreted: 2,
    });
    expect(both(json, { x: 1, n: -5 })).toEqual({
      compiled: 1,
      interpreted: 1,
    });
    // The marker reaches the top of the run, through any block: the run
    // gives no value (a later statement, here `Add(r, 10)` or an outer
    // write, cannot give a value that the interpreter does not give).
    const inner = ['Block', ['Assign', 'r', json], ['Add', 'r', 10]];
    expect(both(inner, { x: -1 }).compiled).toBeNaN();
    const outer = [
      'Block',
      ['Assign', 'a', 5],
      ['If', ['Greater', 'x', 0], ['Assign', 'a', ['Add', 'n', 1]]],
      [
        'Assign',
        'r',
        [
          'Block',
          ['Assign', 'b', 0],
          ['If', ['Less', 'a', 1], ['Assign', 'b', 1], ['Assign', 'b', 2]],
          'b',
        ],
      ],
      ['Add', 'r', 10],
    ];
    const r = both(outer, { x: -1 });
    expect(r.interpreted).toBe(12);
    expect(r.compiled).toBeNaN();
    expect(both(outer, { x: -1, n: 0 })).toEqual({
      compiled: 12,
      interpreted: 12,
    });
    // Where the comparison's own read is absent, the interpreter has no
    // value for it either: no branch is taken, as before, and the block
    // goes on (`b` keeps 0).
    const own = [
      'Block',
      ['Assign', 'a', 0],
      ['Assign', 'b', 0],
      ['If', ['Less', 'a', 'm'], ['Assign', 'b', 1], ['Assign', 'b', 2]],
      'b',
    ];
    expect(both(own, {})).toEqual({ compiled: 0, interpreted: 0 });
    // A later write to an outer local does not survive the marker: the
    // run gives no value (the interpreter gives 9).
    const later = [
      'Block',
      ['Assign', 'c', 0],
      [
        'Assign',
        't',
        [
          'Block',
          ['Assign', 'a', 5],
          ['If', ['Greater', 'x', 0], ['Assign', 'a', ['Add', 'n', 1]]],
          ['If', ['Less', 'a', 1], ['Assign', 'b', 1], ['Assign', 'b', 2]],
          ['Assign', 'c', 9],
          'b',
        ],
      ],
      'c',
    ];
    const lost = both(later, { x: -1 });
    expect(lost.interpreted).toBe(9);
    expect(lost.compiled).toBeNaN();
    expect(both(later, { x: -1, n: 0 })).toEqual({
      compiled: 9,
      interpreted: 9,
    });
    // A function literal whose run result has a type that could hold a
    // function (here `unknown`) declines: the function could escape the
    // run. The interpreter then evaluates it.
    const call = [
      'Block',
      ['Assign', 'a', ['Add', 'n', 1]],
      ['Assign', 'f', ['Function', ['If', ['Less', 'a', 't'], 1, 2], 't']],
      ['f', 3],
    ];
    expect(() =>
      compile(fresh().box(call as never), { fallback: false })
    ).toThrow(/the function could run after the run has returned/);
    const fallback = compile(fresh().box(call as never));
    expect(fallback.success).toBe(false);
    expect(fallback.run!({ n: 1 } as never)).toBe(1);
    // A function literal that the run returns could run after the run: it
    // declines.
    expect(() =>
      compile(
        fresh().box([
          'Block',
          ['Assign', 'a', 5],
          ['If', ['Greater', 'x', 0], ['Assign', 'a', ['Add', 'n', 1]]],
          ['Assign', 'g', ['Function', ['If', ['Less', 'a', 't'], 1, 2], 't']],
          'g',
        ] as never),
        { fallback: false }
      )
    ).toThrow(/the function could run after the run has returned/);
  });

  test('the fixes of review round 3', () => {
    const strict = (last: unknown) => [
      'Block',
      ['Assign', 'a', 5],
      ['If', ['Greater', 'x', 0], ['Assign', 'a', ['Add', 'n', 1]]],
      ['Assign', 'b', 0],
      ['If', ['Less', 'a', 1], ['Assign', 'b', 1], ['Assign', 'b', 2]],
      last,
    ];
    // An effect after the condition must still happen (the interpreter
    // draws once): the run would skip it, so the compile declines.
    expect(() =>
      compile(fresh().box(strict(['Random']) as never), { fallback: false })
    ).toThrow(/an effect that must still happen/);
    // A function in a collection built from another could escape the run.
    const escaping = [
      'Block',
      ['Assign', 'a', 5],
      ['If', ['Greater', 'x', 0], ['Assign', 'a', ['Add', 'n', 1]]],
      ['Assign', 'g', ['Function', ['If', ['Less', 'a', 't'], 1, 2], 't']],
      ['Reverse', ['List', 'g']],
    ];
    expect(() =>
      compile(fresh().box(escaping as never), { fallback: false })
    ).toThrow(/the function could run after the run has returned/);
    // With no effect and no function, the run gives no value, as before.
    const absent = both(strict('b'), { x: -1 });
    expect(absent.interpreted).toBe(2);
    expect(absent.compiled).toBeNaN();
  });

  test('the fixes of review round 2', () => {
    // `Coalesce` discharges an absent value: its fallback is not guarded
    // as an absent collection.
    const ce = fresh();
    ce.declare('k', 'integer');
    const coalesce = compile(
      ce.box(['Coalesce', ['List', 1], ['Take', 'L', 'k']] as never),
      { fallback: false }
    );
    expect(coalesce.run!({ L: [1, 2] } as never)).toEqual([1]);
    // A dependent local of an enclosing block brings the inputs of that
    // block into a nested block.
    const nested = [
      'Block',
      ['Assign', 'a', ['Add', 'n', 1]],
      ['Block', ['Assign', 'b', 'a'], ['Less', 'b', 1]],
    ];
    noValue(nested, {});
    expect(both(nested, { n: -5 })).toEqual({
      compiled: true,
      interpreted: 'True',
    });
    // A block with an early `Return` is not read through its last
    // statement.
    const withReturn = fresh();
    withReturn.declare('f', 'function');
    withReturn.assign(
      'f',
      withReturn.box(['Function', ['Block', ['Return', 'n'], 1], 't'] as never)
    );
    const r = compile(withReturn.box(['Greater', ['f', 1], 0] as never), {
      fallback: false,
    });
    expect(r.run!({})).toBeUndefined();
    expect(r.run!({ n: 2 })).toBe(true);
  });

  test('a local that no input can reach compares as it is', () => {
    // A loop counter, a constant, a destructured constant, and a chain of
    // locals through a block-local function over a constant: none can
    // depend on `x`, so their comparisons test nothing, and the block keeps
    // its value while `x` is absent.
    const counter = [
      'Block',
      ['Declare', 'k', { str: 'unknown' }, 0],
      [
        'Loop',
        [
          'Block',
          ['Assign', 'k', ['Add', 'k', 1]],
          ['If', ['Greater', 'x', 0], ['Break']],
          ['If', ['GreaterEqual', 'k', 5], ['Break']],
        ],
      ],
      'k',
    ];
    expect(both(counter, {})).toEqual({ compiled: 5, interpreted: 5 });
    const sum = [
      'Block',
      ['Assign', 's', 0],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', 'k']],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      ['If', ['Less', 's', 10], ['Assign', 'q', 1], ['Assign', 'q', 2]],
      ['Add', 'q', ['Boole', ['Greater', 'x', 0]]],
    ];
    expect(both(sum, { x: 1 })).toEqual({ compiled: 2, interpreted: 2 });
    const pair = [
      'Block',
      ['Assign', ['Tuple', 'p', 'r'], ['Tuple', 1, 2]],
      ['If', ['Less', 'p', 'r'], ['Assign', 'q', 1], ['Assign', 'q', 2]],
      ['Add', 'q', 'x'],
    ];
    expect(both(pair, { x: 1 })).toEqual({ compiled: 2, interpreted: 2 });
    const chain = (c: unknown) => [
      'Block',
      ['Assign', 'c', c],
      ['Assign', 'gg', ['Function', ['Add', 't', 'c'], 't']],
      ['Assign', 'd', ['gg', 2]],
      ['Assign', 'w', 'd'],
      ['If', ['Less', 'w', 100], ['Assign', 'q', 1], ['Assign', 'q', 2]],
      ['Add', 'q', 'x'],
    ];
    const plain = compile(fresh().box(chain(3) as never), {
      fallback: false,
    }).code;
    expect(plain).not.toContain('throw');
    expect(both(chain(3), { x: 1 })).toEqual({ compiled: 2, interpreted: 2 });
    // The flag is SET through the chain: `w` reads `d`, which calls `gg`,
    // whose body reads `c`, which reads `n`.
    const dependent = compile(fresh().box(chain(['Add', 'n', 1]) as never), {
      fallback: false,
    }).code;
    expect(dependent).toContain('_.n !== undefined');
    noValue(chain(['Add', 'n', 1]), { x: 1 }, undefined, NaN);
    expect(both(chain(['Add', 'n', 1]), { x: 1, n: 1 })).toEqual({
      compiled: 2,
      interpreted: 2,
    });
    // A draw has effects: a local that holds one counts as dependent, so
    // its comparison tests `x`. The run has an effect, which the marker of
    // a failed test would skip, so the compile declines.
    expect(() =>
      compile(
        fresh().box([
          'Block',
          ['Assign', 'r', ['Random']],
          ['If', ['Less', 'r', 2], ['Assign', 'q', 1], ['Assign', 'q', 2]],
          ['Add', 'q', 'x'],
        ] as never),
        { fallback: false }
      )
    ).toThrow(/an effect that must still happen/);
  });

  test('a block that needs no marker is emitted as before', () => {
    // Every input of the block is a read of the comparison itself, so a
    // failed test is a failed read: no marker object, no `try`.
    const ce = fresh();
    for (const json of [
      [
        'Block',
        ['Assign', 'a', 0],
        ['If', ['Less', 'a', 'm'], ['Assign', 'b', 1], ['Assign', 'b', 2]],
        'b',
      ],
      ['Block', ['Assign', 'a', ['Add', 'n', 1]], ['Less', 'a', 'm']],
      ['If', ['Less', 'x', 1], 1, 2],
    ]) {
      const code = compile(ce.box(json as never), { fallback: false }).code;
      expect(code).not.toContain('throw');
      expect(code).not.toContain('try');
    }
  });

  test('a condition with effects is evaluated before it is tested', () => {
    // `Block(a := n, 1) > 0` is `True` in the interpreter with `n` absent,
    // and it assigns `a`. The value of the block operand is its last
    // statement, which reads no input.
    const json = [
      'Block',
      ['Assign', 'a', 0],
      ['Assign', 'b', 0],
      [
        'If',
        ['Greater', ['Block', ['Assign', 'a', 'n'], 1], 0],
        ['Assign', 'b', 1],
        ['Assign', 'b', 2],
      ],
      'b',
    ];
    expect(both(json, {})).toEqual({ compiled: 1, interpreted: 1 });
    // The read of `a` after the `If` has no value.
    const after = [
      'Block',
      ['Assign', 'a', 0],
      [
        'If',
        ['Greater', ['Block', ['Assign', 'a', 'n'], 1], 0],
        ['Assign', 'b', 1],
        ['Assign', 'b', 2],
      ],
      ['Less', 'a', 1],
    ];
    noValue(after, {});
  });

  test('a variable outside the block that the block assigns', () => {
    // `c` is declared in the engine, so `c := n + 1` writes `_.c`: after
    // the write, `_.c` is present while `n` has none.
    const withC = (): ComputeEngine => {
      const ce = fresh();
      ce.declare('c', 'number');
      return ce;
    };
    const outer = [
      'Block',
      ['Assign', 'c', ['Add', 'n', 1]],
      ['Less', ['Add', 'c', 1], 'm'],
    ];
    noValue(outer, { m: 5 }, withC());
    expect(both(outer, { n: 1, m: 5 }, withC())).toEqual({
      compiled: true,
      interpreted: 'True',
    });
    // A function declared in the engine and assigned in the block: its
    // call compiles to the run-time dispatch, which tests the inputs of the
    // body.
    const withG = (): ComputeEngine => {
      const ce = fresh();
      ce.declare('gg', 'function');
      return ce;
    };
    const call = [
      'Block',
      ['Assign', 'c', ['Add', 'n', 1]],
      ['Assign', 'gg', ['Function', ['Add', 't', 'c'], 't']],
      ['Less', ['gg', 1], 'm'],
    ];
    noValue(call, { m: 5 }, withG());
    expect(both(call, { n: 1, m: 5 }, withG())).toEqual({
      compiled: true,
      interpreted: 'True',
    });
  });
});

describe('a chain with an operand with effects after an undecided pair', () => {
  test('evaluates the later operands and keeps the draw count', () => {
    // `Less(x, 1, Random())` with `x` absent: the first pair has no value,
    // the interpreter goes on, draws once, and `1 < Random()` is `False`.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const json = ['Less', 'x', 1, ['Random']];
    const r = compile(ce.box(json as never), { fallback: false });
    expect(r.run!({})).toBe(false);
    expect(ce.box(json as never).evaluate().json).toBe('False');
    // The draw count, through the seeded stream: the following `Random()`
    // reads the same draw in both engines. A `Tuple` keeps the order of
    // evaluation (`Add` would sort its operands).
    const probe = [
      'Tuple',
      ['Boole', ['Less', 'x', 0.5, ['Random'], 0.9]],
      ['Random'],
    ];
    const p = compile(ce.box(probe as never), {
      fallback: false,
      constantFold: false,
    });
    for (const vars of [{}, { x: 5 }, { x: 0 }] as Record<string, number>[]) {
      const subs: Record<string, Expression> = {};
      for (const [k, v] of Object.entries(vars)) subs[k] = ce.box(v);
      const c = withRandomSeedFrame(ce, 7, () => p.run!(vars)) as number[];
      const i = withRandomSeedFrame(ce, 7, () => {
        const value = ce
          .box(probe as never)
          .subs(subs)
          .evaluate();
        return isFunction(value) ? value.ops.map((e) => e.re) : [];
      });
      expect(c).toEqual(i);
    }
  });
});

describe('the draws of a truth test and of a branch condition', () => {
  /** The draw that follows `json`, compiled and interpreted, from the same
   * seeded stream: equal when both consumed the same number of draws. */
  const nextDraw = (json: unknown, vars: Record<string, number>) => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const probe = ['Tuple', json, ['Random']];
    const p = compile(ce.box(probe as never), {
      fallback: false,
      constantFold: false,
    });
    const compiled = withRandomSeedFrame(
      ce,
      7,
      () => (p.run!(vars) as number[])[1]
    );
    const subs: Record<string, Expression> = {};
    for (const [k, v] of Object.entries(vars)) subs[k] = ce.box(v);
    const interpreted = withRandomSeedFrame(ce, 7, () => {
      const value = ce
        .box(probe as never)
        .subs(subs)
        .evaluate();
      return isFunction(value) ? value.ops[1].re : NaN;
    });
    const first = withRandomSeedFrame(
      ce,
      7,
      () => ce.box(['Random']).evaluate().re
    );
    return { compiled, interpreted, drew: interpreted !== first };
  };

  test('a connective with an operand with effects keeps its draw', () => {
    // `x > 0` has no value at `x` absent, so the interpreter evaluates the
    // second operand, and draws. The `And` is not read for truth only:
    // its plain `&&` would stop at the `false` of `0 < undefined`.
    const json = [
      'Boole',
      ['And', ['Greater', 'x', 0], ['Less', ['Random'], 0.5]],
    ];
    for (const vars of [{}, { x: 1 }, { x: -1 }] as Record<string, number>[]) {
      const r = nextDraw(json, vars);
      expect(r.compiled).toBe(r.interpreted);
      expect(r.drew).toBe(vars.x !== -1);
    }
  });

  test('a chain in a branch condition stops after a pair that is false', () => {
    // As for the bare chain, `5 < 0.5` is `False`, and `Random()` is not
    // evaluated.
    const json = ['If', ['Less', 'x', 0.5, ['Random']], 1, 2];
    for (const vars of [{ x: 5 }, { x: 0 }, {}] as Record<string, number>[]) {
      const r = nextDraw(json, vars);
      expect(r.compiled).toBe(r.interpreted);
      expect(r.drew).toBe(vars.x !== 5);
    }
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    expect(ce.box(json as never).evaluate().json).toBe(2);
    // At `{}`, the first pair has no value and the draw is made. With the
    // same draw, the compiled `If` and the interpreter agree: no arm when
    // `0.5 < Random()` (the chain has no value), the second arm otherwise.
    const fresh = new ComputeEngine();
    fresh.declare('x', 'real');
    const at = compile(fresh.box(json as never), { fallback: false });
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const c = withRandomSeedFrame(fresh, seed, () => at.run!({}));
      const i = withRandomSeedFrame(
        fresh,
        seed,
        () => fresh.box(json as never).evaluate().json
      );
      if (i === 2) expect(c).toBe(2);
      else {
        expect(typeof i).not.toBe('number');
        expect(c).toBeNaN();
      }
    }
  });

  test('a branch condition that is a chain with effects selects by value', () => {
    // `Less(x, 0.5, Block(c := c + 1, 1))` at `{}`: the first pair has no
    // value, so the block runs, and the chain has no value. The `If` takes
    // no arm; the plain truth test took the second.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('c', 'real');
    const json = [
      'If',
      ['Less', 'x', 0.5, ['Block', ['Assign', 'c', ['Add', 'c', 1]], 1]],
      1,
      2,
    ];
    const r = compile(ce.box(json as never), { fallback: false });
    expect(r.run!({})).toBeNaN();
    expect(r.run!({ x: 0, c: 0 })).toBe(1);
    expect(r.run!({ x: 5, c: 0 })).toBe(2);
    expect(ce.box(json as never).evaluate().json).not.toBe(2);
    ce.assign('x', 0);
    ce.assign('c', 0);
    expect(ce.box(json as never).evaluate().json).toBe(1);
  });
});

describe('broadcastAsync() scans a boolean column in each inline slice', () => {
  const ce = new ComputeEngine();
  ce.declare('c', 'boolean');
  ce.declare('x', 'real');
  const r = compile(ce.box(['If', 'c', ['Add', 'x', 1], 0]));
  const only = compile(ce.box(['If', 'c', 1, 0]));

  test('an element changed while the batch yields is refused', async () => {
    const c: unknown[] = [true, false, true];
    const x = new Float64Array([1, 2, 3]);
    // The batch yields before its first slice: the change below happens
    // after the count scanned the column.
    const pending = r.broadcastAsync!({ x, c: c as boolean[] });
    c[1] = 5;
    await expect(pending).rejects.toThrow(/a plain array/);
    c[1] = false;
    const ok = await r.broadcastAsync!({ x, c: c as boolean[] });
    expect(Array.from(ok.out)).toEqual([2, 0, 4]);
  });

  test('a column shortened while the batch yields is refused', async () => {
    const c = [true, false, true];
    const pending = only.broadcastAsync!({ c });
    c.length = 2;
    await expect(pending).rejects.toThrow(/changed length during the batch/);
    // With a numeric column of the original length, the slice finds the
    // boolean column shorter than the first array.
    const x = new Float64Array([1, 2, 3]);
    const d = [true, false, true];
    const other = r.broadcastAsync!({ x, c: d });
    d.length = 2;
    await expect(other).rejects.toThrow(
      /the array for "c" holds 2 cells, the first array 3/
    );
  });
});
