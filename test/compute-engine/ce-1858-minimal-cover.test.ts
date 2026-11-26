import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// CE-1858: `MinimalDNF` and `MinimalCNF` give a cover with the fewest
// terms. After the essential primes, the cover was greedy and could have
// more terms than needed.

const ce = new ComputeEngine();
const VARS = ['a', 'b', 'c', 'd'];

type Json = MathJsonExpression;

/** The value of a boolean MathJSON expression for an assignment. */
function truth(expr: Json, env: Record<string, boolean>): boolean {
  if (typeof expr === 'string') {
    if (expr === 'True') return true;
    if (expr === 'False') return false;
    return env[expr];
  }
  const [head, ...ops] = expr as [string, ...Json[]];
  if (head === 'Not') return !truth(ops[0], env);
  if (head === 'And') return ops.every((x) => truth(x, env));
  if (head === 'Or') return ops.some((x) => truth(x, env));
  throw new Error(`unexpected ${JSON.stringify(expr)}`);
}

function assignments(): Record<string, boolean>[] {
  const result: Record<string, boolean>[] = [];
  for (let i = 0; i < 1 << VARS.length; i++)
    result.push(
      Object.fromEntries(VARS.map((v, k) => [v, ((i >> k) & 1) === 1]))
    );
  return result;
}

/** The operands of an `Or` (for a DNF) or an `And` (for a CNF). */
function terms(expr: Json, head: 'Or' | 'And' | 'List'): Json[] {
  if (Array.isArray(expr) && expr[0] === head) return expr.slice(1) as Json[];
  return [expr];
}

/** The fewest of `primes` whose `head` is equivalent to `table`. */
function fewest(primes: Json[], head: 'Or' | 'And', table: boolean[]): number {
  const rows = assignments();
  for (let k = 1; k <= primes.length; k++) {
    const pick: number[] = [];
    const found = (start: number): boolean => {
      if (pick.length === k)
        return rows.every((env, r) => {
          const vals = pick.map((i) => truth(primes[i], env));
          return (
            (head === 'Or' ? vals.some(Boolean) : vals.every(Boolean)) ===
            table[r]
          );
        });
      for (let i = start; i < primes.length; i++) {
        pick.push(i);
        if (found(i + 1)) return true;
        pick.pop();
      }
      return false;
    };
    if (found(0)) return k;
  }
  return primes.length;
}

/** The DNF of the minterms of a truth table. */
function tableExpr(table: boolean[]): Json {
  const rows = assignments();
  const minterms = rows
    .filter((_, r) => table[r])
    .map((env) => ['And', ...VARS.map((v) => (env[v] ? v : ['Not', v]))]);
  return (minterms.length === 1
    ? minterms[0]
    : ['Or', ...minterms]) as unknown as Json;
}

describe('CE-1858: A MINIMAL COVER HAS THE FEWEST TERMS', () => {
  const witness: Json = [
    'Or',
    ['And', 'a', 'c'],
    ['And', ['Not', 'a'], ['Not', 'b'], 'd'],
    ['And', ['Not', 'a'], 'b', ['Not', 'c']],
    ['And', ['Not', 'a'], 'b', ['Not', 'd']],
    ['And', 'b', ['Not', 'c'], 'd'],
  ];

  test('the witness gives 4 terms, where the greedy cover gave 5', () => {
    const result = ce.box(['MinimalDNF', witness]).evaluate().json;
    expect(terms(result, 'Or')).toHaveLength(4);
    for (const env of assignments())
      expect(truth(result, env)).toBe(truth(witness, env));
  });

  test('the dual: a CNF with the fewest clauses', () => {
    const negated: Json = ['Not', witness];
    const result = ce.box(['MinimalCNF', negated]).evaluate().json;
    expect(terms(result, 'And')).toHaveLength(4);
    for (const env of assignments())
      expect(truth(result, env)).toBe(!truth(witness, env));
  });

  test('random truth tables of 4 variables: equivalent, and the fewest terms', () => {
    let seed = 1858;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let n = 0; n < 40; n++) {
      const table = assignments().map(() => random() < 0.5);
      if (table.every((x) => !x) || table.every((x) => x)) continue;
      const expr = tableExpr(table);
      const dnf = ce.box(['MinimalDNF', expr]).evaluate().json;
      const cnf = ce.box(['MinimalCNF', expr]).evaluate().json;
      assignments().forEach((env, r) => {
        expect(truth(dnf, env)).toBe(table[r]);
        expect(truth(cnf, env)).toBe(table[r]);
      });
      const implicants = ce.box(['PrimeImplicants', expr]).evaluate().json;
      const implicates = ce.box(['PrimeImplicates', expr]).evaluate().json;
      expect(terms(dnf, 'Or')).toHaveLength(
        fewest(terms(implicants, 'List'), 'Or', table)
      );
      expect(terms(cnf, 'And')).toHaveLength(
        fewest(terms(implicates, 'List'), 'And', table)
      );
    }
  });
});
