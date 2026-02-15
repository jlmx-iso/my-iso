"use client";

import { useEffect } from "react";

const HEADER_OFFSET = 60;

export function SmoothScroll() {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // Match both "/#section" and "#section" patterns
      const hashMatch = href.match(/^\/?#(.+)$/);
      if (!hashMatch) return;

      const id = hashMatch[1];
      const el = document.getElementById(id!);
      if (!el) return;

      e.preventDefault();

      const top =
        el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET;

      window.scrollTo({
        top,
        behavior: "smooth",
      });

      // Update URL hash without jumping
      window.history.pushState(null, "", `#${id}`);
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return null;
}
