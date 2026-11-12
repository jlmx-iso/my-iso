// @vitest-environment happy-dom
// Session replay safety: every element that can show a member's photo or
// what they wrote carries `data-replay-block`, which the recorder replaces
// with an empty box (REPLAY_BLOCK_SELECTOR in ~/_lib/analyticsBrowser). The
// replay configuration itself (all text and inputs masked) is pinned in
// ~/_lib/analyticsBrowser.test.ts. docs/DEPLOYMENT.md, "Session replay",
// lists what must carry the attribute.
import { screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { REPLAY_BLOCK_SELECTOR } from "~/_lib/analyticsBrowser";
import MessageTile from "~/app/app/messages/_components/MessageTile";
import PhotographerCard from "~/app/app/search/_components/PhotographerCard";
import { renderWithProviders } from "~/test/dom/render";

import { Avatar } from "./Avatar";
import EventComment from "./events/EventComment";
import EventCover from "./events/EventCover";
import { PortfolioThumbnail } from "./portfolio/PortfolioThumbnail";
import ProfileHeader from "./profiles/ProfileHeader";

const PHOTO = "https://res.cloudinary.com/test-cloud/image/upload/v1/u/photo.jpg";

/** The closest element replay blocks around `node`, or null. */
const blocked = (node: Element) => node.closest(REPLAY_BLOCK_SELECTOR);

describe("session replay blocks personal content", () => {
  it("avatars with a photo", () => {
    renderWithProviders(<Avatar src={PHOTO} name="Ann Lee" />);
    expect(blocked(screen.getByRole("img", { name: "Ann Lee" }))).not.toBeNull();
  });

  it("portfolio images and event covers", () => {
    const { container } = renderWithProviders(
      <>
        <div style={{ position: "relative", height: 100 }}>
          <PortfolioThumbnail src={PHOTO} alt="Portrait" />
        </div>
        <EventCover src={PHOTO} />
      </>,
    );
    const images = container.querySelectorAll("img");
    expect(images.length).toBe(2);
    for (const image of images) expect(blocked(image)).not.toBeNull();
  });

  it("message bodies", () => {
    renderWithProviders(
      <MessageTile
        isAuthor={false}
        message={{
          content: "My number is 555 0100",
          createdAt: new Date(),
          sender: { firstName: "Ann", id: "u2", lastName: "Lee", profilePic: null },
        }}
      />,
    );
    expect(blocked(screen.getByText(/My number is 555 0100/))).not.toBeNull();
  });

  it("the profile header: bio, avatar and cover", () => {
    const { container } = renderWithProviders(
      <ProfileHeader
        coverImage={PHOTO}
        photographer={{
          avatar: PHOTO,
          bio: "Wedding photographer in Austin.",
          companyName: "Lee Studio",
          facebook: null,
          instagram: null,
          location: "Austin, TX",
          name: "Ann Lee",
          tiktok: null,
          twitter: null,
          vimeo: null,
          website: null,
          youtube: null,
        }}
      />,
    );
    expect(blocked(screen.getByText("Wedding photographer in Austin."))).not.toBeNull();
    for (const image of container.querySelectorAll("img")) expect(blocked(image)).not.toBeNull();
  });

  it("bios and photos in search results", () => {
    const photographer = {
      avatar: PHOTO,
      bio: "Second shooter, film and digital.",
      companyName: "Studio",
      id: "p1",
      location: "Austin, TX",
      name: "Ann Lee",
      portfolioImages: [{ id: "i1", image: PHOTO, title: "Portrait" }],
      user: { firstName: "Ann", id: "u1", lastName: "Lee", profilePic: PHOTO },
      userId: "u1",
    } as unknown as ComponentProps<typeof PhotographerCard>["photographer"];
    const { container } = renderWithProviders(<PhotographerCard photographer={photographer} />);
    expect(blocked(screen.getByText("Second shooter, film and digital."))).not.toBeNull();
    for (const image of container.querySelectorAll("img")) expect(blocked(image)).not.toBeNull();
  });

  it("event comments", async () => {
    const comment = {
      content: "Call me on 555 0100",
      createdAt: new Date(),
      eventId: "e1",
      id: "c1",
      isLiked: false,
      likeCount: 0,
      user: { firstName: "Ann", id: "u2", lastName: "Lee", profilePic: PHOTO },
      userId: "u2",
    } as unknown as ComponentProps<typeof EventComment>["comment"];
    renderWithProviders(<EventComment comment={comment} />, {
      trpc: { event: { getCommentById: () => comment } },
    });
    expect(blocked(await screen.findByText("Call me on 555 0100"))).not.toBeNull();
  });
});
