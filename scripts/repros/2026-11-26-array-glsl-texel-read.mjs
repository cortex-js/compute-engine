/**
 * The GLSL read of a mutable array input in a WebGL 2 context
 * (`docs/plans/2026-11-25-mutable-arrays-spec.md`, section 11, acceptance
 * case 15; implementation plan, stage 5).
 *
 * Run: npx tsx scripts/repros/2026-11-26-array-glsl-texel-read.mjs
 *
 * For each case, the script compiles `At(A, i)` for the target `glsl`,
 * uploads the cells of `A` to a texture of 8 texels per row (the last row
 * padded, `UNPACK_ALIGNMENT` 1), and runs the compiled shader for every
 * index from -(n + 2) to n + 2 and for the same indexes plus 0.5. It
 * compares each value with the cell that the index names, or with NaN:
 *
 *   - unsigned cells (`array<integer<0..65535>>`, `Uint16Array`, `R16UI`);
 *   - signed cells (`array<integer<-30000..30000>>`, `Int16Array`, `R16I`);
 *   - `real` cells (`Float32Array`, `R32F`);
 *   - a tuple cell of four bytes from `RGBA8UI`, and from a normalized
 *     `RGBA8` (`storage: { A: 'sampler2D' }`);
 *   - bytes from a normalized `R8` (`storage: { A: 'sampler2D' }`);
 *
 * with 37 cells, a count that is not a multiple of the width. `Length(A)`
 * is checked too, and the indexes NaN, +Infinity and -Infinity (a uniform
 * array). The last case reads the unsigned cells through a user function
 * `rd(x, k) = x[k] + Length(x)`, whose parameters are the sampler and the
 * count.
 *
 * Then the read-back of a framebuffer of each tuple format: the shader
 * writes the cells that it reads (`RGBA8UI`: the `vec4` as a `uvec4`;
 * `RGBA8`: divided by 255) and one pixel `(1, 2, 128, 255)`, and
 * `readPixels` with `RGBA`, `UNSIGNED_BYTE` reads them back. The script
 * prints the result per format: an unsigned integer framebuffer is read
 * back only with `RGBA_INTEGER`, `UNSIGNED_INT` in OpenGL ES 3.0.
 *
 * The browser is the headless Chromium of the Playwright cache, rendering
 * with SwiftShader (`scripts/glsl-check/glsl-driver.ts`).
 */
import { chromium } from 'playwright-core';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { executeEpsil } from '../../src/epsil.ts';

const N = 37;
const WIDTH = 8;

const ce = new ComputeEngine();
ce.declare('i', 'real');
executeEpsil(ce, 'let rd = (x, k) => x[k] + length(x)');

const BYTE = 'integer<0..255>';
const cells = (f) => Array.from({ length: N }, (_, k) => f(k));
const CASES = [
  {
    name: 'unsigned (R16UI)',
    type: 'array<integer<0..65535>>',
    format: 'R16UI',
    values: cells((k) => (k * 1777 + 3) % 65536),
  },
  {
    name: 'signed (R16I)',
    type: 'array<integer<-30000..30000>>',
    format: 'R16I',
    values: cells((k) => ((k * 1777) % 60001) - 30000),
  },
  {
    name: 'real (R32F)',
    type: 'array<real>',
    format: 'R32F',
    values: cells((k) => Math.fround(k * 0.37 - 5.125)),
  },
  {
    name: 'tuple (RGBA8UI)',
    type: `array<tuple<${BYTE}, ${BYTE}, ${BYTE}, ${BYTE}>>`,
    format: 'RGBA8UI',
    tuple: true,
    values: cells((k) => [k, (k * 7) % 256, (k * 31 + 128) % 256, 255 - k]),
  },
  {
    name: 'tuple (normalized RGBA8)',
    type: `array<tuple<${BYTE}, ${BYTE}, ${BYTE}, ${BYTE}>>`,
    format: 'RGBA8',
    tuple: true,
    normalized: true,
    values: cells((k) => [k, (k * 7) % 256, (k * 31 + 128) % 256, 255 - k]),
  },
  {
    name: 'bytes (normalized R8)',
    type: `array<${BYTE}>`,
    format: 'R8',
    normalized: true,
    values: cells((k) => (k * 53 + 1) % 256),
  },
  {
    name: 'unsigned (R16UI) through a user function',
    type: 'array<integer<0..65535>>',
    format: 'R16UI',
    function: true,
    values: cells((k) => (k * 1777 + 3) % 65536),
  },
];

/** The compiled `At(A, i)` and `Length(A)` of a case, for the page. */
function compiled(c) {
  const name = `A${CASES.indexOf(c)}`;
  ce.declare(name, c.type);
  const options = {
    to: 'glsl',
    fallback: false,
    ...(c.normalized ? { storage: { [name]: 'sampler2D' } } : {}),
  };
  const at = compile(
    ce.box(c.function ? ['rd', name, 'i'] : ['At', name, 'i']),
    options
  );
  const length = compile(ce.box(['Length', name]), options);
  return {
    ...c,
    uniform: name,
    lowered: at.freeSymbolTypes[name].lowered,
    count: at.freeSymbolTypes[name].count,
    at: { code: at.code, preamble: at.preamble ?? '' },
    length: { code: length.code, preamble: length.preamble ?? '' },
  };
}

/** Runs in the page: each case, and the read-back of the framebuffers. */
function page({ cases, n, width }) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { error: 'no WebGL 2 context' };
  const floatTargets = gl.getExtension('EXT_color_buffer_float') !== null;
  const vs = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
  const program = (fs) => {
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(`${gl.getShaderInfoLog(s)}\n${src}`);
      return s;
    };
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
  const draw = (pr) => {
    gl.useProgram(pr);
    const loc = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  const FORMATS = {
    R16UI: [gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, Uint16Array, 1],
    R16I: [gl.R16I, gl.RED_INTEGER, gl.SHORT, Int16Array, 1],
    R32F: [gl.R32F, gl.RED, gl.FLOAT, Float32Array, 1],
    RGBA8UI: [gl.RGBA8UI, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, Uint8Array, 4],
    RGBA8: [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, Uint8Array, 4],
    R8: [gl.R8, gl.RED, gl.UNSIGNED_BYTE, Uint8Array, 1],
  };
  /** The texture of the cells, padded to a full last row. */
  const upload = (c, unit) => {
    const [internal, format, type, Typed, channels] = FORMATS[c.format];
    const rows = Math.ceil(n / width);
    const data = new Typed(rows * width * channels);
    data.set(c.values.flat());
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, rows, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const bind = (pr, c) => {
    gl.useProgram(pr);
    gl.uniform1i(gl.getUniformLocation(pr, c.uniform), 0);
    gl.uniform1i(gl.getUniformLocation(pr, c.count), n);
  };
  /** A framebuffer of `w` × `h` texels of `internal`. */
  const target = (internal, w, h) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      t,
      0
    );
    gl.viewport(0, 0, w, h);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  };
  const header = (c) => `#version 300 es
precision highp float;
precision highp int;
uniform ${c.lowered} ${c.uniform};
uniform int ${c.count};
`;
  const body = (code) => (code.includes('return') ? code : `return ${code};`);
  /** The value that the index `k` names, or `null` for NaN. */
  const expected = (c, k) => {
    if (!Number.isInteger(k) || k === 0 || Math.abs(k) > n) return null;
    const v = c.values[k > 0 ? k - 1 : n + k];
    return c.function ? v + n : v;
  };
  const results = [];
  const span = 2 * n + 5;
  for (const c of cases) {
    const out = { name: c.name, lowered: c.lowered, failures: [], checked: 0 };
    try {
      upload(c, 0);
      if (!floatTargets) throw new Error('no EXT_color_buffer_float');
      // One row of whole indexes and one of indexes plus 0.5: the value,
      // with NaN as the sentinel -1e30.
      const result = c.tuple ? 'vec4' : 'float';
      const pr = program(`${header(c)}
uniform float special[3];
out vec4 color;
${c.at.preamble}
${result} f(float i) {
${body(c.at.code)}
}
void main() {
  int x = int(gl_FragCoord.x);
  float i = gl_FragCoord.y > 2.0 ? special[min(x, 2)] : floor(gl_FragCoord.x) - ${n + 2}.0 + (gl_FragCoord.y > 1.0 ? 0.5 : 0.0);
  ${result} v = f(i);
  color = ${c.tuple ? 'isnan(v.x) || isnan(v.y) || isnan(v.z) || isnan(v.w) ? vec4(-1e30) : v' : 'isnan(v) ? vec4(-1e30) : vec4(v)'};
}`);
      if (!target(gl.RGBA32F, span, 3)) throw new Error('RGBA32F incomplete');
      bind(pr, c);
      gl.uniform1fv(gl.getUniformLocation(pr, 'special'), [NaN, Infinity, -Infinity]);
      draw(pr);
      const px = new Float32Array(span * 3 * 4);
      gl.readPixels(0, 0, span, 3, gl.RGBA, gl.FLOAT, px);
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < (y === 2 ? 3 : span); x++) {
          const k = y === 2 ? [NaN, Infinity, -Infinity][x] : x - (n + 2) + (y === 1 ? 0.5 : 0);
          const e = expected(c, k);
          const got = Array.from(px.slice((y * span + x) * 4, (y * span + x) * 4 + (c.tuple ? 4 : 1)));
          const want = e === null ? got.map(() => -1e30) : c.tuple ? e : [e];
          out.checked += 1;
          if (got.some((g, j) => Math.fround(g) !== Math.fround(want[j])))
            out.failures.push({ k, got, want });
        }
      // `Length(A)`.
      const lp = program(`${header(c)}
out vec4 color;
${c.length.preamble}
float f() {
${body(c.length.code)}
}
void main() { color = vec4(f()); }`);
      target(gl.RGBA32F, 1, 1);
      bind(lp, c);
      draw(lp);
      const lv = new Float32Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, lv);
      out.length = lv[0];
      if (lv[0] !== n) out.failures.push({ length: lv[0] });
      // The read-back of a framebuffer of the format of the texture: the
      // cells that the shader reads, and the pixel (1, 2, 128, 255).
      if (c.tuple) {
        const integer = !c.normalized;
        const fp = program(`${header(c)}
out ${integer ? 'uvec4' : 'vec4'} color;
${c.at.preamble}
vec4 f(float i) {
${body(c.at.code)}
}
void main() {
  int x = int(gl_FragCoord.x);
  vec4 v = x < ${n} ? f(float(x + 1)) : vec4(1.0, 2.0, 128.0, 255.0);
  color = ${integer ? 'uvec4(v)' : 'v / 255.0'};
}`);
        const internal = integer ? gl.RGBA8UI : gl.RGBA8;
        out.framebufferComplete = target(internal, n + 1, 1);
        bind(fp, c);
        draw(fp);
        while (gl.getError() !== gl.NO_ERROR);
        const bytes = new Uint8Array((n + 1) * 4);
        gl.readPixels(0, 0, n + 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        const err = gl.getError();
        const want = [...c.values.flat(), 1, 2, 128, 255];
        out.readBack = {
          format: integer ? 'RGBA8UI' : 'RGBA8',
          bytesError: err === gl.NO_ERROR ? null : `0x${err.toString(16)}`,
          bytesMatch:
            err === gl.NO_ERROR && want.every((b, j) => bytes[j] === b),
          lastPixel: Array.from(bytes.slice(n * 4)),
        };
        if (integer) {
          // The read that OpenGL ES 3.0 guarantees for this format.
          const words = new Uint32Array((n + 1) * 4);
          gl.readPixels(0, 0, n + 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, words);
          const e2 = gl.getError();
          out.readBack.integerError = e2 === gl.NO_ERROR ? null : `0x${e2.toString(16)}`;
          out.readBack.integerMatch =
            e2 === gl.NO_ERROR && want.every((b, j) => words[j] === b);
          out.readBack.integerLastPixel = Array.from(words.slice(n * 4));
        }
      }
    } catch (e) {
      out.error = String(e && e.message ? e.message : e);
    }
    results.push(out);
  }
  return {
    renderer: gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION),
    results,
  };
}

const cases = CASES.map(compiled);
for (const c of cases)
  console.log(`--- ${c.name}: uniform ${c.lowered} ${c.uniform}; int ${c.count}\n${c.at.preamble}\n${c.at.code}\n`);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const tab = await browser.newPage();
  await tab.setContent('<!doctype html><html><body></body></html>');
  const report = await tab.evaluate(page, { cases, n: N, width: WIDTH });
  console.log(JSON.stringify(report, null, 2));
  const failed = (report.results ?? []).some(
    (r) => r.error !== undefined || r.failures.length > 0
  );
  process.exitCode = report.error !== undefined || failed ? 1 : 0;
} finally {
  await browser.close();
}
