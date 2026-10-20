#!/usr/bin/env node
/**
 * render_cards.js — deterministic HTML -> PNG card renderer for knowledge-card decks.
 *
 *   node render_cards.js --spec cards.json --style STYLE-01-editorial.json --out ./out
 *                        [--width N --height N]        # platform override, keeps style intact
 *
 * Split of labour: the caller (model) decides copy, block types and ordering, and writes
 * cards.json. This script only turns that spec into pixels — same input, same output.
 * Visual judgement (does it overflow? does it look right?) is the caller's job, not this file's.
 *
 * A style is described by two files: `<id>.json` (tokens) and `<id>.md` (field reference).
 * Colours/sizes live in `colors` + `type`; anything structural lives in `variants`
 * (coverBg, quoteStyle, radius, mono, ruleWeight, titleWeight, metaBorder). New styles
 * normally need only the token file — see references/style-registry.md.
 *
 * Node built-ins only. No npm dependencies. Drives a headless Chrome/Edge already on the machine.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const pathToFileURL = require('url').pathToFileURL;

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv);
const SPEC = args.spec;
const STYLE = args.style;
const OUT = path.resolve(args.out || './out');

if (!SPEC || !STYLE) {
  console.error(
    'usage: node render_cards.js --spec <cards.json> --style <style.json> --out <dir>\n' +
    '                             [--width N --height N]   # platform override, keeps style intact'
  );
  process.exit(2);
}

const spec = JSON.parse(fs.readFileSync(path.resolve(SPEC), 'utf8'));
const style = JSON.parse(fs.readFileSync(path.resolve(STYLE), 'utf8'));

// Canvas comes from the STYLE by default. `--width/--height` let the caller repoint the same
// style at a different publishing platform without mutating the style definition — platform and
// style are orthogonal, so a new platform must never mean "edit the style's token file".
const styleW = (style.canvas && style.canvas.width) || 1080;
const styleH = (style.canvas && style.canvas.height) || 1440;
const W = args.width ? Number(args.width) : styleW;
const H = args.height ? Number(args.height) : styleH;
const C = style.colors;
const F = style.fonts;
const T = style.type;

if (!Number.isFinite(W) || !Number.isFinite(H) || W <= 0 || H <= 0) {
  console.error(`invalid canvas: ${W}x${H}`);
  process.exit(2);
}

if (W !== styleW || H !== styleH) {
  const supported = style.supportedCanvas || [];
  console.log(`canvas override: ${styleW}x${styleH} -> ${W}x${H}`);
  if (supported.length && !supported.some(([w, h]) => w === W && h === H)) {
    console.log(
      `WARNING ${W}x${H} is not a ratio this style was tuned for ` +
      `(known-good: ${supported.map((s) => `${s[0]}x${s[1]}`).join(', ')}). ` +
      `Layout is padding-based and may break. Render anyway, then OPEN THE IMAGES and check ` +
      `for clipping or runaway whitespace before delivering.`
    );
  }
}

/* ---------------------------------------------------------------- variants
 * Structural knobs a style can flip without forking the renderer. Colours and
 * sizes alone cannot express "no rounded boxes" vs "everything is a soft card".
 */

const V = style.variants || {};
const vd = (k, d) => (V[k] === undefined ? d : V[k]);

const coverBg = vd('coverBg', 'ink');            // ink | paper | accent
const quoteStyle = vd('quoteStyle', 'bar');      // bar | fill | rule | outline
const radius = vd('radius', 0);
const ruleWeight = vd('ruleWeight', 4);
const titleWeight = vd('titleWeight', 900);
const titleLS = vd('titleLetterSpacing', '-0.01em');
const metaBorder = vd('metaBorder', 3);
const labelStack = vd('mono', false) && F.mono ? F.mono : F.sans;
const bulletColor = vd('bullet', 'ink') === 'accent' ? C.accent : C.ink;
const totalDim = C.totalDim || '#8C8377';

/* Layout variants.
 * Feedback on styles 02-05: they read as "PPT / 报表". The cause is not colour — it is the
 * three structural tells baked into the base layout, so they have to be switchable:
 *   metaLayout  3-column table with top/bottom rules and column dividers -> spreadsheet
 *   secLabel    section caption with a long rule running to the right edge -> slide header
 *   bulletShape small square dots in a left column -> office bulleted list
 * cardBg additionally lets a style flood the whole card with one colour instead of paper.
 */
const metaLayout = vd('metaLayout', 'table');   // table | stack | inline
const secLabel = vd('secLabel', 'rule');        // rule | plain | block | underline
const bulletShape = vd('bulletShape', 'square');// square | dot | bar | dash | arrow | num
const cardBg = vd('cardBg', null);              // null = use colors.paper
const titleBlock = vd('titleBlock', false);     // true = headline sits in a solid colour slab

/* Poster-only tokens. A poster inverts the usual relationship: the ground is one flat extreme
 * value and the type carries the contrast, so ink/muted/seal are derived from the ground rather
 * than read from colors.ink, which was tuned to sit on paper. */
const posterBg = vd('posterBg', C.paper);
const posterInk = vd('posterInk', C.ink);
const posterInkMuted = vd('posterInkMuted', C.muted);
const posterSealBg = vd('posterSealBg', C.accent);
const posterSealInk = vd('posterSealInk', C.onAccent || C.paper);
/* A seal's top line is a numeral in most styles but a two-character word in others. Two CJK glyphs
 * at the default 52px are 104px wide inside a 118px box, which reads as cramped, so the size has
 * to be adjustable per style rather than fixed. */
const posterSealNumSize = vd('posterSealNumSize', 52);
/* The offset "lift" layer behind a headline. The sticker recipe wants a hard vermilion copy of the
 * glyph nudged down-right, not a blurred shadow, so the colour and the offset are both tokens. */
const posterShadowColor = vd('posterShadowColor', 'rgba(0,0,0,.34)');
const posterShadowOffset = vd('posterShadowOffset', '.05em');
/* The rule under the headline: solid, dashed, or a hand-drawn wobble. */
const posterRuleStyle = vd('posterRuleStyle', 'solid');  // solid | dashed | wavy
const posterTitleRotate = vd('posterTitleRotate', 0);
const posterRuleW = vd('posterRuleW', 220);
const posterRuleH = vd('posterRuleH', 12);
// The bold part of a tag is the hook, so it must stay the highest-contrast ink on the ground.
// On a light posterInk (white over orange) that inverts to unreadable, hence its own token.
const posterTagInk = vd('posterTagInk', posterInk);
const posterArtH = vd('posterArtH', 520);
// A 3:4 source cropped to a ~2:1 band throws away over half the height, and a centred crop decapitates
// subjects that sit in the upper third. Focal point has to be per-style, not a fixed default.
const posterArtPosition = vd('posterArtPosition', 'center 34%');
/* Fade the bottom of the band into the ground. A photo band on a dark ground shows a hard seam
 * where the image ends; the seam is what makes it look pasted on rather than lit from within.
 * 0 = hard edge (the default, and what the flat-illustration styles want). */
const posterArtFade = vd('posterArtFade', 0);
const artFadeCss = posterArtFade > 0
  ? `-webkit-mask-image:linear-gradient(to bottom,#000 0,#000 calc(100% - ${posterArtFade}px),transparent 100%);` +
    `mask-image:linear-gradient(to bottom,#000 0,#000 calc(100% - ${posterArtFade}px),transparent 100%);`
  : '';
const titleEffect = vd('titleEffect', '');           // ''|lift|outline|shadow|extrude|neon|glow|halo
const posterFlow = vd('posterFlow', 'bottom');       // bottom | top
const posterTitleWeight = vd('posterTitleWeight', 900);
const posterTitleLS = vd('posterTitleLS', '-0.028em');
/* Outline width has to be tuned per weight AND per face. 2.6px over a 900-weight CJK sans fills the
   counters and the glyphs fuse into a wireframe mess. The serif face has thin/thick contrast and
   open counters, so the same treatment reads as a calligraphic outline instead of a blob. */
const posterTitleFamily = vd('posterTitleFamily', F.sans);
const posterOutlineW = vd('posterOutlineW', 2.6);
const posterTagStyle = vd('posterTagStyle', 'plain');  // plain | chip
const posterRuleOpacity = vd('posterRuleOpacity', 1);
/* 3-D extrusion for the "hard-core type" treatment. The depth cannot come from a blurred shadow —
 * a blur reads as a drop shadow, which the recipe forbids; it has to come from a stack of hard
 * offsets of the same glyph, so the side of the block stays crisp. */
const posterExtrudeStep = vd('posterExtrudeStep', 4);
const posterExtrudeLayers = vd('posterExtrudeLayers', 8);
const posterExtrudeColor = vd('posterExtrudeColor', C.accent);
const extrudeShadow = (() => {
  const parts = [];
  for (let i = posterExtrudeLayers; i >= 1; i--) {
    parts.push(`${i * posterExtrudeStep}px ${i * posterExtrudeStep}px 0 ${posterExtrudeColor}`);
  }
  return parts.join(',');
})();
/* Neon and cinematic glow. The halo is what sells a lit tube, so the letter keeps its own fill and
 * only the halo changes colour — that keeps the "one accent" budget intact. */
const posterNeonA = vd('posterNeonA', '#00E5FF');
const posterNeonB = vd('posterNeonB', '#FF2E9A');
const posterGlowColor = vd('posterGlowColor', C.accent);
/* A light halo behind dark type, for headlines that sit on a busy ground. The halo is the same
 * colour as the ground, so it reads as air around the letters rather than a second accent. */
const posterHaloColor = vd('posterHaloColor', 'rgba(255,255,255,.95)');
/* The rule and the subtitle are separate tokens because the brand-launch recipe wants the rule in
 * the accent colour while the subtitle stays in the muted ink. */
const posterRuleColor = vd('posterRuleColor', posterInk);
/* A raw "#" inside a data URI starts a URL fragment, so the SVG loads as nothing and the rule
 * silently disappears. The colour has to be percent-encoded before it goes in. */
const svgColor = String(posterRuleColor).replace(/#/g, '%23');
const posterSubFamily = vd('posterSubFamily', F.sans);
const posterOutlineColor = vd('posterOutlineColor', posterInk);
/* Step strip: 'rule' is a ruled timeline, 'flow' is a lit pipeline with the connector running
 * through the numerals. */
const posterStepsStyle = vd('posterStepsStyle', 'rule');  // rule | flow
/* Sample matrix: a wall of framed tiles. */
const posterGridCols = vd('posterGridCols', 3);
const posterGridTilt = vd('posterGridTilt', 1.4);
const posterGridGap = vd('posterGridGap', 22);
const posterGridFrame = vd('posterGridFrame', C.ink);
const posterGridBg = vd('posterGridBg', C.paper);
const posterGridInk = vd('posterGridInk', C.ink);
/* Optional per-tile tints for the sample matrix. One flat colour for every tile reads as a table;
 * giving each tile its own soft wash reads as a wall of different works. */
const posterGridTints = vd('posterGridTints', null);
/* A gradient ground, for the styles whose recipe calls for a warm-to-light sweep. */
const posterBgGradient = vd('posterBgGradient', null);
/* Treatment of the illustration band. 'sketch' drains the colour and adds paper warmth so a flat
 * 3-D render reads as a hand-coloured line drawing on kraft paper. */
const posterArtFilter = vd('posterArtFilter', 'none');  // none | sketch | duo
const artFilterCss = {
  none: '',
  sketch: 'filter:saturate(.05) contrast(1.72) brightness(1.04)',
  duo: 'filter:grayscale(1) contrast(1.12) brightness(1.04)',
}[posterArtFilter] || '';
const NOISE_SVG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' " +
  "stitchTiles='stitch'/></filter><rect width='220' height='220' filter='url(%23n)'/></svg>";
const posterBokeh = vd('posterBokeh', null);
/* Soft out-of-focus colour fields. A real "blurred photo" background needs a photo; what actually
 * carries the style is the same thing a defocused lens produces — big overlapping washes of warm
 * light with no hard edge anywhere. */
const bokehImage = Array.isArray(posterBokeh) && posterBokeh.length
  ? posterBokeh.map(([x, y, s, col]) =>
      `radial-gradient(circle at ${x}% ${y}%, ${col} 0 ${s}%, transparent ${s + 15}%)`).join(',')
  : '';
/* Each texture contributes one background-image layer. A style may ask for several at once — a
 * grainy ground with a light pool in the middle, say — and they have to be merged into a single
 * background-image list, because a second background-image declaration would drop the first. */
const POSTER_TEXTURES = {
  none: { image: '' },
  grain: { image: `url("${NOISE_SVG}")`, size: '220px 220px', opacity: '.5' },
  paper: { image: `repeating-linear-gradient(90deg,rgba(0,0,0,.05) 0 1px,transparent 1px 9px),` +
                  `repeating-linear-gradient(0deg,rgba(0,0,0,.05) 0 1px,transparent 1px 9px)` },
  glow: { image: `radial-gradient(circle at ${vd('posterGlowAt', '52% 40%')},${C.accent}55,transparent 62%)` },
  bokeh: { image: bokehImage },
  grid: { image: `repeating-linear-gradient(0deg,${C.accent}1f 0 2px,transparent 2px 48px),` +
                  `repeating-linear-gradient(90deg,${C.accent}1f 0 2px,transparent 2px 48px),` +
                  `radial-gradient(circle at 50% 26%,${C.accent}30,transparent 64%)` },
};
const posterTexture = (() => {
  const raw = vd('posterTexture', 'grain');
  const names = Array.isArray(raw) ? raw : [raw];
  const picked = names.map((n) => POSTER_TEXTURES[n]).filter(Boolean);
  if (!picked.length) return '';
  const images = picked.map((t) => t.image).filter(Boolean).join(',');
  const sizes = picked.map((t) => t.size).filter(Boolean).join(',');
  const op = picked.map((t) => t.opacity).filter(Boolean).pop() || '';
  return `background-image:${images}` + (sizes ? `;background-size:${sizes}` : '') +
    (op ? `;opacity:${op}` : '');
})();
const onAccent = C.onAccent || C.paper;
const onAccentMuted = C.onAccentMuted || onAccent;
/* A solid block behind a keyword usually wants its own pair, not the accent: the "sticker" styles
 * put a deep-brown block on an orange ground and keep vermilion for the corner seal, and tying
 * both to colors.accent would collapse them into one colour. */
const posterBlkBg = vd('posterBlkBg', C.accent);
const posterBlkInk = vd('posterBlkInk', onAccent);

const coverBgColor = coverBg === 'paper' ? C.paper : coverBg === 'accent' ? C.accent : C.ink;
const coverText = coverBg === 'paper' ? C.ink : onAccent;
const coverDim = coverBg === 'paper' ? C.muted : (C.coverDim || '#7A7266');
const coverRule = coverBg === 'paper' ? C.ink : onAccent;
const coverSub = coverBg === 'paper' ? C.muted : (C.coverSub || '#A9A093');
const ghostColor = coverBg === 'paper' ? C.ghost : (C.ghostCover || '#241F19');
const tocText = coverBg === 'paper' ? C.ink : (C.tocText || '#CFC8BB');
const tocRule = coverBg === 'paper' ? C.hairline : (C.coverRule || '#3A342C');
const coverEm = C.coverAccent || (coverBg === 'accent' ? onAccent : C.accent);
const coverVrule = C.coverAccent || (coverBg === 'accent' ? onAccent : C.accent);
const coverTblockBg = coverBg === 'accent' ? C.paper : coverVrule;
const coverTblockInk = coverBg === 'accent' ? C.ink : coverText;

const QUOTE = {
  bar: `background:${C.quote};border-left:9px solid ${C.accent};padding:28px 32px`,
  fill: `background:${C.accent};color:${onAccent};padding:28px 32px`,
  high: `background:${C.quote};color:${C.ink};padding:28px 32px`,
  rule: `background:transparent;border-top:3px solid ${C.ink};padding:26px 0 0`,
  outline: `background:transparent;border:2px solid ${C.ink};padding:26px 30px`,
}[quoteStyle];
const quoteLabelColor = quoteStyle === 'fill' ? onAccentMuted : C.accent;
const quoteTextColor = quoteStyle === 'fill' ? onAccent : C.ink;
const quoteRadius = quoteStyle === 'bar' || quoteStyle === 'outline'
  ? `border-radius:${radius}px;`
  : '';

/* --------------------------------------------------------------- helpers */

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const stars = (n) => {
  const k = Math.max(0, Math.min(5, Number(n) || 0));
  return `<span class="st">${'\u2605'.repeat(k)}<span class="dim">${'\u2606'.repeat(5 - k)}</span></span>`;
};

const chromePath = () => {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(pf, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
    path.join(local, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
};

/* ------------------------------------------------------------------- CSS */

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px}
body{background:${cardBg || C.paper};color:${C.ink};font-family:${F.sans};
     -webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.card{width:${W}px;height:${H}px;position:relative;overflow:hidden;
      padding:78px 78px 66px;display:flex;flex-direction:column}
.card.cover{background:${coverBgColor};color:${coverText}}

.topbar{display:flex;justify-content:space-between;align-items:baseline;flex:0 0 auto}
.kicker{font:700 ${T.kicker}px/1 ${labelStack};letter-spacing:.24em;color:${C.accent}}
.cover .kicker{color:${coverEm}}
.folio{font:600 ${T.folio}px/1 ${labelStack};letter-spacing:.16em;color:${C.muted}}
.cover .folio{color:${coverDim}}
.rule{height:${ruleWeight}px;background:${C.ink};margin-top:20px;flex:0 0 auto}
.cover .rule{background:${coverRule}}

.ghost{position:absolute;right:66px;top:132px;font-family:${F.serif};font-weight:900;
      font-size:250px;line-height:.78;color:${ghostColor};letter-spacing:-.04em;z-index:0}

.body{position:relative;z-index:1;display:flex;flex-direction:column;flex:1 1 auto;min-height:0}

.art{display:block;width:100%;object-fit:cover;border-radius:${radius}px;margin-top:22px;flex:0 0 auto}
.cover .art{margin-top:26px}

.cover .title{font-family:${F.serif};font-weight:${titleWeight};font-size:${T.coverTitle}px;
              line-height:1.08;letter-spacing:${titleLS};margin-top:64px}
.cover .title .em{color:${coverEm}}
.cover .subtitle{font-family:${F.serif};font-weight:400;font-size:${T.coverSub}px;line-height:1.6;
                 color:${coverSub};margin-top:34px;max-width:790px}
.cover .vrule{width:180px;height:10px;background:${coverVrule};margin-top:40px}
.cover .stats{margin-top:auto;display:grid;grid-template-columns:repeat(3,1fr);
              border-top:2px solid ${tocRule};padding-top:26px}
.cover .stat .lab{font:700 16px/1 ${labelStack};letter-spacing:.2em;color:${coverDim}}
.cover .stat .val{font-family:${F.serif};font-weight:700;font-size:38px;margin-top:14px;color:${coverText}}
.cover .stat .val .u{font-size:24px;color:${coverDim};font-weight:700}
.cover .stat .val .st{color:${coverEm};font-size:30px;letter-spacing:.04em}
.cover .stat .val .st .dim{opacity:.35}
.cover .hint{margin-top:40px;padding-top:22px;border-top:2px solid ${tocRule};
             display:flex;justify-content:space-between;
             font:600 17px/1 ${labelStack};letter-spacing:.18em;color:${coverDim}}

.title{font-family:${F.serif};font-weight:${titleWeight};font-size:${T.title}px;line-height:1.16;
       letter-spacing:${titleLS};margin-top:44px}
.title-cn{font-family:${F.serif};font-weight:700;font-size:${T.titleCn}px;line-height:1.45;
           color:${C.titleCn || '#4A443C'};margin-top:20px}
/* Lets a spec wrap a latin headline in <span class="en"> to mark it as the reference title rather
   than the claim; without a rule the span is inert and the two read as one undifferentiated run. */
.title .en{font-size:.92em;letter-spacing:-.005em}
/* titleBlock: set the headline inside a solid colour slab. A free-floating block of colour is
   the opposite of a slide headline, and it gives the title a hard edge to anchor the page. */
.title.tblock{display:inline-block;background:${C.accent};color:${onAccent};
              padding:22px 28px;letter-spacing:0}
/* On an accent-coloured cover the default accent slab would be accent-on-accent, i.e. invisible.
   Flip it to the paper colour with ink type so the headline still reads. */
.cover .title.tblock{background:${coverTblockBg};color:${coverTblockInk}}
.src{font:600 18px/1 ${labelStack};letter-spacing:.14em;color:${C.accent};margin-top:18px}

.meta{display:grid;grid-template-columns:repeat(3,1fr);border-top:${metaBorder}px solid ${C.ink};
      border-bottom:${metaBorder}px solid ${C.ink};margin-top:34px;flex:0 0 auto}
.meta .cell{padding:18px 0}
.meta .cell + .cell{border-left:2px solid ${C.hairline};padding-left:26px}
.meta .lab{font:700 16px/1 ${labelStack};letter-spacing:.2em;color:${C.muted}}
.meta .val{font-family:${F.serif};font-weight:700;font-size:${T.metaVal}px;margin-top:12px;line-height:1.25}
.meta .val .st{color:${C.accent};letter-spacing:.04em;font-size:${T.metaVal - 2}px}
.meta .val .st .dim{opacity:.3}

/* --- metaLayout: table is the default and the main "spreadsheet" tell; stack and inline
   break the grid apart so the same three facts stop reading as a table row. --- */
.meta.stack{display:flex;gap:46px;border-top:0;border-bottom:0;
           border-left:8px solid ${C.accent};padding:2px 0 2px 26px}
.meta.stack .cell{padding:0}
.meta.stack .cell + .cell{border-left:0;padding-left:0}
.meta.stack .lab{color:${C.accent}}
.meta.inline{border-bottom:0;padding:18px 0 4px}
.meta.inline .cell{display:inline-block}
.meta.inline .cell + .cell{border-left:0;padding-left:0}
.meta.inline .cell + .cell::before{content:"／";font-weight:700;color:${C.accent};padding:0 14px}
.meta.inline .lab{display:inline;font-weight:700;color:${C.ink}}
.meta.inline .val{display:inline;font-size:${T.metaVal}px}

.sec{margin-top:34px;flex:0 0 auto}
.sec .lab{display:flex;align-items:center;gap:14px;font:700 ${T.label}px/1 ${labelStack};
          letter-spacing:.2em;color:${C.accent}}
.sec .lab::after{content:"";flex:1;height:2px;background:${C.hairline}}
.sec.plain .lab::after{content:none}
.sec.blocklab .lab{align-self:flex-start;background:${C.accent};color:${onAccent};padding:10px 18px}
.sec.blocklab .lab::after{content:none}
.sec.underline .lab::after{height:${metaBorder}px;background:${C.ink}}
.sec p{margin-top:17px;font-size:${T.body}px;line-height:1.78;color:${C.body || '#2F2C26'}}
.sec p b{font-weight:700;color:${C.ink}}

ul.keys{list-style:none;margin-top:16px}
ul.keys li{position:relative;padding-left:32px;font-size:${T.keys}px;line-height:1.62;
            margin-bottom:13px;color:${C.body || '#2F2C26'}}
ul.keys li:last-child{margin-bottom:0}
ul.keys li::before{content:"";position:absolute;left:0;top:13px;width:13px;height:13px;
                   background:${bulletColor};border-radius:${radius > 8 ? '50%' : '0'}}
ul.keys li b{font-weight:700;color:${C.ink}}

/* --- bulletShape: square dots in a left column read as an office list. These break it up. --- */
ul.keys.dot li::before{width:12px;height:12px;border-radius:50%}
ul.keys.bar li{padding-left:36px}
ul.keys.bar li::before{width:7px;height:1.02em;top:0}
ul.keys.dash li{padding-left:40px}
ul.keys.dash li::before{width:26px;height:0;top:1.05em;background:none;
                        border-top:4px solid ${bulletColor}}
ul.keys.arrow li{padding-left:40px}
ul.keys.arrow li::before{width:0;height:0;top:.82em;background:none;border-radius:0;
                          border-left:14px solid ${bulletColor};
                          border-top:8px solid transparent;border-bottom:8px solid transparent}
ul.keys.num li{padding-left:52px}
ul.keys.num li::before{content:attr(data-i);width:auto;height:auto;top:.1em;background:none;
                       border-radius:0;font:900 .78em/1.2 ${F.serif};color:${C.accent};
                       letter-spacing:.02em}

.more{margin-top:32px;display:flex;flex-wrap:wrap;align-items:center;gap:11px;flex:0 0 auto}
.more .mlab{font:700 16px/1 ${labelStack};letter-spacing:.2em;color:${C.accent};margin-right:4px}
.more .chip{font:500 17px/1 ${labelStack};letter-spacing:.02em;color:${C.muted};
            border:2px solid ${C.hairline};padding:11px 15px;border-radius:${radius}px}

.answer{margin-top:auto;${QUOTE};${quoteRadius}flex:0 0 auto}
.answer .lab{font:700 16px/1 ${labelStack};letter-spacing:.2em;color:${quoteLabelColor}}
.answer .q{margin-top:15px;font-family:${F.serif};font-weight:700;font-size:${T.quote}px;
           line-height:1.5;color:${quoteTextColor}}

.foot{margin-top:30px;padding-top:18px;border-top:2px solid ${C.hairline};
      display:flex;justify-content:space-between;align-items:baseline;
      font:500 17px/1.4 ${labelStack};color:${C.muted};letter-spacing:.08em;flex:0 0 auto}
.foot .url{color:${C.footMuted || '#6E665B'}}

.ladder{margin-top:34px;flex:0 0 auto}
.rrow{display:grid;grid-template-columns:72px 1fr 150px;gap:22px;align-items:center;
      padding:21px 0;border-bottom:2px solid ${C.hairline}}
.rrow:first-child{border-top:${metaBorder}px solid ${C.ink}}
.rrow .n{font-family:${F.serif};font-weight:900;font-size:42px;color:${C.accent}}
.rrow .t{font-family:${F.serif};font-weight:700;font-size:31px;line-height:1.3}
.rrow .s{font:500 19px/1.4 ${labelStack};color:${C.muted};margin-top:7px}
.rrow .d{text-align:right;font-family:${F.serif};font-weight:700;font-size:22px;color:${C.footMuted || '#6E665B'}}
.rrow .d .st{display:block;color:${C.accent};font-size:19px;margin-bottom:7px;letter-spacing:.03em}
.rrow .d .st .dim{opacity:.3}
.route-note{margin-top:30px;font:500 22px/1.62 ${labelStack};color:${C.footMuted || '#6E665B'};
            letter-spacing:.02em;padding-left:18px;border-left:4px solid ${C.accent};flex:0 0 auto}
.route-note b{font-family:${F.serif};font-weight:700;color:${C.ink}}
.total{margin-top:auto;background:${C.ink};color:${onAccent};padding:30px 34px;
       border-radius:${radius}px;
       display:flex;justify-content:space-between;align-items:center;flex:0 0 auto}
.total .l{font:700 17px/1 ${labelStack};letter-spacing:.2em;color:${totalDim}}
.total .v{font-family:${F.serif};font-weight:900;font-size:46px;color:${onAccent}}
.total .v .u{font-size:24px;font-weight:700;color:${totalDim};margin-left:10px}

.qrow{display:grid;grid-template-columns:62px 1fr;gap:20px;align-items:start;
      padding:23px 0;border-bottom:2px solid ${C.hairline};flex:0 0 auto}
.qrow:first-of-type{border-top:${metaBorder}px solid ${C.ink}}
.qrow .n{font-family:${F.serif};font-weight:900;font-size:38px;color:${C.accent};line-height:1.2}
.qrow .t{font-family:${F.serif};font-weight:700;font-size:${T.qaText}px;line-height:1.52}
.qrow .t .dim{font-family:${labelStack};font-weight:500;font-size:19px;color:${C.muted};
               display:block;margin-top:9px;letter-spacing:.06em}
.endnote{margin-top:auto;font-family:${F.serif};font-weight:700;font-size:27px;
         line-height:1.6;padding-top:26px;border-top:${metaBorder + 1}px solid ${C.ink};flex:0 0 auto}
.endnote .em{color:${C.accent}}

.lead{margin-top:26px;font-size:${T.lead}px;line-height:1.76;color:${C.titleCn || '#4A443C'};
      padding-left:18px;border-left:4px solid ${C.hairline}}
.bitem{display:grid;grid-template-columns:58px 1fr;gap:20px;align-items:start;
       padding:30px 0;border-bottom:2px solid ${C.hairline};flex:0 0 auto}
.bitem:first-of-type{border-top:${metaBorder}px solid ${C.ink}}
.bitem .n{font-family:${F.serif};font-weight:900;font-size:34px;color:${C.accent};line-height:1.25}
.bitem .t{font-family:${F.serif};font-weight:700;font-size:${T.itemTitle}px;line-height:1.45}
.bitem .d{margin-top:14px;font-size:${T.itemDesc}px;line-height:1.76;color:${C.body || '#3A362F'}}
.bitem .d .k{display:block;width:max-content;font:700 15px/1 ${labelStack};letter-spacing:.16em;
             color:${C.accent};border:2px solid ${C.accent};padding:7px 11px;margin-bottom:13px;
             border-radius:${radius}px}
.toc{margin-top:${T.tocBlockGap || 52}px;border-top:2px solid ${tocRule};
     padding-top:${T.tocBlockPad || 28}px;flex:0 0 auto}
.toc .lab{font:700 16px/1 ${labelStack};letter-spacing:.22em;color:${coverDim}}
.toc ol{list-style:none;margin-top:20px}
.toc li{display:grid;grid-template-columns:${(T.tocNum || 21) + 34}px 1fr auto;align-items:baseline;
        padding:${T.tocRowPad || 13}px 0;border-bottom:1px solid ${tocRule};
        font-family:${F.serif};font-weight:700;font-size:${T.tocItem || 25}px;color:${tocText}}
.toc li:last-child{border-bottom:0}
.toc li .n{font-family:${F.serif};font-weight:900;font-size:${T.tocNum || 21}px;color:${coverEm}}
.toc li .m{font-family:${labelStack};font-weight:500;font-size:${T.tocMeta || 17}px;color:${coverDim};
           letter-spacing:.04em}

/* ---------------------------------------------------------------- poster
 * A cover's only job is to stop the scroll. The card/index layout used above is the opposite of
 * that: it hangs a table of contents and three stat blocks off the headline, so at thumbnail size
 * nothing reads as a title. Poster drops the index entirely and spends the whole frame on one
 * claim, following the rules measured against real covers: headline carries the frame, at most
 * five elements total, exactly one accent, and a textured ground instead of a flat fill.
 * Note the honest limit: the "1/3 of frame" figure comes from 1500x600 landscape art. At 3:4 the
 * content column is only ~936px wide, so 3-4 CJK glyphs per line caps a legible glyph height near
 * 230px. Vertical covers get their punch from column count and contrast, not raw size alone.
 */
.card.poster{padding:0;background:${posterBgGradient ? `linear-gradient(${posterBgGradient})` : posterBg}}
.poster .wrap{position:relative;z-index:2;height:100%;display:flex;flex-direction:column;
              padding:${T.posterPadY || 80}px ${T.posterPadX || 72}px ${T.posterPadB || 66}px}
.poster .tex{position:absolute;inset:0;z-index:1;${posterTexture}}
.poster .kicker{font:700 ${T.posterKicker || 22}px/1 ${labelStack};letter-spacing:.22em;
                color:${posterInkMuted}}
.poster .seal{position:absolute;right:${T.posterPadX || 72}px;top:${T.posterPadY || 80}px;
              width:118px;height:118px;background:${posterSealBg};
              color:${posterSealInk};transform:rotate(-6deg);flex:0 0 auto}
/* Absolute children, not a flex column: the flex version measured as zero-height in headless
   Chrome and the numeral silently vanished while the caption below it survived. */
.poster .seal .sn{position:absolute;left:0;right:0;top:${Math.round(posterSealNumSize * 0.46)}px;text-align:center;
                  font-family:${F.serif};font-weight:900;font-size:${posterSealNumSize}px;line-height:1;
                  color:${posterSealInk}}
.poster .seal .sl{position:absolute;left:0;right:0;bottom:22px;text-align:center;
                  font:700 17px/1 ${labelStack};letter-spacing:.14em;color:${posterSealInk}}
/* CJK glyphs fill nearly the whole em box, so a landscape-derived 1.04 line-height reads as
   three rows fused into one block. 1.16 buys the breathing room the type needs to stay legible
   as separate lines. */
.poster .title{font-family:${posterTitleFamily};font-weight:${posterTitleWeight};
               font-size:${T.posterTitle || 210}px;
               line-height:1.16;letter-spacing:${posterTitleLS};color:${posterInk};margin-top:auto}
/* flow-top drops the headline right under the eyebrow and lets the tag strip sink to the floor,
   which turns the middle of the frame into deliberate empty space — the minimal-poster look. */
.poster.flow-top .title{margin-top:${T.posterTitleTop || 130}px}
.poster .title .hi{color:${C.accent}}
.poster .title .blk{display:inline-block;background:${posterBlkBg};color:${posterBlkInk};
                    padding:.02em .1em;margin:0 -.02em}
.poster .rule{width:${posterRuleW || 220}px;height:${posterRuleH || 12}px;
              background:${posterRuleColor};opacity:${posterRuleOpacity};margin-top:44px;flex:0 0 auto}
/* A dashed rule reads as ruled-not-drawn; a wavy one reads as a marker stroke. Both are the same
 * element with a different paint, so they stay tokens instead of new blocks. */
.poster.rule-dashed .rule{background:none;height:0;border-top:${Math.max(3, Math.round((posterRuleH || 12) * 0.42))}px dashed ${posterRuleColor}}
.poster.rule-wavy .rule{background:none;height:${posterRuleH || 12}px;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='12' viewBox='0 0 240 12'><path d='M0 7 Q30 1 60 7 T120 7 T180 7 T240 7' fill='none' stroke='${svgColor}' stroke-width='5' stroke-linecap='round'/></svg>");
  background-size:120px 12px;background-repeat:repeat-x;background-position:left center;opacity:.9}
.poster .sub{font-family:${posterSubFamily};font-weight:500;font-size:${T.posterSub || 34}px;
             line-height:1.55;color:${posterInkMuted};margin-top:38px;max-width:820px;flex:0 0 auto}
.poster .tags{margin-top:auto;padding-top:34px;border-top:${posterRuleH || 12}px solid ${posterInk};
              display:flex;flex-wrap:wrap;gap:14px 30px;flex:0 0 auto}
.poster .tags span{font:600 ${T.posterTag || 22}px/1 ${labelStack};letter-spacing:.06em;
                   color:${posterInkMuted}}
.poster .tags span b{color:${posterTagInk};font-weight:800}

/* Type treatments that separate a headline from its ground without adding a second colour.
   text-shadow with a zero blur radius is the only one that survives multi-line headlines:
   pseudo-element layers would need one per line, and -webkit-text-stroke cannot be offset. */
.poster .title.e-lift{text-shadow:.042em .05em 0 ${C.accent}}
.poster .title.e-outline{color:transparent;-webkit-text-stroke:${posterOutlineW}px ${posterOutlineColor}}
.poster .title.e-outline .hi{-webkit-text-stroke:${posterOutlineW}px ${C.accent};color:transparent}
/* A solid block inside an outlined headline keeps its own fill — the stroke would otherwise cut
 * holes through the block's lettering. */
.poster .title.e-outline .blk{-webkit-text-stroke:0}
.poster .title.e-shadow{text-shadow:${posterShadowOffset} ${posterShadowOffset} 0 ${posterShadowColor}}
/* A solid block inside a shadowed headline keeps its own face — the offset copy would otherwise
 * read as a second, misregistered block. */
.poster .title.e-shadow .blk{text-shadow:none}
/* A hand-placed headline: a degree of tilt is what separates "typed" from "put down by hand". */
.poster .title.tilt{transform:rotate(${posterTitleRotate}deg);transform-origin:left center}
/* 3-D block: a stack of hard offsets of the same glyph, no blur anywhere. */
.poster .title.e-extrude{text-shadow:${extrudeShadow}}
/* Neon tube: the halo carries the light, the fill stays put. */
.poster .title.e-neon{text-shadow:0 0 .05em ${posterNeonA},0 0 .12em ${posterNeonA},
                      0 0 .28em ${posterNeonB},0 0 .5em ${posterNeonB}}
/* Cinematic glow: one soft halo in the accent, no second colour. */
.poster .title.e-glow{text-shadow:0 0 .10em ${posterGlowColor},0 0 .30em ${posterGlowColor}}
/* Halo: air around the letters, in the colour of the ground, for headlines on a busy ground. */
.poster .title.e-halo{text-shadow:0 0 .05em ${posterHaloColor},0 0 .12em ${posterHaloColor},
                      0 0 .24em ${posterHaloColor}}

/* Chip-style tag pills for the "four badges" layouts. */
.poster.tags-chip .tags{gap:12px}
.poster.tags-chip .tags span{border:2px solid ${posterInkMuted};border-radius:999px;padding:10px 20px}

/* Bottom timeline of hollow wireframe numerals — the step sequence reads as rhythm, not as a
   numbered list, and hollow numbers keep it from competing with the headline. */
.poster .steps{margin-top:42px;padding-top:28px;position:relative;display:flex;gap:40px;flex:0 0 auto}
.poster .steps::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;
                       background:${posterInk};opacity:.45}
.poster .sstep{flex:1 1 0}
.poster .sn{font-family:${F.serif};font-weight:900;font-size:58px;line-height:1;letter-spacing:.02em;
            color:transparent;-webkit-text-stroke:2.4px ${posterInk}}
.poster .st{font:600 25px/1.4 ${F.sans};color:${posterInkMuted};margin-top:14px}

/* "flow" turns the strip into a lit pipeline: the connector runs through the middle of the
 * numerals instead of sitting above them, and each node carries its own halo. */
.poster.steps-flow .steps{padding-top:0}
.poster.steps-flow .steps::before{top:29px;height:4px;opacity:1;
  background:linear-gradient(90deg,transparent,${posterInk} 10%,${posterInk} 90%,transparent);
  box-shadow:0 0 18px ${posterGlowColor}}
.poster.steps-flow .sn{color:${C.accent};-webkit-text-stroke:0;
  text-shadow:0 0 18px ${C.accent};position:relative;z-index:1}
.poster.steps-flow .st{margin-top:12px}

/* Sample matrix: a wall of small framed works, each tilted a degree off square. The tilt is what
 * stops it reading as a table — a straight grid of equal cells is exactly the PPT tell that got
 * styles 02-05 thrown out. */
.poster .grid{margin-top:38px;display:grid;grid-template-columns:repeat(${posterGridCols},1fr);
  gap:${posterGridGap}px;flex:0 0 auto;perspective:1000px}
.poster .gcell{position:relative;aspect-ratio:4/5;background:${posterGridBg};
  border:4px solid ${posterGridFrame};box-shadow:0 12px 28px rgba(0,0,0,.24);
  display:flex;align-items:center;justify-content:center;overflow:hidden}
.poster .gcell::after{content:"";position:absolute;inset:0;
  background:linear-gradient(140deg,rgba(255,255,255,.34),transparent 58%)}
.poster .gcell span{position:relative;z-index:1;font:800 25px/1.25 ${labelStack};
  letter-spacing:.05em;color:${posterGridInk};text-align:center;padding:0 12px}

/* Illustration band across the top; the headline block drops below it. The band is a hard crop
   rather than a framed picture because a cover reads at thumbnail size — a boxed image competes
   with the type, while a full-bleed band just reads as colour and shape. */
.poster.hasart .wrap{padding-top:0}
.poster .artbox{position:absolute;left:0;right:0;top:0;height:${posterArtH}px;z-index:2;overflow:hidden;${artFadeCss}}
.poster .artbox img{width:100%;height:100%;object-fit:cover;display:block;
                    object-position:${posterArtPosition};${artFilterCss}}
.poster.hasart .kicker{margin-top:${posterArtH + 44}px}
.poster.hasart .seal{top:${posterArtH + 36}px}
`;

/* ---------------------------------------------------------------- blocks */

const topbar = (kicker, folio) =>
  `<div class="topbar"><span class="kicker">${esc(kicker)}</span>` +
  `<span class="folio">${esc(folio)}</span></div><div class="rule"></div>`;

const footer = (left, right) =>
  `<div class="foot"><span>${esc(left)}</span><span class="url">${esc(right)}</span></div>`;

const BLOCKS = {
  cover(card) {
    const toc = (card.toc || [])
      .map(([n, t, m]) =>
        `<li><span class="n">${esc(n)}</span><span>${esc(t)}</span><span class="m">${esc(m)}</span></li>`)
      .join('');
    const stats = (card.stats || [])
      .map(([lab, val]) =>
        `<div class="stat"><div class="lab">${esc(lab)}</div><div class="val">${val}</div></div>`)
      .join('');
    const hint = (card.hint || []).map((h) => `<span>${esc(h)}</span>`).join('');
    // Emit these only when there is content. An empty <div class="stats"> still paints a
    // border and padding, so leaving it in place silently eats vertical budget instead of
    // freeing it — which matters when the caller is trimming content to fit the canvas.
    const statsHtml = stats ? `<div class="stats">${stats}</div>` : '';
    const hintHtml = hint ? `<div class="hint">${hint}</div>` : '';
    // The oversized ghost numeral sits behind the headline. When the headline is a solid colour
    // slab it covers the numeral instead of layering with it, so drop it in that combination.
    const ghostHtml = titleBlock ? '' : `<div class="ghost">${esc(card.ghost || '')}</div>`;
    // Escape first, then re-enable only <br>. CJK subtitles wrap wherever the box ends, which
    // routinely strands one or two characters on the last line ("...学习路" / "径。"). Copy is
    // allowed explicit line breaks but no other inline markup, so this is the single exception.
    const subtitle = esc(card.subtitle).replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    return (
      `${ghostHtml}<div class="body">` +
      `<div class="title${titleBlock ? ' tblock' : ''}">${(card.title || []).join('<br>')}</div>` +
      `<div class="subtitle">${subtitle}</div>` +
      `<div class="vrule"></div>` +
      (toc ? `<div class="toc"><div class="lab">CONTENTS</div><ol>${toc}</ol></div>` : '') +
      statsHtml + hintHtml + `</div>`
    );
  },

  /* Poster: eyebrow -> giant headline (one accent, at most) -> rule -> subtitle -> tag strip.
   * Five elements total, which is the ceiling measured on real covers. `title` is one array
   * entry per line and accepts inline HTML, so <span class="hi"> and <span class="blk"> can mark
   * the single accent without inventing a second colour. */
  poster(card) {
    const lines = (card.title || []).join('<br>');
    const seal = card.seal
      ? `<div class="seal"><div class="sn">${esc(card.seal[0])}</div>` +
        `<div class="sl">${esc(card.seal[1] || '')}</div></div>`
      : '';
    const tags = (card.tags || []).length
      ? `<div class="tags">${card.tags.map((t) => `<span>${t}</span>`).join('')}</div>`
      : '';
    const sub = card.sub ? `<div class="sub">${esc(card.sub)}</div>` : '';
    const steps = (card.steps || []).length
      ? `<div class="steps">${card.steps.map(([n, t]) =>
          `<div class="sstep"><div class="sn">${esc(n)}</div><div class="st">${esc(t)}</div></div>`
        ).join('')}</div>`
      : '';
    const grid = (card.grid || []).length
      ? `<div class="grid">${card.grid.map((t, i) => {
          const tilt = posterGridTilt ? (i % 2 ? posterGridTilt : -posterGridTilt) : 0;
          const tint = Array.isArray(posterGridTints) && posterGridTints.length
            ? posterGridTints[i % posterGridTints.length] : null;
          return `<div class="gcell" style="transform:rotate(${tilt}deg)` +
            `${tint ? `;background:${tint}` : ''}"><span>${esc(t)}</span></div>`;
        }).join('')}</div>`
      : '';
    const titleCls = `title${titleEffect ? ' e-' + titleEffect : ''}` +
      `${posterTitleRotate ? ' tilt' : ''}`;
    return (
      `<div class="tex"></div><div class="wrap">` +
      (card.kicker ? `<div class="kicker">${esc(card.kicker)}</div>` : '') +
      seal +
      `<div class="${titleCls}">${lines}</div>` +
      (card.rule === false ? '' : `<div class="rule"></div>`) +
      sub + grid + steps + tags + `</div>`
    );
  },

  ladder(card) {
    const rows = (card.rows || [])
      .map((r) =>
        `<div class="rrow"><div class="n">${esc(r.n)}</div>` +
        `<div><div class="t">${esc(r.title)}</div><div class="s">${esc(r.sub)}</div></div>` +
        `<div class="d">${stars(r.stars)}<span>${esc(r.right)}</span></div></div>`)
      .join('');
    const total = card.total
      ? `<div class="total"><div class="l">${esc(card.total.label)}</div>` +
        `<div class="v">${esc(card.total.value)}<span class="u">${esc(card.total.unit)}</span></div></div>`
      : '';
    return (
      `<div class="body"><div class="title">${(card.title || []).join('<br>')}</div>` +
      `<div class="ladder">${rows}</div>` +
      (card.note ? `<div class="route-note">${card.note}</div>` : '') +
      total + `</div>` + footer(card.footerL, card.footerR)
    );
  },

  resource(card) {
    const meta = (card.meta || [])
      .map((m) =>
        `<div class="cell"><div class="lab">${esc(m[0])}</div>` +
        `<div class="val">${m[2] ? stars(m[2]) : esc(m[1])}</div></div>`)
      .join('');
    const keys = (card.keys || [])
      .map((k, i) => `<li data-i="${String(i + 1).padStart(2, '0')}">${k}</li>`)
      .join('');
    const more = (card.more || []).length
      ? `<div class="more"><span class="mlab">${esc(card.moreLabel || '延伸阅读')}</span>` +
        card.more.map((c) => `<span class="chip">${esc(c)}</span>`).join('') + `</div>`
      : '';
    const secCls = secLabel === 'plain' ? 'sec plain' : secLabel === 'block' ? 'sec blocklab'
      : secLabel === 'underline' ? 'sec underline' : 'sec';
    return (
      `<div class="body">` +
      `<div class="title${titleBlock ? ' tblock' : ''}">${card.title}</div>` +
      (card.titleCn ? `<div class="title-cn">${esc(card.titleCn)}</div>` : '') +
      (card.src ? `<div class="src">${esc(card.src)}</div>` : '') +
      `<div class="meta ${metaLayout}">${meta}</div>` +
      `<div class="${secCls}"><div class="lab">${esc(card.whyLabel || '为什么选它')}</div><p>${card.why || ''}</p></div>` +
      `<div class="${secCls}"><div class="lab">${esc(card.keysLabel || '重点读')}</div>` +
      `<ul class="keys ${bulletShape}">${keys}</ul></div>` +
      more +
      (card.ans
        ? `<div class="answer"><div class="lab">${esc(card.ansLabel || '读完应能回答')}</div>` +
          `<div class="q">${esc(card.ans)}</div></div>`
        : '') +
      `</div>` + footer(card.footerL, card.footerR)
    );
  },

  items(card) {
    const items = (card.items || [])
      .map((it) =>
        `<div class="bitem"><div class="n">${esc(it.n)}</div><div>` +
        `<div class="t">${esc(it.title)}</div>` +
        `<div class="d">${it.tag ? `<span class="k">${esc(it.tag)}</span>` : ''}${esc(it.desc)}</div>` +
        `</div></div>`)
      .join('');
    return (
      `<div class="body"><div class="title">${(card.title || []).join('<br>')}</div>` +
      (card.titleCn ? `<div class="title-cn">${esc(card.titleCn)}</div>` : '') +
      (card.lead ? `<div class="lead">${esc(card.lead)}</div>` : '') +
      items +
      (card.endnote ? `<div class="endnote">${card.endnote}</div>` : '') +
      `</div>` + footer(card.footerL, card.footerR)
    );
  },

  qa(card) {
    const rows = (card.rows || [])
      .map((r) =>
        `<div class="qrow"><div class="n">${esc(r.n)}</div><div class="t">${esc(r.text)}` +
        (r.dim ? `<span class="dim">${esc(r.dim)}</span>` : '') + `</div></div>`)
      .join('');
    return (
      `<div class="body"><div class="title">${(card.title || []).join('<br>')}</div>` +
      rows +
      (card.endnote ? `<div class="endnote">${card.endnote}</div>` : '') +
      `</div>` + footer(card.footerL, card.footerR)
    );
  },
};

/* ---------------------------------------------------------------- render */

/* A spec that names an illustration but points at a file that is not there is a config error, not
 * a style choice. Returning '' quietly yields a card with an empty image slot and still exits 0,
 * which is worse than failing: the PNG looks finished and gets shipped. Record the miss here so
 * main() can delete the card — "art is missing" must never masquerade as "rendered".
 *
 * art is optional, so only an explicit `art` that resolves to nothing lands in this set. */
const missingArt = new Set();

function resolveArt(card, baseDir) {
  if (!card.art) return null;
  const p = path.isAbsolute(card.art) ? card.art : path.resolve(baseDir, card.art);
  if (!fs.existsSync(p)) missingArt.add(p);
  return p;
}

function artTag(card, baseDir) {
  const p = resolveArt(card, baseDir);
  if (!p) return '';
  const h = card.artHeight || 460;
  return `<img class="art" style="height:${h}px" src="${pathToFileURL(p).href}">`;
}

/* Poster variant: a full-bleed band across the top, sized by variants.posterArtH rather than by
   an inline pixel height. A cover is read at thumbnail size, so the art has to bleed — a framed
   picture competes with the headline for attention instead of just adding colour and shape. */
function posterArtTag(card, baseDir) {
  const p = resolveArt(card, baseDir);
  if (!p) return '';
  return `<div class="artbox"><img src="${pathToFileURL(p).href}"></div>`;
}

function renderCard(card, index, total, baseDir, injectProbe) {
  const build = BLOCKS[card.block];
  if (!build) throw new Error(`unknown block type: ${card.block}`);
  const isCover = card.block === 'cover';
  // A poster supplies its own eyebrow line and deliberately has no rule under the kicker, so it
  // opts out of the standard topbar instead of inheriting one it would never fill.
  const isPoster = card.block === 'poster';
  const art = isPoster ? posterArtTag(card, baseDir) : artTag(card, baseDir);
  const body =
    (isPoster ? '' : topbar(card.kicker || '', card.folio || `${index} / ${total}`)) +
    art +
    build(card);
  // Drive .hasart off the rendered <img>, not off `card.art`. When the file is missing the band is
  // absent, so the hasart offsets (.poster.hasart .kicker / .seal) would still reserve
  // posterArtH px above the headline — a cover with a hole where the illustration should be.
  const cls = `card${isCover ? ' cover' : ''}${isPoster ? ' poster' : ''}` +
    `${isPoster && posterFlow === 'top' ? ' flow-top' : ''}` +
    `${isPoster && posterTagStyle === 'chip' ? ' tags-chip' : ''}` +
    `${isPoster && posterStepsStyle === 'flow' ? ' steps-flow' : ''}` +
    `${isPoster && posterRuleStyle === 'dashed' ? ' rule-dashed' : ''}` +
    `${isPoster && posterRuleStyle === 'wavy' ? ' rule-wavy' : ''}` +
    `${art ? ' hasart' : ''}`;
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>` +
    `<body><div class="${cls}" data-name="${esc(card.name || '')}">${body}</div>` +
    (injectProbe || '') +
    `</body></html>`
  );
}

/* Overflow probe.
 * .card is overflow:hidden, so content that runs past the canvas is silently clipped and the
 * PNG still renders "successfully" with exit code 0. A caller who trusts that signal ships a
 * card with its last row cut off. This measures the real content height in the browser and
 * reports it, so "4/4 rendered" can never quietly mean "4/4 truncated".
 */
const OVERFLOW_PROBE = `<script>
window.addEventListener('load', function () {
  var out = [];
  document.querySelectorAll('.card').forEach(function (el) {
    var card = Math.max(0, el.scrollHeight - el.clientHeight);
    var body = el.querySelector('.body');
    var inner = body ? Math.max(0, body.scrollHeight - body.clientHeight) : 0;
    out.push((el.dataset.name || 'card') + '=' + Math.max(card, inner));
  });
  var m = document.createElement('meta');
  m.name = 'overflow-report';
  m.content = out.join('|');
  document.head.appendChild(m);
});
<\/script>`;

function measureOverflow(bin, htmlPath, width, height) {
  const r = spawnSync(
    bin,
    [
      '--headless=new', '--disable-gpu', '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${width},${height}`,
      '--virtual-time-budget=4000',
      '--dump-dom',
      pathToFileURL(htmlPath).href,
    ],
    { encoding: 'utf8', timeout: 90000 }
  );
  const m = /name="overflow-report" content="([^"]*)"/.exec(String(r.stdout || ''));
  if (!m || !m[1]) return null;
  const out = {};
  if (process.env.KC_DEBUG) console.error('KC_DEBUG ' + m[1]);
  m[1].split('|').forEach((pair) => {
    const [name, val] = pair.split('=');
    out[name] = Number(val);
  });
  return out;
}

function main() {
  const bin = chromePath();
  if (!bin) {
    console.error(
      'No headless Chrome/Edge found. Set CHROME_PATH to the executable, e.g.\n' +
      '  $env:CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"'
    );
    process.exit(3);
  }

  const htmlDir = path.join(path.dirname(path.resolve(SPEC)), 'html');
  fs.mkdirSync(htmlDir, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  const cards = spec.cards || [];
  const total = cards.length;
  const specDir = path.dirname(path.resolve(SPEC));
  let ok = 0;
  const overflowed = [];
  const noArt = [];

  cards.forEach((card, i) => {
    const stem = card.name || `${String(i + 1).padStart(2, '0')}-${card.block}`;
    const htmlPath = path.join(htmlDir, stem + '.html');
    const pngPath = path.join(OUT, stem + '.png');

    // renderCard is what resolves `art`, so snapshot the set around it to learn whether THIS card
    // is the one that lost its illustration.
    const artSeen = missingArt.size;
    fs.writeFileSync(htmlPath, renderCard(card, i + 1, total, specDir), 'utf8');
    const artMissing = missingArt.size > artSeen;

    if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);

    const r = spawnSync(
      bin,
      [
        '--headless=new', '--disable-gpu', '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--window-size=${W},${H}`,
        '--virtual-time-budget=4000',
        `--screenshot=${pngPath}`,
        pathToFileURL(htmlPath).href,
      ],
      { encoding: 'utf8', timeout: 90000 }
    );

    const drew = fs.existsSync(pngPath) && fs.statSync(pngPath).size > 0;

    // Delete a card that lost its illustration. Keeping it would leave a plausible-looking file in
    // the output directory, and the whole failure mode being fixed is someone shipping that file.
    if (drew && artMissing) {
      fs.unlinkSync(pngPath);
      noArt.push(stem);
    }

    const good = drew && !artMissing;
    if (good) ok++;
    const size = good ? fs.statSync(pngPath).size : 0;

    // Measure real content height — .card clips silently, so the PNG alone proves nothing.
    // scrollHeight/clientHeight round to integers while the real layout carries sub-pixels
    // (letter-spacing, 1.6 line-heights), so a cover whose last element bottom lands exactly on
    // the content box still reads 3-5px over. Measured on a fitting cover: last child bottom =
    // 1374 = 1440 - 66px padding, i.e. nothing clipped, yet the probe reported 4px. Real overflows
    // are an order of magnitude larger (measured 51px / 98px / 355px), so a small band is noise.
    const OVERFLOW_TOLERANCE = 8;
    let over = 0;
    const probePath = htmlPath.replace(/\.html$/, '.probe.html');
    try {
      fs.writeFileSync(probePath, renderCard(card, i + 1, total, specDir, OVERFLOW_PROBE), 'utf8');
      const res = measureOverflow(bin, probePath, W, H);
      if (res && typeof res[stem] === 'number' && res[stem] > OVERFLOW_TOLERANCE) over = res[stem];
    } finally {
      if (fs.existsSync(probePath)) fs.unlinkSync(probePath);
    }

    if (over > 0) overflowed.push({ stem, over });
    const flag = artMissing ? '  ⚠ ART MISSING — png deleted' : over > 0 ? `  ⚠ OVERFLOW ${over}px` : '';
    console.log(`${good ? 'OK  ' : 'FAIL'} ${stem.padEnd(20)} ${String(size).padStart(9)} bytes${flag}`);
    if (!good && r.stderr) console.error(String(r.stderr).slice(0, 400));
  });

  console.log(`\n${ok}/${total} rendered at ${W}x${H} -> ${OUT}`);

  if (noArt.length) {
    console.log(`\n⚠ ${noArt.length} card(s) name an illustration that does not exist. Their PNGs were DELETED:`);
    noArt.forEach((s) => console.log(`   ${s}`));
    missingArt.forEach((p) => console.log(`   missing file: ${p}`));
    console.log(
      '  The spec asked for art, so a cover without it is not a deliverable.\n' +
      '  Fix the `art` path in the spec, or drop the `art` field to publish a text-only poster.'
    );
    process.exit(1);
  }

  if (overflowed.length) {
    console.log(`\n⚠ ${overflowed.length}/${total} cards overflow the canvas and ARE CLIPPED:`);
    overflowed.forEach((c) => console.log(`   ${c.stem}  +${c.over}px`));
    console.log(
      '  PNGs were still written, but the bottom of each listed card is cut off.\n' +
      '  Fix by, in order: drop `more` chips -> shorten `why` -> lower artHeight ->\n' +
      '  reduce type.body / type.keys. Do NOT shrink the title.'
    );
    process.exit(1);
  }
}

main();