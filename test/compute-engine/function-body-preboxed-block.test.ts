import { ComputeEngine } from '../../src/compute-engine';

//
// In the body of a function literal, a read of an assignment local before
// its first assignment is the `read-before-declaration` error. A block
// outside every function literal leaves the read as the bare symbol.
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
  "'assignment'",
];

/** The `ErrorCode` of the error value `x` (its breadcrumb is not compared). */
const errorCode = (x: { operator: string; json: unknown }): unknown =>
  x.operator === 'Error' ? (x.json as unknown[])[1] : x.json;

describe('A BLOCK BOXED BEFORE IT BECOMES A FUNCTION BODY', () => {
  test('boxed in one step and boxed first give the same error', () => {
    const ce = new ComputeEngine();
    const body = ['Block', ['Assign', 't', ['Add', 't', 1]], 't'];
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
      ['Block', ['Assign', 'w', ['Add', 'w', 1]], 'w'],
    ] as never);
    const fn = ce.function('Function', [block]);
    expect(errorCode(ce.function('Apply', [fn]).evaluate())).toEqual(
      READ_BEFORE('w')
    );
  });

  test('a block that never becomes a function body keeps the bare symbol', () => {
    const ce = new ComputeEngine();
    const block = ce.box([
      'Block',
      ['Assign', 't', ['Add', 't', 1]],
      't',
    ] as never);
    expect(block.evaluate().toString()).toBe('t + 1');
  });
});
