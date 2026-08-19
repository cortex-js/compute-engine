import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// Arithmetic operators are permissive at boxing time: a `value`-typed symbol
// is admitted into a numeric position because it COULD be a number, even
// though it may legally hold a string. The other half of that contract is
// enforced here: once operand evaluation substitutes a value that PROVES
// non-numeric, the numeric evaluate handlers surface an `incompatible-type`
// error (`nonNumericOperandError`, library/arithmetic.ts). Without the guard
// the mistake either lingered inert (`2 · "hello"`) or was silently absorbed
// into a numeric result (`Negate`/`Sqrt` produced `NaN`, the `0 · x → 0`
// collapse produced `0`).
//
// The probes bind the symbol AFTER boxing: with the value already present,
// the evidence guard reports the mismatch at canonicalization instead, so a
// deferred assignment is the only route that reaches the evaluate handlers.

function evalWithString(latex: string): string {
  const ce = new ComputeEngine();
  ce.declare('a', 'value');
  const boxed = ce.parse(latex); // boxed while `a` is valueless
  ce.assign('a', ce.string('hello')); // legal under `value`
  return boxed.evaluate().toString();
}

describe('non-numeric value in a numeric evaluate handler errors', () => {
  test.each([
    ['Add', 'a+1'],
    ['Multiply (juxtaposition)', '2a'],
    ['Multiply (explicit)', '2\\cdot a'],
    ['Multiply (zero collapse)', '0a'],
    // `\frac{a}{2}` folds to `Multiply(1/2, a)` at canonicalization, so a
    // symbolic denominator is needed to keep an actual `Divide` node with
    // the bad value in numerator position.
    ['Divide (numerator)', '\\frac{a}{x}'],
    ['Divide (denominator)', '\\frac{2}{a}'],
    ['Negate', '-a'],
    ['Power (base)', 'a^2'],
    ['Power (exponent)', '2^a'],
    ['Sqrt', '\\sqrt{a}'],
    ['Root', '\\sqrt[3]{a}'],
    // Ln/Log absorbed the string into `NaN` via the inherited `ln()` before
    // they were guarded; Lb/Lg/Log2/Log10 canonicalize to Log, so these two
    // rows cover the whole log family.
    ['Ln', '\\ln a'],
    ['Log', '\\log_{10} a'],
  ])('%s: an error, not an inert or numeric result', (_op, latex) => {
    const result = evalWithString(latex);
    expect(result).toContain('incompatible-type');
    // The absorption bugs turned these into plain numbers — pin against it.
    expect(result).not.toBe('NaN');
    expect(result).not.toBe('0');
  });

  test('a numeric binding through the same shapes still evaluates', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'value');
    const sum = ce.parse('a+1');
    const prod = ce.parse('2a');
    ce.assign('a', 3);
    expect(sum.evaluate().json).toEqual(4);
    expect(prod.evaluate().json).toEqual(6);
  });

  test('valueless symbols, broadcast, and absence markers are untouched', () => {
    const ce = new ComputeEngine();
    // A free symbol could still be a number: stays symbolic.
    expect(ce.parse('x+1').evaluate().toString()).toBe('x + 1');
    // Collections are consumed by broadcast before the guard matters.
    expect(ce.box(['Add', ['List', 1, 2], 1]).evaluate().json).toEqual([
      'List',
      2,
      3,
    ]);
    // Absence markers propagate (here: lifted at flatten), never error.
    expect(ce.box(['Multiply', 0, 'Nothing']).evaluate().json).toEqual(0);
  });

  test('Epsil route: a branch-hidden string binding still surfaces an error', () => {
    // The static pre-pass tracks only TOP-LEVEL assignment effects, so the
    // binding inside the `if` is invisible to it — no static diagnostic.
    // The final statement is boxed at execution time, when the binding IS
    // present, so the evidence check reports the mismatch there (one stage
    // before the evaluate-handler guard, which covers bindings that appear
    // after boxing).
    const r = executeEpsil(
      new ComputeEngine(),
      'a: value\nif 1 < 2 { a = "hello" }\n2 * a'
    );
    expect(r.value.toString()).toContain('incompatible-type');
  });

  test('Epsil route: an assignment inside one statement reaches the evaluate guard', () => {
    // The whole `do` block is boxed BEFORE any of it runs, so `2 * a` is
    // canonicalized while `a` is still valueless — no boxing-time evidence
    // check possible. The binding happens mid-evaluation, so the error can
    // only come from the evaluate-handler guard; it names the substituted
    // VALUE ("hello"), unlike the evidence check, which blames the symbol
    // and its declared type.
    const r = executeEpsil(
      new ComputeEngine(),
      'a: value\ndo { a = "hello"; 2 * a }'
    );
    expect(r.value.toString()).toContain('incompatible-type');
    expect(r.value.toString()).toContain('hello');
  });
});
