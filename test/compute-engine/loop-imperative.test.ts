/**
 * Interpreter tests for the de-conflated `Loop` (imperative, for effect) and
 * `Comprehension` (value-producing) operators.
 *
 * Note on variable names: an Element index (`Element(i, coll)`) is explicitly
 * declared in the loop scope, so `i` is safe there. A *Block-local* counter is
 * NOT — a bare `i` resolves to the imaginary unit — so bare-loop tests use
 * `k`/`n` for their counters.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { CancellationError } from '../../src/common/interruptible';

describe('Loop — imperative (interpreter)', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('Loop(body) with Break(v) returns the break value', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'k'],
        ['Assign', 'k', 0],
        [
          'Loop',
          [
            'If',
            ['GreaterEqual', 'k', 5],
            ['Break', 'k'],
            ['Assign', 'k', ['Add', 'k', 1]],
          ],
        ],
      ])
      .evaluate();
    expect(result.re).toBe(5);
  });

  test('Loop(body) with a bare Break returns Nothing', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'k'],
        ['Assign', 'k', 0],
        [
          'Loop',
          [
            'If',
            ['GreaterEqual', 'k', 3],
            ['Break'],
            ['Assign', 'k', ['Add', 'k', 1]],
          ],
        ],
      ])
      .evaluate();
    expect(result.symbol).toBe('Nothing');
  });

  test('Loop(body) without Break throws CancellationError (iteration limit)', () => {
    ce.iterationLimit = 500;
    expect(() => ce.expr(['Loop', ['Add', 1, 1]]).evaluate()).toThrow(
      CancellationError
    );
  });

  test('Loop(Element) accumulator ends at 55, loop value is Nothing', () => {
    const expr = ce.expr([
      'Block',
      ['Declare', 's'],
      ['Assign', 's', 0],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', 'i']],
        ['Element', 'i', ['Range', 1, 10]],
      ],
      's',
    ]);
    expect(expr.evaluate().re).toBe(55);
    // The Loop itself is for effect: value Nothing.
    const loopOnly = ce.expr([
      'Loop',
      ['Assign', 's', 'i'],
      ['Element', 'i', ['Range', 1, 3]],
    ]);
    expect(loopOnly.evaluate().symbol).toBe('Nothing');
  });

  test('Continue in body skips (accumulate only even i → 30)', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 's'],
        ['Assign', 's', 0],
        [
          'Loop',
          [
            'If',
            ['NotEqual', ['Mod', 'i', 2], 0],
            ['Continue'],
            ['Assign', 's', ['Add', 's', 'i']],
          ],
          ['Element', 'i', ['Range', 1, 10]],
        ],
        's',
      ])
      .evaluate();
    expect(result.re).toBe(30);
  });

  test('Break with value inside Element form returns that value', () => {
    const result = ce
      .expr([
        'Loop',
        [
          'If',
          ['Greater', ['Power', 'i', 2], 10],
          ['Break', ['Power', 'i', 2]],
          'Nothing',
        ],
        ['Element', 'i', ['Range', 1, 10]],
      ])
      .evaluate();
    // i = 4 is the first with i² > 10.
    expect(result.re).toBe(16);
  });

  test('Loop type is `nothing` for a for-effect body', () => {
    const expr = ce.box([
      'Loop',
      ['Assign', 's', 'i'],
      ['Element', 'i', ['Range', 1, 3]],
    ]);
    expect(expr.type.toString()).toBe('nothing');
  });

  test('Loop type is `unknown` when the body can yield a value', () => {
    const expr = ce.box([
      'Loop',
      ['If', ['Greater', 'i', 3], ['Return', 'i'], 'Nothing'],
      ['Element', 'i', ['Range', 1, 5]],
    ]);
    expect(expr.type.toString()).toBe('unknown');
  });
});

describe('Comprehension (interpreter)', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('single clause → List of squares', () => {
    const result = ce
      .expr(['Comprehension', ['Square', 'x'], ['Element', 'x', ['Range', 1, 3]]])
      .evaluate();
    expect(result.json).toEqual(['List', 1, 4, 9]);
  });

  test('Cartesian product of two independent clauses', () => {
    const result = ce
      .expr([
        'Comprehension',
        ['Tuple', 'x', 'y'],
        ['Element', 'x', ['Range', 1, 2]],
        ['Element', 'y', ['Range', 3, 4]],
      ])
      .evaluate();
    expect(result.ops?.length).toBe(4);
  });

  test('dependent binding (triangle)', () => {
    const result = ce
      .expr([
        'Comprehension',
        ['Tuple', 'x', 'y'],
        ['Element', 'x', ['Range', 1, 3]],
        ['Element', 'y', ['Range', 1, 'x']],
      ])
      .evaluate();
    // 1 + 2 + 3 = 6 tuples
    expect(result.ops?.length).toBe(6);
  });

  test('scope hygiene: bound name does not leak', () => {
    const ce2 = new ComputeEngine();
    ce2
      .expr(['Comprehension', 'x', ['Element', 'x', ['Range', 1, 3]]])
      .evaluate();
    expect(ce2.lookupDefinition('x')).toBeUndefined();
  });

  test('Break canonicalizes without error and stays inert', () => {
    const b = ce.expr(['Break']);
    expect(b.operator).toBe('Break');
    expect(b.evaluate().operator).toBe('Break');
  });
});
