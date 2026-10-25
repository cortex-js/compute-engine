/**
 * ROADMAP CE-447: a conditional with an `unknown` branch was typed by its
 * other branch.
 *
 * `f := (n, s) ↦ If(n = 0, s[1], [1, 2])` had the signature
 * `(unknown, dictionary<any> | indexed_collection<any>) -> vector<integer^2>`,
 * and `f(0, [7])` was typed `vector<integer^2>` but evaluates to `7`. The
 * join of the branch types is neutral in `unknown`, so the `s[1]` branch
 * added nothing. A branch typed `unknown` because of the types of its
 * operands (here a parameter whose elements are of any type) now makes the
 * conditional `unknown`, as an untyped symbol branch already did. A
 * recursive call typed `unknown` while its signature is derived keeps the
 * join of the other branches, so a recursive function is still typed by
 * its base case.
 */
import { ComputeEngine } from '../../src/compute-engine';

describe('A CONDITIONAL WITH AN UNKNOWN BRANCH (CE-447)', () => {
  test('the signature holds the value of the unknown branch', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box([
        'Function',
        ['If', ['Equal', 'n', 0], ['At', 's', 1], ['List', 1, 2]],
        'n',
        's',
      ])
    );
    expect(ce.box('f').type.toString()).toBe(
      '(unknown, dictionary<any> | indexed_collection<any>) -> unknown'
    );
    const call = ce.box(['f', 0, ['List', 7]]);
    const value = call.evaluate();
    expect(value.toString()).toBe('7');
    expect(value.type.matches(call.type)).toBe(true);
  });

  test('a Which with such a branch is unknown', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'w',
      ce.box([
        'Function',
        [
          'Which',
          ['Equal', 'n', 0],
          ['At', 's', 1],
          'True',
          ['List', 1, 2],
        ],
        'n',
        's',
      ])
    );
    expect(ce.box('w').type.toString()).toBe(
      '(unknown, dictionary<any> | indexed_collection<any>) -> unknown'
    );
  });

  test('a recursive function is still typed by its base case', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'r',
      ce.box([
        'Function',
        ['If', ['Equal', 'n', 0], 1, ['r', ['Subtract', 'n', 1]]],
        'n',
      ])
    );
    expect(ce.box('r').type.toString()).toBe('(unknown) -> integer');
  });
});
