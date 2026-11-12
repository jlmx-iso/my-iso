// @vitest-environment happy-dom
//
// A photographer's portfolio grid: what visitors see, and the owner's
// controls (feature, reorder, edit, delete) with the calls they send, the
// toasts they show, and failures reported inside the dialog that caused
// them. Dialogs cannot be dismissed while their request is in flight.

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { testRouter } from "~/test/dom/navigation";
import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));

import PortfolioSection from "./PortfolioSection";

type Image = Awaited<ReturnType<NonNullable<NonNullable<TrpcHandlers["photographer"]>["getPortfolioImages"]>>>[number];

const AT = new Date("2030-01-01T00:00:00Z");

function image(id: string, overrides: Partial<Image> = {}): Image {
  return {
    createdAt: AT,
    description: null,
    id,
    image: `https://img.example/${id}.jpg`,
    isFeatured: false,
    photographerId: "ph-1",
    sortOrder: 0,
    tags: "[]",
    title: `Photo ${id}`,
    updatedAt: AT,
    ...overrides,
  };
}

const IMAGES = [
  image("a", { sortOrder: 0, title: "Golden hour" }),
  image("b", { description: "First dance", sortOrder: 1, tags: '["Wedding","Event"]', title: "Ballroom" }),
  image("c", { isFeatured: true, sortOrder: 2, title: "Hero shot" }),
];

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

function renderSection(options: { images?: Image[]; isOwner: boolean; photographer?: TrpcHandlers["photographer"] }) {
  const images = options.images ?? IMAGES;
  return renderWithProviders(
    <PortfolioSection photographerId="ph-1" initialImages={images} isOwner={options.isOwner} />,
    {
      trpc: {
        photographer: {
          getPortfolioImages: () => images,
          ...options.photographer,
        },
      },
    },
  );
}

const cardTitles = () =>
  within(screen.getByRole("list", { name: "Portfolio images" }))
    .getAllByRole("button", { name: /^View / })
    .map((button) => button.getAttribute("aria-label"));

async function openActions(title: string) {
  await userEvent.click(screen.getByRole("button", { name: `Actions for ${title}` }));
  return screen.findByRole("dialog", { name: `Actions for ${title}` });
}

describe("visitors", () => {
  it("says the photographer has no images yet, with no controls", () => {
    renderSection({ images: [], isOwner: false });

    expect(screen.getByText("This photographer hasn't added portfolio images yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upload image" })).toBeNull();
  });

  it("shows featured images first, then by order, and no owner actions", () => {
    renderSection({ isOwner: false });

    expect(cardTitles()).toEqual(["View Hero shot", "View Golden hour", "View Ballroom"]);
    expect(screen.getByText("Featured")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload image" })).toBeNull();
  });

  it("opens an image with its description and tags, and closes it with Escape", async () => {
    renderSection({ isOwner: false });

    await userEvent.click(screen.getByRole("button", { name: "View Ballroom" }));

    const dialog = await screen.findByRole("dialog", { name: "Ballroom" });
    expect(within(dialog).getByRole("img", { name: "Ballroom" })).toBeTruthy();
    expect(within(dialog).getByText("First dance")).toBeTruthy();
    expect(within(dialog).getByText("Wedding")).toBeTruthy();
    expect(within(dialog).getByText("Event")).toBeTruthy();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ballroom" })).toBeNull());
  });

  it("names an image that fails to load instead of showing a broken picture", async () => {
    renderSection({ images: [image("a", { title: "Golden hour" })], isOwner: false });

    const picture = within(screen.getByRole("button", { name: "View Golden hour" })).getByRole("img");
    fireEvent.error(picture);

    expect(await screen.findByText("Golden hour (image unavailable)")).toBeTruthy();
  });
});

describe("owner", () => {
  it("invites a first upload when the portfolio is empty", () => {
    renderSection({ images: [], isOwner: true });

    expect(screen.getByText("Add your first portfolio image")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Upload image" })).toHaveLength(1);
  });

  it("features an image: sends the change, refreshes the grid and the page, and confirms", async () => {
    const view = renderSection({
      isOwner: true,
      photographer: { updatePortfolioImage: () => ({}) as never },
    });

    // The server-rendered images are refetched once on mount.
    await waitFor(() => expect(view.callsTo("photographer.getPortfolioImages")).toHaveLength(1));

    const actions = await openActions("Golden hour");
    await userEvent.click(within(actions).getByRole("button", { name: "Feature" }));

    expect(await screen.findByText('"Golden hour" now appears at the top of your portfolio.')).toBeTruthy();
    expect(screen.getByText("Image featured")).toBeTruthy();
    expect(view.callsTo("photographer.updatePortfolioImage")).toEqual([{ id: "a", isFeatured: true }]);
    expect(view.callsTo("photographer.getPortfolioImages")).toEqual([{ photographerId: "ph-1" }, { photographerId: "ph-1" }]);
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("removes an image from featured", async () => {
    const view = renderSection({
      isOwner: true,
      photographer: { updatePortfolioImage: () => ({}) as never },
    });

    const actions = await openActions("Hero shot");
    await userEvent.click(within(actions).getByRole("button", { name: "Remove from featured" }));

    expect(await screen.findByText('"Hero shot" is no longer featured.')).toBeTruthy();
    expect(view.callsTo("photographer.updatePortfolioImage")).toEqual([{ id: "c", isFeatured: false }]);
  });

  it("says so when featuring fails, and does not refresh", async () => {
    renderSection({
      isOwner: true,
      photographer: {
        updatePortfolioImage: () => {
          throw trpcError("NOT_FOUND", "Portfolio image not found");
        },
      },
    });

    const actions = await openActions("Golden hour");
    await userEvent.click(within(actions).getByRole("button", { name: "Feature" }));

    expect(await screen.findByText("Couldn't update image")).toBeTruthy();
    expect(screen.getByText("Portfolio image not found")).toBeTruthy();
    expect(testRouter.refresh).not.toHaveBeenCalled();
  });

  it("moves an image within its group only, sending every image's new position", async () => {
    const view = renderSection({
      isOwner: true,
      photographer: { reorderPortfolioImages: () => ({ success: true }) as never },
    });

    // The featured image is alone in its group: it cannot move.
    let actions = await openActions("Hero shot");
    expect(within(actions).getByRole("button", { name: "Move earlier" }).hasAttribute("disabled")).toBe(true);
    expect(within(actions).getByRole("button", { name: "Move later" }).hasAttribute("disabled")).toBe(true);
    await userEvent.keyboard("{Escape}");

    actions = await openActions("Golden hour");
    expect(within(actions).getByRole("button", { name: "Move earlier" }).hasAttribute("disabled")).toBe(true);
    await userEvent.click(within(actions).getByRole("button", { name: "Move later" }));

    await waitFor(() =>
      expect(view.callsTo("photographer.reorderPortfolioImages")).toEqual([
        {
          images: [
            { id: "c", sortOrder: 0 },
            { id: "b", sortOrder: 1 },
            { id: "a", sortOrder: 2 },
          ],
        },
      ]),
    );
    await waitFor(() => expect(testRouter.refresh).toHaveBeenCalledTimes(1));
  });

  it("says so when a reorder fails", async () => {
    renderSection({
      isOwner: true,
      photographer: {
        reorderPortfolioImages: () => {
          throw trpcError("INTERNAL_SERVER_ERROR", "db down");
        },
      },
    });

    const actions = await openActions("Ballroom");
    await userEvent.click(within(actions).getByRole("button", { name: "Move earlier" }));

    expect(await screen.findByText("Couldn't reorder images")).toBeTruthy();
    expect(screen.getByText("Please try again.")).toBeTruthy();
  });

  describe("editing", () => {
    async function openEdit(title: string) {
      const actions = await openActions(title);
      await userEvent.click(within(actions).getByRole("button", { name: "Edit details" }));
      return screen.findByRole("dialog", { name: "Edit image details" });
    }

    it("starts from the image's details and saves the trimmed changes", async () => {
      const view = renderSection({
        isOwner: true,
        photographer: { updatePortfolioImage: () => ({}) as never },
      });

      const dialog = await openEdit("Ballroom");
      const title = within(dialog).getByRole("textbox", { name: "Title" });
      const description = within(dialog).getByRole("textbox", { name: "Description" });
      expect((title as HTMLInputElement).value).toBe("Ballroom");
      expect((description as HTMLTextAreaElement).value).toBe("First dance");

      await userEvent.clear(title);
      await userEvent.type(title, "  Grand ballroom  ");
      await userEvent.clear(description);
      await userEvent.type(description, "   ");
      await userEvent.click(within(dialog).getByRole("checkbox", { name: /Feature this image/ }));
      await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

      expect(await screen.findByText("Image updated")).toBeTruthy();
      expect(view.callsTo("photographer.updatePortfolioImage")).toEqual([
        { description: null, id: "b", isFeatured: true, tags: ["Wedding", "Event"], title: "Grand ballroom" },
      ]);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit image details" })).toBeNull());
      expect(testRouter.refresh).toHaveBeenCalledTimes(1);
    });

    it("asks for a title before sending anything", async () => {
      const view = renderSection({ isOwner: true });

      const dialog = await openEdit("Ballroom");
      await userEvent.clear(within(dialog).getByRole("textbox", { name: "Title" }));
      await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

      expect(await within(dialog).findByText("Give the image a title")).toBeTruthy();
      expect(view.callsTo("photographer.updatePortfolioImage")).toEqual([]);
    });

    it("cannot be dismissed while saving, then shows the failure inside the dialog", async () => {
      const save = deferred<never>();
      renderSection({
        isOwner: true,
        photographer: { updatePortfolioImage: () => save.promise },
      });

      const dialog = await openEdit("Golden hour");
      await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

      await waitFor(() =>
        expect(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true),
      );
      expect(within(dialog).queryByRole("button", { name: /close/i })).toBeNull();
      await userEvent.keyboard("{Escape}");
      expect(screen.getByRole("dialog", { name: "Edit image details" })).toBeTruthy();

      save.reject(trpcError("NOT_FOUND", "Portfolio image not found"));

      const alert = await within(dialog).findByTestId("dialog-error");
      expect(alert.textContent).toContain("Couldn't save changes");
      expect(alert.textContent).toContain("Portfolio image not found");
      // Inside the dialog, not a toast on top of it.
      expect(document.querySelectorAll(".mantine-Notification-root")).toHaveLength(0);
      expect(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(false);
      expect(testRouter.refresh).not.toHaveBeenCalled();
    });

    it("closes with Cancel without sending anything", async () => {
      const view = renderSection({ isOwner: true });

      const dialog = await openEdit("Golden hour");
      await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit image details" })).toBeNull());
      expect(view.callsTo("photographer.updatePortfolioImage")).toEqual([]);
    });
  });

  describe("deleting", () => {
    async function openDelete(title: string) {
      const actions = await openActions(title);
      await userEvent.click(within(actions).getByRole("button", { name: "Delete" }));
      return screen.findByRole("dialog", { name: "Delete this image?" });
    }

    it("asks first, with Keep image focused, and keeping sends nothing", async () => {
      const view = renderSection({ isOwner: true });

      const dialog = await openDelete("Ballroom");
      expect(within(dialog).getByText(/“Ballroom” will be removed from your portfolio/)).toBeTruthy();
      await waitFor(() => expect(document.activeElement?.textContent).toBe("Keep image"));

      await userEvent.click(within(dialog).getByRole("button", { name: "Keep image" }));

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete this image?" })).toBeNull());
      expect(view.callsTo("photographer.deletePortfolioImage")).toEqual([]);
    });

    it("deletes the image, refreshes, and confirms", async () => {
      const view = renderSection({
        isOwner: true,
        photographer: { deletePortfolioImage: () => ({}) as never },
      });

      const dialog = await openDelete("Ballroom");
      await userEvent.click(within(dialog).getByRole("button", { name: "Delete image" }));

      expect(await screen.findByText('"Ballroom" was removed from your portfolio.')).toBeTruthy();
      expect(view.callsTo("photographer.deletePortfolioImage")).toEqual([{ id: "b" }]);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete this image?" })).toBeNull());
      expect(testRouter.refresh).toHaveBeenCalledTimes(1);
    });

    it("cannot be dismissed while deleting, then shows the failure inside the dialog", async () => {
      const removal = deferred<never>();
      renderSection({
        isOwner: true,
        photographer: { deletePortfolioImage: () => removal.promise },
      });

      const dialog = await openDelete("Ballroom");
      await userEvent.click(within(dialog).getByRole("button", { name: "Delete image" }));

      await waitFor(() =>
        expect(within(dialog).getByRole("button", { name: "Keep image" }).hasAttribute("disabled")).toBe(true),
      );
      await userEvent.keyboard("{Escape}");
      expect(screen.getByRole("dialog", { name: "Delete this image?" })).toBeTruthy();

      removal.reject(trpcError("INTERNAL_SERVER_ERROR", "db down"));

      const alert = await within(dialog).findByTestId("dialog-error");
      expect(alert.textContent).toContain("Couldn't delete image");
      expect(alert.textContent).toContain("The image wasn't deleted. Please try again.");
      expect(testRouter.refresh).not.toHaveBeenCalled();
    });
  });
});
