import { ComputeEngine, FunctionDefinition } from '../src/compute-engine';

const ce = new ComputeEngine();
const engine = ce;

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

console.info(ce.box(['Power', ['Power', 2, 3], 4]).value);
console.info(ce.box(['Power', 2, ['Power', 3, 4]]).value);

ce.box(['Add', 1, ['Hold', 2]])
  .evaluate()
  .print();

ce.assign('f_a', ['Function', ['Add', 'x', 1], 'x']);
ce.parse('f_\\text{a}(5)').evaluate().print();

console.info(ce.parse('\\mathrm{x_a}').json);
console.info(ce.parse('x_\\text{a}').json);

ce.parse('(-1)^{1/3}').evaluate().print();

const originalDef = ce.lookupFunction('Ln')!;
ce.defineFunction('Ln', {
  complexity: originalDef.complexity,
  threadable: originalDef.threadable,
  signature: originalDef.signature,
  sgn: originalDef.sgn,
  evaluate: ([x], options) => {
    if (x.is(0)) return ce.NaN;
    return originalDef.evaluate!([x], options);
  },
});

// const rules = ['\\ln 0 -> \\mathrm{NaN}'];
// console.info(ce.parse('\\frac{1}{\\ln(0)}').simplify({ rules }).N().re);

console.info(ce.parse('\\frac{1}{\\ln(0)}').N().re);

console.info(ce.parse('\\tan (90-0.000001)\\degree').json);

ce.parse('\\tan ((90-.000001)\\degree)').N().print();

const expr1 = ce.parse('\\ln |x|');
const deriv = ce.box(['D', expr1, 'x']);
deriv.evaluate().print();

// Should simplify to 2x.
ce.parse('x+x').simplify().print();

ce.assume(ce.parse('x > 0'));
console.log(ce.parse('\\sqrt{x^2}').simplify().toLatex());
console.log(ce.parse('\\sqrt[4]{x^4}').simplify().toLatex());

// 3^{-2} gets calculated because canonicalDivide calls toNumericValue, which
// does simplify the expression, i.e. "(3x)^2" -> "9x^2". That's a bit
// inconsistent with, e.g. "3 + 5" which does not get reduced...
// console.info(ce.parse('\\frac{x}{3^{-2}}').json);

// n is of type unknown... Shouldn't it be inferred to be 'real'?
// also, infer may need an argument to indicate if this is a covariant or contravariant inference
ce.box(['Floor', ['Cos', 'n']])
  .evaluate()
  .print();

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

// Should simplify....
expression = ce.parse('e^x e^{-x}').simplify();
expression.print();
console.log(expression.latex);
console.log(expression.json);

// Should output abs, and asciimath of log should use _ for subscript
expression = ce.parse('\\log_4(x^2)').simplify();
expression.print();
console.log(expression.latex);
console.log(expression.json);

// Should give NaN
expression = ce.parse('\\sin(\\infty)').simplify();
expression.print();
console.log(expression.latex);
console.log(expression.json);

// Expected answer is '7/4 \\log_4(x)' but does not match
expression = ce.parse('\\log_4(x^{7/4})').simplify();
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

console.log(ce.parse('(n - 1)!').evaluate().toString());

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

// Should be equal to 1
console.log(ce.parse('\\tanh(\\infty)').simplify().json);
console.log(ce.parse('\\tanh(\\infty)').simplify().is(1));
console.log(ce.parse('\\tanh(\\infty)').simplify().toString());

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

// Should be the gamma function, not the gamma constant
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

console.log(ce.parse('2x+1=0').isEqual(ce.parse('x=-\\frac12')));

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
//
//

ce.assign('A', ce.box(['Matrix', ['List', ['List', 1, 2], ['List', 3, 4]]]));
ce.assign(
  'X',
  ce.box(['Matrix', ['List', ['List', 'a', 'b'], ['List', 'c', 'd']]])
);
ce.assign('B', ce.box(['Matrix', ['List', ['List', 5, 6], ['List', 7, 8]]]));
ce.assign(
  'C',
  ce.box([
    'Matrix',
    [
      'List',
      ['List', ['List', -1, -2, -3], ['List', -4, -5, -6]],
      ['List', ['List', -7, -8, -9], ['List', -10, -11, -12]],
    ],
  ])
);
ce.assign('D', ce.box(['Matrix', ['List', ['List', 1, 2], ['List', 3, 4, 5]]]));

console.log(ce.box(['Shape', 'A']).evaluate().toString());
console.log(ce.box(['Rank', 'A']).evaluate().toString());

console.log(ce.box(['Flatten', 'A']).evaluate().toString());
console.log(ce.box(['Transpose', 'A']).evaluate().toString());

console.log(ce.box(['Determinant', 'X']).evaluate().toString());

console.log(ce.box(['Shape', 'C']).evaluate().toString());

// const expr = ce.parse('x^{}');
// console.info(expr.json);
// // expr.replace(ce.rules([['^{}', ['Sequence']]]));
// expr.replace(ce.rules([[['Power', '_1', ['Error', "'missing'"]], '_1']]), {
//   recursive: true,
// });
// console.info(expr.json);

// Should distribute: prefer addition over multiplication
const xp = ce.parse('a\\times(c+d)');
console.info(xp.json);
console.info(xp.latex);
console.info(xp.simplify().toString());

// console.info(ce.parse('\\frac{\\sqrt{15}}{\\sqrt{3}}').simplify().toString());

// For the remainder of theses tests, assume that the symbol `f` represent a
// function
ce.declare('f', 'function');
// ce.assume(['Equal', 'one', 1]);

const t1 = ce.parse('\\cos(5\\pi+k)');
// Canonical should simplify argument to -π/+π range
console.info(t1.toString());

console.info(t1.simplify().toString());

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

// `HorizontalScaling` should be interpreted as a function, not a symbol.
// auto-add all the entries from libraries to the dictionary? Alternatively
// check in default `parseUnknownSymbol` (and rename to
// `parseUnknownIdentifier`): check Domain is 'Functions'. (See \\operatorname, parse.ts:983)
// Also maybe unknown identifier in front of Delimiter -> function, .e.g
// `p(n) =  2n`. Can always disambiguate with a \cdot, e.g. `p\cdot(n)`
console.info(
  ce.parse('\\operatorname{HorizontalScaling}\\left(3\\right)+1').json
);

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
// -> ["Boole", ["GreaterThan", x, 4]]

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

// Knuth's interval notation:
console.info(ce.parse('(a..b)').json);
// -> ["Range", a, b]

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
