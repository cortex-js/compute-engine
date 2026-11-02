/**
 * The emission of `mode: 'bigint'` on the JavaScript target (CE-715).
 *
 * The lane analysis (`compile-bigint-lane.ts`) has accepted the expression
 * and recorded, for each node, the kind of its value and of its lowering.
 * This module writes the JavaScript code from those records. Every integer
 * of the code is a JavaScript `bigint`: an integer literal is written
 * `123n`, the arithmetic uses the `bigint` operators, and the other heads
 * call the helpers of `bigint-runtime.ts` through `_SYS`.
 *
 * The emitter is separate from the emitters of the double mode, which it
 * does not call: a lowering of the double mode computes with `number`
 * values, and a `number` that meets a `bigint` is a `TypeError` at run time.
 * The code of the double mode does not change.
 *
 * The emitter writes no type guard: the analysis has proved the type of
 * every node, so a run-time test such as `Number.isInteger(x)` is never
 * needed. (`isIntegerValue` of the runtime is the guard of the mode, for a
 * later emitter that needs one.)
 *
 * A user function called by the expression is written as a local arrow
 * function, in an arrow function called at once around the code, so that
 * a recursive function can call itself. A loop (`Sum`, `Product`) is a
 * `for` statement with a `bigint` counter, in an arrow function called at
 * once. The rules are those of
 * `docs/plans/2026-10-31-ce715-bigint-compile-mode.md` (§3.1.1, §3.2, §3.3,
 * §3.6, §3.7); the section of the spec follows a rule as a footnote.
 *
 * The code of the root is written in a wrapper (`entryWrapper`): it
 * converts each integer input that the host gives as a `number` to a
 * `bigint`, and it catches the `NonFiniteValue` of a pole and returns its
 * `number` (§3.4, §3.5). The wrapper is part of the emitted code, so every
 * runner has it.
 *
 * Not in this module: the folding of a constant subtree by the double
 * mode. A constant subtree is written from the exact value of `evaluate()`.
 */

import type { Expression, FunctionInterface } from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { functionLiteralBoundNames } from '../boxed-expression/function-literal.js';
import type { CompileTarget, TargetSource } from './types.js';
import { bigintLaneError } from './diagnostics.js';
import { tempVar } from './compiler-naming.js';
import { core } from './compiler-core-hooks.js';
import { candidateAt } from './cse.js';
import { cseRegionOf, cseTop } from './compile-conditions.js';
import { cseTempVar } from './compile-cse.js';
import {
  exactRational,
  type BigintForcingParent,
  type BigintLaneAnalysis,
  type BigintLaneRecord,
} from './compile-bigint-lane.js';

/**
 * The JavaScript code of `expr`, whose lane analysis is `analysis`, in
 * `mode: 'bigint'`. `expr` is the root of the compilation, or the body of
 * the `Function` literal at the root (its parameters are then inputs, read
 * as the double mode reads them). Throws the `bigint-lane` decline of a node that this
 * emitter cannot write (a constant whose value is not an exact integer).
 */
export function emitBigintLane(
  expr: Expression,
  target: CompileTarget<Expression>,
  analysis: BigintLaneAnalysis
): TargetSource {
  const emitter = new BigintEmitter(target, analysis);
  // The CSE temporaries that the emitter binds (`BigintEmitter.shared`) can
  // call a user function. So this function takes the bindings out of the
  // root region (the caller, `withCseRegion`, then finds none to write) and
  // writes them with `cseBind` around the root code, after the `const`
  // definitions of the user functions that `withDefinitions` writes.
  const top = cseTop(target);
  const start = top?.bindings.length ?? 0;
  const code = emitter.value(expr);
  const bindings = top?.bindings.splice(start) ?? [];
  return emitter.entryWrapper(
    emitter.withDefinitions(
      bindings.length === 0 ? code : target.cseBind!(bindings, code)
    )
  );
}

class BigintEmitter {
  /** The JavaScript names of the names bound by the enclosing constructs:
   * loop indices, callback and user function parameters. The last scope is
   * the innermost. */
  private scopes: Array<Map<string, string>> = [];
  /** The definitions of the user functions, by the literal whose body the
   * analysis analyzed. */
  private readonly definitions = new Map<
    Expression,
    { name: string; code: string | undefined }
  >();
  /** The JavaScript names of the user functions whose definition is being
   * written, by the name of the function. */
  private readonly inProgress = new Map<string, string>();
  /** The JavaScript names of the converted integer inputs, by the code that
   * reads the input (`_.n`, or a parameter of the `Function` literal at the
   * root). */
  private readonly lifted = new Map<string, string>();

  constructor(
    private readonly target: CompileTarget<Expression>,
    private readonly analysis: BigintLaneAnalysis
  ) {}

  /**
   * `code` in the wrapper of the compiled entry (§3.4, §3.5):
   * - Each integer input is read one time, before the code, into a local.
   *   A `number` is converted with `_SYS.toBigint(x)`, and a `bigint` is
   *   kept. The conversion goes through the runtime object `_SYS`, as every
   *   helper call does, and not through the global `BigInt`, which a
   *   parameter named `BigInt` would shadow.
   *   The conversion is in the code, so it applies in every runner and also
   *   when the entry checks are off. A `number` that is not an integer then
   *   makes the conversion throw a `RangeError`. A `list<integer>` input is not
   *   converted here: the entry check converts its cells when it is on.
   * - One `try`/`catch` around the code catches the `NonFiniteValue` that a
   *   helper throws at a pole, and returns its `number` (`Infinity` or
   *   `NaN`). Any other error is thrown again.
   *
   * The definitions of the user functions are in `code`, so they have no
   * catch of their own: a pole in a user function ends the whole
   * computation. When `code` is the body of the `Function` literal at the
   * root, the closure that the host receives has the same wrapper.
   *
   * Code that reads no integer input and calls no helper (`_SYS`) has no
   * wrapper: only a helper throws a `NonFiniteValue`. Thus the code of a
   * folded constant is its literal (`7n`).
   */
  entryWrapper(code: string): string {
    if (this.lifted.size === 0 && !code.includes('_SYS.')) return code;
    const lifts = [...this.lifted]
      .map(
        ([read, id]) =>
          `const ${id} = typeof ${read} === 'number' ? _SYS.toBigint(${read}) : ${read}; `
      )
      .join('');
    const e = tempVar(this.target);
    return `(() => { ${lifts}try { return ${code}; } catch (${e}) { if (${e} instanceof _SYS.NonFiniteValue) return ${e}.value; throw ${e}; } })()`;
  }

  /** `code` with the definitions of the user functions it calls. */
  withDefinitions(code: string): string {
    if (this.definitions.size === 0) return code;
    const defs = [...this.definitions.values()]
      .map((d) => `const ${d.name} = ${d.code};`)
      .join(' ');
    return `(() => { ${defs} return ${code}; })()`;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private record(node: Expression): BigintLaneRecord {
    const record = this.analysis.records.get(node);
    if (record === undefined)
      throw this.decline(node, 'the lane analysis has no record for this node');
    return record;
  }

  private decline(node: Expression, reason: string): Error {
    return bigintLaneError({
      node: node.toString(),
      type: node.type.toString(),
      reason,
    });
  }

  private lookup(name: string): string | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const id = this.scopes[i].get(name);
      if (id !== undefined) return id;
    }
    return undefined;
  }

  /** Run `fn` with the names `names` bound to new JavaScript names, which
   * it receives. With `fresh`, the names of the enclosing constructs are
   * not visible: the body of a user function is lexically outside the
   * call. */
  private withBound<T>(
    names: ReadonlyArray<string>,
    fn: (ids: string[]) => T,
    fresh = false
  ): T {
    const saved = this.scopes;
    const scope = new Map<string, string>();
    const ids = names.map((name) => {
      const id = tempVar(this.target);
      scope.set(name, id);
      return id;
    });
    this.scopes = [...(fresh ? [] : saved), scope];
    try {
      return fn(ids);
    } finally {
      this.scopes = saved;
    }
  }

  // -------------------------------------------------------------------------
  // Values
  // -------------------------------------------------------------------------

  /**
   * The code of a node whose value is a `bigint`, a list of them, or a
   * boolean. A node that an integer-forcing parent lowers is written by
   * `lowered`, from the parent.
   */
  value(node: Expression): string {
    const record = this.record(node);
    if (record.value === 'parent-lowered')
      throw this.decline(
        node,
        'a non-integer value is on the lane only as the operand of an integer-forcing parent'
      );
    return this.shared(node, () => {
      if (record.lowering === 'folded') return this.folded(node, record);
      if (isSymbol(node)) return this.symbol(node, record);
      if (!isFunction(node))
        throw this.decline(node, 'this kind of expression has no bigint code');
      return this.application(node, record);
    });
  }

  /**
   * The code `emit` gives for `node`, shared through the CSE session of the
   * compilation (§3.7). When `node` is a candidate of the innermost region
   * instance, its first occurrence binds its code to a temporary of that
   * instance, and each later occurrence is a reference to the temporary.
   * `emitBigintLane` writes the bindings around the root code, after the
   * definitions of the user functions. The harvest does not make a
   * candidate of a parent-lowered
   * node, a rational constant or a callback literal
   * (`bigintCseExclusion`).
   *
   * The emitter reads only the region instance that the core compiler
   * pushed before it: the root, or the body of a `Function` literal at the
   * root. It pushes no instance of its own. Thus:
   * - a node in a branch of a conditional or in a short-circuit operand is
   *   in a region of its own, not in the region of the instance, and is
   *   written in its place: a binding does not evaluate it when the
   *   interpreter does not;
   * - in a loop body, a callback and the definition of a user function (a
   *   construct that binds names, `scopes` is not empty) no node is
   *   shared: a node there can read a bound name with the same spelling as
   *   an input, and a binding at the root cannot read the bound name.
   *
   * A later occurrence gets the name of the temporary and is not emitted,
   * but no record of `CompilerState._callerLowered` is copied to it
   * (`copyCallerLowered()`, as `compileWithCse()` does): this emitter never
   * calls a caller's `compile` handler (it calls `core.compile()` only for
   * the read of an input symbol), so no node of this code has such a
   * record. `bigintCseExclusion` does not exclude a node whose operator has
   * a caller's handler, and it does not need to for this reason.
   */
  private shared(node: Expression, emit: () => string): string {
    const top = this.scopes.length === 0 ? cseTop(this.target) : undefined;
    if (top === undefined || this.target.cseBind === undefined) return emit();
    const candidate = candidateAt(cseRegionOf(top), node);
    if (candidate === undefined) return emit();
    const state = top.state.get(candidate);
    if (state === 'bound') return top.names.get(candidate)!;
    if (state === 'defining') return emit();
    top.state.set(candidate, 'defining');
    const rhs = emit();
    const name = cseTempVar(this.target);
    top.bindings.push([name, rhs]);
    top.state.set(candidate, 'bound');
    top.names.set(candidate, name);
    return name;
  }

  /** The code of an operand whose parent forces an integer: `forcing` lowers
   * the operand when it is not an integer (§3.2). */
  private forced(node: Expression, forcing: BigintForcingParent): string {
    const record = this.record(node);
    if (record.value !== 'parent-lowered') return this.value(node);
    return this.lowered(node, record, forcing);
  }

  /** The code of an operand of a parent that may be an integer promise
   * (`promise`), or not. */
  private operand(node: Expression, promise: boolean): string {
    return promise ? this.forced(node, 'promise') : this.value(node);
  }

  private symbol(
    node: Expression & { symbol: string },
    record: BigintLaneRecord
  ): string {
    const name = node.symbol;
    // The read of an input is the read of the double mode: it has no
    // arithmetic, and it records the input for the entry checks
    // (`varsObjectRefs`) and reads a `vars` entry or a parameter of the
    // `Function` literal at the root. An integer input is read from the
    // local that the wrapper of the entry converts (`entryWrapper`).
    if (record.lowering === 'input') {
      const read = core.compile(node, this.target);
      if (record.input !== 'integer') return read;
      let id = this.lifted.get(read);
      if (id === undefined) {
        id = tempVar(this.target);
        this.lifted.set(read, id);
      }
      return id;
    }
    const id = this.lookup(name);
    if (id === undefined)
      throw this.decline(node, 'this local name is not bound in the code');
    return id;
  }

  /**
   * The code of a constant subtree, from the exact value of `evaluate()`:
   * an integer is a `bigint` literal, a boolean is `true` or `false`, and a
   * list holds such values. The literal is exact at every size: no value
   * is rounded to a double, also past `2^53` (`2^60 + 1` is
   * `1152921504606846977n`). A value of another kind declines: an
   * expression that `evaluate()` leaves unevaluated (`Fibonacci(10^9)`,
   * whose value is above the size limit of the interpreter, §3.9) or a
   * value that is not an integer (§3.2, §3.7).
   *
   * A constant whose value is a pole (`record.pole`, §3.4) is a throw of a
   * `NonFiniteValue` with that `number`, in an expression. The throw
   * happens only when the code of the node runs, so a pole on a branch
   * that does not run has no effect. The catch of the compiled entry
   * returns the `number`.
   */
  private folded(node: Expression, record: BigintLaneRecord): string {
    if (record.pole !== undefined)
      return `(() => { throw new _SYS.NonFiniteValue(${String(record.pole)}); })()`;
    const value = isNumber(node) ? node : node.evaluate();
    const code = literalCode(value);
    if (code === undefined)
      throw this.decline(
        node,
        `its value \`${value.toString()}\` is not an exact integer, a boolean or a list of them`
      );
    return code;
  }

  // -------------------------------------------------------------------------
  // Applications
  // -------------------------------------------------------------------------

  private application(
    node: Expression & FunctionInterface,
    record: BigintLaneRecord
  ): string {
    // The lane analysis gives a single-statement `Block` a copy of the
    // record of its operand, with the fields of that operand (`userCall`,
    // `callback`, `comparison`). Thus a `Block` is the value of its operand
    // before any test of these fields: if not, `Block(f(x))` is written as
    // a call of `f` on the operand of the `Block`, which is `f(x)`.
    if (node.operator === 'Block') return this.value(node.op1);
    if (record.userCall !== undefined) return this.userCall(node, record);
    const ops = node.ops;
    const head = node.operator;
    switch (head) {
      case 'Add':
        return `(${ops.map((op) => this.value(op)).join(' + ')})`;
      case 'Subtract':
        return `(${ops.map((op) => this.value(op)).join(' - ')})`;
      case 'Negate':
        return `(-${this.value(node.op1)})`;
      case 'Multiply':
        return `(${ops.map((op) => this.value(op)).join(' * ')})`;
      case 'Power':
        return this.power(node);
      case 'Abs':
        return `_SYS.babs(${this.value(node.op1)})`;
      case 'Sign':
        return `_SYS.bsign(${this.value(node.op1)})`;
      case 'Min':
      case 'Max':
      case 'GCD':
      case 'LCM':
      case 'Factorial':
      case 'Binomial':
      case 'Fibonacci':
        return this.helperCall(node);
      case 'Mod':
        return `_SYS.bfloorMod(${this.value(node.op1)}, ${this.value(node.op2)})`;
      case 'Remainder':
        return `_SYS.bremainder(${this.value(node.op1)}, ${this.value(node.op2)})`;
      case 'Factorial2':
        return `_SYS.bfactorial2(${this.value(node.op1)})`;
      case 'Floor':
      case 'Ceil':
      case 'Round':
      case 'Truncate':
        // The rounding of an integer is that integer.
        return this.forced(node.op1, head);
      case 'Typed':
        return this.forced(node.op1, 'promise');
      case 'If':
      case 'Which':
        return this.conditional(node);
      case 'Less':
      case 'Greater':
      case 'LessEqual':
      case 'GreaterEqual':
      case 'Equal':
      case 'NotEqual':
        return this.comparison(node, record);
      case 'And':
        return `(${ops.map((op) => this.value(op)).join(' && ')})`;
      case 'Or':
        return `(${ops.map((op) => this.value(op)).join(' || ')})`;
      case 'Not':
        return `(!${this.value(node.op1)})`;
      case 'IsPrime':
        return `_SYS.isPrimeBigint(${this.value(node.op1)})`;
      case 'Boole':
        return `(${this.value(node.op1)} ? 1n : 0n)`;
      case 'Sum':
      case 'Product':
        return this.loop(node);
      case 'Reduce':
      case 'Fold':
        return this.fold(node, record);
      case 'Range':
        return this.range(node);
      case 'List':
        return `[${ops.map((op) => this.value(op)).join(', ')}]`;
      case 'Map':
        return `${this.value(node.op2)}.map(${this.callback(record, node.op1)})`;
      case 'Length':
      case 'Count':
        return `_SYS.toBigint(${this.value(node.op1)}.length)`;
      case 'At':
        return `_SYS.bat(${this.value(node.op1)}, ${this.value(node.op2)})`;
      case 'First':
        return `_SYS.bat(${this.value(node.op1)}, 1n)`;
      case 'Last':
        return `_SYS.bat(${this.value(node.op1)}, -1n)`;
      case 'Take':
        return `_SYS.btake(${this.value(node.op1)}, ${this.value(node.op2)})`;
      case 'Drop':
        return `_SYS.bdrop(${this.value(node.op1)}, ${this.value(node.op2)})`;
      case 'ReplaceAt':
        return this.replaceAt(node);
    }
    throw this.decline(node, `\`${head}\` has no bigint code`);
  }

  /** A library head whose arguments at a parameter declared a subtype of
   * `integer` are under an integer promise (`Fibonacci(n/2)`, §3.2). */
  private helperCall(node: Expression & FunctionInterface): string {
    const helper = {
      Min: 'bmin',
      Max: 'bmax',
      GCD: 'bgcd',
      LCM: 'blcm',
      Factorial: 'bfactorial',
      Binomial: 'bbinomial',
      Fibonacci: 'bfibonacci',
    }[node.operator];
    const args = node.ops.map((op) => {
      const record = this.record(op);
      return record.value === 'parent-lowered'
        ? this.lowered(op, record, 'promise')
        : this.value(op);
    });
    return `_SYS.${helper}(${args.join(', ')})`;
  }

  /** `Power(−1, k)` by the parity of `k`; any other power on the lane has an
   * exponent typed `integer<0..>` (§3.1.1). */
  private power(node: Expression & FunctionInterface): string {
    const base = exactRational(node.op1);
    if (base !== undefined && base.q === 1n && base.p === -1n)
      return `_SYS.bnegOnePow(${this.value(node.op2)})`;
    return `_SYS.bpow(${this.value(node.op1)}, ${this.value(node.op2)})`;
  }

  private conditional(node: Expression & FunctionInterface): string {
    const ops = node.ops;
    if (node.operator === 'If')
      return `(${this.value(ops[0])} ? ${this.value(ops[1])} : ${this.value(ops[2])})`;
    // `Which(c₁, v₁, …, True, vₖ)`: the last test is `True`, so its value
    // is the else branch of the last test before it.
    let code = this.value(ops[ops.length - 1]);
    for (let i = ops.length - 4; i >= 0; i -= 2)
      code = `(${this.value(ops[i])} ? ${this.value(ops[i + 1])} : ${code})`;
    return code;
  }

  /**
   * A comparison of two lane values, or of a lane value and a rational
   * constant `p/q` (`q > 0`), compared exactly: `n < p/q` is `q·n < p`.
   * `Equal` and `NotEqual` with a constant that is not an integer have a
   * value known at compile time; the lane operand is still evaluated, so a
   * pole or a size limit in it ends the computation as it does elsewhere
   * (§3.3).
   */
  private comparison(
    node: Expression & FunctionInterface,
    record: BigintLaneRecord
  ): string {
    const op = {
      Less: '<',
      Greater: '>',
      LessEqual: '<=',
      GreaterEqual: '>=',
      Equal: '===',
      NotEqual: '!==',
    }[node.operator]!;
    const c = record.comparison;
    if (c === undefined)
      return `(${this.value(node.op1)} ${op} ${this.value(node.op2)})`;
    const lane = this.value(node.ops[1 - c.constantOperand]);
    if (c.folded !== undefined) return `(${lane}, ${String(c.folded)})`;
    const scaled = `${bigintLiteral(c.q)} * ${lane}`;
    const p = bigintLiteral(c.p);
    return c.constantOperand === 1
      ? `(${scaled} ${op} ${p})`
      : `(${p} ${op} ${scaled})`;
  }

  /**
   * `Sum(body, Limits(i, lo, hi), …)` and `Product(…)`: one `for` loop per
   * `Limits`, the first one outermost, each with a `bigint` counter that
   * runs from `lo` to `hi` by 1 (no iteration when `hi < lo`). The upper
   * limit is evaluated once, before its loop. The accumulator has no size
   * limit, as the loop of the double mode has none (§3.7, §3.9).
   */
  private loop(node: Expression & FunctionInterface): string {
    const [body, ...limits] = node.ops;
    const product = node.operator === 'Product';
    const acc = tempVar(this.target);
    const nest = (i: number): string => {
      if (i === limits.length)
        return `${acc} ${product ? '*=' : '+='} ${this.value(body)};`;
      const limit = limits[i] as Expression & FunctionInterface;
      const lo = this.value(limit.ops[1]);
      const hi = this.value(limit.ops[2]);
      const names = isSymbol(limit.op1) ? [limit.op1.symbol] : [];
      return this.withBound(names, (ids) => {
        const index = ids[0] ?? tempVar(this.target);
        const upper = tempVar(this.target);
        return `{ const ${upper} = ${hi}; for (let ${index} = ${lo}; ${index} <= ${upper}; ${index}++) { ${nest(i + 1)} } }`;
      });
    };
    return `(() => { let ${acc} = ${product ? '1n' : '0n'}; ${nest(0)} return ${acc}; })()`;
  }

  /** `Reduce(coll, f, init?)` and `Fold(f, init, coll)`: the callback
   * receives the accumulator, then the element. */
  private fold(
    node: Expression & FunctionInterface,
    record: BigintLaneRecord
  ): string {
    const [coll, fnOperand, init] =
      node.operator === 'Reduce'
        ? [node.ops[0], node.ops[1], node.ops[2]]
        : [node.ops[2], node.ops[0], node.ops[1]];
    const fn = this.callback(record, fnOperand);
    const list = this.value(coll);
    return init === undefined
      ? `${list}.reduce(${fn})`
      : `${list}.reduce(${fn}, ${this.value(init)})`;
  }

  /** The arrow function of the callback literal of a `Map`, `Fold` or
   * `Reduce`, whose operand is `fn`. The body of a callback named by a user
   * function (`fn` is a symbol) is lexically outside the expression: no
   * enclosing local is visible in it. A callback declared `-> integer` is
   * an integer promise for its body. */
  private callback(record: BigintLaneRecord, fn: Expression): string {
    const literal = record.callback;
    if (literal === undefined)
      throw this.decline(fn, 'the callback has no analyzed literal');
    const literalRecord = this.analysis.records.get(literal);
    const promise = literalRecord?.promiseType !== undefined;
    const names = functionLiteralBoundNames(literal.ops.slice(1));
    return this.withBound(
      names,
      (ids) =>
        `((${ids.join(', ')}) => ${this.operand(literal.ops[0], promise)})`,
      !isFunction(fn, 'Function')
    );
  }

  /** `Range(hi)`, `Range(lo, hi)` and `Range(lo, hi, step)`. With no step,
   * the range goes from `lo` toward `hi` by `1` or `−1`; `Range(hi)` starts
   * at `1`. */
  private range(node: Expression & FunctionInterface): string {
    const ops = node.ops.map((op) => this.value(op));
    if (ops.length === 1) return `_SYS.brange(1n, ${ops[0]})`;
    return `_SYS.brange(${ops.join(', ')})`;
  }

  /** `ReplaceAt(L, i, v)`: the position and the value are at parameters
   * declared `integer`, which are integer promises (§3.2). */
  private replaceAt(node: Expression & FunctionInterface): string {
    const [list, i, v] = node.ops;
    const arg = (op: Expression): string => {
      const record = this.record(op);
      return record.value === 'parent-lowered'
        ? this.lowered(op, record, 'promise')
        : this.value(op);
    };
    return `_SYS.breplaceAt(${this.value(list)}, ${arg(i)}, ${arg(v)})`;
  }

  // -------------------------------------------------------------------------
  // Non-integer shapes under an integer-forcing parent (§3.2)
  // -------------------------------------------------------------------------

  /**
   * The code of the non-integer subtree `node` under the integer-forcing
   * parent `forcing`. A quotient is rounded by the parent: `Floor` by
   * `bfloorDiv`, `Ceil` by `bceilDiv`, `Round` by `broundDiv` (a half away
   * from zero), `Truncate` by `btruncDiv`; under an integer promise it is a
   * checked exact division (`bexactDiv`), which throws a `RangeError` when
   * the quotient is not an integer. The square root is lowered by a
   * rounding parent only. A single-statement `Block` between the parent
   * and the subtree passes the parent down.
   */
  private lowered(
    node: Expression,
    record: BigintLaneRecord,
    forcing: BigintForcingParent
  ): string {
    if (!isFunction(node))
      throw this.decline(node, 'a parent-lowered node must be an application');
    if (node.operator === 'Block') return this.forced(node.op1, forcing);
    const shape = record.parentLowered?.shape;
    const division = {
      Floor: 'bfloorDiv',
      Ceil: 'bceilDiv',
      Round: 'broundDiv',
      Truncate: 'btruncDiv',
      promise: 'bexactDiv',
    }[forcing];
    switch (shape) {
      case 'rational-product': {
        const r = exactRational(node.op1);
        if (r === undefined)
          throw this.decline(node, 'the rational factor has no exact value');
        const factors = [
          bigintLiteral(r.p),
          ...node.ops.slice(1).map((op) => this.value(op)),
        ];
        return `_SYS.${division}(${factors.join(' * ')}, ${bigintLiteral(r.q)})`;
      }
      case 'quotient':
        return `_SYS.${division}(${this.value(node.op1)}, ${this.value(node.op2)})`;
      case 'power':
        return `_SYS.${division}(..._SYS.bpowRational(${this.value(node.op1)}, ${this.value(node.op2)}))`;
      case 'sqrt': {
        const root = {
          Floor: 'bisqrt',
          Truncate: 'bisqrt',
          Ceil: 'bceilSqrt',
          Round: 'broundSqrt',
          promise: undefined,
        }[forcing];
        if (root === undefined)
          throw this.decline(
            node,
            'a square root is lowered by a rounding parent only'
          );
        return `_SYS.${root}(${this.value(node.op1)})`;
      }
    }
    throw this.decline(node, 'this shape has no lowering');
  }

  // -------------------------------------------------------------------------
  // User functions (§3.1.2)
  // -------------------------------------------------------------------------

  /**
   * A call of a user function: a call of its local definition. An argument
   * at a parameter declared a subtype of `integer` is under an integer
   * promise. The definition has no catch: a pole in its body ends the whole
   * computation (§3.4).
   */
  private userCall(
    node: Expression & FunctionInterface,
    record: BigintLaneRecord
  ): string {
    const call = record.userCall!;
    const name = this.definition(call.name, call.literal, call.resultPromise);
    const args = node.ops.map((arg) => {
      const r = this.record(arg);
      return r.value === 'parent-lowered'
        ? this.lowered(arg, r, 'promise')
        : this.value(arg);
    });
    return `${name}(${args.join(', ')})`;
  }

  /**
   * The JavaScript name of the definition of the user function `name` whose
   * body the analysis analyzed in `literal`. A recursive call inside a body
   * that the analysis typed with the types of the arguments names the
   * literal of the function, not that copy: it calls the definition being
   * written.
   */
  private definition(
    name: string,
    literal: Expression & FunctionInterface,
    resultPromise: boolean
  ): string {
    const known = this.definitions.get(literal);
    if (known !== undefined) return known.name;
    if (!this.analysis.records.has(literal.ops[0])) {
      const current = this.inProgress.get(name);
      if (current !== undefined) return current;
      throw this.decline(
        literal,
        `the body of \`${name}\` was not analyzed for this call`
      );
    }
    const id = tempVar(this.target);
    const entry = { name: id, code: undefined as string | undefined };
    this.definitions.set(literal, entry);
    const savedInProgress = this.inProgress.get(name);
    this.inProgress.set(name, id);
    try {
      const params = functionLiteralBoundNames(literal.ops.slice(1));
      entry.code = this.withBound(
        params,
        (ids) =>
          `(${ids.join(', ')}) => ${this.operand(literal.ops[0], resultPromise)}`,
        true
      );
    } finally {
      if (savedInProgress === undefined) this.inProgress.delete(name);
      else this.inProgress.set(name, savedInProgress);
    }
    return id;
  }
}

/** The JavaScript literal of the `bigint` `v`, in parentheses when it is
 * negative, so that it can be an operand of any operator. */
function bigintLiteral(v: bigint): string {
  return v < 0n ? `(${String(v)}n)` : `${String(v)}n`;
}

/** The code of a constant value: an exact integer, a boolean, or a finite
 * collection of them. `undefined` for any other value. */
function literalCode(value: Expression): string | undefined {
  if (isNumber(value)) {
    const r = exactRational(value);
    return r !== undefined && r.q === 1n ? bigintLiteral(r.p) : undefined;
  }
  if (isSymbol(value, 'True')) return 'true';
  if (isSymbol(value, 'False')) return 'false';
  if (isFunction(value, 'List')) {
    const cells = value.ops.map(literalCode);
    return cells.every((c) => c !== undefined)
      ? `[${cells.join(', ')}]`
      : undefined;
  }
  if (value.isFiniteCollection === true) {
    const cells = [...value.each()].map(literalCode);
    return cells.every((c) => c !== undefined)
      ? `[${cells.join(', ')}]`
      : undefined;
  }
  return undefined;
}
