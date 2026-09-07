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
  if (target.naming) contexts.delete(target.naming);
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
