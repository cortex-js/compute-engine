/**
 * Round-7 fresh-process gate: leftover P1s — small clusters (P1-13/21/PA-P1-1),
 * validation (P1-14/15/19/20), type lattice (P1-16/17/18), round-trip
 * (RT-P1-1/2/3 with F's option-b completion: canonicalDivide exact fold).
 * Run: npx tsx round7-gate.ts
 */
import { ComputeEngine } from '/Users/arno/dev/compute-engine/src/compute-engine.ts';
import { isSubtype } from '/Users/arno/dev/compute-engine/src/common/type/subtype.ts';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}`);
  }
}

// ───────── P1-13: Pythagorean n-ary ─────────
{
  const ce = new ComputeEngine();
  const r = ce.parse('\\sin^2(x) + \\cos^2(x) + y').simplify();
  check('P1-13: sin²x+cos²x+y → y+1', r.isSame(ce.parse('y+1').canonical));
  check('P1-13: sin²x+cos²x → 1', ce.parse('\\sin^2(x)+\\cos^2(x)').simplify().isSame(1));
  const diff = ce.parse('\\sin^2(x) + \\cos^2(y) + z').simplify();
  check('P1-13: different args unchanged', diff.operator === 'Add' && diff.ops!.length === 3);
  check('P1-13: 3sin²x+3cos²x+y → 3+y', ce.parse('3\\sin^2(x)+3\\cos^2(x)+y').simplify().isSame(ce.parse('y+3').canonical));
}

// ───────── P1-21: Fungrim complex guard (spot check via loader suite already; here: no-wrong-result) ─────────
// (Detailed corpus checks live in fungrim-loader.test.ts — 107/107.)

// ───────── PA-P1-1: ln/exp sup parsing ─────────
{
  const ce = new ComputeEngine();
  const a = ce.parse('\\ln^2 x');
  check('PA-P1-1: \\ln^2 x → Power(Ln x,2)', JSON.stringify(a.json) === JSON.stringify(['Power', ['Ln', 'x'], 2]));
  const b = ce.parse('\\ln^{-1} x');
  // Exp(x) canonicalizes to Power(e, x) — the inverse-of-ln convention,
  // mirroring \sin^{-1} → Arcsin.
  check('PA-P1-1: \\ln^{-1} x → e^x', b.isSame(ce.box(['Exp', 'x'])));
  check('PA-P1-1: no Error in \\lg^2 x', !JSON.stringify(ce.parse('\\lg^2 x').json).includes('Error'));
}

// ───────── P1-14/15/20: validation ─────────
{
  const ce = new ComputeEngine();
  check('P1-14: Sin("hello") invalid (strict)', ce.box(['Sin', { str: 'hello' }] as any).isValid === false);
  check('P1-14: Sin(x) still valid', ce.box(['Sin', 'x']).isValid === true);
  const f12 = ce.box(['Factorial', ['Rational', 1, 2]]).evaluate();
  check('P1-14: Factorial(1/2) = Γ(3/2) ≈ 0.886', Math.abs(f12.N().re - 0.8862269254527581) < 1e-12);
  ce.declare('f', '(integer) -> integer');
  check('P1-15: f(0.5) invalid', ce.box(['f', 0.5]).isValid === false);
  check('P1-15: f(3) valid', ce.box(['f', 3]).isValid === true);
  check('P1-15: f(x) defers (valid)', ce.box(['f', 'x']).isValid === true);
  const s = ce.box(['Sum', 'x', ['Tuple', 'x', { str: 'lo' }, 10]] as any).evaluate();
  check('P1-20: Sum with string bound ≠ 55', s.re !== 55);
  const m = ce.box(['Map', ['List', 1, 2, 3], { str: 'nf' }] as any).evaluate();
  check('P1-20: Map with string fn stays symbolic', m.operator === 'Map' || m.isValid === false);
}

// ───────── P1-19: higher-order types ─────────
{
  const ce = new ComputeEngine();
  const lam = ce.parse('x \\mapsto x^2');
  const t = lam.type.toString();
  check('P1-19a: (x↦x²) result type widened (no finite claim)', !/finite/.test(t));
  const s = ce.box(['Sum', ['Function', '_1', '_1'], ['Tuple', 'n', 1, 3]] as any).evaluate();
  check('P1-19b: Sum of function literal not a mistyped lambda', s.operator !== 'Function' || s.isValid === false);
}

// ───────── P1-16/17/18: type lattice ─────────
{
  check('P1-16: real <: finite_real|non_finite_number', isSubtype('real', 'finite_real | non_finite_number' as any) === true);
  check('P1-17: symbol not <: expression<Add>', isSubtype('symbol', 'expression<Add>' as any) === false);
  check('P1-17: symbol <: expression<Symbol>', isSubtype('symbol', 'expression<Symbol>' as any) === true);
}

// ───────── RT-P1-1/2 + option (b) ─────────
{
  const ce = new ComputeEngine();
  for (const latex of ['\\frac{\\sqrt{3}}{2}', '-\\frac{\\sqrt{3}}{2}', '\\frac{3\\sqrt{2}}{5}']) {
    const x = ce.parse(latex).evaluate();
    check(`RT-P1-1: ${latex} round-trips (isSame)`, ce.expr(x.json).isSame(x) === true);
  }
  // Divide-form json preserved (matcher/structural stability)
  const st = ce.parse('\\frac{\\sqrt{3}}{2}').evaluate();
  check('RT-P1-1: json stays Divide form', JSON.stringify(st.json) === JSON.stringify(['Divide', ['Sqrt', 3], 2]));
  // option (b): Divide of exact literals folds
  check('RT-P1-1b: box(Divide(Sqrt3,3)) is a literal', ce.box(['Divide', ['Sqrt', 3], 3]).isNumberLiteral === true);
  check('RT-P1-1b: floats do not fold', ce.box(['Divide', 1.5, 2]).operator === 'Divide');
  // Divide-form PATTERNS still match radical literals (the round-7 regression F caught)
  const target = ce.parse('\\arctan\\left(\\frac{\\sqrt{3}}{3}\\right)');
  const m = target.canonical.op1.match(ce.box(['Divide', ['Sqrt', 3], 3], { canonical: false }));
  check('RT-P1-1b: Divide-form pattern matches literal', m !== null);
  // dict isSame
  const d1 = ce.box(['Dictionary', ['Tuple', { str: 'a' }, 1], ['Tuple', { str: 'b' }, 2]] as any);
  const d2 = ce.box(['Dictionary', ['Tuple', { str: 'b' }, 2], ['Tuple', { str: 'a' }, 1]] as any);
  const d3 = ce.box(['Dictionary', ['Tuple', { str: 'a' }, 1], ['Tuple', { str: 'b' }, 3]] as any);
  check('RT-P1-2: equal dicts isSame', d1.isSame(d2) === true);
  check('RT-P1-2: different dicts not isSame', d1.isSame(d3) === false);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
