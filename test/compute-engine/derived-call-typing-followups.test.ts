/**
 * The type of a call on the three routes: the boxed call (`ce.box`), the
 * parsed call (`ce.parse`), and the derivation from operand types
 * (`deriveApplicationType`, which types a call in the body of another
 * function). Each test also checks that the value of the call has a type
 * below the static type of the call.
 *
 * - the derived `At` answers `error` for a base that is
 *   provably not an indexed collection (a number, a boolean, a set, an
 *   interval), as the boxed `At` does.
 * - with `h(a, t) := a[1] + a[2] + t`, the partial
 *   applications `h(3)`, `h(True)` and `h({1, 2})` evaluate to an error, and
 *   are now typed `error`.
 * - a partial application substitutes the given argument
 *   into a held operand of the body (a branch of an `If`).
 * - a call of a function with an inferred signature, with an
 *   argument outside the inferred parameter type, is typed from the body.
 * - a union of lists of points maps at a declared point
 *   parameter.
 * - the derived route refuses a matrix at a declared
 *   `list<integer>` parameter, as the boxed route does.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import { isSubtype } from '../../src/common/type/subtype';

function derived(ce: ComputeEngine, op: string, types: string[]): string {
  const t = deriveApplicationType(
    ce,
    op,
    types.map((x) => describeType(parseType(x)))
  );
  return t === undefined ? 'undefined' : typeToString(t);
}

/** The value of `e`, with each lazy collection replaced by the list of its
 * elements, so that its type is the type of the elements. */
function valueOf(e: Expression): Expression {
  const v = e.evaluate();
  if (!v.isLazyCollection) return v;
  return e.engine.function(
    'List',
    [...v.each()].map((x) => valueOf(x))
  );
}

/** True when the type of the value of `e` is below the static type of `e`. */
function valueFits(e: Expression): boolean {
  return isSubtype(valueOf(e).type.type, e.type.type);
}

describe('THE DERIVED AT REFUSES A BASE THAT CANNOT BE INDEXED', () => {
  const ce = new ComputeEngine();
  ce.parse('d(a) := a[1] + a[2]').evaluate();

  test.each(['integer', 'real', 'boolean', 'set<integer>', 'set<real>'])(
    'At over %s is error on the derived route',
    (t) => {
      expect(derived(ce, 'At', [t, 'integer'])).toBe('error');
    }
  );

  test.each([
    ['list<integer>', 'integer | nan'],
    ['tuple<integer, integer>', 'integer | nan'],
    ['string', 'character | missing'],
    ['integer | list<integer>', 'unknown'],
    ['missing', 'unknown'],
    ['unknown', 'unknown'],
  ])('At over %s is not refused on the derived route', (t, expected) => {
    expect(derived(ce, 'At', [t, 'integer'])).toBe(expected);
  });

  test('the box route gives error for the same bases', () => {
    expect(ce.box(['At', 3, 1]).type.toString()).toBe('error');
    expect(ce.box(['At', 'True', 1]).type.toString()).toBe('error');
    expect(ce.box(['At', ['Set', 1, 2], 1]).type.toString()).toBe('error');
    expect(ce.box(['At', ['Interval', 0, 1], 1]).type.toString()).toBe('error');
  });

  test.each([
    'd(\\operatorname{Interval}(0, 1))',
    'd(3)',
    'd(\\mathrm{True})',
    'd(\\{1, 2\\})',
  ])('the call %s is typed error, as its value is', (latex) => {
    const e = ce.parse(latex);
    expect(e.type.toString()).toBe('error');
    expect(e.evaluate().type.toString()).toBe('error');
  });

  test('a non-strict engine keeps the unevaluated At', () => {
    const lenient = new ComputeEngine();
    lenient.strict = false;
    expect(derived(lenient, 'At', ['integer', 'integer'])).not.toBe('error');
    const e = lenient.box(['At', 3, 1]);
    expect(e.evaluate().toString()).toBe('At(3, 1)');
    expect(valueFits(e)).toBe(true);
  });

  test('a number base whose type is only inferred is not refused', () => {
    // `x` is inferred `number` from `x + 1`, and it can still hold a list.
    const e2 = new ComputeEngine();
    e2.box(['Add', 'x', 1]);
    expect(e2.box(['At', 'x', 1]).type.toString()).not.toBe('error');
  });
});

describe('A PARTIAL APPLICATION WITH A REFUSED BASE IS ERROR', () => {
  const ce = new ComputeEngine();
  ce.parse('h(a, t) := a[1] + a[2] + t').evaluate();

  test.each([
    ['h(3)', ['h', 3]],
    ['h(\\mathrm{True})', ['h', 'True']],
    ['h(\\{1, 2\\})', ['h', ['Set', 1, 2]]],
  ] as const)(
    '%s is typed error on the parse and box routes',
    (latex, json) => {
      for (const e of [ce.parse(latex), ce.box(json as any)]) {
        expect(e.type.toString()).toBe('error');
        expect(e.evaluate().type.toString()).toBe('error');
      }
    }
  );

  test('a call over a list maps, and each cell is an error', () => {
    const e = ce.parse('h(3, [10, 20])');
    expect(e.type.toString()).toBe('list<error>');
  });
});

describe('A PARTIAL APPLICATION KEEPS THE ARGUMENT IN A HELD OPERAND', () => {
  const ce = new ComputeEngine();
  ce.parse('f(a, b) := \\mathrm{If}(b, a[1] + a[2], 42)').evaluate();

  test('the box route', () => {
    const p = ce.box(['f', ['Tuple', 1, 2]]).evaluate();
    expect(ce.function('Apply', [p, ce.True]).evaluate().toString()).toBe('3');
    expect(ce.function('Apply', [p, ce.False]).evaluate().toString()).toBe(
      '42'
    );
  });

  test('the parse route', () => {
    const p = ce.parse('f((1, 2))').evaluate();
    expect(p.toString()).not.toMatch(/At\(a/);
    expect(ce.box(['Apply', p.json, 'True']).evaluate().toString()).toBe('3');
  });

  test('the function route', () => {
    const p = ce.function('f', [ce.tuple(1, 2)]).evaluate();
    expect(ce.function('Apply', [p, ce.True]).evaluate().toString()).toBe('3');
  });

  test('a nested binder that rebinds the parameter keeps its own', () => {
    ce.parse(
      'g(a, b) := \\mathrm{If}(b, \\operatorname{Map}(a \\mapsto 2a, [1, 2]), a)'
    ).evaluate();
    const p = ce.parse('g(5)').evaluate();
    const v = valueOf(ce.function('Apply', [p, ce.True]));
    expect(v.toString()).toBe('[2,4]');
    expect(ce.function('Apply', [p, ce.False]).evaluate().toString()).toBe('5');
  });

  test('an argument with the name of an unapplied parameter stays itself', () => {
    // The rename of the unapplied parameter `b` does not reach the free
    // symbol `b` given as the argument of `a`.
    ce.parse('m(a, b) := a + b').evaluate();
    const p = ce.parse('m(b)').evaluate();
    expect(
      ce
        .function('Apply', [p, ce.number(1)])
        .evaluate()
        .toString()
    ).toBe('b + 1');
  });
});

describe('AN ARGUMENT OUTSIDE AN INFERRED SIGNATURE TYPES THE CALL FROM THE BODY', () => {
  const ce = new ComputeEngine();
  ce.declare('k', '(tuple<number, number>) -> number');
  ce.assign('k', ce.parse('(p) \\mapsto p[1] + p[2]'));
  ce.parse('U(L) := k(\\operatorname{First}(L))').evaluate();
  const arg = ['List', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]] as const;

  test('the box, parse and function routes', () => {
    for (const e of [
      ce.box(['U', arg as any]),
      ce.parse('U([[(1, 2), (3, 4)]])'),
      ce.function('U', [ce.box(arg as any)]),
    ]) {
      expect(e.type.toString()).toBe('list<number>');
      expect(e.evaluate().toString()).toBe('[3,7]');
      expect(valueFits(e)).toBe(true);
    }
  });

  test('an argument inside the inferred parameter type keeps the result', () => {
    const e = ce.parse('U([(1, 2), (3, 4)])');
    expect(e.type.toString()).toBe('number');
    expect(e.evaluate().toString()).toBe('3');
  });

  test('the derived route', () => {
    expect(derived(ce, 'U', ['list<list<tuple<integer, integer>>>'])).toBe(
      'list<number> | missing'
    );
    const e = ce.parse(
      '\\operatorname{Map}(L \\mapsto U(L), [[[(1, 2), (3, 4)]]])'
    );
    expect(e.type.toString()).toBe('list<list<number>>');
    expect(valueFits(e)).toBe(true);
  });
});

describe('A UNION OF LISTS OF POINTS MAPS AT A POINT PARAMETER', () => {
  const ce = new ComputeEngine();
  ce.declare('k', '(tuple<number, number>) -> number');
  ce.assign('k', ce.parse('(p) \\mapsto p[1] + p[2]'));
  const union =
    'list<tuple<integer, integer>^1> | list<tuple<integer, integer>^2>';
  ce.declare('x', union);

  test('the box and derived routes', () => {
    expect(ce.box(['k', 'x']).type.toString()).toBe('list<number>');
    expect(derived(ce, 'k', [union])).toBe('list<number>');
  });

  test('a Map over a ragged list of lists of points', () => {
    const source = [
      'List',
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ['List', ['Tuple', 5, 6]],
    ];
    for (const e of [
      ce.parse(
        '\\operatorname{Map}(L \\mapsto k(L), [[(1, 2), (3, 4)], [(5, 6)]])'
      ),
      ce.box(['Map', ['Function', ['k', 'L'], 'L'], source as any]),
    ]) {
      expect(e.type.toString()).toBe('list<list<number>>');
      expect(valueOf(e).toString()).toBe('[[3,7],[11]]');
      expect(valueFits(e)).toBe(true);
    }
  });
});

describe('THE DERIVED ROUTE REFUSES A MATRIX AT A LIST<INTEGER> PARAMETER', () => {
  const ce = new ComputeEngine();
  ce.declare('g', '(list<integer>) -> integer');
  ce.assign('g', ce.parse('(l) \\mapsto \\operatorname{Length}(l)'));

  test('the box and parse routes', () => {
    expect(
      ce.box(['g', ['List', ['List', 1, 2], ['List', 3, 4]]]).type.toString()
    ).toBe('error');
    expect(ce.parse('g([[1, 2], [3, 4]])').type.toString()).toBe('error');
  });

  test.each([
    ['matrix<integer^(2x2)>', 'error'],
    ['vector<integer^2>', 'integer'],
    ['list<integer>', 'integer'],
    // These can be the empty list, which the parameter admits.
    ['list<list<integer>>', 'integer'],
    ['tensor<integer>', 'integer'],
    ['list<integer> | matrix<integer^(2x2)>', 'integer'],
  ])('g over %s on the derived route', (t, expected) => {
    expect(derived(ce, 'g', [t])).toBe(expected);
  });

  test('a call in the body of another function', () => {
    ce.parse('w(m, s) := g(m) + s').evaluate();
    const e = ce.parse('w([[1, 2], [3, 4]], 1)');
    expect(e.type.toString()).toBe('error');
    expect(e.evaluate().type.toString()).toBe('error');
  });
});

describe('A SELF-REFERENTIAL ALIAS AT A DECLARED POINT PARAMETER', () => {
  // A declaration that names itself in a bare arm of its union adds no value
  // beyond the other arms. The point-list typing walks each arm of the union
  // and must stop at the second occurrence. Before, the typing of `k(x)`
  // threw "Maximum call stack size exceeded".
  function engine(def: string, alias: boolean): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareType('A', def, { alias });
    ce.declare('k', '(tuple<number, number>) -> number');
    ce.assign(
      'k',
      ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'])
    );
    ce.declare('x', 'A');
    return ce;
  }

  test('a list of points', () => {
    const ce = engine('A | list<tuple<number, number>>', true);
    expect(ce.box(['k', 'x']).type.toString()).toBe('list<number>');
    expect(ce.parse('k(x)').type.toString()).toBe('list<number>');
    ce.assign('x', ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    const e = ce.box(['k', 'x']);
    expect(e.evaluate().toString()).toBe('[3,7]');
    expect(valueFits(e)).toBe(true);
  });

  test('a list of lists of points', () => {
    const ce = engine('A | list<list<tuple<number, number>>>', true);
    expect(ce.box(['k', 'x']).type.toString()).toBe('list<list<number>>');
  });

  test('a list of points with an absent arm', () => {
    const ce = engine('A | list<tuple<number, number> | missing>', true);
    expect(ce.box(['k', 'x']).type.toString()).toBe('list<missing | number>');
  });

  test('a nominal type', () => {
    const ce = engine('A | list<list<tuple<number, number>>>', false);
    expect(ce.box(['k', 'x']).type.toString()).toBe('list<list<number>>');
  });
});

describe('A CONDITIONAL WITH AN ERROR BRANCH AND NO SELECTED BRANCH', () => {
  // When no branch is selected, an `If` with no else branch and a `Which`
  // whose last condition is not `True` give `Missing`. That outcome is not
  // an error, so the call is not typed `error`.
  const ce = new ComputeEngine();
  ce.box([
    'Assign',
    'f',
    [
      'Function',
      ['If', 'b', ['Add', ['At', 'a', 1], ['At', 'a', 2]]],
      'a',
      'b',
    ],
  ]).evaluate();
  ce.box([
    'Assign',
    'g',
    [
      'Function',
      ['Which', 'b', ['Add', ['At', 'a', 1], ['At', 'a', 2]]],
      'a',
      'b',
    ],
  ]).evaluate();
  ce.box([
    'Assign',
    'h',
    [
      'Function',
      [
        'Which',
        'b',
        ['Add', ['At', 'a', 1], ['At', 'a', 2]],
        'True',
        ['At', 'a', 3],
      ],
      'a',
      'b',
    ],
  ]).evaluate();

  test.each(['f', 'g'])('%s(3, False) is not typed error', (name) => {
    const e = ce.box([name, 3, 'False']);
    expect(e.type.toString()).not.toBe('error');
    expect(e.evaluate().toString()).toBe('"Missing"');
    expect(valueFits(e)).toBe(true);
  });

  test('a Which with a True default and only error branches is error', () => {
    const e = ce.box(['h', 3, 'False']);
    expect(e.type.toString()).toBe('error');
    expect(e.evaluate().type.toString()).toBe('error');
  });
});

describe('AN APPLIED LITERAL WITH AN ARGUMENT OUTSIDE ITS PARAMETER', () => {
  const ce = new ComputeEngine();
  ce.declare('k', '(tuple<number, number>) -> number');
  ce.assign(
    'k',
    ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'])
  );
  const L = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];

  test.each([
    ['Apply', ['Apply', ['Function', ['k', 'x'], 'x'], 3]],
    ['Pipe', ['Pipe', 3, ['Function', ['k', 'x'], 'x']]],
  ] as const)('%s over a number is typed error, as its value is', (_, json) => {
    const e = ce.box(json as any);
    expect(e.type.toString()).toBe('error');
    expect(e.evaluate().type.toString()).toBe('error');
  });

  test('Apply over a list of points is typed from the body', () => {
    const e = ce.box(['Apply', ['Function', ['k', 'x'], 'x'], L]);
    expect(e.evaluate().toString()).toBe('[3,7]');
    expect(valueFits(e)).toBe(true);
  });
});
