/* Comic slash scene transition, part of Invincible - Plus Ultra. Started from scripts/module.js by a guarded dynamic import (start() below), the
   same way as the party cards and the combat banners: nothing here needs a module.json change, so no server restart.

   ROUTE. Foundry v14 ships a registry of scene transitions, CONFIG.Canvas.sceneTransitions: each entry names a filterClass (a PIXI filter that
   receives the captured OLD frame as its input and the captured NEW frame as `targetTexture`) and a filterType. Core captures both frames on every
   client when the GM views or activates a scene, runs the filter's `progress` uniform 0 -> 1 over the scene's own transition duration, and falls
   back to "no transition" if anything throws. So this module only registers four more entries (from the top, from the bottom, from the right,
   random side) backed by a TextureTransitionFilter subclass with its own fragment shader. They appear in Scene configuration > Transition next to
   the built-ins (with duration, "active only" and the Play preview button) and play on every client. No overlay, no DOM, no stylesheet.

   THE LOOK (one authored moment, all in the shader, 0 -> 1):
     0.04-0.40  panel A, a piece of the NEW scene cut by a slanted edge, slams in from the first side (expo ease-out, the image inside lags a
                little behind its frame) with ink speed streaks; the OLD scene stays visible beside it, dimmed and shaded with halftone dots
     0.40-0.50  hold on the impact (small camera shake, a white flash)
     0.50-0.84  panel B, the other piece of the NEW scene, slams in from the opposite side along the parallel slant; the old scene is squeezed
                into a diagonal sliver between two white gutters and black ink borders, until the two edges meet
     0.84-1.00  the seam flashes, shakes, then the ink and gutter fade; at 1.0 the pixels are exactly the new scene.
   Reduced motion (OS setting) or the client setting "plain fade only": a quick plain fade, no travel, no shake.

   SAFETY. Core wraps a failing transition and continues without it. On top of that the filter has a watchdog: it never keeps the overlay for
   more than WATCHDOG_MS (it jumps to the final frame, then ends the transition), whatever duration the scene asks for.
   World setting "Comic slash: default scene transition" (GM): a scene whose own transition is None uses it (set in memory on canvasInit only).
   Test hook: game.modules.get("invincible-plus-ultra").api.slash.preview("top" | "bottom" | "right" | "random", { progress, duration }). */
import { t } from "./lang.mjs";

const MOD = "invincible-plus-ultra";
const LOG = `${MOD} (slash) |`;
export const KEY = { dflt: "slashDefault", calm: "slashCalm" };
const WATCHDOG_MS = 2500;
const DURATION = 1100;
const SIDES = ["Top", "Bottom", "Right", "Random"];
const STYLES = { slash: 1100, zip: 800, triple: 1200 };   // default durations (ms)
const IDS = { top: "slashTop", bottom: "slashBottom", right: "slashRight", random: "slashRandom" };   // slash sides (the original API names)
const LABELS = {};   // id -> label key
const VARIANT = {};  // id -> 0 top, 1 bottom, 2 right (Random is picked per transition)
const PICK = { ...IDS };   // setting value / preview name -> id
for (const st of Object.keys(STYLES)) for (const [i, side] of SIDES.entries()) {
  const id = st + side;
  LABELS[id] = st === "slash" ? `IPS.Type.${side}` : `IPS.Type.${st[0].toUpperCase() + st.slice(1)}.${side}`;
  if (i < 3) VARIANT[id] = i;
  if (st !== "slash") PICK[id] = id;
}
PICK.zip = "zipRandom"; PICK.triple = "tripleRandom";
const styleOf = (id) => (id.startsWith("zip") ? 1 : id.startsWith("triple") ? 2 : 0);
const msOf = (id) => STYLES[id.replace(/(Top|Bottom|Right|Random)$/, "")] ?? DURATION;

let started = false, previewMode = false, frozenTimer = 0, restoreScene = null;
const hookIds = [];
const get = (key) => { try { return game.settings.get(MOD, key); } catch { return undefined; } };
const on = (name, fn) => hookIds.push([name, Hooks.on(name, fn)]);
const reduced = () => { try { return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

/* ---------- the shader ---------- */
function fragment(filters) {
  return `
    precision ${PIXI.Program.defaultFragmentPrecision} float;
    uniform float progress;
    uniform float style;     /* 0 slash, 1 zip, 2 triple cut */
    uniform float variant;   /* 0 top, 1 bottom, 2 right */
    uniform float aspect;
    uniform float calm;      /* 1: plain quick fade */
    uniform vec4 sceneRect;  /* the NEW scene's rectangle in screen uv (x0, y0, x1, y1) */
    uniform vec3 bgColor;    /* what the live canvas shows outside the scene */
    uniform float preview;   /* 1: tint the old frame so the effect shows over the same scene */
    uniform sampler2D uSampler;
    uniform sampler2D targetTexture;
    uniform vec4 tintAlpha;
    uniform mat3 filterMatrixInverse;
    uniform mat3 targetUVMatrix;
    uniform float opaque;
    uniform vec4 backgroundColor;
    varying vec2 vTextureCoord;
    varying vec2 vFilterCoord;

    const vec3 INK = vec3(0.035, 0.045, 0.085);
    const vec3 PAPER = vec3(0.985, 0.975, 0.94);
    const float SLANT = 0.42;
    const float PAD = 0.03;
    const float AA = 0.0016;

    vec2 mapFuv2Suv(in vec2 uv) { return (filterMatrixInverse * vec3(uv, 1.0)).xy; }
    vec2 mapFuv2Tuv(in vec2 uv) { return (targetUVMatrix * vec3(uv, 1.0)).xy; }
    vec4 oldFrame(in vec2 uv) { return texture2D(uSampler, clamp(mapFuv2Suv(clamp(uv, 0.0, 1.0)), 0.0, 1.0)); }
    /* Core captures the new frame over black, but the live canvas shows the scene background colour outside the scene rectangle: undrawn
       (pure black) pixels there take that colour, so tiles and tokens that sit in the padding do not flash from black to grey at the end. */
    vec4 newFrame(in vec2 uv) {
      uv = clamp(uv, 0.0, 1.0);
      vec4 c = texture2D(targetTexture, mapFuv2Tuv(uv));
      float outside = 1.0 - step(sceneRect.x, uv.x) * step(uv.x, sceneRect.z) * step(sceneRect.y, uv.y) * step(uv.y, sceneRect.w);
      float undrawn = 1.0 - step(0.02, max(c.r, max(c.g, c.b)));
      c.rgb = mix(c.rgb, bgColor, outside * undrawn);
      return c;
    }
    float hash(in float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
    float easeOut(in float x) { x = clamp(x, 0.0, 1.0); return (1.0 - pow(2.0, -10.0 * x)) / (1.0 - pow(2.0, -10.0)); }
    float edge(in float d, in float w) { return smoothstep(-AA, AA, d) * (1.0 - smoothstep(w - AA, w + AA, d)); }   /* band 0..w */

    vec4 slash() {
      float P = progress;
      vec2 uv0 = vFilterCoord;

      /* camera shake after each impact */
      float hitA = step(0.40, P) * exp(-(P - 0.40) * 38.0);
      float hitB = step(0.84, P) * exp(-(P - 0.84) * 30.0);
      float shake = (hitA * 0.7 + hitB) * 0.0075;
      vec2 uv = uv0 + vec2(sin(P * 210.0), cos(P * 260.0)) * shake;

      float eA = easeOut((P - 0.04) / 0.36);
      float eB = easeOut((P - 0.50) / 0.34);
      float ink = 1.0 - smoothstep(0.90, 1.0, P);

      /* frame of the slash: s runs from the first side to the opposite side, c across */
      vec2 q = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
      float s, c, L, W;
      vec2 sdir;
      if (variant < 0.5) { s = q.y + 0.5; c = q.x; L = 1.0; W = aspect; sdir = vec2(0.0, 1.0); }
      else if (variant < 1.5) { s = 0.5 - q.y; c = q.x; L = 1.0; W = aspect; sdir = vec2(0.0, -1.0); }
      else { s = aspect * 0.5 - q.x; c = q.y; L = aspect; W = 1.0; sdir = vec2(-1.0, 0.0); }

      float rough = (hash(floor(c * 90.0) + variant * 13.0) - 0.5) * 0.0045;
      float start = -(SLANT * W * 0.5 + PAD);
      float e1 = mix(start, L * 0.46, eA);
      float e2 = mix(start, L * 0.54, eB);
      float d1 = (e1 + SLANT * c + rough) - s;           /* > 0 inside panel A */
      float d2 = s - (L - e2 + SLANT * c + rough);       /* > 0 inside panel B */

      /* the old scene: dimmed, shaded with halftone dots toward the panel edges */
      vec4 o = oldFrame(uv);
      if (preview > 0.5) o.rgb = o.bgr * 0.55;
      o.rgb *= 0.7;
      float near = min(-d1, -d2);
      float shade = (1.0 - smoothstep(0.0, 0.26, near)) * 0.85 + 0.12;
      vec2 r = mat2(0.7071, -0.7071, 0.7071, 0.7071) * q;
      float cell = 0.021;
      float dotD = length(fract(r / cell) - 0.5);
      float rad = sqrt(shade) * 0.58;
      float dotM = 1.0 - smoothstep(rad - 0.07, rad + 0.07, dotD);
      o.rgb = mix(o.rgb, INK, dotM * 0.82);
      vec3 col = o.rgb;

      /* white gutters outside both panels */
      float gw = 0.024 * ink;
      col = mix(col, PAPER, edge(-d1, gw) * ink);
      col = mix(col, PAPER, edge(-d2, gw) * ink);

      /* panel A: the new scene lagging behind its frame, ink speed streaks, ink border */
      float lagA = (1.0 - eA) * 0.03;
      vec3 pa = newFrame(uv + sdir * lagA).rgb;
      float lane = floor(c * 46.0);
      float lf = fract(c * 46.0);
      float present = step(0.42, hash(lane + variant * 7.0));
      float lw = 0.05 + 0.13 * hash(lane * 3.1);
      float lineM = (1.0 - smoothstep(lw * 0.5 - 0.03, lw * 0.5 + 0.03, abs(lf - 0.5))) * present;
      float len = 0.10 + 0.55 * hash(lane * 1.7);
      float trailA = 1.0 - smoothstep(0.0, len, d1);
      float ampA = smoothstep(0.04, 0.09, P) * (1.0 - smoothstep(0.14, 0.38, P));
      vec3 lineCol = mix(INK, PAPER, step(0.5, hash(lane * 5.3)));
      pa = mix(pa, lineCol, lineM * trailA * ampA * 0.9);
      float bw = 0.018 * ink * (0.8 + 0.4 * hash(floor(c * 60.0) + 3.0));
      pa = mix(pa, INK, edge(d1, bw) * ink);
      col = mix(col, pa, smoothstep(-AA, AA, d1));

      /* panel B */
      float lagB = (1.0 - eB) * 0.03;
      vec3 pb = newFrame(uv - sdir * lagB).rgb;
      float trailB = 1.0 - smoothstep(0.0, len, d2);
      float ampB = smoothstep(0.50, 0.55, P) * (1.0 - smoothstep(0.58, 0.82, P));
      pb = mix(pb, lineCol, lineM * trailB * ampB * 0.9);
      pb = mix(pb, INK, edge(d2, bw) * ink);
      col = mix(col, pb, smoothstep(-AA, AA, d2));

      /* impact flashes */
      col += (hitA * 0.10 + hitB * 0.34) * (1.0 - col);
      return vec4(col, 1.0);
    }


    /* shared pieces for the two extra styles */
    void frame(in vec2 uv, out vec2 q, out float s, out float c, out float L, out float W, out vec2 sdir) {
      q = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
      if (variant < 0.5) { s = q.y + 0.5; c = q.x; L = 1.0; W = aspect; sdir = vec2(0.0, 1.0); }
      else if (variant < 1.5) { s = 0.5 - q.y; c = q.x; L = 1.0; W = aspect; sdir = vec2(0.0, -1.0); }
      else { s = aspect * 0.5 - q.x; c = q.y; L = aspect; W = 1.0; sdir = vec2(-1.0, 0.0); }
    }
    vec3 oldShade(in vec2 uv, in vec2 q, in float near) {
      vec4 o = oldFrame(uv);
      if (preview > 0.5) o.rgb = o.bgr * 0.55;
      o.rgb *= 0.7;
      float shade = (1.0 - smoothstep(0.0, 0.26, near)) * 0.85 + 0.12;
      vec2 r = mat2(0.7071, -0.7071, 0.7071, 0.7071) * q;
      float dotD = length(fract(r / 0.021) - 0.5);
      float rad = sqrt(shade) * 0.58;
      return mix(o.rgb, INK, (1.0 - smoothstep(rad - 0.07, rad + 0.07, dotD)) * 0.82);
    }

    /* ZIP: both panels slam in together, one ink-splat star at the seam */
    vec4 zip() {
      float P = progress;
      float hit = step(0.30, P) * exp(-(P - 0.30) * 26.0);
      vec2 uv = vFilterCoord + vec2(sin(P * 240.0), cos(P * 310.0)) * hit * 0.012;
      float ink = 1.0 - smoothstep(0.55, 0.78, P);
      vec2 q; float s, c, L, W; vec2 sdir;
      frame(uv, q, s, c, L, W, sdir);
      float ez = easeOut((P - 0.03) / 0.27);
      float e = mix(-(SLANT * W * 0.5 + PAD), L * 0.5, ez);
      float rough = (hash(floor(c * 90.0) + variant * 13.0) - 0.5) * 0.0045;
      float d1 = (e + SLANT * c + rough) - s;
      float d2 = s - (L - e + SLANT * c + rough);
      vec3 col = oldShade(uv, q, min(-d1, -d2));
      float gw = 0.03 * ink, bw = 0.02 * ink;
      col = mix(col, PAPER, max(edge(-d1, gw), edge(-d2, gw)) * ink);
      float lag = (1.0 - ez) * 0.05;
      vec3 pa = newFrame(uv + sdir * lag).rgb;
      vec3 pb = newFrame(uv - sdir * lag).rgb;
      float lane = floor(c * 40.0);
      float lm = (1.0 - smoothstep(0.03, 0.09, abs(fract(c * 40.0) - 0.5))) * step(0.4, hash(lane + variant * 5.0));
      float amp = smoothstep(0.03, 0.07, P) * (1.0 - smoothstep(0.12, 0.30, P));
      pa = mix(pa, INK, lm * (1.0 - smoothstep(0.0, 0.5, d1)) * amp * 0.9);
      pb = mix(pb, INK, lm * (1.0 - smoothstep(0.0, 0.5, d2)) * amp * 0.9);
      pa = mix(pa, INK, edge(d1, bw));
      pb = mix(pb, INK, edge(d2, bw));
      col = mix(col, pa, smoothstep(-AA, AA, d1));
      col = mix(col, pb, smoothstep(-AA, AA, d2));
      float tt = clamp((P - 0.30) / 0.30, 0.0, 1.0);
      float ang = atan(q.y, q.x);
      float tri = abs(fract(ang * 9.0 / 6.2831853 + 0.07) - 0.5) * 2.0;
      float R = (0.07 + 0.24 * easeOut(tt)) * (0.68 + 0.5 * tri);
      float rr = length(q);
      float starA = step(0.30, P) * (1.0 - smoothstep(0.50, 0.74, P));
      col = mix(col, INK, (1.0 - smoothstep(R - AA, R + AA, rr)) * starA);
      col = mix(col, PAPER, (1.0 - smoothstep(R - 0.018 - AA, R - 0.018 + AA, rr)) * starA);
      col += hit * 0.45 * (1.0 - col);
      return vec4(col, 1.0);
    }

    /* TRIPLE CUT: four slanted strips of the new scene, alternating sides, one after another */
    vec4 triple() {
      float P = progress;
      float hit = step(0.52, P) * exp(-(P - 0.52) * 30.0);
      vec2 uv = vFilterCoord + vec2(sin(P * 220.0), cos(P * 280.0)) * hit * 0.008;
      float ink = 1.0 - smoothstep(0.84, 0.98, P);
      vec2 q; float s, c, L, W; vec2 sdir;
      frame(uv, q, s, c, L, W, sdir);
      float span = W + 0.2 * L;
      float x = ((c + 0.2 * s) / span + 0.5) * 4.0;
      float i = clamp(floor(x), 0.0, 3.0);
      float odd = mod(i, 2.0);
      float delay = mod(i * 3.0, 4.0) * 0.065;
      float ti = easeOut((P - 0.04 - delay) / 0.30);
      float start = -(SLANT * W * 0.5 + PAD);
      float rough = (hash(floor(c * 80.0) + i * 11.0) - 0.5) * 0.004;
      float lead = mix(start, L + SLANT * W * 0.5 + PAD, ti);
      float dEven = (lead + SLANT * c + rough) - s;
      float dOdd = s - (L - lead + SLANT * c + rough);
      float d = mix(dEven, dOdd, odd);
      float bd = min(fract(x), 1.0 - fract(x)) * span * 0.25;
      vec3 col = oldShade(uv, q, -d);
      float gw = 0.016 * ink, bw = 0.014 * ink;
      col = mix(col, PAPER, edge(-d, gw) * ink * step(0.001, ti));
      float lag = (1.0 - ti) * 0.04;
      vec3 pn = newFrame(uv + sdir * lag * mix(1.0, -1.0, odd)).rgb;
      float lane = floor(c * 44.0);
      float lm = (1.0 - smoothstep(0.03, 0.09, abs(fract(c * 44.0) - 0.5))) * step(0.45, hash(lane + i * 3.0));
      pn = mix(pn, mix(INK, PAPER, step(0.5, hash(lane * 5.3))), lm * (1.0 - smoothstep(0.0, 0.45, d)) * (1.0 - ti) * 0.9);
      pn = mix(pn, INK, edge(d, bw));
      float hf = 0.010 * ink;
      pn = mix(pn, INK, (1.0 - smoothstep(hf + bw - AA, hf + bw + AA, bd)) * ink);
      pn = mix(pn, PAPER, (1.0 - smoothstep(hf - AA, hf + AA, bd)) * ink);
      col = mix(col, pn, smoothstep(-AA, AA, d));
      col += hit * 0.38 * (1.0 - col);
      return vec4(col, 1.0);
    }

    void main() {
      vec4 result;
      if (progress >= 0.999) result = newFrame(vFilterCoord);
      else if (progress <= 0.0005) result = oldFrame(vFilterCoord);
      else if (calm > 0.5) result = mix(oldFrame(vFilterCoord), newFrame(vFilterCoord), smoothstep(0.0, 0.4, progress));
      else if (style > 1.5) result = triple();
      else if (style > 0.5) result = zip();
      else result = slash();
      result *= tintAlpha;
      if (opaque > 0.5) {
        vec4 bg = backgroundColor;
        result.rgb = result.rgb + (bg.rgb * bg.a) * (1.0 - result.a);
        result.a = 1.0;
      }
      gl_FragColor = result;
    }
  `;
}

/* The new scene's rectangle in screen uv and the colour the live canvas paints outside it, read at the moment core captures the new frame. */
function liveFrame() {
  try {
    const wt = canvas.stage.worldTransform, sr = canvas.dimensions.sceneRect, sc = canvas.app.renderer.screen;
    const x0 = (wt.a * sr.x + wt.tx) / sc.width, y0 = (wt.d * sr.y + wt.ty) / sc.height;
    const x1 = (wt.a * (sr.x + sr.width) + wt.tx) / sc.width, y1 = (wt.d * (sr.y + sr.height) + wt.ty) / sc.height;
    const bg = new PIXI.Color(canvas.app.renderer.background.color).toArray().slice(0, 3);   // what the live canvas paints outside the scene
    return { sceneRect: [x0, y0, x1, y1], bgColor: bg };
  } catch { return { sceneRect: [0, 0, 1, 1], bgColor: [0, 0, 0] }; }
}

/* ---------- the filter class (built lazily: needs canvas.rendering.filters) ---------- */
function makeFilterClass() {
  const Base = foundry.canvas.rendering.filters.TextureTransitionFilter;
  return class ComicSlashFilter extends Base {
    #t0 = 0;
    #dog = 0;
    #name = "slashRight";

    get type() { return this.#name; }
    set type(name) {   // core assigns the registry's filterType here: the id of the variant
      this.#name = name in LABELS ? name : "slashRight";
      this.uniforms.style = styleOf(this.#name);
      this.uniforms.variant = this.#name in VARIANT ? VARIANT[this.#name] : Math.floor(Math.random() * 3);
      this.uniforms.calm = reduced() || get(KEY.calm) === true ? 1 : 0;
      this.uniforms.preview = previewMode ? 1 : 0;
      Object.assign(this.uniforms, liveFrame());
      this.#t0 = 0;
      clearTimeout(this.#dog); this.#dog = 0;
    }

    static get defaultUniforms() {
      return { ...super.defaultUniforms, style: 0, sceneRect: [0, 0, 1, 1], bgColor: [0, 0, 0], variant: 2, aspect: 1.78, calm: 0, preview: 0 };
    }

    static _createFragmentShader() { return fragment(Base); }

    /** @inheritDoc */
    apply(filterManager, input, output, clear) {
      try {
        const target = filterManager.activeState?.target;
        if (target?.width && target?.height) this.uniforms.aspect = Math.max(0.5, Math.min(4, target.width / target.height));
        const now = performance.now();
        if (!this.#t0) {   // first frame of this run: arm the watchdog
          this.#t0 = now;
          clearTimeout(this.#dog);
          this.#dog = setTimeout(() => {
            this.#dog = 0;
            try { if (canvas?.transition?.isRunning && !previewFrozen()) canvas.transition._reset(); } catch { /* ignore */ }
          }, WATCHDOG_MS + 150);
        }
        if (now - this.#t0 > WATCHDOG_MS && !previewFrozen()) this.uniforms.progress = 1;
      } catch (e) { console.warn(LOG, "apply", e); }
      return super.apply(filterManager, input, output, clear);
    }
  };
}
const previewFrozen = () => !!frozenTimer;

/* ---------- registry ---------- */
function register() {
  const defs = CONFIG.Canvas?.sceneTransitions;
  if (!defs || !foundry.canvas?.rendering?.filters?.TextureTransitionFilter) throw new Error("scene transition registry not found");
  const Filter = makeFilterClass();
  for (const id of Object.keys(LABELS)) {
    if (defs[id]?.module === MOD) continue;
    const def = { id, filterClass: Filter, filterType: id, defaultDuration: msOf(id), module: MOD };
    Object.defineProperty(def, "label", { enumerable: true, get: () => t(LABELS[id]) });   // follows the language, evaluated when Scene configuration opens
    defs[id] = def;
  }
}
function unregister() {
  const defs = CONFIG.Canvas?.sceneTransitions;
  if (defs) for (const id of Object.keys(LABELS)) if (defs[id]?.module === MOD) delete defs[id];
}

/* ---------- settings ---------- */
function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  if (!has(KEY.dflt)) game.settings.register(MOD, KEY.dflt, {
    name: t("IPS.Settings.Default.Name"), hint: t("IPS.Settings.Default.Hint"), scope: "world", config: true, type: String, default: "off",
    choices: { off: t("IPS.Settings.Default.off"), ...Object.fromEntries(Object.keys(PICK).map((k) => [k, t(LABELS[PICK[k]])])) }
  });
  if (!has(KEY.calm)) game.settings.register(MOD, KEY.calm, {
    name: t("IPS.Settings.Calm.Name"), hint: t("IPS.Settings.Calm.Hint"), scope: "client", config: true, type: Boolean, default: false
  });
}

/* A scene whose own transition is None borrows the default for this one draw (in memory; the stored data and the config form are untouched). */
function lend(canvasObj) {
  try {
    const scene = canvasObj?.scene ?? canvas?.scene;
    const v = get(KEY.dflt);
    if (!scene || !PICK[v] || scene.transition?.type) return;
    scene.transition.type = PICK[v];
    restoreScene = scene;
  } catch (e) { console.warn(LOG, "default transition", e); }
}
function giveBack() {
  const scene = restoreScene;
  restoreScene = null;
  if (!scene) return;
  setTimeout(() => { try { if (scene.transition?.type in LABELS && !scene._source?.transition?.type) scene.transition.type = null; } catch { /* ignore */ } }, 0);
}

/* ---------- test hook ---------- */
export function clear() {
  clearTimeout(frozenTimer); frozenTimer = 0;
  try { canvas?.transition?._reset(); if (canvas?.root) canvas.root.visible = true; } catch { /* ignore */ }
}
/** Plays the slash over the CURRENT scene (the old frame is tinted so it shows), without changing the scene.
 *  With opts.progress (0..1) it freezes that frame instead (auto-clears after 20 s, or call api.slash.clear()). */
export async function preview(variant = "random", opts = {}) {
  if (!canvas?.ready) return false;
  const id = PICK[variant] ?? IDS.random;
  try {
    if (canvas.transition.isRunning) await canvas.transition.cancel();
    clear();
    previewMode = true;
    const duration = Math.min(Number(opts.duration) || msOf(id), WATCHDOG_MS);
    if (opts.progress == null) {
      await canvas.transition.run({ operation: async () => {}, duration, transitionType: id });
    } else {
      const tr = canvas.transition;
      tr._captureCurrentScene({});
      canvas.root.visible = false;
      await tr._captureNextScene({ transitionType: id });
      const f = tr.children?.[0]?.filters?.[0];
      if (f) f.uniforms.progress = Math.max(0, Math.min(1, Number(opts.progress)));
      frozenTimer = setTimeout(clear, 20000);
    }
    return true;
  } catch (e) { console.warn(LOG, "preview failed", e); clear(); return false; }
  finally { previewMode = false; }
}

/* ---------- start / stop (called from module.js; both idempotent) ----------
   phases = { init, setup, ready }: the Foundry start-up phases already passed when the dynamic import finished. */
export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
  run("init", () => {
    try {
      registerSettings();
      on("canvasInit", lend);
      on("canvasReady", giveBack);
      try { register(); } catch { /* retried at ready */ }
      run("ready", () => {
        const mod = game.modules.get(MOD);
        if (mod) mod.api = { ...(mod.api ?? {}), slash: { preview, clear, stop } };
        try { register(); } catch (e) { console.warn(LOG, "register", e); }   // idempotent
        console.log(`${LOG} ready`);
      });
    } catch (e) { console.warn(LOG, "start failed", e); }
  });
}

export function stop() {
  for (const [name, id] of hookIds.splice(0)) { try { Hooks.off(name, id); } catch { /* gone */ } }
  clear();
  unregister();
  started = false;
}
