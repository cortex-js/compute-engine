// Origin of SETTINGS_PAYLOADS (library/enclosure-arithmetic.ts, commit
// 22d77a2ea, 2026-10-27, value kinds phase 3). CHANGELOG of the commit:
// "the unit of a quantity is decoded once for each boxed value ... the hooks
// of a value kind ... can decode the operands of a kind value once for each
// boxed expression". The review of that commit split the decodes that read
// the angular unit and the precision into this cache. No slow case is
// recorded; the case it serves is arithmetic that reads the same enclosure
// (with exact constant endpoints) many times.
// A new engine per run: the cache is keyed by the boxed node.
import { ComputeEngine } from '/tmp/wt-compute-engine-aa-cache2/src/compute-engine.ts';
import { measure } from './harness.mts';

const TERMS = Number(process.env.ENC_TERMS ?? 40);

await measure(
  `enclosure-reads terms=${TERMS} costly=${process.env.ENC_COSTLY ?? '0'}`,
  () => {
    const ce = new ComputeEngine();
    ce.assign('x', ce.box(['Enclosure', ['Sqrt', 2], 'Pi']));
    // ENC_COSTLY=1: endpoints whose numeric value costs more to compute
    // (special functions), so each decode costs more.
    if (process.env.ENC_COSTLY === '1')
      ce.assign('y', ce.box(['Enclosure', ['Add', ['Gamma', ['Rational', 1, 3]], ['Zeta', 3]], ['Multiply', ['Erf', ['Rational', 1, 3]], 9]]));
    else ce.assign('y', ce.box(['Enclosure', ['Ln', 2], ['Exp', 1]]));
    return ce;
  },
  (ce) => {
    const out: string[] = [];
    // A polynomial in x and y, Horner form: each step reads x again.
    let p: any = 'y';
    for (let k = 1; k <= TERMS; k++) p = ['Add', ['Multiply', p, 'x'], ['Multiply', k, 'y']];
    out.push(ce.box(p).evaluate().toString());
    // The numeric route (outward-rounded doubles of the endpoints).
    out.push(ce.box(p).N().toString());
    // Comparisons and extrema that read the endpoints of x and y.
    for (let k = 0; k < TERMS; k++) {
      out.push(ce.box(['Max', 'x', 'y', ['Rational', k, 7]]).evaluate().toString());
      out.push(ce.box(['Less', 'x', ['Add', 'y', ['Rational', k, 5]]]).evaluate().toString());
      out.push(ce.box(['Sin', ['Add', 'x', k]]).evaluate().toString());
    }
    return out.join('\n');
  }
);
