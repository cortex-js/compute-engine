// Does a Series result depend on zero verdicts computed before it?
const root = process.argv[2] ?? '/Users/arno/dev/compute-engine';
const { ComputeEngine } = await import(`${root}/src/compute-engine.ts`);
const { exactZeroVerdict } = await import(`${root}/src/compute-engine/symbolic/contour.ts`);
const z = ['Subtract', ['Add', ['Power', ['Sin', 1], 2], ['Power', ['Cos', 1], 2]], 1];
const body = ['Add', ['Sin', 'x'], ['Multiply', z, ['Power', 'x', 2]]];
const series = (ce: any) => ce.box(['Series', body, 'x', 0, 5]).evaluate().toString();
for (const prime of [false, true]) {
  const ce = new ComputeEngine();
  if (prime) console.log('  verdict computed first:', exactZeroVerdict(ce.box(z)));
  console.log(prime ? 'after:' : 'fresh:', series(ce));
}
