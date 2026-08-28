import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// PHASE 1 — placeholder ELEMENT refinement (`docs/INFERENCE_ROADMAP.md`,
// ruled 2026-08-18: re-refine on re-assignment; element only; `typeof`
// shows the refinement) — and PHASE 2, literal downward distribution.
//
// A bare collection constructor (`list` = `list<unknown>`) declares the
// CONSTRUCTOR as the contract and the element slot as a placeholder: each
// assignment refines the element type (kept on `_placeholderSkeleton` +
// the reported type), while the constructor contract still rejects
// non-collection values.

describe('Phase 1: placeholder element refinement', () => {
  test('R2/R3: a declared bare list refines its element from the assignment, element only', () => {
    const ce = new ComputeEngine();
    const run = (s: string) => executeEpsil(ce, s);
    run('let a: list');
    expect(ce.box('a').type.toString()).toBe('list');
    run('a = [1, 2, 3]');
    // Element only — rank and length stay open (the value's own type is
    // `vector<integer^3>`), and `typeof` SHOWS the refinement.
    expect(ce.box('a').type.toString()).toBe('list<integer>');
  });

  test('R1: re-assignment re-refines — the refinement never hardens', () => {
    const ce = new ComputeEngine();
    const run = (s: string) => executeEpsil(ce, s);
    run('let a: list\na = [1, 2, 3]');
    expect(ce.box('a').type.toString()).toBe('list<integer>');
    run('a = ["x", "y"]');
    expect(ce.box('a').type.toString()).toBe('list<string>');
  });

  test('the constructor CONTRACT still rejects, against the skeleton', () => {
    const ce = new ComputeEngine();
    const run = (s: string) => executeEpsil(ce, s);
    run('let a: list\na = ["x"]');
    const bad = run('a = 42');
    // The error names the SKELETON (`list`), not the refined spelling, and
    // the refinement survives the failed assignment.
    expect(bad.value?.toString()).toContain(
      'ErrorCode("incompatible-type", "list"'
    );
    expect(ce.box('a').type.toString()).toBe('list<string>');
  });

  test('declare-with-initializer refines identically to the split spelling', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let a: list = [1, 2, 3]');
    expect(ce.box('a').type.toString()).toBe('list<integer>');
  });

  test('only placeholder spellings refine: explicit contracts never move', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      ['let c: list<any>', 'c = [1, 2]', 'let d: list<integer>', 'd = [1, 2]'].join(
        '\n'
      )
    );
    expect(ce.box('c').type.toString()).toBe('list<any>');
    expect(ce.box('d').type.toString()).toBe('list<integer>');
  });

  test('STATIC: the refined element type flows through the one-shot pre-pass', () => {
    const r = executeEpsil(
      new ComputeEngine(),
      [
        'let k: (integer) -> integer',
        'let a: list',
        'a = ["x", "y"]',
        'k(a[1])',
      ].join('\n')
    );
    expect(JSON.stringify(r.diagnostics)).toContain('static-type-error');
    // The compatible case stays clean.
    const r2 = executeEpsil(
      new ComputeEngine(),
      [
        'let k: (integer) -> integer',
        'let a: list',
        'a = [1, 2]',
        'k(a[1])',
      ].join('\n')
    );
    expect(JSON.stringify(r2.diagnostics)).toBe('[]');
  });

  test('API route parity: ce.declare + ce.assign', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'set');
    ce.assign('s', ce.box(['Set', 1, 2]).evaluate());
    expect(ce.box('s').type.toString()).toBe('set<integer>');
    ce.declare('m', 'dictionary');
    ce.assign('m', ce.box(['Dictionary', ['KeyValuePair', { str: 'a' }, 1]]).evaluate());
    expect(ce.box('m').type.toString()).toBe('dictionary<integer>');
    // A RECORD-typed value (heterogeneous fields) refines the dictionary
    // skeleton to the WIDENED field type.
    const ce2 = new ComputeEngine();
    ce2.declare('r', 'dictionary');
    ce2.assign(
      'r',
      ce2
        .box([
          'Dictionary',
          ['KeyValuePair', { str: 'a' }, 1],
          ['KeyValuePair', { str: 'b' }, { str: 'x' }],
        ])
        .evaluate()
    );
    expect(ce2.box('r').type.toString()).toBe(
      'dictionary<integer | string>'
    );
  });
});

describe('Phase 2: literal downward distribution', () => {
  test('a typed collection parameter infers the literal SYMBOL elements', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(list<number>) -> number');
    ce.box(['f', ['List', 'a', 'b']]);
    expect(ce.box('a').type.toString()).toBe('number');
    expect(ce.box('b').type.toString()).toBe('number');
  });

  test('Epsil route: f([a, b]) infers a and b', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let f: (list<number>) -> number\nf([a, b])');
    expect(ce.box('a').type.toString()).toBe('number');
    expect(ce.box('b').type.toString()).toBe('number');
  });
});
