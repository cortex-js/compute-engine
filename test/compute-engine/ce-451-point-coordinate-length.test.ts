/**
 * ROADMAP CE-451: `PointY` over a list of points dropped the length when a
 * coordinate can be absent.
 *
 * `PointY([(1, Missing), (2, 3)])` was typed `list<integer | missing>`,
 * while `PointX` of the same list is `vector<integer^2>`. The result type of
 * a mapping over a list of known length (`listOfLengthType`,
 * `library/collections.ts`) dropped the length for any union that is not a
 * number type. A number that may be absent keeps the length, as it does in
 * the list literal `[Missing, 3]` (`list<integer | missing^2>`).
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

describe('A POINT COORDINATE THAT MAY BE ABSENT KEEPS THE LENGTH (CE-451)', () => {
  it('types PointY of a list with an absent y-coordinate with its length', () => {
    const expr = ce.box([
      'PointY',
      ['List', ['Tuple', 1, 'Missing'], ['Tuple', 2, 3]],
    ]);
    expect(expr.type.toString()).toBe('list<integer | missing^2>');
    const value = expr.evaluate();
    expect(value.toString()).toBe('["Missing",3]');
    expect(value.type.matches(expr.type)).toBe(true);
  });

  it('types PointX of a list with an absent x-coordinate with its length', () => {
    const expr = ce.box([
      'PointX',
      ['List', ['Tuple', 'Missing', 1], ['Tuple', 2, 3]],
    ]);
    expect(expr.type.toString()).toBe('list<integer | missing^2>');
  });

  it('types a Map whose callback may answer Missing with its length', () => {
    const expr = ce.box([
      'Map',
      ['Function', ['If', ['Equal', 'x', 1], 'Missing', 'x'], 'x'],
      ['List', 1, 2],
    ]);
    expect(expr.type.toString()).toBe('list<integer | missing^2>');
    expect(expr.evaluate().type.matches(expr.type)).toBe(true);
  });

  it('keeps no length for a union with a string', () => {
    const expr = ce.box([
      'Map',
      ['Function', ['If', ['Equal', 'x', 1], "'x'", 'x'], 'x'],
      ['List', 1, 2],
    ]);
    expect(expr.type.toString()).toBe('list<integer | string>');
  });
});
