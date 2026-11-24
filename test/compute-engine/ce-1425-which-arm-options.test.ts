import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// CE-1425: `Which` evaluated the arm that it selects with the options of its
// handler, which also hold keys that are not evaluation options (`engine`,
// `expression`). A symbol evaluated with such a key does not use the memo of
// its stored value, so an arm `At(VS, j)` in a function called at each
// element evaluated the whole list `VS` again at each call: the time grew
// with the square of the length. `If` gave its arm only the numeric request.
//
// The tests count the evaluations of the elements of `VS` with a pure host
// function `Count`, which returns its argument.
//

function engine(): { ce: ComputeEngine; calls: () => number } {
  const ce = new ComputeEngine();
  let calls = 0;
  ce.declare('Count', {
    signature: '(any) -> any',
    pure: true,
    evaluate: ([x]) => {
      calls += 1;
      return x.evaluate();
    },
  });
  ce.assign(
    'VS',
    ce.box([
      'List',
      ...[10, 20, 30, 40, 50, 60].map((k): MathJsonExpression => ['Count', k]),
    ])
  );
  ce.assign(
    'CS',
    ce.box(['List', 'False', 'True', 'True', 'False', 'True', 'True'])
  );
  return { ce, calls: () => calls };
}

describe('CE-1425 THE SELECTED ARM OF WHICH READS A SYMBOL THROUGH ITS MEMO', () => {
  test('Which in a callback evaluates the list once, as If does', () => {
    const bodies: MathJsonExpression[] = [
      ['Which', ['At', 'CS', 'j'], ['At', 'VS', 'j'], 'True', 'NaN'],
      ['If', ['At', 'CS', 'j'], ['At', 'VS', 'j'], 'NaN'],
    ];
    for (const body of bodies) {
      const { ce, calls } = engine();
      const before = calls();
      const r = ce
        .box(['ListFrom', ['Map', ['Function', body, 'j'], ['Range', 1, 6]]])
        .evaluate();
      expect(r.json).toEqual(['List', 'NaN', 20, 30, 'NaN', 50, 60]);
      // One evaluation of each element of `VS`, for the first read only.
      expect(calls() - before).toBe(6);
    }
  });

  test('The selected arm keeps the numeric request', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Which', 'False', 1, 'True', ['Divide', 1, 3]])
      .evaluate({ numericApproximation: true });
    expect(r.re).toBeCloseTo(1 / 3, 12);
    expect(
      ce.box(['Which', 'False', 1, 'True', ['Divide', 1, 3]]).evaluate().json
    ).toEqual(['Rational', 1, 3]);
  });
});
