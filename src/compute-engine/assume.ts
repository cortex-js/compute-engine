import {
  getArg,
  getFunctionName,
  getSymbolName,
  getTail,
  MISSING,
} from '../common/utils';
import { Expression } from '../public';
import { ComputeEngine, Numeric } from './public';
import { CortexError } from './utils';

export function internalIs(
  engine: ComputeEngine,
  proposition: Expression
): boolean | undefined {
  let val = true;
  [proposition, val] = normalizeProposition(proposition);
  const result = engine.assumptions.get(proposition);
  if (result === undefined) return undefined;
  return result === val;
}

export function normalizeProposition<T extends number = Numeric>(
  proposition: Expression<T>
): [Expression<T>, boolean] {
  let val = true;
  const head = getFunctionName(proposition);
  if (head === 'Not') {
    [proposition, val] = normalizeProposition(
      getArg(proposition, 1) ?? MISSING
    );
    val = !val;
  } else if (head === 'NotEqual') {
    val = false;
    proposition = ['Equal', getArg(proposition, 1) ?? MISSING];
  } else if (head === 'NotElement') {
    val = false;
    proposition = ['Element', getArg(proposition, 1) ?? MISSING];
  }
  return [proposition, val];
}

export function internalAssume<T extends number = Numeric>(
  engine: ComputeEngine<T>,
  proposition: Expression<T>
): 'contradiction' | 'tautology' | 'ok' {
  proposition = engine.canonical(proposition)!;

  const head = getFunctionName(proposition);

  if (!head) throw new CortexError({ message: 'expected-predicate' });

  let val = true;

  if (head === 'And') {
    for (const prop of getTail(proposition)) {
      const result = internalAssume(engine, prop);
      if (result !== 'ok') return result;
    }
  } else {
    [proposition, val] = normalizeProposition(proposition);
  }

  const v = engine.is(proposition);

  // Is the proposition a contradiction or tautology?
  if (v !== undefined) {
    if (v === val) return 'tautology';
    if (v !== val) return 'contradiction';
  }

  // Add a new assumption
  engine.assumptions.set(proposition, val);

  // @todo: could check any assumptions that have become tautologies
  // (i.e. if `proposition` was more general than an existing assumption)
  // and remove them.

  return 'ok';
}

// export function filterAssumptions<T extends number = Numeric>(
//   engine: ComputeEngine<T>,
//   head: Expression<T>,
//   arg1?: Expression<T>,
//   arg2?: Expression<T>
// ): Expression<T>[] {
//   const result: Expression<T>[] = [];
//   const assumptions = engine.assumptions;
//   for (const [assumption, val] of assumptions) {
//     if (getFunctionName(assumption) === head) {
//       if (arg1 === undefined) {
//         result.push(assumption);
//       } else {
//         if (match(arg1, getArg(assumption, 1))) {
//           if (arg2 === undefined) {
//             result.push(assumption);
//           } else {
//             if (match(arg2, getArg(assumption, 2))) {
//               result.push(assumption);
//             }
//           }
//         }
//       }
//     }
//   }
//   return result;
// }

function getAssumptionsAbout<T extends number = Numeric>(
  engine: ComputeEngine<T>,
  arg: Expression<T>
): Expression<T>[] {
  const symbols: string[] = [...engine.getVars(arg)]
    .map((x) => getSymbolName(x))
    .filter((x) => x !== null) as string[];

  if (symbols.length === 0) return [];

  const result: Expression<T>[] = [];
  for (const [assumption, val] of engine.assumptions) {
    const vars = engine.getVars(assumption);
    for (const symbol of symbols) {
      if (vars.has(symbol)) {
        if (val) {
          result.push(assumption);
        } else if (getFunctionName(assumption) === 'Equal') {
          result.push(['NotEqual', assumption]);
        } else if (getFunctionName(assumption) === 'Element') {
          result.push(['NotElement', assumption]);
        } else {
          result.push(['Not', assumption]);
        }
        break;
      }
    }
  }

  return [];
}

export function forget<T extends number = Numeric>(
  engine: ComputeEngine<T>,
  arg: Expression<T>
): void {
  for (const assumption of getAssumptionsAbout(engine, arg)) {
    engine.assumptions.delete(assumption);
  }
}
