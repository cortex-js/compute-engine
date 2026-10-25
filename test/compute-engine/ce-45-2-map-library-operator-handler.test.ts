/**
 * ROADMAP CE-45.2: a LIBRARY operator given by name as the callback of `Map`
 * is typed by its own type handler on the element type, as the lambda
 * spelling is (user decision 2026-10-25, option b). Before, the element type
 * was the declared result of the operator: `Map(Abs, xs)` with
 * `xs: list<integer>` was `list<number>`, while `Map(x ↦ |x|, xs)` was
 * `list<integer<0..>>`.
 *
 * A USER function keeps the declared result of its signature (user decision
 * 2026-09-27), and an assigned lambda given by name is not changed.
 */
import { ComputeEngine } from '../../src/compute-engine';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('xs', 'list<integer>');
  ce.declare('ys', 'list<integer>');
  ce.declare('rs', 'list<real>');
  return ce;
}

describe('A NAMED LIBRARY OPERATOR IS TYPED BY ITS HANDLER (CE-45.2)', () => {
  test.each([
    ['Abs', 'list<integer<0..>>'],
    ['Sin', 'list<real>'],
    ['Negate', 'list<integer>'],
    ['Floor', 'list<integer>'],
    ['Sign', 'list<integer<-1..1>>'],
    ['Re', 'list<real>'],
    // A generic operator is instantiated on the element. `Conjugate` is
    // declared `(T) -> T`; the element type was `unknown`.
    ['Conjugate', 'list<integer>'],
  ])('Map(%s, xs) is %s, as the lambda spelling', (op, expected) => {
    const ce = engine();
    const named = ce.box(['Map', op, 'xs']);
    const lambda = ce.box(['Map', ['Function', [op, 'x'], 'x'], 'xs']);
    expect(named.type.toString()).toBe(expected);
    expect(named.type.toString()).toBe(lambda.type.toString());
    // The parse route agrees with the box route.
    expect(
      ce
        .parse(`\\operatorname{Map}(\\operatorname{${op}}, \\operatorname{xs})`)
        .type.toString()
    ).toBe(expected);
  });

  test.each([
    ['Abs', ['List', -3, 2], '[3,2]'],
    ['Sin', ['List', 0, 0], '[0,0]'],
    ['Negate', ['List', 1, 2], '[-1,-2]'],
    ['Floor', ['List', 1.5, -0.5], '[1,-1]'],
    ['Conjugate', ['List', 1, 2], '[1,2]'],
  ])('the value of Map(%s, …) matches its type', (op, source, value) => {
    const ce = engine();
    const m = ce.box(['Map', op, source]);
    const v = m.evaluate();
    expect(v.toString()).toBe(value);
    expect(v.type.matches(m.type)).toBe(true);
  });

  test('the zip form is typed by the handler for every source', () => {
    const ce = engine();
    for (const [op, a, b, expected] of [
      ['Add', 'xs', 'ys', 'list<integer>'],
      ['Multiply', 'xs', 'ys', 'list<integer>'],
      ['Multiply', 'xs', 'rs', 'list<real>'],
      ['Max', 'xs', 'ys', 'list<integer>'],
    ]) {
      const named = ce.box(['Map', op, a, b]);
      const lambda = ce.box([
        'Map',
        ['Function', [op, 'x', 'y'], 'x', 'y'],
        a,
        b,
      ]);
      expect(named.type.toString()).toBe(expected);
      expect(named.type.toString()).toBe(lambda.type.toString());
    }
    const m = ce.box(['Map', 'Multiply', ['List', 1, 2], ['List', 3, 4]]);
    const v = m.evaluate();
    expect(v.toString()).toBe('[3,8]');
    expect(m.type.toString()).toBe('vector<integer^2>');
    expect(v.type.matches(m.type)).toBe(true);
  });

  test('an absent cell is typed as the lambda spelling (CE-453)', () => {
    const ce = engine();
    for (const op of ['Abs', 'Floor', 'Sign']) {
      const src = ['List', 1, 'Missing', 2];
      const named = ce.box(['Map', op, src]);
      const lambda = ce.box(['Map', ['Function', [op, 'x'], 'x'], src]);
      expect(named.type.toString()).toBe('list<integer | nan^3>');
      expect(named.type.toString()).toBe(lambda.type.toString());
      expect(named.evaluate().type.matches(named.type)).toBe(true);
    }
  });
});

describe('A USER FUNCTION KEEPS ITS DECLARED RESULT (CE-45.2)', () => {
  test('a function declared with a signature', () => {
    const ce = engine();
    ce.declare('h', '(number) -> number');
    expect(ce.box(['Map', 'h', 'xs']).type.toString()).toBe('list<number>');
  });

  test('an assigned lambda given by name', () => {
    const ce = engine();
    ce.assign('g', ce.parse('x \\mapsto x + 10'));
    expect(ce.box(['Map', 'g', 'xs']).type.toString()).toBe('list<number>');
  });
});
