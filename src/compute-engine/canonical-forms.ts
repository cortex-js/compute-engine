import { Expression } from '../public';
import { Form, ComputeEngine } from './public';
import {
  isAtomic,
  isNumberObject,
  isFunctionObject,
  isSymbolObject,
  getNumberValue,
  getFunctionName,
  getTail,
  getArg,
  getArgCount,
  getFunctionHead,
  POWER,
  DIVIDE,
  MULTIPLY,
  NEGATE,
  ADD,
  EXP,
  EXPONENTIAL_E,
  LIST,
  IDENTITY,
  SQRT,
  ROOT,
  SUBTRACT,
  NOTHING,
  SEQUENCE,
  SEQUENCE2,
  MISSING,
  applyRecursively,
  getSymbolName,
  getRationalValue,
} from '../common/utils';
import { canonicalOrder } from './order';
import { canonicalDomainForm } from './dictionary/domains';
import {
  applyConstants,
  applyNegate,
  applyPower,
  ungroup,
} from './dictionary/arithmetic';
import { Decimal } from 'decimal.js';
import { Complex } from 'complex.js';

/**
 * Return an expression that's the inverse (1/x) of the input
 *
 */

function applyInvert(expr: Expression): Expression {
  expr = ungroup(expr);
  if (isAtomic(expr)) return [DIVIDE, 1, expr];
  const head = getFunctionHead(expr);
  if (head === POWER && getArgCount(expr!) === 2) {
    return [POWER, getArg(expr, 1)!, applyNegate(getArg(expr, 2)!)];
  }
  if (head === DIVIDE && getArgCount(expr!) === 2) {
    return [DIVIDE, getArg(expr, 2)!, getArg(expr, 1)!];
  }
  return [DIVIDE, 1, expr];
}

/** Recursively flatten an expression with the head `head`, i.e.
 * `f(x, f(y)) -> f(x, y)`
 */
function flatten(expr: Expression, head: string): Expression {
  if (isAtomic(expr)) return expr;

  if (getFunctionName(expr) !== head) {
    return applyRecursively(expr, (x) => flatten(x, head));
  }

  const args = getTail(expr);
  let result: Expression[] = [head];
  for (let i = 0; i < args.length; i++) {
    if (getFunctionName(args[i]) === head) {
      // [f, a, [f, b, c]] -> [f, a, b, c]
      // or [f, f[a]] -> f[a]
      result = result.concat(getTail(flatten(args[i], head)));
    } else {
      result.push(flatten(args[i], head));
    }
  }
  return result;
}

function flattenInvolution(
  expr: Expression,
  engine: ComputeEngine
): Expression {
  if (isAtomic(expr)) return expr;

  const name = getFunctionName(expr);
  const def = engine.getFunctionDefinition(name);
  if (def?.involution) {
    const args = getTail(expr);
    if (args.length === 1 && getFunctionName(args[0]) === name) {
      return flatten(args[0], name);
    }
  }
  return applyRecursively(expr, (x) => flattenInvolution(x, engine));
}

function flattenIdempotent(
  expr: Expression,
  engine: ComputeEngine
): Expression {
  if (isAtomic(expr)) return expr;

  const name = getFunctionName(expr);
  const def = engine.getFunctionDefinition(name);
  if (def?.idempotent) return flatten(expr, name);

  return applyRecursively(expr, (x) => flattenIdempotent(x, engine));
}

function flattenAssociative(
  expr: Expression,
  engine: ComputeEngine
): Expression {
  if (isAtomic(expr)) return expr;

  const name = getFunctionName(expr);
  const def = engine.getFunctionDefinition(name);
  if (def?.associative) return flatten(expr, name);

  return applyRecursively(expr, (x) => flattenAssociative(x, engine));
}

function canonicalAddForm(expr: Expression, engine: ComputeEngine): Expression {
  if (isAtomic(expr)) return expr;
  if (getFunctionHead(expr) !== ADD) {
    return applyRecursively(expr, (x) => canonicalAddForm(x, engine));
  }
  expr = flatten(ungroup(expr), ADD);
  let args = getTail(expr);
  args = args
    .map((x) => canonicalAddForm(x, engine))
    .filter((x) => getNumberValue(x) !== 0);
  const argCount = args.length;
  if (argCount === 0) return 0;
  if (argCount === 1) return args[0];
  return [ADD, ...args];
}

function canonicalDivideForm(
  expr: Expression,
  engine: ComputeEngine
): Expression {
  if (isAtomic(expr)) return expr;
  if (getFunctionHead(expr) !== DIVIDE) {
    return applyRecursively(expr, (x) => canonicalDivideForm(x, engine));
  }

  if (getArgCount(expr) !== 2) return expr;

  const arg1 = canonicalDivideForm(getArg(expr, 1)!, engine);
  const arg2 = canonicalDivideForm(getArg(expr, 2)!, engine);
  if (getNumberValue(arg2) === 1) return arg1;
  if (getNumberValue(arg1) === 1) return applyInvert(arg2);
  if (getNumberValue(arg1) === -1) return [NEGATE, applyInvert(arg2)];
  return [DIVIDE, arg1, arg2];
}

function canonicalExpForm(expr: Expression, engine: ComputeEngine): Expression {
  if (isAtomic(expr)) return expr;
  if (getFunctionName(expr) === POWER) {
    if (getSymbolName(getArg(expr, 1)) === EXPONENTIAL_E) {
      return [EXP, canonicalExpForm(getArg(expr, 2)!, engine)];
    }
  }
  return applyRecursively(expr, (x) => canonicalExpForm(x, engine));
}

function canonicalListForm(
  expr: Expression,
  engine: ComputeEngine
): Expression {
  if (isAtomic(expr)) return expr;

  const head = getFunctionName(expr);
  if (head !== LIST && head !== SEQUENCE && head !== SEQUENCE2) {
    return applyRecursively(expr, (x) => canonicalListForm(x, engine));
  }

  const args = getTail(expr);
  let result: Expression[] = [getFunctionHead(expr)!];

  if (head === LIST) {
    for (let arg of args) {
      arg = canonicalListForm(arg, engine);
      const name = getFunctionName(arg);
      if (name === IDENTITY) {
        const arg1 = getArg(arg, 1);
        if (arg1 !== null && arg1 !== undefined) {
          result.push(arg1);
        }
      } else {
        result.push(arg);
      }
    }
    return result;
  }

  const def = engine.getFunctionDefinition(head);
  const sequenceHold = def?.sequenceHold ?? false;

  for (let arg of args) {
    arg = canonicalListForm(arg, engine);
    const name = getFunctionName(arg);
    if (name === IDENTITY) {
      const arg1 = getArg(arg, 1);
      if (arg1 !== null && arg1 !== undefined) {
        result.push(arg1);
      }
    } else if (name === head && !sequenceHold) {
      for (let arg2 of getTail(arg)) {
        arg2 = canonicalListForm(arg2, engine);
        if (getFunctionName(arg2) === head) {
          result = result.concat(getTail(arg2));
        } else {
          result.push(arg2);
        }
      }
    } else {
      result.push(arg);
    }
  }

  return result;
}

function getRootDegree(expr: Expression): number {
  const name = getFunctionName(expr);
  if (name === SQRT) return 2;
  if (name === ROOT) return getNumberValue(getArg(expr, 2)) ?? 2;
  if (name !== POWER) return 1;
  const exponent = getArg(expr, 2);
  if (exponent === null) return 1;
  if (
    getFunctionName(exponent) === POWER &&
    getNumberValue(getArg(exponent, 2)) === -1
  ) {
    // x^{n^{-1}}
    const val = getNumberValue(getArg(exponent, 1)) ?? NaN;
    if (isFinite(val)) return val;
  }
  return 1;
}

/**
 * Assuming that `expr` is a `"Multiply"`, return in the first member
 * of the tuples all the arguments that are square roots,
 * and in the second member of the tuples all those that aren't
 */

function getSquareRoots(expr: Expression): [Expression[], Expression[]] {
  console.assert(getFunctionName(expr) === MULTIPLY);
  const args = getTail(expr);
  const roots: Expression[] = [];
  const nonRoots: Expression[] = [];
  for (const arg of args) {
    if (getRootDegree(arg) === 2) {
      roots.push(getArg(arg, 1) ?? MISSING);
    } else {
      nonRoots.push(arg);
    }
  }
  return [roots, nonRoots];
}

function canonicalMultiplyForm(
  expr: Expression,
  engine: ComputeEngine
): Expression {
  if (isAtomic(expr)) return expr;
  if (getFunctionHead(expr) !== MULTIPLY) {
    return applyRecursively(expr, (x) => canonicalMultiplyForm(x, engine));
  }

  expr = flatten(ungroup(expr), MULTIPLY);

  // Group all square roots together
  // \sqrt{2}\sqrt{x}y -> \sqrt{2x}y
  const [squareRoots, nonSquareRoots] = getSquareRoots(expr);
  let args: Expression[];
  if (squareRoots.length === 0) {
    args = nonSquareRoots;
  } else if (squareRoots.length === 1) {
    args = [...nonSquareRoots, [SQRT, squareRoots[0]]];
  } else {
    args = [...nonSquareRoots, [SQRT, [MULTIPLY, ...squareRoots]]];
  }

  // Hoist any negative (numbers or `"Negate"` function)
  let isNegative = false;
  let hasNegative = false;
  args = args.map((x) => {
    if (getFunctionName(x) === NEGATE) {
      hasNegative = true;
      isNegative = !isNegative;
      return getArg(x, 1) ?? MISSING;
    }
    const val = getNumberValue(x) ?? NaN;
    if (val < 0) {
      hasNegative = true;
      isNegative = !isNegative;
      return -val;
    }
    return x;
  });
  if (isNegative) {
    const val = getNumberValue(args[0]) ?? NaN;
    if (isFinite(val)) {
      // If the first argument is a finite number, negate it
      args = getTail(flatten([MULTIPLY, -val, ...args.slice(1)], MULTIPLY));
    } else {
      args = getTail(flatten([MULTIPLY, -1, ...args], MULTIPLY));
    }
  } else if (hasNegative) {
    // At least one term was hoisted, it could require flatening
    // e.g. `[MULTIPLY, [NEGATE, [MULTIPLY, 2, 3]], 4]`
    args = getTail(flatten([MULTIPLY, ...args], MULTIPLY));
  } else {
    args = getTail(flatten([MULTIPLY, ...args], MULTIPLY));
  }

  // Any arg is 0? Return 0.
  // WARNING: we can't do this. If any of the argument, or the result
  // of the evaluation of any of the argument was non-finite, the
  // result is undefined (NaN), not 0.
  // if (args.some((x) => getNumberValue(x) === 0)) return 0;

  // Any 1? Eliminate them.
  args = args.filter((x) => getNumberValue(x) !== 1);

  // If no arguments left, return 1
  if (args.length === 0) return 1;

  // Only one argument, return it (`"Multiply"` is idempotent)
  if (args.length === 1) return args[0];

  return [MULTIPLY, ...args];
}

function canonicalPowerForm(
  expr: Expression,
  engine: ComputeEngine
): Expression {
  if (isAtomic(expr)) return expr;

  expr = applyRecursively(expr, (x) => canonicalPowerForm(x, engine));

  if (getFunctionName(expr) === POWER) return applyPower(engine, expr);

  return expr;
}

function canonicalNegateForm(
  expr: Expression,
  engine: ComputeEngine
): Expression {
  if (isAtomic(expr)) return expr;
  if (getFunctionHead(expr) !== NEGATE) {
    return applyRecursively(expr, (x) => canonicalNegateForm(x, engine));
  }

  return applyNegate(getArg(ungroup(expr), 1) ?? MISSING);
}

function canonicalBooleanForm(
  expr: Expression,
  _engine: ComputeEngine
): Expression {
  // @todo
  return expr;
}

function canonicalConstantsForm(
  expr: Expression,
  _engine: ComputeEngine
): Expression {
  return applyConstants(expr);
}

function canonicalRationalForm(
  expr: Expression,
  engine: ComputeEngine
): Expression {
  if (!isAtomic(expr)) {
    return applyRecursively(expr, (x) => canonicalConstantsForm(x, engine));
  }
  const [numer, denom] = getRationalValue(expr);
  if (numer === null || denom === null) return expr;
  if (denom === 1) return numer;
  if (denom === -1) return -numer;
  // Make the denominator > 0
  if (denom < 0) return ['Divide', applyNegate(numer), applyNegate(denom)];
  return ['Divide', numer, denom];
}

function canonicalNumberForm(
  expr: Expression,
  engine: ComputeEngine
): Expression {
  if (!isAtomic(expr)) {
    return applyRecursively(expr, (x) => canonicalNumberForm(x, engine));
  }
  if (typeof expr === 'number') {
    if (isNaN(expr)) {
      return { num: 'NaN' };
    } else if (!isFinite(expr) && expr > 0) {
      return { num: '+Infinity' };
    } else if (!isFinite(expr) && expr < 0) {
      return { num: '-Infinity' };
    }
  } else if (expr instanceof Complex) {
    const c = expr as Complex;
    return ['Complex', c.re, c.im];
  } else if (expr instanceof Decimal) {
    const d = expr as Decimal;
    return { num: d.toString() + 'd' };
  } else if (isNumberObject(expr)) {
    if (isNaN(Number(expr.num))) {
      // Only return true if it's not a number
      // If it's an overflow, Number() is Infinity
      // If it's an underflow Number() is 0
      return { num: 'NaN' };
    }
  } else if (getFunctionName(expr) === 'Complex') {
    if (getNumberValue(getArg(expr, 2)) === 0) {
      return getNumberValue(getArg(expr, 1)) ?? NaN;
    }
  }

  return expr;
}

function canonicalSubtractForm(
  expr: Expression,
  engine: ComputeEngine
): Expression {
  if (isAtomic(expr)) return expr;
  if (getFunctionHead(expr) !== SUBTRACT) {
    return applyRecursively(expr, (x) => canonicalSubtractForm(x, engine));
  }

  if (getArgCount(expr) !== 2) return expr;

  const arg1 = canonicalSubtractForm(getArg(expr, 1)!, engine);
  const val1 = getNumberValue(arg1);
  const arg2 = canonicalSubtractForm(getArg(expr, 2)!, engine);
  const val2 = getNumberValue(arg2);

  if (val1 === 0) {
    if (val2 === 0) return 0;
    return applyNegate(arg2);
  }
  return [ADD, arg1, applyNegate(arg2)];
}

function canonicalRootForm(
  expr: Expression,
  engine: ComputeEngine
): Expression {
  if (isAtomic(expr)) return expr;
  const head = getFunctionHead(expr);
  if (getArgCount(expr) < 2 && head !== ROOT && head !== POWER) {
    return applyRecursively(expr, (x) => canonicalRootForm(x, engine));
  }

  const arg2 = canonicalRootForm(getArg(expr, 2)!, engine);
  const arg1 = canonicalRootForm(getArg(expr, 1)!, engine);

  if (head === ROOT) {
    if (getNumberValue(arg2) === 2) return [SQRT, arg1];
    return [ROOT, arg1, arg2];
  }

  if (head === POWER) {
    const [numer, denom] = getRationalValue(arg2);
    if (numer === -1) {
      if (denom === 2) return [SQRT, arg1];
      return [ROOT, arg1, denom!];
    }
    if (denom === 1) return [POWER, arg1, numer!];
    if (numer !== null && denom !== null) {
      return [POWER, arg1, [DIVIDE, numer, denom]];
    }
  }

  return expr;
}

/**
 * Return num as a number if it's a valid JSON number (that is
 * a valid JavaScript number but not NaN or +/-Infinity) or
 * as a string otherwise
 */

function asValidJSONNumber(num: string): string | number {
  if (typeof num === 'string') {
    const val = Number(num);
    if (num[0] === '+') num = num.slice(1);
    if (val.toString() === num) {
      // If the number roundtrips, it can be represented by a
      // JavaScript number
      // However, NaN and Infinity cannot be represented by JSON
      if (isNaN(val) || !isFinite(val)) {
        return val.toString();
      }
      return val;
    }
  }
  return num;
}

/**
 * Transform the expression so that object literals for numbers, symbols and
 * functions are used only when necessary, i.e. when they have associated
 * metadata attributes. Otherwise, use a plain number, string or array
 *
 * For example:
 *
 * ```
 * {num: 2} -> 2
 * {sym: "x"} -> "x"
 * {fn:['add', {num: 1}, {sym: "x"}]} -> ['add', 1, "x"]
 * ```
 *
 */
export function jsonForm(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  if (expr === null) return null;
  if (Array.isArray(expr)) {
    return (expr as Expression[]).map((x, i) => {
      if (i === 0) {
        return x;
      }
      return jsonForm(x, engine) ?? NOTHING;
    });
  }
  if (typeof expr === 'object') {
    const keys = Object.keys(expr);
    if (keys.length === 1) {
      if (isNumberObject(expr)) {
        // Exclude NaN and Infinity, which are not valid numbers in JSON
        const val = asValidJSONNumber(expr.num);
        if (typeof val === 'number') return val;
        return { num: val };
      }
      if (isFunctionObject(expr)) {
        return expr.fn.map((x) => jsonForm(x, engine) ?? NOTHING);
      }
      if (isSymbolObject(expr)) {
        return expr.sym;
      }
    } else {
      if (isFunctionObject(expr)) {
        expr.fn = expr.fn.map((x) => jsonForm(x, engine) ?? NOTHING);
      }
    }
  }
  return expr;
}

export function strippedMetadataForm(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  if (expr === null) return null;
  if (typeof expr === 'number' || typeof expr === 'string') {
    return expr;
  }
  if (Array.isArray(expr)) {
    return expr.map((x) => strippedMetadataForm(x, engine) ?? NOTHING);
  }
  if (typeof expr === 'object') {
    if ('num' in expr) {
      const val = asValidJSONNumber(expr.num);
      if (typeof val === 'number') return val;
      return { num: val };
    } else if ('fn' in expr) {
      return expr.fn.map((x) => strippedMetadataForm(x, engine) ?? NOTHING);
    } else if ('dict' in expr) {
      return {
        dict: Object.fromEntries(
          Object.entries(expr.dict).map((keyValue) => {
            return [
              keyValue[0],
              strippedMetadataForm(keyValue[1], engine) ?? NOTHING,
            ];
          })
        ),
      };
    }
  }

  return null;
}

export function objectLiteralForm(
  expr: Expression,
  engine: ComputeEngine
): Expression {
  if (typeof expr === 'number') {
    return { num: expr.toString() };
  }
  if (typeof expr === 'string') {
    return { sym: expr };
  }
  if (Array.isArray(expr) && expr.length > 0) {
    return { fn: expr.map((x) => objectLiteralForm(x, engine)) };
  }
  if (typeof expr === 'object' && 'fn' in expr) {
    return { ...expr, fn: expr.fn.map((x) => objectLiteralForm(x, engine)) };
  }
  return expr;
}

/**
 * Transform the expression so that the arguments of functions that have the
 * `isCommutative` attributes are ordered as follow:
 *
 * - Real numbers
 * - Complex numbers
 * - Symbols
 * - Functions
 *
 * Within Real Numbers:
 * - by their value
 *
 * Within Complex numbers:
 * - by the value of their imaginary component,
 * - then by the value of their real component
 *
 * Within Symbols:
 * - constants (`isConstant === true`) before non-constants
 * - then alphabetically
 *
 * Within Functions:
 * - if a `[MULTIPLY]` or a `[POWER]`... @todo
 *
 */
export function sortedForm(
  expr: Expression,
  engine: ComputeEngine
): Expression {
  // Get the unique variables (not constants) in the expression
  const v: Set<string> = engine.getVars(expr);

  return canonicalOrder(engine, Array.from(v).sort(), expr);
}

/**
 *  Return the expression in canonical form:
 *
 * - `"divide"`, `"exp"`,` `"subtract"`, `"root"`, `"exp"` replaced with
 *      `"add"`, `"multiply"`, "`power"`
 * - some trivial simplifications (multiply by 1, addition of 0, division by 1)
 * - terms sorted
 *
 */
export function canonicalForm(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  return engine.format(expr, [
    // @todo: canonical-boolean: transforms, Equivalent, Implies, Xor...
    'canonical-boolean',
    // in CNF (Conjunctive Normal Form: https://en.wikipedia.org/wiki/Conjunctive_normal_form)
    'canonical-number', // ➔ simplify number
    'canonical-exp', // ➔ power
    'canonical-root', // ➔ power, divide
    'canonical-subtract', // ➔ add, negate, multiply,
    'canonical-divide', // ➔ multiply, power
    'canonical-power', // simplify power
    'canonical-multiply', // ➔ multiply, power,    (this might generate
    // some POWER functions, but they are 'safe' (don't need simplification)
    'canonical-negate',
    'canonical-add',
    'flatten', // associative, idempotent and groups
    'canonical-list', // 'Nothing', 'Identity' and 'Sequence'
    'canonical-domain',
    'canonical-rational',
    'canonical-constants',
    'sorted',
    'json',
  ]);
}

function flattenForm(expr: Expression, engine: ComputeEngine): Expression {
  return flattenAssociative(
    flattenIdempotent(flattenInvolution(expr, engine), engine),
    engine
  );
}

/**
 * Return a string escaped as necessary to comply with the JSON format
 *
 */
export function escapeText(s: string): string {
  return s
    .replace(/[\\]/g, '\\\\')
    .replace(/["]/g, '\\"')
    .replace(/[\b]/g, '\\b')
    .replace(/[\f]/g, '\\f')
    .replace(/[\n]/g, '\\n')
    .replace(/[\r]/g, '\\r')
    .replace(/[\t]/g, '\\t');
}

/**
 * Transform an expression by applying one or more rewriting rules to it,
 * recursively.
 *
 * There are many ways to symbolically manipulate an expression, but
 * transformations with `form` have the following characteristics:
 *
 * - they don't require calculations or assumptions about the domain of free
 * variables or the value of constants
 * - the output expression is expressed with more primitive functions,
 * for example subtraction is replaced with addition
 *
 */
export function format(
  engine: ComputeEngine,
  expr: Expression | null,
  forms: Form[]
): Expression | null {
  let result = expr;
  for (const form of forms) {
    const fn: (
      expr: Expression | null,
      engine: ComputeEngine
    ) => Expression | null = {
      'canonical': canonicalForm,
      'canonical-add': canonicalAddForm,
      'canonical-boolean': canonicalBooleanForm,
      'canonical-constants': canonicalConstantsForm,
      'canonical-divide': canonicalDivideForm,
      'canonical-domain': canonicalDomainForm,
      'canonical-exp': canonicalExpForm,
      'canonical-list': canonicalListForm,
      'canonical-multiply': canonicalMultiplyForm,
      'canonical-power': canonicalPowerForm,
      'canonical-negate': canonicalNegateForm,
      'canonical-number': canonicalNumberForm,
      'canonical-rational': canonicalRationalForm,
      'canonical-root': canonicalRootForm,
      'canonical-subtract': canonicalSubtractForm,
      'json': jsonForm,
      'flatten': flattenForm,
      'sorted': sortedForm,
      'stripped-metadata': strippedMetadataForm,
      'object-literal': objectLiteralForm,
      // 'sum-product': sumProductForm,
    }[form];
    if (!fn) {
      console.error('Unknown form ' + form);
      return null;
    }

    result = fn(result, engine);
  }
  return result;
}
