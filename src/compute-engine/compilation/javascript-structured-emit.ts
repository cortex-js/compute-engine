/**
 * The emitter of the structured representation of the internal scalar
 * JavaScript fragment target (`structured-ir.ts`): from a
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
 *   Otherwise the `and` or `or` is a chain of `if` statements, with a block
 *   for each region, and the `if` an `if` statement: one `let` per result,
 *   assigned at the end of each branch. An `if` of several results, or of
 *   none (the merged values of locals that branches write), is always an
 *   `if` statement.
 * - Parentheses come from the precedence of the JavaScript operators. A
 *   negative number literal, `-0` and `-Infinity` have the precedence of a
 *   unary minus. The operand of a unary minus is in parentheses unless it is
 *   a name, a literal that is not negative, or a call, so that `-(-x)` and
 *   `-(-1)` are never `--x` and `--1`. The operands after
 *   the first of a left-associative operator are in parentheses when their
 *   precedence is the same: `a + (b + c)` keeps the order of a floating-point
 *   sum.
 * - A `loop` is a `for` statement with one `let` per result, declared
 *   before it with the initial value; the parameter of a carried value in
 *   the body is that variable too. The bounds are read once each before the
 *   first iteration (a bound that is not a name or a literal is bound to a
 *   `const` first, because the code reads its text more than once). The
 *   index is the counter of the `for`, from `from` to `to`, in steps of 1,
 *   or of -1 when `to` is less than `from`. At the end of the body, each
 *   carried variable is assigned its next value; when more than one changes,
 *   each next value that could read a carried variable is first bound to a
 *   `const`, so that every next value reads the values of the iteration
 *   that ends. With an iteration budget, each iteration first calls
 *   `_SYS.countLoopPass()` with the floored budget, as the existing emitter
 *   writes it (`loopPassCount()` in `compile-loops.ts`), and the assembly of
 *   the result starts each call with `_SYS.resetLoopPasses()`. A value of
 *   the body is never written outside it, and a value defined before the
 *   loop that the body uses is a name or a literal (the rule above: its use
 *   is in a nested region).
 * - A conversion is written where its operation is, in its region.
 * - A helper is one JavaScript function declaration, called with values.
 *   Its body reads its parameters and the snapshots of captured bindings,
 *   and can call another helper: a declaration is hoisted, so the order of
 *   the definitions does not matter.
 * - A read of a captured binding is its snapshot, written as a number
 *   literal at each use, as the existing emitter writes the stored value.
 * - Numbers are JavaScript numbers and complex numbers are `{re, im}`
 *   objects, as in the existing emitter. A complex sum is written per
 *   component, a complex negation calls the runtime helper `_SYS.cneg`, a
 *   real square root is `Math.sqrt` and a complex one calls `_SYS.csqrt`,
 *   a complex product is written per component, `mod` calls
 *   `_SYS.floorMod`, `floor` is `Math.floor` and `divide` is `/`, as the
 *   existing emitter does. An object literal is in parentheses, so that it
 *   is never read as a block.
 * - A list is a JavaScript array of numbers. `at` calls the runtime helper
 *   `_SYS.atNumeric(list, index, element type)` and `length` reads
 *   `list.length`, as the existing emitter writes a read of a list input or
 *   parameter (`At` and `Length` in `javascript-target.ts`). The helper
 *   returns the element at an integer index in range, counts a negative
 *   index from the end, returns `NaN` for an index out of range, and throws
 *   when the element is an array. The third argument names the element
 *   type in the message of that throw: the element type that the program
 *   declares for the list input or parameter (`IRInput.elementLabel`), as
 *   the existing emitter writes it.
 *
 * The design is `docs/plans/2026-11-09-js-structured-scalar-emitter.md`,
 * "Integration with existing JavaScript compilation".
 */
import {
  elementOf,
  regionsOf,
  yieldedValues,
  type IRFunction,
  type IRLoop,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRValue,
} from './structured-ir.js';

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
   *  reads its parameters and the snapshots of captured bindings. */
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
  const value = emitter.region(program.root, statements, true)[0].text;
  return {
    definitions,
    statements,
    value,
    inputs: emitter.inputs,
    runtime: emitter.runtime,
  };
}

/** The one value that `op` defines and that `Emitter.operation()` can
 *  write as an expression: an `if` of one result, or the result of any
 *  other operation but a yield. */
function singleResult(op: IROperation): IRValue | undefined {
  if (op.kind === 'if') return op.results.length === 1 ? op.results[0] : undefined;
  return op.result;
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
      // component, and of a complex product four times. The code of a loop
      // reads the text of its upper bound twice.
      const complex = op.result?.representation === 'complex';
      const readsOf = (i: number) =>
        op.kind === 'add' && complex
          ? 2
          : op.kind === 'multiply' && complex
            ? 4
            : op.kind === 'loop' && i === 1
              ? 2
              : 1;
      for (const [i, value] of op.operands.entries()) {
        const reads = readsOf(i);
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
  /** The values whose source is a name that the emitter binds, or a
   *  literal: a source that reads no variable that a loop assigns, other
   *  than its own name. */
  private readonly plain = new Set<number>();
  readonly inputs = new Set<string>();
  readonly runtime = new Set<string>();
  /** The declared element type of each list value that is an input or a
   *  parameter, by its id (`IRInput.elementLabel`). */
  private readonly elementLabels = new Map<number, string>();

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
    fn.parameters.forEach((p, i) => {
      const label = fn.parameterElementLabels?.[i];
      if (label !== undefined) this.elementLabels.set(p.id, label);
    });
    const parameters = fn.parameters.map((p) => this.bind(p));
    const statements: string[] = [];
    const [value] = this.region(fn.body, statements, false);
    return `function ${name}(${parameters.join(', ')}) { ${[
      ...statements,
      `return ${value.text};`,
    ].join(' ')} }`;
  }

  /**
   * Append the statements of `region` to `out` and return the sources of
   * the values that it yields. `readsInputs` is false in the body of a
   * helper.
   */
  region(region: IRRegion, out: string[], readsInputs: boolean): Source[] {
    const operations = region.operations;
    // `impure[k]`: the number of operations before position `k` that are
    // not `pure`.
    const impure = [0];
    for (const op of operations)
      impure.push(impure[impure.length - 1] + (op.effect === 'pure' ? 0 : 1));
    for (const [index, op] of operations.entries()) {
      if (op.kind === 'yield') return op.operands.map((v) => this.source(v));
      const code = this.operation(op, out, readsInputs);
      if (code === undefined) continue;
      const result = singleResult(op)!;
      if (this.writtenAtUse(result, op, region, index, impure)) this.define(result, code);
      else out.push(`const ${this.bind(result)} = ${code.text};`);
    }
    return fail('a region has no yield');
  }

  /**
   * True when the value `result` of `op`, at the position `index` of
   * `region`, is written at its use: `op` is pure, its value has one use,
   * in `region`, and every operation between the two is pure.
   */
  private writtenAtUse(
    result: IRValue,
    op: IROperation,
    region: IRRegion,
    index: number,
    impure: readonly number[]
  ): boolean {
    if (op.effect !== 'pure') return false;
    const use = this.uses.get(result.id);
    if (use === undefined || use.count !== 1 || use.region !== region) return false;
    return impure[use.index] - impure[index + 1] === 0;
  }

  /** A fresh name for `value`. */
  private bind(value: IRValue): string {
    const name = this.names.fresh();
    this.define(value, atom(name));
    this.plain.add(value.id);
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
   * values itself: a literal, and an `if`, `and` or `or` written as
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
        this.plain.add(op.result.id);
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
      case 'capture':
        // The snapshot is written as a number literal at each use, as the
        // existing emitter writes the stored value of a captured binding.
        this.plain.add(op.result.id);
        this.define(op.result, numberSource(op.snapshot));
        return undefined;
      case 'input': {
        if (!readsInputs) fail('the body of a helper reads an input');
        const input = this.program.inputs[op.input];
        if (input === undefined) fail(`no input ${op.input}`);
        this.inputs.add(input.name);
        if (input.elementLabel !== undefined)
          this.elementLabels.set(op.result.id, input.elementLabel);
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
      case 'multiply': {
        if (op.result.representation !== 'complex')
          return leftAssociative(operands, MULTIPLICATIVE, '*');
        // `(a.re b.re - a.im b.im) + i (a.re b.im + a.im b.re)`, the text
        // of the existing emitter.
        const [a, b] = operands.map((o) => operand(o, CALL));
        return atom(
          `({ re: ${a}.re * ${b}.re - ${a}.im * ${b}.im, im: ${a}.re * ${b}.im + ${a}.im * ${b}.re })`
        );
      }
      case 'divide':
        return leftAssociative(operands, MULTIPLICATIVE, '/');
      case 'mod':
        this.runtime.add('floorMod');
        return call('_SYS.floorMod', operands);
      case 'floor':
        return call('Math.floor', operands);
      case 'less':
        return leftAssociative(operands, RELATIONAL, '<');
      case 'less-equal':
        return leftAssociative(operands, RELATIONAL, '<=');
      case 'equal':
        return leftAssociative(operands, EQUALITY, '===');
      case 'sqrt':
        if (op.result.representation !== 'complex')
          return call('Math.sqrt', operands);
        this.runtime.add('csqrt');
        return call('_SYS.csqrt', operands);
      case 'at':
        this.runtime.add('atNumeric');
        return call('_SYS.atNumeric', [
          ...operands,
          atom(
            JSON.stringify(
              this.elementLabels.get(op.operands[0].id) ?? elementOf(op.operands[0].type)
            )
          ),
        ]);
      case 'length':
        return { text: `${operand(operands[0], CALL)}.length`, precedence: CALL };
      case 'min':
        return call('Math.min', operands);
      case 'max':
        return call('Math.max', operands);
      case 'convert':
        return atom(`({ re: ${operand(operands[0], CONDITIONAL)}, im: 0 })`);
      case 'if': {
        const thenStatements: string[] = [];
        const thenValues = this.region(op.then, thenStatements, readsInputs);
        const elseStatements: string[] = [];
        const elseValues = this.region(op.else, elseStatements, readsInputs);
        if (
          op.results.length === 1 &&
          thenStatements.length === 0 &&
          elseStatements.length === 0
        )
          return {
            text: `${operand(operands[0], OR)} ? ${operand(thenValues[0], CONDITIONAL)} : ${operand(elseValues[0], CONDITIONAL)}`,
            precedence: CONDITIONAL,
          };
        // One `let` per result, assigned at the end of each branch.
        const names = op.results.map((result) => this.bind(result));
        const block = (statements: string[], values: readonly Source[]) =>
          `{ ${[...statements, ...names.map((name, i) => `${name} = ${values[i].text};`)].join(' ')} }`;
        const test = `if (${operands[0].text}) ${block(thenStatements, thenValues)}`;
        const otherwise =
          elseStatements.length === 0 && names.length === 0
            ? ''
            : ` else ${block(elseStatements, elseValues)}`;
        out.push(
          names.length === 0
            ? `${test}${otherwise}`
            : `let ${names.join(', ')}; ${test}${otherwise}`
        );
        return undefined;
      }
      case 'loop':
        out.push(...this.loop(op, operands, readsInputs));
        return undefined;
      case 'and':
      case 'or': {
        const regions = op.rest.map((region) => {
          const statements: string[] = [];
          const [value] = this.region(region, statements, readsInputs);
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

  /**
   * The statements of `op`, whose operands have the sources `operands`:
   * the `let` of each carried value, then the `for` statement.
   */
  private loop(op: IRLoop, operands: readonly Source[], readsInputs: boolean): string[] {
    const [from, to, ...initial] = operands;
    const [index, ...parameters] = op.body.parameters ?? [];
    if (index === undefined) return fail('a loop has no index');
    // One variable per carried value: the parameter in the body, the
    // result after the loop.
    const names = op.results.map((result) => this.bind(result));
    parameters.forEach((p, i) => {
      this.define(p, atom(names[i]));
      this.plain.add(p.id);
    });
    const k = this.bind(index);
    const step = this.names.fresh();
    const left = this.names.fresh();
    const body: string[] = [];
    if (op.iterationBudget !== undefined)
      body.push(`_SYS.countLoopPass(${Math.floor(op.iterationBudget)});`);
    const next = this.region(op.body, body, readsInputs);
    // The carried values whose next value is not the parameter itself.
    const changed = parameters.flatMap((_, i) => (next[i].text === names[i] ? [] : [i]));
    // Each next value is read before any carried variable is assigned:
    // the last one is assigned first, and every other one that could read
    // a carried variable is first bound to a `const`.
    const carried = new Set(names);
    const assignments: string[] = [];
    const last = changed[changed.length - 1];
    const later: string[] = [];
    for (const i of changed) {
      if (i === last) {
        assignments.push(`${names[i]} = ${next[i].text};`);
        continue;
      }
      const value = yieldedValues(op.body)[i];
      if (this.plain.has(value.id) && !carried.has(next[i].text)) {
        later.push(`${names[i]} = ${next[i].text};`);
        continue;
      }
      const temporary = this.names.fresh();
      body.push(`const ${temporary} = ${next[i].text};`);
      later.push(`${names[i]} = ${temporary};`);
    }
    body.push(...assignments, ...later);
    const header =
      `for (let ${k} = ${operand(from, CONDITIONAL)}, ` +
      `${step} = ${operand(to, RELATIONAL + 1)} < ${k} ? -1 : 1, ` +
      `${left} = ${step} * (${operand(to, ADDITIVE)} - ${k}); ` +
      `${left} >= 0; ${k} += ${step}, ${left}--)`;
    const declarations =
      names.length === 0
        ? []
        : [`let ${names.map((name, i) => `${name} = ${operand(initial[i], CONDITIONAL)}`).join(', ')};`];
    return [...declarations, `${header} { ${body.join(' ')} }`];
  }
}
