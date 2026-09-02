/**
 * The membership predicates `isNumber`, `isInteger` and `isRational` answer
 * THREE-valued on every expression shape (ruled 2026-09-02): `true` means
 * the value is certainly a member, `false` that it certainly is not, and
 * `undefined` that the claimed type does not decide it.
 *
 * A function expression used to answer two-valued from its claimed type —
 * `false` for "not a subtype" — so `Divide(k, 2)` for an integer `k`, which
 * claims `real`, was reported "certainly not an integer" although it is one
 * for an even `k`; and a symbol declared `number | string` was reported
 * "certainly not a number".
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('k', 'integer');
ce.declare('r', 'real');
ce.declare('im', 'imaginary');
ce.declare('ns', 'number | string');
ce.declare('anything', 'any');
ce.declare('s', 'string');

describe('membership predicates are three-valued on function expressions', () => {
  test('a claimed `real` leaves integrality undecided', () => {
    const half = ce.box(['Divide', 'k', 2]);
    expect(half.type.toString()).toBe('real');
    expect(half.isInteger).toBeUndefined();
    expect(half.isRational).toBeUndefined();
    expect(half.isNumber).toBe(true);
  });

  test('a claimed `integer` proves membership', () => {
    const e = ce.box(['Add', 'k', 1]);
    expect(e.isInteger).toBe(true);
    expect(e.isRational).toBe(true);
    expect(e.isNumber).toBe(true);
  });

  test('a provably disjoint claim refutes membership', () => {
    // A list is not a number of any kind.
    const list = ce.box(['List', 'k', 'k']);
    expect(list.isInteger).toBe(false);
    expect(list.isRational).toBe(false);
    expect(list.isNumber).toBe(false);
    // A claimed `complex` is a HEDGE (`Sqrt` of a real of unknown sign),
    // not a proof of non-reality: undecided.
    const root = ce.box(['Sqrt', 'r']);
    expect(root.type.matches('complex')).toBe(true);
    expect(root.isInteger).toBeUndefined();
  });

  test('a symbol declared with a union that admits numbers is undecided for isNumber', () => {
    expect(ce.box('ns').isNumber).toBeUndefined();
    expect(ce.box('anything').isNumber).toBeUndefined();
    expect(ce.box('s').isNumber).toBe(false);
    expect(ce.box('im').isInteger).toBe(false);
    expect(ce.box('r').isInteger).toBeUndefined();
    expect(ce.box('k').isRational).toBe(true);
  });

  test('a symbol declared `complex` is undecided: complex contains the integers', () => {
    // It used to answer `false` (a declared `complex` read as "non-real").
    ce.declare('z', 'complex');
    expect(ce.box('z').isInteger).toBeUndefined();
    expect(ce.box('z').isRational).toBeUndefined();
    expect(ce.box('z').isNumber).toBe(true);
  });
});

describe('isExtendedReal follows the same three-valued rule', () => {
  test('a bare `complex` claim is undecided, a disjoint claim is refuted', () => {
    // A declared `complex` symbol and a `complex`-claiming compound used to
    // answer `false` ("a general complex value"); `complex` contains the
    // reals, so neither is a proof.
    expect(ce.box('z').isExtendedReal).toBeUndefined();
    expect(ce.box(['Sqrt', 'r']).isExtendedReal).toBeUndefined();
    expect(ce.box('ns').isExtendedReal).toBeUndefined();
    // Provably disjoint from the extended real line: refuted.
    expect(ce.box('im').isExtendedReal).toBe(false);
    expect(ce.box('s').isExtendedReal).toBe(false);
    expect(ce.box(['List', 'r', 'r']).isExtendedReal).toBe(false);
    expect(ce.NaN.isExtendedReal).toBe(false);
    expect(ce.ComplexInfinity.isExtendedReal).toBe(false);
    // Entailed: the finite reals and the signed infinities.
    expect(ce.box('r').isExtendedReal).toBe(true);
    expect(ce.box(['Add', 'r', 1]).isExtendedReal).toBe(true);
    expect(ce.PositiveInfinity.isExtendedReal).toBe(true);
    // An assumption still refutes what the type cannot.
    const e = new ComputeEngine();
    e.assume(e.parse('\\Im(w) > 0'));
    expect(e.box('w').isExtendedReal).toBe(false);
  });

  test('the Power and Square sign folds need a PROOF of non-reality', () => {
    // `Sqrt(r)` claims `complex` for a real `r` of unknown sign, and is 0
    // at `r = 0`: its square is not provably non-zero (the fold used to
    // answer `not-zero` from the bare `complex` claim).
    expect(ce.box(['Power', ['Sqrt', 'r'], 2]).sgn).not.toBe('not-zero');
    expect(ce.box(['Square', ['Sqrt', 'r']]).sgn).not.toBe('not-zero');
    // A pure-imaginary base is provably non-real, hence non-zero.
    expect(ce.box(['Power', 'im', 3]).sgn).toBe('unsigned');
    expect(ce.box(['Power', 'im', 2]).sgn).toBe('negative');
    expect(ce.box(['Square', 'im']).sgn).toBe('negative');
  });
});

describe('a never-typed operand makes every application never', () => {
  test('a declare-then-assign function agrees with a library operator', () => {
    const e = new ComputeEngine();
    e.declare('nev', 'integer<2<..<3>');
    e.declare('f', '(number) -> number');
    e.assign('f', e.parse('x \\mapsto x + 1'));
    expect(e.box(['f', 'nev']).type.toString()).toBe('never');
    expect(e.box(['Fract', 'nev']).type.toString()).toBe('never');
  });
});
