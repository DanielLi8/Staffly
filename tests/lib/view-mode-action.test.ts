import { describe, it, expect, vi, beforeEach } from "vitest";

const cookieStoreMock = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => cookieStoreMock }));

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const requireActorMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ requireActor: requireActorMock }));

import { setViewMode } from "@/app/actions/view-mode";
import { VIEW_MODE_COOKIE } from "@/lib/view-mode";

describe("setViewMode", () => {
  beforeEach(() => {
    cookieStoreMock.set.mockClear();
    redirectMock.mockClear();
    requireActorMock.mockReset();
  });

  it("requires an ADMIN actor before touching anything", async () => {
    requireActorMock.mockResolvedValue({ id: "u1", role: "ADMIN" });

    await setViewMode("WORKER");

    expect(requireActorMock).toHaveBeenCalledWith("ADMIN");
  });

  it("persists the flipped view state to the cookie", async () => {
    requireActorMock.mockResolvedValue({ id: "u1", role: "ADMIN" });

    await setViewMode("WORKER");

    expect(cookieStoreMock.set).toHaveBeenCalledWith(
      VIEW_MODE_COOKIE,
      "WORKER",
      expect.objectContaining({ httpOnly: true, path: "/" })
    );
  });

  it("redirects to the new view's home", async () => {
    requireActorMock.mockResolvedValue({ id: "u1", role: "ADMIN" });

    await setViewMode("WORKER");
    expect(redirectMock).toHaveBeenCalledWith("/worker");

    await setViewMode("ADMIN");
    expect(redirectMock).toHaveBeenCalledWith("/admin");
  });

  it("propagates rejection for a non-ADMIN actor and never sets the cookie", async () => {
    requireActorMock.mockRejectedValue(new Error("FORBIDDEN"));

    await expect(setViewMode("WORKER")).rejects.toThrow("FORBIDDEN");
    expect(cookieStoreMock.set).not.toHaveBeenCalled();
  });
});
