import { ComputeEngine } from '../../src/compute-engine';

/**
 * A user-declared symbol whose name is a single uppercase letter must be
 * type-checked at call boundaries exactly like any other name.
 *
 * The `devolveUnappliedOperator` repair (`boxed-expression/validate.ts`) exists
 * for a bare single-uppercase symbol bound to a **standard-library operator**
 * (`N`, `D`) used where a value is required. Its "already shadowed with a
 * value" branch used to accept ANY value definition, so every user-declared
 * `V`/`P`/… that failed a parameter check was silently re-boxed and pushed
 * through as valid — skipping its declared-type check.
 */

const TUPLE3 = 'tuple<number, number, number>';

function declaredNumber(name: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('sx', `(${TUPLE3}) -> unknown` as any);
  ce.declare(name, 'number');
  ce.assign(name, 42);
  return ce;
}

describe('declared single-uppercase symbols are type-checked', () => {
  // `V`/`P` are the reported cases; `Vt`/`pt`/`a` are the controls that
  // always worked.
  for (const name of ['V', 'P', 'Vt', 'pt', 'a']) {
    test(`sx(${name}) with a mismatching declared type errors`, () => {
      const ce = declaredNumber(name);
      const expr = ce.box(['sx', name]);
      expect(JSON.stringify(expr.json)).toContain('incompatible-type');
    });
  }

  test('a matching declared type still passes', () => {
    const ce = new ComputeEngine();
    ce.declare('sx', `(${TUPLE3}) -> unknown` as any);
    ce.declare('V', TUPLE3 as any);
    ce.assign('V', ce.box(['Tuple', 3, 4, 12]));
    expect(JSON.stringify(ce.box(['sx', 'V']).json)).not.toContain('Error');
  });

  test('Distance(V, …) behaves like Distance(pt, …)', () => {
    const make = (name: string) => {
      const ce = new ComputeEngine();
      ce.declare(name, TUPLE3 as any);
      ce.assign(name, ce.box(['Tuple', 3, 4, 12]));
      return ce;
    };
    for (const name of ['V', 'pt']) {
      const ce = make(name);
      expect(
        ce.box(['Distance', name, ['Tuple', 0, 0, 0]]).evaluate().re
      ).toBe(13);
    }

    // …and a mismatching declaration errors for both names alike.
    const bad = (name: string) => {
      const ce = new ComputeEngine();
      ce.declare(name, 'string');
      return JSON.stringify(
        ce.box(['Distance', name, ['Tuple', 0, 0, 0]]).json
      );
    };
    expect(bad('V')).toContain('incompatible-type');
    expect(bad('pt')).toContain('incompatible-type');
  });
});

describe('the standard-library devolve repair is preserved', () => {
  test('bare `N` in value position still devolves', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('N + 1').json).toEqual(['Add', 'N', 1]);
    expect(ce.box('N').type.matches('number')).toBe(true);
  });

  test('repeated occurrences in one expression (the shadow branch)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('N + N').json).toEqual(['Add', 'N', 'N']);
    expect(ce.parse('N, N+1, N+2').json).toEqual([
      'Tuple',
      'N',
      ['Add', 'N', 1],
      ['Add', 'N', 2],
    ]);
  });

  test('`D` devolves at a signature-validated call boundary', () => {
    const ce = new ComputeEngine();
    expect(JSON.stringify(ce.parse('\\frac{S}{D}').json)).not.toContain(
      'Error'
    );
  });
});

describe('undeclared uppercase symbols are unaffected', () => {
  test('a free `A` is still inferred, not rejected', () => {
    const ce = new ComputeEngine();
    expect(JSON.stringify(ce.box(['Add', 'A', 1]).json)).not.toContain(
      'Error'
    );
  });

  test('uppercase booleans keep working', () => {
    const ce = new ComputeEngine();
    expect(JSON.stringify(ce.box(['And', 'A', 'B']).json)).not.toContain(
      'Error'
    );
  });

  test('a user-declared single-uppercase FUNCTION is still not devolved', () => {
    const ce = new ComputeEngine();
    ce.declare('F', '(real) -> real');
    expect(JSON.stringify(ce.box(['Add', 'F', 1]).json)).toContain('Error');
  });
});
