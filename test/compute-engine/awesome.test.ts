import { check } from '../utils';

//
// Some real math expressions that are awesome...
//

// A function that returns the nth prime number.
// Not very efficient, but it works
//  p(n)=(\sum_{v_{1}=2}^{\operatorname{floor}\left(1.5*n*\ln(n)\right)}(\operatorname{floor}(\frac{1}{0^{n-(\sum_{v_{2}=2}^{v_{1}}((\prod_{v_{3}=2}^{\operatorname{floor}(\sqrt{v_{2}})}(1-0^{\operatorname{abs}(\operatorname{floor}(\frac{v_{2}}{v_{3}})-\frac{v_{2}}{v_{3}})}))))}+1})))+2
// https://github.com/uellenberg/Logimat/tree/master/examples/nth-prime

describe('Nth PRIME NUMBER', () =>
  test('', () => {
    expect(
      check(
        'p(n)=(\\sum_{v_{1}=2}^{\\operatorname{floor}\\left(1.5*n*\\ln(n)\\right)}(\\operatorname{floor}(\\frac{1}{0^{n-(\\sum_{v_{2}=2}^{v_{1}}((\\prod_{v_{3}=2}^{\\operatorname{floor}(\\sqrt{v_{2}})}(1-0^{\\operatorname{abs}(\\operatorname{floor}(\\frac{v_{2}}{v_{3}})-\\frac{v_{2}}{v_{3}})}))))}+1})))+2'
      )
    ).toMatchInlineSnapshot();
  }));

// A meaningless, but amusing, coincidence
describe('⌈e⌉ = ⌊π⌋', () =>
  test('', () => expect(check('⌈e⌉ = ⌊π⌋')).toMatchInlineSnapshot()));

//  Ramanujan factorial approximation
// https://www.johndcook.com/blog/2012/09/25/ramanujans-factorial-approximation/
describe('RAMANUJAN FACTORIAL APPROXIMATION', () =>
  test('', () =>
    expect(
      check(
        '\\sqrt{\\pi}\\left(\\frac{n}{e}\\right)^n\\sqrt[6]{8n^3+4n^2+n+\\frac{1}{30}}'
      )
    ).toMatchInlineSnapshot()));

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
