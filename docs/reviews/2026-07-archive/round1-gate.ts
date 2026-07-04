// Round-1 combined verification gate: all P0 repros from WP-1.1..1.5, 2.1, 2.2
// in one fresh engine/process. PASS/FAIL per check.
import { ComputeEngine } from '/Users/arno/dev/compute-engine/src/compute-engine';

const ce = new ComputeEngine();
let pass = 0,
  fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
}
const N = (e: any) => { const n = e.N(); const v = n.operator === 'PlusMinus' ? n.op1 : n; return v.re as number; };
const approx = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

// WP-1.1 P0-8 Argument
{
  const ev = ce.expr(['Argument', ['Complex', 1, 1]]).evaluate();
  check('1.1 Argument(1+i) evaluate = pi/4', approx(N(ev), Math.PI / 4), ev.toString());
  const n = ce.expr(['Argument', ['Complex', 1, 1]]).N();
  check('1.1 Argument(1+i) N ~ 0.7853', approx(n.re as number, Math.PI / 4), n.toString());
}

// WP-1.2 P0-14 arcoth'
{
  const d = ce.expr(['D', ['Arcoth', 'x'], 'x']).evaluate();
  const at2 = d.subs({ x: 2 }).N().re as number;
  check('1.2 D(Arcoth)(2) = -1/3', approx(at2, -1 / 3), String(at2));
}

// WP-1.3 SYM P0-1 / P0-15 ODD_TRIG
{
  const s = ce.parse('|\\sin(x)|').simplify();
  check('1.3 |sin x| unchanged', s.toString().includes('sin') && s.operator === 'Abs', s.toString());
  const v1 = N(ce.parse('|\\sin(4)|').simplify());
  check('1.3 |sin 4| numeric', approx(v1, Math.abs(Math.sin(4))), String(v1));
  const ac = N(ce.expr(['Abs', ['Arccot', -2]]).simplify());
  check('1.3 |Arccot(-2)| ~ 2.678', approx(ac, Math.PI - Math.atan(1 / 2), 1e-6), String(ac));
  const ctrl = ce.parse('|\\sinh(x)|').simplify();
  check('1.3 control |sinh x| -> sinh|x|', ctrl.operator === 'Sinh', ctrl.toString());
}

// WP-1.4 P0-5 2(1+i)
{
  const r = ce.expr(['Multiply', 2, ['Complex', 1, 1]]).evaluate();
  check('1.4 2(1+i) = 2+2i', approx(r.re as number, 2) && approx(r.im as number, 2), r.toString());
  const r2 = ce.expr(['Multiply', 5, ['Complex', 2, 1]]).evaluate();
  check('1.4 5(2+i) = 10+5i', approx(r2.re as number, 10) && approx(r2.im as number, 5), r2.toString());
  const c = ce.expr(['Multiply', 2, ['Complex', 0, 1]]).evaluate();
  check('1.4 control 2i', approx(c.re as number, 0) && approx(c.im as number, 2), c.toString());
}

// WP-1.5 SYM P0-3 exact exponents
{
  const j = JSON.stringify(ce.parse('x \\cdot x^{\\sqrt{2}}').simplify().json);
  check('1.5 x*x^sqrt2 exponent exact', j.includes('"Sqrt"') && !j.includes('2.414'), j);
}

// WP-2.1 P0-1 defint
{
  const e1 = ce.parse('\\int_{-1}^{1} \\frac{\\sqrt{1-x^2}}{1+x^2} dx');
  const ev1 = e1.evaluate();
  check('2.1 hard defint evaluate stays inert', ev1.has('Integrate'), ev1.toString());
  check('2.1 hard defint N ~ 1.3013', approx(N(e1), Math.PI * (Math.SQRT2 - 1), 1e-3), String(N(e1)));
  const e2 = ce.parse('\\int_{-1}^{1} \\left(\\frac{\\sqrt{1-x^2}}{1+x^2} + 5\\right) dx');
  const ev2 = e2.evaluate();
  check('2.1 +5 variant stays inert', ev2.has('Integrate'), ev2.toString());
  check('2.1 +5 variant N ~ 11.3013', approx(N(e2), 10 + Math.PI * (Math.SQRT2 - 1), 1e-2), String(N(e2)));
  const c1 = ce.parse('\\int_0^1 x^2 dx').evaluate();
  check('2.1 control x^2 -> 1/3 exact', c1.isSame(ce.expr(['Rational', 1, 3])), c1.toString());
  const c2 = ce.parse('\\int_0^a x dx').evaluate();
  check('2.1 control symbolic bounds a^2/2', c2.toString().includes('a'), c2.toString());
}

// WP-2.2 P0-2 Sqrt N
{
  ce.pushScope();
  const s1 = ce.expr(['Sqrt', 'y']).N();
  check('2.2 Sqrt(y).N keeps radical', s1.toString() !== 'y' && s1.has('y'), s1.toString());
  const s2 = ce.expr(['Sqrt', ['Multiply', 4, 'y']]).N();
  const s2str = s2.toString();
  check('2.2 sqrt(4y).N = 2*sqrt-ish y', s2str !== '2y' && /2/.test(s2str), s2str);
  // numeric identity: substitute y=2 and compare against sqrt(8)
  const num = s2.subs({ y: 2 }).N().re as number;
  check('2.2 sqrt(4y) at y=2 = sqrt(8)', approx(num, Math.sqrt(8)), String(num));
  ce.popScope();
}

// WP-2.2 P0-4 asBigint consumers (exactly-stored values)
{
  const m = ce.number(170141183460469231731687303715884105727n); // M127 literal
  const p = ce.expr(['IsPrime', m]).evaluate();
  check('2.2 IsPrime(M127 literal) = True', p.symbol === 'True', p.toString());
  const ds = ce.expr(['DigitSum', m]).evaluate();
  check('2.2 DigitSum(M127) = 154', ds.re === 154, ds.toString());
  const md = ce.expr(['Mod', ce.number(1000000000000000000003n), 10]).evaluate();
  check('2.2 Mod(10^21+3,10) = 3', md.re === 3, md.toString());
}

// WP-2.2 P0-16i Sum exactness
{
  const s = ce.expr(['Sum', ['Sqrt', 'k'], ['Tuple', 'k', 1, 5]]).evaluate();
  const js = JSON.stringify(s.json);
  check('2.2 Sum(sqrt k,1..5) exact', js.includes('Sqrt') && !js.includes('8.38'), js.slice(0, 120));
  check('2.2 Sum N ~ 8.3823', approx(N(s), 1 + Math.SQRT2 + Math.sqrt(3) + 2 + Math.sqrt(5), 1e-9), String(N(s)));
  const c = ce.expr(['Sum', 'k', ['Tuple', 'k', 1, 100]]).evaluate();
  check('2.2 control Sum(k,1..100)=5050 exact', c.re === 5050 && c.isExact !== false, c.toString());
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
