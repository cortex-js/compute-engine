/**
 * The kind of the result of a collection literal with a spread, and of `Join`
 * and `Append` over an operand that may hold a set (user decision
 * 2026-09-29).
 *
 * Part 1. A list literal with a spread, `[...a, 0]`, is ALWAYS a list,
 * whatever `a` holds: a list, a set (its elements in its iteration order,
 * without deduplication), a range, a lazy view. Its canonical form is
 * `ListJoin(a, [0])`. Before, it was `Join(a, [0])`, and `Join` adopts the
 * kind of its operands, so `g(a) = [...a, 0]` called with a set returned a
 * set. A set literal with a spread, `{...a, 0}`, is always a set.
 *
 * Part 2. `Join` and `Append` over an operand declared with an abstract
 * collection type (`collection<T>`), which may hold a set, are typed
 * `collection<T>`, and their value does not depend on the `materialization`
 * option: the kind follows the value the operand holds. Before, they were
 * typed `list<T>`, `evaluate()` gave `Set(3, 1, 5)` and
 * `evaluate({ materialization: true })` gave `[3, 1, 5]`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';
import { executeEpsil, parseEpsil, serializeEpsil } from '../../src/epsil';
import { compile } from '../../src/compile';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';
import {
  evaluateListRecursion,
  listRecursionPlan,
} from '../../src/compute-engine/boxed-expression/recursive-list-builder';

type MathJson = any;

/** The value of the last statement of an Epsil program. */
function epsil(source: string): Expression {
  const r = executeEpsil(new ComputeEngine(), source);
  expect(r.value).toBeDefined();
  return r.value!;
}

/** The materialized value of an expression: a `List` or a `Set` literal. */
function materialized(expr: Expression): Expression {
  return expr.evaluate({ materialization: true });
}

// Each source is a value to spread, written in Epsil and in MathJSON, with
// the elements it contributes, in order.
const SOURCES: [string, string, MathJson, string][] = [
  ['a list', '[3, 1, 1]', ['List', 3, 1, 1], '3,1,1'],
  ['a set', '{3, 1}', ['Set', 3, 1], '3,1'],
  ['a range', '1..3', ['Range', 1, 3], '1,2,3'],
  [
    'a lazy Map',
    'map((x) => 2 * x, 1..3)',
    ['Map', ['Function', ['Multiply', 2, 'x'], 'x'], ['Range', 1, 3]],
    '2,4,6',
  ],
];

/** The string of a set with the distinct elements of `elements`, in order. */
function setString(elements: string): string {
  const distinct = [...new Set(elements.split(','))];
  return `Set(${distinct.join(', ')})`;
}

describe('A list literal with a spread is a list', () => {
  for (const [name, source, json, elements] of SOURCES) {
    describe(`spread of ${name}`, () => {
      const expected = `[${elements},0]`;

      test('Epsil route, top level', () => {
        const v = epsil(`let s = ${source}\n[...s, 0]`);
        expect(v.toString()).toBe(expected);
        expect(materialized(v).operator).toBe('List');
        expect(isSubtype(v.type.type, 'list<any>')).toBe(true);
      });

      test('Epsil route, expression-body function', () => {
        const v = epsil(`g(a) = [...a, 0]\ng(${source})`);
        expect(v.toString()).toBe(expected);
        expect(materialized(v).operator).toBe('List');
      });

      test('Epsil route, block-body function', () => {
        const v = epsil(`function g(a) { [...a, 0] }\ng(${source})`);
        expect(v.toString()).toBe(expected);
        expect(materialized(v).operator).toBe('List');
      });

      test('box route, top level', () => {
        const ce = new ComputeEngine();
        ce.assign('s', ce.box(json));
        const expr = ce.box(['List', ['Spread', 's'], 0]);
        expect(expr.operator).toBe('ListJoin');
        const staticType = expr.type;
        expect(isSubtype(staticType.type, 'list<any>')).toBe(true);
        const v = materialized(expr);
        expect(v.operator).toBe('List');
        expect(v.toString()).toBe(expected);
        expect(isSubtype(v.type.type, staticType.type)).toBe(true);
        // The same value without the materialization option.
        expect(expr.evaluate().toString()).toBe(expected);
        // A literal operand of the spread.
        expect(
          materialized(ce.box(['List', ['Spread', json], 0])).toString()
        ).toBe(expected);
      });

      test('box route, function body', () => {
        const ce = new ComputeEngine();
        const fn = ce.box(['Function', ['List', ['Spread', 'a'], 0], 'a']);
        expect(fn.type.toString()).toBe('(a: collection<any>) -> list<any>');
        ce.assign('g', fn);
        const call = ce.box(['g', json]);
        const staticType = call.type;
        expect(isSubtype(staticType.type, 'list<any>')).toBe(true);
        const v = materialized(call);
        expect(v.operator).toBe('List');
        expect(v.toString()).toBe(expected);
        expect(isSubtype(v.type.type, staticType.type)).toBe(true);
      });

      test('a set literal with a spread is a set', () => {
        const v = epsil(`let s = ${source}\n{...s, 0}`);
        expect(materialized(v).operator).toBe('Set');
        expect(v.toString()).toBe(setString(`${elements},0`));
        const w = epsil(`g(a) = {...a, 0}\ng(${source})`);
        expect(materialized(w).operator).toBe('Set');
        expect(w.toString()).toBe(setString(`${elements},0`));

        const ce = new ComputeEngine();
        ce.assign('s', ce.box(json));
        const expr = ce.box(['Set', ['Spread', 's'], 0]);
        expect(isSubtype(expr.type.type, 'set<any>')).toBe(true);
        const m = materialized(expr);
        expect(m.operator).toBe('Set');
        expect(isSubtype(m.type.type, expr.type.type)).toBe(true);
      });
    });
  }

  test('two spreads', () => {
    expect(
      epsil('let a = {3, 1}\nlet b = [1, 2]\n[...a, ...b]').toString()
    ).toBe('[3,1,1,2]');
    expect(epsil('g(a, b) = [...a, ...b]\ng({3, 1}, 1..2)').toString()).toBe(
      '[3,1,1,2]'
    );
    const ce = new ComputeEngine();
    ce.assign('a', ce.box(['Set', 3, 1]));
    ce.assign('b', ce.box(['List', 1, 2]));
    const v = materialized(
      ce.box(['List', ['Spread', 'a'], ['Spread', 'b'], 0])
    );
    expect(v.json).toEqual(['List', 3, 1, 1, 2, 0]);
  });

  test('spread of a call result', () => {
    expect(epsil('f(n) = {n, n + 1}\n[...f(1), 0]').toString()).toBe('[1,2,0]');
    expect(
      epsil('f(n) = {n, n + 1}\ng(n) = [...f(n), 0]\ng(4)').toString()
    ).toBe('[4,5,0]');
  });

  test('a string spread gives a list of characters', () => {
    const ce = new ComputeEngine();
    const v = materialized(ce.box(['List', ['Spread', { str: 'ab' }], 0]));
    expect(v.operator).toBe('List');
    expect(v.toString()).toBe('["a","b",0]');
  });

  test('an infinite spread stays lazy, also through a function', () => {
    const ce = new ComputeEngine();
    const inf = ['Range', 1, { num: '+Infinity' }];
    expect(
      ce
        .box(['Take', ['List', ['Spread', inf], 0], 3])
        .evaluate()
        .toString()
    ).toBe('[1,2,3]');
    ce.assign('g', ce.box(['Function', ['List', ['Spread', 'a'], 0], 'a']));
    expect(
      ce
        .box(['Take', ['g', inf], 3])
        .evaluate()
        .toString()
    ).toBe('[1,2,3]');
  });

  test('a spread of a set is not deduplicated against the other elements', () => {
    const ce = new ComputeEngine();
    ce.assign('s', ce.box(['Set', 3, 1]));
    const expr = ce.box(['List', ['Spread', 's'], 3, 3]);
    expect(expr.evaluate().toString()).toBe('[3,1,3,3]');
    expect(expr.evaluate().count).toBe(4);
  });
});

describe('Serialization of a list literal with a spread', () => {
  const ce = new ComputeEngine();
  for (const source of [
    '[...a, 0]',
    '[1, ...a, 2, 3]',
    '[...a, ...b]',
    '[...a]',
    '[...f(x), 1]',
  ]) {
    test(source, () => {
      const [json] = parseEpsil(source);
      const expr = ce.box(json as MathJson);
      expect(expr.operator).toBe('ListJoin');
      // Epsil writes the canonical form back as the literal.
      expect(serializeEpsil(expr.json as MathJson)).toBe(source);
      // LaTeX has no spread syntax: the canonical form is written as a
      // function and parses back to the same expression.
      expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
    });
  }
});

describe('A join over an unresolved operand', () => {
  // A call of a function with no known result type may return a list. The
  // join cannot be enumerated before the call is resolved, so it prints as
  // itself. Before, its preview dropped the call: `Join(f(x), [1])` printed
  // as `[1]`.
  test('prints the operand', () => {
    const ce = new ComputeEngine();
    const join = ce.box(['Join', ['f', 'x'], ['List', 1]]);
    expect(join.toString()).toBe('Join(f(x), [1])');
    expect(ce.parse(join.latex).isSame(join)).toBe(true);
    const literal = ce.box(['List', ['Spread', ['f', 'x']], 1]);
    expect(literal.toString()).toBe('ListJoin(f(x), [1])');
  });
});

describe('Compilation of a list literal with a spread', () => {
  test('a spread of a list and of a set compile', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<number>');
    ce.declare('s', 'set<number>');
    for (const name of ['xs', 's']) {
      const result = compile(ce.box(['List', ['Spread', name], 0]), {
        fallback: false,
      } as any);
      expect(result.success).toBe(true);
    }
    const f = compile(ce.box(['List', ['Spread', 'xs'], 0]));
    expect(f.run!({ xs: [1, 2] } as any)).toEqual([1, 2, 0]);
  });
});

describe('Join and Append over an operand that may hold a set', () => {
  const ce = new ComputeEngine();

  const DECLARATIONS = [
    'collection<number>',
    'collection<any>',
    'indexed_collection<number>',
    'list<number>',
  ];

  const VALUES: [string, MathJson][] = [
    ['list', ['List', 3, 1, 1]],
    ['set', ['Set', 3, 1]],
    ['range', ['Range', 1, 3]],
  ];

  const OPERATORS: [string, (s: string) => MathJson, Record<string, string>][] =
    [
      [
        'Join',
        (s) => ['Join', s, ['List', 5, 3]],
        { list: '[3,1,1,5,3]', set: 'Set(3, 1, 5)', range: '[1,2,3,5,3]' },
      ],
      [
        'Append',
        (s) => ['Append', s, 5],
        { list: '[3,1,1,5]', set: 'Set(3, 1, 5)', range: '[1,2,3,5]' },
      ],
    ];

  let counter = 0;
  for (const [op, make, expected] of OPERATORS) {
    for (const declaration of DECLARATIONS) {
      const abstract = declaration.startsWith('collection');
      for (const [valueName, value] of VALUES) {
        // A symbol declared `indexed_collection<T>` or `list<T>` cannot hold
        // a set, and a symbol declared `list<T>` cannot hold a range: the
        // assignment is refused.
        if (!abstract && valueName === 'set') continue;
        if (declaration.startsWith('list') && valueName === 'range') continue;
        test(`${op} over ${declaration} holding a ${valueName}`, () => {
          const name = `P${++counter}`;
          ce.declare(name, declaration);
          ce.assign(name, ce.box(value));
          const expr = ce.box(make(name));
          // The static type admits a set exactly when the operand may hold
          // one.
          expect(expr.type.toString()).toBe(
            abstract
              ? declaration === 'collection<any>'
                ? 'collection<any>'
                : 'collection<number>'
              : 'list<number>'
          );
          const plain = expr.evaluate();
          const full = expr.evaluate({ materialization: true });
          expect(plain.toString()).toBe(expected[valueName]);
          expect(full.toString()).toBe(expected[valueName]);
          expect(full.operator).toBe(valueName === 'set' ? 'Set' : 'List');
          expect(isSubtype(full.type.type, expr.type.type)).toBe(true);
          // The unevaluated node counts its distinct elements when it is a
          // set.
          expect(expr.count).toBe(full.nops);
        });
      }
    }
  }

  test('the kind follows a later assignment', () => {
    ce.declare('Q', 'collection<number>');
    ce.assign('Q', ce.box(['List', 3, 1, 1]));
    const expr = ce.box(['Join', 'Q', ['List', 5]]);
    expect(expr.evaluate({ materialization: true }).operator).toBe('List');
    ce.assign('Q', ce.box(['Set', 3, 1]));
    expect(expr.evaluate({ materialization: true }).operator).toBe('Set');
    expect(expr.evaluate().toString()).toBe('Set(3, 1, 5)');
  });

  // The same rule reaches `Map`, which keeps the kind of its source: over a
  // source declared `collection<T>` that holds a set, the lazy node
  // enumerates and counts the distinct values, as its materialized value
  // does.
  test('a Map over an operand that holds a set counts distinct values', () => {
    ce.declare('R', 'collection<number>');
    ce.assign('R', ce.box(['Set', 3, 1]));
    const m = ce.box(['Map', ['Function', 1, 'x'], 'R']);
    expect(m.count).toBe(1);
    expect(m.evaluate({ materialization: true }).toString()).toBe('Set(1)');
    ce.declare('S', 'collection<number>');
    ce.assign('S', ce.box(['List', 3, 1, 1]));
    expect(ce.box(['Map', ['Function', 1, 'x'], 'S']).count).toBe(3);
  });

  test('a join with a set operand is still a set', () => {
    expect(
      ce
        .box(['Join', ['Set', 3, 1], ['List', 5, 3]])
        .evaluate()
        .toString()
    ).toBe('Set(3, 1, 5)');
  });
});

describe('Element reads of a list literal with a spread of a collection that is not indexed', () => {
  // `ListJoin` is typed as a list, so it reports itself as indexed whatever
  // its operands hold. An operand declared `collection` may hold a set, a
  // dictionary or a lazy view over a set, which have no positional `at`:
  // such an operand is read by position through its iterator.
  const HELD: [string, MathJson, string[]][] = [
    ['a set', ['Set', 3, 1], ['3', '1']],
    [
      'a dictionary',
      ['Dictionary', ['Tuple', "'x'", 1], ['Tuple', "'y'", 2]],
      ['("x", 1)', '("y", 2)'],
    ],
    [
      'a lazy Map over a set',
      ['Map', ['Function', ['Multiply', 2, 'x'], 'x'], ['Set', 3, 1]],
      ['6', '2'],
    ],
  ];
  for (const [name, value, elements] of HELD) {
    test(`an operand that holds ${name}`, () => {
      const ce = new ComputeEngine();
      ce.declare('s', 'collection');
      ce.assign('s', ce.box(value));
      const e = ce.box(['List', ['Spread', 's'], 0]);
      expect(e.operator).toBe('ListJoin');
      const all = [...elements, '0'];
      expect(e.count).toBe(3);
      expect([...e.each()].map((x) => x.toString())).toEqual(all);
      expect([1, 2, 3].map((i) => e.at(i)?.toString())).toEqual(all);
      expect(e.at(-1)?.toString()).toBe('0');
      expect(e.at(-3)?.toString()).toBe(all[0]);
      expect(e.at(4)).toBeUndefined();
      for (let k = 1; k <= 3; k++)
        expect(
          ce
            .box(['At', ['List', ['Spread', 's'], 0], k])
            .evaluate()
            .toString()
        ).toBe(all[k - 1]);
      expect(e.evaluate().toString()).toBe(`[${all.join(',')}]`);
      const v = e.evaluate({ materialization: true });
      expect(v.operator).toBe('List');
      expect(v.ops!.map((x) => x.toString())).toEqual(all);
    });
  }
});

describe('Join over operands that may hold a set or a dictionary', () => {
  // The kind of a `Join` over operands declared `collection` follows the
  // values they hold, with the precedence of the static rule: a keyed
  // operand makes the result keyed, else a set operand makes it a set, else
  // it is a list. The value is the same with and without
  // `materialization: true`.
  const D1: MathJson = ['Dictionary', ['Tuple', "'x'", 1]];
  const D2: MathJson = ['Dictionary', ['Tuple', "'y'", 2]];
  const CASES: [string, MathJson, MathJson, string | undefined][] = [
    ['two dictionaries', D1, D2, '{"x" -> 1, "y" -> 2}'],
    ['two sets', ['Set', 1, 2], ['Set', 2, 3], 'Set(1, 2, 3)'],
    ['a set and a list', ['Set', 1, 2], ['List', 2, 3], 'Set(1, 2, 3)'],
    // A dictionary and a list: the result is keyed, as the static
    // `Join(Dictionary(…), List(…))` is, and a list element is not an
    // entry, so the value is the error value the static join gives.
    ['a dictionary and a list', D1, ['List', 2, 3], undefined],
  ];
  for (const [name, a, b, expected] of CASES) {
    test(name, () => {
      const ce = new ComputeEngine();
      ce.declare('a', 'collection');
      ce.declare('b', 'collection');
      ce.assign('a', ce.box(a));
      ce.assign('b', ce.box(b));
      const e = ce.box(['Join', 'a', 'b']);
      expect(e.type.toString()).toMatch(/^collection/);
      const plain = e.evaluate().toString();
      const full = e.evaluate({ materialization: true }).toString();
      expect(full).toBe(plain);
      const literal = ce.box(['Join', a, b]).evaluate().toString();
      expect(plain).toBe(expected ?? literal);
      if (expected === undefined)
        expect(e.evaluate({ materialization: true }).operator).toBe('Error');
    });
  }

  test('a function that joins two dictionaries', () => {
    const v = epsil('h(a, b) = join(a, b)\nh({"x" -> 1}, {"y" -> 2})');
    expect(v.toString()).toBe('{"x" -> 1, "y" -> 2}');
  });
});

describe('Only the sources decide the kind of an abstract-typed node', () => {
  test('an Append whose appended element is a set', () => {
    // `s` is an ELEMENT of the `Append`, not its source: it does not make
    // the result a set, and the repeated `[1]` of the source is kept.
    const ce = new ComputeEngine();
    ce.declare('s', 'collection');
    ce.declare('acc', 'collection');
    ce.assign('s', ce.box(['Set', 2, 3]));
    ce.assign('acc', ce.box(['List', ['List', 1], ['List', 1]]));
    const e = ce.box(['Append', 'acc', 's']);
    expect(e.isIndexedCollection).toBe(true);
    const expected = '[[1],[1],Set(2, 3)]';
    expect(e.evaluate().toString()).toBe(expected);
    expect(e.evaluate({ materialization: true }).toString()).toBe(expected);
  });

  test('a Scan with a set seed over a list', () => {
    // The seed of a `Scan` is not a source: the scan of a list is a list.
    const ce = new ComputeEngine();
    ce.declare('seed', 'collection');
    ce.declare('xs', 'collection');
    ce.assign('seed', ce.box(['Set', 7]));
    ce.assign('xs', ce.box(['List', 1, 1, 2]));
    const e = ce.box([
      'Scan',
      'xs',
      ['Function', ['Join', 'acc', ['List', 'x']], 'acc', 'x'],
      'seed',
    ]);
    const expected = '[Set(7, 1),Set(7, 1),Set(7, 1, 2)]';
    expect(e.evaluate().toString()).toBe(expected);
    expect(e.evaluate({ materialization: true }).toString()).toBe(expected);
  });
});

describe('Join over an operand whose type says nothing', () => {
  // An operand typed `any` (or an unresolved call, typed `unknown`) may hold
  // a set, so the join is typed `collection`, and its kind follows the value
  // the operand holds.
  test('a symbol declared any', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'any');
    const e = ce.box(['Join', 'q', ['List', 0]]);
    expect(e.type.toString()).toBe('collection');
    ce.assign('q', ce.box(['List', 1, 2]));
    expect(e.isIndexedCollection).toBe(true);
    expect(e.evaluate().toString()).toBe('[1,2,0]');
    expect(e.evaluate({ materialization: true }).toString()).toBe('[1,2,0]');
    ce.assign('q', ce.box(['Set', 1, 2]));
    expect(e.isIndexedCollection).toBe(false);
    expect(e.evaluate().toString()).toBe('Set(1, 2, 0)');
    expect(e.evaluate({ materialization: true }).toString()).toBe(
      'Set(1, 2, 0)'
    );
  });

  test('an unresolved call', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Join', ['f', 'x'], ['List', 0]]).type.toString()).toBe(
      'collection'
    );
  });
});

describe('A spread of an absent operand', () => {
  // An absent operand is an absent collection (user decision 2026-09-26):
  // the list literal is `Missing`, as `ListJoin(Missing, [0])` is.
  test('value', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['List', ['Spread', 'Missing'], 0]);
    expect(e.json).toEqual(['ListJoin', 'Missing', ['List', 0]]);
    expect(e.evaluate().toString()).toBe('"Missing"');
    expect(
      ce
        .box(['ListJoin', 'Missing', ['List', 0]])
        .evaluate()
        .toString()
    ).toBe('"Missing"');
    // An operand that may be an absent collection is not one element either.
    expect(
      ce
        .box(['List', ['Spread', ['Sort', 'Missing']], 0])
        .evaluate()
        .toString()
    ).toBe('"Missing"');
  });

  test('set literal and the collection converters', () => {
    // `{...Missing, 0}` was `Set(Missing, 0)`, and `SetFrom` of an absent
    // collection was `Set(Missing)`.
    const ce = new ComputeEngine();
    const e = ce.box(['Set', ['Spread', 'Missing'], 0]);
    expect(e.json).toEqual(['SetFrom', ['Join', 'Missing', ['List', 0]]]);
    expect(e.evaluate().toString()).toBe('"Missing"');
    // The type admits the absence marker.
    expect(e.type.toString()).toBe('missing | set');
    expect(
      ce
        .box(['Set', ['Spread', ['Sort', 'Missing']], 0])
        .evaluate()
        .toString()
    ).toBe('"Missing"');
    for (const op of ['SetFrom', 'ListFrom', 'TupleFrom']) {
      expect(ce.box([op, 'Missing']).evaluate().toString()).toBe('"Missing"');
      expect(
        ce
          .box([op, ['Join', 'Missing', ['List', 0]]])
          .evaluate()
          .toString()
      ).toBe('"Missing"');
    }
    // A present collection is unchanged.
    expect(
      ce
        .box(['Set', ['Spread', ['Range', 1, 3]], 0])
        .evaluate()
        .toString()
    ).toBe('Set(1, 2, 3, 0)');
    expect(
      ce
        .box(['SetFrom', ['List', 1, 2, 2]])
        .evaluate()
        .toString()
    ).toBe('Set(1, 2)');
  });

  test('Epsil round trip', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['List', ['Spread', 'Missing'], 0]);
    const source = serializeEpsil(e.json as MathJson);
    expect(source).toBe('[...missing, 0]');
    const [parsed] = parseEpsil(source);
    const back = ce.box(resolveLibraryNames(parsed, source, ce) as never);
    expect(back.isSame(e)).toBe(true);
    expect(epsil('[...missing, 0]').toString()).toBe('"Missing"');
  });
});

describe('Compilation of a consumer of a join over an inferred collection', () => {
  // The parameter `a` of `f(a) = Join(a, [0])` is inferred as
  // `collection<any>`, so the join is typed `collection<any>`. Its compiled
  // value is still a JavaScript array: `a` is checked to be an array at run
  // time. A consumer of the join must compile, and give the value the
  // interpreter gives.
  const SHAPES: [string, (inner: MathJson) => MathJson, unknown][] = [
    ['Length', (j) => ['Length', j], 3],
    ['Sum', (j) => ['Sum', j], 9],
    [
      'a spread in a list literal',
      (j) => ['List', ['Spread', j], 2],
      [4, 5, 0, 2],
    ],
  ];
  const INNER: MathJson[] = [
    ['Join', 'a', ['List', 0]],
    ['Append', 'a', 0],
    ['ListJoin', 'a', ['List', 0]],
  ];
  for (const [name, make, expected] of SHAPES) {
    for (const inner of INNER) {
      test(`${name} of ${inner[0]}, top level`, () => {
        const ce = new ComputeEngine();
        const e = ce.box(make(inner));
        expect(ce.symbol('a').type.toString()).toBe('collection<any>');
        const result = compile(e, { to: 'javascript', fallback: false } as any);
        expect(result.success).toBe(true);
        expect(result.run!({ a: [4, 5] } as any)).toEqual(expected);
        ce.assign('a', ce.box(['List', 4, 5]));
        expect(e.evaluate().json).toEqual(
          Array.isArray(expected) ? ['List', ...expected] : expected
        );
      });
    }
  }

  const PROGRAMS: [string, string][] = [
    ['Length', 'function f(a) { length(join(a, [0])) }\nf([4, 5])'],
    ['Sum', 'function f(a) { sum(join(a, [0])) }\nf([4, 5])'],
    ['a spread', 'function f(a) { [...join(a, [1]), 2] }\nf([4, 5])'],
    [
      'the result of a call',
      'function f(a) { join(a, [0]) }\nfunction g(b) { length(f(b)) }\ng([4, 5])',
    ],
  ];
  for (const [name, source] of PROGRAMS) {
    test(`${name}, in a function body`, () => {
      const ce = new ComputeEngine();
      const [parsed] = parseEpsil(source);
      const program = ce.box(resolveLibraryNames(parsed, source, ce) as never);
      const result = compile(program, {
        to: 'javascript',
        fallback: false,
      } as any);
      expect(result.success).toBe(true);
      const interpreted = epsil(source);
      expect(JSON.stringify(result.run!())).toBe(
        interpreted.toString().replace(/ /g, '')
      );
    });
  }
});

describe('The head of a list recursion', () => {
  // The fast route of a list-producing recursion rebuilds its result with
  // the head of the recursive arms, so that it answers with the head the
  // ordinary evaluation gives.
  const define = (ce: ComputeEngine, which: MathJson): Expression => {
    ce.declare('F', '(number) -> list<number>');
    ce.assign('F', ce.box(['Function', ['Block', which], 'n']));
    return ce.box('F').value!;
  };
  const call: MathJson = ['F', ['Subtract', 'n', 1]];

  for (const [head, arm] of [
    ['ListJoin', ['List', ['Spread', ['List', 'n']], ['Spread', call]]],
    ['Join', ['Join', ['List', 'n'], call]],
  ] as [string, MathJson][]) {
    test(head, () => {
      const ce = new ComputeEngine();
      const literal = define(ce, [
        'Which',
        ['Less', 'n', 1],
        ['List', 0],
        'True',
        arm,
      ]);
      const plan = listRecursionPlan(literal);
      expect(plan?.head).toBe(head);
      expect(ce.box(['F', 3]).evaluate().toString()).toBe('[3,2,1,0]');
      // One recursive step, then an undecided step whose ordinary
      // evaluation is a symbol: the result keeps its structure, and its head
      // is the head of the arms.
      let calls = 0;
      const result = evaluateListRecursion(plan!, [ce.number(1)], (_, step) => {
        calls += 1;
        if (step === undefined) return ce.symbol('t');
        return calls === 1
          ? ce._fn('Tuple', [
              ce.One,
              ce._fn('List', [ce.One]),
              ce._fn('Tuple', [ce.Zero]),
            ])
          : ce.symbol('t');
      });
      expect(result?.operator).toBe(head);
    });
  }

  test('arms with different heads are left to the ordinary evaluation', () => {
    const ce = new ComputeEngine();
    const literal = define(ce, [
      'Which',
      ['Less', 'n', 1],
      ['List', 0],
      ['Less', 'n', 5],
      ['Join', ['List', 'n'], call],
      'True',
      ['List', ['Spread', ['List', 'n']], ['Spread', call]],
    ]);
    expect(listRecursionPlan(literal)).toBe(undefined);
    expect(ce.box(['F', 6]).evaluate().toString()).toBe('[6,5,4,3,2,1,0]');
  });
});

describe('A predicate shorthand typed broadcastable<boolean>', () => {
  // `_ > P` with `P` declared `number | collection<number>` is typed
  // `broadcastable<boolean>`: it is still a predicate, as the equivalent
  // function literal is, not a value to count.
  test('Count', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'number | collection<number>');
    ce.assign('P', ce.box(1));
    const predicate: MathJson = ['Greater', '_', 'P'];
    expect(ce.box(predicate).type.toString()).toBe('broadcastable<boolean>');
    expect(
      ce
        .box(['Count', ['List', 1, 2, 3], predicate])
        .evaluate()
        .toString()
    ).toBe('2');
    expect(
      ce
        .box([
          'Count',
          ['List', 1, 2, 3],
          ['Function', ['Greater', 'x', 'P'], 'x'],
        ])
        .evaluate()
        .toString()
    ).toBe('2');
  });
});
