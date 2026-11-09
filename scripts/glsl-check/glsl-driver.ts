/**
 * Compiles GLSL ES 3.00 shaders with the WebGL 2 compiler of a headless
 * Chromium, and returns the result and the info log of each shader.
 *
 * The engine writes GLSL for WebGL 2. A shader that the engine writes with no
 * decline can still be one that no driver accepts, and only a real compiler
 * shows this. Chromium compiles a WebGL shader with ANGLE, which also applies
 * the WebGL rules (reserved `webgl_` names, resource limits), so this is the
 * compiler that the users of the shaders run. A GLSL validator checks only the
 * language specification and can accept a shader that a browser refuses.
 *
 * The browser renders with SwiftShader (a software renderer), so the result
 * does not depend on the GPU or the driver of the machine, and no GPU is
 * necessary.
 *
 * The browser comes from the Playwright cache. When it is missing, install it
 * with `npx playwright-core install chromium-headless-shell` (the revision
 * must match the version of `playwright-core` in `package.json`).
 */

import { chromium, type Browser, type Page } from 'playwright-core';

export type GlslShader = {
  /** A name for the report. */
  name: string;
  stage: 'fragment' | 'vertex';
  source: string;
};

/** A fragment shader that writes one `float` output, and the values of its
 *  `float` uniforms (a number, or an array for a `float[n]` uniform). The
 *  keys must include the name of each active uniform of the program, or the
 *  result is `ok: false`. A key with no active uniform is skipped (the GLSL
 *  compiler can remove a uniform whose value cannot change the output, and
 *  that depends on the driver); the result lists such keys in `inactive`. */
export type GlslEvaluation = {
  name: string;
  source: string;
  uniforms: Record<string, number | number[]>;
};

/** The value that a fragment shader wrote, or the step that failed. */
export type GlslValue =
  | { name: string; ok: true; value: number; inactive: string[] }
  | { name: string; ok: false; log: string };

export type GlslResult = {
  name: string;
  /** True when the shader compiles and links into a program. */
  ok: boolean;
  /** The step that failed, when `ok` is false. */
  failedAt?: 'compile' | 'link';
  /** The info log of the step that failed (or an empty string). */
  log: string;
};

/**
 * The shader of the other stage, linked with each shader under test. It reads
 * nothing and writes nothing that the shader under test reads, so a link
 * failure comes from the shader under test.
 */
const PASS_THROUGH: Record<'fragment' | 'vertex', string> = {
  vertex: `#version 300 es
void main() {
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
}
`,
  fragment: `#version 300 es
precision highp float;
out vec4 fragColor;
void main() {
  fragColor = vec4(0.0);
}
`,
};

/**
 * The code that runs in the page, as a string. A TypeScript function given to
 * `page.evaluate()` is serialized from the source that `tsx` emits, and that
 * source calls a `__name` helper that does not exist in the page.
 *
 * `glslCheck.renderer()` gives the unmasked renderer name (`gl.RENDERER`
 * gives only "WebKit WebGL"). `glslCheck.compile()` compiles each shader,
 * links it with the pass-through shader of the other stage, and gives one
 * `GlslResult` per shader. `glslCheck.evaluate()` draws one pixel with each
 * fragment shader and gives the value that it wrote.
 */
const PAGE_SCRIPT = `
window.glslCheck = (() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  function make(stage, source) {
    const shader = gl.createShader(
      stage === 'fragment' ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER
    );
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }
  return {
    renderer() {
      if (!gl) return null;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return String(
        gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)
      );
    },
    // Draws one pixel with the fragment shader \`source\` into a 1 by 1
    // RGBA32F framebuffer, and reads back the red channel, where a
    // \`float\` output at location 0 is written. The vertex shader makes a
    // triangle that covers the viewport. The uniform values and the value
    // read back are numbers, or the strings 'NaN', 'Infinity', '-Infinity'
    // and '-0', which JSON does not keep (\`encodeNumber()\` in Node).
    evaluate(items) {
      const decode = (v) => (typeof v === 'string' ? Number(v) : v);
      const encode = (v) =>
        Object.is(v, -0) ? '-0' : Number.isFinite(v) ? v : String(v);
      if (!gl.getExtension('EXT_color_buffer_float'))
        return items.map(({ name }) => ({
          name,
          ok: false,
          log: 'no EXT_color_buffer_float',
        }));
      const vertex = make(
        'vertex',
        '#version 300 es\\nvoid main() {\\n' +
          '  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\\n' +
          '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\\n}\\n'
      );
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0
      );
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.viewport(0, 0, 1, 1);
      const results = items.map(({ name, source, uniforms }) => {
        if (status !== gl.FRAMEBUFFER_COMPLETE)
          return { name, ok: false, log: 'framebuffer status ' + status };
        const shader = make('fragment', source);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const log = gl.getShaderInfoLog(shader) || '';
          gl.deleteShader(shader);
          return { name, ok: false, log };
        }
        const program = gl.createProgram();
        gl.attachShader(program, vertex);
        gl.attachShader(program, shader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          const log = gl.getProgramInfoLog(program) || '';
          gl.deleteProgram(program);
          gl.deleteShader(shader);
          return { name, ok: false, log };
        }
        // Each active uniform of the program must be a key of
        // \`uniforms\`: a uniform with no value reads as 0. A key with no
        // active uniform is skipped and reported in \`inactive\`. The name of
        // an active array uniform ends with \`[0]\`.
        const active = [];
        const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < count; i++)
          active.push(gl.getActiveUniform(program, i).name.replace(/\\[0\\]$/, ''));
        const missing = active.filter((u) => !Object.hasOwn(uniforms, u));
        const inactive = Object.keys(uniforms).filter((u) => !active.includes(u));
        if (missing.length > 0) {
          gl.deleteProgram(program);
          gl.deleteShader(shader);
          return {
            name,
            ok: false,
            log: 'uniforms with no value: [' + missing.join(', ') + ']',
          };
        }
        for (let i = 0; i < 16 && gl.getError() !== gl.NO_ERROR; i++);
        gl.useProgram(program);
        for (const [u, v] of Object.entries(uniforms)) {
          if (!active.includes(u)) continue;
          const at = gl.getUniformLocation(program, u);
          if (Array.isArray(v)) gl.uniform1fv(at, v.map(decode));
          else gl.uniform1f(at, decode(v));
        }
        const uniformError = gl.getError();
        if (uniformError !== gl.NO_ERROR) {
          gl.deleteProgram(program);
          gl.deleteShader(shader);
          return {
            name,
            ok: false,
            log: 'WebGL error ' + uniformError + ' in the uniform step',
          };
        }
        const pixel = new Float32Array([NaN, NaN, NaN, NaN]);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixel);
        const error = gl.getError();
        gl.deleteProgram(program);
        gl.deleteShader(shader);
        if (error !== gl.NO_ERROR)
          return { name, ok: false, log: 'WebGL error ' + error };
        return { name, ok: true, value: encode(pixel[0]), inactive };
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      gl.deleteShader(vertex);
      return results;
    },
    compile(shaders, passThrough) {
      return shaders.map(({ name, stage, source }) => {
        const shader = make(stage, source);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const log = gl.getShaderInfoLog(shader) || '';
          gl.deleteShader(shader);
          return { name, ok: false, failedAt: 'compile', log };
        }
        const otherStage = stage === 'fragment' ? 'vertex' : 'fragment';
        const other = make(otherStage, passThrough[otherStage]);
        const program = gl.createProgram();
        gl.attachShader(program, shader);
        gl.attachShader(program, other);
        gl.linkProgram(program);
        const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
        const log = linked ? '' : gl.getProgramInfoLog(program) || '';
        gl.deleteProgram(program);
        gl.deleteShader(shader);
        gl.deleteShader(other);
        return linked
          ? { name, ok: true, log }
          : { name, ok: false, failedAt: 'link', log };
      });
    },
  };
})();
`;

/**
 * A number for the JSON text that `GlslDriver.evaluate()` sends to the page:
 * `NaN`, `±Infinity` and `-0` become the strings `'NaN'`, `'Infinity'`,
 * `'-Infinity'` and `'-0'` (JSON writes the first three as `null`, and `-0`
 * as `0`). `Number()` of the string gives the number again.
 */
function encodeNumber(v: number): number | string {
  if (Object.is(v, -0)) return '-0';
  return Number.isFinite(v) ? v : String(v);
}

export class GlslDriver {
  private constructor(
    private readonly browser: Browser,
    private readonly page: Page,
    /** The unmasked renderer name of the WebGL 2 context, for the report. */
    readonly renderer: string
  ) {}

  /** Starts the browser and checks that it has a WebGL 2 context. */
  static async start(): Promise<GlslDriver> {
    let browser: Browser;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      });
    } catch (e) {
      throw new Error(
        `Could not start the headless Chromium of playwright-core. If the ` +
          `browser is not installed, run ` +
          `\`npx playwright-core install chromium-headless-shell\`.\n` +
          String(e)
      );
    }
    // The caller gets no driver when a step below fails, so it cannot stop
    // the browser: close it here, or the Chromium process keeps the Node
    // process alive.
    try {
      const page = await browser.newPage();
      await page.setContent('<canvas width="1" height="1"></canvas>');
      await page.addScriptTag({ content: PAGE_SCRIPT });
      const renderer = (await page.evaluate('glslCheck.renderer()')) as
        | string
        | null;
      if (renderer === null)
        throw new Error('The headless Chromium has no WebGL 2 context.');
      return new GlslDriver(browser, page, renderer);
    } catch (e) {
      // A failure to close is ignored: the error to report is `e`.
      await browser.close().catch(() => {});
      throw e;
    }
  }

  /**
   * Compiles each shader, links it with a pass-through shader of the other
   * stage, and returns one result per shader, in the same order.
   */
  async compile(shaders: ReadonlyArray<GlslShader>): Promise<GlslResult[]> {
    const args = JSON.stringify([shaders, PASS_THROUGH]);
    return (await this.page.evaluate(
      `glslCheck.compile(...${args})`
    )) as GlslResult[];
  }

  /**
   * Draws one pixel with each fragment shader and returns the value of its
   * `float` output, in the same order. A value is a float32: NaN, the
   * infinities and `-0` are kept, in the uniforms and in the result. The
   * result is `ok: false` when the framebuffer is not complete, when the
   * active uniform has no key in `uniforms`, or when WebGL gives an error for
   * the uniform upload or the draw. Keys with no active uniform are listed
   * in `inactive`.
   */
  async evaluate(items: ReadonlyArray<GlslEvaluation>): Promise<GlslValue[]> {
    const args = JSON.stringify([
      items.map((item) => ({
        ...item,
        uniforms: Object.fromEntries(
          Object.entries(item.uniforms).map(([u, v]) => [
            u,
            Array.isArray(v) ? v.map(encodeNumber) : encodeNumber(v),
          ])
        ),
      })),
    ]);
    const values = (await this.page.evaluate(
      `glslCheck.evaluate(...${args})`
    )) as (GlslValue | { name: string; ok: true; value: number | string })[];
    return values.map((v) =>
      v.ok ? { ...v, value: Number(v.value) } : v
    ) as GlslValue[];
  }

  async stop(): Promise<void> {
    await this.browser.close();
  }
}
