import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A declared type is a contract on the PRESENT values the symbol takes.
// `Missing` is a result only (user decision of 2026-11-02,
// `docs/ERROR-MODEL.md`): a declared type cannot name `missing`, and a store
// into a declared name accepts a value that holds the marker where the
// declared type accepts a present value. So `s: string` accepts `Missing`
// and refuses `5`; `list<string>` accepts `["a", Missing]`. A `number`
// declaration admits `NaN`; `real`, `integer` and `complex` hold finite
// values only and refuse it (write `real | nan`). The Epsil static check,
// the Epsil runtime and the engine's assignment route agree.
//
// This replaces the rule of 2026-10-21 (a declared type refuses `Missing`,
// decisions P1 and P1b of
// `docs/plans/2026-10-21-presence-contracts-and-assertion.md`).
//

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

function run(source: string): { value: string; diagnostics: string[] } {
  const r = executeEpsil(new ComputeEngine(), source);
  return {
    value: r.value.toString(),
    diagnostics: r.diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message.join(' ') : String(d.message)
    ),
  };
}

describe('the engine assignment route', () => {
  test('a declared `string` accepts Missing and refuses a number', () => {
    ce.declare('s', 'string');
    expect(() => ce.assign('s', ce.number(5))).toThrow(
      /not compatible with the type "string"/
    );
    // The refusal leaves the symbol valueless.
    expect(ce.box('s').evaluate().symbol).toBe('s');
    ce.assign('s', ce.Missing);
    expect(ce.box('s').evaluate().symbol).toBe('Missing');
  });

  test('a declaration cannot name missing', () => {
    expect(() => ce.declare('om', 'string | missing')).toThrow(
      /cannot be declared/
    );
    ce.declare('a', 'any');
    ce.assign('a', ce.Missing);
    expect(ce.box('a').evaluate().symbol).toBe('Missing');
  });

  test('an undeclared symbol takes the absent value and infers from it', () => {
    ce.assign('u', ce.Missing);
    expect(ce.box('u').evaluate().symbol).toBe('Missing');
  });

  // A restriction `If(c, e)` has the type of `e`: the absent value it takes
  // when `c` fails is outside the declared type, as `NaN` is outside `real`
  // (docs/plans/2026-11-02-language-axes-options.md, page 1, "Typing"). So a
  // restricted point binds to a declaration of the point type.
  test('a restricted non-numeric value has the type of its value and binds to its declaration', () => {
    ce.declare('p', 'tuple<number, number>');
    const gated = ce.parse('(1,2) \\{ a > 0 \\}');
    expect(gated.type.toString()).toBe('tuple<integer, integer>');
    ce.assign('p', gated);
    expect(ce.box('p').evaluate().toString()).toBe('If(0 < a, (1, 2))');
    // The value when the condition fails is the absent value. For a point,
    // the absent value is the `NaN` point `(NaN, NaN)`, which the readers of
    // a point read as absent; a restriction of a string or a list gives
    // `Missing`.
    ce.assign('a', -1);
    expect(gated.evaluate().toString()).toBe('(NaN, NaN)');
  });

  test('a numeric restriction has the type of its value and binds to a numeric declaration', () => {
    ce.declare('n', 'number');
    const gated = ce.parse('3 \\{ a > 0 \\}');
    // The static type of a restriction has no `nan` arm.
    expect(gated.type.toString()).toBe('integer');
    ce.assign('n', gated);
    expect(ce.box('n').evaluate().toString()).toBe('If(0 < a, 3)');
    // The value when the condition fails is NaN.
    ce.assign('a', -1);
    expect(gated.evaluate().toString()).toBe('NaN');
  });

  test('a declared element contract accepts an absent cell', () => {
    ce.declare('xs', 'list<string>');
    ce.assign('xs', ce.box(['List', "'a'", 'Missing']));
    expect(ce.box('xs').evaluate().toString()).toBe('["a","Missing"]');
    expect(() =>
      ce.assign('xs', ce.box(['List', "'a'", 5]))
    ).toThrow(/not compatible/);
    expect(() => ce.declare('xm', 'list<string | missing>')).toThrow(
      /cannot be declared/
    );
  });

  test('a refining declaration keeps refining', () => {
    ce.declare('ys', 'list');
    ce.assign('ys', ce.box(['List', "'a'", 'Missing']));
    expect(ce.box('ys').type.toString()).toBe('list<missing | string>');
  });

  test('a declared function signature refuses the marker too', () => {
    ce.declare('fn', '(number) -> number');
    expect(() => ce.assign('fn', ce.Missing)).toThrow(/not compatible/);
  });
});

describe('the Epsil routes', () => {
  test('`let s: string = Missing` is accepted', () => {
    expect(run('let s: string = Missing\ns')).toEqual({
      value: '"Missing"',
      diagnostics: [],
    });
  });

  test('a later `s := Missing` is accepted', () => {
    expect(run('let s: string = "a"\ns := Missing\ns')).toEqual({
      value: '"Missing"',
      diagnostics: [],
    });
  });

  test('a list literal with an absent cell is accepted', () => {
    expect(run('let xs: list<string> = ["a", Missing]\nxs')).toEqual({
      value: '["a","Missing"]',
      diagnostics: [],
    });
    expect(
      run('let xs: list<string | missing> = ["a", Missing]\nxs')
        .diagnostics.join(' ')
    ).toContain('type-annotation-error');
  });

  test('a possibly absent initializer at a declaration is not reported', () => {
    const base = 'let xs: list<string> = ["a"]\nlet i: integer = 1\n';
    expect(run(`${base}let y: string = xs[i]\ny`)).toEqual({
      value: '"a"',
      diagnostics: [],
    });
    expect(run(`${base}let y: string = xs[i]?!\ny`).diagnostics).toEqual([]);
    expect(run(`${base}let y: string = xs[i] ?? "d"\ny`).diagnostics).toEqual(
      []
    );
  });

  test('a `number` declaration admits NaN and a numeric read', () => {
    expect(run('let n: number = NaN\nn')).toEqual({
      value: 'NaN',
      diagnostics: [],
    });
    expect(
      run('let zs: list<number> = [4]\nlet i: integer = 3\nlet n: number = zs[i]\nn')
    ).toEqual({ value: 'NaN', diagnostics: [] });
  });

  test('a `real` or `integer` declaration refuses NaN', () => {
    expect(() => {
      ce.declare('r', 'real');
      ce.assign('r', ce.NaN);
    }).toThrow(/not compatible/);
    ce.declare('rn', 'real | nan');
    ce.assign('rn', ce.NaN);
    expect(ce.box('rn').evaluate().isNaN).toBe(true);

    // A read is typed as its element (`zs[i]` is `real`): the absence
    // marker `NaN` of a read past the end is implicit in its type, so there
    // is no static report. The run time still refuses the `NaN`.
    const r = run(
      'let zs: list<real> = [4.5]\nlet i: integer = 3\nlet r: real = zs[i]\nr'
    );
    expect(r.diagnostics.join('\n')).not.toMatch(/may be `NaN`/);
    expect(r.diagnostics.join('\n')).toMatch(/expected `real`, got `NaN`/);

    // The discharges.
    expect(
      run('let zs: list<real> = [4.5]\nlet i: integer = 3\nlet r: real = zs[i] ?? 0\nr')
    ).toEqual({ value: '0', diagnostics: [] });
    expect(
      run('let zs: list<real> = [4.5]\nlet i: integer = 1\nlet r: real = zs[i]?!\nr')
    ).toEqual({ value: '4.5', diagnostics: [] });

    // A value with another arm outside the declaration overlaps it and is
    // not reported: `a / b` is `infinity | nan | real`.
    expect(
      run('let a: real = 2\nlet b: real = 3\nlet r: real = a / b\nr')
    ).toEqual({ value: '2/3', diagnostics: [] });
  });

  test('a declaration from a read does not hide the later checks of the name', () => {
    // The run time installs the binding when the read is in range, so a
    // later write to the constant and a later use are still checked. The
    // read is typed `real`, so there is no static report on the read.
    const c = run(
      'let zs: list<real> = [4.5]\nlet i: integer = 1\nconst r: real = zs[i]\nr = 3\nr'
    );
    expect(c.diagnostics.join('\n')).not.toMatch(/may be `NaN`/);
    expect(c.diagnostics.join('\n')).toMatch(/constant-assignment/);

    const u = run(
      'let zs: list<real> = [4.5]\nlet i: integer = 1\nlet r: real = zs[i]\nlet s: string = r\ns'
    );
    expect(u.diagnostics.join('\n')).toMatch(
      /static-type-error The value "r" of type "real" is not compatible with the declared type "string"/
    );
  });
});
