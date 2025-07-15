import { Complex } from 'complex-esm';
import { Decimal } from 'decimal.js';

import type { Expression } from '../../math-json/types';
import type { LatexString } from '../latex-syntax/types';

import { apply } from './apply'; // @fixme

import { canonicalAngle } from './utils';

import type {
  BoxedExpression,
  ComputeEngine,
  RuleStep,
  Sign,
} from '../global-types';
import { asLatexString } from '../latex-syntax/utils';

type ConstructibleTrigValues = [
  [numerator: number, denominator: number],
  { [operator: string]: BoxedExpression },
][];

export function Fu(exp: BoxedExpression): RuleStep | undefined {
  const ce = exp.engine;

  // const rationalTrigOps=['Sin','Cos','Tan','Cot','Sec','Csc','Power','Add','Negate','Multiply','Divide'];
  // function isTrigRational(exp:BoxedExpression){ //Is a rational function of trig functions
  //   return exp.ops!.every(x => rationalTrigOps.includes(x.operator))
  // }

  //Number of monomials that are trig functions (including all numerators and denominators); might need to expand first?
  const cost = (exp: BoxedExpression) => {
    if (exp.operator === 'Add' || exp.operator === 'Divide')
      return exp.ops!.reduce((sum, x) => sum + cost(x), 0);
    if (['Sin', 'Cos', 'Tan', 'Cot', 'Sec', 'Csc'].includes(exp.operator))
      return 1;
    return 0;
  };

  const hasOp = (exp: BoxedExpression, ...ops: string[]) => {
    if (!exp.ops) return false;
    return (
      ops.includes(exp.operator) ||
      exp.subexpressions.some((x) => ops.includes(x.operator))
    );
  };

  const TR1 = ['\\sec x -> 1/(\\cos x)', '\\csc x -> 1/(\\sin x)'];
  const TR2 = [
    '\\tan x -> \\sin(x)/(\\cos x)',
    '\\cot x -> \\cos(x)/(\\sin x)',
  ];
  const TR5 = ['\\sin^2(x) -> 1-\\cos^2(x)'];
  const TR6 = ['\\cos^2(x) -> 1-\\sin^2(x)'];
  const TR7 = ['\\cos^2(x) -> (1+\\cos(2x))/2'];
  const TR8 = [
    '\\sin(x)\\cos(y) -> 1/2*(\\sin(x+y)+\\sin(x-y))',
    '\\cos(x)\\cos(y) -> 1/2*(\\cos(x+y)+\\cos(x-y))',
    '\\sin(x)\\sin(y) -> 1/2*(\\cos(x+y)-\\cos(x-y))',
  ];
  const TR9 = [
    '\\sin(x)+\\sin(y) -> 2\\sin((x+y)/2)\\cos((x-y)/2)',
    '\\sin(x)-\\sin(y) -> 2\\sin((x+y)/2)\\sin((x-y)/2)',
    '\\cos(x)+\\cos(y) -> 2\\sin((x+y)/2)\\sin((x-y)/2)',
    '\\cos(x)-\\cos(y) -> -2\\sin((x+y)/2)\\sin((x-y)/2)',
  ];
  const TR10 = [
    '\\sin(x+y) -> \\sin(x)\\cos(y)+\\cos(x)\\sin(y)',
    '\\sin(x-y) -> \\sin(x)\\cos(y)-\\cos(x)\\sin(y)',
    '\\cos(x+y) -> \\cos(x)\\cos(y)-\\sin(x)\\sin(y)',
    '\\cos(x-y) -> \\cos(x)\\cos(y)+\\sin(x)\\sin(y)',
  ];
  const TR10Inverse = [
    '\\sin(x)\\cos(y)+\\cos(x)\\sin(y) -> \\sin(x+y)',
    '\\sin(x)\\cos(y)-\\cos(x)\\sin(y) -> \\sin(x-y)',
    '\\cos(x)\\cos(y)-\\sin(x)\\sin(y) -> \\cos(x+y)',
    '\\cos(x)\\cos(y)+\\sin(x)\\sin(y) -> \\cos(x-y)',
  ];
  const TR11 = [
    '\\sin(2x) -> 2\\sin(x)\\cos(x)',
    '\\cos(2x) -> 2\\cos^2(x) - 1',
  ];
  const TR12 = [
    '\\tan(x+y) -> (\\tan(x)+\\tan(y))/(1-\\tan(x)\\tan(y))',
    '\\tan(x-y) -> (\\tan(x)-\\tan(y))/(1+\\tan(x)\\tan(y))',
  ];
  const TR13 = [
    '\\tan(x)*\\tan(y) -> 1-(\\tan(x)+\\tan(y))\\cdot \\cot(x+y)',
    '\\cot(x)*\\cot(y) -> 1+(\\cot(x)+\\cot(y))\\cdot \\cot(x+y)',
  ];

  const applyTR = (exp: BoxedExpression, ...ruless: string[][]) => {
    for (const rules of ruless) {
      exp = exp.simplify();
      const savedCostFunction = ce.costFunction;
      ce.costFunction = () => 0;
      exp = exp.simplify({ rules: rules });
      ce.costFunction = savedCostFunction;
      return exp.simplify();
    }
    return exp;
  };

  function bestCase(...cases: BoxedExpression[]): BoxedExpression {
    const costs = cases.map(cost);
    let bestI = 0;
    for (let i = 1; i < cases.length; i++) {
      if (costs[bestI] < costs[i]) {
        bestI = i;
      }
    }
    return cases[bestI];
  }

  const CTR1 = (exp: BoxedExpression) =>
    bestCase(exp, applyTR(exp, TR5), applyTR(exp, TR6));
  //Factor out TR11 since it applies in all cases
  const CTR2 = (exp: BoxedExpression) =>
    bestCase(exp, applyTR(exp, TR5), applyTR(exp, TR6));
  const CTR3 = (exp: BoxedExpression) => {
    const exps = [exp, applyTR(exp, TR8), applyTR(exp, TR8, TR10Inverse)];
    if (cost(exps[2]) < cost(exps[0])) return exps[2];
    if (cost(exps[1]) < cost(exps[0])) return exps[1];
    return exp;
  };
  const CTR4 = (exp: BoxedExpression) =>
    bestCase(exp, applyTR(exp, TR10Inverse));

  const applyCTR = (exp: BoxedExpression, CTR: Function) => CTR(exp).simplify();

  const RL1 = (exp: BoxedExpression) => {
    return applyTR(exp, TR12, TR13);
  };

  const RL2 = (exp: BoxedExpression) => {
    console.info(applyTR(exp, TR11).toString());
    exp = applyTR(exp, TR10, TR11, TR5, TR7, TR11);
    exp = applyCTR(exp, CTR3);
    exp = applyCTR(exp, CTR1);
    exp = applyTR(exp, TR9);
    exp = applyCTR(exp, CTR2);
    exp = applyTR(exp, TR9);
    return applyCTR(exp, CTR4);
  };
  if (!hasOp(exp, 'Sin', 'Cos', 'Tan', 'Cot', 'Sec', 'Csc')) {
    return undefined;
  }
  let answer = exp;

  if (hasOp(answer, 'Sec', 'Csc')) {
    //exp contains sec, csc
    answer = applyTR(answer, TR1);
  }
  if (hasOp(answer, 'Tan', 'Cot')) {
    //exp contains tan, cot
    answer = RL1(answer);
  }
  if (hasOp(answer, 'Tan', 'Cot')) {
    //exp contains tan, cot
    answer = applyTR(answer, TR2);
  }
  if (hasOp(answer, 'Sin', 'Cos')) {
    //exp contains sin, cos
    answer = RL2(answer);
  }
  if (answer === exp) return undefined;
  return { value: answer, because: 'Fu' };
}

// For each trig function, by quadrant (0..π/2, π/2..π, π..3π/2, 3π/2..2π),
// what is the corresponding identity (sign and function)
// E.g 'Sin[θ+π/2] = Cos[θ]` -> Quadrant 2, Positive sign, Cos
const TRIG_IDENTITIES: { [key: string]: [sign: number, name: string][] } = {
  Sin: [
    [+1, 'Sin'],
    [+1, 'Cos'],
    [-1, 'Sin'],
    [-1, 'Cos'],
  ],
  Cos: [
    [+1, 'Cos'],
    [-1, 'Sin'],
    [-1, 'Cos'],
    [+1, 'Sin'],
  ],
  Sec: [
    [+1, 'Sec'],
    [-1, 'Csc'],
    [-1, 'Sec'],
    [+1, 'Csc'],
  ],
  Csc: [
    [+1, 'Csc'],
    [+1, 'Sec'],
    [-1, 'Csc'],
    [-1, 'Sec'],
  ],
  Tan: [
    [+1, 'Tan'],
    [-1, 'Cot'],
    [+1, 'Tan'],
    [-1, 'Cot'],
  ],
  Cot: [
    [+1, 'Cot'],
    [-1, 'Tan'],
    [+1, 'Cot'],
    [-1, 'Tan'],
  ],
};

const S2: Expression = ['Sqrt', 2];
const S3: Expression = ['Sqrt', 3];
const S5: Expression = ['Sqrt', 5];
const S6: Expression = ['Sqrt', 6];
// From https://en.wikipedia.org/wiki/Trigonometric_functions
// and https://en.wikipedia.org/wiki/Exact_trigonometric_values

// The key is the argument in radian, as (num * π / den)
const CONSTRUCTIBLE_VALUES: [
  key: [numerator: number, denominator: number],
  values: { [name: string]: Expression | LatexString },
][] = [
  [
    [0, 1],
    {
      Sin: 0,
      Cos: 1,
      Tan: 0,
      Cot: 'ComplexInfinity',
      Sec: 1,
      Csc: 'ComplexInfinity',
    },
  ],
  [
    [1, 12],
    {
      Sin: ['Divide', ['Subtract', S6, S2], 4],
      Cos: ['Divide', ['Add', S6, S2], 4],
      Tan: ['Subtract', 2, S3],
      Cot: ['Add', 2, S3],
      Sec: ['Subtract', S6, S2],
      Csc: ['Add', S6, S2],
    },
  ],
  [
    [1, 10],
    {
      Sin: ['Divide', ['Subtract', S5, 1], 4],
      Cos: ['Divide', ['Sqrt', ['Add', 10, ['Multiply', 2, S5]]], 4],
      Tan: ['Divide', ['Sqrt', ['Subtract', 25, ['Multiply', 10, S5]]], 5],
      Cot: ['Sqrt', ['Add', 5, ['Multiply', 2, S5]]],
      Sec: ['Divide', ['Sqrt', ['Subtract', 50, ['Multiply', 10, S5]]], 5],
      Csc: ['Add', 1, S5],
    },
  ],
  [
    [1, 8],
    {
      Sin: '$\\frac{\\sqrt{2-\\sqrt2}}{2}$',
      Cos: '$\\frac{\\sqrt {2+{\\sqrt {2}}}}{2}$',
      Tan: '$\\sqrt{2} - 1$',
      Cot: '$\\sqrt{2} + 1$',
      Sec: '$\\sqrt{ 4 - 2\\sqrt{2}}$',
      Csc: '$\\sqrt{ 4 + 2\\sqrt{2}}$',
    },
  ],
  [
    [1, 6],
    {
      Sin: '$\\frac{1}{2}$',
      Cos: '$\\frac{\\sqrt{3}}{2}$',
      Tan: '$\\frac{\\sqrt{3}}{3}$',
      Cot: '$\\sqrt{3}$',
      Sec: '$\\frac{2\\sqrt{3}}{3}$',
      Csc: 2,
    },
  ],
  [
    [1, 5],
    {
      Sin: '$\\frac{\\sqrt{10- 2\\sqrt{5}}} {4}$',
      Cos: '$\\frac{1+ \\sqrt{5}} {4}$',
      Tan: '$\\sqrt{5-2\\sqrt5}$',
      Cot: '$\\frac{\\sqrt{25+10\\sqrt5}} {5}$',
      Sec: '$\\sqrt{5} - 1$',
      Csc: '$\\frac{\\sqrt{50+10\\sqrt{5}}} {5}$',
    },
  ],
  [
    [1, 4],
    {
      Sin: ['Divide', S2, 2],
      Cos: ['Divide', S2, 2],
      Tan: 1,
      Cot: 1,
      Sec: S2,
      Csc: S2,
    },
  ],

  [
    [3, 10],
    {
      Sin: '$\\frac{1+ \\sqrt5} {4}$',
      Cos: '$\\frac{\\sqrt{10- 2\\sqrt5}} {4}$',
      Tan: '$\\frac{\\sqrt{25+10\\sqrt5}} {5}$',
      Cot: '$\\sqrt{5-2\\sqrt5}$',
      Sec: '$\\frac{\\sqrt{50+10\\sqrt5}} {5}$',
      Csc: '$\\sqrt5-1$',
    },
  ],
  [
    [1, 3],
    {
      Sin: ['Divide', S3, 2], // '$\\frac{\\sqrt{3}}{2}$'
      Cos: 'Half', // '$\\frac{1}{2}$'
      Tan: S3, // '$\\sqrt{3}$'
      Cot: ['Divide', S3, 3], // '$\\frac{\\sqrt{3}}{3}$'
      Sec: 2,
      Csc: ['Divide', ['Multiply', 2, S3], 3], // '$\\frac{2\\sqrt{3}}{3}$'
    },
  ],
  [
    [3, 8],
    {
      Sin: '$\\frac{ \\sqrt{2 + \\sqrt{2}} } {2}$',
      Cos: '$\\frac{ \\sqrt{2 - \\sqrt{2}} } {2}$',
      Tan: '$\\sqrt{2} + 1$',
      Cot: '$\\sqrt{2} - 1$',
      Sec: '$\\sqrt{ 4 + 2 \\sqrt{2} }$',
      Csc: '$\\sqrt{ 4 - 2 \\sqrt{2} }$',
    },
  ],
  [
    [2, 5],
    {
      Sin: '$\\frac{\\sqrt{10+ 2\\sqrt{5}}} {4}$',
      Cos: '$\\frac{\\sqrt{5}-1} {4}$',
      Tan: '$\\sqrt{5+2\\sqrt{5}}$',
      Cot: '$\\frac{\\sqrt{25-10\\sqrt{5}}} {5}$',
      Sec: '$1 + \\sqrt{5}$',
      Csc: '$\\frac{\\sqrt{50-10\\sqrt{5}}} {5}$',
    },
  ],
  [
    [5, 12],
    {
      Sin: '$\\frac{\\sqrt{6} + \\sqrt{2}} {4}$',
      Cos: '$\\frac{ \\sqrt{6} - \\sqrt{2}} {4}$',
      Tan: '$2+\\sqrt{3}$',
      Cot: '$2-\\sqrt{3}$',
      Sec: '$\\sqrt{6}+\\sqrt{2}$',
      Csc: '$\\sqrt{6} - \\sqrt{2}$',
    },
  ],
  [
    [1, 2],
    {
      Sin: 1,
      Cos: 0,
      Tan: 'ComplexInfinity',
      Cot: 0,
      Sec: 'ComplexInfinity',
      Csc: 1,
    },
  ],
];

function applyAngle(
  angle: BoxedExpression,
  fn: (x: number) => number | Complex,
  bigFn?: (x: Decimal) => Decimal | Complex | number,
  complexFn?: (x: Complex) => number | Complex
): BoxedExpression | undefined {
  const theta = canonicalAngle(angle)?.N();
  if (theta === undefined) return undefined;
  return apply(theta, fn, bigFn, complexFn);
}

/** Assuming x in an expression in radians, convert to current angular unit. */
export function radiansToAngle(
  x: BoxedExpression | undefined
): BoxedExpression | undefined {
  if (!x) return x;
  const ce = x.engine;
  const angularUnit = ce.angularUnit;
  if (angularUnit === 'rad') return x;

  const theta = x.N().re;
  if (Number.isNaN(theta)) return x;
  if (angularUnit === 'deg') return ce.number(theta * (180 / Math.PI));
  if (angularUnit === 'grad') return ce.number(theta * (200 / Math.PI));
  if (angularUnit === 'turn') return ce.number(theta / (2 * Math.PI));
  return x;
}

export function evalTrig(
  name: string,
  op: BoxedExpression | undefined
): BoxedExpression | undefined {
  if (!op) return undefined;
  const ce = op.engine;

  switch (name) {
    case 'Arccos':
      return radiansToAngle(
        apply(
          op,
          Math.acos,
          (x) => x.acos(),
          (x) => x.acos()
        )
      );
    case 'Arccot':
      return radiansToAngle(
        apply(
          op,
          (x) => Math.atan2(1, x),
          (x) => Decimal.atan2(ce._BIGNUM_ONE, x),
          (x) => x.inverse().atan()
        )
      );
    case 'Arccsc':
      return radiansToAngle(
        apply(
          op,
          (x) => Math.asin(1 / x),
          (x) => ce._BIGNUM_ONE.div(x).asin(),
          (x) => x.inverse().asin()
        )
      );
    case 'Arccosh':
      return radiansToAngle(
        apply(
          op,
          Math.acosh,
          (x) => x.acosh(),
          (x) => x.acosh()
        )
      );
    case 'Arccoth':
      // ln[(1 + x) /(x − 1)] /2
      return radiansToAngle(
        apply(
          op,
          (x) => Math.log((1 + x) / (x - 1)) / 2,
          (x) => ce._BIGNUM_ONE.add(x).div(x.sub(ce._BIGNUM_ONE)).log().div(2),
          (x) => ce.complex(1).add(x).div(x.sub(1)).log().div(2)
        )
      );

    case 'Arccsch':
      // ln[1/x + √(1/x2 + 1)],
      return radiansToAngle(
        apply(
          op,
          (x) => Math.log(1 / x + Math.sqrt(1 / (x * x) + 1)),
          (x) =>
            ce._BIGNUM_ONE
              .div(x.mul(x))
              .add(ce._BIGNUM_ONE)
              .sqrt()
              .add(ce._BIGNUM_ONE.div(x))
              .log(),
          (x) => x.mul(x).inverse().add(1).sqrt().add(x.inverse()).log()
        )
      );

    case 'Arcsec':
      return radiansToAngle(
        apply(
          op,
          (x) => Math.acos(1 / x),
          (x) => ce._BIGNUM_ONE.div(x).acos(),
          (x) => x.inverse().acos()
        )
      );

    case 'Arcsin':
      return radiansToAngle(
        apply(
          op,
          Math.asin,
          (x) => x.asin(),
          (x) => x.asin()
        )
      );

    case 'Arcsech':
      return radiansToAngle(
        apply(
          op,
          (x) => Math.log((1 + Math.sqrt(1 - x * x)) / x),
          (x) => ce._BIGNUM_ONE.sub(x.mul(x).add(ce._BIGNUM_ONE).div(x)).log(),
          (x) => ce.complex(1).sub(x.mul(x)).add(1).div(x).log()
        )
      );

    case 'Arcsinh':
      return radiansToAngle(
        apply(
          op,
          Math.asinh,
          (x) => x.asinh(),
          (x) => x.asinh()
        )
      );

    case 'Arctan':
      return radiansToAngle(
        apply(
          op,
          Math.atan,
          (x) => x.atan(),
          (x) => x.atan()
        )
      );

    case 'Arctanh':
      return radiansToAngle(
        apply(
          op,
          Math.atanh,
          (x) => x.atanh(),
          (x) => x.atanh()
        )
      );

    case 'Cos':
      return applyAngle(
        op,
        Math.cos,
        (x) => ce.chop(x.cos()),
        (x) => x.cos()
      );

    case 'Cosh':
      return applyAngle(
        op,
        Math.cosh,
        (x) => x.cosh(),
        (x) => x.cosh()
      );

    case 'Cot':
      return applyAngle(
        op,
        (x) => 1 / Math.tan(x),
        (x) => ce._BIGNUM_ONE.div(x.tan()),
        (x) => x.tan().inverse()
      );
    case 'Coth':
      return applyAngle(
        op,
        (x) => 1 / Math.tanh(x),
        (x) => ce._BIGNUM_ONE.div(x.tanh()),
        (x) => x.tanh().inverse()
      );
    case 'Csc':
      return applyAngle(
        op,
        (x) => 1 / Math.sin(x),
        (x) => ce._BIGNUM_ONE.div(x.sin()),
        (x) => x.sin().inverse()
      );
    case 'Csch':
      return applyAngle(
        op,
        (x) => 1 / Math.sinh(x),
        (x) => ce._BIGNUM_ONE.div(x.sinh()),
        (x) => x.sinh().inverse()
      );
    case 'Sec':
      return applyAngle(
        op,
        (x) => 1 / Math.cos(x),
        (x) => ce._BIGNUM_ONE.div(x.cos()),
        (x) => x.cos().inverse()
      );
    case 'Sech':
      return applyAngle(
        op,
        (x) => 1 / Math.cosh(x),
        (x) => ce._BIGNUM_ONE.div(x.cosh()),
        (x) => x.cosh().inverse()
      );
    case 'Sin':
      return applyAngle(
        op,
        Math.sin,
        (x) => ce.chop(x.sin()),
        (x) => x.sin()
      );
    case 'Sinh':
      return applyAngle(
        op,
        Math.sinh,
        (x) => x.sinh(),
        (x) => x.sinh()
      );
    case 'Tan': {
      const result = applyAngle(
        op,
        (x) => {
          const y = Math.tan(x);
          if (y > 1e6 || y < -1e6) return ce.ComplexInfinity;
          return y;
        },

        (x) => {
          const y = x.tan();
          if (y.greaterThan(1e6) || y.lessThan(-1e6)) return ce.ComplexInfinity;
          return y;
        },
        (x) => x.tan()
      );

      return result;
    }
    case 'Tanh':
      return applyAngle(
        op,
        Math.tanh,
        (x) => x.tanh(),
        (x) => x.tanh()
      );
  }
  return undefined;
}

function isInverseTrigFunc(name: string): boolean {
  if (name.startsWith('Ar') && inverseTrigFuncName(name)) return true;
  return false;
}

function inverseTrigFuncName(name: string): string | undefined {
  return {
    Sin: 'Arcsin',
    Cos: 'Arccos',
    Tan: 'Arctan',
    Sec: 'Arcsec',
    Csc: ' Arccsc',
    Sinh: 'Arcsinh',
    Cosh: 'Arccosh',
    Tanh: 'Arctanh',
    Sech: 'Arcsech',
    Csch: 'Arccsch',
    Arccosh: 'Cosh',
    Arccos: 'Cos',
    Arccsc: 'Csc',
    Arccsch: 'Csch',
    // '??': 'Cot',
    // '??': 'Coth',
    Arcsec: 'Sec',
    Arcsin: 'Sin',
    Arcsinh: 'Sinh',
    Arctan: 'Tan',
    Arctanh: 'Tanh',
  }[name];
}

export function processInverseFunction(
  ce: ComputeEngine,
  xs: ReadonlyArray<BoxedExpression>
): BoxedExpression | undefined {
  if (xs.length !== 1 || !xs[0].isValid) return undefined;
  const expr = xs[0];
  if (expr.operator === 'InverseFunction') return expr.op1.canonical;

  const name = expr.symbol;
  if (typeof name !== 'string') return undefined;

  const newHead = inverseTrigFuncName(name);
  return newHead ? ce.symbol(newHead) : undefined;
}

function trigFuncParity(name: string): number {
  // Cos and Sec are even functions, the others are odd
  return name !== 'Cos' && name !== 'Sec' ? -1 : 1;
}

function constructibleValuesInverse(
  ce: ComputeEngine,
  operator: string,
  x: BoxedExpression | undefined,
  specialValues: ConstructibleTrigValues
): undefined | BoxedExpression {
  if (!x) return undefined;
  let x_N = x.N().re;
  if (Number.isNaN(x_N)) return undefined;
  // operator is arcFn, and inv_operator is Fn
  const inv_operator = inverseTrigFuncName(operator);

  //
  // Create the cache of special values of the operator function by inverting
  // specialValues of inv_operator function
  //
  type ConstructibleTrigValuesInverse = [
    [match_arg: BoxedExpression, match_arg_N: number],
    angle: [numerator: number, denominator: number],
  ][];
  const specialInverseValues = ce._cache<ConstructibleTrigValuesInverse>(
    'constructible-inverse-trigonometric-values-' + operator,
    () => {
      const cache: ConstructibleTrigValuesInverse = [];
      for (const [[n, d], value] of specialValues) {
        const r = value[inv_operator!];
        if (r === undefined) continue;
        const rn = r.N().re;
        if (Number.isNaN(rn)) continue;
        cache.push([
          [r, rn],
          [n, d],
        ]);
      }
      return cache;
    },

    (cache: ConstructibleTrigValuesInverse) => {
      for (const [[match_arg, match_arg_N], [n, d]] of cache) {
        match_arg.reset();
      }
      return cache;
    }
  );

  // Odd-even identities

  let quadrant = 0;
  if (x_N < 0) {
    quadrant = trigFuncParity(inv_operator!) == -1 ? -1 : 1;
    // shift x to quadrant 0 to match the key in specialInverseValues
    x_N = -x_N;
    x = x.neg();
  }

  for (const [[match_arg, match_arg_N], [n, d]] of specialInverseValues) {
    if (ce.chop(x_N - match_arg_N) === 0) {
      // there is an implicit Pi in the numerator
      let theta = ce.Pi.mul(n).div(d);
      if (quadrant == -1) theta = theta.neg();
      else if (quadrant == 1) theta = ce.Pi.sub(theta);

      return theta.evaluate();
    }
  }
  return undefined;
}

export function trigSign(
  operator: string,
  x: BoxedExpression
): Sign | undefined {
  const [q, pos] = quadrant(x);
  if (q === undefined) return undefined;
  if (pos !== undefined) {
    if ((operator === 'Sin' || operator === 'Tan') && (pos === 0 || pos === 2))
      return 'zero';
    if ((operator === 'Cos' || operator === 'Cot') && (pos === 1 || pos === 3))
      return 'zero';
  }
  return {
    Sin: ['positive', 'positive', 'negative', 'negative'],
    Cos: ['positive', 'negative', 'negative', 'positive'],
    Sec: ['positive', 'negative', 'negative', 'positive'],
    Csc: ['positive', 'positive', 'negative', 'negative'],
    Tan: ['positive', 'negative', 'positive', 'negative'],
    Cot: ['positive', 'negative', 'positive', 'negative'],
  }[operator]?.[q] as Sign;
}

export function isConstructible(x: string | BoxedExpression): boolean {
  return ['Sin', 'Cos', 'Tan', 'Csc', 'Sec', 'Cot'].includes(
    typeof x === 'string' ? x : x.operator
  );
}

export function constructibleValues(
  operator: string,
  x: BoxedExpression | undefined
): undefined | BoxedExpression {
  if (!x || !isConstructible(operator)) return undefined;
  const ce = x.engine;

  x = x.N();
  // If the argument has an imaginary part, it's not a constructible value
  if (x.im !== 0) return undefined;

  let theta = x.re;
  if (Number.isNaN(theta)) return undefined;

  //
  // Create the cache of special values
  //
  const specialValues = ce._cache<ConstructibleTrigValues>(
    'constructible-trigonometric-values',
    () => {
      return CONSTRUCTIBLE_VALUES.map(([val, results]) => [
        val,
        Object.fromEntries(
          Object.entries(results).map(([op, r]) => [
            op,
            (ce.parse(asLatexString(r)) ?? ce.box(r)).simplify(),
          ])
        ),
      ]);
    },

    (cache: ConstructibleTrigValues) => {
      for (const [_k, v] of cache) {
        for (const v2 of Object.values(v)) v2.reset();
      }
      return cache;
    }
  );

  if (isInverseTrigFunc(operator))
    return constructibleValuesInverse(ce, operator, x, specialValues);

  const angularUnit = ce.angularUnit;
  if (angularUnit !== 'rad') {
    if (angularUnit === 'deg') theta *= Math.PI / 180;
    if (angularUnit === 'grad') theta *= Math.PI / 200;
    if (angularUnit === 'turn') theta *= 2 * Math.PI;
  }

  // Odd-even identities
  const identitySign = trigFuncParity(operator) == -1 ? Math.sign(theta) : +1;

  theta = Math.abs(theta % (2 * Math.PI));

  const quadrant = Math.floor((theta * 2) / Math.PI); // 0..3

  theta = theta % (Math.PI / 2); // 0..π/2

  // Adjusting for the position in the quadrant
  let sign: number;
  [sign, operator] = TRIG_IDENTITIES[operator]?.[quadrant] ?? [1, operator];

  for (const [[n, d], value] of specialValues) {
    const r = value[operator];
    if (r && Math.abs(theta - (Math.PI * n) / d) <= 1e-12) {
      if (r.symbol === 'ComplexInfinity') return r;
      return identitySign * sign < 0 ? r.neg() : r;
    }
  }
  return undefined;
}

// Return the quadrant of the angle (1..4) and the position on the
// circle 0...4 corresponding to 0, π/2, π, 3π/2, 2π.
function quadrant(
  theta: BoxedExpression
): [number | undefined, number | undefined] {
  // theta = theta.N();
  if (!theta.isValid || !theta.isNumberLiteral) return [undefined, undefined];
  if (theta.im !== 0) return [undefined, undefined];

  // Normalize the angle to the range [0, 2π)
  const t = theta.re;
  if (isNaN(t)) return [undefined, undefined];
  const normalizedTheta = ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  if (Math.abs(normalizedTheta) < 1e-12) return [1, 0];
  if (Math.abs(normalizedTheta - Math.PI / 2) < 1e-12) return [2, 1];
  if (Math.abs(normalizedTheta - Math.PI) < 1e-12) return [3, 2];
  if (Math.abs(normalizedTheta - (3 * Math.PI) / 2) < 1e-12) return [4, 3];

  // Use Math.floor to determine the quadrant
  return [Math.floor(normalizedTheta / (Math.PI / 2)) + 1, undefined];
}
