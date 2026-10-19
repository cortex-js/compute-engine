/**
 * A compiled body that assigns an input does not change the binding of the
 * caller.
 *
 * When an engine scope binds `u` (`ce.declare('u', 'real')`), the body
 * `u ≔ u + 1` (or the chained `t ≔ (u ≔ t + i)` in a loop) writes `u` as an
 * input of the compiled code, with the same spelling as a read: `_.u` in the
 * JavaScript targets. The write changed the `vars` object that the caller gave
 * to `run()`. The interpreter changes the engine's binding instead.
 *
 * - JavaScript and interval-js make the vars object a local copy before the
 *   body runs, so the caller's object does not change, and a read of `u`
 *   before the first write gives the caller's value.
 * - Python `compileFunction()` reads `u` as a parameter (a local already) or
 *   as a module global. For a global, the function starts with a local `u`
 *   initialized from the global: without it, the read of `u` before the
 *   write raised `UnboundLocalError`.
 * - Python `compile()` (code with no `def`) reads and writes a local copy of
 *   `u` with a generated name, which starts with the value of `u`.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { TEST_PYTHON } from './test-python';
import { execFileSync } from 'child_process';

const range = ['Element', 'i', ['Range', 1, 3]];
const chained = ['Assign', 't', ['Assign', 'u', ['Add', 't', 'i']]];

/** [name, MathJSON]. Each one assigns `u`. */
const PROGRAMS: [string, any][] = [
  [
    'a chained assignment in a loop body',
    ['Block', ['Assign', 't', 0], ['Loop', chained, range], 't'],
  ],
  [
    'a chained assignment in a loop block, read after the loop',
    [
      'Block',
      ['Assign', 't', 0],
      ['Loop', ['Block', chained], range],
      ['Add', 't', 'u'],
    ],
  ],
  ['u ≔ u + 1', ['Assign', 'u', ['Add', 'u', 1]]],
  [
    'u ≔ u + 1, then a read',
    ['Block', ['Assign', 'u', ['Add', 'u', 1]], ['Multiply', 'u', 2]],
  ],
  [
    'a write before any read',
    ['Block', ['Assign', 'u', 3], ['Multiply', 'u', 2]],
  ],
  [
    'an accumulation in a loop',
    ['Block', ['Loop', ['Assign', 'u', ['Add', 'u', 'i']], range], 'u'],
  ],
];

/** The interpreter's value with `u = 5`. */
function interpreted(src: any): number {
  const ce = new ComputeEngine();
  ce.declare('u', 'real');
  ce.assign('u', 5);
  return ce.box(src).evaluate().re;
}

describe('JAVASCRIPT: AN INPUT THAT THE BODY ASSIGNS', () => {
  for (const [name, src] of PROGRAMS)
    test(name, () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      const c = compile(ce.box(src), { fallback: false }) as any;
      expect(c.success).toBe(true);
      const vars = { u: 5 };
      expect(c.run(vars)).toBe(interpreted(src));
      expect(vars).toEqual({ u: 5 });
      // A second call starts from the caller's value again.
      expect(c.run(vars)).toBe(interpreted(src));
    });

  test('a write before any read needs no vars object', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    const c = compile(
      ce.box(['Block', ['Assign', 'u', 3], ['Multiply', 'u', 2]]),
      { fallback: false }
    ) as any;
    expect(c.run()).toBe(6);
  });

  test('a user function reads the value that the body wrote', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    ce.parse('g(x) := x + u').evaluate();
    const src = ['Block', ['Assign', 'u', ['Add', 'u', 1]], ['g', 2]];
    const c = compile(ce.box(src), { fallback: false }) as any;
    const vars = { u: 5 };
    expect(c.run(vars)).toBe(8);
    expect(vars).toEqual({ u: 5 });
    ce.assign('u', 5);
    expect(ce.box(src).evaluate().toString()).toBe('8');
  });

  test('the other inputs are read from the caller, and stay unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    const c = compile(
      ce.box([
        'Block',
        ['Assign', 'u', ['Add', 'u', 'w']],
        ['Multiply', 'u', 2],
      ]),
      { fallback: false }
    ) as any;
    const vars = { u: 5, w: 1 };
    expect(c.run(vars)).toBe(12);
    expect(vars).toEqual({ u: 5, w: 1 });
  });

  test('a frozen object, a read-only inherited input and a setter', () => {
    // The copy defines its properties. Before, it assigned them, so a
    // frozen caller object (the prototype of the copy) made the write throw
    // "Cannot assign to read only property", and an inherited setter ran.
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    ce.declare('w', 'real');
    const c = compile(
      ce.box(['Block', ['Assign', 'u', ['Add', 'u', 'w']], 'u']),
      { fallback: false }
    ) as any;
    const frozen = Object.freeze({ u: 5, w: 1 });
    expect(c.run(frozen)).toBe(6);
    const child = Object.create(Object.freeze({ u: 7 }));
    child.w = 2;
    expect(c.run(child)).toBe(9);
    expect(child.u).toBe(7);
    let setterCalls = 0;
    const withSetter = Object.create({
      get u() {
        return 3;
      },
      set u(_v: number) {
        setterCalls += 1;
      },
    });
    withSetter.w = 1;
    expect(c.run(withSetter)).toBe(4);
    expect(setterCalls).toBe(0);
  });

  test('an input named after a property of Object.prototype', () => {
    // The compiled code reads `toString` only when it is an own property of
    // the vars object. The copy keeps it as an own property.
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    ce.declare('toString', 'real');
    const c = compile(
      ce.box(['Block', ['Assign', 'u', ['Add', 'u', 'toString']], 'u']),
      { fallback: false }
    ) as any;
    expect(c.run({ u: 1, toString: 2 })).toBe(3);
    expect(c.run({ u: 1 })).toBeNaN();
  });

  test('a getter of an input that the body does not read is not called', () => {
    // The copy takes the descriptors of the caller's properties: before, it
    // read each one, and a getter that throws made `run()` throw.
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    const c = compile(ce.box(['Block', ['Assign', 'u', 3], 'u']), {
      fallback: false,
    }) as any;
    const vars = {
      get z(): number {
        throw new Error('z is read');
      },
    };
    expect(c.run(vars)).toBe(3);
  });

  test('a body that writes no input reads the caller object as before', () => {
    const ce = new ComputeEngine();
    const c = compile(ce.parse('x + 1'), { fallback: false }) as any;
    expect(c.code).toBe('_.x + 1');
  });
});

describe('INTERVAL-JS: AN INPUT THAT THE BODY ASSIGNS', () => {
  for (const [name, src] of PROGRAMS)
    test(name, () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      const c = compile(ce.box(src), {
        to: 'interval-js',
        fallback: false,
      }) as any;
      expect(c.success).toBe(true);
      const vars = { u: 5 };
      const v = interpreted(src);
      expect(c.run(vars)).toEqual({
        kind: 'interval',
        value: { lo: v, hi: v },
      });
      expect(vars).toEqual({ u: 5 });
      // The emitted code run with the host's own object does not change it.
      const host = { u: { lo: 5, hi: 5 } };
      new Function('_IA', '_', `${c.preamble ?? ''}\nreturn ${c.code};`)(
        c.run.IA,
        host
      );
      expect(host).toEqual({ u: { lo: 5, hi: 5 } });
    });
});

describe('PYTHON: AN INPUT THAT THE BODY ASSIGNS', () => {
  (TEST_PYTHON === undefined ? it.skip : it)(
    'a parameter u and a global u give the interpreter value, and the global does not change',
    () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      const py = new PythonTarget({ includeImports: true });
      // A root assignment has no Python function body (it declines).
      const programs = PROGRAMS.filter(([, src]) => src[0] !== 'Assign');
      let program = 'import json\nu = 5.0\nout = []\n';
      programs.forEach(([, src], k) => {
        program += py.compileFunction(ce.box(src), `p${k}`, ['u']) + '\n';
        program += py.compileFunction(ce.box(src), `g${k}`, ['x']) + '\n';
        program += `out.append([p${k}(5.0), g${k}(0.0), u])\n`;
      });
      program += 'print(json.dumps(out))\n';
      const out = JSON.parse(
        execFileSync(TEST_PYTHON!, ['-c', program], { encoding: 'utf8' })
      ) as [number, number, number][];
      programs.forEach(([name, src], k) => {
        const v = interpreted(src);
        expect([name, ...out[k]]).toEqual([name, v, v, 5]);
      });
    }
  );
});

describe('PYTHON: A NAME THAT COLLIDES WITH THE GLOBALS LOOKUP', () => {
  // The local of a written global is initialized from the module globals.
  // The bare call `globals()` read a parameter or a written input named
  // `globals` instead of the builtin.
  const ce = new ComputeEngine();
  ce.declare('u', 'real');
  ce.declare('globals', 'real');
  const py = new PythonTarget({ includeImports: true });
  const withParameter = py.compileFunction(
    ce.box(['Block', ['Assign', 'u', ['Add', 'u', 'globals']], 'u']),
    'f',
    ['globals']
  );
  const withWrittenGlobal = py.compileFunction(
    ce.box(['Block', ['Assign', 'globals', ['Add', 'globals', 1]], 'globals']),
    'g',
    ['x']
  );

  test('the builtin is read through the builtins module', () => {
    expect(withParameter).toContain('__import__("builtins").globals()');
    expect(withParameter).not.toMatch(/(^|[^.])globals\(\)/m);
    expect(withWrittenGlobal).toContain(
      'globals = __import__("builtins").globals().get("globals")'
    );
  });

  test('the name __import__ is refused', () => {
    expect(() =>
      py.compileFunction(
        ce.box(['Block', ['Assign', 'u', ['Add', 'u', '__import__']], 'u']),
        'h',
        ['x']
      )
    ).toThrow(/"__import__" cannot be used/);
  });

  (TEST_PYTHON === undefined ? it.skip : it)(
    'the functions run and the globals do not change',
    () => {
      const program = [
        'import json',
        'u = 5.0',
        'globals_value = 2.0',
        withParameter,
        withWrittenGlobal.replace(/^import .*$/gm, ''),
        'r1 = f(1.0)',
        'G = {"globals": 2.0}',
        `exec(${JSON.stringify(withWrittenGlobal)}, G)`,
        'r2 = G["g"](0.0)',
        'print(json.dumps([r1, u, r2, G["globals"]]))',
      ].join('\n');
      const out = JSON.parse(
        execFileSync(TEST_PYTHON!, ['-c', program], { encoding: 'utf8' })
      );
      expect(out).toEqual([6, 5, 3, 2]);
    }
  );
});

describe('PYTHON compile(): AN INPUT THAT THE BODY ASSIGNS', () => {
  // The code of `compile()` has no `def`. A host runs it in a function that
  // it writes around the code, or at the top level of a module. In a
  // function, the plain `u = u + 1` made `u` a local of the function, and the
  // read of `u` raised `UnboundLocalError` when `u` is a global. The code now
  // writes a local copy of `u` that starts with the value of `u`, which reads
  // a global, a parameter of the host's function and a variable of an
  // enclosing function alike.
  const py = new PythonTarget();
  const box = (src: any) => {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    return ce.box(src);
  };

  test('the code writes a local copy of the input', () => {
    expect(py.compile(box(['Assign', 'u', ['Add', 'u', 1]])).code).toBe(
      '_tv1 = u\n_tv1 = _tv1 + 1'
    );
    expect(
      py.compile(
        box(['Block', ['Assign', 'u', ['Add', 'u', 1]], ['Multiply', 2, 'u']])
      ).code
    ).toBe('_tv1 = u\n_tv1 = _tv1 + 1\nreturn 2 * _tv1');
  });

  test('a write before any read does not read the input', () => {
    expect(
      py.compile(box(['Block', ['Assign', 'u', 3], ['Multiply', 'u', 2]])).code
    ).toBe('_tv1 = 3\nreturn 2 * _tv1');
  });

  test('an input that `vars` maps starts with the mapped source', () => {
    expect(
      py.compile(box(['Block', ['Assign', 'u', ['Add', 'u', 1]], 'u']), {
        vars: { u: 'p["u"]' },
      }).code
    ).toBe('_tv1 = p["u"]\n_tv1 = _tv1 + 1\nreturn _tv1');
  });

  (TEST_PYTHON === undefined ? it.skip : it)(
    'the code run in a function, with u as a global or a parameter, gives the interpreter value',
    () => {
      const indent = (code: string) =>
        code
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n');
      let program = 'import json\nu = 5.0\nout = []\n';
      PROGRAMS.forEach(([, src], k) => {
        const code = py.compile(box(src)).code;
        program += `def g${k}():\n${indent(code)}\n`;
        program += `def p${k}(u):\n${indent(code)}\n`;
        program += `out.append([g${k}(), p${k}(5.0), u])\n`;
      });
      program += 'print(json.dumps(out))\n';
      const out = JSON.parse(
        execFileSync(TEST_PYTHON!, ['-c', program], { encoding: 'utf8' })
      ) as [number | null, number | null, number][];
      PROGRAMS.forEach(([name, src], k) => {
        // A root assignment is a statement: the function gives `None`.
        const v = src[0] === 'Assign' ? null : interpreted(src);
        expect([name, ...out[k]]).toEqual([name, v, v, 5]);
      });
    }
  );
});

describe('PYTHON: A SUM WHOSE BODY IS A STATEMENT', () => {
  // The Python lowering of `Sum`/`Product` is a generator expression, whose
  // element is an expression. A body with an assignment gave
  // `sum(_tv1 = k + _tv1 ⏎ return _tv1 for k in range(1, 4))`, a syntax
  // error. Such a body is now a `for` loop with an accumulator, written
  // ahead of the body's value (`compile-statement-forms.test.ts`); a body
  // that writes an input writes the local copy of the input.
  const py = new PythonTarget();
  const limits = ['Limits', 'k', 1, 3];
  const PROGRAMS: [string, boolean, any][] = [
    [
      'a block that writes an input',
      true,
      ['Sum', ['Block', ['Assign', 'u', ['Add', 'u', 'k']], 'u'], limits],
    ],
    [
      'a block with a local',
      false,
      [
        'Sum',
        ['Block', ['Assign', 't', ['Add', 'k', 1]], ['Multiply', 't', 't']],
        limits,
      ],
    ],
    [
      'an assignment',
      false,
      ['Product', ['Block', ['Assign', 't', ['Add', 'k', 1]]], limits],
    ],
  ];
  for (const [name, declareU, src] of PROGRAMS)
    (TEST_PYTHON === undefined ? it.skip : it)(name, () => {
      const ce = new ComputeEngine();
      if (declareU) ce.declare('u', 'real');
      const code = py.compile(ce.box(src)).code;
      expect(code).toMatch(/^for _tv\d+ in range\(1, 4\):$/m);
      // The input `u` is read, never written.
      expect(code).not.toMatch(/(^|[^\w.])u\s*=[^=]/m);
      const indent = code
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n');
      const out = execFileSync(
        TEST_PYTHON!,
        [
          '-c',
          `import json\nu = 5.0\ndef g():\n${indent}\nprint(json.dumps([g(), u]))`,
        ],
        { encoding: 'utf8' }
      );
      expect(JSON.parse(out)).toEqual([interpreted(src), 5]);
    });

  (TEST_PYTHON === undefined ? it.skip : it)(
    'a block whose value is an expression still runs',
    () => {
      const ce = new ComputeEngine();
      const src = ['Sum', ['Block', ['Multiply', 'k', 'k']], limits];
      const code = py.compile(ce.box(src)).code;
      const out = execFileSync(
        TEST_PYTHON!,
        ['-c', `import json\nprint(json.dumps(${code}))`],
        { encoding: 'utf8' }
      );
      expect(JSON.parse(out)).toBe(ce.box(src).evaluate().re);
    }
  );
});
