import { engine as ce } from '../utils';
import type { LanguageTarget, CompileTarget, CompiledOperators, CompiledFunctions } from '../../src/compute-engine/compilation/types';
import type { BoxedExpression } from '../../src/compute-engine/global-types';

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

  compileToExecutable(
    expr: BoxedExpression,
    options: any = {}
  ): any {
    const { BaseCompiler } = require('../../src/compute-engine/compilation/base-compiler');
    const target = this.createTarget();
    const pythonCode = BaseCompiler.compile(expr, target);

    const result = function () {
      return pythonCode;
    };
    Object.defineProperty(result, 'toString', { value: () => pythonCode });
    Object.defineProperty(result, 'isCompiled', { value: true });
    return result;
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

  compileToExecutable(expr: BoxedExpression, options: any = {}): any {
    const { BaseCompiler } = require('../../src/compute-engine/compilation/base-compiler');
    const target = this.createTarget();
    const rpnCode = BaseCompiler.compile(expr, target);

    const result = function () {
      return rpnCode;
    };
    Object.defineProperty(result, 'toString', { value: () => rpnCode });
    Object.defineProperty(result, 'isCompiled', { value: true });
    return result;
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
    });

    it('should allow registering custom targets', () => {
      const pythonTarget = new PythonTarget();
      ce.registerCompilationTarget('python', pythonTarget);

      const registered = ce._getCompilationTarget('python');
      expect(registered).toBe(pythonTarget);
    });

    it('should allow overriding existing targets', () => {
      const customJSTarget = new PythonTarget(); // Just for testing override
      ce.registerCompilationTarget('javascript', customJSTarget);

      const registered = ce._getCompilationTarget('javascript');
      expect(registered).toBe(customJSTarget);

      // Restore default
      const { JavaScriptTarget } = require('../../src/compute-engine/compilation/javascript-target');
      ce.registerCompilationTarget('javascript', new JavaScriptTarget());
    });
  });

  describe('Compiling with Custom Targets', () => {
    beforeAll(() => {
      ce.registerCompilationTarget('python', new PythonTarget());
      ce.registerCompilationTarget('rpn', new RPNTarget());
    });

    it('should compile to Python target', () => {
      const expr = ce.parse('x + y');
      const compiled = expr.compile({ to: 'python' });
      expect(compiled.toString()).toMatchInlineSnapshot(`x + y`);
    });

    it('should compile to Python with functions', () => {
      const expr = ce.parse('\\sin(x) + \\cos(y)');
      const compiled = expr.compile({ to: 'python' });
      expect(compiled.toString()).toMatchInlineSnapshot(`math.sin(x) + math.cos(y)`);
    });

    it('should compile to Python with power operator', () => {
      const expr = ce.parse('x^2');
      const compiled = expr.compile({ to: 'python' });
      // Power in Python is **
      expect(compiled.toString()).toMatchInlineSnapshot(`x ** 2`);
    });

    it('should compile to RPN target', () => {
      const expr = ce.parse('x + y');
      const compiled = expr.compile({ to: 'rpn' });
      expect(compiled.toString()).toMatchInlineSnapshot(`x y +`);
    });

    it('should compile complex expression to RPN', () => {
      const expr = ce.parse('(x + y) * z');
      const compiled = expr.compile({ to: 'rpn' });
      // Canonical form may reorder operands: z * (x + y)
      expect(compiled.toString()).toMatchInlineSnapshot(`z x y + *`);
    });

    it('should compile trigonometric to RPN', () => {
      const expr = ce.parse('\\sin(x)');
      const compiled = expr.compile({ to: 'rpn' });
      expect(compiled.toString()).toMatchInlineSnapshot(`x sin`);
    });

    it('should throw error for unregistered target', () => {
      const expr = ce.parse('x + y');
      expect(() => {
        expr.compile({ to: 'matlab', fallback: false });
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

      const compiled = expr.compile({ target: customTarget });
      expect(compiled.toString()).toMatchInlineSnapshot(`VAR_x ⊕ VAR_y`);
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

      const compiled = expr.compile({
        to: 'javascript',
        target: customTarget,
      });

      // Should use custom target, not javascript
      expect(compiled.toString()).toBe('CUSTOM_x');
    });
  });

  describe('GLSL Target via Registry', () => {
    it('should compile to GLSL via registry', () => {
      const expr = ce.parse('x + y');
      const compiled = expr.compile({ to: 'glsl' });
      expect(compiled.toString()).toMatchInlineSnapshot(`x + y`);
    });

    it('should compile GLSL functions', () => {
      const expr = ce.parse('\\sin(x)');
      const compiled = expr.compile({ to: 'glsl' });
      expect(compiled.toString()).toMatchInlineSnapshot(`sin(x)`);
    });

    it('should compile GLSL vectors', () => {
      const expr = ce.box(['List', 1, 2, 3]);
      const compiled = expr.compile({ to: 'glsl' });
      expect(compiled.toString()).toMatchInlineSnapshot(`vec3(1.0, 2.0, 3.0)`);
    });
  });

  describe('JavaScript Target via Registry', () => {
    it('should compile to JavaScript via registry (default)', () => {
      const expr = ce.parse('x + y');
      const compiled = expr.compile();
      expect(typeof compiled).toBe('function');
      expect(compiled.isCompiled).toBe(true);
    });

    it('should compile to JavaScript via registry (explicit)', () => {
      const expr = ce.parse('x + y');
      const compiled = expr.compile({ to: 'javascript' });
      expect(typeof compiled).toBe('function');
      expect(compiled.isCompiled).toBe(true);
    });

    it('should execute compiled JavaScript function', () => {
      const expr = ce.parse('x + y');
      const f = expr.compile({ to: 'javascript' }) as any;
      expect(f({ x: 3, y: 4 })).toBe(7);
    });
  });
});
