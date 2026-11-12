import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import Stripe from "stripe";

import { createStripeClient, STRIPE_API_VERSION } from "~/server/_billing/stripe";

/**
 * A local stand-in for the Stripe API, for tests and end-to-end runs. The
 * REAL Stripe SDK talks to it over HTTP, so request encoding, idempotency
 * keys, error mapping and response parsing are all exercised; only Stripe's
 * servers are replaced. It implements just the endpoints this app calls and
 * keeps its objects in memory, in the shape of API version
 * STRIPE_API_VERSION.
 */

type Json = Record<string, unknown>;

export type StubSubscriptionInput = {
  cancelAt?: number | null;
  cancelAtPeriodEnd?: boolean;
  cancellationReason?: string | null;
  created?: number;
  customer: string;
  endedAt?: number | null;
  id: string;
  interval?: "month" | "year";
  metadata?: Record<string, string>;
  periodEnd?: number;
  periodStart?: number;
  priceId?: string;
  status: string;
};

/** A subscription as the API returns it (the fields this app reads, and the usual rest). */
export function buildSubscription(input: StubSubscriptionInput): Json {
  const created = input.created ?? 1_800_000_000;
  const periodStart = input.periodStart ?? created;
  const periodEnd = input.periodEnd ?? periodStart + 30 * 24 * 60 * 60;
  const priceId = input.priceId ?? "price_standard_monthly";
  return {
    billing_cycle_anchor: created,
    cancel_at: input.cancelAt ?? null,
    cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
    canceled_at: input.status === "canceled" ? (input.endedAt ?? periodEnd) : null,
    cancellation_details: {
      comment: null,
      feedback: null,
      reason: input.cancellationReason ?? null,
    },
    collection_method: "charge_automatically",
    created,
    currency: "usd",
    customer: input.customer,
    ended_at: input.endedAt ?? null,
    id: input.id,
    items: {
      data: [
        {
          created,
          // The billing period lives on the item in this API version.
          current_period_end: periodEnd,
          current_period_start: periodStart,
          id: `si_${input.id}`,
          metadata: {},
          object: "subscription_item",
          price: {
            active: true,
            currency: "usd",
            id: priceId,
            object: "price",
            product: "prod_iso_pro",
            recurring: { interval: input.interval ?? "month", interval_count: 1, usage_type: "licensed" },
            type: "recurring",
            unit_amount: 1900,
          },
          quantity: 1,
          subscription: input.id,
        },
      ],
      has_more: false,
      object: "list",
      url: `/v1/subscription_items?subscription=${input.id}`,
    },
    latest_invoice: `in_${input.id}`,
    livemode: false,
    metadata: input.metadata ?? {},
    object: "subscription",
    pause_collection: null,
    start_date: created,
    status: input.status,
    trial_end: null,
    trial_start: null,
  };
}

/** An invoice of `subscriptionId`, pointing at it the way this API version does. */
export function buildInvoice(input: {
  attemptCount?: number;
  customer: string;
  id: string;
  status: "open" | "paid";
  subscriptionId: string | null;
}): Json {
  return {
    attempt_count: input.attemptCount ?? 1,
    billing_reason: "subscription_cycle",
    customer: input.customer,
    id: input.id,
    livemode: false,
    object: "invoice",
    parent: input.subscriptionId
      ? {
          quote_details: null,
          subscription_details: { metadata: {}, subscription: input.subscriptionId },
          type: "subscription_details",
        }
      : null,
    status: input.status,
  };
}

let eventCounter = 0;

/** A webhook event envelope around `object`. */
export function buildEvent(
  type: string,
  object: Json,
  overrides: { created?: number; id?: string } = {},
): Json {
  eventCounter += 1;
  return {
    api_version: STRIPE_API_VERSION,
    created: overrides.created ?? Math.floor(Date.now() / 1000),
    data: { object },
    id: overrides.id ?? `evt_test_${eventCounter}_${Math.random().toString(36).slice(2, 10)}`,
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
  };
}

/** The body and `Stripe-Signature` header Stripe would send for `event`. */
export async function signEvent(
  event: Json,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): Promise<{ body: string; signature: string }> {
  const body = JSON.stringify(event);
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
    cryptoProvider: Stripe.createSubtleCryptoProvider(),
    payload: body,
    secret,
    timestamp,
  });
  return { body, signature };
}

export type StubRequest = {
  idempotencyKey: string | null;
  method: string;
  params: Record<string, string>;
  path: string;
};

export type StripeStub = {
  /** A real Stripe SDK client pointed at this server (no automatic retries). */
  client: Stripe;
  close: () => Promise<void>;
  customers: Map<string, Json>;
  /** The next `count` requests fail with HTTP `status` (a Stripe outage). */
  failNext: (count: number, status?: number) => void;
  port: number;
  portalSessions: Json[];
  /** Every request received, in order. */
  requests: StubRequest[];
  sessions: Map<string, Json>;
  /** The time the stub reports as Stripe's clock (the `Date` header). */
  setNow: (now: () => Date) => void;
  subscriptions: Map<string, Json>;
  url: string;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const list = (data: Json[], url: string): Json => ({ data, has_more: false, object: "list", url });

class StubError extends Error {
  constructor(
    readonly status: number,
    readonly body: Json,
  ) {
    super("stub error");
  }
}

const missing = (what: string, id: string, param: string) =>
  new StubError(404, {
    error: {
      code: "resource_missing",
      message: `No such ${what}: '${id}'`,
      param,
      type: "invalid_request_error",
    },
  });

export async function startStripeStub(options: { port?: number } = {}): Promise<StripeStub> {
  const customers = new Map<string, Json>();
  const subscriptions = new Map<string, Json>();
  const sessions = new Map<string, Json>();
  const portalSessions: Json[] = [];
  const requests: StubRequest[] = [];
  const idempotent = new Map<string, Json>();
  let failures = { count: 0, status: 500 };
  let now: () => Date = () => new Date();
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}_stub_${(counter += 1)}`;

  const liveCustomer = (id: string, param: string): Json => {
    const customer = customers.get(id);
    if (!customer || customer.deleted === true) throw missing("customer", id, param);
    return customer;
  };

  function route(method: string, path: string, params: Record<string, string>): Json {
    const segments = path.split("/").filter(Boolean).slice(1); // drop "v1"
    const [resource, second, third] = segments;

    if (resource === "customers") {
      if (method === "POST" && !second) {
        const id = nextId("cus");
        const customer: Json = {
          created: Math.floor(now().getTime() / 1000),
          email: params.email ?? null,
          id,
          livemode: false,
          metadata: params["metadata[userId]"] ? { userId: params["metadata[userId]"] } : {},
          object: "customer",
        };
        customers.set(id, customer);
        return customer;
      }
      if (method === "GET" && second) {
        const customer = customers.get(second);
        if (!customer) throw missing("customer", second, "id");
        return customer;
      }
    }

    if (resource === "subscriptions") {
      if (method === "GET" && second) {
        const subscription = subscriptions.get(second);
        if (!subscription) throw missing("subscription", second, "id");
        return subscription;
      }
      if (method === "GET") {
        const customerId = params.customer ?? "";
        liveCustomer(customerId, "customer");
        const data = [...subscriptions.values()]
          .filter((sub) => sub.customer === customerId)
          .filter((sub) => params.status === "all" || sub.status !== "canceled")
          .sort((a, b) => Number(b.created) - Number(a.created));
        return list(data, "/v1/subscriptions");
      }
    }

    if (resource === "checkout" && second === "sessions") {
      const [, , sessionId, action] = segments;
      if (method === "GET" && !sessionId) {
        const customerId = params.customer ?? "";
        liveCustomer(customerId, "customer");
        const data = [...sessions.values()].filter(
          (session) => session.customer === customerId && session.status === (params.status ?? session.status),
        );
        return list(data, "/v1/checkout/sessions");
      }
      if (method === "POST" && !sessionId) {
        liveCustomer(params.customer ?? "", "customer");
        const id = nextId("cs_test");
        const session: Json = {
          cancel_url: params.cancel_url,
          client_reference_id: params.client_reference_id ?? null,
          customer: params.customer,
          id,
          line_items_price: params["line_items[0][price]"],
          livemode: false,
          metadata: params["metadata[userId]"] ? { userId: params["metadata[userId]"] } : {},
          mode: params.mode,
          object: "checkout.session",
          status: "open",
          subscription: null,
          subscription_metadata_user_id: params["subscription_data[metadata][userId]"] ?? null,
          success_url: params.success_url,
          url: `https://checkout.stripe.test/c/pay/${id}`,
        };
        sessions.set(id, session);
        return session;
      }
      if (method === "POST" && sessionId && action === "expire") {
        const session = sessions.get(sessionId);
        if (!session) throw missing("checkout.session", sessionId, "session");
        if (session.status !== "open") {
          throw new StubError(400, {
            error: { message: "Only Checkout Sessions with a status in [\"open\"] can be expired.", type: "invalid_request_error" },
          });
        }
        session.status = "expired";
        return session;
      }
    }

    if (resource === "billing_portal" && second === "sessions" && method === "POST" && !third) {
      liveCustomer(params.customer ?? "", "customer");
      const session: Json = {
        customer: params.customer,
        id: nextId("bps"),
        object: "billing_portal.session",
        return_url: params.return_url,
        url: `https://billing.stripe.test/p/session/${counter}`,
      };
      portalSessions.push(session);
      return session;
    }

    throw new StubError(404, {
      error: { message: `Stripe stub: unhandled ${method} ${path}`, type: "invalid_request_error" },
    });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://stub");
    const method = req.method ?? "GET";
    const body = await readBody(req);
    const params = Object.fromEntries(
      method === "GET" ? url.searchParams.entries() : new URLSearchParams(body).entries(),
    );
    const header = req.headers["idempotency-key"];
    const idempotencyKey = typeof header === "string" ? header : null;
    requests.push({ idempotencyKey, method, params, path: url.pathname });

    const send = (status: number, json: Json) => {
      res.writeHead(status, {
        "content-type": "application/json",
        date: now().toUTCString(),
        "request-id": `req_stub_${requests.length}`,
      });
      res.end(JSON.stringify(json));
    };

    if (failures.count > 0) {
      failures.count -= 1;
      send(failures.status, { error: { message: "Stripe stub: injected failure", type: "api_error" } });
      return;
    }

    // Like Stripe: a repeated POST with the same key replays the first answer.
    const replayKey = method === "POST" && idempotencyKey ? `${url.pathname}:${idempotencyKey}` : null;
    const replay = replayKey ? idempotent.get(replayKey) : undefined;
    if (replay) {
      send(200, replay);
      return;
    }

    try {
      const result = route(method, url.pathname, params);
      if (replayKey) idempotent.set(replayKey, result);
      send(200, result);
    } catch (error) {
      if (error instanceof StubError) send(error.status, error.body);
      else send(500, { error: { message: String(error), type: "api_error" } });
    }
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    client: createStripeClient(
      "sk_test_stub",
      { host: "127.0.0.1", port: String(port), protocol: "http" },
      { maxNetworkRetries: 0 },
    ),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    customers,
    failNext: (count, status = 500) => {
      failures = { count, status };
    },
    port,
    portalSessions,
    requests,
    sessions,
    setNow: (clock) => {
      now = clock;
    },
    subscriptions,
    url: `http://127.0.0.1:${port}`,
  };
}
