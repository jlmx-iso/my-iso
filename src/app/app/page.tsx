import { Avatar } from "@mantine/core";

type ProfilePhotoProps = {
  photoUrl?: string;
  userFullName?: string;
  size?: "sm" | "md" | "lg";
};

export default function Page({
  photoUrl,
  userFullName,
  size = "md",
}: ProfilePhotoProps) {
  const alt = userFullName ?? "Profile Photo";
  return <Avatar src={photoUrl} alt={alt} size={size} radius="xl" />;
};
