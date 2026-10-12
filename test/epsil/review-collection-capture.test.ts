import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

function run(source: string) {
  const ce = new ComputeEngine();
  const result = executeEpsil(ce, source, {
    parseLatex: (latex) => ce.parse(latex).json,
  });
  expect(result.diagnostics).toEqual([]);
  return result.value;
}

test('a returned dictionary captures the same local callback as a direct map', () => {
  const direct = run(`
make(n) = do { let h = k => k + n; map(h, [1, 2]) }
make(10)`);
  const dictionary = run(`
make(n) = do { let h = k => k + n; {"a" -> map(h, [1, 2])} }
make(10)`);
  expect([...direct.each()].map((x) => x.re)).toEqual([11, 12]);
  expect([...dictionary.get('a')!.each()].map((x) => x.re)).toEqual([11, 12]);
});

test('dictionary callbacks keep their creating frame after another call', () => {
  const value = run(`
make(n) = {"a" -> (k => k + n)}
let a = make(10)
make(20)
a["a"](1)`);
  expect(value.re).toBe(11);
});

test('a dictionary nested in a list substitutes a lazy source parameter', () => {
  const value = run(`
make(xs) = [{"a" -> map(x => x + 1, xs)}]
make([1, 2])`);
  expect([...value.op1.get('a')!.each()].map((x) => x.re)).toEqual([2, 3]);
});
