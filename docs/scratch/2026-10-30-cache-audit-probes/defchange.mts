// A definition change under each value cache: fill an entry, change a
// definition that the entry read, read the SAME node again. The oracle is the
// same script run with the value caches off (CE_CACHE_OFF in the probe
// worktree): a line that differs between the two runs is a cache that keeps a
// value computed with the old definition.
//   (R) retype: `b` declared `integer`, then its type is set to `real`;
//       `T = If(Element(b, Integers), 10, 20)` is 10 before and 20 after.
//   (X) extension: `g(x) = x + 1`, then `ce.declare('g', {evaluate}, {extend: true})`
//       gives `g(x) = x + 100`.
// npx tsx defchange.mts <repo root>
const root = process.argv[2] ?? '/Users/arno/dev/compute-engine';
const { ComputeEngine } = await import(`${root}/src/compute-engine.ts`);

function engine() {
  const ce = new ComputeEngine();
  ce.declare('b', 'integer');
  ce.declare('q', 'real');
  ce.declare('g', {
    signature: '(number) -> number',
    pure: true,
    evaluate: ([x]: any[], { engine }: any) =>
      x.isNumberLiteral ? engine.number(x.re + 1) : undefined,
  });
  return ce;
}
const retype = (ce: any) => {
  ce.box('b').valueDefinition!.type = 'real';
};
const extend = (ce: any) =>
  ce.declare(
    'g',
    {
      evaluate: ([x]: any[], { engine }: any) =>
        x.isNumberLiteral ? engine.number(x.re + 100) : undefined,
    },
    { extend: true }
  );

const T = ['If', ['Element', 'b', 'Integers'], 10, 20];
const body = ['Add', T, ['g', 'k']];
const fn = ['Function', body, 'k'];
const pred = ['Function', ['Greater', ['Add', ['g', 'k'], T], 14], 'k'];

type Case = [name: string, build: (ce: any) => any, read: (e: any, ce: any) => string];
const cases: Case[] = [
  ['application memo', (ce) => { ce.assign('f', ce.box(fn)); return ce.box(['f', 2]); }, (e) => e.evaluate().toString()],
  ['lazy value', (ce) => ce.box(['Map', fn, ['Range', 1, 3]]), (e) => e.evaluate().toString()],
  ['element memo', (ce) => ce.box(['Map', fn, ['Range', 1, 3]]).evaluate(), (e) => [...e.each()].map((x: any) => x.toString()).join(', ')],
  ['at()', (ce) => ce.box(['Map', fn, ['List', 1, 2]]), (e) => String(e.at(1))],
  ['facet', (ce) => ce.box(['Filter', ['Range', 1, 5], pred]), (e) => String(e.count)],
  ['slice', (ce) => ce.box(['Slice', ['Filter', ['Range', 1, 5], pred], 1, -1]), (e) => e.evaluate().toString()],
  ['stored value', (ce) => { ce.assign('p', ce.box(['Hold', ['Add', T, 'q']]).ops![0]); return ce.box(['Multiply', 'p', 'p']); }, (e) => e.evaluate().toString()],
  ['sequence', (ce) => { ce.declareSequence('s', { base: { 0: 0 }, recurrence: 's_{n-1} + \\operatorname{g}(1)' } as any); return ce.parse('s_{5}'); }, (e) => e.evaluate().toString()],
  ['derivative chain', (ce) => { ce.assign('f', ce.box(['Function', ['Multiply', 'x', T, ['g', 1]], 'x'])); return ce.box(['Derivative', 'f']); }, (e) => e.evaluate().toString()],
  ['Limit probe', (ce) => ce.box(['Limit', ['Function', ['Divide', ['Add', ['g', 'x'], T], 'x'], 'x'], 'PositiveInfinity']), (e) => e.evaluate().toString()],
  ['Map compile', (ce) => { ce.precision = 'machine'; return ce.box(['Map', ['Function', ['Add', ['Sin', 'k'], T], 'k'], ['Range', 1, 300]]).evaluate().N(); }, (e) => { let last = ''; for (const x of e.each()) last = x.toString(); return last; }],
];

for (const [label, change] of [['R', retype], ['X', extend]] as const) {
  for (const [name, build, read] of cases) {
    let line: string;
    try {
      const ce = engine();
      const e = build(ce);
      const r1 = read(e, ce);
      change(ce);
      const r2 = read(e, ce);
      let fresh: string;
      try { fresh = read(build(ce), ce); } catch (err: any) { fresh = 'throw ' + String(err?.message ?? err).slice(0, 60); }
      line = `${r1} | after: ${r2} | new node: ${fresh}`;
    } catch (err: any) {
      line = 'throw ' + String(err?.message ?? err).slice(0, 100);
    }
    console.log(`${label} ${name}: ${line}`);
  }
}
