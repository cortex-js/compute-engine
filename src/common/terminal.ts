import { ansiFgColor, ansiBgColor } from './ansi-codes';
import { StyledBlock, StyledSpan } from './styled-text';

type TerminalCapabilities = 'none' | 'basic' | '256' | 'full' | 'css';

type TerminalState = {
  fg: string;
  bg: string;
  weight: 'bold' | 'normal' | 'thin';
  italic: boolean;
};

function isDefaultStyle(style: Partial<StyledSpan>): boolean {
  return (
    style.fg === undefined &&
    style.bg === undefined &&
    (style.weight === undefined || style.weight === 'normal') &&
    (style.italic === undefined || style.italic === false)
  );
}

abstract class Terminal {
  width: number | undefined;
  indent: number;

  constructor(options?: { indent?: number; width?: number }) {
    this.width = options?.width;
    this.indent = options?.indent ?? 0;
  }

  renderBlock(block: StyledBlock): string {
    const content =
      'spans' in block
        ? this.renderSpans(block.spans)
        : block.blocks.map((b) => this.renderBlock(b)).join('\n');

    if (block.tag === 'paragraph')
      return `\n${wrapAnsiString(content, this.width).join('\n')}\n\n`;

    if (block.tag === 'blockquote') {
      const lines = wrapAnsiString(content, (this.width ?? 40) - 4);
      return lines.map((line) => `>  ${line}`).join('\n');
    }

    if (block.tag === 'note') {
      const lines = wrapAnsiString(content, (this.width ?? 40) - 3);
      return lines.map((line) => `|  ${line}`).join('\n');
    }

    if (block.tag === 'warning') {
      const lines = wrapAnsiString(content, (this.width ?? 40) - 3);
      return lines.map((line) => `!! ${line}`).join('\n');
    }

    if (block.tag === 'error') {
      const lines = wrapAnsiString(content, (this.width ?? 40) - 3);
      return lines.map((line) => `XX ${line}`).join('\n');
    }

    return content;
  }

  abstract renderSpan(span: StyledSpan): string;

  renderSpans(s: StyledSpan[]): string {
    return s.map((span) => this.renderSpan(span)).join('');
  }

  display(s: StyledSpan[] | StyledBlock): void {
    if (Array.isArray(s)) {
      console['info'](this.renderSpans(s));
    } else {
      console['info'](this.renderBlock(s));
    }
  }
}

/**
 * A terminal with no color support.
 */
class TextTerminal extends Terminal {
  renderSpan(span: StyledSpan): string {
    let content =
      typeof span.content === 'string'
        ? span.content
        : this.renderSpans(span.content);

    // Replace some Unicode characters with ASCII
    content = content
      .replace(/[\u2551\u2502\u2503\u2506\u2507\u250a\u250b]/g, '|')
      .replace(/—/g, '--')
      .replace(/–/g, '-')
      .replace(/‘|’/g, "'")
      .replace(/“|”/g, '"')
      .replace(/…/g, '...');

    if (span.italic) {
      if (span.weight === 'bold') content = `***${content}***`;
      else content = `*${content}*`;
    } else if (span.weight === 'bold') content = `**${content}**`;

    if (span.mono) content = `\`${content}\``;
    return content;
  }

  constructor(options?: { indent?: number; width?: number }) {
    super(options);
  }
}

class ColorTerminal extends Terminal {
  private colorMode: 'full' | 'basic' | 'none';

  private state: Partial<TerminalState> = {};

  constructor(options: { mode: 'full' | 'basic' | 'none' }) {
    super();
    this.colorMode = options.mode;
  }

  // @todo: implement correct wrapping, handling of different
  // block types, etc.
  renderBlock(block: StyledBlock): string {
    return super.renderBlock(block);
  }

  getStyleCodes(style: Partial<TerminalState>): number[] {
    const codes: number[] = [];

    const newStyle = style;
    const currentStyle = this.state;

    if (isDefaultStyle(newStyle) && !isDefaultStyle(currentStyle)) {
      // Reset all attributes
      codes.push(0);
      currentStyle.fg = undefined;
      currentStyle.bg = undefined;
      currentStyle.weight = undefined;
      currentStyle.italic = undefined;
    } else {
      // Weight
      if (currentStyle.weight !== newStyle.weight) {
        if (newStyle.weight === 'bold') {
          // Some implementations treat bold and thin as separate
          if (currentStyle.weight === 'thin') codes.push(22); // Reset thin
          codes.push(1);
        } else if (newStyle.weight === 'thin') {
          // Some implementations treat bold and thin as separate
          if (currentStyle.weight === 'bold') codes.push(22); // Reset bold
          codes.push(2);
        } else if (
          currentStyle.weight !== undefined &&
          currentStyle.weight !== 'normal'
        ) {
          codes.push(22); // Reset weight
        }
      }

      // Italic
      if (currentStyle.italic !== newStyle.italic) {
        if (newStyle.italic === true) {
          codes.push(3);
        } else if (currentStyle.italic) {
          codes.push(23); // Reset italic
        }
      }

      // Background color
      if (currentStyle.bg !== newStyle.bg) {
        if (newStyle.bg !== undefined) {
          codes.push(...ansiBgColor(newStyle.bg, this.colorMode));
        } else if (currentStyle.bg !== undefined) {
          codes.push(49); // Reset bg color
        }
      }

      // Foreground color
      if (currentStyle.fg !== newStyle.fg) {
        if (newStyle.fg !== undefined) {
          codes.push(...ansiFgColor(newStyle.fg, this.colorMode));
        } else if (currentStyle.fg !== undefined) {
          codes.push(39); // Reset fg color
        }
      }
    }

    // Update current style
    this.state.fg = newStyle.fg;
    this.state.bg = newStyle.bg;
    this.state.weight = newStyle.weight;
    this.state.italic = newStyle.italic;

    return codes;
  }

  renderSpan(span: StyledSpan): string {
    // If the content is only whitespace, don't bother with the codes
    // (check this before getting codes, which will change the state)
    if (
      typeof span.content === 'string' &&
      /^\s+$/.test(span.content) &&
      this.state.bg === undefined
    )
      return span.content;

    const codes = this.getStyleCodes(span);

    let content =
      typeof span.content === 'string'
        ? span.content
        : this.renderSpans(span.content);

    if (span.mono) codes.push(7);
    if (codes.length > 0) content = `\x1b[${codes.join(';')}m${content}`;
    if (span.mono) content = `${content}\x1b[27m`;

    return content;
  }

  renderSpans(s: StyledSpan[]): string {
    let result = s.map((span) => this.renderSpan(span)).join('');

    if (!isDefaultStyle(this.state)) result += '\x1b[0m';

    return result;
  }

  // abstract progress(s: string): void;
}

/* @todo: Implement HTML terminal */
class _HtmlTerminal extends Terminal {
  renderSpan(span: StyledSpan): string {
    let content =
      typeof span.content === 'string'
        ? span.content
        : this.renderSpans(span.content);

    if (span.italic) {
      if (span.weight === 'bold') content = `<strong>${content}</strong>`;
      else content = `<em>${content}</em>`;
    } else if (span.weight === 'bold') content = `<strong>${content}</strong>`;

    if (span.mono) content = `<code>${content}</code>`;
    return content;
  }
  // display(s: TaggedText[]): void {}
}

function _consoleSupportsStyles() {
  if (typeof window === 'undefined' || typeof console === 'undefined') {
    return false; // Likely non-browser environment (e.g., Node.js)
  }

  // Chrome or Chromium-based browsers
  const isChrome = 'chrome' in window;

  /* eslint-disable no-restricted-globals */
  // Firefox
  const isFirefox =
    navigator.userAgent.toLowerCase().includes('firefox') &&
    !navigator.userAgent.match(
      /mobi|tablet|fennec|android|netscape|seamonkey|iceweasel|iceape|icecat|waterfox|gnuzilla|shadowfox|swiftfox/i
    );
  // Safari
  const isSafari = /^Apple/.test(navigator.vendor);
  /* eslint-enable no-restricted-globals */

  // If any of these are true, we can assume console styling is supported
  return isChrome || isFirefox || isSafari;
}

// export const terminal = consoleSupportsStyles()
//   ? new ColorTerminal({ mode: 'full' }) /* new HtmlTerminal() */
//   : {
//       none: new TextTerminal(),
//       basic: new ColorTerminal({ mode: 'basic' }),
//       full: new ColorTerminal({ mode: 'full' }),
//     }[terminalColorSupport()];
export const terminal: Terminal = {
  none: new TextTerminal(),
  basic: new ColorTerminal({ mode: 'basic' }),
  full: new ColorTerminal({ mode: 'full' }),
}[terminalColorSupport()];

/** Word-wrap a string that contains ANSI escape sequences.
 *  ANSI escape sequences do not add to the string length.
 */
export const wrapAnsiString = (
  string: string,
  width: number | undefined
): string[] => {
  // if the terminal width is zero, don't bother word-wrapping
  if (width === undefined || width <= 0) return [string];

  const ANSI_REGEXP = /\x1B\[[0-9;]*[A-Za-z]/g;
  const tokens: ['string' | 'ansi', string][] = [];
  let lastIndex = 0;
  let match;

  while ((match = ANSI_REGEXP.exec(string))) {
    const ansi = match[0];
    const index = match['index'];
    if (index != lastIndex) {
      tokens.push(['string', string.slice(lastIndex, index)]);
    }
    tokens.push(['ansi', ansi]);
    lastIndex = index + ansi.length;
  }

  if (lastIndex != string.length - 1) {
    tokens.push(['string', string.slice(lastIndex, string.length)]);
  }

  let lastLineLength = 0;

  return tokens.reduce(
    (lines, [kind, token]) => {
      if (kind === 'string') {
        if (lastLineLength + token.length > width) {
          while (token.length) {
            const chunk = token.slice(0, width - lastLineLength);
            const remaining = token.slice(width - lastLineLength, token.length);
            lines[lines.length - 1] += chunk;
            lastLineLength += chunk.length;
            token = remaining;
            if (token.length) {
              lines.push('');
              lastLineLength = 0;
            }
          }
        } else {
          lines[lines.length - 1] += token;
          lastLineLength += token.length;
        }
      } else {
        lines[lines.length - 1] += token;
      }

      return lines;
    },
    ['']
  );
};

// From https://github.com/chalk/supports-color
function terminalColorSupport(): TerminalCapabilities {
  if (typeof process === 'undefined') {
    if (globalThis.navigator['userAgentData']) {
      // eslint-disable-next-line no-restricted-globals
      const brand = navigator['userAgentData'].brands.find(
        ({ brand }) => brand === 'Chromium'
      );
      if (brand?.version > 93) return 'full';
    }

    return 'none';
  }

  if (process.env.JEST_WORKER_ID !== undefined) return 'none';
  if (process.env.NO_COLOR) return 'none';
  if (process.env.NODE_DISABLE_COLORS) return 'none';

  if (process.env.FORCE_COLOR === '0' || process.env.FORCE_COLOR === 'false')
    return 'none';

  if (
    process.env.FORCE_COLOR === '1' ||
    process.env.FORCE_COLOR === 'true' ||
    (typeof process.env.FORCE_COLOR === 'string' &&
      process.env.FORCE_COLOR.length === 0)
  )
    return 'basic';

  if (process.env.FORCE_COLOR === '2') return '256';

  if (
    typeof process.env.FORCE_COLOR === 'string' &&
    process.env.FORCE_COLOR.length === 0
  )
    return 'basic';

  if (process.env.FORCE_COLOR === '3') return 'full';

  if (process.stdout && !process.stdout.isTTY) return 'none';
  if (process.stderr && !process.stderr.isTTY) return 'none';

  if ('CI' in process.env) {
    if (
      [
        'TRAVIS',
        'CIRCLECI',
        'APPVEYOR',
        'GITLAB_CI',
        'BUILDKITE',
        'DRONE',
      ].some((ci) => ci in process.env)
    )
      return 'basic';

    if ('GITHUB_ACTIONS' in process.env || 'GITEA_ACTIONS' in process.env) {
      return 'full';
    }

    return 'none';
  }

  if ('TERM_PROGRAM' in process.env) {
    const pgm = process.env.TERM_PROGRAM;

    switch (pgm) {
      case 'iTerm.app': {
        const version = Number.parseInt(
          (process.env.TERM_PROGRAM_VERSION || '').split('.')[0],
          10
        );

        return version >= 3 ? 'full' : '256';
      }

      case 'Apple_Terminal':
        return '256';

      // No default
    }
  }

  // Must check before TERM. Some terminals return TERM=xterm-256color with
  // COLORTERM = 'truecolor'
  if (
    process.env.COLORTERM === 'truecolor' ||
    process.env.COLORTERM === '24bit'
  )
    return 'full';

  if (typeof process.env.TERM === 'string') {
    const term = process.env.TERM.toLowerCase();
    if (term === 'dumb') return 'none';
    if (
      /^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(term)
    )
      return 'basic';

    if (term === 'xterm-kitty') return 'full';

    if (/-256(color)?$/i.test(term)) return '256';
  }

  if ('COLORTERM' in process.env) return 'basic';

  return 'basic';
}
