/* THE PLUS ULTRA MENU: the module's own group in Foundry's scene controls (the left column), with its tools in the second column.
   It is the place for the module's windows and, later, the settings for the players and the GM: a feature adds a tool with
     api.menu.add({ name, title, icon, order, visible?, onChange })      title: a string or () => string (read in the reader's language)
   A tool is a BUTTON (it opens something; it never takes the canvas layer). The group itself changes no layer either: the canvas keeps
   the layer it had, so tokens stay selectable while the menu is open. First tool: the statistics (scripts/stats/). */
import { t } from "./stats/lang.mjs";

const MOD = "invincible-plus-ultra";
export const CONTROL = "plusUltra";
const tools = new Map();
let hooked = false;

const text = (v) => (typeof v === "function" ? v() : String(v ?? ""));
/** add (or replace) a tool of the menu; re-draws the controls when they are up */
export function add(tool) {
  if (!tool?.name || typeof tool.onChange !== "function") return false;
  tools.set(tool.name, tool);
  refresh();
  return true;
}
export function remove(name) { const had = tools.delete(name); if (had) refresh(); return had; }
export const list = () => [...tools.keys()];
function refresh() { try { if (ui.controls?.rendered) ui.controls.render({ reset: true }); } catch { /* the controls are not up yet */ } }

function onButtons(controls) {
  try {
    const own = [...tools.values()].filter((x) => x.visible === undefined || (typeof x.visible === "function" ? x.visible() : !!x.visible));
    if (!own.length) return;
    const entries = {};
    own.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach((x, i) => {
      entries[x.name] = { name: x.name, title: text(x.title), icon: x.icon ?? "fa-solid fa-circle", order: x.order ?? i, button: true, onChange: (event, active) => { try { x.onChange(event, active); } catch (e) { console.warn(`${MOD} | menu tool ${x.name}`, e); } } };
    });
    controls[CONTROL] = { name: CONTROL, title: t("IPU.Menu.title"), icon: "fa-solid fa-star", order: 100, visible: true, tools: entries, activeTool: "" };
  } catch (e) { console.warn(`${MOD} | Plus Ultra menu not built`, e); }
}

export function start() {
  if (hooked) return;
  hooked = true;
  Hooks.on("getSceneControlButtons", onButtons);
  refresh();
}
