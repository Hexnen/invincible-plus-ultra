/* GORE, PURE: what a viewer SEES of the blood, and whether it is pink (GOREPINK; the owner's standing rule for these effects: no pink).
   Used by the node checks (scripts/sweep-checks/gore.mjs, gorepink.mjs); main.mjs builds the glass this file describes.

   THE GLASS under the blood is two panes (main.mjs):
     1. the SHADE: the blood's own colour, opaque, blended "darken" (each channel = the smaller of the ground's and the blood's): blood
        soaks light out of whatever lies under it. On a dark map it changes next to nothing; on a light map the ground under a splash
        can no longer shine through as white;
     2. the BLOOD at its alpha, as before.
   Why: red at a low alpha over a light ground IS pink (a tint of red). With the shade a shown pixel is never lighter, in any channel,
   than the blood colour painted there, on any ground: so a palette with no pink colour shows no pink on a dark and on a light scene. */

/** one channel of a blood pixel (colour c 0..255, alpha a 0..255) as shown over a ground bg 0..255 */
export const onGround = (c, a, bg) => { const v = bg < c ? bg : c; return v + (c - v) * (a / 255); };
/** a blood pixel [r, g, b, a] as shown over a ground [r, g, b] */
export const shown = (px, bg) => [onGround(px[0], px[3], bg[0]), onGround(px[1], px[3], bg[1]), onGround(px[2], px[3], bg[2])];

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
/** sRGB 0..255 -> OKLCH [L 0..1, C, h degrees] */
export function oklch(r, g, b) {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180 / Math.PI + 360) % 360];
}
/* PINK or SALMON: a LIGHT red, magenta or red-orange, i.e. a tint. Hue from magenta through red to the orange side of salmon
   (OKLCH 300..360 and 0..55: salmon 28, light coral 21, dark salmon 39, the old crumbling front 39, hot pink 350; ochre, amber and tan
   lie at 60+), with some colour in it (C >= 0.03: a rosy grey counts, a warm white does not), and light (L >= 0.58, a little more for
   a vivid colour: a pure red, L 0.63 at C 0.26, is red, not pink; Indian red, L 0.62 at C 0.14, is a dusty pink). The lettering
   engine's own band (design.mjs PINK: hue 290..15) stops short of salmon; this one is wider on purpose. */
export const PINK = { h0: 300, h1: 55, C: 0.03, L: 0.58, vivid: 0.5, at: 0.1 };
export function isPink(r, g, b) {
  const [L, C, h] = oklch(r, g, b);
  return (h >= PINK.h0 || h < PINK.h1) && C >= PINK.C && L >= PINK.L + PINK.vivid * Math.max(0, C - PINK.at);
}
