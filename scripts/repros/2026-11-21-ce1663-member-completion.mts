/**
 * CE-1663: after `.`, `epsilCompletions` offers every name of the program and
 * of the library instead of the members of the value before the dot.
 *
 *   npx tsx scripts/repros/2026-11-21-ce1663-member-completion.mts
 *
 * Prints, for each source, the number of items and the members found among
 * them, then READY (exit 0) when each lists exactly its members, else
 * NOT READY (exit 1).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { checkEpsil, epsilCompletions } from '../../src/epsil';

const PROGRAM = `protocol Shape {
  function area(self: Self) -> number
  function scale(self: Self, k: number) -> Self
}
type Circle = tuple<r: number> is Shape {
  function area(self: Circle) -> number { Pi * self.r^2 }
  function scale(self: Circle, k: number) -> Circle { Circle(self.r * k) }
}
const c: Circle = Circle(1)
const p: record{x: real, y: real, tag: string} = {x -> 1, y -> 2, tag -> "a"}
`;

const ce = new ComputeEngine();
const problems = checkEpsil(ce, PROGRAM).diagnostics;
if (problems.length > 0) {
  console.log('the program does not check:', JSON.stringify(problems));
  process.exit(2);
}

const cases: [string, string[]][] = [
  ['c.', ['area', 'r', 'scale']],
  ['p.', ['tag', 'x', 'y']],
  ['p.t', ['tag']],
];
let ready = true;
for (const [line, members] of cases) {
  const source = PROGRAM + line;
  const { items } = epsilCompletions(ce, source, source.length);
  const labels = items.map((i) => i.label).sort();
  const ok = JSON.stringify(labels) === JSON.stringify(members);
  if (!ok) ready = false;
  const found = labels.filter((l) => members.includes(l));
  console.log(
    `${ok ? 'ok ' : 'BAD'} ${JSON.stringify(line)}: ${items.length} items, ` +
      `members found: ${found.join(', ') || 'none'}, first: ` +
      items
        .slice(0, 4)
        .map((i) => i.label)
        .join(', ')
  );
}
console.log(ready ? 'READY' : 'NOT READY');
process.exit(ready ? 0 : 1);
