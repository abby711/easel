// Design-system extraction without AI:
//  1. static: CSS custom properties, colours, fonts, sizes, radii, spacing, Tailwind usage
//  2. components: definitions with file:line, props, and usage counts (React/Vue/Svelte/Astro/Angular/Blade)
//  3. runtime census: what the rendered pages actually use (reported by the runtime)
import path from 'node:path';
import { walk, readText, lineOf } from './util.js';
import { MOCKS_DIR } from './config.js';

const STYLE_EXTS = ['.css', '.scss', '.sass', '.less', '.styl', '.pcss'];
const MARKUP_EXTS = ['.html', '.htm', '.vue', '.svelte', '.astro', '.jsx', '.tsx', '.js', '.ts', '.erb', '.php', '.twig', '.cshtml', '.heex', '.liquid', '.njk', '.hbs', '.ejs'];
const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)/g;

export function normColor(c) {
  const s = c.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    if (h.length === 8 && h.endsWith('ff')) h = h.slice(0, 6);
    return '#' + h;
  }
  m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    const hex = '#' + [m[1], m[2], m[3]].map((n) => Math.max(0, Math.min(255, +n)).toString(16).padStart(2, '0')).join('');
    if (a >= 1) return hex;
    if (a === 0) return 'transparent';
    return hex + Math.round(a * 255).toString(16).padStart(2, '0');
  }
  return s.replace(/\s+/g, ' ');
}

function bump(map, key, where) {
  if (!key) return;
  const e = map.get(key) || { value: key, count: 0, where: null };
  e.count++;
  if (!e.where && where) e.where = where;
  map.set(key, e);
}
const top = (map, n = 40) => [...map.values()].sort((a, b) => b.count - a.count).slice(0, n);

/** Pull <style> blocks out of markup files. */
function styleBlocks(text) {
  const out = [];
  for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) out.push({ css: m[1], offset: m.index });
  return out;
}

export function extractTokens(appDir) {
  const files = walk(appDir, { max: 8000 }).filter((f) => !f.startsWith(MOCKS_DIR + '/'));
  const vars = new Map();
  const colors = new Map();
  const fonts = new Map();
  const sizes = new Map();
  const radii = new Map();
  const spacing = new Map();
  const shadows = new Map();
  const tw = new Map();
  const varUses = new Map();

  const scanCss = (css, file, baseText, offset = 0) => {
    for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}{]+)[;}]/g)) {
      const name = m[1];
      const value = m[2].trim();
      if (!vars.has(name)) vars.set(name, { name, value, file, line: lineOf(baseText, offset + m.index), uses: 0, kind: kindOf(value) });
    }
    for (const m of css.matchAll(/var\(\s*(--[\w-]+)/g)) varUses.set(m[1], (varUses.get(m[1]) || 0) + 1);
    for (const m of css.matchAll(COLOR_RE)) bump(colors, normColor(m[0]), `${file}:${lineOf(baseText, offset + m.index)}`);
    for (const m of css.matchAll(/font-family\s*:\s*([^;}{]+)/g)) bump(fonts, m[1].split(',')[0].replace(/["']/g, '').trim(), `${file}:${lineOf(baseText, offset + m.index)}`);
    for (const m of css.matchAll(/font-size\s*:\s*([^;}{]+)/g)) bump(sizes, m[1].trim(), file);
    for (const m of css.matchAll(/border-radius\s*:\s*([^;}{]+)/g)) bump(radii, m[1].trim(), file);
    for (const m of css.matchAll(/box-shadow\s*:\s*([^;}{]+)/g)) bump(shadows, m[1].trim().slice(0, 80), file);
    for (const m of css.matchAll(/(?:^|[\s;{])(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block))?\s*:\s*([^;}{]+)/g)) {
      for (const v of m[1].trim().split(/\s+/)) if (/^\d/.test(v) && v !== '0') bump(spacing, v, file);
    }
  };

  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!STYLE_EXTS.includes(ext) && !MARKUP_EXTS.includes(ext)) continue;
    const text = readText(path.join(appDir, f), '');
    if (!text || text.length > 1500000) continue;
    if (STYLE_EXTS.includes(ext)) scanCss(text, f, text);
    else {
      for (const b of styleBlocks(text)) scanCss(b.css, f, text, b.offset);
      // Tailwind utility usage
      if (/class(Name)?\s*=/.test(text)) {
        for (const m of text.matchAll(/\b(bg|text|border|ring|fill|stroke|from|to|via)-([a-z]+-(?:50|[1-9]00|950)|black|white|primary|secondary|accent|muted|brand[\w-]*)\b/g)) bump(tw, `${m[1]}-${m[2]}`, f);
      }
    }
  }
  // Tailwind v3 config colours (v4 uses @theme custom properties, already captured above)
  const twConfig = files.find((f) => /^tailwind\.config\.(js|cjs|mjs|ts)$/.test(f));
  const twColors = [];
  if (twConfig) {
    const t = readText(path.join(appDir, twConfig), '');
    for (const m of t.matchAll(/['"]?([\w-]+)['"]?\s*:\s*['"](#[0-9a-fA-F]{3,8}|rgb[^'"]+|hsl[^'"]+)['"]/g)) twColors.push({ name: m[1], value: normColor(m[2]), file: twConfig, line: lineOf(t, m.index) });
  }
  for (const [k, n] of varUses) if (vars.has(k)) vars.get(k).uses = n;
  return {
    vars: [...vars.values()].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)).slice(0, 300),
    colors: top(colors, 60),
    fonts: top(fonts, 20),
    fontSizes: top(sizes, 30),
    radii: top(radii, 20),
    spacing: top(spacing, 30),
    shadows: top(shadows, 15),
    tailwind: { config: twConfig || null, colors: twColors, classes: top(tw, 40) },
  };
}

function kindOf(v) {
  if (COLOR_RE.test(v) || /^(transparent|currentcolor)$/i.test(v)) {
    COLOR_RE.lastIndex = 0;
    return 'color';
  }
  COLOR_RE.lastIndex = 0;
  if (/^-?[\d.]+(px|rem|em|%|vh|vw|ch)?$/.test(v)) return 'size';
  if (/,|serif|sans|mono/i.test(v)) return 'font';
  if (/^\d{3}$/.test(v)) return 'weight';
  if (/shadow|\d+px\s+\d+px/.test(v)) return 'shadow';
  return 'other';
}

// ---------- components ----------

export function extractComponents(appDir) {
  const files = walk(appDir, { max: 8000 }).filter((f) => !f.startsWith(MOCKS_DIR + '/'));
  const src = files.filter((f) => /\.(jsx|tsx|js|ts|vue|svelte|astro|html|php|erb)$/.test(f));
  const defs = [];
  const texts = new Map();
  const get = (f) => {
    if (!texts.has(f)) texts.set(f, readText(path.join(appDir, f), ''));
    return texts.get(f);
  };
  for (const f of src) {
    const ext = path.extname(f);
    const t = get(f);
    if (!t || t.length > 800000) continue;
    if (/\.(jsx|tsx)$/.test(f) || (/\.(js|ts)$/.test(f) && /<[A-Z]\w*[\s/>]|React|jsx/.test(t))) {
      const re = /export\s+(?:default\s+)?(?:function\s+([A-Z]\w*)\s*\(([^)]*)\)|const\s+([A-Z]\w*)\s*(?::[^=]+)?=\s*(?:React\.)?(?:forwardRef|memo)?\(?\s*(?:function\s*\w*)?\s*\(([^)]*)\))/g;
      for (const m of t.matchAll(re)) {
        const name = m[1] || m[3];
        const params = m[2] ?? m[4] ?? '';
        const props = [...params.matchAll(/([A-Za-z_$][\w$]*)\s*(?:=\s*([^,}]+))?[,}]/g)].map((p) => (p[2] ? `${p[1]}=${p[2].trim()}` : p[1])).filter((p) => !/^(props|ref)$/.test(p));
        defs.push({ name, file: f, line: lineOf(t, m.index), framework: 'react', props: params.trim().startsWith('{') ? props : [] });
      }
    } else if (ext === '.vue' || ext === '.svelte' || ext === '.astro') {
      const name = path.basename(f, ext);
      if (/^[A-Z]/.test(name) || /components?\//i.test(f)) {
        const props = [];
        for (const m of t.matchAll(/defineProps<\{([^}]*)\}>|export\s+let\s+(\w+)|props\s*:\s*\{([^}]*)\}|interface Props\s*\{([^}]*)\}/g)) {
          const body = m[1] || m[3] || m[4];
          if (m[2]) props.push(m[2]);
          if (body) for (const p of body.matchAll(/(\w+)\??\s*:/g)) props.push(p[1]);
        }
        defs.push({ name: name.replace(/^\w/, (c) => c.toUpperCase()), file: f, line: 1, framework: ext.slice(1), props });
      }
    }
    if (/\.ts$/.test(f) && /@Component\(/.test(t)) {
      for (const m of t.matchAll(/@Component\(\s*\{[\s\S]*?selector\s*:\s*['"`]([^'"`]+)['"`][\s\S]*?\}\)\s*export\s+class\s+(\w+)/g)) defs.push({ name: m[2], selector: m[1], file: f, line: lineOf(t, m.index), framework: 'angular', props: [...t.matchAll(/@Input\(\)\s*(\w+)/g)].map((x) => x[1]) });
    }
  }
  // Blade components (resources/views/components/*.blade.php → <x-name>)
  for (const f of files.filter((x) => /resources\/views\/components\/.+\.blade\.php$/.test(x))) {
    const name = f.replace(/^.*components\//, '').replace(/\.blade\.php$/, '').replace(/\//g, '.');
    defs.push({ name, selector: `x-${name}`, file: f, line: 1, framework: 'blade', props: [] });
  }
  // usage counts
  const seen = new Set();
  const uniq = defs.filter((d) => (seen.has(d.name + d.file) ? false : seen.add(d.name + d.file)));
  for (const d of uniq) {
    const kebab = d.name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const needles = [`<${d.name}`, d.selector ? `<${d.selector}` : null, d.framework === 'vue' ? `<${kebab}` : null].filter(Boolean);
    let uses = 0;
    const usedIn = [];
    for (const f of src) {
      if (f === d.file) continue;
      const t = get(f);
      let n = 0;
      for (const nd of needles) {
        let i = t.indexOf(nd);
        while (i !== -1) {
          const ch = t[i + nd.length];
          if (!ch || /[\s/>.]/.test(ch)) n++;
          i = t.indexOf(nd, i + nd.length);
        }
      }
      if (n) {
        uses += n;
        if (usedIn.length < 8) usedIn.push(f);
      }
    }
    d.uses = uses;
    d.usedIn = usedIn;
  }
  return uniq.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}

/** Merge runtime census reports (from many pages) into ranked lists. */
export function mergeCensus(reports) {
  const buckets = {};
  for (const r of reports) {
    if (!r) continue;
    for (const [bucket, counts] of Object.entries(r)) {
      if (typeof counts !== 'object') continue;
      buckets[bucket] ||= new Map();
      for (const [k, n] of Object.entries(counts)) {
        const key = /color|background|border/.test(bucket) || /^rgb/.test(k) ? normColor(k) : k;
        buckets[bucket].set(key, (buckets[bucket].get(key) || 0) + n);
      }
    }
  }
  const out = {};
  for (const [b, m] of Object.entries(buckets)) out[b] = [...m.entries()].map(([value, count]) => ({ value, count })).sort((x, y) => y.count - x.count).slice(0, 30);
  return out;
}
