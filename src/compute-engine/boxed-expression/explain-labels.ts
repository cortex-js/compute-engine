/**
 * Labeling layer for `expr.explain()`.
 *
 * Maps the machine ids of rules and algorithmic phases (the `because`
 * string of a `RuleStep`, which is the rule's `id`) to default English
 * descriptions.
 *
 * The registry is seeded with curated descriptions for the most frequently
 * fired rules. Unregistered ids fall back to a prettifier so every step
 * always has a readable description.
 *
 * **Stability contract:** once shipped, a registered id is frozen — the id
 * is the localization key consumers use for translations and custom copy.
 * Renaming a rule id requires keeping the old id as a registry alias.
 */

/** A resolved step label. `registered` is true when the description came
 * from the curated registry (vs. the prettifier fallback) — used by the
 * label-coverage harness to keep label debt visible. */
export type StepLabel = {
  id: string;
  description: string;
  registered: boolean;
};

const STEP_LABELS = new Map<string, string>();

/**
 * Register default English descriptions for step ids.
 *
 * Later registrations override earlier ones (consumers may override the
 * built-in descriptions, though localization is better keyed off
 * `ExplainStep.id`).
 */
export function registerStepLabels(labels: Record<string, string>): void {
  for (const [id, description] of Object.entries(labels))
    STEP_LABELS.set(id, description);
}

/**
 * Resolve the public label of a step from the id of the rule (or
 * algorithmic phase) that produced it.
 *
 * The id is returned verbatim (it is already the stable machine id); only
 * the description is derived: from the registry when registered, otherwise
 * from a prettifier over the id itself.
 */
export function labelFor(because: string): StepLabel {
  const id = because === '' ? 'unknown-rule' : because;

  const registered = STEP_LABELS.get(id);
  if (registered !== undefined)
    return { id, description: registered, registered: true };

  // Rubi integration-rule ids get a uniform description keyed off the
  // underlying rule id (a systematic family, like 'fungrim:'). The id embeds
  // the full corpus file path ('rubi:1 Algebraic functions/…/1.1.1.1 (a+b
  // x)^m.m#7') for stability; the description uses only the last path
  // segment — the section number and rule index — to stay readable.
  if (id.startsWith('rubi:')) {
    const ruleId = id.slice('rubi:'.length);
    const tail = ruleId.slice(ruleId.lastIndexOf('/') + 1);
    // '1.1.1.1 (a+b x)^m.m#7' → section '1.1.1.1', rule index '7'
    const m = tail.match(/^([\d.]+)\s?.*#(\d+)$/);
    return {
      id,
      description: m
        ? `Apply integration rule ${m[1]}#${m[2]} (Rubi)`
        : `Apply integration rule ${tail} (Rubi)`,
      registered: true,
    };
  }

  return { id, description: prettify(id), registered: false };
}

/** Derive a readable description from an unregistered id. */
function prettify(id: string): string {
  if (id === 'unknown-rule') return 'Simplify';

  // Opaque identity ids from the Fungrim loader
  if (id.startsWith('fungrim:')) return `Apply identity ${id}`;

  // Arrow-style rule ids ('a^m / a^n -> a^{m-n}') are already readable
  if (id.includes('->')) return `Apply ${id.replace(/->/g, '→')}`;

  // Kebab-case slugs ('abs-negate') get de-hyphenated
  if (/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id)) {
    const words = id.replace(/[.-]/g, ' ');
    return words[0].toUpperCase() + words.slice(1);
  }

  // Prose ('partial fraction decomposition') gets capitalized
  return id[0].toUpperCase() + id.slice(1);
}

//
// Seed registry: curated descriptions for the most-fired rule ids, measured
// over the simplify test corpus. (The label-coverage harness in
// `test/compute-engine/explain.test.ts` keeps this list honest — run it
// when adding rules to see uncovered ids.)
//
registerStepLabels({
  // ── Driver / explain-internal phases ──
  'simplify-terms': 'Simplify the terms',
  'fu': 'Apply trigonometric simplification (Fu algorithm)',
  'exp-to-trig':
    'Rewrite exponentials as trigonometric functions (Euler’s formula)',
  'simplify-relational-operator': 'Simplify both sides of the relation',

  // ── Arithmetic folding ──
  'addition': 'Add the terms',
  'multiplication': 'Multiply the factors',
  'division': 'Divide the terms',
  'negation': 'Negate',
  'power': 'Evaluate the power',
  'root': 'Evaluate the root',
  'sqrt': 'Evaluate the square root',
  'rational': 'Simplify the fraction',

  // ── Structural ──
  'expand': 'Expand the expression',
  'cancel common polynomial factors': 'Cancel the common factors',
  'partial fraction decomposition': 'Decompose into partial fractions',
  'a/a -> 1': 'Cancel the common factor: a⁄a = 1',

  // ── Powers ──
  'combined powers': 'Combine the powers',
  'combined powers with same base': 'Combine powers with the same base',
  'x^n * x^m -> x^{n+m}': 'Combine powers with the same base: xⁿ·xᵐ = xⁿ⁺ᵐ',
  'x * x^n -> x^{n+1}': 'Combine powers with the same base: x·xⁿ = xⁿ⁺¹',
  'a^m / a^n -> a^{m-n}': 'Subtract the exponents: aᵐ⁄aⁿ = aᵐ⁻ⁿ',
  'a^m / a -> a^{m-1}': 'Subtract the exponents: aᵐ⁄a = aᵐ⁻¹',
  'a / a^n -> a^{1-n}': 'Subtract the exponents: a⁄aⁿ = a¹⁻ⁿ',
  '(-x)^n -> -x^n when n is odd': 'Factor out the sign: (−x)ⁿ = −xⁿ for odd n',
  '(-x)^n -> x^n when n is even': 'Drop the sign: (−x)ⁿ = xⁿ for even n',
  '(-x)^{n/m} -> x^{n/m} when n is even and m is odd':
    'Drop the sign: (−x)ⁿᐟᵐ = xⁿᐟᵐ for even n and odd m',
  '(-x)^{n/m} -> -x^{n/m} when n and m are odd':
    'Factor out the sign: (−x)ⁿᐟᵐ = −xⁿᐟᵐ for odd n and m',
  'root(-a, n) -> -root(a, n) when n odd':
    'Factor the sign out of the odd root: ⁿ√(−a) = −ⁿ√a',
  'a / (b/c)^d -> a * (c/b)^d': 'Dividing by (b⁄c)ᵈ is multiplying by (c⁄b)ᵈ',

  // ── Roots & radicals ──
  'denest √(a+b√c) -> √x+√y': 'Denest the radical',
  'sqrt(x^2) -> |x|': 'Apply √(x²) = |x|',
  'sqrt(x^{2n}) -> |x|^n': 'Apply √(x²ⁿ) = |x|ⁿ',
  'root(x^n, n) -> x when n odd': 'Apply ⁿ√(xⁿ) = x for odd n',
  'root(x^n, n) -> |x| when n even': 'Apply ⁿ√(xⁿ) = |x| for even n',
  'root(x^m, n) -> |x|^{m/n}': 'Rewrite the root as a power: ⁿ√(xᵐ) = |x|ᵐᐟⁿ',
  'root(1, n) -> 1': 'A root of 1 is 1',
  'root(0, n) -> 0 when n > 0': 'A root of 0 is 0',
  'root(root(x, m), n) -> x^{1/(m*n)}':
    'Combine the nested roots: ⁿ√(ᵐ√x) = x^(1⁄(m·n))',
  'sqrt(sqrt(x)) -> x^{1/4}': 'Combine the nested roots: √(√x) = x^(1⁄4)',
  'root(sqrt(x), n) -> x^{1/(2n)}':
    'Combine the nested roots: ⁿ√(√x) = x^(1⁄(2n))',
  'sqrt(root(x, n)) -> x^{1/(2n)}':
    'Combine the nested roots: √(ⁿ√x) = x^(1⁄(2n))',
  'root(product, n) -> factored': 'Distribute the root over the product',

  // ── Exponentials & logarithms ──
  'ln': 'Simplify the natural logarithm',
  'log': 'Simplify the logarithm',
  'combine ln terms': 'Combine the logarithms',
  'combine log terms': 'Combine the logarithms',
  'e^ln(x) -> x': 'Apply e^(ln x) = x: exp and ln are inverses',
  'c^log_c(x) -> x':
    'Apply c^(log꜀ x) = x: the exponential and the logarithm are inverses',
  'e^(ln(x) + y) -> x * e^y': 'Split the exponent: e^(ln x + y) = x·eʸ',
  'e^(ln(x) * y) -> x^y': 'Apply e^(y·ln x) = xʸ',
  'c^(log_c(x) + y) -> x * c^y': 'Split the exponent: c^(log꜀ x + y) = x·cʸ',
  'c^(log_c(x) * y) -> x^y': 'Apply c^(y·log꜀ x) = xʸ',
  'ln(e^x * y) -> x + ln(y)': 'Expand the logarithm: ln(eˣ·y) = x + ln y',
  'log_c(c) -> 1': 'The logarithm of the base is 1',
  'log_c(c^x) -> x':
    'Apply log꜀(cˣ) = x: the logarithm and the exponential are inverses',
  'log_c(c^x * y) -> x + log_c(y)':
    'Expand the logarithm: log꜀(cˣ·y) = x + log꜀ y',
  'log_c(c^x / y) -> x - log_c(y)':
    'Expand the logarithm: log꜀(cˣ⁄y) = x − log꜀ y',
  'log_c(y / c^x) -> log_c(y) - x':
    'Expand the logarithm: log꜀(y⁄cˣ) = log꜀ y − x',
  'log_c(x^n) -> n*log_c(x)': 'Bring the exponent out: log(xⁿ) = n·log x',
  'log_c(x^n) -> n*log_c(|x|) when n even':
    'Bring the exponent out: log(xⁿ) = n·log|x| for even n',
  'log_c(x^{p/q}) -> (p/q)*log_c(x)':
    'Bring the exponent out: log(xᵖᐟ𐞥) = (p⁄q)·log x',
  'log_c(x^{p/q}) -> (p/q)*log_c(|x|) when p even':
    'Bring the exponent out: log(xᵖᐟ𐞥) = (p⁄q)·log|x| for even p',
  'ln(a)/ln(b) -> k when a = b^k':
    'Recognize the logarithm ratio: ln(bᵏ)⁄ln(b) = k',
  'log_{1/c}(a) -> -log_c(a)': 'Invert the base: log₁⁄꜀(a) = −log꜀(a)',
  'log_c(a) / log_c(b) -> ln(a) / ln(b)':
    'Change of base: log꜀(a)⁄log꜀(b) = ln(a)⁄ln(b)',
  'log_c(a) / ln(a) -> 1/ln(c)': 'Change of base: log꜀(a)⁄ln(a) = 1⁄ln(c)',
  'ln(a) / log_c(a) -> ln(c)': 'Change of base: ln(a)⁄log꜀(a) = ln(c)',
  'log base 0 or 1 -> NaN': 'A logarithm base of 0 or 1 is undefined',
  'log_c(0) -> NaN': 'The logarithm of 0 is undefined',

  // ── Absolute value & sign ──
  'abs-negate': 'Apply |−x| = |x|',
  '|-x| -> |x|': 'Apply |−x| = |x|',
  '|x| -> x': 'Drop the absolute value: the argument is non-negative',
  '|x| -> -x': 'Resolve the absolute value: the argument is non-positive',
  '|xy| -> x|y| when x >= 0':
    'Move the non-negative factor out of the absolute value',
  '|x/y| -> |x|/y when y >= 0':
    'Move the non-negative denominator out of the absolute value',
  '|x/y| -> x/|y| when x >= 0':
    'Move the non-negative numerator out of the absolute value',
  '|x|^n -> x^n when n is even':
    'Drop the absolute value: |x|ⁿ = xⁿ for even n',
  '|x^n| -> x^n when n is even': 'Drop the absolute value: xⁿ ≥ 0 for even n',
  '|x^n| -> |x|^n when n is odd':
    'Move the absolute value onto the base: |xⁿ| = |x|ⁿ for odd n',
  '|x|^(p/q) -> x^(p/q) when p is even':
    'Drop the absolute value: |x|ᵖᐟ𐞥 = xᵖᐟ𐞥 for even p',
  '|x^(p/q)| -> x^(p/q) when p is even':
    'Drop the absolute value: xᵖᐟ𐞥 ≥ 0 for even p',
  '|x^(p/q)| -> |x|^(p/q) when p is odd':
    'Move the absolute value onto the base: |xᵖᐟ𐞥| = |x|ᵖᐟ𐞥 for odd p',
  'sign positive': 'The sign of a positive quantity is 1',
  'sign negative': 'The sign of a negative quantity is −1',
  'sign zero': 'The sign of zero is 0',

  // ── Trigonometric identities ──
  'sin²(x) + cos²(x) -> 1': 'Apply the Pythagorean identity: sin²x + cos²x = 1',
  'a*sin²(x) + a*cos²(x) -> a':
    'Apply the Pythagorean identity: sin²x + cos²x = 1',
  'tan²(x) + 1 -> sec²(x)': 'Apply the Pythagorean identity: tan²x + 1 = sec²x',
  '1 + cot²(x) -> csc²(x)': 'Apply the Pythagorean identity: 1 + cot²x = csc²x',
  'sin(x)cos(y)+cos(x)sin(y) -> sin(x+y)':
    'Apply the angle-addition identity: sin x cos y + cos x sin y = sin(x + y)',
  'sin(x)cos(y)-cos(x)sin(y) -> sin(x-y)':
    'Apply the angle-subtraction identity: sin x cos y − cos x sin y = sin(x − y)',
});

//
// ── Solve: algorithmic phase steps (`expr.explain('solve')`) ──
//
registerStepLabels({
  'solve.move-terms': 'Move all terms to one side',
  'solve.simplify': 'Simplify the equation',
  'solve.apply-inverse': 'Apply the inverse function to both sides',
  'solve.equate-exponents': 'The bases are equal, so equate the exponents',
  'solve.apply-tangent':
    'Take the tangent of both sides to clear the inverse trigonometric functions',
  'solve.clear-denominators': 'Multiply through to clear the denominators',
  'solve.square-both-sides': 'Square both sides to eliminate the radical',
  'solve.substitute': 'Substitute a new variable',
  'solve.substituted-equation':
    'Rewrite the equation in the substituted variable',
  'solve.back-substitute': 'Substitute back to the original variable',
  'solve.factor-zero-product':
    'A product is zero exactly when one of its factors is zero',
  'solve.harmonize': 'Rewrite the equation in an equivalent form',
  'solve.expand': 'Expand the equation',
  'solve.quadratic-formula': 'Apply the quadratic formula',
  'solve.rational-roots': 'Find the rational roots (rational-root theorem)',
  'solve.polynomial-roots': 'Find the remaining roots of the polynomial',
  'solve.candidates': 'Candidate solutions',
  'solve.validate-roots':
    'Check each candidate in the original equation; reject the extraneous ones',
  'solve.filter-domain': 'Discard solutions outside the domain of the variable',
  'solve.roots': 'The solutions',
  'solve.template': 'Solve the matched equation pattern',
  // System-of-equations phases
  'solve.system.eliminate': 'Eliminate a variable from the remaining equations',
  'solve.system.back-substitute':
    'Substitute the known value back to solve for the next variable',
  'solve.system.parametric':
    'Express the solutions in terms of a free parameter',
  'solve.system.solve-for': 'Solve one equation for one variable',
  'solve.system.substitute': 'Substitute into the remaining equations',
  'solve.system.product-sum':
    'Rewrite the sum and product conditions as a quadratic',
  'solve.case': 'Consider the next case',
  // System-of-inequalities phases
  'solve.system.normalize-inequality':
    'Rewrite the inequality with zero on the right-hand side',
  'solve.system.intersect-boundaries':
    'Find the intersection points of the boundary lines',
  'solve.system.vertices':
    'Keep the corner points that satisfy every inequality',
  'solve.system.check-constraints':
    'Substitute the candidate solution into each constraint',
  'solve.system.reject': 'Reject the candidate: it violates a constraint',
});

//
// ── Solve: root-template ids (`UNIVARIATE_ROOTS` in solve.ts) ──
//
registerStepLabels({
  'solve.linear-monomial':
    'A multiple of the unknown is zero when the unknown is zero',
  'solve.reciprocal': 'Solve the reciprocal equation',
  'solve.linear':
    'Isolate the unknown: subtract the constant, then divide by the coefficient',
  'solve.linear-negated':
    'Isolate the unknown: subtract the constant, then divide by the coefficient',
  'solve.power': 'Take the n-th root of both sides',
  'solve.power-negative-root':
    'Take the n-th root of both sides (negative root)',
  'solve.quadratic-no-constant-zero':
    'Factor out the unknown: one solution is 0',
  'solve.quadratic-no-constant':
    'Factor out the unknown and solve the remaining linear factor',
  'solve.quadratic-formula-positive':
    'Apply the quadratic formula (positive branch)',
  'solve.quadratic-formula-negative':
    'Apply the quadratic formula (negative branch)',
  'solve.exponential': 'Take the logarithm of both sides',
  'solve.exponential-natural': 'Take the natural logarithm of both sides',
  'solve.exponential-natural-unit-exponent':
    'Take the natural logarithm of both sides',
  'solve.exponential-natural-simple':
    'Take the natural logarithm of both sides',
  'solve.exponential-natural-unit-coefficient':
    'Take the natural logarithm of both sides',
  'solve.logarithm-base': 'Exponentiate both sides to clear the logarithm',
  'solve.logarithm-base-no-constant':
    'Exponentiate both sides to clear the logarithm',
  'solve.absolute-value-positive': 'Resolve the absolute value (positive case)',
  'solve.absolute-value-negative': 'Resolve the absolute value (negative case)',
  'solve.quadratic-in-sqrt-positive':
    'Solve as a quadratic in the square root of the unknown',
  'solve.quadratic-in-sqrt-negative':
    'Solve as a quadratic in the square root of the unknown',
  'solve.quadratic-in-sqrt-negated-positive':
    'Solve as a quadratic in the square root of the unknown',
  'solve.quadratic-in-sqrt-negated-negative':
    'Solve as a quadratic in the square root of the unknown',
  'solve.radical': 'Isolate the radical, then square both sides',
  'solve.logarithm-natural-scaled':
    'Exponentiate both sides to clear the logarithm',
  'solve.logarithm-natural': 'Exponentiate both sides to clear the logarithm',
  'solve.sine': 'Apply the inverse sine',
  'solve.sine-second-branch':
    'Apply the inverse sine (second branch: π − arcsin)',
  'solve.sine-unit': 'Apply the inverse sine',
  'solve.sine-unit-second-branch':
    'Apply the inverse sine (second branch: π − arcsin)',
  'solve.cosine': 'Apply the inverse cosine',
  'solve.cosine-negative-branch': 'Apply the inverse cosine (negative branch)',
  'solve.cosine-unit': 'Apply the inverse cosine',
  'solve.cosine-unit-negative-branch':
    'Apply the inverse cosine (negative branch)',
  'solve.tangent': 'Apply the inverse tangent',
  'solve.tangent-unit': 'Apply the inverse tangent',
  'solve.cotangent': 'Apply the inverse cotangent',
  'solve.cotangent-unit': 'Apply the inverse cotangent',
  'solve.sine-cosine-linear-combination':
    'Rewrite a·sin x + b·cos x as a single sinusoid',
});

//
// ── Integration: rule-driver phase steps (`expr.explain('Integrate')`) ──
//
registerStepLabels({
  'integrate.constant': 'The integral of a constant: ∫c dx = c·x',
  'integrate.variable': 'The integral of the variable: ∫x dx = x²/2',
  'integrate.sum': 'Integrate term by term: ∫(u+v) dx = ∫u dx + ∫v dx',
  'integrate.constant-factor': 'Move the constant factor out of the integral',
  'integrate.collected-power': 'Integrate the power of the linear expression',
  'integrate.hyperbolic-to-exp': 'Rewrite the hyperbolic functions as exponentials',
  'integrate.trig-to-exp': 'Rewrite the trigonometric functions as exponentials',
  'integrate.by-parts': 'Integrate by parts',
  'integrate.si-ci':
    'Express the integral with the sine and cosine integral functions Si and Ci',
  'integrate.trig-to-single-exp':
    'Substitute a single exponential for the trigonometric functions',
  'integrate.exponential-substitution':
    'Substitute for the exponential and integrate the rational function',
  'integrate.partial-fractions': 'Integrate using partial-fraction decomposition',
  'integrate.previous-result': 'Use the integral computed earlier',
  'integrate.simplify': 'Simplify the result',
});

//
// ── Derivatives: textbook rule steps (`expr.explain('D')`) ──
//
registerStepLabels({
  'derivative.sum-rule': 'Apply the sum rule: (u + v)′ = u′ + v′',
  'derivative.product-rule': 'Apply the product rule: (u·v)′ = u′·v + u·v′',
  'derivative.quotient-rule':
    'Apply the quotient rule: (u⁄v)′ = (u′·v − u·v′)⁄v²',
  'derivative.power-rule': 'Apply the power rule: (uⁿ)′ = n·uⁿ⁻¹·u′',
  'derivative.exponential-rule':
    'Differentiate the exponential: (aᵘ)′ = aᵘ·ln(a)·u′',
  'derivative.general-power-rule':
    'Differentiate by logarithmic differentiation: (f^g)′ = f^g·(g′·ln f + g·f′⁄f)',
  'derivative.chain-rule': 'Apply the chain rule: f(u)′ = f′(u)·u′',
  'derivative.known-derivative': 'Differentiate using a known derivative',
  'derivative.constant-multiple':
    'Apply the constant-multiple rule: (c·u)′ = c·u′',
  'derivative.rewrite': 'Rewrite in an equivalent differentiable form',
  'derivative.expand-definition': 'Expand the definition of the function',
  'derivative.zero': 'The expression is locally constant: its derivative is 0',
  'derivative.simplify': 'Simplify the result',
});

//
// Systematic families, registered per function with uniform curated copy.
//

// Odd/even symmetry: `F(-x) -> ±F(x)`
{
  const ODD = [
    'Sin',
    'Tan',
    'Cot',
    'Csc',
    'Sinh',
    'Tanh',
    'Coth',
    'Csch',
    'Arcsin',
    'Arctan',
    'Arccsc',
    'Arsinh',
    'Artanh',
    'Arcsch',
  ];
  const EVEN = ['Cos', 'Sec', 'Cosh', 'Sech'];
  const labels: Record<string, string> = {};
  for (const F of ODD) {
    const f = F.toLowerCase();
    labels[`${F}(-x) -> -${F}(x)`] =
      `Use the odd symmetry: ${f}(−x) = −${f}(x)`;
  }
  for (const F of EVEN) {
    const f = F.toLowerCase();
    labels[`${F}(-x) -> ${F}(x)`] = `Use the even symmetry: ${f}(−x) = ${f}(x)`;
  }
  registerStepLabels(labels);
}

// Absolute value and odd/even functions:
// `|F(x)| -> F(|x|) (odd function)` and `F(|x|) -> F(x) (even function)`
{
  const ODD = [
    'Sin',
    'Tan',
    'Cot',
    'Csc',
    'Sinh',
    'Tanh',
    'Coth',
    'Csch',
    'Arcsin',
    'Arctan',
    'Arccot',
    'Arccsc',
    'Arsinh',
    'Artanh',
    'Arcoth',
    'Arcsch',
  ];
  const EVEN = ['Cos', 'Sec', 'Cosh', 'Sech'];
  const labels: Record<string, string> = {};
  for (const F of ODD) {
    const f = F.toLowerCase();
    labels[`|${F}(x)| -> ${F}(|x|) (odd function)`] =
      `Move the absolute value onto the argument: |${f}(x)| = ${f}(|x|) because ${f} is odd`;
  }
  for (const F of EVEN) {
    const f = F.toLowerCase();
    labels[`${F}(|x|) -> ${F}(x) (even function)`] =
      `Drop the absolute value: ${f}(|x|) = ${f}(x) because ${f} is even`;
  }
  registerStepLabels(labels);
}

// Angle shift by π and cofunction (π/2) reflections
registerStepLabels({
  'Sin(π + x) -> -Sin(x)': 'Shift the angle by π: sin(π + x) = −sin(x)',
  'Cos(π + x) -> -Cos(x)': 'Shift the angle by π: cos(π + x) = −cos(x)',
  'Tan(π + x) -> Tan(x)': 'Use the period π of tangent: tan(π + x) = tan(x)',
  'Cot(π + x) -> Cot(x)': 'Use the period π of cotangent: cot(π + x) = cot(x)',
  'Sec(π + x) -> -Sec(x)': 'Shift the angle by π: sec(π + x) = −sec(x)',
  'Csc(π + x) -> -Csc(x)': 'Shift the angle by π: csc(π + x) = −csc(x)',
  'Sin(π/2 - x) -> Cos(x)':
    'Apply the cofunction identity: sin(π⁄2 − x) = cos(x)',
  'Cos(π/2 - x) -> Sin(x)':
    'Apply the cofunction identity: cos(π⁄2 − x) = sin(x)',
  'Tan(π/2 - x) -> Cot(x)':
    'Apply the cofunction identity: tan(π⁄2 − x) = cot(x)',
  'Cot(π/2 - x) -> Tan(x)':
    'Apply the cofunction identity: cot(π⁄2 − x) = tan(x)',
  'Sec(π/2 - x) -> Csc(x)':
    'Apply the cofunction identity: sec(π⁄2 − x) = csc(x)',
  'Csc(π/2 - x) -> Sec(x)':
    'Apply the cofunction identity: csc(π⁄2 − x) = sec(x)',
});

// Limits at infinity (and other undefined-value evaluations)
{
  const UNDEFINED_AT_INFINITY = [
    'Sin',
    'Cos',
    'Tan',
    'Cot',
    'Sec',
    'Csc',
    'Arcsin',
    'Arccos',
  ];
  const labels: Record<string, string> = {};
  for (const F of UNDEFINED_AT_INFINITY)
    labels[`${F}(infinity) -> NaN`] =
      `${F.toLowerCase()} has no limit at infinity`;
  // Inverse/hyperbolic evaluations at ±∞ (exact rule ids from
  // simplify-infinity.ts and the log/root rule sets)
  for (const id of [
    'arctan(+inf) -> π/2',
    'arctan(-inf) -> -π/2',
    'arccot(+inf) -> 0',
    'arccot(-inf) -> π',
    'arcsec(±inf) -> π/2',
    'arccsc(±inf) -> 0',
    'sinh(+inf) -> +inf',
    'sinh(-inf) -> -inf',
    'cosh(+inf) -> +inf',
    'cosh(-inf) -> +inf',
    'tanh(+inf) -> 1',
    'tanh(-inf) -> -1',
    'coth(+inf) -> 1',
    'coth(-inf) -> -1',
    'sech(+inf) -> 0',
    'sech(-inf) -> 0',
    'csch(+inf) -> 0',
    'csch(-inf) -> 0',
    'arsinh(+inf) -> +inf',
    'arsinh(-inf) -> -inf',
    'arcosh(+inf) -> +inf',
    'arcoth(±inf) -> 0',
    'arcsch(±inf) -> 0',
    'ln(+inf) -> +inf',
    'log_c(+inf) -> +inf when c > 1',
    'log_c(+inf) -> -inf when 0 < c < 1',
    'log_c(0) -> -inf when c > 1',
    'log_c(0) -> +inf when 0 < c < 1',
    'log_inf(x) -> 0',
    'root(+inf, n) -> +inf when n > 0',
  ])
    labels[id] = 'Evaluate the limit at infinity';
  for (const id of [
    'artanh(±inf) -> NaN',
    'arsech(±inf) -> NaN',
    'arcosh(-inf) -> NaN',
    'log_inf(inf) -> NaN',
  ])
    labels[id] = 'The value is undefined at infinity';
  for (const id of ['root(x, 0) -> NaN', 'root(0, n) -> NaN when n <= 0'])
    labels[id] = 'The root is undefined';
  registerStepLabels(labels);
}
