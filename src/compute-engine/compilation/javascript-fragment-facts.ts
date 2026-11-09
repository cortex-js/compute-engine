/** Compile-local facts for the internal scalar JavaScript fragment. */
import { isFunction } from '../boxed-expression/type-guards.js';
import type { Expression } from '../global-types.js';
import type { CompileTarget } from './types.js';
export type ScalarRepresentation = 'number' | 'boolean' | 'complex';
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
  readonly annotate: () => Annotation;
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
  annotation?: Annotation;
  scope?: Scope;
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
  const policy = Object.fromEntries(
    policyKeys.map((key) => [key, target[key]])
  ) as Policy;
  (target as AnnotatedTarget)[artifactKey] = {
    root: artifact.root,
    annotate: artifact.annotate,
    functionRoot: artifact.functionRoot,
    helper: artifact.helper,
    capture: artifact.capture ?? artifact.helper?.capture,
    policy,
  };
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
  const value = artifact.scope?.facts.get(node);
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
  return artifact.annotation?.scope;
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
    artifact.functionRoot !== fn ||
    artifact.root !== body ||
    artifact.annotation
  )
    throw new Error(
      'JS scalar fragment invariant: different prepared function'
    );
  attachScalarFragment(inner, artifact);
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
    name === undefined ? undefined : artifact.annotation?.functions.get(name);
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
    annotate: artifact.annotate,
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
  if (artifact.annotation === undefined) {
    if (node !== artifact.root)
      throw new Error('JS scalar fragment invariant: different prepared root');
  } else assertMember(artifact, node);
}

/** Enter only after the compiler has installed its mode and folding policy. */
export function enterScalarFragment(
  node: Expression,
  target: CompileTarget<Expression>
): (() => void) | undefined {
  const artifact = (target as AnnotatedTarget)[artifactKey];
  if (artifact === undefined) return undefined;
  assertPolicy(artifact, target);
  // The authorized target's root expression is part of its policy. A named
  // definition has its own annotated body but retains the registry's root.
  if (artifact.annotation === undefined) {
    if (node !== artifact.root)
      throw new Error('JS scalar fragment invariant: different prepared root');
    const annotation = artifact.annotate();
    if (annotation.root !== artifact.root || annotation.refusal)
      throw new Error('JS scalar fragment invariant: invalid annotation');
    artifact.annotation = annotation;
    artifact.scope = annotation.scope;
  }
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

/** A direct helper call may not acquire hidden arguments or changed operands. */
export function assertScalarFragmentCall(
  target: CompileTarget<Expression>,
  args: readonly Expression[],
  held: readonly string[]
): void {
  const op = operation(target);
  if (op === undefined) return;
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
