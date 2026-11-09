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
 * `GlslResult` per shader.
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

  async stop(): Promise<void> {
    await this.browser.close();
  }
}
