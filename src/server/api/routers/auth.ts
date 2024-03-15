import { z } from "zod";
import { createTRPCRouter, publicProcedure, } from "~/server/api/trpc";

export const authRouter = createTRPCRouter({
  register: publicProcedure
    .input(z.object({
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      email: z.string().min(1),
      password: z.string().min(1),
      phone: z.string().min(1),
    }))
    // .mutation(async ({input}) => {
    //   const user = await registerUser(input);
    //   return user;
  // }),
  .mutation(async ({ctx, input}) => {
    return await ctx.db.user.create({
      data: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        accounts: {
          create: {
            password: input.password,
            type: "local",
            provider: "credentials",
            providerAccountId: input.email,
          }
        }
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        accounts: {
          select: {
            id: true,
            provider: true,
            providerAccountId: true,
          }
        }
      }
    });
  }),
});