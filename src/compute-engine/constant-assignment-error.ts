/**
 * The refusal to assign a value to a constant: `ce.assign('Pi', 3)`, an
 * `Assign` whose target is a `const` binding, a sequence definition
 * (`F_0 := 1`) that would replace the value of a constant `F`.
 *
 * It is thrown to the host, as before. The message is unchanged, so a host
 * that reads the message still works. The error also carries the stable
 * code `constant-assignment` and the name of the constant, so that a caller
 * can identify it without reading the message. Epsil (`executeEpsil()`)
 * catches it and makes the error value
 * `["Error", ["ErrorCode", "constant-assignment", name]]` from it.
 *
 * A caller identifies the error by its `name` property, not with
 * `instanceof`: a plugin bundle has its own copy of this class, and the
 * class identity is different on each side of the boundary.
 */
export class ConstantAssignmentError extends Error {
  readonly code = 'constant-assignment';
  /** The name of the constant. (`name` itself is the property of `Error`
   * that holds the class name.) */
  readonly constantName: string;
  /** The source range of the `Assign` expression that made the write, when
   * that expression carries source offsets (an expression of an Epsil
   * program does). `undefined` for a call of `ce.assign()` by the host, and
   * for an `Assign` built without source offsets. Set by
   * `noteConstantAssignmentSite()` while the error goes out of the `Assign`
   * node. */
  sourceOffsets: [start: number, end: number] | undefined = undefined;
  constructor(constantName: string) {
    super(`Cannot assign a value to the constant "${constantName}"`);
    this.name = 'ConstantAssignmentError';
    this.constantName = constantName;
  }
}

/**
 * Record on a `ConstantAssignmentError` the source range of the `Assign`
 * node that made the write. The evaluation of each function node calls
 * this when the evaluate handler of the node throws. The error goes out of
 * the innermost node first, so the first `Assign` node with source offsets
 * sets the range, and the enclosing nodes do not change it.
 *
 * Epsil (`executeEpsil()`) uses the range to find whether the static check
 * reported the same assignment: the static report is at the range of the
 * same `Assign` node of the program.
 *
 * The error is identified by its `name` property, not with `instanceof`
 * (see the class above).
 */
export function noteConstantAssignmentSite(
  e: unknown,
  operator: string,
  sourceOffsets: [start: number, end: number] | undefined
): void {
  if (
    operator !== 'Assign' ||
    sourceOffsets === undefined ||
    !(e instanceof Error) ||
    e.name !== 'ConstantAssignmentError'
  )
    return;
  const error = e as { sourceOffsets?: [number, number] };
  error.sourceOffsets ??= sourceOffsets;
}
