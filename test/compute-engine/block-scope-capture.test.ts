import { ComputeEngine } from '../../src/compute-engine';

/**
 * Regression tests for the nested-`Block` scope-capture defect
 * (docs/plans/2026-07-07-block-scope-capture-investigation.md).
 *
 * A nested `Block` resolved symbols against the scope chain captured at
 * canonicalization time: a reference to an enclosing block's local — whose
 * `Declare`/`Assign` only register at *evaluation* time — auto-declared a
 * valueless shadow binding in the nested scope, permanently hiding the
 * enclosing block's runtime value. Fixed by hoisting `Declare`/`Assign`
 * targets into the block scope during canonicalization (`canonicalBlock`),
 * evaluating Element-loop bodies in the loop's own lexical scope
 * (`runNestedElements`), and letting a `Declare` statement reset the binding
 * it created on a previous evaluation of the same scope (re-entered Block).
 */

describe('nested Block reads enclosing Block locals', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('R1: nested Block reads an outer block-local', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'k', { str: 'integer' }],
        ['Assign', 'k', 7],
        ['Block', 'k'],
      ])
      .evaluate();
    expect(result.toString()).toEqual('7');
  });

  test('R2: expression over an outer block-local in a nested Block', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'g', { str: 'integer' }],
        ['Assign', 'g', 7],
        ['Block', ['Add', 'g', 1]],
      ])
      .evaluate();
    expect(result.toString()).toEqual('8');
  });

  test('R3: If condition inside a nested Block in a Loop resolves', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'a', { str: 'integer' }],
        ['Assign', 'a', 0],
        [
          'Loop',
          [
            'Block',
            [
              'If',
              ['Less', 'a', 5],
              ['Assign', 'a', ['Add', 'a', 1]],
              ['Break'],
            ],
          ],
        ],
        'a',
      ])
      .evaluate();
    expect(result.toString()).toEqual('5');
  });

  test('R4: while-style loop with write-then-read Block body', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'm', { str: 'integer' }],
        ['Assign', 'm', 0],
        [
          'Loop',
          [
            'Block',
            ['If', ['Not', ['Less', 'm', 5]], ['Break']],
            ['Assign', 'm', ['Add', 'm', 1]],
          ],
        ],
        'm',
      ])
      .evaluate();
    expect(result.toString()).toEqual('5');
  });

  test('R5: Element-form Loop with a Block body reading the loop variable', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 's', { str: 'integer' }],
        ['Assign', 's', 0],
        [
          'Loop',
          ['Block', ['Assign', 's', ['Add', 's', 'n']]],
          ['Element', 'n', ['Range', 1, 5]],
        ],
        's',
      ])
      .evaluate();
    expect(result.toString()).toEqual('15');
  });
});

describe('re-entered scopes (warm engine / repeated evaluation)', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('the same Block object with a Declare can be evaluated twice', () => {
    const expr = ce.expr([
      'Block',
      ['Declare', 'm', { str: 'integer' }],
      ['Assign', 'm', 0],
      [
        'Loop',
        [
          'Block',
          ['If', ['Not', ['Less', 'm', 5]], ['Break']],
          ['Assign', 'm', ['Add', 'm', 1]],
        ],
      ],
      'm',
    ]);
    expect(expr.evaluate().toString()).toEqual('5');
    expect(expr.evaluate().toString()).toEqual('5');
  });

  test('a Declare inside a Loop body Block re-executes on each iteration', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'acc', { str: 'integer' }],
        ['Assign', 'acc', 0],
        [
          'Loop',
          [
            'Block',
            ['Declare', 't', { str: 'integer' }],
            ['Assign', 't', 'n'],
            ['Assign', 'acc', ['Add', 'acc', 't']],
          ],
          ['Element', 'n', ['Range', 1, 3]],
        ],
        'acc',
      ])
      .evaluate();
    expect(result.toString()).toEqual('6');
  });
});

describe('block-local semantics preserved', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('an inner Declare shadows the outer block-local', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'k', { str: 'integer' }],
        ['Assign', 'k', 7],
        ['Block', ['Declare', 'k', { str: 'integer' }], ['Assign', 'k', 2], 'k'],
        'k',
      ])
      .evaluate();
    // The inner block's k=2 must not overwrite the outer k=7.
    expect(result.toString()).toEqual('7');
  });

  test('a nested Block assignment updates the outer block-local', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'k', { str: 'integer' }],
        ['Assign', 'k', 0],
        ['Block', ['Assign', 'k', 5]],
        'k',
      ])
      .evaluate();
    expect(result.toString()).toEqual('5');
  });

  test('Assign without a Declare stays block-local (no leak)', () => {
    ce.expr(['Block', ['Assign', 'zzlocal', 5]]).evaluate();
    // zzlocal must not be visible (with a value) outside the block:
    // it evaluates to itself, not to 5.
    expect(ce.symbol('zzlocal').evaluate().symbol).toEqual('zzlocal');
  });

  test('assignment to a declared enclosing variable is visible after', () => {
    ce.declare('zzouter', { type: 'integer', value: 1 });
    ce.expr(['Block', ['Assign', 'zzouter', 42]]).evaluate();
    expect(ce.symbol('zzouter').evaluate().toString()).toEqual('42');
  });
});
