# Program type/signature demand investigation

The coordinator requested this investigation after committing guard revision
`050a14088`. That revision did not establish performance recovery. The original
Program semantics, loop-widening fixpoint, explicit contracts and diagnostics are
constraints, not optimization options.

Distinguish four demands: callable identity, parameter compatibility, result type
and effects. Record actual derivations separately from getter requests, and
initial evidence reads separately from rejoin passes. Repeated reads are not
redundancy evidence without unchanged relevant inputs; incomplete observer
coverage must remain explicit. An existing helper that rejects before examining
an input, however, proves that input unnecessary for that invocation without a
new dependency analysis.

The initial source audit identifies eager operand-type arguments passed to
operator- or answer-guarded point/absence helpers. A private diagnostic fork will
attribute those demands and record binding/context observations. Production code
is unchanged at this stage. No persistent cache, dependency tracking, special
evaluator, Document work or inference-contract change is authorized.

If the demand proof supports a bounded reduction, implement it through the
existing helper owner, validate the affected paths and obtain independent Sol
delta review. Compare original baseline, current Program implementation and
revision in one matched timing protocol using the existing small Program and
real notebook fixtures. Keep diagnostic instrumentation out of timed builds.
Report unresolved regressions and preserve the net production deletion gains.
If recovery instead requires a precision/contract change, stop with its smallest
concrete choice and witnesses.
