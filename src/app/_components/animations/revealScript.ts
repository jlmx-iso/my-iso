/** How long the page waits for React before giving up on scroll reveals. */
export const REVEAL_FALLBACK_MS = 4000;

/** Set on <html> by the reveal components once they have hydrated. */
export const REVEAL_READY_ATTRIBUTE = "data-reveal-ready";

/**
 * Inline script for <head>: marks the document as scripted before first paint,
 * which arms the scroll reveals in `globals.css`. Without it (JavaScript off)
 * all content simply renders visible.
 *
 * Armed content stays hidden until React marks it as revealed. If React never
 * gets that far (the bundle failed to load, hydration threw), the script
 * disarms the reveals again after REVEAL_FALLBACK_MS, so the content always
 * becomes visible.
 */
export const REVEAL_SCRIPT =
  "(function(d){d.setAttribute('data-reveal','');" +
  `setTimeout(function(){if(!d.hasAttribute('${REVEAL_READY_ATTRIBUTE}'))d.removeAttribute('data-reveal')},${REVEAL_FALLBACK_MS})` +
  "})(document.documentElement)";
