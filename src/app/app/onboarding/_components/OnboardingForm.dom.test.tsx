// @vitest-environment happy-dom
//
// Onboarding: the welcome screen, three steps that each check their own
// fields (and whether the username is free) before moving on, then one save
// that sends the profile, the photographer, the Discover setting and the
// photo in that order. A refused username sends the member back to its
// step; a failure before the profile exists is said above the form; what
// fails after it exists is a warning that does not stop them reaching the
// plan step.

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testRouter } from "~/test/dom/navigation";
import { allowConsoleError, renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import { testSession } from "~/test/dom/session";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));
vi.mock("next-auth/react", () => import("~/test/dom/session"));
// happy-dom has no layout: the cropper reports its area once per image,
// as react-easy-crop does after loading it (see AvatarStep.dom.test.tsx).
vi.mock("react-easy-crop", async () => {
  const { useEffect, useRef } = await import("react");
  function Cropper({ image, onCropComplete }: { image: string; onCropComplete: (area: unknown, pixels: unknown) => void }) {
    const report = useRef(onCropComplete);
    useEffect(() => {
      const area = { height: 100, width: 100, x: 0, y: 0 };
      report.current(area, area);
    }, [image]);
    return <div data-testid="cropper" />;
  }
  return { default: Cropper };
});

import { OnboardingForm, PLAN_STEP_URL } from "./OnboardingForm";

type Handlers = {
  discover?: TrpcHandlers["discover"];
  photographer?: TrpcHandlers["photographer"];
  user?: TrpcHandlers["user"];
};

const USER = {
  city: null,
  country: null,
  email: "ann@example.com",
  firstName: "Ann",
  handle: null,
  id: "user-1",
  lastName: "Lee",
  phone: null,
  state: null,
};

const PRICING = { annualPrice: 99, isFoundingPrice: true, monthlyPrice: 10, standardMonthlyPrice: 15 };

afterEach(() => {
  vi.restoreAllMocks();
});

function renderForm(handlers: Handlers = {}, user: Partial<typeof USER> = {}, initialStage: "welcome" | "plan" = "welcome") {
  testSession.signIn("user-1");
  return renderWithProviders(
    <OnboardingForm initialStage={initialStage} photographerCount={3} pricing={PRICING} user={{ ...USER, ...user }} />,
    {
      trpc: {
        discover: { updatePreferences: () => ({}) as never, ...handlers.discover },
        google: { getAutocompleteLocations: () => [] },
        photographer: {
          create: () => ({}) as never,
          uploadProfileImage: () => ({}) as never,
          ...handlers.photographer,
        },
        user: {
          isHandleAvailable: () => ({ available: true }),
          updateProfile: () => ({}) as never,
          ...handlers.user,
        },
      },
    },
  );
}

const field = (name: string | RegExp) => screen.getByLabelText<HTMLInputElement>(name, { selector: "input" });
const next = () => userEvent.click(screen.getByRole("button", { name: "Next" }));

async function start() {
  await userEvent.click(screen.getByRole("button", { name: "Let's set up your profile" }));
  expect(await screen.findByRole("heading", { name: "The basics" })).toBeTruthy();
}

async function fillBasics(values: { handle?: string; location?: string; phone?: string } = {}) {
  await userEvent.type(field(/^Location/), values.location ?? "Austin, TX");
  if (values.handle) await userEvent.type(field(/^Username/), values.handle);
  if (values.phone) await userEvent.type(field(/^Phone number/), values.phone);
}

async function toBusinessStep(values?: Parameters<typeof fillBasics>[0]) {
  await start();
  await fillBasics(values);
  await next();
  expect(await screen.findByRole("heading", { name: "Your business" })).toBeTruthy();
}

async function toPhotoStep() {
  await toBusinessStep({ handle: "ann_lee", phone: "(512) 555-0100" });
  await userEvent.type(field(/^Business name/), "  Ann Lee Photo ");
  await userEvent.type(field(/^Instagram/), "@annlee");
  await userEvent.type(field(/^Website/), "annlee.com");
  await next();
  expect(await screen.findByRole("heading", { name: "Your photo" })).toBeTruthy();
}

const finish = () => userEvent.click(screen.getByRole("button", { name: "Skip photo and create profile" }));

describe("OnboardingForm", () => {
  it("welcomes the member by name, then shows the first of three steps", async () => {
    renderForm();

    expect(screen.getByRole("heading", { name: "Welcome to ISO, Ann!" })).toBeTruthy();
    await start();
    expect(screen.getByText("Step 1 of 3")).toBeTruthy();
    // A name from the invite is shown, not offered as a field.
    expect(screen.getByText("Ann Lee")).toBeTruthy();
    expect(screen.queryByLabelText(/^First name/)).toBeNull();
  });

  it("asks for a name when the invite had none", async () => {
    renderForm({}, { firstName: "", lastName: "" });
    await start();

    await fillBasics();
    await next();

    expect(await screen.findByText("Enter your first name")).toBeTruthy();
    expect(screen.getByText("Enter your last name")).toBeTruthy();
    expect(document.activeElement).toBe(field(/^First name/));
  });

  it("checks the first step's fields and takes the keyboard to the problem", async () => {
    renderForm();
    await start();

    await next();

    expect(await screen.findByText("Enter the city you're based in")).toBeTruthy();
    expect(document.activeElement).toBe(field(/^Location/));
    expect(screen.getByText("Step 1 of 3")).toBeTruthy();
  });

  it("names every problem on the step at once", async () => {
    renderForm();
    await start();

    await userEvent.type(field(/^Phone number/), "123");
    await next();

    expect(await screen.findByText("Enter the city you're based in")).toBeTruthy();
    expect(screen.getByText("Enter a 10-digit US phone number, or leave this blank")).toBeTruthy();
  });

  // KNOWN GAP (reported, not fixed here): with several problems, focus goes
  // to the first one in STEPS' field list (firstName, lastName, phoneNumber,
  // handle, location), not the first on screen (Location, Username, Phone).
  // A keyboard or screen-reader user lands on Phone, below the Location
  // field that also needs fixing. CreateEventForm keeps its FIELD_ORDER in
  // screen order; STEPS[0].fields should too. Drop `.fails` once it does.
  it.fails("takes the keyboard to the first problem on screen", async () => {
    renderForm();
    await start();

    await userEvent.type(field(/^Phone number/), "123");
    await next();

    await screen.findByText("Enter the city you're based in");
    expect(document.activeElement).toBe(field(/^Location/));
  });

  it("says a username is free while it is typed, and shows the profile link", async () => {
    const view = renderForm();
    await start();

    await userEvent.type(field(/^Username/), "Ann_Lee");

    expect(await screen.findByText("@ann_lee is available.")).toBeTruthy();
    expect(screen.getByText("Your link: localhost:3000/photographer/ann_lee")).toBeTruthy();
    expect(view.callsTo("user.isHandleAvailable")).toEqual([{ handle: "ann_lee" }]);
  });

  it("says a username is taken on the field and does not move on", async () => {
    renderForm({ user: { isHandleAvailable: () => ({ available: false }) } });
    await start();
    await fillBasics({ handle: "taken" });

    expect(await screen.findByText("That username is taken. Try another one.")).toBeTruthy();
    await next();
    expect(screen.getByText("Step 1 of 3")).toBeTruthy();
  });

  it("says what is wrong with a username as soon as the field is left", async () => {
    const view = renderForm();
    await start();

    await userEvent.type(field(/^Username/), "a!");
    await userEvent.tab();

    expect(await screen.findByText("Use at least 3 characters")).toBeTruthy();
    expect(view.callsTo("user.isHandleAvailable")).toEqual([]);
  });

  it("checks the second step, and Back keeps what was typed", async () => {
    renderForm();
    await toBusinessStep();

    await userEvent.type(field(/^Website/), "not a site");
    await userEvent.type(field(/^Instagram/), "bad handle!");
    await next();

    expect(await screen.findByText("Enter your business name. Your own name is fine.")).toBeTruthy();
    expect(screen.getByText("Enter a web address, like yoursite.com")).toBeTruthy();
    expect(screen.getByText("Enter just the handle, like yourhandle")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(field(/^Location/).value).toBe("Austin, TX");
  });

  it("creates the profile in order and moves to the plan step", async () => {
    const view = renderForm();
    await toPhotoStep();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(screen.getByRole("switch", { name: /Show my profile in Discover/ }));
    await next();

    await finish();

    await waitFor(() => expect(testRouter.replace).toHaveBeenCalledWith(PLAN_STEP_URL));
    expect(view.calls.filter((call) => call.type === "mutation").map((call) => call.path)).toEqual([
      "user.updateProfile",
      "photographer.create",
      "discover.updatePreferences",
    ]);
    expect(view.callsTo("user.updateProfile")).toEqual([{ handle: "ann_lee", phone: "5125550100" }]);
    expect(view.callsTo("photographer.create")).toEqual([
      {
        companyName: "Ann Lee Photo",
        facebook: null,
        instagram: "annlee",
        location: "Austin, TX",
        name: "Ann Lee",
        tiktok: null,
        twitter: null,
        vimeo: null,
        website: "https://annlee.com/",
        youtube: null,
      },
    ]);
    expect(view.callsTo("discover.updatePreferences")).toEqual([{ isDiscoverable: false }]);
    expect(testSession.updates).toBe(1);
    expect(screen.queryByRole("heading", { name: "Your photo" })).toBeNull();
  });

  it("sends a typed name, no username and an empty phone when none were given", async () => {
    const view = renderForm({}, { firstName: "", lastName: "" });
    await start();
    await userEvent.type(field(/^First name/), " Bo ");
    await userEvent.type(field(/^Last name/), " Diaz ");
    await fillBasics();
    await next();
    await userEvent.type(field(/^Business name/), "Bo Photo");
    await next();

    await finish();

    await waitFor(() => expect(testRouter.replace).toHaveBeenCalledWith(PLAN_STEP_URL));
    expect(view.callsTo("user.updateProfile")).toEqual([{ firstName: "Bo", handle: undefined, lastName: "Diaz", phone: "" }]);
    expect(view.callsTo("photographer.create")[0]).toMatchObject({ instagram: null, name: "Bo Diaz", website: null });
  });

  it("shows that it is working, with the buttons off, while saving", async () => {
    let finishSave!: () => void;
    renderForm({ user: { updateProfile: () => new Promise((resolve) => (finishSave = () => resolve({} as never))) } });
    await toPhotoStep();

    await finish();

    expect(await screen.findByText("Setting up your profile…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Skip photo and create profile" }).hasAttribute("disabled")).toBe(true);
    finishSave();
    await waitFor(() => expect(testRouter.replace).toHaveBeenCalledWith(PLAN_STEP_URL));
  });

  it("sends the member back to the username when the server refuses it", async () => {
    // The failure path logs with logger.error; that log is expected here.
    allowConsoleError(/Profile update failed during onboarding/);
    const view = renderForm({
      user: {
        updateProfile: () => {
          throw trpcError("CONFLICT", "Handle taken");
        },
      },
    });
    await toPhotoStep();

    await finish();

    expect(await screen.findByRole("heading", { name: "The basics" })).toBeTruthy();
    expect(screen.getByTestId("onboarding-error").textContent).toBe(
      "That username can't be used. Choose a different one to continue.",
    );
    expect(screen.getByText("That username is taken. Try another one.")).toBeTruthy();
    expect(view.callsTo("photographer.create")).toEqual([]);
    expect(testRouter.replace).not.toHaveBeenCalled();
  });

  it("says why when the details cannot be saved, staying on the last step", async () => {
    // The failure path logs with logger.error; that log is expected here.
    allowConsoleError(/Profile update failed during onboarding/);
    const view = renderForm({
      user: {
        updateProfile: () => {
          throw trpcError("INTERNAL_SERVER_ERROR", "db down");
        },
      },
    });
    await toPhotoStep();

    await finish();

    expect((await screen.findByTestId("onboarding-error")).textContent).toBe(
      "We couldn't save your details. Please try again.",
    );
    expect(screen.getByRole("heading", { name: "Your photo" })).toBeTruthy();
    expect(view.callsTo("photographer.create")).toEqual([]);
  });

  it("says why when the profile cannot be created", async () => {
    // The failure path logs with logger.error; that log is expected here.
    allowConsoleError(/Photographer creation failed during onboarding/);
    renderForm({
      photographer: {
        create: () => {
          throw trpcError("INTERNAL_SERVER_ERROR", "db down");
        },
      },
    });
    await toPhotoStep();

    await finish();

    expect((await screen.findByTestId("onboarding-error")).textContent).toBe(
      "We couldn't create your profile. Please try again.",
    );
    expect(testRouter.replace).not.toHaveBeenCalled();
  });

  it("still finishes when the Discover setting is not saved, with a warning", async () => {
    // The failure path logs with logger.error; that log is expected here.
    allowConsoleError(/Saving discoverability failed during onboarding/);
    renderForm({
      discover: {
        updatePreferences: () => {
          throw trpcError("INTERNAL_SERVER_ERROR", "db down");
        },
      },
    });
    await toPhotoStep();

    await finish();

    expect(await screen.findByText("One setting wasn't saved")).toBeTruthy();
    expect(screen.getByText("We couldn't save your Discover visibility. You can set it on the Discover page.")).toBeTruthy();
    await waitFor(() => expect(testRouter.replace).toHaveBeenCalledWith(PLAN_STEP_URL));
  });

  describe("with a photo", () => {
    function stubCanvas() {
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as RenderingContext);
      vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
        callback(new Blob(["jpeg"], { type: "image/jpeg" })),
      );
    }

    async function choosePhoto() {
      await userEvent.upload(screen.getByLabelText("Profile photo"), new File(["hello"], "me.png", { type: "image/png" }));
      await screen.findByTestId("cropper");
      // While cropping, "Use this photo" is the only primary action.
      expect(screen.queryByRole("button", { name: /create profile/ })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Use this photo" }));
      return screen.findByRole("button", { name: "Create profile" });
    }

    it("uploads the cropped photo after the profile is created", async () => {
      stubCanvas();
      const view = renderForm();
      await toPhotoStep();

      await userEvent.click(await choosePhoto());

      await waitFor(() => expect(testRouter.replace).toHaveBeenCalledWith(PLAN_STEP_URL));
      expect(view.calls.filter((call) => call.type === "mutation").map((call) => call.path)).toEqual([
        "user.updateProfile",
        "photographer.create",
        "discover.updatePreferences",
        "photographer.uploadProfileImage",
      ]);
      // "jpeg", base64.
      expect(view.callsTo("photographer.uploadProfileImage")).toEqual([{ image: "anBlZw==" }]);
    });

    it("still finishes when the photo is refused, saying why", async () => {
      // The failure path logs with logger.error; that log is expected here.
      allowConsoleError(/Avatar upload failed during onboarding/);
      stubCanvas();
      renderForm({
        photographer: {
          uploadProfileImage: () => {
            throw trpcError("PAYLOAD_TOO_LARGE", "Request entity too large");
          },
        },
      });
      await toPhotoStep();

      await userEvent.click(await choosePhoto());

      expect(await screen.findByText("Photo not uploaded")).toBeTruthy();
      expect(screen.getByText(/^Your profile is ready, but the photo didn't upload\. That image is larger than/)).toBeTruthy();
      await waitFor(() => expect(testRouter.replace).toHaveBeenCalledWith(PLAN_STEP_URL));
    });
  });

  it("opens on the plan step when the profile already exists", () => {
    renderWithProviders(
      <OnboardingForm initialStage="plan" photographerCount={3} pricing={PRICING} user={USER} />,
    );

    expect(screen.queryByRole("heading", { name: "The basics" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Welcome to ISO/ })).toBeNull();
  });

  it("says how Pro renews before checkout, with the yearly total for an annual plan", async () => {
    renderWithProviders(
      <OnboardingForm initialStage="plan" photographerCount={3} pricing={PRICING} user={USER} />,
    );
    expect(screen.getByTestId("renewal-terms").textContent).toBe(
      "Renews automatically every month at $10 until you cancel. Cancel anytime in Settings → Current plan → Manage subscription.",
    );

    await userEvent.click(screen.getByRole("radio", { name: /Annual/ }));
    expect(screen.getByTestId("pro-price").textContent).toBe("$99/year");
    expect(screen.getByTestId("renewal-terms").textContent).toMatch(/every year at \$99/);
    expect(screen.getByRole("button", { name: "Upgrade to Pro — $99/year" })).toBeTruthy();
  });
});
