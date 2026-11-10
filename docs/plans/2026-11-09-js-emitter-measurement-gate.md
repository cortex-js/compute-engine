# Compiler measurements before the JS scalar emitter pilot

**Status: measured 2026-11-09 at `68672e1b1`. Documentation only.**

The [approved scalar emitter plan](2026-11-09-js-structured-scalar-emitter.md)
requires a fresh measurement after the GLSL removal work. This report supplies
step 7 of the [compile-targets plan](2026-11-08-compile-targets-implementation-plan.md):
source size, `CompileTarget` members and the four statement-compilation paths.
It does not measure runtime or compilation performance.

## Result and recommendation

Proceed with the approved bounded JS pilot, beginning with annotation
materialization and the body-emission seam. Keep it internal and retain the
existing emitter as default. Include effect facts in preparation from the start,
as required by the approval. These counts support a small experiment, not a
cross-target rewrite or a prediction that the pilot will reduce total source.

GLSL removal has materially reduced the GPU-family files, but total compiler
source is larger than the November 5 baseline. The shared target interface is
only two members smaller, and the statement-compilation paths remain separate.
Moving from annotations plus string emission to a small structured body is still
a distinct experiment; the GLSL conversion has not already supplied that body.

The JS pilot should not wait for every GLSL shape reader to move. The step 5
report explicitly leaves `gpuOperandShape()` migration as a separate decision:
preparation and newly constructed nodes still need facts. That work is outside
the bounded JS pilot, and this report does not authorize it. Interval lowering,
which must preserve enclosure, also remains outside the pilot.

## Source counts

Recomputed from committed Git objects, excluding blank lines and lines beginning
with `//`, `/*` or `*` after whitespace. These are the exact filename families
and line rule of the [earlier measurement](2026-11-05-compiler-next-pass-measure.md).
The old baseline was rerun as a control: all five published totals reproduce.

| Family | Original `1872ac457` | Proposal baseline `d43d68f25` | Current `68672e1b1` | Change from original |
| --- | ---: | ---: | ---: | ---: |
| JavaScript (`javascript-*.ts`) | 16,465 | 17,820 | 17,820 | +1,355 |
| GPU (`gpu-*.ts`, `glsl-target.ts`, `wgsl-*.ts`) | 19,523 | 14,298 | 13,797 | −5,726 |
| Python (`python-*.ts`) | 4,680 | 4,686 | 4,686 | +6 |
| Interval (`interval-*.ts`) | 4,333 | 4,384 | 4,384 | +51 |
| Other compilation files | 44,724 | 51,640 | 51,539 | +6,815 |
| All compilation files | 89,725 | 92,828 | 92,226 | +2,501 |

Since the proposal baseline, total compiler source is down 602 counted lines:
501 in the GPU family and 101 in other files. The JavaScript family is unchanged.
The commit that added the approved plan (`e02dcb0b1`) did not add a structured
JS emitter, despite its subject; its source changes concern declared locals and
fragment/destructuring handling.

The filename rule is not an architectural ownership classifier. For example,
`glsl-fragment.ts` and `fragment.ts` fall in “other”, while shared lowering files
can serve multiple targets. GPU-family shrinkage therefore does not mean that
5,726 lines of functionality disappeared. These counts also include unrelated
changes between revisions. They are not attribution of net growth to this pilot.

## Target interface

A TypeScript AST count of the direct members of the `CompileTarget` interface
in `types.ts` gives **94 → 92 → 92** at the three revisions above. This counts
interface members, not call sites, fields set by each target, or inherited types.

Relative to the original baseline, five members were removed:
`checkOperandShapes`, `storageRead`, `hostInputVars`, `storageBufferBindings`,
and `storageBuffersRead`. Three were added: `shaderLoopJumps`,
`bindStatementEffects`, and `gpuParameterFacts`.

The small net reduction is not evidence that the remaining members can all be
removed by an IR. The JS body-emission seam should be internal to JS assembly;
adding a generic `CompileTarget` callback merely to launch the experiment would
increase the coupling this work is intended to test.

## Statement-compilation paths

These are AST function spans, filtered by the same code-line rule. They exclude
leading documentation comments and include nested function bodies. They are not
counts of independent or duplicate handlers.

| Function | Source file | Original | Proposal baseline | Current |
| --- | --- | ---: | ---: | ---: |
| `compileBlock` | `compile-blocks.ts` | 477 | 541 | 491 |
| `compileLoopBody` | `compiler-core.ts` | 102 | 112 | 112 |
| `compilePythonStatements` | `python-target.ts` | 88 | 88 | 88 |
| `compileStatementList` | `compile-blocks.ts` | 29 | 28 | 28 |

All four entry points remain. Inspection confirms the important distinction:
`compileStatementList` delegates block bodies to `compileBlock` with the final
value unused; it is not a fourth wholly independent block implementation.
JS/interval loop bodies and Python statement bodies still have separate
statement dispatch and preprocessing. The facade exposes these functions through
`BaseCompiler`; their implementations reside in the files above.

A scalar root pilot does not replace any of these four paths. Its first
structural success criterion is narrower: selected scalar operations and lazy
branches emit from typed operations and regions, without another generic walk
or reconstruction through the JS source-string statement registry. Consolidating
statement preprocessing belongs to later function/local/loop work.

## Implementation boundary and subsequent evidence

The next implementation slice should factor the existing preparation and result
assembly boundaries without changing the default route. It must retain numeric
policy, input normalization, dependencies and reconstruction metadata, and make
the prepared annotation available without first invoking legacy emission.
Effect classification must use the resolved binding and target policy, including
trusted purity declarations. It must not be inferred from the spelling of an
emitted expression.

Then build the small operation/region representation and independent emitter
specified by the approved plan. Unknown effects remain ordered; occurrences of
non-pure operations remain distinct. Do not enable CSE or reordering in this
first implementation. When those transforms are introduced, paired pure and
non-pure tests must demonstrate the distinction.

The proposed 10% total-compilation and 5% warm-execution budgets remain
unmeasured. Only the paired emitter experiment can determine those costs. These
source counts establish neither speed nor value parity. Correctness, lazy
execution, metadata fidelity and absence of hidden legacy fallback remain hard
gates before expansion.

No compiler code, tests, public targets, or Tycho consumers changed for this
measurement. No worktree, runtime suite, corpus run or dual review was needed:
all measurements read immutable committed source, and the deliverable is this
document. Repository links and whitespace were checked before staging.

## Reproduce the counts

Run the following from the repository root with Node and the repository's
TypeScript dependency. The fixed revisions make the measurement independent of
uncommitted work. The AST query also prints the interface member names for
comparison and function locations for inspection.

```js
const cp = require('node:child_process');
const ts = require('typescript');
const git = (...args) => cp.execFileSync('git', args, {
  encoding: 'utf8', maxBuffer: 20_000_000,
});
const root = 'src/compute-engine/compilation/';
const count = (s) => s.split('\n').filter(
  (line) => !/^\s*(\/\/|\/\*|\*|$)/.test(line)
).length;
for (const rev of ['1872ac457', 'd43d68f25', '68672e1b1']) {
  const paths = git('ls-tree', '-r', '--name-only', rev, '--', root)
    .trim().split('\n')
    .filter((p) => p.endsWith('.ts') && !p.slice(root.length).includes('/'));
  const totals = { javascript: 0, gpu: 0, python: 0, interval: 0, other: 0, all: 0 };
  const routines = [];
  let members;
  for (const path of paths) {
    const source = git('show', `${rev}:${path}`);
    const name = path.slice(root.length);
    const family = name.startsWith('javascript-') ? 'javascript'
      : /^(gpu-|wgsl-)/.test(name) || name === 'glsl-target.ts' ? 'gpu'
      : name.startsWith('python-') ? 'python'
      : name.startsWith('interval-') ? 'interval' : 'other';
    totals[family] += count(source);
    totals.all += count(source);
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    if (name === 'types.ts') {
      const declaration = ast.statements.find((n) =>
        ts.isInterfaceDeclaration(n) && n.name.text === 'CompileTarget');
      members = declaration.members.map((n) => n.name.getText(ast));
    }
    if (['compile-blocks.ts', 'compiler-core.ts', 'python-target.ts'].includes(name)) {
      for (const n of ast.statements) {
        if (ts.isFunctionDeclaration(n) && [
          'compileBlock', 'compileLoopBody', 'compilePythonStatements',
          'compileStatementList',
        ].includes(n.name?.text)) {
          routines.push({ name: n.name.text, file: name,
            line: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1,
            codeLines: count(n.getText(ast)) });
        }
      }
    }
  }
  console.log(JSON.stringify({ rev, totals, memberCount: members.length,
    members, routines }, null, 2));
}
```
