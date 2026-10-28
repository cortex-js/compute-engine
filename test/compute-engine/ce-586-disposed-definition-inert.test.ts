import { ComputeEngine, compile, isFunction } from '../../src/compute-engine';

// A checkpoint restore disposes each definition created in the rewound window.
// An expression built in the window keeps a pointer to such a definition. The
// symbol stays inert after the restore: it reads no value, also after a later
// declaration of the same name, whose value it would otherwise read with the
// type of the disposed definition. A new expression reads the new definition.
// (ROADMAP CE-586, user decision 2026-10-28.)

describe('CE-586: a symbol bound to a disposed definition is inert', () => {
  test('a free symbol first boxed in the window', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();
    const e = ce.parse('w + 1');
    ce.restore(cp);
    ce.discard(cp);
    expect(e.evaluate().toString()).toBe('w + 1');

    ce.declare('w', { type: 'integer', value: 9 });
    expect(e.evaluate().toString()).toBe('w + 1');
    expect(e.N().toString()).toBe('w + 1');
    expect(isFunction(e) ? e.ops[0].value : 'not a function').toBeUndefined();
    // The symbol still counts as unknown, consistent with its evaluation.
    expect(e.unknowns).toEqual(['w']);
    expect(e.freeVariables).toEqual(['w']);
    // A new expression reads the new definition.
    expect(ce.parse('w + 1').evaluate().toString()).toBe('10');
  });

  test('a symbol declared with a value in the window', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();
    ce.declare('q', { type: 'integer', value: 3 });
    const e = ce.parse('q + 1');
    expect(e.evaluate().toString()).toBe('4');
    ce.restore(cp);
    ce.discard(cp);
    expect(e.evaluate().toString()).toBe('q + 1');

    ce.assign('q', 7);
    expect(e.evaluate().toString()).toBe('q + 1');
    expect(ce.parse('q + 1').evaluate().toString()).toBe('8');
  });

  test('a constant declared in the window', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();
    ce.declare('k', { type: 'integer', value: 5, isConstant: true });
    const e = ce.parse('k + 1');
    ce.restore(cp);
    ce.discard(cp);
    ce.declare('k', { type: 'integer', value: 7, isConstant: true });
    expect(e.evaluate().toString()).toBe('k + 1');
    expect(e.unknowns).toEqual(['k']);
    expect(ce.parse('k + 1').evaluate().toString()).toBe('8');
  });

  test('a function declared in the window', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();
    ce.declare('g', {
      signature: '(integer) -> integer',
      evaluate: ([x]) => ce.number(x.re * 10),
    });
    const e = ce.box(['g', 2]);
    expect(e.evaluate().toString()).toBe('20');
    ce.restore(cp);
    ce.discard(cp);
    ce.declare('g', {
      signature: '(integer) -> integer',
      evaluate: ([x]) => ce.number(x.re * 100),
    });
    expect(e.evaluate().toString()).toBe('g(2)');
    expect(ce.box(['g', 2]).evaluate().toString()).toBe('200');
  });

  test('a compile reads the inert symbol as an input', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();
    ce.declare('q', { type: 'integer', value: 3 });
    const e = ce.parse('q + 1');
    ce.restore(cp);
    ce.discard(cp);
    ce.assign('q', 7);
    expect(e.unknowns).toEqual(['q']);
    const result = compile(e);
    expect(result.success).toBe(true);
    expect(result.run!({ q: 1 })).toBe(2);
    // A direct target does not fold the later value either.
    const raw = compile(e, {
      target: ce._getCompilationTarget('javascript')!.createTarget(),
    });
    expect(raw.code).not.toContain('7');
  });

  test('a Sum index and a Block local built in the window still run', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();
    const sum = ce.box(['Sum', ['Power', 'n', 2], ['Limits', 'n', 1, 3]]);
    const block = ce.box([
      'Block',
      ['Declare', 'a', "'integer'"],
      ['Assign', 'a', 4],
      ['Multiply', 2, 'a'],
    ]);
    ce.restore(cp);
    ce.discard(cp);
    expect(sum.evaluate().toString()).toBe('14');
    expect(block.evaluate().toString()).toBe('8');
    // A later global declaration of the same names does not change them.
    ce.declare('n', { type: 'integer', value: 100 });
    ce.declare('a', { type: 'integer', value: 50 });
    expect(sum.evaluate().toString()).toBe('14');
    expect(block.evaluate().toString()).toBe('8');
  });

  test('a name that existed before the window is not affected', () => {
    const ce = new ComputeEngine();
    ce.declare('n', { type: 'integer', value: 2 });
    const cp = ce.checkpoint();
    ce.assign('n', 10);
    const e = ce.parse('n + 1');
    expect(e.evaluate().toString()).toBe('11');
    ce.restore(cp);
    ce.discard(cp);
    expect(e.evaluate().toString()).toBe('3');
    ce.assign('n', 4);
    expect(e.evaluate().toString()).toBe('5');
  });
});
