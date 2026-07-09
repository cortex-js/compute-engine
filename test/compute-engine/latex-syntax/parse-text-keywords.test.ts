import { ComputeEngine } from '../../../src/compute-engine';
import { engine as ce } from '../../utils';

describe('DOUBLE-QUOTED STRING LITERALS', () => {
  test('parses a double-quoted string', () => {
    expect(ce.parse('"hello"').string).toBe('hello');
  });

  test('parses an empty string', () => {
    expect(ce.parse('""').string).toBe('');
  });

  test('preserves spaces', () => {
    expect(ce.parse('"a b c"').string).toBe('a b c');
  });

  test('normalizes commands to Unicode, like \\text', () => {
    expect(ce.parse('"\\alpha"').string).toBe('α');
  });

  test('serializes back to \\text{…} (no round-trip to quotes)', () => {
    expect(ce.parse('"hello"').latex).toBe('\\text{hello}');
  });

  test('does not interfere with \\unicode hex prefix', () => {
    // The `"` inside `\unicode{…}` is a hex prefix on a separate parse path.
    expect(ce.parse('\\unicode{"2012}').json).toEqual('____002012');
  });

  test('an unterminated string is an error', () => {
    expect(ce.parse('"abc').operator).toBe('Error');
  });

  test('reads a dictionary value by key via bracket notation', () => {
    const engine = new ComputeEngine();
    const dict = engine.box({ dict: { height: 42, width: 7 } });
    engine.declare('tbl', dict.type);
    engine.assign('tbl', dict);
    expect(engine.parse('\\mathrm{tbl}["height"]').evaluate().valueOf()).toBe(
      42
    );
  });
});

describe('TEXT KEYWORDS', () => {
  test('\\text{and} as logical conjunction', () => {
    expect(ce.parse('x > 0 \\text{ and } x < 10').json).toMatchInlineSnapshot(`
      [
        And,
        [
          Less,
          0,
          x,
        ],
        [
          Less,
          x,
          10,
        ],
      ]
    `);
  });

  test('\\text{or} as logical disjunction', () => {
    expect(ce.parse('x = 0 \\text{ or } x = 1').json).toMatchInlineSnapshot(`
      [
        Or,
        [
          Equal,
          x,
          0,
        ],
        [
          Equal,
          x,
          1,
        ],
      ]
    `);
  });

  test('\\text{iff} as biconditional', () => {
    expect(ce.parse('P \\text{ iff } Q').json).toMatchInlineSnapshot(`
      [
        Equivalent,
        P,
        Q,
      ]
    `);
  });

  test('\\text{andy} is NOT a keyword (text run)', () => {
    expect(ce.parse('\\text{andy}').json).toMatchInlineSnapshot(`'andy'`);
  });

  test('\\text{organic} is NOT a keyword (text run)', () => {
    expect(ce.parse('\\text{organic}').json).toMatchInlineSnapshot(`'organic'`);
  });

  test('\\text{if and only if} as biconditional', () => {
    expect(ce.parse('P \\text{ if and only if } Q').json)
      .toMatchInlineSnapshot(`
      [
        Equivalent,
        P,
        Q,
      ]
    `);
  });
});

describe('KEYWORD COMMAND (\\keyword{…})', () => {
  test('\\keyword{and} as logical conjunction', () => {
    expect(ce.parse('x > 0 \\keyword{and} x < 10').json).toEqual([
      'And',
      ['Less', 0, 'x'],
      ['Less', 'x', 10],
    ]);
  });

  test('\\keyword{or} as logical disjunction', () => {
    expect(ce.parse('x = 0 \\keyword{or} x = 1').json).toEqual([
      'Or',
      ['Equal', 'x', 0],
      ['Equal', 'x', 1],
    ]);
  });

  test('\\keyword{iff} as biconditional', () => {
    expect(ce.parse('P \\keyword{iff} Q').json).toEqual(['Equivalent', 'P', 'Q']);
  });

  test('\\keyword{if and only if} (multi-word, one token)', () => {
    expect(ce.parse('P \\keyword{if and only if} Q').json).toEqual([
      'Equivalent',
      'P',
      'Q',
    ]);
  });

  test('\\keyword{for all} quantifier', () => {
    expect(ce.parse('\\keyword{for all} x, x > 0').json).toEqual([
      'ForAll',
      'x',
      ['Greater', 'x', 0],
    ]);
  });

  test('\\keyword{where} binding', () => {
    expect(ce.parse('x \\keyword{where} x = 2').json).toEqual([
      'Block',
      ['Equal', 'x', 2],
      'x',
    ]);
  });

  test('mixed \\keyword and \\text spellings interoperate', () => {
    expect(
      ce.parse('x > 0 \\keyword{and} x < 10 \\text{ or } x = -1').json
    ).toEqual(
      ce.parse('x > 0 \\text{ and } x < 10 \\text{ or } x = -1').json
    );
  });

  test('\\keyword{andy} is NOT a keyword (text run)', () => {
    expect(ce.parse('\\keyword{andy}').json).toMatchInlineSnapshot(`'andy'`);
  });
});

describe('TRAILING QUALIFIER CLAUSES', () => {
  test('trailing \\text{for} condition parses as ForAll', () => {
    // A non-binding clause (a condition, not `name = collection`) after `for`
    // is a trailing qualifier: `body for n >= 2` → ForAll(n >= 2, body).
    const engine = new ComputeEngine();
    expect(engine.parse('u_n = 3u_{n-1} \\text{ for } n \\ge 2').json).toEqual([
      'ForAll',
      ['GreaterEqual', 'n', 2],
      ['Equal', 'u_n', ['InvisibleOperator', 3, ['Subscript', 'u', ['Subtract', 'n', 1]]]],
    ]);
  });

  test('trailing \\text{for all} condition parses as ForAll', () => {
    const engine = new ComputeEngine();
    expect(
      engine.parse('u_n = 3u_{n-1} \\text{ for all } n \\ge 2').json
    ).toEqual([
      'ForAll',
      ['GreaterEqual', 'n', 2],
      ['Equal', 'u_n', ['InvisibleOperator', 3, ['Subscript', 'u', ['Subtract', 'n', 1]]]],
    ]);
  });

  test('trailing \\text{for} with a comprehension binding still parses as Comprehension', () => {
    // Regression guard: a `name = collection` clause is a comprehension, not a
    // trailing condition.
    const engine = new ComputeEngine();
    expect(engine.parse('x^2 \\text{ for } x = 1..10').json).toEqual([
      'Comprehension',
      ['Power', 'x', 2],
      ['Element', 'x', ['Range', 1, 10]],
    ]);
  });

  test('a non-condition clause after \\text{for} is not swallowed', () => {
    // `for y` (neither a binding nor a predicate) leaves `for` unconsumed
    // rather than misparsing as a ForAll.
    const engine = new ComputeEngine();
    const e = engine.parse('x^2 \\text{ for } y');
    expect(e.isValid).toBe(false);
  });

  test('English enumeration `and` after a comma is absorbed', () => {
    // `a, b, and c` is a list `a, b, c`, not a stray `and` text token.
    const engine = new ComputeEngine();
    expect(engine.parse('a, b, \\text{and } c').json).toEqual([
      'Tuple',
      'a',
      'b',
      'c',
    ]);
  });

  test('recurrence system: u_0, u_1, u_n = ... for n >= 2', () => {
    const engine = new ComputeEngine();
    const e = engine.parse(
      'u_0 = 0,\\ u_1 = 1,\\ u_n = 2011u_{n-1} - u_{n-2} \\quad \\text{for } n \\ge 2.'
    );
    expect(e.isValid).toBe(true);
    expect(JSON.stringify(e.json)).not.toContain('Error');
    expect(e.operator).toBe('ForAll');
    expect(e.op1.json).toEqual(['GreaterEqual', 'n', 2]);
    // The body is a Tuple of the three equations.
    expect(e.op2.operator).toBe('Tuple');
    expect(e.op2.nops).toBe(3);
  });

  test('recurrence system with fraction: x_1, x_2, x_n = ... for n >= 3', () => {
    const engine = new ComputeEngine();
    const e = engine.parse(
      'x_1 = a, \\quad x_2 = b, \\quad x_n = \\frac{x_{n-1}^2 + x_{n-2}^2}{x_{n-1} + x_{n-2}} \\quad \\text{for } n \\ge 3.'
    );
    expect(e.isValid).toBe(true);
    expect(JSON.stringify(e.json)).not.toContain('Error');
    expect(e.operator).toBe('ForAll');
    expect(e.op1.json).toEqual(['GreaterEqual', 'n', 3]);
    expect(e.op2.operator).toBe('Tuple');
    expect(e.op2.nops).toBe(3);
  });

  test('recurrence system with enumeration `and` and trailing `for all`', () => {
    const engine = new ComputeEngine();
    const e = engine.parse(
      'a_0 = 1, \\quad a_1 = 3, \\quad \\text{and} \\quad a_{n+1} = a_n + a_{n-1} \\quad \\text{for all } n \\ge 1.'
    );
    expect(e.isValid).toBe(true);
    expect(JSON.stringify(e.json)).not.toContain('Error');
    // The `and` connective is absorbed, so there is no stray text token.
    expect(JSON.stringify(e.json)).not.toContain("'and'");
    expect(e.operator).toBe('ForAll');
    expect(e.op1.json).toEqual(['GreaterEqual', 'n', 1]);
    expect(e.op2.operator).toBe('Tuple');
    expect(e.op2.nops).toBe(3);
  });
});
