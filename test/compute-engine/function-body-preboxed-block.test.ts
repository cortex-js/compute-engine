import { ComputeEngine } from '../../src/compute-engine';

//
// A read of a block local in a statement before its `Declare` is the static
// `read-before-declaration` error, in a function body and outside every
// function literal. (The value of a `Declare` reads the name outside the
// block, so it is not such a read.)
//
// A block that the caller boxes first, then gives to
// `ce.function('Function', [block])`, becomes a function body there: it
// follows the rule of a function body, as the same `Function` boxed in one
// step does (`markFunctionBodyBlocks()`, `function-utils.ts`).
//

const READ_BEFORE = (name: string) => [
  'ErrorCode',
  "'read-before-declaration'",
  `'${name}'`,
];

/** The `ErrorCode` of the error value `x` (its breadcrumb is not compared). */
const errorCode = (x: { operator: string; json: unknown }): unknown =>
  x.operator === 'Error' ? (x.json as unknown[])[1] : x.json;

describe('A BLOCK BOXED BEFORE IT BECOMES A FUNCTION BODY', () => {
  test('boxed in one step and boxed first give the same error', () => {
    const ce = new ComputeEngine();
    const body = [
      'Block',
      ['Declare', 'u', "'unknown'", ['Add', 't', 1]],
      ['Declare', 't', "'unknown'", 1],
      'u',
    ];
    const direct = ce.box(['Function', body] as never);
    expect(errorCode(ce.function('Apply', [direct]).evaluate())).toEqual(
      READ_BEFORE('t')
    );
    const block = ce.box(body as never);
    const fn = ce.function('Function', [block]);
    expect(errorCode(ce.function('Apply', [fn]).evaluate())).toEqual(
      READ_BEFORE('t')
    );
  });

  test('a block nested in the body follows the same rule', () => {
    const ce = new ComputeEngine();
    const block = ce.box([
      'Block',
      [
        'Block',
        ['Declare', 'v', "'unknown'", ['Add', 'w', 1]],
        ['Declare', 'w', "'unknown'", 1],
        'v',
      ],
    ] as never);
    const fn = ce.function('Function', [block]);
    expect(errorCode(ce.function('Apply', [fn]).evaluate())).toEqual(
      READ_BEFORE('w')
    );
  });

  test('a block that never becomes a function body has the same error', () => {
    const ce = new ComputeEngine();
    const block = ce.box([
      'Block',
      ['Declare', 'u', "'unknown'", ['Add', 't', 1]],
      ['Declare', 't', "'unknown'", 1],
      'u',
    ] as never);
    expect(block.evaluate().toString()).toBe(
      'Error(ErrorCode("read-before-declaration", "t"))'
    );
  });
});
