#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX_URL = 'https://math.unm.edu/~wester/cas_review.html';
const OUTPUT_DIR = path.dirname(fileURLToPath(import.meta.url));

const SPECIAL_NAMES = {
  'demos/PDEs/Math.heat': 'test_pdes_heat.m',
  'demos/Programming/Math.dif': 'test_programming_dif.m',
  'demos/MathvsCS/Math.local': 'test_math_vs_cs_local.m',
  'demos/MathvsCS/Math.match': 'test_math_vs_cs_match.m',
};

function snakeCase(value) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

function outputName(href) {
  if (SPECIAL_NAMES[href]) return SPECIAL_NAMES[href];
  const [, topic] = href.match(/^demos\/([^/]+)\/Math\.problems$/) ?? [];
  if (!topic) throw new Error(`Unrecognized Mathematica suite URL: ${href}`);
  return `test_${snakeCase(topic)}.m`;
}

function extractLinks(html) {
  const links = [];
  const pattern = /HREF="(demos\/[^"]+\/Math\.(?:problems|heat|dif|local|match))"/g;
  for (const match of html.matchAll(pattern)) links.push(match[1]);
  return [...new Set(links)];
}

function isTiming(line) {
  return /^\s*(?:\d+(?:\.\d*)?|\.\d+)\s+Second(?:s)?\s*$/.test(line);
}

function isSessionBoundary(line) {
  return (
    /^In\[\d+\]:=/.test(line) ||
    /^[A-Za-z$][A-Za-z0-9$]*::[A-Za-z0-9]+:/.test(line) ||
    /^time: command terminated abnormally\./.test(line) ||
    /^(?:real|user|sys)\s+\d/.test(line) ||
    /^-{20,}\s*$/.test(line) ||
    /^\w{3} \w{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \w+ \d{4}$/.test(line) ||
    /^euler% math$/.test(line) ||
    /^Mathematica \d/.test(line)
  );
}

function repairTerminalWrapping(lines) {
  const repaired = [];

  for (let line of lines) {
    line = line.replace(/^>\s{0,4}/, '');

    if (repaired.length > 0 && repaired.at(-1).endsWith('\\')) {
      repaired[repaired.length - 1] =
        repaired.at(-1).slice(0, -1) + ' ' + line.trimStart();
    } else if (line !== '' || repaired.at(-1) !== '') {
      repaired.push(line);
    }
  }

  return repaired;
}

function extractInputs(transcript, sourceUrl) {
  const lines = transcript.replaceAll('\r\n', '\n').split('\n');
  const expressions = [];

  for (let index = 0; index < lines.length; index += 1) {
    const start = lines[index].match(/^In\[\d+\]:=\s?(.*)$/);
    if (!start) continue;
    if (start[1].trim() === '') continue;
    if (start[1].trim() === 'Quit[]') continue;

    const input = [start[1]];
    while (
      index + 1 < lines.length &&
      !isTiming(lines[index + 1]) &&
      !isSessionBoundary(lines[index + 1])
    ) {
      input.push(lines[index + 1]);
      index += 1;
    }

    const expression = repairTerminalWrapping(input).join('\n').trim();
    if (expression) expressions.push(expression);
  }

  return [
    `(* Extracted from ${sourceUrl}`,
    `   Source index: ${INDEX_URL} *)`,
    '',
    ...expressions.flatMap((expression) => [expression, '']),
  ].join('\n');
}

const indexResponse = await fetch(INDEX_URL);
if (!indexResponse.ok) {
  throw new Error(`Failed to fetch ${INDEX_URL}: ${indexResponse.status}`);
}

const links = extractLinks(await indexResponse.text());
if (links.length === 0) throw new Error('No Mathematica suite links found');

await mkdir(OUTPUT_DIR, { recursive: true });

for (const href of links) {
  const sourceUrl = new URL(href, INDEX_URL).href;
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${sourceUrl}: ${response.status}`);
  }

  const filename = outputName(href);
  const source = extractInputs(await response.text(), sourceUrl);
  await writeFile(path.join(OUTPUT_DIR, filename), source, 'utf8');
  console.log(filename);
}

console.log(`Extracted ${links.length} Mathematica files into ${OUTPUT_DIR}`);
