/* Plus Ultra STATISTICS, THE ATTRIBUTE RADAR (package RADR): the "spider" of a character's six attributes, drawn as inline SVG in the
   head of the character's entry (app.mjs #entry). The model is model.radarOf (values as they are now on the sheet, one scale for the rail)
   and the geometry model.radarPoint (node-tested). Comic like the rest of the window: an ink hexagon with the kit's halftone dots, rings
   every 2, the values as a yellow shape with a black outline and diamond corners like the title badges; around it each attribute's name
   (label colour) over its value (the highest in yellow). Styles: styles/stats.css "RADR". */
import { radarPoint } from "./model.mjs";

const NS = "http://www.w3.org/2000/svg";
const W = 260, H = 218, CX = 130, CY = 109, R = 68;
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
};
const pts = (list) => list.map(([x, y]) => `${x},${y}`).join(" ");

/** radar = { top, axes: [{ id, label, v }] } -> <figure> or null */
export function radarFigure(radar, t) {
  if (!radar?.axes?.length) return null;
  const top = radar.top;
  const ring = (k) => pts(radar.axes.map((_, i) => radarPoint(i, k, top, R, CX, CY)));
  const vals = radar.axes.map((a) => a.v), max = Math.max(...vals), flat = vals.every((v) => v === max);
  const shape = radar.axes.map((a, i) => radarPoint(i, a.v, top, R, CX, CY));
  const rings = [];
  for (let k = 2; k < top; k += 2) rings.push(s("polygon", { class: "rd-ring", points: ring(k) }));
  const spokes = radar.axes.map((_, i) => { const [x, y] = radarPoint(i, top, top, R, CX, CY); return s("line", { class: "rd-spoke", x1: CX, y1: CY, x2: x, y2: y }); });
  const labels = radar.axes.map((a, i) => {
    const [x, y] = radarPoint(i, top, top, R + 10, CX, CY);
    const side = Math.abs(x - CX) < 1 ? "mid" : x > CX ? "r" : "l";
    const anchor = side === "mid" ? "middle" : side === "r" ? "start" : "end";
    /* the value sits nearest the chart: above the name at the bottom, under it at the top and on the sides */
    const up = side === "mid" && y < CY, down = side === "mid" && y > CY;
    const nameY = up ? y - 19 : down ? y + 29 : y - 3, valY = up ? y - 2 : down ? y + 12 : y + 13;
    return s("g", { class: "rd-lab", "data-id": a.id, "text-anchor": anchor },
      s("text", { class: "rd-name", x, y: nameY }, a.label),
      s("text", { class: "rd-val", x, y: valY, "data-top": !flat && a.v === max ? "1" : null }, String(a.v)));
  });
  const said = radar.axes.map((a) => `${a.label} ${a.v}`).join(", ");
  const svg = s("svg", { class: "ipu-st-radar-svg", viewBox: `0 0 ${W} ${H}`, width: W, height: H, "aria-hidden": "true", focusable: "false" },
    s("defs", {}, s("pattern", { id: "ipu-st-rd-dots", width: 6, height: 6, patternUnits: "userSpaceOnUse" }, s("circle", { cx: 3, cy: 3, r: 0.9, class: "rd-dot" }))),
    s("polygon", { class: "rd-base", points: ring(top) }),
    s("polygon", { class: "rd-dots", points: ring(top) }),
    rings, spokes,
    s("polygon", { class: "rd-edge", points: pts(shape) }),
    s("polygon", { class: "rd-shape", points: pts(shape) }),
    shape.map(([x, y]) => s("rect", { class: "rd-pt", x: x - 3.5, y: y - 3.5, width: 7, height: 7, transform: `rotate(45 ${x} ${y})` })),
    labels);
  const fig = document.createElement("figure");
  fig.className = "ipu-st-radar";
  fig.setAttribute("role", "img");
  fig.setAttribute("aria-label", `${t("IPU.Stats.radar")}: ${said}`);
  fig.setAttribute("data-tooltip", t("IPU.Stats.radar.tip", { top }));
  fig.append(svg);
  return fig;
}
