/* FXI-SPLASH (ADVI 10, privacy): does THIS seat see a token? The owner: nothing may reveal to a player a token that seat cannot see.
   A map moment stands by its token on the board (the same scene place on every seat that sees it); a seat that does not see the token
   (hidden by the GM, or out of its sight: vision, walls, fog) must not get a word, a caption, a gauge, sparks or an impact frame at that
   place: it gets the moment on its screen instead, with no place on the board. The GM sees every token (the GM's own vision does not hide
   tokens from the GM). Fails closed: whatever cannot be answered counts as not seen.
     seesToken(token, { user, canvas }) -> boolean */
export function seesToken(t, env = {}) {
  try {
    const user = env.user ?? globalThis.game?.user, C = env.canvas ?? globalThis.canvas;
    if (!t || t.destroyed || !t.document) return false;
    if (user?.isGM) return true;
    if (t.document.hidden) return false;
    if (t.visible === false) return false;           // the canvas's own answer for this seat (Token#visible follows its vision refresh)
    if (t.controlled || t.isOwner || t.document.isOwner) return true;   // the seat's own token
    const V = C?.visibility;
    if (!V || !V.tokenVision) return true;           // a scene without token vision: everybody sees every shown token
    if (typeof V.testVisibility !== 'function') return false;
    const pts = t.document.getVisibilityTestPoints?.() ?? t.center;
    return !!V.testVisibility(pts, { tolerance: 0, object: t });
  } catch (e) { return false; }
}
