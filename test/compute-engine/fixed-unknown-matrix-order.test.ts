import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';

const prepared = (ce: ComputeEngine, source: string) =>
  ce.box(resolveLibraryNames(parseEpsil(source)[0]!, source, ce));

test('fixed unknown matrix factors keep their noncommutative order', () => {
  const ce = new ComputeEngine();
  const source = 'let A:unknown=[[1,2],[0,1]]; let B:unknown=[[1,0],[3,1]]; B*A';
  const e = prepared(ce, source);
  expect(e.evaluate().json).toEqual(['List', ['List',1,2], ['List',3,7]]);
  expect(ce.symbol('A').type.toString()).toBe('unknown');
  expect(ce.symbol('B').type.toString()).toBe('unknown');
});

test('the public compiler preserves the SVD reconstruction or declines', () => {
  const ce = new ComputeEngine();
  const e = prepared(ce, 'let A=[[1,2],[3,4]]; let (U,S,V)=N(svd(A)); U*S*transpose(V)');
  const compiled = compile(e, {to:'javascript'});
  const result = compiled.run!({}) as number[][];
  [[1, 2], [3, 4]].forEach((row, i) =>
    row.forEach((x, j) => expect(result[i][j]).toBeCloseTo(x, 12))
  );
});

test('legacy scalar symbols still have the ordinary canonical product order', () => {
  const ce = new ComputeEngine();
  expect(ce.box(['Multiply','z','a']).json).toEqual(['Multiply','a','z']);
});
