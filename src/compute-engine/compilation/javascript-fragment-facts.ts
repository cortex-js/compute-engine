/** Compile-local facts for the internal scalar JavaScript fragment. */
import { isFunction } from '../boxed-expression/type-guards.js';
import type { Expression } from '../global-types.js';
import type { CompileTarget } from './types.js';
/** `array`: a list of reals or of integers that the program reads, on the
 *  structured route only (`javascript-structured-policy.ts`). */
export type ScalarRepresentation = 'number' | 'boolean' | 'complex' | 'array';
// The emitter consumes this readonly view of the real fragment annotation.
// Keeping the view here avoids a dependency on the walker's preparation code.
type Facts = {
  readonly representation: ScalarRepresentation;
  readonly conversions?: readonly {
    readonly kind: string;
    readonly representation: ScalarRepresentation;
  }[];
};
type Scope = {
  readonly facts: ReadonlyMap<Expression, Facts | { readonly type: unknown }>;
  readonly inner: ReadonlyMap<Expression, Scope>;
};
type Annotation = {
  readonly root: Expression;
  readonly scope: Scope;
  readonly functions: ReadonlyMap<
    string,
    {
      readonly body: Expression;
      readonly scope: Scope;
    }
  >;
  readonly refusal?: unknown;
};
export type ScalarFragmentCapture = {
  readonly symbols: ReadonlySet<Expression>;
  readonly value: Expression;
  readonly assertCurrent: () => void;
};
export type ScalarFragmentHelper = {
  readonly name: string;
  readonly literal: Expression;
  readonly body: Expression;
  readonly capture?: ScalarFragmentCapture;
};
type ScalarFragmentArtifact = {
  readonly root: Expression;
  /** Built by `prepareCompilation()`, before any emission. */
  readonly annotation: Annotation;
  /** The root `Function` literal whose body is `root`. The target that
   *  holds it does not emit: `bindScalarFragmentFunction()` gives the
   *  artifact, without this field, to the target of the function body. */
  readonly functionRoot?: Expression;
  readonly helper?: ScalarFragmentHelper;
  readonly capture?: ScalarFragmentCapture;
};
const artifactKey = Symbol('scalar fragment artifact');
const policyKeys = [
  'mode',
  'constantFold',
  'rootExpression',
  'boundVars',
  'symbolDeps',
  'functions',
  'operators',
  'var',
  'declaredVarTypes',
  'renamedWritables',
] as const;
type Policy = Pick<CompileTarget<Expression>, (typeof policyKeys)[number]>;
type OwnedArtifact = ScalarFragmentArtifact & {
  readonly policy: Policy;
  scope: Scope;
  statements?: ReadonlySet<Expression>;
  current?: Expression;
};
type AnnotatedTarget = CompileTarget<Expression> & {
  [artifactKey]?: OwnedArtifact;
};

export function attachScalarFragment(
  target: CompileTarget<Expression>,
  artifact: ScalarFragmentArtifact
): void {
  const annotation = artifact.annotation;
  if (annotation.root !== artifact.root || annotation.refusal)
    throw new Error('JS scalar fragment invariant: invalid annotation');
  const policy = Object.fromEntries(
    policyKeys.map((key) => [key, target[key]])
  ) as Policy;
  (target as AnnotatedTarget)[artifactKey] = {
    root: artifact.root,
    annotation,
    scope: annotation.scope,
    functionRoot: artifact.functionRoot,
    helper: artifact.helper,
    capture: artifact.capture ?? artifact.helper?.capture,
    policy,
  };
}

/** The annotation attached to `target`, or `undefined` when it has none. */
export function scalarFragmentAnnotation(
  target: CompileTarget<Expression>
): Annotation | undefined {
  return (target as AnnotatedTarget)[artifactKey]?.annotation;
}

function assertPolicy(
  artifact: OwnedArtifact,
  target: CompileTarget<Expression>
): void {
  const changed = policyKeys.find(
    (key) => target[key] !== artifact.policy[key]
  );
  if (changed)
    throw new Error(
      `JS scalar fragment invariant: different prepared policy (${changed})`
    );
}

function facts(artifact: OwnedArtifact, node: Expression): Facts {
  const value = artifact.scope.facts.get(node);
  if (value === undefined || !('representation' in value))
    throw new Error(
      'JS scalar fragment invariant: missing prepared-node facts'
    );
  return value;
}

/**
 * The walker types stored values in the root scope. Read those facts only
 * while substituting the exact literal for its recorded captured symbol;
 * ordinary helper-body nodes continue to use their lexical scope.
 */
function storedCaptureScope(
  artifact: OwnedArtifact,
  node: Expression
): Scope | undefined {
  const capture = artifact.capture;
  if (!capture) return undefined;
  if (capture.symbols.has(node)) capture.assertCurrent();
  if (
    node !== capture.value ||
    artifact.current === undefined ||
    !capture.symbols.has(artifact.current)
  )
    return undefined;
  capture.assertCurrent();
  return artifact.annotation.scope;
}

function assertMember(artifact: OwnedArtifact, node: Expression): void {
  const storedScope = storedCaptureScope(artifact, node);
  if (storedScope) {
    const value = storedScope.facts.get(node);
    if (value && 'representation' in value) return;
    throw new Error(
      'JS scalar fragment invariant: missing captured-value facts'
    );
  }
  if (artifact.statements?.has(node)) return;
  facts(artifact, node);
}

/** Authorize the existing root-lambda target, with its exact prepared body. */
export function bindScalarFragmentFunction(
  outer: CompileTarget<Expression>,
  inner: CompileTarget<Expression>,
  fn: Expression,
  body: Expression
): void {
  const artifact = (outer as AnnotatedTarget)[artifactKey];
  if (artifact === undefined) return;
  assertPolicy(artifact, outer);
  if (
    artifact.functionRoot === undefined ||
    artifact.functionRoot !== fn ||
    artifact.root !== body
  )
    throw new Error(
      'JS scalar fragment invariant: different prepared function'
    );
  // The target of the body holds the facts that `prepareCompilation()`
  // computed for the body. It holds no `functionRoot`: it emits.
  attachScalarFragment(inner, {
    root: artifact.root,
    annotation: artifact.annotation,
    helper: artifact.helper,
    capture: artifact.capture,
  });
}

/** Bind only the exact helper body that root annotation already proved. */
export function bindScalarFragmentDefinition(
  outer: CompileTarget<Expression>,
  inner: CompileTarget<Expression>,
  literal: Expression,
  body: Expression,
  name: string | undefined
): void {
  const artifact = (outer as AnnotatedTarget)[artifactKey];
  if (artifact === undefined) return;
  assertPolicy(artifact, outer);
  const helper = artifact.helper;
  const entry =
    name === undefined ? undefined : artifact.annotation.functions.get(name);
  if (
    !helper ||
    helper.name !== name ||
    helper.literal !== literal ||
    helper.body !== body ||
    !entry ||
    entry.body !== body
  )
    throw new Error(
      'JS scalar fragment invariant: different prepared definition'
    );
  const policy = Object.fromEntries(
    policyKeys.map((key) => [key, inner[key]])
  ) as Policy;
  (inner as AnnotatedTarget)[artifactKey] = {
    root: body,
    policy,
    annotation: artifact.annotation,
    scope: entry.scope,
    capture: artifact.capture,
  };
}

/** A one-value block still has an annotated lexical scope when unwrapped. */
export function scalarFragmentUnwrappedBlock(
  target: CompileTarget<Expression>,
  node: Expression | undefined,
  statements: readonly Expression[]
): CompileTarget<Expression> {
  if ((target as AnnotatedTarget)[artifactKey] === undefined) return target;
  const inner = { ...target };
  bindScalarFragmentBlock(target, inner, node, statements);
  return inner;
}

/** Only the emitter of the recorded block may authorize its local target. */
export function bindScalarFragmentBlock(
  outer: CompileTarget<Expression>,
  inner: CompileTarget<Expression>,
  block: Expression | undefined,
  statements: readonly Expression[]
): void {
  const artifact = (outer as AnnotatedTarget)[artifactKey];
  if (artifact === undefined) return;
  assertPolicy(artifact, outer);
  const scope =
    block === undefined ? undefined : artifact.scope?.inner.get(block);
  if (
    !scope ||
    block === undefined ||
    !isFunction(block, 'Block') ||
    block !== artifact.current ||
    block !== artifact.root ||
    statements.length !== block.nops ||
    statements.some((statement, i) => statement !== block.ops[i])
  )
    throw new Error('JS scalar fragment invariant: different prepared block');
  const policy = Object.fromEntries(
    policyKeys.map((key) => [key, inner[key]])
  ) as Policy;
  (inner as AnnotatedTarget)[artifactKey] = {
    ...artifact,
    policy,
    scope,
    statements: new Set(
      statements.filter(
        (statement) =>
          statement.operator === 'Declare' || statement.operator === 'Assign'
      )
    ),
    current: undefined,
  };
}

/** Check identity even when an alias lets the core skip normal emission. */
export function assertScalarPreparedNode(
  node: Expression,
  target: CompileTarget<Expression>
): void {
  const artifact = (target as AnnotatedTarget)[artifactKey];
  if (artifact === undefined) return;
  assertPolicy(artifact, target);
  assertEmitter(artifact);
  assertMember(artifact, node);
}

/** The target of a root `Function` literal does not emit its body: only the
 *  target that `bindScalarFragmentFunction()` makes for the body does. */
function assertEmitter(artifact: OwnedArtifact): void {
  if (artifact.functionRoot !== undefined)
    throw new Error(
      'JS scalar fragment invariant: function body emitted before its binding'
    );
}

/**
 * Enter `node`. The annotation was built in `prepareCompilation()`; this
 * checks only that the target owns the node with the prepared policy.
 */
export function enterScalarFragment(
  node: Expression,
  target: CompileTarget<Expression>
): (() => void) | undefined {
  const artifact = (target as AnnotatedTarget)[artifactKey];
  if (artifact === undefined) return undefined;
  // The authorized target's root expression is part of its policy. A named
  // definition has its own annotated body but retains the registry's root.
  assertPolicy(artifact, target);
  assertEmitter(artifact);
  // The annotation typed the captured value that was stored when it was
  // built. A change of that binding after the preparation fails here, before
  // the compiler can choose another route for the changed definition.
  artifact.capture?.assertCurrent();
  assertMember(artifact, node);
  const previous = artifact.current;
  const previousScope = artifact.scope;
  artifact.scope = storedCaptureScope(artifact, node) ?? previousScope;
  artifact.current = node;
  return () => {
    artifact.current = previous;
    artifact.scope = previousScope;
  };
}

function operation(target: CompileTarget<Expression>) {
  const artifact = (target as AnnotatedTarget)[artifactKey];
  if (artifact === undefined) return undefined;
  if (artifact.current === undefined)
    throw new Error('JS scalar fragment invariant: no current operation');
  return {
    artifact,
    node: artifact.current,
    facts: facts(artifact, artifact.current),
  };
}

/** True only for an owned scalar call with exact identity conversions.
 * False is reserved for legacy targets; incomplete owned facts always fail. */
export function assertScalarFragmentCall(
  target: CompileTarget<Expression>,
  args: readonly Expression[],
  held: readonly string[]
): boolean {
  const op = operation(target);
  if (op === undefined) return false;
  assertPolicy(op.artifact, target);
  const helper = op.artifact.helper;
  const node = op.node;
  if (
    !helper ||
    !isFunction(node, helper.name) ||
    held.length !== 0 ||
    args.length !== node.nops ||
    args.some((arg, i) => arg !== node.ops[i])
  )
    throw new Error('JS scalar fragment invariant: different prepared call');
  const conversions = op.facts.conversions;
  if ((conversions?.length ?? 0) !== args.length ||
      args.some((arg, i) => {
        const conversion = conversions?.[i];
        return !conversion || conversion.kind !== 'none' ||
          !['number', 'boolean', 'complex'].includes(conversion.representation) ||
          conversion.representation !== facts(op.artifact, arg).representation;
      }))
    throw new Error('JS scalar fragment invariant: invalid scalar call conversions');
  return true;
}

/** Undefined is reserved for legacy targets, never for an absent fact. */
export function scalarResultIsComplex(
  target: CompileTarget<Expression>
): boolean | undefined {
  const op = operation(target);
  return op === undefined ? undefined : op.facts.representation === 'complex';
}

/** Whether an operand already has the complex convention before conversion. */
export function scalarOperandIsComplex(
  index: number,
  target: CompileTarget<Expression>
): boolean | undefined {
  const op = operation(target);
  if (op === undefined) return undefined;
  const conversion = op.facts.conversions?.[index];
  if (conversion === undefined)
    throw new Error('JS scalar fragment invariant: missing operand conversion');
  return conversion.representation === 'complex' && conversion.kind === 'none';
}

/**
 * The recorded conversion of operand `index`, for an emitter that applies
 * it in its own code (the complex sum writes a real operand as the real
 * part of the sum, which is what `real-to-complex` makes of it). Only the
 * two kinds that the scalar emitter applies are answered; another kind
 * fails closed, as in `scalarConvertOperand()`. Undefined is reserved for
 * legacy targets.
 */
export function scalarOperandConversion(
  index: number,
  target: CompileTarget<Expression>
): 'none' | 'real-to-complex' | undefined {
  const op = operation(target);
  if (op === undefined) return undefined;
  const conversion = op.facts.conversions?.[index];
  if (conversion === undefined)
    throw new Error('JS scalar fragment invariant: missing operand conversion');
  if (conversion.kind === 'none' || conversion.kind === 'real-to-complex')
    return conversion.kind;
  throw new Error('JS scalar fragment invariant: unsupported conversion');
}

/**
 * The representation in the facts of `operand` itself, an operand of the
 * current operation, not the representation that its recorded conversion
 * gives. Undefined is reserved for legacy targets.
 */
export function scalarOperandRepresentation(
  operand: Expression,
  target: CompileTarget<Expression>
): ScalarRepresentation | undefined {
  const op = operation(target);
  if (op === undefined) return undefined;
  return facts(op.artifact, operand).representation;
}

/** Apply an annotated edge conversion inside the operand's evaluation region. */
export function scalarConvertOperand(
  index: number,
  code: string,
  target: CompileTarget<Expression>
): string | undefined {
  const op = operation(target);
  if (op === undefined) return undefined;
  const conversion = op.facts.conversions?.[index];
  if (conversion === undefined)
    throw new Error('JS scalar fragment invariant: missing operand conversion');
  if (conversion.kind === 'none') return code;
  if (conversion.kind === 'real-to-complex') return `({ re: ${code}, im: 0 })`;
  throw new Error('JS scalar fragment invariant: unsupported conversion');
}
