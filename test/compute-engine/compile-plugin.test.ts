import { engine as ce } from '../utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type {
  LanguageTarget,
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  CompilationResult,
} from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';

/**
 * Example custom target: Python-like compilation
 */
class PythonTarget implements LanguageTarget {
  getOperators(): CompiledOperators {
    return {
      Add: ['+', 11],
      Subtract: ['-', 11],
      Multiply: ['*', 12],
      Divide: ['/', 13],
      Power: ['**', 14],
    };
  }

  getFunctions(): CompiledFunctions {
    return {
      Sin: 'math.sin',
      Cos: 'math.cos',
      Sqrt: 'math.sqrt',
      Abs: 'abs',
      Max: 'max',
      Min: 'min',
    };
  }

  createTarget(options: Partial<CompileTarget> = {}): CompileTarget {
    const ops = this.getOperators();
    const fns = this.getFunctions();

    return {
      language: 'python',
      operators: (op) => ops[op],
      functions: (id) => fns[id],
      var: (id) => id,
      string: (str) => JSON.stringify(str),
      number: (n) => n.toString(),
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      ...options,
    };
  }

  compile(expr: Expression, options: any = {}): CompilationResult {
    const {
      BaseCompiler,
    } = require('../../src/compute-engine/compilation/base-compiler');
    const target = this.createTarget();
    const pythonCode = BaseCompiler.compile(expr, target);

    return {
      target: 'python',
      success: true,
      code: pythonCode,
    };
  }
}

/**
 * Example custom target: RPN (Reverse Polish Notation)
 */
class RPNTarget implements LanguageTarget {
  getOperators(): CompiledOperators {
    // RPN doesn't use infix operators
    return {};
  }

  getFunctions(): CompiledFunctions {
    return {
      Add: (args, compile) => args.map(compile).join(' ') + ' +',
      Subtract: (args, compile) =>
        compile(args[0]) + ' ' + compile(args[1]) + ' -',
      Multiply: (args, compile) => args.map(compile).join(' ') + ' *',
      Divide: (args, compile) =>
        compile(args[0]) + ' ' + compile(args[1]) + ' /',
      Power: (args, compile) =>
        compile(args[0]) + ' ' + compile(args[1]) + ' **',
      Sin: (args, compile) => compile(args[0]) + ' sin',
      Cos: (args, compile) => compile(args[0]) + ' cos',
      Sqrt: (args, compile) => compile(args[0]) + ' sqrt',
    };
  }

  createTarget(options: Partial<CompileTarget> = {}): CompileTarget {
    const fns = this.getFunctions();

    return {
      language: 'rpn',
      operators: () => undefined,
      functions: (id) => fns[id],
      var: (id) => id,
      string: (str) => str,
      number: (n) => n.toString(),
      indent: 0,
      ws: () => '',
      preamble: '',
      ...options,
    };
  }

  compile(expr: Expression, options: any = {}): CompilationResult {
    const {
      BaseCompiler,
    } = require('../../src/compute-engine/compilation/base-compiler');
    const target = this.createTarget();
    const rpnCode = BaseCompiler.compile(expr, target);

    return {
      target: 'rpn',
      success: true,
      code: rpnCode,
    };
  }
}

describe('COMPILATION PLUGIN ARCHITECTURE', () => {
  describe('Target Registry', () => {
    it('should have default targets registered', () => {
      // JavaScript should be registered
      const jsTarget = ce._getCompilationTarget('javascript');
      expect(jsTarget).toBeDefined();

      // GLSL should be registered
      const glslTarget = ce._getCompilationTarget('glsl');
      expect(glslTarget).toBeDefined();

      // Interval targets should be registered
      const intervalJSTarget = ce._getCompilationTarget('interval-js');
      expect(intervalJSTarget).toBeDefined();
    });

    it('should list all default targets', () => {
      const targets = ce._listCompilationTargets();
      expect(targets).toContain('javascript');
      expect(targets).toContain('glsl');
      expect(targets).toContain('interval-js');
    });

    it('should allow registering custom targets', () => {
      const pythonTarget = new PythonTarget();
      ce._registerCompilationTarget('python', pythonTarget);

      const registered = ce._getCompilationTarget('python');
      expect(registered).toBe(pythonTarget);

      // Should appear in list
      expect(ce._listCompilationTargets()).toContain('python');
    });

    it('should allow overriding existing targets', () => {
      const customJSTarget = new PythonTarget(); // Just for testing override
      ce._registerCompilationTarget('javascript', customJSTarget);

      const registered = ce._getCompilationTarget('javascript');
      expect(registered).toBe(customJSTarget);

      // Restore default
      const {
        JavaScriptTarget,
      } = require('../../src/compute-engine/compilation/javascript-target');
      ce._registerCompilationTarget('javascript', new JavaScriptTarget());
    });

    it('should return undefined for unregistered target', () => {
      expect(ce._getCompilationTarget('nonexistent')).toBeUndefined();
    });

    it('should unregister a target', () => {
      ce._registerCompilationTarget('temp-target', new PythonTarget());
      expect(ce._getCompilationTarget('temp-target')).toBeDefined();
      expect(ce._listCompilationTargets()).toContain('temp-target');

      ce._unregisterCompilationTarget('temp-target');
      expect(ce._getCompilationTarget('temp-target')).toBeUndefined();
      expect(ce._listCompilationTargets()).not.toContain('temp-target');
    });

    it('should throw when compiling with an unregistered target', () => {
      ce._registerCompilationTarget('removable', new PythonTarget());
      ce._unregisterCompilationTarget('removable');

      const expr = ce.parse('x + y');
      expect(() => {
        compile(expr, { to: 'removable', fallback: false });
      }).toThrow(/not registered/);
    });
  });

  describe('Compiling with Custom Targets', () => {
    beforeAll(() => {
      ce._registerCompilationTarget('python', new PythonTarget());
      ce._registerCompilationTarget('rpn', new RPNTarget());
    });

    it('should compile to Python target', () => {
      const expr = ce.parse('x + y');
      const compiled = compile(expr, { to: 'python' });
      expect(compiled.code).toMatchInlineSnapshot(`x + y`);
    });

    it('should compile to Python with functions', () => {
      const expr = ce.parse('\\sin(x) + \\cos(y)');
      const compiled = compile(expr, { to: 'python' });
      expect(compiled.code).toMatchInlineSnapshot(`math.sin(x) + math.cos(y)`);
    });

    it('should compile to Python with power operator', () => {
      const expr = ce.parse('x^2');
      const compiled = compile(expr, { to: 'python' });
      // Power in Python is **
      expect(compiled.code).toMatchInlineSnapshot(`x ** 2`);
    });

    it('should compile to RPN target', () => {
      const expr = ce.parse('x + y');
      const compiled = compile(expr, { to: 'rpn' });
      expect(compiled.code).toMatchInlineSnapshot(`x y +`);
    });

    it('should compile complex expression to RPN', () => {
      const expr = ce.parse('(x + y) * z');
      const compiled = compile(expr, { to: 'rpn' });
      // Canonical form may reorder operands: z * (x + y)
      expect(compiled.code).toMatchInlineSnapshot(`z x y + *`);
    });

    it('should compile trigonometric to RPN', () => {
      const expr = ce.parse('\\sin(x)');
      const compiled = compile(expr, { to: 'rpn' });
      expect(compiled.code).toMatchInlineSnapshot(`x sin`);
    });

    it('should throw error for unregistered target', () => {
      const expr = ce.parse('x + y');
      expect(() => {
        compile(expr, { to: 'matlab', fallback: false });
      }).toThrow(/not registered/);
    });
  });

  describe('Direct Target Override', () => {
    it('should allow direct target override', () => {
      const expr = ce.parse('x + y');

      const customTarget: CompileTarget = {
        language: 'custom',
        operators: (op) => (op === 'Add' ? ['⊕', 10] : undefined),
        functions: () => undefined,
        var: (id) => `VAR_${id}`,
        string: (str) => `"${str}"`,
        number: (n) => `NUM(${n})`,
        indent: 0,
        ws: () => ' ',
        preamble: '',
      };

      const compiled = compile(expr, { target: customTarget });
      expect(compiled.code).toMatchInlineSnapshot(`VAR_x ⊕ VAR_y`);
    });

    it('should prioritize target over to option', () => {
      const expr = ce.parse('x');

      const customTarget: CompileTarget = {
        language: 'custom',
        operators: () => undefined,
        functions: () => undefined,
        var: (id) => `CUSTOM_${id}`,
        string: (str) => str,
        number: (n) => n.toString(),
        indent: 0,
        ws: () => '',
        preamble: '',
      };

      const compiled = compile(expr, {
        to: 'javascript',
        target: customTarget,
      });

      // Should use custom target, not javascript
      expect(compiled.code).toBe('CUSTOM_x');
    });
  });

  describe('GLSL Target via Registry', () => {
    it('should compile to GLSL via registry', () => {
      const expr = ce.parse('x + y');
      const compiled = compile(expr, { to: 'glsl' });
      expect(compiled.code).toMatchInlineSnapshot(`x + y`);
    });

    it('should compile GLSL functions', () => {
      const expr = ce.parse('\\sin(x)');
      const compiled = compile(expr, { to: 'glsl' });
      expect(compiled.code).toMatchInlineSnapshot(`_gpu_sin(x)`);
    });

    it('should compile GLSL vectors', () => {
      const expr = ce.expr(['List', 1, 2, 3]);
      const compiled = compile(expr, { to: 'glsl' });
      expect(compiled.code).toMatchInlineSnapshot(`vec3(1.0, 2.0, 3.0)`);
    });
  });

  describe('JavaScript Target via Registry', () => {
    it('should compile to JavaScript via registry (default)', () => {
      const expr = ce.parse('x + y');
      const compiled = compile(expr);
      expect(compiled.run).toBeDefined();
      expect(compiled.success).toBe(true);
    });

    it('should compile to JavaScript via registry (explicit)', () => {
      const expr = ce.parse('x + y');
      const compiled = compile(expr, { to: 'javascript' });
      expect(compiled.run).toBeDefined();
      expect(compiled.success).toBe(true);
    });

    it('should execute compiled JavaScript function', () => {
      const expr = ce.parse('x + y');
      const compiled = compile(expr, { to: 'javascript' });
      expect(compiled.run!({ x: 3, y: 4 })).toBe(7);
    });
  });
});

/**
 * A custom target that has no `Sum` or `Product` of its own gets the generic
 * counted loop (`compileLoop`). A bound with no compile-time value is compiled
 * as an expression of the target and evaluated at run time; it is never
 * replaced with a default number.
 */
describe('GENERIC SUM/PRODUCT LOOP OF A CUSTOM TARGET', () => {
  const loopTarget: CompileTarget = {
    language: 'custom',
    operators: (op) =>
      (
        ({
          Add: ['+', 11],
          Subtract: ['-', 11],
          Multiply: ['*', 12],
        }) as Record<string, [string, number]>
      )[op],
    functions: () => undefined,
    var: (id) => id,
    string: (str) => JSON.stringify(str),
    number: (n) => n.toString(),
    indent: 0,
    ws: () => ' ',
    preamble: '',
  };

  function loopEngine() {
    const { ComputeEngine } = require('../../src/compute-engine');
    const engine = new ComputeEngine();
    engine.declare('n', 'integer');
    engine.declare('m', 'integer');
    engine.declare('x', 'real');
    return engine;
  }

  /**
   * Compile `json` with the custom target, run it with the values of
   * `inputs`, and evaluate it with the interpreter for the same values.
   */
  function runLoop(json: any, inputs: Record<string, number>, declare = {}) {
    const engine = loopEngine();
    for (const [name, type] of Object.entries(declare))
      engine.declare(name, type);
    const result = compile(engine.box(json), {
      target: loopTarget,
      fallback: false,
    });
    expect(result.success).toBe(true);
    const names = Object.keys(inputs);
    const fn = new Function(...names, `return ${result.code};`);
    const expected = engine.box(json).subs(inputs).evaluate().re;
    return { value: fn(...names.map((k) => inputs[k])), expected };
  }

  it('compiles a symbolic upper bound', () => {
    for (const n of [0, 1, 4, 20]) {
      const { value, expected } = runLoop(
        ['Sum', 'j', ['Limits', 'j', 1, 'n']],
        { n }
      );
      expect(value).toBe(expected);
    }
    expect(runLoop(['Sum', 'j', ['Limits', 'j', 1, 'n']], { n: 4 }).value).toBe(
      10
    );
  });

  it('compiles a symbolic lower bound', () => {
    const { value, expected } = runLoop(
      ['Sum', 'j', ['Limits', 'j', 'm', 'n']],
      { n: 4, m: 2 }
    );
    expect(value).toBe(9);
    expect(value).toBe(expected);
  });

  it('compiles an expression bound', () => {
    const sum = runLoop(
      ['Sum', 'j', ['Limits', 'j', ['Add', 'm', 1], ['Multiply', 2, 'n']]],
      { n: 4, m: 2 }
    );
    expect(sum.value).toBe(33);
    expect(sum.value).toBe(sum.expected);
    const product = runLoop(
      ['Product', 'j', ['Limits', 'j', 1, ['Add', 'n', 1]]],
      { n: 4 }
    );
    expect(product.value).toBe(120);
    expect(product.value).toBe(product.expected);
  });

  it('compiles a symbolic bound with a body that writes its index', () => {
    // Each iteration binds `j` to the next value of the counter, whatever the
    // body wrote: 11 + 12 + 13 for n = 3.
    const { value, expected } = runLoop(
      [
        'Sum',
        ['Block', ['Assign', 'j', ['Add', 'j', 10]], 'j'],
        ['Limits', 'j', 1, 'n'],
      ],
      { n: 3 }
    );
    expect(value).toBe(36);
    expect(value).toBe(expected);
  });

  it('reads an outer variable with the name of the index in a bound', () => {
    // The bound `j` is a free variable, not the index: 2 + 3 + 4 + 5.
    const lower = runLoop(
      ['Sum', 'j', ['Limits', 'j', 'j', 5]],
      { j: 2 },
      { j: 'integer' }
    );
    expect(lower.value).toBe(14);
    expect(lower.value).toBe(lower.expected);
    // 1 + 2 + 3 + 4 for an upper bound j + 2 with j = 2.
    const upper = runLoop(
      ['Sum', 'j', ['Limits', 'j', 1, ['Add', 'j', 2]]],
      { j: 2 },
      { j: 'integer' }
    );
    expect(upper.value).toBe(10);
    expect(upper.value).toBe(upper.expected);
  });

  it('compiles a big operator with no indexing set', () => {
    // A scalar operand is its own sum and product.
    for (const op of ['Sum', 'Product']) {
      const { value, expected } = runLoop([op, 'x'], { x: 2.5 });
      expect(value).toBe(2.5);
      expect(value).toBe(expected);
    }
    // A list of numbers is reduced.
    const engine = loopEngine();
    engine.declare('L', 'list<integer>');
    const result = compile(engine.box(['Sum', 'L']), {
      target: loopTarget,
      fallback: false,
    });
    expect(result.success).toBe(true);
    const value = new Function('L', `return ${result.code};`)([1, 2, 3]);
    engine.assign('L', engine.box(['List', 1, 2, 3]));
    expect(value).toBe(6);
    expect(value).toBe(engine.box(['Sum', 'L']).evaluate().re);
  });

  it('keeps the precedence of a scalar operand with no indexing set', () => {
    // `2 * Sum(x + 1)` is `2 * (x + 1)`, not `2 * x + 1`.
    for (const op of ['Sum', 'Product']) {
      const { value, expected } = runLoop(
        ['Multiply', 2, [op, ['Add', 'x', 1]]],
        { x: 2.5 }
      );
      expect(value).toBe(7);
      expect(value).toBe(expected);
    }
  });

  it('folds a list with no indexing set only when its elements are real', () => {
    const engine = loopEngine();
    engine.declare('C', 'list<complex>');
    expect(() =>
      compile(engine.box(['Sum', 'C']), { target: loopTarget, fallback: false })
    ).toThrow(/elements have the type `complex`/);
    engine.declare('R', 'list<real>');
    const result = compile(engine.box(['Sum', 'R']), {
      target: loopTarget,
      fallback: false,
    });
    expect(result.success).toBe(true);
    const value = new Function('R', `return ${result.code};`)([1.5, 2]);
    engine.assign('R', engine.box(['List', 1.5, 2]));
    expect(value).toBe(3.5);
    expect(value).toBe(engine.box(['Sum', 'R']).evaluate().re);
  });

  it('reads the global `Number` with an index named `Number`', () => {
    // The safe-integer test of the symbolic bound runs before the index
    // `Number` is declared.
    const { value, expected } = runLoop(
      ['Sum', 'Number', ['Limits', 'Number', 1, 'n']],
      { n: 4 }
    );
    expect(value).toBe(10);
    expect(value).toBe(expected);
  });

  it('reads a bound that the target maps to the name of the index', () => {
    // The target emits the input `n` as `j`, the name of the index. The bound
    // is evaluated before the index is declared, inside the loop body.
    const mapped: CompileTarget = {
      ...loopTarget,
      var: (id) => (id === 'n' ? 'j' : id),
    };
    for (const [json, expected] of [
      [['Sum', 'j', ['Limits', 'j', 1, 'n']], 10],
      [['Sum', 'j', ['Limits', 'j', 'n', 5]], 9],
    ] as const) {
      const engine = loopEngine();
      const result = compile(engine.box(json), {
        target: mapped,
        fallback: false,
      });
      expect(result.success).toBe(true);
      const value = new Function('j', `return ${result.code};`)(4);
      expect(value).toBe(expected);
      expect(value).toBe(engine.box(json).subs({ n: 4 }).evaluate().re);
    }
  });

  it('gives an index named like a JavaScript global a fresh name', () => {
    // Declared as `let Number`, the outer index would hide the global
    // `Number` for the inner loop's `Number.isSafeInteger` test.
    const nested = runLoop(
      ['Sum', ['Sum', 'k', ['Limits', 'k', 1, 'n']], ['Limits', 'Number', 1, 3]],
      { n: 2 }
    );
    expect(nested.value).toBe(9);
    expect(nested.value).toBe(nested.expected);
    // Constant bounds: the index `Math` is a loop variable, not the global.
    const constant = runLoop(
      ['Sum', ['Multiply', 'Math', 'x'], ['Limits', 'Math', 1, 3]],
      { x: 0.5 }
    );
    expect(constant.value).toBe(3);
    expect(constant.value).toBe(constant.expected);
    // An outer index `Math` around an inner loop with a run-time bound.
    const outerMath = runLoop(
      [
        'Sum',
        ['Multiply', 'Math', ['Sum', 'k', ['Limits', 'k', 1, 'n']]],
        ['Limits', 'Math', 1, 3],
      ],
      { n: 2 }
    );
    expect(outerMath.value).toBe(18);
    expect(outerMath.value).toBe(outerMath.expected);
  });

  it('declines a big operator with no indexing set over a nested list', () => {
    // The interpreter adds the rows element-wise ([[0, 1], [2, 3]] gives
    // [2, 4]); the scalar reduction would not.
    const engine = loopEngine();
    engine.declare('M', 'list<list<integer>>');
    expect(() =>
      compile(engine.box(['Sum', 'M']), { target: loopTarget, fallback: false })
    ).toThrow(/list<list<integer>>/);
  });

  it('answers NaN for a run-time bound that is not a safe integer', () => {
    // Above 2^53 − 1 the counter does not advance; the loop must not hang.
    // The JavaScript target's loop answers NaN for the same bounds.
    const big = 2 ** 53;
    expect(
      runLoop(['Sum', 'j', ['Limits', 'j', 'n', 'n']], { n: big }).value
    ).toBeNaN();
    expect(
      runLoop(['Sum', 'j', ['Limits', 'j', 1, 'n']], { n: big }).value
    ).toBeNaN();
    // The early return leaves only the loop function, so the enclosing
    // expression gives NaN too.
    expect(
      runLoop(['Add', 1, ['Sum', 'j', ['Limits', 'j', 1, 'n']]], { n: big })
        .value
    ).toBeNaN();
  });

  it('declines a bound it cannot compile as a loop bound', () => {
    const engine = loopEngine();
    for (const [json, reason] of [
      [['Sum', 'j', ['Limits', 'j', 1, 'x']], /type `real`/],
      [['Sum', 'j', ['Limits', 'j', 1, 'PositiveInfinity']], /not a finite/],
      // The interpreter leaves a big operator over an impure bound
      // unevaluated.
      [
        ['Sum', 'j', ['Limits', 'j', 1, ['Random', ['Range', 2, 3]]]],
        /upper bound .* is not pure/,
      ],
      [
        ['Sum', 'j', ['Limits', 'j', ['Random', ['Range', 2, 3]], 5]],
        /lower bound .* is not pure/,
      ],
    ] as const) {
      expect(() =>
        compile(engine.box(json), { target: loopTarget, fallback: false })
      ).toThrow(reason);
    }
    for (const limits of [
      ['Limits', 'j', 1, ['Random', ['Range', 2, 3]]],
      ['Limits', 'j', ['Random', ['Range', 2, 3]], 5],
    ])
      expect(engine.box(['Sum', 'j', limits]).evaluate().operator).toBe('Sum');
  });
});
