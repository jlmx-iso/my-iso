import { type User } from "@prisma/client";

export type FormattedUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  profilePic: string | null;
};

export const formatUser = (user: User): FormattedUser => {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    profilePic: user.profilePic,
  };
}