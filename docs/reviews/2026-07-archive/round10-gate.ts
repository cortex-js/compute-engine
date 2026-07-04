// Round-10 gate: fresh-process probes covering all four agents' claims.
// Run: npx tsx round10-gate.ts
import { ComputeEngine } from '/Users/arno/dev/compute-engine/src/compute-engine.ts';

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL ${label}: got ${String(actual)}, expected ${String(expected)}`);
  }
}

// ───── Simplify cluster ─────
{
  const ce = new ComputeEngine();
  // #2 rules: null → no rules
  const s1 = ce.parse('\\sin^2(x) + \\cos^2(x)');
  check('S2 rules:null keeps sin²+cos²', s1.simplify({ rules: null } as any).isSame(s1.simplify()), false);
  check('S2 default simplifies to 1', s1.simplify().toString(), '1');
  // #6 sin addition rule
  check(
    'S6 sinxcosy+cosxsiny → sin(x+y)',
    ce.parse('\\sin(x)\\cos(y) + \\cos(x)\\sin(y)').simplify().toString(),
    ce.parse('\\sin(x+y)').toString()
  );
  // #4 bigint ln-ratio counterexample: 2^60+1 is not a power of 2
  const huge = (2n ** 60n + 1n).toString();
  const r = ce.parse(`\\frac{\\ln(${huge})}{\\ln(2)}`).simplify();
  check('S4 ln(2^60+1)/ln2 stays symbolic', r.isSame(ce.number(60)), false);
  check('S4 ln(2^60)/ln2 = 60', ce.parse(`\\frac{\\ln(${(2n ** 60n).toString()})}{\\ln(2)}`).simplify().toString(), '60');
  // #1 mechanism swap: a log exemption still applies (ln(x²)→2ln|x|)
  check('S1 ln(x^2) exemption intact', ce.parse('\\ln(x^2)').simplify().toString().includes('ln'), true);
}

// ───── Type cluster (P3-6; P2-2 reverted) ─────
{
  const ce = new ComputeEngine();
  check('T6 named tuple <: unnamed', ce.type('tuple<x: integer, y: integer>').matches('tuple<integer, integer>'), true);
  check('T6 unnamed not <: named', ce.type('tuple<integer, integer>').matches('tuple<x: integer, y: integer>'), false);
}

// ───── Assumptions/fungrim P3 batch ─────
{
  const ce = new ComputeEngine();
  ce.pushScope();
  ce.assume(ce.parse('x > 0'));
  check('A1 verify string', ce.verify('x > 0' as any), true);
  check('A1 verify latex string', ce.verify('$x > 0$' as any), true);
  ce.popScope();
  // P3-2 live Kleene recursion
  ce.pushScope();
  ce.assume(ce.parse('x \\cdot y > 0'));
  ce.assume(ce.parse('x + y > 0'));
  check('A2 And of DB facts', ce.verify(ce.box(['And', ['Greater', ['Multiply', 'x', 'y'], 0], ['Greater', ['Add', 'x', 'y'], 0]])), true);
  check('A2 Not of DB fact', ce.verify(ce.box(['Not', ['Greater', ['Multiply', 'x', 'y'], 0]])), false);
  ce.popScope();
}
{
  // P3-7: real-guarded fungrim rule must NOT fire at +∞
  const ce = new ComputeEngine();
  const mod = require('/Users/arno/dev/compute-engine/src/compute-engine/fungrim/loader.ts');
  const loadFn = mod.loadIdentities ?? mod.default;
  if (typeof loadFn === 'function') {
    loadFn(ce);
    ce.declare('k', 'real');
    ce.assign('k', ce.PositiveInfinity);
    const r = ce.box(['Im', ['Exp', ['Multiply', ['Complex', 0, 1], 'k']]]).simplify();
    check('A7 Im(e^{ik}) at k=+∞ not sin', r.toString().startsWith('sin('), false);
  } else {
    console.log('SKIP A7 loader entry not found');
  }
}

// ───── Corpora cluster ─────
{
  const ce = new ComputeEngine();
  // #28 Gruntz limit fast + #29 no throw
  ce.timeLimit = 2000;
  const t0 = Date.now();
  let threw = false;
  let out = '';
  try {
    out = ce
      .parse('\\lim_{x\\to\\infty} \\frac{e^{e^{e^x}}}{e^{e^{e^{x-1}}}}')
      .evaluate()
      .toString();
  } catch {
    threw = true;
  }
  const dt = Date.now() - t0;
  check('C28 Gruntz returns fast (<10s)', dt < 10000, true);
  check('C29 no CancellationError throw', threw, false);
  check('C28 no wrong 0', out === '0', false);
}
{
  const ce = new ComputeEngine();
  // #30 subs into List/Median
  const m = ce.box(['Median', ['List', 'a', 'b', 'c']]);
  const sub = m.subs({ a: ce.number(1), b: ce.number(2), c: ce.number(3) });
  check('C30 Median subs descends', sub.evaluate().toString(), '2');
  check('C30 List subs', ce.box(['List', 'a', 2]).subs({ a: ce.number(7) }).toString(), '[7,2]');
  // #30 Power(0,0) N-path
  check('C30 0^0 N NaN', ce.box(['Power', 0, 0]).N().toString(), 'NaN');
  ce.assign('zz', 0);
  ce.assign('ww', 0);
  check('C30 assigned 0^0 N NaN', ce.box(['Power', 'zz', 'ww']).N().toString(), 'NaN');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
