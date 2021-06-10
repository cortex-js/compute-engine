import { Expression } from '../public';
import { Form, Domain, ComputeEngine } from './public';
import {
  isAtomic,
  isNumberObject,
  isFunctionObject,
  isSymbolObject,
  getNumberValue,
  getFunctionName,
  getTail,
  getArg,
  applyArgs,
  getArgCount,
  getFunctionHead,
  PARENTHESES,
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
} from '../common/utils';
import { canonicalOrder } from './order';

function ungroup(expr: Expression | null): Expression | null {
  if (expr === null) return null;
  const head = getFunctionHead(expr);
  if (!head) return expr;
  if (head === PARENTHESES && getArgCount(expr) === 1) {
    return ungroup(getArg(expr, 1));
  }
  return applyArgs(expr, ungroup);
}

/**
 * Return an expression that's the inverse (1/x) of the input
 *
 */

function applyInvert(expr: Expression | null): Expression | null {
  if (expr === null) return null;
  expr = ungroup(expr);
  const head = getFunctionHead(expr);
  if (head === POWER && getArgCount(expr!) === 2) {
    return [
      POWER,
      getArg(expr, 1) ?? NOTHING,
      applyNegate(getArg(expr, 2)) ?? NOTHING,
    ];
  }
  if (head === DIVIDE && getArgCount(expr!) === 2) {
    return [
      MULTIPLY,
      [POWER, getArg(expr, 1) ?? NOTHING, -1],
      getArg(expr, 2) ?? NOTHING,
    ];
  }
  return [POWER, expr!, -1];
}

export function applyNegate(expr: Expression | null): Expression | null {
  if (expr === null) return expr;
  expr = ungroup(expr);
  if (typeof expr === 'number') {
    expr = -expr;
  } else if (expr && isNumberObject(expr)) {
    if (expr.num[0] === '-') {
      expr = { num: expr.num.slice(1) };
    } else {
      expr = { num: '-' + expr.num };
    }
  } else {
    // [NEGATE, [NEGATE, x]] -> x
    const name = getFunctionName(expr);
    const argCount = getArgCount(expr!);
    if (name === NEGATE && argCount === 1) {
      return getArg(expr, 1);
    } else if (name === MULTIPLY) {
      let arg = getArg(expr, 1) ?? MISSING;
      if (typeof arg === 'number') {
        arg = -arg;
      } else if (isNumberObject(arg)) {
        if (arg.num[0] === '-') {
          arg = { num: arg.num.slice(1) };
        } else {
          arg = { num: '-' + arg.num };
        }
      } else {
        arg = [NEGATE, arg];
      }
      return [MULTIPLY, arg, ...getTail(expr).slice(1)];
    } else if (name === PARENTHESES && argCount === 1) {
      return applyNegate(getArg(getArg(expr, 1), 1));
    }

    expr = [NEGATE, expr ?? MISSING];
  }
  return expr;
}

function flatten(expr: Expression | null, flatName: string): Expression | null {
  const head = getFunctionHead(expr);
  if (!head) return expr;

  expr = applyArgs(expr, (x) => flatten(x, flatName));

  if (head !== flatName) return expr;

  const args = getTail(expr);
  let newArgs: Expression[] = [];
  for (let i = 0; i < args.length; i++) {
    if (getFunctionName(args[i]) === flatName) {
      // [f, a, [f, b, c]] -> [f, a, b, c]
      // or [f, f[a]] -> f[a]
      newArgs = newArgs.concat(getTail(args[i]));
    } else {
      newArgs.push(args[i]);
    }
  }
  return [head, ...newArgs];
}

function flattenInvolution(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  const name = getFunctionName(expr);
  const def = engine.getFunctionDefinition(name);
  if (def?.involution) {
    const args = getTail(expr);
    if (args.length === 1 && getFunctionName(args[0]) === name) {
      return flatten(args[0], name);
    }
  }

  return applyArgs(expr, (x) => flattenInvolution(x, engine));
}

function flattenIdempotent(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  const name = getFunctionName(expr);
  const def = engine.getFunctionDefinition(name);
  if (def?.idempotent) return flatten(expr, name);

  return applyArgs(expr, (x) => flattenIdempotent(x, engine));
}

function flattenAssociative(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  const name = getFunctionName(expr);
  const def = engine.getFunctionDefinition(name);
  if (def?.associative) return flatten(expr, name);

  return applyArgs(expr, (x) => flattenAssociative(x, engine));
}

function canonicalAddForm(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  const head = getFunctionHead(expr);
  if (!head) return expr;
  if (head !== ADD) {
    return applyArgs(expr, (x) => canonicalAddForm(x, engine));
  }
  expr = flatten(ungroup(expr), ADD);
  let args = getTail(expr);
  args = args
    .map((x) => canonicalAddForm(x, engine) ?? MISSING)
    .filter((x) => getNumberValue(x) !== 0);
  const argCount = args.length;
  if (argCount === 0) return 0;
  if (argCount === 1) return args[0];
  return [ADD, ...args];
}

function canonicalDivideForm(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  if (expr === null) return null;
  const head = getFunctionHead(expr);
  if (!head) return expr;
  if (head !== DIVIDE) {
    return applyArgs(expr, (x) => canonicalDivideForm(x, engine));
  }

  if (getArgCount(expr) !== 2) return expr;

  const arg1 = canonicalDivideForm(getArg(expr, 1), engine);
  const arg2 = canonicalDivideForm(getArg(expr, 2), engine);
  if (getNumberValue(arg2) === 1) return arg1;
  if (getNumberValue(arg1) === 1) return applyInvert(arg2);
  return [MULTIPLY, arg1 ?? MISSING, applyInvert(arg2) ?? MISSING];
}

function canonicalExpForm(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  if (expr === null) return null;
  const head = getFunctionHead(expr);
  if (!head) return expr;
  if (head !== EXP) {
    return applyArgs(expr, (x) => canonicalExpForm(x, engine));
  }

  if (getArgCount(expr) !== 1) return expr;

  return [
    POWER,
    EXPONENTIAL_E,
    canonicalExpForm(getArg(expr, 1), engine) ?? MISSING,
  ];
}

function canonicalListForm(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  if (expr === null) return null;
  if (isAtomic(expr)) return expr;

  const rootName = getFunctionName(expr);
  if (rootName !== LIST && rootName !== SEQUENCE && rootName !== SEQUENCE2) {
    return applyArgs(expr, (x) => canonicalListForm(x, engine));
  }

  const isList = rootName === LIST;
  const args = getTail(expr);
  const newArgs: Expression[] = [];

  if (isList) {
    for (let arg of args) {
      arg = canonicalListForm(arg, engine)!;
      const name = getFunctionName(arg);
      if (name === IDENTITY) {
        const newArg = getArg(arg, 1);
        if (newArg !== null && newArg !== undefined) {
          newArgs.push(newArg);
        }
      } else if (name !== NOTHING) {
        newArgs.push(arg);
      }
    }
    return [LIST, ...newArgs];
  }

  const def = engine.getFunctionDefinition(rootName);
  const sequenceHold = def?.sequenceHold ?? false;

  for (let arg of args) {
    arg = canonicalListForm(arg, engine)!;
    const name = getFunctionName(arg);
    if (name === IDENTITY) {
      const newArg = getArg(arg, 1);
      if (newArg !== null && newArg !== undefined) {
        newArgs.push(newArg);
      }
    } else if (name === rootName && !sequenceHold) {
      const head = getFunctionHead(expr);
      for (const arg2 of getTail(arg)) {
        if (getFunctionName(arg2) === name) {
          newArgs.push([head ?? MISSING, ...getTail(arg2)]);
        } else {
          newArgs.push(arg2);
        }
      }
    } else {
      newArgs.push(arg);
    }
  }

  return [getFunctionHead(expr) ?? MISSING, ...newArgs];
}

function getRootDegree(expr: Expression): number {
  const name = getFunctionName(expr);
  if (name === SQRT) return 2;
  if (name === ROOT) return getNumberValue(getArg(expr, 2)) ?? NaN;
  if (name !== POWER) return 1;
  const exponent = getArg(expr, 2);
  if (!exponent) return 1;
  if (
    getFunctionName(exponent) === POWER &&
    getNumberValue(getArg(exponent, 2)) === -1
  ) {
    const val = getNumberValue(getArg(exponent, 1)) ?? NaN;
    if (isFinite(val)) return val;
  }
  return 1;
}

/**
 * Assuming that `expr` is a `"multiply"`, return in the first member
 * of the tuples all the arguments that are square roots,
 * and in the second member of the tuples all those that aren't
 */

function getSquareRoots(expr: Expression): [Expression[], Expression[]] {
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
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  if (expr === null) return null;
  const head = getFunctionHead(expr);
  if (!head) return expr;
  expr = applyArgs(expr, (x) => canonicalMultiplyForm(x, engine));
  if (head !== MULTIPLY) return expr;

  expr = flatten(ungroup(expr), MULTIPLY)!;

  // Group all square roots together
  const [squareRoots, nonSquareRoots] = getSquareRoots(expr);
  let args: Expression[];
  if (squareRoots.length === 0) {
    args = nonSquareRoots;
  } else if (squareRoots.length === 1) {
    expr = [
      MULTIPLY,
      ...nonSquareRoots,
      [POWER, squareRoots[0], [POWER, 2, -1]],
    ];
    args = getTail(expr);
  } else {
    expr = [
      MULTIPLY,
      ...nonSquareRoots,
      [POWER, [MULTIPLY, ...squareRoots], [POWER, 2, -1]],
    ];
    args = getTail(expr);
  }

  // Hoist any negative (numbers or `"negate"` function)
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
  // of the evaluation of any of the argument was non-finit, the
  // result is undefined (NaN), not 0.
  // if (args.some((x) => getNumberValue(x) === 0)) return 0;

  // Any 1? Eliminate them.
  args = args.filter((x) => getNumberValue(x) !== 1);

  // If no arguments left, return 1
  if (args.length === 0) return 1;

  // Only one argument, return it (`"multiply"` is idempotent)
  if (args.length === 1) return args[0];

  return [MULTIPLY, ...args];
}

// @todo: see https://docs.sympy.org/1.6/modules/core.html#pow
function canonicalPowerForm(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  if (expr === null) return null;
  const head = getFunctionHead(expr);
  if (!head) return expr;
  if (head !== POWER) {
    return applyArgs(expr, (x) => canonicalPowerForm(x, engine));
  }

  expr = ungroup(expr)!;

  if (getArgCount(expr) !== 2) return expr;

  const arg1 = canonicalPowerForm(getArg(expr, 1), engine);
  const val1 = getNumberValue(arg1) ?? NaN;
  const arg2 = canonicalPowerForm(getArg(expr, 2), engine);
  const val2 = getNumberValue(arg2) ?? NaN;

  if (val2 === 0) return 1;
  if (val2 === 1) return arg1;
  if (val1 === -1 && val2 === -1) return -1;
  // -1 +oo           nan
  // -1 -oo           nan

  // 0 -1             zoo
  // 0 oo             0
  // 0 -oo            zoo

  if (val1 === 1 && val2 === -1) return 1;
  if (val1 === 1) return 1;
  // 1 oo             nan
  // 1 -oo            nan

  // oo -1            0
  // oo oo            oo
  // oo -oo           0
  // oo i             nan
  // oo 1+i           zoo
  // oo -1+i          0

  // -oo -1           0
  // -oo oo           nan
  // -oo -oo          nan
  // -oo i            nan
  // -oo 1+i          zoo
  // -oo -1+i         0

  // b zoo            nan

  return expr;
}

function canonicalNegateForm(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  const head = getFunctionHead(expr);
  if (head === NEGATE) {
    expr = ungroup(expr);
    const arg = getArg(expr, 1);
    if (typeof arg === 'number') {
      expr = -arg;
    } else if (arg && isNumberObject(arg)) {
      if (getNumberValue(arg) === 0) return 0;
      if (arg.num[0] === '-') {
        expr = { num: arg.num.slice(1) };
      } else if (arg.num[0] === '+') {
        expr = { num: '-' + arg.num.slice(1) };
      } else {
        expr = { num: '-' + arg.num };
      }
    } else if (getFunctionName(arg) === MULTIPLY) {
      let fact = getArg(arg, 1);
      if (typeof fact === 'number') {
        fact = -fact;
      } else if (isNumberObject(fact)) {
        if (fact.num[0] === '-') {
          fact = { num: fact.num.slice(1) };
        } else {
          fact = { num: '-' + fact.num };
        }
      } else {
        return [MULTIPLY, -1, fact ?? MISSING, ...getTail(arg).slice(1)];
      }
      return [MULTIPLY, fact, ...getTail(arg).slice(1)];
    } else {
      return [MULTIPLY, -1, arg ?? MISSING];
    }
  } else if (head) {
    return applyArgs(expr, (x) => canonicalNegateForm(x, engine));
  }
  return expr;
}

function canonicalNumberForm(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  if (getFunctionHead(expr)) {
    return applyArgs(expr, (x) => canonicalNumberForm(x, engine));
  }

  if (typeof expr === 'number') {
    if (isNaN(expr)) {
      return { num: 'NaN' };
    } else if (!isFinite(expr) && expr > 0) {
      return { num: 'Infinity' };
    } else if (!isFinite(expr) && expr < 0) {
      return { num: '-Infinity' };
    }
    // } else if (typeof expr === 'bigint') {
    //     return { num: BigInt(expr).toString().slice(0, -1) };
    // }
  } else if (isNumberObject(expr)) {
    if (isNaN(Number(expr.num))) {
      // Only return true if it's not a number
      // If it's an overflow, Number() is Infinity
      // If it's an underflow Number() is 0
      return { num: 'NaN' };
    }
    if (expr.num.endsWith('n')) {
      // It's a bigint string
      return { num: expr.num.slice(0, -1) };
    }
    // if (typeof expr.num === 'bigint') {
    //     return { num: BigInt(expr.num).toString().slice(0, -1) };
    // }
  }

  return expr;
}

function canonicalSubtractForm(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  if (expr === null) return null;
  const head = getFunctionHead(expr);
  if (!head) return expr;
  if (head !== SUBTRACT) {
    return applyArgs(expr, (x) => canonicalSubtractForm(x, engine));
  }

  if (getArgCount(expr) !== 2) return expr;

  const arg1 = canonicalSubtractForm(getArg(expr, 1), engine) ?? MISSING;
  const val1 = getNumberValue(arg1);
  const arg2 = canonicalSubtractForm(getArg(expr, 2), engine) ?? MISSING;
  const val2 = getNumberValue(arg2);

  if (val1 === 0) {
    if (val2 === 0) return 0;
    return canonicalSubtractForm(
      [ADD, arg1, applyNegate(arg2) ?? MISSING],
      engine
    );
  }
  return canonicalSubtractForm(
    [ADD, arg1, applyNegate(arg2) ?? MISSING],
    engine
  );
}

function canonicalRootForm(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  if (expr === null) return null;
  const head = getFunctionHead(expr);
  if (!head) return expr;
  if (head !== ROOT && head !== SQRT) {
    return applyArgs(expr, (x) => canonicalRootForm(x, engine));
  }

  if (getArgCount(expr) < 1) return expr;

  const arg1 = canonicalRootForm(getArg(expr, 1), engine);

  let arg2: Expression | null = 2;
  if (getArgCount(expr) > 1) {
    arg2 = canonicalPowerForm(getArg(expr, 2), engine);
  }
  if (getNumberValue(arg2) === 1) {
    return arg1;
  }

  return [POWER, arg1 ?? NOTHING, [DIVIDE, 1, arg2 ?? MISSING]];
}

/**
 * Return num as a number if it's a valid JSON number (that is
 * a valid JavaScript number but not NaN or +/-Infinity) or
 * as a string otherwise
 */

function isValidJSONNumber(num: string): string | number {
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
 * ```
 * {num: 2} -> 2
 * {sym: "x"} -> "x"
 * {fn:['add', {num: 1}, {sym: "x"}]} -> ['add', 1, "x"]
 * ```
 *
 */
export function fullForm(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
  if (expr === null) return null;
  if (Array.isArray(expr)) {
    return (expr as Expression[]).map((x, i) => {
      if (i === 0) {
        return x;
      }
      return fullForm(x, engine) ?? NOTHING;
    });
  }
  if (typeof expr === 'object') {
    const keys = Object.keys(expr);
    if (keys.length === 1) {
      if (isNumberObject(expr)) {
        // Exclude NaN and Infinity, which are not valid numbers in JSON
        const val = isValidJSONNumber(expr.num);
        if (typeof val === 'number') return val;
        return { num: val };
      }
      if (isFunctionObject(expr)) {
        return expr.fn.map((x) => fullForm(x, engine) ?? NOTHING);
      }
      if (isSymbolObject(expr)) {
        return expr.sym;
      }
    } else {
      if (isFunctionObject(expr)) {
        expr.fn = expr.fn.map((x) => fullForm(x, engine) ?? NOTHING);
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
      const val = isValidJSONNumber(expr.num);
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
 * Return a canonical form of the domain
 *
 */
export function canonicalDomainForm(
  dom: Domain,
  _engine: ComputeEngine
): Domain {
  // The canonical domain is calculated by evaluating the
  // domain expression @todo

  // @todo Deal with parametric domains
  // when overlapping
  // Simplify ranges: Real[-infinity, +infinity] (or does Real not include infinity?)
  return dom;
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
    // in CNF (Conjunctive Normal Form: https://en.wikipedia.org/wiki/Conjunctive_normal_form)
    'canonical-number', // ➔ simplify number
    'canonical-exp', // ➔ power
    'canonical-root', // ➔ power, divide
    'canonical-subtract', // ➔ add, negate, multiply,
    'canonical-divide', // ➔ multiply, power
    'canonical-power', // simplify power
    'canonical-multiply', // ➔ multiply, power,    (this might generate
    // some POWER functions, but they are 'safe' (don't need simplification)
    'canonical-negate', // simplify negate
    'canonical-add', // simplify add
    'flatten', // associative, idempotent and groups
    'canonical-list', // 'Nothing', 'Identity' and 'Sequence'
    'canonical-domain',
    'sorted',
    'full',
  ]);
}

function flattenForm(
  expr: Expression | null,
  engine: ComputeEngine
): Expression | null {
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
      'canonical-divide': canonicalDivideForm,
      'canonical-exp': canonicalExpForm,
      'canonical-list': canonicalListForm,
      'canonical-multiply': canonicalMultiplyForm,
      'canonical-power': canonicalPowerForm,
      'canonical-negate': canonicalNegateForm,
      'canonical-number': canonicalNumberForm,
      'canonical-root': canonicalRootForm,
      'canonical-subtract': canonicalSubtractForm,
      'full': fullForm,
      'flatten': flattenForm,
      'sorted': sortedForm,
      'stripped-metadata': strippedMetadataForm,
      'object-literal': objectLiteralForm,
      'canonical-domain': canonicalDomainForm,
      // 'sum-product': sumProductForm,
    }[form];
    if (!fn) {
      console.error('Unknown form ' + form);
      return null;
    }
    result = fn(result, engine);
    // console.log(form + ' = ' + JSON.stringify(result));
  }
  return result;
}
