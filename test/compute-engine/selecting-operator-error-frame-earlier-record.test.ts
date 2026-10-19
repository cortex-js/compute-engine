import { ComputeEngine } from '../../src/compute-engine';

//
// A selecting operator (`If`, `Which`, `Coalesce`) names the operand that
// made the error it returns from the record of the evaluation that returned
// the error. The record lives as long as the error object, so it can be from
// an EARLIER evaluation: the error that `g("a")` returned, assigned to `y`,
// is the value of the else branch `y` of `If(c, g("a"), y)`. That record must
// not be used: the else branch (argument 3) was taken, and `g("a")`
// (argument 2) was not evaluated. With no record of this evaluation and no
// operand that holds the error, the frame falls back to argument 1.
//

function frames(json: unknown): unknown {
  const trace = (json as unknown[]).find(
    (x) => Array.isArray(x) && x[0] === 'ErrorTrace'
  ) as unknown[] | undefined;
  return trace?.slice(1);
}

function setup() {
  const ce = new ComputeEngine();
  ce.parse('g(x) := 1/x').evaluate();
  const ga = ce.box(['g', "'a'"]);
  const e1 = ga.evaluate();
  ce.assign('y', e1);
  return { ce, ga };
}

describe('a record from an earlier evaluation does not name the operand', () => {
  test('If, else branch is a symbol that holds the earlier error (evaluate)', () => {
    const { ce, ga } = setup();
    ce.assign('c', false);
    const v = ce.box(['If', 'c', ga, 'y']).evaluate();
    expect(v.operator).toBe('Error');
    expect(frames(v.json)).toEqual([['ErrorFrame', "'If'", 1]]);
  });

  test('If, else branch is a symbol that holds the earlier error (evaluateAsync)', async () => {
    const { ce, ga } = setup();
    ce.assign('c', false);
    const v = await ce.box(['If', 'c', ga, 'y']).evaluateAsync();
    expect(v.operator).toBe('Error');
    expect(frames(v.json)).toEqual([['ErrorFrame', "'If'", 1]]);
  });

  test('If, then branch evaluated now is still named (evaluate)', () => {
    const { ce, ga } = setup();
    ce.assign('c', true);
    const v = ce.box(['If', 'c', ga, 'y']).evaluate();
    expect(frames(v.json)).toEqual([['ErrorFrame', "'If'", 2]]);
  });

  test('If, else branch evaluated now is still named (evaluate)', () => {
    const { ce, ga } = setup();
    ce.assign('c', false);
    const v = ce.box(['If', 'c', 0, ga]).evaluate();
    expect(frames(v.json)).toEqual([['ErrorFrame', "'If'", 3]]);
  });
});
