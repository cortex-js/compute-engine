/**
 * The compile APIs that 0.194.0 removed (the migration note of 0.194.0 in
 * `CHANGELOG.md`, `docs/MIGRATION-0.194.md`): a JavaScript caller that
 * still passes one gets an error that names it, not an option or a key that
 * is silently ignored.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile, canCompile } from '../../src/compile';

const ce = new ComputeEngine();
ce.declare('x', 'real');

const REMOVED_OPTIONS: [string, unknown][] = [
  ['target', {}],
  ['functions', { f: 'Math.sin' }],
  ['operators', { Add: ['+', 11] }],
  ['imports', []],
  ['preamble', ''],
  ['strictTypes', true],
  ['broadcast', false],
];

describe('the compile options that 0.194.0 removed', () => {
  for (const [name, value] of REMOVED_OPTIONS) {
    test(`compile() throws on \`${name}\`, on every target`, () => {
      for (const to of ['javascript', 'glsl', 'interval-js'])
        expect(() =>
          compile(ce.parse('x + 1'), { to, [name]: value } as never)
        ).toThrow(`The compilation option "${name}" was removed in 0.194.0`);
    });

    test(`canCompile() answers ok: false on \`${name}\``, () => {
      const r = canCompile(ce.parse('x + 1'), { [name]: value } as never);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.diagnostic.message).toContain(`"${name}"`);
    });
  }

  test('canCompile() answers on interval-js with no `profile`', () => {
    expect(canCompile(ce.parse('x + 1'), { to: 'interval-js' }).ok).toBe(true);
  });

  test('the options that stay are accepted', () => {
    const r = compile(ce.parse('x + 1'), {
      profile: 'ir',
      callerLocals: ['x'],
    } as never);
    expect(r.success).toBe(true);
    expect(r.run?.({ x: 2 })).toBe(3);
  });
});

describe('the definition keys that 0.194.0 removed', () => {
  for (const key of ['compileHelpers', 'compileShippable']) {
    test(`an operator definition with \`${key}\` throws`, () => {
      const e = new ComputeEngine();
      expect(() =>
        e.declare('MyOp', {
          signature: '(real) -> real',
          [key]: key === 'compileHelpers' ? {} : true,
        } as never)
      ).toThrow(`the key "${key}" was removed in 0.194.0`);
    });
  }

  test('a value kind with `arithmetic.compile` throws', () => {
    const e = new ComputeEngine();
    expect(() =>
      e.declare('MyResidue', {
        signature: '(integer, integer) -> residue',
        arithmetic: { compile: {} },
      } as never)
    ).toThrow('the key "arithmetic.compile" was removed in 0.194.0');
  });
});

describe('an operator compile handler', () => {
  function engine() {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.declare('Twice', {
      signature: '(real) -> real',
      evaluate: ([t], { engine }) => engine.number(2 * t.re),
    });
    return e;
  }

  test('that returns an expression compiles it in place of the node', () => {
    const e = engine();
    const def = e.lookupDefinition('Twice');
    if (def === undefined || !('operator' in def)) throw new Error('Twice');
    def.operator.compile = ([t]) => e.box(['Multiply', 2, t]);
    const r = compile(e.box(['Twice', 'x']));
    expect(r.success).toBe(true);
    expect(r.run?.({ x: 3 })).toBe(6);
  });

  test('that returns text declines, and the interpreter evaluates', () => {
    const e = engine();
    const def = e.lookupDefinition('Twice');
    if (def === undefined || !('operator' in def)) throw new Error('Twice');
    def.operator.compile = (() => '2 * _.x') as never;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = compile(e.box(['Twice', 'x']));
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('outside-profile');
      expect(r.run?.({ x: 3 })).toBe(6);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('a decline on GLSL', () => {
  test('gives no code and a run that evaluates, with a warning', () => {
    const e = new ComputeEngine();
    e.declare('L', 'list<real>');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = compile(e.box(['Sort', 'L']), { to: 'glsl' });
      expect(r.success).toBe(false);
      expect(r.code).toBe('');
      expect(r.diagnostic?.code).toBe('outside-profile');
      expect(typeof r.run).toBe('function');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('runAsync() in 0.194.0', () => {
  test('runs run(), and willParallelize() is false', async () => {
    const r = compile(ce.parse('x + 1'));
    expect(r.willParallelize?.(1e6)).toBe(false);
    await expect(r.runAsync?.({ x: 2 })).resolves.toBe(3);
  });

  test('refuses a minPasses that is not a positive integer', async () => {
    const r = compile(ce.parse('x + 1'));
    await expect(r.runAsync?.({ x: 2 }, { minPasses: 0 })).rejects.toThrow(
      'minPasses'
    );
  });
});
