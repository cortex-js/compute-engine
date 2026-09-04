/**
 * A derived type is bounded in size (`TYPE_SIZE_LIMIT` nodes,
 * `src/common/type/size-cap.ts`).
 *
 * A boxed expression is a DAG: a value built from one sub-expression
 * referenced twice holds the same object twice. `t = Tuple(t, t)` repeated
 * k times is k + 1 nodes with 2^k leaves, and its honest type names one slot
 * per leaf. Every type-level reader walks a type as a tree, so `Length`,
 * `Element`, `Negate` and a printed hover over such a value doubled with
 * each level (14 s for `Negate` at 20 levels). A dimensioned list type
 * summarizes a regular shape and never had this cost; tuples, ragged lists
 * and records have no summary, so past the bound the components of a
 * derived type are flattened to their kind and arity with `any` slots.
 */

import { ComputeEngine } from '../../src/compute-engine';
import {
  boundTypeSize,
  TYPE_SIZE_LIMIT,
  typeSizeUpTo,
} from '../../src/common/type/size-cap';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import { isSubtype } from '../../src/common/type/subtype';

const ce = new ComputeEngine();

/** `head(t, t)` nested `depth` times over a symbolic leaf. */
function sharedTower(head: string, depth: number, width = 2) {
  let t = ce.parse('x + 1');
  for (let k = 0; k < depth; k++)
    t = ce.function(head, Array.from({ length: width }, () => t));
  return t;
}

describe('boundTypeSize', () => {
  const bound = (s: string, limit?: number) =>
    typeToString(boundTypeSize(parseType(s)!, limit));

  test('a type under the limit is returned as is', () => {
    const t = parseType('tuple<number, list<integer>>')!;
    expect(boundTypeSize(t)).toBe(t);
  });

  test('the size counts one node per primitive and per compound', () => {
    expect(typeSizeUpTo('number', 10)).toBe(1);
    expect(typeSizeUpTo(parseType('list<number>')!, 10)).toBe(2);
    expect(typeSizeUpTo(parseType('tuple<number, string>')!, 10)).toBe(3);
    expect(typeSizeUpTo(parseType('(number, string) -> boolean')!, 10)).toBe(
      4
    );
    expect(
      typeSizeUpTo(parseType('record{a: number, b: list<string>}')!, 10)
    ).toBe(4);
  });

  test('compound components keep their kind and arity with any slots', () => {
    // 1 + 2 × 3 = 7 nodes; with a limit of 4 the pairs flatten, and the
    // outer tuple keeps its shape.
    expect(bound('tuple<tuple<number, number>, tuple<number, number>>', 4)).toBe(
      'tuple<tuple<any, any>, tuple<any, any>>'
    );
    expect(bound('list<tuple<number, number>>', 2)).toBe(
      'list<tuple<any, any>>'
    );
    expect(bound('tuple<a: list<number>, b: (number) -> number>', 3)).toBe(
      'tuple<a: list<any>, b: function>'
    );
    expect(bound('record{p: tuple<number, number>, q: number}', 3)).toBe(
      'record{p: tuple<any, any>, q: number}'
    );
  });

  test('a flattened slot admits absence: the result is a supertype', () => {
    // `unknown` excludes `missing` and `nothing`; `any` does not.
    const t = parseType('tuple<tuple<integer | missing, nothing>, number>')!;
    const b = boundTypeSize(t, 3);
    expect(typeToString(b)).toBe('tuple<tuple<any, any>, number>');
    expect(isSubtype(t, b)).toBe(true);
    expect(isSubtype(parseType('tuple<tuple<missing, nothing>, number>')!, b)).toBe(
      true
    );
  });

  test('a negation of a leaf stays; a negation of a compound widens', () => {
    expect(bound('tuple<!string, tuple<number, number>>', 3)).toBe(
      'tuple<!string, tuple<any, any>>'
    );
  });

  test('a wide flat type is kept: it is linear in the value it describes', () => {
    const wide = `tuple<${Array(TYPE_SIZE_LIMIT).fill('number').join(', ')}>`;
    expect(bound(wide)).toBe(wide);
    const fields = Array.from(
      { length: TYPE_SIZE_LIMIT },
      (_, i) => `f${i}: number`
    );
    const record = `record{${fields.join(', ')}}`;
    expect(bound(record)).toBe(record);
  });

  test('a union of flattened members is deduplicated and unwrapped', () => {
    const b = boundTypeSize(
      parseType('list<tuple<number, number> | tuple<string, string>>')!,
      3
    );
    expect(typeToString(b)).toBe('list<tuple<any, any>>');
    // One member left: the union wrapper is gone, not kept around one type.
    expect((b as any).elements.kind).toBe('tuple');
    expect(bound('list<list<number> | list<string>>', 3)).toBe('list<list<any>>');
    // Two members of different kinds stay two members.
    expect(bound('list<list<number> | tuple<number, number>>', 3)).toBe(
      'list<list<any> | tuple<any, any>>'
    );
  });

  test('a broadcastable keeps its wrapper; a dimensioned list is small', () => {
    expect(bound('broadcastable<tuple<number, number>>', 2)).toBe(
      'broadcastable<tuple<any, any>>'
    );
    // `vector<3>` is `list<number^3>`: the dimensions are not nodes.
    expect(typeSizeUpTo(parseType('list<vector<3>>')!, 10)).toBe(3);
  });
});

describe('derived types of a shared tower', () => {
  test('a tuple tower of any depth types in bounded size', () => {
    // Milliseconds when bounded; the unbounded types doubled every level, and
    // the test timeout is the guard against a return to that.
    const tower = sharedTower('Tuple', 26);
    const type = tower.type.toString();
    const length = ce.function('Length', [tower]);
    const element = ce.function('Element', [ce.symbol('n'), tower]);
    const negated = ce.function('Negate', [tower]);
    // 27 nodes, 2^26 leaves. The honest type has 2^26 slots; the stored one
    // regrows from each flattening and never passes twice the limit, and its
    // outer levels keep their shape.
    expect(typeSizeUpTo(tower.type.type, 10 * TYPE_SIZE_LIMIT)).toBeLessThan(
      2 * TYPE_SIZE_LIMIT
    );
    expect(type.startsWith('tuple<tuple<')).toBe(true);
    expect(length.type.toString()).toBe('integer');
    expect(element.type.toString()).toBe('boolean');
    expect(negated.operator).toBe('Tuple');
  });

  test('a wide shared tower is bounded by its arities, not by its depth', () => {
    // 64 copies of one child, nested 5 deep: 6 nodes, 64^5 ≈ 10^9 leaves.
    // The stored type is the top level over 64 flattened components of 64
    // `unknown` slots each — 1 + 64 × 65 nodes — and the same at any depth.
    const size = (depth: number) =>
      typeSizeUpTo(sharedTower('Tuple', depth, 64).type.type, 10 ** 5);
    expect(size(5)).toBe(1 + 64 * 65);
    expect(size(8)).toBe(1 + 64 * 65);
    const length = ce.function('Length', [sharedTower('Tuple', 8, 64)]);
    expect(length.type.toString()).toBe('integer');
  });

  test('a ragged shared list is bounded too', () => {
    // L_k = List(L_{k-1}, L_{k-2}): the shape claim is declined and the type
    // falls back to `list<A | B>` over the children's types, one node per
    // level with Fibonacci-many leaves.
    let a = ce.parse('x + 1');
    let b = ce.function('List', [a, a]);
    for (let k = 0; k < 40; k++) {
      const c = ce.function('List', [b, a]);
      a = b;
      b = c;
    }
    const type = b.type.toString();
    expect(type.startsWith('list<')).toBe(true);
    expect(typeSizeUpTo(b.type.type, 10 * TYPE_SIZE_LIMIT)).toBeLessThan(
      2 * TYPE_SIZE_LIMIT
    );
    expect(ce.function('Length', [b]).type.toString()).toBe('integer');
    expect(ce.function('Hold', [b]).type.toString()).toBe('unknown');
  });

  test('a dictionary tower is bounded at its own storage site', () => {
    // A dictionary literal stores its `record{…}` type itself, outside the
    // function-node chokepoint: `{a: d, b: d}` nested 26 times has one
    // field per path.
    let d = ce.box({ dict: { x: 1, y: 2 } });
    for (let k = 0; k < 26; k++) d = ce.box({ dict: { a: d, b: d } } as any);
    const type = d.type.toString();
    expect(type.startsWith('record{a: record{')).toBe(true);
    expect(typeSizeUpTo(d.type.type, 10 * TYPE_SIZE_LIMIT)).toBeLessThan(
      2 * TYPE_SIZE_LIMIT
    );
  });

  test('arithmetic over a flattened tower is still component-wise', () => {
    // A tower of points ten deep: 2048 leaves, a type past the bound. Every
    // form evaluates to a tuple of the same shape, as it does under the
    // bound (the `tuples` broadcast exemption and the component-wise arms
    // recognize a tuple with `any` components).
    let t = ce.parse('(1, 2)');
    for (let k = 0; k < 10; k++) t = ce.function('Tuple', [t, t]);
    expect(typeSizeUpTo(t.type.type, 10 * TYPE_SIZE_LIMIT)).toBeGreaterThan(
      7
    );
    const leaves = (e: typeof t): number =>
      e.operator === 'Tuple' ? e.ops!.reduce((a, o) => a + leaves(o), 0) : 1;
    const firstLeaf = (e: typeof t): string =>
      e.operator === 'Tuple' ? firstLeaf(e.ops![0]) : e.toString();
    const forms = {
      '2t': ce.function('Multiply', [ce.number(2), t]),
      't+t': ce.function('Add', [t, t]),
      '-t': ce.function('Negate', [t]),
      't-t': ce.function('Subtract', [t, t]),
      't/2': ce.function('Divide', [t, ce.number(2)]),
    };
    const got = Object.fromEntries(
      Object.entries(forms).map(([k, e]) => {
        const v = e.evaluate();
        return [k, [v.operator, leaves(v), firstLeaf(v)]];
      })
    );
    expect(got).toEqual({
      '2t': ['Tuple', 2048, '2'],
      't+t': ['Tuple', 2048, '2'],
      '-t': ['Tuple', 2048, '-1'],
      't-t': ['Tuple', 2048, '0'],
      't/2': ['Tuple', 2048, '1/2'],
    });
  });

  test('a regular list tower keeps its dimensioned type', () => {
    // The dimensioned list type is already a summary and is never widened.
    const tower = sharedTower('List', 26);
    expect(tower.type.toString()).toBe(
      `list<number^(${Array(26).fill('2').join('x')})>`
    );
  });
});

describe('wide literals', () => {
  test('a wide flat tuple keeps every slot type', () => {
    // Width alone is linear in the literal, so it is never flattened: a
    // 300-element tuple of integers types with 300 `integer` slots, and its
    // slot-precise reads keep their types.
    const wide = ce.function(
      'Tuple',
      Array.from({ length: 300 }, (_, i) => ce.number(i + 1))
    );
    expect(wide.type.toString()).toBe(
      `tuple<${Array(300).fill('integer').join(', ')}>`
    );
    expect(ce.function('Length', [wide]).evaluate().toString()).toBe('300');
    expect(ce.function('At', [wide, ce.number(200)]).evaluate().toString()).toBe(
      '200'
    );
  });

  test('a point and a point list are far under the limit', () => {
    expect(ce.parse('(1, 2)').type.toString()).toBe('tuple<integer, integer>');
    expect(ce.parse('[(1, 2), (3, 4)]').type.toString()).toBe(
      'list<tuple<integer, integer>^2>'
    );
  });

  test('a wide numeric tuple still takes part in tuple arithmetic', () => {
    const wide = ce.function(
      'Tuple',
      Array.from({ length: 300 }, (_, i) => ce.number(i + 1))
    );
    const scaled = ce.function('Multiply', [ce.number(2), wide]);
    expect(scaled.type.matches('tuple')).toBe(true);
    const v = scaled.evaluate();
    expect(v.operator).toBe('Tuple');
    expect(v.nops).toBe(300);
    expect(v.ops![299].toString()).toBe('600');
  });
});
