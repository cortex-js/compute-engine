import { ComputeEngine } from '../../src/compute-engine';

//
// A selecting operator (`If`, `Which`, `Coalesce`) adds its frame to the
// breadcrumb of an error that its handler returns. When the error was made by
// the EVALUATION of an operand (a call of a user function whose body fails),
// no operand holds it before evaluation, and the frame must still name the
// operand that was evaluated, not operand 1.
//

const ce = new ComputeEngine();
ce.parse('g(x) := 1/x').evaluate();

function frames(json: unknown): unknown {
  const trace = (json as unknown[]).find(
    (x) => Array.isArray(x) && x[0] === 'ErrorTrace'
  ) as unknown[] | undefined;
  return trace?.slice(1);
}

const cases: [string, unknown, unknown][] = [
  [
    'If, then branch',
    ['If', ['Equal', 'n', 2], ['g', "'a'"], 0],
    [['ErrorFrame', "'If'", 2]],
  ],
  [
    'If, else branch',
    ['If', ['Equal', 'n', 3], 0, ['g', "'a'"]],
    [['ErrorFrame', "'If'", 3]],
  ],
  [
    'Which, second clause',
    ['Which', ['Equal', 'n', 3], 0, ['Equal', 'n', 2], ['g', "'a'"]],
    [['ErrorFrame', "'Which'", 4]],
  ],
  [
    'Coalesce, second operand',
    ['Coalesce', 'Missing', ['g', "'a'"]],
    [['ErrorFrame', "'Coalesce'", 2]],
  ],
  [
    'If, two identical boxed errors, else branch taken',
    ['If', ['Equal', 'n', 3], ['Ln', "'a'"], ['Ln', "'a'"]],
    [
      ['ErrorFrame', "'Ln'", 1],
      ['ErrorFrame', "'If'", 3],
    ],
  ],
];

describe('THE FRAME OF AN ERROR MADE BY THE EVALUATION OF AN OPERAND', () => {
  beforeAll(() => ce.assign('n', 2));

  for (const [name, input, expected] of cases) {
    test(`${name} (evaluate)`, () => {
      expect(frames(ce.box(input as any).evaluate().json)).toEqual(expected);
    });
    test(`${name} (evaluateAsync)`, async () => {
      const v = await ce.box(input as any).evaluateAsync();
      expect(frames(v.json)).toEqual(expected);
    });
  }
});
