import { engine as ce } from '../utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { LanguageTarget, CompileTarget, CompiledOperators, CompiledFunctions, CompilationResult } from '../../src/compute-engine/compilation/types';
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

  compile(
    expr: Expression,
    options: any = {}
  ): CompilationResult {
    const { BaseCompiler } = require('../../src/compute-engine/compilation/base-compiler');
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
      Subtract: (args, compile) => compile(args[0]) + ' ' + compile(args[1]) + ' -',
      Multiply: (args, compile) => args.map(compile).join(' ') + ' *',
      Divide: (args, compile) => compile(args[0]) + ' ' + compile(args[1]) + ' /',
      Power: (args, compile) => compile(args[0]) + ' ' + compile(args[1]) + ' **',
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
    const { BaseCompiler } = require('../../src/compute-engine/compilation/base-compiler');
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
      const jsTarget = ce.getCompilationTarget('javascript');
      expect(jsTarget).toBeDefined();

      // GLSL should be registered
      const glslTarget = ce.getCompilationTarget('glsl');
      expect(glslTarget).toBeDefined();

      // Interval targets should be registered
      const intervalJSTarget = ce.getCompilationTarget('interval-js');
      expect(intervalJSTarget).toBeDefined();

      const intervalGLSLTarget = ce.getCompilationTarget('interval-glsl');
      expect(intervalGLSLTarget).toBeDefined();
    });

    it('should list all default targets', () => {
      const targets = ce.listCompilationTargets();
      expect(targets).toContain('javascript');
      expect(targets).toContain('glsl');
      expect(targets).toContain('interval-js');
      expect(targets).toContain('interval-glsl');
    });

    it('should allow registering custom targets', () => {
      const pythonTarget = new PythonTarget();
      ce.registerCompilationTarget('python', pythonTarget);

      const registered = ce.getCompilationTarget('python');
      expect(registered).toBe(pythonTarget);

      // Should appear in list
      expect(ce.listCompilationTargets()).toContain('python');
    });

    it('should allow overriding existing targets', () => {
      const customJSTarget = new PythonTarget(); // Just for testing override
      ce.registerCompilationTarget('javascript', customJSTarget);

      const registered = ce.getCompilationTarget('javascript');
      expect(registered).toBe(customJSTarget);

      // Restore default
      const { JavaScriptTarget } = require('../../src/compute-engine/compilation/javascript-target');
      ce.registerCompilationTarget('javascript', new JavaScriptTarget());
    });

    it('should return undefined for unregistered target', () => {
      expect(ce.getCompilationTarget('nonexistent')).toBeUndefined();
    });

    it('should unregister a target', () => {
      ce.registerCompilationTarget('temp-target', new PythonTarget());
      expect(ce.getCompilationTarget('temp-target')).toBeDefined();
      expect(ce.listCompilationTargets()).toContain('temp-target');

      ce.unregisterCompilationTarget('temp-target');
      expect(ce.getCompilationTarget('temp-target')).toBeUndefined();
      expect(ce.listCompilationTargets()).not.toContain('temp-target');
    });

    it('should throw when compiling with an unregistered target', () => {
      ce.registerCompilationTarget('removable', new PythonTarget());
      ce.unregisterCompilationTarget('removable');

      const expr = ce.parse('x + y');
      expect(() => {
        compile(expr, { to: 'removable', fallback: false });
      }).toThrow(/not registered/);
    });
  });

  describe('Compiling with Custom Targets', () => {
    beforeAll(() => {
      ce.registerCompilationTarget('python', new PythonTarget());
      ce.registerCompilationTarget('rpn', new RPNTarget());
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
        operators: (op) => op === 'Add' ? ['⊕', 10] : undefined,
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
      expect(compiled.code).toMatchInlineSnapshot(`sin(x)`);
    });

    it('should compile GLSL vectors', () => {
      const expr = ce.box(['List', 1, 2, 3]);
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
