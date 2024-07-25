import { check } from '../utils';

//
// Some real math expressions that are awesome...
//

describe('Primality Test', () => {
  test('Primality Test', () =>
    expect(
      check(
        '-\\left\\lfloor\\cos\\left(\\pi\\cdot\\frac{\\left( n-1\\right)!+1}{ n}\\right)\\right\\rfloor'
      )
    ).toMatchInlineSnapshot(`
      box       = [
        "Negate",
        [
          "Floor",
          [
            "Cos",
            [
              "Multiply",
              "Pi",
              [
                "Divide",
                ["Add", ["Factorial", ["Delimiter", ["Add", "n", -1]]], 1],
                "n"
              ]
            ]
          ]
        ]
      ]
      canonical = [
        "Negate",
        [
          "Floor",
          [
            "Cos",
            [
              "Multiply",
              "Pi",
              [
                "Divide",
                ["Add", ["Factorial", ["Subtract", "n", 1]], 1],
                "n"
              ]
            ]
          ]
        ]
      ]
      eval-auto = -floor(cos((pi * n - 1! + pi) / n))
      eval-mach = -floor(cos((pi * n - 1! + pi) / n))
      N-auto    = -floor(cos((3.14159265358979323846264338327950288419716939937510582097494459230781640628620899862803482534211706798214808651328230664709384460955058223172535940812848111745028410270193852110555964462294895493038196442881097566593344612847564823378678316527120190914564856692346034861045432664821339360726024914127 * n - 1! + 3.14159265358979323846264338327950288419716939937510582097494459230781640628620899862803482534211706798214808651328230664709384460955058223172535940812848111745028410270193852110555964462294895493038196442881097566593344612847564823378678316527120190914564856692346034861045432664821339360726024914127) / n))
      N-mach    = -floor(cos((3.141592653589793 * n - 1! + 3.141592653589793) / n))
    `));
  // 	https://en.wikipedia.org/wiki/Wilson%27s_theorem
  // 	https://en.wikipedia.org/wiki/Primality_test#Wilson's_theorem
});

// C.P. Willans Formula: A function that returns the nth prime number.
//
// Not very efficient, but it works
//
//  p(n)=(\sum_{v_{1}=2}^{\operatorname{floor}\left(1.5*n*\ln(n)\right)}(\operatorname{floor}(\frac{1}{0^{n-(\sum_{v_{2}=2}^{v_{1}}((\prod_{v_{3}=2}^{\operatorname{floor}(\sqrt{v_{2}})}(1-0^{\operatorname{abs}(\operatorname{floor}(\frac{v_{2}}{v_{3}})-\frac{v_{2}}{v_{3}})}))))}+1})))+2
// https://github.com/uellenberg/Logimat/tree/master/examples/nth-prime

// See https://en.wikipedia.org/wiki/Formula_for_primes
// Explanation at https://www.youtube.com/watch?v=j5s0h42GfvM&t=1s

describe('Nth PRIME NUMBER', () =>
  test('', () => {
    expect(
      check(
        'p(n):=(\\sum_{v_{1}=2}^{\\operatorname{floor}\\left(1.5*n*\\ln(n)\\right)}(\\operatorname{floor}(\\frac{1}{0^{n-(\\sum_{v_{2}=2}^{v_{1}}((\\prod_{v_{3}=2}^{\\operatorname{floor}(\\sqrt{v_{2}})}(1-0^{\\operatorname{abs}(\\operatorname{floor}(\\frac{v_{2}}{v_{3}})-\\frac{v_{2}}{v_{3}})}))))}+1})))+2'
      )
    ).toMatchInlineSnapshot(
      `Error: Invalid function (n) |-> {sum_(At(v, 1)=2)^(floor(1.5 * n * ln(n)))(floor(1 / (0^(n - sum_(At(v, 2)=2)^(At(v, 1))(prod_(At(v, 3)=2)^(floor(sqrt(Error(ErrorCode(incompatible-domain, "Numbers", "Anything"), At(v, 2)))))(1 + 0^|floor(Error(ErrorCode(incompatible-domain, "Numbers", "Anything"), At(v, 2)) / Error(ErrorCode(incompatible-domain, "Numbers", "Anything"), At(v, 3))) - Error(ErrorCode(incompatible-domain, "Numbers", "Anything"), At(v, 2)) / Error(ErrorCode(incompatible-domain, "Numbers", "Anything"), At(v, 3))|))) + 1))) + 2}`
    );
  }));

// The value of these polynomials for x in 0..n are all prime numbers
describe('Euler Prime Generating Polynomial', () => {
  test('x in 0..39', () =>
    expect(check('n^2 + n + 41')).toMatchInlineSnapshot(`
      box       = ["Add", ["Power", "n", 2], "n", 41]
      canonical = ["Add", ["Square", "n"], "n", 41]
    `));
  test('x in 0..61', () =>
    expect(check('8x^2 - 488 x + 7243')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        ["InvisibleOperator", 8, ["Power", "x", 2]],
        ["InvisibleOperator", -488, "x"],
        7243
      ]
      canonical = [
        "Add",
        ["Multiply", 8, ["Square", "x"]],
        ["Multiply", -488, "x"],
        7243
      ]
    `));
  test('x in ', () =>
    expect(check('43 x^2 - 537x + 2971')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        ["InvisibleOperator", 43, ["Power", "x", 2]],
        ["InvisibleOperator", -537, "x"],
        2971
      ]
      canonical = [
        "Add",
        ["Multiply", 43, ["Square", "x"]],
        ["Multiply", -537, "x"],
        2971
      ]
    `));
  test('x in 0..45', () =>
    expect(check('36 x^2 - 810 x + 2763')).toMatchInlineSnapshot(`
      box       = [
        "Add",
        ["InvisibleOperator", 36, ["Power", "x", 2]],
        ["InvisibleOperator", -810, "x"],
        2763
      ]
      canonical = [
        "Add",
        ["Multiply", 36, ["Square", "x"]],
        ["Multiply", -810, "x"],
        2763
      ]
    `));
  test('x in', () =>
    expect(check('x^2 - 79x + 1601')).toMatchInlineSnapshot(`
      box       = ["Add", ["Power", "x", 2], ["InvisibleOperator", -79, "x"], 1601]
      canonical = ["Add", ["Square", "x"], ["Multiply", -79, "x"], 1601]
    `));
  test('x in 0..10', () =>
    expect(check('2x^2 + 11')).toMatchInlineSnapshot(`
      box       = ["Add", ["InvisibleOperator", 2, ["Power", "x", 2]], 11]
      canonical = ["Add", ["Multiply", 2, ["Square", "x"]], 11]
    `));
  test('x in 0..10', () =>
    expect(check('x^3 + x^2 + 17')).toMatchInlineSnapshot(`
      box       = ["Add", ["Power", "x", 3], ["Power", "x", 2], 17]
      canonical = ["Add", ["Power", "x", 3], ["Square", "x"], 17]
    `));
});

describe("Mill's formula https://en.wikipedia.org/wiki/Mills%27_constant", () =>
  test('Sequence https://oeis.org/A051254', () =>
    expect(check('\\lfloor (\\frac{3540326840}{2710032743})^{3^{n}} \\rfloor'))
      .toMatchInlineSnapshot(`
      box       = [
        "Floor",
        [
          "Power",
          ["Delimiter", ["Divide", 3540326840, 2710032743]],
          ["Power", 3, "n"]
        ]
      ]
      canonical = [
        "Floor",
        ["Power", ["Rational", 3540326840, 2710032743], ["Power", 3, "n"]]
      ]
      eval-auto = floor((3540326840/2710032743)^3^n)
      eval-mach = floor((3540326840/2710032743)^3^n)
      N-auto    = floor(1.30637788386308069046086798516588993109445984284183240955033730380282715277879578003312707576389603791587842080917617902006285833277845381368515812061537147265382689879920760795029257696315590235656425793966873853376169337301619458698916539253046213102525602953572874968027646446779480848508700103185^3^n)
      N-mach    = floor(1.3063778838630806^3^n)
    `)));

// A meaningless, but amusing, coincidence
describe('⌈e⌉ = ⌊π⌋', () =>
  test('', () =>
    expect(check('⌈e⌉ = ⌊π⌋')).toMatchInlineSnapshot(`
      box       = ["Equal", ["Ceil", "e"], ["Floor", "Pi"]]
      canonical = ["Equal", ["Ceil", "ExponentialE"], ["Floor", "Pi"]]
      eval-auto = "True"
    `)));

//  Ramanujan factorial approximation
// https://www.johndcook.com/blog/2012/09/25/ramanujans-factorial-approximation/
describe('RAMANUJAN FACTORIAL APPROXIMATION', () =>
  test('', () =>
    expect(
      check(
        '\\sqrt{\\pi}\\left(\\frac{n}{e}\\right)^n\\sqrt[6]{8n^3+4n^2+n+\\frac{1}{30}}'
      )
    ).toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        ["Sqrt", "Pi"],
        ["Power", ["Delimiter", ["Divide", "n", "e"]], "n"],
        [
          "Root",
          [
            "Add",
            ["InvisibleOperator", 8, ["Power", "n", 3]],
            ["InvisibleOperator", 4, ["Power", "n", 2]],
            "n",
            ["Divide", 1, 30]
          ],
          6
        ]
      ]
      canonical = [
        "Multiply",
        ["Exp", ["Negate", "n"]],
        ["Sqrt", "Pi"],
        ["Power", "n", "n"],
        [
          "Root",
          [
            "Add",
            ["Multiply", 8, ["Power", "n", 3]],
            ["Multiply", 4, ["Square", "n"]],
            "n",
            ["Rational", 1, 30]
          ],
          6
        ]
      ]
      eval-auto = e^-n * sqrt(pi) * n^n * (8n^3 + 4n^2 + n + 1/30)^(1/6)
      eval-mach = e^-n * sqrt(pi) * n^n * (8n^3 + 4n^2 + n + 1/30)^(1/6)
      N-auto    = 1.772453850905516 * 2.71828182845904523536028747135266249775724709369995957496696762772407663035354759457138217852516642742746639193200305992181741359662904357290033429526059563073813232862794349076323382988075319525101901157383418793070215408914993488416750924476146066808226480016847741185374234544243710753907774499207^-n * n^n * (8n^3 + 4n^2 + n + 0.0333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333)^0.166666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666667
      N-mach    = 1.7724538509055159 * 2.718281828459045^-n * n^n * (8n^3 + 4n^2 + n + 0.03333333333333333)^0.16666666666666666
    `)));

/*

	⁃	https://www.reddit.com/r/math/comments/rxv4qw/what_is_your_all_time_favorite_math_equation/
	⁃	Curves for  the Mathematically Curious
  	⁃	sin(sin x + cos y) = cos(sin xy + cos x)
	  ⁃	x^2 + (\frac54y − \sqrt{|x|})^2  = 1
	  ⁃	catenary
	  ⁃	Weierestrass function (continuous, but not differentiable anywhere)
	  ⁃	 \int_a^b \frac{f(x)}{f(a+b-x)+f(x)}dx = \frac{b-a}{2}
	⁃	see https://www.youtube.com/watch?v=BfZObnTIsYk
	⁃	x+y+z = 1, x^2+y^2+z^2 = 2, x^3+y^3+z^3=3, x^4+y^4+z^4=? (x, y, z integers). Try out all integers from 0 to 1 million
	⁃	615+x^2 = 2^y
	⁃	https://www.youtube.com/watch?v=DOISjFviqkM
	⁃	f(2a) + f(2b) = f(f(a + b))
	⁃	https://www.youtube.com/watch?v=uJqbHaFqjmI

*/
