import { ComputeEngine } from '../../src/compute-engine';

/**
 * Phase 3b of the type-variables design
 * (`docs/TYPE-SYSTEM.md`): the two bounded
 * identity-echo conversions whose operands are numeric / matrix-shaped.
 *
 *   Conjugate  `(number) -> number` + `type: ([z]) => z.type`
 *              →  `(T) -> T where T: number`   (broadcastable, §4.4/D10)
 *   Inverse    `(matrix) -> matrix` + `type: ([m]) => m.type`
 *              →  `(T) -> T where T: matrix`   (§4.7 dimensions row)
 *
 * Every `Conjugate` expectation below was probed against the PRE-migration
 * engine and pinned verbatim: the contract of a bounded identity echo is that
 * the declarative form reproduces the imperative handler exactly, kind and
 * dimensions included.
 *
 * `Inverse` is no longer an identity echo. The echo was not sound: the
 * inverse of an integer matrix has rational entries (`[[1, 2], [3, 4]]^-1`
 * is `[[-2, 1], [3/2, -1/2]]`), and a non-square matrix has no inverse at
 * all, but the echo typed the first as `matrix<integer^(2x2)>` and the second
 * as `matrix<integer^(2x3)>`. `Inverse` now declares `(matrix) -> matrix` and
 * has a type handler that types it as `MatrixPower` with a negative integer
 * exponent (`squareMatrixPowerType()` in `library/linear-algebra.ts`). So
 * `m^-1` (canonical form `Inverse(m)`) and `m^-2` (canonical form
 * `MatrixPower(m, -2)`) have the same element type. The `Inverse`
 * expectations below pin that handler.
 */

/** A fresh engine per test: symbol declarations and inferred symbol types are
 * engine-global. */
function fresh(): ComputeEngine {
  return new ComputeEngine();
}

const M22 = ['List', ['List', 1, 2], ['List', 3, 4]] as any;
const M23 = ['List', ['List', 1, 2, 5], ['List', 3, 4, 6]] as any;

describe('the migrated definitions are declaratively generic', () => {
  test('the polytype signature REPLACES the imperative `type:` echo', () => {
    const ce = fresh();
    const conj = ce.box(['Conjugate', 2]).operatorDefinition as any;
    expect(conj.signature.toString()).toBe('(T) -> T where T: number');
    expect(conj.signature.isPolymorphic).toBe(true);
    expect(conj.type).toBeUndefined();

    // `Inverse` is the exception: its result is not the operand type (see
    // the comment at the top of this file), so it has a monomorphic
    // signature and a type handler.
    const inv = ce.box(['Inverse', M22]).operatorDefinition as any;
    expect(inv.signature.toString()).toBe('(matrix) -> matrix');
    expect(inv.signature.isPolymorphic).toBe(false);
    expect(typeof inv.type).toBe('function');
  });
});

describe('Conjugate — (T) -> T where T: number', () => {
  test('scalar result types echo the operand (kind preserved)', () => {
    const ce = fresh();
    expect(ce.function('Conjugate', [ce.number(2)]).type.toString()).toBe(
      'integer'
    );
    expect(ce.function('Conjugate', [ce.number(2.5)]).type.toString()).toBe(
      'real'
    );
    expect(
      ce.function('Conjugate', [ce.number(ce.complex(1, 2))]).type.toString()
    ).toBe('complex');
  });

  test('a declared symbol operand echoes its declared type', () => {
    const ce = fresh();
    ce.declare('w', 'complex');
    expect(ce.box(['Conjugate', 'w']).type.toString()).toBe('complex');
  });

  test('an inferable symbol operand narrows to the declared bound', () => {
    const ce = fresh();
    // §4.2 rule 1: the operand narrows to the instantiated ground parameter.
    expect(ce.box(['Conjugate', 'qq']).type.toString()).toBe('number');
    expect(ce.box('qq').type.toString()).toBe('number');
  });

  // D10 (§4.4): a lift-admitted operand at a bare-variable pattern is admitted
  // at the SCALAR BASE but binds the FULL actual, so the result type is the
  // collection — matching the echo handler's behavior under broadcast.
  test('D10 — broadcast over a vector keeps the collection type', () => {
    const ce = fresh();
    const e = ce.box(['Conjugate', ['List', 1, 2, 3]]);
    expect(e.type.toString()).toBe('vector<integer^3>');
    expect(e.evaluate().toString()).toBe('[1,2,3]');
  });

  test('D10 — broadcast evaluates elementwise over complex entries', () => {
    const ce = fresh();
    expect(
      ce
        .box(['Conjugate', ['List', ['Complex', 1, 2], 3]])
        .evaluate()
        .toString()
    ).toBe('[(1 - 2i),3]');
  });

  test('D10 — a matrix operand echoes the operand type, not a re-shaped lift', () => {
    const ce = fresh();
    const e = ce.box(['Conjugate', M22]);
    expect(e.op1.type.toString()).toBe('matrix<integer^(2x2)>');
    // D10 bound `T` to the FULL actual, so the arm's result IS the operand's
    // own type: the broadcast wrapper must not unwrap and re-shape it (that
    // produced the mixed-encoding `matrix<vector<integer^2>^(2x2)>`).
    // A GROUND broadcastable — `Sin`, `Sqrt` — already answers `matrix<…>`
    // here, so this is the shape that keeps the two paths in agreement.
    expect(e.type.toString()).toBe('matrix<integer^(2x2)>');
    expect(e.evaluate().toString()).toBe('[[1,2],[3,4]]');
  });

  test('a non-indexed collection operand is unchanged (lift admission)', () => {
    const ce = fresh();
    const e = ce.box(['Conjugate', ['Set', 1, 2]]);
    expect(e.type.toString()).toBe('set<integer>');
    expect(e.evaluate().toString()).toBe('Conjugate(Set(1, 2))');
  });

  test('bound violation — a non-number operand reports the declared bound', () => {
    const ce = fresh();
    const e = ce.box(['Conjugate', { str: 'ab' }]);
    expect(e.type.toString()).toBe('error');
    // §8: the displayed expected type is the ground bound, never variable
    // syntax.
    expect(JSON.stringify(e.json)).toBe(
      '["Conjugate",["Error",["ErrorCode","\'incompatible-type\'","\'number\'","\'string\'"],"\'ab\'"]]'
    );
  });

  test('the `sgn` handler is unaffected by the migration', () => {
    const ce = fresh();
    expect(ce.box(['Conjugate', -3]).sgn).toBe('negative');
  });

  test('values are preserved', () => {
    const ce = fresh();
    expect(ce.box(['Conjugate', 2]).evaluate().toString()).toBe('2');
    expect(
      ce
        .box(['Conjugate', ['Complex', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('(1 - 2i)');
    expect(
      ce
        .box(['Conjugate', ['Conjugate', ['Complex', 1, 2]]])
        .evaluate()
        .toString()
    ).toBe('(1 + 2i)');
  });

  test('route parity — ce.function / ce.box / ce.parse agree', () => {
    const ce = fresh();
    const viaFunction = ce.function('Conjugate', [ce.number(2)]);
    const viaBox = ce.box(['Conjugate', 2]);
    // `^\star` is `ConjugateTranspose`; `\overline{…}` and the operator
    // name reach `Conjugate`.
    const viaParse = ce.parse('\\operatorname{Conjugate}(2)');
    expect(viaParse.operator).toBe('Conjugate');
    expect(viaFunction.type.toString()).toBe('integer');
    expect(viaBox.type.toString()).toBe('integer');
    expect(viaParse.type.toString()).toBe('integer');
    expect(viaFunction.evaluate().toString()).toBe('2');
    expect(viaBox.evaluate().toString()).toBe('2');
    expect(viaParse.evaluate().toString()).toBe('2');
  });

  test('route parity — the broadcast row on all three routes', () => {
    const ce = fresh();
    const list = ce.box(['List', 1, 2, 3]);
    expect(ce.function('Conjugate', [list]).type.toString()).toBe(
      'vector<integer^3>'
    );
    expect(ce.box(['Conjugate', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<integer^3>'
    );
    expect(
      ce
        .parse('\\operatorname{Conjugate}(\\lbrack 1, 2, 3\\rbrack)')
        .type.toString()
    ).toBe('vector<integer^3>');
  });
});

describe('Inverse — (matrix) -> matrix, typed as a power with exponent -1', () => {
  test('a square integer matrix has rational entries; a non-square one declines', () => {
    const ce = fresh();
    expect(ce.box(['Inverse', M22]).type.toString()).toBe(
      'matrix<rational^(2x2)>'
    );
    // A non-square matrix has no inverse (the value is an
    // `expected-square-matrix` error). The handler declines, so the declared
    // `matrix` applies, as for `MatrixPower` with a negative exponent.
    expect(ce.box(['Inverse', M23]).type.toString()).toBe('matrix');
  });

  test('the result type equals the type of MatrixPower(m, -1)', () => {
    const ce = fresh();
    for (const m of [M22, M23])
      expect(ce.box(['Inverse', m]).type.toString()).toBe(
        ce.box(['MatrixPower', m, -1]).type.toString()
      );
  });

  test('a declared matrix symbol is typed from its element type and shape', () => {
    const ce = fresh();
    ce.declare('MM', 'matrix<integer^(2x2)>');
    expect(ce.box(['Inverse', 'MM']).type.toString()).toBe(
      'matrix<rational^(2x2)>'
    );
    ce.declare('R', 'matrix<real^(3x3)>');
    expect(ce.box(['Inverse', 'R']).type.toString()).toBe('matrix<real^(3x3)>');
    ce.declare('Z', 'matrix<complex^(2x2)>');
    expect(ce.box(['Inverse', 'Z']).type.toString()).toBe(
      'matrix<complex^(2x2)>'
    );
    // The `list` spelling of a square integer matrix.
    ce.declare('NN', 'matrix<integer^(2x2)>');
    expect(ce.box(['Inverse', 'NN']).type.toString()).toBe(
      'matrix<rational^(2x2)>'
    );
  });

  test('an operand with no known shape keeps a shape-free matrix type', () => {
    const ce = fresh();
    ce.declare('P', 'matrix');
    expect(ce.box(['Inverse', 'P']).type.toString()).toBe('matrix');
    ce.declare('Q', 'matrix<integer>');
    expect(ce.box(['Inverse', 'Q']).type.toString()).toBe('matrix<rational>');
  });

  test('m^-1 and m^-2 have the same element type', () => {
    const ce = fresh();
    ce.declare('MM', 'matrix<integer^(2x2)>');
    const inverse = ce.parse('\\mathrm{MM}^{-1}');
    const square = ce.parse('\\mathrm{MM}^{-2}');
    expect(inverse.operator).toBe('Inverse');
    expect(square.operator).toBe('MatrixPower');
    expect(inverse.type.toString()).toBe('matrix<rational^(2x2)>');
    expect(square.type.toString()).toBe(inverse.type.toString());
  });

  test('nested application stays rational', () => {
    const ce = fresh();
    expect(ce.box(['Inverse', ['Inverse', M22]]).type.toString()).toBe(
      'matrix<rational^(2x2)>'
    );
  });

  test('the type of the value is a subtype of the static type', () => {
    const ce = fresh();
    const cases = [
      M22,
      ['List', ['List', 1.5, 2], ['List', 3, 5]],
      ['List', ['List', ['Complex', 1, 1], 2], ['List', 3, 4]],
      ['Inverse', M22],
    ];
    for (const m of cases) {
      const e = ce.box(['Inverse', m] as any);
      const value = e.evaluate();
      expect(value.operator).toBe('List');
      expect(value.type.matches(e.type)).toBe(true);
    }
  });

  test('bound violation — a set operand reports the declared bound', () => {
    const ce = fresh();
    const e = ce.box(['Inverse', ['Set', 1, 2]]);
    expect(e.type.toString()).toBe('error');
    // §8: the declared bound `matrix` is what is displayed as expected.
    expect(JSON.stringify(e.json)).toBe(
      '["Inverse",["Error",["ErrorCode","\'incompatible-type\'","\'matrix\'","\'set<integer>\'"],["Set",1,2]]]'
    );
  });

  test('bound violation — a scalar operand reports the declared bound', () => {
    const ce = fresh();
    const e = ce.function('Inverse', [ce.number(4)]);
    expect(e.type.toString()).toBe('error');
    expect(JSON.stringify(e.json)).toBe(
      '["Inverse",["Error",["ErrorCode","\'incompatible-type\'","\'matrix\'","\'4\'"],4]]'
    );
  });

  test('bound violation — a vector operand reports the declared bound', () => {
    const ce = fresh();
    const e = ce.box(['Inverse', ['List', 1, 2, 3]]);
    expect(e.type.toString()).toBe('error');
    expect(JSON.stringify(e.json)).toBe(
      '["Inverse",["Error",["ErrorCode","\'incompatible-type\'","\'matrix\'","\'vector<integer^3>\'"],["List",1,2,3]]]'
    );
  });

  test('values are preserved (exact and numeric paths)', () => {
    const ce = fresh();
    expect(ce.box(['Inverse', M22]).evaluate().toString()).toBe(
      '[[-2,1],[3/2,-1/2]]'
    );
    expect(ce.box(['Inverse', M22]).evaluate().type.toString()).toBe(
      'matrix<rational^(2x2)>'
    );
    expect(ce.box(['Inverse', M22]).N().toString()).toBe('[[-2,1],[1.5,-0.5]]');
    expect(ce.box(['Inverse', M22]).N().type.toString()).toBe(
      'matrix<real^(2x2)>'
    );
  });

  test('route parity — ce.function / ce.box / ce.parse agree', () => {
    const ce = fresh();
    ce.declare('MM', 'matrix<integer^(2x2)>');
    const viaFunction = ce.function('Inverse', [ce.symbol('MM')]);
    const viaBox = ce.box(['Inverse', 'MM']);
    // `A^{-1}` reaches `Inverse` only for a matrix-typed symbol (see the
    // `InverseFunction` postfix entry in `definitions-core.ts`).
    const viaParse = ce.parse('\\mathrm{MM}^{-1}');
    const viaParse2 = ce.parse('\\operatorname{Inverse}(\\mathrm{MM})');
    expect(viaParse.operator).toBe('Inverse');
    expect(viaParse2.operator).toBe('Inverse');
    for (const e of [viaFunction, viaBox, viaParse, viaParse2])
      expect(e.type.toString()).toBe('matrix<rational^(2x2)>');
  });

  test('route parity — a matrix literal on all three routes', () => {
    const ce = fresh();
    const m = ce.box(M22);
    expect(ce.function('Inverse', [m]).type.toString()).toBe(
      'matrix<rational^(2x2)>'
    );
    expect(ce.box(['Inverse', M22]).type.toString()).toBe(
      'matrix<rational^(2x2)>'
    );
    expect(
      ce
        .parse(
          '\\operatorname{Inverse}(\\lbrack\\lbrack 1,2\\rbrack,\\lbrack 3,4\\rbrack\\rbrack)'
        )
        .type.toString()
    ).toBe('matrix<rational^(2x2)>');
  });
});
