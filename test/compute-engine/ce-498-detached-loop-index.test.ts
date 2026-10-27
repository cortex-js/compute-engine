import { ComputeEngine } from '../../src/compute-engine';

// CE-498: a part of a loop body taken out of its `Loop` read a loop index
// named `i` as the imaginary unit. Its `toString()` (which evaluates a lazy
// collection such as `ReplaceAt` to print it) showed an `incompatible-type`
// error. An occurrence of the variable of a binder has no value outside a
// run of its binder, so the detached part now stays symbolic.

describe('CE-498: a loop index read outside its Loop', () => {
  test('a detached ReplaceAt prints the loop index i', () => {
    const ce = new ComputeEngine();
    const loop = ce.parse(
      '\\operatorname{Loop}(\\operatorname{ReplaceAt}([1,2,3], i, 9), \\operatorname{Element}(i, \\operatorname{Range}(1,3)))'
    );
    const body = loop.op1;
    expect(body.toString()).toBe('ReplaceAt([1,2,3], i, 9)');
    const value = body.evaluate();
    expect(value.json).toEqual(['ReplaceAt', ['List', 1, 2, 3], 'i', 9]);
    expect(value.type.matches(body.type)).toBe(true);
    // The index is not the imaginary unit.
    expect(body.op2.evaluate().json).toEqual('i');
  });

  test('a detached arithmetic part keeps the index symbolic', () => {
    const ce = new ComputeEngine();
    const loop = ce.parse(
      '\\operatorname{Loop}(i+1, \\operatorname{Element}(i, \\operatorname{Range}(1,3)))'
    );
    expect(loop.op1.evaluate().toString()).toBe('i + 1');
  });

  test('a detached Sum summand does not read a global of the same name', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 5);
    const sum = ce.parse('\\sum_{k=1}^{3} k^2');
    expect(sum.evaluate().json).toBe(14);
    expect(sum.op1.evaluate().toString()).toBe('k^2');
  });

  test('the loop itself still reads its index', () => {
    const ce = new ComputeEngine();
    const sum = ce.parse('\\sum_{i=1}^{3} i^2');
    expect(sum.evaluate().json).toBe(14);
  });
});
