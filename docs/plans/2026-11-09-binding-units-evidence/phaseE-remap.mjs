import fs from 'node:fs';
const [,, logPath, jsonPath, outPath] = process.argv;
const tri = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const keys = Object.keys(tri[0]);
const classKey = 'cls';
const byTest = new Map();
for (const t of tri) byTest.set(t.file + '|' + t.test, t[classKey] ?? '?');
// The default reporter prints each failure under its FAIL header, and all of them again at the end ("Summary of all failing tests").
const lines = fs.readFileSync(logPath, 'utf8').split('\n');
const end = lines.findIndex((l) => l.startsWith('Summary of all failing tests'));
const body = end >= 0 ? lines.slice(0, end) : lines;
let file = null;
const seen = new Set();
const perClass = new Map();
for (const l of body) {
  const f = l.match(/^FAIL (\S+)/);
  if (f) { file = f[1].replace(/^\.\.\//, ''); continue; }
  if (/^PASS /.test(l)) { file = null; continue; }
  const m = l.match(/^  ● (.*)$/);
  if (m && file) {
    const k = file + '|' + m[1].trim();
    if (seen.has(k)) continue;
    seen.add(k);
    const c = byTest.get(k) ?? 'NEW';
    if (!perClass.has(c)) perClass.set(c, new Map());
    const fm = perClass.get(c);
    fm.set(file, (fm.get(file) ?? 0) + 1);
  }
}
const rows = [...perClass].map(([c, fm]) => [c, [...fm.values()].reduce((a, b) => a + b, 0), fm.size, fm]).sort((a, b) => b[1] - a[1]);
let out = `class key: ${classKey}; failing tests counted: ${seen.size}\n\n| Class | Tests | Files |\n|---|---|---|\n`;
for (const [c, n, nf] of rows) out += `| ${c} | ${n} | ${nf} |\n`;
for (const [c, n, nf, fm] of rows) {
  out += `\n### ${c} (${n} tests, ${nf} files)\n`;
  for (const [f, k] of [...fm].sort()) out += `- ${f} (${k})\n`;
}
fs.writeFileSync(outPath, out);
console.log(out.split('\n### ')[0]);
