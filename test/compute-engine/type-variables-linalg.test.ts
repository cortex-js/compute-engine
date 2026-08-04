import { ComputeEngine } from '../../src/compute-engine';

/**
 * Phase 3b of the type-variables design
 * (`docs/plans/2026-08-01-type-variables-design.md`): the two bounded
 * identity-echo conversions whose operands are numeric / matrix-shaped.
 *
 *   Conjugate  `(number) -> number` + `type: ([z]) => z.type`
 *              →  `forall T: number. (T) -> T`   (broadcastable, §4.4/D10)
 *   Inverse    `(matrix) -> matrix` + `type: ([m]) => m.type`
 *              →  `forall T: matrix. (T) -> T`   (§4.7 dimensions row)
 *
 * Every expectation below was probed against the PRE-migration engine and
 * pinned verbatim: the contract of a bounded identity echo is that the
 * declarative form reproduces the imperative handler exactly, kind and
 * dimensions included.
 */

/** A fresh engine per test: symbol declarations and inferred symbol types are
 * engine-global. */
function fresh(): ComputeEngine {
  return new ComputeEngine();
}

const M22 = ['List', ['List', 1, 2], ['List', 3, 4]] as any;
const M23 = ['List', ['List', 1, 2, 5], ['List', 3, 4, 6]] as any;

describe('the migrated definitions are declaratively generic', () => {
  test('the forall signature REPLACES the imperative `type:` echo', () => {
    const ce = fresh();
    const conj = ce.box(['Conjugate', 2]).operatorDefinition as any;
    expect(conj.signature.toString()).toBe('forall T: number. (T) -> T');
    expect(conj.signature.isPolymorphic).toBe(true);
    expect(conj.type).toBeUndefined();

    const inv = ce.box(['Inverse', M22]).operatorDefinition as any;
    expect(inv.signature.toString()).toBe('forall T: matrix. (T) -> T');
    expect(inv.signature.isPolymorphic).toBe(true);
    expect(inv.type).toBeUndefined();
  });
});

describe('Conjugate — forall T: number. (T) -> T', () => {
  test('scalar result types echo the operand (kind preserved)', () => {
    const ce = fresh();
    expect(ce.function('Conjugate', [ce.number(2)]).type.toString()).toBe(
      'finite_integer'
    );
    expect(ce.function('Conjugate', [ce.number(2.5)]).type.toString()).toBe(
      'finite_real'
    );
    expect(
      ce.function('Conjugate', [ce.number(ce.complex(1, 2))]).type.toString()
    ).toBe('finite_complex');
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
    expect(e.type.toString()).toBe('vector<finite_integer^3>');
    expect(e.evaluate().toString()).toBe('[1,2,3]');
  });

  test('D10 — broadcast evaluates elementwise over complex entries', () => {
    const ce = fresh();
    expect(
      ce.box(['Conjugate', ['List', ['Complex', 1, 2], 3]]).evaluate().toString()
    ).toBe('[(1 - 2i),3]');
  });

  test('D10 — a matrix operand keeps the rank/shape-aware broadcast type', () => {
    const ce = fresh();
    const e = ce.box(['Conjugate', M22]);
    expect(e.op1.type.toString()).toBe('matrix<finite_integer^(2x2)>');
    // The broadcast wrapper (rank/shape-aware lift) owns the result type here,
    // exactly as it did with the imperative echo.
    expect(e.type.toString()).toBe('list<vector<finite_integer^2>^(2x2)>');
    expect(e.evaluate().toString()).toBe('[[1,2],[3,4]]');
  });

  test('a non-indexed collection operand is unchanged (lift admission)', () => {
    const ce = fresh();
    const e = ce.box(['Conjugate', ['Set', 1, 2]]);
    expect(e.type.toString()).toBe('set<finite_integer>');
    expect(e.evaluate().toString()).toBe('Conjugate(Set(1, 2))');
  });

  test('bound violation — a non-number operand reports the declared bound', () => {
    const ce = fresh();
    const e = ce.box(['Conjugate', { str: 'ab' }]);
    expect(e.type.toString()).toBe('error');
    // §8: the displayed expected type is the ground bound, never variable
    // syntax.
    expect(JSON.stringify(e.json)).toBe(
      '["Conjugate",["Error",["ErrorCode","\'incompatible-type\'","\'number\'","\'string\'"]]]'
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
      ce.box(['Conjugate', ['Complex', 1, 2]]).evaluate().toString()
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
    // `\overline{…}` is `OverBar` and `^\star` is `ConjugateTranspose`; the
    // only LaTeX form that reaches `Conjugate` is the operator name.
    const viaParse = ce.parse('\\operatorname{Conjugate}(2)');
    expect(viaParse.operator).toBe('Conjugate');
    expect(viaFunction.type.toString()).toBe('finite_integer');
    expect(viaBox.type.toString()).toBe('finite_integer');
    expect(viaParse.type.toString()).toBe('finite_integer');
    expect(viaFunction.evaluate().toString()).toBe('2');
    expect(viaBox.evaluate().toString()).toBe('2');
    expect(viaParse.evaluate().toString()).toBe('2');
  });

  test('route parity — the broadcast row on all three routes', () => {
    const ce = fresh();
    const list = ce.box(['List', 1, 2, 3]);
    expect(ce.function('Conjugate', [list]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    expect(ce.box(['Conjugate', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    expect(
      ce.parse('\\operatorname{Conjugate}(\\lbrack 1, 2, 3\\rbrack)').type.toString()
    ).toBe('vector<finite_integer^3>');
  });
});

describe('Inverse — forall T: matrix. (T) -> T', () => {
  test('§4.7 identity row — dimensions and kind are preserved verbatim', () => {
    const ce = fresh();
    expect(ce.box(['Inverse', M22]).type.toString()).toBe(
      'matrix<finite_integer^(2x2)>'
    );
    // Non-square is a runtime error, but the STATIC echo still carries the
    // operand's dimensions (2x3 in, 2x3 out).
    expect(ce.box(['Inverse', M23]).type.toString()).toBe(
      'matrix<finite_integer^(2x3)>'
    );
  });

  test('the result type equals the operand type', () => {
    const ce = fresh();
    const e = ce.box(['Inverse', M22]);
    expect(e.type.toString()).toBe(e.op1.type.toString());
  });

  test('a declared matrix symbol echoes its declared type', () => {
    const ce = fresh();
    ce.declare('MM', 'matrix<integer^(2x2)>');
    expect(ce.box(['Inverse', 'MM']).type.toString()).toBe(
      'matrix<integer^(2x2)>'
    );
  });

  test('nested application preserves the type', () => {
    const ce = fresh();
    expect(ce.box(['Inverse', ['Inverse', M22]]).type.toString()).toBe(
      'matrix<finite_integer^(2x2)>'
    );
  });

  test('bound violation — a set operand reports the declared bound', () => {
    const ce = fresh();
    const e = ce.box(['Inverse', ['Set', 1, 2]]);
    expect(e.type.toString()).toBe('error');
    // §8: the declared bound `matrix` is what is displayed as expected.
    expect(JSON.stringify(e.json)).toBe(
      '["Inverse",["Error",["ErrorCode","\'incompatible-type\'","\'matrix\'","\'set<finite_integer>\'"]]]'
    );
  });

  test('bound violation — a scalar operand reports the declared bound', () => {
    const ce = fresh();
    const e = ce.function('Inverse', [ce.number(4)]);
    expect(e.type.toString()).toBe('error');
    expect(JSON.stringify(e.json)).toBe(
      '["Inverse",["Error",["ErrorCode","\'incompatible-type\'","\'matrix\'","\'finite_integer\'"]]]'
    );
  });

  test('bound violation — a vector operand reports the declared bound', () => {
    const ce = fresh();
    const e = ce.box(['Inverse', ['List', 1, 2, 3]]);
    expect(e.type.toString()).toBe('error');
    expect(JSON.stringify(e.json)).toBe(
      '["Inverse",["Error",["ErrorCode","\'incompatible-type\'","\'matrix\'","\'vector<finite_integer^3>\'"]]]'
    );
  });

  test('values are preserved (exact and numeric paths)', () => {
    const ce = fresh();
    expect(ce.box(['Inverse', M22]).evaluate().toString()).toBe(
      '[[-2,1],[3/2,-1/2]]'
    );
    expect(ce.box(['Inverse', M22]).evaluate().type.toString()).toBe(
      'matrix<finite_rational^(2x2)>'
    );
    expect(ce.box(['Inverse', M22]).N().toString()).toBe('[[-2,1],[1.5,-0.5]]');
    expect(ce.box(['Inverse', M22]).N().type.toString()).toBe(
      'matrix<finite_real^(2x2)>'
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
      expect(e.type.toString()).toBe('matrix<integer^(2x2)>');
  });

  test('route parity — a matrix literal on all three routes', () => {
    const ce = fresh();
    const m = ce.box(M22);
    expect(ce.function('Inverse', [m]).type.toString()).toBe(
      'matrix<finite_integer^(2x2)>'
    );
    expect(ce.box(['Inverse', M22]).type.toString()).toBe(
      'matrix<finite_integer^(2x2)>'
    );
    expect(
      ce
        .parse(
          '\\operatorname{Inverse}(\\lbrack\\lbrack 1,2\\rbrack,\\lbrack 3,4\\rbrack\\rbrack)'
        )
        .type.toString()
    ).toBe('matrix<finite_integer^(2x2)>');
  });
});
