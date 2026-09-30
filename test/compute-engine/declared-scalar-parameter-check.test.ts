/**
 * A function declared with `ce.declare(name, { signature })` and then
 * assigned its body checks the EVALUATED arguments against the scalar
 * parameter types of the declaration (user decision 2026-09-30).
 *
 * At boxing, an argument is checked against the declared type through its
 * static type. When the static type is not known, nothing checked the value
 * against a scalar parameter: only a non-scalar declared type is written on
 * the stored literal, and the application checks only what the literal
 * annotates. `f` declared `(integer) -> unknown` answered `2.5` for the
 * value `1.5`. The check is `declaredScalarConformance`
 * (`boxed-expression/boxed-function.ts`).
 */
import { ComputeEngine } from '../../src/compute-engine';

const INC = ['Function', ['Add', 'x', 1], 'x'];
const DBL = ['Function', ['Multiply', 2, 'x'], 'x'];

/**
 * The value of `f(u)`, with `f` declared `signature` and assigned `body`
 * (`assignments` times), and `u` a symbol typed `unknown` that receives
 * `value` AFTER the call is boxed: the call is valid at boxing, and the
 * value is known only when it is evaluated.
 */
function late(
  signature: string,
  body: unknown,
  value: unknown,
  assignments = 1
): string {
  const ce = new ComputeEngine();
  ce.declare('f', { signature });
  for (let i = 0; i < assignments; i++) ce.assign('f', ce.box(body as any));
  ce.declare('u', 'unknown');
  const call = ce.box(['f', 'u']);
  expect(call.isValid).toBe(true);
  ce.assign('u', ce.box(value as any));
  return call.evaluate().toString();
}

describe('a value that does not fit a declared scalar parameter', () => {
  test.each([
    ['(integer) -> unknown', INC, 1.5, '"integer", "1.5"'],
    ['(real) -> unknown', DBL, ['Complex', 1, 2], '"real", "complex"'],
    ['(number) -> unknown', INC, { str: 'a' }, '"number", "string"'],
    [
      '(string) -> unknown',
      ['Function', ['Length', 's'], 's'],
      5,
      '"string", "5"',
    ],
    [
      '(boolean) -> unknown',
      ['Function', ['If', 'b', 1, 2], 'b'],
      5,
      '"boolean", "5"',
    ],
  ])('%s refuses it', (signature, body, value, expected) => {
    expect(late(signature, body, value)).toContain(
      `ErrorCode("incompatible-type", ${expected})`
    );
  });

  // The second assignment of a declared function keeps an operator
  // definition; the first one installs a value. Both are checked.
  test('also after the body is assigned a second time', () => {
    expect(late('(integer) -> unknown', INC, 1.5, 2)).toContain(
      'ErrorCode("incompatible-type", "integer", "1.5")'
    );
  });

  test('an absent value at a parameter that is not numeric', () => {
    expect(
      late('(string) -> unknown', ['Function', ['Length', 's'], 's'], 'Missing')
    ).toBe('Error(ErrorCode("incompatible-type", "string", "missing"), "Missing")');
  });

  test('each cell of a list is checked', () => {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: '(integer) -> unknown' });
    ce.assign('f', ce.box(INC as any));
    const cells = ce.box(['f', ['List', 1, 1.5, 2]]).evaluate();
    expect(cells.operator).toBe('List');
    expect((cells as any).ops[0].toString()).toBe('2');
    expect((cells as any).ops[1].toString()).toContain('incompatible-type');
    expect((cells as any).ops[2].toString()).toBe('3');
  });
});

// Each case runs with the body assigned once (the function is held as a
// value) and twice (the second assignment keeps an operator definition):
// the two representations read the declaration through different fields.
describe.each([1, 2])(
  'what the check leaves alone, body assigned %i time(s)',
  (assignments) => {
    test('a value that fits', () => {
      expect(late('(integer) -> unknown', INC, 2, assignments)).toBe('3');
      expect(
        late('(number) -> unknown', DBL, ['Complex', 1, 2], assignments)
      ).toBe('(2 + 4i)');
    });

    // A function with scalar parameters is applied to the elements of a
    // collection, and a point is doubled coordinate by coordinate.
    test.each([
      ['a list', ['List', 1, 2, 3], '[2,4,6]'],
      ['a range', ['Range', 1, 4], '[2,4,6,8]'],
      ['a point', ['Tuple', 1, 2], '(2, 4)'],
      [
        'a list of points',
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
        '[(2, 4),(6, 8)]',
      ],
    ])('%s at a number parameter is broadcast', (_label, value, expected) => {
      expect(late('(number) -> unknown', DBL, value, assignments)).toBe(
        expected
      );
    });

    test('a symbolic argument', () => {
      const ce = new ComputeEngine();
      ce.declare('f', { signature: '(integer) -> unknown' });
      for (let i = 0; i < assignments; i++) ce.assign('f', ce.box(INC as any));
      expect(ce.box(['f', 'n']).evaluate().toString()).toBe('n + 1');
    });

    test('NaN and an absent value at a numeric parameter', () => {
      expect(late('(integer) -> unknown', INC, 'NaN', assignments)).toBe('NaN');
      expect(late('(number) -> unknown', INC, 'Missing', assignments)).toBe(
        'NaN'
      );
    });

    // A slot the author left `unknown` is a placeholder: the type the engine
    // reports for it is inferred from the body and checks nothing.
    test('a placeholder slot', () => {
      expect(late('(unknown) -> unknown', INC, 1.5, assignments)).toBe('2.5');
      expect(
        late(
          '(unknown) -> unknown',
          ['Function', ['Add', ['At', 'p', 1], 1], 'p'],
          'Missing',
          assignments
        )
      ).toBe('NaN');
    });
  }
);

describe('a scalar slot beside a slot that maps', () => {
  // The verdict for the scalar slot must not depend on the shape of the
  // other argument: the check runs before the map over a list of points.
  test('beside a point parameter, with a list of points', () => {
    const ce = new ComputeEngine();
    ce.declare('f', {
      signature: '(tuple<number, number>, integer) -> unknown',
    });
    ce.assign(
      'f',
      ce.box(['Function', ['Add', ['At', 'p', 1], 'n'], 'p', 'n'])
    );
    ce.declare('u', 'unknown');
    const onePoint = ce.box(['f', ['Tuple', 1, 2], 'u']);
    const points = ce.box(['f', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]], 'u']);
    ce.assign('u', 1.5);
    expect(onePoint.evaluate().toString()).toContain('"integer", "1.5"');
    expect(points.evaluate().toString()).toContain('"integer", "1.5"');
  });
});
