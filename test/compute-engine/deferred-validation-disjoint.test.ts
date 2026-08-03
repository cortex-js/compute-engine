import { ComputeEngine } from '../../src/compute-engine';

/**
 * Applying a symbol declared with an explicit *function type* (a **value**
 * definition, `ce.declare('sx', '(T) -> …')`, as opposed to an operator
 * definition `{ signature: … }`) validates its operands in strict mode
 * (`makeCanonicalFunction`, `boxed-expression/box.ts`).
 *
 * That validation used to be undone for ANY operand with free variables —
 * including a bare symbol carrying an explicit, incompatible declared type.
 * "Has free variables" is a proxy for "provisional type", and it only holds
 * while the type could still turn out compatible: a symbol declared `string`
 * can never denote a `tuple<number, number, number>`.
 *
 * The un-rejection is now withheld only when the operand's type is
 * **provably disjoint** from every parameter it could bind
 * (`BoxedType.isDisjointFrom`, conservative by construction), so
 * union-declared, `unknown`-typed and same-category-composite operands keep
 * deferring exactly as before.
 */

const TUPLE3 = 'tuple<number, number, number>';
const UNION3 = `${TUPLE3} | list<${TUPLE3}>`;

function engineWith(declaredType: string, name = 'pt'): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('sx', `(${TUPLE3}) -> unknown` as any);
  ce.declare(name, declaredType as any);
  return ce;
}

describe('a provably disjoint declared type is rejected at the call boundary', () => {
  // Name-independent: the admission had nothing to do with the symbol's name.
  for (const name of ['pt', 'V', 'P', 'q', 'point']) {
    test(`sx(${name}) with \`${name}\` declared \`string\` errors`, () => {
      const ce = engineWith('string', name);
      expect(JSON.stringify(ce.box(['sx', name]).json)).toContain(
        'incompatible-type'
      );
    });
  }

  test('the error survives evaluation', () => {
    const ce = engineWith('string');
    expect(JSON.stringify(ce.box(['sx', 'pt']).evaluate().json)).toContain(
      'incompatible-type'
    );
  });

  test('parse route agrees with the box route', () => {
    // A multi-letter name would parse as implicit multiplication, so use a
    // single-letter symbol for the LaTeX route.
    const ce = engineWith('string', 'V');
    expect(
      JSON.stringify(ce.parse('\\operatorname{sx}(V)').json)
    ).toContain('incompatible-type');
  });

  test('`ce.function` route agrees with the box route', () => {
    const ce = engineWith('string');
    expect(
      JSON.stringify(ce.function('sx', [ce.symbol('pt')]).json)
    ).toContain('incompatible-type');
  });

  test('other provably disjoint declared types are rejected too', () => {
    for (const t of ['number', 'boolean', `list<${TUPLE3}>`]) {
      const ce = engineWith(t);
      expect(JSON.stringify(ce.box(['sx', 'pt']).json)).toContain(
        'incompatible-type'
      );
    }
  });

  test('a compound operand with free variables is judged on its type', () => {
    const ce = new ComputeEngine();
    ce.declare('sx', `(${TUPLE3}) -> unknown` as any);
    ce.declare('x', 'number');
    expect(JSON.stringify(ce.box(['sx', ['Add', 'x', 1]]).json)).toContain(
      'incompatible-type'
    );
  });

  test('a matching declared type still passes', () => {
    const ce = engineWith(TUPLE3);
    expect(JSON.stringify(ce.box(['sx', 'pt']).json)).not.toContain('Error');
  });
});

describe('deferral is preserved wherever the type does not refute', () => {
  test('a union-declared operand still defers (Tycho item 130 shape)', () => {
    const ce = engineWith(UNION3);
    expect(JSON.stringify(ce.box(['sx', 'pt']).json)).not.toContain('Error');
    // …and through the parse route.
    const ce2 = engineWith(UNION3, 'V');
    expect(
      JSON.stringify(ce2.parse('\\operatorname{sx}(V)').json)
    ).not.toContain('Error');
  });

  test('an `unknown`-declared operand still defers', () => {
    const ce = engineWith('unknown');
    expect(JSON.stringify(ce.box(['sx', 'pt']).json)).not.toContain('Error');
  });

  test('an undeclared operand is still inferred, not rejected', () => {
    const ce = new ComputeEngine();
    ce.declare('sx', `(${TUPLE3}) -> unknown` as any);
    expect(JSON.stringify(ce.box(['sx', 'z']).json)).not.toContain('Error');
  });

  test('same-category composites are not provably disjoint: `list<integer>` vs a `list<string>` parameter defers', () => {
    // By ruling, element-wise disjointness is NOT part of `provablyDisjoint`
    // (the empty list inhabits both), so this stays admitted.
    const ce = new ComputeEngine();
    ce.declare('sy', '(list<string>) -> unknown' as any);
    ce.declare('L', 'list<integer>' as any);
    expect(JSON.stringify(ce.box(['sy', 'L']).json)).not.toContain('Error');
  });

  test('an inferred signature carries no constraint and never rejects', () => {
    const ce = new ComputeEngine();
    ce.box(['sx', 1]); // `sx` becomes an inferred function
    ce.declare('pt', 'string');
    expect(JSON.stringify(ce.box(['sx', 'pt']).json)).not.toContain('Error');
  });
});
