// Probes of the caches that the CE-601 census does not list, with a host
// operator `h` that does not state its purity and reads a JavaScript
// variable `k`.  npx tsx uncensused.mts <repo root>
const root = process.argv[2] ?? '/Users/arno/dev/compute-engine';
const { ComputeEngine } = await import(`${root}/src/compute-engine.ts`);

function engine() {
  const ce = new ComputeEngine();
  const state = { k: 1, calls: 0 };
  ce.declare('h', {
    signature: '(number) -> number',
    evaluate: ([x]: any[], { engine }: any) => {
      state.calls += 1;
      return engine.number(x.re + state.k);
    },
  });
  return { ce, state };
}

{
  const { ce } = engine();
  const e = ce.box(['h', 2]);
  console.log('A. isPure of h(2):', e.isPure, ' isConstant:', e.isConstant);
}

{
  // B. Enclosure endpoints read through the payload cache.
  const { ce, state } = engine();
  const e = ce.box(['Enclosure', ['h', 2], 100]);
  const r1 = e.N().toString();
  state.k = 1000;
  const r2 = e.N().toString();
  const fresh = ce.box(['Enclosure', ['h', 2], 100]).N().toString();
  console.log('B. Enclosure(h(2),100).N():', r1, '| after k=1000:', r2, '| fresh node:', fresh, '| calls', state.calls);
}

{
  // B2. An enclosure arithmetic with an unevaluated endpoint.
  const { ce, state } = engine();
  const e = ce.box(['Add', ['Enclosure', 0, ['h', 2]], ['Enclosure', 0, 1]]);
  const r1 = e.evaluate().toString();
  state.k = 1000;
  const r2 = e.evaluate().toString();
  console.log('B2. Enclosure(0,h(2)) + Enclosure(0,1):', r1, '| after k=1000:', r2, '| calls', state.calls);
}

{
  // C. A dictionary node used twice in one evaluation.
  const { ce, state } = engine();
  const d = ce.box(['Dictionary', ['Tuple', "'a'", ['h', 2]]]);
  const t = ce.function('Tuple', [d, d]);
  const r = t.evaluate().toString();
  console.log('C. Tuple(d, d) with d = {a: h(2)}:', r, '| host calls', state.calls, '(the rule expects 2)');
}

{
  // D. Derivative chain of a function literal whose body holds h(2).
  const { ce, state } = engine();
  ce.assign('f', ce.box(['Function', ['Multiply', 'x', ['h', 2]], 'x']));
  const d = ce.box(['D', ['f', 'x'], 'x']);
  const r1 = d.evaluate().toString();
  state.k = 1000;
  const r2 = d.evaluate().toString();
  const r3 = ce.box(['D', ['f', 'x'], 'x']).evaluate().toString();
  console.log('D. D(f(x), x), f = x -> x h(2):', r1, '| after k=1000:', r2, '| fresh:', r3);
  const dd = ce.box(['Derivative', 'f', 2]);
  console.log('D2. Derivative(f, 1) eval:', ce.box(['Derivative', 'f']).evaluate().toString());
}

{
  // E. Comparison approximation of an expression holding h(2).
  const { ce, state } = engine();
  const e = ce.box(['Less', ['h', 2], 4]);
  const r1 = e.evaluate().toString();
  state.k = 10;
  const r2 = e.evaluate().toString();
  console.log('E. h(2) < 4:', r1, '| after k=10:', r2);
}
