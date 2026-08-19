import { ComputeEngine } from '../../src/compute-engine';

// "Option B" for And/Or (user-ruled 2026-08-16; ROADMAP "Symbolic-side
// commutativity for `And`/`Or`"): the short-circuit conversion made the tree
// ordered — operands evaluate left to right and the canonical form preserves
// written order — which cost the symbolic side two properties. This restores
// both at the VALUE-level entry points, leaving order to the program:
//   1. `isEqual`/`isIdenticallyEqual` compare And/Or modulo permutation and
//      nesting of operands (the operators' `eq` handlers,
//      `acEquivalentBoolean` in `symbolic/logic-utils.ts` — both sides are
//      EVALUATED first, so the order-sensitive parts of evaluation
//      (short-circuit, Kleene absence, error-valued deciders) are honored,
//      and only the undecided residue is AC-matched).
//   2. `match` tries operand permutations again, via the `commutativeMatch`
//      flag — permutation matching decoupled from the canonical sort that
//      the `commutative` flag would impose.
// `isSame` stays strictly syntactic, everywhere.

// UPPERCASE symbols in boolean contexts, per the shared-engine convention:
// boolean use retypes a symbol for the engine's lifetime.
let ce: ComputeEngine;
beforeAll(() => {
  ce = new ComputeEngine();
  ce.declare('A', 'boolean');
  ce.declare('B', 'boolean');
  ce.declare('C', 'boolean');
});

describe('AC-equivalence at isEqual/isIdenticallyEqual', () => {
  test('permuted operands compare equal', () => {
    expect(ce.box(['And', 'A', 'B']).isEqual(ce.box(['And', 'B', 'A']))).toBe(
      true
    );
    expect(ce.box(['Or', 'A', 'B']).isEqual(ce.box(['Or', 'B', 'A']))).toBe(
      true
    );
    expect(
      ce.box(['And', 'A', 'B']).isIdenticallyEqual(ce.box(['And', 'B', 'A']))
    ).toBe(true);
  });

  test('nesting is transparent: And(A, And(B, C)) equals And(C, B, A)', () => {
    expect(
      ce
        .box(['And', 'A', ['And', 'B', 'C']])
        .isEqual(ce.box(['And', 'C', 'B', 'A']))
    ).toBe(true);
    expect(
      ce
        .box(['Or', ['Or', 'A', 'B'], 'C'])
        .isEqual(ce.box(['Or', 'C', ['Or', 'B', 'A']]))
    ).toBe(true);
  });

  test('a large permutation resolves through the unbounded syntactic pass', () => {
    // 14 operands: far past any bounded permutation search. The syntactic
    // multiset pass has no size limit, so expression size never decides
    // the equality answer for structurally-pairable operands.
    const syms = Array.from({ length: 14 }, (_, i) => `V${i}`);
    for (const s of syms) ce.declare(s, 'boolean');
    expect(
      ce
        .box(['And', ...syms])
        .isEqual(ce.box(['And', ...[...syms].reverse()]))
    ).toBe(true);
  });

  test('residual operands pair at the value tier, not just syntactically', () => {
    // 2·sin y·cos y < 1/2 and sin 2y < 1/2 are the same relation by the
    // double-angle identity: not `isSame`, undecided at the cheap tier,
    // proved at the prover tier — so the conjunctions pair only at
    // `isIdenticallyEqual`, through the value-level matching pass.
    ce.declare('y', 'real');
    const p1: any = [
      'Less',
      ['Multiply', 2, ['Sin', 'y'], ['Cos', 'y']],
      ['Divide', 1, 2],
    ];
    const p2: any = ['Less', ['Sin', ['Multiply', 2, 'y']], ['Divide', 1, 2]];
    // Preconditions: the operands themselves are non-syntactic pairs.
    expect(ce.box(p1).isSame(ce.box(p2))).toBe(false);
    expect(ce.box(p1).isEqual(ce.box(p2))).toBeUndefined();
    expect(ce.box(p1).isIdenticallyEqual(ce.box(p2))).toBe(true);
    // The prover tier pairs them inside the conjunction; the cheap tier
    // stays undecided.
    expect(
      ce.box(['And', 'A', p1]).isIdenticallyEqual(ce.box(['And', p2, 'A']))
    ).toBe(true);
    expect(
      ce.box(['And', 'A', p1]).isEqual(ce.box(['And', p2, 'A']))
    ).toBeUndefined();
  });

  test('a failed pairing declines to undefined, never false', () => {
    // And(A, B) and And(A, C) coincide whenever A is False, so an operand
    // mismatch must not claim the VALUES differ.
    expect(
      ce.box(['And', 'A', 'B']).isEqual(ce.box(['And', 'A', 'C']))
    ).toBeUndefined();
  });

  test('duplicate operands compare equal through evaluation', () => {
    // The AC matcher does not model idempotence, but both sides are
    // EVALUATED before matching and the evaluator's reducer deduplicates:
    // And(A, A, B) and And(A, B) leave the same residue.
    expect(
      ce.box(['And', 'A', 'A', 'B']).isEqual(ce.box(['And', 'A', 'B']))
    ).toBe(true);
  });

  test('impure operands decline: order and draw counts stay observable', () => {
    // A random-bearing operand must not be evaluated speculatively by the
    // equality handler — even a syntactically identical multiset declines
    // and is left to the generic machinery.
    const R: any = ['Greater', ['Random'], 0.5];
    expect(
      ce.box(['And', 'A', R]).isEqual(ce.box(['And', R, 'A']))
    ).toBeUndefined();
  });

  test('isSame stays strictly syntactic: permuted operands are NOT the same', () => {
    expect(ce.box(['And', 'A', 'B']).isSame(ce.box(['And', 'B', 'A']))).toBe(
      false
    );
    expect(ce.box(['Or', 'A', 'B']).isSame(ce.box(['Or', 'B', 'A']))).toBe(
      false
    );
  });

  test('the canonical form still preserves written order', () => {
    expect(ce.box(['And', 'B', 'A']).toString()).toBe('B && A');
  });
});

describe('permutation matching (commutativeMatch)', () => {
  test('a rule pattern hits its permutation again', () => {
    const pat = ce.box(['And', ['Not', '_p'], '_p']);
    // Written order matches...
    expect(
      ce.box(['And', ['Not', 'A'], 'A']).match(pat)?._p?.toString()
    ).toBe('A');
    // ...and the permuted order matches again.
    expect(ce.box(['And', 'A', ['Not', 'A']]).match(pat)?._p?.toString()).toBe(
      'A'
    );
    // Same for Or.
    const orPat = ce.box(['Or', ['Not', '_p'], '_p']);
    expect(ce.box(['Or', 'A', ['Not', 'A']]).match(orPat)?._p?.toString()).toBe(
      'A'
    );
  });

  test('an exact written-order match survives past the permutation bound', () => {
    // The permutation generator refuses more than six operands; positional
    // matching is itself a permutation, so the exact-order fallback must
    // recover a seven-wildcard pattern.
    for (const s of ['W0', 'W1', 'W2', 'W3', 'W4', 'W5', 'W6'])
      ce.declare(s, 'boolean');
    const pat = ce.box(['And', '_a', '_b', '_c', '_d', '_e', '_f', '_g']);
    const target = ce.box(['And', 'W0', 'W1', 'W2', 'W3', 'W4', 'W5', 'W6']);
    const m = target.match(pat);
    expect(m).not.toBeNull();
    expect(m?._a?.json).toBe('W0');
    expect(m?._g?.json).toBe('W6');
  });

  test('contradiction and tautology fold regardless of operand order', () => {
    expect(ce.box(['And', 'A', ['Not', 'A']]).evaluate().json).toBe('False');
    expect(ce.box(['And', ['Not', 'A'], 'A']).evaluate().json).toBe('False');
    expect(ce.box(['Or', 'A', ['Not', 'A']]).evaluate().json).toBe('True');
    expect(ce.box(['Or', ['Not', 'A'], 'A']).evaluate().json).toBe('True');
  });
});
