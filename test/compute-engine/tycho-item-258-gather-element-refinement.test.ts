/**
 * The use-driven element refinement read a GATHER as an element access.
 *
 * `At`'s `inferOperandTypes` hook lets a use of an undeclared symbol refine
 * it: `ys[1] + 1` proves `ys` holds numbers, so `ys` becomes
 * `indexed_collection<number>`. What the requirement names, though, depends on
 * the INDEX:
 *
 *  - a SCALAR index selects one element, so the requirement names the element
 *    type;
 *  - a GATHER (a `Range` or a list index) selects a LIST of elements. A scalar
 *    requirement still names the elements, because the consumer broadcasts
 *    over the selected list — `xs[[1, 2]] + 1` does prove `xs` holds numbers.
 *    But a COLLECTION requirement is ambiguous: it is satisfied either by
 *    elements that are themselves collections (the scalar-index reading) or by
 *    the selected LIST being the collection (the gather reading), and under a
 *    gather the second is the right one.
 *
 * The handler's own documentation says exactly this, but the guard was applied
 * only where the index kind was OPEN; a provably collection-typed index wrote
 * `indexed_collection<r>` whatever `r` was. So a chained gather refined its
 * base to a collection OF collections: with `Z` undeclared,
 * `(Z[1..p-1])[W]` made `Z` an `indexed_collection<indexed_collection<…>>`,
 * `(Z[1..p-1])[W] = Z[p]` then typed `list<boolean | missing>`, and the Desmos
 * importer's filter-index predicate was refused with
 * `expected (number) any -> boolean` (Tycho item 258).
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// The type of the first occurrence of `name` in `expr`: the refinement is
// read by the occurrences of the expression that uses the name.
function typeOf(expr: Expression, name: string): string | undefined {
  if (expr.symbol === name) return expr.type.toString();
  for (const op of expr.ops ?? []) {
    const t = typeOf(op, name);
    if (t !== undefined) return t;
  }
  return undefined;
}

describe('Tycho 258 — a gather index does not make the base nested', () => {
  // The importer's normalization scope declares nothing: values never enter it.
  test('a chained gather leaves the base a flat collection', () => {
    const ce = new ComputeEngine();
    const gather = ['At', 'Z', ['Range', 1, ['Subtract', 'p', 1]]];
    const expr = ce.box(['Equal', ['At', gather, 'W'], ['At', 'Z', 'p']]);
    const z = typeOf(expr, 'Z');
    expect(z).toBe('dictionary<any> | indexed_collection<any>');
    expect(z).not.toMatch(/indexed_collection<(dictionary|indexed_collection)/);
  });

  test('the comparison types as a boolean, not a list of them', () => {
    const ce = new ComputeEngine();
    const gather = ['At', 'Z', ['Range', 1, ['Subtract', 'p', 1]]];
    expect(
      ce.box(['Equal', ['At', gather, 'W'], ['At', 'Z', 'p']]).type.toString()
    ).toBe('broadcastable<boolean>');
  });

  test('the importer’s filter-index predicate is accepted', () => {
    const ce = new ComputeEngine();
    const filter = [
      'Filter',
      ['Range', 1, ['Subtract', 'p', 1]],
      [
        'Function',
        [
          'Equal',
          [
            'At',
            ['Delimiter', ['At', 'Z', ['Range', 1, ['Subtract', 'p', 1]]]],
            'W',
          ],
          ['At', 'Z', 'p'],
        ],
        'W',
      ],
    ];
    expect(ce.box(filter).isValid).toBe(true);
  });

  // The controls: the refinement must keep working where it was right.
  test('a scalar index still refines the element type', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Add', ['At', 'ys', 1], 1]);
    expect(typeOf(expr, 'ys')).toBe('indexed_collection<number>');
  });

  test('a gather with a SCALAR requirement still refines the element type', () => {
    // The consumer broadcasts over the selected list, so this really does
    // prove the elements are numbers.
    const ce = new ComputeEngine();
    const expr = ce.box(['Add', ['At', 'xs', ['List', 1, 2]], 1]);
    expect(typeOf(expr, 'xs')).toBe('indexed_collection<number>');
  });

  test('a declared base is unaffected', () => {
    const ce = new ComputeEngine();
    ce.declare('Z', 'list<integer>');
    const gather = ['At', 'Z', ['Range', 1, ['Subtract', 'p', 1]]];
    expect(ce.box(['At', gather, 'W']).isValid).toBe(true);
    expect(ce.symbol('Z')?.type.toString()).toBe('list<integer>');
  });
});
