/**
 * Example: Compilation Plugin Architecture
 *
 * This example demonstrates how to register custom compilation targets
 * and use them to compile mathematical expressions to different languages.
 *
 * The plugin architecture allows you to:
 * - Register custom language targets
 * - Compile expressions to multiple target languages
 * - Override default targets
 * - Use direct target overrides without registration
 */

import { ComputeEngine, BaseCompiler } from '../dist/compute-engine.esm.js';

const ce = new ComputeEngine();

console.log('Compilation Plugin Architecture Examples');
console.log('='.repeat(70));
console.log();

// ============================================================================
// Example 1: Using Built-in Targets
// ============================================================================
console.log('Example 1: Built-in Targets (JavaScript and GLSL)');
console.log('-'.repeat(70));

const expr1 = ce.parse('x^2 + y^2');

// Compile to JavaScript (default)
const jsFunc = expr1.compile();
console.log('JavaScript (default):');
console.log('  Code:', jsFunc.toString());
console.log('  Result: f({x: 3, y: 4}) =', jsFunc({ x: 3, y: 4 }));
console.log();

// Compile to JavaScript (explicit)
const jsFunc2 = expr1.compile({ to: 'javascript' });
console.log('JavaScript (explicit):');
console.log('  Code:', jsFunc2.toString());
console.log();

// Compile to GLSL
const glslCode = expr1.compile({ to: 'glsl' });
console.log('GLSL:');
console.log('  Code:', glslCode.toString());
console.log();

// ============================================================================
// Example 2: Registering a Custom Target - Python
// ============================================================================
console.log('Example 2: Custom Python Target');
console.log('-'.repeat(70));

class PythonTarget {
  getOperators() {
    return {
      Add: ['+', 11],
      Subtract: ['-', 11],
      Multiply: ['*', 12],
      Divide: ['/', 13],
      Power: ['**', 14],
    };
  }

  getFunctions() {
    return {
      Sin: 'math.sin',
      Cos: 'math.cos',
      Tan: 'math.tan',
      Sqrt: 'math.sqrt',
      Abs: 'abs',
      Exp: 'math.exp',
      Ln: 'math.log',
      Log: 'math.log10',
      Max: 'max',
      Min: 'min',
    };
  }

  createTarget(options = {}) {
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
      ws: (s) => s ?? '',
      preamble: '',
      ...options,
    };
  }

  compileToExecutable(expr, options = {}) {
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

// Register the Python target
ce.registerCompilationTarget('python', new PythonTarget());

// Compile expressions to Python
const expr2 = ce.parse('\\sin(x) + \\cos(y)');
const pythonCode1 = expr2.compile({ to: 'python' });
console.log('Expression: sin(x) + cos(y)');
console.log('Python:', pythonCode1.toString());
console.log();

const expr3 = ce.parse('x^2 + y^2');
const pythonCode2 = expr3.compile({ to: 'python' });
console.log('Expression: x² + y²');
console.log('Python:', pythonCode2.toString());
console.log();

const expr4 = ce.parse('\\sqrt{a^2 + b^2}');
const pythonCode3 = expr4.compile({ to: 'python' });
console.log('Expression: √(a² + b²)');
console.log('Python:', pythonCode3.toString());
console.log();

// ============================================================================
// Example 3: Registering a Custom Target - RPN (Reverse Polish Notation)
// ============================================================================
console.log('Example 3: Custom RPN (Reverse Polish Notation) Target');
console.log('-'.repeat(70));

class RPNTarget {
  getOperators() {
    // RPN doesn't use infix operators
    return {};
  }

  getFunctions() {
    return {
      Add: (args, compile) => args.map(compile).join(' ') + ' +',
      Subtract: (args, compile) => compile(args[0]) + ' ' + compile(args[1]) + ' -',
      Multiply: (args, compile) => args.map(compile).join(' ') + ' *',
      Divide: (args, compile) => compile(args[0]) + ' ' + compile(args[1]) + ' /',
      Power: (args, compile) => compile(args[0]) + ' ' + compile(args[1]) + ' ^',
      Sin: (args, compile) => compile(args[0]) + ' sin',
      Cos: (args, compile) => compile(args[0]) + ' cos',
      Sqrt: (args, compile) => compile(args[0]) + ' sqrt',
    };
  }

  createTarget(options = {}) {
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

  compileToExecutable(expr, options = {}) {
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

// Register the RPN target
ce.registerCompilationTarget('rpn', new RPNTarget());

// Compile expressions to RPN
const expr5 = ce.parse('x + y');
const rpnCode1 = expr5.compile({ to: 'rpn' });
console.log('Expression: x + y');
console.log('RPN:', rpnCode1.toString());
console.log();

const expr6 = ce.parse('(x + y) * z');
const rpnCode2 = expr6.compile({ to: 'rpn' });
console.log('Expression: (x + y) * z');
console.log('RPN:', rpnCode2.toString());
console.log();

const expr7 = ce.parse('\\sin(x)');
const rpnCode3 = expr7.compile({ to: 'rpn' });
console.log('Expression: sin(x)');
console.log('RPN:', rpnCode3.toString());
console.log();

// ============================================================================
// Example 4: Direct Target Override (No Registration)
// ============================================================================
console.log('Example 4: Direct Target Override');
console.log('-'.repeat(70));

const expr8 = ce.parse('a + b');

// Create a custom target for Forth-like syntax
const forthTarget = {
  language: 'forth',
  operators: (op) => {
    // Map operators to Forth words
    const mapping = {
      Add: ['+', 10],
      Subtract: ['-', 10],
      Multiply: ['*', 11],
      Divide: ['/', 11],
    };
    return mapping[op];
  },
  functions: () => undefined,
  var: (id) => id,
  string: (str) => `"${str}"`,
  number: (n) => n.toString(),
  indent: 0,
  ws: () => ' ',
  preamble: '',
};

const forthCode = expr8.compile({ target: forthTarget });
console.log('Expression: a + b');
console.log('Forth:', forthCode.toString());
console.log();

// ============================================================================
// Example 5: Listing Available Targets
// ============================================================================
console.log('Example 5: Available Compilation Targets');
console.log('-'.repeat(70));

console.log('Registered targets:');
console.log('  - javascript (built-in)');
console.log('  - glsl (built-in)');
console.log('  - python (custom)');
console.log('  - rpn (custom)');
console.log();

// ============================================================================
// Summary
// ============================================================================
console.log('Summary');
console.log('='.repeat(70));
console.log('✓ Used built-in JavaScript and GLSL targets');
console.log('✓ Created and registered Python target');
console.log('✓ Created and registered RPN target');
console.log('✓ Used direct target override for Forth');
console.log();
console.log('Plugin Architecture Features:');
console.log('  • Register custom compilation targets');
console.log('  • Switch between targets with { to: "language" }');
console.log('  • Override targets without registration with { target: ... }');
console.log('  • Extend existing targets with custom operators/functions');
console.log('  • Support for any target language (Python, MATLAB, R, etc.)');
console.log();
