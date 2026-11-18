/**
 * Issue #369: a fold whose accumulator is a list that each step extends with
 * `Join` evaluates but did not compile, and the consumers of such a fold
 * (`Length`, `At`) refused its `collection<any>`-typed result.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { parseEpsil } from '../../src/epsil/parse-epsil';

const BODY = ['Join', 'acc', ['List', ['Multiply', 2, ['At', 'p', 'i']]]];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('p', 'list<integer>');
  return ce;
}

describe('issue #369: the consumers of a list-building fold compile', () => {
  it('a block local that is not a function shadows an engine function of the same name', () => {
    // The code reads the local (`5`), so the engine's `step` must not be the
    // literal the fold is planned with: the fold declines.
    const ce = engine();
    ce.assign('step', ce.box(['Function', BODY, 'acc', 'i'] as any));
    const program = parseEpsil(
      'let step = 5\nLength(Fold(step, [], 1..Length(p)))'
    )[0];
    expect(() => compile(ce.box(program), { fallback: false })).toThrow(
      /Could not compile/
    );
  });
});
