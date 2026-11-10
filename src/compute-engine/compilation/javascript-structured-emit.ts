/**
 * The emitter of the structured representation of the internal scalar
 * JavaScript fragment target (`javascript-structured-ir.ts`): from a
 * verified program to JavaScript statements, a final value, function
 * definitions and the dependencies of that code.
 *
 * The emitter reads only the program. It does not read an expression, a
 * type of the engine or a fact of the compiler, and it calls no part of the
 * existing emitter. The assembly of the result (`compileToTarget()` in
 * `javascript-target.ts`) gives the names: the source of a read of each
 * input and a fresh name for each local.
 *
 * Rules:
 *
 * - Each operation is written once, in the order of its region. Each
 *   operation that is not a literal binds its value to a `const` (or a `let`
 *   for an `if`, an `and` and an `or`), so the order of the statements is the
 *   order of the program, also for a read of an input, which a getter of the
 *   vars object can observe. A literal has no evaluation: its text is written
 *   at each use.
 * - A region is a block. The block of a branch of an `if`, and the block of
 *   each region of an `and` or an `or` after the first operand, run only when
 *   they are selected, as the JavaScript `if` statement selects them.
 * - A conversion is written where its operation is, in its region.
 * - A helper is one JavaScript function, called with values. Its body reads
 *   only its parameters.
 * - Numbers are JavaScript numbers and complex numbers are `{re, im}`
 *   objects, as in the existing emitter. A complex sum is written per
 *   component and a complex negation calls the runtime helper `_SYS.cneg`,
 *   as the existing emitter does.
 *
 * The design is `docs/plans/2026-11-09-js-structured-scalar-emitter.md`,
 * "Integration with existing JavaScript compilation".
 */
import type {
  IRFunction,
  IROperation,
  IRProgram,
  IRRegion,
  IRValue,
} from './javascript-structured-ir.js';

/** The names that the assembly of the result gives to the emitter. */
export type StructuredEmitNames = {
  /** The source of a read of the input `name` of the program. */
  readonly input: (name: string) => string;
  /** A name that no other name of the compilation uses. */
  readonly fresh: () => string;
};

export type StructuredEmitOptions = {
  /**
   * For tests only: the source of the operation that exists only for tests,
   * from its trace id and the sources of its operands. Without it, a
   * program with such an operation throws.
   */
  readonly trace?: (id: string, operands: readonly string[]) => string;
};

/** The code of a program. */
export type StructuredEmission = {
  /** One JavaScript function per helper, in the order of the program. Each
   *  reads only its parameters. */
  readonly definitions: readonly string[];
  /** The statements of the root region, in order. */
  readonly statements: readonly string[];
  /** The source of the value of the program, after the statements. */
  readonly value: string;
  /** The names of the inputs that the statements read. */
  readonly inputs: ReadonlySet<string>;
  /** The helpers of the runtime object `_SYS` that the code calls. */
  readonly runtime: ReadonlySet<string>;
};

const fail = (message: string): never => {
  throw new Error(`JS structured emission: ${message}`);
};

/**
 * The source of the number `n`. A negative number, `-0` and `-Infinity` are
 * in parentheses, so that the text is an operand of any operator.
 */
function numberSource(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (Object.is(n, -0)) return '(-0)';
  if (n === Infinity) return 'Infinity';
  if (n === -Infinity) return '(-Infinity)';
  return n < 0 ? `(${String(n)})` : String(n);
}

/** Write the code of `program`, which `verifyProgram()` accepted. */
export function emitStructuredProgram(
  program: IRProgram,
  names: StructuredEmitNames,
  options: StructuredEmitOptions = {}
): StructuredEmission {
  const emitter = new Emitter(program, names, options);
  const definitions = program.functions.map((fn, i) => emitter.definition(fn, i));
  const statements: string[] = [];
  const value = emitter.region(program.root, statements, true);
  return {
    definitions,
    statements,
    value,
    inputs: emitter.inputs,
    runtime: emitter.runtime,
  };
}

class Emitter {
  /** The source of each value, by its id: a name, or the text of a
   *  literal. */
  private readonly sources = new Map<number, string>();
  /** The name of the JavaScript function of each helper, by its index. */
  private readonly functionNames: string[] = [];
  readonly inputs = new Set<string>();
  readonly runtime = new Set<string>();

  constructor(
    private readonly program: IRProgram,
    private readonly names: StructuredEmitNames,
    private readonly options: StructuredEmitOptions
  ) {}

  /**
   * The JavaScript function of the helper of index `index`. The names of all
   * the helpers are given before any body is written, so that a body can
   * call a helper of a higher index, or its own helper: a function
   * declaration is hoisted.
   */
  definition(fn: IRFunction, index: number): string {
    if (this.functionNames.length === 0)
      this.functionNames.push(
        ...this.program.functions.map(() => this.names.fresh())
      );
    const name = this.functionNames[index];
    const parameters = fn.parameters.map((p) => this.bind(p));
    const statements: string[] = [];
    const value = this.region(fn.body, statements, false);
    return `function ${name}(${parameters.join(', ')}) { ${[
      ...statements,
      `return ${value};`,
    ].join(' ')} }`;
  }

  /**
   * Append the statements of `region` to `out` and return the source of the
   * value that it yields. `readsInputs` is false in the body of a helper.
   */
  region(region: IRRegion, out: string[], readsInputs: boolean): string {
    for (const op of region.operations) {
      if (op.kind === 'yield') return this.source(op.operands[0]);
      this.operation(op, out, readsInputs);
    }
    return fail('a region has no yield');
  }

  /** A fresh name for `value`. */
  private bind(value: IRValue): string {
    if (this.sources.has(value.id)) fail(`the value ${value.id} is defined twice`);
    const name = this.names.fresh();
    this.sources.set(value.id, name);
    return name;
  }

  private source(value: IRValue): string {
    const source = this.sources.get(value.id);
    if (source === undefined) return fail(`the value ${value.id} has no source`);
    return source;
  }

  /** `const <name> = <code>;` for the result of `op`. */
  private constant(op: IROperation, code: string, out: string[]): void {
    out.push(`const ${this.bind(op.result!)} = ${code};`);
  }

  private operation(op: IROperation, out: string[], readsInputs: boolean): void {
    const operands = op.operands.map((v) => this.source(v));
    switch (op.kind) {
      case 'literal': {
        const value = op.value;
        const text =
          typeof value === 'boolean'
            ? String(value)
            : typeof value === 'number'
              ? numberSource(value)
              : `({ re: ${numberSource(value.re)}, im: ${numberSource(value.im)} })`;
        if (this.sources.has(op.result.id))
          fail(`the value ${op.result.id} is defined twice`);
        this.sources.set(op.result.id, text);
        return;
      }
      case 'input': {
        if (!readsInputs) fail('the body of a helper reads an input');
        const input = this.program.inputs[op.input];
        if (input === undefined) fail(`no input ${op.input}`);
        this.inputs.add(input.name);
        return this.constant(op, this.names.input(input.name), out);
      }
      case 'add':
        if (op.result.representation === 'complex')
          return this.constant(
            op,
            `{ re: ${operands.map((a) => `${a}.re`).join(' + ')}, im: ${operands
              .map((a) => `${a}.im`)
              .join(' + ')} }`,
            out
          );
        return this.constant(op, operands.join(' + '), out);
      case 'negate':
        if (op.result.representation === 'complex') {
          this.runtime.add('cneg');
          return this.constant(op, `_SYS.cneg(${operands[0]})`, out);
        }
        return this.constant(op, `-${operands[0]}`, out);
      case 'multiply':
        return this.constant(op, operands.join(' * '), out);
      case 'less':
        return this.constant(op, `${operands[0]} < ${operands[1]}`, out);
      case 'equal':
        return this.constant(op, `${operands[0]} === ${operands[1]}`, out);
      case 'min':
        return this.constant(op, `Math.min(${operands.join(', ')})`, out);
      case 'max':
        return this.constant(op, `Math.max(${operands.join(', ')})`, out);
      case 'convert':
        return this.constant(op, `{ re: ${operands[0]}, im: 0 }`, out);
      case 'if': {
        const name = this.bind(op.result);
        const branch = (region: IRRegion) => {
          const inner: string[] = [];
          const value = this.region(region, inner, readsInputs);
          return `{ ${[...inner, `${name} = ${value};`].join(' ')} }`;
        };
        out.push(
          `let ${name}; if (${operands[0]}) ${branch(op.then)} else ${branch(op.else)}`
        );
        return;
      }
      case 'and':
      case 'or': {
        // `let t = a; if (t) { …; t = b; if (t) { …; t = c; } }` for `and`,
        // with `!t` for `or`: each region runs only when the operands before
        // it do not decide the result.
        const name = this.bind(op.result);
        const test = op.kind === 'and' ? name : `!${name}`;
        const chain = (i: number): string[] => {
          if (i === op.rest.length) return [];
          const inner: string[] = [];
          const value = this.region(op.rest[i], inner, readsInputs);
          return [
            `if (${test}) { ${[...inner, `${name} = ${value};`, ...chain(i + 1)].join(' ')} }`,
          ];
        };
        out.push(`let ${name} = ${operands[0]};`, ...chain(0));
        return;
      }
      case 'call': {
        const fn = this.functionNames[op.function];
        if (fn === undefined) return fail(`no function ${op.function}`);
        return this.constant(op, `${fn}(${operands.join(', ')})`, out);
      }
      case 'trace': {
        const trace = this.options.trace;
        if (trace === undefined)
          return fail('a trace operation, and no trace source');
        return this.constant(op, trace(op.trace, operands), out);
      }
      default:
        return fail(`no emission for the operation ${(op as { kind: string }).kind}`);
    }
  }
}
