import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env file
config();

const rawUrl = process.env.DATABASE_URL ?? "file:./dev.db";

console.log(`Seeding database at: ${rawUrl}`);

// Use better-sqlite3 for file: URLs, LibSQL for remote URLs
const adapter = rawUrl.startsWith("file:")
  ? new PrismaBetterSqlite3({ url: rawUrl })
  : new PrismaLibSql({ url: rawUrl });

const db = new PrismaClient({ adapter });

async function main() {
  console.log("Clearing seed data (preserving real accounts)...");

  // Only delete seed users (identified by @example.com email)
  const seedUsers = await db.user.findMany({
    where: { email: { endsWith: "@example.com" } },
    select: { id: true },
  });
  const seedUserIds = seedUsers.map((u) => u.id);

  if (seedUserIds.length > 0) {
    // Delete in dependency order, scoped to seed users
    await db.commentLike.deleteMany({ where: { user: { id: { in: seedUserIds } } } });
    await db.comment.deleteMany({ where: { userId: { in: seedUserIds } } });
    await db.eventLike.deleteMany({ where: { userId: { in: seedUserIds } } });
    await db.booking.deleteMany({ where: { OR: [{ applicantId: { in: seedUserIds } }, { ownerId: { in: seedUserIds } }] } });
    await db.notification.deleteMany({ where: { recipientId: { in: seedUserIds } } });
    await db.referral.deleteMany({ where: { OR: [{ referrerId: { in: seedUserIds } }, { referredId: { in: seedUserIds } }] } });
    await db.review.deleteMany({ where: { userId: { in: seedUserIds } } });
    await db.event.deleteMany({ where: { photographer: { userId: { in: seedUserIds } } } });
    await db.message.deleteMany({ where: { senderId: { in: seedUserIds } } });
    await db.messageThread.deleteMany({ where: { participants: { some: { id: { in: seedUserIds } } } } });
    await db.portfolioImage.deleteMany({ where: { photographer: { userId: { in: seedUserIds } } } });
    await db.favorite.deleteMany({ where: { userId: { in: seedUserIds } } });
    await db.photographer.deleteMany({ where: { userId: { in: seedUserIds } } });
    await db.session.deleteMany({ where: { userId: { in: seedUserIds } } });
    await db.account.deleteMany({ where: { userId: { in: seedUserIds } } });
    await db.subscription.deleteMany({ where: { userId: { in: seedUserIds } } });
    await db.user.deleteMany({ where: { id: { in: seedUserIds } } });
  }

  console.log(`Cleared ${seedUserIds.length} seed users`);

  console.log("Creating users...");

  const users = await Promise.all([
    db.user.create({
      data: {
        firstName: "Sarah",
        lastName: "Chen",
        email: "sarah@example.com",
        handle: "sarahchen",
        phone: "555-0101",
        city: "Austin",
        state: "TX",
        country: "US",
      },
    }),
    db.user.create({
      data: {
        firstName: "Marcus",
        lastName: "Rivera",
        email: "marcus@example.com",
        handle: "marcusrivera",
        phone: "555-0102",
        city: "Denver",
        state: "CO",
        country: "US",
      },
    }),
    db.user.create({
      data: {
        firstName: "Aisha",
        lastName: "Patel",
        email: "aisha@example.com",
        handle: "aishapatel",
        phone: "555-0103",
        city: "Portland",
        state: "OR",
        country: "US",
      },
    }),
    db.user.create({
      data: {
        firstName: "James",
        lastName: "O'Brien",
        email: "james@example.com",
        handle: "jamesobrien",
        phone: "555-0104",
        city: "Nashville",
        state: "TN",
        country: "US",
      },
    }),
    db.user.create({
      data: {
        firstName: "Yuki",
        lastName: "Tanaka",
        email: "yuki@example.com",
        handle: "yukitanaka",
        phone: "555-0105",
        city: "Seattle",
        state: "WA",
        country: "US",
      },
    }),
    db.user.create({
      data: {
        firstName: "Elena",
        lastName: "Kowalski",
        email: "elena@example.com",
        handle: "elenakowalski",
        phone: "555-0106",
        city: "Chicago",
        state: "IL",
        country: "US",
      },
    }),
  ]);

  console.log(`Created ${users.length} users`);

  console.log("Creating photographer profiles...");

  const photographers = await Promise.all([
    db.photographer.create({
      data: {
        userId: users[0]!.id,
        name: "Sarah Chen",
        companyName: "Chen Photography Co.",
        location: "Austin, TX",
        bio: "Wedding and portrait photographer with 8 years of experience capturing authentic moments. I specialize in natural light photography and documentary-style storytelling. Based in Austin but available for destination shoots.",
        website: "https://chenphotography.example.com",
        instagram: "https://instagram.com/sarahchenphotos",
        twitter: "https://x.com/sarahchenphotos",
      },
    }),
    db.photographer.create({
      data: {
        userId: users[1]!.id,
        name: "Marcus Rivera",
        companyName: "Rivera Visual Studio",
        location: "Denver, CO",
        bio: "Adventure and elopement photographer based in the Colorado Rockies. Whether it's a mountaintop ceremony or a forest engagement session, I'm there to capture the wild beauty of your love story.",
        website: "https://riveravisual.example.com",
        instagram: "https://instagram.com/riveravisual",
        youtube: "https://youtube.com/@riveravisual",
      },
    }),
    db.photographer.create({
      data: {
        userId: users[2]!.id,
        name: "Aisha Patel",
        companyName: "Luminous Frame",
        location: "Portland, OR",
        bio: "Editorial and fashion photographer with a focus on bold, colorful imagery. I bring a fashion-forward perspective to weddings and events, creating images that feel both timeless and contemporary.",
        website: "https://luminousframe.example.com",
        instagram: "https://instagram.com/luminousframe",
        tiktok: "https://tiktok.com/@luminousframe",
      },
    }),
    db.photographer.create({
      data: {
        userId: users[3]!.id,
        name: "James O'Brien",
        companyName: "O'Brien Photo",
        location: "Nashville, TN",
        bio: "Music and event photographer who brings concert energy to every shoot. From album covers to festival coverage, I capture the rhythm and soul of Nashville's creative scene.",
        website: "https://obrienphotography.example.com",
        facebook: "https://facebook.com/obrienphotography",
        vimeo: "https://vimeo.com/obrienphotography",
      },
    }),
    db.photographer.create({
      data: {
        userId: users[4]!.id,
        name: "Yuki Tanaka",
        companyName: "Tanaka Creative",
        location: "Seattle, WA",
        bio: "Minimalist wedding photographer specializing in intimate ceremonies and micro-weddings. I believe the best photos come from genuine connections and quiet, beautiful moments.",
        website: "https://tanakacreative.example.com",
        instagram: "https://instagram.com/tanakacreative",
      },
    }),
    db.photographer.create({
      data: {
        userId: users[5]!.id,
        name: "Elena Kowalski",
        companyName: "Kowalski Studios",
        location: "Chicago, IL",
        bio: "Architectural and real estate photographer turned wedding photographer. My background in spaces and structures gives me a unique eye for venue shots and environmental portraits.",
        website: "https://kowalskistudios.example.com",
        instagram: "https://instagram.com/kowalskistudios",
        twitter: "https://x.com/kowalskistudios",
        youtube: "https://youtube.com/@kowalskistudios",
      },
    }),
  ]);

  console.log(`Created ${photographers.length} photographer profiles`);

  console.log("Creating events...");

  const now = new Date();

  const events = await Promise.all([
    // Upcoming events
    db.event.create({
      data: {
        photographerId: photographers[0]!.id,
        title: "Spring Wedding at Barton Creek — Need Second Shooter",
        description:
          "200-guest outdoor wedding at a vineyard venue along Barton Creek. Looking for a second shooter comfortable with natural light and candid reception coverage. Ceremony at 4pm, reception until 11pm.",
        location: "Austin, TX",
        date: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // 1 week out
        duration: 8,
      },
    }),
    db.event.create({
      data: {
        photographerId: photographers[1]!.id,
        title: "Mountain Elopement — Assistant Needed",
        description:
          "Sunrise elopement at Rocky Mountain National Park. Need someone who's comfortable hiking 3+ miles with gear. We'll meet at the trailhead at 4am. Incredible views guaranteed.",
        location: "Estes Park, CO",
        date: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000), // 10 days
        duration: 6,
      },
    }),
    db.event.create({
      data: {
        photographerId: photographers[2]!.id,
        title: "Fashion Editorial Shoot — Looking for BTS Photographer",
        description:
          "Two-day fashion editorial for a Portland-based clothing brand. Need someone to capture behind-the-scenes content for their social media. Studio and on-location shots.",
        location: "Portland, OR",
        date: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000), // 2 weeks
        duration: 10,
      },
    }),
    db.event.create({
      data: {
        photographerId: photographers[3]!.id,
        title: "Live Music Festival Coverage — 3-Day Event",
        description:
          "Nashville's biggest indie music festival needs photographers! Covering 4 stages over 3 days. Great opportunity to build your portfolio with live music photography. Press passes included.",
        location: "Nashville, TN",
        date: new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000), // 3 weeks
        duration: 12,
      },
    }),
    db.event.create({
      data: {
        photographerId: photographers[4]!.id,
        title: "Intimate Garden Wedding — Second Shooter",
        description:
          "50-person micro-wedding in a private garden. Looking for a second shooter who excels at detail shots and candid guest portraits. Relaxed, low-key vibe.",
        location: "Seattle, WA",
        date: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000), // 5 days
        duration: 5,
      },
    }),
    db.event.create({
      data: {
        photographerId: photographers[5]!.id,
        title: "Corporate Headshot Day — Need Two Assistants",
        description:
          "Full-day corporate headshot session for a tech company. 80+ employees. Need two assistants to help with lighting setup, backdrop changes, and keeping the queue moving.",
        location: "Chicago, IL",
        date: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // 3 days
        duration: 8,
      },
    }),
    db.event.create({
      data: {
        photographerId: photographers[0]!.id,
        title: "Engagement Session at Lady Bird Lake",
        description:
          "Golden hour engagement session along the boardwalk. Couple wants a mix of posed and candid. Looking for someone to help with off-camera flash for a few dramatic shots.",
        location: "Austin, TX",
        date: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000), // 4 days
        duration: 2,
      },
    }),
    db.event.create({
      data: {
        photographerId: photographers[2]!.id,
        title: "Branding Photoshoot for Local Bakery",
        description:
          "Half-day branding session for a popular artisan bakery. Product shots, lifestyle content, and staff portraits. Looking for a food photography enthusiast to assist.",
        location: "Portland, OR",
        date: new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000), // 8 days
        duration: 4,
      },
    }),
    db.event.create({
      data: {
        photographerId: photographers[1]!.id,
        title: "Winter Formal Wedding — Second Shooter Needed",
        description:
          "Elegant ballroom wedding at The Brown Palace. 300 guests, black-tie affair. Need an experienced second shooter comfortable working in low light with flash.",
        location: "Denver, CO",
        date: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 1 month
        duration: 10,
      },
    }),
    db.event.create({
      data: {
        photographerId: photographers[4]!.id,
        title: "Newborn and Family Portrait Session",
        description:
          "In-home newborn session with the whole family. Looking for an assistant to help with posing, props, and natural light modifiers. Gentle, quiet environment.",
        location: "Seattle, WA",
        date: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000), // 6 days
        duration: 3,
      },
    }),
  ]);

  console.log(`Created ${events.length} events`);

  console.log("Creating comments on events...");

  await Promise.all([
    db.comment.create({
      data: {
        eventId: events[0]!.id,
        userId: users[1]!.id,
        content: "I'm available! I've shot several weddings in the Austin area. Would love to chat about the details.",
      },
    }),
    db.comment.create({
      data: {
        eventId: events[0]!.id,
        userId: users[4]!.id,
        content: "Beautiful venue! Is there parking for the second shooter or should I plan for rideshare?",
      },
    }),
    db.comment.create({
      data: {
        eventId: events[1]!.id,
        userId: users[2]!.id,
        content: "This sounds incredible! I'm a strong hiker and have all-weather gear. What lens kit are you recommending?",
      },
    }),
    db.comment.create({
      data: {
        eventId: events[3]!.id,
        userId: users[0]!.id,
        content: "I've covered festivals before and would love to be part of this. What's the photo pit situation like?",
      },
    }),
    db.comment.create({
      data: {
        eventId: events[3]!.id,
        userId: users[5]!.id,
        content: "This is a dream gig! Available all 3 days. Happy to share my live music portfolio.",
      },
    }),
    db.comment.create({
      data: {
        eventId: events[4]!.id,
        userId: users[3]!.id,
        content: "I specialize in intimate weddings. This sounds right up my alley!",
      },
    }),
    db.comment.create({
      data: {
        eventId: events[5]!.id,
        userId: users[2]!.id,
        content: "I have experience with high-volume headshot days. What lighting setup are you planning?",
      },
    }),
  ]);

  console.log("Created 7 comments");

  console.log("Creating message threads...");

  const thread1 = await db.messageThread.create({
    data: {
      participants: {
        connect: [{ id: users[0]!.id }, { id: users[1]!.id }],
      },
    },
  });

  const thread2 = await db.messageThread.create({
    data: {
      participants: {
        connect: [{ id: users[0]!.id }, { id: users[2]!.id }],
      },
    },
  });

  await Promise.all([
    db.message.create({
      data: {
        threadId: thread1.id,
        senderId: users[1]!.id,
        content: "Hey Sarah! I saw your post about the Barton Creek wedding. I'd love to be your second shooter.",
        isRead: true,
      },
    }),
    db.message.create({
      data: {
        threadId: thread1.id,
        senderId: users[0]!.id,
        content: "Hi Marcus! Thanks for reaching out. Your adventure portfolio is stunning. Have you shot weddings before?",
        isRead: true,
      },
    }),
    db.message.create({
      data: {
        threadId: thread1.id,
        senderId: users[1]!.id,
        content: "Absolutely — I've second-shot about 20 weddings in the past two years. I can send you some samples if you'd like!",
        isRead: false,
      },
    }),
    db.message.create({
      data: {
        threadId: thread2.id,
        senderId: users[2]!.id,
        content: "Hi Sarah! Love your work. Would you ever be interested in collaborating on a styled shoot? I have some ideas for an editorial series.",
        isRead: true,
      },
    }),
    db.message.create({
      data: {
        threadId: thread2.id,
        senderId: users[0]!.id,
        content: "That sounds amazing, Aisha! I'm always down for creative collabs. What did you have in mind?",
        isRead: false,
      },
    }),
  ]);

  console.log("Created 2 message threads with messages");

  console.log("Creating favorites...");

  await Promise.all([
    db.favorite.create({
      data: { userId: users[0]!.id, targetId: photographers[1]!.id },
    }),
    db.favorite.create({
      data: { userId: users[0]!.id, targetId: photographers[2]!.id },
    }),
    db.favorite.create({
      data: { userId: users[1]!.id, targetId: photographers[0]!.id },
    }),
    db.favorite.create({
      data: { userId: users[3]!.id, targetId: photographers[4]!.id },
    }),
  ]);

  console.log("Created 4 favorites");

  // --- Real user interactions ---
  // Find any real (non-seed) users with photographer profiles
  const realUsers = await db.user.findMany({
    where: { email: { not: { endsWith: "@example.com" } } },
    include: { photographer: true },
  });

  let realBookingCount = 0;
  let realThreadCount = 0;
  let realNotificationCount = 0;

  for (const realUser of realUsers) {
    if (!realUser.photographer) continue;

    console.log(`Creating seed data for real user: ${realUser.firstName} ${realUser.lastName}`);

    // --- Bookings ---
    // 1. Someone applied to the Austin events (real user is the event owner for Austin events)
    //    Actually, the Austin events belong to Sarah (seed user). Let's create bookings
    //    where the real user applied to events, and where seed users applied to any events
    //    the real user owns.

    // Real user applied to the Barton Creek wedding (Austin event by Sarah)
    const austinEvent = events[0]!; // Spring Wedding at Barton Creek
    const ladyBirdEvent = events[6]!; // Engagement Session at Lady Bird Lake

    await db.booking.create({
      data: {
        eventId: austinEvent.id,
        applicantId: realUser.id,
        ownerId: users[0]!.id, // Sarah owns the event
        status: "accepted",
        rate: "$75/hr",
        notes: "I'd love to second shoot this! I know the Barton Creek area well and have shot several weddings there.",
        ownerNotes: "Great portfolio! You're in. Let's connect the week before to go over the shot list.",
      },
    });

    // Real user applied to Lady Bird Lake engagement (also Sarah's)
    await db.booking.create({
      data: {
        eventId: ladyBirdEvent.id,
        applicantId: realUser.id,
        ownerId: users[0]!.id,
        status: "applied",
        rate: "$50 flat",
        notes: "Happy to help with off-camera flash — I have a couple of Godox AD200s.",
      },
    });

    // Marcus applied to real user's hypothetical event (create one for the real user)
    const realUserEvent = await db.event.create({
      data: {
        photographerId: realUser.photographer.id,
        title: "Family Portrait Mini-Sessions at Zilker Park",
        description:
          "Running back-to-back 20-minute family portrait sessions in Zilker Park. Need a second shooter to handle candid shots while I direct poses. 8 families booked so far.",
        location: realUser.photographer.location,
        date: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000), // 12 days out
        duration: 4,
      },
    });

    // Seed users apply to the real user's event
    await db.booking.create({
      data: {
        eventId: realUserEvent.id,
        applicantId: users[1]!.id, // Marcus
        ownerId: realUser.id,
        status: "applied",
        rate: "$60/hr",
        notes: "I love family sessions! I'm great with kids and can keep energy high between sessions.",
      },
    });

    await db.booking.create({
      data: {
        eventId: realUserEvent.id,
        applicantId: users[4]!.id, // Yuki
        ownerId: realUser.id,
        status: "applied",
        rate: "Negotiable",
        notes: "I specialize in natural light portraits — this sounds perfect for my style. Happy to travel from Seattle!",
      },
    });

    // A completed booking from a past-ish event
    await db.booking.create({
      data: {
        eventId: events[5]!.id, // Corporate Headshot Day (Chicago, Elena's)
        applicantId: realUser.id,
        ownerId: users[5]!.id,
        status: "completed",
        rate: "$200 flat",
        notes: "I have studio lighting experience and can help keep things moving.",
        ownerNotes: "Fantastic work! Would love to hire you again.",
      },
    });

    realBookingCount = 6;

    // --- Messages ---
    // Thread with Sarah about the Barton Creek wedding
    const threadWithSarah = await db.messageThread.create({
      data: {
        participants: { connect: [{ id: realUser.id }, { id: users[0]!.id }] },
      },
    });

    await db.message.create({
      data: {
        threadId: threadWithSarah.id,
        senderId: users[0]!.id,
        content: `Hey ${realUser.firstName}! Thanks for applying to second shoot the Barton Creek wedding. Your portfolio looks great — love your natural light work!`,
        isRead: true,
      },
    });
    await db.message.create({
      data: {
        threadId: threadWithSarah.id,
        senderId: realUser.id,
        content: "Thanks Sarah! I'm really excited about this one. The venue looks incredible. What's the timeline looking like?",
        isRead: true,
      },
    });
    await db.message.create({
      data: {
        threadId: threadWithSarah.id,
        senderId: users[0]!.id,
        content: "Ceremony at 4pm, cocktail hour at 5, reception 6-11. I'll send over the full shot list next week. Can you bring a 70-200?",
        isRead: true,
      },
    });
    await db.message.create({
      data: {
        threadId: threadWithSarah.id,
        senderId: realUser.id,
        content: "Absolutely, I've got the 70-200 f/2.8. I'll also bring my 35mm for candids during the reception. Looking forward to it!",
        isRead: true,
      },
    });

    // Thread with Marcus about collaborating
    const threadWithMarcus = await db.messageThread.create({
      data: {
        participants: { connect: [{ id: realUser.id }, { id: users[1]!.id }] },
      },
    });

    await db.message.create({
      data: {
        threadId: threadWithMarcus.id,
        senderId: users[1]!.id,
        content: `Hi ${realUser.firstName}! I saw your mini-sessions event posting. I'm based in Denver but I'm actually going to be in Austin that week visiting family. Would love to help out!`,
        isRead: true,
      },
    });
    await db.message.create({
      data: {
        threadId: threadWithMarcus.id,
        senderId: realUser.id,
        content: "Oh perfect timing Marcus! Your adventure photography background would bring a great energy to the sessions. What's your rate looking like?",
        isRead: false,
      },
    });

    // Thread with Aisha — unread message
    const threadWithAisha = await db.messageThread.create({
      data: {
        participants: { connect: [{ id: realUser.id }, { id: users[2]!.id }] },
      },
    });

    await db.message.create({
      data: {
        threadId: threadWithAisha.id,
        senderId: users[2]!.id,
        content: `Hey ${realUser.firstName}! I came across your profile and love your work. I'm planning a styled shoot in Austin next month — any interest in collaborating? I'm thinking desert-bohemian vibes at a ranch venue.`,
        isRead: false,
      },
    });

    realThreadCount = 3;

    // --- Notifications ---
    await Promise.all([
      db.notification.create({
        data: {
          recipientId: realUser.id,
          type: "booking_accepted",
          title: "Application Accepted!",
          body: "Sarah Chen accepted your application for \"Spring Wedding at Barton Creek\"",
          linkUrl: "/app/bookings",
          isRead: true,
        },
      }),
      db.notification.create({
        data: {
          recipientId: realUser.id,
          type: "booking_applied",
          title: "New Application",
          body: "Marcus Rivera applied to your event \"Family Portrait Mini-Sessions at Zilker Park\"",
          linkUrl: "/app/bookings",
          isRead: false,
        },
      }),
      db.notification.create({
        data: {
          recipientId: realUser.id,
          type: "booking_applied",
          title: "New Application",
          body: "Yuki Tanaka applied to your event \"Family Portrait Mini-Sessions at Zilker Park\"",
          linkUrl: "/app/bookings",
          isRead: false,
        },
      }),
      db.notification.create({
        data: {
          recipientId: realUser.id,
          type: "new_message",
          title: "New Message",
          body: "Aisha Patel sent you a message about a styled shoot collaboration",
          linkUrl: "/app/messages",
          isRead: false,
        },
      }),
      db.notification.create({
        data: {
          recipientId: realUser.id,
          type: "booking_completed",
          title: "Booking Completed",
          body: "Your booking for \"Corporate Headshot Day\" has been marked as completed",
          linkUrl: "/app/bookings",
          isRead: true,
        },
      }),
    ]);

    realNotificationCount = 5;
  }

  console.log(realUsers.length > 0
    ? `Created interactions for ${realUsers.length} real user(s): ${realBookingCount} bookings, ${realThreadCount} threads, ${realNotificationCount} notifications`
    : "No real users found — skipping user interactions"
  );

  console.log("\nSeed complete!");
  console.log(`  ${users.length} seed users`);
  console.log(`  ${photographers.length} seed photographers`);
  console.log(`  ${events.length + (realUsers.length > 0 ? 1 : 0)} events`);
  console.log(`  7 comments`);
  console.log(`  ${2 + realThreadCount} message threads`);
  console.log(`  4 favorites`);
  console.log(`  ${realBookingCount} bookings`);
  console.log(`  ${realNotificationCount} notifications`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
