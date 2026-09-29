import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';
import { stripNumericRanges } from '../../src/common/type/utils';
import type { Type } from '../../src/common/type/types';

/**
 * The static type of an element-wise (broadcast) operator applied to an
 * operand declared with an ABSTRACT collection type, `collection<T>`.
 *
 * Such a declaration does not fix the kind of the value: `P` declared
 * `collection<number>` can hold a list or a range, over which `Sin(P)` maps
 * (the value is a list of sines), or a set, over which it does not map. So
 * neither the scalar type nor a list type is true for every value the
 * declaration admits. The static type is `broadcastable<R>`: the scalar `R`
 * or an indexed collection of `R`, where `R` is the per-element result
 * computed from the ELEMENT type of `P`.
 *
 * A `P` that holds a value now is typed from that value, as for any symbol:
 * a list or a range gives a list type, and a set gives the scalar type of an
 * application that does not map (this was already the case). The soundness check below evaluates each
 * application with `P` holding each kind of value and checks that the type
 * of the value is a subtype of the static type.
 */

type Decl = 'collection<number>' | 'collection<any>' | 'collection';

const OPERATORS: Record<string, unknown> = {
  Sin: ['Sin', 'P'],
  Add: ['Add', 'P', 1],
  Multiply: ['Multiply', 'P', 2],
  Greater: ['Greater', 'P', 1],
  Not: ['Not', ['Greater', 'P', 1]],
  And: ['And', ['Greater', 'P', 1], ['Less', 'P', 3]],
  Abs: ['Abs', 'P'],
  Power: ['Power', 'P', 2],
  // A user function: its signature is inferred scalar, `(number) -> number`,
  // so a call maps over a collection argument.
  g: ['g', 'P'],
};

const VALUES: Record<string, unknown> = {
  list: ['List', 1, 2],
  set: ['Set', 1, 2],
  range: ['Range', 1, 3],
  none: undefined,
};

function engineWith(decl: Decl, value: unknown): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('P', decl);
  ce.parse('g(x) := 2x+1').evaluate();
  if (value !== undefined) ce.assign('P', ce.box(value as any));
  return ce;
}

/** The static type of each operator over a VALUELESS `P`. */
const VALUELESS: Record<Decl, Record<string, string>> = {
  'collection<number>': {
    Sin: 'broadcastable<number>',
    Add: 'broadcastable<number>',
    Multiply: 'broadcastable<number>',
    Greater: 'broadcastable<boolean>',
    Not: 'broadcastable<boolean>',
    And: 'broadcastable<boolean>',
    Abs: 'broadcastable<nan | real<0..> | signed_infinity>',
    Power: 'broadcastable<number>',
    g: 'broadcastable<number>',
  },
  'collection<any>': {
    Sin: 'broadcastable<number>',
    Add: 'broadcastable<any>',
    Multiply: 'broadcastable<number>',
    Greater: 'broadcastable<boolean>',
    Not: 'broadcastable<boolean>',
    And: 'broadcastable<boolean>',
    Abs: 'broadcastable<real<0..> | signed_infinity>',
    Power: 'broadcastable<number>',
    g: 'broadcastable<number>',
  },
  // The elements of a bare `collection` are values of an unknown type. The
  // cell of `P + 1` is typed as `value`, not from the literal `1` alone.
  'collection': {
    Sin: 'broadcastable<number>',
    Add: 'broadcastable<value>',
    Multiply: 'broadcastable<number>',
    Greater: 'broadcastable<boolean>',
    Not: 'broadcastable<boolean>',
    And: 'broadcastable<boolean>',
    Abs: 'broadcastable<real<0..> | signed_infinity>',
    Power: 'broadcastable<number>',
    g: 'broadcastable<number>',
  },
};

/**
 * Whether the type of `value` is admitted by `staticType`.
 *
 * The type of an evaluated value is built from the widened types of its
 * literals: `[1, 2]` is `vector<integer^2>`, not a vector of positive
 * integers. So a numeric range in the static type (`real<0..>` for `Abs`)
 * cannot be witnessed by the value type, and the check falls back to the
 * static type with its numeric ranges removed.
 */
function admits(valueType: Type, staticType: Type): boolean {
  return (
    isSubtype(valueType, staticType) ||
    isSubtype(valueType, stripNumericRanges(staticType))
  );
}

const DECLS: Decl[] = ['collection<number>', 'collection<any>', 'collection'];

describe('ELEMENT-WISE OPERATOR OVER AN ABSTRACT COLLECTION: STATIC TYPE', () => {
  for (const decl of DECLS) {
    for (const [name, expr] of Object.entries(OPERATORS)) {
      test(`${name}(P) with P: ${decl} and no value`, () => {
        const ce = engineWith(decl, undefined);
        expect(ce.box(expr as any).type.toString()).toBe(VALUELESS[decl][name]);
      });
    }
  }

  test('P holding a set is typed from its value: not mapped over', () => {
    // A set is not mapped over, so the application is typed as a scalar
    // application over the set (`Sin` of a set evaluates to a type error).
    const ce = engineWith('collection<number>', ['Set', 1, 2]);
    expect(ce.box(['Sin', 'P']).type.toString()).toBe('number');
    expect(ce.box(['Abs', 'P']).type.toString()).toBe(
      'real<0..> | signed_infinity'
    );
  });

  test('P holding a list or a range is typed from its value: a list', () => {
    for (const value of [VALUES.list, VALUES.range]) {
      const ce = engineWith('collection<number>', value);
      expect(ce.box(['Sin', 'P']).type.toString()).toBe('list<number>');
    }
  });

  test('an indexed operand beside the abstract one: the list lift wins', () => {
    // The element-wise map either gives a list, or does not apply (a set
    // against a list is an error value), so the result is never a scalar.
    const ce = engineWith('collection<number>', undefined);
    const t = ce.box(['Add', 'P', ['List', 1, 2]]).type;
    expect(t.matches('collection<any>')).toBe(true);
  });

  test('set, list and dictionary declarations keep their typing', () => {
    const ce = new ComputeEngine();
    ce.declare('S', 'set<number>');
    ce.declare('L', 'list<number>');
    expect(ce.box(['Sin', 'S']).type.toString()).toBe('number');
    expect(ce.box(['Sin', 'L']).type.toString()).toBe('list<number>');
  });
});

describe('ELEMENT-WISE OPERATOR OVER AN ABSTRACT COLLECTION: SOUNDNESS', () => {
  for (const decl of DECLS) {
    for (const [valueName, value] of Object.entries(VALUES)) {
      for (const [name, expr] of Object.entries(OPERATORS)) {
        test(`${name}(P) with P: ${decl} holding ${valueName}`, () => {
          const ce = engineWith(decl, value);
          const boxed = ce.box(expr as any);
          const staticType = boxed.type.type;
          const result = boxed.evaluate();
          if (result.operator === 'Error') {
            // An arithmetic operator over a SET is a type error: a set is
            // not mapped over, and it is not a number. An error value is
            // outside every value type, so there is no type to compare.
            // Only a set gives an error.
            expect(valueName).toBe('set');
            return;
          }
          expect(admits(result.type.type, staticType)).toBe(true);
        });
      }
    }
  }
});

/** `Map(x -> 2x, P)`: a collection whose kind follows the value of `P`. */
const MAP_P = ['Map', ['Function', ['Multiply', 2, 'x'], 'x'], 'P'];

describe('ABSTRACT COLLECTION: A MAP OVER P WHOSE KIND IS NOT DECIDED', () => {
  // A `Map` over `P` declared `collection<number>` is a collection that is
  // not known to be indexed until `P` holds a value. While `P` holds no
  // value, the kind is not decided, so the `Map` may still be a list and
  // `Sin` of it is `broadcastable<number>`, not the scalar `number`.
  test.each([
    ['no value', undefined, 'broadcastable<number>'],
    ['a list', ['List', 1, 2], 'list<number>'],
    ['a set', ['Set', 1, 2], 'number'],
  ])('Sin(Map(x -> 2x, P)) with P holding %s', (_, value, expected) => {
    const ce = engineWith('collection<number>', value);
    const expr = ce.box(['Sin', MAP_P] as any);
    expect(expr.type.toString()).toBe(expected);
    const result = expr.evaluate();
    expect(admits(result.type.type, expr.type.type)).toBe(true);
  });

  test.each([
    ['no value', undefined, 'broadcastable<number>'],
    ['a list', ['List', 1, 2], 'list<number>'],
    ['a set', ['Set', 1, 2], 'number'],
  ])(
    'Q := Map(x -> 2x, P), then Sin(Q), with P holding %s',
    (_, value, expected) => {
      const ce = engineWith('collection<number>', value);
      ce.assign('Q', ce.box(MAP_P as any));
      const expr = ce.box(['Sin', 'Q']);
      expect(expr.type.toString()).toBe(expected);
      const result = expr.evaluate();
      expect(admits(result.type.type, expr.type.type)).toBe(true);
    }
  );
});

describe('ABSTRACT COLLECTION: INPUTS ACCEPTED BEFORE STAY ACCEPTED', () => {
  // `Sin(P)` with `P: collection<number>` and no value was typed `number`; it
  // is now `broadcastable<number>`, and a comparison over it is
  // `broadcastable<boolean>`. Each input below was accepted with the scalar
  // type and must still be accepted, with the same value.

  test('assigning Sin(P) to a symbol declared number', () => {
    const ce = engineWith('collection<number>', undefined);
    ce.declare('y', 'number');
    expect(() => ce.assign('y', ce.box(['Sin', 'P']))).not.toThrow();
    expect(ce.box('y').evaluate().json).toEqual(['Sin', 'P']);
  });

  test('Sin(P) > x as the condition of a three-operand Element', () => {
    const ce = engineWith('collection<number>', undefined);
    const expr = ce.box([
      'Element',
      'x',
      'RealNumbers',
      ['Greater', ['Sin', 'P'], 'x'],
    ]);
    expect(expr.isValid).toBe(true);
    expect(expr.json).toEqual([
      'Element',
      'x',
      'RealNumbers',
      ['Less', 'x', ['Sin', 'P']],
    ]);
  });

  test('Sin(P) > x under a boolean rule wildcard', () => {
    const ce = engineWith('collection<number>', undefined);
    const result = ce
      .box(['Not', ['Greater', ['Sin', 'P'], 'x']])
      .replace(ce.rules(['\\lnot b_{boolean} -> b']));
    expect(result?.json).toEqual(['Less', 'x', ['Sin', 'P']]);
  });

  test('a predicate over Sin(P) solved over a domain', () => {
    // `Or(n > 17, Sin(P) > 5)` is a predicate to enumerate, not an equation
    // to test against 0.
    const ce = engineWith('collection<number>', undefined);
    const result = ce
      .box([
        'Solve',
        ['Or', ['Greater', 'n', 17], ['Greater', ['Sin', 'P'], 5]],
        ['Element', 'n', ['Range', 1, 20]],
      ])
      .evaluate();
    expect(result.json).toEqual(['List', 18, 19, 20]);
  });

  test('a side condition over Sin(P) beside an equation', () => {
    const ce = engineWith('collection<number>', undefined);
    const result = ce
      .box([
        'Solve',
        [
          'Set',
          ['Equal', ['Power', 'n', 2], 4],
          ['Or', ['Greater', 'n', 0], ['Greater', ['Sin', 'P'], 5]],
        ],
        ['Element', 'n', ['Range', -20, 20]],
      ])
      .evaluate();
    expect(result.json).toEqual(['List', 2]);
  });

  test('Sin(P) > x evaluates as before', () => {
    const ce = engineWith('collection<number>', undefined);
    expect(ce.box(['Greater', ['Sin', 'P'], 'x']).evaluate().json).toEqual([
      'Less',
      'x',
      ['Sin', 'P'],
    ]);
  });
});

describe('ABSTRACT COLLECTION: ONLY THE ELEMENT-WISE SLOTS ARE RETYPED', () => {
  test('an operand at a whole-collection slot keeps its collection type', () => {
    // `h` maps over its first slot (`broadcastable<number>`) and takes its
    // second slot whole (`collection<number>`). Its type handler answers
    // `integer` when it sees a collection in the second slot, and `string`
    // when it does not. Only the first operand is typed as its element when
    // the handler is called again for the cell.
    const ce = new ComputeEngine();
    ce.declare('P', 'collection<number>');
    ce.declare('S', 'collection<number>');
    ce.declare('h', {
      signature: '(broadcastable<number>, collection<number>) -> number',
      type: (ops: ReadonlyArray<{ type: Type }>) =>
        isSubtype(ops[1].type, {
          kind: 'collection',
          elements: 'any',
        } as Type)
          ? 'integer'
          : 'string',
      evaluate: (_ops: unknown, { engine }: { engine: ComputeEngine }) =>
        engine.number(1),
    } as any);
    expect(ce.box(['h', 'P', 'S']).type.toString()).toBe(
      'broadcastable<integer>'
    );
  });
});

describe('ABSTRACT COLLECTION: AN ELEMENT THAT IS A COLLECTION', () => {
  // The runtime broadcast over a held list of lists descends to the leaves,
  // so `Sin` of `[[1, 2], [3, 4]]` is a list of lists of numbers. The type of
  // `Sin(P)` with `P: collection<list<number>>` must admit that value.
  const NESTED = ['List', ['List', 1, 2], ['List', 3, 4]];

  test('with no value', () => {
    const free = new ComputeEngine();
    free.declare('P', 'collection<list<number>>');
    const staticType = free.box(['Sin', 'P']).type;
    expect(staticType.toString()).toBe('broadcastable<list<number>>');

    const held = new ComputeEngine();
    held.declare('P', 'collection<list<number>>');
    held.assign('P', held.box(NESTED as any));
    const value = held.box(['Sin', 'P']).evaluate();
    expect(admits(value.type.type, staticType.type)).toBe(true);
  });

  test('holding a list of lists', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'collection<list<number>>');
    ce.assign('P', ce.box(NESTED as any));
    const expr = ce.box(['Sin', 'P']);
    const value = expr.evaluate();
    expect(admits(value.type.type, expr.type.type)).toBe(true);
  });
});

describe('ABSTRACT COLLECTION: WITH AN ABSENCE ARM OR SCALAR ARMS', () => {
  test.each([
    ['collection<number> | missing', 'broadcastable<number> | missing'],
    ['number | collection<number>', 'broadcastable<number>'],
  ])('Sin(m) with m: %s', (decl, expected) => {
    const ce = new ComputeEngine();
    ce.declare('m', decl);
    expect(ce.box(['Sin', 'm']).type.toString()).toBe(expected);
  });

  test.each([
    ['collection<number> | missing', ['List', 1, 2]],
    ['number | collection<number>', ['List', 1, 2]],
    ['number | collection<number>', 3],
  ])('Sin(m) with m: %s holding %j admits the value', (decl, value) => {
    const free = new ComputeEngine();
    free.declare('m', decl);
    const staticType = free.box(['Sin', 'm']).type.type;
    const held = new ComputeEngine();
    held.declare('m', decl);
    held.assign('m', held.box(value as any));
    const result = held.box(['Sin', 'm']).evaluate();
    expect(admits(result.type.type, staticType)).toBe(true);
  });
});

describe('ABSTRACT COLLECTION: A COMPARISON OVER AN ELEMENT-WISE APPLICATION', () => {
  // `Equal`/`NotEqual` compare two collections as a whole (one boolean) and
  // map only over a list against a scalar. Beside the list literal, the
  // result is a boolean when `Sin(P)` is a list and a list when it is a
  // number, so the static type is `broadcastable<boolean>`.
  //
  // The orderings (`Less`, `LessEqual`, `Greater`, `GreaterEqual`) map
  // element-wise over two lists, so beside the list literal `[1, 2]` the
  // result is never a scalar: it is a list of two booleans, or an error value
  // when the lengths do not agree (`[5, 6, 7]` against `[1, 2]`) or when
  // `Sin` does not apply (a set). An error value is outside every value type,
  // so `list<boolean^2>` admits every value that is not an error.
  const S = ['Sin', 'P'];
  const L = ['List', 1, 2];
  const COMPARISONS: Record<string, [unknown, string]> = {
    'Sin(P) = [1, 2]': [['Equal', S, L], 'broadcastable<boolean>'],
    'Sin(P) != [1, 2]': [['NotEqual', S, L], 'broadcastable<boolean>'],
    'Sin(P) < [1, 2]': [['Less', S, L], 'list<boolean^2>'],
    'Sin(P) <= [1, 2]': [['LessEqual', S, L], 'list<boolean^2>'],
    'Sin(P) > [1, 2]': [['Greater', S, L], 'list<boolean^2>'],
    'Sin(P) >= [1, 2]': [['GreaterEqual', S, L], 'list<boolean^2>'],
    '[1, 2] < Sin(P)': [['Less', L, S], 'list<boolean^2>'],
    '[1, 2] = Sin(P)': [['Equal', L, S], 'broadcastable<boolean>'],
    '0 < Sin(P) < [1, 2]': [['Less', 0, S, L], 'list<boolean^2>'],
    '0 <= Sin(P) <= [1, 2]': [['LessEqual', 0, S, L], 'list<boolean^2>'],
    'Sin(P) < Cos(P)': [['Less', S, ['Cos', 'P']], 'broadcastable<boolean>'],
    'Sin(P) = Cos(P)': [['Equal', S, ['Cos', 'P']], 'broadcastable<boolean>'],
    'Sin(P) < 1': [['Less', S, 1], 'broadcastable<boolean>'],
    'Sin(P) = 1': [['Equal', S, 1], 'broadcastable<boolean>'],
    'Sin(P) < 1 and Sin(P) > 0': [
      ['And', ['Less', S, 1], ['Greater', S, 0]],
      'broadcastable<boolean>',
    ],
    'not Sin(P) < 1': [['Not', ['Less', S, 1]], 'broadcastable<boolean>'],
    'not Sin(P) < [1, 2]': [['Not', ['Less', S, L]], 'list<boolean^2>'],
    'Sin(P) < [1, 2] or Sin(P) > 0': [
      ['Or', ['Less', S, L], ['Greater', S, 0]],
      'list<boolean^2>',
    ],
  };

  const HELD: Record<string, unknown> = {
    'a list of the same length': ['List', 5, 6],
    'a list of another length': ['List', 5, 6, 7],
    'a single-element list': ['List', 5],
    'a set': ['Set', 5, 6],
    'a number': 5,
  };
  // The held values for which an error value is an expected result: a
  // length that does not agree with `[1, 2]`, or a set, which `Sin` does not
  // apply to.
  const MAY_ERROR = new Set([
    'a list of another length',
    'a single-element list',
    'a set',
  ]);

  const COMPARISON_DECLS = [
    'collection<number>',
    'number | collection<number>',
  ];

  for (const decl of COMPARISON_DECLS) {
    for (const [name, [expr, expected]] of Object.entries(COMPARISONS)) {
      test(`${name} with P: ${decl} and no value`, () => {
        const ce = new ComputeEngine();
        ce.declare('P', decl);
        const boxed = ce.box(expr as any);
        expect(boxed.type.toString()).toBe(expected);
        // Unevaluated, the value keeps the static type.
        expect(admits(boxed.evaluate().type.type, boxed.type.type)).toBe(true);
      });

      for (const [valueName, value] of Object.entries(HELD)) {
        // A number is not a value of `collection<number>`.
        if (decl === 'collection<number>' && valueName === 'a number') continue;
        test(`${name} with P: ${decl} holding ${valueName}`, () => {
          const free = new ComputeEngine();
          free.declare('P', decl);
          const staticType = free.box(expr as any).type.type;

          const ce = new ComputeEngine();
          ce.declare('P', decl);
          ce.assign('P', ce.box(value as any));
          const result = ce.box(expr as any).evaluate();
          if (result.type.toString() === 'error') {
            expect(MAY_ERROR.has(valueName)).toBe(true);
            return;
          }
          expect(admits(result.type.type, staticType)).toBe(true);
        });
      }
    }
  }
});
