import {
  applyRecursively,
  getArg,
  getComplexValue,
  getDictionary,
  getFunctionHead,
  getFunctionName,
  getNumberValue,
  getRationalValue,
  getSymbolName,
  getTail,
  isAtomic,
  MISSING,
  simplifyRational,
} from '../common/utils';
import { Expression } from '../public';
import { ComputeEngine, Rule, Simplification } from './public';
import { isNegative, isNotZero, isPositive, isZero } from './predicates';
import { Substitution } from './patterns';

// A list of simplification rules.
// The rules are expressed as
//    [lhs, rhs, condition]
// where `lhs` is rewritten as `rhs` if `condition` is true
// `lhs` and `rhs` can be either an Expression or a Latex string.
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

export function internalSimplify(
  engine: ComputeEngine,
  expr: Expression | null,
  simplifications?: Simplification[]
): Expression | null {
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
  expr = engine.replace(engine.getRules(simplifications), expr);

  //
  // 2/ Numeric simplifications
  //
  expr = simplifyNumber(engine, expr!) ?? expr;

  //
  // 3/ Simplify assumptions
  //
  // If the expression is a predicate which is an assumption, return `True`
  //
  if (engine.is(expr) === true) return 'True';

  if (isAtomic(expr!)) return expr;

  //
  // 4/ Simplify Dictionary
  //
  if (getDictionary(expr!) !== null) {
    return applyRecursively(
      expr!,
      (x) => engine.simplify(x, { simplifications }) ?? x
    );
  }

  //
  // 5/ It's a function (not a dictionary and not atomic)
  //

  const head = internalSimplify(
    engine,
    getFunctionHead(expr) ?? MISSING,
    simplifications
  );
  if (typeof head === 'string') {
    const def = engine.getFunctionDefinition(head);
    if (def) {
      // Simplify the arguments, except those affected by `hold`
      const args: Expression[] = [];
      const tail = getTail(expr);
      for (let i = 0; i < tail.length; i++) {
        const name = getFunctionName(tail[i]);
        if (name === 'Evaluate') {
          args.push(engine.simplify(tail[i], { simplifications }) ?? tail[i]);
        } else if (name === 'Hold') {
          args.push(getArg(tail[i], 1) ?? MISSING);
        } else if (
          (i === 0 && def.hold === 'first') ||
          (i > 0 && def.hold === 'rest') ||
          def.hold === 'all'
        ) {
          args.push(tail[i]);
        } else {
          args.push(engine.simplify(tail[i], { simplifications }) ?? tail[i]);
        }
      }
      if (typeof def.simplify === 'function') {
        return def.simplify(engine, ...args);
      }
      return [head, ...args];
    }
  }
  if (head !== null) {
    // If we can't identify the function, we don't know how to process
    // the arguments (they may be Hold...), so don't attempt to process them.
    return [head, ...getTail(expr)];
  }
  return expr;
}

function simplifyNumber(engine: ComputeEngine, expr: Expression) {
  //
  // Replace constants by their value
  //
  const symDef = engine.getSymbolDefinition(getSymbolName(expr) ?? '');
  if (symDef && symDef.hold === false && symDef.value) {
    // If hold is false, we can substitute the symbol for its value
    if (typeof symDef.value === 'function') {
      return internalSimplify(engine, symDef.value(engine));
    }
    return internalSimplify(engine, symDef.value);
  }

  //
  // Simplify rationals
  //
  const [numer, denom] = simplifyRational(getRationalValue(expr));
  if (numer !== null && denom !== null) {
    console.assert(denom >= 0);
    if (denom === 1) return numer;
    if (numer === 0 && isFinite(denom)) return 0;
    if (Object.is(denom, -0) && isFinite(numer)) return -Infinity;
    if (denom === 0 && isFinite(numer)) return +Infinity;
    return ['Divide', numer, denom];
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
    if (re === 0) return ['Multiply', arg2, 'ImaginaryUnit'];

    // This may be a non-numerical Complex,
    // i.e. ['Complex', ['Divide', 2, 3], 2]
    return ['Add', re ?? arg1, ['Multiply', im ?? arg2, 'ImaginaryUnit']];
  }

  return expr;
}
