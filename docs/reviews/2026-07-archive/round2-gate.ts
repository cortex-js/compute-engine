// Round-2 combined verification gate: WP-2.3, 2.7, 2.14, 2.15, 2.16 P0 repros
// in one fresh engine/process.
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
const N = (e: any) => {
  const n = e.N();
  const v = n.operator === 'PlusMinus' ? n.op1 : n;
  return v.re as number;
};
const approx = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

// ---- WP-2.3 complex-blindness (P0-27, P0-6, P0-13)
{
  const i = ce.expr(['Complex', 0, 1]);
  const opi = ce.expr(['Complex', 1, 1]);
  check('2.3 1.5 < 2+3i undefined', ce.number(1.5).isLess(ce.expr(['Complex', 2, 3]) as any) === undefined);
  check('2.3 i < 2 undefined', (i as any).isLess(2) === undefined);
  check('2.3 (1+i) > 1 undefined', (opi as any).isGreater(1) === undefined);
  check('2.3 control 1 < 2', ce.number(1).isLess(2) === true);
  const lb = ce.expr(['Lb', i]);
  const ev = lb.evaluate(),
    nn = lb.N();
  check('2.3 Lb(i) eval im ~ 2.26618', approx(ev.im as number, Math.PI / (2 * Math.LN2), 1e-6), ev.toString());
  check('2.3 Lb(i) eval==N', approx(ev.im as number, nn.im as number, 1e-9), `${ev} vs ${nn}`);
  const m1 = ce.expr(['Max', i, 2]).evaluate().toString();
  const m2 = ce.expr(['Max', 2, i]).evaluate().toString();
  check('2.3 Max order-independent symbolic', m1.includes('max') && m2.includes('max') && m1.length === m2.length, `${m1} / ${m2}`);
}

// ---- WP-2.14 Arctan2 (P0-9, SYM P0-6, EX-19)
{
  const s = ce.expr(['Arctan2', 1, -1]).simplify();
  check('2.14 Arctan2(1,-1).simplify().N() = 3pi/4', approx(N(s), (3 * Math.PI) / 4), s.toString());
  check('2.14 Arctan2(NaN,2) eval NaN', ce.expr(['Arctan2', NaN, 2]).evaluate().isNaN === true);
  check('2.14 Arctan2(2,NaN) eval NaN', ce.expr(['Arctan2', 2, NaN]).evaluate().isNaN === true);
  const u = ce.expr(['Arctan2', 0, 'uq']).simplify();
  check('2.14 Arctan2(0,x) unknown stays', u.operator === 'Arctan2', u.toString());
  const ci = ce.expr(['Arctan2', ['Complex', 0, 1], 2]);
  check('2.14 Arctan2(i,2) eval==N symbolic', ci.evaluate().operator === 'Arctan2' && ci.N().operator === 'Arctan2');
  for (const [y, x] of [[1, 1], [1, -1], [-1, -1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]] as const)
    check(`2.14 quadrant (${y},${x})`, approx(N(ce.expr(['Arctan2', y, x])), Math.atan2(y, x)), '');
}

// ---- WP-2.7 parse cluster (P0-38, P0-39, P0-40)
{
  check('2.7 1<=2>0 True', ce.parse('1 \\le 2 > 0').evaluate().symbol === 'True');
  check('2.7 3>=2<4 True', ce.parse('3 \\ge 2 < 4').evaluate().symbol === 'True');
  check('2.7 1<=2>3 False', ce.parse('1 \\le 2 > 3').evaluate().symbol === 'False');
  check('2.7 1=2>0 False', ce.parse('1 = 2 > 0').evaluate().symbol === 'False');
  check('2.7 control 1<2<3 True', ce.parse('1 < 2 < 3').evaluate().symbol === 'True');
  check('2.7 control 3<2<1 False', ce.parse('3 < 2 < 1').evaluate().symbol === 'False');
  // serializer round-trip: Subtract(x, Negate(y))
  const raw = ce.box(['Subtract', 'x', ['Negate', 'y']], { canonical: false });
  const rt = ce.parse(raw.latex);
  const diff = rt.sub(ce.parse('x+y')).simplify();
  check('2.7 x-(-y) serializer round-trip = x+y', diff.isSame(0) === true, `${raw.latex} -> ${rt.toString()}`);
  check('2.7 log_2^2 8 = 9', N(ce.parse('\\log_2^2 8')) === 9, ce.parse('\\log_2^2 8').toString());
  const ln2 = ce.parse('\\ln^2 x');
  check('2.7 ln^2 x valid', ln2.isValid === true, ln2.toString());
}

// ---- WP-2.15 Choose/Binomial (P0-10)
{
  for (const op of ['Choose', 'Binomial']) {
    check(`2.15 ${op}(5,2)=10`, ce.expr([op, 5, 2]).evaluate().re === 10);
    check(`2.15 ${op}(2,3)=0`, ce.expr([op, 2, 3]).evaluate().re === 0);
    check(`2.15 ${op}(-2,3)=-4`, ce.expr([op, -2, 3]).evaluate().re === -4);
    let threw = false;
    try {
      ce.expr([op, ['Rational', 1, 2], ['Rational', 1, 3]]).evaluate();
    } catch {
      threw = true;
    }
    check(`2.15 ${op}(1/2,1/3) no-throw`, !threw);
  }
  check('2.15 Binomial(1/2,2).N = -0.125', approx(N(ce.expr(['Binomial', ['Rational', 1, 2], 2])), -0.125));
}

// ---- WP-2.16 exact powers (P0-4 residual, P0-16a, P0-11, EX-15)
{
  const p = ce.expr(['Power', 2, 127]).evaluate();
  check('2.16 2^127 exact 39 digits', JSON.stringify(p.json).includes('170141183460469231731687303715884105728'), JSON.stringify(p.json).slice(0, 50));
  check('2.16 IsPrime(2^127-1) True end-to-end', ce.parse('2^{127}-1').evaluate().isSame(ce.number(170141183460469231731687303715884105727n)) === true && ce.expr(['IsPrime', ce.parse('2^{127}-1')]).evaluate().symbol === 'True');
  const q = ce.expr(['Power', 2, -2]).evaluate();
  check('2.16 2^-2 = 1/4 exact', q.isSame(ce.expr(['Rational', 1, 4])) === true, q.toString());
  const g = ce.expr(['Power', ['Complex', 1, 1], 2]).evaluate();
  check('2.16 (1+i)^2 = 2i exact', g.re === 0 && g.im === 2, g.toString());
  const g4 = ce.expr(['Power', ['Complex', 1, 1], 4]).evaluate();
  check('2.16 (1+i)^4 = -4', g4.re === -4 && g4.im === 0, g4.toString());
  const huge = ce.expr(['Power', 2, 1e15]).evaluate();
  let jsonOk = true;
  try {
    JSON.stringify(huge.json);
  } catch {
    jsonOk = false;
  }
  check('2.16 2^1e15 symbolic + json ok', huge.operator === 'Power' && jsonOk, huge.toString().slice(0, 30));
  check('2.16 control 2^10=1024', ce.expr(['Power', 2, 10]).evaluate().re === 1024);
  check('2.16 control 2^127.N ~ 1.7e38', approx(N(ce.expr(['Power', 2, 127])) / 1.7014118346046923e38, 1, 1e-9));
}

// ---- round-1 non-regression spot checks (still green together with round 2)
{
  check('r1 Argument(1+i)=pi/4', approx(N(ce.expr(['Argument', ['Complex', 1, 1]]).evaluate()), Math.PI / 4));
  check('r1 2(1+i)=2+2i', ce.expr(['Multiply', 2, ['Complex', 1, 1]]).evaluate().re === 2);
  const dint = ce.parse('\\int_{-1}^{1} \\frac{\\sqrt{1-x^2}}{1+x^2} dx').evaluate();
  check('r1 hard defint inert', dint.has('Integrate'));
  const s = ce.expr(['Sum', ['Sqrt', 'k'], ['Tuple', 'k', 1, 5]]).evaluate();
  check('r1 Sum exact', JSON.stringify(s.json).includes('Sqrt'));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
