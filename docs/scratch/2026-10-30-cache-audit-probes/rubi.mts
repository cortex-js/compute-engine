// The Rubi zero-test cache with a host operator `h(x) = x + k` that does not
// state its purity. Two zero tests of `h(1) - 2` inside one integration call
// (the caches installed), with `k` changed by host code between them.
// npx tsx rubi.mts <repo root>
const root = process.argv[2] ?? '/Users/arno/dev/compute-engine';
const { ComputeEngine } = await import(`${root}/src/compute-engine.ts`);
const { zeroQ, installCaches } = await import(`${root}/src/compute-engine/rubi/rubi-utils.ts`);
const ce = new ComputeEngine();
const state = { k: 1, calls: 0 };
ce.declare('h', { signature: '(number) -> number', evaluate: ([x]: any[], { engine }: any) => { state.calls++; return engine.number(x.re + state.k); } });
const d = ce.box(['Subtract', ['h', 1], 2]);
for (const cached of [false, true]) {
  state.k = 1; state.calls = 0;
  installCaches(cached ? { zeroQ: new Map(), simplify: new Map() } : undefined);
  const a = zeroQ(d);
  state.k = 5;
  const b = zeroQ(d);
  console.log(`caches ${cached ? 'on ' : 'off'}: zeroQ(h(1) - 2) = ${a}, after k = 5: ${b} (expected false), host calls ${state.calls}`);
}
installCaches(undefined);
