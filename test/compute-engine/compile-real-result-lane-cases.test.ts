import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Cases where a compiled user function with a declared real result left the
 * real lane (ROADMAP CE-230). A function declared `-> real` compiles its body
 * with promotion off (a real ascription): an unknown-sign radical gives `NaN`
 * outside its real domain, as `mode: 'strict'` gives.
 *
 * - CE-230.1: under `mode: 'complex'`, a definition that is emitted (here a
 *   recursive one) declined, because its parameter had no type and the mode
 *   read the body as complex. The definition now takes the declared
 *   parameter types.
 * - CE-230.2: a body that reads an assigned symbol whose value promotes
 *   (`a := √(c − 1)`) declined, because the value compiled with promotion on.
 *   The value now compiles with promotion off for the readers in the body.
 */

function js(ce: ComputeEngine, json: unknown, mode?: string): any {
  return compile(ce.box(json as any), {
    to: 'javascript',
    fallback: false,
    ...(mode ? { mode } : {}),
  } as any);
}

describe('CE-230.1: a recursive real function in the complex mode', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('p', '(real) -> real');
    ce.assign(
      'p',
      ce.box([
        'Function',
        [
          'If',
          ['Less', 'k', 1],
          ['Sqrt', 'k'],
          ['Add', ['p', ['Subtract', 'k', 1]], ['Sqrt', 'k']],
        ],
        'k',
      ])
    );
    return ce;
  }

  for (const mode of ['complex', 'auto', 'strict'])
    test(`${mode}: compiles on the real lane, with the value of the interpreter`, () => {
      const ce = engine();
      const r = js(ce, ['p', 'x'], mode);
      expect(r.success).toBe(true);
      expect(r.promoted).toBe(false);
      const v = r.run({ x: 2.5 });
      expect(typeof v).toBe('number');
      expect(v).toBeCloseTo(ce.box(['p', 2.5]).N().re, 12);
      // Outside the real domain the value is `NaN`.
      expect(Number.isNaN(r.run({ x: -0.5 }))).toBe(true);
    });
});

describe('CE-230.2: a real body that reads a value that promotes', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('c', 'real');
    ce.declare('a', 'number');
    ce.assign('a', ce.box(['Sqrt', ['Subtract', 'c', 1]]));
    ce.declare('p', '(real) -> real');
    ce.assign('p', ce.box(['Function', ['Multiply', 'a', 'y'], 'y']));
    return ce;
  }

  for (const mode of [undefined, 'complex'])
    test(`${mode ?? 'auto'}: the body compiles on the real lane`, () => {
      const ce = engine();
      const r = js(ce, ['p', 'x'], mode);
      expect(r.success).toBe(true);
      expect(r.promoted).toBe(false);
      // c = 5: a = 2, p(3) = 6, as in the interpreter.
      ce.assign('c', 5);
      expect(r.run({ x: 3, c: 5 })).toBeCloseTo(ce.box(['p', 3]).N().re, 12);
      // c = 0: `a` has no real value, and the real result is `NaN`.
      expect(Number.isNaN(r.run({ x: 3, c: 0 }))).toBe(true);
    });

  test('a reader outside the real body keeps the complex value', () => {
    const ce = engine();
    const r = js(ce, ['Add', ['p', 'x'], 'a']);
    expect(r.success).toBe(true);
    // c = 0: `p(2)` is `NaN` (real result), `a` is `i`.
    const v = r.run({ x: 2, c: 0 });
    expect(Number.isNaN(v.re)).toBe(true);
    expect(v.im).toBe(1);
    expect(r.run({ x: 2, c: 5 })).toBe(6);
  });
});
