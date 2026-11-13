/**
 * The types of the parameters of a function literal are written on their
 * definitions once, when the boxing of the literal ends (decision D18 of
 * `docs/plans/2026-11-11-bound-once-spec.md`). One state event follows that
 * write when it changes a type. The event is what the cached types of OTHER
 * nodes need: a type cached during the boxing (here, the recursive call of a
 * function whose signature is derived while the signature of the function it
 * calls is still provisional) can depend on the type of a parameter before
 * the literal is complete. Without the event, `G` below kept the signature
 * `-> unknown` that it was given while `F` was being derived.
 *
 * The same write does not replace the type that an assignment in the body
 * gives a parameter (the second group).
 */
import { ComputeEngine } from '../../src/compute-engine';

function pair(order: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('F', '(unknown, unknown) -> unknown');
  ce.declare('G', '(unknown, unknown) -> unknown');
  const F = [
    'Function',
    [
      'Which',
      ['Equal', 'n', ['Subtract', 'K', 1]],
      ['List', 'n'],
      ['Equal', 'n', ['Subtract', 'K', 2]],
      ['Join', ['List', 'n'], ['F', ['Add', 'n', 1], 'K']],
      'True',
      ['Join', ['List', 'n'], ['G', ['Add', 'n', 1], 'K']],
    ],
    'n',
    'K',
  ];
  const G = ['Function', ['F', 'n', 'K'], 'n', 'K'];
  for (const name of order)
    ce.assign(name, ce.box((name === 'F' ? F : G) as never));
  return ce;
}

describe('D18: THE STATE EVENT AT THE END OF THE BOXING OF A LITERAL', () => {
  test.each(['FG', 'GF'])(
    'a recursive pair assigned in the order %s keeps the derived signature after F is read again',
    (order) => {
      const ce = pair(order);
      expect(ce.box('F').type.toString()).toBe(
        '(unknown, unknown) -> list<number>'
      );
      expect(ce.box('G').type.toString()).toBe(
        '(unknown, unknown) -> list<number>'
      );
      // Read F again, then G: G is not the signature cached while F was
      // provisional.
      expect(ce.box('F').type.toString()).toBe(
        '(unknown, unknown) -> list<number>'
      );
      expect(ce.box('G').type.toString()).toBe(
        '(unknown, unknown) -> list<number>'
      );
      expect(ce.box(['G', 0, 4]).evaluate().toString()).toBe('[0,1,2,3]');
    }
  );
});

// The record of the uses of a parameter is not written over the type that
// the assignments in the body give it (`_assignmentEvidence`): an
// assignment replaces a type that only uses gave.
describe('D18: THE END-OF-LITERAL WRITE KEEPS ASSIGNMENT EVIDENCE', () => {
  test('a use before the assignment', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Block', ['Add', 'x', 1], ['Assign', 'x', ['List', 1, 2]], 'x'],
      'x',
    ] as never);
    expect(f.type.toString()).toBe(
      '(x: vector<integer^2>) -> vector<integer^2>'
    );
    expect(
      ce
        .box(['Apply', f, 3] as never)
        .evaluate()
        .toString()
    ).toBe('[1,2]');
  });

  test('a use after the assignment', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Block', ['Assign', 'x', ['List', 1, 2]], ['Add', 'x', 1], 'x'],
      'x',
    ] as never);
    expect(f.type.toString()).toBe('(x: unknown) -> number');
    expect(
      ce
        .box(['Apply', f, 3] as never)
        .evaluate()
        .toString()
    ).toBe('[1,2]');
  });
});
