/**
 * Contract B declarations of the linear-algebra scalars — `Norm`, `Trace`,
 * `MatrixPower` and `Determinant` (`docs/ERROR-MODEL.md` §4; Phase F batch 13
 * of `docs/plans/2026-08-30-error-model-implementation.md`).
 *
 * Each head is probed at its exceptional points on BOTH routes that reach it
 * without a `canonical` handler in between: the MathJSON box route
 * (`ce.box`) and, where the operator has a LaTeX spelling, the parse route.
 * None of the four is lazy and none has a `canonical` handler, so signature
 * validation at boxing is the seam that answers an off-carrier operand, and
 * the dispatch conformance re-test answers one that arrives later (a symbol
 * that gets a value).
 *
 * Every `describe` builds its own engine: symbol inference leaks across the
 * tests of a shared-engine file, and these pins declare symbols from the
 * flipped carriers.
 */

import { ComputeEngine } from '../../src/compute-engine';

const M = ['List', ['List', 1, 2], ['List', 3, 4]];
const DIAG = ['List', ['List', 4, 0], ['List', 0, 9]];
const RANK3 = [
  'List',
  ['List', ['List', 1, 2], ['List', 3, 4]],
  ['List', ['List', 5, 6], ['List', 7, 8]],
];

/** The operator definition of `name`, for the Contract B policy accessors. */
function opDef(ce: ComputeEngine, name: string) {
  return (ce.lookupDefinition(name) as any).operator;
}

/**
 * The `incompatible-type` error an off-carrier operand boxes to. The error is
 * read off the EVALUATED expression rather than the boxed one, because the
 * `Norm` serializer prints only the vector bars and its first operand, so an
 * error wrapped around the ORDER does not appear in the boxed string.
 */
function expectIncompatible(e: any) {
  expect(e.isValid).toBe(false);
  expect(e.evaluate().toString()).toContain('incompatible-type');
}

describe('Norm — Contract B declaration', () => {
  test('the declaration resolves to handle/reject and may-marker', () => {
    const ce = new ComputeEngine();
    const def = opDef(ce, 'Norm');
    // The operand slot HANDLES `NaN` (the `IsPrime`/`Hypot` arrangement:
    // `NaN` rides in on the carrier and the handler answers `|NaN| = NaN`),
    // while the ORDER is an administrative slot and rejects it.
    expect(def.resolvedNanBehaviorAt(0)).toBe('handle');
    expect(def.resolvedNanBehaviorAt(1)).toBe('reject');
    expect(def.resolvedPartiality).toBe('may-marker');
  });

  test('a scalar operand is its absolute value, NaN and the infinities included', () => {
    const ce = new ComputeEngine();
    const value = (x: any) =>
      ce
        .box(['Norm', x] as any)
        .evaluate()
        .toString();
    expect(value(5)).toBe('5');
    expect(value('NaN')).toBe('NaN');
    expect(value('PositiveInfinity')).toBe('+oo');
    expect(value('NegativeInfinity')).toBe('+oo');
    // `|~oo| = +oo` by definition of the point at infinity.
    expect(value('ComplexInfinity')).toBe('+oo');
    expect(value('i')).toBe('1');
  });

  test('a non-numeric operand is an incompatible-type error at boxing', () => {
    // The old `(value, …)` carrier admitted a string, a boolean and a list
    // with a non-numeric element, and every one of them stayed inert — an
    // undecided answer to a decided question.
    const ce = new ComputeEngine();
    expectIncompatible(ce.box(['Norm', { str: 'a' }] as any));
    expectIncompatible(ce.box(['Norm', 'True'] as any));
    expectIncompatible(ce.box(['Norm', ['List', 1, { str: 'a' }]] as any));
    expectIncompatible(ce.box(['Norm', 'Missing'] as any));
  });

  test('an undeclared operand symbol is inferred from the flipped carrier', () => {
    const ce = new ComputeEngine();
    ce.box(['Norm', 'normArg'] as any);
    expect(ce.box('normArg').type.toString()).toBe(
      'list<number> | list<tuple> | number | tuple'
    );
  });

  test('the declared result stands where the handler declines', () => {
    const ce = new ComputeEngine();
    // A scalar, a matrix (whose elements are rows) and a symbol give the
    // handler nothing to read, so the declared `real | +oo | nan` applies —
    // sharper than the old `number`, which admitted complex values and `-oo`.
    expect(ce.box(['Norm', 5] as any).type.toString()).toBe('+oo | nan | real');
    expect(ce.box(['Norm', M] as any).type.toString()).toBe('+oo | nan | real');
    // A literal vector of proven-finite components keeps the sharp `real`.
    expect(ce.box(['Norm', ['List', 3, 4]] as any).type.toString()).toBe(
      'real'
    );
    // A broadcasting point and a point list answer one norm per element.
    expect(
      ce.box(['Norm', ['Tuple', ['List', 3, 6], 4]] as any).type.toString()
    ).toBe('list<number>');
  });

  test('a vector norm and its orders', () => {
    const ce = new ComputeEngine();
    const value = (...ops: any[]) =>
      ce
        .box(['Norm', ...ops] as any)
        .evaluate()
        .toString();
    expect(value(['List', 3, 4])).toBe('5');
    expect(value(['List', 3, 4], 1)).toBe('7');
    expect(value(['List', 3, 4], { str: 'Infinity' })).toBe('4');
    expect(value(['List', 3, 4], 'PositiveInfinity')).toBe('4');
    // The Frobenius norm is the entry-wise L2 norm at ANY rank, so it is
    // defined on a vector too — it used to stay inert there while the
    // JavaScript compile target answered 5.
    expect(value(['List', 3, 4], { str: 'Frobenius' })).toBe('5');
    expect(value(['Tuple', 3, 4], { str: 'Frobenius' })).toBe('5');
    expect(value(['List', 3, 4], 2.5)).toBe('4.68814084234358779781');
    // An infinite component dominates a NaN one (ruled 2026-09-02).
    expect(value(['List', 1, 'PositiveInfinity'])).toBe('+oo');
    expect(value(['List', 1, 'ComplexInfinity'])).toBe('+oo');
    expect(value(['List', 1, 'NaN'])).toBe('NaN');
  });

  test('the norm of an EMPTY vector is 0', () => {
    // `[]` carries no shape, so it is not a tensor value and the rank-1
    // branch never reached the "0 for every order" case: the application
    // stayed inert on a question every norm decides.
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Norm', ['List']] as any)
        .evaluate()
        .toString()
    ).toBe('0');
    expect(
      ce
        .box(['Norm', ['List'], 1] as any)
        .evaluate()
        .toString()
    ).toBe('0');
  });

  test('an order outside the carrier is an error at boxing', () => {
    const ce = new ComputeEngine();
    // A NaN order is an administrative slot: `reject`.
    expectIncompatible(ce.box(['Norm', ['List', 3, 4], 'NaN'] as any));
    // `i`, `-oo` and `~oo` are simply not orders.
    expectIncompatible(ce.box(['Norm', ['List', 3, 4], 'i'] as any));
    expectIncompatible(
      ce.box(['Norm', ['List', 3, 4], 'NegativeInfinity'] as any)
    );
    expectIncompatible(
      ce.box(['Norm', ['List', 3, 4], 'ComplexInfinity'] as any)
    );
  });

  test('an in-carrier order that is not a norm fails the precondition', () => {
    // `requires` decides an in-carrier LITERAL only: a non-positive order and
    // an unrecognized order NAME are contract violations (the Error channel),
    // where they used to stay inert.
    const ce = new ComputeEngine();
    const op = (...ops: any[]) => ce.box(['Norm', ...ops] as any).evaluate();
    expect(op(['List', 3, 4], 0).operator).toBe('Error');
    expect(op(['List', 3, 4], 0).toString()).toContain('evaluation-error');
    expect(op(['List', 3, 4], -1).operator).toBe('Error');
    expect(op(['List', 3, 4], { str: 'foo' }).operator).toBe('Error');
  });

  test('a symbolic order is undecidable and falls through', () => {
    const ce = new ComputeEngine();
    ce.declare('normOrder', 'real');
    const e = ce.box(['Norm', ['List', 3, 4], 'normOrder'] as any);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().operator).toBe('Norm');
  });

  test('the parse route agrees with the box route', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\|5\\|').evaluate().toString()).toBe('5');
    expect(ce.parse('\\|5\\|').type.toString()).toBe('+oo | nan | real');
    expect(
      ce
        .parse('\\|\\begin{pmatrix}3\\\\4\\end{pmatrix}\\|')
        .evaluate()
        .toString()
    ).toBe('5');
    expectIncompatible(ce.parse('\\|\\text{a}\\|'));
  });
});

describe('Trace — Contract B declaration', () => {
  test('the declaration resolves to handle on the operand, reject on the axes', () => {
    const ce = new ComputeEngine();
    const def = opDef(ce, 'Trace');
    expect(def.resolvedNanBehaviorAt(0)).toBe('handle');
    expect(def.resolvedNanBehaviorAt(1)).toBe('reject');
    expect(def.resolvedNanBehaviorAt(2)).toBe('reject');
    expect(def.resolvedPartiality).toBe('may-marker');
  });

  test('a scalar is the trace of the 1x1 matrix it names', () => {
    const ce = new ComputeEngine();
    const value = (x: any) =>
      ce
        .box(['Trace', x] as any)
        .evaluate()
        .toString();
    expect(value(5)).toBe('5');
    expect(value('NaN')).toBe('NaN');
    expect(value('PositiveInfinity')).toBe('+oo');
    expect(value('ComplexInfinity')).toBe('~oo');
    expect(value('i')).toBe('i');
  });

  test('a non-numeric operand is an incompatible-type error at boxing', () => {
    const ce = new ComputeEngine();
    expectIncompatible(ce.box(['Trace', { str: 'a' }] as any));
    expectIncompatible(ce.box(['Trace', 'True'] as any));
    expectIncompatible(ce.box(['Trace', 'Missing'] as any));
  });

  test('NaN and infinite CELLS are summed by IEEE along the diagonal', () => {
    const ce = new ComputeEngine();
    const value = (m: any) =>
      ce
        .box(['Trace', m] as any)
        .evaluate()
        .toString();
    // Off the diagonal a NaN cell does not reach the sum.
    expect(value(['List', ['List', 1, 'NaN'], ['List', 3, 4]])).toBe('5');
    expect(value(['List', ['List', 'NaN', 1], ['List', 3, 4]])).toBe('NaN');
    expect(
      value(['List', ['List', 1, 2], ['List', 3, 'PositiveInfinity']])
    ).toBe('+oo');
  });

  test('the Error-channel answers of the handler are unchanged', () => {
    const ce = new ComputeEngine();
    const value = (...ops: any[]) =>
      ce
        .box(['Trace', ...ops] as any)
        .evaluate()
        .toString();
    // A vector has no trace, an out-of-range or repeated axis is invalid,
    // and a non-square extent pair has no trace: each keeps its own code.
    expect(value(['List', 1, 2])).toContain('expected-matrix-or-tensor');
    expect(value(M, 0, 2)).toContain('invalid-axis');
    expect(value(M, 1, 1)).toContain('invalid-axis');
    expect(value(['List', ['List', 1, 2, 3], ['List', 4, 5, 6]])).toContain(
      'expected-square-matrix'
    );
    // A NaN axis is refused by the `integer` slot at boxing.
    expectIncompatible(ce.box(['Trace', M, 'NaN', 2] as any));
  });

  test('the declared result stands where the handler declines', () => {
    const ce = new ComputeEngine();
    // A rank-2 operand and a scalar claim the sharp `number`.
    expect(ce.box(['Trace', M] as any).type.toString()).toBe('number');
    expect(ce.box(['Trace', 5] as any).type.toString()).toBe('number');
    // A batch trace reduces two axes and stays a collection; there is
    // nothing cheap to claim about its shape, so the declared union applies.
    expect(ce.box(['Trace', RANK3] as any).type.toString()).toBe(
      'list<number> | number'
    );
    expect(
      ce
        .box(['Trace', RANK3] as any)
        .evaluate()
        .toString()
    ).toBe('[5,13]');
  });

  test('an undeclared operand symbol is inferred from the flipped carrier', () => {
    const ce = new ComputeEngine();
    ce.box(['Trace', 'traceArg'] as any);
    expect(ce.box('traceArg').type.toString()).toBe('list<number> | number');
  });

  test('the parse route agrees with the box route', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\operatorname{tr}(5)').evaluate().toString()).toBe('5');
    expect(
      ce
        .parse('\\operatorname{tr}\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}')
        .evaluate()
        .toString()
    ).toBe('5');
    expectIncompatible(ce.parse('\\operatorname{tr}(\\text{a})'));
  });
});

describe('MatrixPower — Contract B declaration', () => {
  test('both slots reject NaN', () => {
    const ce = new ComputeEngine();
    const def = opDef(ce, 'MatrixPower');
    expect(def.resolvedNanBehaviorAt(0)).toBe('reject');
    expect(def.resolvedNanBehaviorAt(1)).toBe('reject');
    expect(def.resolvedPartiality).toBe('may-marker');
  });

  test('a non-real exponent is an error at boxing', () => {
    // The handler read `exponent.re`, so `MatrixPower(A, i)` returned the
    // IDENTITY (`i.re` is 0) — a silently wrong matrix. `real` puts every
    // complex exponent and every infinity out of the domain.
    const ce = new ComputeEngine();
    expectIncompatible(ce.box(['MatrixPower', M, 'i'] as any));
    expectIncompatible(ce.box(['MatrixPower', M, 'NaN'] as any));
    expectIncompatible(ce.box(['MatrixPower', M, 'PositiveInfinity'] as any));
    expectIncompatible(ce.box(['MatrixPower', M, 'ComplexInfinity'] as any));
  });

  test('an undeclared exponent symbol is inferred `real`', () => {
    const ce = new ComputeEngine();
    ce.box(['MatrixPower', M, 'mpExp'] as any);
    expect(ce.box('mpExp').type.toString()).toBe('real');
  });

  test('integer powers, and the non-matrix operands the carrier refuses', () => {
    const ce = new ComputeEngine();
    const value = (...ops: any[]) =>
      ce
        .box(['MatrixPower', ...ops] as any)
        .evaluate()
        .toString();
    expect(value(M, 2)).toBe('[[7,10],[15,22]]');
    expect(value(M, 0)).toBe('[[1,0],[0,1]]');
    expect(value(M, -1)).toBe('[[-2,1],[3/2,-1/2]]');
    expectIncompatible(ce.box(['MatrixPower', 5, 2] as any));
    expectIncompatible(ce.box(['MatrixPower', ['List', 1, 2], 2] as any));
    expectIncompatible(ce.box(['MatrixPower', { str: 'a' }, 2] as any));
    expect(value(['List', ['List', 1, 2, 3], ['List', 4, 5, 6]], 2)).toContain(
      'expected-square-matrix'
    );
  });

  test('a half-integer exponent survives numericization', () => {
    // `.N()` numericizes the exponent, and the denominator of a float is
    // always 1 — the denominator of `0.5` reads 1, not 2 — so the principal
    // square root branch was unreachable on the numeric route:
    // `MatrixPower(D, 1/2).N()` stayed inert where its `evaluate()` answered
    // `[[2,0],[0,3]]`.
    const ce = new ComputeEngine();
    const e = ce.box(['MatrixPower', DIAG, ['Divide', 1, 2]] as any);
    expect(e.evaluate().toString()).toBe('[[2,0],[0,3]]');
    expect(e.N().toString()).toBe('[[2,0],[0,3]]');
    expect(
      ce
        .box(['MatrixPower', DIAG, 0.5] as any)
        .evaluate()
        .toString()
    ).toBe('[[2,0],[0,3]]');
    expect(
      ce
        .box(['MatrixPower', DIAG, ['Divide', 3, 2]] as any)
        .N()
        .toString()
    ).toBe('[[8,0],[0,27]]');
    // Any other non-integer exponent has no closed form here and stays
    // inert — no value is invented for it.
    expect(ce.box(['MatrixPower', M, 2.5] as any).evaluate().operator).toBe(
      'MatrixPower'
    );
  });

  test('NaN and infinite CELLS propagate by IEEE through the product', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'MatrixPower',
          ['List', ['List', 'NaN', 0], ['List', 0, 1]],
          2,
        ] as any)
        .evaluate()
        .toString()
    ).toBe('[[NaN,NaN],[NaN,1]]');
    expect(
      ce
        .box([
          'MatrixPower',
          ['List', ['List', 'PositiveInfinity', 0], ['List', 0, 1]],
          2,
        ] as any)
        .evaluate()
        .toString()
    ).toBe('[[+oo,NaN],[NaN,1]]');
  });

  test('the `A^n` parse route routes to MatrixPower unchanged', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}^2');
    expect(e.operator).toBe('MatrixPower');
    expect(e.evaluate().toString()).toBe('[[7,10],[15,22]]');
  });
});

describe('Determinant — Contract B declaration', () => {
  test('the carrier already excludes NaN, and the policy is reject', () => {
    const ce = new ComputeEngine();
    const def = opDef(ce, 'Determinant');
    expect(def.resolvedNanBehaviorAt(0)).toBe('reject');
    expect(def.resolvedPartiality).toBe('may-marker');
    expectIncompatible(ce.box(['Determinant', 'NaN'] as any));
    expectIncompatible(ce.box(['Determinant', 5] as any));
    expectIncompatible(ce.box(['Determinant', ['List', 1, 2]] as any));
    expectIncompatible(ce.box(['Determinant', { str: 'a' }] as any));
  });

  test('the result stays in the entries ring or field', () => {
    // A determinant is a polynomial in the entries — sums of products — so
    // the tier of the entries carries over.
    const ce = new ComputeEngine();
    const type = (m: any) => ce.box(['Determinant', m] as any).type.toString();
    expect(type(M)).toBe('integer');
    expect(type(['List', ['List', ['Divide', 1, 2], 2], ['List', 3, 4]])).toBe(
      'rational'
    );
    expect(type(['List', ['List', 1.5, 2], ['List', 3, 4]])).toBe('real');
    expect(type(['List', ['List', 'i', 2], ['List', 3, 4]])).toBe('complex');
    // An entry that may be an infinity or NaN can give `∞ − ∞`, a symbolic
    // entry gives an expression, and a statically non-square matrix has no
    // determinant at all: each declines to the declared `number`.
    expect(type(['List', ['List', 1, 'NaN'], ['List', 3, 4]])).toBe('number');
    expect(type(['List', ['List', 'a', 'b'], ['List', 'c', 'd']])).toBe(
      'number'
    );
    expect(type(['List', ['List', 1, 2, 3], ['List', 4, 5, 6]])).toBe('number');
  });

  test('NaN and infinite cells are computed by IEEE inside the handler', () => {
    const ce = new ComputeEngine();
    const value = (m: any) =>
      ce
        .box(['Determinant', m] as any)
        .evaluate()
        .toString();
    expect(value(M)).toBe('-2');
    // 1·4 − ∞·3 = −∞.
    expect(
      value(['List', ['List', 1, 'PositiveInfinity'], ['List', 3, 4]])
    ).toBe('-oo');
    // ∞·∞ − 1·1 = +∞.
    expect(
      value([
        'List',
        ['List', 'PositiveInfinity', 1],
        ['List', 1, 'PositiveInfinity'],
      ])
    ).toBe('+oo');
    expect(value(['List', ['List', 1, 'NaN'], ['List', 3, 4]])).toBe('NaN');
    expect(value(['List', ['List', 1, 2, 3], ['List', 4, 5, 6]])).toContain(
      'expected-square-matrix'
    );
  });

  test('the parse route agrees with the box route', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('\\det\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}');
    expect(e.type.toString()).toBe('integer');
    expect(e.evaluate().toString()).toBe('-2');
    expectIncompatible(ce.parse('\\det(5)'));
  });
});
