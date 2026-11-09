/** Compile-local facts for the internal scalar JavaScript fragment. */
import type { Expression } from '../global-types.js';
import type { CompileTarget } from './types.js';
import type { FragmentAnnotation, FragmentValueFacts } from './fragment.js';

export type ScalarRepresentation = 'number' | 'boolean' | 'complex';
type Facts = FragmentValueFacts<ScalarRepresentation>;
type ScalarFragmentArtifact = {
  readonly root: Expression;
  readonly annotate: () => FragmentAnnotation<ScalarRepresentation>;
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
] as const;
type Policy = Pick<CompileTarget<Expression>, (typeof policyKeys)[number]>;
type OwnedArtifact = ScalarFragmentArtifact & {
  readonly policy: Policy;
  annotation?: FragmentAnnotation<ScalarRepresentation>;
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
    policy,
  };
}

function assertPolicy(
  artifact: OwnedArtifact,
  target: CompileTarget<Expression>
): void {
  if (policyKeys.some((key) => target[key] !== artifact.policy[key]))
    throw new Error('JS scalar fragment invariant: different prepared policy');
}

function facts(artifact: OwnedArtifact, node: Expression): Facts {
  const value = artifact.annotation?.scope.facts.get(node);
  if (value === undefined || !('representation' in value))
    throw new Error(
      'JS scalar fragment invariant: missing prepared-node facts'
    );
  return value;
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
  } else facts(artifact, node);
}

/** Enter only after the compiler has installed its mode and folding policy. */
export function enterScalarFragment(
  node: Expression,
  target: CompileTarget<Expression>
): (() => void) | undefined {
  const artifact = (target as AnnotatedTarget)[artifactKey];
  if (artifact === undefined) return undefined;
  assertPolicy(artifact, target);
  if (target.rootExpression !== artifact.root || target.boundVars?.size)
    throw new Error('JS scalar fragment invariant: different prepared scope');
  if (artifact.annotation === undefined) {
    if (node !== artifact.root)
      throw new Error('JS scalar fragment invariant: different prepared root');
    const annotation = artifact.annotate();
    if (annotation.root !== artifact.root || annotation.refusal)
      throw new Error('JS scalar fragment invariant: invalid annotation');
    artifact.annotation = annotation;
  }
  facts(artifact, node);
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
