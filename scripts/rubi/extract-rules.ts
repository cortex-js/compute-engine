// Rubi rule extractor — parses Rubi `.m` integration-rule files
// (Rubi/IntegrationRules/**) into structured records.
//
// A rule file is a sequence of cells separated by blank lines; live rules
// are cells of the form
//
//   Int[<integrand-pattern>, x_Symbol] :=
//     <body> /; <condition>
//
// where <body> may be `With[{q = …}, inner /; innerCondition]` (or
// `Module[…]`, same shape). Superseded rules are commented out and are
// dropped with the comments. Rule order within a file is Rubi's
// specificity/priority order and MUST be preserved.

import { readFileSync } from 'node:fs';

import { parseWL, Json } from './wl-parser';

export type RubiRule = {
  /** 1-based position among the live rules of the file (= priority) */
  index: number;
  /** integrand pattern (first argument of `Int`), with Blank/BlankOptional nodes */
  lhs: Json;
  /** name of the integration variable (from `x_Symbol`) */
  variable: string;
  /** rule body, with conditions and local bindings stripped */
  rhs: Json;
  /** outer `/;` condition (over pattern variables), or null */
  condition: Json | null;
  /** With/Module local bindings, in order; value null for bare Module locals */
  bindings: { name: string; value: Json | null }[];
  scoped: 'with' | 'module' | null;
  /** `/;` condition inside the With/Module scope (may reference bindings) */
  innerCondition: Json | null;
  /** original cell text */
  source: string;
};

export type ExtractResult = {
  rules: RubiRule[];
  errors: { index: number; error: string; source: string }[];
};

/** Strip WL comments (nested), preserving newlines for cell structure. */
export function stripComments(src: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    if (src.startsWith('(*', i)) {
      depth++;
      i++;
    } else if (depth > 0 && src.startsWith('*)', i)) {
      depth--;
      i++;
    } else if (depth === 0) {
      out += src[i];
    } else if (src[i] === '\n') {
      out += '\n';
    }
  }
  return out;
}

function asCall(expr: Json, op: string): Json[] | null {
  return Array.isArray(expr) && expr[0] === op ? (expr as Json[]) : null;
}

/** Net bracket depth of a fragment, ignoring brackets inside strings. */
function bracketBalance(s: string): number {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if ('[({'.includes(c)) depth++;
    else if ('])}'.includes(c)) depth--;
  }
  return depth;
}

export function extractRules(filePath: string): ExtractResult {
  const src = stripComments(readFileSync(filePath, 'utf8'));
  // Blank-line cells — but rules may contain internal blank lines (e.g.
  // where a comment was stripped, or in If[TrueQ[$LoadShowSteps], …]
  // cells), so merge fragments until brackets balance and the cell does
  // not end mid-definition.
  const fragments = src.split(/\n\s*\n/).map((c) => c.trim());
  const cells: string[] = [];
  for (const frag of fragments) {
    if (frag === '') continue;
    const prev = cells.length > 0 ? cells[cells.length - 1] : undefined;
    const prevIncomplete =
      prev !== undefined &&
      (bracketBalance(prev) > 0 || /(:=|\/;|[+\-*/^,]|&&|\|\|)$/.test(prev));
    if (prevIncomplete) cells[cells.length - 1] = prev + '\n' + frag;
    else cells.push(frag);
  }

  const ruleCells = cells.filter(
    (c) => c.startsWith('Int[') || c.startsWith('If[TrueQ[$LoadShowSteps]')
  );

  const rules: RubiRule[] = [];
  const errors: ExtractResult['errors'] = [];

  ruleCells.forEach((cell, i) => {
    const index = i + 1;
    try {
      let expr = parseWL(cell);
      // If[TrueQ[$LoadShowSteps], <ShowStep variant>, <plain rule>] —
      // keep the plain (non-display) definition.
      const cond = asCall(expr, 'If');
      if (cond && cell.startsWith('If[TrueQ[$LoadShowSteps]')) {
        if (cond.length !== 4)
          throw new Error('unexpected $LoadShowSteps If shape');
        expr = cond[3];
      }
      rules.push(normalizeRule(index, expr, cell));
    } catch (e) {
      errors.push({ index, error: String(e), source: cell });
    }
  });
  applyUpstreamCorrections(filePath, rules);
  return { rules, errors };
}

/**
 * Corrections for verified bugs in the frozen Rubi 4.17.3.0 source. Each entry
 * is keyed by a path substring + rule index and rewrites the rule's `rhs`.
 * Kept here (not hand-edited into the corpus JSON) so a regeneration preserves
 * the fix. Every correction must cite the math and stay minimal.
 */
function applyUpstreamCorrections(filePath: string, rules: RubiRule[]): void {
  // 1.1.3.6 (rules #19/#20): splitting (e+f·x^n) out of (g·x)^m gives
  //   f·x^n·(g·x)^m = (f/g^n)·(g·x)^(m+n)  — the second term's coefficient is
  // f/g^n, but the Rubi source writes f/e^n (e is the *constant* of the third
  // binomial, not the coefficient g of (g·x)^m). With the common default g=1
  // this should be just f, yet f/e^n divides by e^n. Surfaced as a wrong
  // antiderivative for ∫x^m·(c+d·x³)^(k/2)/(8c−d·x³) (1.1.3.4 two-binomial
  // family). Matched by content, not index (f/e^n is never a correct split
  // coefficient, and only these rules carry the pattern). Fix: f/e^n → f/g^n.
  if (filePath.includes('1.1.3.6 (g x)^m')) {
    const fix = (node: Json): Json => {
      if (Array.isArray(node)) {
        if (
          node[0] === 'Divide' &&
          node[1] === 'f' &&
          Array.isArray(node[2]) &&
          node[2][0] === 'Power' &&
          node[2][1] === 'e_var'
        )
          return ['Divide', 'f', ['Power', 'g', node[2][2]]];
        return node.map(fix);
      }
      return node;
    };
    for (const r of rules) r.rhs = fix(r.rhs);
  }
}

function normalizeRule(index: number, expr: Json, source: string): RubiRule {
  const setDelayed = asCall(expr, 'SetDelayed');
  if (!setDelayed) throw new Error('rule is not a SetDelayed definition');
  const [, lhsCall, rhsExpr] = setDelayed;

  const int = asCall(lhsCall, 'Int');
  if (!int || int.length !== 3) throw new Error('LHS is not Int[…, x_Symbol]');
  const [, lhs, varPat] = int;
  // The integration-variable slot is `x_Symbol` or plain `x_`.
  const blank = asCall(varPat, 'Blank');
  if (
    !blank ||
    typeof blank[1] !== 'string' ||
    blank[1] === '' ||
    (blank[2] !== undefined && blank[2] !== 'Symbol')
  )
    throw new Error('integration variable is not an x_/x_Symbol pattern');
  const variable = blank[1];

  // Outer condition: rhs = Condition[body, cond]
  let body = rhsExpr;
  let condition: Json | null = null;
  const outerCond = asCall(body, 'Condition');
  if (outerCond) {
    body = outerCond[1];
    condition = outerCond[2];
  }

  // With/Module scope (possibly nested) with optional inner condition
  const bindings: RubiRule['bindings'] = [];
  let scoped: RubiRule['scoped'] = null;
  let innerCondition: Json | null = null;
  for (;;) {
    const scope = asCall(body, 'With') ?? asCall(body, 'Module');
    if (!scope) break;
    if (scope.length !== 3)
      throw new Error(`${scope[0]} with ${scope.length - 1} arguments`);
    scoped = scoped ?? ((scope[0] === 'With' ? 'with' : 'module') as const);
    const locals = asCall(scope[1], 'List');
    if (!locals) throw new Error(`${scope[0]} locals are not a List`);
    for (const local of locals.slice(1)) {
      const set = asCall(local, 'Set');
      if (set && typeof set[1] === 'string')
        bindings.push({ name: set[1], value: set[2] });
      else if (typeof local === 'string')
        bindings.push({ name: local, value: null });
      else throw new Error('unsupported local binding form');
    }
    body = scope[2];
    const inner = asCall(body, 'Condition');
    if (inner) {
      body = inner[1];
      innerCondition =
        innerCondition === null ? inner[2] : ['And', innerCondition, inner[2]];
    }
  }

  return {
    index,
    lhs,
    variable,
    rhs: body,
    condition,
    bindings,
    scoped,
    innerCondition,
    source,
  };
}
