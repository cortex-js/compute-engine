import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A declared result type is checked against the RETURNED VALUE when the
// function is applied.
//
// The engine accepts a definition whose body cannot meet the declared result:
// the declaration stays the type contract, and the compiler declines it
// (see the header of `list-valued-summand-compile.test.ts`). The declared
// result is ascribed onto the stored body, so `g` declared
// `(integer) -> integer` and assigned `n ↦ "s"` stores
// `Function(Typed("s", 'integer'), n)`. Before this check, `g(5)` was typed
// `integer` and evaluated to `"s"` with no error. Now the `Typed` evaluate
// handler compares a concrete returned value with the ascribed type, and a
// value that does not conform evaluates to an `incompatible-type` error.
//
// A symbolic value, an absence marker (`Missing`, `Nothing`) and `NaN` pass
// unchanged: a declared result constrains successful values only
// (`docs/ERROR-MODEL.md`, section 4).
//

const S_ERROR =
  'Error(ErrorCode("incompatible-type", "integer", "string"), "s")';

/** A `Typed` parameter that carries a type annotation. */
function p(name: string, type: string): MathJsonExpression {
  return ['Typed', name, { str: type }];
}

type Route = [string, (ce: ComputeEngine) => void];

/** Each route installs `g`, declared `(integer) -> integer`, with a body that
 * returns the string `"s"`. */
const ROUTES: Route[] = [
  [
    'ce.declare + ce.assign of a parsed function literal',
    (ce) => {
      ce.declare('g', '(integer) -> integer');
      ce.assign('g', ce.parse('n \\mapsto "s"'));
    },
  ],
  [
    'ce.declare + ce.assign of a boxed function literal',
    (ce) => {
      ce.declare('g', '(integer) -> integer');
      ce.assign('g', ce.box(['Function', "'s'", 'n']));
    },
  ],
  [
    'object-form declaration (operator slot) + ce.assign',
    (ce) => {
      ce.declare('g', { signature: '(integer) -> integer' });
      ce.assign('g', ce.box(['Function', "'s'", 'n']));
    },
  ],
  [
    'declare with a value',
    (ce) => {
      ce.declare('g', {
        type: '(integer) -> integer',
        value: ce.box(['Function', "'s'", 'n']),
      });
    },
  ],
  [
    'ce.declare + a DefineFunction clause',
    (ce) => {
      ce.declare('g', '(integer) -> integer');
      ce.box([
        'DefineFunction',
        'g',
        ['Function', { str: 's' }, 'n'],
      ]).evaluate();
    },
  ],
  [
    'Epsil clause with a declared signature',
    (ce) => {
      const { diagnostics } = executeEpsil(
        ce,
        'let g: (integer) -> integer\ng(n) = "s"'
      );
      expect(diagnostics).toEqual([]);
    },
  ],
  [
    'Epsil second clause with a declared signature',
    (ce) => {
      const { diagnostics } = executeEpsil(
        ce,
        'let g: (integer) -> integer\ng(0) = 1\ng(n) = "s"'
      );
      expect(diagnostics).toEqual([]);
    },
  ],
];

describe('a declared result is checked against the returned value', () => {
  test.each(ROUTES)('%s: the definition is accepted', (_, define) => {
    const ce = new ComputeEngine();
    expect(() => define(ce)).not.toThrow();
    // The declaration stays the type contract.
    expect(ce.box('g').type.toString()).toBe('(integer) -> integer');
    expect(ce.box(['g', 5]).type.toString()).toBe('integer');
  });

  test.each(ROUTES)('%s: evaluate', (_, define) => {
    const ce = new ComputeEngine();
    define(ce);
    expect(ce.box(['g', 5]).evaluate().toString()).toBe(S_ERROR);
  });

  test.each(ROUTES)('%s: N', (_, define) => {
    const ce = new ComputeEngine();
    define(ce);
    expect(ce.box(['g', 5]).N().toString()).toBe(S_ERROR);
  });

  test.each(ROUTES)('%s: evaluateAsync', async (_, define) => {
    const ce = new ComputeEngine();
    define(ce);
    const v = await ce.box(['g', 5]).evaluateAsync();
    expect(v.toString()).toBe(S_ERROR);
  });

  test('an Epsil program that applies the function', () => {
    const { value, diagnostics } = executeEpsil(
      new ComputeEngine(),
      'let g: (integer) -> integer\ng(n) = "s"\ng(5)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe(S_ERROR);
  });

  test('the clause that conforms still answers its value', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let g: (integer) -> integer\ng(0) = 1\ng(n) = "s"');
    expect(ce.box(['g', 0]).evaluate().toString()).toBe('1');
  });

  test.each<[string, MathJsonExpression, string, string]>([
    ['a boolean', ['Greater', 'n', 0], '(integer) -> integer', '"boolean"'],
    ['a rational', ['Divide', 'n', 2], '(integer) -> integer', '"rational'],
    [
      'a list with a string element',
      ['List', 1, "'s'"],
      '(integer) -> list<integer>',
      '"list<integer | string>"',
    ],
  ])(
    'a returned value that is %s and does not conform is an error',
    (_, body, signature, actual) => {
      const ce = new ComputeEngine();
      ce.declare('g', signature);
      ce.assign('g', ce.box(['Function', body, 'n']));
      const v = ce.box(['g', 5]).evaluate();
      expect(v.operator).toBe('Error');
      expect(v.toString()).toContain('"incompatible-type"');
      expect(v.toString()).toContain(actual);
    }
  );

  test.each<[string, MathJsonExpression, number, string]>([
    // `n / 2` is a `number`, wider than `integer`: an even argument returns
    // an integer, which conforms.
    ['a value that conforms', ['Divide', 'n', 2], 4, '2'],
    // A call of an unknown function stays symbolic.
    ['a symbolic value', ['u', 'n'], 5, 'u(5)'],
    // The absence and failure markers are not incompatible values.
    ['Missing', 'Missing', 5, '"Missing"'],
    ['Nothing', 'Nothing', 5, '"Nothing"'],
    ['NaN', 'NaN', 5, 'NaN'],
    ['an else-less If', ['If', ['Greater', 'n', 0], 1], -1, '"Missing"'],
  ])('%s passes unchanged', (_, body, arg, expected) => {
    const ce = new ComputeEngine();
    ce.declare('g', '(integer) -> integer');
    ce.assign('g', ce.box(['Function', body, 'n']));
    expect(ce.box(['g', arg]).evaluate().toString()).toBe(expected);
  });

  test('a symbolic value passes unchanged on the async route', async () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(integer) -> integer');
    ce.assign('g', ce.box(['Function', ['u', 'n'], 'n']));
    expect((await ce.box(['g', 5]).evaluateAsync()).toString()).toBe('u(5)');
  });

  test('a function value is not checked against a signature result', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(integer) -> ((integer) -> integer)');
    ce.assign(
      'g',
      ce.box(['Function', ['Function', ['Add', 'x', 'n'], 'x'], 'n'])
    );
    expect(
      ce
        .box([['g', 5], 2] as MathJsonExpression)
        .evaluate()
        .toString()
    ).toBe('7');
  });

  test('a scalar under a grouped function-valued result is an error', () => {
    // `((integer) -> integer)` is the type of a returned function, not the
    // marker form of the literal's own signature, so it is checked.
    const ce = new ComputeEngine();
    ce.declare('g', '(integer) -> ((integer) -> integer)');
    ce.assign('g', ce.parse('n \\mapsto "s"'));
    expect(ce.box(['g', 5]).evaluate().toString()).toBe(
      'Error(ErrorCode("incompatible-type", "(integer) -> integer", "string"), "s")'
    );
  });

  test('a list, tuple or character that broadcasts the declared result conforms', () => {
    const ce = new ComputeEngine();
    // The declared scalar result, computed once per point of a list argument.
    ce.declare(
      'norm',
      '(list<tuple<number, number>> | tuple<number, number>) -> number'
    );
    ce.assign(
      'norm',
      ce.box(['Function', ['Abs', ['Subtract', 'P', ['Tuple', 1, 2]]], 'P'])
    );
    expect(
      ce
        .box(['norm', ['List', ['Tuple', 4, 6], ['Tuple', 1, 2]]])
        .evaluate()
        .toString()
    ).toBe('[5,0]');
    // A character is the same value as the one-cluster string.
    ce.declare('first', '(string) -> string');
    ce.assign('first', ce.box(['Function', ['At', 's', 1], 's']));
    expect(
      ce
        .box(['first', { str: 'abc' }])
        .evaluate()
        .toString()
    ).toBe('"a"');
    // A string element under a numeric list result is still refused.
    expect(
      ce
        .box(['Typed', ['List', { str: 's' }], { str: 'list<integer>' }])
        .evaluate()
        .toString()
    ).toBe(
      'Error(ErrorCode("incompatible-type", "list<integer>", "list<string^1>"), ["s"])'
    );
  });

  test('a numeric approximation of a rational or integer result is not refused', async () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(integer) -> rational');
    ce.assign('g', ce.parse('n \\mapsto \\frac{1}{n}'));
    expect(ce.box(['g', 3]).evaluate().toString()).toBe('1/3');
    expect(ce.box(['g', 3]).N().toString()).toBe('0.333333333333333333333');
    expect((await ce.box(['g', 3]).evaluateAsync()).toString()).toBe('1/3');
    // Rounding moves the float of an integer result off the integer.
    ce.declare('r', '(integer) -> integer');
    ce.assign('r', ce.parse('n \\mapsto (n^{1/3})^3'));
    expect(ce.box(['r', 7]).evaluate().toString()).toBe('7');
    expect(ce.box(['r', 7]).N().re).toBeCloseTo(7, 12);
    // A list of floats under a list of rationals.
    expect(
      ce
        .box(['Typed', ['List', ['Rational', 1, 3]], { str: 'list<rational>' }])
        .N()
        .toString()
    ).toBe('[0.333333333333333333333]');
    // A string is refused under `.N()` too.
    ce.declare('q', '(integer) -> integer');
    ce.assign('q', ce.parse('n \\mapsto "s"'));
    expect(ce.box(['q', 1]).N().toString()).toBe(S_ERROR);
    // A complex float under a real result gets no allowance.
    ce.declare('c', '(number) -> real');
    ce.assign('c', ce.parse('z \\mapsto z^2'));
    expect(
      ce
        .box(['c', ['Complex', 1.5, 1]])
        .N()
        .toString()
    ).toMatch(/^Error\(ErrorCode\("incompatible-type", "real", /);
  });
});

describe('a Typed ascription written by the user', () => {
  test('Typed(2 + 3, "integer") evaluates to 5', () => {
    const ce = new ComputeEngine();
    const v = ce.box(['Typed', ['Add', 2, 3], "'integer'"]);
    expect(v.evaluate().toString()).toBe('5');
    expect(v.N().toString()).toBe('5');
  });

  test('Typed(2 + 3, "integer") evaluates to 5 on the async route', async () => {
    const ce = new ComputeEngine();
    const v = await ce
      .box(['Typed', ['Add', 2, 3], "'integer'"])
      .evaluateAsync();
    expect(v.toString()).toBe('5');
  });

  // The check is in the `Typed` evaluate handler, so an ascription the user
  // wrote is checked in the same way as the one a declaration wrote.
  test('Typed("s", "integer") is an error', async () => {
    const ce = new ComputeEngine();
    const t = ce.box(['Typed', "'s'", "'integer'"]);
    expect(t.evaluate().toString()).toBe(S_ERROR);
    expect((await t.evaluateAsync()).toString()).toBe(S_ERROR);
  });

  test('a symbolic operand passes unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Typed', ['Add', 'x', 1], "'integer'"])
        .evaluate()
        .toString()
    ).toBe('x + 1');
  });
});

// A redefinition over a signature that the engine DERIVED from the previous
// literal takes the result of the new body. The derived result is a record
// of the previous body, not a contract on the name, so the check must not
// refuse the new value.
describe('a redefinition over a derived signature re-infers the result', () => {
  test('ce.assign of an annotated literal, twice', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.parse('(a: integer) \\mapsto 1'));
    expect(ce.box('h').type.toString()).toBe('(a: integer) -> integer');
    ce.assign('h', ce.parse('(a: integer) \\mapsto "s"'));
    expect(ce.box('h').type.toString()).toBe('(a: integer) -> string');
    expect(ce.box(['h', 0]).type.toString()).toBe('string');
    expect(ce.box(['h', 0]).evaluate().toString()).toBe('"s"');
  });

  test('a DefineFunction clause that replaces the clause with the same parameter domain', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DefineFunction',
      'h',
      ['Function', 1, p('a', 'integer')],
    ]).evaluate();
    ce.box([
      'DefineFunction',
      'h',
      ['Function', { str: 's' }, p('a', 'integer')],
    ]).evaluate();
    expect(ce.box(['h', 0]).type.toString()).toBe('string');
    expect(ce.box(['h', 0]).evaluate().toString()).toBe('"s"');
  });

  test('an Epsil redefinition in a second program', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'h(a: integer) = 1');
    const { value, diagnostics } = executeEpsil(
      ce,
      'h(a: integer) = "s"\nh(0)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('"s"');
    expect(ce.box(['h', 0]).type.toString()).toBe('string');
  });

  test('the async route', async () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.parse('(a: integer) \\mapsto 1'));
    ce.assign('h', ce.parse('(a: integer) \\mapsto "s"'));
    expect((await ce.box(['h', 0]).evaluateAsync()).toString()).toBe('"s"');
  });

  test('a return type that the new literal states is still checked', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.parse('(a: integer) \\mapsto 1'));
    ce.assign(
      'h',
      ce.box(['Function', ['Typed', "'s'", "'integer'"], p('a', 'integer')])
    );
    expect(ce.box(['h', 0]).evaluate().toString()).toBe(S_ERROR);
  });

  test('a declared signature keeps its result as a contract', () => {
    const ce = new ComputeEngine();
    ce.declare('h', { signature: '(a: integer) -> integer' });
    ce.assign('h', ce.parse('(a: integer) \\mapsto 1'));
    ce.assign('h', ce.parse('(a: integer) \\mapsto "s"'));
    expect(ce.box('h').type.toString()).toBe('(a: integer) -> integer');
    expect(ce.box(['h', 0]).evaluate().toString()).toBe(S_ERROR);
  });
});
