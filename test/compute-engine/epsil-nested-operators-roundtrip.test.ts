/**
 * `serializeEpsil` must print a non-canonical nested operator tree so that
 * `parseEpsil` reads it back as the same tree, up to flattening of nested
 * same-head associative operators (`Add`, `Multiply`).
 */

import type { MathJsonExpression as MathJson } from '../../src/math-json/types';
import { parseEpsil, serializeEpsil } from '../../src/epsil';

const HEADS = ['Add', 'Subtract', 'Multiply', 'Divide', 'Mod', 'Power'];
const LEAVES: MathJson[] = ['a', 'b', 'c'];

// Flatten nested same-head Add/Multiply so equal-up-to-regrouping trees match.
function norm(e: MathJson): MathJson {
  // The parser's verbose nodes (`{ fn }`, `{ sym }`, `{ num }`) down to the
  // shorthand the trees here are written in
  if (e !== null && typeof e === 'object' && !Array.isArray(e)) {
    const node = e as { fn?: MathJson[]; sym?: string; num?: string };
    if (node.fn) return norm(node.fn as MathJson);
    if (node.sym !== undefined) return node.sym;
    if (node.num !== undefined) return Number(node.num);
  }
  if (!Array.isArray(e)) return e;
  const [head, ...args] = e as [string, ...MathJson[]];
  const out: MathJson[] = [];
  for (const arg of args.map(norm)) {
    if (
      (head === 'Add' || head === 'Multiply') &&
      Array.isArray(arg) &&
      arg[0] === head
    )
      out.push(...(arg as MathJson[]).slice(1));
    else out.push(arg);
  }
  return [head, ...out] as MathJson;
}

function trees(depth: number): MathJson[] {
  if (depth === 0) return LEAVES;
  const sub = trees(depth - 1);
  const out: MathJson[] = [...LEAVES];
  for (const h of HEADS)
    for (const l of sub) for (const r of LEAVES) out.push([h, l, r], [h, r, l]);
  for (const l of sub) out.push(['Negate', l]);
  return out;
}

function roundTrips(e: MathJson): string | null {
  const text = serializeEpsil(e);
  const [parsed] = parseEpsil(text);
  return JSON.stringify(norm(parsed as MathJson)) === JSON.stringify(norm(e))
    ? null
    : `${JSON.stringify(e)} -> ${text} -> ${JSON.stringify(parsed)}`;
}

describe('SERIALIZE EPSIL NESTED OPERATORS', () => {
  test('issue #596: Mod at the head of a nested Multiply', () => {
    const e: MathJson = ['Multiply', 'a', ['Multiply', ['Mod', 'x', 2], 'b']];
    expect(serializeEpsil(e)).toBe('a * (x % 2 * b)');
    expect(roundTrips(e)).toBeNull();
  });

  test('Add with a Subtract at the head of a nested Add', () => {
    const e: MathJson = ['Add', 'a', ['Add', ['Subtract', 'x', 'y'], 'b']];
    expect(serializeEpsil(e)).toBe('a + (x - y + b)');
  });

  test('canonical flat forms stay unparenthesized', () => {
    expect(
      serializeEpsil(['Multiply', 'a', ['Multiply', 'x', ['Mod', 'y', 2]]])
    ).toBe('a * x * (y % 2)');
    expect(serializeEpsil(['Multiply', 'a', ['Multiply', 'b', 'c']])).toBe(
      'a * b * c'
    );
    expect(serializeEpsil(['Add', 'a', ['Add', 'b', 'c']])).toBe('a + b + c');
  });

  test('generated trees round-trip', () => {
    const failures: string[] = [];
    for (const t of trees(2)) {
      for (const h of HEADS) {
        for (const e of [[h, t, 'c'], [h, 'c', t]] as MathJson[]) {
          const f = roundTrips(e);
          if (f) failures.push(f);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
