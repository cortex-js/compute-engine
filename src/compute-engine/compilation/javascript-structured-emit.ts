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
 * - Each operation is written once. A literal has no evaluation: its text is
 *   written at each use.
 * - The value of an operation is written at its use, as a part of the
 *   expression of the use, when all of these are true: the operation is
 *   `pure`; the value has exactly one use; that use is in the region of the
 *   definition, not in a nested region; every operation between the
 *   definition and the use is `pure`. The evaluation of the value then moves
 *   from its definition to its use, and only across pure operations, so no
 *   effect changes its order. A read of an input is `pure`: compiled code
 *   treats an input as a value, and the order and the number of the reads of
 *   a getter of the vars object are unspecified. Neither the entry check of
 *   `run()` nor `rawCall` makes a snapshot of the vars object, so a getter
 *   runs at each read that the code makes.
 * - Every other value binds a `const` (or a `let` for an `if`, an `and` and
 *   an `or` written as statements) at the position of its operation. An
 *   operation whose effect is `effectful` or `unknown` is always such a
 *   statement, so the statements keep the order of the effects of the
 *   program.
 * - A value that the code reads twice (an operand of a complex sum, whose
 *   text is written once per component) counts as two uses, so it is
 *   evaluated once, into a `const`.
 * - A region whose statements are all written into its value is one
 *   expression. An `if` whose two regions are expressions is the conditional
 *   operator `c ? a : b`, and an `and` or an `or` whose regions after the
 *   first operand are expressions is `&&` or `||`: JavaScript evaluates a
 *   branch or an operand only when it is selected, as the program does.
 *   Otherwise the `if` is an `if` statement, and the `and` or `or` a chain
 *   of `if` statements, with a block for each region.
 * - Parentheses come from the precedence of the JavaScript operators. A
 *   negative number literal, `-0` and `-Infinity` have the precedence of a
 *   unary minus. The operand of a unary minus is in parentheses unless it is
 *   a name, a literal that is not negative, or a call, so that `-(-x)` and
 *   `-(-1)` are never `--x` and `--1`. The operands after
 *   the first of a left-associative operator are in parentheses when their
 *   precedence is the same: `a + (b + c)` keeps the order of a floating-point
 *   sum.
 * - A conversion is written where its operation is, in its region.
 * - A helper is one JavaScript function, called with values. Its body reads
 *   only its parameters.
 * - Numbers are JavaScript numbers and complex numbers are `{re, im}`
 *   objects, as in the existing emitter. A complex sum is written per
 *   component and a complex negation calls the runtime helper `_SYS.cneg`,
 *   as the existing emitter does. An object literal is in parentheses, so
 *   that it is never read as a block.
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
 * The precedence of the JavaScript operators that the emitter writes, from
 * the loosest to the tightest. `ATOM` is a name, a literal, or an
 * expression in parentheses.
 */
const CONDITIONAL = 2;
const OR = 3;
const AND = 4;
const EQUALITY = 8;
const RELATIONAL = 9;
const ADDITIVE = 11;
const MULTIPLICATIVE = 12;
const UNARY = 14;
const CALL = 17;
const ATOM = 20;

/** The text of an expression and the precedence of its outermost
 *  operator. */
type Source = { readonly text: string; readonly precedence: number };

const atom = (text: string): Source => ({ text, precedence: ATOM });

/** The text of `source` as an operand that needs at least the precedence
 *  `min`. */
function operand(source: Source, min: number): string {
  return source.precedence >= min ? source.text : `(${source.text})`;
}

/** The operands of a left-associative operator of precedence `p`: the first
 *  at `p`, the others above it. */
function leftAssociative(operands: readonly Source[], p: number, symbol: string): Source {
  return {
    text: operands.map((s, i) => operand(s, i === 0 ? p : p + 1)).join(` ${symbol} `),
    precedence: p,
  };
}

/**
 * The source of the number `n`. JavaScript reads a negative number, `-0` and
 * `-Infinity` as a unary minus applied to a literal, so they have the
 * precedence of a unary operator: `x + -1`, `-1 * x`, and `-(-1)`.
 */
function numberSource(n: number): Source {
  if (Number.isNaN(n)) return atom('NaN');
  const text = Object.is(n, -0) ? '-0' : n === -Infinity ? '-Infinity' : String(n);
  return text.startsWith('-') ? { text, precedence: UNARY } : atom(text);
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
  const value = emitter.region(program.root, statements, true).text;
  return {
    definitions,
    statements,
    value,
    inputs: emitter.inputs,
    runtime: emitter.runtime,
  };
}

/** The regions that `op` evaluates. */
function regionsOf(op: IROperation): readonly IRRegion[] {
  if (op.kind === 'if') return [op.then, op.else];
  if (op.kind === 'and' || op.kind === 'or') return op.rest;
  return [];
}

/** Where a value is used: the number of reads that the code makes of it,
 *  and the region and the position of its last use. */
type Use = { count: number; region: IRRegion; index: number };

/** The uses of each value of `program`, by its id. */
function usesOf(program: IRProgram): Map<number, Use> {
  const uses = new Map<number, Use>();
  const visit = (region: IRRegion) => {
    region.operations.forEach((op, index) => {
      // The text of an operand of a complex sum is written twice, once per
      // component.
      const reads = op.kind === 'add' && op.result.representation === 'complex' ? 2 : 1;
      for (const value of op.operands) {
        const use = uses.get(value.id);
        if (use === undefined) uses.set(value.id, { count: reads, region, index });
        else {
          use.count += reads;
          use.region = region;
          use.index = index;
        }
      }
      for (const inner of regionsOf(op)) visit(inner);
    });
  };
  for (const fn of program.functions) visit(fn.body);
  visit(program.root);
  return uses;
}

class Emitter {
  /** The source of each value, by its id: a name, the text of a literal, or
   *  the expression of a value written at its use. */
  private readonly sources = new Map<number, Source>();
  /** The name of the JavaScript function of each helper, by its index. */
  private readonly functionNames: string[] = [];
  private readonly uses: Map<number, Use>;
  readonly inputs = new Set<string>();
  readonly runtime = new Set<string>();

  constructor(
    private readonly program: IRProgram,
    private readonly names: StructuredEmitNames,
    private readonly options: StructuredEmitOptions
  ) {
    this.uses = usesOf(program);
  }

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
      `return ${value.text};`,
    ].join(' ')} }`;
  }

  /**
   * Append the statements of `region` to `out` and return the source of the
   * value that it yields. `readsInputs` is false in the body of a helper.
   */
  region(region: IRRegion, out: string[], readsInputs: boolean): Source {
    const operations = region.operations;
    // `impure[k]`: the number of operations before position `k` that are
    // not `pure`.
    const impure = [0];
    for (const op of operations)
      impure.push(impure[impure.length - 1] + (op.effect === 'pure' ? 0 : 1));
    for (const [index, op] of operations.entries()) {
      if (op.kind === 'yield') return this.source(op.operands[0]);
      const code = this.operation(op, out, readsInputs);
      if (code === undefined) continue;
      if (this.writtenAtUse(op, region, index, impure)) this.define(op.result!, code);
      else out.push(`const ${this.bind(op.result!)} = ${code.text};`);
    }
    return fail('a region has no yield');
  }

  /**
   * True when the value of `op`, at the position `index` of `region`, is
   * written at its use: `op` is pure, its value has one use, in `region`,
   * and every operation between the two is pure.
   */
  private writtenAtUse(
    op: IROperation,
    region: IRRegion,
    index: number,
    impure: readonly number[]
  ): boolean {
    if (op.effect !== 'pure' || op.result === undefined) return false;
    const use = this.uses.get(op.result.id);
    if (use === undefined || use.count !== 1 || use.region !== region) return false;
    return impure[use.index] - impure[index + 1] === 0;
  }

  /** A fresh name for `value`. */
  private bind(value: IRValue): string {
    const name = this.names.fresh();
    this.define(value, atom(name));
    return name;
  }

  private define(value: IRValue, source: Source): void {
    if (this.sources.has(value.id)) fail(`the value ${value.id} is defined twice`);
    this.sources.set(value.id, source);
  }

  private source(value: IRValue): Source {
    const source = this.sources.get(value.id);
    if (source === undefined) return fail(`the value ${value.id} has no source`);
    return source;
  }

  /**
   * The expression of the value of `op`, which `region()` writes at its use
   * or binds to a `const`. Undefined when `op` defines the source of its
   * value itself: a literal, and an `if`, `and` or `or` written as
   * statements in `out`.
   */
  private operation(
    op: IROperation,
    out: string[],
    readsInputs: boolean
  ): Source | undefined {
    const operands = op.operands.map((v) => this.source(v));
    const call = (fn: string, args: readonly Source[]): Source => ({
      text: `${fn}(${args.map((a) => operand(a, CONDITIONAL)).join(', ')})`,
      precedence: CALL,
    });
    switch (op.kind) {
      case 'literal': {
        const value = op.value;
        this.define(
          op.result,
          typeof value === 'boolean'
            ? atom(String(value))
            : typeof value === 'number'
              ? numberSource(value)
              : atom(
                  `({ re: ${numberSource(value.re).text}, im: ${numberSource(value.im).text} })`
                )
        );
        return undefined;
      }
      case 'input': {
        if (!readsInputs) fail('the body of a helper reads an input');
        const input = this.program.inputs[op.input];
        if (input === undefined) fail(`no input ${op.input}`);
        this.inputs.add(input.name);
        return atom(this.names.input(input.name));
      }
      case 'add': {
        if (op.result.representation !== 'complex')
          return leftAssociative(operands, ADDITIVE, '+');
        const part = (p: 're' | 'im') =>
          operands.map((a) => `${operand(a, CALL)}.${p}`).join(' + ');
        return atom(`({ re: ${part('re')}, im: ${part('im')} })`);
      }
      case 'negate':
        if (op.result.representation !== 'complex')
          return { text: `-${operand(operands[0], CALL)}`, precedence: UNARY };
        this.runtime.add('cneg');
        return call('_SYS.cneg', operands);
      case 'multiply':
        return leftAssociative(operands, MULTIPLICATIVE, '*');
      case 'less':
        return leftAssociative(operands, RELATIONAL, '<');
      case 'equal':
        return leftAssociative(operands, EQUALITY, '===');
      case 'min':
        return call('Math.min', operands);
      case 'max':
        return call('Math.max', operands);
      case 'convert':
        return atom(`({ re: ${operand(operands[0], CONDITIONAL)}, im: 0 })`);
      case 'if': {
        const thenStatements: string[] = [];
        const thenValue = this.region(op.then, thenStatements, readsInputs);
        const elseStatements: string[] = [];
        const elseValue = this.region(op.else, elseStatements, readsInputs);
        if (thenStatements.length === 0 && elseStatements.length === 0)
          return {
            text: `${operand(operands[0], OR)} ? ${operand(thenValue, CONDITIONAL)} : ${operand(elseValue, CONDITIONAL)}`,
            precedence: CONDITIONAL,
          };
        const name = this.bind(op.result);
        const block = (statements: string[], value: Source) =>
          `{ ${[...statements, `${name} = ${value.text};`].join(' ')} }`;
        out.push(
          `let ${name}; if (${operands[0].text}) ${block(thenStatements, thenValue)} else ${block(elseStatements, elseValue)}`
        );
        return undefined;
      }
      case 'and':
      case 'or': {
        const regions = op.rest.map((region) => {
          const statements: string[] = [];
          const value = this.region(region, statements, readsInputs);
          return { statements, value };
        });
        if (regions.every((r) => r.statements.length === 0))
          return leftAssociative(
            [operands[0], ...regions.map((r) => r.value)],
            op.kind === 'and' ? AND : OR,
            op.kind === 'and' ? '&&' : '||'
          );
        // `let t = a; if (t) { …; t = b; if (t) { …; t = c; } }` for `and`,
        // with `!t` for `or`: each region runs only when the operands before
        // it do not decide the result.
        const name = this.bind(op.result);
        const test = op.kind === 'and' ? name : `!${name}`;
        const chain = (i: number): string[] => {
          if (i === regions.length) return [];
          const { statements, value } = regions[i];
          return [
            `if (${test}) { ${[...statements, `${name} = ${value.text};`, ...chain(i + 1)].join(' ')} }`,
          ];
        };
        out.push(`let ${name} = ${operands[0].text};`, ...chain(0));
        return undefined;
      }
      case 'call': {
        const fn = this.functionNames[op.function];
        if (fn === undefined) return fail(`no function ${op.function}`);
        return call(fn, operands);
      }
      case 'trace': {
        const trace = this.options.trace;
        if (trace === undefined)
          return fail('a trace operation, and no trace source');
        // The source of the test operation is a call.
        const args = operands.map((a) => operand(a, CONDITIONAL));
        return { text: trace(op.trace, args), precedence: CALL };
      }
      default:
        return fail(`no emission for the operation ${(op as { kind: string }).kind}`);
    }
  }
}
