import argon2 from "argon2";
import { Result } from "src/_utils";


export const hashPassword = async (password: string): Promise<Result<string>> => {
  try {
    const hashedPassword = await argon2.hash(password);
    return Result.ok(hashedPassword);
  } catch (error) {
    return Result.err(error);
  }
}

export const verifyPassword = async (hashedPassword: string, password: string): Promise<Result<boolean>> => {
  try {
    const isPasswordValid = await argon2.verify(hashedPassword, password);
    return Result.ok(isPasswordValid);
  } catch (error) {
    return Result.err(error);
  }
};

