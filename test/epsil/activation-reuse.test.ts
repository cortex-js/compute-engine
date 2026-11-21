import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil, executeEpsilAsync } from '../../src/epsil';

// An iteration, or a run of a block, reuses the activation of the previous
// one when nothing keeps it (`docs/SCOPING-MODEL.md`, "Activations"). Each
// program below reads a value that a reused activation would overwrite if a
// keeper were missed: a closure, a lazy collection, a recursive run of the
// same block, a block local of an earlier run.

const PROGRAMS: [name: string, source: string, value: unknown][] = [
  [
    'an accumulator over a loop',
    'let total = 0\nfor i in 1..100 { total = total + i * 2 }\ntotal',
    10100,
  ],
  [
    'a closure made in each iteration',
    'let fs = []\nfor i in 1..3 { fs = append(fs, x => x + i) }\n[fs[1](10), fs[2](10), fs[3](10)]',
    ['List', 11, 12, 13],
  ],
  [
    'a closure made in a block nested in the loop body',
    'let fs = []\nfor i in 1..3 { if i > 0 { let k = i * 2\n fs = append(fs, () => k + i) } }\n[fs[1](), fs[2](), fs[3]()]',
    ['List', 3, 6, 9],
  ],
  [
    'a closure made in the first iteration only',
    'let f = () => 0\nfor i in 1..4 { if i == 1 { f = () => i } }\nf()',
    1,
  ],
  [
    'closures made in every other iteration',
    'let fs = []\nfor i in 1..5 { if i % 2 == 1 { fs = append(fs, () => i) } }\n[fs[1](), fs[2](), fs[3]()]',
    ['List', 1, 3, 5],
  ],
  [
    'a function declared in the loop body',
    'let fs = []\nfor i in 1..3 { function g(x) { x * i }\n fs = append(fs, g) }\n[fs[1](10), fs[2](10), fs[3](10)]',
    ['List', 10, 20, 30],
  ],
  [
    'closures made in nested loops',
    'let fs = []\nfor i in 1..2 { for j in 1..2 { fs = append(fs, () => 10 * i + j) } }\n[fs[1](), fs[2](), fs[3](), fs[4]()]',
    ['List', 11, 12, 21, 22],
  ],
  [
    'a block local in each iteration',
    'let out = []\nfor i in 1..3 { let y = i * i\n out = append(out, y) }\nout',
    ['List', 1, 4, 9],
  ],
  [
    'a comprehension made in each iteration',
    'let rows = []\nfor i in 1..3 { rows = append(rows, [i * k for k in 1..3]) }\nrows',
    ['List', ['List', 1, 2, 3], ['List', 2, 4, 6], ['List', 3, 6, 9]],
  ],
  [
    'a function literal that parse makes in a nested block',
    'let fs = []\nfor i in 1..3 { if i > 0 { let w = i\n fs = append(fs, parse("x \\\\mapsto x + w")) } }\n[fs[1](100), fs[2](100), fs[3](100)]',
    ['List', 101, 102, 103],
  ],
  [
    'a function literal that parse makes in the loop body',
    'let fs = []\nfor i in 1..3 { let w = i\n fs = append(fs, parse("x \\\\mapsto x + w + i")) }\n[fs[1](100), fs[2](100), fs[3](100)]',
    ['List', 102, 104, 106],
  ],
  [
    'a recursive run of a block while its outer run is in progress',
    'function f(n) { let a = n\n if n > 0 { f(n - 1) }\n a }\n[f(3), f(1)]',
    ['List', 3, 1],
  ],
  [
    'a block local of a function body after another call',
    'function sq(n) { let m = n * n\n m }\n[sq(2), sq(3), sq(4)]',
    ['List', 4, 9, 16],
  ],
];

describe('ACTIVATION REUSE', () => {
  test.each(PROGRAMS)('%s', (_name, source, value) => {
    const result = executeEpsil(new ComputeEngine(), source);
    expect(result.value.json).toEqual(value);
  });

  test.each(PROGRAMS)('%s, asynchronously', async (_name, source, value) => {
    const result = await executeEpsilAsync(new ComputeEngine(), source);
    expect(result.value.json).toEqual(value);
  });
});
