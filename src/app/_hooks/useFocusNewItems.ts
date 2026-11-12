"use client";

import { useCallback, useEffect, useRef } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focuses the first control inside `element`, or the element itself. */
export function focusInto(element: Element | null | undefined): void {
    if (!(element instanceof HTMLElement)) return;
    const control = element.querySelector<HTMLElement>(FOCUSABLE);
    if (control) {
        control.focus();
        return;
    }
    // Nothing to operate in it: make the item itself a one-off focus target.
    if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
    element.focus();
}

/**
 * Keeps keyboard and screen-reader users in place after "Load more": the
 * button they pressed often disappears (last page) or moves, which would
 * drop focus on <body>. Call `expectMore()` when the button is pressed; once
 * the list has grown, focus moves to the first item that was added.
 *
 * `listRef` goes on the element whose children are the items. `added` says
 * where new items appear: at the "end" (most lists) or the "start" (earlier
 * comments, loaded above the ones on screen).
 */
export function useFocusNewItems(count: number, added: "end" | "start" = "end") {
    const list = useRef<HTMLElement | null>(null);
    // A callback ref, so it fits whatever element the list is rendered as.
    const listRef = useCallback((node: HTMLElement | null) => {
        list.current = node;
    }, []);
    const countWhenAsked = useRef<number | null>(null);

    useEffect(() => {
        const before = countWhenAsked.current;
        if (before === null || count <= before) return;
        countWhenAsked.current = null;
        focusInto(list.current?.children.item(added === "end" ? before : 0));
    }, [added, count]);

    const expectMore = useCallback(() => {
        countWhenAsked.current = count;
    }, [count]);

    return { expectMore, listRef };
}
