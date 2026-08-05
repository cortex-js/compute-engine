import { ComputeEngine } from '../../src/compute-engine';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';

/**
 * `IdenticallyEqual` (`\equiv`) and its API twin `.isIdenticallyEqual()` —
 * the PROVER tier of the equality ladder:
 *
 * | Tier | Operator | Method |
 * | --- | --- | --- |
 * | Structural | `Same` (`===`) | `.isSame()` |
 * | Arithmetic | `Equal` (`=`) | `.isEqual()` |
 * | Identity | `IdenticallyEqual` (`\equiv`) | `.isIdenticallyEqual()` |
 *
 * See `docs/plans/2026-08-04-cheap-equal-audit.md`.
 */

const ce = new ComputeEngine();

describe('.isIdenticallyEqual() — the prover, via the API method', () => {
  test('a trigonometric identity', () => {
    expect(
      ce.parse('\\sin^2(x)+\\cos^2(x)').isIdenticallyEqual(ce.box(1))
    ).toBe(true);
  });

  test('an algebraic identity', () => {
    expect(
      ce.parse('(x+1)^2').isIdenticallyEqual(ce.parse('x^2+2x+1'))
    ).toBe(true);
    expect(ce.parse('x \\cdot x').isIdenticallyEqual(ce.parse('x^2'))).toBe(
      true
    );
  });

  test('a NON-identity is `undefined`, not `false` (D9)', () => {
    // A sampled disagreement refutes identity-in-all-variables, but under the
    // "truth under constraints" contract an assumption could still make the
    // two sides equal, so it degrades to `undefined`.
    expect(ce.parse('x+1').isIdenticallyEqual(ce.parse('x+2'))).toBe(undefined);
  });

  test('decidable, variable-free comparisons still decide', () => {
    expect(ce.parse('2+2').isIdenticallyEqual(ce.box(4))).toBe(true);
    expect(ce.parse('2+2').isIdenticallyEqual(ce.box(5))).toBe(false);
  });
});

describe('relation equivalence routes through the prover', () => {
  // Two relations are equivalent when they have the same solution set: an
  // identity question in the free variables of the operands. The comparison
  // handlers (`inequalityEq`, `NotEqual`'s `eq:`) therefore call
  // `.isIdenticallyEqual()`, not the arithmetic `.isEqual()` tier — with the
  // cheap tier `2(13.1+x)<(10-5)` vs `26.2+2x<5` reported a wrong `false`.
  test('an inequality vs its expanded form', () => {
    expect(
      ce.parse('2(13.1+x)<(10-5)').isIdenticallyEqual(ce.parse('26.2+2x<5'))
    ).toBe(true);
  });

  test('an inequality vs the same relation written in the opposite direction', () => {
    expect(ce.parse('x+1>2').isIdenticallyEqual(ce.parse('2<x+1'))).toBe(true);
  });

  test('an equation vs its expanded form', () => {
    expect(
      ce.parse('2(13.1+x)=(10-5)').isIdenticallyEqual(ce.parse('26.2+2x=5'))
    ).toBe(true);
  });

  test('a NotEqual vs its expanded (and commuted) form', () => {
    expect(
      ce.parse('(x+1)^2 \\ne 0').isIdenticallyEqual(ce.parse('x^2+2x+1 \\ne 0'))
    ).toBe(true);
    expect(
      ce.parse('(x+1)^2 \\ne 0').isIdenticallyEqual(ce.parse('0 \\ne x^2+2x+1'))
    ).toBe(true);
  });

  test('the CHEAP tier declines on relations', () => {
    // Relation equivalence is prover-only: the `eq:` hooks of `Equal`,
    // `NotEqual` and the inequalities decline when `eq()` calls them with
    // `prover === false`, so `.isEqual()` reports `undefined` rather than
    // silently paying for (and answering with) the prover.
    expect(ce.parse('2(13.1+x)<(10-5)').isEqual(ce.parse('26.2+2x<5'))).toBe(
      undefined
    );
    expect(ce.parse('2(13.1+x)=(10-5)').isEqual(ce.parse('26.2+2x=5'))).toBe(
      undefined
    );
    expect(
      ce.parse('(x+1)^2 \\ne 0').isEqual(ce.parse('x^2+2x+1 \\ne 0'))
    ).toBe(undefined);
  });

  test('an UNDECIDED relation pair is `undefined`, never `false`', () => {
    // Pairwise non-identity of the operands does not prove the two relations
    // have different solution sets (`x < 1` and `x+1 < 2` do not match
    // pairwise yet are equivalent), so the comparison declines.
    expect(ce.parse('x<1').isIdenticallyEqual(ce.parse('y<1'))).toBe(undefined);
    expect(ce.parse('x<1').isEqual(ce.parse('y<1'))).toBe(undefined);
    expect(ce.parse('x \\ne 1').isIdenticallyEqual(ce.parse('y \\ne 1'))).toBe(
      undefined
    );
    // `Equal` of two relations decomposes into a comparison CHAIN
    // (`a < b = c < d`), so it stays inert rather than collapsing to `False`.
    const chain = ce
      .box(['Equal', ce.parse('x<1'), ce.parse('y<1')])
      .evaluate();
    expect(chain.symbol).toBe(undefined);
  });
});

describe('IdenticallyEqual operator — dimensioned quantities', () => {
  test('`5 m ≡ 500 cm` is True (the `Equal` fast path)', () => {
    expect(
      ce
        .box([
          'IdenticallyEqual',
          ce.parse('5\\,\\mathrm{m}'),
          ce.parse('500\\,\\mathrm{cm}'),
        ])
        .evaluate().symbol
    ).toBe('True');
    // …and the same comparison on `Equal`, for reference.
    expect(
      ce
        .box([
          'Equal',
          ce.parse('5\\,\\mathrm{m}'),
          ce.parse('500\\,\\mathrm{cm}'),
        ])
        .evaluate().symbol
    ).toBe('True');
    // Incompatible magnitudes still decide `False`.
    expect(
      ce
        .box([
          'IdenticallyEqual',
          ce.parse('5\\,\\mathrm{m}'),
          ce.parse('501\\,\\mathrm{cm}'),
        ])
        .evaluate().symbol
    ).toBe('False');
  });
});

describe('IdenticallyEqual operator — route parity (parse + box)', () => {
  test('an identity evaluates to True on the PARSE route', () => {
    expect(
      ce.parse('\\sin^2(x)+\\cos^2(x) \\equiv 1').evaluate().symbol
    ).toBe('True');
    expect(ce.parse('(x+1)^2 \\equiv x^2+2x+1').evaluate().symbol).toBe('True');
  });

  test('an identity evaluates to True on the BOX route', () => {
    expect(
      ce
        .box([
          'IdenticallyEqual',
          ['Add', ['Power', ['Sin', 'x'], 2], ['Power', ['Cos', 'x'], 2]],
          1,
        ])
        .evaluate().symbol
    ).toBe('True');
  });

  test('a decidable numeric comparison decides', () => {
    expect(ce.parse('2+2 \\equiv 4').evaluate().symbol).toBe('True');
    expect(ce.parse('2+2 \\equiv 5').evaluate().symbol).toBe('False');
  });

  test('an undecidable comparison stays INERT (like `Equal`)', () => {
    const e = ce.parse('x \\equiv y').evaluate();
    expect(e.operator).toBe('IdenticallyEqual');
    expect(e.symbol).toBe(undefined);
    // A sampled disagreement is not a `False` either.
    expect(ce.parse('x+1 \\equiv x+2').evaluate().operator).toBe(
      'IdenticallyEqual'
    );
  });

  test('round-trips through LaTeX as an infix `\\equiv`', () => {
    expect(ce.parse('a \\equiv b').json).toEqual(['IdenticallyEqual', 'a', 'b']);
    expect(ce.parse('a \\equiv b').latex).toBe('a\\equiv b');
    expect(ce.box(['IdenticallyEqual', 'a', 'b']).latex).toBe('a\\equiv b');
  });

  test('the Unicode ≡ and the negated forms parse to the same head', () => {
    expect(ce.parse('a ≡ b').json).toEqual(['IdenticallyEqual', 'a', 'b']);
    expect(ce.parse('a \\not\\equiv b').json).toEqual([
      'Not',
      ['IdenticallyEqual', 'a', 'b'],
    ]);
  });

  test('a chain decomposes like an `Equal` chain (n-ary)', () => {
    expect(ce.parse('a \\equiv b \\equiv c').json).toEqual([
      'IdenticallyEqual',
      'a',
      'b',
      'c',
    ]);
    expect(ce.parse('2+2 \\equiv 4 \\equiv 8/2').evaluate().symbol).toBe('True');
    expect(ce.parse('2+2 \\equiv 4 \\equiv 5').evaluate().symbol).toBe('False');
  });
});

describe('IdenticallyEqual — what it does NOT change', () => {
  test('`\\equiv … \\pmod n` is still a congruence', () => {
    expect(ce.parse('a \\equiv b \\pmod 7').json).toEqual([
      'Congruent',
      'a',
      'b',
      7,
    ]);
    expect(ce.parse('7 \\equiv 1 \\pmod 3').evaluate().symbol).toBe('True');
  });

  test('`\\iff` is still the logical biconditional `Equivalent`', () => {
    // UPPERCASE symbols in boolean contexts (a boolean use retypes a symbol
    // for the engine's lifetime).
    expect(ce.parse('P \\iff Q').json).toEqual(['Equivalent', 'P', 'Q']);
    expect(ce.parse('P \\iff Q').latex).toBe('P\\iff Q');
    expect(ce.parse('P \\Leftrightarrow Q').json).toEqual([
      'Equivalent',
      'P',
      'Q',
    ]);
  });

  test('it is NOT broadcastable: a list operand compares as a whole', () => {
    expect(
      ce.box(['IdenticallyEqual', ['List', 1, 2], ['List', 1, 2]]).evaluate()
        .symbol
    ).toBe('True');
  });
});

describe('IdenticallyEqual — compilation fails closed', () => {
  test('there is no lowering for the prover', () => {
    // Like `Same`, `IdenticallyEqual` has no sound numeric lowering (it is a
    // symbolic prover, not a comparison), so no target declares a handler and
    // compilation fails closed with the head.
    const e = new ComputeEngine();
    e.declare('x', 'number');
    const js = new JavaScriptTarget();
    expect(() => js.compile(e.box(['IdenticallyEqual', 'x', 1]))).toThrow(
      /IdenticallyEqual.*no lowering.*Fail closed/s
    );
  });
});
