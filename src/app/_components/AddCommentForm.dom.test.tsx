// @vitest-environment happy-dom
//
// Commenting on an event: an empty or too-long comment is refused before
// sending (with a counter near the limit), the trimmed comment is posted
// with the button or Ctrl/Cmd+Enter, the draft is cleared only once the
// server has stored it, and a refusal is shown under the field with the
// draft kept.

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MAX_COMMENT_LENGTH } from "~/_utils/limits";
import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";

import AddCommentForm from "./AddCommentForm";

type AddComment = NonNullable<NonNullable<TrpcHandlers["event"]>["addCommentToEvent"]>;

function renderForm(addCommentToEvent: AddComment = () => ({}) as never) {
  const onPosted = vi.fn();
  const view = renderWithProviders(<AddCommentForm eventId="ev-1" eventTitle="Garden wedding" onPosted={onPosted} />, {
    trpc: { event: { addCommentToEvent } },
  });
  return { ...view, onPosted };
}

const field = () => screen.getByRole("textbox", { name: "Comment on Garden wedding" }) as HTMLTextAreaElement;
const post = () => screen.getByRole("button", { name: "Post comment" });

describe("AddCommentForm", () => {
  it("asks for a comment before posting", async () => {
    const view = renderForm();
    await userEvent.type(field(), "   ");
    await userEvent.click(post());
    expect(await screen.findByText("Write a comment first")).toBeTruthy();
    expect(view.callsTo("event.addCommentToEvent")).toEqual([]);
  });

  it("posts the trimmed comment, clears the draft and tells the page", async () => {
    const view = renderForm();
    await userEvent.type(field(), "  Count me in!  ");
    await userEvent.click(post());

    await waitFor(() => expect(view.onPosted).toHaveBeenCalledTimes(1));
    expect(view.callsTo("event.addCommentToEvent")).toEqual([{ content: "Count me in!", eventId: "ev-1" }]);
    expect(field().value).toBe("");
  });

  it("posts with Ctrl+Enter", async () => {
    const view = renderForm();
    await userEvent.type(field(), "Quick one");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(view.callsTo("event.addCommentToEvent")).toEqual([{ content: "Quick one", eventId: "ev-1" }]));
  });

  it("counts characters near the limit and refuses a comment over it", async () => {
    const view = renderForm();
    fireEvent.change(field(), { target: { value: "a".repeat(MAX_COMMENT_LENGTH - 250) } });
    expect(screen.queryByTestId("comment-counter")).toBeNull();

    fireEvent.change(field(), { target: { value: "a".repeat(MAX_COMMENT_LENGTH + 5) } });
    expect(screen.getByTestId("comment-counter").textContent).toBe("2,005/2,000");
    await userEvent.click(post());

    expect(await screen.findByText("That comment is 5 characters over the 2,000 limit. Shorten it to post.")).toBeTruthy();
    expect(view.callsTo("event.addCommentToEvent")).toEqual([]);
  });

  it("keeps the draft and shows why when the server refuses it", async () => {
    const view = renderForm(() => {
      throw trpcError("TOO_MANY_REQUESTS", "You're commenting too fast. Try again in a minute.");
    });
    await userEvent.type(field(), "Hello");
    await userEvent.click(post());

    expect(await screen.findByText("You're commenting too fast. Try again in a minute.")).toBeTruthy();
    expect(field().value).toBe("Hello");
    expect(view.onPosted).not.toHaveBeenCalled();
  });
});
