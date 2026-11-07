import type { Expression } from '../global-types.js';
import type { CompileTarget, NamingContext } from './types.js';

// An exit is one JavaScript statement, including when it assigns and breaks.
type Exit = (value: string) => string;
type StatementBody = (exit: Exit) => string;

/**
 * Structured alternatives to expression wrappers emitted by this compiler.
 * Only a complete expression at a statement position is expanded. Operands
 * embedded in arithmetic, calls or conditional expressions stay untouched,
 * preserving their evaluation order and conditional execution.
 */
class JavaScriptStatements {
  private readonly bodies = new Map<string, StatementBody>();
  private counter = 0;

  constructor(private readonly naming: NamingContext) {}

  private fresh(): string {
    let name: string;
    do name = `_js${++this.counter}`;
    while (this.naming.usedNames.has(name));
    return name;
  }

  has(source: string): boolean {
    return this.bodies.has(source);
  }

  register(source: string, body: StatementBody): string {
    this.bodies.set(source, body);
    return source;
  }

  expression(body: StatementBody): string {
    return this.register(`(() => { ${body((v) => `return ${v};`)} })()`, body);
  }

  parenthesize(source: string): string {
    const wrapped = `(${source})`;
    const body = this.bodies.get(source);
    if (body) this.register(wrapped, body);
    return wrapped;
  }

  emit(source: string, exit: Exit): string {
    const body = this.bodies.get(source);
    // The former function's locals keep a lexical scope, including when a
    // loop index shadows an enclosing function parameter.
    return body ? `{ ${body(exit)} }` : exit(source);
  }

  functionBody(source: string): string {
    return this.emit(source, (v) => `return ${v};`);
  }

  /**
   * `kind` applies only to ordinary expression initializers. Registered statement
   * bodies require a `let` binding; local exits assign it and leave a block,
   * never the caller.
   */
  initialize(name: string, source: string, kind = 'const'): string {
    if (!this.bodies.has(source)) return `${kind} ${name} = ${source};`;
    const label = this.fresh();
    return `let ${name}; ${label}: ${this.emit(
      source,
      (v) => `{ ${name} = ${v}; break ${label}; }`
    )}`;
  }

  consume(source: string, use: (value: string) => string): string {
    if (!this.bodies.has(source)) return use(source);
    const name = this.fresh();
    return `${this.initialize(name, source)} ${use(name)}`;
  }

  bindings(bindings: ReadonlyArray<[string, string]>, body: string): string {
    const source = `(() => { ${bindings
      .map(([name, code]) => `const ${name} = ${code};`)
      .join(' ')} return ${body}; })()`;
    return this.register(
      source,
      (exit) =>
        `${bindings.map(([name, code]) => this.initialize(name, code)).join(' ')} ${this.emit(body, exit)}`
    );
  }

  parameters(bindings: ReadonlyArray<[string, string]>, body: string): string {
    const source = `((${bindings.map(([name]) => name).join(', ')}) => ${body})(${bindings.map(([, code]) => code).join(', ')})`;
    return this.register(source, (exit) => {
      // Arguments see the enclosing scope, not earlier parameters. Evaluate
      // all arguments before introducing any parameter names in a new block.
      const args = bindings.map(() => this.fresh());
      return `${bindings.map(([, code], i) => this.initialize(args[i], code)).join(' ')} { ${bindings.map(([name], i) => `const ${name} = ${args[i]};`).join(' ')} ${this.emit(body, exit)} }`;
    });
  }
}

const contexts = new WeakMap<NamingContext, JavaScriptStatements>();

export function resetJavaScriptStatements(
  target: CompileTarget<Expression>
): void {
  if (target.naming) {
    contexts.delete(target.naming);
    statementForms.delete(target.naming);
  }
}

/** Naming state is shared by target copies and belongs to one compilation. */
export function javascriptStatements(
  target: CompileTarget<Expression>
): JavaScriptStatements | undefined {
  if (target.language !== 'javascript' || !target.naming) return undefined;
  let context = contexts.get(target.naming);
  if (!context) {
    context = new JavaScriptStatements(target.naming);
    contexts.set(target.naming, context);
  }
  return context;
}

/**
 * The block statements recorded by `registerStatement()`, for each
 * compilation (naming context): the source of an arrow function that is
 * called at once, and the block statement with the same effect.
 */
const statementForms = new WeakMap<NamingContext, Map<string, string>>();

/**
 * Record that `source`, an arrow function that is called at once, has the
 * same effect as `statement`, a block statement, and that its value is
 * `undefined`, which nothing reads. A compiled `Loop` is such a source.
 * Where the value of `source` is discarded (a statement of a block or of a
 * loop body), `discardedValueStatement()` gives the block instead. V8 keeps a
 * local that the inner function writes in a heap context, so the arrow
 * function around a loop made each pass of a loop over such locals up to two
 * times slower.
 *
 * Only the JavaScript and interval JavaScript targets record a statement form,
 * and only when the target has a naming context: elsewhere `source` stays as
 * it is.
 *
 * The caller must make sure that `statement` has no `return`: in the arrow
 * function it ends only the arrow function, and in the block it would end
 * the function that contains the block. A `break` or a `continue` in
 * `statement` is inside its own loop, so it goes to the same loop in both
 * forms.
 */
export function registerStatement(
  target: CompileTarget<Expression>,
  source: string,
  statement: string
): string {
  const naming = target.naming;
  if (
    naming === undefined ||
    (target.language !== 'javascript' &&
      target.language !== 'interval-javascript')
  )
    return source;
  let forms = statementForms.get(naming);
  if (forms === undefined) statementForms.set(naming, (forms = new Map()));
  forms.set(source, statement);
  return source;
}

/**
 * `code`, the code of a statement whose value is discarded, in the form to
 * emit: the block statement recorded for it by `registerStatement()`, or
 * `code` itself.
 */
export function discardedValueStatement(
  target: CompileTarget<Expression>,
  code: string
): string {
  const naming = target.naming;
  if (naming === undefined) return code;
  return statementForms.get(naming)?.get(code) ?? code;
}
