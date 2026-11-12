import { describe, expect, it } from "vitest";

import { MAX_EVENT_PAY_CENTS, formatPay, payCentsToDollars, payDollarsToCents, payError } from "./eventPay";

describe("formatPay", () => {
  it("writes whole dollars without cents and other amounts with them", () => {
    expect(formatPay(45_000)).toBe("$450");
    expect(formatPay(120_000)).toBe("$1,200");
    expect(formatPay(8_750)).toBe("$87.50");
    expect(formatPay(0)).toBe("$0");
  });

  it("has nothing to show for no pay or a value that is not an amount", () => {
    expect(formatPay(null)).toBeNull();
    expect(formatPay(undefined)).toBeNull();
    expect(formatPay(-100)).toBeNull();
    expect(formatPay(1.5)).toBeNull();
  });
});

describe("payDollarsToCents and payCentsToDollars", () => {
  it("round-trip the form's dollars and the stored cents", () => {
    expect(payDollarsToCents(450)).toBe(45_000);
    expect(payDollarsToCents("87.5")).toBe(8_750);
    // Floating point: 19.99 * 100 is 1998.9999…
    expect(payDollarsToCents(19.99)).toBe(1_999);
    expect(payCentsToDollars(45_000)).toBe(450);
  });

  it("treat an empty field as no listed pay", () => {
    expect(payDollarsToCents("")).toBeNull();
    expect(payDollarsToCents(null)).toBeNull();
    expect(payDollarsToCents(undefined)).toBeNull();
    expect(payDollarsToCents("abc")).toBeNull();
    expect(payCentsToDollars(null)).toBe("");
    expect(payCentsToDollars(undefined)).toBe("");
  });
});

describe("payError", () => {
  it("accepts empty and sensible amounts", () => {
    expect(payError("")).toBeNull();
    expect(payError(null)).toBeNull();
    expect(payError(0)).toBeNull();
    expect(payError(450)).toBeNull();
    expect(payError("87.50")).toBeNull();
    expect(payError(MAX_EVENT_PAY_CENTS / 100)).toBeNull();
  });

  it("says what to type instead", () => {
    expect(payError("lots")).toBe("Enter the pay as a number of dollars, like 450");
    expect(payError(-1)).toBe("Pay can't be negative. Leave it empty if you'd rather discuss it");
    expect(payError(10.555)).toBe("Use at most two decimal places, like 87.50");
    expect(payError(MAX_EVENT_PAY_CENTS / 100 + 1)).toBe("Enter an amount up to $100,000");
  });
});
