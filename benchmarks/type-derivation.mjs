// Compare P1's symbolic probes and type/collection controls in one warm process.
// Build both revisions with the same options and hold the shared-box CPU lock.
// node benchmarks/type-derivation.mjs /path/to/baseline.mjs /path/to/current.mjs
import { loadavg } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const paths = process.argv.slice(2);
if (paths.length === 0)
  throw new Error('Supply one or more engine bundle paths');
const engines = await Promise.all(
  paths.map(async (path) => {
    const { ComputeEngine } = await import(pathToFileURL(resolve(path)).href);
    return new ComputeEngine();
  })
);
const sum = [
  'Add',
  ['Multiply', ['Sqrt', 6], 'x'],
  ['Multiply', ['Sqrt', 2], 'x'],
];
const cases = [
  ['box', (ce) => () => ce.expr(sum)],
  ['simplify', (ce) => () => ce.expr(sum).simplify()],
  [
    'nested-root',
    (ce) => () =>
      ce.expr(['Sqrt', ['Add', 3, ['Multiply', 2, ['Sqrt', 2]]]]).simplify(),
  ],
  [
    'solve',
    (ce) => () =>
      ce.expr(['Add', ['Power', 'x', 4], ['Power', 'x', 2], -1]).solve('x'),
  ],
  [
    'integral',
    (ce) => () =>
      ce
        .expr([
          'Integrate',
          ['Divide', 1, ['Add', ['Power', 'x', 3], 1]],
          ['Tuple', 'x'],
        ])
        .evaluate(),
  ],
  [
    'definite',
    (ce) => () =>
      ce
        .expr(['Integrate', ['Divide', 1, 'x'], ['Tuple', 'x', 1, 2]])
        .evaluate(),
  ],
  ['numeric-control', (ce) => () => ce.expr(['Sqrt', 2]).N()],
  [
    'ranged-product',
    (ce) => {
      ce.declare('boundedX', 'real<2..3>');
      ce.declare('boundedY', 'real<4..5>');
      const ops = [ce.expr('boundedX'), ce.expr('boundedY')];
      return () => ce._fn('Multiply', ops).type.toString();
    },
  ],
  [
    'list-type',
    (ce) => {
      const points = Array.from({ length: 100 }, (_, i) =>
        ce.expr(['Tuple', i, i + 1])
      );
      return () => ce._fn('List', points).type.toString();
    },
  ],
];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fingerprint = (x) =>
  Array.isArray(x) ? x.map(fingerprint) : (x?.json ?? x);
console.log(JSON.stringify({ bundles: paths, load: loadavg() }));
for (const [name, setup] of cases) {
  const fns = engines.map(setup);
  const results = fns.map((fn) => JSON.stringify(fingerprint(fn())));
  // A performance gain must not hide different work or different answers.
  if (results.some((value) => value !== results[0]))
    console.log(JSON.stringify({ name, differentResults: results }));
  for (let i = 0; i < 1000; i++) for (const fn of fns) fn();
  const rounds = fns.map(() => []);
  for (let round = 0; round < 7; round++) {
    for (let offset = 0; offset < fns.length; offset++) {
      const index = (round + offset) % fns.length;
      const times = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        fns[index]();
        times.push((performance.now() - start) * 1000);
      }
      rounds[index].push(median(times));
    }
  }
  console.log(
    JSON.stringify({ name, microseconds: rounds.map(median), rounds })
  );
}
console.log(JSON.stringify({ loadAfter: loadavg() }));
