/* eslint-disable no-restricted-globals */
/**
 * This file contains a series of lightweight tests. More exhaustive tests
 * are included in the `./test/compute-engine` and
 * `./test/latex-syntax` directories.
 *
 * They are divided in:
 * - boxing (MathJSON to boxed expressions)
 * - parsing (LaTeX to boxed expressions)
 * - serializing (boxed expressions to Latex)
 * - canonicalization
 * - simplification
 * - symbolic evaluation
 * - numerical evaluation
 */

import { ComputeEngine } from '../../src/compute-engine';
import { Expression } from '../../src/math-json/math-json-format';
import {
  boxToJson,
  canonicalToJson,
  engine,
  evaluateToJson,
  expand,
  NToJson,
  parse,
  parseToJson,
  simplifyToJson,
} from '../utils';

const ce = engine;
// ce.numericMode = 'bignum';
// engine.jsonSerializationOptions.precision = 16;

// For the remainder of theses tests, assume that the symbol `f` represent a
// function
ce.assume(['Element', 'f', 'Function']);
ce.assume('one', 1);

console.log(ce.parse('\\sin(30\\deg)').evaluate().toJSON());

function slowEval() {
  ///
  const ce = new ComputeEngine();

  const expr = ce.parse('ax^2+bx+c'); // like $$ ax^2+bx+c $$
  const vars = { a: 2, b: 3, c: 4 };

  // Factor out substitution of constants

  ce.numericMode = 'machine';
  ce.strict = false;

  let y = 0;
  const startTime = performance.now();
  for (let x = 0; x <= Math.PI; x += 0.01) {
    y += expr.subs(vars).subs({ x: x }).N().numericValue! as number;
  }

  console.log(
    `Slow eval: y = ${y} in ${performance.now() - startTime} milliseconds`
  );
}

function fastEval() {
  ///
  const ce = new ComputeEngine();

  const expr = ce.parse('ax^2+bx+c'); // like $$ ax^2+bx+c $$
  const vars = { a: 2, b: 3, c: 4 };

  // Factor out substitution of constants
  const expr3 = expr.subs(vars).N();

  ce.numericMode = 'machine';
  ce.strict = false;

  let y = 0;
  const startTime = performance.now();
  for (let x = 0; x <= Math.PI; x += 0.01) {
    ce.set({ x: x });
    y += expr3.N().numericValue! as number;
  }

  console.log(
    `Fast eval: y = ${y} in ${performance.now() - startTime} milliseconds`
  );
}
// ---
persist();

slowEval();
fastEval();

ce.set({ vv: 0 });
// Should return a symbol, not 0
const v = ce.symbol('vv');

console.log(ce.parse('f\\left(\\right)').toString());

// Produces error -- mathlive #1707
// also should parse sub, i.e. f_{n-1} -> use sub as first params? (or last, as in log_2(x) -> log(x, 2))
console.log(ce.parse("f'").json);

const n1 = ce.parse('x_{1,2}');
console.log(n1.toString());

const expr200 = ce.parse('x^2').json;
console.log(
  ce.box(['Integrate', expr200, ['Element', 'x', ['Interval', 0, 1]]]).latex
);

// console.log(engine.pattern(['Add', 1, '_']).match(engine.box(['Add', 1, 2])));

// console.log(
//   ce.box(['Set', 'Number', ['Condition', ['NotEqual', '_', 0]]]).latex
// );

// Look for other @fixme in tests

//
// PROBLEMATIC EXPRESSIONS
//

// Serialization issue (the 1/2 rational should get distributed to numerator/denominator)
console.log(ce.parse('\\frac{1}{2\\sqrt{3}}').canonical.latex);

// Needs a \times between 2 and 3
console.log(ce.parse('\\sqrt{\\sqrt{\\sqrt{2\\sqrt{3}}}}').latex);

// `HorizontalScaling` should be interpreted as a function, not a symbol.
// auto-add all the entries from libraries to the dictionary? Alternatively
// check in default `parseUnknownSymbol` (and rename to
// `parseUnknownIdentifier`): check Domain is 'Function'. (See \\operatorname, parse.ts:983)
// Also maybe unknown identifier in front of Delimiter -> function, .e.g
// `p(n) =  2n`. Can always disambiguate with a \cdot, e.g. `p\cdot(n)`
console.log(ce.parse('\\mathrm{HorizontalScaling}\\left(3\\right)+1').json);

// simplify() should decompose the square roots of rational
let z7 = ce.parse('\\frac{\\sqrt{15}}{\\sqrt{3}}');
console.log(z7.toJSON());
z7 = z7.canonical;
console.log(z7.toJSON());
z7 = z7.simplify();
console.log(z7.json);
// Expect: `['Sqrt',  5]`
console.log(ce.parse('\\sqrt{15}').simplify().latex);
// Expect_. `\sqrt15` (don't keep decomposed root expanded)

// Report false. Should be true.
const sig1 = ce.domain(['Function', 'PositiveInteger', 'Number']);
const sig2 = ce.domain(['Function', 'Number', 'Number']);
console.log(sig1.isCompatible(sig2));

// Outputs unexpected command, \\left...
// because there is no matchfix for \\left(\\right.
console.log(ce.parse('\\sin\\left(x\\right.').toJSON());
// Another example: should probably downconvert the \left( to a (
// and ignore the \right.
console.log(ce.parse('\\frac{\\left(w\\right.-x)\\times10^6}{v}').json);

// Check error
console.log(ce.parse('(').toJSON());

// Gives unexpected-token. Should be expected closing boundary?
console.log(ce.parse('(3+x').toJSON());

// Give unexpected token. SHould be unexpected closing boundary?
console.log(ce.parse(')').toJSON());

// ; is parsed as List List?
console.log(ce.parse('(a, b; c, d, ;; n ,, m)').toJSON());

// The invalid `$` is not detected. Should return an error 'unexpected-mode-shift', or invalid identifier
const w = ce.parse('\\mathrm{$invalid}').json;
console.log(w);

// Should interpret function application `(x)`
console.log(ce.parse('f_{n - 1}(x)').toJSON());
console.log(ce.parse('x \\times f_{n - 1}(x) + f_{n - 2}(x)').toJSON());

// If a symbol surrounded by two numeric literals
// (Range if integers and symbol is an integer, Interval otherwise)
console.log(ce.parse('5\\le b\\le 7}').canonical.json);
// -> ["Range", 5, 7]
console.log(ce.parse('5\\le b\\lt 7}').canonical.json);
// -> ["Range", 5, 6]

// Inequality with more than 2 terms (hold all)
console.log(ce.parse('a\\lt b\\le c}').canonical.json);
// -> ["Inequality", a, "LessThan", b, "Less", c]

// Several problems:
// - \mathbb{R} is not recognized
// - \in has higher precedence than =
// - ['Equal'] with more than two arguments fails
console.log(
  ce.parse(
    '{\\sqrt{\\sum_{n=1}^\\infty {\\frac{10}{n^4}}}} = {\\int_0^\\infty \\frac{2xdx}{e^x-1}} = \\frac{\\pi^2}{3} \\in {\\mathbb R}'
  ).json
);

// Parses, but doesn't canonicalize
//  p(n)=(\sum_{v_{1}=2}^{\operatorname{floor}\left(1.5*n*\ln(n)\right)}(\operatorname{floor}(\frac{1}{0^{n-(\sum_{v_{2}=2}^{v_{1}}((\prod_{v_{3}=2}^{\operatorname{floor}(\sqrt{v_{2}})}(1-0^{\operatorname{abs}(\operatorname{floor}(\frac{v_{2}}{v_{3}})-\frac{v_{2}}{v_{3}})}))))}+1})))+2
// https://github.com/uellenberg/Logimat/tree/master/examples/nth-prime

console.log(
  ce.parse(
    'p(n)=(\\sum_{v_{1}=2}^{\\operatorname{floor}\\left(1.5*n*\\ln(n)\\right)}(\\operatorname{floor}(\\frac{1}{0^{n-(\\sum_{v_{2}=2}^{v_{1}}((\\prod_{v_{3}=2}^{\\operatorname{floor}(\\sqrt{v_{2}})}(1-0^{\\operatorname{abs}(\\operatorname{floor}(\\frac{v_{2}}{v_{3}})-\\frac{v_{2}}{v_{3}})}))))}+1})))+2'
  ).json
);

// Add Kronecker's Delta
console.log(ce.parse('\\delta_{n, m}').json);
// -> ["KroneckerDelta", n, m]
console.log(ce.box(['KroneckerDelta', 5, ['Add', 4, 1], 5]).evaluate().json);
// -> 1, when all ops are equal
console.log(ce.box(['KroneckerDelta', 5, ['Add', 4, 1], 6]).evaluate().json);
// -> 0 when any ops is different

// Add Iverson Brackets/Indicator Function (0 when boolean expression is false,
// 1 otherwise)
// Also, prioritize evaluation of `Boole` terms in `Multiply` (if 0, can exit
// early)
console.log(ce.box(['Boole', ['Equal', 3, 5]]).evaluate().json);
// -> 0
console.log(ce.box(['Boole', ['Equal', 3, ['Add', 1, 2]]]).evaluate().json);
// -> 1

// Parse Delimiter with square brackets and a single boolean expression as
// an argument as an Iverson Bracket.
console.log(ce.parse('\\left[a=b\\right]').canonical.json);
// Also \llbracket (U+27E6)...\rrbracket (U+27E7)
console.log(ce.parse('\\llbracket[a=b\\rrbracket]').canonical.json);
// -> ['Boole', ['Equal', a, b]]
//  For Tuple with a single boolean, use Tuple (or Single)
console.log(ce.parse('\\mathrm{Single}(a, b)').json);
console.log(ce.parse('\\mathrm{Tuple}(a, b)').json);

// Simplify to Iverson Bracket (or maybe canonicalize)
console.log(ce.parse('0^{|a-b|}').json);
// -> ["Boole", ["Equal", a, b]]

// Simplify (canonicalize) sign function
console.log(ce.parse('\\frac{2}{0^x+1}-1').json);

// Simplify to LessThan, etc...
console.log(ce.parse('0^{|\\frac{2}{0^x+1}|}').json);
// -> ["Boole", ["LessThan", x, 0]]

console.log(ce.parse('0^{|\\frac{2}{0^{4-x}+1}|}').json);
// -> ["Boole", ["GreaterThan", x, 4]]

console.log(ce.parse('0^{|\\frac{2}{0^{x-4}+1}|}').json);
// -> ["Boole", ["LessThan", x, 4]]

console.log(ce.parse('\\mathbb{1}_{\\N}\\left(x\\right)').json);
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
console.log(ce.parse('(a..b)').json);
// -> ["Range", a, b]

// Knuth's coprime notation
console.log(ce.parse('m\\bot n').json);
// -> ["Equal", ["Gcd", m, n], 1]
// -> ["Coprime", m, n]

// Euler's Phi function (number of integers that are coprime)
console.log(
  ce.parse('\\phi(n)=\\sum_{i=1}^n\\left\\lbrack i\\bot n\\right\\rbrack ').json
);

// Additional \sum syntax
console.log(ce.parse('\\sum_{1 \\le i \\le 10} i^2').json);
//-> ["Sum", ["Square", "i"], ["i", 1, 10]]

console.log(ce.parse('\\sum_{i \\in S} i^2').json);

console.log(ce.parse('\\sum_{i,j} j+i^2').json);
// -> ["Sum", ..., ["i"], ["j"]]

console.log(
  ce.parse('\\sum_{\\stackrel{{\\scriptstyle 1\\le k\\le n}}{(k,n)=1}}\\!\\!k')
    .json
);

// Simplify summations:  see https://en.wikipedia.org/wiki/Summation General Identities

// Congruence (mod) notation (a-b is divisible by n, )
console.log(ce.parse('a\\equiv b(\\mod n)').canonical.json);
// -> ["Equal", ["Mod", a, n], ["Mod", b, n]]
console.log(ce.parse('a\\equiv_{n} b').canonical.json);
// -> ["Equal", ["Mod", a, n], ["Mod", b, n]]
// See https://reference.wolfram.com/language/ref/Mod.html
// a \equiv b (mod 0) => a = b

// Function application (when, e.g. f is a  lambda)
console.log(ce.parse('f|_{3}').canonical.json);
// Application to a range (return a list)
console.log(ce.parse('f|_{3..5}').canonical.json);

//
// BOXING
//

// describe('BOXING', () => {});

//
// PARSING
//

describe('PARSING numbers', () => {
  test(`{ num: '-12n' }`, () => {
    // The `n` prefix is not necessary, but is supported for legacy reasons
    // (an earlier version of the MathJSON spec included it)
    expect(boxToJson({ num: '-12n' })).toEqual(-12);
  });
  test(`-2+3-4`, () => {
    expect(parse('-2+3-4')).toMatchInlineSnapshot(`["Add", -4, -2, 3]`);
  });
  test(`-i`, () => {
    expect(parse('-i')).toMatchInlineSnapshot(`["Negate", "ImaginaryUnit"]`);
  });

  test(`3.424242334e4`, () =>
    expect(parseToJson('3.424242334e4')).toEqual(34242.42334));

  // Should not sum, loss of precision (very big intger + small integer)
  test(`1 + 1e199`, () =>
    expect(parse('1 + 1e199')).toMatch('["Add", 1, 1e+199]'));

  test(`421.35e+1000`, () =>
    expect(parse('421.35e+1000')).toMatch('4.2135e+1002'));

  test(`\\frac34 + 1e199`, () =>
    expect(parse('\\frac34 + 1e199')).toMatch(
      '["Add", ["Rational", 3, 4], 1e+199]'
    ));

  test(`-5-2-3 (non-canonical)`, () =>
    expect(parse('-5-2-3')).toMatchInlineSnapshot(`["Add", -5, -3, -2]`));

  test(`5+3+2 (non-canonical)`, () =>
    expect(parseToJson('5+3+2')).toMatchObject(['Add', 5, 3, 2]));

  // From https://github.com/uellenberg/Logimat/tree/master/examples/nth-prime

  test('nth prime', () =>
    expect(
      parse(
        'p(n)=(\\sum_{v_{1}=2}^{\\operatorname{floor}\\left(1.5*n*\\ln(n)\\right)}(\\operatorname{floor}(\\frac{1}{0^{n-(\\sum_{v_{2}=2}^{v_{1}}((\\prod_{v_{3}=2}^{\\operatorname{floor}(\\sqrt{v_{2}})}(1-0^{\\operatorname{abs}(\\operatorname{floor}(\\frac{v_{2}}{v_{3}})-\\frac{v_{2}}{v_{3}})}))))}+1})))+2'
      )
    ).toMatchInlineSnapshot(`
      [
        "Equal",
        ["Multiply", "n", "p"],
        [
          "Add",
          [
            "Sum",
            [
              "Floor",
              [
                "Divide",
                1,
                [
                  "Add",
                  [
                    "Power",
                    0,
                    [
                      "Subtract",
                      "n",
                      [
                        "Sum",
                        [
                          "Product",
                          [
                            "Delimiter",
                            [
                              "Subtract",
                              1,
                              [
                                "Power",
                                0,
                                [
                                  "Abs",
                                  [
                                    "Subtract",
                                    [
                                      "Floor",
                                      [
                                        "Divide",
                                        ["Subscript", "v", 2],
                                        ["Subscript", "v", 3]
                                      ]
                                    ],
                                    [
                                      "Divide",
                                      ["Subscript", "v", 2],
                                      ["Subscript", "v", 3]
                                    ]
                                  ]
                                ]
                              ]
                            ]
                          ],
                          [
                            "Triple",
                            [
                              "Error",
                              [
                                "ErrorCode",
                                "'incompatible-domain'",
                                "Symbol",
                                ["Domain", "Anything"]
                              ]
                            ],
                            ["Floor", ["Sqrt", "v_2"]],
                            ["Floor", ["Sqrt", "v_2"]]
                          ]
                        ],
                        [
                          "Triple",
                          [
                            "Error",
                            [
                              "ErrorCode",
                              "'incompatible-domain'",
                              "Symbol",
                              ["Domain", "Anything"]
                            ]
                          ],
                          2,
                          "v_1"
                        ]
                      ]
                    ]
                  ],
                  1
                ]
              ]
            ],
            [
              "Triple",
              [
                "Error",
                [
                  "ErrorCode",
                  "'incompatible-domain'",
                  "Symbol",
                  ["Domain", "Anything"]
                ]
              ],
              2,
              ["Floor", ["Multiply", 1.5, "n", ["Ln", "n"]]]
            ]
          ],
          2
        ]
      ]
    `));
});

describe('PARSING symbols', () => {
  test('x', () => expect(parse('x')).toMatch('x'));
  test('\\pi', () => expect(parse('\\pi')).toMatch('Pi'));
  test('3\\pi', () => {
    expect(parse('3\\pi')).toMatchInlineSnapshot(`["Multiply", 3, "Pi"]`);
  });
});

describe('PARSING functions', () => {
  test(`\\frac{-x}{-n}`, () => {
    expect(parse('\\frac{-x}{-n}')).toMatchInlineSnapshot(
      `["Divide", "x", "n"]`
    );
  });
});

//
// SERIALIZING
//

describe('SERIALIZING Incomplete expressions', () => {
  test(`['Multiply', 2, ['Rational', 1, 3]]`, () => {
    expect(
      engine.serialize(['Multiply', 2, ['Rational', 1, 3]])
    ).toMatchInlineSnapshot(`\\frac{2}{3}`);
  });
  test(`['Divide']`, () =>
    expect(
      ce.box(['Divide'], { canonical: false }).toJSON()
    ).toMatchInlineSnapshot(`["Divide"]`));
  test(`['Power', undefined]`, () =>
    expect(
      ce
        .box(['Power', undefined as unknown as Expression], {
          canonical: false,
        })
        .toJSON()
    ).toMatchInlineSnapshot(`["Power", ["Sequence"]]`));
});

describe('SERIALIZING Negative factors', () => {
  test(`(-2)\\times(-x)\\times y\\times\\frac{3}{-5}`, () => {
    expect(
      engine.parse('(-2)\\times(-x)\\times y\\times\\frac{3}{-5}').latex
    ).toMatchInlineSnapshot(`\\frac{1}{5}(-6xy)`);
  });
});

//
// CANONICALIZATION
//

describe('CANONICALIZATION negate', () => {
  test('Negate', () => {
    expect(canonicalToJson('-(5)')).toEqual(-5);
  });
  test(`-(-x)`, () => {
    expect(canonicalToJson('-(-x)')).toEqual('x');
  });
  test(`2-q`, () => {
    expect(canonicalToJson('2-q')).toMatchObject(['Subtract', 2, 'q']);
  });
});
describe('CANONICALIZATION Add', () => {
  test('7 + 2 + 5', () =>
    expect(canonicalToJson('7 + 2 + 5')).toMatchObject(['Add', 2, 5, 7]));

  test(`7 + \\frac12`, () =>
    expect(canonicalToJson('7 + \\frac12')).toMatchObject([
      'Add',
      ['Rational', 1, 2],
      7,
    ]));

  test(`1 + 2 + x`, () =>
    expect(canonicalToJson('1 + 2 + x')).toMatchObject(['Add', 1, 2, 'x']));

  test(`1 + \\infty`, () =>
    expect(canonicalToJson('1 + \\infty')).toMatchInlineSnapshot(
      `["Add", 1, {num: "+Infinity"}]`
    ));

  test(`7 + (2 + 5) // Associative`, () =>
    expect(canonicalToJson('7 + (2 + 5)')).toMatchInlineSnapshot(
      `["Add", 2, 5, 7]`
    ));

  test(`-2+a+b`, () =>
    expect(canonicalToJson('-2+a+b')).toMatchInlineSnapshot(
      `["Add", -2, "a", "b"]`
    ));

  test(`-2+a^2+a+a^2`, () =>
    expect(canonicalToJson('-2+a^2+a+a^2')).toMatchInlineSnapshot(
      `["Add", -2, ["Square", "a"], ["Square", "a"], "a"]`
    ));
});
describe('CANONICALIZATION multiply', () => {
  test('2\\times3', () =>
    expect(canonicalToJson('2\\times3')).toStrictEqual(6));

  test(`-2\\times-3`, () =>
    expect(canonicalToJson('-2\\times-3')).toStrictEqual(6));

  test(`x\\times(-y)`, () =>
    expect(canonicalToJson('x\\times(-y)')).toMatchObject([
      'Negate',
      ['Multiply', 'x', 'y'],
    ]));

  test(`2\\times\\frac12`, () =>
    expect(canonicalToJson('2\\times\\frac12')).toStrictEqual(1));

  test(`2\\times(5-5)\\times5\\times4`, () =>
    expect(
      canonicalToJson('2\\times(5-5)\\times5\\times4')
    ).toMatchInlineSnapshot(`["Multiply", 40, ["Subtract", 5, 5]]`));

  test(`(-2)\\times(-x)\\times y\\times\\frac{3}{-5}`, () =>
    expect(
      canonicalToJson('(-2)\\times(-x)\\times y\\times\\frac{3}{-5}')
    ).toMatchInlineSnapshot(`["Multiply", ["Rational", -6, 5], "x", "y"]`));

  test(`'1\\times x\\times 2\\times -5.23 \\times 3.2 \\times \\frac23\\times \\frac1x  // Commutative order'`, () => {
    expect(
      canonicalToJson(
        '1\\times x\\times 2\\times -5.23 \\times 3.2 \\times \\frac23\\times \\frac1x'
      )
    ).toMatchInlineSnapshot(`["Multiply", ["Rational", -4, 3], 16.736]`);
  });
});
describe('CANONICALIZATION divide', () => {
  test(`\\frac{-x}{-n}`, () => {
    expect(canonicalToJson('\\frac{-x}{-n}')).toMatchObject([
      'Divide',
      'x',
      'n',
    ]);
  });
  test(`\\frac{-x}{2}`, () => {
    expect(canonicalToJson('\\frac{-x}{2}')).toMatchInlineSnapshot(
      `["Negate", ["Multiply", ["Rational", 1, 2], "x"]]`
    );
  });
  test(`\\frac{-x}{\\frac{1}{n}}`, () => {
    expect(canonicalToJson('\\frac{-x}{\\frac{1}{n}}')).toMatchInlineSnapshot(
      `["Negate", ["Multiply", "n", "x"]]`
    );
  });
});
describe('CANONICALIZATION sqrt', () => {
  test('\\sqrt{3^2}', () => {
    expect(canonicalToJson('\\sqrt{3^2}')).toMatchInlineSnapshot(`3`);
    // Canonical of Sqrt should not transform to Power
    expect(canonicalToJson('\\sqrt{12}')).toMatchInlineSnapshot(
      `["Multiply", 2, ["Sqrt", 3]]`
    );
  });
  test(`\\sqrt[3]{x}`, () =>
    expect(canonicalToJson('\\sqrt[3]{x}')).toMatchObject(['Root', 'x', 3]));
  test(`\\sqrt{x}`, () =>
    expect(canonicalToJson('\\sqrt{x}')).toMatchObject(['Sqrt', 'x']));
});
describe('CANONICALIZATION invisible operators', () => {
  test('2x // invisible multiply', () => {
    expect(canonicalToJson('2x')).toMatchObject(['Multiply', 2, 'x']);
  });
  test(`'3\\frac18 // invisible add`, () =>
    expect(canonicalToJson('3\\frac18')).toMatchInlineSnapshot(
      `["Add", ["Rational", 1, 8], 3]`
    ));
  test(`2(x)`, () =>
    expect(canonicalToJson('2(x)')).toMatchObject(['Multiply', 2, 'x']));
  test(`(2)(x)`, () =>
    expect(canonicalToJson('(2)(x)')).toMatchObject(['Multiply', 2, 'x']));
  test(`2x+x`, () =>
    expect(canonicalToJson('2x+x')).toMatchInlineSnapshot(
      `["Add", "x", ["Multiply", 2, "x"]]`
    ));
});

//
// SIMPLIFICATION
//

describe('SIMPLIFICATION add', () => {
  test('7 + 2 + 5', () => expect(simplifyToJson('7 + 2 + 5')).toEqual(14));
  test(`2-q`, () =>
    expect(simplifyToJson('2-q')).toMatchObject(['Subtract', 2, 'q']));

  test(`-i`, () =>
    expect(simplifyToJson('-i')).toMatchInlineSnapshot(
      `["Negate", "ImaginaryUnit"]`
    )); // @fixme ['Complex', 0, -1]?
  test(`3-i`, () => expect(simplifyToJson('3-i')).toEqual(['Complex', 3, -1]));

  test(`2\\sqrt{3}+\\sqrt{1+2}`, () =>
    expect(simplifyToJson('2\\sqrt{3}+\\sqrt{1+2}')).toMatchInlineSnapshot(
      `["Multiply", 3, ["Sqrt", 3]]`
    ));

  test(`2x+x`, () =>
    expect(simplifyToJson('2x+x')).toMatchInlineSnapshot(
      `["Multiply", 3, "x"]`
    ));
});

describe('SIMPLIFICATION divide', () => {
  test(`simplify('\\frac{\\sqrt{5040}}{3}')`, () => {
    expect(simplifyToJson('\\frac{\\sqrt{5040}}{3}')).toMatchObject([
      'Multiply',
      4,
      ['Sqrt', 35],
    ]);
  });

  test(`'\\frac{-x}{-n}'`, () =>
    expect(simplifyToJson('\\frac{-x}{-n}')).toMatchObject([
      'Divide',
      'x',
      'n',
    ]));

  test(`\\frac{5}{\\frac{7}{x}}`, () =>
    expect(simplifyToJson('\\frac{5}{\\frac{7}{x}}')).toMatchObject([
      'Multiply',
      ['Rational', 5, 7],
      'x',
    ]));

  test(`simplify('\\frac{\\sqrt{15}}{\\sqrt{3}}')`, () =>
    expect(simplifyToJson('\\frac{\\sqrt{15}}{\\sqrt{3}}')).toMatchObject([
      'Divide',
      ['Sqrt', 15],
      ['Sqrt', 3],
    ])); // @fixme
});

describe('SIMPLIFICATION sqrt', () => {
  test(`\\sqrt{5040}`, () =>
    expect(simplifyToJson('\\sqrt{5040}')).toMatchObject([
      'Multiply',
      12,
      ['Sqrt', 35],
    ]));

  test(`simplify('\\sqrt{3^2}')`, () =>
    expect(simplifyToJson('\\sqrt{3^2}')).toEqual(3));

  test(`simplify('\\sqrt{12}')`, () =>
    expect(simplifyToJson('\\sqrt{12}')).toMatchObject([
      'Multiply',
      2,
      ['Sqrt', 3],
    ]));

  // A math olympiad problem
  // that other CAS don't simplify: Simplify[ToExpression["\\frac{\\sqrt{4+2\\sqrt{3}}-\\sqrt{28+10\\sqrt{3}}}{15}", TeXForm]]
  test(`simplify('\\frac{\\sqrt{4+2\\sqrt{3}}-\\sqrt{28+10\\sqrt{3}}}{15}')`, () =>
    expect(
      simplifyToJson('\\frac{\\sqrt{4+2\\sqrt{3}}-\\sqrt{28+10\\sqrt{3}}}{15}')
    ).toMatchInlineSnapshot(`
      [
        "Multiply",
        ["Rational", 1, 15],
        [
          "Subtract",
          ["Sqrt", ["Add", 4, ["Multiply", 2, ["Sqrt", 3]]]],
          ["Sqrt", ["Add", 28, ["Multiply", 10, ["Sqrt", 3]]]]
        ]
      ]
    `));
});

describe('SIMPLIFICATION negate', () => {
  test(`simplify('-(-x)')`, () => expect(simplifyToJson('-(-x)')).toMatch('x'));

  test(`simplify('-(x+1)')`, () =>
    expect(simplifyToJson('-(x+1)')).toMatchInlineSnapshot(
      `["Subtract", ["Negate", "x"], 1]`
    ));
});

describe('SIMPLIFICATION trigonometry', () => {
  test(`simplify('\\sin\\pi')`, () =>
    expect(simplifyToJson('\\sin\\pi')).toEqual(0));

  test(`simplify('1+4\\times\\sin\\frac{\\pi}{10}')`, () =>
    expect(simplifyToJson('1+4\\times\\sin\\frac{\\pi}{10}')).toMatchObject([
      'Sqrt',
      5,
    ]));
});

describe('SIMPLIFICATION power', () => {
  test(`simplify('a^3a\\times a^2')`, () =>
    expect(simplifyToJson('a^3a\\times a^2')).toMatchInlineSnapshot(
      `["Power", "a", 6]`
    ));

  test(`simplify('\\frac{a^4}{a^2}')`, () =>
    expect(simplifyToJson('\\frac{a^4}{a^2}')).toMatchInlineSnapshot(
      `["Square", "a"]`
    ));

  test(`simplify('(a+b)^6')`, () =>
    expect(simplifyToJson('(a+b)^6')).toMatchInlineSnapshot(
      `["Power", ["Add", "a", "b"], 6]`
    ));
});

describe('EXPAND', () => {
  test(`Expand('(a+b)^6')`, () =>
    expect(expand('(a+b)^6')).toMatchInlineSnapshot(`
      [
        "Add",
        ["Power", "a", 6],
        ["Multiply", 20, ["Power", "a", 3], ["Power", "b", 3]],
        ["Multiply", 15, ["Square", "a"], ["Power", "b", 4]],
        ["Multiply", 6, "a", ["Power", "b", 5]],
        ["Power", "b", 6],
        ["Multiply", 15, ["Square", "b"], ["Power", "a", 4]],
        ["Multiply", 6, "b", ["Power", "a", 5]]
      ]
    `)); //@fixme
});

describe('SIMPLIFICATION multiply', () => {
  test(`3(2+5)`, () => {
    expect(simplifyToJson('3(2+5)')).toStrictEqual(21);
  });

  test('2x', () =>
    expect(simplifyToJson('2x')).toMatchObject(['Multiply', 2, 'x']));

  test(`-\\frac{-x+2\\times x}{-2\\times x + 1}`, () => {
    expect(
      simplifyToJson('-\\frac{-x+2\\times x}{-2\\times x + 1}')
    ).toMatchInlineSnapshot(
      `["Negate", ["Divide", "x", ["Add", 1, ["Multiply", -2, "x"]]]]`
    );
  });
});

//
// SYMBOLIC EVALUATION
//

describe('SYMBOLIC EVALUATION trigonometric functions', () => {
  test(`\\sin\\frac\\pi3 // constructible values`, () =>
    expect(evaluateToJson('\\sin\\frac\\pi3')).toMatchInlineSnapshot(
      `["Multiply", ["Rational", 1, 2], ["Sqrt", 3]]`
    ));
  test(`\\sin(\\frac13\\pi) // constructible values`, () =>
    expect(evaluateToJson('\\sin(\\frac13\\pi)')).toMatchInlineSnapshot(
      `["Multiply", ["Rational", 1, 2], ["Sqrt", 3]]`
    ));
});

describe('SYMBOLIC EVALUATION Other functions', () => {
  test('-(-x)', () => expect(NToJson('-(-x)')).toMatch('x'));

  test('50!', () =>
    expect(evaluateToJson('50!')).toMatch(
      '3.0414093201713378043612608166064768844377641568960512e+64'
    ));

  test(`eval('8844418+\\frac{85}{7}')`, () =>
    expect(evaluateToJson('8844418+\\frac{85}{7}')).toMatchObject([
      'Rational',
      61911011,
      7,
    ]));
});

//
// NUMERIC EVALUATION
//

describe('NUMERIC EVALUATION arithmetic', () => {
  test(`N('88444111111113418+8')`, () => {
    expect(NToJson('88444111111113418+8')).toMatch('88444111111113426');
  });

  test(`N('1 + \\frac{1}{3}')`, () => {
    expect(NToJson('1 + \\frac{1}{3}')).toMatch('1.(3)');
  });

  test(`N('8844418+\\frac{85}{7}')`, () =>
    expect(NToJson('8844418+\\frac{85}{7}')).toMatch('8844430.(142857)'));

  test(`N('\\frac34 + 1e30')`, () =>
    expect(NToJson('\\frac34 + 1e30')).toMatch(
      '1.00000000000000000000000000000075e+30'
    ));

  test(`N('\\frac34 + 1e99') // Precision is at 100 digits, so loss of 3/4 is expected`, () =>
    expect(NToJson('\\frac34 + 1e199')).toEqual(1e199));

  test(`NToJson('12345678^3 + \\frac{1}{3}')`, () =>
    expect(NToJson('12345678^3 + \\frac{1}{3}')).toMatch(
      '1.881675960266558605752(3)e+21'
    ));

  test(`NToJson('50!')`, () =>
    expect(NToJson('50!')).toMatch(
      '3.0414093201713378043612608166064768844377641568960512e+64'
    ));

  test(`Wester-3`, () =>
    expect(
      NToJson(
        '\\frac12+\\frac13+\\frac14+\\frac15+\\frac16+\\frac17+\\frac18+\\frac19+\\frac{1}{10}'
      )
    ).toMatch('1.928(968253)'));
});

describe('NUMERIC EVALUATION trigonometry', () => {
  test(`N('\\sin\\pi')`, () => expect(NToJson('\\sin\\pi')).toEqual(0));
  test(`N('\\cos\\frac{\\pi}{7}')`, () =>
    expect(NToJson('\\cos\\frac{\\pi}{7}')).toMatch(
      '0.9009688679024191262361023195074450511659191621318571500535624231994324204279399655013614547185124153'
    ));
});
