import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { isSubtype } from '../../src/common/type/subtype';
import { stripMissingFromType } from '../../src/common/type/utils';
import type { Type } from '../../src/common/type/types';
import {
  hasTupleOrStringArm,
  isRecordOrRecordUnionShapedType,
  isTupleOrTupleUnionShapedType,
  typeCouldBeList,
  typeCouldBeTuple,
} from '../../src/compute-engine/collection-utils';

//
// A tuple is one value, whatever the types of its slots. The bare type
// `tuple` admits values only: a tuple with an absence slot
// (`tuple<integer, missing>`) does NOT match it. So a gate that asks "is
// this operand a tuple?" must test the kind of the type
// (`isTupleShapedType`, or `isTupleOrTupleUnionShapedType` for a union of
// tuples, in `collection-utils.ts`), not `matches('tuple')`.
//
// Before, a tuple symbol with an absence slot was read as a collection to
// splice: it was spread into a list literal (`[...t, 5]` gave
// `[1, Missing, 5]`), spliced by `Join` (count 4 for `Join(t, [3, 4])`),
// judged definitively unequal to a tuple literal, and compiled as a matrix
// operand of `Dot`. Each test below compares an absence-slotted tuple with
// a value-slotted tuple: the two must be treated alike.
//

const SPREAD_ERROR = (name: string) => [
  'Error',
  ['ErrorCode', "'spread-tuple'"],
  `'${name}'`,
];

describe('A TUPLE WITH AN ABSENCE SLOT DOES NOT SPREAD', () => {
  const ce = new ComputeEngine();
  ce.declare('t', 'tuple<integer, missing>');
  ce.declare('u', 'tuple<integer, integer>');
  // A union whose every arm is a tuple is a tuple too.
  ce.declare('w', 'tuple<integer> | tuple<integer, missing>');
  ce.declare('v', 'tuple<integer> | tuple<integer, integer>');

  test.each(['t', 'u', 'w', 'v'])('in a list literal, box route: %s', (s) => {
    expect(ce.box(['List', ['Spread', s], 5]).json).toEqual([
      'List',
      SPREAD_ERROR(s),
      5,
    ]);
  });

  test.each(['t', 'u'])('in a list literal, function route: %s', (s) => {
    const e = ce.function('List', [
      ce.function('Spread', [ce.symbol(s)]),
      ce.number(5),
    ]);
    expect(e.json).toEqual(['List', SPREAD_ERROR(s), 5]);
  });

  test.each(['t', 'u', 'w', 'v'])('in a list literal, parse route: %s', (s) => {
    expect(ce.parse(`\\lbrack\\mathrm{Spread}(${s}), 5\\rbrack`).json).toEqual([
      'List',
      SPREAD_ERROR(s),
      5,
    ]);
  });

  test.each(['t', 'u', 'w', 'v'])('in a set literal, box route: %s', (s) => {
    expect(ce.box(['Set', ['Spread', s], 5]).json).toEqual([
      'Set',
      5,
      SPREAD_ERROR(s),
    ]);
  });

  test.each(['t', 'u', 'w', 'v'])('in a set literal, parse route: %s', (s) => {
    expect(ce.parse(`\\lbrace\\mathrm{Spread}(${s}), 5\\rbrace`).json).toEqual([
      'Set',
      5,
      SPREAD_ERROR(s),
    ]);
  });

  test.each(['t', 'u'])('in a dictionary literal: %s', (s) => {
    expect(ce.box(['Dictionary', ['Spread', s]]).json).toEqual(SPREAD_ERROR(s));
  });

  test('an assigned tuple with an absent slot', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('t', 'tuple<integer, missing>');
    ce2.assign('t', ce2.box(['Tuple', 1, 'Missing']));
    expect(ce2.box(['List', ['Spread', 't'], 5]).evaluate().json).toEqual([
      'List',
      SPREAD_ERROR('t'),
      5,
    ]);
  });
});

describe('JOIN APPENDS A TUPLE WITH AN ABSENCE SLOT AS ONE ELEMENT', () => {
  const ce = new ComputeEngine();
  ce.declare('t', 'tuple<integer, missing>');
  ce.assign('t', ce.box(['Tuple', 1, 'Missing']));
  ce.declare('u', 'tuple<integer, integer>');
  ce.assign('u', ce.box(['Tuple', 1, 2]));

  test.each([
    ['t', ['Tuple', 1, 'Missing']],
    ['u', ['Tuple', 1, 2]],
  ])('box route: %s', (s, tuple) => {
    const j = ce.box(['Join', s, ['List', 3, 4]]);
    expect(j.count).toBe(3);
    expect(ce.box(['Length', j]).evaluate().json).toBe(3);
    expect(ce.box(['At', j, 1]).evaluate().json).toEqual(tuple);
    expect(ce.box(['ListFrom', j]).evaluate().json).toEqual([
      'List',
      tuple,
      3,
      4,
    ]);
  });

  test.each(['t', 'u'])('parse route: %s', (s) => {
    expect(ce.parse(`\\mathrm{Join}(${s}, [3, 4])`).count).toBe(3);
  });

  test('a union of tuples is one element', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('w', 'tuple<integer> | tuple<integer, missing>');
    ce2.declare('v', 'tuple<integer> | tuple<integer, integer>');
    expect(ce2.box(['Join', ['List', 3, 4], 'w']).count).toBe(3);
    expect(ce2.box(['Join', ['List', 3, 4], 'v']).count).toBe(3);
  });

  test('a scalar or a tuple with an absence slot is one element', () => {
    // A union of a scalar and a tuple can only be one element. Before, the
    // absence-slotted arm read as a collection, and `Join` reported an
    // `incompatible-type` error for `s`, but not for `s2`.
    const ce2 = new ComputeEngine();
    ce2.declare('s', 'integer | tuple<integer, missing>');
    ce2.declare('s2', 'integer | tuple<integer, integer>');
    for (const x of ['s', 's2']) {
      expect(ce2.box(['Join', ['List', 3, 4], x]).json).toEqual([
        'List',
        3,
        4,
        x,
      ]);
      expect(ce2.box(['List', ['Spread', x], 5]).json).toEqual(['List', x, 5]);
    }
  });
});

describe('A TUPLE WITH AN ABSENCE SLOT IN A LIST SNAPSHOT COUNTS AS ONE', () => {
  // A list literal with a spread of an impure `Join` is listed only when an
  // upper bound of its cells, found without calling the callbacks, fits in
  // `maxCollectionSize`. A tuple operand of the `Join` is one cell. Before,
  // the tuple with an absence slot counted as its two components, the bound
  // was 5 instead of 4, and the list stayed a lazy `ListJoin` view.
  const ce = new ComputeEngine();
  ce.declare('t', 'tuple<integer, missing>');
  ce.assign('t', ce.box(['Tuple', 1, 'Missing']));
  ce.declare('u', 'tuple<integer, integer>');
  ce.assign('u', ce.box(['Tuple', 1, 2]));
  ce.maxCollectionSize = 4;

  test.each(['t', 'u'])('%s', (s) => {
    const result = ce
      .box([
        'List',
        [
          'Spread',
          ['Join', s, ['Map', ['Function', ['Random'], 'x'], ['Range', 1, 3]]],
        ],
      ])
      .evaluate();
    expect(result.operator).toBe('List');
    expect(result.nops).toBe(4);
  });
});

describe('A TUPLE WITH AN ABSENCE SLOT MAY EQUAL A TUPLE LITERAL', () => {
  // `p` can hold `(1, 2)`, so `(1, 2) = p` is not decided while `p` has no
  // value, as for `q`. Before, `p` was judged definitively unequal (`False`).
  const ce = new ComputeEngine();
  ce.declare('p', 'tuple<integer, integer | missing>');
  ce.declare('q', 'tuple<integer, integer>');

  test.each(['p', 'q'])('box route: %s', (s) => {
    expect(ce.box(['Equal', ['Tuple', 1, 2], s]).evaluate().json).toEqual([
      'Equal',
      ['Tuple', 1, 2],
      s,
    ]);
    expect(ce.box(['Equal', s, ['Tuple', 1, 2]]).evaluate().json).toEqual([
      'Equal',
      s,
      ['Tuple', 1, 2],
    ]);
    expect(ce.box(['NotEqual', ['Tuple', 1, 2], s]).evaluate().json).toEqual([
      'NotEqual',
      ['Tuple', 1, 2],
      s,
    ]);
  });

  test.each(['p', 'q'])('parse route: %s', (s) => {
    expect(ce.parse(`(1, 2) = ${s}`).evaluate().json).toEqual([
      'Equal',
      ['Tuple', 1, 2],
      s,
    ]);
  });

  test.each(['p', 'q'])('isEqual: %s', (s) => {
    expect(ce.box(['Tuple', 1, 2]).isEqual(ce.symbol(s))).toBeUndefined();
  });

  test('with a value', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('p', 'tuple<integer, integer | missing>');
    ce2.assign('p', ce2.box(['Tuple', 1, 2]));
    expect(ce2.box(['Equal', ['Tuple', 1, 2], 'p']).evaluate().json).toBe(
      'True'
    );
  });
});

describe('A TUPLE OF TUPLES WITH ABSENCE SLOTS DOES NOT COMPILE AS A MATRIX', () => {
  // The interpreter does not contract a tuple of tuples (one point with
  // nested coordinates), so the compiled `Dot` declines it. Before, the
  // absence-slotted inner tuples were not seen as tuples, and `Dot(a, a)`
  // compiled to `_SYS.matmul(_.a, _.a)`.
  const ce = new ComputeEngine();
  ce.declare(
    'a',
    'tuple<tuple<real, real | missing>, tuple<real, real | missing>>'
  );
  ce.declare('b', 'tuple<tuple<real, real>, tuple<real, real>>');

  test.each(['a', 'b'])('%s', (s) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(compile(ce.box(['Dot', s, s]))?.success).toBe(false);
      expect(compile(ce.box(['Dot', s, ['Tuple', 1, 2]]))?.success).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('A SELF-REFERENTIAL ALIAS OF A TUPLE UNION', () => {
  // `cyc` reaches itself through a bare union arm. A walk over the arms of a
  // union that unfolds the alias at each step without a descent guard
  // overflowed the stack: the spread and the `Join` below logged "error
  // canonicalizing: Maximum call stack size exceeded". The values of `cyc`
  // are the values of its other arm, so `cyc` is a tuple.
  const ce = new ComputeEngine();
  ce.declareType('cyc', 'cyc | tuple<number, number>', { alias: true });
  ce.declare('c', 'cyc');
  ce.declareType('rcyc', 'rcyc | record{a: integer}', { alias: true });
  ce.declareType('lcyc', 'lcyc | list<integer>', { alias: true });

  function noCanonicalizationError(f: () => unknown): unknown {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = f();
      expect(error).not.toHaveBeenCalled();
      return result;
    } finally {
      error.mockRestore();
    }
  }

  test('a spread is a spread-tuple error', () => {
    expect(
      noCanonicalizationError(() => ce.box(['List', ['Spread', 'c'], 5]).json)
    ).toEqual(['List', SPREAD_ERROR('c'), 5]);
    expect(
      noCanonicalizationError(
        () => ce.parse('\\lbrack\\mathrm{Spread}(c), 5\\rbrack').json
      )
    ).toEqual(['List', SPREAD_ERROR('c'), 5]);
    expect(
      noCanonicalizationError(() => ce.box(['Set', ['Spread', 'c'], 5]).json)
    ).toEqual(['Set', 5, SPREAD_ERROR('c')]);
  });

  test('Join appends it as one element', () => {
    // Before, `isSubtype(cyc, 'collection<any>')` was false, and the operand
    // was an `incompatible-type` error.
    const j = noCanonicalizationError(() =>
      ce.box(['Join', ['List', 3, 4], 'c'])
    ) as ReturnType<typeof ce.box>;
    expect(j.json).toEqual(['Join', ['List', 3, 4], 'c']);
    expect(j.count).toBe(3);
    expect(
      noCanonicalizationError(() => ce.box(['Join', 'c', ['List', 3, 4]]).json)
    ).toEqual(['Join', 'c', ['List', 3, 4]]);
  });

  test('its subtypes', () => {
    // The arm `cyc` adds no value of its own: `cyc` is
    // `tuple<number, number>`. Before, it was a subtype of nothing.
    const T = (s: string) => ce.type(s).type;
    const cyc = T('cyc');
    expect(isSubtype(cyc, T('collection<any>'))).toBe(true);
    expect(isSubtype(cyc, T('tuple'))).toBe(true);
    expect(isSubtype(cyc, T('tuple<number, number>'))).toBe(true);
    expect(isSubtype(cyc, T('integer | tuple<number, number>'))).toBe(true);
    expect(isSubtype(cyc, T('value'))).toBe(true);
    expect(isSubtype(cyc, T('tuple<integer, integer>'))).toBe(false);
    expect(isSubtype(cyc, T('list<number>'))).toBe(false);
    const lcyc = T('lcyc');
    expect(isSubtype(lcyc, T('list<integer>'))).toBe(true);
    expect(isSubtype(lcyc, T('number'))).toBe(false);
    // An alias that reaches itself through a constructor is unchanged.
    ce.declareType('json', 'list<json> | integer', { alias: true });
    expect(isSubtype(T('json'), T('integer'))).toBe(false);
    // The target may be an alias too. Before, the assumption was recorded
    // for the alias `pt` only, and lost once `pt` was read as its definition.
    ce.declareType('pt', 'tuple<number, number>', { alias: true });
    ce.declareType(
      'c2',
      'c2 | tuple<integer, integer> | tuple<number, number>',
      {
        alias: true,
      }
    );
    expect(isSubtype(cyc, T('pt'))).toBe(true);
    expect(isSubtype(cyc, T('c2'))).toBe(true);
    ce.declareType('ipt', 'tuple<integer, integer>', { alias: true });
    expect(isSubtype(cyc, T('ipt'))).toBe(false);
  });

  test('a tuple literal may equal it', () => {
    expect(ce.box(['Equal', ['Tuple', 1, 2], 'c']).evaluate().json).toEqual([
      'Equal',
      ['Tuple', 1, 2],
      'c',
    ]);
  });

  test('the shape predicates', () => {
    const cyc = ce.type('cyc').type;
    const rcyc = ce.type('rcyc').type;
    const lcyc = ce.type('lcyc').type;
    expect(isTupleOrTupleUnionShapedType(cyc)).toBe(true);
    expect(isTupleOrTupleUnionShapedType(lcyc)).toBe(false);
    expect(isRecordOrRecordUnionShapedType(rcyc)).toBe(true);
    expect(isRecordOrRecordUnionShapedType(lcyc)).toBe(false);
    expect(typeCouldBeTuple(cyc)).toBe(true);
    expect(typeCouldBeTuple(lcyc)).toBe(false);
    expect(hasTupleOrStringArm(cyc)).toBe(true);
    expect(hasTupleOrStringArm(lcyc)).toBe(false);
  });
});

describe('A TUPLE LITERAL IS NOT EQUAL ONLY TO A VALUE THAT CANNOT BE A TUPLE', () => {
  // Each of `x` (undeclared), `r`, `s` and `p` can hold `(1, 2)`, so the
  // comparison is not decided while they have no value. Before, a tuple
  // literal was definitively unequal (`False`) to every value whose type is
  // not a tuple, so `(1, 2) = x` was `False`.
  const ce = new ComputeEngine();
  ce.declare('r', 'tuple<integer, integer> | missing');
  ce.declare('s', 'integer | tuple<integer, integer>');
  ce.declare('q', 'tuple<integer, integer>');
  ce.declare('L', 'list<integer>');
  ce.declare('n', 'integer');

  test.each(['x', 'r', 's', 'q', 'L'])('box route: %s', (y) => {
    expect(ce.box(['Equal', ['Tuple', 1, 2], y]).evaluate().json).toEqual([
      'Equal',
      ['Tuple', 1, 2],
      y,
    ]);
    expect(ce.box(['Equal', y, ['Tuple', 1, 2]]).evaluate().json).toEqual([
      'Equal',
      y,
      ['Tuple', 1, 2],
    ]);
  });

  test.each(['x', 'r', 's'])('parse route: %s', (y) => {
    expect(ce.parse(`(1, 2) = ${y}`).evaluate().json).toEqual([
      'Equal',
      ['Tuple', 1, 2],
      y,
    ]);
    expect(ce.parse(`${y} = (1, 2)`).evaluate().json).toEqual([
      'Equal',
      y,
      ['Tuple', 1, 2],
    ]);
  });

  test.each(['x', 'r', 's'])('isEqual: %s', (y) => {
    expect(ce.box(['Tuple', 1, 2]).isEqual(ce.symbol(y))).toBeUndefined();
    expect(ce.symbol(y).isEqual(ce.box(['Tuple', 1, 2]))).toBeUndefined();
  });

  test('an integer cannot be a tuple', () => {
    expect(ce.box(['Equal', ['Tuple', 1, 2], 'n']).evaluate().json).toBe(
      'False'
    );
    expect(ce.box(['Equal', 'n', ['Tuple', 1, 2]]).evaluate().json).toBe(
      'False'
    );
  });
});

describe('A LIST LITERAL IS NOT EQUAL TO A UNION OF TUPLES', () => {
  // Every value of `w` and `v` is a tuple, and a list is never equal to a
  // tuple, as for `t` and `q`. Before, the comparison with a union of tuples
  // stayed undecided.
  const ce = new ComputeEngine();
  ce.declare('t', 'tuple<integer, missing>');
  ce.declare('q', 'tuple<integer, integer>');
  ce.declare('w', 'tuple<integer> | tuple<integer, missing>');
  ce.declare('v', 'tuple<integer> | tuple<integer, integer>');

  test.each(['t', 'q', 'w', 'v'])('%s', (y) => {
    expect(ce.box(['Equal', ['List', 1, 2], y]).evaluate().json).toBe('False');
    expect(ce.box(['Equal', y, ['List', 1, 2]]).evaluate().json).toBe('False');
    expect(ce.parse(`[1, 2] = ${y}`).evaluate().json).toBe('False');
    expect(ce.box(['List', 1, 2]).isEqual(ce.symbol(y))).toBe(false);
    expect(ce.symbol(y).isEqual(ce.box(['List', 1, 2]))).toBe(false);
  });
});

describe('A PARAMETER SLOT WITH AN ALIAS OF A RECORD UNION', () => {
  // A record arm of a slot is not a whole-collection use of the parameter:
  // `h(xs) = g(xs)` stays unlifted, and a list argument is applied element
  // by element. An alias of a union of records is a record arm too. Before,
  // the alias was read as a collection arm, `h` was typed
  // `(xs: recs | value) -> number`, and `h([1, 2])` was an
  // `incompatible-type` error.
  test.each([
    ['recs', 'record{a: integer} | record{b: integer}'],
    ['rec1', 'record{a: integer}'],
  ])('%s', (name, body) => {
    const ce = new ComputeEngine();
    ce.declareType(name, body, { alias: true });
    ce.declare('g', {
      signature: `(integer | ${name}) -> integer`,
      evaluate: (_ops: unknown, { engine }: { engine: ComputeEngine }) =>
        engine.number(7),
    } as never);
    const fn = ce.box(['Function', ['g', 'xs'], 'xs']);
    expect(fn.type.toString()).toBe('(unknown) -> number');
    ce.declare('h', 'function');
    ce.assign('h', fn);
    expect(ce.box(['h', ['List', 1, 2]]).evaluate().json).toEqual([
      'List',
      7,
      7,
    ]);
  });

  test('an alias of a list is a whole-collection arm', () => {
    const ce = new ComputeEngine();
    ce.declareType('lst', 'list<integer>', { alias: true });
    ce.declare('g', {
      signature: '(integer | lst) -> integer',
      evaluate: (_ops: unknown, { engine }: { engine: ComputeEngine }) =>
        engine.number(7),
    } as never);
    const fn = ce.box(['Function', ['g', 'xs'], 'xs']);
    expect(fn.type.toString()).toBe('(xs: lst | value) -> number');
  });
});

describe('A SELF-REFERENTIAL ALIAS DOES NOT OVERFLOW THE STACK', () => {
  // Each alias below names itself, as a bare union arm or as a list
  // element. A recursive walk of a type that unfolds an alias at each step
  // without the descent guard (`unfoldAliasOnDescent`) never stops on such
  // a type. Before, each operation below threw "Maximum call stack size
  // exceeded", or logged it as an error of canonicalization, for at least
  // one of these aliases.
  const ALIASES: [string, string][] = [
    ['cyc', 'cyc | tuple<number, number>'],
    ['lcyc', 'lcyc | list<integer>'],
    ['mcyc', 'mcyc | tuple<number, number> | missing'],
    ['mlcyc', 'mlcyc | list<integer> | missing'],
    ['pcyc', 'pcyc | tuple<number, number> | list<tuple<number, number>>'],
    ['nest', 'list<nest> | integer'],
    ['rcyc', 'rcyc | record{a: integer}'],
    // The alias names itself inside a nested union.
    ['nn2', 'list<integer> | (nn2 | integer)'],
    ['nn3', 'tuple<number, number> | (nn3 | list<integer>) | integer'],
  ];
  const OPERATIONS: [string, unknown][] = [
    ['c + 1', ['Add', 'c', 1]],
    ['[1, 2] + c', ['Add', ['List', 1, 2], 'c']],
    ['c + c', ['Add', 'c', 'c']],
    ['2c', ['Multiply', 2, 'c']],
    ['c (1, 2)', ['Multiply', 'c', ['Tuple', 1, 2]]],
    ['c c', ['Multiply', 'c', 'c']],
    ['c / 2', ['Divide', 'c', 2]],
    ['-c', ['Negate', 'c']],
    ['c^2', ['Power', 'c', 2]],
    ['sin c', ['Sin', 'c']],
    ['sqrt c', ['Sqrt', 'c']],
    ['sign c', ['Sign', 'c']],
    ['floor c', ['Floor', 'c']],
    ['[1, 2] = c', ['Equal', ['List', 1, 2], 'c']],
    ['c[1]', ['At', 'c', 1]],
    ['map', ['Map', 'c', ['Function', ['Add', 'x', 1], 'x']]],
    ['destructuring', ['Block', ['Assign', ['Tuple', 'a', 'b'], 'c'], 'a']],
    ['a function of c', ['Function', ['Add', 'c', 'x'], 'x']],
  ];

  test.each(ALIASES)('%s', (name, definition) => {
    const ce = new ComputeEngine();
    ce.declareType(name, definition, { alias: true });
    ce.declare('c', name);
    const logged: string[] = [];
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const failures: string[] = [];
    try {
      for (const [label, json] of OPERATIONS) {
        for (const [stage, run] of [
          ['type', (e: ReturnType<typeof ce.box>) => e.type.toString()],
          ['evaluate', (e: ReturnType<typeof ce.box>) => e.evaluate()],
          ['N', (e: ReturnType<typeof ce.box>) => e.N()],
        ] as const) {
          logged.length = 0;
          try {
            run(ce.box(json as never));
          } catch (e) {
            if (/call stack/.test((e as Error).message))
              failures.push(`${label} (${stage}): ${(e as Error).message}`);
          }
          for (const line of logged)
            if (/call stack/.test(line))
              failures.push(`${label} (${stage}): ${line}`);
        }
      }
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
    expect(failures).toEqual([]);
  });
});

describe('A LIST LITERAL IS NOT EQUAL ONLY TO A VALUE THAT CANNOT BE A LIST', () => {
  // `x` (undeclared), `g(x)` (an application with no declared result) and
  // `k` (`list<integer> | integer`) can hold `[1, 2]`, so the comparison is
  // not decided. Before, a list literal was definitively unequal (`false`)
  // to every value whose type is not an indexed collection.
  const ce = new ComputeEngine();
  ce.declare('k', 'list<integer> | integer');
  ce.declare('n', 'integer');
  ce.declare('L', 'list<integer>');

  test.each([
    ['x', 'x'],
    ['g(x)', ['g', 'x']],
    ['k', 'k'],
    ['L', 'L'],
  ])('isEqual: %s', (_label, y) => {
    const list = ce.box(['List', 1, 2]);
    const other = ce.box(y as never);
    expect(list.isEqual(other)).toBeUndefined();
    expect(other.isEqual(list)).toBeUndefined();
  });

  test('an integer cannot be a list', () => {
    expect(ce.box(['List', 1, 2]).isEqual(ce.symbol('n'))).toBe(false);
    expect(ce.symbol('n').isEqual(ce.box(['List', 1, 2]))).toBe(false);
  });

  test('Equal with an undeclared symbol or an integer applies to each element', () => {
    // A list beside a value that is not a collection applies the comparison
    // to each element, as before: the result is not a definitive `False`.
    expect(ce.parse('[1, 2] = x').evaluate().json).toEqual([
      'List',
      ['Equal', 1, 'x'],
      ['Equal', 2, 'x'],
    ]);
    expect(ce.parse('[1, 2] = n').evaluate().json).toEqual([
      'List',
      ['Equal', 1, 'n'],
      ['Equal', 2, 'n'],
    ]);
  });

  test('Equal with an application with no declared result is undecided', () => {
    expect(
      ce.box(['Equal', ['List', 1, 2], ['g', 'x']]).evaluate().json
    ).toEqual(['Equal', ['List', 1, 2], ['g', 'x']]);
  });
});

describe('A SELF-REFERENTIAL ALIAS REACHED THROUGH A CONSTRUCTOR', () => {
  // The inner `a` of `list<a | integer>` stands for values deeper in the
  // structure, unlike the arm `cyc` of `cyc | tuple<…>`, which adds no value
  // of its own. A walk cut there must not drop it, and a rewrite of the
  // leaves must not keep it with its old leaves. Before, the strip dropped
  // it, and a quotient kept it unchanged, so each type below left out
  // values that the expression can have.
  const ce = new ComputeEngine();
  ce.declareType('a', 'list<a | integer> | missing', { alias: true });
  ce.declareType('tree', 'integer | list<tree | missing>', { alias: true });
  ce.declareType('pts', 'tuple<integer, integer> | list<pts>', {
    alias: true,
  });
  const T = (s: string) => ce.type(s).type;

  test('the strip keeps the deeper values', () => {
    const a = stripMissingFromType(T('a'));
    expect(isSubtype(T('list<list<list<integer>>>'), a)).toBe(true);
    const tree = stripMissingFromType(T('tree'));
    for (const value of [
      ['List', ['List', 1]],
      ['List', ['List', ['List', 1]]],
    ])
      expect(isSubtype(ce.box(value as never).type.type, tree)).toBe(true);
  });

  test('a quotient and a product admit the deeper values', () => {
    ce.declare('p', 'pts');
    const points = ce.box(['List', ['List', ['Tuple', 1, 1]]]);
    for (const [op, factor] of [
      ['Divide', 2],
      ['Multiply', 0.5],
    ] as const) {
      const value = ce.box([op, points, factor] as never).evaluate();
      const type = ce.box([op, 'p', factor] as never).type.type;
      expect(isSubtype(value.type.type, type)).toBe(true);
    }
  });
});

describe('AN INTERSECTION OR A TYPE VARIABLE', () => {
  // An intersection is a tuple when one member that is not a negation is a
  // tuple. A "could be" test must err toward `true` for a type it cannot
  // see into (a type variable, a negation). Before, the first was not a
  // tuple, and the second answered `false`.
  const ce = new ComputeEngine();
  ce.declare('k', 'tuple<integer, integer> & !tuple<0, 0>');
  ce.declare('z', 'indexed_collection<integer> & !set');
  ce.declare('y', 'tuple<integer, missing> & tuple<number, missing>');

  test('an intersection with a tuple member is a tuple', () => {
    expect(ce.box(['Join', ['List', 3, 4], 'k']).count).toBe(3);
    expect(ce.box(['List', ['Spread', 'k'], 5]).json).toEqual([
      'List',
      SPREAD_ERROR('k'),
      5,
    ]);
    expect(
      isTupleOrTupleUnionShapedType(T('tuple<integer, integer> & !tuple<0, 0>'))
    ).toBe(true);
    expect(
      isRecordOrRecordUnionShapedType(T('record{a: integer} & !record{a: 0}'))
    ).toBe(true);
    expect(isTupleOrTupleUnionShapedType(T('!tuple<integer, integer>'))).toBe(
      false
    );
  });

  test('a literal may equal it', () => {
    expect(ce.box(['List', 1, 2]).isEqual(ce.symbol('z'))).toBeUndefined();
    expect(ce.box(['Tuple', 1, 2]).isEqual(ce.symbol('y'))).toBeUndefined();
  });

  test('a type variable could be a tuple or a list', () => {
    const variable: Type = { kind: 'variable', name: 'T' };
    expect(typeCouldBeTuple(variable)).toBe(true);
    expect(typeCouldBeList(variable)).toBe(true);
    expect(typeCouldBeList(T('indexed_collection<integer> & !set'))).toBe(true);
    expect(
      typeCouldBeTuple(T('tuple<integer, missing> & tuple<number, missing>'))
    ).toBe(true);
    expect(typeCouldBeTuple(T('integer & !0'))).toBe(false);
  });

  function T(s: string): Type {
    return ce.type(s).type;
  }
});
