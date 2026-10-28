import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// CE-581: the `run()` of a `javascript` compilation accepts an array for a
// symbol that the code reads as a list, and its TypeScript type admits it
// (no cast). `scripts/typecheck.sh` type-checks this file (ts-jest does not),
// so `npm run typecheck` fails if the type refuses these arrays, or if it
// accepts a typed array, which `run()` refuses at run time.
describe('CE-581 a list argument of run() type-checks', () => {
  const ce = new ComputeEngine();
  ce.declare('S', 'list<real>');
  ce.declare('P', 'list<tuple<real, real>>');
  ce.declare('x', 'real');

  test('a list of numbers', () => {
    const r = compile(ce.parse('\\sum_{k=1}^{3} S_k'));
    expect(r.run!({ S: [1, 2, 3] })).toBe(6);
    // @ts-expect-error A typed array is refused at run time, with a message.
    expect(() => r.run!({ S: new Float64Array([1, 2, 3]) })).toThrow(
      /typed array/
    );
  });

  test('a list of points', () => {
    const r = compile(ce.box(['At', 'P', 2]));
    expect(r.run!({ P: [[1, 2], [3, 4]] })).toEqual([3, 4]);
  });

  test('an array at a scalar binding is refused, with a message', () => {
    // Before, JavaScript converted the array to a string: `x + 1` with
    // `x = [1, 2]` gave `"1,21"`.
    const x = compile(ce.parse('x + 1'));
    expect(() => x.run!({ x: [1, 2] })).toThrow(
      /"x" was compiled as a real number but received an array/
    );
  });

  test('an undeclared symbol still broadcasts over an array', () => {
    // Only a symbol that the host declared with a number type refuses an
    // array: the compiled code can broadcast a call over an array bound to
    // an undeclared symbol at run time.
    const local = new ComputeEngine();
    local.parse('q(t) := 4t + 1').evaluate();
    const r = compile(local.box(['q', 'w']));
    expect(r.run!({ w: [1, 2, 3] })).toEqual([5, 9, 13]);
  });

  test('a union with a list member still accepts an array', () => {
    const local = new ComputeEngine();
    local.declare('u', 'real | list<real>');
    const r = compile(local.parse('u + 1'));
    expect(r.run!({ u: [1, 2] })).toEqual([2, 3]);
    expect(r.run!({ u: 3 })).toBe(4);
  });
});
