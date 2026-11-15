// CE-1210: the difference of two V8 CPU profiles (`node --cpu-prof`) of an
// unminified bundle (dist/esm, or a one-file esbuild bundle), by source file
// or by function. The source file of a sample is found from the
// `// src/...` markers that esbuild writes before each module.
//
//   node scripts/repros/2026-11-14-ce1210-profile-diff.mjs A.cpuprofile B.cpuprofile [top] [file filter]
//
// Without a filter: the self time of each source file, B minus A. With a
// filter (a part of a path, `binding-unit.ts`): the self time of each
// function of the matching files. Times in ms.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const markerCache = new Map();
function markers(url) {
  if (markerCache.has(url)) return markerCache.get(url);
  let m = [];
  try { const lines = readFileSync(fileURLToPath(url), 'utf8').split('\n'); lines.forEach((l, i) => { { const mm = /^\/\/ (?:.*?\/)?(src\/.*|node_modules\/.*)$/.exec(l); if (mm) m.push([i, mm[1]]); } }); } catch {}
  markerCache.set(url, m); return m;
}
function fileOf(cf) {
  if (!cf.url.startsWith('file:')) return cf.functionName || cf.url || '(vm)';
  const m = markers(cf.url); let f = cf.url.split('/').pop();
  for (const [i, name] of m) { if (i <= cf.lineNumber) f = name; else break; }
  return f;
}
function load(p, fnFilter) {
  const prof = JSON.parse(readFileSync(p, 'utf8'));
  const dt = new Map(); for (let i = 0; i < prof.samples.length; i++) dt.set(prof.samples[i], (dt.get(prof.samples[i]) ?? 0) + (prof.timeDeltas[i] ?? 0));
  const m = new Map();
  for (const n of prof.nodes) { const t = (dt.get(n.id) ?? 0) / 1000; if (!t) continue; const f = fileOf(n.callFrame); const k = fnFilter ? (f.includes(fnFilter) ? (n.callFrame.functionName || '(anon)') + ' ' + f : null) : f; if (k === null) continue; m.set(k, (m.get(k) ?? 0) + t); }
  return m;
}
const [a, b, top = 40, filter] = process.argv.slice(2);
const A = load(a, filter), B = load(b, filter);
const keys = new Set([...A.keys(), ...B.keys()]);
let sum = 0;
const rows = [...keys].map((k) => [k, (B.get(k) ?? 0) - (A.get(k) ?? 0), A.get(k) ?? 0, B.get(k) ?? 0]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
for (const r of rows) sum += r[1];
console.log('sum of delta', sum.toFixed(0));
rows.slice(0, +top).forEach(([k, d, x, y]) => console.log(d.toFixed(0).padStart(7), x.toFixed(0).padStart(7), y.toFixed(0).padStart(7), k));
