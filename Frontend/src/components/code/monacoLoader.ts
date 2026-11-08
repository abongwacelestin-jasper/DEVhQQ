/**
 * Self-hosted Monaco. @monaco-editor/react would otherwise fetch the editor from
 * cdn.jsdelivr.net at runtime; handing the loader the bundled package keeps every
 * byte on our origin (CSP `'self'`), versioned and content-hashed with the build.
 *
 * Imported only by the editor components, which live in the lazily loaded code
 * workspace chunk: none of this is in the entry bundle. Workers are separate
 * files fetched the first time a language needs one.
 */
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      default:
        return new EditorWorker();
    }
  },
};

loader.config({ monaco });
