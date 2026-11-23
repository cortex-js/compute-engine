// Shared by the combinatorics tests: the data rows and the elements.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { MathJsonExpression } from '../../../src/math-json/types';

const DATA = resolve(__dirname, '../../../data/combinatorics');

export function readData<T = any>(file: string): T {
  return JSON.parse(readFileSync(join(DATA, file), 'utf8')) as T;
}

export type ExampleRow = {
  id: string;
  head: string;
  input: MathJsonExpression;
  expected?: MathJsonExpression;
  unevaluated?: true;
  source: string;
};

/** Every permutation of 1..n, as one-line lists. */
export function permutationsOf(n: number): number[][] {
  const out: number[][] = [];
  const used = new Array<boolean>(n + 1).fill(false);
  const current: number[] = [];
  const go = () => {
    if (current.length === n) return void out.push([...current]);
    for (let v = 1; v <= n; v++) {
      if (used[v]) continue;
      used[v] = true;
      current.push(v);
      go();
      current.pop();
      used[v] = false;
    }
  };
  go();
  return out;
}

/** Every partition of n, as non-increasing parts. */
export function partitionsOf(n: number, max = n): number[][] {
  if (n === 0) return [[]];
  const out: number[][] = [];
  for (let first = Math.min(n, max); first >= 1; first--)
    for (const rest of partitionsOf(n - first, first))
      out.push([first, ...rest]);
  return out;
}
