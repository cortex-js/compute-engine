/**
 * Language census: which features of the Compute Engine language Tycho uses.
 * It is the measurement of section 7 of
 * `docs/plans/2026-11-01-language-axes-survey.md`, and it writes
 * `census.md` and `census.json` in the directory of this script.
 *
 * Command (run from the Tycho checkout so that Tycho's `node_modules` and its
 * relative corpus paths resolve; the Compute Engine is the one installed in
 * Tycho's `node_modules`, not the source tree of this repo):
 *
 *   cd /Users/arno/dev/tycho && timeout -k 30 1200 npx tsx /Users/arno/dev/compute-engine/docs/plans/2026-11-01-language-axes-survey/census.mts
 *
 * It reads Tycho and writes nothing in Tycho. It runs on one core, in about
 * 210 s on 2026-11-01. `--limit N` runs the showcase and the first N Desmos
 * states only, for a quick check (it still overwrites the outputs).
 *
 * Two corpora, counted separately:
 *
 * - "compile": every expression that the product pipeline hands to
 *   `compile()`, over the 757 documents of
 *   `tycho/scripts/audit-ce-codegen.mts --all` (the Desmos states of
 *   `_TASK/desmos/desmos-corpus/states` and
 *   `_TASK/requirements/neyret-corpus/states`, and the native showcase
 *   entries). The pipeline code below the "Product pipeline" line is a copy
 *   of that script (its classify, normalize and resolve calls, and the
 *   deferred GLSL compile), with absolute import paths. A recording
 *   `compile` is registered in Tycho's module registry, as in that script:
 *   it analyses the boxed expression it receives, in the scope that the
 *   product pushed for the compile, and then calls the real `compile`. One
 *   "expression" is one distinct MathJSON tree per document; the targets
 *   and options of all its compile calls are merged.
 * - "rows": every equation row with LaTeX of the Desmos states (not the
 *   showcase), boxed as `tycho/scripts/ce-round-trip-audit.mts` boxes it: a
 *   strict `ce.parse(latex)` inside `withRowParamScope`, on the document's
 *   `DocumentCEManager`. The manager is set up by the same `setupState()`
 *   as the compile corpus, so it carries the document's cells, variable
 *   names, slider ranges, angle unit, complex mode and dimension. Every row
 *   is counted, with no deduplication.
 *
 * A feature is counted once per expression. "Counted by" in the report says
 * whether the test reads the MathJSON structure ("syntax"), the static
 * `.type` of a node ("type"), the compile options or the compile result
 * ("option", "result"), or is a proxy for a property that is not static.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ceModule from "/Users/arno/dev/tycho/node_modules/@cortex-js/compute-engine/dist/esm-min/compute-engine.js";
import {
  registerComputeEngineModule,
  resolveCECompile,
} from "/Users/arno/dev/tycho/src/plot-core/ce-module-registry.js";

type Expression = any;
type ComputeEngine = any;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CE_VERSION: string = JSON.parse(
  (await import("node:fs")).readFileSync(
    "node_modules/@cortex-js/compute-engine/package.json",
    "utf8",
  ),
).version;

// ── Feature catalogue ───────────────────────────────────────────────────────

type Method = "syntax" | "type" | "option" | "result" | "proxy";
interface FeatureDef {
  section: string;
  key: string;
  label: string;
  method: Method;
}
const FEATURES: FeatureDef[] = [];
function def(section: string, key: string, method: Method, label: string) {
  FEATURES.push({ section, key, label, method });
}

const SEL = "Selection, comparisons and connectives";
const SELECT_OPS = ["Which", "If", "When"];
const COMPARE_OPS = [
  "Equal",
  "NotEqual",
  "Less",
  "LessEqual",
  "Greater",
  "GreaterEqual",
];
const CONNECTIVE_OPS = ["And", "Or", "Not", "Xor", "Nand", "Nor", "Implies", "Equivalent"];
for (const [group, ops] of [
  ["Which", ["Which"]],
  ["If", ["If"]],
  ["When", ["When"]],
  ["comparison", COMPARE_OPS],
  ["connective", CONNECTIVE_OPS],
] as const) {
  def(SEL, `${group}:use`, "syntax", `${group}: used`);
  def(
    SEL,
    `${group}:list`,
    "type",
    `${group}: an operand whose static type is a list (element-wise use)`,
  );
  def(
    SEL,
    `${group}:maybe-list`,
    "type",
    `${group}: an operand whose static type admits a list but is not one (\`broadcastable<T>\`, a union with a list)`,
  );
  def(
    SEL,
    `${group}:absent`,
    "type",
    `${group}: an operand whose static type contains \`missing\` (a cell can be absent)`,
  );
}

const TYP = "Types of inputs and parameters";
const TYPE_TERMS: [string, string][] = [
  ["missing", "contains `missing`"],
  ["any", "contains `any`"],
  ["value", "contains `value`"],
  ["unknown", "contains `unknown`"],
  ["union", "is a union of shapes (`broadcastable<T>`, or `|` with a collection member)"],
  ["complex", "contains `complex` or `imaginary`"],
  ["number", "contains `number` (admits a complex value)"],
];
for (const [term, text] of TYPE_TERMS)
  def(TYP, `sym:${term}`, "type", `A symbol of the expression (input or parameter) whose type ${text}`);
def(TYP, `sym:inferred`, "type", "A symbol whose type is inferred, not declared (`inferredType`)");
for (const [term, text] of TYPE_TERMS)
  def(
    TYP,
    `free:${term}`,
    "result",
    `A free symbol of the compiled code (\`freeSymbolTypes\`) whose type ${text}`,
  );
def(TYP, `free:inferred`, "result", "A free symbol of the compiled code whose type was inferred (`provenance`)");
def(TYP, `sig:open`, "type", "A function symbol whose signature contains `unknown` or `any`");
def(TYP, `sig:default`, "type", "A function symbol whose signature has a parameter default (`= v`)");
def(TYP, `sig:returns-fn`, "type", "A function symbol whose signature returns a function");

const LST = "List shapes";
def(LST, "list:literal", "syntax", "A `List` literal");
def(LST, "list:depth2", "syntax", "A `List` literal nested to depth 2 (a list of lists)");
def(LST, "list:depth3", "syntax", "A `List` literal nested to depth 3 or more");
def(LST, "list:ragged", "syntax", "A `List` literal of lists of different lengths (not rectangular)");
def(LST, "list:points", "syntax", "A `List` literal whose elements are all points (`Pair`, `Tuple`, `PointList`) or tuples by type");
def(LST, "list:range", "syntax", "A `Range`");
def(LST, "ltype:list", "type", "A node whose static type is a list");
def(LST, "ltype:nested", "type", "A node whose static type is a list of lists or a matrix");
def(LST, "ltype:points", "type", "A node whose static type is a list of tuples (points)");
def(LST, "ltype:ragged", "type", "A node whose static type is a list of lists whose element types differ (a union of list types inside a list)");
def(LST, "root:list", "type", "The expression's own static type is a list (its value is broadcast)");

const ABS = "No-value results and their readers";
for (const s of ["Nothing", "Indeterminate", "Missing", "NaN", "Undefined"])
  def(ABS, `res:${s}`, "syntax", `\`${s}\` appears in the boxed expression`);
def(ABS, "res:error", "syntax", "An `Error` node in the boxed expression");
def(ABS, "res:type-nothing", "type", "A node whose static type is `nothing`");
for (const s of ["IsMissing", "Coalesce", "AssertPresent"])
  def(ABS, `read:${s}`, "syntax", `\`${s}\` is used`);

const FNV = "Function values";
const HOF_OPS = ["Sort", "Map", "Iterate", "Pipe", "Filter", "Fold", "Reduce", "Apply", "Tabulate", "Find", "Count"];
for (const h of HOF_OPS) {
  def(FNV, `hof:${h}:use`, "syntax", `\`${h}\` is used`);
  def(FNV, `hof:${h}:callback`, "type", `\`${h}\` with an operand that is a function (a \`Function\` literal or a symbol of function type)`);
}
def(FNV, "fn:lambda", "syntax", "A `Function` literal (lambda)");
def(FNV, "fn:user-call", "syntax", "A call to a document-defined function (`isDocumentFn`)");
def(FNV, "fn:fn-arg", "type", "A call to a document function with an argument that is a function");
def(FNV, "fn:curry", "syntax", "Currying: a `Function` whose body is a `Function`, or an `Apply` of a call");
def(FNV, "fn:partial", "type", "Partial application: a call with fewer arguments than the required parameters of the function's signature");

const BLK = "Block locals and effects";
def(BLK, "blk:block", "syntax", "A `Block`");
def(BLK, "blk:declare", "syntax", "A `Declare`");
def(BLK, "blk:assign", "syntax", "An `Assign`");
def(BLK, "blk:assign-branch", "syntax", "An `Assign` inside an `If`, `Which` or `When` inside a `Block`");
def(BLK, "blk:read-before", "syntax", "In a `Block`, a symbol read in a statement before the statement that first assigns it");
def(BLK, "blk:loop", "syntax", "A loop (`Loop`, `For`, `While`)");
def(BLK, "blk:loop-value", "syntax", "A loop whose value is used (not a statement of a `Block` other than its last one)");
def(BLK, "opt:vars-code", "option", "A `vars` entry of the compile options that is code, not a name or a member access (`_.x`)");

const OPT = "Compile options and targets";
def(OPT, "tgt:javascript", "option", "Compiled to `javascript`");
def(OPT, "tgt:interval-js", "option", "Compiled to `interval-js`");
def(OPT, "tgt:glsl", "option", "Compiled to `glsl`");
def(OPT, "tgt:wgsl", "option", "Compiled to `wgsl`");
def(OPT, "tgt:python", "option", "Compiled to `python`");
def(OPT, "tgt:other", "option", "Compiled to another target");
def(OPT, "tgt:multi", "option", "Compiled to two or more targets");
def(OPT, "decline", "result", "At least one compile of the expression declined or threw");
// Option keys are added dynamically as `optkey:<name>`.

const CPX = "Real/complex lane";
def(CPX, "cx:node", "type", "A node whose static type contains `complex` or `imaginary`");
def(CPX, "cx:literal", "syntax", "`ImaginaryUnit` or a complex number literal");
def(CPX, "cx:call-arg", "type", "A call to a document function, or a `Function` application, with an argument typed `complex` or `imaginary` (proxy for a complex value that reaches a parameter)");
def(CPX, "cx:mode-complex", "result", "A compile result with `mode: \"complex\"`");
def(CPX, "cx:promoted", "result", "A compile result with `promoted: true` (an unknown-sign `Sqrt`, `Ln`, `Log` or `Power` lowered through the complex kernel)");
def(CPX, "cx:escalation", "result", "A compile result with an `escalation` (the strict attempt declined on a lane mismatch and the compile was redone in complex mode)");
def(CPX, "cx:doc-complex-mode", "option", "The document is in complex mode (`complexMode`)");

// ── Counters ────────────────────────────────────────────────────────────────

type CorpusKey = "compile" | "rows";
interface Tally {
  expr: number;
  docs: Set<string>;
  examples: string[];
}
const tallies: Record<CorpusKey, Map<string, Tally>> = {
  compile: new Map(),
  rows: new Map(),
};
const opTallies: Record<CorpusKey, Map<string, Tally>> = {
  compile: new Map(),
  rows: new Map(),
};
const totals = {
  compile: {
    documents: 0,
    documentsFailed: 0,
    expressions: 0,
    compileCalls: 0,
    compileThrew: 0,
    analysisThrew: 0,
    withError: 0,
    perCorpus: {} as Record<string, number>,
  },
  rows: {
    documents: 0,
    documentsFailed: 0,
    rows: 0,
    boxThrew: 0,
    withError: 0,
    analysisThrew: 0,
    perCorpus: {} as Record<string, number>,
  },
};

const MAX_EXAMPLE = 140;
/** Candidates for the examples: the first expression of each of the first
 *  30 documents that have the feature. The report shows the three shortest
 *  of them, so the examples come from three documents where possible. */
function addExample(t: Tally, latex: string) {
  let s = latex.replace(/\s+/g, " ").trim();
  if (!s || t.examples.length >= 30) return;
  if (s.length > MAX_EXAMPLE) s = s.slice(0, MAX_EXAMPLE) + " …";
  if (!t.examples.includes(s)) t.examples.push(s);
}
function shortest(examples: string[]): string[] {
  return [...examples].sort((a, b) => a.length - b.length).slice(0, 3);
}
function hit(
  map: Map<string, Tally>,
  key: string,
  doc: string,
  latex: string,
) {
  let t = map.get(key);
  if (!t) {
    t = { expr: 0, docs: new Set(), examples: [] };
    map.set(key, t);
  }
  t.expr++;
  const newDoc = !t.docs.has(doc);
  t.docs.add(doc);
  if (newDoc) addExample(t, latex);
}

// ── Analysis of one boxed expression ────────────────────────────────────────

const CONSTANT_SYMBOLS = new Set([
  "Pi",
  "ExponentialE",
  "ImaginaryUnit",
  "True",
  "False",
  "Nothing",
  "Missing",
  "Indeterminate",
  "NaN",
  "Undefined",
  "PositiveInfinity",
  "NegativeInfinity",
  "ComplexInfinity",
  "Half",
  "EulerGamma",
  "GoldenRatio",
  "CatalanConstant",
]);
const POINT_HEADS = new Set(["Pair", "Tuple", "PointList", "Point", "Triple"]);
const LOOP_HEADS = new Set(["Loop", "For", "While"]);
const BRANCH_HEADS = new Set(["If", "Which", "When"]);

function typeOf(x: Expression): string {
  try {
    return String(x.type?.toString?.() ?? "");
  } catch {
    return "";
  }
}
function isListType(x: Expression): boolean {
  try {
    return x.type?.matches?.("list") === true;
  } catch {
    return false;
  }
}
const MAYBE_LIST = /broadcastable|\blist\b|matrix|vector|tensor|collection/;
const COLLECTION_WORD = /\b(list|tuple|matrix|vector|tensor|record|dictionary|string|set|collection)\b/;

function typeTerms(t: string): string[] {
  const out: string[] = [];
  if (/\bmissing\b/.test(t)) out.push("missing");
  if (/\bany\b/.test(t)) out.push("any");
  if (/\bvalue\b/.test(t)) out.push("value");
  if (/\bunknown\b/.test(t)) out.push("unknown");
  if (/broadcastable/.test(t) || (/\|/.test(t) && COLLECTION_WORD.test(t)))
    out.push("union");
  if (/\bcomplex\b|\bimaginary\b/.test(t)) out.push("complex");
  if (/\bnumber\b/.test(t)) out.push("number");
  return out;
}

/** Split `(a: x, b: y = 2) -> r` into its top-level parameter strings and
 *  its return type. Undefined when the string is not a signature. */
function splitSignature(t: string): { params: string[]; result: string } | undefined {
  const s = t.trim();
  if (!s.startsWith("(")) return undefined;
  let depth = 0;
  let end = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "<" || c === "[") depth++;
    else if (c === ")" || c === ">" || c === "]") {
      // `->` is not a closing bracket.
      if (c === ">" && s[i - 1] === "-") continue;
      depth--;
      if (depth === 0 && c === ")") {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return undefined;
  const rest = s.slice(end + 1).trim();
  if (!rest.startsWith("->")) return undefined;
  const inner = s.slice(1, end);
  const params: string[] = [];
  let cur = "";
  depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "(" || c === "<" || c === "[") depth++;
    else if ((c === ")" || c === ">" || c === "]") && !(c === ">" && inner[i - 1] === "-")) depth--;
    if (c === "," && depth === 0) {
      params.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) params.push(cur.trim());
  return { params, result: rest.slice(2).trim() };
}

function isFunctionValue(x: Expression): boolean {
  if (x.operator === "Function") return true;
  if (typeof x.symbol === "string") {
    const t = typeOf(x);
    return splitSignature(t) !== undefined || t === "function";
  }
  return false;
}

function symbolsRead(x: Expression, out: Set<string>) {
  if (typeof x.symbol === "string") {
    out.add(x.symbol);
    return;
  }
  const ops: Expression[] = x.ops ?? [];
  if (x.operator === "Assign" && ops.length > 0) {
    for (const o of ops.slice(1)) symbolsRead(o, out);
    return;
  }
  if (x.operator === "Declare") return;
  for (const o of ops) symbolsRead(o, out);
}

interface AnalysisContext {
  isDocumentFn: (name: string) => boolean;
}

/** The set of feature keys of one boxed expression, and the operators. */
function analyse(
  root: Expression,
  ctx: AnalysisContext,
): { features: Set<string>; operators: Set<string> } {
  const f = new Set<string>();
  const operators = new Set<string>();
  if (isListType(root)) f.add("root:list");

  const visit = (
    x: Expression,
    parent: Expression | undefined,
    index: number,
    inBlock: boolean,
    inBranchInBlock: boolean,
  ) => {
    const t = typeOf(x);
    // A statement of a block (`Assign`, `Declare`, or any statement but the
    // last) has the type `nothing` by construction: it is not a result.
    const isStatement =
      x.operator === "Assign" ||
      x.operator === "Declare" ||
      (parent?.operator === "Block" && index < (parent.ops?.length ?? 0) - 1);
    if (t === "nothing" && !isStatement) f.add("res:type-nothing");
    if (/\bcomplex\b|\bimaginary\b/.test(t)) f.add("cx:node");
    if (isListType(x)) {
      f.add("ltype:list");
      if (/^(list<(list|matrix|vector)|matrix)/.test(t)) f.add("ltype:nested");
      if (/^list<tuple/.test(t)) f.add("ltype:points");
      if (/^list<.*\blist<.*\|.*\blist</.test(t)) f.add("ltype:ragged");
    }

    // Symbols.
    if (typeof x.symbol === "string") {
      const name: string = x.symbol;
      if (["Nothing", "Indeterminate", "Missing", "NaN", "Undefined"].includes(name))
        f.add(`res:${name}`);
      if (name === "ImaginaryUnit") f.add("cx:literal");
      if (CONSTANT_SYMBOLS.has(name)) return;
      const sig = splitSignature(t);
      if (sig) {
        if (/\bunknown\b|\bany\b/.test(t)) f.add("sig:open");
        if (sig.params.some((p) => /=/.test(p))) f.add("sig:default");
        if (splitSignature(sig.result) !== undefined) f.add("sig:returns-fn");
        return;
      }
      // An operator name in a call position is not a value symbol.
      if (parent && index < 0) return;
      for (const term of typeTerms(t)) f.add(`sym:${term}`);
      try {
        if (x.valueDefinition?.inferredType === true) f.add("sym:inferred");
      } catch {
        /* no definition */
      }
      return;
    }

    // Numbers.
    if (x.isNumberLiteral) {
      const j = x.json;
      if (j === "NaN" || (typeof j === "object" && j?.num === "NaN")) f.add("res:NaN");
      try {
        if (typeof x.im === "number" && x.im !== 0) f.add("cx:literal");
      } catch {
        /* not a number */
      }
      return;
    }

    const op: string | undefined = x.operator;
    const ops: Expression[] = x.ops ?? [];
    if (typeof op !== "string") return;
    // Tycho names its generated helper operators `TychoCertificate<n>`;
    // they are counted as one operator.
    operators.add(/^TychoCertificate\d+$/.test(op) ? "TychoCertificate<n>" : op);
    if (op === "Error") f.add("res:error");
    if (op === "Complex") f.add("cx:literal");

    // Selection, comparisons, connectives. A top-level `Equal` is an
    // equation or a definition row, not a comparison.
    let group: string | undefined;
    if (SELECT_OPS.includes(op)) group = op;
    else if (COMPARE_OPS.includes(op)) {
      // An `Equal` at the root, or as the first operand of a root `When`
      // (`y = f(x) {x > 0}`), is an equation or a definition row.
      const equation =
        op === "Equal" &&
        (parent === undefined ||
          (parent === root && root.operator === "When" && index === 0));
      group = equation ? undefined : "comparison";
    }
    else if (CONNECTIVE_OPS.includes(op)) group = "connective";
    if (group) {
      f.add(`${group}:use`);
      for (const o of ops) {
        const ot = typeOf(o);
        if (isListType(o)) f.add(`${group}:list`);
        else if (MAYBE_LIST.test(ot)) f.add(`${group}:maybe-list`);
        if (/\bmissing\b/.test(ot)) f.add(`${group}:absent`);
      }
    }

    if (["IsMissing", "Coalesce", "AssertPresent"].includes(op)) f.add(`read:${op}`);

    // Lists.
    if (op === "List") {
      f.add("list:literal");
      const depth = (e: Expression): number =>
        e.operator === "List" ? 1 + Math.max(0, ...(e.ops ?? []).map(depth)) : 0;
      const d = depth(x);
      if (d === 2) f.add("list:depth2");
      if (d >= 3) f.add("list:depth3");
      if (ops.length > 1 && ops.every((o) => o.operator === "List")) {
        const lengths = new Set(ops.map((o) => (o.ops ?? []).length));
        if (lengths.size > 1) f.add("list:ragged");
      }
      if (
        ops.length > 0 &&
        ops.every((o) => POINT_HEADS.has(o.operator) || /^tuple</.test(typeOf(o)))
      )
        f.add("list:points");
    }
    if (op === "Range") f.add("list:range");

    // Function values.
    if (HOF_OPS.includes(op)) {
      f.add(`hof:${op}:use`);
      if (ops.some(isFunctionValue)) f.add(`hof:${op}:callback`);
    }
    if (op === "Function") {
      f.add("fn:lambda");
      if (ops[0]?.operator === "Function") f.add("fn:curry");
    }
    if (op === "Apply" && ops[0] && typeof ops[0].symbol !== "string" && ops[0].operator !== "Function")
      f.add("fn:curry");
    const userCall = ctx.isDocumentFn(op);
    if (userCall) {
      f.add("fn:user-call");
      if (ops.some(isFunctionValue)) f.add("fn:fn-arg");
    }
    if (userCall || (op === "Apply" && ops[0]?.operator === "Function")) {
      const args = op === "Apply" ? ops.slice(1) : ops;
      if (args.some((a) => /\bcomplex\b|\bimaginary\b/.test(typeOf(a)))) f.add("cx:call-arg");
    }
    if (userCall) {
      // The signature of the operator, read from the boxed operator symbol.
      let sigType = "";
      try {
        sigType = String(x.operatorDefinition?.signature?.toString?.() ?? "");
      } catch {
        sigType = "";
      }
      const sig = splitSignature(sigType);
      if (sig) {
        if (/\bunknown\b|\bany\b/.test(sigType)) f.add("sig:open");
        if (sig.params.some((p) => /=/.test(p))) f.add("sig:default");
        if (splitSignature(sig.result) !== undefined) f.add("sig:returns-fn");
        const required = sig.params.filter((p) => !/[?=]|\.\.\.|\+$|\*$/.test(p)).length;
        if (ops.length < required) f.add("fn:partial");
      }
    }

    // Blocks.
    if (op === "Block") {
      f.add("blk:block");
      const firstAssign = new Map<string, number>();
      ops.forEach((s, i) => {
        if ((s.operator === "Assign" || s.operator === "Declare") && typeof s.ops?.[0]?.symbol === "string") {
          const n = s.ops[0].symbol;
          if (s.operator === "Assign" && !firstAssign.has(n)) firstAssign.set(n, i);
        }
      });
      ops.forEach((s, i) => {
        const read = new Set<string>();
        symbolsRead(s, read);
        for (const n of read) {
          const k = firstAssign.get(n);
          if (k !== undefined && k > i) f.add("blk:read-before");
        }
      });
    }
    if (op === "Declare") f.add("blk:declare");
    if (op === "Assign") {
      f.add("blk:assign");
      if (inBranchInBlock) f.add("blk:assign-branch");
    }
    if (LOOP_HEADS.has(op)) {
      f.add("blk:loop");
      const isStatement =
        parent?.operator === "Block" && index < (parent.ops?.length ?? 0) - 1;
      if (!isStatement) f.add("blk:loop-value");
    }

    const nowInBlock = inBlock || op === "Block";
    const nowInBranch = inBranchInBlock || (nowInBlock && BRANCH_HEADS.has(op));
    ops.forEach((o, i) => visit(o, x, i, nowInBlock, nowInBranch));
  };
  visit(root, undefined, 0, false, false);
  return { features: f, operators };
}

function containsHead(json: unknown, head: string): boolean {
  if (Array.isArray(json)) {
    if (json[0] === head) return true;
    return json.some((x) => containsHead(x, head));
  }
  if (json !== null && typeof json === "object")
    return Object.values(json as Record<string, unknown>).some((x) => containsHead(x, head));
  return false;
}

// ── The compile corpus: the recording compile ───────────────────────────────

const rawCompile = (ceModule as unknown as { compile: Function }).compile;

const context: { corpus: string; doc: string; row: string } = {
  corpus: "",
  doc: "",
  row: "",
};

interface CompileEntry {
  latex: string;
  features: Set<string>;
  operators: Set<string>;
  targets: Set<string>;
}
/** The expressions of the current document, by MathJSON. */
let docEntries = new Map<string, CompileEntry>();
/** Set by `runDocument`/`runShowcase` (through `setupState`) for the
 *  analysis of the compile inputs of the current document. */
let currentIsDocumentFn: (name: string) => boolean = () => false;

const IDENTIFIER_OR_MEMBER = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\[\d+\])*$/;

function recordingCompile(expr: Expression, options?: Record<string, unknown>) {
  totals.compile.compileCalls++;
  let key = "";
  try {
    key = JSON.stringify(expr.json);
  } catch {
    key = String(Math.random());
  }
  let entry = docEntries.get(key);
  if (!entry) {
    let latex = "";
    try {
      latex = expr.latex;
    } catch {
      latex = "(unserializable)";
    }
    let features = new Set<string>();
    let operators = new Set<string>();
    try {
      ({ features, operators } = analyse(expr, { isDocumentFn: currentIsDocumentFn }));
    } catch (e) {
      totals.compile.analysisThrew++;
      features.add("analysis-threw");
    }
    if (containsHead(expr.json, "Error")) features.add("res:error");
    entry = { latex, features, operators, targets: new Set() };
    docEntries.set(key, entry);
  }
  const target = String(options?.to ?? "javascript");
  entry.targets.add(target);
  for (const [k, v] of Object.entries(options ?? {})) {
    if (k === "to") continue;
    entry.features.add(`optkey:${k}`);
    if (typeof v === "string" || typeof v === "boolean" || typeof v === "number")
      entry.features.add(`optkey:${k}=${String(v)}`);
    if (k === "vars" && v && typeof v === "object")
      for (const code of Object.values(v as Record<string, unknown>))
        if (typeof code !== "string" || !IDENTIFIER_OR_MEMBER.test(code))
          entry.features.add("opt:vars-code");
  }
  let r: any;
  try {
    r = rawCompile(expr, options);
  } catch (e) {
    totals.compile.compileThrew++;
    entry.features.add("decline");
    throw e;
  }
  if (r?.success !== true) entry.features.add("decline");
  if (r?.mode === "complex") entry.features.add("cx:mode-complex");
  if (r?.promoted === true) entry.features.add("cx:promoted");
  if (r?.escalation) entry.features.add("cx:escalation");
  const fst = r?.freeSymbolTypes;
  if (fst && typeof fst === "object")
    for (const info of Object.values(fst as Record<string, any>)) {
      for (const term of typeTerms(String(info?.type ?? "")))
        entry.features.add(`free:${term}`);
      if (info?.provenance === "inferred") entry.features.add("free:inferred");
    }
  return r;
}
registerComputeEngineModule({
  ...(ceModule as unknown as Record<string, unknown>),
  compile: recordingCompile,
} as never);

/** Move the expressions of the finished document into the tallies. */
function flushCompileDocument(corpus: string, id: string, complexMode: boolean) {
  const doc = `${corpus}/${id}`;
  for (const e of docEntries.values()) {
    totals.compile.expressions++;
    totals.compile.perCorpus[corpus] = (totals.compile.perCorpus[corpus] ?? 0) + 1;
    if (e.features.has("res:error")) totals.compile.withError++;
    for (const t of e.targets) {
      const known = ["javascript", "interval-js", "glsl", "wgsl", "python"];
      e.features.add(known.includes(t) ? `tgt:${t}` : "tgt:other");
    }
    if (e.targets.size > 1) e.features.add("tgt:multi");
    if (complexMode) e.features.add("cx:doc-complex-mode");
    for (const k of e.features) hit(tallies.compile, k, doc, e.latex);
    for (const o of e.operators)
      if (!currentIsDocumentFn(o)) hit(opTallies.compile, o, doc, e.latex);
  }
  docEntries = new Map();
}

// ── The rows corpus ─────────────────────────────────────────────────────────

function censusRows(corpus: string, id: string, doc: DocLike, s: Setup) {
  totals.rows.documents++;
  const docKey = `${corpus}/${id}`;
  const ce: any = s.ce;
  const isDocumentFn = s.mgr.isDocumentFn;
  for (const cell of doc.cells as any[]) {
    if (cell.type !== "equation") continue;
    const source = cell.latex;
    if (typeof source !== "string" || source.trim() === "") continue;
    totals.rows.rows++;
    totals.rows.perCorpus[corpus] = (totals.rows.perCorpus[corpus] ?? 0) + 1;
    let result: { features: Set<string>; operators: Set<string> } | undefined;
    try {
      result = s.mgr.withRowParamScope(source, () => {
        const expr = ce.parse(source);
        const hasError = containsHead(expr.json, "Error");
        let a: { features: Set<string>; operators: Set<string> };
        try {
          a = analyse(expr, { isDocumentFn });
        } catch {
          totals.rows.analysisThrew++;
          a = { features: new Set(["analysis-threw"]), operators: new Set() };
        }
        if (hasError) a.features.add("res:error");
        return a;
      });
    } catch {
      totals.rows.boxThrew++;
      continue;
    }
    if (!result) continue;
    if (result.features.has("res:error")) totals.rows.withError++;
    if (s.mgr.complexMode) result.features.add("cx:doc-complex-mode");
    for (const k of result.features) hit(tallies.rows, k, docKey, source);
    for (const o of result.operators)
      if (!isDocumentFn(o)) hit(opTallies.rows, o, docKey, source);
  }
}

// ── Product pipeline (after the recorder is registered) ─────────────────────

import {
  resolveSeriesData,
  resolveVolumeSeriesData,
} from "/Users/arno/dev/tycho/src/plot/resolve-fn.js";
import type { PlotSeriesInput } from "/Users/arno/dev/tycho/src/plot/types.js";
import type { VolumeSeriesInput } from "/Users/arno/dev/tycho/src/plot-3d/types.js";
import { convertDesmosState } from "/Users/arno/dev/tycho/src/graph-paper/desmos-import/index.js";
import {
  DocumentCEManager,
  numericListElements,
} from "/Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.js";
import type { CEConfig } from "/Users/arno/dev/tycho/src/graph-paper/editors/settings/ce-config.js";
import { inferSeries } from "/Users/arno/dev/tycho/src/graph-paper/graph/series-inference.js";
import type { InferredSeries } from "/Users/arno/dev/tycho/src/graph-paper/graph/series-inference.js";
import { classifyFormulaArtifact } from "/Users/arno/dev/tycho/src/plot-core/classify-formula.js";
import type { ClassifyOptions } from "/Users/arno/dev/tycho/src/plot-core/classify-formula.js";
import { MaterializeBudget } from "/Users/arno/dev/tycho/src/plot-core/materialize-budget.js";
import { normalizeInferredSeries } from "/Users/arno/dev/tycho/src/graph-paper/graph/hydrate-plot.js";
import { mergeSeriesPatch } from "/Users/arno/dev/tycho/src/graph-paper/graph/state.js";
import type {
  SeriesInput,
  SeriesPatch,
} from "/Users/arno/dev/tycho/src/graph-paper/graph/state.js";
import { resolveSourceAuthoredStyle } from "/Users/arno/dev/tycho/src/graph-paper/graph/source-authored-style.js";
import { collectColorDefinitions } from "/Users/arno/dev/tycho/src/graph-paper/graph/style-expressions.js";
import type {
  ColorDefinitions,
  StyleDefinitionCell,
} from "/Users/arno/dev/tycho/src/graph-paper/graph/style-expressions.js";
import { canonicalNameToLatex } from "/Users/arno/dev/tycho/src/graph-paper/variables/reference-rewrite.js";
import {
  resolveAllComputedCollections,
  makeComputedSymbolResolver,
} from "/Users/arno/dev/tycho/src/graph-paper/graph/computed-collections.js";
import {
  canonicalSymbolFromName,
  documentVariableRangesOf,
  runVariablePass,
  type VariableSource,
} from "/Users/arno/dev/tycho/src/graph-paper/variables/dependency-graph.js";
import { variableDefinitionFromFields } from "/Users/arno/dev/tycho/src/graph-paper/variables/variable-model.js";
import {
  SolverRegistry,
  createDocumentSolverNamespace,
  resolveScalarBodies,
  resolveTableColumns,
  type SolverTableCellSource,
} from "/Users/arno/dev/tycho/src/graph-paper/graph/solver-registry.js";
import { sanitizeUniformName } from "/Users/arno/dev/tycho/src/graph-paper/variables/sanitize-uniform-name.js";
import {
  SHOWCASE,
  definitionLatex,
} from "/Users/arno/dev/tycho/src/graph-paper/onboarding/templates.js";

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

function setupState(doc: DocLike): Setup {
  const mgr = new DocumentCEManager(CONFIG);
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
  mgr.setCells(
    doc.cells
      .filter((c: any) => typeof c.latex === "string" && c.latex.trim())
      .map((c: any) => ({ latex: c.latex, visible: c.visible !== false })),
  );
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
  return normalizeInferredSeries(
    patched,
    {
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
    },
    patch
      ? { base: inferred, authoredKeys: new Set(Object.keys(patch)) }
      : null,
  );
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

function runDocument(corpus: string, id: string, doc: DocLike): void {
  const t0 = performance.now();
  const summary: DocSummary = { corpus, doc: id, rows: 0, series: 0, ms: 0 };
  context.corpus = corpus;
  context.doc = id;
  context.row = "(setup)";
  let s: Setup;
  try {
    s = setupState(doc);
  } catch (e) {
    summary.error = `setup: ${String((e as Error).message).slice(0, 200)}`;
    summary.ms = Math.round(performance.now() - t0);
    docs.push(summary);
    totals.compile.documentsFailed++;
    totals.rows.documentsFailed++;
    return;
  }
  // Census: box every equation row first (the rows corpus), then run the
  // product pipeline, whose compile calls the recorder analyses.
  try {
    censusRows(corpus, id, doc, s);
  } catch (e) {
    process.stderr.write(`  census rows failed (${id}): ${String((e as Error).message).slice(0, 120)}\n`);
  }
  totals.compile.documents++;
  currentIsDocumentFn = s.mgr.isDocumentFn;
  runRows(doc, s, summary, id);
  flushCompileDocument(corpus, id, s.mgr.complexMode === true);
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

function runDesmos(all: boolean): void {
  for (const { corpus, id } of desmosTargets(all).slice(0, LIMIT)) {
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
      totals.compile.documentsFailed++;
      totals.rows.documentsFailed++;
      continue;
    }
    runDocument(corpus, id, res.document as unknown as DocLike);
  }
}

// ── Native showcase entries ─────────────────────────────────────────────────

function runShowcase(): void {
  let nextId = 1;
  for (const entry of SHOWCASE) {
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
      ...(entry.category === "3d" ? { dimension: 3 as const } : {}),
    };
    const t0 = performance.now();
    const summary: DocSummary = {
      corpus: "showcase",
      doc: entry.id,
      rows: cells.length,
      series: 0,
      ms: 0,
    };
    context.corpus = "showcase";
    context.doc = entry.id;
    context.row = "(setup)";
    let s: Setup;
    try {
      s = setupState(doc);
    } catch (e) {
      summary.error = `setup: ${String((e as Error).message).slice(0, 200)}`;
      docs.push(summary);
      totals.compile.documentsFailed++;
      continue;
    }
    totals.compile.documents++;
    currentIsDocumentFn = s.mgr.isDocumentFn;
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
    flushCompileDocument("showcase", entry.id, false);
    summary.ms = Math.round(performance.now() - t0);
    docs.push(summary);
    process.stderr.write(
      `showcase/${entry.id}: ${summary.series} series, ${summary.ms} ms\n`,
    );
  }
}


// ── Main ────────────────────────────────────────────────────────────────────

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;

const t0 = performance.now();
runShowcase();
runDesmos(true);
const elapsed = Math.round((performance.now() - t0) / 1000);

// ── Report ──────────────────────────────────────────────────────────────────

function cell(map: Map<string, Tally>, key: string): [number, number] {
  const t = map.get(key);
  return t ? [t.expr, t.docs.size] : [0, 0];
}
function md(s: string): string {
  return s.replace(/\|/g, "\\|");
}
function examplesFor(key: string, rowsMap = tallies.rows, compileMap = tallies.compile): string {
  const ex = shortest(rowsMap.get(key)?.examples ?? []);
  for (const e of shortest(compileMap.get(key)?.examples ?? [])) {
    if (ex.length >= 3) break;
    if (!ex.includes(e)) ex.push(e);
  }
  return ex.map((e) => "`` " + md(e) + " ``").join("<br>");
}
function pct(n: number, d: number): string {
  return d === 0 ? "" : ` (${((100 * n) / d).toFixed(1)}%)`;
}

const out: string[] = [];
const C = totals.compile;
const R = totals.rows;
const compileDocs = C.documents;
out.push(
  "# Census: which features of the language Tycho uses",
  "",
  `**Status:** measurement, ${new Date().toLocaleDateString("sv")}. Written by ` +
    "`census.mts` in this directory; its header gives the command. Compute Engine " +
    `${CE_VERSION} (the version installed in Tycho's \`node_modules\`), interpreter side only: no production build. Run time ${elapsed} s.`,
  "",
  "This is the census of section 7 of `docs/plans/2026-11-01-language-axes-survey.md`. The bigint compile mode is not counted.",
  "",
  "## Corpora and totals",
  "",
  "- **compile**: the expressions that Tycho's product pipeline hands to `compile()` " +
    "(classify, normalize, resolve, and the deferred GLSL compile of `<math-plot>`), " +
    "over the documents of `tycho/scripts/audit-ce-codegen.mts --all`. One expression " +
    "is one distinct MathJSON tree per document; the targets and options of its compile calls are merged.",
  "- **rows**: every equation row with LaTeX of the Desmos states, boxed as " +
    "`tycho/scripts/ce-round-trip-audit.mts` boxes it (a strict `ce.parse` inside " +
    "`withRowParamScope`, with the document's declarations, slider ranges, angle unit, " +
    "complex mode and dimension). Every row counts, with no deduplication. A definition " +
    "row `f(x)=...` boxes as `Equal(f(x), ...)`; a top-level `Equal` is therefore not counted as a comparison, in both corpora.",
  "",
  "| Total | compile | rows |",
  "| --- | ---: | ---: |",
  `| Documents (Desmos states + showcase entries) | ${compileDocs} (${Object.entries(C.perCorpus).map(([k, v]) => k).join(", ")}) | ${R.documents} |`,
  `| Documents whose setup failed (convert or manager) | ${C.documentsFailed} | ${R.documentsFailed} |`,
  `| Expressions (compile: distinct per document; rows: equation rows) | ${C.expressions} | ${R.rows} |`,
  `| ... by source | ${Object.entries(C.perCorpus).map(([k, v]) => `${k} ${v}`).join(", ")} | ${Object.entries(R.perCorpus).map(([k, v]) => `${k} ${v}`).join(", ")} |`,
  `| \`compile()\` calls | ${C.compileCalls} | |`,
  `| \`compile()\` calls that threw | ${C.compileThrew} | |`,
  `| Rows whose box threw (failed to box) | | ${R.boxThrew} |`,
  `| Expressions that hold an \`Error\` node (boxed, but invalid) | ${C.withError}${pct(C.withError, C.expressions)} | ${R.withError}${pct(R.withError, R.rows)} |`,
  `| Expressions on which this census's own analysis threw | ${C.analysisThrew} | ${R.analysisThrew} |`,
  "",
  "**Counted by**: `syntax` reads the MathJSON structure of the boxed, canonical " +
    "expression; `type` reads the static `.type` of a node (in the scope the product " +
    "pushed: for the compile corpus, the scope of the compile call); `option` reads the " +
    "compile options; `result` reads the compile result (`freeSymbolTypes`, `mode`, " +
    "`promoted`, `escalation`, `success`). Each column counts expressions that have the " +
    "feature at least once, and the documents that have at least one such expression.",
  "",
);

out.push(
  "## What the census cannot measure, and the proxies used",
  "",
  "- **A value that crosses the real/complex lane at run time** is not static. The nearest " +
    "proxies are a call to a document function (or a `Function` application) with an argument " +
    "whose static type is `complex` or `imaginary`, and the compile results with `mode: \"complex\"`, " +
    "`promoted` or `escalation` (section \"Real/complex lane\").",
  "- **`Nothing` and `Indeterminate` as results** of an evaluation are not computed: the census " +
    "does not evaluate. It counts the symbols in the boxed expression and the nodes whose static " +
    "type is `nothing` (statements of a block are excluded).",
  "- **A read before the first assignment on some path** is approximated by statement order " +
    "in a `Block` (a symbol read in a statement before the statement that first assigns it); " +
    "no control-flow analysis is done.",
  "- **Partial application** is a call with fewer arguments than the required parameters of " +
    "the operator's signature. The hits that were inspected are a list index written on a name " +
    "that is also a document function (`F[2]` boxed as a call `F(2)`), not partial application.",
  "- **Currying**: the hits that were inspected are derivatives, `f'(x)`, which box as " +
    "`Apply(Derivative(f), x)`; none is a function that returns a function.",
  "- **Rectangular lists** are judged on `List` literals only. A list built by a comprehension, " +
    "a `Range` or `join` has no literal shape; its static type is counted instead " +
    "(\"a list of lists whose element types differ\" is a regular expression on the type string).",
  "- **The types of row parameters** in the rows corpus are those Tycho declares in " +
    "`withRowParamScope`: the parameters of a definition row are declared " +
    "`broadcastable<number | tuple>`, which is why \"a union of shapes\" is frequent there. In the " +
    "compile corpus the types are those of the scope of the compile call, and the " +
    "`freeSymbolTypes` rows are the compiler's own report.",
  "- The rows corpus counts hidden rows too, so it has more rows than the 5,337 visible equation " +
    "rows that `audit-ce-codegen.mts --all` reports.",
  "- The Compute Engine is the version installed in Tycho, not the source tree of this repo.",
  "",
);

const sections = [...new Set(FEATURES.map((f) => f.section))];
const optKeys = [
  ...new Set([...tallies.compile.keys()].filter((k) => k.startsWith("optkey:"))),
].sort();
for (const k of optKeys)
  FEATURES.push({
    section: "Compile options and targets",
    key: k,
    method: "option",
    label: k.includes("=")
      ? `Compile option \`${k.slice(7).replace("=", ": ")}\``
      : `Compile option \`${k.slice(7)}\` is passed`,
  });
for (const section of sections) {
  out.push(`## ${section}`, "");
  out.push(
    "| Feature | Counted by | compile: expressions | compile: documents | rows: expressions | rows: documents | Examples |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |",
  );
  for (const fd of FEATURES.filter((f) => f.section === section)) {
    const [ce, cd] = cell(tallies.compile, fd.key);
    const [re, rd] = cell(tallies.rows, fd.key);
    out.push(
      `| ${md(fd.label)} | ${fd.method} | ${ce} | ${cd} | ${re} | ${rd} | ${examplesFor(fd.key)} |`,
    );
  }
  out.push("");
}

// Targets per expression, as sets.
out.push("## Operators", "");
out.push(
  "Every operator of the boxed expressions, by the number of expressions that use it (syntax). Sorted by rows, then compile.",
  "",
  "| Operator | compile: expressions | compile: documents | rows: expressions | rows: documents | Examples |",
  "| --- | ---: | ---: | ---: | ---: | --- |",
);
const allOps = [...new Set([...opTallies.compile.keys(), ...opTallies.rows.keys()])];
allOps.sort(
  (a, b) =>
    cell(opTallies.rows, b)[0] - cell(opTallies.rows, a)[0] ||
    cell(opTallies.compile, b)[0] - cell(opTallies.compile, a)[0] ||
    a.localeCompare(b),
);
for (const o of allOps) {
  const [ce, cd] = cell(opTallies.compile, o);
  const [re, rd] = cell(opTallies.rows, o);
  out.push(
    `| \`${md(o)}\` | ${ce} | ${cd} | ${re} | ${rd} | ${examplesFor(o, opTallies.rows, opTallies.compile)} |`,
  );
}
out.push("");

writeFileSync(path.join(HERE, "census.md"), out.join("\n") + "\n");
const json = {
  computeEngine: CE_VERSION,
  generatedAt: new Date().toISOString(),
  totals,
  features: Object.fromEntries(
    (["compile", "rows"] as const).map((c) => [
      c,
      Object.fromEntries(
        [...tallies[c]].map(([k, t]) => [k, { expr: t.expr, docs: t.docs.size, examples: t.examples }]),
      ),
    ]),
  ),
  operators: Object.fromEntries(
    (["compile", "rows"] as const).map((c) => [
      c,
      Object.fromEntries([...opTallies[c]].map(([k, t]) => [k, { expr: t.expr, docs: t.docs.size }])),
    ]),
  ),
};
writeFileSync(path.join(HERE, "census.json"), JSON.stringify(json, null, 1) + "\n");
process.stderr.write(`census: ${elapsed} s; wrote ${path.join(HERE, "census.md")}\n`);
