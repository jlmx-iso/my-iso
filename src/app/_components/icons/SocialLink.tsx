import { IconBrandFacebook, IconBrandInstagram, IconBrandTiktok, IconBrandTwitter, IconBrandVimeo, IconBrandYoutube, IconWorld } from "@tabler/icons-react";
import Link from "next/link";

type BaseSocialIconProps = {
  href: string;
  children: React.ReactNode;
};

type SocialIconProps = {
  href: string;
  size?: number;
};

const BaseSocialIcon = ({ href, children }: BaseSocialIconProps) => {
  return (
    <Link href={href} passHref>
      {children}
    </Link>
  );
};

export const SocialIconWebsite = ({ href, size=24 }: SocialIconProps) => {
  return (
    <BaseSocialIcon href={href}>
      <IconWorld size={size} aria-label="Website" />
    </BaseSocialIcon>
  );
};

export const SocialIconFacebook = ({ href, size=24 }: SocialIconProps) => {
  return (
    <BaseSocialIcon href={href}>
      <IconBrandFacebook size={size} aria-label="Facebook" />
    </BaseSocialIcon>
  );
};

export const SocialIconInstagram = ({ href, size=24 }: SocialIconProps) => {
  return (
    <BaseSocialIcon href={href}>
      <IconBrandInstagram size={size} aria-label="Instagram" />
    </BaseSocialIcon>
  );
};

export const SocialIconTiktok = ({ href, size=24 }: SocialIconProps) => {
  return (
    <BaseSocialIcon href={href}>
      <IconBrandTiktok size={size} aria-label="Tiktok" />
    </BaseSocialIcon>
  );
};

export const SocialIconTwitter = ({ href, size=24 }: SocialIconProps) => {
  return (
    <BaseSocialIcon href={href}>
      <IconBrandTwitter size={size} aria-label="Twitter" />
    </BaseSocialIcon>
  );
};

export const SocialIconVimeo = ({ href, size=24 }: SocialIconProps) => {
  return (
    <BaseSocialIcon href={href}>
      <IconBrandVimeo size={size} aria-label="Vimeo" />
    </BaseSocialIcon>
  );
};

export const SocialIconYoutube = ({ href, size=24 }: SocialIconProps) => {
  return (
    <BaseSocialIcon href={href}>
      <IconBrandYoutube size={size} aria-label="Youtube" />
    </BaseSocialIcon>
  );
};