// Round-4 combined verification gate: WP-2.9, 2.10, 2.11, 2.12 (+F completion)
// + Totient signature fix + prior-rounds non-regression. One fresh process.
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
const approx = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

// ---- WP-2.9 type system
{
  ce.pushScope();
  ce.declare('bx', 'integer<0..10>');
  let ok = true;
  let v = '';
  try {
    v = ce.expr(['Element', 'bx', 'Integers']).evaluate().toString();
  } catch (e) {
    ok = false;
    v = String(e);
  }
  check('2.9 Element(int<0..10>, Integers) = True (no throw)', ok && v === '"True"', v);
  ce.popScope();
  ce.pushScope();
  ce.declare('nx', '!string');
  check('2.9 (!string).isInteger undefined', ce.box('nx').isInteger === undefined, String(ce.box('nx').isInteger));
  ce.declare('q9', 'finite_number');
  check('2.9 assume(q ∈ Z) ok', ce.assume(ce.expr(['Element', 'q9', 'Integers'])) === 'ok');
  ce.declare('r9', 'integer');
  ce.declare('s9', 'integer');
  const el = ce.expr(['Element', ['Power', 'r9', 's9'], 'Integers']).evaluate().toString();
  check('2.9 Element(r^s, Z) not True', el !== '"True"', el);
  check('2.9 Ln(-2).isReal not true', ce.expr(['Ln', -2]).isReal !== true, String(ce.expr(['Ln', -2]).isReal));
  ce.declare('ia', 'imaginary');
  ce.declare('ib', 'imaginary');
  const elr = ce.expr(['Element', ['Subtract', 'ia', 'ib'], 'RealNumbers']).evaluate().toString();
  check('2.9 Element(ia−ib, R) not False', elr !== '"False"', elr);
  ce.popScope();
  check('2.9 Pi.isRational undefined (sound)', ce.box('Pi').isRational === undefined, String(ce.box('Pi').isRational));
}

// ---- Totient signature fix (F)
{
  const t = ce.box(['Totient', ['Power', 2, 'n']]);
  check('F Totient(2^n) boxes valid', t.isValid === true, t.toString());
  check('F Totient(10) = 4', ce.expr(['Totient', 10]).evaluate().re === 4);
  const sym = ce.expr(['Totient', ['Rational', 1, 2]]).evaluate();
  check('F Totient(1/2) stays symbolic', sym.operator === 'Totient', sym.toString());
}

// ---- WP-2.10 branch cuts / realness
{
  const l2 = ce.parse('\\ln(x^2)').simplify();
  check('2.10 ln(x²) → 2ln|x|', l2.toString().includes('|x|') || l2.toString().includes('abs'), l2.toString());
  const num = l2.subs({ x: -2 }).N().re as number;
  check('2.10 ln(x²) numeric at -2', approx(num, Math.log(4)), String(num));
  const l3 = ce.parse('\\ln(x^3)').simplify().toString();
  check('2.10 ln(x³) keeps convention 3ln(x)', l3.includes('3') && !l3.includes('|'), l3);
  ce.pushScope();
  ce.declare('z10', 'complex');
  const s1 = ce.expr(['Sqrt', ['Power', 'z10', 2]]).simplify();
  check('2.10 sqrt(z²) stays for complex z', !s1.toString().includes('|'), s1.toString());
  const s2 = ce.expr(['Ln', ['Power', 'z10', 2]]).simplify();
  check('2.10 ln(z²) stays for complex z', s2.toString().includes('ln(z10^2)') || s2.operator === 'Ln', s2.toString());
  ce.popScope();
  const c1 = ce.parse('\\sqrt{x}\\sqrt{y}').simplify().toString();
  check('2.10 √x·√y not combined (convention intact)', !c1.includes('xy') && !c1.includes('x * y)'), c1);
}

// ---- WP-2.11 deadlines (fast spot checks only; full battery in its test file)
{
  ce.timeLimit = 2000;
  const t0 = Date.now();
  const g = ce.expr(['Gamma', 1e300]).N();
  check('2.11 Gamma(1e300).N fast +oo', Date.now() - t0 < 4000 && g.isInfinity === true, `${Date.now() - t0}ms ${g.toString().slice(0, 20)}`);
  const t1 = Date.now();
  const f = ce.expr(['Fibonacci', 1e9]).evaluate();
  check('2.11 Fibonacci(1e9) symbolic fast', Date.now() - t1 < 4000 && f.operator === 'Fibonacci', `${Date.now() - t1}ms`);
  const ctrl = ce.expr(['Fibonacci', 100]).evaluate().toString();
  check('2.11 control Fib(100)', ctrl === '354224848179261915075', ctrl);
}

// ---- WP-2.12 + F completion
{
  const m = ce.box(['Multiply', 1e200, 1e200]).evaluate();
  check('2.12 1e200*1e200 exact (not NaN)', m.isNaN !== true && m.isExact === true, m.toString().slice(0, 30));
  ce.pushScope();
  ce.declare('M', 'matrix');
  ce.declare('P', 'matrix');
  const comm = ce.box(['Subtract', ['Multiply', 'M', 'P'], ['Multiply', 'P', 'M']]).evaluate();
  check('2.12 M·P − P·M symbolic', !comm.isSame(ce.Zero), comm.toString());
  ce.popScope();
  const e = ce.parse('|x^3|');
  e.simplify();
  ce.pushScope();
  ce.assume(ce.parse('x > 0'));
  e.simplify();
  ce.popScope();
  const after = e.simplify().toString();
  check('2.12 popScope drops assumption for held expr', after.includes('|x|') || after.includes('abs'), after);
}

// ---- prior rounds non-regression spot checks
{
  check('r1 defint inert', ce.parse('\\int_{-1}^{1} \\frac{\\sqrt{1-x^2}}{1+x^2} dx').evaluate().has('Integrate'));
  check('r2 2^127 exact', ce.parse('2^{127}').evaluate().isSame(ce.number(2n ** 127n)) === true);
  check('r2 i<2 undefined', (ce.expr(['Complex', 0, 1]) as any).isLess(2) === undefined);
  check('r3 Mod(-7,3)=2', ce.expr(['Mod', -7, 3]).evaluate().re === 2);
  check('r3 NaN order invariant', ce.box(['Add', NaN, 0.5, 'nq', 3.7]).isSame(ce.box(['Add', 3.7, 'nq', NaN, 0.5])) === true);
  check('r3 matcher keeps operands', ce.parse('w+x+y+z').replace(['...a + b -> a'])?.isSame(ce.parse('w+x+y')) === true);
  const lim = ce.expr(['Limit', ['Function', ['Multiply', 'x', ['Subtract', ['Ln', ['Add', 'x', 1]], ['Ln', 'x']]], 'x'], { sym: 'PositiveInfinity' } as any]).evaluate();
  check('r3 limit x(ln(x+1)-lnx)=1', lim.isSame(ce.number(1)) === true, lim.toString());
  check('r2 |sin x| unchanged', ce.parse('|\\sin(x)|').simplify().operator === 'Abs');
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
