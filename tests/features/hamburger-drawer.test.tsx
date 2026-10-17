import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HamburgerDrawer } from "@/components/layout/hamburger-drawer";

let pathname = "/admin";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

// The drawer binds `setViewMode` into `<form action>`. Test React (18, not the
// Next canary) only accepts a string there, so the bound action is a URL stub.
vi.mock("@/app/actions/view-mode", () => ({
  setViewMode: { bind: () => "/view-mode" },
}));

function renderDrawer(onClose = vi.fn()) {
  render(
    <HamburgerDrawer
      userName="Sarah Chen"
      homeHref="/admin"
      topLinks={[
        { href: "/admin/schedule", label: "Schedule" },
        { href: "/admin/workers", label: "Workers" },
      ]}
      moreLinks={[{ href: "/admin/departments", label: "Departments" }]}
      role="ADMIN"
      viewMode="ADMIN"
      onClose={onClose}
    />
  );
  return onClose;
}

describe("HamburgerDrawer", () => {
  beforeEach(() => {
    pathname = "/admin";
  });

  it("is a labelled modal dialog that takes focus when it opens", () => {
    renderDrawer();
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(dialog);
  });

  it("closes on Escape", () => {
    const onClose = renderDrawer();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("highlights the current page, not always Home", () => {
    pathname = "/admin/workers";
    renderDrawer();
    expect(screen.getByRole("link", { name: "Workers" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("returns focus to the opener when it closes", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const { unmount } = render(
      <HamburgerDrawer
        userName="Maria Santos"
        homeHref="/worker"
        moreLinks={[]}
        role="STAFF"
        viewMode="WORKER"
        onClose={onClose}
      />
    );
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
