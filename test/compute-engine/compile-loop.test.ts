/**
 * Tests for Loop compilation (for loops, break, continue)
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

describe('COMPILE Loop', () => {
  test('simple loop: accumulate sum 1..10 = 55', () => {
    const expr = ce.expr([
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
    const expr = ce.expr([
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
    const expr = ce.expr([
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
    const expr = ce.expr([
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
    const expr = ce.expr([
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
    const expr = ce.expr([
      'Loop',
      ['If', ['Greater', 'i', 3], ['Break'], 'Nothing'],
      ['Element', 'i', ['Range', 1, 10]],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toContain('break');
  });

  test('Continue appears in loop code', () => {
    const expr = ce.expr([
      'Loop',
      ['If', ['Greater', 'i', 3], ['Continue'], 'Nothing'],
      ['Element', 'i', ['Range', 1, 10]],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toContain('continue');
  });
});

describe('COMPILE Loop (interval-js)', () => {
  test('simple accumulation loop', () => {
    const expr = ce.expr([
      'Block',
      ['Declare', 's'],
      ['Assign', 's', 0],
      ['Loop',
        ['Assign', 's', ['Add', 's', 'i']],
        ['Element', 'i', ['Range', 1, 5]],
      ],
      's',
    ]);
    const result = compile(expr, { to: 'interval-js' })!;
    expect(result.success).toBe(true);
    // Loop counter should be raw numbers, not _IA.point()
    expect(result.code).toContain('for (let i = 1; i <= 5; i++)');
    // Body should wrap index as interval
    expect(result.code).toContain('_IA.point(i)');
    // sum 1..5 = 15
    const out = result.run!() as any;
    const val = out.kind === 'interval' ? out.value : out;
    expect(val.lo).toBe(15);
    expect(val.hi).toBe(15);
  });

  test('loop with break', () => {
    const expr = ce.expr([
      'Block',
      ['Declare', 's'],
      ['Assign', 's', 0],
      ['Loop',
        ['Block',
          ['If', ['Greater', 'i', 3], ['Break'], 'Nothing'],
          ['Assign', 's', ['Add', 's', 'i']],
        ],
        ['Element', 'i', ['Range', 1, 100]],
      ],
      's',
    ]);
    const result = compile(expr, { to: 'interval-js' })!;
    expect(result.success).toBe(true);
    // sum 1..3 = 6
    const out = result.run!() as any;
    const val = out.kind === 'interval' ? out.value : out;
    expect(val.lo).toBe(6);
    expect(val.hi).toBe(6);
  });

  test('loop with trig in body', () => {
    // sum of sin(i) for i = 1..3
    const expr = ce.expr([
      'Block',
      ['Declare', 's'],
      ['Assign', 's', 0],
      ['Loop',
        ['Assign', 's', ['Add', 's', ['Sin', 'i']]],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      's',
    ]);
    const result = compile(expr, { to: 'interval-js' })!;
    expect(result.success).toBe(true);
    const expected = Math.sin(1) + Math.sin(2) + Math.sin(3);
    const out = result.run!() as any;
    const val = out.kind === 'interval' ? out.value : out;
    expect(val.lo).toBeCloseTo(expected, 10);
    expect(val.hi).toBeCloseTo(expected, 10);
  });
});

describe('COMPILE Variadic Loop (comprehension)', () => {
  test('JS: Loop with 2 Element clauses produces Cartesian product', () => {
    // (x, y) for x = [1..2], y = [3..4]  →  4 pairs
    const expr = ce.expr([
      'Loop',
      ['Tuple', 'x', 'y'],
      ['Element', 'x', ['Range', 1, 2]],
      ['Element', 'y', ['Range', 3, 4]],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    const out = result.run!() as unknown[];
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBe(4); // 2 × 2 Cartesian
  });

  test('JS: Loop with single Element and Range preserves imperative behavior', () => {
    // The existing imperative path: accumulate sum in a block
    const expr = ce.expr([
      'Block',
      ['Declare', 's'],
      ['Assign', 's', 0],
      ['Loop',
        ['Assign', 's', ['Add', 's', 'i']],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      's',
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(6); // 1 + 2 + 3
  });

  test('JS: Loop with single Element (body is plain expression) collects results', () => {
    // Single Element where body is a pure value expression — comprehension mode
    // because a Loop body without side effects in a standalone context is collected.
    // Note: since Range is the collection, this still uses the imperative path;
    // but the body is just a computation (i*2) which is a statement with no effect.
    // The test exercises the legacy for-loop with an expression body.
    const expr = ce.expr([
      'Loop',
      ['Multiply', 'i', 2],
      ['Element', 'i', ['Range', 1, 3]],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    // The imperative loop runs but doesn't collect; run() returns undefined.
    // This is the expected behaviour for the legacy path.
    expect(result.code).toContain('for (let i = 1; i <= 3; i++)');
  });

  test('JS: nested loop body references outer variable', () => {
    // (x, y) for x=[1..2], y=[1..x] — y depends on x (triangle)
    // For this to work, x must be in scope when y's collection is evaluated.
    // Since we use `for (const x of ...) { for (const y of ...) { ... } }`,
    // x is naturally in scope for the inner loop's collection.
    const expr = ce.expr([
      'Loop',
      ['Add', 'x', 'y'],
      ['Element', 'x', ['Range', 1, 2]],
      ['Element', 'y', ['Range', 1, 'x']],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    const out = result.run!() as number[];
    // x=1: y in [1..1] → [1+1=2] (1 item)
    // x=2: y in [1..2] → [2+1=3, 2+2=4] (2 items)
    // total 3 items: [2, 3, 4]
    expect(out).toEqual([2, 3, 4]);
  });

  test('JS: compiled code contains for-of for multi-Element comprehension', () => {
    const expr = ce.expr([
      'Loop',
      'x',
      ['Element', 'x', ['Range', 1, 3]],
      ['Element', 'y', ['Range', 4, 5]],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toContain('for (const x of');
    expect(result.code).toContain('for (const y of');
    expect(result.code).toContain('result.push(');
  });

  test('JS: comprehension over Range with integer step honors the step', () => {
    // Range(1, 9, 2) → [1, 3, 5, 7, 9]. A second Element clause forces
    // comprehension mode so the new compileRangeIterable path is exercised.
    const expr = ce.expr([
      'Loop',
      'i',
      ['Element', 'i', ['Range', 1, 9, 2]],
      ['Element', '_', ['List', 0]],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toEqual([1, 3, 5, 7, 9]);
  });

  test('JS: comprehension over Range with fractional step honors the step', () => {
    // Range(0, 1, 0.25) → [0, 0.25, 0.5, 0.75, 1]. Pre-fix this collapsed
    // to integer bounds via Math.floor and ignored the step.
    const expr = ce.expr([
      'Loop',
      'x',
      ['Element', 'x', ['Range', 0, 1, 0.25]],
      ['Element', '_', ['List', 0]],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    const out = result.run!() as number[];
    expect(out.length).toBe(5);
    out.forEach((v, k) => expect(v).toBeCloseTo(k * 0.25, 10));
  });

  test('JS: comprehension over Range with negative step', () => {
    const expr = ce.expr([
      'Loop',
      'i',
      ['Element', 'i', ['Range', 10, 0, -2]],
      ['Element', '_', ['List', 0]],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toEqual([10, 8, 6, 4, 2, 0]);
  });

  test('JS: comprehension over Range(5, 1) auto-directs (no explicit step)', () => {
    const expr = ce.expr([
      'Loop',
      'i',
      ['Element', 'i', ['Range', 5, 1]],
      ['Element', '_', ['List', 0]],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toEqual([5, 4, 3, 2, 1]);
  });

  test('JS: comprehension over sign-mismatched Range yields empty', () => {
    const expr = ce.expr([
      'Loop',
      'i',
      ['Element', 'i', ['Range', 0, 1, -1]],
      ['Element', '_', ['List', 0]],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toEqual([]);
  });
});

describe('COMPILE Loop / single-Element Range routing', () => {
  test('Range with explicit step != 1 routes through comprehension', () => {
    // Reviewer P1: sum of i over Range(1, 5, 2) must be 1+3+5 = 9, not 15.
    const expr = ce.expr([
      'Block',
      ['Declare', 's'],
      ['Assign', 's', 0],
      ['Loop',
        ['Assign', 's', ['Add', 's', 'i']],
        ['Element', 'i', ['Range', 1, 5, 2]],
      ],
      's',
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    // Generated code must NOT use the legacy `i++` shape for stepped Range.
    expect(result.code).not.toContain('for (let i = 1; i <= 5; i++)');
    expect(result.run!()).toBe(9);
  });

  test('Descending Range(5, 1) iterates 5 elements', () => {
    // Reviewer P1: legacy `i = 5; i <= 1; i++` produces zero iterations.
    const expr = ce.expr([
      'Block',
      ['Declare', 's'],
      ['Assign', 's', 0],
      ['Loop',
        ['Assign', 's', ['Add', 's', 'i']],
        ['Element', 'i', ['Range', 5, 1]],
      ],
      's',
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(15); // 5+4+3+2+1
  });

  test('Range with fractional bounds routes through comprehension', () => {
    // Range(1.5, 4.5) iterates 1.5, 2.5, 3.5, 4.5 → sum 12.
    const expr = ce.expr([
      'Block',
      ['Declare', 's'],
      ['Assign', 's', 0],
      ['Loop',
        ['Assign', 's', ['Add', 's', 'i']],
        ['Element', 'i', ['Range', 1.5, 4.5]],
      ],
      's',
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBeCloseTo(12, 10);
  });

  test('Integer-ascending step-1 Range still uses legacy for-loop', () => {
    // Performance / readability: simple ranges should NOT pay for an array.
    const expr = ce.expr([
      'Loop',
      ['Square', 'i'],
      ['Element', 'i', ['Range', 0, 9]],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toContain('for (let i = 0; i <= 9; i++)');
  });
});

describe('COMPILE Loop comprehension under interval-js', () => {
  test('comprehension wraps loop variables for interval body operators', () => {
    // Reviewer P1: a multi-Element comprehension whose body uses interval
    // operators must wrap each loop variable as `_IA.point(...)`. Otherwise
    // `_IA.add(x, y)` is invoked with raw numbers and yields a wrong result.
    const expr = ce.expr([
      'Loop',
      ['Add', 'x', 'y'],
      ['Element', 'x', ['Range', 1, 2]],
      ['Element', 'y', ['Range', 3, 4]],
    ]);
    const result = compile(expr, { to: 'interval-js' })!;
    expect(result.success).toBe(true);
    expect(result.code).toContain('_IA.point(x)');
    expect(result.code).toContain('_IA.point(y)');
    const out = result.run!() as any[];
    expect(out.length).toBe(4);
    // Every entry should be an interval (not a raw number).
    for (const v of out) {
      const interval = v.kind === 'interval' ? v.value : v;
      expect(interval).toHaveProperty('lo');
      expect(interval).toHaveProperty('hi');
    }
  });
});
