#!/usr/bin/env node

/**
 * cli.ts — Markdown CLI for promptui
 *
 * Usage:
 *   promptui file.md           # parse MD → post to server → print result
 *   cat file.md | promptui -   # read from stdin
 */

import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';
import parseMd from './parse-md';
import { validatePayload } from './validate';
import { Payload, ServerResponse } from './types';

const VERSION = require('../package.json').version;

const PORT_FILE = '/tmp/promptui.port';
const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 5000;

// --- Helpers ---

function readPort(): number | null {
  try { return parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10); }
  catch { return null; }
}

function isServerAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/', timeout: 1000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function startServer(): void {
  const serverPath = path.join(__dirname, 'server.js');
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function ensureServer(): Promise<number> {
  let port = readPort();
  if (port && await isServerAlive(port)) return port;

  // Stale or missing — (re)start
  try { fs.unlinkSync(PORT_FILE); } catch {}
  startServer();

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS));
    port = readPort();
    if (port && await isServerAlive(port)) return port;
  }

  throw new Error(`Server failed to start within 5s.\n  Try: rm ${PORT_FILE} && promptui <file.md>`);
}

function postPayload(port: number, payload: Payload): Promise<ServerResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/ui',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error(`Invalid server response: ${body}`)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Convert server JSON response → plain text for stdout.
 */
function formatResponse(json: ServerResponse): { text: string; code: number } {
  if ('dismissed' in json) return { text: 'dismissed', code: 0 };
  if ('error' in json) return { text: `error: ${json.error}`, code: 1 };
  if ('values' in json) {
    const lines = Object.entries(json.values).map(([key, val]) => {
      const str = String(val);
      if (str.includes('\n')) {
        const indented = str.split('\n').map((l, i) => i === 0 ? l : `  ${l}`).join('\n');
        return `${key}: ${indented}`;
      }
      return `${key}: ${str}`;
    });
    return { text: lines.join('\n'), code: 0 };
  }
  if ('ranked' in json) {
    return {
      text: json.ranked.map((item, i) => `${i + 1}. ${item}`).join('\n'),
      code: 0,
    };
  }
  if ('results' in json) {
    return {
      text: json.results.map(r => `- ${r.label}: ${r.action || 'skipped'}`).join('\n'),
      code: 0,
    };
  }
  if ('uploaded' in json) {
    const paths = (json as { uploaded: string[] }).uploaded;
    if (paths.length === 1) return { text: paths[0], code: 0 };
    return { text: paths.map(p => `- ${p}`).join('\n'), code: 0 };
  }
  if ('chosen' in json) {
    if (Array.isArray(json.chosen))
      return { text: json.chosen.map(c => `- ${c}`).join('\n'), code: 0 };
    return { text: String(json.chosen), code: 0 };
  }
  if ('confirmed' in json) return { text: json.confirmed ? 'yes' : 'no', code: 0 };
  if ('action' in json) return { text: String(json.action), code: 0 };
  if ('rating' in json) return { text: String(json.rating), code: 0 };
  if ('value' in json) return { text: String(json.value), code: 0 };
  if ('text' in json) return { text: String(json.text), code: 0 };
  if ('ok' in json) return { text: 'ok', code: 0 };
  return { text: JSON.stringify(json), code: 0 };
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => data += chunk);
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

// --- Path resolution ---

/**
 * Resolve all path fields in a payload to absolute paths.
 * baseDir is the directory of the source .md file, or CWD for stdin.
 */
function resolvePayloadPaths(payload: Payload, baseDir: string): Payload {
  const p = { ...payload } as Record<string, unknown>;

  // Resolve options[].image
  if ('options' in payload && Array.isArray((payload as any).options)) {
    p.options = ((payload as any).options as Array<{ label: string; image?: string }>).map(o => {
      if (o.image && !path.isAbsolute(o.image)) {
        return { ...o, image: path.resolve(baseDir, o.image) };
      }
      return o;
    });
  }

  // Resolve root (file picker)
  if ('root' in p && typeof p.root === 'string' && !path.isAbsolute(p.root as string)) {
    p.root = path.resolve(baseDir, p.root as string);
  }

  // Resolve dest (upload)
  if ('dest' in p && typeof p.dest === 'string' && !path.isAbsolute(p.dest as string)) {
    p.dest = path.resolve(baseDir, p.dest as string);
  }

  return p as unknown as Payload;
}

// --- Help ---

const HELP = `promptui v${VERSION} — browser UI prompts for Claude Code

Usage:
  promptui <file.md>    Show prompt defined in markdown file
  promptui -            Read markdown from stdin

Examples:
  promptui /tmp/pick.md
  echo '# Deploy? \\nThis affects prod.' | promptui -

Docs: promptui SKILL.md or see .claude/skills/promptui/SKILL.md`;

// --- Main ---

async function main(): Promise<void> {
  const arg = process.argv[2];

  // No args or help flag → print help, exit 0
  if (!arg || arg === '--help' || arg === '-h') {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }

  if (arg === '--version' || arg === '-v') {
    process.stdout.write(VERSION + '\n');
    process.exit(0);
  }

  // Read input from file or stdin
  let raw: string;
  let baseDir: string;
  if (arg === '-') {
    raw = await readStdin();
    baseDir = process.cwd();
  } else {
    const filePath = path.resolve(arg);
    if (!fs.existsSync(filePath)) {
      process.stderr.write(`promptui: file not found: ${filePath}\n  (resolved from "${arg}")\n`);
      process.exit(1);
    }
    raw = fs.readFileSync(filePath, 'utf8');
    baseDir = path.dirname(filePath);
  }

  // JSON passthrough if input starts with {, otherwise parse as markdown
  let payload: Payload;
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      payload = JSON.parse(trimmed);
    } catch {
      process.stderr.write('promptui: invalid JSON input\n');
      process.exit(1);
    }
  } else {
    payload = parseMd(raw);
  }

  // Resolve relative paths to absolute
  payload = resolvePayloadPaths(payload, baseDir);

  // Validate payload before sending
  const error = validatePayload(payload);
  if (error) {
    process.stderr.write(`promptui: ${error}\n`);
    process.exit(1);
  }

  // Ensure server is running
  let port: number;
  try {
    port = await ensureServer();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`promptui: ${msg}\n`);
    process.exit(1);
  }

  // Post and print result
  try {
    const response = await postPayload(port, payload);
    const { text, code } = formatResponse(response);
    process.stdout.write(text + '\n');
    process.exit(code);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`promptui: ${msg}\n`);
    process.exit(1);
  }
}

main();
