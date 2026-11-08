/**
 * Regenerates the email images under Frontend/public/brand/email/ from the
 * app's own artwork (macOS only: it uses `sips` and the installed Chrome).
 *
 *   node infra/brand/email-assets.mjs
 *
 * Needs the repo's dev dependencies installed (root, Frontend and e2e).
 *
 * Heroes: each illustration from Frontend/src/data/illustrations.ts is
 * scaled to fit a 1200 x 480 banner (shown at 520 x 208, sharp on retina);
 * the sides are filled by stretching the illustration's own edge pixels, so
 * the banner reads as one seamless backdrop. Chrome composes a lossless PNG,
 * then `sips` encodes the JPEG. The script prints the edge colour of every
 * hero: it is the `bg` fallback in Backend/mail/assets.ts.
 *
 * Product marks: the real <ProductMark> component (Frontend/src/components/
 * ui/ProductMark.tsx) is compiled with TypeScript, rendered with React's
 * server renderer, and screenshotted by headless Chrome at 24 CSS px x2 =
 * 48 px PNGs with transparent corners.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fe = join(root, 'Frontend');
const out = join(fe, 'public/brand/email');
const work = join(tmpdir(), `email-assets-${process.pid}`);
mkdirSync(out, { recursive: true });
mkdirSync(work, { recursive: true });

const feRequire = createRequire(join(fe, 'package.json'));
const { chromium } = createRequire(join(root, 'e2e/package.json'))('playwright');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** email asset name → illustration id (Frontend/src/data/illustrations.ts). */
const HEROES = {
  'hero-invite': 'welcome',
  'hero-digest': 'assistant',
  'hero-task': 'checklist',
  'hero-review': 'code',
  'hero-incident': 'incident',
  'hero-deploy': 'ship',
  'hero-access': 'lockedGate',
  'hero-handover': 'volunteer',
  'hero-farewell': 'idle',
};
const W = 1200;
const H = 480;
const MAX_BYTES = 80 * 1024;

const catalogue = readFileSync(join(fe, 'src/data/illustrations.ts'), 'utf8');
const srcOf = (id) => {
  const m = new RegExp(`\\b${id}: \\{\\s*src: '([^']+)'`).exec(catalogue);
  if (!m) throw new Error(`illustration ${id} not found`);
  return join(fe, 'public', m[1]);
};

const browser = await chromium.launch({ executablePath: CHROME });
try {
  const page = await browser.newPage();
  for (const [name, id] of Object.entries(HEROES)) {
    const data = readFileSync(srcOf(id)).toString('base64');
    const res = await page.evaluate(
      async ({ data, W, H }) => {
        const img = new Image();
        img.src = `data:image/webp;base64,${data}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        // Fit by height (crop a little top and bottom when the art is tall), centre.
        const s = Math.max(H / img.height, Math.min(W / img.width, (H * 1.26) / img.height));
        const w = Math.round(img.width * s);
        const h = Math.round(img.height * s);
        const x = Math.round((W - w) / 2);
        const y = Math.round((H - h) / 2);
        if (x > 0) {
          // Stretch a column of plain backdrop (3% in, clear of edge artefacts) over the side margins.
          const inset = Math.round(img.width * 0.03);
          // Each half of the canvas, so the feathered edges below always blend into backdrop.
          g.drawImage(img, inset, 0, 2, img.height, 0, y, W / 2, h);
          g.drawImage(img, img.width - inset - 2, 0, 2, img.height, W / 2, y, W / 2, h);
          // Feather the art's left and right edges into that backdrop, so no seam shows.
          const f = document.createElement('canvas');
          f.width = w;
          f.height = h;
          const fg = f.getContext('2d');
          fg.imageSmoothingQuality = 'high';
          fg.drawImage(img, 0, 0, w, h);
          const fade = Math.round(w * 0.12);
          const mask = fg.createLinearGradient(0, 0, w, 0);
          mask.addColorStop(0, 'rgba(0,0,0,0)');
          mask.addColorStop(fade / w, 'rgba(0,0,0,1)');
          mask.addColorStop(1 - fade / w, 'rgba(0,0,0,1)');
          mask.addColorStop(1, 'rgba(0,0,0,0)');
          fg.globalCompositeOperation = 'destination-in';
          fg.fillStyle = mask;
          fg.fillRect(0, 0, w, h);
          g.drawImage(f, x, y);
        } else g.drawImage(img, x, y, w, h);
        const px = g.getImageData(4, Math.round(H / 2), 1, 1).data;
        const hex = `#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        return { png: c.toDataURL('image/png').split(',')[1], hex };
      },
      { data, W, H },
    );
    const png = join(work, `${name}.png`);
    const jpg = join(out, `${name}.jpg`);
    writeFileSync(png, Buffer.from(res.png, 'base64'));
    let q = 80;
    for (;;) {
      execFileSync(
        'sips',
        ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(q), png, '--out', jpg],
        {
          stdio: 'ignore',
        },
      );
      if (statSync(jpg).size <= MAX_BYTES || q <= 50) break;
      q -= 5;
    }
    console.log(
      `${name}.jpg  ${W}x${H}  ${Math.round(statSync(jpg).size / 1024)} kB  q${q}  edge ${res.hex}`,
    );
  }

  // ── product marks from the real component ──────────────────────────────
  const ts = feRequire('typescript');
  const React = feRequire('react');
  const { renderToStaticMarkup } = feRequire('react-dom/server');
  const tsx = readFileSync(join(fe, 'src/components/ui/ProductMark.tsx'), 'utf8');
  const js = ts
    .transpileModule(tsx, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(
      /from ["']react\/jsx-runtime["']/,
      `from '${pathToFileURL(feRequire.resolve('react/jsx-runtime')).href}'`,
    );
  const modPath = join(work, 'ProductMark.mjs');
  writeFileSync(modPath, js);
  const { ProductMark } = await import(pathToFileURL(modPath).href);
  const renewberry = `data:image/png;base64,${readFileSync(join(fe, 'public/renewberry.png')).toString('base64')}`;
  // The Tailwind utilities ProductMark uses, with the light-theme token values (src/index.css).
  const css = `body{margin:0;background:transparent}
.inline-flex{display:inline-flex}.shrink-0{flex-shrink:0}.items-center{align-items:center}.justify-center{justify-content:center}
.overflow-hidden{overflow:hidden}.rounded-md{border-radius:6px}.border{border-width:1px;border-style:solid}
.border-line{border-color:rgb(231 231 234)}.bg-white{background:#fff}.h-full{height:100%}.w-full{width:100%}
.object-contain{object-fit:contain}.p-\\[12\\%\\]{padding:12%}*{box-sizing:border-box}
#m{width:24px;height:24px;display:flex}#m>*{width:24px!important;height:24px!important}`;
  const marks = await browser.newPage({
    viewport: { width: 24, height: 24 },
    deviceScaleFactor: 2,
  });
  for (const product of ['renewberry', 'blog', 'mirror']) {
    const html = renderToStaticMarkup(
      React.createElement(ProductMark, { product, size: 'md' }),
    ).replace('src="/renewberry.png"', `src="${renewberry}"`);
    await marks.setContent(`<!doctype html><style>${css}</style><div id="m">${html}</div>`);
    await marks.waitForTimeout(100);
    const file = join(out, `mark-${product}.png`);
    await marks.locator('#m').screenshot({ path: file, omitBackground: true });
    console.log(`mark-${product}.png  48x48  ${(statSync(file).size / 1024).toFixed(1)} kB`);
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
