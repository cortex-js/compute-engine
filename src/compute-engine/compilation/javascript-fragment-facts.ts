/** Compile-local facts for the internal scalar JavaScript fragment. */
import { isFunction } from '../boxed-expression/type-guards.js';
import type { Expression } from '../global-types.js';
import type { CompileTarget } from './types.js';
import type {
  FragmentAnnotation,
  FragmentScope,
  FragmentValueFacts,
} from './fragment.js';

export type ScalarRepresentation = 'number' | 'boolean' | 'complex';
type Facts = FragmentValueFacts<ScalarRepresentation>;
type ScalarFragmentArtifact = {
  readonly root: Expression;
  readonly annotate: () => FragmentAnnotation<ScalarRepresentation>;
  readonly functionRoot?: Expression;
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
  annotation?: FragmentAnnotation<ScalarRepresentation>;
  scope?: FragmentScope<ScalarRepresentation>;
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

function assertMember(artifact: OwnedArtifact, node: Expression): void {
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
  if (target.rootExpression !== (artifact.functionRoot ?? artifact.root))
    throw new Error('JS scalar fragment invariant: different prepared scope');
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
  artifact.current = node;
  return () => {
    artifact.current = previous;
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
