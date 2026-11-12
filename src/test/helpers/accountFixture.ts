// A member with something in every table that can hold their data, and a
// second member they interact with. Shared by the account export and
// deletion tests, so both look at the same, complete picture.

import type { TestDb } from "./sqlite";
import { createTestUser } from "./sqlite";

export const CLOUD = "test-cloud";
export const image = (path: string) => `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${path}.jpg`;

export async function seedAccount(db: TestDb["db"]) {
  const other = await createTestUser(db, { firstName: "Bea", lastName: "Other" });
  const otherPhotographer = await db.photographer.create({
    data: { companyName: "Other Studio", location: "Austin, TX", name: "Bea Other", userId: other.id },
  });

  const member = await createTestUser(db, { firstName: "Ann", lastName: "Lee" });
  await db.user.update({
    data: {
      city: "Austin",
      handle: `ann-${member.id.slice(-6)}`,
      invitedByUserId: other.id,
      isDiscoverable: true,
      phone: "+15125550100",
      profilePic: image(`${member.id}/profile/me`),
      seekingTypes: JSON.stringify(["wedding"]),
      stripeId: `cus_${member.id}`,
    },
    where: { id: member.id },
  });
  const photographer = await db.photographer.create({
    data: {
      avatar: image(`${member.id}/profile/avatar`),
      bio: "Wedding photographer.",
      companyName: "Lee Studio",
      instagram: "annlee",
      location: "Austin, TX",
      name: "Ann Lee",
      userId: member.id,
    },
  });
  await db.portfolioImage.create({
    data: {
      image: image(`${member.id}/portfolio/one`),
      isFeatured: true,
      photographerId: photographer.id,
      tags: JSON.stringify(["wedding"]),
      title: "First dance",
    },
  });
  await db.portfolioImage.create({
    data: {
      image: image(`${member.id}/portfolio/removed`),
      isDeleted: true,
      isFeatured: false,
      photographerId: photographer.id,
      tags: "[]",
      title: "Removed earlier",
    },
  });

  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  // The member's event, with an application from the other member.
  const ownEvent = await db.event.create({
    data: {
      date: future,
      description: "Second shooter wanted.",
      image: image(`app/${photographer.id}/events/cover`),
      location: "Austin, TX",
      photographerId: photographer.id,
      title: "Smith wedding",
    },
  });
  const applicationToMember = await db.booking.create({
    data: {
      applicantId: other.id,
      eventId: ownEvent.id,
      notes: "Happy to help.",
      ownerId: member.id,
      ownerNotes: "Great, see you there.",
      status: "accepted",
    },
  });
  // The other member's event, with an application from the member.
  const otherEvent = await db.event.create({
    data: { date: future, location: "Dallas, TX", photographerId: otherPhotographer.id, title: "Jones wedding" },
  });
  const memberApplication = await db.booking.create({
    data: {
      applicantId: member.id,
      eventId: otherEvent.id,
      notes: "I shoot on Sony.",
      ownerId: other.id,
      status: "applied",
    },
  });

  // Pro insights counts of their profile and event.
  await db.profileView.create({ data: { count: 3, day: "2026-11-01", source: "search", userId: member.id } });
  await db.eventView.create({ data: { count: 2, day: "2026-11-01", eventId: ownEvent.id } });

  const comment = await db.comment.create({
    data: { content: "Call me on 555 0100", eventId: otherEvent.id, userId: member.id },
  });
  const otherComment = await db.comment.create({
    data: { content: "Nice event", eventId: ownEvent.id, userId: other.id },
  });
  await db.commentLike.create({ data: { commentId: otherComment.id, userId: member.id } });
  await db.eventLike.create({ data: { eventId: otherEvent.id, userId: member.id } });
  await db.favorite.create({ data: { targetId: otherPhotographer.id, userId: member.id } });
  await db.favorite.create({ data: { targetId: photographer.id, userId: other.id } });

  // Reviews both ways.
  const reviewWritten = await db.review.create({
    data: { photographerId: otherPhotographer.id, rating: 5, title: "Great to work with", userId: member.id },
  });
  await db.review.create({
    data: { description: "Ann was great.", photographerId: photographer.id, rating: 4, title: "Solid", userId: other.id },
  });

  // A match and a conversation with messages both ways.
  const thread = await db.messageThread.create({
    data: { participants: { connect: [{ id: member.id }, { id: other.id }] } },
  });
  const sent = await db.message.create({ data: { content: "Hi Bea!", senderId: member.id, threadId: thread.id } });
  const received = await db.message.create({ data: { content: "Hi Ann!", senderId: other.id, threadId: thread.id } });
  await db.threadRead.create({ data: { lastReadAt: new Date(), threadId: thread.id, userId: member.id } });
  await db.swipe.create({ data: { direction: "like", swiperId: member.id, targetId: other.id } });
  await db.swipe.create({ data: { direction: "like", swiperId: other.id, targetId: member.id } });
  await db.match.create({
    data: {
      aiSummary: "Both shoot weddings in Texas.",
      icebreakers: JSON.stringify(["Ask about film"]),
      messageThreadId: thread.id,
      user1Id: member.id,
      user2Id: other.id,
    },
  });

  await db.notification.create({
    data: { body: "Bea applied", recipientId: member.id, title: "New application", type: "booking_applied" },
  });
  const otherNotification = await db.notification.create({
    data: { body: "Ann applied", recipientId: other.id, title: "New application", type: "booking_applied" },
  });
  // As booking.ts writes it: the member named, the booking in `data`.
  const namingNotification = await db.notification.create({
    data: {
      body: `Ann Lee applied to "Jones wedding".`,
      data: JSON.stringify({ bookingId: memberApplication.id, eventId: otherEvent.id }),
      recipientId: other.id,
      title: "New application",
      type: "booking_applied",
    },
  });

  const inviteCode = await db.inviteCode.create({
    data: { code: `ISO-ANN-${member.id.slice(-8).toUpperCase()}`, creatorId: member.id, currentRedemptions: 1 },
  });
  const otherCode = await db.inviteCode.create({ data: { code: `ISO-BEA-${other.id.slice(-8).toUpperCase()}`, creatorId: other.id } });
  await db.inviteRedemption.create({ data: { inviteCodeId: otherCode.id, redeemedById: member.id } });

  await db.waitlist.create({ data: { email: member.email, instagram: "annlee", name: "Ann Lee" } });
  await db.account.create({
    data: { access_token: "secret-token", provider: "google", providerAccountId: `g-${member.id}`, type: "oidc", userId: member.id },
  });
  await db.session.create({
    data: { expires: future, sessionToken: `session-${member.id}`, userId: member.id },
  });
  await db.verificationToken.create({
    data: { expires: future, identifier: `otp:${member.email}`, token: "123456" },
  });
  await db.pendingInviteValidation.create({
    data: { code: otherCode.code, email: member.email, expiresAt: future },
  });

  const now = new Date();
  await db.subscription.create({
    data: {
      currentPeriodEnd: future,
      currentPeriodStart: now,
      interval: "month",
      isActive: true,
      isCanceled: false,
      isExpired: false,
      isLifetime: false,
      isPaused: false,
      isPending: false,
      isTrial: false,
      plan: "standard",
      status: "active",
      stripeCustomerId: `cus_${member.id}`,
      subscriptionId: `sub_${member.id}`,
      userId: member.id,
    },
  });

  return {
    applicationToMember,
    comment,
    inviteCode,
    member: await db.user.findUniqueOrThrow({ where: { id: member.id } }),
    memberApplication,
    namingNotification,
    other,
    otherEvent,
    otherNotification,
    otherPhotographer,
    ownEvent,
    photographer,
    received,
    reviewWritten,
    sent,
    thread,
  };
}
