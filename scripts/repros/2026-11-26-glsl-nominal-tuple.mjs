/**
 * A value of a nominal tuple type of numbers on GLSL (CE-1870) in a WebGL 2
 * context: `type P2 = tuple<x: real, y: real>` is a `vec2`.
 *
 * Run: npx tsx scripts/repros/2026-11-26-glsl-nominal-tuple.mjs
 *
 * The script compiles `mid(P2(x, y), P2(y, x))` (a user function
 * `P2 -> P2`) and `P2(x, y) == P2(y, x)` for the target `glsl`, runs each
 * shader for several values of the uniforms `x` and `y`, and compares the
 * `vec2` and the boolean with the interpreter's values. With `x` NaN (a
 * value outside the type `real`, for which the interpreter gives the error
 * `incompatible-type` for `P2(x, y)`) it compares with the value of the
 * JavaScript code instead: a field of NaN, and `false`.
 *
 * The browser is the headless Chromium of the Playwright cache, rendering
 * with SwiftShader (`scripts/glsl-check/glsl-driver.ts`).
 */
import { chromium } from 'playwright-core';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { executeEpsil } from '../../src/epsil.ts';

const ce = new ComputeEngine();
executeEpsil(
  ce,
  `type P2 = tuple<x: real, y: real>
function mid(a: P2, b: P2) -> P2 { P2((a.x + b.x) / 2, (a.y + b.y) / 2) }`
);
ce.declare('x', 'real');
ce.declare('y', 'real');

const MID = ['mid', ['P2', 'x', 'y'], ['P2', 'y', 'x']];
const EQUAL = ['Equal', ['P2', 'x', 'y'], ['P2', 'y', 'x']];
const INPUTS = [
  [1, 3],
  [2.5, 2.5],
  [-4, 0.25],
  [0, 0],
  [1e10, -7],
  [NaN, 1],
];

/** The interpreter's value, or the value of the JavaScript code for an
 *  input outside the type `real` (NaN). */
function expected(json, [x, y]) {
  if (Number.isNaN(x) || Number.isNaN(y)) {
    const v = compile(ce.box(json), { fallback: false }).run({ x, y });
    return typeof v === 'boolean' ? v : [v.x, v.y];
  }
  const v = ce
    .box(json)
    .subs({ x: ce.number(x), y: ce.number(y) })
    .evaluate();
  if (v.symbol === 'True' || v.symbol === 'False') return v.symbol === 'True';
  return v.ops.map((z) => z.re);
}

const shader = (json) => {
  const r = compile(ce.box(json), { to: 'glsl', fallback: false });
  return { code: r.code, preamble: r.preamble ?? '' };
};
const mid = shader(MID);
const equal = shader(EQUAL);
console.log(`--- mid\n${mid.preamble}\n${mid.code}\n--- equal\n${equal.preamble}\n${equal.code}\n`);

/** Runs in the page: each shader for each input, one texel each. */
function page({ shaders, inputs }) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { error: 'no WebGL 2 context' };
  if (gl.getExtension('EXT_color_buffer_float') === null)
    return { error: 'no EXT_color_buffer_float' };
  const vs = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(`${gl.getShaderInfoLog(s)}\n${src}`);
    return s;
  };
  const program = (fs) => {
    const pr = gl.createProgram();
    gl.attachShader(pr, make(gl.VERTEX_SHADER, vs));
    gl.attachShader(pr, make(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(pr));
    return pr;
  };
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  gl.viewport(0, 0, 1, 1);
  const results = {};
  for (const [name, s, result, out] of [
    ['mid', shaders.mid, 'vec2', 'vec4(v, 0.0, 0.0)'],
    ['equal', shaders.equal, 'bool', 'vec4(v ? 1.0 : 0.0)'],
  ]) {
    const pr = program(`#version 300 es
precision highp float;
precision highp int;
uniform float x;
uniform float y;
out vec4 color;
${s.preamble}
${result} f(float x, float y) {
${s.code.includes('return') ? s.code : `return ${s.code};`}
}
void main() { ${result} v = f(x, y); color = ${out}; }`);
    gl.useProgram(pr);
    const loc = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    results[name] = inputs.map(([a, b]) => {
      gl.uniform1f(gl.getUniformLocation(pr, 'x'), a);
      gl.uniform1f(gl.getUniformLocation(pr, 'y'), b);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const px = new Float32Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
      return Array.from(px);
    });
  }
  return { renderer: gl.getParameter(gl.RENDERER), results };
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const tab = await browser.newPage();
  await tab.setContent('<!doctype html><html><body></body></html>');
  const inputs = INPUTS.map(([a, b]) => [Math.fround(a), Math.fround(b)]);
  const report = await tab.evaluate(page, {
    shaders: { mid, equal },
    inputs,
  });
  if (report.error !== undefined) throw new Error(report.error);
  const failures = [];
  const same = (g, w) =>
    (Number.isNaN(w) && Number.isNaN(g)) || Math.fround(w) === Math.fround(g);
  inputs.forEach((input, k) => {
    const m = expected(MID, input);
    const gm = report.results.mid[k].slice(0, 2);
    if (!gm.every((g, j) => same(g, m[j])))
      failures.push({ program: 'mid', input, got: gm, want: m });
    const e = expected(EQUAL, input);
    const ge = report.results.equal[k][0] === 1;
    if (ge !== e) failures.push({ program: 'equal', input, got: ge, want: e });
    console.log(JSON.stringify({ input, mid: gm, wantMid: m, equal: ge, wantEqual: e }));
  });
  console.log(JSON.stringify({ renderer: report.renderer, checked: inputs.length * 2, failures }, null, 2));
  process.exitCode = failures.length > 0 ? 1 : 0;
} finally {
  await browser.close();
}
