#!/usr/bin/env node

import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { FileItem, OptionItem, ServerResponse } from './types';

const app = express();
app.use((req, res, next) => {
  if (req.path === '/api/upload') return next();
  express.json()(req, res, next);
});

const PORT_FILE = '/tmp/promptui.port';
const CHROME_PROFILE = '/tmp/promptui-chrome';
const SHUTDOWN_GRACE_MS = 60_000;
const WIN_W = 780, WIN_H = 580;

let sseRes: Response | null = null;
let shutdownTimer: ReturnType<typeof setTimeout> | null = null;
let pendingResolve: ((value: ServerResponse) => void) | null = null;
let sseWaiters: (() => void)[] = [];
let serverPort: number | null = null;
let frontApp: string | null = null;
let openBrowserDone: Promise<void> | null = null;
let storedOptions: OptionItem[] = [];
let filePickerRoot: string | null = null;
let uploadDest: string | null = null;
let uploadMaxSize: number | null = null;
let uploadExtensions: string[] | null = null;
const PAGE_SIZE = 48;

function captureFrontApp(): Promise<string | null> {
  return new Promise((resolve) => {
    exec(`osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

async function killStaleChromeWindows(): Promise<void> {
  return new Promise((resolve) => {
    exec(`pkill -f 'user-data-dir=${CHROME_PROFILE}'`, () => resolve());
  });
}

function focusPromptUIWindow(): void {
  exec(`pgrep -f 'app=http://localhost.*user-data-dir=${CHROME_PROFILE}'`, (err, stdout) => {
    if (err || !stdout.trim()) return;
    const pid = stdout.trim().split('\n')[0];
    exec(`osascript -e 'tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true'`);
  });
}

async function openBrowser(): Promise<void> {
  await killStaleChromeWindows();
  await new Promise<void>((resolve) => setTimeout(resolve, 500));

  frontApp = await captureFrontApp();
  const W = WIN_W, H = WIN_H;
  const url = `http://localhost:${serverPort}`;

  const centerExpr = frontApp ? `
try
  tell application "System Events"
    tell process "${frontApp}"
      set {px, py} to position of window 1
      set {pw, ph} to size of window 1
    end tell
  end tell
  set cx to px + (pw - ${W}) div 2
  set cy to py + (ph - ${H}) div 2
on error
  set cx to 200
  set cy to 200
end try` : `
tell application "Finder" to set sb to bounds of window of desktop
set cx to (item 3 of sb - ${W}) div 2
set cy to (item 4 of sb - ${H}) div 2`;

  const script = `
${centerExpr}
do shell script "open -na 'Google Chrome' --args --app='${url}' --window-size=${W},${H} --window-position=" & (cx as text) & "," & (cy as text) & " --user-data-dir='${CHROME_PROFILE}' --no-first-run --no-default-browser-check"
repeat with i from 1 to 150
  delay 0.02
  try
    tell application "Google Chrome"
      if (count of windows) > 0 then
        set bounds of front window to {cx, cy, cx + ${W}, cy + ${H}}
        exit repeat
      end if
    end tell
  end try
end repeat`;

  openBrowserDone = new Promise<void>((resolve) => {
    const child = exec('osascript', () => resolve());
    child.stdin!.write(script);
    child.stdin!.end();
  });
}

function waitForSSE(timeoutMs = 15000): Promise<void> {
  if (sseRes) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const waiter = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => {
      sseWaiters = sseWaiters.filter(fn => fn !== waiter);
      reject(new Error('No browser connected within 15s. Is Google Chrome installed?'));
    }, timeoutMs);
    sseWaiters.push(waiter);
  });
}

// --- SSE stream the browser listens to ---
app.get('/events', (req: Request, res: Response) => {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseRes = res;

  const sendReady = () => {
    if (sseRes) sseRes.write(`data: ${JSON.stringify({ type: '_ready' })}\n\n`);
  };

  if (openBrowserDone) {
    openBrowserDone.then(sendReady);
    openBrowserDone = null;
  } else {
    sendReady();
  }

  const waiters = sseWaiters.slice();
  sseWaiters = [];
  waiters.forEach(fn => fn());

  req.on('close', () => {
    sseRes = null;
    shutdownTimer = setTimeout(() => {
      console.log('Browser disconnected — shutting down.');
      try { fs.unlinkSync(PORT_FILE); } catch (_) {}
      process.exit(0);
    }, SHUTDOWN_GRACE_MS);
  });
});

// --- Send a UI event, block until user responds ---
app.post('/ui', async (req: Request, res: Response) => {
  let payload = req.body;

  if (!sseRes) {
    openBrowser();
    try {
      await waitForSSE();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(503).json({ error: msg });
    }
  }

  // Bring promptui window to front
  focusPromptUIWindow();

  if (payload.type === 'display') {
    sseRes!.write(`data: ${JSON.stringify(payload)}\n\n`);
    return res.json({ ok: true });
  }

  // File picker: store root server-side for jail enforcement
  if (payload.type === 'file') {
    filePickerRoot = path.resolve(payload.root || process.cwd());
  }

  // Upload: store dest/limits server-side, strip dest from browser payload
  if (payload.type === 'upload') {
    uploadDest = path.resolve(payload.dest);
    uploadMaxSize = payload.maxSize || null;
    uploadExtensions = payload.extensions || null;
    const { dest, maxSize: _ms, ...browserPayload } = payload;
    payload = {
      ...browserPayload,
      extensions: uploadExtensions,
      maxSize: uploadMaxSize,
    };
  }

  // For filterable payloads: store full list server-side, send first page only
  if (payload.filter && Array.isArray(payload.options)) {
    storedOptions = payload.options;
    payload = {
      ...payload,
      options: storedOptions.slice(0, PAGE_SIZE),
      total: storedOptions.length,
      pageSize: PAGE_SIZE,
    };
  }

  const UI_TIMEOUT_MS = 5 * 60_000;
  let result: ServerResponse;
  try {
    result = await new Promise<ServerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingResolve = null;
        reject(new Error('UI timed out after 5 minutes waiting for a response'));
      }, UI_TIMEOUT_MS);
      pendingResolve = (value) => { clearTimeout(timer); resolve(value); };
      sseRes!.write(`data: ${JSON.stringify(payload)}\n\n`);
    });
  } catch (e: unknown) {
    pendingResolve = null;
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(504).json({ error: msg });
  }

  pendingResolve = null;
  // Return focus to the app that launched the prompt
  if (frontApp) {
    exec(`osascript -e 'tell application "${frontApp}" to activate'`);
  }
  res.json(result);
});

// --- Paginated / filtered options ---
app.get('/ui/page', (req: Request, res: Response) => {
  const q = (String(req.query.q || '')).toLowerCase().trim();
  const offset = parseInt(String(req.query.offset)) || 0;
  const limit = parseInt(String(req.query.limit)) || PAGE_SIZE;
  const filtered = q
    ? storedOptions.filter(o => o.label.toLowerCase().includes(q))
    : storedOptions;
  res.json({ items: filtered.slice(offset, offset + limit), total: filtered.length });
});

// --- File picker directory listing (jailed to root) ---
app.get('/api/ls', (req: Request, res: Response) => {
  if (!filePickerRoot) return res.status(400).json({ error: 'No active file picker' });

  const subpath = String(req.query.path || '');
  const resolvedRoot = path.resolve(filePickerRoot);
  const target = path.resolve(resolvedRoot, subpath);

  // Jail check: resolved path must be within root
  if (!target.startsWith(resolvedRoot + path.sep) && target !== resolvedRoot) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Symlink check: follow symlinks and re-verify jail
  let realTarget: string;
  try {
    realTarget = fs.realpathSync(target);
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
  const realRoot = fs.realpathSync(resolvedRoot);
  if (!realTarget.startsWith(realRoot + path.sep) && realTarget !== realRoot) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Read directory
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(realTarget, { withFileTypes: true });
  } catch {
    return res.status(403).json({ error: 'Cannot read directory' });
  }

  // Filter hidden files, build items
  const items: FileItem[] = entries
    .filter(e => !e.name.startsWith('.'))
    .map(e => {
      const fullPath = path.join(realTarget, e.name);
      const isDir = e.isDirectory();
      let size = 0;
      try { size = isDir ? 0 : fs.statSync(fullPath).size; } catch {}
      return {
        name: e.name,
        type: isDir ? 'directory' as const : 'file' as const,
        size,
        extension: isDir ? undefined : path.extname(e.name).slice(1).toLowerCase() || undefined,
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const isAtRoot = realTarget === realRoot;
  res.json({
    path: target,
    root: resolvedRoot,
    atRoot: isAtRoot,
    items,
  });
});

// --- File upload endpoint (base64 via JSON) ---
app.post('/api/upload', express.json({ limit: '50mb' }), (req: Request, res: Response) => {
  if (!uploadDest) return res.status(400).json({ error: 'No active upload prompt' });

  const files: { name: string; data: string }[] = req.body.files;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }

  // Ensure dest directory exists
  const realDest = path.resolve(uploadDest);
  fs.mkdirSync(realDest, { recursive: true });

  const saved: string[] = [];

  for (const file of files) {
    // Sanitize filename: basename only, reject dot-prefix, replace illegal chars
    let name = path.basename(file.name);
    name = name.replace(/[<>:"|?*\x00-\x1f]/g, '_');
    if (name.startsWith('.')) name = '_' + name;
    if (!name) continue;

    // Extension check
    if (uploadExtensions && uploadExtensions.length > 0) {
      const ext = path.extname(name).slice(1).toLowerCase();
      if (!uploadExtensions.includes(ext)) {
        return res.status(400).json({ error: `Extension not allowed: .${ext}` });
      }
    }

    // Decode base64 (strip data URL prefix if present)
    const b64 = file.data.replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(b64, 'base64');

    // Size check
    if (uploadMaxSize && buf.length > uploadMaxSize) {
      return res.status(400).json({ error: `File too large: ${name} (${buf.length} bytes, max ${uploadMaxSize})` });
    }

    // Jail check
    let writePath = path.resolve(realDest, name);
    if (!writePath.startsWith(realDest + path.sep) && writePath !== realDest) {
      return res.status(403).json({ error: 'Path traversal denied' });
    }

    // Collision handling: append timestamp if file exists
    if (fs.existsSync(writePath)) {
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      name = `${base}-${Date.now()}${ext}`;
      writePath = path.resolve(realDest, name);
    }

    fs.writeFileSync(writePath, buf);
    saved.push(writePath);
  }

  res.json({ paths: saved });
});

// --- Browser posts response back here ---
app.post('/response', (req: Request, res: Response) => {
  if (pendingResolve) {
    pendingResolve(req.body);
  }
  filePickerRoot = null;
  uploadDest = null;
  uploadMaxSize = null;
  uploadExtensions = null;
  res.json({ ok: true });
});

// --- Serve local files by absolute path ---
app.get('/static/*', (req: Request, res: Response) => {
  const filePath = '/' + req.params[0];
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Not found');
  }
  res.sendFile(filePath);
});

// --- Serve frontend ---
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// --- Start ---
const server = app.listen(0, '127.0.0.1', async () => {
  const addr = server.address();
  serverPort = typeof addr === 'object' && addr !== null ? addr.port : 0;
  fs.writeFileSync(PORT_FILE, String(serverPort));
  await killStaleChromeWindows();
  console.log(`\nUI Bridge running → http://localhost:${serverPort}\n`);
});
