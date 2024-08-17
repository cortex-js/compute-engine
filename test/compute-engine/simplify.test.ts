import {
  BoxedExpression,
  BoxedRule,
  BoxedRuleSet,
  ComputeEngine,
  Rule,
} from '../../src/compute-engine';
import { Expression } from '../../src/math-json/types.ts';
import { simplify, exprToString } from '../utils';

export const ce = new ComputeEngine();

const RULES: Rule[] = [
  //NEW (doesn't work b/c keeps - sign)
  {
    match: '(-x)^n',
    replace: 'x^n',
    condition: ({ _n }) => _n.isEven === true,
  },
  {
    match: '(-x)^{n/m}',
    replace: 'x^{n/m}',
    condition: ({ _n, _m }) => _n.isEven === true && _m.isOdd === true,
  },

  //NEW
  {
    match: '(-x)^n',
    replace: '-x^n',
    condition: ({ _n }) => _n.isOdd === true,
  },
  {
    match: '(-x)^{n/m}',
    replace: '-x^{n/m}',
    condition: (ids) => ids._n.isOdd === true && ids._m.isOdd === true,
  },

  //Situational and Not Being Run
  {
    match: 'a/b+c/d',
    replace: '(a*d+b*c)/(b*d)',
    condition: (ids) => ids._a.isNotZero === true,
  },

  //Not Being Run (gives infinity instead of NaN)
  'x/0 -> \\operatorname{NaN}',
  {
    match: '0^x',
    replace: '\\operatorname{NaN}',
    condition: (ids) => ids._x.isNonPositive === true,
  },

  //Currently gives 0
  {
    match: '0*x',
    replace: '\\operatorname{NaN}',
    condition: (_x) => _x._x.isInfinity === true,
  },

  //Ln
  // '\\log(x) -> \\ln(x)',
  '\\ln(x)+\\ln(y) -> \\ln(x*y)', //assumes negative arguments are allowed
  '\\ln(x)-\\ln(y) -> \\ln(x/y)',
  'e^{\\ln(x)+y} -> x*e^y',
  'e^{\\ln(x)-y} -> x/e^y',
  'e^{\\ln(x)*y} -> x^y',
  'e^{\\ln(x)/y} -> x^{1/y}',
  'e^\\ln(x) -> x',
  '\\ln(e^x*y) -> x+\\ln(y)',
  '\\ln(e^x/y) -> x-\\ln(y)',
  '\\ln(y/e^x) -> \\ln(y)-x',
  '\\ln(0) -> \\operatorname{NaN}',

  //Log base c
  {
    match: '\\log_c(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._c.isZero === true || id._c.isOne === true,
  },
  '\\log_c(x)+\\log_c(y) -> \\log_c(x*y)', //assumes negative arguments are allowed
  '\\log_c(x)-\\log_c(y) -> \\log_c(x/y)',
  '\\log_c(c^x) -> x',
  '\\log_c(c) -> 1',
  '\\log_c(0) -> \\operatorname{NaN}',
  'c^{\\log_c(x)} -> x',
  'c^{\\log_c(x)*y} -> x^y',
  'c^{\\log_c(x)/y} -> x^{1/y}',
  '\\log_c(c^x*y) -> x+\\log_c(y)',
  '\\log_c(c^x/y) -> x-\\log_c(y)',
  '\\log_c(y/c^x) -> \\log_c(y)-x',
  'c^{\\log_c(x)+y} -> x*c^y',
  'c^{\\log_c(x)-y} -> x/c^y',

  //Change of Base
  '\\log_{1/c}(a) -> -\\log_c(a)',
  '\\log_c(a)*\\ln(a) -> \\ln(c)',
  '\\log_c(a)/\\log_c(b) -> \\ln(a)/\\ln(b)',
  '\\log_c(a)/\\ln(a) -> 1/\\ln(c)',
  '\\ln(a)/\\log_c(a) -> \\ln(c)',

  //Absolute Value
  '|-x| -> |x|',
  {
    match: '|x|',
    replace: 'x',
    condition: (ids) => ids._x.isNonNegative === true,
  },
  {
    match: '|x|',
    replace: '-x',
    condition: (ids) => ids._x.isNonPositive === true,
  },
  {
    match: '|xy|',
    replace: 'x|y|',
    condition: (ids) => ids._x.isNonNegative === true,
  },
  {
    match: '|xy|',
    replace: '-x|y|',
    condition: (ids) => ids._x.isNonPositive === true,
  },

  '|xy| -> |x||y|',
  '|\\frac{x}{y}| -> \\frac{|x|}{|y|}',
  { match: '|x|^n', replace: 'x^n', condition: (id) => id._n.isEven === true },
  {
    match: '|x|^{n/m}',
    replace: 'x^{n/m}',
    condition: (id) => id._n.isEven === true && id._m.isOdd === true,
  },
  {
    match: '|x^n|',
    replace: '|x|^n',
    condition: (id) => id._n.isOdd === true || id._n.isRational === false,
  },
  {
    match: '|x^{n/m}|',
    replace: '|x|^{n/m}',
    condition: (id) => id._n.isOdd === true || id._m.isInteger === true,
  },

  {
    match: '|\\frac{x}{y}|',
    replace: '\\frac{x}{|y|}',
    condition: (ids) => ids._x.isNonNegative === true,
  },
  {
    match: '|\\frac{x}{y}|',
    replace: '-\\frac{x}{|y|}',
    condition: (ids) => ids._x.isNonPositive === true,
  },
  {
    match: '|\\frac{x}{y}|',
    replace: '\\frac{|x|}{y}',
    condition: (ids) => ids._y.isNonNegative === true,
  },
  {
    match: '|\\frac{x}{y}|',
    replace: '-\\frac{|x|}{y}',
    condition: (ids) => ids._y.isNonPositive === true,
  },

  //Even functions
  '\\cos(|x|) -> \\cos(x)',
  '\\sec(|x|) -> \\sec(x)',
  '\\cosh(|x|) -> \\cosh(x)',
  '\\sech(|x|) -> \\sech(x)',

  //Odd Trig Functions
  '|\\sin(x)| -> \\sin(|x|)',
  '|\\tan(x)| -> \\tan(|x|)',
  '|\\cot(x)| -> \\cot(|x|)',
  '|\\csc(x)| -> \\csc(|x|)',
  '|\\arcsin(x)| -> \\arcsin(|x|)',
  '|\\arctan(x)| -> \\arctan(|x|)',
  '|\\arcctg(x)| -> \\arcctg(|x|)',
  '|\\arccsc(x)| -> \\arccsc(|x|)',
  //Odd Hyperbolic Trig Functions
  '|\\sinh(x)| -> \\sinh(|x|)',
  '|\\tanh(x)| -> \\tanh(|x|)',
  '|\\coth(x)| -> \\coth(|x|)',
  '|\\csch(x)| -> \\csch(|x|)',
  '|\\arsinh(x)| -> \\arsinh(|x|)',
  '|\\artanh(x)| -> \\artanh(|x|)',
  '|\\operatorname{arccoth}(x)| -> \\operatorname{arccoth}(|x|)',
  '|\\arcsch(x)| -> \\arcsch(|x|)',

  //Negative Exponents in Denominator
  {
    match: '\\frac{a}{b^{-n}}',
    replace: 'a*b^n',
    condition: ({ _b }) => _b.isNotZero === true,
  }, // doesn't work but {match:'\\frac{a}{b^n}',replace:'a*b^{-n}',condition:ids=>ids._n.isNotZero===true} works
  {
    match: '\\frac{a}{d*b^{-n}}',
    replace: '\\frac{a}{d}*b^n',
    condition: (ids) => ids._b.isNotZero === true,
  }, // doesn't work but {match:'\\frac{a}{d*b^n}',replace:'\\frac{a}{d}*b^{-n}',condition:ids=>ids._n.isNotZero===true} works

  //Indeterminate Forms Involving Infinity
  { match: '0*x', replace: '0', condition: (_x) => _x._x.isFinite === true },
  { match: '1^x', replace: '1', condition: (_x) => _x._x.isFinite === true },
  {
    match: 'a^0',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._a.isInfinity === true,
  },

  //Infinity and Multiplication
  {
    match: '\\infty*x',
    replace: '\\infty',
    condition: (_x) => _x._x.isPositive === true,
  },
  {
    match: 'x*(-\\infty)',
    replace: '-\\infty',
    condition: (_x) => _x._x.isPositive === true,
  },
  {
    match: '\\infty*x',
    replace: '-\\infty',
    condition: (_x) => _x._x.isNegative === true,
  },
  {
    match: 'x*(-\\infty)',
    replace: '\\infty',
    condition: (_x) => _x._x.isNegative === true,
  },

  //Infinity and Division
  {
    match: '\\infty/x',
    replace: '\\infty',
    condition: (_x) => _x._x.isPositive === true && _x._x.isFinite === true,
  },
  {
    match: '(-\\infty)/x',
    replace: '-\\infty',
    condition: (_x) => _x._x.isPositive === true && _x._x.isFinite === true,
  },
  {
    match: '\\infty/x',
    replace: '-\\infty',
    condition: (_x) => _x._x.isNegative === true && _x._x.isFinite === true,
  },
  {
    match: '(-\\infty)/x',
    replace: '\\infty',
    condition: (_x) => _x._x.isNegative === true && _x._x.isFinite === true,
  },
  {
    match: 'x/y',
    replace: '\\operatorname{NaN}',
    condition: (_x) => _x._x.isInfinity === true && _x._y.isInfinity === true,
  },

  //Infinity and Powers (doesn't work for a=\\pi)
  {
    match: 'a^\\infty',
    replace: '\\infty',
    condition: (id) => id._a.isGreater(1) === true,
  },
  {
    match: 'a^\\infty',
    replace: '0',
    condition: (id) => id._a.isPositive === true && id._a.isLess(1) === true,
  },
  {
    match: '\\infty^a',
    replace: '0',
    condition: (id) => id._a.isNegative === true,
  },
  {
    match: '(-\\infty)^a',
    replace: '0',
    condition: (id) => id._a.isNegative === true,
  },
  {
    match: 'a^{-\\infty}',
    replace: '0',
    condition: (id) => id._a.isGreater(1) === true,
  },
  {
    match: 'a^{-\\infty}',
    replace: '\\infty',
    condition: (id) => id._a.isPositive === true && id._a.isLess(1) === true,
  },
  //This one works for \\pi
  // {match:'\\infty^a',replace:'\\infty',condition:id=>id._a.isPositive===true},

  //Logs and Infinity
  '\\ln(\\infty) -> \\infty',
  {
    match: '\\log_c(\\infty)',
    replace: '\\infty',
    condition: (id) => id._c.isGreater(1) === true,
  },
  {
    match: '\\log_c(\\infty)',
    replace: '-\\infty',
    condition: (id) => id._c.isLess(1) === true && id._c.isPositive === true,
  },
  {
    match: '\\log_\\infty(c)',
    replace: '0',
    condition: (id) =>
      id._c.isPositive === true &&
      id._c.isOne === false &&
      id._c.isFinite === true,
  },

  //Trig and Infinity
  {
    match: '\\sin(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\cos(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\tan(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\cot(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\sec(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\csc(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },

  //Inverse Trig and Infinity
  '\\arcsin(\\infty) -> \\operatorname{NaN}',
  '\\arccos(\\infty) -> \\operatorname{NaN}',
  '\\arcsin(-\\infty) -> \\operatorname{NaN}',
  '\\arccos(-\\infty) -> \\operatorname{NaN}',
  '\\arctan(\\infty) -> \\frac{\\pi}{2}',
  '\\arctan(-\\infty) -> -\\frac{\\pi}{2}',
  '\\arcctg(\\infty) -> 0',
  '\\arcctg(-\\infty) -> \\pi',
  '\\arcsec(\\infty) -> \\frac{\\pi}{2}',
  '\\arcsec(-\\infty) -> \\frac{\\pi}{2}',
  '\\arccsc(\\infty) -> 0',
  '\\arccsc(-\\infty) -> 0',

  //Hyperbolic Trig and Infinity
  '\\sinh(\\infty) -> \\infty',
  '\\sinh(-\\infty) -> -\\infty',
  '\\cosh(\\infty) -> \\infty',
  '\\cosh(-\\infty) -> \\infty',
  '\\tanh(\\infty) -> 1',
  '\\tanh(-\\infty) -> -1',
  '\\coth(\\infty) -> 1',
  '\\coth(-\\infty) -> -1',
  '\\sech(\\infty) -> 0',
  '\\sech(-\\infty) -> 0',
  '\\csch(\\infty) -> 0',
  '\\csch(-\\infty) -> 0',

  //Inverse Hyperbolic Trig and Infinity
  '\\arsinh(\\infty) -> \\infty',
  '\\arsinh(-\\infty) -> -\\infty',
  '\\arcosh(\\infty) -> \\infty',
  '\\arcosh(-\\infty) -> \\operatorname{NaN}',

  {
    match: '\\arctanh(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\arccoth(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\arcsech(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },
  {
    match: '\\arcsch(x)',
    replace: '\\operatorname{NaN}',
    condition: (id) => id._x.isInfinity === true,
  },

  //----------- DOMAIN ISSUES -----------

  //Division
  { match: 'a/a', replace: '1', condition: (ids) => ids._a.isNotZero === true },
  {
    match: '1/(1/a)',
    replace: 'a',
    condition: (ids) => ids._a.isNotZero === true,
  },
  {
    match: 'a/(1/b)',
    replace: 'a*b',
    condition: (ids) => ids._b.isNotZero === true,
  },
  {
    match: 'a/(b/c)',
    replace: '(a*c)/b',
    condition: (ids) => ids._c.isNotZero === true,
  },
  { match: '0/a', replace: '0', condition: ({ _a }) => _a.isNotZero === true },

  //Powers
  {
    match: 'x^0',
    replace: '1',
    condition: (ids) => ids._x.isNotZero === true && ids._x.isFinite === true,
  },
  {
    match: 'x/x^n',
    replace: '1/x^{n-1}',
    condition: (ids) => ids._x.isNotZero || ids._n.isGreater(1) === true,
  },
  {
    match: 'x^n/x',
    replace: '1/x^{1-n}',
    condition: (ids) => ids._x.isNotZero || ids._n.isLess(1) === true,
  },
  {
    match: 'x^n*x',
    replace: 'x^{n+1}',
    condition: (ids) =>
      ids._x.isNotZero === true ||
      ids._n.isPositive === true ||
      ids._x.isLess(-1) === true,
  },
  {
    match: 'x^n*x^m',
    replace: 'x^{n+m}',
    condition: (ids) =>
      (ids._x.isNotZero === true ||
        ids._n.add(ids._m).isNegative === true ||
        ids._n.mul(ids._m).isPositive === true) &&
      (ids._n.isInteger === true ||
        ids._m.isInteger === true ||
        ids._n.add(ids._m).isRational === false ||
        ids._x.isNonNegative === true),
  }, //also check if at least one power is not an even root or sum is an even root
  {
    match: 'x^n/x^m',
    replace: 'x^{n+m}',
    condition: (ids) =>
      (ids._x.isNotZero === true || ids._n.add(ids._m).isNegative === true) &&
      (ids._n.isInteger === true ||
        ids._m.isInteger === true ||
        ids._n.sub(ids._m).isRational === false ||
        ids._x.isNonNegative === true),
  }, //also check if at least one power is not an even root or difference is an even root

  {
    match: 'a/(b/c)^d',
    replace: 'a*(c/b)^d',
    condition: (ids) => ids._c.isNotZero === true,
  },
  {
    match: '(b/c)^{-d}',
    replace: '(c/b)^d',
    condition: (ids) => ids._c.isNotZero === true,
  },
  {
    match: '(b/c)^{-1}',
    replace: 'c/b',
    condition: (ids) => ids._c.isNotZero === true,
  },
  {
    match: '(a^n)^m',
    replace: 'a^{m*n}',
    condition: (ids) =>
      ((ids._n.isInteger === true && ids._m.isInteger === true) ||
        ids._a.isNonNegative ||
        ids._n.mul(ids._m).isRational === false) &&
      (ids._n.isPositive === true || ids._m.isPositive === true),
  }, //also check if n*m not rational with even denominator
  // @fixme: this rule may not be correct: (a^n)^m -> a^{m*n} for every n,m

  //Logs and Powers
  {
    match: '\\ln(x^n)',
    replace: 'n*\\ln(x)',
    condition: (ids) =>
      ids._x.isNonNegative ||
      ids._n.isOdd === true ||
      ids._n.isRational === false,
  },
  {
    match: '\\ln(x^{n/k})',
    replace: 'n*\\ln(x)/k',
    condition: (ids) => ids._x.isNonNegative || ids._n.isOdd === true,
  },
  {
    match: '\\ln(x^{n/k})',
    replace: 'n*\\ln(|x|)/k',
    condition: (ids) => ids._n.isEven === true && ids._k.isOdd === true,
  },
  {
    match: '\\ln(x^n)',
    replace: 'n*\\ln(|x|)',
    condition: (ids) => ids._n.isEven === true,
  },

  {
    match: '\\log_c(x^n)',
    replace: 'n*\\log_c(x)',
    condition: (ids) =>
      ids._x.isNonNegative ||
      ids._n.isOdd === true ||
      ids._n.isRational === false,
  },
  {
    match: '\\log_c(x^{n/k})',
    replace: 'n*\\log_c(x)/k',
    condition: (ids) => ids._x.isNonNegative || ids._n.isOdd === true,
  },
  {
    match: '\\log_c(x^{n/k})',
    replace: 'n*\\log_c(|x|)/k',
    condition: (ids) => ids._n.isEven === true && ids._k.isOdd === true,
  },
  {
    match: '\\log_c(x^n)',
    replace: 'n*\\log_c(|x|)',
    condition: (ids) => ids._n.isEven === true,
  },

  // -------- TRIGONOMETRIC --------
  '\\sin(-x) -> -\\sin(x)',
  '\\cos(-x) -> \\cos(x)',
  '\\tan(-x) -> -\\tan(x)',
  '\\cot(-x) -> -\\cot(x)',
  '\\sec(-x) -> \\sec(x)',
  '\\csc(-x) -> -\\csc(x)',
  '\\sin(\\pi - x) -> \\sin(x)',
  '\\cos(\\pi - x) -> -\\cos(x)',
  '\\tan(\\pi - x) -> -\\tan(x)',
  '\\cot(\\pi - x) -> -\\cot(x)',
  '\\sec(\\pi - x) -> -\\sec(x)',
  '\\csc(\\pi - x) -> \\csc(x)',
  '\\sin(\\pi + x) -> -\\sin(x)',
  '\\cos(\\pi + x) -> -\\cos(x)',
  '\\tan(\\pi + x) -> \\tan(x)',
  '\\cot(\\pi + x) -> -\\cot(x)',
  '\\sec(\\pi + x) -> -\\sec(x)',
  '\\csc(\\pi + x) -> \\csc(x)',

  '\\sin(\\frac{\\pi}{2} - x) -> \\cos(x)',
  '\\cos(\\frac{\\pi}{2} - x) -> \\sin(x)',
  '\\tan(\\frac{\\pi}{2} - x) -> \\cot(x)',
  '\\cot(\\frac{\\pi}{2} - x) -> \\tan(x)',
  '\\sec(\\frac{\\pi}{2} - x) -> \\csc(x)',
  '\\csc(\\frac{\\pi}{2} - x) -> \\sec(x)',
  '\\sin(x) * \\cos(x) -> \\frac{1}{2} \\sin(2x)',
  '\\sin(x) * \\sin(y) -> \\frac{1}{2} (\\cos(x-y) - \\cos(x+y))',
  '\\cos(x) * \\cos(y) -> \\frac{1}{2} (\\cos(x-y) + \\cos(x+y))',
  '\\tan(x) * \\cot(x) -> 1',
  // '\\sin(x)^2 + \\cos(x)^2 -> 1',
  '\\sin(x)^2 -> \\frac{1 - \\cos(2x)}{2}',
  '\\cos(x)^2 -> \\frac{1 + \\cos(2x)}{2}',
  {
    match: ['Tan', '__x'],
    replace: ['Divide', ['Sin', '__x'], ['Cos', '__x']],
  },
  {
    match: ['Cot', '__x'],
    replace: ['Divide', ['Cos', '__x'], ['Sin', '__x']],
  },
  {
    match: ['Sec', '__x'],
    replace: ['Divide', 1, ['Cos', '__x']],
  },
  {
    match: ['Csc', '__x'],
    replace: ['Divide', 1, ['Sin', '__x']],
  },
  // {
  //   match: ['Cos', '__x'],
  //   replace: ['Sin', ['Add', ['Divide', 'Pi', 2], '__x']],
  // },
  {
    match: ['Arcosh', '__x'],
    replace: [
      'Ln',
      ['Add', '__x', ['Sqrt', ['Subtract', ['Square', '__x'], 1]]],
    ],
    condition: (sub, ce) => sub.__x.isGreater(ce.One) ?? false,
  },
  {
    match: ['Arcsin', '__x'],
    replace: [
      'Multiply',
      2,
      [
        'Arctan2',
        '__x',
        ['Add', 1, ['Sqrt', ['Subtract', 1, ['Square', '__x']]]],
      ],
    ],
  },
  {
    match: ['Arsinh', '__x'],
    replace: [
      'Multiply',
      2,
      ['Ln', ['Add', '__x', ['Sqrt', ['Add', ['Square', '__x'], 1]]]],
    ],
  },
  {
    match: ['Artanh', '__x'],
    replace: [
      'Multiply',
      'Half',
      ['Ln', ['Divide', ['Add', 1, '__x'], ['Subtract', 1, '__x']]],
    ],
  },
  {
    match: ['Cosh', '__x'],
    replace: ['Divide', ['Add', ['Exp', '__x'], ['Exp', ['Negate', '__x']]], 2],
  },
  {
    match: ['Sinh', '__x'],
    replace: [
      'Divide',
      ['Subtract', ['Exp', '__x'], ['Exp', ['Negate', '__x']]],
      2,
    ],
  },

  // '\\frac{x}{x} -> 1', // Note this is not true for x = 0

  // '\\frac{x^n}{x^m} -> x^{n-m}', // Note this is not always true
  // 'x^n * x^m -> x^{n+m}',
  // 'x^a * x^b -> x^{a+b}',
  // 'x^n^m -> x^{n * m}',

  // // Exponential and logarithms
  // '\\log(xy) -> \\log(x) + \\log(y)',
  // '\\log(x^n) -> n \\log(x)',
  // '\\log(\\frac{x}{y}) -> \\log(x) - \\log(y)',
  // '\\log(\\exp(x) * y) -> x + \\log(y)',
  // '\\log(\\exp(x) / y) -> x - \\log(y)',
  // '\\log(\\exp(x)^y) -> y * x',
  // '\\log(\\exp(x)) -> x',

  // '\\exp(x) * \\exp(y) -> \\exp(x + y)',
  // '\\exp(x)^n -> \\exp(n x)',
  // '\\exp(\\log(x)) -> x',
  // '\\exp(\\log(x) + y) -> x * \\exp(y)',
  // '\\exp(\\log(x) - y) -> x / \\exp(y)',
  // '\\exp(\\log(x) * y) -> x^y',
  // '\\exp(\\log(x) / y) -> x^(1/y)',
  // '\\exp(\\log(x) * \\log(y)) -> x^\\log(y)',
  // '\\exp(\\log(x) / \\log(y)) -> x^{1/\\log(y)}',

  // // Trigonometric
  // '\\sin(-x) -> -\\sin(x)',
  // '\\cos(-x) -> \\cos(x)',
  // '\\tan(-x) -> -\\tan(x)',
  // '\\cot(-x) -> -\\cot(x)',
  // '\\sec(-x) -> \\sec(x)',
  // '\\csc(-x) -> -\\csc(x)',
  // '\\sin(\\pi - x) -> \\sin(x)',
  // '\\cos(\\pi - x) -> -\\cos(x)',
  // '\\tan(\\pi - x) -> -\\tan(x)',
  // '\\cot(\\pi - x) -> -\\cot(x)',
  // '\\sec(\\pi - x) -> -\\sec(x)',
  // '\\csc(\\pi - x) -> \\csc(x)',
  // '\\sin(\\pi + x) -> -\\sin(x)',
  // '\\cos(\\pi + x) -> -\\cos(x)',
  // '\\tan(\\pi + x) -> \\tan(x)',
  // '\\cot(\\pi + x) -> -\\cot(x)',
  // '\\sec(\\pi + x) -> -\\sec(x)',
  // '\\csc(\\pi + x) -> \\csc(x)',

  // '\\sin(\\frac{\\pi}{2} - x) -> \\cos(x)',
  // '\\cos(\\frac{\\pi}{2} - x) -> \\sin(x)',
  // '\\tan(\\frac{\\pi}{2} - x) -> \\cot(x)',
  // '\\cot(\\frac{\\pi}{2} - x) -> \\tan(x)',
  // '\\sec(\\frac{\\pi}{2} - x) -> \\csc(x)',
  // '\\csc(\\frac{\\pi}{2} - x) -> \\sec(x)',
  // '\\sin(x) * \\cos(x) -> \\frac{1}{2} \\sin(2x)',
  // '\\sin(x) * \\sin(y) -> \\frac{1}{2} (\\cos(x-y) - \\cos(x+y))',
  // '\\cos(x) * \\cos(y) -> \\frac{1}{2} (\\cos(x-y) + \\cos(x+y))',
  // '\\tan(x) * \\cot(x) -> 1',
  // // '\\sin(x)^2 + \\cos(x)^2 -> 1',
  // '\\sin(x)^2 -> \\frac{1 - \\cos(2x)}{2}',
  // '\\cos(x)^2 -> \\frac{1 + \\cos(2x)}{2}',
  // {
  //   match: ['Tan', '__x'],
  //   replace: ['Divide', ['Sin', '__x'], ['Cos', '__x']],
  // },
  // {
  //   match: ['Cot', '__x'],
  //   replace: ['Divide', ['Cos', '__x'], ['Sin', '__x']],
  // },
  // {
  //   match: ['Sec', '__x'],
  //   replace: ['Divide', 1, ['Cos', '__x']],
  // },
  // {
  //   match: ['Csc', '__x'],
  //   replace: ['Divide', 1, ['Sin', '__x']],
  // },
  // {
  //   match: ['Cos', '__x'],
  //   replace: ['Sin', ['Add', ['Divide', 'Pi', 2], '__x']],
  // },
  {
    match: ['Arcosh', '__x'],
    replace: [
      'Ln',
      ['Add', '__x', ['Sqrt', ['Subtract', ['Square', '__x'], 1]]],
    ],
    condition: ({ __x }) => __x.isGreater(1) ?? false,
  },
  {
    match: ['Arcsin', '__x'],
    replace: [
      'Multiply',
      2,
      [
        'Arctan2',
        '__x',
        ['Add', 1, ['Sqrt', ['Subtract', 1, ['Square', '__x']]]],
      ],
    ],
  },
  {
    match: ['Arsinh', '__x'],
    replace: [
      'Multiply',
      2,
      ['Ln', ['Add', '__x', ['Sqrt', ['Add', ['Square', '__x'], 1]]]],
    ],
  },
  {
    match: ['Artanh', '__x'],
    replace: [
      'Multiply',
      'Half',
      ['Ln', ['Divide', ['Add', 1, '__x'], ['Subtract', 1, '__x']]],
    ],
  },
  {
    match: ['Cosh', '__x'],
    replace: ['Divide', ['Add', ['Exp', '__x'], ['Exp', ['Negate', '__x']]], 2],
  },
  {
    match: ['Sinh', '__x'],
    replace: [
      'Divide',
      ['Subtract', ['Exp', '__x'], ['Exp', ['Negate', '__x']]],
      2,
    ],
  },
];
//  [
//   // `Subtract`
//   ['$\\_ - \\_$', 0],
//   [['Subtract', '\\_x', 0], 'x'],
//   [['Subtract', 0, '\\_x'], '$-x$'],

//   // `Add`
//   [['Add', '_x', ['Negate', '_x']], 0],

//   // `Multiply`
//   ['$\\_ \\times \\_ $', '$\\_^2$'],

//   // `Divide`
//   [['Divide', '_x', 1], { sym: '_x' }],
//   [['Divide', '_x', '_x'], 1, { condition: (sub) => sub.x.isNotZero ?? false }],
//   [
//     ['Divide', '_x', 0],
//     { num: '+Infinity' },
//     { condition: (sub) => sub.x.isPositive ?? false },
//   ],
//   [
//     ['Divide', '_x', 0],
//     { num: '-Infinity' },
//     { condition: (sub) => sub.x.isNegative ?? false },
//   ],
//   [['Divide', 0, 0], NaN],

//   // `Power`
//   [['Power', '_x', 'Half'], '$\\sqrt{x}$'],
//   [
//     ['Power', '_x', 2],
//     ['Square', '_x'],
//   ],

//   // Complex
//   [
//     ['Divide', ['Complex', '_re', '_im'], '_x'],
//     ['Add', ['Divide', ['Complex', 0, '_im'], '_x'], ['Divide', '_re', '_x']],
//     {
//       condition: (sub: Substitution): boolean =>
//         (sub.re.isNotZero ?? false) &&
//         (sub.re.isInteger ?? false) &&
//         (sub.im.isInteger ?? false),
//     },
//   ],

//   // `Abs`
//   [
//     ['Abs', '_x'],
//     { sym: '_x' },
//     {
//       condition: (sub: Substitution): boolean => sub.x.isNonNegative ?? false,
//     },
//   ],
//   [
//     ['Abs', '_x'],
//     ['Negate', '_x'],
//     {
//       condition: (sub: Substitution): boolean => sub.x.isNegative ?? false,
//     },
//   ],

//   //
//   // Boolean
//   //
//   [['Not', ['Not', '_x']], '_x'], // @todo Since Not is an involution, should not be needed
//   [['Not', 'True'], 'False'],
//   [['Not', 'False'], 'True'],
//   [['Not', 'OptArg'], 'OptArg'],

//   [['And'], 'True'],
//   [['And', '__x'], '__x'],
//   [['And', '__x', 'True'], '_x'],
//   [['And', '__', 'False'], 'False'],
//   [['And', '__', 'OptArg'], 'OptArg'],
//   [['And', '__x', ['Not', '__x']], 'False'],
//   [['And', ['Not', '__x'], '__x'], 'False'],

//   [['Or'], 'False'],
//   [['Or', '__x'], '__x'],
//   [['Or', '__', 'True'], 'True'],
//   [['Or', '__x', 'False'], '__x'],
//   [
//     ['Or', '__x', 'OptArg'],
//     ['Or', '__x'],
//   ],

//   [
//     ['NotEqual', '__x'],
//     ['Not', ['Equal', '__x']],
//   ],
//   [
//     ['NotElement', '__x'],
//     ['Not', ['Element', '__x']],
//   ],
//   [
//     ['NotLess', '__x'],
//     ['Not', ['Less', '__x']],
//   ],
//   [
//     ['NotLessNotEqual', '__x'],
//     ['Not', ['LessEqual', '__x']],
//   ],
//   [
//     ['NotTildeFullEqual', '__x'],
//     ['Not', ['TildeFullEqual', '__x']],
//   ],
//   [
//     ['NotApprox', '__x'],
//     ['Not', ['Approx', '__x']],
//   ],
//   [
//     ['NotApproxEqual', '__x'],
//     ['Not', ['ApproxEqual', '__x']],
//   ],
//   [
//     ['NotGreater', '__x'],
//     ['Not', ['Greater', '__x']],
//   ],
//   [
//     ['NotApproxNotEqual', '__x'],
//     ['Not', ['GreaterEqual', '__x']],
//   ],
//   [
//     ['NotPrecedes', '__x'],
//     ['Not', ['Precedes', '__x']],
//   ],
//   [
//     ['NotSucceeds', '__x'],
//     ['Not', ['Succeeds', '__x']],
//   ],
//   [
//     ['NotSubset', '__x'],
//     ['Not', ['Subset', '__x']],
//   ],
//   [
//     ['NotSuperset', '__x'],
//     ['Not', ['Superset', '__x']],
//   ],
//   [
//     ['NotSubsetNotEqual', '__x'],
//     ['Not', ['SubsetEqual', '__x']],
//   ],
//   [
//     ['NotSupersetEqual', '__x'],
//     ['Not', ['SupersetEqual', '__x']],
//   ],

//   // DeMorgan's Laws
//   [
//     ['Not', ['And', ['Not', '_a'], ['Not', '_b']]],
//     ['Or', '_a', '_b'],
//   ],
//   [
//     ['And', ['Not', '_a'], ['Not', '_b']],
//     ['Not', ['Or', '_a', '_b']],
//   ],
//   [
//     ['Not', ['Or', ['Not', '_a'], ['Not', '_b']]],
//     ['And', '_a', '_b'],
//   ],
//   [
//     ['Or', ['Not', '_a'], ['Not', '_b']],
//     ['Not', ['And', '_a', '_b']],
//   ],

//   // Implies

//   [['Implies', 'True', 'False'], 'False'],
//   [['Implies', '_', 'OptArg'], 'True'],
//   [['Implies', '_', 'True'], 'True'],
//   [['Implies', 'False', '_'], 'True'],
//   [
//     ['Or', ['Not', '_p'], '_q'],
//     ['Implies', '_p', '_q'],
//   ], // p => q := (not p) or q
//   // if           Q=F & P= T      F
//   // otherwise                    T

//   //  Equivalent

//   [
//     ['Or', ['And', '_p', '_q'], ['And', ['Not', '_p'], ['Not', '_q']]],
//     ['Equivalent', '_p', '_q'],
//   ], // p <=> q := (p and q) or (not p and not q), aka `iff`
//   //   if (q = p), T. Otherwise, F
//   [['Equivalent', 'True', 'True'], 'True'],
//   [['Equivalent', 'False', 'False'], 'True'],
//   [['Equivalent', 'OptArg', 'OptArg'], 'True'],
//   [['Equivalent', 'True', 'False'], 'False'],
//   [['Equivalent', 'False', 'True'], 'False'],
//   [['Equivalent', 'True', 'OptArg'], 'False'],
//   [['Equivalent', 'False', 'OptArg'], 'False'],
//   [['Equivalent', 'OptArg', 'True'], 'False'],
//   [['Equivalent', 'OptArg', 'False'], 'False'],

// \frac{\sin ^4\left(x\right)-\cos ^4\left(x\right)}{\sin ^2\left(x\right)-\cos ^2\left(x\right)}
// -> 1
// \frac{\sec \left(x\right)\sin ^2\left(x\right)}{1+\sec \left(x\right)}
// -> 1 - cos x
// \tan ^4\left(x\right)+2\tan ^2\left(x\right)+1
// -> \sec ^4\left(x\right)
// \tan ^2\left(x\right)\cos ^2\left(x\right)+\cot ^2\left(x\right)\sin ^2\left(x\right)
// -> 1

/**
 * Each test case is a tuple of two expressions:
 * - The first expression is the input expression to simplify.
 * - The second expression is the expected simplified expression.
 *
 * A third, optional element, is a comment to describe the test case.
 * If the comment starts with the keyword "skip", the test case will be skipped.
 * If the comment starts with the keyword "stop", the debugger will stop at this test case.
 */
export type TestCase =
  | [
      input: Expression | string,
      expected: Expression | string,
      comment?: string,
    ]
  | [heading: string];

/*
 * Some expressions get simplified during canonicalization.
 */
const CANONICALIZATION_TEST_CASES: TestCase[] = [
  [
    `
    // Arithmetic operations
    // - integers and float are simplified
    // - rational and square root of integers are preserved
    // (same behavior as Mathematica)
    //
  `,
  ],
  ['-23', -23, 'Integers should stay as is'],
  ['0.3', 0.3, 'Floating point should stay as is'],
  ['3/4', '3/4', 'Rational are reduced'],
  ['6/8', '3/4', 'Rational are reduced (during canonicalization)'],
  ['\\sqrt3', '\\sqrt3'],
  ['\\sqrt{3.1}', { num: '1.76068168616590091458' }],
  ['x+0', 'x', 'Zero is removed from addition'],
  ['-1234 - 5678', -6912],
  ['1.234 + 5678', 5679.234],
  ['1.234 + 5.678', 6.912],
  ['1.234 + 5.678 + 1.0001', 7.9121],
  ['2 + 4', 6],
  ['1/2 + 0.5', 1, 'Floating point and exact should get simplified'],
  ['\\sqrt3 + 3', '\\sqrt3 + 3', 'should stay exact'],
  ['\\sqrt3 + 1/2', '\\sqrt3 + 1/2', 'should stay exact'],
  ['\\sqrt3 + 0.3', { num: '2.0320508075688772' }],
  ['3/4 + 2', '11/4', 'Rational are reduced, but preserved as exact values'],
  ['3/4 + 5/7', '41/28', 'Rational are reduced, but preserved as exact values'],
  ['3.1/2.8', '1.10714285714285714286', 'Floating point division'],
  [
    ' 2x\\times x \\times 3 \\times x',
    '6x^3',
    'Product of x should be simplified',
  ],
  ['2(13.1+x)', '26.2+2x', 'Product of floating point should be simplified'],
  ['2(13.1+x) - 26.2 - 2x', 0],

  [
    `
    //
    // Numeric literals
    //
    `,
  ],
  ['\\sqrt3 - 2', '\\sqrt3 - 2', 'Should stay exact'],
  ['\\frac{\\sqrt5+1}{4}', '\\frac{\\sqrt5}{4}+\\frac14', 'Should stay exact'],

  [
    `
    //
    // Addition and Subtraction
    //
  `,
  ],
  ['-2+x', 'x-2'],
  ['x-(-1)', 'x+1'],
  ['x+(-1)', 'x-1'],

  [
    `
    //
    // Multiplication
    //
  `,
  ],
  ['1*x', 'x'],
  ['-1*x', '-x'],
  ['(-2)*(-x)', '2*x'],
  ['2*(-x)', '-2*x'],

  [
    `
    //
    // Combine Like terms
    //
  `,
  ],
  ['x+2*x', '3*x'],
  ['2*\\pi * x^2-\\pi * x^2+2*\\pi', '\\pi * x^2+ 2\\pi'],

  [
    `
    //
    // Power of Fraction in Denominator
    //
  `,
  ],
  ['x/(y/2)^3', '(8*x)/y^3'],
  ['x/(2/y)^3', 'x/(2/y)^3'],

  [
    `
    //
    // Double Powers
    //
  `,
  ],
  ['(x^1)^3', 'x^3'],
  ['(x^2)^{-2}', 'x^{-4}'],
  ['(x^{-2})^2', 'x^{-4}'],
  [
    '(x^{-2})^{-2}',
    'x^4',
    'Not defined at x=0, but we assume variables represent values in the general domain where the operation is valid ',
  ],
  ['(x^{1/3})^8', 'x^{8/3}'],
  ['(x^3)^{2/5}', 'x^{6/5}'],
  ['(x^{\\sqrt{2}})^3', 'x^{3\\sqrt{2}}'],

  [
    `
    //
    // Ln/Log
    //
  `,
  ],
  ['\\ln(3)+\\ln(\\frac{1}{3})', 0],
  ['\\frac{\\ln(9)}{\\ln(3)}', 2],
  ['\\ln(e^x/y)', 'x-\\ln(y)'],
  ['\\ln(y/e^x)', '\\ln(y)-x'],
  ['\\ln(0)', NaN],
  ['\\ln(1/x)', '-\\ln(x)'],
  ['\\ln(1)', 0],
  ['\\ln(e)', 1],
  ['\\ln(e^x)', 'x'],

  [
    `
    //
    // Others
    //
  `,
  ],
  ['2\\left(13.1+x\\right)-\\left(26.2+2x\\right)', 0],
  ['\\sqrt{3}(\\sqrt2x + x)', '(\\sqrt3+\\sqrt6)x'],
  [['Add', 1, 2, 1.0001], 4.0001],
];

/**
 * A set of test cases for the simplification of expressions.
 */
const RULE_TEST_CASES: TestCase[] = [
  [
    `
  //
  // Other simplifications
  //
`,
  ],
  ['e e^x e^{-x}', 'e'], // 🙁 e * e^x * e^(-x)
  ['e^x e^{-x}', 1], // 🙁 e^(x - x)
  ['\\sqrt[4]{16b^{4}}', '2b'],

  [
    `
  //
  // Negative Signs and Powers
  //
`,
  ],
  ['(-x)^3', '-x^3'],
  ['(-x)^{4/3}', 'x^{4/3}'], // 🙁 (-x)^(4/3)
  ['(-x)^4', 'x^4'],
  ['(-x)^{3/5}', '-x^{3/5}'],
  ['1/x-1/(x+1)', '1/(x(x+1))'], // 🙁 -1 / (x + 1) + 1 / x
  ['\\sqrt[3]{-2}', '-\\sqrt[3]{2}'], // 🙁 root(-2)(3)

  [
    `
  //
  // Common Denominator
  //
`,
  ],
  ['3/x-1/x', '2/x'],
  ['1/(x+1)-1/x', '-1/(x(x+1))'], // 🙁 -1 / x + 1 / (x + 1)

  [
    `
  //
  // Distribute
  //
`,
  ],
  ['x*y+(x+1)*y', '2xy+y'],
  ['(x+1)^2-x^2', '2x+1'],
  ['2*(x+h)^2-2*x^2', '4xh+2h^2'], // 🙁 -2x^2 + 2(h + x)^2

  [
    `
  //
  // Division
  //
`,
  ],
  ['x/x', 'x/x'], // ("_x")^("_n") -> "_x"^("_n")
  ['\\pi/\\pi', 1],
  ['(\\pi+1)/(\\pi+1)', 1],
  ['1/(1/0)', NaN],
  ['1/(1/\\pi)', '\\pi'],
  ['1/(1/x)', '1/(1/x)'],
  ['y/(1/2)', '2*y'],
  ['x/(1/(-\\pi))', '-\\pi * x'],
  ['x/(a/\\pi)', '\\pi * x/a'],
  ['x/(a/b)', 'x/(a/b)'],
  ['(x/y)/(\\pi/2)', '(2*x)/(\\pi * y)'],
  ['2/3*5/x', '10/(3*x)'],
  ['a/b*c/d', '(a*c)/(b*d)'],
  ['2/\\pi * \\pi', '2'],
  ['x/1', 'x'],
  ['(-1)/x', '-1/x'],
  ['(-2)/(-x)', '2/x'],
  ['2/(-x)', '-2/x'],

  [
    `
  //
  // Operations Involving 0
  //
`,
  ],
  ['0*\\pi', 0],
  ['x-0', 'x'],
  ['\\sin(x)+0', '\\sin(x)'],
  ['0/0', NaN],
  ['2/0', NaN],
  ['0^\\pi', 0], // 🙁 0^(pi)
  ['0^{-2}', NaN], // 0^("_x") -> NaN
  ['0^{-\\pi}', NaN], // 0^("_x") -> NaN
  ['0^0', NaN], // 🙁 1
  ['2^0', 1],
  ['\\pi^0', 1],
  ['0/2', 0],
  ['\\sqrt{0}', 0],
  ['\\sqrt[n]{0}', 0], // 🙁 root(0)(n)
  ['e^0', 1],
  ['|0|', 0],
  ['-0', 0],

  [
    `
  //
  // Ln
  //
`,
  ],
  ['\\ln(xy)-\\ln(x)', '\\ln(y)'], // 🙁 -ln(x) + ln(x * y)
  ['\\ln(y/x)+\\ln(x)', '\\ln(x*y/x)'], // 🙁 ln(x) + ln(y / x)
  ['e^{\\ln(x)+x}', 'x*e^x'], // 🙁 e^(x + ln(x))
  ['e^{\\ln(x)-2*x}', 'x*e^{-2*x}'], // 🙁 e^(-2x + ln(x))
  ['e^\\ln(x)', 'x'], // 🙁 e^(ln(x))
  ['e^{3\\ln(x)}', 'x^3'], // 🙁 e^(3ln(x))
  ['e^{\\ln(x)/3}', 'x^{1/3}'], // 🙁 e^(ln(x) / 3)
  ['\\ln(e^x*y)', 'x+\\ln(y)'], // 🙁 ln(y * e^x)

  [
    `
  //
  // log
  //
`,
  ],
  ['\\log_c(xy)-\\log_c(x)', '\\log_c(y)'], // 🙁 -log(x, c) + log(x * y, c)
  ['\\log_c(y/x)+\\log_c(x)', '\\log_c(xy/x)'], // 🙁 log(x, c) + log(y / x, c)
  ['c^{\\log_c(x)+x}', 'x c^x'], // 🙁 c^(x + log(x, c))
  ['c^{\\log_c(x)-2*x}', 'x c^{-2*x}'], // 🙁 c^(-2x + log(x, c))
  ['c^\\log_c(x)', 'x'], // c^(log(x, c)) -> x
  ['c^{3\\log_c(x)}', 'x^3'], // 🙁 c^(3log(x, c))
  ['c^{\\log_c(x)/3}', 'x^{1/3}'], // 🙁 c^(log(x, c) / 3)
  ['\\log_c(c^x*y)', 'x+\\log_c(y)'], // log(c^x * y, c) -> x + log(y, c)
  ['\\log_c(c^x/y)', 'x-\\log_c(y)'], // log(c^x / y, c) -> x - log(y, c)
  ['\\log_c(y/c^x)', '\\log_c(y)-x'], // log(y / c^x, c) -> log(y, c) - x
  ['\\log_c(c)', 1], // log(c, c) -> 1
  ['\\log_c(c^x)', 'x'], // log(c^x, c) -> x
  ['\\log_c(0)', NaN],
  ['\\log_c(1)', 0],
  ['\\log_2(1/x)', '-\\log_2(x)'],

  [
    `
  //
  // Change of Base
  //
`,
  ],
  ['\\log_c(a)*\\ln(a)', '\\ln(c)'], // log(a, c) * ln(a) -> ln(c)
  ['\\log_c(a)/\\log_c(b)', '\\ln(a)/\\ln(b)'], // log(a, c) / log(b, c) -> ln(a) / ln(b)
  ['\\log_c(a)/\\ln(a)', '1/\\ln(c)'], // log(a, c) / ln(a) -> 1 / ln(c)
  ['\\ln(a)/\\log_c(a)', '\\ln(c)'], // ln(a) / log(a, c) -> ln(c)

  [
    `
  //
  // Logs and Infinity
`,
  ],
  ['\\ln(\\infty)', '\\infty'],
  ['\\log_4(\\infty)', '\\infty'],
  ['\\log_{0.5}(\\infty)', '-\\infty'], // log(+oo, "_c") -> -+oo

  [
    `
  //
  // Absolute Value
  //
`,
  ],
  ['|\\pi|', '\\pi'],
  ['|\\infty|', '\\infty'],
  ['|-\\infty|', '\\infty'],
  ['|-x|', '|x|'], // |-x| -> |x|
  ['|-\\pi|', '\\pi'],
  ['|\\pi * x|', '\\pi * x'], // 🙁 |pi * x|
  ['|\\frac{x}{\\pi}|', '\\frac{|x|}{\\pi}'], // |"_x" / "_y"| -> |"_x"| / "_y"
  ['|\\frac{2}{x}|', '\\frac{2}{|x|}'], // |"_x" / "_y"| -> "_x" / |"_y"|
  ['|x|^4', 'x^4'], // |"_x"|^("_n") -> "_x"^("_n")
  ['|x^3|', '|x|^3'], // |"_x"^("_n")| -> |"_x"|^("_n")
  ['|x|^{4/3}', 'x^{4/3}'], // |"_x"|^("_n") -> "_x"^("_n")
  ['|x^{3/5}|', '|x|^{3/5}'], // 🙁 |x^(3/5)|

  [
    `
  //
  // Even Functions and Absolute Value
  //
`,
  ],
  ['\\cos(|x+2|)', '\\cos(x+2)'], // 🙁 cos(|x + 2|)
  ['\\sec(|x+2|)', '\\sec(x+2)'], // 🙁 1 / cos(|x + 2|)
  ['\\cosh(|x+2|)', '\\cosh(x+2)'], // 🙁 cosh(|x + 2|)
  ['\\sech(|x+2|)', '\\sech(x+2)'], // 🙁 sech(|x + 2|)

  [
    `
  //
  // Odd Functions and Absolute Value
  //
`,
  ],
  ['|\\sin(x)|', '\\sin(|x|)'], // |sin(x)| -> sin(|x|)
  ['|\\tan(x)|', '\\tan(|x|)'], // |tan(x)| -> tan(|x|)
  ['|\\cot(x)|', '\\cot(|x|)'], // |Cot(x)| -> Cot(|x|)
  ['|\\csc(x)|', '\\csc(|x|)'], // |csc(x)| -> csc(|x|)
  ['|\\arcsin(x)|', '\\arcsin(|x|)'], // |arcsin(x)| -> arcsin(|x|)
  ['|\\arctan(x)|', '\\arctan(|x|)'], // |arctan(x)| -> arctan(|x|)
  ['|\\arcctg(x)|', '\\arcctg(|x|)'], // |Arccot(x)| -> Arccot(|x|)
  ['|\\arccsc(x)|', '\\arccsc(|x|)'], // |Arccsc(x)| -> Arccsc(|x|)
  ['|\\sinh(x)|', '\\sinh(|x|)'], // |sinh(x)| -> sinh(|x|)
  ['|\\tanh(x)|', '\\tanh(|x|)'], // |tanh(x)| -> tanh(|x|)
  ['|\\coth(x)|', '\\coth(|x|)'], // |coth(x)| -> coth(|x|)
  ['|\\csch(x)|', '\\csch(|x|)'], // |csch(x)| -> csch(|x|)
  ['|\\arsinh(x)|', '\\arsinh(|x|)'], // |Arsinh(x)| -> Arsinh(|x|)
  ['|\\artanh(x)|', '\\artanh(|x|)'], // |Artanh(x)| -> Artanh(|x|)
  ['|\\operatorname{arcoth}(x)|', '\\operatorname{arcoth}(|x|)'],
  ['|\\arcsch(x)|', '\\arcsch(|x|)'], // |Arcsch(x)| -> Arcsch(|x|)

  [
    `
  //
  // Powers and Infinity
  //
`,
  ],
  ['2^\\infty', '\\infty'],
  ['0.5^\\infty', 0],
  ['\\pi^\\infty', '\\infty'],
  ['e^\\infty', '\\infty'],
  ['\\pi^{-\\infty}', 0],
  ['e^{-\\infty}', 0],
  ['2^{-\\infty}', 0],
  ['(1/2)^{-\\infty}', '\\infty'],
  ['(-\\infty)^4', '\\infty'],
  ['(\\infty)^{1.4}', '\\infty'],
  ['(-\\infty)^{1/3}', '-\\infty'], // 🙁 (-oo)^(1/3)
  ['(-\\infty)^{-1}', 0],
  ['(\\infty)^{-2}', 0],
  ['1^{-\\infty}', NaN],
  ['1^{\\infty}', NaN],
  ['\\infty^0', NaN], // 🙁 1
  ['\\sqrt[4]{\\infty}', '\\infty'],

  [
    `
  //
  // Multiplication and Infinity
  //
`,
  ],
  ['0*\\infty', NaN],
  ['0*(-\\infty)', NaN],
  ['0.5*\\infty', '\\infty'],
  ['(-0.5)*(-\\infty)', '\\infty'], // 🙁 -oo
  ['(-0.5)*\\infty', '-\\infty'],
  ['\\pi * (-\\infty)', '-\\infty'], // 🙁 +oo

  [
    `
  //
  // Division and Infinity
  //
`,
  ],
  ['(-\\infty)/\\infty', NaN],
  ['\\infty/0.5', '\\infty'],
  ['\\infty/(-2)', '-\\infty'],
  ['\\infty/0', NaN],
  ['(-\\infty)/1.7', '-\\infty'],
  ['(-\\infty)/(1-3)', '\\infty'],
  ['2/\\infty', 0],
  ['-100/(-\\infty)', 0],
  ['0/\\infty', 0],

  [
    `
  //
  // Addition and Subtraction and Infinity
  //
`,
  ],
  ['\\infty-\\infty', NaN],
  ['-\\infty-\\infty', '-\\infty'],
  ['\\infty+\\infty', '\\infty'],
  ['\\infty+10', '\\infty'],
  ['\\infty-10', '\\infty'],
  ['-\\infty+10', '-\\infty'],
  ['-\\infty-10', '-\\infty'],
  ['-10-\\infty', '-\\infty'],

  [
    `
  //
  // Trig and Infinity
  //
`,
  ],
  ['\\sin(\\infty)', NaN], // sin("_x") -> NaN
  ['\\cos(\\infty)', NaN], // cos("_x") -> NaN
  ['\\tan(\\infty)', NaN], // tan("_x") -> NaN
  ['\\cot(\\infty)', NaN], // Cot("_x") -> NaN
  ['\\sec(\\infty)', NaN], // sec("_x") -> NaN
  ['\\csc(\\infty)', NaN], // csc("_x") -> NaN
  ['\\sin(-\\infty)', NaN], // sin("_x") -> NaN
  ['\\cos(-\\infty)', NaN], // cos("_x") -> NaN
  ['\\tan(-\\infty)', NaN], // tan("_x") -> NaN
  ['\\cot(-\\infty)', NaN], // Cot("_x") -> NaN
  ['\\sec(-\\infty)', NaN], // sec("_x") -> NaN
  ['\\csc(-\\infty)', NaN], // csc("_x") -> NaN

  [
    `
  //
  // Inverse Trig and Infinity
  //
`,
  ],
  ['\\arcsin(\\infty)', NaN], // arcsin(+oo) -> NaN
  ['\\arccos(\\infty)', NaN], // arccos(+oo) -> NaN
  ['\\arcsin(-\\infty)', NaN], // 🙁 arcsin(-oo)
  ['\\arccos(-\\infty)', NaN], // 🙁 arccos(-oo)
  ['\\arctan(\\infty)', '\\frac{\\pi}{2}'], // arctan(+oo) -> pi / 2
  ['\\arctan(-\\infty)', '-\\frac{\\pi}{2}'], // 🙁 arctan(-oo)
  ['\\arcctg(\\infty)', 0], // Arccot(+oo) -> 0
  ['\\arcctg(-\\infty)', '\\pi'], // 🙁 Arccot(-oo)
  ['\\arcsec(\\infty)', '\\frac{\\pi}{2}'], // Arcsec(+oo) -> pi / 2
  ['\\arcsec(-\\infty)', '\\frac{\\pi}{2}'], // 🙁 Arcsec(-oo)
  ['\\arccsc(\\infty)', 0], // Arccsc(+oo) -> 0
  ['\\arccsc(-\\infty)', 0], // 🙁 Arccsc(-oo)

  [
    `
  //
  // Hyperbolic Trig and Infinity
  //
`,
  ],
  ['\\sinh(\\infty)', '\\infty'], // sinh(+oo) -> +oo
  ['\\sinh(-\\infty)', '-\\infty'], // 🙁 sinh(-oo)
  ['\\cosh(\\infty)', '\\infty'], // cosh(+oo) -> +oo
  ['\\cosh(-\\infty)', '\\infty'], // 🙁 cosh(-oo)
  ['\\tanh(\\infty)', 1], // tanh(+oo) -> 1
  ['\\tanh(-\\infty)', -1], // 🙁 tanh(-oo)
  ['\\coth(\\infty)', 1], // coth(+oo) -> 1
  ['\\coth(-\\infty)', -1], // 🙁 coth(-oo)
  ['\\sech(\\infty)', 0], // sech(+oo) -> 0
  ['\\sech(-\\infty)', 0], // 🙁 sech(-oo)
  ['\\csch(\\infty)', 0], // csch(+oo) -> 0
  ['\\csch(-\\infty)', 0], // 🙁 csch(-oo)

  [
    `
  //
  // Inverse Hyperbolic Trig and Infinity
  //
`,
  ],
  ['\\arsinh(\\infty)', '\\infty'], // Arsinh(+oo) -> +oo
  ['\\arsinh(-\\infty)', '-\\infty'], // 🙁 Arsinh(-oo)
  ['\\arcosh(\\infty)', '\\infty'], // Arcosh(+oo) -> +oo
  ['\\arcosh(-\\infty)', NaN], // 🙁 Arcosh(-oo)
  ['\\arctanh(\\infty)', NaN], // 🙁 (Error("unexpected-command", "\arctanh"), +oo)
  ['\\arctanh(-\\infty)', NaN], // 🙁 (Error("unexpected-command", "\arctanh"), -oo)
  ['\\operatorname{arcoth}(\\infty)', NaN], // 🙁 0
  ['\\operatorname{arcoth}(-\\infty)', NaN], // 🙁 Arccot(-oo)
  ['\\arcsech(\\infty)', NaN], // 🙁 (Error("unexpected-command", "\arcsech"), +oo)
  ['\\arcsech(-\\infty)', NaN], // 🙁 (Error("unexpected-command", "\arcsech"), -oo)
  ['\\arcsch(\\infty)', NaN], // Arcsch("_x") -> NaN
  ['\\arcsch(-\\infty)', NaN], // Arcsch("_x") -> NaN

  [
    `
  //
  // Negative Exponents and Denominator
  //
`,
  ],
  ['\\frac{2}{\\pi^{-2}}', '2\\pi^2'], // 🙁 2 / pi^(-2)
  ['\\frac{2}{x\\pi^{-2}}', '\\frac{2}{x} \\pi^2'], // 🙁 2 / (x * pi^(-2))
  ['(3/\\pi)^{-1}', '\\pi/3'],
  ['(3/x)^{-1}', '(3/x)^{-1}'], // ("_x")^("_n") -> "_x"^("_n")
  ['(x/\\pi)^{-3}', '\\pi^3 / x^3'], // 🙁 (x / pi)^(-3)
  ['(x/y)^{-3}', '(x/y)^{-3}'],
  ['(x^2/\\pi^3)^{-2}', '\\pi^6/x^4'],

  [
    `
  //
  // Powers: Division Involving x
  //
`,
  ],
  ['x/x^3', '1/x^2'], // "_x" / "_x"^("_n") -> 1 / "_x"^("_n" - 1)
  ['(2*x)/x^5', '2/x^4'],
  ['x/x^{-2}', 'x/x^{-2}'], // ("_x")^("_n") -> "_x"^("_n")
  ['x^2/x', 'x^2/x'], // ("_x")^("_n") -> "_x"^("_n")
  ['x^{0.3}/x', '1/x^{0.7}'], // "_x"^("_n") / "_x" -> 1 / "_x"^(1 - "_n")
  ['x^{-3/5}/x', '1/x^{8/5}'], // "_x"^("_n") / "_x" -> 1 / "_x"^(1 - "_n")
  ['\\pi^2/\\pi', '\\pi'],
  ['\\pi/\\pi^{-2}', '\\pi^3'],
  ['\\sqrt[3]{x}/x', '1/x^{2/3}'], // 🙁 root(x)(3) / x

  [
    `
  //
  // Powers: Multiplication Involving x
  //
`,
  ],
  ['x^3*x', 'x^4'],
  ['x^{-2}*x', '1/x'],
  ['x^{-1/3}*x', 'x^{-1/3}*x'], // ("_x")^("_n") -> "_x"^("_n")
  ['\\pi^{-2}*\\pi', '1/\\pi'],
  ['\\pi^{-0.2}*\\pi', '\\pi^{0.8}'], // 🙁 pi^(1 - 0.2)
  ['\\sqrt[3]{x}*x', 'x^{4/3}'],

  [
    `
  //
  // Powers: Multiplication of Two Powers
  //
`,
  ],
  ['x^2*x^{-3}', '1/x'],
  ['x^2*x^{-1}', 'x^2 x^{-1}'], // ("_x")^("_n") -> "_x"^("_n")
  ['x^2*x^3', 'x^5'],
  ['x^{-2}*x^{-1}', '1/x^3'],
  ['x^{2/3}*x^2', 'x^{8/3}'],
  ['x^{5/2}*x^3', 'x^{11/2}'],
  ['\\pi^{-1}*\\pi^2', '\\pi'],
  ['\\sqrt{x}*\\sqrt{x}', '(\\sqrt{x})^2'], // 🙁 sqrt(x) * sqrt(x)
  ['\\sqrt{x}*x^2', 'x^{5/2}'],

  [
    `
  //
  // Powers: Division of Two Powers
  //
  `,
  ],
  ['x^2/x^3', '1/x'],
  ['x^{-1}/x^3', '1/x^4'], // 🙁 x^(-1) / x^3
  ['x/x^{-1}', 'x/x^{-1}'], // ("_x")^("_n") -> "_x"^("_n")
  ['\\pi / \\pi^{-1}', '\\pi^2'], // "_x" / "_x"^("_n") -> 1 / "_x"^("_n" - 1)
  ['\\pi^{0.2}/\\pi^{0.1}', '\\pi^{0.1}'], // 🙁 pi^(0.1 + 0.2)
  ['x^{\\sqrt{2}}/x^3', 'x^{\\sqrt{2}-3}'], // 🙁 x^(sqrt(2)) / x^3

  [
    `
  //
  // Powers and Denominators
  //
`,
  ],
  ['x/(\\pi/2)^3', '8x/\\pi^3'],
  ['x/(\\pi/y)^3', 'x/(\\pi/y)^3'],

  [
    `
  //
  // Powers and Roots
  //
`,
  ],
  ['\\sqrt{x^4}', 'x^2'], // 🙁 sqrt(x^4)
  ['\\sqrt{x^3}', 'x^{3/2}'], // 🙁 sqrt(x^3)
  ['\\sqrt[3]{x^2}', 'x^{2/3}'],
  ['\\sqrt[4]{x^6}', 'x^{3/2}'],
  ['\\sqrt{x^6}', '|x|^3'], // 🙁 sqrt(x^6)
  ['\\sqrt[4]{x^4}', '|x|'], // 🙁 root(x^4)(4)

  [
    `
  //
  // Ln and Powers
  //
`,
  ],
  ['\\ln(x^3)', '3\\ln(x)'],
  ['\\ln(x^\\sqrt{2})', '\\sqrt{2} \\ln(x)'],
  ['\\ln(x^2)', '2 \\ln(|x|)'], // 🙁 ln(x^2)
  ['\\ln(x^{2/3})', '2/3 \\ln(|x|)'], // 🙁 ln(x^(2/3))
  ['\\ln(\\pi^{2/3})', '2/3 \\ln(\\pi)'], // 🙁 ln(pi^(2/3))
  ['\\ln(x^{7/4})', '7/4 \\ln(x)'], // 🙁 ln(x^(7/4))
  ['\\ln(\\sqrt{x})', '\\ln(x)/2'],

  [
    `
  //
  // Log and Powers
  //
`,
  ],
  ['\\log_4(x^3)', '3\\log_4(x)'],
  ['\\log_3(x^\\sqrt{2})', '\\sqrt{2} \\log_3(x)'],
  ['\\log_4(x^2)', '2\\log_4(|x|)'], // 🙁 log(x^2, 4)
  ['\\log_4(x^{2/3})', '2/3 \\log_4(|x|)'], // 🙁 log(x^(2/3), 4)
  ['\\log_4(x^{7/4})', '7/4 \\log_4(x)'], // 🙁 log(x^(7/4), 4)
];

describe('SIMPLIFY', () => {
  console.info('Canonicalization test cases\n\n');
  for (const test of CANONICALIZATION_TEST_CASES) runTestCase(test);

  console.info('\n\nRule test cases\n\n');
  const rules = ce.rules(RULES);
  for (const test of RULE_TEST_CASES) runTestCase(test, rules);
});

describe('SIMPLIFY', () => {
  test(`simplify(1 + 1e999) (expect precision loss)`, () =>
    expect(simplify('1 + 1e999')).toMatchInlineSnapshot(`
      {
        num: "1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"
      }
    `));

  test(`\\frac34 + \\frac12`, () =>
    expect(simplify('\\frac34 + \\frac12')).toMatchInlineSnapshot(
      `["Rational", 5, 4]`
    ));

  test(`\\frac34 + 1e99`, () =>
    expect(simplify('\\frac34 + 1e99')).toMatchInlineSnapshot(`
      [
        "Rational",
        {
          num: "4000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003"
        },
        4
      ]
    `));

  test(`1e149 + 1e150`, () =>
    expect(simplify('1e149 + 1e150')).toMatchInlineSnapshot(
      `{num: "11e+149"}`
    ));
});

describe('RELATIONAL OPERATORS', () => {
  // Simplify common coefficient
  test(`2a < 4b`, () =>
    expect(simplify('2a \\lt 4b')).toMatchInlineSnapshot(
      `["Less", "a", ["Multiply", 2, "b"]]`
    ));

  // Simplify coefficient with a common factor
  test(`2x^2 < 4x^3`, () =>
    expect(simplify('2x^2 \\lt 4x^3')).toMatchInlineSnapshot(`
      [
        "Less",
        ["Divide", ["Square", "x"], ["Abs", "x"]],
        ["Divide", ["Multiply", 2, ["Power", "x", 3]], ["Abs", "x"]]
      ]
    `));

  test(`2a < 4ab`, () =>
    expect(simplify('2a < 4ab')).toMatchInlineSnapshot(`
      [
        "Less",
        ["Divide", "a", ["Abs", "a"]],
        ["Divide", ["Multiply", 2, "a", "b"], ["Abs", "a"]]
      ]
    `));
});

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\');
}

function runTestCase(test: TestCase, rules?: BoxedRuleSet): void {
  if (test.length === 1) {
    // It's a heading
    // It's a heading
    console.info(`\n[\`${test[0]}\`],`);
    return;
  }

  const [input, expected, comment] = test;

  const row = escape(
    `[${typeof input === 'string' ? '"' + input + '"' : exprToString(input)}, ${
      typeof expected === 'string'
        ? '"' + expected + '"'
        : exprToString(expected)
    }${comment ? ', "' + comment + '"' : ''}],`
  );

  if (comment?.startsWith('skip')) {
    console.info(row);
    return;
  }

  const a = typeof input === 'string' ? ce.parse(input) : ce.box(input);
  const b =
    typeof expected === 'string' ? ce.parse(expected) : ce.box(expected);

  let result = tryRules(a, b, rules);
  if (comment?.startsWith('stop')) {
    let a1 = a.simplify({ rules });
    const eq = a1.isSame(b);
    debugger;
    a1 = a.simplify({ rules });
  }

  console.info(result ? `${row} // ${result}` : row);
  // test(row, () => expect(a.simplify().json).toEqual(b.json));
}

function tryRules(
  a: BoxedExpression,
  b: BoxedExpression,
  allRules?: BoxedRuleSet
): string {
  // No rules
  if (a.simplify().isSame(b)) return '';

  if (!allRules) return '';

  // One rule at a time
  let i = 0;
  const ruleCount = allRules.rules.length - 1;
  while (i <= ruleCount) {
    const sa = a.simplify({ rules: [allRules.rules[i]] });
    if (sa.isSame(b)) return ruleName(allRules.rules[i]);
    i += 1;
  }

  // Many rules at a time
  i = 0;
  let rules: BoxedRule[] = [];
  while (i <= ruleCount) {
    const sa = a.simplify({ rules });
    if (sa.isSame(b)) return 'up to ' + ruleName(rules.pop());
    rules.push(allRules.rules[i]);
    i += 1;
  }

  return `🙁 ${a.simplify({ rules }).toString()}`;
}

function ruleName(rule: BoxedRule | undefined): string {
  if (!rule) return '';
  if (rule.id) return rule.id;
  if (typeof rule.replace === 'function') return `function ${rule.toString()}`;
  return 'unknown rule';
}
