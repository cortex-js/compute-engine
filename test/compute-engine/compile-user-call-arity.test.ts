/**
 * A call of a user function with the wrong number of arguments is refused by
 * every compile target (user decision of 2026-10-17), and the interpreter
 * fallback answers it.
 *
 * With `a := (x, y, z) ↦ x + y + z`, the interpreter answers `a(3, 4)` with a
 * partial application (`(_) => _ + 7`) and `a(1, 2, 3, 4)` with
 * `Error("unexpected-argument", "4")`. The compiled JavaScript call passed
 * `undefined` for the missing argument and computed `NaN`, and ignored the
 * extra argument and computed `6`, both behind `success: true`. The arity is
 * known when the call is compiled, so the call declines.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const TARGETS = ['javascript', 'interval-js', 'glsl'];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('t', 'real');
  ce.parse('a := (x, y, z) \\mapsto x + y + z').evaluate();
  // `r(x, ...q)`: one fixed parameter, then a rest parameter.
  ce.assign(
    'r',
    ce.box(['Function', ['Add', 'x', ['Length', 'q']], 'x', ['Spread', 'q']])
  );
  // A function with no parameter ignores its arguments.
  ce.assign('k', ce.box(['Function', 5]));
  return ce;
}

describe('A user-function call with the wrong number of arguments', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    // The fallback warns; silence it for clean test output.
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  test.each(TARGETS)('too few arguments declines on %s', (to) => {
    const ce = engine();
    const r = compile(ce.parse('a(3, 4)'), { to } as never);
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('outside-profile');
    expect(r.error).toMatch(/a with 2 arguments/);
  });

  test.each(TARGETS)('too many arguments declines on %s', (to) => {
    const ce = engine();
    const r = compile(ce.parse('a(1, 2, 3, 4)'), { to } as never);
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('outside-profile');
    expect(r.error).toMatch(/a with 4 arguments/);
  });

  test('the interpreter answers the declined call', () => {
    const ce = engine();
    expect(ce.parse('a(3, 4)').evaluate().toString()).toBe(
      '(_) => Apply((x, y, z) => x + y + z, 3, 4, _)'
    );
    expect(ce.parse('a(1, 2, 3, 4)').evaluate().toString()).toBe(
      'Error("unexpected-argument", "4")'
    );
    // The JavaScript fallback runs the interpreter: the error value has no
    // number, so the result is `NaN`, not the `6` the compiled call gave.
    const r = compile(ce.parse('a(1, 2, 3, 4)'));
    expect(r.success).toBe(false);
    expect(r.run!({} as never)).toBeNaN();
  });

  test('a call with the declared number of arguments compiles', () => {
    const ce = engine();
    for (const to of ['javascript', 'interval-js', 'glsl']) {
      const r = compile(ce.parse('a(t, 1, 2)'), { to } as never);
      expect(r.success).toBe(true);
    }
    expect(compile(ce.parse('a(t, 1, 2)')).run!({ t: 4 } as never)).toBe(7);
  });

  test('a rest parameter takes any number of arguments after the fixed ones', () => {
    const ce = engine();
    // The rest parameter is a record of the arguments after the fixed ones
    // (CE-1652), which `Length` does not read, so these calls decline for
    // that reason, not for their number of arguments.
    for (const [json, value] of [
      [['r', 't'], 1],
      [['r', 't', 2, 3], 3],
    ] as const) {
      const r = compile(ce.box(json as never));
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/a scalar where a list is required/);
      expect(r.run!({ t: 1 } as never)).toBe(value);
    }
    const none = compile(ce.box(['r'] as never));
    expect(none.success).toBe(false);
    expect(none.error).toMatch(/r with 0 arguments/);
  });
});
