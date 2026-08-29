/**
 * Pins for the 2026-08-24 rulings on canonical rewrites that dropped the
 * rewritten operator's stricter parameter contract (ROADMAP: "A canonical
 * rewrite drops the rewritten operator's stricter parameter contract"),
 * plus the two defects the inventory surfaced (`Divides` reducing through
 * the rounding `toBigint`, and single-operand `Intersection` hard-coded to
 * the empty set).
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

/** An `any`-typed symbol holding `value` — the permissive route that used to
 * slip past the contract the canonical rewrite dropped. */
let holderCount = 0;
function anySymbolHolding(value: Expression): Expression {
  const name = `__h${++holderCount}`;
  ce.declare(name, 'any');
  ce.assign(name, value);
  return ce.symbol(name);
}

describe('Rational: two-argument form is an (integer, integer) constructor', () => {
  test('non-integer denominator literal is rejected (box route)', () => {
    const expr = ce.box(['Rational', 3, 2.5]);
    expect(expr.isValid).toBe(false);
  });

  test('non-integer denominator literal is rejected (function route)', () => {
    const expr = ce.function('Rational', [ce.box(3), ce.box(2.5)]);
    expect(expr.isValid).toBe(false);
  });

  test('symbol holding a non-integer is rejected (was: evaluated to 1.2)', () => {
    const expr = ce.function('Rational', [ce.box(3), anySymbolHolding(ce.box(2.5))]);
    expect(expr.isValid).toBe(false);
  });

  test('non-integer numerator literal is rejected', () => {
    expect(ce.box(['Rational', 2.5, 3]).isValid).toBe(false);
  });

  test('a valueless number-typed symbol still admits and rewrites to Divide', () => {
    ce.declare('rq', 'number');
    const expr = ce.function('Rational', [ce.box(3), ce.symbol('rq')]);
    expect(expr.isValid).toBe(true);
    expect(expr.operator).toBe('Divide');
  });

  test('integer arguments construct the exact rational', () => {
    expect(ce.box(['Rational', 6, 4]).evaluate().json).toEqual([
      'Rational',
      3,
      2,
    ]);
  });

  test('single-argument form still rationalizes a real', () => {
    expect(ce.box(['Rational', 2.5]).evaluate().json).toEqual([
      'Rational',
      5,
      2,
    ]);
  });

  test('single-argument form rejects a complex argument (declared real)', () => {
    expect(ce.box(['Rational', ['Complex', 1, 1]]).isValid).toBe(false);
  });
});

describe('Divides: no reduction through the rounding toBigint', () => {
  // The contract this block protects is that a non-integer operand never
  // reduces to a boolean through `toBigint`'s ROUNDING — `Divides(2.5, 3)`
  // must not answer the rounded question `3 | 3` → `True`.
  //
  // The REMEDY changed on 2026-08-29. It used to be inertness, because the
  // parameters were declared `(number, number)` and so admitted `2.5`; they
  // now declare `(integer, integer)` like the other number-theory heads, so a
  // provably non-integer operand is refused at the signature instead (ruling
  // L9(a)). That is the same contract enforced earlier and more loudly: the
  // wrong boolean is still impossible, and the caller now learns why. The
  // handler's integrality gate stays — a SYMBOLIC operand is still admitted
  // and still reaches it undecided.
  test('Divides(2.5, 3) is refused, never rounded to 3 | 3 → True', () => {
    const result = ce.box(['Divides', 2.5, 3]).evaluate();
    expect(result.symbol).not.toBe('True');
    expect(result.toString()).toContain('incompatible-type');
  });

  test('NotDivides(2.5, 3) is refused through its Not(Divides(…)) rewrite', () => {
    const result = ce.box(['NotDivides', 2.5, 3]).evaluate();
    expect(result.symbol).not.toBe('True');
    expect(result.toString()).toContain('incompatible-type');
  });

  test('a SYMBOLIC operand is still admitted and stays unevaluated', () => {
    // The carrier refuses only what the types PROVE non-integer, so the
    // symbolic route the previous remedy protected is untouched.
    const result = ce.box(['Divides', 'a', 'b']).evaluate();
    expect(result.operator).toBe('Divides');
    expect(result.toString()).not.toContain('incompatible-type');
  });

  test('integer divisibility still decides', () => {
    expect(ce.box(['Divides', 3, 12]).evaluate().symbol).toBe('True');
    expect(ce.box(['Divides', 5, 12]).evaluate().symbol).toBe('False');
    expect(ce.box(['NotDivides', 5, 12]).evaluate().symbol).toBe('True');
    // 0 divides only 0; every non-zero integer divides 0.
    expect(ce.box(['Divides', 0, 0]).evaluate().symbol).toBe('True');
    expect(ce.box(['Divides', 2, 0]).evaluate().symbol).toBe('True');
  });
});

describe('Unary Subtract/Multiply fold: non-numeric scalar evidence is rejected', () => {
  test('Multiply(s) with s := "str" is rejected (was: evaluated to "str")', () => {
    const expr = ce.function('Multiply', [anySymbolHolding(ce.string('str'))]);
    expect(expr.isValid).toBe(false);
  });

  test('Subtract(s) with s := "str" is rejected (was: evaluated to "str")', () => {
    const expr = ce.function('Subtract', [anySymbolHolding(ce.string('str'))]);
    expect(expr.isValid).toBe(false);
  });

  test('boolean evidence is rejected too', () => {
    const expr = ce.function('Multiply', [anySymbolHolding(ce.True)]);
    expect(expr.isValid).toBe(false);
  });

  test('character evidence is rejected too', () => {
    // A character LITERAL (`ce.character`), not the unevaluated
    // `['Character', 'a']` application — only a held concrete scalar is
    // evidence.
    const expr = ce.function('Multiply', [
      anySymbolHolding(ce.character('a')),
    ]);
    expect(expr.isValid).toBe(false);
  });

  test('literal routes keep refusing', () => {
    expect(ce.function('Multiply', [ce.string('str')]).isValid).toBe(false);
    expect(ce.function('Subtract', [ce.string('str')]).isValid).toBe(false);
  });

  test('a lone collection operand still folds (broadcast identity)', () => {
    const lit = ce.function('Multiply', [ce.box(['List', 1, 2])]);
    expect(lit.evaluate().json).toEqual(['List', 1, 2]);
    const held = ce.function('Multiply', [
      anySymbolHolding(ce.box(['List', 1, 2])),
    ]);
    expect(held.isValid).toBe(true);
  });

  test('a valueless symbol still folds to itself', () => {
    const expr = ce.function('Multiply', [ce.symbol('mx')]);
    expect(expr.symbol).toBe('mx');
  });

  test('at arity 2 the arithmetic evaluate guard still catches the value', () => {
    const expr = ce.function('Subtract', [
      anySymbolHolding(ce.string('str')),
      ce.box(1),
    ]);
    expect(expr.evaluate().isValid).toBe(false);
  });
});

describe('Vector: content-lenient like the rest of the tensor family', () => {
  test('non-numeric entries are accepted on both routes', () => {
    const lit = ce.box(['Vector', "'str'"]);
    expect(lit.isValid).toBe(true);
    expect(lit.operator).toBe('Matrix');
    const held = ce.function('Vector', [anySymbolHolding(ce.string('str'))]);
    expect(held.isValid).toBe(true);
  });

  test('numeric vectors are unchanged', () => {
    // The canonical form is the Matrix rewrite, typed by its payload.
    const v = ce.box(['Vector', 1, 2]);
    expect(v.type.toString()).toBe('matrix<integer^(2x1)>');
    expect(v.evaluate().json).toEqual(['List', ['List', 1], ['List', 2]]);
  });

  test('the structural tier does not claim a numeric vector type for non-numeric content', () => {
    // On the structural tier the Matrix rewrite has not happened, so the
    // type handler answers: numeric elements keep `vector<N>`, anything
    // else falls back to the honest `list`.
    const num = ce.function('Vector', [ce.box(1), ce.box(2)], {
      form: 'structural',
    });
    expect(num.type.toString()).toBe('vector<2>');
    const str = ce.function('Vector', [ce.string('s')], {
      form: 'structural',
    });
    expect(str.type.toString()).toBe('list');
  });
});

describe('Intersection: a single operand is that collection as a set', () => {
  test('single list operand (was: hard-coded EmptySet)', () => {
    expect(ce.box(['Intersection', ['List', 1, 2, 2]]).evaluate().json).toEqual(
      ['Set', 1, 2]
    );
  });

  test('single set operand', () => {
    expect(ce.box(['Intersection', ['Set', 1, 2]]).evaluate().json).toEqual([
      'Set',
      1,
      2,
    ]);
  });

  test('no operands is still the empty set', () => {
    expect(ce.box(['Intersection']).symbol).toBe('EmptySet');
  });

  test('a single set-shaped operand returns itself, even infinite', () => {
    expect(ce.box(['Intersection', 'Integers']).evaluate().symbol).toBe(
      'Integers'
    );
  });

  test('a symbolic single operand stays inert', () => {
    const expr = ce.box(['Intersection', 'H']).evaluate();
    expect(expr.operator).toBe('Intersection');
  });

  test('two operands are unchanged', () => {
    expect(
      ce.box(['Intersection', ['List', 1, 2, 3], ['List', 2, 3, 4]]).evaluate()
        .json
    ).toEqual(['Set', 2, 3]);
  });
});

describe('FromContinuedFraction: non-integer terms decline instead of rounding', () => {
  test('integer terms reconstruct', () => {
    expect(
      ce.box(['FromContinuedFraction', ['List', 2, 3, 1, 4]]).evaluate().json
    ).toEqual(['Rational', 43, 19]);
  });

  test('a non-integer term stays symbolic (was: reconstructed from the rounded term)', () => {
    const result = ce
      .box(['FromContinuedFraction', ['List', 2, 2.5]])
      .evaluate();
    expect(result.operator).toBe('FromContinuedFraction');
  });
});
