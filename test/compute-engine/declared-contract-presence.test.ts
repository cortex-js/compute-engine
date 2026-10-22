import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A declared type is a contract on EVERY value the symbol takes (user
// decisions P1 and P1b of
// `docs/plans/2026-10-21-presence-contracts-and-assertion.md`, 2026-10-21).
// `s: string` refuses `Missing` and `Undefined` as it refuses `5`; a declared
// element contract (`list<string>`) refuses a value with an absent cell. An
// author who wants absence writes it (`string | missing`), or uses a
// refining declaration (`list`, `list<unknown>`). A numeric declaration
// still admits `NaN`, the numeric absence marker. The Epsil static check,
// the Epsil runtime and the engine's assignment route agree.
//
// This reverses the rule of 2026-09-09 ("assignment admits `missing` into a
// declared type"), recorded in `docs/ERROR-MODEL.md`.
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
  test('a declared `string` refuses the absence symbols', () => {
    ce.declare('s', 'string');
    expect(() => ce.assign('s', ce.Missing)).toThrow(
      /not compatible with the type "string"/
    );
    expect(() => ce.assign('s', ce.box('Undefined'))).toThrow(
      /not compatible with the type "string"/
    );
    // The refusal leaves the symbol valueless.
    expect(ce.box('s').evaluate().symbol).toBe('s');
  });

  test('a declaration that admits absence takes the symbol', () => {
    ce.declare('om', 'string | missing');
    ce.assign('om', ce.Missing);
    expect(ce.box('om').evaluate().symbol).toBe('Missing');
    ce.declare('a', 'any');
    ce.assign('a', ce.Missing);
    expect(ce.box('a').evaluate().symbol).toBe('Missing');
  });

  test('an undeclared symbol takes the absent value and infers from it', () => {
    ce.assign('u', ce.Missing);
    expect(ce.box('u').evaluate().symbol).toBe('Missing');
  });

  test('a restricted non-numeric value needs a declaration that admits absence', () => {
    ce.declare('p', 'tuple<number, number>');
    const gated = ce.parse('(1,2) \\{ a > 0 \\}');
    expect(gated.type.toString()).toBe('missing | tuple<integer, integer>');
    expect(() => ce.assign('p', gated)).toThrow(/not compatible/);
    ce.declare('pm', 'tuple<number, number> | missing');
    ce.assign('pm', gated);
    expect(ce.box('pm').evaluate().toString()).toBe('(1, 2) {0 < a}');
  });

  test('a numeric restriction masks to NaN and binds to a numeric declaration', () => {
    ce.declare('n', 'number');
    const gated = ce.parse('3 \\{ a > 0 \\}');
    expect(gated.type.toString()).toBe('integer | nan');
    ce.assign('n', gated);
    expect(ce.box('n').evaluate().toString()).toBe('3 {0 < a}');
  });

  test('a declared element contract is checked (P1b)', () => {
    ce.declare('xs', 'list<string>');
    expect(() => ce.assign('xs', ce.box(['List', "'a'", 'Missing']))).toThrow(
      /list<missing \| string>.*not compatible with the type "list<string>"/
    );
    expect(() => ce.assign('xs', ce.Missing)).toThrow(/not compatible/);
    ce.declare('xm', 'list<string | missing>');
    ce.assign('xm', ce.box(['List', "'a'", 'Missing']));
    expect(ce.box('xm').evaluate().toString()).toBe('["a","Missing"]');
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
  test('`let s: string = Missing` is reported and refused', () => {
    const r = run('let s: string = Missing\ns');
    expect(r.diagnostics.some((d) => d.startsWith('static-type-error'))).toBe(
      true
    );
    expect(r.diagnostics.some((d) => d.startsWith('runtime-error'))).toBe(
      true
    );
  });

  test('a later `s := Missing` is refused at run time', () => {
    const r = run('let s: string = "a"\ns := Missing\ns');
    expect(r.diagnostics.join(' ')).toContain('incompatible-type');
    expect(r.value).toBe('"a"');
  });

  test('a list literal with an absent cell is reported and refused', () => {
    const r = run('let xs: list<string> = ["a", Missing]\nxs');
    expect(r.diagnostics.join(' ')).toContain('list<missing | string>');
    expect(run('let xs: list<string | missing> = ["a", Missing]\nxs')).toEqual(
      { value: '["a","Missing"]', diagnostics: [] }
    );
  });

  test('a possibly absent initializer at a strict declaration is reported, and its discharges are not', () => {
    const base = 'let xs: list<string> = ["a"]\nlet i: integer = 1\n';
    const r = run(`${base}let y: string = xs[i]\ny`);
    expect(r.diagnostics.join(' ')).toContain('may be absent');
    expect(r.diagnostics.join(' ')).toContain('xs[i]?!');
    expect(run(`${base}let y: string = xs[i]?!\ny`).diagnostics).toEqual([]);
    expect(run(`${base}let y: string = xs[i] ?? "d"\ny`).diagnostics).toEqual(
      []
    );
    expect(
      run(`${base}let y: string | missing = xs[i]\ny`).diagnostics
    ).toEqual([]);
  });

  test('a numeric declaration admits NaN and a numeric read', () => {
    expect(run('let n: number = NaN\nn')).toEqual({
      value: 'NaN',
      diagnostics: [],
    });
    expect(
      run('let zs: list<number> = [4]\nlet i: integer = 3\nlet n: number = zs[i]\nn')
    ).toEqual({ value: 'NaN', diagnostics: [] });
  });

  test('a numeric declaration refuses a value with a `missing` arm', () => {
    const r = run('let m: number | missing = Missing\nlet n: number = m\nn');
    expect(r.diagnostics.join(' ')).toContain('may be absent');
    expect(r.diagnostics.join(' ')).toContain('m?!');
  });
});
