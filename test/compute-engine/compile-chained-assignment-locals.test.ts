/**
 * A chained assignment (`t ≔ (u ≔ t + i)`) in a loop body, a write to a
 * symbol of the engine in a loop body, and a nested block whose last
 * statement is an assignment, on the JavaScript and shader targets.
 *
 * - An `Assign` that is the value of another `Assign` is the static error
 *   `assignment-in-operand`. The expression is invalid, and every target
 *   declines. Write the chain as two statements.
 * - A loop body that writes a symbol declared in the engine
 *   (`ce.declare('u', 'real')`) declines: compiled code writes only the
 *   locals that it declares.
 * - WGSL `compileFunction()` compiles `Block(s ≔ x; Block(t ≔ s + 1; t))`,
 *   as GLSL does. When the nested block ends with the assignment, its value
 *   is `Nothing`, and both targets decline.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const range = ['Element', 'i', ['Range', 1, 3]];
const chained = ['Assign', 't', ['Assign', 'u', ['Add', 't', 'i']]];
const program = (body: any, result: any) => [
  'Block',
  ['Assign', 't', 0],
  ['Loop', body, range],
  result,
];

describe('A CHAINED ASSIGNMENT IS A STATIC ERROR', () => {
  test('the interpreter marks the inner assignment as an error', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Assign', 't', 0],
      ['Assign', 't', ['Assign', 'u', 1]],
      't',
    ] as any);
    expect(expr.isValid).toBe(false);
    expect(expr.toString()).toContain('assignment-in-operand');
  });

  for (const to of ['javascript', 'glsl', 'wgsl', 'python'] as const)
    test(`${to} declines a chained assignment in a loop body`, () => {
      const ce = new ComputeEngine();
      const expr = ce.box(program(['Block', chained], 't') as any);
      expect(expr.isValid).toBe(false);
      expect(() => compile(expr, { to, fallback: false })).toThrow(
        /invalid expression/
      );
    });
});

describe('JAVASCRIPT: TWO ASSIGNMENTS IN A LOOP BODY', () => {
  // The chain written as two statements. `u` is first assigned at the
  // level of the outer block, so the loop body can assign it again.
  const body = [
    'Block',
    ['Assign', 'u', ['Add', 't', 'i']],
    ['Assign', 't', 'u'],
  ];
  const twoStatements = (result: any) => [
    'Block',
    ['Assign', 't', 0],
    ['Assign', 'u', 0],
    ['Loop', body, range],
    result,
  ];

  test('the inner target is a local of the compiled code', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(twoStatements('t') as any);
    expect(expr.evaluate().toString()).toBe('6');
    const c = compile(expr, { fallback: false }) as any;
    expect(c.success).toBe(true);
    expect(c.code).not.toContain('_.u');
    const vars: Record<string, unknown> = {};
    expect(c.run(vars)).toBe(6);
    expect(vars).toEqual({});
  });
});

describe('SHADERS: A WRITE TO A SYMBOL OF THE ENGINE IN A LOOP BODY', () => {
  for (const to of ['glsl', 'wgsl'] as const)
    test(`${to}: a u that an engine scope binds declines`, () => {
      // A write to a symbol declared in the engine declines.
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      const body = [
        'Block',
        ['Assign', 'u', ['Add', 't', 'i']],
        ['Assign', 't', 'u'],
      ];
      expect(() =>
        compile(ce.box(program(body, 't') as any), { to, fallback: false })
      ).toThrow(/"u" is not a local of the compiled expression/);
    });
});

describe('WGSL compileFunction(): A NESTED BLOCK WITH A TAIL ASSIGNMENT', () => {
  const ce = new ComputeEngine();
  const nested = ce.box([
    'Block',
    ['Assign', 's', 'x'],
    ['Block', ['Assign', 't', ['Add', 's', 1]], 't'],
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
      ['Block', ['Block', ['Assign', 't', ['Add', 's', 1]], 't']],
    ]);
    expect(
      new WGSLTarget().compileFunction(deeper, 'f', 'float', [['x', 'float']])
    ).toContain('  return _tv1;\n}');
  });

  test('a nested block that ends with the assignment declines', () => {
    // The value of the nested block is `Nothing`, and the function returns
    // it.
    const tail = ce.box([
      'Block',
      ['Assign', 's', 'x'],
      ['Block', ['Assign', 't', ['Add', 's', 1]]],
    ]);
    expect(tail.subs({ x: 3 }).evaluate().symbol).toBe('Nothing');
    for (const target of [new WGSLTarget(), new GLSLTarget()])
      expect(() =>
        target.compileFunction(tail, 'f', 'float', [['x', 'float']])
      ).toThrow(/its value is used here/);
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
