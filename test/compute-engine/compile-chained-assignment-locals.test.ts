/**
 * The inner target of a chained assignment (`t ≔ (u ≔ t + i)`) in a loop
 * body, and a nested block whose last statement is an assignment, on the
 * JavaScript and shader targets.
 *
 * - The interpreter declares the inner target `u` in the loop body when no
 *   scope binds it, or when only the canonical form of a read of `u` in an
 *   enclosing block of the expression binds it (a `u` read after the loop).
 *   The compiled code declares a local `u` in the loop body on every route
 *   (a loop body that is a block, or one statement), and does not write the
 *   caller's `vars` object.
 * - When an engine scope outside the expression binds `u`
 *   (`ce.declare('u', 'real')`), the interpreter changes that binding. A
 *   shader target cannot write an input, so the compilation fails on both
 *   routes.
 * - WGSL `compileFunction()` compiles `Block(s ≔ x; Block(t ≔ s + 1))`, as
 *   GLSL does.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const range = ['Element', 'i', ['Range', 1, 3]];
const chained = ['Assign', 't', ['Assign', 'u', ['Add', 't', 'i']]];
/** The loop body as a block, and as one statement. */
const BODIES: [string, any][] = [
  ['a block', ['Block', chained]],
  ['one statement', chained],
];
const program = (body: any, result: any) => [
  'Block',
  ['Assign', 't', 0],
  ['Loop', body, range],
  result,
];

describe('JAVASCRIPT: CHAINED ASSIGNMENT IN A LOOP BODY', () => {
  for (const [name, body] of BODIES)
    test(`${name}: the inner target is a local of the loop body`, () => {
      const ce = new ComputeEngine();
      const expr = ce.box(program(body, 't') as any);
      expect(expr.evaluate().toString()).toBe('6');
      const c = compile(expr, { fallback: false }) as any;
      expect(c.success).toBe(true);
      expect(c.code).not.toContain('_.u');
      const vars: Record<string, unknown> = {};
      expect(c.run(vars)).toBe(6);
      expect(vars).toEqual({});
    });

  test('the reported shape: a block with a later read of the inner target', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(
      program(['Block', chained, ['Assign', 'w', 'u']], 't') as any
    );
    const c = compile(expr, { fallback: false }) as any;
    expect(c.code).not.toContain('_.u');
    const vars: Record<string, unknown> = {};
    expect(c.run(vars)).toBe(6);
    expect(vars).toEqual({});
  });

  for (const [name, body] of BODIES)
    test(`${name}: a read of u after the loop reads the input`, () => {
      // The loop does not change the `u` read after it: the interpreter
      // gives `u + 6`.
      const ce = new ComputeEngine();
      const expr = ce.box(program(body, ['Add', 't', 'u']) as any);
      expect(expr.evaluate().toString()).toBe('u + 6');
      const c = compile(expr, { fallback: false }) as any;
      const vars = { u: 2 };
      expect(c.run(vars)).toBe(8);
      expect(vars).toEqual({ u: 2 });
    });

  test('a three-level chain declares each inner target', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(
      program(
        [
          'Block',
          ['Assign', 't', ['Assign', 'u', ['Assign', 'v', ['Add', 't', 'i']]]],
        ],
        't'
      ) as any
    );
    expect(expr.evaluate().toString()).toBe('6');
    const c = compile(expr, { fallback: false }) as any;
    expect(c.code).not.toMatch(/_\.[uv]\b/);
    expect(c.run({})).toBe(6);
  });
});

describe('SHADERS: CHAINED ASSIGNMENT IN A LOOP BODY', () => {
  for (const to of ['glsl', 'wgsl'] as const)
    for (const [name, body] of BODIES) {
      test(`${to}, ${name}: a u read after the loop is not written`, () => {
        const ce = new ComputeEngine();
        const code = (
          compile(ce.box(program(body, ['Add', 't', 'u']) as any), {
            to,
            fallback: false,
          }) as any
        ).code as string;
        // A local `u` is declared in the loop body, before its write.
        const local = to === 'glsl' ? 'float u;' : 'var u: f32;';
        expect(code).toContain(local);
        expect(code.indexOf(local)).toBeGreaterThan(code.indexOf('for'));
      });

      test(`${to}, ${name}: a u that an engine scope binds declines`, () => {
        const ce = new ComputeEngine();
        ce.declare('u', 'real');
        const expr = ce.box(program(body, 't') as any);
        // The interpreter changes the engine's `u`.
        expect(expr.evaluate().toString()).toBe('6');
        expect(ce.box('u').evaluate().toString()).toBe('6');
        expect(() =>
          compile(ce.box(program(body, 't') as any), { to, fallback: false })
        ).toThrow(/an engine scope outside the expression binds/);
      });
    }
});

describe('WGSL compileFunction(): A NESTED BLOCK WITH A TAIL ASSIGNMENT', () => {
  const ce = new ComputeEngine();
  const nested = ce.box([
    'Block',
    ['Assign', 's', 'x'],
    ['Block', ['Assign', 't', ['Add', 's', 1]]],
  ]);

  test('the value is the value of the last assignment', () => {
    expect(nested.subs({ x: 3 }).evaluate().toString()).toBe('4');
  });

  test('WGSL compiles it, as GLSL does', () => {
    expect(
      new WGSLTarget().compileFunction(nested, 'f', 'float', [['x', 'float']])
    ).toBe(
      'fn f(x: f32) -> f32 {\n' +
        '  var s: f32;\n' +
        '  s = x;\n' +
        '  var _tv1: f32;\n' +
        '  {\n' +
        '    var t: f32;\n' +
        '    t = s + 1.0;\n' +
        '    _tv1 = t;\n' +
        '  }\n' +
        '  return _tv1;\n' +
        '}'
    );
    expect(
      new GLSLTarget().compileFunction(nested, 'f', 'float', [['x', 'float']])
    ).toContain('return _tv1;');
  });

  test('two levels of nested blocks', () => {
    const deeper = ce.box([
      'Block',
      ['Assign', 's', 'x'],
      ['Block', ['Block', ['Assign', 't', ['Add', 's', 1]]]],
    ]);
    expect(
      new WGSLTarget().compileFunction(deeper, 'f', 'float', [['x', 'float']])
    ).toContain('  return _tv1;\n}');
  });

  test('a lone assignment still declines', () => {
    expect(() =>
      new WGSLTarget().compileFunction(
        ce.box(['Assign', 's', 'x']),
        'f',
        'float',
        [['x', 'float']]
      )
    ).toThrow(/assignment/);
  });
});
