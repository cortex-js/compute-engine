import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { applyRule } from '../../src/compute-engine/boxed-expression/rules';
import type {
  CompileTarget,
  CompiledFunctions,
  CompiledOperators,
  CompilationResult,
  LanguageTarget,
} from '../../src/compute-engine/compilation/types';
import type {
  Expression,
  LibraryDefinition,
} from '../../src/compute-engine/global-types';

class ContractTarget implements LanguageTarget<Expression> {
  getOperators(): CompiledOperators {
    return { Add: ['+', 11] };
  }

  getFunctions(): CompiledFunctions<Expression> {
    return {};
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    const ops = this.getOperators();
    const fns = this.getFunctions();
    return {
      language: 'contract',
      operators: (op) => ops[op],
      functions: (id) => fns[id],
      var: (id) => id,
      string: (str) => JSON.stringify(str),
      number: (n) => n.toString(),
      ws: (s?: string) => s ?? '',
      preamble: '',
      indent: 0,
      ...options,
    };
  }

  compile(expr: Expression): CompilationResult {
    const {
      BaseCompiler,
    } = require('../../src/compute-engine/compilation/base-compiler');
    return {
      target: 'contract',
      success: true,
      code: BaseCompiler.compile(expr, this.createTarget()),
    };
  }
}

describe('Extension Contracts', () => {
  describe('Compilation Option Payloads', () => {
    test('rejects malformed operator overrides', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('x + y');

      expect(() =>
        compile(expr, {
          operators: { Add: ['add', '11'] as unknown as [string, number] },
        })
      ).toThrow(/operators\.Add/);
    });

    test('rejects malformed function overrides', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('x + y');

      expect(() =>
        compile(expr, {
          functions: { Add: 42 as unknown as string },
        })
      ).toThrow(/functions\.Add/);
    });

    test('rejects malformed variable bindings', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('x + y');

      expect(() =>
        compile(expr, {
          vars: { x: 1 as unknown as string },
        })
      ).toThrow(/vars\.x/);
    });

    test('rejects malformed imports payload', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('x + y');

      expect(() =>
        compile(expr, {
          imports: 'not-an-array' as unknown as unknown[],
        })
      ).toThrow(/"imports"/);
    });

    test('rejects malformed direct compile target payload', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('x + y');

      const invalidTarget = {
        language: 'broken',
        var: () => 'x',
        string: (s: string) => s,
        number: (n: number) => String(n),
        preamble: '',
        indent: 0,
      } as unknown as CompileTarget<Expression>;

      expect(() => compile(expr, { target: invalidTarget })).toThrow(
        /"ws\(\)"/
      );
    });

    test('accepts well-formed compilation options', () => {
      const ce = new ComputeEngine();
      const expr = ce.parse('x + y');

      const result = compile(expr, {
        operators: { Add: ['add', 11] },
        functions: { add: (a: number, b: number) => a + b },
      });

      expect(result.code).toContain('add');
    });
  });

  describe('Compilation Targets', () => {
    test('rejects invalid target names', () => {
      const ce = new ComputeEngine();
      const target = new ContractTarget();

      expect(() => ce.registerCompilationTarget('', target)).toThrow(
        /must not be empty/
      );
      expect(() => ce.registerCompilationTarget(' python', target)).toThrow(
        /leading or trailing whitespace/
      );
      expect(() =>
        ce.registerCompilationTarget('python plugin', target)
      ).toThrow(/must not include whitespace/);
    });

    test('rejects target objects that do not implement LanguageTarget', () => {
      const ce = new ComputeEngine();
      const invalidTarget = {} as unknown as LanguageTarget<Expression>;

      expect(() =>
        ce.registerCompilationTarget('broken-target', invalidTarget)
      ).toThrow(/missing required method/);
    });

    test('accepts valid targets after contract checks', () => {
      const ce = new ComputeEngine();
      ce.registerCompilationTarget('contract-target', new ContractTarget());

      const expr = ce.parse('x+y');
      const compiled = compile(expr, { to: 'contract-target' });

      expect(compiled.success).toBe(true);
      expect(compiled.code).toContain('+');
    });
  });

  describe('Library Definitions', () => {
    test('rejects non-object custom libraries', () => {
      const invalid = 42 as unknown as LibraryDefinition;
      expect(() => new ComputeEngine({ libraries: ['core', invalid] })).toThrow(
        /Invalid library definition/
      );
    });

    test('rejects malformed custom library fields', () => {
      const invalidName = {
        name: ' custom-lib',
      } as unknown as LibraryDefinition;
      expect(
        () => new ComputeEngine({ libraries: ['core', invalidName] })
      ).toThrow(/leading or trailing whitespace/);

      const invalidRequires = {
        name: 'custom-invalid-requires',
        requires: 'core',
      } as unknown as LibraryDefinition;
      expect(
        () => new ComputeEngine({ libraries: ['core', invalidRequires] })
      ).toThrow(/"requires" must be an array/);

      const invalidDefinitions = {
        name: 'custom-invalid-definitions',
        definitions: 123,
      } as unknown as LibraryDefinition;
      expect(
        () => new ComputeEngine({ libraries: ['core', invalidDefinitions] })
      ).toThrow(/"definitions" must be an object or an array of objects/);

      const invalidDependencyName = {
        name: 'custom-invalid-dependency-name',
        requires: [' core'],
      } as unknown as LibraryDefinition;
      expect(
        () => new ComputeEngine({ libraries: ['core', invalidDependencyName] })
      ).toThrow(/leading or trailing whitespace/);

      const duplicateDependency = {
        name: 'custom-duplicate-dependency',
        requires: ['core', 'core'],
      } as unknown as LibraryDefinition;
      expect(
        () => new ComputeEngine({ libraries: ['core', duplicateDependency] })
      ).toThrow(/duplicate dependency/);
    });

    test('accepts valid custom libraries and loads definitions', () => {
      const ce = new ComputeEngine({
        libraries: [
          'core',
          {
            name: 'custom-constants',
            requires: ['core'],
            definitions: {
              FooConstant: {
                value: 42,
                type: 'integer',
                isConstant: true,
              },
            },
          },
        ],
      });

      expect(ce.symbol('FooConstant').evaluate().toString()).toBe('42');
    });
  });

  describe('Rule Replacement Results', () => {
    test('rejects invalid replacement callback return values', () => {
      const ce = new ComputeEngine();
      // The replace callback is not validated at rule creation time,
      // only when the rule is applied and the callback is invoked.
      // Invalid return values cause the rule application to fail
      // gracefully, returning null.
      const ruleSet = ce.rules([
        {
          match: 'x',
          replace: () => 'not-an-expression' as unknown as Expression,
        },
      ]);
      ce.declare('x', { type: 'integer' });
      ce.assign('x', 1);
      expect(ce.box('x').replace(ruleSet)).toBeNull();
    });
  });
});
