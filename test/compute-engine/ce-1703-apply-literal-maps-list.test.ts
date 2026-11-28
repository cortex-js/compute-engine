/**
 * CE-1703: a function literal applied in place maps a list at a parameter
 * declared as a scalar, as the call of a name that holds the literal does.
 * The check of the arguments read the signature in which a bare parameter is
 * relaxed to `any`, so it did not see a mapped slot, and it checked the whole
 * list against the declared type.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

const lit = ['Function', ['Add', 'k', 'x'], 'k', ['Typed', 'x', "'real'"]];

describe('a list at a declared scalar parameter of a literal', () => {
  const ce = new ComputeEngine();
  const run = (expr: unknown) =>
    JSON.stringify(ce.box(expr as never).evaluate().json);

  test('the witness: Apply of the literal maps as the named call does', () => {
    ce.assign('kx', lit as never);
    expect(run(['kx', ['List', 1, 2], ['List', 10, 20]])).toBe(
      '["List",11,22]'
    );
    expect(run(['Apply', lit, ['List', 1, 2], ['List', 10, 20]])).toBe(
      '["List",11,22]'
    );
    expect(run(['Apply', lit, 1, ['List', 10, 20]])).toBe('["List",11,21]');
  });

  test('a name declared `function` that holds the literal maps too', () => {
    ce.declare('kf', 'function');
    ce.assign('kf', lit as never);
    expect(run(['kf', ['List', 1, 2], ['List', 10, 20]])).toBe(
      '["List",11,22]'
    );
    expect(run(['kf', 1, ['List', 10, 20]])).toBe('["List",11,21]');
  });

  test('a sibling that binds whole is not part of the map', () => {
    const three = [
      'Function',
      ['Add', ['Length', 'L'], 'k', 'x'],
      'L',
      'k',
      ['Typed', 'x', "'real'"],
    ];
    expect(
      run(['Apply', three, ['List', 1, 2, 6], ['List', 1, 2], ['List', 10, 20]])
    ).toBe('["List",14,25]');
  });

  test('beside a parameter typed by its use as a tuple, the list is refused', () => {
    // `p` binds whole (`tuple<number>`, from `p[1]`), and the application
    // of the literal does not map at `x` (CE-1928): the call is refused
    // when it is boxed, as its value is an error.
    const D = [
      'Function',
      ['Add', ['At', 'p', 1], 'x'],
      'p',
      ['Typed', 'x', "'real'"],
    ];
    const call = ce.box([
      'Apply',
      D,
      ['List', 1, 2],
      ['List', 10, 20],
    ] as never);
    expect(call.isValid).toBe(false);
    expect(JSON.stringify(call.evaluate().json)).toContain(
      "'incompatible-type'"
    );
  });

  test('a partial application maps to a list of functions', () => {
    const three = [
      'Function',
      ['Add', 'k', 'x', 'y'],
      'k',
      ['Typed', 'x', "'real'"],
      'y',
    ];
    const call = ce.box([
      'Apply',
      three,
      ['List', 1, 2],
      ['List', 10, 20],
    ] as never);
    expect(call.isValid).toBe(true);
    const value = call.evaluate().json as unknown[];
    expect(value[0]).toBe('List');
    expect(value.slice(1).map((x) => (x as unknown[])[0])).toEqual([
      'Function',
      'Function',
    ]);
  });

  test('a value that does not fit is still refused', () => {
    expect(run(['Apply', lit, 1, "'abc'"])).toContain("'incompatible-type'");
    // Each element is checked: the string element is the error, the other
    // element is mapped.
    const mixed = run(['Apply', lit, 1, ['List', "'abc'", 2]]);
    expect(mixed).toMatch(/^\["List",\["Error",/);
    expect(mixed).toMatch(/,3\]$/);
    // A list at a parameter declared as a list is not mapped.
    const whole = [
      'Function',
      ['Add', 'k', 'x'],
      ['Typed', 'k', "'list<real>'"],
      ['Typed', 'x', "'real'"],
    ];
    expect(run(['Apply', whole, ['List', 1, 2], ['List', 1, 2]])).toContain(
      "'incompatible-type'"
    );
  });
});

describe('the Epsil static check of the same calls', () => {
  const check = (source: string) => {
    const r = executeEpsil(new ComputeEngine(), source);
    return {
      codes: r.diagnostics.map((d) => d.code),
      value: r.value?.toString(),
    };
  };

  test('a literal applied in place gives no diagnostic', () => {
    expect(check('((k, x: real) => k + x)([1, 2], [10, 20])')).toEqual({
      codes: [],
      value: '[11,22]',
    });
    expect(check('((k, x: real) => k + x)(1, "a")').codes).toEqual([
      'incompatible-type',
    ]);
  });

  test('a `let` that holds the literal gives no diagnostic', () => {
    expect(
      check('let kx = (k, x: real) => k + x\nkx([1, 2], [10, 20])')
    ).toEqual({ codes: [], value: '[11,22]' });
    expect(check('let kx = (k, x: real) => k + x\nkx(1, [10, 20])')).toEqual(
      { codes: [], value: '[11,21]' }
    );
  });
});
