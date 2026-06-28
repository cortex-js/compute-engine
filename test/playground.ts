import { ComputeEngine } from '../src/compute-engine';

// =============================================================================
// playground.ts — scratch probes into Compute Engine behavior.
//
// Triaged 2026-06-28. Probes whose described issue is now fixed were removed;
// the rest are grouped below. Run with:  npx tsx test/playground.ts
//
//   ACTIVE   — still reproduces the described problem.
//   FEATURE  — notation/behavior not yet implemented (wishlist).
//   UNCLEAR  — original intent or expected result is ambiguous; needs triage.
//   BENCH    — timing probes.
//
// Each probe prints to the console so the current behavior can be eyeballed.
// Avoid global state mutations here (precision, costFunction, …): they leak
// into every probe below and produce misleading results.
// =============================================================================

const ce = new ComputeEngine();

// =============================================================================
// ACTIVE — parsing & serialization
// =============================================================================

// Matrix multiplication: `\times` maps to Multiply, which does not implement
// matrix multiplication, so the product stays unevaluated.
// Expected: [[15, 13], [29, 23]].
ce.parse(
  String.raw`\begin{pmatrix}2 & 3\\ 4 & 5\end{pmatrix}\times\begin{pmatrix}6 & 2\\ 1 & 3\end{pmatrix}`
)
  .evaluate()
  .print();

// A styled relational operator breaks parsing: instead of Equal(x, y) this
// yields a Tuple wrapping an 'expected-closing-delimiter' error. See
// parseTextRun.
console.log(ce.parse('x \\textcolor{red}{=} y').json);

// Contents of \mathrm collapse into a single symbol "xplusalpha" instead of
// the sum x + α.
console.log(ce.parse('\\mathrm{x+\\alpha}').json);

// \gamma(2, 1) parses as EulerGamma * (2, 1) instead of the incomplete gamma
// function Gamma(2, 1).
ce.parse('\\gamma(2, 1)').print();

// `i` inside a summation index/body is treated as the imaginary unit
// (i^2 -> Complex(0, 1)^2), and `1 <= i <= 10` is not turned into limits.
// For contrast, `\sum_{i \in S} i^2` (below) parses `i` as a symbol correctly.
console.log(ce.parse('\\sum_{1 \\le i \\le 10} i^2').json);
console.log(ce.parse('\\sum_{i,j} j+i^2').json);
console.log(ce.parse('\\sum_{i \\in S} i^2').json); // ok: Sum(i^2, Element(i, S))

// No matchfix for `\left( ... \right.`; produces unexpected-command /
// unexpected-delimiter errors.
console.log(ce.parse('\\sin\\left(x\\right.').json);
console.log(ce.parse('\\frac{\\left(w\\right.-x)\\times10^6}{v}').json);

// =============================================================================
// ACTIVE — pattern matching, replace & collections
// =============================================================================

// Variation matching can't bind a = 0 so that _a*x matches 0.
const m1 = ce.parse('0').match(ce.parse('\\mathrm{_a}x'), {
  substitution: { _x: ce.expr('x') },
  useVariations: true,
});
console.log(
  'match 0 ~ _a*x:',
  m1 ? JSON.stringify(m1) : 'no match (expected a = 0 via variation)'
);

// Match against a pattern with several optional terms returns null.
const eq = ce.parse('2x-\\sqrt{5}\\sqrt{x}');
const pat = ce.expr([
  'Add',
  ['Multiply', '_a', '_x'],
  ['Multiply', '__b', ['Sqrt', ['Add', ['Multiply', '_c', '_x'], '__d']]],
  '__g',
]);
console.log(
  'complex match:',
  eq.match(pat, { substitution: { _x: ce.expr('x') }, useVariations: true })
);

// Filter is not evaluated when nested inside a List (works on its own).
const filtered = ce.expr(['Filter', ce.function('List', [1, 2, 3, 4, 5]), ['IsOdd', '_']]);
console.log('Filter alone:  ', filtered.evaluate().toString()); // [1, 3, 5]
console.log('Filter in List:', ce.function('List', [filtered]).evaluate().toString());

// =============================================================================
// FEATURE — notation / simplifications not yet implemented (wishlist)
// =============================================================================

// Iverson bracket / Boole recognition & simplification.
console.log(ce.parse('0^{|a-b|}').json); // -> Boole(Equal(a, b))
console.log(ce.parse('\\frac{2}{0^x+1}-1').json); // sign-function canonicalization
console.log(ce.parse('0^{|\\frac{2}{0^x+1}|}').json); // -> Boole(Less(x, 0))
console.log(ce.parse('0^{|\\frac{2}{0^{4-x}+1}|}').json); // -> Boole(Greater(x, 4))
console.log(ce.parse('0^{|\\frac{2}{0^{x-4}+1}|}').json); // -> Boole(Less(x, 4))
console.log(ce.parse('\\mathbb{1}_{\\N}\\left(x\\right)').json); // -> Boole(Element(x, NonNegativeInteger))
// Iverson/Boole equivalences worth (maybe) normalizing between:
//   [¬P] = 1 − [P]            [P∧Q] = [P][Q]
//   [P∨Q] = [P]+[Q]−[P][Q]    [P⊕Q] = ([P]−[Q])
//   [P→Q] = 1−[P]+[P][Q]      [P≡Q] = 1−([P]−[Q])

// Knuth coprime notation: `\bot` parses as False (Tuple[m, False, n]).
// Desired: Coprime(m, n) / Equal(Gcd(m, n), 1).
console.log(ce.parse('m\\bot n').json);
console.log(ce.parse('\\phi(n)=\\sum_{i=1}^n\\left\\lbrack i\\bot n\\right\\rbrack ').json);

// Congruence (mod) notation — a − b divisible by n.
//   ce.parse('a\\equiv b(\\mod n)')  -> Equal(Mod(a, n), Mod(b, n))
//   ce.parse('a\\equiv_{n} b')       -> Equal(Mod(a, n), Mod(b, n))
//   a ≡ b (mod 0) => a = b. See https://reference.wolfram.com/language/ref/Mod.html

// Restriction / function application `f|_{3}` errors on `|`. Desired: apply f
// at 3, and over a range -> a list.
console.log(ce.parse('f|_{3}').canonical.json);
console.log(ce.parse('f|_{3..5}').canonical.json);

// Chained inequalities of a symbol between two literals.
// Desired: Range when integer-valued, Interval otherwise; Inequality for 3+ terms.
console.log(ce.parse('5\\le b\\le 7').canonical.json); // -> Range(5, 7)
console.log(ce.parse('5\\le b\\lt 7').canonical.json); // -> Range(5, 6)
console.log(ce.parse('a\\lt b\\le c').canonical.json); // -> Inequality(a, Less, b, LessEqual, c)

// Several problems at once: \mathbb{R} not recognized, \in binds tighter than
// =, and Equal with more than two arguments fails.
console.log(
  ce.parse(
    '{\\sqrt{\\sum_{n=1}^\\infty {\\frac{10}{n^4}}}} = {\\int_0^\\infty \\frac{2xdx}{e^x-1}} = \\frac{\\pi^2}{3} \\in {\\mathbb R}'
  ).json
);

// =============================================================================
// UNCLEAR — intent or expected result ambiguous; needs triage
// =============================================================================

// `±` evaluates to a Tuple of the two values — is that the intended semantics?
console.log(ce.parse('21\\pm1').evaluate().json); // -> Tuple(20, 22)

// Exactness contract says a transcendental of an exact argument stays symbolic
// (like Sin(Pi^2)), yet this numericizes.
ce.parse('\\sin(\\pi^2)').evaluate().print();

// The exact 3/4·√3 numericizes once an imaginary term is present.
console.log(ce.parse('\\frac34 \\sqrt{3} + i').evaluate().toString());

// `\degree` binds to the whole Tan(...) -> Degrees(Tan(90 - 1e-6)). Intended
// precedence? (With explicit parens, `\tan((90-.000001)\degree)` works.)
console.log(ce.parse('\\tan (90-0.000001)\\degree').json);

// Out-of-range / multi-index At stays unevaluated — should it error or clamp?
ce.expr(['At', ['List', 7, 13, 5, 19, 2, 3, 11], 1, 2])
  .evaluate()
  .print();

// "x__" becomes a symbol — should a trailing `__` be an error instead?
ce.parse('x__+1').print();

// Error-message wording for malformed input.
console.log(ce.parse('(3+x').json); // unterminated group (expected-closing-boundary?)
console.log(ce.parse(')').json); // stray close
console.log(ce.parse('(a, b; c, d, ;; n ,, m)').json); // ';' and ',,' handling in delimited lists

// Serializes 2√3 without an explicit \times between 2 and 3 — fine, or ambiguous?
console.log(ce.parse('\\sqrt{\\sqrt{\\sqrt{2\\sqrt{3}}}}').latex);

// Sum of a list does not reduce to the scalar 180; returns the element-wise
// product list instead.
ce.assign('a', ['List', 5, 65]);
ce.assign('b', ['List', 10, 2]);
console.log(ce.parse('\\mathrm{Sum}(a \\cdot b)').evaluate().toString()); // -> [50, 130]

// Parses but doesn't canonicalize (nth-prime formula, Logimat example):
// https://github.com/uellenberg/Logimat/tree/master/examples/nth-prime
console.log(
  ce.parse(
    'p(n)=(\\sum_{v_{1}=2}^{\\operatorname{floor}\\left(1.5*n*\\ln(n)\\right)}(\\operatorname{floor}(\\frac{1}{0^{n-(\\sum_{v_{2}=2}^{v_{1}}((\\prod_{v_{3}=2}^{\\operatorname{floor}(\\sqrt{v_{2}})}(1-0^{\\operatorname{abs}(\\operatorname{floor}(\\frac{v_{2}}{v_{3}})-\\frac{v_{2}}{v_{3}})}))))}+1})))+2'
  ).json
);

// =============================================================================
// BENCH — quick timing probes (the full harness lives in benchmarks/)
// =============================================================================

console.time('evaluate');
ce.parse('(2x^2+3x+1)(2x+1)').evaluate().print();
console.timeEnd('evaluate');

console.time('N');
ce.parse('(2x^2+3x+1)(2x+1)').N().print();
console.timeEnd('N');

// Double integral N() no longer hangs (~2s), but the estimate is loose and
// stochastic vs the exact value of 1. Tracked here for the accuracy follow-up.
ce.parse('\\int_0^1 \\int_0^1 (x+y) dx dy').N().print();
