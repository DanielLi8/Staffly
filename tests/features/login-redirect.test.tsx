import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { safeCallbackPath } from "@/lib/safe-redirect";

/**
 * Review finding F4: `/login?callbackUrl=https://phish.example/` sent a nurse
 * from the genuine sign-in page straight to an attacker's lookalike after a
 * successful login. Only same-origin paths may be followed.
 */

const push = vi.fn();
let query = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(query),
}));

const signIn = vi.fn();
vi.mock("next-auth/react", () => ({ signIn: (...args: unknown[]) => signIn(...args) }));

import { LoginForm } from "@/features/auth/login-form";

async function signInWith(callbackUrl: string) {
  query = new URLSearchParams({ callbackUrl }).toString();
  render(<LoginForm />);
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "worker1@staffly.com" } });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "worker123" } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  await waitFor(() => expect(push).toHaveBeenCalled());
  return push.mock.calls[0][0] as string;
}

describe("login redirect (F4)", () => {
  beforeEach(() => {
    push.mockReset();
    signIn.mockReset();
    signIn.mockResolvedValue({ ok: true, error: null });
  });

  it("follows a same-origin path", async () => {
    expect(await signInWith("/worker/schedule")).toBe("/worker/schedule");
    expect(signIn.mock.calls[0][1]).toMatchObject({ callbackUrl: "/worker/schedule" });
  });

  it("never leaves the site after sign-in", async () => {
    expect(await signInWith("https://staffly-login.example/")).toBe("/");
    expect(signIn.mock.calls[0][1]).toMatchObject({ callbackUrl: "/" });
  });
});

describe("safeCallbackPath", () => {
  it.each([
    ["/admin", "/admin"],
    ["/worker/shifts/abc?tab=bids#top", "/worker/shifts/abc?tab=bids#top"],
  ])("keeps the same-origin path %s", (raw, expected) => {
    expect(safeCallbackPath(raw)).toBe(expected);
  });

  it.each([
    null,
    "",
    "https://evil.example/",
    "http:/evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "javascript:alert(1)",
    "evil.example",
  ])("falls back to / for %j", (raw) => {
    expect(safeCallbackPath(raw)).toBe("/");
  });
});
