import { ActionIcon, Group } from "@mantine/core";
import {
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandTiktok,
  IconBrandVimeo,
  IconBrandX,
  IconBrandYoutube,
  IconWorld,
} from "@tabler/icons-react";

import { instagramUrl } from "~/_utils/instagram";
import {
  facebookUrl,
  tikTokUrl,
  toSafeWebsiteUrl,
  twitterUrl,
  vimeoUrl,
  youTubeUrl,
} from "~/_utils/social";

type SocialFields = {
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  twitter: string | null;
  youtube: string | null;
  tiktok: string | null;
  vimeo: string | null;
};

const socials: Array<{
  key: keyof SocialFields;
  icon: React.ElementType;
  label: string;
  toUrl: (value: string) => string | null;
}> = [
  { icon: IconWorld, key: "website", label: "Website", toUrl: toSafeWebsiteUrl },
  { icon: IconBrandInstagram, key: "instagram", label: "Instagram", toUrl: instagramUrl },
  { icon: IconBrandFacebook, key: "facebook", label: "Facebook", toUrl: facebookUrl },
  { icon: IconBrandX, key: "twitter", label: "X", toUrl: twitterUrl },
  { icon: IconBrandYoutube, key: "youtube", label: "YouTube", toUrl: youTubeUrl },
  { icon: IconBrandTiktok, key: "tiktok", label: "TikTok", toUrl: tikTokUrl },
  { icon: IconBrandVimeo, key: "vimeo", label: "Vimeo", toUrl: vimeoUrl },
];

/** Icon links to a photographer's website and social profiles. */
export function SocialLinks({ photographer, name }: { photographer: SocialFields; name: string }) {
  const links = socials.flatMap((social) => {
    const value = photographer[social.key];
    const href = value ? social.toUrl(value) : null;
    return href ? [{ ...social, href }] : [];
  });

  if (links.length === 0) return null;

  return (
    <Group gap={4}>
      {links.map(({ key, href, icon: Icon, label }) => (
        <ActionIcon
          key={key}
          component="a"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          variant="subtle"
          color="gray"
          size="lg"
          aria-label={`${name} on ${label} (opens in a new tab)`}
        >
          <Icon size={20} />
        </ActionIcon>
      ))}
    </Group>
  );
}
