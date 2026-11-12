// @vitest-environment happy-dom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import AccountDeletedNotice from "~/app/_components/AccountDeletedNotice";
import ConsentBanner from "~/app/_components/consent/ConsentBanner";
import { renderWithProviders, trpcError } from "~/test/dom/render";

import AccountDataSettings, { saveJsonFile } from "./AccountDataSettings";

const USERNAME = { kind: "username", value: "ann-lee" } as const;

describe("Download your data", () => {
  it("asks the server for the export and saves it as a dated JSON file", async () => {
    const saveFile = vi.fn();
    const exportData = { account: { id: "u1" }, generatedAt: "2026-11-12T12:00:00.000Z" };
    const view = renderWithProviders(<AccountDataSettings confirmationEmail confirmation={USERNAME} saveFile={saveFile} />, {
      trpc: { account: { exportData: () => exportData as never } },
    });

    await userEvent.click(screen.getByRole("button", { name: "Download your data" }));

    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    expect(saveFile).toHaveBeenCalledWith("iso-data-2026-11-12.json", exportData);
    expect(view.callsTo("account.exportData")).toHaveLength(1);
    expect(await screen.findByText("Download ready")).toBeTruthy();
  });

  it("says so when the export cannot be made", async () => {
    const saveFile = vi.fn();
    renderWithProviders(<AccountDataSettings confirmationEmail confirmation={USERNAME} saveFile={saveFile} />, {
      trpc: {
        account: {
          exportData: () => {
            throw trpcError("TOO_MANY_REQUESTS", "Too many requests. Try again in 59 minutes.");
          },
        },
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Download your data" }));
    expect(await screen.findByText("Couldn't prepare your data")).toBeTruthy();
    expect(saveFile).not.toHaveBeenCalled();
  });
});

describe("saveJsonFile", () => {
  it("offers the data as a downloaded file", () => {
    const createObjectURL = vi.fn(() => "blob:export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const clicked: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });

    saveJsonFile("iso-data.json", { a: 1 });

    expect(clicked[0]?.download).toBe("iso-data.json");
    expect(clicked[0]?.href).toBe("blob:export");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
    expect(document.querySelector("a[download]")).toBeNull();
    click.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("Delete account", () => {
  async function openDialog(confirmation: { kind: "username" | "email"; value: string } = USERNAME) {
    const onDeleted = vi.fn();
    const view = renderWithProviders(<AccountDataSettings confirmationEmail confirmation={confirmation} onDeleted={onDeleted} />, {
      trpc: { account: { deleteAccount: () => ({ status: "deleted" as const }) } },
    });
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
    return { dialog, onDeleted, view };
  }

  it("needs the username typed before it can delete, then deletes and leaves", async () => {
    const { dialog, onDeleted, view } = await openDialog();
    const confirm = within(dialog).getByRole<HTMLButtonElement>("button", { name: "Delete my account" });
    const input = within(dialog).getByRole("textbox", { name: "Type your username to confirm" });

    expect(confirm.disabled).toBe(true);
    await userEvent.type(input, "ann");
    expect(confirm.disabled).toBe(true);
    await userEvent.type(input, "-LEE");
    expect(confirm.disabled).toBe(false);

    await userEvent.click(confirm);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(view.callsTo("account.deleteAccount")).toEqual([{ confirmation: "ann-LEE" }]);
  });

  it("asks for the email address when there is no username, and can be cancelled", async () => {
    const { dialog, onDeleted, view } = await openDialog({ kind: "email", value: "ann@example.com" });
    expect(within(dialog).getByRole("textbox", { name: "Type your email address to confirm" })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(view.callsTo("account.deleteAccount")).toEqual([]);
  });

  it("does not submit on Enter until the confirmation matches", async () => {
    const { dialog, view } = await openDialog();
    const input = within(dialog).getByRole("textbox", { name: "Type your username to confirm" });
    await userEvent.type(input, "nope{Enter}");
    expect(view.callsTo("account.deleteAccount")).toEqual([]);
  });

  it("shows why the account was not deleted", async () => {
    const onDeleted = vi.fn();
    renderWithProviders(<AccountDataSettings confirmationEmail confirmation={USERNAME} onDeleted={onDeleted} />, {
      trpc: {
        account: {
          deleteAccount: () => {
            throw trpcError("BAD_REQUEST", "Type your username exactly to confirm.");
          },
        },
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Type your username to confirm" }), "@ann-lee");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete my account" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("Type your username exactly to confirm.");
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe("the delete dialog", () => {
  it("says what happens, and promises an email only when one is sent", async () => {
    const { unmount } = renderWithProviders(<AccountDataSettings confirmationEmail confirmation={USERNAME} />, {
      trpc: { account: { deleteAccount: () => ({ status: "deleted" as const }) } },
    });
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
    for (const text of [
      "You'll be signed out on every device.",
      "We'll email you a confirmation.",
      /The rest of the period you've paid for is not refunded/,
      /your events are hidden/,
    ]) {
      expect(within(dialog).getByText(text)).toBeTruthy();
    }
    unmount();

    renderWithProviders(<AccountDataSettings confirmationEmail={false} confirmation={USERNAME} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(screen.queryByText("We'll email you a confirmation.")).toBeNull();
  });

  it("offers the download inside the dialog, and clears its toast when reopened", async () => {
    const saveFile = vi.fn();
    const exportData = { generatedAt: "2026-11-12T12:00:00.000Z" };
    renderWithProviders(
      <AccountDataSettings confirmationEmail confirmation={USERNAME} saveFile={saveFile} />,
      { trpc: { account: { exportData: () => exportData as never } } },
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "download your data" }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    expect(await screen.findByText("Download ready")).toBeTruthy();

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    await waitFor(() => expect(screen.queryByText("Download ready")).toBeNull());
  });

  it("goes to the pending page when a step is still finishing", async () => {
    const onDeleted = vi.fn();
    renderWithProviders(<AccountDataSettings confirmationEmail confirmation={USERNAME} onDeleted={onDeleted} />, {
      trpc: { account: { deleteAccount: () => ({ status: "scheduled" as const }) } },
    });
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
    await userEvent.type(within(dialog).getByRole("textbox"), "ann-lee");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete my account" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(true));
  });

  it("cannot be closed while the deletion runs", async () => {
    let finish: (value: { status: "deleted" }) => void = () => undefined;
    const pending = new Promise<{ status: "deleted" }>((resolve) => {
      finish = resolve;
    });
    const onDeleted = vi.fn();
    renderWithProviders(<AccountDataSettings confirmationEmail confirmation={USERNAME} onDeleted={onDeleted} />, {
      trpc: { account: { deleteAccount: () => pending } },
    });
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
    await userEvent.type(within(dialog).getByRole("textbox"), "ann-lee");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete my account" }));

    await waitFor(() => expect(within(dialog).getByRole<HTMLButtonElement>("button", { name: "Cancel" }).disabled).toBe(true));
    expect(within(dialog).queryByRole("button", { name: /close/i })).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Delete your account?" })).toBeTruthy();

    finish({ status: "deleted" });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  });
});

describe("AccountDeletedNotice", () => {
  it("confirms the deletion, mentioning the email only when one is sent", () => {
    const { unmount } = renderWithProviders(<AccountDeletedNotice confirmationEmail />);
    expect(screen.getByRole("heading", { name: "Your account has been deleted" })).toBeTruthy();
    expect(screen.getByText(/We've sent a confirmation to your email/)).toBeTruthy();
    unmount();
    renderWithProviders(<AccountDeletedNotice confirmationEmail={false} />);
    expect(screen.queryByText(/We've sent a confirmation/)).toBeNull();
    expect(screen.getByText(/your events are hidden/)).toBeTruthy();
  });

  it("while a step is still finishing, says only what has happened", () => {
    renderWithProviders(<AccountDeletedNotice confirmationEmail pending />);
    expect(screen.getByRole("heading", { name: "We're deleting your account" })).toBeTruthy();
    expect(screen.getByText(/Your profile is already hidden; the rest\s+completes within the hour/)).toBeTruthy();
    expect(screen.queryByText(/cancelled|confirmation|gone from ISO/)).toBeNull();
  });
});

describe("Privacy choices in Settings", () => {
  it("opens the preferences dialog", async () => {
    renderWithProviders(
      <>
        <AccountDataSettings confirmationEmail confirmation={USERNAME} />
        <ConsentBanner optInRequired={false} />
      </>,
    );
    const buttons = await screen.findAllByRole("button", { name: "Privacy choices" });
    await userEvent.click(buttons[0]!);
    expect(screen.getByRole("dialog", { name: "Privacy choices" })).toBeTruthy();
  });
});
