/**
 * Inline script for <head>: marks the document as scripted before first paint,
 * which arms the scroll reveals in `globals.css`. Without it (JavaScript off)
 * all content simply renders visible.
 */
export const REVEAL_SCRIPT = "document.documentElement.setAttribute('data-reveal','')";
