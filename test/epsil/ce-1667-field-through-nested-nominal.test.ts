import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// CE-1667: a field of a value whose type is a nominal type defined as
// another nominal type (`type Wrapped = Circle`) is read through both
// layers, as the checker already types it. `w.r + 1` gave `1 + Circle(2)`.
//

function run(source: string): { value: string; diagnostics: number } {
  const r = executeEpsil(new ComputeEngine(), source);
  return { value: r.value.toString(), diagnostics: r.diagnostics.length };
}

describe('a field read through a nominal type over a nominal type', () => {
  test('one layer', () => {
    expect(
      run(`type Circle = tuple<r: number>
type Wrapped = Circle
const w: Wrapped = Wrapped(Circle(2))
w.r + 1`)
    ).toEqual({ value: '3', diagnostics: 0 });
  });

  test('two layers', () => {
    expect(
      run(`type Circle = tuple<r: number, s: number>
type A = Circle
type B = A
const w: B = B(A(Circle(2, 5)))
w.s`)
    ).toEqual({ value: '5', diagnostics: 0 });
  });

  test('a field whose value is a nominal value is not read through', () => {
    expect(
      run(`type Circle = tuple<r: number>
type box = tuple<inner: Circle>
const b = box(Circle(2))
b.inner`)
    ).toEqual({ value: 'Circle(2)', diagnostics: 0 });
  });
});
