/**
 * Tests for Loop compilation (for loops, break, continue)
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

describe('COMPILE Loop', () => {
  test('simple loop: accumulate sum 1..10 = 55', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 's'],
      ['Assign', 's', 0],
      ['Loop',
        ['Assign', 's', ['Add', 's', 'i']],
        ['Element', 'i', ['Range', 1, 10]],
      ],
      's',
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(55);
  });

  test('loop with break: sum until i > 5', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 's'],
      ['Assign', 's', 0],
      ['Loop',
        ['Block',
          ['If', ['Greater', 'i', 5], ['Break'], 'Nothing'],
          ['Assign', 's', ['Add', 's', 'i']],
        ],
        ['Element', 'i', ['Range', 1, 100]],
      ],
      's',
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    // sum of 1..5 = 15
    expect(result.run!()).toBe(15);
  });

  test('loop with continue: sum only even numbers 1..10', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 's'],
      ['Assign', 's', 0],
      ['Loop',
        ['Block',
          ['If', ['NotEqual', ['Mod', 'i', 2], 0], ['Continue'], 'Nothing'],
          ['Assign', 's', ['Add', 's', 'i']],
        ],
        ['Element', 'i', ['Range', 1, 10]],
      ],
      's',
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    // sum of 2+4+6+8+10 = 30
    expect(result.run!()).toBe(30);
  });

  test('loop with nested if + break', () => {
    // Find first i where i^2 > 50
    const expr = ce.box([
      'Block',
      ['Declare', 'result'],
      ['Assign', 'result', -1],
      ['Loop',
        ['If',
          ['Greater', ['Power', 'i', 2], 50],
          ['Block', ['Assign', 'result', 'i'], ['Break']],
          'Nothing',
        ],
        ['Element', 'i', ['Range', 1, 100]],
      ],
      'result',
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    // 7^2 = 49 <= 50, 8^2 = 64 > 50 → result = 8
    expect(result.run!()).toBe(8);
  });

  test('code generation: simple loop', () => {
    const expr = ce.box([
      'Loop',
      ['Square', 'i'],
      ['Element', 'i', ['Range', 0, 9]],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toContain('for (let i = 0; i <= 9; i++)');
  });
});

describe('COMPILE Break / Continue', () => {
  test('Break appears in loop code', () => {
    const expr = ce.box([
      'Loop',
      ['If', ['Greater', 'i', 3], ['Break'], 'Nothing'],
      ['Element', 'i', ['Range', 1, 10]],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toContain('break');
  });

  test('Continue appears in loop code', () => {
    const expr = ce.box([
      'Loop',
      ['If', ['Greater', 'i', 3], ['Continue'], 'Nothing'],
      ['Element', 'i', ['Range', 1, 10]],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toContain('continue');
  });
});
