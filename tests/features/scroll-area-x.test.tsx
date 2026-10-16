import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScrollAreaX } from "@/components/ui/scroll-area-x";

/** jsdom has no layout, so stub the three scroll metrics the component reads. */
function setMetrics(el: HTMLElement, { scrollLeft, clientWidth, scrollWidth }: Record<string, number>) {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  el.scrollLeft = scrollLeft;
}

function edge(container: HTMLElement, side: "left" | "right") {
  return container.querySelector(`[data-edge="${side}"]`)!.getAttribute("data-visible");
}

describe("ScrollAreaX", () => {
  it("marks hidden overflow on the right, then the left, as the user scrolls", () => {
    const { container } = render(
      <ScrollAreaX label="Department month schedule">
        <div style={{ width: 1000 }}>wide grid</div>
      </ScrollAreaX>
    );
    const region = screen.getByRole("region", { name: "Department month schedule" });

    setMetrics(region, { scrollLeft: 0, clientWidth: 300, scrollWidth: 1000 });
    fireEvent.scroll(region);
    expect(edge(container, "right")).toBe("true");
    expect(edge(container, "left")).toBe("false");

    setMetrics(region, { scrollLeft: 700, clientWidth: 300, scrollWidth: 1000 });
    fireEvent.scroll(region);
    expect(edge(container, "right")).toBe("false");
    expect(edge(container, "left")).toBe("true");
  });

  it("shows no fade when the content fits", () => {
    const { container } = render(
      <ScrollAreaX label="Outreach log">
        <div>narrow</div>
      </ScrollAreaX>
    );
    const region = screen.getByRole("region", { name: "Outreach log" });
    setMetrics(region, { scrollLeft: 0, clientWidth: 300, scrollWidth: 300 });
    fireEvent.scroll(region);
    expect(edge(container, "right")).toBe("false");
    expect(edge(container, "left")).toBe("false");
  });

  it("makes the labelled scroll region keyboard-focusable", () => {
    render(
      <ScrollAreaX label="Department schedule">
        <div>grid</div>
      </ScrollAreaX>
    );
    expect(screen.getByRole("region", { name: "Department schedule" })).toHaveAttribute("tabindex", "0");
  });
});
