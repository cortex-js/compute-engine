/**
 * Issue #506: the bare accumulator of a fold whose callback body is already
 * a `Block` (the form that the canonical MathJSON of a literal has) was not
 * typed from the seed when the fold was inside an enclosing literal.
 *
 * The fold refinement (`fixpointLiteral`, `library/collections.ts`)
 * canonicalizes the raw callback once per step, each time with another
 * inferred type for the accumulator. `canonicalFunctionLiteral` read a raw
 * `Block` body through `get canonical`, which gives a raw node met again in
 * the same read and the same lexical scope the canonical form of the first
 * time. So every step got the body of the first step, where the accumulator
 * is `unknown`. The fold was then typed `unknown`, and the compiler, which
 * rebuilds a list-accumulator combiner from its MathJSON
 * (`listAccumulatorStep`, `compilation/javascript-target.ts`), declined.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const BODY = [
  'If',
  ['And', ['Equal', 'f', 0], ['Equal', ['At', 'us', 'v'], 1]],
  'v',
  'f',
];
const innerFold = (body: unknown) => [
  'Reduce',
  ['Range', 1, 3, 1],
  ['Function', body, 'f', 'v'],
  0,
];
const US = ['Typed', 'us', "'list<integer>'"];

describe('issue #506: a fold accumulator with a Block body is typed', () => {
  it('types the fold the same with and without the Block', () => {
    const ce = new ComputeEngine();
    const plain = ce.box(['Function', innerFold(BODY), US] as any);
    const block = ce.box(['Function', innerFold(['Block', BODY]), US] as any);
    expect(plain.type.toString()).toBe('(us: list<integer>) -> number');
    expect(block.type.toString()).toBe('(us: list<integer>) -> number');
  });

  it('gives the canonical MathJSON of a literal the type of the literal', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', innerFold(BODY), US] as any);
    expect(ce.box(f.json).type.toString()).toBe(f.type.toString());
  });

  it('compiles the example of the issue', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const first = [
      'Fold',
      ['Function', BODY, 'f', 'v'],
      0,
      ['Range', 1, 3, 1],
    ];
    const step = [
      'Apply',
      [
        'Function',
        ['ReplaceAt', 'us', ['Max', 'x', 1], 0],
        ['Typed', 'x', "'integer'"],
      ],
      first,
    ];
    const e = ce.box([
      'Fold',
      ['Function', step, 'us', 'i'],
      ['List', 1, 1, 0],
      ['Range', 1, 'n', 1],
    ] as any);
    expect(e.subs({ n: 2 }).evaluate().json).toEqual(['List', 0, 0, 0]);
    const result = compile(e, { fallback: false });
    expect(result.success).toBe(true);
    expect(result.run!({ n: 2 })).toEqual([0, 0, 0]);
  });
});
