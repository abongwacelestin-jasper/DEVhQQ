import type { Monaco } from '@monaco-editor/react';
import { resolveImport } from './codeFiles';
import type { OutLine, RunResult } from '../types/ide';

/**
 * Runtime injected into the sandbox worker: console capture, timer tracking (so a run ends when the
 * event loop is idle), a CommonJS loader for workspace files, and a small vitest-compatible test API.
 * Written as plain ES5 strings — it runs inside a Web Worker with no access to the page, cookies or network APIs we expose.
 */
const PRELUDE = [
  'var __timers = new Set(), __finished = false;',
  'var __st = self.setTimeout.bind(self), __ct = self.clearTimeout.bind(self), __si = self.setInterval.bind(self), __ci = self.clearInterval.bind(self);',
  'self.fetch = function () { return Promise.reject(new Error("Network access is disabled in the sandbox")); };',
  'self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.importScripts = undefined;',
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

interface EmitOutput {
  outputFiles: { name: string; text: string }[];
}

/** Compiles the entry file and its workspace imports with Monaco's TypeScript worker, then runs them in an isolated Web Worker. */
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
        ? monaco.languages.typescript.getJavaScriptWorker
        : monaco.languages.typescript.getTypeScriptWorker;
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
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    let settled = false;
    const finish = (r: Omit<RunResult, 'ms'>) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve({ ...r, ms: Math.round(performance.now() - started) });
    };
    const timer = window.setTimeout(() => {
      onLine({
        text: `Stopped after ${timeoutMs / 1000}s — each sandbox run is time-limited.`,
        tone: 'bad',
      });
      finish({ ok: false, passed: 0, failed: 0 });
    }, timeoutMs);
    worker.onmessage = (
      e: MessageEvent<{
        type: 'log' | 'done';
        text?: string;
        tone?: OutLine['tone'];
        ok?: boolean;
        passed?: number;
        failed?: number;
      }>,
    ) => {
      const d = e.data;
      if (d.type === 'log') onLine({ text: d.text ?? '', tone: d.tone });
      else finish({ ok: !!d.ok, passed: d.passed ?? 0, failed: d.failed ?? 0 });
    };
    worker.onerror = (e) => {
      e.preventDefault();
      onLine({ text: e.message || 'The sandbox crashed while running this file.', tone: 'bad' });
      finish({ ok: false, passed: 0, failed: 0 });
    };
  });
}
