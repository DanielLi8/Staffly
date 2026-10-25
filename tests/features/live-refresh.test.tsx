import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { LiveRefresh, LiveStatus } from "@/features/live/live-refresh";

/**
 * The live-refresh seam: polls the revision endpoint, refreshes the page only
 * when the revision moves, pauses while the tab is hidden, backs off on
 * errors, and gives up for good on a final 4xx.
 */

type Reply = { status: number; revision?: string } | "network-error";

const TOPIC = "admin-shift:s1";
let replies: Reply[];
let fetchMock: ReturnType<typeof vi.fn>;
let visibility: DocumentVisibilityState;

function queue(...next: Reply[]) {
  replies.push(...next);
}

/** Let pending fetch promises and their state updates settle. */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function mount(initialRevision: string | null = "r1") {
  return render(
    <LiveRefresh topic={TOPIC} initialRevision={initialRevision} intervalMs={3_000}>
      <LiveStatus />
    </LiveRefresh>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  refreshMock.mockReset();
  replies = [];
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  fetchMock = vi.fn(async () => {
    const reply = replies.shift() ?? { status: 200, revision: "r1" };
    if (reply === "network-error") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(reply.revision ? { revision: reply.revision } : {}), {
      status: reply.status,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LiveRefresh", () => {
  it("checks once on mount, then every interval, against the topic's endpoint", async () => {
    mount();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/live/revision?topic=admin-shift%3As1");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });

    await advance(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refreshes only when the revision changes, once per change", async () => {
    queue({ status: 200, revision: "r1" }, { status: 200, revision: "r1" }, { status: 200, revision: "r2" });
    queue({ status: 200, revision: "r2" }, { status: 200, revision: "r3" });
    mount("r1");
    await flush();
    await advance(3_000);
    expect(refreshMock).not.toHaveBeenCalled();

    await advance(3_000); // r2
    expect(refreshMock).toHaveBeenCalledTimes(1);
    await advance(3_000); // r2 again
    expect(refreshMock).toHaveBeenCalledTimes(1);
    await advance(3_000); // r3
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("catches a change that landed between server render and the first check", async () => {
    queue({ status: 200, revision: "r2" });
    mount("r1");
    await flush();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("adopts the revision a refresh re-rendered with, so it does not refresh twice", async () => {
    queue({ status: 200, revision: "r1" });
    const view = mount("r1");
    await flush();
    // The admin's own action re-rendered the page with a newer revision.
    view.rerender(
      <LiveRefresh topic={TOPIC} initialRevision="r5" intervalMs={3_000}>
        <LiveStatus />
      </LiveRefresh>
    );
    queue({ status: 200, revision: "r5" });
    await advance(3_000);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("pauses while the tab is hidden and checks at once when it is shown again", async () => {
    mount();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    queue({ status: 200, revision: "r2" });
    setVisibility("visible");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    await advance(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not reschedule after a check that finishes once the tab is hidden", async () => {
    mount();
    await flush();
    let resolveSlow!: (res: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveSlow = resolve)));
    await advance(3_000); // in flight
    expect(fetchMock).toHaveBeenCalledTimes(2);

    setVisibility("hidden");
    await act(async () => {
      resolveSlow(new Response(JSON.stringify({ revision: "r1" }), { status: 200 }));
    });
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("checks at once on window focus without doubling up the schedule", async () => {
    mount();
    await flush();
    await advance(1_000);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The next tick is a full interval after the focus check, not the old one.
    await advance(2_500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([400, 401, 403, 404])("stops for good on %i", async (status) => {
    queue({ status });
    mount();
    await flush();
    await advance(120_000);
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Live updates paused/)).toBeInTheDocument();
  });

  it("backs off exponentially on errors, then recovers", async () => {
    queue("network-error", { status: 500 }, "network-error");
    mount();
    await flush(); // fail 1 -> retry in 6s
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();

    await advance(5_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1); // fail 2 -> retry in 12s
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await advance(11_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(1); // fail 3 -> retry in 24s
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await advance(24_000); // succeeds -> back to the normal interval
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(screen.getByText(/^Live/)).toBeInTheDocument();
    await advance(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("caps the backoff at a minute", async () => {
    queue(...Array.from({ length: 8 }, () => "network-error" as const));
    mount();
    await flush();
    // 6 + 12 + 24 + 48 = 90s for four retries; the fifth waits the 60s cap.
    await advance(90_000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await advance(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("stops polling when unmounted", async () => {
    const view = mount();
    await flush();
    view.unmount();
    await advance(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("LiveStatus", () => {
  it("says how fresh the page is", async () => {
    mount();
    expect(screen.getByText("Live")).toBeInTheDocument();
    await flush();
    expect(screen.getByText("Live · updated just now")).toBeInTheDocument();

    setVisibility("hidden");
    await advance(20_000);
    expect(screen.getByText("Live · updated 20s ago")).toBeInTheDocument();
    await advance(100_000);
    expect(screen.getByText("Live · updated 2 min ago")).toBeInTheDocument();
  });

  it("renders nothing outside a LiveRefresh", () => {
    const { container } = render(<LiveStatus />);
    expect(container).toBeEmptyDOMElement();
  });
});
