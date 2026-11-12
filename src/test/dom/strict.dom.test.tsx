// @vitest-environment happy-dom
//
// The strict DOM checks themselves (./strict.ts): each case runs the checks
// against a scratch test, so the outer test can see them fail.

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { api } from "~/trpc/react";

import { allowConsoleError, renderWithProviders } from "./render";
import { checkStrictDomRun, recordUnhandledTrpcCall, resetStrictDomRun } from "./strict";

function UsesUnreadCount() {
  const unread = api.message.getUnreadCount.useQuery();
  return <p>{unread.isError ? "failed" : "waiting"}</p>;
}

describe("strict DOM checks", () => {
  it("fail a test whose component called a procedure without a handler", async () => {
    renderWithProviders(<UsesUnreadCount />);
    expect(await screen.findByText("failed")).toBeTruthy();

    expect(() => checkStrictDomRun()).toThrow(/no handler for:\n {2}query message\.getUnreadCount/);
    resetStrictDomRun();
  });

  it("fail a test that logged with console.error", () => {
    console.error("Warning: An update to X inside a test was not wrapped in act(...)");
    expect(() => checkStrictDomRun()).toThrow(/console\.error was called[\s\S]*not wrapped in act/);
    resetStrictDomRun();
  });

  it("let a test allow the error log it expects, and only that one", () => {
    allowConsoleError(/Error updating booking/);
    console.error("Error updating booking status");
    expect(() => checkStrictDomRun()).not.toThrow();

    console.error("Something else entirely");
    expect(() => checkStrictDomRun()).toThrow(/Something else entirely/);
    resetStrictDomRun();
  });

  it("pass a clean run", () => {
    recordUnhandledTrpcCall("query x.y");
    resetStrictDomRun();
    expect(() => checkStrictDomRun()).not.toThrow();
  });
});
