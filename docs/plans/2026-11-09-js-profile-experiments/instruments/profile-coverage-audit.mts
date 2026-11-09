import { observedConstructor, inspectProfile, installPublicObserver } from './profile-coverage-capture.mts';
import { appendFileSync as appendProfile } from 'node:fs';
/**
 * CE code-generation audit: record the JavaScript / interval-js / GLSL code the
 * Compute Engine emits for the rows of REAL documents, so a CE bump can be
 * compared against the previous release's output.
 *
 * Mechanism: every product compile goes through `resolveCECompile`, which
 * reads `compile` from the registered CE module namespace. This script
 * registers a namespace whose `compile` records (expression LaTeX, options,
 * target, emitted code, preamble, diagnostics, duration) and then drives two
 * corpora through the product's own classify → normalize → resolve pipeline
 * (the same node harness as the classification census in `scripts/repros/`):
 *
 *   - the Desmos CORE corpus (`_TASK/desmos/desmos-corpus/CORE_CORPUS.txt`),
 *     converted by the product importer; `--all` runs every state instead;
 *   - the native showcase entries (`SHOWCASE` in template-data.js). An
 *     entry with an Epsil `prelude` gets it as the first cell of its
 *     document, as the app seeds it (`buildEditorFromEntry` in
 *     `src/graph-paper/modes/document-mode.ts`). The prelude check runs in
 *     this process (no worker in node: the runner's iteration budget
 *     `PRELUDE_ITERATION_BUDGET` applies, and no deadline), and the manager
 *     replays the result before the rows, so a row that calls a prelude
 *     function (`B(x, -y)` in `burning-ship`) compiles against the bound
 *     function: by reference, with the function's body in the GLSL preamble.
 *     Each showcase document records its prelude outcome (`prelude`: ran,
 *     valid, names, diagnostics, check time; `null` for an entry without
 *     one). An invalid prelude is a document `error` and the entry's rows do
 *     not run. The `buddhabrot` prelude makes about 28 million passes; it
 *     runs in full.
 *
 *   `--showcase-only <id>` runs one showcase entry and no Desmos state, to
 *   the explicit `--full` and `--digest` paths only
 *   (`tests/node/graph-paper/codegen-audit-showcase-prelude.test.ts` uses it).
 *
 * The GLSL band is compiled LAZILY by `<math-plot>` in the browser, so after
 * resolving each row the script compiles every `glsl-deferred` function the
 * same way the element does (`resolveCECompile(fn.expr, { to: "glsl", byReference })`).
 * Only CE's emitted code and preamble are recorded — not Tycho's shader
 * scaffolding or JS wrappers.
 *
 * Fidelity notes (what mirrors the product, and how):
 *   - every cell with LaTeX (equation, action, solver, …) registers with the
 *     document manager, as `cellsFromRows` does in document-mode — action
 *     cells are what mark a collection as action-written and so BY REFERENCE;
 *   - the deferred GLSL compile follows `MathPlotElement.compileDeferredGlsl`:
 *     snapshot kernels compile `snapshotExpression()`, sampler widths for
 *     by-reference carriers come from the manager's current binding (the
 *     element reads them from its values record), and a declined or thrown
 *     primary compile retries with `exprFallback()` — a snapshot kernel does
 *     not retry;
 *   - a 2-D heatmap colour formula that reads a document list by reference
 *     also compiles its GLSL field with the list as a texture, as document
 *     mode does (`compileHeatmapListColor`); the reduced renderer of
 *     `normalizeInferredSeries` does not ask for that field;
 *   - 3-D members (surface, parametric-curve, parametric-surface,
 *     spherical-surface, cylindrical-surface, analyticLandscape,
 *     implicit-surface) go through `resolveVolumeSeriesData`, after the
 *     manager is told the document's dimension, as the product does.
 *   - the picture is the LOAD-time one. A formula-seeded, action-written
 *     collection (the Game of Life board) is bound to its seed formula at load
 *     and compiles BOUND; the product re-registers it as a numeric list at the
 *     first action write, after which its readers compile BY REFERENCE (and,
 *     on the GPU, sampler-backed). No action is fired here, so that later
 *     state is not recorded.
 *
 * Usage:
 *   npm run audit:ce-codegen                       # record, write full + digest
 *   npm run audit:ce-codegen -- --compare <file>   # …and diff against a previous run
 *   npm run audit:ce-codegen -- --all              # full Desmos corpus, not CORE
 *   npx tsx scripts/audit-ce-codegen.mts --help    # usage; records nothing
 *
 * Running with no arguments RECORDS — it is not a dry run, and it overwrites
 * both default output paths for the installed CE version. An unrecognized or
 * value-less flag therefore exits 2 rather than being ignored (it used to be
 * ignored, so `--help` silently started a corpus run and clobbered an
 * adoption's arm, 2026-09-10).
 *
 * Outputs (one file per CE version, overwritten on re-run):
 *   full   `_TASK/desmos/desmos-corpus/codegen-audit/ce-<version>.json`
 *          — every distinct (target, input, code, preamble, error) record with
 *          the code text. Gitignored with the corpus it depends on.
 *   digest `tests/fixtures/ce-codegen/ce-<version>.json`
 *          — the same records without code text: a hash of code+preamble,
 *          lengths, decline message, compile time. Tracked, so the comparison
 *          survives a machine change.
 * `--full <path>` / `--digest <path>` override the locations. `--compare`
 * accepts either shape (the digest's hash is what is compared). Compile
 * durations are wall-clock on a shared box and vary several-fold with load;
 * the comparison only reports timing deltas that are both ≥100 ms and ≥2×.
 */
import {
  readFileSync,
  writeFileSync,
  writeSync,
  mkdirSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { execSync } from "node:child_process";
import * as ceModule from "@cortex-js/compute-engine";
import type { ComputeEngine, Expression } from "@cortex-js/compute-engine";
import {
  registerComputeEngineModule,
  resolveCECompile,
} from "../src/plot-core/ce-module-registry.js";

// ── Recorder ────────────────────────────────────────────────────────────────

interface CompileRecord {
  /** Which document and which authored row produced this compile. */
  corpus: string;
  doc: string;
  /** Authored LaTeX; `(setup)` = a document definition compiled at load. */
  row: string;
  /** Set on a `--shadow-wgsl` record: the target of the product compile it
   *  copies. Records are merged by (target, input, output), so a shadow
   *  compile identical to a product compile keeps the first one's value. */
  shadowOf?: string;
  /** LaTeX of the expression handed to CE (after Tycho's lowerings). */
  input: string;
  target: string;
  options: Record<string, unknown>;
  success: boolean;
  code?: string;
  preamble?: string;
  error?: string;
  unsupported?: string[];
  freeSymbols?: string[];
  /** `CompilationResult.freeSymbolTypes` (CE main after 2026-09-24): per free
   *  symbol, the engine type, the type the compiled code reads it as on the
   *  target (`lowered`: `float`/`vec2`/`vec3` on glsl, `number`/`complex`/
   *  `color` on javascript) and whether it was declared or inferred. Absent
   *  on an engine that does not report it. Recorded so a run can list every
   *  symbol a document leaves to inference — what `strictTypes: true` would
   *  decline — without changing what is compiled. */
  freeSymbolTypes?: Record<
    string,
    { type: string; lowered: string; provenance: string }
  >;
  /** `CompilationResult.mode` (CE 0.116.0+): the arithmetic discipline the
   *  returned code was compiled under, `strict` or `complex`, never `auto`.
   *  Absent on a decline and on an engine that does not report it. */
  mode?: string;
  /** `CompilationResult.promoted`: true when an unknown-sign `Sqrt`, `Ln`,
   *  `Log` or non-integer `Power` was lowered through the complex kernel —
   *  the code computes a different value on a real-only target. Recorded so
   *  a release can count the complex-lane kernels of real-valued plots (CE
   *  request of 2026-10-08, `docs/COMPUTE_ENGINE_LOG.md` § "CE notices and
   *  release notices moved out of `COMPUTE_ENGINE.md` (2026-10-23)"). */
  promoted?: boolean;
  /** `CompilationResult.escalation`: under `mode: "auto"`, the diagnostic of
   *  the strict attempt that declined with a lane mismatch before the
   *  compilation was redone in complex mode. Only the citable fields are
   *  kept; `message` repeats them in prose. */
  escalation?: { code: string; boundary?: string; binding?: string };
  durationMs: number;
  threw?: string;
}

const records: CompileRecord[] = [];
/** `shadowOf` is set only while `--shadow-wgsl` records a shadow compile: the
 *  target of the product compile it copies. */
const context: {
  corpus: string;
  doc: string;
  row: string;
  shadowOf?: string;
} = { corpus: "", doc: "", row: "" };

function stripOptions(o: unknown): Record<string, unknown> {
  if (!o || typeof o !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (typeof v === "function") {
      out[k] = "(function)";
      continue;
    }
    if (k === "functions" || k === "operators" || k === "target") {
      out[k] =
        v && typeof v === "object"
          ? `(${Object.keys(v).length} entries)`
          : String(v);
      continue;
    }
    out[k] = v;
  }
  return out;
}

const rawCompile = (ceModule as unknown as { compile: Function }).compile;

/** `--shadow-wgsl`: after each `glsl` compile, compile the same expression
 *  with the same options to `wgsl` and record that too (target `wgsl`). The
 *  shadow compile runs inside the same call, so it sees the same scope
 *  declarations that `resolveCECompile` pushed for the GLSL compile (sampler
 *  widths, by-reference carriers). Its result is discarded: the product
 *  still receives the GLSL result, so the rest of the run is unchanged. Used
 *  to measure what a move from WebGL to WebGPU would decline. */
const shadowWgsl = process.argv.includes("--shadow-wgsl");

function recordingCompile(expr: Expression, options?: Record<string, unknown>) {
  const result = recordOneCompile(expr, options);
  if (!shadowWgsl) return result;
  const to = String(options?.to ?? "javascript");
  // A `javascript` compile is shadowed on BOTH shader targets, so the run
  // also shows expressions outside today's GPU lane that one shader target
  // accepts and the other declines. `mode` is dropped: the shader targets
  // decline any `mode` option.
  const shadowTargets =
    to === "glsl" ? ["wgsl"] : to === "javascript" ? ["glsl", "wgsl"] : [];
  const { mode: _mode, ...rest } = options ?? {};
  // The `vars` option maps a name to its spelling on the target. A
  // `javascript` compile spells it `_.name`; the shader targets read the bare
  // name (`freeSymbolSource` in src/plot-core/ce-module-registry.ts).
  if (rest.vars && typeof rest.vars === "object")
    rest.vars = Object.fromEntries(
      Object.keys(rest.vars).map((n) => [n, n]),
    );
  const shader: Record<string, CompileRecord> = {};
  if (to === "glsl") shader.glsl = records[records.length - 1];
  for (const target of shadowTargets) {
    const saved = context.shadowOf;
    context.shadowOf = to;
    try {
      recordOneCompile(expr, { ...rest, to: target });
    } catch {
      // Recorded with `threw` by recordOneCompile; the product never sees it.
    } finally {
      context.shadowOf = saved;
    }
    shader[target] = records[records.length - 1];
  }
  if (shader.glsl?.success && shader.wgsl?.success)
    collectNumericCase(expr, rest, shader.glsl, shader.wgsl);
  return result;
}

/** One expression that both shader targets compiled, with float64 reference
 *  values from the `javascript` target at fixed sample points. A browser
 *  page runs the GLSL and the WGSL code at the same points on the GPU and
 *  compares the three (`scripts/repros/2026-10-26-wgsl-glsl-gpu-compare.mts`). */
interface NumericCase {
  doc: string;
  row: string;
  input: string;
  names: string[];
  glsl: { code: string; preamble: string };
  wgsl: { code: string; preamble: string };
  /** `inputs[i][k]` is the value of `names[k]` at sample `i`. */
  inputs: number[][];
  /** The JavaScript value at sample `i`: a number, a tuple of numbers, a
   *  boolean as 0 or 1, or null when the value is not one of those. A
   *  non-finite number is the string `"NaN"`, `"Infinity"` or `"-Infinity"`,
   *  because JSON writes every one of them as null. */
  ref: (number | string | (number | string)[] | null)[];
}
const numericCases: NumericCase[] = [];
const numericSeen = new Set<string>();

/** Sample values: a deterministic mix of wide, unit, integer and large
 *  inputs, so that periodic, piecewise and rounding functions are all
 *  reached. The same seed gives the same points in every run. */
function sampleInputs(count: number, width: number): number[][] {
  let s = 0x2545f491;
  const rnd = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    const row: number[] = [];
    for (let k = 0; k < width; k++) {
      const u = rnd();
      switch (i % 4) {
        case 0:
          row.push(Math.fround(-10 + 20 * u));
          break;
        case 1:
          row.push(Math.fround(-1 + 2 * u));
          break;
        case 2:
          row.push(Math.round(-5 + 10 * u));
          break;
        default:
          row.push(Math.fround(-100 + 200 * u));
      }
    }
    out.push(row);
  }
  return out;
}

function collectNumericCase(
  expr: Expression,
  options: Record<string, unknown>,
  glsl: CompileRecord,
  wgsl: CompileRecord,
): void {
  // Only scalar `f32` inputs: a sampler, a vector or a list input needs
  // texture plumbing that the GPU page does not build.
  if (options.sampler || options.byReference) return;
  const types = wgsl.freeSymbolTypes ?? {};
  const names = Object.keys(types).sort();
  if (names.some((n) => types[n].lowered !== "f32")) return;
  const key = `${glsl.code}\n${glsl.preamble ?? ""}\n${wgsl.code}`;
  if (numericSeen.has(key)) return;
  numericSeen.add(key);
  // The `vars` option maps a name to its spelling on the target; the
  // JavaScript spelling reads the runner's argument bag.
  const vars = options.vars
    ? Object.fromEntries(
        Object.keys(options.vars as object).map((n) => [n, `_.${n}`]),
      )
    : undefined;
  let js: { success?: boolean; run?: Function };
  try {
    js = rawCompile(expr, {
      ...options,
      ...(vars ? { vars } : {}),
      to: "javascript",
      mode: "strict",
    });
  } catch {
    return;
  }
  if (!js?.success || typeof js.run !== "function") return;
  const inputs = sampleInputs(64, names.length);
  const ref = inputs.map((row) => {
    try {
      const v = js.run!(Object.fromEntries(names.map((n, k) => [n, row[k]])));
      const enc = (x: number): number | string =>
        Number.isFinite(x) ? x : String(x);
      if (typeof v === "number") return enc(v);
      if (typeof v === "boolean") return v ? 1 : 0;
      if (Array.isArray(v) && v.every((x) => typeof x === "number"))
        return (v as number[]).map(enc);
      return null;
    } catch {
      return null;
    }
  });
  numericCases.push({
    doc: context.doc,
    row: context.row,
    input: glsl.input,
    names,
    glsl: { code: glsl.code!, preamble: glsl.preamble ?? "" },
    wgsl: { code: wgsl.code!, preamble: wgsl.preamble ?? "" },
    inputs,
    ref,
  });
}

function recordOneCompile(
  expr: Expression,
  options?: Record<string, unknown>,
) {
  const captured = inspectProfile(expr, options, context);
  const t = performance.now();
  let latex = "(unserializable)";
  try {
    latex = expr.latex;
  } catch {}
  const rec: CompileRecord = {
    ...context,
    input: latex,
    target: String(options?.to ?? "javascript"),
    options: stripOptions(options),
    success: false,
    durationMs: 0,
  };
  let r:any;
  let compileError:unknown;
  let didThrow=false;
  try {
    r = rawCompile(expr, options);
    rec.durationMs = Math.round((performance.now() - t) * 100) / 100;
    rec.success = r?.success === true;
    if (typeof r?.code === "string") rec.code = r.code;
    if (typeof r?.preamble === "string" && r.preamble.trim())
      rec.preamble = r.preamble;
    if (typeof r?.error === "string") rec.error = r.error;
    if (Array.isArray(r?.unsupported) && r.unsupported.length)
      rec.unsupported = r.unsupported;
    if (Array.isArray(r?.freeSymbols)) rec.freeSymbols = r.freeSymbols;
    if (r?.freeSymbolTypes && typeof r.freeSymbolTypes === "object")
      rec.freeSymbolTypes =
        r.freeSymbolTypes as CompileRecord["freeSymbolTypes"];
    if (typeof r?.mode === "string") rec.mode = r.mode;
    if (typeof r?.promoted === "boolean") rec.promoted = r.promoted;
    if (r?.escalation && typeof r.escalation === "object") {
      const e = r.escalation as {
        code?: unknown;
        boundary?: unknown;
        binding?: unknown;
      };
      rec.escalation = {
        code: String(e.code ?? "unknown"),
        ...(typeof e.boundary === "string" ? { boundary: e.boundary } : {}),
        ...(typeof e.binding === "string" ? { binding: e.binding } : {}),
      };
    }
  } catch (e) {
    rec.durationMs = Math.round((performance.now() - t) * 100) / 100;
    rec.threw = String((e as Error).message).slice(0, 300);
    didThrow=true;compileError=e;
  }
  appendProfile(process.env.PROFILE_CAPTURE!, JSON.stringify({...captured, success:rec.success, error:rec.error, threw:rec.threw, freeSymbols:rec.freeSymbols, freeSymbolTypes:rec.freeSymbolTypes})+'\n');
  records.push(rec);
  if(didThrow)throw compileError;
  return r;
}
registerComputeEngineModule({
  ...(ceModule as unknown as Record<string, unknown>),
  ComputeEngine: observedConstructor(ceModule.ComputeEngine),
  compile: recordingCompile,
} as never);

// ── Product pipeline (after the recorder is registered) ─────────────────────

import {
  resolveSeriesData,
  resolveVolumeSeriesData,
} from "../src/plot/resolve-fn.js";
import type { PlotSeriesInput } from "../src/plot/types.js";
import type { VolumeSeriesInput } from "../src/plot-3d/types.js";
import { convertDesmosState } from "../src/graph-paper/desmos-import/index.js";
import {
  DocumentCEManager,
  numericListElements,
} from "../src/graph-paper/graph/document-ce-manager.js";
import type { CEConfig } from "../src/graph-paper/editors/settings/ce-config.js";
import { inferSeries } from "../src/graph-paper/graph/series-inference.js";
import type { InferredSeries } from "../src/graph-paper/graph/series-inference.js";
import { classifyFormulaArtifact } from "../src/plot-core/classify-formula.js";
import type { ClassifyOptions } from "../src/plot-core/classify-formula.js";
import { MaterializeBudget } from "../src/plot-core/materialize-budget.js";
import {
  compileRowColorExpression,
  normalizeInferredSeries,
} from "../src/graph-paper/graph/hydrate-plot.js";
import { mergeSeriesPatch } from "../src/graph-paper/graph/state.js";
import type {
  SeriesInput,
  SeriesPatch,
} from "../src/graph-paper/graph/state.js";
import { resolveSourceAuthoredStyle } from "../src/graph-paper/graph/source-authored-style.js";
import { collectColorDefinitions } from "../src/graph-paper/graph/style-expressions.js";
import type {
  ColorDefinitions,
  StyleDefinitionCell,
} from "../src/graph-paper/graph/style-expressions.js";
import { canonicalNameToLatex } from "../src/graph-paper/variables/reference-rewrite.js";
import {
  resolveAllComputedCollections,
  makeComputedSymbolResolver,
} from "../src/graph-paper/graph/computed-collections.js";
import {
  canonicalSymbolFromName,
  documentVariableRangesOf,
  runVariablePass,
  type VariableSource,
} from "../src/graph-paper/variables/dependency-graph.js";
import { variableDefinitionFromFields } from "../src/graph-paper/variables/variable-model.js";
import {
  SolverRegistry,
  createDocumentSolverNamespace,
  resolveScalarBodies,
  resolveTableColumns,
  type SolverTableCellSource,
} from "../src/graph-paper/graph/solver-registry.js";
import { sanitizeUniformName } from "../src/graph-paper/variables/sanitize-uniform-name.js";
import { createPreludeCheckService } from "../src/graph-paper/graph/prelude/prelude-check.js";
import type { PreludeDiagnostic } from "../src/plot-core/prelude-runner.js";
import {
  SHOWCASE,
  definitionLatex,
} from "../src/graph-paper/onboarding/templates.js";
import { resolveAuditOutputs } from "./lib/codegen-audit-outputs.mjs";

const CONFIG: CEConfig = {
  angleUnit: "radians",
  decimalSeparator: ".",
  digitGroupSeparator: "\\,",
  numberNotation: "auto",
  digits: "auto",
  repeatingDecimal: "auto",
  fractionStyle: "quotient",
  rootStyle: "radical",
  logicStyle: "word",
  multiplySymbol: "cross",
  prettify: true,
  avoidExponentsInRange: { min: -4, max: 5 },
  dmsFormat: false,
};
const CORPUS_DIR = "_TASK/desmos/desmos-corpus";
const STATES: Record<string, string> = {
  art: `${CORPUS_DIR}/states`,
  neyret: "_TASK/requirements/neyret-corpus/states",
};

/* eslint-disable @typescript-eslint/no-explicit-any */
interface DocLike {
  cells: any[];
  /** The Epsil prelude of a showcase entry (`PlotEntry.prelude`). The app
   *  seeds it as the first cell of the document, a prelude cell
   *  (`buildEditorFromEntry` in `src/graph-paper/modes/document-mode.ts`),
   *  and the manager replays its result before the rows at each
   *  registration pass. */
  prelude?: string;
  dimension?: 3;
  angleUnit?: "radians" | "degrees";
  complexMode?: boolean;
  desmosPiecewiseBroadcast?: boolean;
  rejectOutOfRangeListIndexes?: boolean;
  seriesPatchById?: Record<string, SeriesPatch>;
}
interface Setup {
  doc: DocLike;
  mgr: DocumentCEManager;
  ce: ComputeEngine;
  values: Record<string, number>;
  docVarMap: Record<string, string> | undefined;
  resolved: Record<string, Expression>;
  carrierNames: ReadonlySet<string>;
  materializeBudget: MaterializeBudget;
  colorDefinitions: ColorDefinitions;
}

/** What a showcase document records about its prelude: whether it ran,
 *  whether its result is applied, the names it binds, its diagnostics (of
 *  both severities) and the run time of the check. */
interface PreludeSummary {
  ran: boolean;
  valid: boolean;
  names: string[];
  diagnostics: PreludeDiagnostic[];
  runMs?: number;
}

/** The row id of the prelude cell that {@link setupState} seeds. */
const PRELUDE_ROW_ID = 0;

/** The first diagnostics of an invalid prelude, as one line for
 *  `DocSummary.error`. */
function preludeErrorText(summary: PreludeSummary): string {
  const errors = summary.diagnostics.filter((d) => d.severity === "error");
  const first = errors[0] ?? summary.diagnostics[0];
  return (
    `prelude: ${first ? `${first.code}: ${first.message}` : "the check gave no valid result"}` +
    (errors.length > 1 ? ` (and ${errors.length - 1} more)` : "")
  ).slice(0, 300);
}

/**
 * Build the document's manager and run its load-time passes. A document
 * with a prelude gets it as its first cell, as the app seeds a showcase
 * entry; the check runs in this process (no worker in node, so the check
 * has the runner's iteration budget, `PRELUDE_ITERATION_BUDGET`, and no
 * deadline), and the manager replays the result before its rows when the
 * check ends. `onPrelude` receives the outcome; an invalid prelude throws
 * after it, so the caller records a document-level error.
 */
async function setupState(
  doc: DocLike,
  onPrelude?: (summary: PreludeSummary) => void,
): Promise<Setup> {
  const prelude = doc.prelude?.trim() ? doc.prelude : undefined;
  const mgr = new DocumentCEManager(
    CONFIG,
    prelude
      ? {
          preludeService: createPreludeCheckService({
            startWorker: () => null,
          }),
        }
      : undefined,
  );
  mgr.setAngleUnit(doc.angleUnit ?? null);
  mgr.setDesmosPiecewiseBroadcast(doc.desmosPiecewiseBroadcast === true);
  mgr.setComplexMode(doc.complexMode === true);
  mgr.setRejectOutOfRangeListIndexes(doc.rejectOutOfRangeListIndexes === true);
  // A 3-D document's `\rho = f(\theta, \phi)` row is a spherical surface; the
  // manager reads it as a definition of a function `rho` unless it knows the
  // dimension BEFORE the rows register, and the row then reaches `compile()`
  // with `rho` typed as a function. The product sets it first too
  // (`src/graph-paper/gallery/reference-corpus-render.ts`). Probe:
  // `scripts/repros/2026-10-27-spherical-rho-dimension-probe.mts`.
  mgr.setDocumentDimension(doc.dimension === 3 ? 3 : undefined);
  // Mirror `cellsFromRows` (document-mode): every row with LaTeX registers,
  // not only equations — an action cell's `\to` is what marks its target
  // collection as action-written, hence compiled by reference.
  mgr.setCells([
    ...(prelude
      ? [
          {
            latex: "",
            visible: false,
            prelude: { id: PRELUDE_ROW_ID, appliedSource: prelude },
          },
        ]
      : []),
    ...doc.cells
      .filter((c: any) => typeof c.latex === "string" && c.latex.trim())
      .map((c: any) => ({ latex: c.latex, visible: c.visible !== false })),
  ]);
  mgr.setVariableNames(
    doc.cells.flatMap((c: any) =>
      c.type === "variable"
        ? [c.name]
        : c.type === "point-variable"
          ? [c.xName, c.yName]
          : [],
    ),
  );
  mgr.evaluate();
  if (prelude) {
    // The check's compiles (the prelude's statements, on the check's own
    // engine) and the registration pass that applies the result are
    // attributed to this row.
    const row = context.row;
    context.row = "(prelude)";
    await mgr.preludeSettled;
    context.row = row;
    const state = mgr.preludeStateOf(PRELUDE_ROW_ID);
    const applied = mgr.appliedPrelude;
    const summary: PreludeSummary =
      state?.kind === "applied" && applied?.valid
        ? {
            ran: true,
            valid: true,
            names: [...state.names],
            diagnostics: [...state.warnings],
            runMs: Math.round(state.runMs),
          }
        : {
            ran: state?.kind === "invalid",
            valid: false,
            names: [],
            diagnostics:
              state?.kind === "invalid"
                ? [...state.diagnostics]
                : [
                    {
                      severity: "error",
                      code: "prelude-not-applied",
                      message: `the prelude cell is in the state ${state?.kind ?? "(none)"} after its check`,
                      range: [0, prelude.length],
                    },
                  ],
          };
    onPrelude?.(summary);
    if (!summary.valid) throw new Error(preludeErrorText(summary));
  }
  const ce = mgr.ce;

  const values: Record<string, number> = {};
  const sources: VariableSource[] = [];
  for (const cell of doc.cells as any[]) {
    if (cell.type === "point-variable") {
      sources.push({
        sourceId: `${cell.id}.${cell.xName}`,
        name: cell.xName,
        value: cell.xValue,
      });
      sources.push({
        sourceId: `${cell.id}.${cell.yName}`,
        name: cell.yName,
        value: cell.yValue,
      });
    } else if (cell.type === "variable") {
      sources.push({
        sourceId: String(cell.id),
        name: cell.name,
        value: cell.value,
        // ROADMAP DZ: the domain is what the product promises a range from
        // (`buildPlotDocumentHydrationContext` / `rowToSource` carry it);
        // without it every slider compiles `real` and the audit cannot see
        // the sign/range specialization.
        domain: variableDefinitionFromFields(cell).domain,
      });
    }
  }
  const solverCells = (doc.cells as any[]).filter((c) => c.type === "solver");
  if (solverCells.length > 0) {
    const registry = new SolverRegistry();
    for (const cell of solverCells)
      if (cell.solution) registry.seedEffectiveSolution(cell.id, cell.solution);
    registry.syncCells(solverCells.map((c) => ({ id: c.id, latex: c.latex })));
    const tableSources: SolverTableCellSource[] = (doc.cells as any[]).flatMap(
      (c) =>
        c.type === "table"
          ? [{ columns: c.tableData.columns, cells: c.tableData.cells }]
          : [],
    );
    registry.pass(
      ce,
      createDocumentSolverNamespace(
        mgr,
        resolveTableColumns(ce, tableSources),
        resolveScalarBodies(ce, sources),
      ),
    );
    for (const source of registry.variableSources()) {
      if (canonicalSymbolFromName(ce, source.name) === undefined) continue;
      sources.push(source);
    }
  }
  // The document's value definitions take their value in this pass, after
  // the solver sources (`runVariablePass` explains why).
  const evaluation = runVariablePass(ce, sources, mgr);
  for (const [n, v] of evaluation.values) values[n] = v;
  const documentVariables: Record<string, string> = {};
  for (const n of evaluation.definedNames)
    documentVariables[n] = sanitizeUniformName(n);
  for (const source of mgr.deferredScalarVariableSources)
    documentVariables[source.name] = sanitizeUniformName(source.name);
  const docVarMap =
    Object.keys(documentVariables).length > 0 ? documentVariables : undefined;
  const docVarRanges = documentVariableRangesOf(evaluation.byName);
  for (const status of evaluation.byName.values())
    if (status.kind === "ok" && status.domain !== undefined)
      sliderTally.withDomain++;
  sliderTally.promised += Object.keys(docVarRanges ?? {}).length;
  // ROADMAP IF: the document scope declares each slider under its range, as
  // the app does (`syncVariableRanges` in document-mode), so the audit
  // compiles under the same types. A changed declaration registers the
  // document again, which clears the values the variable pass bound, so the
  // pass runs again.
  if (mgr.setVariableRanges(docVarRanges)) {
    mgr.evaluate();
    runVariablePass(ce, sources, mgr);
  }
  const resolved = resolveAllComputedCollections(
    ce,
    mgr.computedCollections,
    values,
    new Map(),
  );

  const carrierNames: ReadonlySet<string> = new Set<string>([
    ...mgr.collectionNames,
    ...mgr.computedCollections.keys(),
  ]);
  const materializeBudget = new MaterializeBudget();
  const colorDefinitionCells: StyleDefinitionCell[] = [];
  for (const cell of doc.cells as any[]) {
    if (
      cell.type === "variable" &&
      cell.name &&
      typeof cell.value === "string" &&
      cell.value.trim()
    )
      colorDefinitionCells.push({
        latex: `${canonicalNameToLatex(ce, cell.name)} = ${cell.value}`,
      });
    else if (
      "latex" in cell &&
      typeof cell.latex === "string" &&
      cell.latex.trim()
    )
      colorDefinitionCells.push({ latex: cell.latex });
  }
  const colorDefinitions = collectColorDefinitions(
    { ce, documentVariableNames: mgr.documentVariableNames },
    colorDefinitionCells,
  );
  return {
    doc,
    mgr,
    ce,
    values,
    docVarMap,
    resolved,
    carrierNames,
    materializeBudget,
    colorDefinitions,
  };
}

function classifyOptionsFor(s: Setup): ClassifyOptions {
  const { mgr, ce, doc, carrierNames, materializeBudget } = s;
  return {
    isDocumentFn: mgr.isDocumentFn,
    isDocumentRecursiveFn: mgr.isDocumentRecursiveFn,
    collectionNames: carrierNames,
    documentVariableNames: mgr.documentVariableNames,
    complexMode: mgr.complexMode,
    documentDimension: doc.dimension,
    threadMacroRefs: (e: Expression) => mgr.threadMacroRefsForRow(e),
    expandFunctionRefsBoxed: (e: Expression) =>
      mgr.expandFunctionRefsBoxed(e, true),
    expandFunctionRefsStructural: (e: Expression) =>
      mgr.expandFunctionRefsStructural(e, true),
    shadowedParamsFor: (e: Expression) => mgr.shadowedParamsFor(e),
    resolveComputedSymbol: makeComputedSymbolResolver(
      ce,
      mgr.computedCollections,
      {},
    ),
    materializeBudget,
  };
}

function inferRow(latex: string, s: Setup): InferredSeries | null {
  const opts = classifyOptionsFor(s);
  const artifact = classifyFormulaArtifact(latex, s.ce, opts);
  try {
    return inferSeries(
      latex,
      s.ce,
      { ...opts, skipDataMaterialization: "2d" },
      { latex, artifact },
    );
  } finally {
    artifact.dispose();
  }
}

function normalizeRow(
  inferred: SeriesInput,
  s: Setup,
  persistedPatch?: SeriesPatch,
): Record<string, unknown>[] {
  const {
    ce,
    mgr,
    values,
    resolved,
    colorDefinitions,
    carrierNames,
    materializeBudget,
  } = s;
  const patch = persistedPatch
    ? resolveSourceAuthoredStyle(inferred, persistedPatch).patch
    : undefined;
  const patched = patch
    ? (mergeSeriesPatch(
        inferred as unknown as Record<string, unknown>,
        patch,
      ) as unknown as SeriesInput)
    : inferred;
  const host = {
    ce,
    expandFunctionRefsBoxed: (e: Expression) =>
      mgr.expandClassificationRefsBoxed(e),
    isElementwiseParam: mgr.isElementwiseParam,
    variableValues: values,
    resolvedCollections: resolved,
    colorDefinitions,
    documentVariableNames: mgr.documentVariableNames,
    documentVariableDependencies: (e: Expression) =>
      mgr.documentVariableDependencies(e),
    computedCollectionNames: new Set(mgr.computedCollections.keys()),
    carrierOnlyNames: new Set(mgr.carrierOnlyNames),
    collectionNames: carrierNames,
    materializeBudget,
  };
  const members = normalizeInferredSeries(
    patched,
    host,
    patch
      ? { base: inferred, authoredKeys: new Set(Object.keys(patch)) }
      : null,
  );
  compileHeatmapListColor(
    patched as unknown as Record<string, unknown>,
    s,
    host,
  );
  return members;
}

/**
 * The GLSL colour field of a 2-D heatmap whose colour formula reads a
 * document list by reference (the `buddhabrot` colour `c(H, x, y, z)` reads
 * the list `H`). Document mode compiles it when it builds the heatmap's
 * colour spec, with the list textures that the heatmap draw binds
 * (`gpuFragmentField(values, { samplerCarriers: true })` in
 * `src/graph-paper/modes/document-mode.ts`). The reduced renderer that
 * `normalizeInferredSeries` runs asks for the field without them, and a
 * colour that reads a list then has no field and compiles nothing, so the
 * audit asks for it here. A colour that reads no list compiled its field
 * when `normalizeInferredSeries` compiled the colour, and is not compiled
 * again.
 */
function compileHeatmapListColor(
  rec: Record<string, unknown>,
  s: Setup,
  host: Parameters<typeof compileRowColorExpression>[1],
): void {
  if (s.doc.dimension === 3 || rec.type !== "heatmap") return;
  const compiled = compileRowColorExpression(rec, host);
  if (compiled === null || compiled.byReference.length === 0) return;
  compiled.gpuFragmentField(s.values, { samplerCarriers: true });
}

/** Sampler widths for the by-reference carriers, as the element derives them
 *  from its values record (`samplerCarrierWidths`): the current numeric list
 *  bound to each name, when there is one. */
function samplerWidthsFor(
  byReference: readonly string[],
  mgr: DocumentCEManager,
): Record<string, number> | undefined {
  const widths: Record<string, number> = {};
  for (const name of byReference) {
    const bound = mgr.carrierBinding(name);
    const elements = bound === undefined ? null : numericListElements(bound);
    if (elements !== null && elements.length > 0)
      widths[name] = elements.length;
  }
  return Object.keys(widths).length > 0 ? widths : undefined;
}

/** Mirror `MathPlotElement.compileDeferredGlsl` for every resolved function:
 *  primary compile (snapshot expression for a snapshot kernel; sampler widths
 *  for by-reference carriers), then the `exprFallback` retry on a decline or a
 *  throw — except for a snapshot kernel, which the element declines to CPU. */
function compileDeferredGlsl(
  resolvedSeries: unknown[],
  mgr: DocumentCEManager,
): void {
  const seen = new Set<object>();
  const tryCompile = (
    expr: Expression,
    options: Record<string, unknown>,
  ): boolean => {
    try {
      const r = resolveCECompile(expr, { to: "glsl", ...options } as never);
      return r.success === true && typeof r.code === "string";
    } catch {
      return false;
    }
  };
  const visit = (v: unknown, depth: number): void => {
    if (!v || typeof v !== "object" || depth > 4 || seen.has(v)) return;
    seen.add(v);
    const o = v as Record<string, unknown>;
    if (o.kind === "glsl-deferred" && o.expr && typeof o.expr === "object") {
      const byReference = Array.isArray(o.byReference)
        ? (o.byReference as string[])
        : undefined;
      const sampler = byReference
        ? samplerWidthsFor(byReference, mgr)
        : undefined;
      const options = {
        ...(byReference ? { byReference } : {}),
        ...(sampler ? { sampler } : {}),
      };
      const snapshot =
        typeof o.refreshSnapshotKernel === "function" &&
        typeof o.snapshotExpression === "function";
      let expr: Expression | null = o.expr as Expression;
      if (snapshot) {
        try {
          expr = (o.snapshotExpression as () => Expression | null)();
        } catch {
          expr = null;
        }
      }
      if (!expr) return;
      if (tryCompile(expr, options) || snapshot) return;
      let alt: Expression | null = null;
      try {
        alt =
          typeof o.exprFallback === "function"
            ? ((o.exprFallback as () => Expression | null)() ?? null)
            : null;
      } catch {
        alt = null;
      }
      if (alt) tryCompile(alt, options);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    for (const k of Object.keys(o)) {
      if (k === "ce" || k === "expr") continue;
      visit(o[k], depth + 1);
    }
  };
  for (const s of resolvedSeries) visit(s, 0);
}

interface DocSummary {
  corpus: string;
  doc: string;
  rows: number;
  series: number;
  error?: string;
  ms: number;
  /** Showcase documents only: the outcome of the entry's prelude, or `null`
   *  for an entry without one. A Desmos document has no prelude and no
   *  field. An invalid prelude also sets `error`, and the entry's rows do
   *  not run. */
  prelude?: PreludeSummary | null;
}
const docs: DocSummary[] = [];
/** ROADMAP DZ: how many sliders the corpus PROMISES a range for (hard bound
 *  or integer grid) out of every slider with a domain — the reach of the
 *  sign/range specialization. Desmos-imported sliders are SOFT-bounded unless
 *  the source set `hardMin`/`hardMax`, so this is expected to be small. */
const sliderTally = { withDomain: 0, promised: 0 };

const VOLUME_SERIES_TYPES = new Set([
  "surface",
  "parametric-curve",
  "parametric-surface",
  // The spherical and cylindrical forms (`\rho = f(\theta, \phi)`,
  // `r = f(\theta, z)` in a 3-D document) are resolved by
  // `resolveVolumeSeriesData` too; without them here their rows reached the
  // 2-D resolver and recorded no compile.
  "spherical-surface",
  "cylindrical-surface",
  "analyticLandscape",
  "implicit-surface",
]);

function resolveMember(m: Record<string, unknown>, s: Setup): number {
  if (VOLUME_SERIES_TYPES.has(String(m.type))) {
    const resolved = resolveVolumeSeriesData(
      [m as unknown as VolumeSeriesInput],
      s.ce,
      s.docVarMap,
      s.values,
    );
    compileDeferredGlsl(resolved, s.mgr);
    return resolved.length;
  }
  const byReference = [...s.mgr.byReferenceCarrierNames()];
  const resolved = resolveSeriesData(
    [m as unknown as PlotSeriesInput],
    s.ce,
    s.docVarMap,
    s.values,
    s.mgr.definitionsRevision,
    undefined,
    byReference.length ? byReference : undefined,
  );
  compileDeferredGlsl(resolved, s.mgr);
  return resolved.length;
}

function runRows(doc: DocLike, s: Setup, summary: DocSummary, id: string) {
  for (const cell of doc.cells as any[]) {
    if (cell.type !== "equation" || cell.visible === false) continue;
    summary.rows++;
    context.row = cell.latex;
    try {
      const inferred = inferRow(cell.latex, s);
      if (!inferred) continue;
      const members = normalizeRow(
        inferred as SeriesInput,
        s,
        doc.seriesPatchById?.[String(cell.id)],
      );
      // One member at a time, so each compile is attributed to its row.
      for (const m of members) {
        if (typeof m.fn !== "string") continue;
        summary.series += resolveMember(m, s);
      }
    } catch (e) {
      process.stderr.write(
        `  row failed (${id}): ${String((e as Error).message).slice(0, 120)}\n`,
      );
    }
  }
}

async function runDocument(
  corpus: string,
  id: string,
  doc: DocLike,
): Promise<void> {
  const t0 = performance.now();
  const summary: DocSummary = { corpus, doc: id, rows: 0, series: 0, ms: 0 };
  context.corpus = corpus;
  context.doc = id;
  context.row = "(setup)";
  let s: Setup;
  try {
    s = await setupState(doc);
  } catch (e) {
    summary.error = `setup: ${String((e as Error).message).slice(0, 200)}`;
    summary.ms = Math.round(performance.now() - t0);
    docs.push(summary);
    return;
  }
  runRows(doc, s, summary, id);
  summary.ms = Math.round(performance.now() - t0);
  docs.push(summary);
  process.stderr.write(
    `${corpus}/${id}: ${summary.rows} rows, ${summary.series} series, ${summary.ms} ms\n`,
  );
}

// ── Desmos corpus ───────────────────────────────────────────────────────────

function desmosTargets(all: boolean): { corpus: string; id: string }[] {
  if (all)
    return Object.entries(STATES).flatMap(([corpus, dir]) =>
      readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({ corpus, id: f.replace(/\.json$/, "") })),
    );
  return readFileSync(`${CORPUS_DIR}/CORE_CORPUS.txt`, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [corpus, id] = l.split("/");
      return { corpus, id };
    });
}

async function runDesmos(all: boolean): Promise<void> {
  for (const { corpus, id } of desmosTargets(all)) {
    const statePath = path.join(STATES[corpus], `${id}.json`);
    // A CORE state absent from this tree: the output plan already refused
    // the default paths for such a run (scripts/lib/codegen-audit-outputs.mjs);
    // with explicit paths the run is a declared PARTIAL arm, so record the
    // omission as a document entry instead of dying on ENOENT.
    if (!existsSync(statePath)) {
      docs.push({
        corpus,
        doc: id,
        rows: 0,
        series: 0,
        ms: 0,
        error: `missing: state file ${statePath} is absent from this tree`,
      });
      continue;
    }
    const stateJson = JSON.parse(readFileSync(statePath, "utf8"));
    const res = convertDesmosState(stateJson as never);
    if (!res.ok) {
      docs.push({
        corpus,
        doc: id,
        rows: 0,
        series: 0,
        ms: 0,
        error: `convert: ${res.reason}`,
      });
      continue;
    }
    await runDocument(corpus, id, res.document as unknown as DocLike);
  }
}

// ── Native showcase entries ─────────────────────────────────────────────────

/** Run the showcase entries; `only` restricts the pass to the entry with
 *  that id (`--showcase-only`). */
async function runShowcase(only?: string): Promise<void> {
  let nextId = 1;
  for (const entry of SHOWCASE) {
    if(process.env.PROFILE_IDS && !process.env.PROFILE_IDS.split(",").includes(entry.id))continue;
    if (only !== undefined && entry.id !== only) continue;
    const cells: any[] = [];
    for (const d of entry.definitions ?? []) {
      const hidden = typeof d !== "string" && d.hidden;
      cells.push({
        id: nextId++,
        type: "equation",
        latex: definitionLatex(d),
        visible: !hidden,
      });
    }
    for (const v of entry.variables ?? [])
      cells.push({
        id: nextId++,
        type: "variable",
        name: v.name,
        value: v.value,
      });
    // A point controller (`PlotEntry.points`) is two more document
    // variables, as the app seeds it; without them a definition that reads
    // a coordinate (`R = \sqrt{(1 - c_x)^2 + c_y^2}` in `joukowsky-airfoil`)
    // has free symbols and compiles to something the app never runs.
    for (const p of entry.points ?? [])
      cells.push({
        id: nextId++,
        type: "point-variable",
        xName: p.x.name,
        xValue: p.x.value,
        yName: p.y.name,
        yValue: p.y.value,
      });
    for (const a of entry.actions ?? [])
      cells.push({
        id: nextId++,
        type: "action",
        latex: a.latex,
        visible: true,
      });
    const doc: DocLike = {
      cells,
      ...(entry.prelude?.trim() ? { prelude: entry.prelude } : {}),
      ...(entry.category === "3d" ? { dimension: 3 as const } : {}),
    };
    const t0 = performance.now();
    const summary: DocSummary = {
      corpus: "showcase",
      doc: entry.id,
      rows: cells.length,
      series: 0,
      ms: 0,
      prelude: null,
    };
    context.corpus = "showcase";
    context.doc = entry.id;
    context.row = "(setup)";
    let s: Setup;
    try {
      s = await setupState(doc, (prelude) => {
        summary.prelude = prelude;
      });
    } catch (e) {
      summary.error = `setup: ${String((e as Error).message).slice(0, 300)}`;
      summary.ms = Math.round(performance.now() - t0);
      docs.push(summary);
      process.stderr.write(`showcase/${entry.id}: ${summary.error}\n`);
      continue;
    }
    // Definition rows may be plottable themselves; run them like a document.
    const rowsBefore = summary.rows;
    runRows(doc, s, summary, entry.id);
    summary.rows = rowsBefore;
    // The entry's series are resolved directly, as the showcase route does.
    for (const series of entry.series) {
      const fnLatex =
        "fn" in series && typeof (series as { fn?: unknown }).fn === "string"
          ? ((series as { fn: string }).fn as string)
          : null;
      context.row = fnLatex ?? `(${series.type} series without fn)`;
      try {
        if (entry.category === "3d") {
          summary.series += resolveMember(series as Record<string, unknown>, s);
          continue;
        }
        let input: Record<string, unknown> = series as Record<string, unknown>;
        if (fnLatex) {
          // The showcase route infers the row first and adopts the inferred fn.
          const inferred = inferRow(fnLatex, s) as Record<
            string,
            unknown
          > | null;
          if (inferred) {
            const members = normalizeRow(
              {
                ...inferred,
                ...series,
                fn: inferred.fn ?? fnLatex,
              } as unknown as SeriesInput,
              s,
            );
            const withFn = members.find((m) => typeof m.fn === "string");
            if (withFn) input = withFn;
          }
        }
        summary.series += resolveMember(input, s);
      } catch (e) {
        process.stderr.write(
          `  series failed (${entry.id}): ${String((e as Error).message).slice(0, 120)}\n`,
        );
      }
    }
    summary.ms = Math.round(performance.now() - t0);
    docs.push(summary);
    process.stderr.write(
      `showcase/${entry.id}: ${summary.series} series, ${summary.ms} ms` +
        (summary.prelude
          ? ` (prelude: ${summary.prelude.names.length} names, ${summary.prelude.runMs ?? "?"} ms)`
          : "") +
        "\n",
    );
  }
}

// ── Output shapes ───────────────────────────────────────────────────────────

/** One entry per distinct (target, input, code, preamble, error). */
interface AuditEntry extends Omit<CompileRecord, "durationMs"> {
  id: number;
  /** sha256 of `code` + "\n" + `preamble` (empty when the compile declined). */
  hash: string;
  /** sha256 of the full `input`; the digest truncates `input` and `row`. */
  inputHash: string;
  codeLength: number;
  preambleLength: number;
  /** Identical compile calls folded into this entry. */
  occurrences: number;
  /** Fastest and slowest of the folded calls, ms. */
  durationMs: number;
  maxDurationMs: number;
}
interface AuditFile {
  generatedAt: string;
  computeEngine: string;
  tychoCommit: string;
  /** `showcase-only`: a `--showcase-only` arm, with no Desmos document. */
  desmosScope: "core" | "all" | "showcase-only";
  shape: "full" | "digest";
  note: string;
  documents: DocSummary[];
  records: AuditEntry[];
}

function dedupe(): AuditEntry[] {
  const byKey = new Map<string, AuditEntry>();
  for (const r of records) {
    const key = JSON.stringify([
      r.target,
      r.input,
      r.code ?? "",
      r.preamble ?? "",
      r.error ?? "",
      r.threw ?? "",
    ]);
    const hit = byKey.get(key);
    if (hit) {
      hit.occurrences++;
      hit.durationMs = Math.min(hit.durationMs, r.durationMs);
      hit.maxDurationMs = Math.max(hit.maxDurationMs, r.durationMs);
      continue;
    }
    byKey.set(key, {
      id: byKey.size + 1,
      ...r,
      hash: r.code
        ? createHash("sha256")
            .update(r.code + "\n" + (r.preamble ?? ""))
            .digest("hex")
            .slice(0, 16)
        : "",
      inputHash: createHash("sha256")
        .update(r.input)
        .digest("hex")
        .slice(0, 16),
      codeLength: r.code?.length ?? 0,
      preambleLength: r.preamble?.length ?? 0,
      occurrences: 1,
      maxDurationMs: r.durationMs,
    });
  }
  return [...byKey.values()];
}

const DIGEST_TEXT_CAP = 1000;
function digestOf(entry: AuditEntry): AuditEntry {
  const { code: _code, preamble: _preamble, ...rest } = entry;
  const cap = (t: string): string =>
    t.length > DIGEST_TEXT_CAP
      ? t.slice(0, DIGEST_TEXT_CAP) + `… [${t.length} chars]`
      : t;
  return {
    ...rest,
    row: cap(rest.row),
    input: cap(rest.input),
    ...(rest.error !== undefined ? { error: cap(rest.error) } : {}),
  } as AuditEntry;
}

// ── Compare ─────────────────────────────────────────────────────────────────

/** Identity of a compile call across runs: the target, the document, the
 *  expression, and the options (a `mode: "strict"` colour compile and a plain
 *  one of the same expression are different calls). Several records can still
 *  share a key — the same call declining then succeeding, say — so groups are
 *  paired member by member. */
const entryKey = (e: AuditEntry, ignoreMode = false): string => {
  let options = e.options ?? {};
  if (ignoreMode && "mode" in options) {
    const { mode: _mode, ...rest } = options;
    options = rest;
  }
  return [
    e.target,
    e.corpus,
    e.doc,
    e.inputHash ?? e.input,
    JSON.stringify(options),
  ].join(" ");
};

/**
 * Since 2026-10-08 every plot-sampling and data-side compile passes a `mode`
 * option (`strict` or `auto`, selected by the document's complex-mode flag),
 * so its options differ from the same call in a digest recorded before that
 * change, and a key that includes `mode` would pair none of them: the
 * strict-vs-auto code change would hide inside "only in previous / only in
 * next" instead of showing as changed code or a new decline. When one side
 * of a compare carries no `mode` field on any record (recorded before the
 * instrument stored it), `mode` is left out of the key on both sides.
 */
const sideHasModeField = (file: AuditFile): boolean =>
  file.records.some((r) => r.mode !== undefined);

/**
 * Per target, how many successful records report the complex discipline
 * (`mode: "complex"`), a promoted radical (`promoted: true`) and an auto-mode
 * escalation (`escalation` set), as `target c/p/e`; "n/a" when no record of
 * the file carries the `mode` field (a digest recorded before 2026-10-08).
 */
function laneCounts(file: AuditFile): string {
  if (!file.records.some((r) => r.mode !== undefined)) return "n/a";
  const by = new Map<string, [number, number, number]>();
  for (const r of file.records) {
    if (!r.success) continue;
    const t = by.get(r.target) ?? [0, 0, 0];
    if (r.mode === "complex") t[0]++;
    if (r.promoted === true) t[1]++;
    if (r.escalation !== undefined) t[2]++;
    by.set(r.target, t);
  }
  return [...by]
    .sort()
    .map(([target, [c, p, e]]) => `${target} ${c}/${p}/${e}`)
    .join(", ");
}

function compare(prev: AuditFile, next: AuditFile): string {
  const lines: string[] = [];
  lines.push(
    `compare: ${prev.computeEngine} (${prev.generatedAt.slice(0, 10)}) → ${next.computeEngine} (${next.generatedAt.slice(0, 10)})`,
  );
  const ignoreMode = !sideHasModeField(prev) || !sideHasModeField(next);
  if (ignoreMode)
    lines.push(
      "note: one side was recorded before the instrument stored `mode`; records are paired without it",
    );
  const prevBy = new Map<string, AuditEntry[]>();
  for (const e of prev.records) {
    const k = entryKey(e, ignoreMode);
    prevBy.set(k, [...(prevBy.get(k) ?? []), e]);
  }
  const nextBy = new Map<string, AuditEntry[]>();
  for (const e of next.records) {
    const k = entryKey(e, ignoreMode);
    nextBy.set(k, [...(nextBy.get(k) ?? []), e]);
  }
  const changed: string[] = [];
  const newDeclines: string[] = [];
  const goneDeclines: string[] = [];
  const slower: string[] = [];
  const faster: string[] = [];
  let same = 0;
  let onlyPrev = 0;
  let onlyNext = 0;
  const label = (e: AuditEntry) =>
    `${e.target} ${e.corpus}/${e.doc} ${e.input.slice(0, 80)}`;
  const pairUp = (p: AuditEntry, n: AuditEntry): void => {
    if (p.success && !n.success)
      newDeclines.push(
        `${label(n)} — ${(n.error ?? n.threw ?? "").slice(0, 120)}`,
      );
    else if (!p.success && n.success) goneDeclines.push(label(n));
    else if (p.hash !== n.hash)
      changed.push(
        `${label(n)} — ${p.codeLength + p.preambleLength} → ${n.codeLength + n.preambleLength} chars`,
      );
    else same++;
    const dt = n.durationMs - p.durationMs;
    const ratio =
      Math.max(p.durationMs, n.durationMs) /
      Math.max(0.01, Math.min(p.durationMs, n.durationMs));
    if (Math.abs(dt) >= 100 && ratio >= 2)
      (dt > 0 ? slower : faster).push(
        `${label(n)} — ${p.durationMs} → ${n.durationMs} ms`,
      );
  };
  for (const [k, nexts] of nextBy) {
    const prevs = prevBy.get(k);
    if (!prevs) {
      onlyNext += nexts.length;
      continue;
    }
    // Pair identical outcomes first, then the leftovers in order; whatever is
    // left on either side is reported as only-in-one-run.
    const remainingPrev = [...prevs];
    const remainingNext: AuditEntry[] = [];
    for (const n of nexts) {
      const i = remainingPrev.findIndex(
        (p) => p.hash === n.hash && p.success === n.success,
      );
      if (i >= 0) {
        pairUp(remainingPrev[i], n);
        remainingPrev.splice(i, 1);
      } else remainingNext.push(n);
    }
    while (remainingPrev.length > 0 && remainingNext.length > 0)
      pairUp(remainingPrev.shift()!, remainingNext.shift()!);
    onlyPrev += remainingPrev.length;
    onlyNext += remainingNext.length;
  }
  for (const [k, prevs] of prevBy) if (!nextBy.has(k)) onlyPrev += prevs.length;
  lines.push(
    `records: ${next.records.length} (previous ${prev.records.length}); unchanged ${same}, changed code ${changed.length}, new declines ${newDeclines.length}, resolved declines ${goneDeclines.length}, only in previous ${onlyPrev}, only in next ${onlyNext}`,
  );
  // The complex-lane count per target, previous → next, so a release (or a
  // Tycho change of the compile `mode`) that moves kernels between the real
  // and the complex discipline is visible without reading the records. A
  // digest made before the fields were recorded reads "n/a".
  lines.push(
    `lanes (complex / promoted / escalated, by target): ${laneCounts(prev)} → ${laneCounts(next)}`,
  );
  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push("", `${title} (${items.length}):`);
    for (const i of items.slice(0, 60)) lines.push(`  ${i}`);
    if (items.length > 60) lines.push(`  … ${items.length - 60} more`);
  };
  section("NEW DECLINES", newDeclines);
  section("RESOLVED DECLINES", goneDeclines);
  section("CHANGED CODE", changed);
  section("SLOWER (≥100 ms and ≥2×)", slower);
  section("FASTER (≥100 ms and ≥2×)", faster);
  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

// Argument validation, not decoration: this script's default action is a full
// CORE corpus run that overwrites two arm files. An unrecognized flag used to
// be IGNORED, so `--help` silently started that run and clobbered an
// adoption's arm (2026-09-10). Anything not understood must stop the run.
const USAGE = `audit-ce-codegen — record the code CE emits for real documents.

  npx tsx scripts/audit-ce-codegen.mts [options]

  --all               audit every Desmos state instead of the CORE corpus;
                      writes ce-<version>-all.json and no tracked digest
  --compare <path>    diff this run against a previous full or digest file
  --full <path>       write the full arm here (default: by CE version)
  --digest <path>     write the tracked digest here (default: by CE version)
  --showcase-only <id>
                      record only the showcase entry <id> and no Desmos
                      state; needs both --full and --digest (a test arm,
                      not a release record)
  --plan              print where this run would write, and exit
  --shadow-wgsl       also compile every glsl input to wgsl with the same
                      options, and record it (the product keeps the glsl
                      result); name --full and --digest outside the
                      tracked paths, as this arm is not a release record
  --help, -h          print this and exit

Running with no options records a CORE arm and OVERWRITES the two default
output paths for the installed CE version.`;

const VALUE_FLAGS = new Set([
  "--compare",
  "--full",
  "--digest",
  "--showcase-only",
]);
const BARE_FLAGS = new Set(["--all", "--plan", "--shadow-wgsl"]);

// `writeSync` on the fd, not `console.log`: writes to a TTY or a pipe are
// ASYNCHRONOUS on POSIX, so `console.error(...)` immediately followed by
// `process.exit()` can truncate the very message that explains the exit.
const exitWith = (fd: 1 | 2, text: string, code: 0 | 2): never => {
  writeSync(fd, `${text}\n`);
  process.exit(code);
};

if (args.includes("--help") || args.includes("-h")) exitWith(1, USAGE, 0);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (VALUE_FLAGS.has(arg)) {
    const value = args[i + 1];
    // An EMPTY value must fail here too. `--compare "$BASE"` with `BASE`
    // unset passes a `""` that is neither undefined nor dash-led; it would
    // then read as "no baseline requested" further down and the run would
    // overwrite both default outputs having compared nothing — exactly the
    // silent destructive run this validation exists to stop.
    if (value === undefined || value === "" || value.startsWith("-"))
      exitWith(2, `audit-ce-codegen: ${arg} needs a path.\n\n${USAGE}`, 2);
    i++; // consume the value, so it is never read as a flag
    continue;
  }
  if (BARE_FLAGS.has(arg)) continue;
  exitWith(
    2,
    `audit-ce-codegen: unrecognized argument \`${arg}\`.\n\n${USAGE}`,
    2,
  );
}

const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const all = args.includes("--all");
const showcaseOnly = flag("--showcase-only");
if (
  showcaseOnly !== undefined &&
  !SHOWCASE.some((entry) => entry.id === showcaseOnly)
)
  exitWith(
    2,
    `audit-ce-codegen: --showcase-only: no showcase entry has the id \`${showcaseOnly}\`.`,
    2,
  );
const ceVersion: string = JSON.parse(
  readFileSync("node_modules/@cortex-js/compute-engine/package.json", "utf8"),
).version;
const sha = execSync("git rev-parse --short HEAD").toString().trim();
// Output paths — the rule lives in scripts/lib/codegen-audit-outputs.mjs and
// is pinned by tests/node/graph-paper/codegen-audit-outputs.test.ts: the
// default tracked digest and full arm belong to a COMPLETE CORE run. Three
// single-document runs overwrote the 0.128.9 digest and an empty run its
// full arm (docs/COMPUTE_ENGINE_LOG.md, the 0.128.11 record). Decided BEFORE
// any audit work, so a refused run costs nothing.
const plan = resolveAuditOutputs({
  all,
  fullFlag: flag("--full"),
  digestFlag: flag("--digest"),
  ceVersion,
  corpusDir: CORPUS_DIR,
  ...(showcaseOnly !== undefined ? { showcaseOnly } : {}),
  missingCore:
    all || showcaseOnly !== undefined
      ? []
      : desmosTargets(false)
          .filter(
            ({ corpus, id }) =>
              !existsSync(path.join(STATES[corpus], `${id}.json`)),
          )
          .map(({ corpus, id }) => `${corpus}/${id}`),
});
for (const note of plan.notes)
  process.stderr.write(`audit-ce-codegen: ${note}\n`);
if (plan.refusal !== null) exitWith(2, `audit-ce-codegen: ${plan.refusal}`, 2);
if (args.includes("--plan"))
  exitWith(
    1,
    `audit-ce-codegen: plan for CE ${ceVersion} (${plan.scope})\n` +
      `  full arm:       ${plan.fullPath}\n` +
      `  tracked digest: ${plan.digestPath ?? "(not written)"}`,
    0,
  );
const fullPath = plan.fullPath;
const digestPath = plan.digestPath;
const comparePath = flag("--compare");
if (comparePath && !existsSync(comparePath))
  throw new Error(`--compare: ${comparePath} does not exist`);
// Read the baseline BEFORE the run: `--compare` may name one of this run's
// own output paths (a re-record of the same CE version), which is overwritten
// below.
const previous: AuditFile | null = comparePath
  ? (JSON.parse(readFileSync(comparePath, "utf8")) as AuditFile)
  : null;

const restoreProfileObserver=installPublicObserver(ceModule.ComputeEngine);
try {
await runShowcase(showcaseOnly);
if (showcaseOnly === undefined && !process.env.PROFILE_IDS) await runDesmos(all);

const entries = dedupe();
const base = {
  generatedAt: new Date().toISOString(),
  computeEngine: ceVersion,
  tychoCommit: sha,
  desmosScope: plan.scope,
  documents: docs,
};
const NOTE =
  "One entry per distinct (target, input, code, preamble, error). `occurrences` counts identical compile calls; `durationMs` is the fastest, `maxDurationMs` the slowest. `row` is the authored LaTeX ('(setup)' = a document definition compiled at load); `input` is the LaTeX of the boxed expression handed to compile(). `hash` is sha256(code + newline + preamble), truncated: it sees emitted TEXT only, so a CE change to how that text runs (when a baked preamble local is evaluated, say) is invisible here by design. Written by scripts/audit-ce-codegen.mts.";
const full: AuditFile = {
  ...base,
  shape: "full",
  note: NOTE,
  records: entries,
};
const digest: AuditFile = {
  ...base,
  shape: "digest",
  note: NOTE + " Digest: code and preamble text omitted; see the full file.",
  records: entries.map(digestOf),
};
mkdirSync(path.dirname(fullPath), { recursive: true });
writeFileSync(fullPath, JSON.stringify(full, null, 1));
if (shadowWgsl) {
  const numericPath = fullPath.replace(/\.json$/, "") + "-numeric.json";
  writeFileSync(numericPath, JSON.stringify(numericCases));
  process.stderr.write(
    `numeric cases (both shaders compiled, f32 inputs): ${numericCases.length} → ${numericPath}\n`,
  );
}
if (digestPath !== null) {
  mkdirSync(path.dirname(digestPath), { recursive: true });
  writeFileSync(digestPath, JSON.stringify(digest, null, 1) + "\n");
}
process.stderr.write(
  `\n${records.length} compile calls, ${entries.length} distinct records, ${docs.length} documents\n` +
    `sliders with a range promise (ROADMAP DZ): ${sliderTally.promised} of ${sliderTally.withDomain} with a domain\n` +
    `full   → ${fullPath}\ndigest → ${digestPath ?? "(not written)"}\n`,
);
if (previous) process.stdout.write(compare(previous, full) + "\n");

} finally { restoreProfileObserver(); }
