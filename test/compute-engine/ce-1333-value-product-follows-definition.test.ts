import { ComputeEngine } from '../../src/compute-engine';
import {
  hasAnyProvisionalDependents,
  hasProvisionalDependents,
} from '../../src/compute-engine/boxed-expression/provisional-application';

// A stored body reads `a(t+1)` as the product `a·(t+1)` while `a` holds a
// number. When `a` is defined as a function later, the body is derived again
// and reads the application, as a body written after the definition does
// (`noteValueProduct()`, `provisional-application.ts`).

function run(ce: ComputeEngine, latex: string): string {
  return ce.parse(latex).evaluate().toString();
}

describe('a product read from a value follows a later function definition', () => {
  test('the name is applied, then holds a number, then is a function', () => {
    const ce = new ComputeEngine();
    run(ce, 'f(t) := a(t+1)');
    ce.assign('a', 3);
    expect(run(ce, 'f(1)')).toBe('6');
    run(ce, 'a(x) := x^2');
    expect(run(ce, 'f(1)')).toBe('4');
  });

  test('the name holds a number before the body is defined', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 3);
    run(ce, 'g(t) := a(t+1)');
    expect(run(ce, 'g(1)')).toBe('6');
    run(ce, 'a(x) := x^2');
    expect(run(ce, 'g(1)')).toBe('4');
  });

  test('the name is declared real before the body is defined', () => {
    const ce = new ComputeEngine();
    ce.declare('b', 'real');
    run(ce, 'k(t) := b(t+1)');
    run(ce, 'b(x) := x^2');
    expect(run(ce, 'k(1)')).toBe('4');
  });

  test('a function value given with assign() is applied', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 3);
    run(ce, 'g(t) := a(t+1)');
    ce.assign('a', ce.parse('x \\mapsto x^2'));
    expect(run(ce, 'g(1)')).toBe('4');
  });

  test('a product in a longer juxtaposition is applied', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 3);
    run(ce, 'g(t) := 2a(t+1)');
    expect(run(ce, 'g(1)')).toBe('12');
    run(ce, 'a(x) := x^2');
    expect(run(ce, 'g(1)')).toBe('8');
  });

  test('a product through a power is applied', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 3);
    run(ce, 'g(t) := a(t+1)^2');
    expect(run(ce, 'g(1)')).toBe('12');
    run(ce, 'a(x) := x^2');
    expect(run(ce, 'g(1)')).toBe('16');
  });

  test('a name in parentheses is applied once it is a function', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 3);
    run(ce, 'g(t) := (a)(t+1)');
    expect(run(ce, 'g(1)')).toBe('6');
    run(ce, 'a(x) := x^2');
    expect(run(ce, 'g(1)')).toBe('4');
  });

  test('a new number keeps the product', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 3);
    run(ce, 'g(t) := a(t+1)');
    ce.assign('a', 5);
    expect(run(ce, 'g(1)')).toBe('10');
    // The body still waits on `a`, but it does not apply `a`.
    expect(hasAnyProvisionalDependents(ce, 'a')).toBe(true);
    expect(hasProvisionalDependents(ce, 'a')).toBe(false);
  });

  test('withValues() accepts a name that a body reads as a product', () => {
    const ce = new ComputeEngine();
    ce.declare('b', 'real');
    run(ce, 'k(t) := b(t+1)');
    expect(ce.withValues({ b: 2 }, () => run(ce, 'k(1)'))).toBe('4');
  });

  test('a constant is not waited on', () => {
    const ce = new ComputeEngine();
    ce.declare('c', { type: 'real', value: 3, isConstant: true });
    run(ce, 'g(t) := c(t+1)');
    expect(run(ce, 'g(1)')).toBe('6');
    expect(hasAnyProvisionalDependents(ce, 'c')).toBe(false);
  });
});
