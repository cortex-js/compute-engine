import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A local of a block is made by a `Declare` at the top level of the block; an
// `Assign` writes a variable that is in scope and, inside a block, is an
// error for a name that is not declared. As a variable of a JavaScript or
// Python function, a local starts from its declaration in each top-level
// evaluation and in each function call, and keeps its value inside one
// evaluation: across the iterations of a loop in the block.
//

const INCREMENT: unknown = [
  'Block',
  ['Declare', 'x', "'unknown'", 0],
  ['Assign', 'x', ['Add', 'x', 1]],
  ['Multiply', 2, 'x'],
];

function box(ce: ComputeEngine, json: unknown): Expression {
  return ce.box(json as Parameters<ComputeEngine['box']>[0]);
}

describe('a local of a block is fresh in each top-level evaluation', () => {
  test('box route', () => {
    const ce = new ComputeEngine();
    const block = box(ce, INCREMENT);
    expect(block.evaluate().toString()).toBe('2');
    expect(block.evaluate().toString()).toBe('2');
    expect(block.evaluate().toString()).toBe('2');
    // An assignment to a name that is not declared is an error.
    const undeclared = box(ce, [
      'Block',
      ['Assign', 'x', 0],
      ['Assign', 'x', ['Add', 'x', 1]],
      ['Multiply', 2, 'x'],
    ]);
    expect(undeclared.isValid).toBe(false);
    expect(undeclared.evaluate().toString()).toBe(
      'Error(ErrorCode("assignment-to-undeclared-variable", "x"))'
    );
  });

  test('parse route', () => {
    const ce = new ComputeEngine();
    const block = ce.parse('x \\coloneq 0; x \\coloneq x+1; 2x');
    expect(block.evaluate().toString()).toBe('2');
    expect(block.evaluate().toString()).toBe('2');
  });

  test('asynchronous evaluation', async () => {
    const ce = new ComputeEngine();
    const block = box(ce, INCREMENT);
    expect((await block.evaluateAsync()).toString()).toBe('2');
    expect((await block.evaluateAsync()).toString()).toBe('2');
  });

  test('an asynchronous evaluation after a synchronous one', async () => {
    // The asynchronous route runs the block in a copy of the block scope,
    // made when the run starts. The copy must not hold the value that the
    // synchronous run wrote.
    const ce = new ComputeEngine();
    const block = box(ce, INCREMENT);
    expect(block.evaluate().toString()).toBe('2');
    expect((await block.evaluateAsync()).toString()).toBe('2');
    expect(block.evaluate().toString()).toBe('2');
  });

  test('the local does not leak to the enclosing scope', () => {
    const ce = new ComputeEngine();
    const block = box(ce, INCREMENT);
    block.evaluate();
    block.evaluate();
    expect(box(ce, 'x').evaluate().toString()).toBe('x');
  });

  test('an assignment in a branch of a later run does not see the earlier run', () => {
    // `g` and `h` are locals of the block. On each run `g` is `0` when the
    // condition is read, so the branch is not taken and `h` stays `0`.
    const ce = new ComputeEngine();
    const block = box(ce, [
      'Block',
      ['Declare', 'g', "'unknown'", 0],
      ['Declare', 'h', "'unknown'", 0],
      ['If', ['Greater', 'g', 0], ['Assign', 'h', 1], 'Nothing'],
      ['Assign', 'g', 1],
      'h',
    ]);
    expect(block.evaluate().toString()).toBe('0');
    expect(block.evaluate().toString()).toBe('0');
    // An assignment in a branch to a name that is not declared is an error.
    const undeclared = box(ce, [
      'Block',
      ['If', ['Greater', 'g', 0], ['Assign', 'h', 1], 'Nothing'],
      ['Assign', 'g', 1],
      'h',
    ]);
    expect(undeclared.isValid).toBe(false);
    expect(undeclared.toString()).toContain(
      'ErrorCode("assignment-to-undeclared-variable", "h")'
    );
  });

  test('a block that assigns a function gives the same result on each run', () => {
    // `fn` is a local of the block, so the call `fn(3)` in an earlier
    // statement is a use of the local before its declaration: a static
    // error. A `DefineFunction` statement declares a local too, so the
    // same holds for it; called after it, the block gives `(6, 6)` on each
    // run.
    const ce = new ComputeEngine();
    const block = box(ce, [
      'Block',
      ['Declare', 'r', "'unknown'", ['fn', 3]],
      ['Declare', 'fn', "'unknown'", ['Function', ['Multiply', 'z', 2], 'z']],
      ['Tuple', 'r', ['fn', 3]],
    ]);
    expect(block.evaluate().toString()).toBe(
      'Error(ErrorCode("read-before-declaration", "fn"))'
    );
    const early = box(ce, [
      'Block',
      ['Declare', 'r', "'unknown'", ['fe', 3]],
      ['DefineFunction', 'fe', ['Function', ['Multiply', 'z', 2], 'z']],
      ['Tuple', 'r', ['fe', 3]],
    ]);
    expect(early.evaluate().toString()).toBe(
      'Error(ErrorCode("read-before-declaration", "fe"))'
    );
    const declared = box(ce, [
      'Block',
      ['DefineFunction', 'fd', ['Function', ['Multiply', 'z', 2], 'z']],
      ['Declare', 'r', "'unknown'", ['fd', 3]],
      ['Tuple', 'r', ['fd', 3]],
    ]);
    expect(declared.evaluate().toString()).toBe('(6, 6)');
    expect(declared.evaluate().toString()).toBe('(6, 6)');
  });
});

describe('what does not change', () => {
  test('a variable declared outside the block is written by the block', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'integer');
    ce.assign('y', 0);
    const block = box(ce, ['Block', ['Assign', 'y', ['Add', 'y', 1]], 'y']);
    expect(block.evaluate().toString()).toBe('1');
    expect(block.evaluate().toString()).toBe('2');
    expect(box(ce, 'y').evaluate().toString()).toBe('2');
  });

  test('a loop accumulates in a local of the enclosing block', () => {
    const ce = new ComputeEngine();
    const block = box(ce, [
      'Block',
      ['Declare', 's', "'unknown'", 0],
      [
        'Loop',
        ['Block', ['Assign', 's', ['Add', 's', 'i']]],
        ['Element', 'i', ['Range', 1, 4]],
      ],
      's',
    ]);
    expect(block.evaluate().toString()).toBe('10');
    expect(block.evaluate().toString()).toBe('10');
  });

  test('a loop accumulates in a local of the enclosing block (asynchronous)', async () => {
    const ce = new ComputeEngine();
    const block = box(ce, [
      'Block',
      ['Declare', 's', "'unknown'", 0],
      [
        'Loop',
        ['Block', ['Assign', 's', ['Add', 's', 'i']]],
        ['Element', 'i', ['Range', 1, 4]],
      ],
      's',
    ]);
    expect((await block.evaluateAsync()).toString()).toBe('10');
    expect((await block.evaluateAsync()).toString()).toBe('10');
  });

  test('a function defined in a block is callable on each run', () => {
    const ce = new ComputeEngine();
    const block = ce.parse('f(u) \\coloneq u^2; f(3)');
    expect(block.evaluate().toString()).toBe('9');
    expect(block.evaluate().toString()).toBe('9');
  });
});

const LOOP_BODY_LOCAL: unknown = [
  'Block',
  ['Declare', 'last', "'unknown'", 0],
  ['Declare', 't', "'unknown'", 0],
  [
    'Loop',
    ['Block', ['Assign', 't', ['Add', 't', 1]], ['Assign', 'last', 't']],
    ['Element', 'i', ['Range', 1, 3]],
  ],
  'last',
];

describe('a local of a block keeps its value inside one evaluation', () => {
  test('across the iterations of a loop', () => {
    // `t` is a local of the enclosing block, written in the loop body. It
    // keeps its value from one iteration to the next, and starts again from
    // its declaration in the next evaluation.
    const ce = new ComputeEngine();
    const block = box(ce, LOOP_BODY_LOCAL);
    expect(block.evaluate().toString()).toBe('3');
    expect(block.evaluate().toString()).toBe('3');
  });

  test('across the iterations of a loop (asynchronous)', async () => {
    const ce = new ComputeEngine();
    const block = box(ce, LOOP_BODY_LOCAL);
    expect((await block.evaluateAsync()).toString()).toBe('3');
    expect((await block.evaluateAsync()).toString()).toBe('3');
    expect(block.evaluate().toString()).toBe('3');
  });

  test('in a block nested in the body of a loop', () => {
    const ce = new ComputeEngine();
    const block = box(ce, [
      'Block',
      ['Declare', 'last', "'unknown'", 0],
      ['Declare', 'w', "'unknown'", 0],
      [
        'Loop',
        [
          'Block',
          [
            'If',
            'True',
            [
              'Block',
              ['Assign', 'w', ['Add', 'w', 1]],
              ['Assign', 'last', 'w'],
            ],
            'Nothing',
          ],
        ],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      'last',
    ]);
    expect(block.evaluate().toString()).toBe('3');
    expect(block.evaluate().toString()).toBe('3');
  });

  test('a loop at the top level of a program', () => {
    expect(
      executeEpsil(
        new ComputeEngine(),
        'let last = 0; let t = 0; for i in 1..3 { t = t + 1; last = t }; last'
      ).value?.json
    ).toEqual(3);
  });
});

/** Wait about `ms` milliseconds without giving control back. */
function busyWait(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Wait
  }
}

describe('the evaluation that a run of a block is part of', () => {
  test('a synchronous evaluation while an asynchronous one is pending is a new evaluation', async () => {
    // Before, a synchronous evaluation that started while an asynchronous
    // evaluation was pending was taken as a part of that evaluation, so the
    // local of the block kept its value: `2(x + 1)`, then `2(x + 2)`.
    const ce = new ComputeEngine();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ce.declare('Gate', {
      signature: '() -> number',
      pure: false,
      evaluateAsync: async () => {
        await gate;
        return ce.number(5);
      },
    } as never);
    const pending = box(ce, [
      'Block',
      ['Declare', 'y', "'unknown'", ['Gate']],
      ['Add', 'y', 1],
    ]).evaluateAsync();
    const block = box(ce, INCREMENT);
    expect(block.evaluate().toString()).toBe('2');
    expect(block.evaluate().toString()).toBe('2');
    release();
    expect((await pending).toString()).toBe('6');
  });

  test('an asynchronous loop keeps its locals across a synchronous evaluation', async () => {
    // Each iteration of the loop body waits longer than a time slice of the
    // asynchronous driver, so the driver gives control back after each one.
    // The synchronous evaluations that run then are new evaluations, but the
    // loop is still in its own evaluation: its local `t` keeps its value.
    const ce = new ComputeEngine();
    let started!: () => void;
    const first = new Promise<void>((resolve) => {
      started = resolve;
    });
    ce.declare('Slow', {
      signature: '() -> number',
      pure: false,
      evaluate: () => {
        started();
        busyWait(25);
        return ce.Zero;
      },
    });
    const loop = box(ce, [
      'Block',
      ['Declare', 'last', "'unknown'", 0],
      ['Declare', 't', "'unknown'", 0],
      [
        'Loop',
        [
          'Block',
          ['Assign', 't', ['Add', 't', 1]],
          ['Slow'],
          ['Assign', 'last', 't'],
        ],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      'last',
    ]);
    const pending = loop.evaluateAsync();
    await first;
    const block = box(ce, INCREMENT);
    expect(block.evaluate().toString()).toBe('2');
    expect(block.evaluate().toString()).toBe('2');
    expect((await pending).toString()).toBe('3');
  });

  test('an evaluation on another engine does not end the evaluation', () => {
    // Before, the number of the evaluation was shared by all the engines: the
    // evaluation on `other` in the loop body made each iteration a new
    // evaluation, and the local `t` started again with no value.
    const ce = new ComputeEngine();
    const other = new ComputeEngine();
    ce.declare('OnOther', {
      signature: '() -> number',
      pure: false,
      evaluate: () => {
        other.box(['Sqrt', 'q']).evaluate();
        return ce.Zero;
      },
    });
    const block = box(ce, [
      'Block',
      ['Declare', 'last', "'unknown'", 0],
      ['Declare', 't', "'unknown'", 0],
      [
        'Loop',
        [
          'Block',
          ['Assign', 't', ['Add', 't', 1]],
          ['OnOther'],
          ['Assign', 'last', 't'],
        ],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      'last',
    ]);
    expect(block.evaluate().toString()).toBe('3');
    expect(block.evaluate().toString()).toBe('3');
  });
});
