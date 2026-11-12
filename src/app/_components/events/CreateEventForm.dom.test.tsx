// @vitest-environment happy-dom
//
// Posting an event, through the "Create event" button and its dialog: the
// form asks for what is missing and takes the keyboard there, sends the
// trimmed event with its cover image as base64 (no other network), keeps
// the draft and explains a failure inside the dialog (offering to post
// without a cover the server would not take), cannot be closed while it
// saves, and asks before a typed draft is thrown away.

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import dayjs from "dayjs";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { defaultEventStart } from "~/_utils/eventDates";
import { IMAGE_TOO_LARGE_MESSAGE, IMAGE_WRONG_TYPE_MESSAGE } from "~/_utils/imageFile";
import { testRouter } from "~/test/dom/navigation";
import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));

import CreateEventButton from "./CreateEventButton";
import CreateEventForm from "./CreateEventForm";

type Created = Awaited<ReturnType<NonNullable<NonNullable<TrpcHandlers["event"]>["create"]>>>;

/** A promise the test settles, to hold a request in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

const created = (title = "Downtown wedding") => ({ id: "ev-1", title }) as Created;

const png = (name = "cover.png") => new File(["hello"], name, { type: "image/png" });
const PNG_BASE64 = "aGVsbG8=";

function renderButton(event: TrpcHandlers["event"] = {}) {
  return renderWithProviders(<CreateEventButton />, {
    trpc: {
      event,
      // Typing a location asks for suggestions; there are none here.
      google: { getAutocompleteLocations: () => [] },
    },
  });
}

async function openDialog() {
  await userEvent.click(screen.getByRole("button", { name: "Create event" }));
  return screen.findByRole("dialog", { name: "Create event" });
}

async function fillRequired(dialog: HTMLElement, values = { description: "  Second shooter for the ceremony  ", location: " Austin, TX ", title: "  Downtown wedding " }) {
  const form = within(dialog);
  await userEvent.type(form.getByRole("textbox", { name: "Title" }), values.title);
  await userEvent.type(form.getByRole("textbox", { name: /Description/ }), values.description);
  await userEvent.type(form.getByLabelText(/^Location/, { selector: "input" }), values.location);
}

const coverInput = (dialog: HTMLElement) => {
  const input = dialog.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input");
  return input;
};

const submit = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole("button", { name: "Create event" }));

describe("creating an event", () => {
  it("posts the trimmed event at the default start, closes and confirms", async () => {
    const view = renderButton({ create: () => created() });
    const dialog = await openDialog();

    await fillRequired(dialog);
    await submit(dialog);

    expect(await screen.findByText('"Downtown wedding" is live. Photographers nearby can now apply.')).toBeTruthy();
    expect(view.callsTo("event.create")).toEqual([
      {
        date: dayjs(defaultEventStart()).toISOString(),
        description: "Second shooter for the ceremony",
        duration: 4,
        image: undefined,
        location: "Austin, TX",
        title: "Downtown wedding",
      },
    ]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create event" })).toBeNull());
  });

  it("sends the chosen duration and the cover image as base64", async () => {
    const view = renderButton({ create: () => created() });
    const dialog = await openDialog();

    await fillRequired(dialog);
    await userEvent.click(within(dialog).getByLabelText(/^Duration/, { selector: "input" }));
    await userEvent.click(await screen.findByRole("option", { name: "8 hours (full day)" }));
    await userEvent.upload(coverInput(dialog), png());
    await submit(dialog);

    await waitFor(() => expect(view.callsTo("event.create")).toHaveLength(1));
    expect(view.callsTo("event.create")[0]).toMatchObject({ duration: 8, image: PNG_BASE64 });
  });

  it("names every missing field, focuses the first, and sends nothing", async () => {
    const view = renderButton();
    const dialog = await openDialog();

    await submit(dialog);

    expect(await within(dialog).findByText("Give the event a title")).toBeTruthy();
    expect(within(dialog).getByText("Describe the event so second shooters know what to expect")).toBeTruthy();
    expect(within(dialog).getByText("Enter where the event is")).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("textbox", { name: "Title" }));
    expect(view.callsTo("event.create")).toEqual([]);
  });

  it("takes the keyboard to the first invalid field when it is not the first", async () => {
    renderButton();
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title" }), "Wedding");

    await submit(dialog);

    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole("textbox", { name: /Description/ })),
    );
  });

  it("refuses a cover of the wrong type as soon as it is chosen", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const view = renderButton();
    await user.click(screen.getByRole("button", { name: "Create event" }));
    const dialog = await screen.findByRole("dialog", { name: "Create event" });

    await user.upload(coverInput(dialog), new File(["gif"], "anim.gif", { type: "image/gif" }));

    expect(await within(dialog).findByText(IMAGE_WRONG_TYPE_MESSAGE)).toBeTruthy();
    await fillRequired(dialog);
    await submit(dialog);
    expect(view.callsTo("event.create")).toEqual([]);
  });
});

describe("failures, inside the dialog", () => {
  it("keeps the draft and says the event was not posted", async () => {
    renderButton({
      create: () => {
        throw trpcError("INTERNAL_SERVER_ERROR", "db down");
      },
    });
    const dialog = await openDialog();
    await fillRequired(dialog);

    await submit(dialog);

    const alert = await within(dialog).findByTestId("create-event-error");
    expect(alert.textContent).toContain("Event not posted");
    expect(alert.textContent).toContain("We couldn't create your event. Your details are still here — please try again.");
    expect(within(dialog).queryByRole("button", { name: "Post without cover" })).toBeNull();
    expect(within(dialog).getByRole<HTMLInputElement>("textbox", { name: "Title" }).value).toBe("  Downtown wedding ");
  });

  it("shows the server's own words for a refusal written for the member", async () => {
    renderButton({
      create: () => {
        throw trpcError("TOO_MANY_REQUESTS", "You're posting too fast. Try again in a minute.");
      },
    });
    const dialog = await openDialog();
    await fillRequired(dialog);

    await submit(dialog);

    expect(await within(dialog).findByText("You're posting too fast. Try again in a minute.")).toBeTruthy();
  });

  it("offers to post without the cover when the image host refused it, and does", async () => {
    let attempt = 0;
    const view = renderButton({
      create: () => {
        attempt += 1;
        if (attempt === 1) throw trpcError("INTERNAL_SERVER_ERROR", "Error uploading image");
        return created();
      },
    });
    const dialog = await openDialog();
    await fillRequired(dialog);
    await userEvent.upload(coverInput(dialog), png());

    await submit(dialog);

    const alert = await within(dialog).findByTestId("create-event-error");
    expect(alert.textContent).toContain(
      "The cover image couldn't be uploaded, so the event wasn't posted. Everything else is still here.",
    );
    await userEvent.click(within(alert).getByRole("button", { name: "Post without cover" }));

    expect(await screen.findByText("Event created")).toBeTruthy();
    const [first, second] = view.callsTo("event.create") as Array<{ image?: string }>;
    expect(first?.image).toBe(PNG_BASE64);
    expect(second?.image).toBeUndefined();
  });

  it("marks a cover the server found too large on the field as well", async () => {
    renderButton({
      create: () => {
        throw trpcError("PAYLOAD_TOO_LARGE", "Request entity too large");
      },
    });
    const dialog = await openDialog();
    await fillRequired(dialog);
    await userEvent.upload(coverInput(dialog), png());

    await submit(dialog);

    const alert = await within(dialog).findByTestId("create-event-error");
    expect(alert.textContent).toContain(`${IMAGE_TOO_LARGE_MESSAGE} The event wasn't posted.`);
    expect(within(dialog).getAllByText(IMAGE_TOO_LARGE_MESSAGE, { exact: false })).toHaveLength(2);
    expect(within(alert).getByRole("button", { name: "Post without cover" })).toBeTruthy();
  });

  it("cannot be closed or cancelled while saving", async () => {
    const save = deferred<Created>();
    renderButton({ create: () => save.promise });
    const dialog = await openDialog();
    await fillRequired(dialog);

    await submit(dialog);

    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true),
    );
    expect(dialog.querySelector(".mantine-Modal-close")).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Create event" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Discard this event?" })).toBeNull();

    await act(async () => save.resolve(created()));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create event" })).toBeNull());
  });
});

describe("closing", () => {
  it("closes at once when nothing was typed", async () => {
    renderButton();
    const dialog = await openDialog();

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create event" })).toBeNull());
    expect(screen.queryByRole("dialog", { name: "Discard this event?" })).toBeNull();
  });

  it("asks before throwing away a draft: Keep editing keeps it, Discard draft closes", async () => {
    renderButton();
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title" }), "Half-written");

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    let confirm = await screen.findByRole("dialog", { name: "Discard this event?" });
    expect(within(confirm).getByText("What you've written so far will be lost.")).toBeTruthy();
    await userEvent.click(within(confirm).getByRole("button", { name: "Keep editing" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Discard this event?" })).toBeNull());
    expect(within(dialog).getByRole<HTMLInputElement>("textbox", { name: "Title" }).value).toBe("Half-written");

    await userEvent.keyboard("{Escape}");
    confirm = await screen.findByRole("dialog", { name: "Discard this event?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Discard draft" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create event" })).toBeNull());
  });

  it("opens from ?create and drops it from the URL when closed", async () => {
    testRouter.setLocation("/app/events", "create=1");
    renderButton();

    const dialog = await screen.findByRole("dialog", { name: "Create event" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(testRouter.replace).toHaveBeenCalledWith("/app/events", { scroll: false });
  });
});

describe("a save that ends after the form is gone", () => {
  function Harness({ onCreated }: { onCreated: () => void }) {
    const [shown, setShown] = useState(true);
    return (
      <>
        {shown && <CreateEventForm onCreated={onCreated} onCancel={() => setShown(false)} />}
        <button type="button" onClick={() => setShown(false)}>
          Leave
        </button>
      </>
    );
  }

  it("reports the failure as a toast instead of dropping it", async () => {
    const save = deferred<Created>();
    const onCreated = vi.fn();
    renderWithProviders(<Harness onCreated={onCreated} />, {
      trpc: { event: { create: () => save.promise }, google: { getAutocompleteLocations: () => [] } },
    });
    await fillRequired(document.body);
    await userEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "Leave" }));
    await act(async () => save.reject(trpcError("INTERNAL_SERVER_ERROR", "db down")));

    expect(await screen.findByText("Event not posted")).toBeTruthy();
    expect(
      screen.getByText(
        "We couldn't create your event. Your details are still here — please try again. Your draft was not posted.",
      ),
    ).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
