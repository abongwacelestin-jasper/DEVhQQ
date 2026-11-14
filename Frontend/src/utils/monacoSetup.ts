import type { Monaco } from '@monaco-editor/react';

let configured = false;

const sandboxGlobals = `
declare const process: { env: Record<string, string | undefined>; argv: string[]; exit(code?: number): never };
interface DevhqMatchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toContain(item: unknown): void;
  toHaveLength(length: number): void;
  toBeGreaterThan(n: number): void;
  toBeLessThan(n: number): void;
  toThrow(message?: string): void;
  not: DevhqMatchers;
}
declare function test(name: string, fn: () => unknown): void;
declare const it: typeof test;
declare function describe(name: string, fn: () => void): void;
declare function expect(value: unknown): DevhqMatchers;
declare const React: any;
declare namespace JSX { interface IntrinsicElements { [name: string]: any } }
declare module 'vitest' {
  export const test: (name: string, fn: () => unknown) => void;
  export const it: (name: string, fn: () => unknown) => void;
  export const describe: (name: string, fn: () => void) => void;
  export function expect(value: unknown): DevhqMatchers;
}
`;

/** One-time Monaco configuration: TavetaHQ themes, TypeScript compiler options and sandbox globals. */
export function setupMonaco(monaco: Monaco) {
  if (configured) return;
  configured = true;

  monaco.editor.defineTheme('devhq-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#1F1F1F',
      'editorGutter.background': '#1F1F1F',
      'minimap.background': '#1F1F1F',
      'editorStickyScroll.background': '#1F1F1F',
      'editorLineNumber.foreground': '#6E7681',
      'editorLineNumber.activeForeground': '#CCCCCC',
      'editor.lineHighlightBorder': '#282828',
      'editorWidget.background': '#202020',
      'editorWidget.border': '#313131',
    },
  });
  monaco.editor.defineTheme('devhq-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#FFFFFF',
      'editorLineNumber.foreground': '#6E7681',
      'editorLineNumber.activeForeground': '#171184',
      'editor.lineHighlightBorder': '#EEEEEE',
    },
  });

  const ts = monaco.typescript;
  const options = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.React,
    allowNonTsExtensions: true,
    allowJs: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    strict: true,
    skipLibCheck: true,
  };
  ts.typescriptDefaults.setCompilerOptions(options);
  ts.javascriptDefaults.setCompilerOptions(options);
  ts.typescriptDefaults.setEagerModelSync(true);
  ts.javascriptDefaults.setEagerModelSync(true);
  ts.typescriptDefaults.addExtraLib(
    sandboxGlobals,
    'file:///node_modules/@types/devhq-sandbox/index.d.ts',
  );
  ts.javascriptDefaults.addExtraLib(
    sandboxGlobals,
    'file:///node_modules/@types/devhq-sandbox/index.d.ts',
  );
}
