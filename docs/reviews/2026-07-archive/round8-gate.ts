// Round-8 gate: fresh-process probes covering all five agents' claims.
// Run: npx tsx round8-gate.ts
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

// ───── Agent 1: assumptions cluster ─────
{
  // A: sign via bounds — n ∈ Range(1,10) ⇒ isPositive true
  const ce = new ComputeEngine();
  ce.pushScope();
  ce.assume(ce.parse('n \\in \\lbrack 1, 10 \\rbrack')); // may not parse; use box
  ce.popScope();
}
{
  const ce = new ComputeEngine();
  ce.pushScope();
  ce.assume(ce.box(['Element', 'n', ['Range', 1, 10]]));
  check('A1 n∈Range(1,10) isPositive', ce.box('n').isPositive, true);
  ce.popScope();

  ce.pushScope();
  ce.assume(ce.parse('w > 4'));
  check('A2 w>4 ⇒ w.isEqual(2)', ce.box('w').isEqual(2), false);
  ce.popScope();

  ce.pushScope();
  ce.assume(ce.parse('s > 4'));
  ce.assume(ce.parse('t < 1'));
  check('A3 s>4,t<1 ⇒ s>t', ce.box('s').isGreater(ce.box('t')), true);
  check('A3b Greater(s,t) evaluates True', ce.box(['Greater', 's', 't']).evaluate().symbol, 'True');
  ce.popScope();

  ce.pushScope();
  ce.assume(ce.parse('x > 0'));
  check('A4 x>0 discharges x≠0', ce.verify(ce.parse('x \\ne 0')), true);
  ce.popScope();

  // C: atomic conjunction — contradictory And leaves no residue
  ce.pushScope();
  const r = ce.assume(ce.box(['And', ['Greater', 'p', 0], ['Less', 'p', -5]]));
  check('C1 contradictory And rejected', r, 'contradiction');
  check('C2 no residue p.isPositive', ce.box('p').isPositive, undefined);
  ce.popScope();

  // D: no-arg forget clears assume-values but not assigns
  ce.pushScope();
  ce.assume(ce.parse('q = 5'));
  ce.assign('y2', 7);
  ce.forget();
  check('D1 assumed value cleared', ce.box('q').evaluate().toString(), 'q');
  check('D2 assigned value survives', ce.box('y2').evaluate().toString(), '7');
  ce.popScope();

  // E: domainToType signed sets
  ce.pushScope();
  ce.assume(ce.box(['Element', 'k', 'PositiveIntegers']));
  check('E1 k∈Z+ isInteger', ce.box('k').isInteger, true);
  check('E2 k∈Z+ isPositive', ce.box('k').isPositive, true);
  ce.popScope();
}

// ───── Agent 2: D10 type lattice ─────
{
  const ce = new ComputeEngine();
  check('D10-1 real⊂complex', ce.type('real').matches('complex'), true);
  check('D10-2 integer⊂complex', ce.type('integer').matches('complex'), true);
  check('D10-3 complex⊄real', ce.type('complex').matches('real'), false);
  check('D10-4 real still admits ±∞: isReal(+oo)', ce.box('PositiveInfinity').isReal, true);
  // P2-20: union canonical order
  const t1 = ce.type('integer | string').toString();
  const t2 = ce.type('string | integer').toString();
  check('P2-20 union order canonical', t1 === t2, true);
  // Real symbol satisfies complex-typed operations end to end (shim-1 retirement class)
  ce.declare('rr', 'real');
  check('D10-5 real symbol type matches complex', ce.box('rr').type.matches('complex'), true);
}

// ───── Agent 3: Rubi/packs ─────
{
  const ce = new ComputeEngine();
  // ln(e) Divide-context fold
  const e1 = ce.parse('\\frac{\\ln(e) \\cdot y}{x}').simplify();
  check('R1 (ln(e)·y)/x → y/x', e1.toString(), ce.parse('\\frac{y}{x}').simplify().toString());
  const e2 = ce.parse('\\frac{\\ln(2) \\cdot y}{x}').simplify();
  check('R2 ln(2) stays symbolic', e2.has('Ln') || e2.toString().includes('ln'), true);
}

// ───── Agent 4: P2-5 Bernoulli correctness ─────
{
  // precision escalation must not serve a stale short table
  const ce = new ComputeEngine();
  ce.precision = 20;
  ce.parse('\\Gamma(1.23456789)').N(); // build small table
  ce.precision = 300;
  const a = ce.parse('\\Gamma(1.23456789)').N().toString();
  const ce2 = new ComputeEngine();
  ce2.precision = 300;
  const b = ce2.parse('\\Gamma(1.23456789)').N().toString();
  check('B1 Gamma@300 after escalation == fresh@300', a === b, true);
}

// ───── Agent 5: library bugs ─────
{
  const ce = new ComputeEngine();
  check('L1 Intersection({1,2},{2})', ce.box(['Intersection', ['Set', 1, 2], ['Set', 2]]).evaluate().toString(), 'Set(2)');
  check('L2 Union({1,2},{2,3}) has 3 elems', ce.box(['Union', ['Set', 1, 2], ['Set', 2, 3]]).evaluate().json.toString().includes('3'), true);
  check('L3 Reverse([1,2,3])', ce.box(['Reverse', ['List', 1, 2, 3]]).evaluate().toString(), '[3,2,1]');
  check('L4 Reverse([]) no crash', typeof ce.box(['Reverse', ['List']]).evaluate().toString(), 'string');
  const nce = new ComputeEngine();
  nce.strict = false;
  check('L5 non-strict Sin() degrades', nce.expr(['Sin']).evaluate().toString().includes('undefined'), false);
  check('L6 non-strict Negate() no crash', typeof nce.expr(['Negate']).evaluate().toString(), 'string');
  check('L7 SymmetricDifference({1,2},{2,3})', ce.box(['SymmetricDifference', ['Set', 1, 2], ['Set', 2, 3]]).evaluate().toString(), 'Set(1, 3)');
}

// ───── Round non-regression spot checks ─────
{
  const ce = new ComputeEngine();
  check('NR1 IsPrime(2^127-1)', ce.box(['IsPrime', ['Subtract', ['Power', 2, 127], 1]]).evaluate().symbol, 'True');
  check('NR2 arctan(1)', ce.parse('\\arctan(1)').evaluate().toString(), '1/4 * pi');
  check('NR3 ln(2) exact stays symbolic', ce.parse('\\ln(2)').evaluate().toString(), 'ln(2)');
  check('NR4 Mod(-7,3) floored', ce.box(['Mod', -7, 3]).evaluate().toString(), '2');
  check('NR5 Power(2,-2) exact', ce.box(['Power', 2, -2]).evaluate().toString(), '1/4');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
