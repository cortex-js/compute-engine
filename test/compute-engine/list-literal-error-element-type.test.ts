import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { isSubtype } from '../../src/common/type/subtype';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * The type of a collection literal that holds an error value.
 *
 * A type describes the successful values (`docs/ERROR-MODEL.md` §4), so the
 * element join of a `List` or `Set` literal leaves out an element whose type
 * is exactly `error`. The error stays in the expression (`isValid` is false,
 * `errors` lists it); only the type ignores it. User decision 2026-10-22
 * (option (a) of the ROADMAP entry "A list literal that holds an error value
 * is typed `list<unknown>`").
 *
 * Each test states the type before the change in a comment.
 */

const ce = new ComputeEngine();

/** `1/"a"`, which is an `Error(incompatible-type)` once boxed. */
const FAILED = ['Divide', 1, { str: 'a' }];

function typeOf(json: unknown): string {
  return ce.box(json as any).type.toString();
}

/** Every error of `expr` is kept, and `expr` is not valid. */
function expectErrorsKept(expr: Expression, count: number): void {
  expect(expr.isValid).toBe(false);
  expect(expr.errors.length).toBe(count);
}

describe('A List literal skips an error element in its element join', () => {
  test('[1, 1/"a", 3] is typed as [1, 2, 3] is', () => {
    // Before: list<unknown>
    const expr = ce.box(['List', 1, FAILED, 3]);
    expect(typeOf(['List', 1, 2, 3])).toBe('vector<integer^3>');
    expect(expr.type.toString()).toBe('vector<integer^3>');
    expectErrorsKept(expr, 1);
    expect(expr.nops).toBe(3);
  });

  test('an Error expression element', () => {
    // Before: list<unknown>
    const expr = ce.box(['List', 1, ['Error', { str: 'x' }]]);
    expect(expr.type.toString()).toBe('vector<integer^2>');
    expectErrorsKept(expr, 1);
  });

  test('the cell type of the other elements is kept', () => {
    // Before: list<unknown>, for each of the three
    expect(typeOf(['List', 1.5, FAILED])).toBe('vector<real^2>');
    expect(typeOf(['List', 'True', FAILED])).toBe('list<boolean^2>');
    // Before: list<unknown>
    expect(typeOf(['List', 1, { str: 'a' }, FAILED])).toBe(
      'list<integer | string>'
    );
  });

  test('an absent cell beside an error keeps its arm', () => {
    // Before: list<missing | unknown>
    expect(typeOf(['List', 1, 'Missing', FAILED])).toBe(
      'list<integer | missing>'
    );
    // Before: list<missing | unknown>
    expect(typeOf(['List', FAILED, 'Missing'])).toBe('list<missing^2>');
  });

  test('an element of unknown type still makes the element type unknown', () => {
    // Before: list<unknown> (unchanged)
    expect(typeOf(['List', ['f', 'x'], FAILED])).toBe('list<unknown>');
  });

  test('an element whose type is a union with an error arm is not skipped', () => {
    const engine = new ComputeEngine();
    engine.declare('g', '(integer) -> integer | error');
    // Before: list<error | integer> (unchanged)
    expect(
      engine.box(['List', 1, ['g', 2], 3]).type.toString()
    ).toBe('list<error | integer>');
  });
});

describe('A List literal whose elements all failed', () => {
  // The skip needs one element of the level that did not fail. A level whose
  // elements all failed keeps the typing it had: `list<unknown>`, with no
  // shape. A cell type `never` (`list<never^2>`) would be read as a type
  // with no value.
  test('[1/"a", 1/"a"] claims nothing of its cells', () => {
    // Before: list<unknown> (unchanged)
    const expr = ce.box(['List', FAILED, FAILED]);
    expect(expr.type.toString()).toBe('list<unknown>');
    expectErrorsKept(expr, 2);
    // Not the type of the empty list.
    expect(isSubtype(expr.type.type, parseType('list<never>'))).toBe(false);
  });

  test('one failed element', () => {
    // Before: list<unknown> (unchanged)
    expect(typeOf(['List', FAILED])).toBe('list<unknown>');
  });

  test('a declared bare list keeps reading its elements as any', () => {
    const engine = new ComputeEngine();
    engine.declare('fs', 'list');
    engine.assign('fs', ['List', FAILED, FAILED]);
    expect(engine.box(['First', 'fs']).type.toString()).toBe('any');
    expect(engine.box(['At', 'fs', 1]).type.toString()).toBe('any');
  });

  test('the empty list is unchanged', () => {
    expect(typeOf(['List'])).toBe('list<never>');
  });
});

describe('A nested List literal with error elements', () => {
  test('[[1, 1/"a"], [3, 4]] is a 2 by 2 matrix of integers', () => {
    // Before: list<list<unknown>>
    const expr = ce.box(['List', ['List', 1, FAILED], ['List', 3, 4]]);
    expect(expr.type.toString()).toBe('matrix<integer^(2x2)>');
    expectErrorsKept(expr, 1);
  });

  test('every cell failed', () => {
    // Before: list<list<unknown>> (unchanged)
    expect(
      typeOf(['List', ['List', FAILED, FAILED], ['List', FAILED, FAILED]])
    ).toBe('list<list<unknown>>');
  });

  test('a failed element in place of a row', () => {
    // Before: list<unknown>
    expect(typeOf(['List', ['List', 1, 2], FAILED])).toBe(
      'matrix<integer^(2x2)>'
    );
  });

  test('a level that mixes rows and cells claims no shape', () => {
    // Before: list<unknown>
    expect(typeOf(['List', ['List', 1, 2], FAILED, 3])).toBe(
      'list<integer | vector<integer^2>>'
    );
  });
});

describe('Other collection literals', () => {
  test('Set(1, 1/"a") is a set of integers', () => {
    // Before: set<unknown>
    const expr = ce.box(['Set', 1, FAILED]);
    expect(expr.type.toString()).toBe('set<integer>');
    expectErrorsKept(expr, 1);
  });

  test('a set whose elements all failed claims no element type', () => {
    // `set<never>` is the type of the empty set, so the element type stays
    // `unknown`. Before: set<unknown> (unchanged)
    expect(typeOf(['Set', FAILED, FAILED])).toBe('set<unknown>');
  });

  test('a tuple slot is positional and is not changed', () => {
    // The tuple type with an error slot reduces to `error`.
    // Before: error (unchanged)
    expect(typeOf(['Tuple', 1, FAILED])).toBe('error');
  });
});

describe('A declared collection refuses a value with a failed element', () => {
  // The type of `[1, Error(…)]` leaves the failed element out, so the
  // declared-type check reads the elements of the value
  // (`failedElementRefusedBy`, `boxed-expression/type-compatibility-error.ts`).
  // A declared element type that is a supertype of `error` (`any`, `unknown`,
  // an explicit `error` arm) admits the failed element. User decision
  // 2026-10-22.
  const ERR = ['Error', "'oops'"];

  /** Declare `s` with `type` (when given), then assign `value` to it. */
  function assign(type: string | undefined, value: unknown): () => void {
    return () => {
      const engine = new ComputeEngine();
      if (type !== undefined) engine.declare('s', type);
      engine.assign('s', value as any);
    };
  }

  test.each([
    ['list<number>', ['List', 1, ERR]],
    ['list<expression>', ['List', ERR, 2]],
    ['list<list<number>>', ['List', ['List', 1, ERR]]],
    ['matrix<number>', ['List', ['List', 1, 2], ERR]],
    ['tensor<number>', ['List', ['List', 1, ERR]]],
    ['set<integer>', ['Set', 1, ERR]],
    ['list<number> | string', ['List', 1, ERR]],
    // A tuple slot and a dictionary value are read too.
    ['tuple<list<number>, integer>', ['Tuple', ['List', 1, ERR], 2]],
    [
      'dictionary<list<number>>',
      ['Dictionary', ['Tuple', "'k'", ['List', 1, ERR]]],
    ],
    [
      'record{k: list<number>}',
      ['Dictionary', ['Tuple', "'k'", ['List', 1, ERR]]],
    ],
  ])('%s refuses %j', (type, value) => {
    expect(assign(type, value)).toThrow(/failed element "Error\("oops"\)"/);
  });

  test.each([
    ['list<any>', ['List', 1, ERR]],
    ['list', ['List', 1, ERR]],
    ['list<unknown>', ['List', 1, ERR]],
    ['list<number | error>', ['List', 1, ERR]],
    ['list<list<any>>', ['List', ['List', 1, ERR]]],
    ['any', ['List', 1, ERR]],
    ['tuple<list<any>, integer>', ['Tuple', ['List', 1, ERR], 2]],
    [
      'dictionary<list<any>>',
      ['Dictionary', ['Tuple', "'k'", ['List', 1, ERR]]],
    ],
  ])('%s admits %j', (type, value) => {
    expect(assign(type, value)).not.toThrow();
  });

  test('an undeclared symbol admits the value', () => {
    expect(assign(undefined, ['List', 1, ERR])).not.toThrow();
    const engine = new ComputeEngine();
    engine.assign('s', ['List', 1, 2]);
    expect(() => engine.assign('s', ['List', 1, ERR])).not.toThrow();
  });

  test('a list without a failed element is still admitted', () => {
    expect(assign('list<number>', ['List', 1, 2])).not.toThrow();
  });

  test('a symbol that holds the list is read through', () => {
    const engine = new ComputeEngine();
    engine.assign('fs', ['List', 1, ERR]);
    engine.declare('s', 'list<number>');
    expect(() => engine.assign('s', 'fs')).toThrow(/failed element/);
  });

  test('the value of an element-wise If', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'list<integer>');
    const value = engine
      .box(['If', ['List', 'True', 'Missing', 'False'], 1, 0])
      .evaluate();
    expect(() => engine.assign('x', value)).toThrow(/failed element/);
  });

  test('the Assign operator gives an incompatible-type error value', () => {
    const engine = new ComputeEngine();
    engine.declare('s', 'list<number>');
    const result = engine.box(['Assign', 's', ['List', 1, ERR]]).evaluate();
    expect(result.operator).toBe('Error');
    expect(result.toString()).toContain('incompatible-type');
    expect(result.toString()).toContain('failed element');
  });

  test('a union is read arm by arm', () => {
    // The list matches the arm `list<number>`, which refuses the failed
    // element; the arm `set<any>` admits it, but the list is not a set.
    expect(assign('list<number> | set<any>', ['List', 1, ERR])).toThrow(
      /failed element/
    );
    expect(assign('list<number> | list<any>', ['List', 1, ERR])).not.toThrow();
  });

  test.each(['collection<list<number>>', 'indexed_collection<list<number>>'])(
    'each tuple slot is read against the element type of %s',
    (type) => {
      expect(
        assign(type, ['Tuple', ['List', 1, ERR], ['List', 2, 3]])
      ).toThrow(/failed element/);
      expect(
        assign(type, ['Tuple', ['List', 1, 2], ['List', 2, 3]])
      ).not.toThrow();
    }
  );

  test.each(['tensor<number>', 'list<list<any>> | list<any>'])(
    'a value that holds itself through symbols ends the walk (%s)',
    (type) => {
      // `y := [z]` and `z := [y]`. The result is the one the check gave
      // before the failed-element walk: refused by the type for
      // `tensor<number>`, admitted for the union.
      const run = (declare: boolean) => {
        const engine = new ComputeEngine();
        engine.assign('y', ['List', 'z']);
        engine.assign('z', ['List', 'y']);
        if (declare) engine.declare('u', { type, value: engine.box('y') });
        else {
          engine.declare('u', type);
          engine.assign('u', 'y');
        }
      };
      for (const declare of [false, true]) {
        if (type === 'tensor<number>')
          expect(() => run(declare)).toThrow(/TypeCompatibilityError|Symbol "u"/);
        else expect(() => run(declare)).not.toThrow();
      }
    }
  );

  test('a literal shared by many parents is read once per declared type', () => {
    // `List(t, t)` repeated 26 times has 27 distinct nodes and 2^26 paths. A
    // walk of every path would not finish in the time bound.
    const engine = new ComputeEngine();
    let t = engine.number(1);
    for (let i = 0; i < 26; i++) t = engine._fn('List', [t, t]);
    engine.declare('s', 'tensor<number>');
    const start = performance.now();
    engine.assign('s', t);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('The refusal message of a failed element', () => {
  const ERR = ['Error', "'oops'"];

  test('the type is not stated when it matches the declared type', () => {
    const engine = new ComputeEngine();
    engine.declare('s', 'list<number>');
    expect(() => engine.assign('s', ['List', 1, ERR])).toThrow(
      /The value "\[1,Error\("oops"\)\]" is not compatible with the type "list<number>"\n\|   The value holds the failed element/
    );
    // The error value has no value type: it does not read "got vector<…>".
    const result = engine.box(['Assign', 's', ['List', 1, ERR]]).evaluate();
    expect(result.toString()).not.toContain('vector<integer^2>');
  });

  test('the type is stated when it does not match either', () => {
    const engine = new ComputeEngine();
    engine.declare('s', 'list<number>');
    expect(() => engine.assign('s', ['List', { str: 'a' }, ERR])).toThrow(
      /of type "list<string\^2>" is not compatible with the type "list<number>"\n\|   The value holds the failed element/
    );
  });

  test('the Epsil route', () => {
    const only = executeEpsil(
      new ComputeEngine(),
      'function g(x) { 1/x }\nlet q: list<number> = [1, g("a")]\nq'
    );
    expect(only.diagnostics).toHaveLength(1);
    const onlyText = String(only.diagnostics[0].message[1]);
    expect(onlyText).toContain('failed element');
    expect(onlyText).not.toContain('got `');
    const both = executeEpsil(
      new ComputeEngine(),
      'function g(x) { 1/x }\nlet q: list<number> = ["a", g("a")]\nq'
    );
    expect(both.diagnostics).toHaveLength(1);
    const bothText = String(both.diagnostics[0].message[1]);
    expect(bothText).toContain('got `list<string^2>`');
    expect(bothText).toContain('failed element');
  });
});

describe('A parameter binding does not refuse an argument with a failed element', () => {
  // Only a declared variable refuses the value. The call runs, and the body
  // reads the failed element as a value. Each call returns 1, as before the
  // type of such a list left the failed element out.
  const ERR = ['Error', "'oops'"];

  test('the box route', () => {
    const engine = new ComputeEngine();
    engine.declare('k', '(list<number>) -> integer');
    engine.assign('k', ['Function', 1, 'xs']);
    expect(engine.box(['k', ['List', 1, ERR]]).evaluate().toString()).toBe(
      '1'
    );
  });

  test('the parse route', () => {
    const engine = new ComputeEngine();
    engine.declare('k', '(list<number>) -> integer');
    engine.assign('k', ['Function', 1, 'xs']);
    expect(engine.parse('k([1, \\sin("a")])').evaluate().toString()).toBe(
      '1'
    );
  });

  test('Apply of a function literal with a typed parameter', () => {
    const engine = new ComputeEngine();
    expect(
      engine
        .box([
          'Apply',
          ['Function', 1, ['Typed', 'xs', "'list<number>'"]],
          ['List', 1, ERR],
        ])
        .evaluate()
        .toString()
    ).toBe('1');
  });

  test('the Epsil route', () => {
    const r = executeEpsil(
      new ComputeEngine(),
      'function h(xs: list<number>) { 1 }\nlet fs = [1/"a", 2]\nh(fs)'
    );
    expect(r.value.toString()).toBe('1');
  });

  test('a declared variable inside the body still refuses it', () => {
    const engine = new ComputeEngine();
    engine.declare('s', 'list<number>');
    expect(
      engine
        .box([
          'Apply',
          [
            'Function',
            ['Assign', 's', 'xs'],
            ['Typed', 'xs', "'list<number>'"],
          ],
          ['List', 1, ERR],
        ])
        .evaluate()
        .toString()
    ).toContain('failed element');
  });
});

describe('The value of an element-wise If or Which matches its static type', () => {
  test('If([True, Missing, False], 1, 0)', () => {
    const expr = ce.box(['If', ['List', 'True', 'Missing', 'False'], 1, 0]);
    const value = expr.evaluate();
    expect(expr.type.toString()).toBe('list<integer>');
    expect(value.nops).toBe(3);
    expectErrorsKept(value, 1);
    // Before: list<unknown>, which did not match list<integer>
    expect(value.type.toString()).toBe('vector<integer^3>');
    expect(value.type.matches(expr.type)).toBe(true);
  });

  test('If([Missing, Missing], 1, 0)', () => {
    const expr = ce.box(['If', ['List', 'Missing', 'Missing'], 1, 0]);
    const value = expr.evaluate();
    expect(expr.type.toString()).toBe('vector<integer^2>');
    expectErrorsKept(value, 2);
    // Every cell failed, so the value keeps the typing of a list with no
    // successful cell, `list<unknown>`, which does not match the static
    // type. Unchanged: before, also `list<unknown>`, no match.
    expect(value.type.toString()).toBe('list<unknown>');
    expect(value.type.matches(expr.type)).toBe(false);
  });

  test('Which([True, False], 1, Missing, 2)', () => {
    const expr = ce.box(['Which', ['List', 'True', 'False'], 1, 'Missing', 2]);
    const value = expr.evaluate();
    expect(expr.type.toString()).toBe('vector<2>');
    expect(value.nops).toBe(2);
    expect(value.ops![0].toString()).toBe('1');
    expect(value.ops![1].operator).toBe('Error');
    expectErrorsKept(value, 1);
    // Before: list<unknown>, which did not match vector<2>
    expect(value.type.toString()).toBe('vector<integer^2>');
    expect(value.type.matches(expr.type)).toBe(true);
  });
});
