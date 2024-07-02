// eslint-disable-next-line import/no-extraneous-dependencies
import { CustomConsole, LogType, LogMessage } from '@jest/console';

const RESET = '\u001b[0;0m';
const GREY = '\u001b[30;1m';
// const GREY = '\u001b[90;1m'; // BRIGHT BLACK
const RED = '\u001b[31;1m';
const CYAN = '\u001b[36;1m';
const REVERSED_RED = '\u001b[91;7m';
const BLUE = '\u001b[34;1m';
// const BRIGHT_BLUE = '\u001b[94;1m';
const YELLOW = '\u001b[33;0m';
// const DIM_YELLOW = '\u001b[33;2m';

// const GREY_BG = '\u001b[40;1m';

function simpleFormatter(type: LogType, ...message: LogMessage[]): string {
  const CONSOLE_INDENT = ' ';

  let s = message.map((x) => x.toString()).join('');

  if (type === 'assert')
    s =
      '\n' +
      REVERSED_RED +
      ' ASSERTION FAILURE ' +
      RESET +
      RED +
      ' ' +
      message +
      RESET;
  else if (type === 'error')
    s = REVERSED_RED + ' ERROR ' + RESET + RED + ' ' + message + RESET;
  else if (type === 'log') s = BLUE + message + RESET;
  else if (type === 'warn') s = YELLOW + 'WARNING ' + YELLOW + message + RESET;

  return s
    .split(/\n/)
    .map((line) => CONSOLE_INDENT + line)
    .join('\n');
}

function formatStackTrace(s: string): string {
  const curDir = __dirname;
  const parentDir = curDir.match(/(.*)\/([^\/]*)$/)?.[1];
  if (!parentDir || !curDir) return s;
  s = s
    .replace(new RegExp(parentDir, 'g'), '..')
    .replace(new RegExp(curDir, 'g'), '.');

  const lines = s.split('\n').map((line) => {
    if (/\.\.\/node_modules/.test(line)) return '';
    if (/\(node:internal/.test(line)) return '';

    line = line.replace('    at ', '  > ');

    const [_, prefix, filename, suffix] =
      line.match(/(?:(.+)\()([^:]+)(\:[^)]+)/) ?? [];
    if (!prefix) return line;
    if (/Object.<anonymous>/.test(prefix) || prefix.startsWith('  > console.'))
      return GREY + '  > ' + CYAN + filename + GREY + suffix;
    return GREY + prefix + CYAN + filename + GREY + suffix;
  });
  lines[0] = '';
  lines[1] = '';
  return RESET + lines.filter((line) => line.length > 0).join('\n') + RESET;
}

/**
 * @noInheritDoc
 */
class CortexConsole extends CustomConsole {
  constructor(stdout, stderr, formatBuffer = (_type, message) => message) {
    super(stdout, stderr, formatBuffer);
  }
  log(...message) {
    let msg = '';
    try {
      throw new Error();
    } catch (e) {
      msg = `${
        !message ? '' : message.map((x) => serialize(x)).join(' ')
      }\n${formatStackTrace(e.stack)}\n`;
    }
    this['_logError']('log', msg);
  }
  error(...message) {
    debugger;

    let msg = '';
    try {
      throw new Error();
    } catch (e) {
      msg = `${
        !message ? '' : message.map((x) => serialize(x)).join(' ')
      }\n${formatStackTrace(e.stack)}\n`;
    }
    this['_logError']('error', msg);
  }
  assert(value, ...message) {
    if (value) return;

    debugger;

    let msg = '';
    try {
      throw new Error();
    } catch (e) {
      msg = `${
        !message ? '' : message.map((x) => serialize(x)).join(' ')
      }\n${formatStackTrace(e.stack)}\n`;
    }
    this['_logError']('assert', msg);
  }
}

function recursiveSerialize(x: unknown): string {
  if (x === null) return 'null';
  if (
    typeof x === 'object' &&
    !Array.isArray(x) &&
    x.constructor.name !== 'Object'
  )
    return `{${x.constructor.name}}`;
  return serialize(x);
}

function serialize(x: any): string {
  if (Array.isArray(x)) {
    return `[${x.map((y) => recursiveSerialize(y)).join(', ')}]`;
  }
  if (x === null) return 'null';
  if (x === undefined) return 'undefined';
  if (typeof x === 'object') {
    return `[${Object.entries(x)
      .map(([key, value]) => '"' + key + '": ' + recursiveSerialize(value))
      .join(', ')}]`;
  }
  if (typeof x === 'string') {
    return `"${x}"`;
  }
  return x.toString();
}

global.console = new CortexConsole(
  process.stdout,
  process.stderr,
  simpleFormatter
);
