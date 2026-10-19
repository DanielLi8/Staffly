import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";

vi.mock("@/app/actions/shifts", () => ({ assignWorker: vi.fn() }));

import { BidderList, NEW_BID_PILL_MS } from "@/features/shifts/bidder-list";
import type { DashboardBidder } from "@/lib/callout/dashboard";

/**
 * When a live refresh brings in bids that weren't there at first render, they
 * get a short-lived "New" pill and a polite screen-reader announcement. Bids
 * already on the page when it loaded are never "new".
 */

function bidder(id: string, name: string, seniorityPosition: number): DashboardBidder {
  return {
    bidId: `bid-${id}`,
    workerId: id,
    name,
    position: "Registered Nurse",
    department: "ICU",
    note: null,
    durationScope: "FULL",
    status: "PENDING",
    createdAt: new Date(),
    seniorityPosition,
    overtime: {
      assignedHours: 0,
      shiftHours: 12,
      projectedHours: 12,
      thresholdHours: 44,
      overtimeHours: 0,
      isOvertime: false,
    },
  } as DashboardBidder;
}

const priya = bidder("w5", "Priya Sharma", 1);
const david = bidder("w2", "David Kim", 1);
const maria = bidder("w1", "Maria Santos", 2);

function rowOf(name: string): HTMLElement {
  return screen.getByText(name, { selector: "span" }).closest("div.flex.items-start") as HTMLElement;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BidderList live arrivals", () => {
  it("never flags bids that were there at first render", () => {
    render(<BidderList shiftId="s1" bidders={[priya]} shiftOpen />);
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("flags and announces a bid that arrives on a refresh, then drops the pill", () => {
    const view = render(<BidderList shiftId="s1" bidders={[priya]} shiftOpen />);
    view.rerender(<BidderList shiftId="s1" bidders={[david, { ...priya, seniorityPosition: 2 }]} shiftOpen />);

    expect(within(rowOf("David Kim")).getByText("New")).toBeInTheDocument();
    expect(within(rowOf("Priya Sharma")).queryByText("New")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("New bid from David Kim");

    act(() => {
      vi.advanceTimersByTime(NEW_BID_PILL_MS - 1);
    });
    expect(within(rowOf("David Kim")).getByText("New")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("New")).not.toBeInTheDocument();
  });

  it("announces from an empty list too (the live region is always mounted)", () => {
    const view = render(<BidderList shiftId="s1" bidders={[]} shiftOpen />);
    const region = screen.getByRole("status");
    expect(screen.getByText("No bids have been submitted yet.")).toBeInTheDocument();

    view.rerender(<BidderList shiftId="s1" bidders={[david, maria]} shiftOpen />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("New bids from David Kim, Maria Santos");
    expect(screen.getAllByText("New")).toHaveLength(2);
  });

  it("keeps each pill for its own full minute", () => {
    const view = render(<BidderList shiftId="s1" bidders={[]} shiftOpen />);
    view.rerender(<BidderList shiftId="s1" bidders={[david]} shiftOpen />);
    act(() => {
      vi.advanceTimersByTime(40_000);
    });
    view.rerender(<BidderList shiftId="s1" bidders={[david, maria]} shiftOpen />);
    expect(screen.getByRole("status")).toHaveTextContent("New bid from Maria Santos");

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(within(rowOf("David Kim")).queryByText("New")).not.toBeInTheDocument();
    expect(within(rowOf("Maria Santos")).getByText("New")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(40_000);
    });
    expect(screen.queryByText("New")).not.toBeInTheDocument();
  });

  it("does not re-flag a bid that is merely updated (same bid id)", () => {
    const view = render(<BidderList shiftId="s1" bidders={[david]} shiftOpen />);
    view.rerender(<BidderList shiftId="s1" bidders={[{ ...david, note: "Can stay late" }]} shiftOpen />);
    expect(screen.queryByText("New")).not.toBeInTheDocument();
  });
});
