import type { Monaco } from '@monaco-editor/react';
import { resolveImport } from './codeFiles';
import type { OutLine, RunResult } from '../types/ide';

/**
 * Runtime injected into the sandbox worker: console capture, timer tracking (so a run ends when the
 * event loop is idle), a CommonJS loader for workspace files, and a small vitest-compatible test API.
 * Written as plain ES5 strings. It runs in a Web Worker spawned by an opaque-origin sandbox iframe
 * (see SANDBOX_BOOTSTRAP), so it cannot reach the page, its storage, cookies or the same-origin API;
 * disabling the network APIs here is defence in depth on top of that isolation.
 */
const PRELUDE = [
  'var __timers = new Set(), __finished = false;',
  'var __st = self.setTimeout.bind(self), __ct = self.clearTimeout.bind(self), __si = self.setInterval.bind(self), __ci = self.clearInterval.bind(self);',
  'self.fetch = function () { return Promise.reject(new Error("Network access is disabled in the sandbox")); };',
  'self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.EventSource = undefined; self.importScripts = undefined;',
  'function __fmt(v) { if (typeof v === "string") return v; if (v instanceof Error) return v.stack || v.message; try { var s = JSON.stringify(v, null, 2); return s === undefined ? String(v) : s; } catch (e) { return String(v); } }',
  'function __out(tone) { return function () { var a = Array.prototype.slice.call(arguments); postMessage({ type: "log", tone: tone, text: a.map(__fmt).join(" ") }); }; }',
  'console.log = __out(undefined); console.info = __out(undefined); console.debug = __out("muted"); console.warn = __out("warn"); console.error = __out("bad"); console.table = __out(undefined);',
  'function __check() { if (__finished && __timers.size === 0) __st(function () { if (__timers.size === 0) postMessage({ type: "done", ok: true, passed: 0, failed: 0 }); }, 0); }',
  'self.setTimeout = function (fn, ms) { var args = Array.prototype.slice.call(arguments, 2); var id = __st(function () { __timers.delete(id); try { fn.apply(null, args); } finally { __check(); } }, ms); __timers.add(id); return id; };',
  'self.clearTimeout = function (id) { __timers.delete(id); __ct(id); __check(); };',
  'self.setInterval = function (fn, ms) { var id = __si(fn, ms); __timers.add(id); return id; };',
  'self.clearInterval = function (id) { __timers.delete(id); __ci(id); __check(); };',
  'self.process = { env: {}, argv: ["node"], exit: function (c) { postMessage({ type: "done", ok: !c, passed: 0, failed: 0 }); } };',
  'self.addEventListener("unhandledrejection", function (e) { postMessage({ type: "log", tone: "bad", text: "Unhandled rejection: " + __fmt(e.reason) }); });',
  'var __tests = [];',
  'self.test = self.it = function (name, fn) { __tests.push({ name: name, fn: fn }); };',
  'self.describe = function (name, fn) { fn(); };',
  'function __eq(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return a === b; } }',
  'function __matchers(v, neg) {',
  '  function check(pass, msg) { if (neg ? pass : !pass) throw new Error((neg ? "expected not: " : "") + msg); }',
  '  var m = {',
  '    toBe: function (e) { check(Object.is(v, e), "expected " + __fmt(e) + ", received " + __fmt(v)); },',
  '    toEqual: function (e) { check(__eq(v, e), "expected " + __fmt(e) + ", received " + __fmt(v)); },',
  '    toBeTruthy: function () { check(!!v, "expected truthy, received " + __fmt(v)); },',
  '    toBeFalsy: function () { check(!v, "expected falsy, received " + __fmt(v)); },',
  '    toContain: function (e) { check(v != null && v.indexOf(e) !== -1, "expected " + __fmt(v) + " to contain " + __fmt(e)); },',
  '    toHaveLength: function (n) { check(v != null && v.length === n, "expected length " + n + ", received " + (v && v.length)); },',
  '    toBeGreaterThan: function (n) { check(v > n, "expected " + __fmt(v) + " > " + n); },',
  '    toBeLessThan: function (n) { check(v < n, "expected " + __fmt(v) + " < " + n); },',
  '    toThrow: function (msg) { var threw = false, err; try { v(); } catch (e) { threw = true; err = e; } check(threw && (!msg || String(err && err.message).indexOf(msg) !== -1), "expected function to throw" + (msg ? " \\"" + msg + "\\"" : "")); }',
  '  };',
  '  if (!neg) m.not = __matchers(v, true);',
  '  return m;',
  '}',
  'self.expect = function (v) { return __matchers(v, false); };',
  'var __cache = {};',
  'function __load(p) {',
  '  if (__cache[p]) return __cache[p].exports;',
  '  var mod = { exports: {} }; __cache[p] = mod;',
  '  var def = __mods[p];',
  '  function req(s) {',
  '    if (s === "vitest" || s === "@jest/globals") return { test: self.test, it: self.it, describe: self.describe, expect: self.expect };',
  '    var r = def.deps[s];',
  '    if (!r) throw new Error("Cannot find module \'" + s + "\' from " + p + " — only files in this workspace can be imported (no npm packages, no network).");',
  '    return __load(r);',
  '  }',
  '  def.fn(req, mod, mod.exports);',
  '  return mod.exports;',
  '}',
  'async function __start(entry) {',
  '  try {',
  '    self.process.argv.push(entry);',
  '    __load(entry);',
  '    if (__tests.length) {',
  '      var passed = 0, failed = 0;',
  '      for (var i = 0; i < __tests.length; i++) {',
  '        var t = __tests[i], s = performance.now();',
  '        try { await t.fn(); passed++; postMessage({ type: "log", tone: "ok", text: "  ✓ " + t.name + " (" + Math.round(performance.now() - s) + "ms)" }); }',
  '        catch (e) { failed++; postMessage({ type: "log", tone: "bad", text: "  ✗ " + t.name + "\\n      " + (e && e.message ? e.message : __fmt(e)) }); }',
  '      }',
  '      postMessage({ type: "done", ok: failed === 0, passed: passed, failed: failed });',
  '      return;',
  '    }',
  '    __finished = true;',
  '    __check();',
  '  } catch (e) {',
  '    postMessage({ type: "log", tone: "bad", text: e && e.stack ? String(e.stack).split("\\n").slice(0, 3).join("\\n") : __fmt(e) });',
  '    postMessage({ type: "done", ok: false, passed: 0, failed: 0 });',
  '  }',
  '}',
].join('\n');

/** Output limits per run: a runaway `console.log` loop must not freeze the page. */
export const MAX_OUTPUT_LINES = 2000;
export const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_LINE_CHARS = 8000;

/**
 * Runs inside the sandbox iframe (`sandbox="allow-scripts"`, `srcdoc`), whose
 * origin is opaque: it cannot read the app's DOM or storage, its requests carry
 * no DevHQ cookies, and the same-origin `/api` is cross-origin to it. It spawns
 * the worker that executes user code, relays only well-formed messages to its
 * parent, and stops forwarding (and kills the worker) once output limits are hit.
 *
 * The page CSP allows exactly this script by hash (`vite.config.ts` computes it
 * from this constant), so it must stay a static string.
 */
export const SANDBOX_BOOTSTRAP = [
  '(function () {',
  '  "use strict";',
  '  var parentOrigin = null, channel = null, worker = null, lines = 0, bytes = 0, closed = false;',
  `  var MAX_LINES = ${MAX_OUTPUT_LINES}, MAX_BYTES = ${MAX_OUTPUT_BYTES}, MAX_CHARS = ${MAX_LINE_CHARS};`,
  '  function send(msg) { if (parentOrigin) window.parent.postMessage({ channel: channel, msg: msg }, parentOrigin); }',
  '  function stop(msg) { if (closed) return; closed = true; if (worker) worker.terminate(); send(msg); }',
  '  function onWorker(e) {',
  '    var d = e.data; if (!d || closed) return;',
  '    if (d.type === "log") {',
  '      var text = String(d.text == null ? "" : d.text);',
  '      if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + " … (line truncated)";',
  '      lines += 1; bytes += text.length;',
  '      if (lines > MAX_LINES || bytes > MAX_BYTES) { stop({ type: "limit" }); return; }',
  '      send({ type: "log", text: text, tone: typeof d.tone === "string" ? d.tone : undefined });',
  '    } else if (d.type === "done") {',
  '      stop({ type: "done", ok: !!d.ok, passed: Number(d.passed) || 0, failed: Number(d.failed) || 0 });',
  '    }',
  '  }',
  '  window.addEventListener("message", function (e) {',
  '    if (e.source !== window.parent || worker) return;',
  '    var d = e.data;',
  '    if (!d || d.type !== "devhq-run" || typeof d.source !== "string" || typeof d.channel !== "string") return;',
  '    parentOrigin = e.origin; channel = d.channel;',
  '    try {',
  '      var url = URL.createObjectURL(new Blob([d.source], { type: "text/javascript" }));',
  '      worker = new Worker(url);',
  '      URL.revokeObjectURL(url);',
  '      worker.onmessage = onWorker;',
  '      worker.onerror = function (ev) { ev.preventDefault(); send({ type: "log", tone: "bad", text: String(ev.message || "The sandbox crashed while running this file.") }); stop({ type: "done", ok: false, passed: 0, failed: 0 }); };',
  '    } catch (err) {',
  '      stop({ type: "fatal", text: String((err && err.message) || err) });',
  '    }',
  '  });',
  // The ready ping carries no data, so it may go to any origin: the sandbox cannot know its parent's yet.
  '  window.parent.postMessage({ type: "devhq-sandbox-ready" }, "*");',
  '})();',
].join('\n');

/** The iframe document. No other markup: nothing for user code to reach. */
export function sandboxSrcdoc(): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${SANDBOX_BOOTSTRAP}</script></body></html>`;
}

interface EmitOutput {
  outputFiles: { name: string; text: string }[];
}

type SandboxMessage =
  | { type: 'log'; text: string; tone?: string }
  | { type: 'done'; ok: boolean; passed: number; failed: number }
  | { type: 'limit' }
  | { type: 'fatal'; text: string };

function isSandboxEnvelope(v: unknown): v is { channel: string; msg: SandboxMessage } {
  if (!v || typeof v !== 'object') return false;
  const r = v as { channel?: unknown; msg?: { type?: unknown } };
  return typeof r.channel === 'string' && !!r.msg && typeof r.msg.type === 'string';
}

const TONES: readonly string[] = ['cmd', 'ok', 'bad', 'warn', 'muted'];
const toTone = (t: string | undefined): OutLine['tone'] =>
  t && TONES.includes(t) ? (t as OutLine['tone']) : undefined;

/** Compiles the entry file and its workspace imports with Monaco's TypeScript worker, then runs them in the sandbox. */
export async function runInSandbox(
  monaco: Monaco,
  entry: string,
  paths: string[],
  onLine: (l: OutLine) => void,
  timeoutMs = 8000,
): Promise<RunResult> {
  const available = new Set(paths);
  const mods: Record<string, { code: string; deps: Record<string, string | null> }> = {};

  const emit = async (path: string) => {
    const model = monaco.editor.getModel(monaco.Uri.parse(`file:///${path}`));
    if (!model) throw new Error(`${path} isn’t loaded in the editor yet.`);
    if (path.endsWith('.json')) return `module.exports = ${model.getValue()};`;
    const getter =
      model.getLanguageId() === 'javascript'
        ? monaco.typescript.getJavaScriptWorker
        : monaco.typescript.getTypeScriptWorker;
    const worker = await getter();
    const client = await worker(model.uri);
    const out = (await client.getEmitOutput(model.uri.toString())) as EmitOutput;
    const js = out.outputFiles.find((f) => f.name.endsWith('.js'))?.text;
    if (js == null) throw new Error(`Couldn’t compile ${path}.`);
    return js;
  };

  const collect = async (path: string): Promise<void> => {
    if (mods[path]) return;
    mods[path] = { code: '', deps: {} };
    const code = await emit(path);
    mods[path].code = code;
    const specs = Array.from(code.matchAll(/require\((["'])([^"']+)\1\)/g)).map((m) => m[2]);
    for (const s of specs) {
      const resolved = resolveImport(path, s, available);
      mods[path].deps[s] = resolved;
      if (resolved) await collect(resolved);
    }
  };

  await collect(entry);

  const table = Object.entries(mods)
    .map(
      ([p, m]) =>
        `${JSON.stringify(p)}: { deps: ${JSON.stringify(m.deps)}, fn: function (require, module, exports) {\n${m.code}\n} }`,
    )
    .join(',\n');
  const source = `${PRELUDE}\nvar __mods = {\n${table}\n};\n__start(${JSON.stringify(entry)});`;

  return new Promise<RunResult>((resolve) => {
    const started = performance.now();
    const channel = crypto.randomUUID();
    const frame = document.createElement('iframe');
    // allow-scripts only: opaque origin, no same-origin access, no forms, popups or top navigation.
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.title = 'Code sandbox';
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;';
    frame.srcdoc = sandboxSrcdoc();

    let settled = false;
    let lines = 0;
    let bytes = 0;

    const finish = (r: Omit<RunResult, 'ms'>) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove(); // tears down the iframe and, with it, the worker
      resolve({ ...r, ms: Math.round(performance.now() - started) });
    };

    const limitHit = () => {
      onLine({
        text: `Output stopped after ${MAX_OUTPUT_LINES} lines / ${Math.round(MAX_OUTPUT_BYTES / 1024)} KB — the run was terminated.`,
        tone: 'bad',
      });
      finish({ ok: false, passed: 0, failed: 0 });
    };

    function onMessage(e: MessageEvent<unknown>) {
      // Only our own sandbox frame (an opaque origin serialises as "null") may talk to us.
      if (e.source !== frame.contentWindow || e.origin !== 'null') return;
      const data = e.data;
      if (
        data &&
        typeof data === 'object' &&
        (data as { type?: unknown }).type === 'devhq-sandbox-ready'
      ) {
        // Opaque origins can't be targeted by name; the payload is the user's own code.
        frame.contentWindow?.postMessage({ type: 'devhq-run', channel, source }, '*');
        return;
      }
      if (!isSandboxEnvelope(data) || data.channel !== channel) return;
      const msg = data.msg;
      if (msg.type === 'log') {
        const text = String(msg.text ?? '');
        lines += 1;
        bytes += text.length;
        if (lines > MAX_OUTPUT_LINES || bytes > MAX_OUTPUT_BYTES) return limitHit();
        onLine({ text, tone: toTone(msg.tone) });
      } else if (msg.type === 'limit') {
        limitHit();
      } else if (msg.type === 'fatal') {
        onLine({ text: `The sandbox couldn’t start: ${msg.text}`, tone: 'bad' });
        finish({ ok: false, passed: 0, failed: 0 });
      } else {
        finish({ ok: !!msg.ok, passed: Number(msg.passed) || 0, failed: Number(msg.failed) || 0 });
      }
    }

    // Wall-clock limit enforced by the page: removing the frame terminates even a busy-looping worker.
    const timer = window.setTimeout(() => {
      onLine({
        text: `Stopped after ${timeoutMs / 1000}s — each sandbox run is time-limited.`,
        tone: 'bad',
      });
      finish({ ok: false, passed: 0, failed: 0 });
    }, timeoutMs);

    window.addEventListener('message', onMessage);
    document.body.appendChild(frame);
  });
}
