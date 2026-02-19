import {
  ComputeEngine,
  Expression,
  InfixEntry,
  simplify,
  compile,
  parse,
  evaluate,
  declare,
  assign,
} from '../src/compute-engine';
import { expand } from '../src/compute-engine/boxed-expression/expand';

const ce = new ComputeEngine();
const engine = ce;

console.log(parse('3\\times2+1').isEqual(parse('5+2')));

assign('v', 2);
console.log(parse('1 + 4 / v').is(3));

console.log(
  parse('\\sin^2(x) + \\cos^2(x)').isEqual(1),
  parse('(x+y)^2').isEqual(parse('x^2+2xy+y^2'))
);

let entier = true;
const domaine = [-10, 10];

const variable = 'x';
const input = '2x + x + 1';
const goodAnswer = '3x + 1';

const cleanInput = input;
const cleanAnswer = goodAnswer;

const inputFn = compile(cleanInput, { realOnly: true });
const goodAnswerFn = compile(cleanAnswer, { realOnly: true });
const [min, max] = domaine;
const range = max - min;
const valAlea = () => {
  const v = min + range * Math.random();
  return entier ? Math.round(v) : v;
};

if (!inputFn.run || !goodAnswerFn.run)
  throw Error(
    `functionCompare : La saisie ou la bonne réponse ne sont pas des fonctions (saisie : ${input} et réponse attendue : ${goodAnswer})`
  );

const varName = variable ?? 'x';
let isEqual = false;
for (let cpt = 0; cpt < 1000; cpt++) {
  const points = [valAlea(), valAlea(), valAlea()].map((v) => ({
    [varName]: v,
  }));
  // Skip test points where the expected answer produces NaN
  if (points.some((p) => Number.isNaN(goodAnswerFn.run(p)))) continue;
  if (
    !points.every((p) => Math.abs(inputFn.run(p) - goodAnswerFn.run(p)) < 1e-10)
  ) {
    isEqual = false;
    break;
  }
  isEqual = true;
}
console.log(`functionCompare : ${isEqual ? 'égales' : 'différentes'}`);

console.log(parse('3 \\times').json);

compile('sin(2x) + x').code;
// -> "Math.sin(2*x) + x"

compile('f(x) := sin(2x) + x').code;
// -> "f = ((x) => x + Math.sin(2 * x))"

compile('(x) \\mapsto sin(2x) + x').code;
// -> "(x) => x + Math.sin(2 * x)"

evaluate(['UnitConvert', ['Quantity', 132, 'km'], 'mi']).print();

// 1. sin(theta)**2 + cos(theta)**2 → 1 — Clean trig identity, but too simple.
// 2. (alpha**2 - beta**2) / (alpha - beta) → didn't simplify. Engine doesn't cancel the
// difference of squares factoring here.
// 3. sqrt(2) * sin(pi/4) + sqrt(3) * cos(pi/6) → 5/2 — Nice! Evaluates special angle values
// and simplifies radical products. A good runner-up.
// 4. (x**3 - 1) / (x - 1) + 2*x + 3 → didn't simplify. Engine doesn't do the polynomial long
// division.
// 5. cbrt(27) + sqrt(16) - 2**3 + sin(pi) → -1 — Exercises cbrt, sqrt, **, sin, pi.
// Surprising result (3 + 4 - 8 + 0 = -1). Fun but purely numeric, no variables.
// 6. (sin(alpha)**2 + cos(alpha)**2) * (x**2 + 2*x + 1) / (x + 1) → x + 1 — The winner.
// Combines trig identity simplification with polynomial cancellation.
// 7. (1 + 1/x)**2 - (1 - 1/x)**2 → 2 + 2/x² — Partially simplified but not fully (should be
// 4/x). Not ideal.
// 8. sqrt(2)*cos(pi/4) + cbrt(8)*sin(pi/6) + ln(exp(3)) → 5 — Also great: three independent
// terms each collapse (1 + 1 + 3). Exercises sqrt, cbrt, cos, sin, ln, exp, pi, *. Pure
// numeric though.

simplify(
  '(sin(alpha)**2 + cos(alpha)**2) * (x**2 + 2*x + 1) / (x + 1)'
).print();

console.log(ce.parse('x = \\textcolor{red}{y + 1} - z').json);

console.log(ce.parse(`\\sum_{n=0,m=4}^{4,8}{n+m}`).json);

// See parseTextRun
const styledText = ce.parse('x \\textcolor{red}{=} y');
console.log(styledText.json);

// const rho = ce.box(['List', ['List', 0.5, 0.5], ['List', 0.5, 0.5]]);
// const U = ce.parse(
//   '\\begin{pmatrix}e^{-\\frac{i\\pi}{32}} & 0\\\\0 & e^{-\\frac{i\\pi}{32}}\\end{pmatrix}'
// );
// console.log(ce.box(['Transpose', U]).evaluate().toString());

// console.log(
//   ce
//     .box(['Multiply', U, rho, ['Transpose', U]])
//     .evaluate()
//     .toString()
// );

// @issue Double integral N() times out
// Parses correctly but numerical evaluation hangs
const doubleInt = ce.parse(`\\int_0^1 \\int_0^1 (x+y) dx dy`);
console.log(doubleInt.json);
// doubleInt.N().print(); // Commented out - times out

engine
  .box(['N', engine.parse('\\int^2_0\\frac{3x}{5}dx')])
  .evaluate()
  .print();

// Should output 1\cdot 10^3
// @todo is that true for scientific *and* engineering notation
console.log(
  engine
    .parse('1000')
    .toLatex({ notation: 'scientific', avoidExponentsInRange: null })
);

ce.parse(
  `\\int_0^1 \\sech^2 (10(x − 0.2)) + \\sech^4 (100(x − 0.4)) + \\sech^6 (1000(x − 0.6)) dx`
)
  .N()
  .print();

// @issue: .replace() auto-wildcards single-char symbols (TODO #23)
ce.box(['Add', ['Multiply', 'a', 'x'], 'b']).replace(
  { match: 'a', replace: 2 },
  { recursive: true }
);
// Expected: 2*x + b
// Actual: 2
// Bug: 'a' in match is converted to wildcard '_a', matching any expression
// Workaround: Use .subs({a: 2}) for variable substitution

ce.precision = 30;
console.log(ce.parse('\\pi').N().toString());
console.log(ce.parse('\\pi').N().json);

console.log(ce.parse('\\pi').N().toMathJson({ fractionalDigits: 30 }));

console.log(ce.parse('3/4').type);

ce.parse('\\sin(x+1)').simplify().print();

console.info(ce.parse('21\\pm1').json);
console.info(ce.parse('21\\pm1').evaluate().json);

ce.parse('|\\operatorname{arccoth}(x)|').print();

ce.declare('e', 'list');
// Should be parsed as At...
console.log(ce.parse('\\sum_{p=0}^3x_{p}e_{p}').json);

// console.info(
//   ce.parse('(p + q)^2 = p^2 + q^2 + 2p * q = (p - q)^2 + 4p * q').json
// );

// console.info(
//   ce
//     .parse('(p + q)^2 = p^2 + q^2 + 2p * q = (p - q)^2 + 4p * q')
//     .compile()!
//     .toString()
// );

// Check this doesn't throw an error
ce.parse('f()').print();
ce.parse('f\\left(\\right)').print();
ce.parse('f(x)').print();
ce.parse('f\\left(x\\right)').print();

// @issue Matrix multiplication not supported by Multiply operator
// The \times operator maps to Multiply which expects numbers, not matrices
// Expected: [[15, 13], [29, 23]] (if matrix multiplication were supported)
ce.parse(
  String.raw`\begin{pmatrix}2 & 3\\ 4 & 5\end{pmatrix}\times\begin{pmatrix}6 & 2\\ 1 & 3\end{pmatrix}`
)
  .evaluate()
  .print();

// let sub2 = ce
//   .parse('\\sqrt{x}')
//   .match(
//     ce.parse(
//       '\\mathrm{_a}x + \\mathrm{_c}\\sqrt{\\mathrm{_d}\\mathrm{_x}+\\mathrm{_e}} + \\mathrm{_g}'
//     ),
//     {
//       // .match(ce.parse('\\sqrt{\\operatorname{\\_x}}'), {
//       substitution: { _x: ce.box('x') },
//       useVariations: true,
//     }
//   );

// @issue Pattern matching with variations not working
// Expected: Match 0 against _a*x with a=0 variation
// Actual: No match found
let sub2 = ce.parse('0').match(ce.parse('\\mathrm{_a}x'), {
  substitution: { _x: ce.box('x') },
  useVariations: true,
});

if (sub2) {
  console.log(
    Object.entries(sub2)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ')
  );
} else {
  console.log('No match found (expected: should find a=0 variation)');
}

// @issue Complex pattern matching incomplete
// Expected: Substitution with _a, __b, _c, __d, __g values
// Actual: null
const eq = ce.parse('2x-\\sqrt{5}\\sqrt{x}');

const match = ce.box([
  'Add',
  ['Multiply', '_a', '_x'],
  ['Multiply', '__b', ['Sqrt', ['Add', ['Multiply', '_c', '_x'], '__d']]],
  '__g',
]);
let sub = eq.match(match, {
  substitution: { _x: ce.box('x') },
  useVariations: true,
});
console.log(sub); // Expected: substitution object, Actual: null

ce.parse('2x=\\sqrt{5x}')
  .solve()
  ?.map((x) => x.print());

ce.parse('\\operatorname{a?#_!}').print();
ce.parse('x__+1)').print();
ce.parse('\\mathrm{speed}_{max}').print();

const data = [
  { a: 5, b: 10 },
  { a: 65, b: 2 },
];
ce.assign('a', ['List', ...data.map((d) => d.a)]);
ce.assign('b', ['List', ...data.map((d) => d.b)]);
const formula = ce.parse('\\mathrm{Sum}(a \\cdot b)');

// const formula = ce.parse('\\sum_{i=1}^n a_{i} \\cdot b_{i}');
// ce.assign('n', data.length);
// console.log(ce.parse('n').toString());
console.log(formula.evaluate().toString());

ce.parse('\\mathrm{x+\\alpha}').print();
ce.parse('\\mathrm{\\oplus}').print();
ce.parse('\\mathrm{\\frac{a}{\\oplus\\prime}').print();

ce.parse('\\sin(\\pi^2)').evaluate().print();

// console.info(
//   JSON.stringify(ce.parse('12+(-2)').toMathJson({ prettify: false }))
// );
// console.info(JSON.stringify(ce.parse('12-2').toMathJson({ prettify: false })));

console.log(ce.parse('x').value);
console.log(ce.parse('x').re);

const localInput = '12+(-2)';
const expr = engine.parse(localInput, { form: 'raw' });
if (expr.operator === 'Add' && expr.op1.valueOf() === 0) {
}

console.info(JSON.stringify(ce.parse('12+(-2)', { form: 'raw' }).json));
console.info(JSON.stringify(ce.parse('12-2', { form: 'raw' }).json));

ce.box(['Add', 1, { str: 'hello' }]).print();

console.info(
  ce
    .parse('x^2 - 1 = 0')
    .solve('x')
    ?.map((x) => x.toString())
);

ce.parse('\\mathrm{PopulationVariance}([7, 2, 11])').evaluate().print();

ce.parse('\\mathrm{Variance}([7, 2, 11])').evaluate().print();

console.info(ce.parse('{2^3}^4').latex);
console.info(ce.parse('2^{3^4}').json);

ce.box(['Add', 1, ['Hold', 2]])
  .evaluate()
  .print();

console.info(ce.parse('\\mathrm{x_a}').json);
console.info(ce.parse('x_\\text{a}').json);

ce.parse('(-1)^{1/3}').evaluate().print();

// const rules = ['\\ln 0 -> \\mathrm{NaN}'];
// console.info(ce.parse('\\frac{1}{\\ln(0)}').simplify({ rules }).N().re);

console.info(ce.parse('\\frac{1}{\\ln(0)}').N().re);

console.info(ce.parse('\\tan (90-0.000001)\\degree').json);

ce.parse('\\tan ((90-.000001)\\degree)').N().print();

const exprln = ce.parse('\\ln |x|');
const deriv = ce.box(['D', exprln, 'x']);
deriv.evaluate().print();

// 3^{-2} gets calculated because canonicalDivide calls toNumericValue, which
// does simplify the expression, i.e. "(3x)^2" -> "9x^2". That's a bit
// inconsistent with, e.g. "3 + 5" which does not get reduced...
// console.info(ce.parse('\\frac{x}{3^{-2}}').json);

ce.costFunction = () => 0;
console.info(
  ce
    .parse('-\\sin(2x) + 2\\sin(x) * \\cos(x)')
    .simplify({ rules: ['\\sin(2x) -> 2\\sin(x)\\cos(x)'] })
    .toString() + ' this ran'
);

ce.parse('||a| + 3|').simplify().print();

const cx = ce.box(ce.box(['If', ['Greater', 'x', 0], 'x', ['Negate', 'x']]));
console.log(cx.json);
console.log(cx.toString());

// Should simplify...
// ce.parse('1+2').simplify().print();
ce.parse('-1234 - 5678').simplify().print();
ce.parse('2\\sqrt{3}+\\sqrt{1+2}').simplify().print();

// Serialize correctly?
ce.parse('\\cos(30\\degree)').simplify().print();

// Should not be Subtract.
console.info(ce.parse('\\frac{2}{-3222233}+\\frac{1}{3}').json);

ce.box([
  'Sum',
  ['Multiply', 'i', 'j'],
  ['Tuple', ['Hold', 'i'], 1, 10],
  ['Tuple', 'j', 3, 13],
])
  .evaluate()
  .print();

let expression = ce.parse('|-\\pi|').simplify();
expression.print();
console.log(expression.latex);
console.log(expression.json);

// arcsinh does not exist, but give unexpected token error
expression = ce.parse('|\\arcsinh(x)|').simplify();
expression.print();
console.log(expression.latex);
console.log(expression.json);

// See terms.ts:134. Explore options for shortcircuting when values are 1 or -1,
// or canonicalMultiply2() for the same.
console.log(ce.parse('-x-1').N().toString());

console.log(
  ce.parse(
    '2\\times 5\\times\\frac{5}{7}\\times\\frac{7}{9}\\times\\sqrt{2}\\times\\pi'
  ).json
);

console.log(ce.box(['Add', ['Add', 'x', 3], 5]).toMathJson());

console.log(ce.parse('\\frac34 \\sqrt{3} + i').evaluate().toString());

console.log(
  ce.box(['Divide', ['Subtract', ['Sqrt', 6], ['Sqrt', 2]], 4]).toString()
);

console.log(
  ce
    .box(['Cos', ['Multiply', ['Rational', 7, 12], 'Pi']])
    .evaluate()
    .toString()
);

console.log(ce.box(['Rational', 7, 12]).N().toString());
console.log(
  ce
    .box(['Multiply', ['Rational', 7, 12], 'Pi'])
    .N()
    .toString()
);

console.log(ce.box(['Sqrt', 2]).numericValue?.toString());

console.log(ce.box(['Sqrt', ['Rational', 3, 4]]).numericValue?.toString());

console.log(ce.box(['Multiply', 2, ['Sqrt', 3]]).numericValue?.toString());

console.log(
  ce.box(['Multiply', 2, ['Sqrt', ['Rational', 3, 5]]]).numericValue?.toString()
);

console.log(
  ce
    .box(['Multiply', ['Rational', 3, 4], ['Sqrt', ['Rational', 3, 4]]])
    .numericValue?.toString()
);

console.log(
  ce
    .box(['Multiply', 5, ['Rational', 3, 4], ['Sqrt', ['Rational', 3, 4]]])
    .numericValue?.toString()
);

console.log(
  ce
    .box(['Multiply', 'x', 5, ['Rational', 3, 4], ['Sqrt', ['Rational', 3, 4]]])
    .toString()
);

console.log(ce.parse('\\sqrt{-1}').toString());

// Should be -sqrt(3)(2)
console.log(ce.parse('\\sqrt[3]{-2}').simplify().toString());
console.log(ce.parse('\\sqrt[3]{-2}').simplify().latex);

// console.log(ce.parse('2(13.1+x)<(10-5)').isEqual(ce.parse('26.2+2x<5')));

// y powers should combine
console.log(
  ce.parse('-2x5z\\sqrt{y}\\frac{3}{4}3\\pi y').simplify().toString()
);

// Produces * 0.25. Maybe / 4?
console.log(
  ce
    .box(['Square', ['Divide', 'x', 2]])
    .evaluate()
    .toString()
);

ce.parse('\\frac{\\pi}{4}').evaluate().print();

// Should be [Complex, 0, 1], not NaN.
ce.precision = 'machine';
ce.box(['Negate', 'i']).evaluate().print();

// Quick perf testing

// console.time('simplify');
// ce.parse('(2x^2+3x+1)(2x+1)').simplify().print();
// console.timeLog('simplify');

console.time('evaluate');
ce.parse('(2x^2+3x+1)(2x+1)').evaluate().print();
// ce.parse('x+1').evaluate().print();
console.timeLog('evaluate');

// ce.parse('(0+1.1-1.1)(0+1/4-1/4)').simplify().print();
ce.parse('(0+1.1-1.1)(0+1/4-1/4)').evaluate().print();
ce.parse('(0+1.1-1.1)(0+1/4-1/4)').N().print();

console.time('N');
ce.parse('(2x^2+3x+1)(2x+1)').N().print();
console.timeLog('N');

// @issue \gamma(2, 1) parses as EulerGamma * (2, 1) instead of incomplete gamma
// Expected: Gamma(2, 1) - the incomplete gamma function
// Actual: "EulerGamma" * (2, 1)
ce.parse('\\gamma(2, 1)').print();

// Should error nicely. Probably return as many indexes as possible
ce.box(['At', ['List', 7, 13, 5, 19, 2, 3, 11], 1, 2])
  .evaluate()
  .print();

ce.parse('8x^2 - 488 x + 7243').simplify().print();

// Should not be a At, but a Subscript
ce.parse(`\\sum_{n,m} k_{n,m}`).print();

// ce.box([
//   'Multiply',
//   'Pi',
//   ['Add', ['Rational', -5, 2], ['Rational', 0, 1]],
// ]).print();

// console.profile();
// ceBaselineN(randNumbers(1000));
// console.profileEnd();

// ce.box([
//   'Multiply',
//   'Pi',
//   ['Add', ['Rational', -4, 2], ['Rational', 1, 12]],
// ]).print();

// ce.box(['Multiply', 'Pi', ['Add', ['Rational', -4, 2], ['Rational', 1, 12]]])
//   .simplify()
//   .print();

// ce.box(['Rational', -4, 2]).simplify().print();
// ce.box(['Rational', 1, 12]).simplify().print();

// 4x(3x+2)-5(5x-4)

// Should not be modified (Expand should be hold "hold")
ce.box(['Expand', ce.parse('4x(3x+2)-5(5x-4)')])
  .simplify()
  .print();

// Should be expanded, and use -25, not Negate(25x)
ce.box(['Expand', ce.parse('4x(3x+2)-5(5x-4)')])
  .evaluate()
  .print();

// Should not have a divide by 1,
ce.parse('\\frac{-x}{\\frac{1}{n}}').print();

ce.box(['Add', -2, ['Rational', 1, 12]])
  .simplify()
  .print();

ce.parse('\\sin(\\frac{-23\\pi}{12})').evaluate().print();

// Should parse correctly, without a Single for the parens
ce.parse('\\int^\\infty_0(3x+x^2dx) = 2').print();

// Type error: bigint conversion
ce.box(['Sqrt', { num: '12345670000000000000000000' }])
  .evaluate()
  .print();

// Should have an error, not an At
ce.parse('x__+1').print();

// Expect 1/3
ce.parse('\\int_{0}^{1} x^2 dx').evaluate().print();

console.log(ce.parse('2\\times3xxx').simplify().toString());

// Should have a single solution, 0
const eqn = ce.box(['Multiply', 5, 'x']);
const r1 = eqn.solve('x');
console.info(r1?.map((x) => x.toString()).join(', '));

const e = ce.parse('x = \\sqrt{5}');
const r2 = e.solve('x')?.map((x) => x.toString());
console.log(r2);

// Should be √5
console.log(ce.parse('1+4\\times\\sin\\frac{\\pi}{10}').simplify().toString());

// console.log(ce.parse('3x + 1 = 0').isEqual(ce.parse('6x + 2 = 0')));

//
//
//

// Simple performance benchmark

ce.box(['Multiply', 3, ['Add', ['Negate', 1], ['Rational', 1, 2]]])
  .evaluate()
  .print();

//
// MATRIX OPERATIONS
//

// All matrix operations work correctly (numeric and symbolic)
// See PLAYGROUND.md for verified working operations

// const expr = ce.parse('x^{}');
// console.info(expr.json);
// // expr.replace(ce.rules([['^{}', ['Sequence']]]));
// expr.replace(ce.rules([[['Power', '_1', ['Error', "'missing'"]], '_1']]), {
//   recursive: true,
// });
// console.info(expr.json);

// Note: Distribution is NOT automatic during simplify()
// Use expand() to distribute: a*(c+d) -> ac + ad
const xp = ce.parse('a\\times(c+d)');
console.info(xp.json);
console.info(xp.latex);
console.info(xp.simplify().toString()); // Returns a*(c+d)
console.info((expand(xp) ?? xp).toString()); // Returns ac + ad

// console.info(ce.parse('\\frac{\\sqrt{15}}{\\sqrt{3}}').simplify().toString());

// For the remainder of theses tests, assume that the symbol `f` represent a
// function
ce.declare('f', 'function');
// ce.assume(['Equal', 'one', 1]);

// Filter works correctly
const l1 = ce.function('List', [1, 2, 3, 4, 5]);
const l2 = ce.box(['Filter', l1, ['IsOdd', '_']]);
console.info(l2.evaluate().toString()); // Works: [1, 3, 5]

// @issue Filter not evaluated inside List
// Expected: [[1, 3, 5]]
// Actual: Filter not evaluated when wrapped in List
console.info(ce.function('List', [l2]).toString());
console.info(ce.function('List', [l2]).evaluate().toString());

console.info(ce.parse('f\\left(\\right)').toString());

// Produces error -- mathlive #1707
// also should parse sub, i.e. f_{n-1} -> use sub as first params? (or last, as in log_2(x) -> log(x, 2))
console.info(ce.parse("f'").json);

const n1 = ce.parse('x_{1,2}');
console.info(n1.toString());

const expr200 = ce.parse('x^2').json;
console.info(ce.box(['Integrate', expr200, ['Tuple', 'x', 0, 1]]).latex);

// console.info(engine.pattern(['Add', 1, '_']).match(engine.box(['Add', 1, 2])));

// console.info(
//   ce.box(['Set', 'Number', ['Condition', ['NotEqual', '_', 0]]]).latex
// );

// Look for other @fixme in tests

//
// PROBLEMATIC EXPRESSIONS
//

// Serialization issue (the 1/2 rational should get distributed to numerator/denominator)
console.info(ce.parse('\\frac{1}{2\\sqrt{3}}').canonical.latex);

// Needs a \times between 2 and 3
console.info(ce.parse('\\sqrt{\\sqrt{\\sqrt{2\\sqrt{3}}}}').latex);

// simplify() should decompose the square roots of rational
let z7 = ce.parse('\\frac{\\sqrt{15}}{\\sqrt{3}}');
console.info(z7.toJSON());
z7 = z7.canonical;
console.info(z7.toJSON());
z7 = z7.simplify();
console.info(z7.json);
// Expect: `['Sqrt',  5]`
console.info(ce.parse('\\sqrt{15}').simplify().latex);
// Expect_. `\sqrt15` (don't keep decomposed root expanded)

// Outputs unexpected command, \\left...
// because there is no matchfix for \\left(\\right.
console.info(ce.parse('\\sin\\left(x\\right.').toJSON());
// Another example: should probably downconvert the \left( to a (
// and ignore the \right.
console.info(ce.parse('\\frac{\\left(w\\right.-x)\\times10^6}{v}').json);

// Check error
console.info(ce.parse('(').toJSON());

// Gives unexpected-token. Should be expected closing boundary?
console.info(ce.parse('(3+x').toJSON());

// Give unexpected token. SHould be unexpected closing boundary?
console.info(ce.parse(')').toJSON());

// ; is parsed as List List?
console.info(ce.parse('(a, b; c, d, ;; n ,, m)').toJSON());

// The invalid `$` is not detected. Should return an error 'unexpected-mode-shift', or invalid identifier
const w = ce.parse('\\operatorname{$invalid}').json;
console.info(w);

// Should interpret function application `(x)`
// console.info(ce.parse('f_{n - 1}(x)').toJSON());
// console.info(ce.parse('x \\times f_{n - 1}(x) + f_{n - 2}(x)').toJSON());

// If a symbol surrounded by two numeric literals
// (Range if integers and symbol is an integer, Interval otherwise)
console.info(ce.parse('5\\le b\\le 7}').canonical.json);
// -> ["Range", 5, 7]
console.info(ce.parse('5\\le b\\lt 7}').canonical.json);
// -> ["Range", 5, 6]

// Inequality with more than 2 terms (hold all)
console.info(ce.parse('a\\lt b\\le c}').canonical.json);
// -> ["Inequality", a, "LessThan", b, "Less", c]

// Several problems:
// - \mathbb{R} is not recognized
// - \in has higher precedence than =
// - ['Equal'] with more than two arguments fails
console.info(
  ce.parse(
    '{\\sqrt{\\sum_{n=1}^\\infty {\\frac{10}{n^4}}}} = {\\int_0^\\infty \\frac{2xdx}{e^x-1}} = \\frac{\\pi^2}{3} \\in {\\mathbb R}'
  ).json
);

// Parses, but doesn't canonicalize
//  p(n)=(\sum_{v_{1}=2}^{\operatorname{floor}\left(1.5*n*\ln(n)\right)}(\operatorname{floor}(\frac{1}{0^{n-(\sum_{v_{2}=2}^{v_{1}}((\prod_{v_{3}=2}^{\operatorname{floor}(\sqrt{v_{2}})}(1-0^{\operatorname{abs}(\operatorname{floor}(\frac{v_{2}}{v_{3}})-\frac{v_{2}}{v_{3}})}))))}+1})))+2
// https://github.com/uellenberg/Logimat/tree/master/examples/nth-prime

console.info(
  ce.parse(
    'p(n)=(\\sum_{v_{1}=2}^{\\operatorname{floor}\\left(1.5*n*\\ln(n)\\right)}(\\operatorname{floor}(\\frac{1}{0^{n-(\\sum_{v_{2}=2}^{v_{1}}((\\prod_{v_{3}=2}^{\\operatorname{floor}(\\sqrt{v_{2}})}(1-0^{\\operatorname{abs}(\\operatorname{floor}(\\frac{v_{2}}{v_{3}})-\\frac{v_{2}}{v_{3}})}))))}+1})))+2'
  ).json
);

// Simplify to Iverson Bracket (or maybe canonicalize)
console.info(ce.parse('0^{|a-b|}').json);
// -> ["Boole", ["Equal", a, b]]

// Simplify (canonicalize) sign function
console.info(ce.parse('\\frac{2}{0^x+1}-1').json);

// Simplify to LessThan, etc...
console.info(ce.parse('0^{|\\frac{2}{0^x+1}|}').json);
// -> ["Boole", ["LessThan", x, 0]]

console.info(ce.parse('0^{|\\frac{2}{0^{4-x}+1}|}').json);
// -> ["Boole", ["Greater", x, 4]]

console.info(ce.parse('0^{|\\frac{2}{0^{x-4}+1}|}').json);
// -> ["Boole", ["LessThan", x, 4]]

console.info(ce.parse('\\mathbb{1}_{\\N}\\left(x\\right)').json);
// -> ["Boole", ["Element", x, ["Domain", "NonNegativeInteger"]]

// Iverson Bracket/Boole simplification/equivalent rules (not sure if worth
// transforming from one to the other)
// [¬P]=1−[P]
// [P∧Q]=[P][Q]
// [P∨Q]=[P]+[Q]−[P][Q]
//[P⊕Q]=([P]−[Q])
// [P→Q]=1−[P]+[P][Q]
// [P≡Q]=1−([P]−[Q])

// Knuth's coprime notation
console.info(ce.parse('m\\bot n').json);
// -> ["Equal", ["Gcd", m, n], 1]
// -> ["Coprime", m, n]

// Euler's Phi function (number of integers that are coprime)
console.info(
  ce.parse('\\phi(n)=\\sum_{i=1}^n\\left\\lbrack i\\bot n\\right\\rbrack ').json
);

// Additional \sum syntax
console.info(ce.parse('\\sum_{1 \\le i \\le 10} i^2').json);
//-> ["Sum", ["Square", "i"], ["i", 1, 10]]

console.info(ce.parse('\\sum_{i \\in S} i^2').json);

console.info(ce.parse('\\sum_{i,j} j+i^2').json);
// -> ["Sum", ..., ["i"], ["j"]]

console.info(
  ce.parse('\\sum_{\\stackrel{{\\scriptstyle 1\\le k\\le n}}{(k,n)=1}}\\!\\!k')
    .json
);

// Simplify summations:  see https://en.wikipedia.org/wiki/Summation General Identities

// Congruence (mod) notation (a-b is divisible by n, )
// console.info(ce.parse('a\\equiv b(\\mod n)').canonical.json);
// -> ["Equal", ["Mod", a, n], ["Mod", b, n]]
// console.info(ce.parse('a\\equiv_{n} b').canonical.json);
// -> ["Equal", ["Mod", a, n], ["Mod", b, n]]
// See https://reference.wolfram.com/language/ref/Mod.html
// a \equiv b (mod 0) => a = b

// Function application (when, e.g. f is a  lambda)
console.info(ce.parse('f|_{3}').canonical.json);
// Application to a range (return a list)
console.info(ce.parse('f|_{3..5}').canonical.json);

function ceBaselineN(numRandos: number[]): number {
  const ce = new ComputeEngine();

  let randos = numRandos.map((n) => ce.number(n));

  let start = globalThis.performance.now();

  randos = randos.map((n, i) => {
    // Do some arithmetic calculations
    if (i % 2 === 0)
      return ce
        .box([
          'Add',
          [
            'Multiply',
            ['Rational', 4, 3],
            ['Square', n],
            ['Multiply', ['Rational', 3, 2], n],
            2,
          ],
        ])
        .N();

    // Trigonometry, log, exp
    return ce.box(['Add', ['Tan', n], ['Log', ['Abs', n], ['Exp', n]]]).N();
  });

  return globalThis.performance.now() - start;
}

function randNumbers(n: number): number[] {
  let randos: number[] = [];
  for (let i = 0; i < n; i++) {
    const n = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    randos.push(n);
  }
  return randos;
}
