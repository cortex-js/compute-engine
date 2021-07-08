import {
  applyRecursively,
  getArg,
  getComplexValue,
  getDictionary,
  getFunctionHead,
  getFunctionName,
  getNumberValue,
  getRationalValue,
  getStringValue,
  getSymbolName,
  getTail,
  isAtomic,
  MISSING,
} from '../common/utils';
import { Expression, Substitution } from '../math-json/math-json-format';
import {
  ComputeEngine,
  Numeric,
  Rule,
  RuleSet,
  Simplification,
} from '../math-json/compute-engine-interface';
import { isNegative, isNotZero, isPositive, isZero } from './predicates';
import { rules } from './rules';
import { simplifyRational } from './numeric';
import { simplifyBoolean } from './assume';

// A list of simplification rules.
// The rules are expressed as
//    [lhs, rhs, condition]
// where `lhs` is rewritten as `rhs` if `condition` is true
// `lhs` and `rhs` can be either an Expression or a LaTeX string.
// If using an Expression, the expression is *not* canonicalized before being
// used. Therefore in some cases using Expression, while more verbose,
// may be necessary as the expression could be simplified by the canonicalization.
export const SIMPLIFY_RULES: { [topic: string]: Rule[] } = {
  'simplify-arithmetic': [
    // `Subtract`
    ['x - x', 0],
    [['Subtract', '_x', 0], 'x'],
    [['Subtract', 0, '_x'], '-x'],

    // `Add`
    [['Add', '_x', ['Negate', '_x']], 0],

    // `Multiply`
    [
      'x \\times x ',
      'x^2',
      // ['Multiply', '_x', '_x'],
      // ['Square', '_x'],
    ],

    // `Divide`
    [['Divide', '_x', 1], { sym: '_x' }],
    [
      ['Divide', '_x', '_x'],
      1,
      (ce: ComputeEngine, sub: Substitution): boolean =>
        isNotZero(ce, sub.x) ?? false,
    ],
    [
      ['Divide', '_x', 0],
      +Infinity,
      (ce: ComputeEngine, sub: Substitution): boolean =>
        isPositive(ce, sub.x) ?? false,
    ],
    [
      ['Divide', '_x', 0],
      -Infinity,
      (ce: ComputeEngine, sub: Substitution): boolean =>
        isNegative(ce, sub.x) ?? false,
    ],
    [['Divide', 0, 0], NaN],

    // `Power`
    [['Power', '_x', 'Half'], ['\\sqrt{x}']],
    [['Power', '_x', ['Divide', 1, 2]], ['\\sqrt{x}']],
    [
      ['Power', '_x', 2],
      ['Square', '_x'],
    ],

    // Complex
    [
      ['Divide', ['Complex', '_re', '_im'], '_x'],
      ['Add', ['Divide', ['Complex', 0, '_im'], '_x'], ['Divide', '_re', '_x']],
      (ce: ComputeEngine, sub: Substitution): boolean =>
        (ce.isNotZero(sub.re) ?? false) &&
        (ce.isInteger(sub.re) ?? false) &&
        (ce.isInteger(sub.im) ?? false),
    ],

    // `Abs`
    [
      ['Abs', '_x'],
      { sym: '_x' },
      (ce: ComputeEngine, sub: Substitution): boolean =>
        (isZero(ce, sub.x) ?? false) || (isPositive(ce, sub.x) ?? false),
    ],
    [
      ['Abs', '_x'],
      ['Negate', '_x'],
      (ce: ComputeEngine, sub: Substitution): boolean =>
        isNegative(ce, sub.x) ?? false,
    ],
  ],
};

export function internalSimplify<T extends number = Numeric>(
  ce: ComputeEngine<T>,
  expr: Expression<T> | null,
  simplifications?: Simplification[]
): Expression<T> | null {
  if (expr === null) return null;

  //
  // 1/ Apply simplification rules
  //
  simplifications = simplifications ?? ['simplify-all'];
  if (simplifications.length === 1 && simplifications[0] === 'simplify-all') {
    simplifications = [
      'simplify-arithmetic',
      // 'simplify-logarithmic',
      // 'simplify-trigonometric',
    ];
  }
  for (const simplification of simplifications) {
    expr = ce.replace(
      expr,
      ce.cache<RuleSet>(
        simplification,
        (): RuleSet => rules(ce, SIMPLIFY_RULES[simplification])
      )
    );
  }

  //
  // 2/ Numeric simplifications
  //
  expr = simplifyNumber(ce, expr!) ?? expr;

  //
  // 3/ Simplify boolean expressions, using assumptions.
  //
  //
  expr = simplifyBoolean(ce, expr);

  if (isAtomic(expr!)) return expr;

  //
  // 4/ Simplify Dictionary
  //
  if (getDictionary(expr!) !== null) {
    return applyRecursively(
      expr!,
      (x) => internalSimplify(ce, x, simplifications) ?? x
    );
  }

  //
  // 5/ It's a function (not a dictionary and not atomic)
  //

  const head = internalSimplify(
    ce,
    getFunctionHead(expr) ?? MISSING,
    simplifications
  );
  if (typeof head === 'string') {
    const def = ce.getFunctionDefinition(head);
    if (def) {
      // Simplify the arguments, except those affected by `hold`
      const args: Expression<T>[] = [];
      const tail = getTail(expr);
      for (let i = 0; i < tail.length; i++) {
        const name = getFunctionName(tail[i]);
        if (name === 'Evaluate') {
          args.push(internalSimplify(ce, tail[i], simplifications) ?? tail[i]);
        } else if (name === 'Hold') {
          args.push(getArg(tail[i], 1) ?? MISSING);
        } else if (
          (i === 0 && def.hold === 'first') ||
          (i > 0 && def.hold === 'rest') ||
          def.hold === 'all'
        ) {
          args.push(tail[i]);
        } else {
          args.push(internalSimplify(ce, tail[i], simplifications) ?? tail[i]);
        }
      }
      const result =
        typeof def.simplify === 'function'
          ? def.simplify(ce, ...args) ?? expr
          : [head, ...args];
      return ce.cost(result) <= ce.cost(expr) ? result : expr;
    }
  }
  if (head !== null) {
    // If we can't identify the function, we don't know how to process
    // the arguments (they may be Hold...), so don't attempt to process them.
    return [head, ...getTail(expr)];
  }
  return expr;
}

function simplifyNumber<T extends number = Numeric>(
  engine: ComputeEngine<T>,
  expr: Expression<T>
): Expression<T> | null {
  //
  // Replace constants by their value
  //
  const symDef = engine.getSymbolDefinition(getSymbolName(expr) ?? '');
  if (symDef && symDef.value && symDef.hold === false) {
    // If hold is false, we can substitute the symbol for its value
    if (typeof symDef.value === 'function') return symDef.value(engine);
    return symDef.value;
  }

  //
  // Simplify rationals
  //
  const [numer, denom] = simplifyRational(getRationalValue(expr));
  if (numer !== null && denom !== null) {
    console.assert(denom >= 0);
    if (denom === 1) return numer as T;
    if (numer === 0 && isFinite(denom)) return 0 as T;
    if (Object.is(denom, -0) && isFinite(numer)) return -Infinity as T;
    if (denom === 0 && isFinite(numer)) return +Infinity as T;
    return ['Divide', numer, denom] as Expression<T>;
  }

  // @todo could simplify Decimal rationals as well

  //
  // Simplify complex numbers
  //
  const c = getComplexValue(expr);
  if (c !== null) {
    if (c.im === 0) return c.re;
    return ['Complex', c.re, c.im];
  }
  if (getFunctionName(expr) === 'Complex') {
    const arg1 = getArg(expr, 1);
    const arg2 = getArg(expr, 2);

    const im = getNumberValue(arg2);
    if (im === 0) return arg1;

    const re = getNumberValue(arg1);
    if (re === 0) return ['Multiply', arg2, 'ImaginaryUnit'] as Expression<T>;

    // This may be a non-numerical Complex,
    // i.e. ['Complex', ['Divide', 2, 3], 2]
    return [
      'Add',
      re ?? arg1,
      ['Multiply', im ?? arg2, 'ImaginaryUnit'],
    ] as Expression<T>;
  }

  return expr;
}

export function costFunction(expr: Expression): number {
  const numValue = getNumberValue(expr);
  if (numValue !== null) return numValue.toString().length;

  const strValue = getStringValue(expr);
  if (strValue) return strValue.length;

  const sym = getSymbolName(expr);
  if (sym) return sym.length;

  const head = getFunctionName(expr);

  if (head) {
    if (['Add', 'Multiply', 'Divide'].includes(head)) return 100;
    if (['Negate', 'Subtract'].includes(head)) return 110;
    if (['Sqrt', 'Root'].includes(head)) return 120;
    if (['Power', 'Ln'].includes(head)) return 130;
    if (['Tan'].includes(head)) return 140;
    if (['Sin', 'Cos'].includes(head)) return 150;
    if (['Arcsin', 'Arccos', 'Arctan'].includes(head)) return 160;
  }

  if (getFunctionHead(expr)) {
    return getTail(expr).reduce<number>((acc, x) => acc + costFunction(x), 200);
  }

  const dict = getDictionary(expr);
  if (dict) {
    return Object.values(dict).reduce<number>(
      (acc, x) => acc + costFunction(x),
      200
    );
  }

  return 1_000_000;
}

export const DEFAULT_COST_FUNCTION = costFunction;
