import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * ROADMAP CE-569: defects of the compiled `If(c, e)`, which selected the
 * value `e` from a condition that was not decided `True`.
 *
 * - JavaScript: a condition read by its value that is not provably boolean
 *   (`b: boolean | real`) must be exactly `true`; a value that is not a
 *   boolean selects nothing and does not raise.
 * - JavaScript: `c = True` for a boolean `c` was always `false`: the
 *   absence guard of the equality tested `typeof c === 'number'`.
 *
 * The host supplies every input with a value of its declared type, so an
 * input left out, and a value outside the declared type (`c = 1` for a
 * `boolean` `c`), are not tested: the result is not specified.
 *
 * The other tests check that the cases the fixes do not change still agree
 * with the interpreter.
 */

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('b', 'boolean | real');
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('z', 'complex');
  ce.declare('c', 'boolean');
  return ce;
}

function js(ce: ComputeEngine, json: unknown) {
  const r = compile(ce.box(json as never), {
    to: 'javascript',
    fallback: false,
  });
  expect(r.success).toBe(true);
  return r;
}

const SAMPLES = [-2, -0.5, 0, 0.25, 1, 3, NaN];

describe('CE-569 — javascript: When over a condition', () => {
  it('When(5, x ≠ 0) has no value', () => {
    const ce = engine();
    const f = js(ce, ['If', ['NotEqual', 'x', 0], 5]);
    expect(f.run!({ x: 1 })).toBe(5);
    expect(f.run!({ x: 0 })).toBeNaN();
  });

  it('When(5, ¬(x > 0)) has no value', () => {
    const ce = engine();
    const f = js(ce, ['If', ['Not', ['Greater', 'x', 0]], 5]);
    expect(f.run!({ x: -1 })).toBe(5);
    expect(f.run!({ x: 1 })).toBeNaN();
  });

  it('When(5, ¬c) has no value', () => {
    const ce = engine();
    const f = js(ce, ['If', ['Not', 'c'], 5]);
    expect(f.run!({ c: false })).toBe(5);
    expect(f.run!({ c: true })).toBeNaN();
  });

  it('When(x, ¬c) selects x only for c = false', () => {
    const ce = engine();
    const f = js(ce, ['If', ['Not', 'c'], 'x']);
    expect(f.run!({ x: 2, c: false })).toBe(2);
    expect(f.run!({ x: 2, c: true })).toBeNaN();
  });

  it('a condition that is not provably boolean declines', () => {
    // `b` is declared `boolean | real`, so it is not provably boolean.
    // The interpreter gives an `Error` for `If(1, 5)`: the condition of an
    // `If` must be a boolean. Compiled code does not test the condition at
    // run time, so the compilation declines
    // (`assertBooleanOrAbsentCondition()`).
    const ce = engine();
    expect(ce.box(['If', 1, 5]).evaluate().operator).toBe('Error');
    expect(() => js(ce, ['If', 'b', 5])).toThrow(
      /the input b of type boolean \| real/
    );
  });

  it('the compiled value agrees with the interpreter', () => {
    const ce = engine();
    for (const json of [
      ['If', ['Greater', 'x', 0], ['Power', 'x', 2]],
      ['If', ['NotEqual', 'x', 0], 5],
      ['If', ['Not', ['Greater', 'x', 0]], 'x'],
    ]) {
      const expr = ce.box(json as never);
      const f = js(ce, json);
      for (const x of SAMPLES) {
        const expected = expr.subs({ x }).N();
        const actual = f.run!({ x }) as number;
        if (expected.isNaN === true) expect(actual).toBeNaN();
        else expect(actual).toBeCloseTo(expected.re, 12);
      }
    }
  });
});

describe('CE-569 — javascript: an operand that is not a bare numeric read', () => {

  it('a draw in the condition: When counts the draws as If does', () => {
    // Each draws once.
    const ce = engine();
    const draws = (json: unknown, input: Record<string, number>): number => {
      const f = js(ce, json);
      const random = Math.random;
      let n = 0;
      Math.random = () => {
        n += 1;
        return random();
      };
      try {
        f.run!(input);
      } finally {
        Math.random = random;
      }
      return n;
    };
    const w = ['If', ['Less', ['Random'], 'x'], 5];
    const i = ['If', ['Less', ['Random'], 'x'], 5, -1];
    expect(draws(w, { x: 2 })).toBe(1);
    expect(draws(i, { x: 2 })).toBe(1);
  });
});

describe('CE-569 — the cases the fixes do not change', () => {

  it('a point value: the interpreter and javascript give the NaN point', () => {
    const ce = engine();
    const expr = ce.box(['If', ['Greater', 'x', 0], ['Tuple', 'x', 'y']]);
    expect(expr.subs({ x: 1, y: 2 }).evaluate().toString()).toBe('(1, 2)');
    expect(expr.subs({ x: -1, y: 2 }).evaluate().toString()).toBe(
      '(NaN, NaN)'
    );
    const f = compile(expr, { to: 'javascript', fallback: false });
    expect(f.run!({ x: 1, y: 2 })).toEqual([1, 2]);
    expect(f.run!({ x: -1, y: 2 })).toEqual([NaN, NaN]);
  });

  // Where the interpreter gives `Nothing`, compiled code may give `NaN` or
  // `undefined` (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code").
  it('a complex value: the kept value', () => {
    const ce = engine();
    const f = js(ce, ['If', ['Greater', 'x', 0], ['Multiply', 'z', 'x']]);
    const kept = f.run!({ x: 2, z: { re: 1, im: 2 } }) as {
      re: number;
      im: number;
    };
    expect(kept).toEqual({ re: 2, im: 4 });
  });

  it('a Sum of When agrees with the interpreter', () => {
    const ce = engine();
    const expr = ce.box([
      'Sum',
      ['If', ['Greater', 'k', 'x'], 'k'],
      ['Limits', 'k', 1, 5],
    ]);
    const f = compile(expr, { to: 'javascript', fallback: false });
    for (const x of [-1, 0.5, 3]) {
      const expected = expr.subs({ x }).N();
      const actual = f.run!({ x }) as number;
      if (expected.isNaN === true) expect(actual).toBeNaN();
      else expect(actual).toBeCloseTo(expected.re, 12);
    }
  });
});
