import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';

// Boxing declares no name, so the Epsil
// static check declares the names that a top-level assignment or declaration
// binds, in its own scope, before it pins the signature of a function literal
// (`declareStatementNames()`, src/epsil/static-diagnostics.ts; rule 10 of
// docs/plans/2026-11-09-binding-units-slice-1-spec.md).

function engine(): ComputeEngine {
  return new ComputeEngine();
}

/** `[description, code]` of each static diagnostic of `source`. */
function check(source: string, ce = engine()): [string, string][] {
  const [ast] = parseEpsil(source);
  return staticDiagnostics(ce, ast!, source).map((d) => [
    String(d.message[1]),
    String(d.message[3]),
  ]);
}

describe('BINDING UNITS — names declared by the Epsil static check', () => {
  test('a `let`-bound literal pins its signature', () => {
    expect(check('let k = (n: integer) => n + 1\nk(1.5)')).toEqual([
      ['expected `integer`, got `1.5` at `1.5`', 'incompatible-type'],
    ]);
  });

  test('a `:=`-bound literal pins its signature', () => {
    expect(check('k := (n: integer) => n + 1\nk(1.5)')).toEqual([
      ['expected `integer`, got `1.5` at `1.5`', 'incompatible-type'],
    ]);
  });

  test('a named call to a `:=`-bound literal with a rest parameter', () => {
    const r = executeEpsil(
      engine(),
      'f := (a, ...rest) => Length(rest)\nf(a: 1)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.re).toBe(0);
  });

  test('a destructuring `let` declares each name of its pattern', () => {
    const r = executeEpsil(
      engine(),
      'let (a, b) = (0, 1)\nfor k in 1..3 { a = b }\na'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.re).toBe(1);
  });

  test('a destructuring `let` gives each leaf its type', () => {
    const ce = engine();
    ce.declare('k', '(integer) -> integer');
    expect(check('let (a, b) = (1, "s")\nk(b)', ce)).toEqual([
      [expect.stringContaining('expected `integer`'), 'incompatible-type'],
    ]);
  });
});
