import { type NextRequest } from "next/server";
import Stripe from "stripe";
import { logger } from "~/_utils";
import { env } from "~/env";
import { db } from "~/server/db";

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

export const useStripe = () => stripe;

const handler = async (req: NextRequest) => {

  // const customer: Stripe.Customer = await stripe.customers.create(params);
  // lookup customer by email in db
  // if customer exists, return customer
  // if customer doesn't exist, create customer in db
  const customer = await req.json() as { id: string, data: { object: Record<string, string> } };
  const customerEmail = customer.data.object.email;

  if (!customerEmail) {
    const error = new Error("Email is required");
    return new Response(error.message, {
      status: 400,
    });
  }

  let customerInDb;
  try {
    customerInDb = await db.user.update({
      where: {
        email: customerEmail,

      },
      data: {
        stripeId: customer.id,
      },
    });
  } catch (err: unknown) {
    return new Response("Something bad", { status: 500, statusText: "Internal Server Error" });
  }
  logger.info("Customer in db", customerInDb);
  return new Response("ok", { status: 200 });

}

export { handler as GET, handler as POST }