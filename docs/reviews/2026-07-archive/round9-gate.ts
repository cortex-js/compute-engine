// Round-9 gate: fresh-process probes covering all five agents' claims.
// Run: npx tsx round9-gate.ts
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

// ───── A1: parse/serialize ─────
{
  const ce = new ComputeEngine();
  // #4 \binom round-trip
  const b = ce.parse('\\binom{7}{2}');
  check('PS4 \\binom parses', b.isValid, true);
  check('PS4 \\binom evaluates', b.evaluate().toString(), '21');
  check('PS4 Binomial serializes \\binom', ce.box(['Binomial', 'n', 'k']).latex.includes('\\binom'), true);
  // #7 double superscript is an error
  check('PS7 x^2^3 invalid', ce.parse('x^2^3').isValid, false);
  // #8 Sequence latex not digit-fusing
  const seq = ce.box(['Sequence', 1, 2]);
  check('PS8 Sequence latex has separator', ce.parse(seq.latex).isSame(ce.number(12)), false);
  // #10 == and !=
  check('PS10 3==3 evaluates True', ce.parse('3 == 3').evaluate().symbol, 'True');
  check('PS10 3!=2 evaluates True', ce.parse('3 != 2').evaluate().symbol, 'True');
  check('PS10 3! = 6 factorial intact', ce.parse('3! = 6').evaluate().symbol, 'True');
  // #6 set-builder
  const sb = ce.parse('\\{x \\in \\R : x>0\\}');
  check('PS6 set-builder no Colon-in-domain', JSON.stringify(sb.json).includes('Colon'), false);
}

// ───── A2: canonicalization/comparison ─────
{
  const ce = new ComputeEngine();
  // #13 negative-index root → reciprocal
  const r = ce.parse('x^{-1/3}');
  check('CC13 x^(-1/3) reciprocal form', JSON.stringify(r.json).includes('"Root"') && JSON.stringify(r.json).includes('"Divide"'), true);
  check('CC13 no negative root index', JSON.stringify(r.json).includes('-3'), false);
  check('CC13 8^(-1/3) value', ce.parse('8^{-1/3}').N().re.toFixed(6), '0.500000');
  // #12 float coefficients don't mint exact
  const d = ce.parse('\\frac{0.3x}{0.1y}');
  check('CC12 (0.3x)/(0.1y) not exact 3', JSON.stringify(d.json).includes('0.3') || JSON.stringify(d.json).includes('2.9999'), true);
  // #15 primitive isSame parity
  check('CC15 Rational(1,2).isSame(0.5)', ce.box(['Rational', 1, 2]).isSame(0.5), ce.box(['Rational', 1, 2]).isSame(ce.number(0.5)));
  // #16 tensor isEqual tolerance
  const v1 = ce.box(['List', 1.0, 2.0]);
  const v2 = ce.box(['List', 1.0 + 1e-12, 2.0]);
  check('CC16 near-equal lists isEqual', v1.isEqual(v2), true);
}

// ───── A3: numerics ─────
{
  const ce = new ComputeEngine();
  ce.precision = 50;
  check('NU17 log10(1e-7) exact -7', ce.box(['Log', { num: '1e-7' }]).N().toString(), '-7');
  check('NU17 log2(8) exact 3', ce.box(['Log', 8, 2]).N().toString(), '3');
  check('NU18 Zeta(-2) exact 0', ce.box(['Zeta', -2]).N().toString(), '0');
  check('NU18 Zeta(-4) exact 0', ce.box(['Zeta', -4]).N().toString(), '0');
  const ce2 = new ComputeEngine();
  // #19 Fresnel beyond old cutoff (36974) no longer hard 0.5
  const fs = ce2.box(['FresnelS', 40000]).N().re;
  check('NU19 FresnelS(40000) not 0.5', fs !== 0.5 && Math.abs(fs - 0.49999204) < 1e-6, true);
  // #20 exact roots
  check('NU20 64^(1/3) exact 4', ce2.box(['Power', 64, ['Rational', 1, 3]]).evaluate().toString(), '4');
  check('NU20 (27/8)^(1/3) exact 3/2', ce2.box(['Power', ['Rational', 27, 8], ['Rational', 1, 3]]).evaluate().toString(), '3/2');
  // RT P2-5: 2^100 exact
  check('RT5 2^100 exact', ce2.parse('2^{100}').evaluate().toString(), (2n ** 100n).toString());
  // #21 (7/3)√3 @100 correctly bounded digits
  const ce3 = new ComputeEngine();
  ce3.precision = 100;
  const s = ce3.box(['Multiply', ['Rational', 7, 3], ['Sqrt', 3]]).N().toString();
  const digits = s.replace('-', '').replace('.', '').length;
  check('NU21 digits ≤ ~101', digits <= 102, true);
}

// ───── A4: compilation ─────
{
  const ce = new ComputeEngine();
  const { compile } = require('/Users/arno/dev/compute-engine/src/compute-engine/compilation/compile-expression.ts');
  // #23a negative-bound Sum unroll compiles and runs
  const f = compile(ce.box(['Sum', ['Negate', '_i'], ['Triple', '_i', -3, 3]]));
  check('CO23a Sum(-i,-3..3) compiles+runs', f ? String(f.run()) : 'nocompile', '0');
  // #24 dynamic 0^0 → NaN on JS
  const g = compile(ce.parse('x^y'));
  check('CO24 dynamic 0^0 NaN', g ? String(g.run({ x: 0, y: 0 })) : 'nocompile', 'NaN');
}

// ───── A5: fungrim P2-25 + D11 ─────
{
  const ce = new ComputeEngine();
  // D11 locked repro
  ce.parse('gcd(12,8)');
  let ok = true;
  try {
    ce.assign('d', 5);
  } catch {
    ok = false;
  }
  check('D11 assign d after gcd misparse', ok, true);
  check('D11 d+1 evaluates 6', ce.parse('d+1').evaluate().toString(), '6');
}
{
  // P2-25 Digamma(1/2) fires with pack loaded
  const ce = new ComputeEngine();
  const mod = require('/Users/arno/dev/compute-engine/src/compute-engine/fungrim/loader.ts');
  const loadFn = mod.loadIdentities ?? mod.loadFungrim ?? mod.default;
  if (typeof loadFn === 'function') {
    loadFn(ce);
    const r = ce.box(['Digamma', ['Rational', 1, 2]]).simplify();
    check('P2-25 Digamma(1/2) fires', r.isSame(ce.box(['Digamma', ['Rational', 1, 2]])), false);
    check('P2-25 result has Ln(2)', JSON.stringify(r.json).includes('Ln'), true);
  } else {
    console.log('SKIP P2-25 loader entry not found:', Object.keys(mod).join(','));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
