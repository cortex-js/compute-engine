// The debugger statement hook (`src/common/debug-hook.ts`).
//
// `evaluateStatements` — the sequencer behind `Block` bodies, lambda bodies
// and `if` branches — fires the hook before each statement that carries
// `sourceOffsets`. This is the pause-point contract the VS Code debugger's
// body breakpoints are built on (`vscode-epsil/VSCODE_EPSIL_ROADMAP.md`,
// Tier 2):
//  - statements inside function bodies and loop bodies fire, once per
//    execution (per iteration for loops);
//  - engine-internal blocks (no source offsets) never fire;
//  - a cleared hook costs nothing and fires nothing.

import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import {
  setDebugStatementHook,
  setDebugStatementResultHook,
} from '../../src/common/debug-hook';

let ce: ComputeEngine;

beforeAll(() => {
  ce = new ComputeEngine();
});

afterEach(() => {
  setDebugStatementHook(undefined);
  setDebugStatementResultHook(undefined);
});

/** Evaluate an Epsil program statement-by-statement (the executeEpsil
 * contract) and return the spans the hook fired for. */
function firedSpans(source: string): string[] {
  const [ast] = parseEpsil(source, undefined, {
    typeNames: ce._typeResolver.names,
  });
  const stmts =
    typeof ast === 'object' && ast !== null && 'fn' in ast && ast.fn[0] === 'Block'
      ? ast.fn.slice(1)
      : [ast];
  const fired: string[] = [];
  setDebugStatementHook((raw) => {
    const offsets = (raw as { sourceOffsets?: [number, number] })
      .sourceOffsets;
    if (offsets) fired.push(source.slice(offsets[0], offsets[1]));
  });
  try {
    for (const stmt of stmts) ce.box(stmt as any).evaluate();
  } finally {
    setDebugStatementHook(undefined);
  }
  return fired;
}

test('function-body statements fire when the function is applied', () => {
  const fired = firedSpans(
    'function dbg1(n) {\n  let a = n * 2\n  a + 1\n}\ndbg1(3)'
  );
  expect(fired).toContain('let a = n * 2');
  expect(fired).toContain('a + 1');
});

test('loop-body statements fire once per iteration', () => {
  const fired = firedSpans('let w = 0\nwhile w < 3 { w := w + 1 }\nw');
  expect(fired.filter((s) => s === 'w := w + 1')).toHaveLength(3);
});

test('if-branch statements fire only for the taken branch', () => {
  const fired = firedSpans('let q = 5\nif q > 3 { q + 1 } else { q - 1 }');
  expect(fired).toContain('q + 1');
  expect(fired).not.toContain('q - 1');
});

test('recursive function bodies fire (knot-tying re-box keeps offsets)', () => {
  // A self-referential literal is RE-BOXED at assign time to bind the
  // self-call (`engine-declarations.ts`, knot-tying); serialized without
  // `sourceOffsets` that copy silently disabled every recursive body's
  // pause points.
  const fired = firedSpans(
    'function rfact(n) {\n  if n <= 1 { 1 }\n  else { n * rfact(n - 1) }\n}\nrfact(3)'
  );
  expect(fired.filter((s) => s.startsWith('if n <= 1'))).toHaveLength(3);
  expect(fired.filter((s) => s.startsWith('n * rfact'))).toHaveLength(2);
  // The base case's bare NUMBER statement fires too — the knot-tying
  // re-box serialization keeps atom offsets (numbers, strings, symbols).
  expect(fired).toContain('1');
});

test('a bare-symbol return statement fires', () => {
  // `BoxedSymbol.canonical` threads sourceOffsets: the idiomatic Epsil
  // return value is a bare symbol statement.
  const fired = firedSpans('function ret1(n) {\n  let v = n + 1\n  v\n}\nret1(1)');
  expect(fired).toContain('v');
});

test('a cleared hook fires nothing', () => {
  const [ast] = parseEpsil('function dbg2(n) { n + 1 }\ndbg2(1)', undefined, {
    typeNames: ce._typeResolver.names,
  });
  let count = 0;
  setDebugStatementHook(() => count++);
  setDebugStatementHook(undefined);
  for (const stmt of (ast as any).fn.slice(1)) ce.box(stmt).evaluate();
  expect(count).toBe(0);
});

test('result hook fires with each source-mapped statement result', () => {
  // The debugger's "break on error value" filter is built on this hook: it
  // receives each statement's evaluated RESULT (the worker inspects it for
  // error values). Pinned with an ordinary program — an invalid statement
  // (a literal `Error` node) makes its Block invalid, which short-circuits
  // evaluation before the sequencer runs, so error-shaped programs cannot
  // exercise the hook directly; the adapter's end-to-end suite covers the
  // top-level error pause.
  const seen: string[] = [];
  setDebugStatementResultHook((stmt, result) => {
    seen.push(String(result));
  });
  try {
    const src = 'function rh1(n) {\n  let t = n + 1\n  t * 2\n}\nrh1(3)';
    const [ast] = parseEpsil(src, undefined, {
      typeNames: ce._typeResolver.names,
    });
    for (const stmt of (ast as any).fn.slice(1)) ce.box(stmt).evaluate();
  } finally {
    setDebugStatementResultHook(undefined);
  }
  // `let t = n + 1` result (Nothing) and `t * 2` result (8), in order.
  expect(seen[seen.length - 1]).toEqual('8');
  expect(seen).toHaveLength(2);
});

test('engine-internal evaluation (no source offsets) does not fire', () => {
  let count = 0;
  setDebugStatementHook(() => count++);
  try {
    // A Block built programmatically carries no sourceOffsets anywhere.
    ce.box(['Block', ['Add', 1, 2], ['Multiply', 2, 3]]).evaluate();
  } finally {
    setDebugStatementHook(undefined);
  }
  expect(count).toBe(0);
});
