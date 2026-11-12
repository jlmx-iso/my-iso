import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/_lib/posthog", () => ({ captureServerException: vi.fn() }));

import { captureServerException } from "~/server/_lib/posthog";
import { image, seedAccount } from "~/test/helpers/accountFixture";
import { createTestDb, type TestDb } from "~/test/helpers/sqlite";

import {
  anonymiseNotificationsAbout,
  DELETED_MEMBER_NAME,
  deletedAccountEmail,
  type DeletionDeps,
  NOTIFICATION_CHUNK,
  requestAccountDeletion,
  runAccountDeletion,
} from "./deletion";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.close();
});

function fakeDeps() {
  return {
    deleteImages: vi.fn<DeletionDeps["deleteImages"]>(async () => undefined),
    endBilling: vi.fn<DeletionDeps["endBilling"]>(async () => undefined),
    eraseAnalytics: vi.fn<DeletionDeps["eraseAnalytics"]>(async () => "requested" as const),
    revokeRealtime: vi.fn<DeletionDeps["revokeRealtime"]>(async () => undefined),
    sendConfirmation: vi.fn<DeletionDeps["sendConfirmation"]>(async () => undefined),
  };
}

describe("requestAccountDeletion", () => {
  it("closes the account at once, and only once", async () => {
    const { member } = await seedAccount(testDb.db);
    const now = new Date("2026-11-12T10:00:00Z");

    await expect(requestAccountDeletion(testDb.db, member.id, now)).resolves.toBe(true);
    await expect(requestAccountDeletion(testDb.db, member.id)).resolves.toBe(false);

    // Gone for every read through the app's client (this also ends sessions).
    await expect(testDb.db.user.findUnique({ where: { id: member.id } })).resolves.toBeNull();
    const row = await testDb.raw.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(row).toMatchObject({ deletedAt: null, deletionRequestedAt: now, email: member.email, isDeleted: true });
  });
});

describe("runAccountDeletion, end to end", () => {
  let seeded: Awaited<ReturnType<typeof seedAccount>>;
  const calls = {
    cancelled: [] as string[],
    emailed: [] as Array<{ email: string; firstName: string }>,
    erased: [] as string[],
    images: [] as string[][],
    revoked: [] as Array<{ threadIds: string[]; userId: string }>,
  };
  const deps: DeletionDeps = {
    deleteImages: async (urls) => void calls.images.push(urls),
    endBilling: async (id) => void calls.cancelled.push(id),
    eraseAnalytics: async (userId) => {
      calls.erased.push(userId);
      return "requested";
    },
    revokeRealtime: async (userId, threadIds) => void calls.revoked.push({ threadIds, userId }),
    sendConfirmation: async (to) => void calls.emailed.push(to),
  };
  const now = new Date("2026-11-12T12:00:00Z");

  beforeAll(async () => {
    seeded = await seedAccount(testDb.db);
    await requestAccountDeletion(testDb.db, seeded.member.id, now);
    await expect(runAccountDeletion(testDb.db, seeded.member.id, deps, now)).resolves.toBe("finished");
  });

  const raw = () => testDb.raw;

  it("cancels the active Stripe subscription and keeps the billing record", async () => {
    expect(calls.cancelled).toEqual([`sub_${seeded.member.id}`]);
    await expect(raw().subscription.count({ where: { userId: seeded.member.id } })).resolves.toBe(1);
  });

  it("deletes every uploaded image, live or removed earlier", () => {
    const id = seeded.member.id;
    expect(calls.images).toHaveLength(1);
    expect([...(calls.images[0] ?? [])].sort()).toEqual(
      [
        image(`${id}/profile/me`),
        image(`${id}/profile/avatar`),
        image(`${id}/portfolio/one`),
        image(`${id}/portfolio/removed`),
        image(`app/${seeded.photographer.id}/events/cover`),
      ].sort(),
    );
  });

  it("anonymises the account and marks it finished", async () => {
    const user = await raw().user.findUniqueOrThrow({ where: { id: seeded.member.id } });
    expect(user).toMatchObject({
      city: null,
      deletedAt: now,
      email: deletedAccountEmail(seeded.member.id),
      firstName: "Deleted",
      handle: null,
      invitedByUserId: null,
      isDeleted: true,
      isDiscoverable: false,
      lastName: "member",
      phone: null,
      profilePic: null,
      seekingTypes: null,
    });
    // Kept for the billing records Stripe holds.
    expect(user.stripeId).toBe(`cus_${seeded.member.id}`);
  });

  it("anonymises and hides the profile; deletes portfolio and the reviews about them", async () => {
    const profile = await raw().photographer.findUniqueOrThrow({ where: { id: seeded.photographer.id } });
    expect(profile).toMatchObject({
      avatar: null,
      bio: null,
      companyName: "",
      instagram: null,
      isDeleted: true,
      location: "",
      name: DELETED_MEMBER_NAME,
    });
    await expect(raw().portfolioImage.count({ where: { photographerId: seeded.photographer.id } })).resolves.toBe(0);
    await expect(raw().review.count({ where: { photographerId: seeded.photographer.id } })).resolves.toBe(0);
    await expect(raw().favorite.count({ where: { targetId: seeded.photographer.id } })).resolves.toBe(0);
  });

  it("keeps the reviews they wrote, from 'Deleted member'", async () => {
    const review = await raw().review.findUniqueOrThrow({
      include: { user: true },
      where: { id: seeded.reviewWritten.id },
    });
    expect(`${review.user.firstName} ${review.user.lastName}`).toBe(DELETED_MEMBER_NAME);
  });

  it("hides their events but keeps them for the other member's booking history", async () => {
    const event = await raw().event.findUniqueOrThrow({ where: { id: seeded.ownEvent.id } });
    expect(event).toMatchObject({ description: null, image: null, isDeleted: true, title: "Smith wedding" });

    const theirApplication = await raw().booking.findUniqueOrThrow({ where: { id: seeded.applicationToMember.id } });
    expect(theirApplication).toMatchObject({
      cancelOrigin: "canceled_by_owner",
      notes: "Happy to help.",
      ownerNotes: null,
      status: "canceled",
    });
    const ownApplication = await raw().booking.findUniqueOrThrow({ where: { id: seeded.memberApplication.id } });
    expect(ownApplication).toMatchObject({ cancelOrigin: "withdrawn", notes: null, status: "canceled" });
  });

  it("keeps the messages others received, from 'Deleted member', and the other side intact", async () => {
    const thread = await raw().messageThread.findUniqueOrThrow({
      include: { messages: { include: { sender: true }, orderBy: { createdAt: "asc" } }, participants: true },
      where: { id: seeded.thread.id },
    });
    expect(thread.participants.map((p) => p.id).sort()).toEqual([seeded.member.id, seeded.other.id].sort());
    const sent = thread.messages.find((message) => message.id === seeded.sent.id);
    expect(sent?.content).toBe("Hi Bea!");
    expect(`${sent?.sender.firstName} ${sent?.sender.lastName}`).toBe(DELETED_MEMBER_NAME);
    expect(thread.messages.some((message) => message.id === seeded.received.id)).toBe(true);
    await expect(raw().threadRead.count({ where: { userId: seeded.member.id } })).resolves.toBe(0);
  });

  it("deletes their activity, matches, swipes and notifications, and nobody else's", async () => {
    const id = seeded.member.id;
    for (const [table, count] of [
      ["comments", raw().comment.count({ where: { userId: id } })],
      ["comment likes", raw().commentLike.count({ where: { userId: id } })],
      ["event likes", raw().eventLike.count({ where: { userId: id } })],
      ["favorites", raw().favorite.count({ where: { userId: id } })],
      ["swipes", raw().swipe.count({ where: { OR: [{ swiperId: id }, { targetId: id }] } })],
      ["matches", raw().match.count({ where: { OR: [{ user1Id: id }, { user2Id: id }] } })],
      ["notifications", raw().notification.count({ where: { recipientId: id } })],
      ["profile views", raw().profileView.count({ where: { userId: id } })],
      ["event views", raw().eventView.count({ where: { eventId: seeded.ownEvent.id } })],
    ] as const) {
      await expect(count, table).resolves.toBe(0);
    }
    await expect(raw().notification.count({ where: { id: seeded.otherNotification.id } })).resolves.toBe(1);
    await expect(raw().comment.count({ where: { eventId: seeded.ownEvent.id } })).resolves.toBe(1);
  });

  it("disables their invite code and forgets their own invitation", async () => {
    const code = await raw().inviteCode.findUniqueOrThrow({ where: { id: seeded.inviteCode.id } });
    expect(code.maxRedemptions).toBe(0);
    await expect(raw().inviteRedemption.count({ where: { redeemedById: seeded.member.id } })).resolves.toBe(0);
  });

  it("deletes sign-in methods and everything keyed on their address", async () => {
    const { email, id } = seeded.member;
    await expect(raw().account.count({ where: { userId: id } })).resolves.toBe(0);
    await expect(raw().session.count({ where: { userId: id } })).resolves.toBe(0);
    await expect(raw().waitlist.count({ where: { email } })).resolves.toBe(0);
    await expect(raw().pendingInviteValidation.count({ where: { email } })).resolves.toBe(0);
    await expect(raw().verificationToken.count({ where: { identifier: `otp:${email}` } })).resolves.toBe(0);
  });

  it("closes their live chat sockets in every thread they are in", () => {
    expect(calls.revoked).toEqual([{ threadIds: [seeded.thread.id], userId: seeded.member.id }]);
  });

  it("erases their analytics by user id and records nothing skipped", async () => {
    expect(calls.erased).toEqual([seeded.member.id]);
    const row = await raw().user.findUniqueOrThrow({ where: { id: seeded.member.id } });
    expect(row).toMatchObject({ deletionAttempts: 1, deletionAttemptedAt: now, deletionSkipped: null });
  });

  it("rewrites other members' notifications that named them", async () => {
    const notification = await raw().notification.findUniqueOrThrow({ where: { id: seeded.namingNotification.id } });
    expect(notification.body).toBe(`${DELETED_MEMBER_NAME} applied to "Jones wedding".`);
    const other = await raw().notification.findUniqueOrThrow({ where: { id: seeded.otherNotification.id } });
    expect(other.body).toBe("Ann applied");
  });

  it("emails the confirmation to the address they had", () => {
    expect(calls.emailed).toEqual([{ email: seeded.member.email, firstName: "Ann" }]);
  });

  it("does nothing more on a second run", async () => {
    await expect(runAccountDeletion(testDb.db, seeded.member.id, deps, now)).resolves.toBe("not-pending");
    expect(calls.emailed).toHaveLength(1);
  });

  it("leaves the other member's account alone", async () => {
    await expect(testDb.db.user.findUnique({ where: { id: seeded.other.id } })).resolves.not.toBeNull();
  });
});

describe("runAccountDeletion, interrupted and resumed", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing for an account that never asked", async () => {
    const { member } = await seedAccount(testDb.db);
    await expect(runAccountDeletion(testDb.db, member.id, fakeDeps())).resolves.toBe("not-pending");
    await expect(testDb.db.user.findUnique({ where: { id: member.id } })).resolves.not.toBeNull();
  });

  it("stops where a step fails, changes nothing after it, and finishes on the next run", async () => {
    const { member } = await seedAccount(testDb.db);
    await requestAccountDeletion(testDb.db, member.id);
    const deps = fakeDeps();
    deps.deleteImages.mockRejectedValueOnce(new Error("Cloudinary is down"));

    await expect(runAccountDeletion(testDb.db, member.id, deps)).rejects.toThrow("Cloudinary is down");
    // Images first: no row that holds an image URL was touched.
    await expect(testDb.raw.portfolioImage.count({ where: { photographer: { userId: member.id } } })).resolves.toBe(2);
    const halfway = await testDb.raw.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(halfway).toMatchObject({ deletedAt: null, email: member.email, isDeleted: true });
    expect(deps.sendConfirmation).not.toHaveBeenCalled();

    await expect(runAccountDeletion(testDb.db, member.id, deps)).resolves.toBe("finished");
    await expect(testDb.raw.portfolioImage.count({ where: { photographer: { userId: member.id } } })).resolves.toBe(0);
    expect(deps.sendConfirmation).toHaveBeenCalledOnce();
  });

  it("asks Stripe to end billing whatever the stored status says (it may lag behind)", async () => {
    const { member } = await seedAccount(testDb.db);
    await testDb.raw.subscription.update({ data: { status: "canceled" }, where: { userId: member.id } });
    await requestAccountDeletion(testDb.db, member.id);
    const deps = fakeDeps();
    await runAccountDeletion(testDb.db, member.id, deps);
    expect(deps.endBilling).toHaveBeenCalledWith(`sub_${member.id}`);
  });

  it("records and reports a skipped analytics erasure, and still finishes", async () => {
    const { member } = await seedAccount(testDb.db);
    await requestAccountDeletion(testDb.db, member.id);
    const deps = fakeDeps();
    deps.eraseAnalytics.mockResolvedValueOnce("skipped");
    await expect(runAccountDeletion(testDb.db, member.id, deps)).resolves.toBe("finished");
    const row = await testDb.raw.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(row.deletionSkipped).toBe("posthog");
    expect(captureServerException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { $exception_fingerprint: "account-deletion-skipped:posthog", step: "posthog" },
      source: "account-deletion",
    });
  });

  it("deletes an account with no profile, no images and no subscription", async () => {
    const lone = await testDb.db.user.create({ data: { email: `lone-${Date.now()}@example.com`, firstName: "", lastName: "" } });
    await requestAccountDeletion(testDb.db, lone.id);
    const deps = fakeDeps();
    await expect(runAccountDeletion(testDb.db, lone.id, deps)).resolves.toBe("finished");
    expect(deps.deleteImages).not.toHaveBeenCalled();
    expect(deps.endBilling).not.toHaveBeenCalled();
  });

  it("finishes even when the confirmation email cannot be sent", async () => {
    const { member } = await seedAccount(testDb.db);
    await requestAccountDeletion(testDb.db, member.id);
    const deps = fakeDeps();
    deps.sendConfirmation.mockRejectedValueOnce(new Error("Resend is down"));
    await expect(runAccountDeletion(testDb.db, member.id, deps)).resolves.toBe("finished");
    const row = await testDb.raw.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(row.deletedAt).not.toBeNull();
  });

  it("answers not-pending when another run finished first", async () => {
    const { member } = await seedAccount(testDb.db);
    await requestAccountDeletion(testDb.db, member.id);
    const deps = fakeDeps();
    // A concurrent run completes the deletion while this one is busy.
    deps.deleteImages.mockImplementationOnce(async () => {
      await runAccountDeletion(testDb.db, member.id, fakeDeps());
    });
    await expect(runAccountDeletion(testDb.db, member.id, deps)).resolves.toBe("not-pending");
    expect(deps.sendConfirmation).not.toHaveBeenCalled();
  });

  it("rewrites notifications across more bookings than one query takes, and only names", async () => {
    const { createTestUser } = await import("~/test/helpers/sqlite");
    const owner = await createTestUser(testDb.db, { firstName: "Olga", lastName: "Owner" });
    const applicant = await createTestUser(testDb.db, { firstName: "Zed", lastName: "Applicant" });
    const photographer = await testDb.db.photographer.create({ data: { companyName: "", location: "", name: "Olga", userId: owner.id } });
    const count = NOTIFICATION_CHUNK + 5;
    for (let i = 0; i < count; i++) {
      const event = await testDb.db.event.create({ data: { date: new Date(), location: "X", photographerId: photographer.id, title: `E${i}` } });
      const booking = await testDb.db.booking.create({ data: { applicantId: applicant.id, eventId: event.id, ownerId: owner.id } });
      await testDb.db.notification.create({ data: { body: `Zed Applicant applied to "E${i}".`, data: JSON.stringify({ bookingId: booking.id }), recipientId: owner.id, title: "t", type: "booking_applied" } });
    }
    await expect(anonymiseNotificationsAbout(testDb.db, applicant.id, "Zed Applicant")).resolves.toBe(count);
    await expect(anonymiseNotificationsAbout(testDb.db, applicant.id, "Zed Applicant")).resolves.toBe(0);
    await expect(anonymiseNotificationsAbout(testDb.db, applicant.id, "")).resolves.toBe(0);
    const left = await testDb.raw.notification.count({ where: { body: { contains: "Zed" }, recipientId: owner.id } });
    expect(left).toBe(0);
  });
});
