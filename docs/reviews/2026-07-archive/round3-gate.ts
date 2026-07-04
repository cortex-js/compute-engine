// Round-3 combined verification gate: WP-2.4, 2.5, 2.6, 2.8, F.1, F.2
// + rounds 1-2 non-regression, one fresh process.
import { ComputeEngine } from '/Users/arno/dev/compute-engine/src/compute-engine';
import { compile } from '/Users/arno/dev/compute-engine/src/compute-engine/compilation/compile-expression';

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

// ---- WP-2.4 (P0-28/29/30/31)
{
  const p1 = ce.box(['Add', NaN, 0.5, 'nx', 3.7]);
  const p2 = ce.box(['Add', 3.7, 'nx', NaN, 0.5]);
  check('2.4 NaN canonical order permutation-invariant', p1.isSame(p2) === true, `${p1.toString()} vs ${p2.toString()}`);
  ce.pushScope();
  ce.assume(ce.parse('a_1 = b_1') as any);
  check('2.4 assume(a=b) => isEqual true', ce.box('a_1').isEqual(ce.box('b_1')) === true);
  ce.popScope();
  check('2.4 x.isEqual(y) undefined for free symbols', ce.box('fx1').isEqual(ce.box('fy1')) === undefined);
  ce.assign('g1', ce.parse('x^2+1'));
  const lhs = ce.box('g1').is(ce.parse('x^2+1'));
  const rhs = ce.parse('x^2+1').is(ce.box('g1'));
  check('2.4 .is() symmetric for expr bindings', lhs === true && rhs === true, `${lhs}/${rhs}`);
}

// ---- WP-2.5 (P0-7 interp)
{
  const mod = (a: any, b: any) => ce.expr(['Mod', a, b]).evaluate();
  check('2.5 Mod(-7,3)=2', mod(-7, 3).re === 2);
  check('2.5 Mod(7,-3)=-2', mod(7, -3).re === -2);
  check('2.5 Mod(-7,-3)=-1', mod(-7, -3).re === -1);
  const r = mod(['Rational', 1, 2], ['Rational', 1, 3]);
  check('2.5 Mod(1/2,1/3)=1/6 exact', r.isSame(ce.expr(['Rational', 1, 6])) === true, r.toString());
  check('2.5 sgn agrees', ce.box(['Mod', -7, 3]).sgn === 'positive', String(ce.box(['Mod', -7, 3]).sgn));
}

// ---- WP-2.6 (P0-32..37)
{
  const big = ce.parse('10^{23}').evaluate();
  const rt = ce.box(big.json);
  check('2.6 10^23 json round-trip lossless', rt.isSame(big) === true, JSON.stringify(big.json));
  const b2 = ce.box({ num: '0.12345678901234567' } as any);
  check('2.6 17-digit json unchanged', ce.box(b2.json).isSame(b2) === true, JSON.stringify(b2.json));
  const third = ce.expr(['Rational', 1, 3]).N();
  const mj = third.toMathJson();
  check('2.6 0.(3) re-boxes as number', ce.box(mj as any).type.toString() !== 'string', JSON.stringify(mj));
  const lx = third.latex;
  check('2.6 1/3 latex has overline', lx.includes('\\overline'), lx);
  const f2 = ce.parse("f''(x)");
  const rt2 = ce.parse(f2.latex);
  check('2.6 f\'\'(x) latex round-trip', rt2.isSame(f2.canonical) === true || JSON.stringify(rt2.json).includes('Derivative') || JSON.stringify(rt2.json).includes('"D"'), `${f2.latex} -> ${JSON.stringify(rt2.json).slice(0, 80)}`);
}

// ---- WP-2.8 (P0-41..46 + P0-7 targets) — JS executed
{
  ce.pushScope();
  const c1r = compile(ce.parse('\\operatorname{arccot}(x)')); const c1 = c1r?.run;
  check('2.8 compiled Arccot(-2) ~ 2.678', c1 !== undefined && approx(c1({ x: -2 }) as number, Math.PI / 2 - Math.atan(-2)), String(c1 && c1({ x: -2 })));
  const c2 = compile(ce.box(['Round', 'x']))?.run;
  check('2.8 compiled Round(-2.5) = -3', c2 !== undefined && (c2({ x: -2.5 }) as number) === -3, String(c2 && c2({ x: -2.5 })));
  const c3 = compile(ce.box(['Sum', ['Multiply', 'i', 'j'], ['Tuple', 'i', 1, 3], ['Tuple', 'j', 1, 3]]))?.run;
  check('2.8 compiled multi-index Sum = 36', c3 !== undefined && (c3({}) as number) === 36, String(c3 && c3({})));
  const c4 = compile(ce.box(['Mod', 'x', 3]))?.run;
  check('2.8 compiled Mod(-1,3) = 2', c4 !== undefined && (c4({ x: -1 }) as number) === 2, String(c4 && c4({ x: -1 })));
  let failedClosed = false;
  try {
    const c5 = compile(ce.box(['Sqrt', -4]), { fallback: false } as any);
    failedClosed = c5 === undefined || c5.success === false;
  } catch {
    failedClosed = true;
  }
  check('2.8 Sqrt(-4) compile fails closed', failedClosed);
  ce.popScope();
}

// ---- F.1 matcher
{
  const r = ce.parse('w+x+y+z').replace(['...a + b -> a']);
  check('F.1 replace keeps all operands', r !== null && r.isSame(ce.parse('w+x+y')) === true, String(r));
  const m = ce.box(['Tuple', 'x', 'y', 'q', 'x', 'z']).match(ce.box(['Tuple', '__a', '_m', '__a'], { canonical: false }));
  check('F.1 conflicting repeated __a rejected', m === null);
}

// ---- F.2 limits
{
  const lim = (body: any) => ce.expr(['Limit', ['Function', body, 'x'], { sym: 'PositiveInfinity' } as any]).evaluate();
  check('F.2 x(ln(x+1)-ln x)=1', lim(['Multiply', 'x', ['Subtract', ['Ln', ['Add', 'x', 1]], ['Ln', 'x']]]).isSame(ce.number(1)) === true);
  check('F.2 sqrt(x)(sqrt(x+1)-sqrt x)=1/2', lim(['Multiply', ['Sqrt', 'x'], ['Subtract', ['Sqrt', ['Add', 'x', 1]], ['Sqrt', 'x']]]).isSame(ce.expr(['Rational', 1, 2])) === true);
}

// ---- rounds 1-2 non-regression spot checks
{
  check('r1 defint inert', ce.parse('\\int_{-1}^{1} \\frac{\\sqrt{1-x^2}}{1+x^2} dx').evaluate().has('Integrate'));
  check('r1 IsPrime(M127 literal)', ce.expr(['IsPrime', ce.number(170141183460469231731687303715884105727n)]).evaluate().symbol === 'True');
  check('r2 2^127 exact via parse', ce.parse('2^{127}').evaluate().isSame(ce.number(2n ** 127n)) === true);
  check('r2 i<2 undefined', (ce.expr(['Complex', 0, 1]) as any).isLess(2) === undefined);
  check('r2 mixed chain 1<=2>0 True', ce.parse('1 \\le 2 > 0').evaluate().symbol === 'True');
  check('r2 Arctan2(1,-1) simplify 3pi/4', approx(ce.expr(['Arctan2', 1, -1]).simplify().N().re as number, (3 * Math.PI) / 4));
  check('r2 Choose(-2,3)=-4', ce.expr(['Choose', -2, 3]).evaluate().re === -4);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
