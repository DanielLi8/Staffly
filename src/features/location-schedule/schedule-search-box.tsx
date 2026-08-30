"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchScheduleTargets, type ScheduleSearchResults } from "@/app/actions/schedule-search";

type FlatResult =
  | { kind: "staff"; id: string; name: string; position: string | null }
  | { kind: "department"; id: string; name: string; code: string };

/**
 * The search-driven entry point for `/admin/schedule` - there is no
 * department picker sidebar, this box IS the navigation. Matches against
 * both staff names and department names/codes as the admin types, in one
 * grouped "Staff" / "Departments" suggestion list. Built fresh for this page:
 * the header's "Search shifts..." input (`staffly-header.tsx`) is a
 * decorative, read-only redirect-on-focus control for a different surface,
 * not a real search.
 */
export function ScheduleSearchBox({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ScheduleSearchResults>({ staff: [], departments: [] });
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const flat: FlatResult[] = useMemo(
    () => [
      ...results.staff.map((s): FlatResult => ({ kind: "staff", id: s.id, name: s.name, position: s.position })),
      ...results.departments.map((d): FlatResult => ({ kind: "department", id: d.id, name: d.name, code: d.code })),
    ],
    [results]
  );

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleChange(value: string) {
    setQuery(value);
    setHighlighted(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setResults({ staff: [], departments: [] });
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const r = await searchScheduleTargets(trimmed);
        setResults(r);
        setOpen(true);
      });
    }, 200);
  }

  function select(item: FlatResult) {
    setOpen(false);
    const type = item.kind === "staff" ? "staff" : "department";
    router.push(`/admin/schedule?type=${type}&id=${item.id}&view=week`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => (i + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(flat[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const hasResults = flat.length > 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <label className="relative block">
        <span className="sr-only">Search staff or departments</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => hasResults && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search staff or departments..."
          role="combobox"
          aria-expanded={open}
          aria-controls="schedule-search-results"
          aria-autocomplete="list"
          className="h-11 w-full rounded-xl border border-neutral-200 bg-white pl-9 pr-9 text-sm placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
        />
        {isPending && (
          <Loader2
            className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-300 animate-spin"
            aria-hidden
          />
        )}
      </label>

      {open && (
        <div
          id="schedule-search-results"
          role="listbox"
          className="absolute z-20 mt-2 w-full rounded-xl border border-neutral-200 bg-white shadow-lg overflow-hidden max-h-80 overflow-y-auto"
        >
          {!hasResults ? (
            <p className="px-4 py-6 text-sm text-neutral-500 text-center">No matches for &ldquo;{query}&rdquo;.</p>
          ) : (
            <>
              {results.staff.length > 0 && (
                <ResultGroup label="Staff">
                  {results.staff.map((s) => {
                    const index = flat.findIndex((f) => f.kind === "staff" && f.id === s.id);
                    return (
                      <ResultRow
                        key={s.id}
                        primary={s.name}
                        secondary={s.position}
                        active={index === highlighted}
                        onSelect={() => select({ kind: "staff", id: s.id, name: s.name, position: s.position })}
                      />
                    );
                  })}
                </ResultGroup>
              )}
              {results.departments.length > 0 && (
                <ResultGroup label="Departments">
                  {results.departments.map((d) => {
                    const index = flat.findIndex((f) => f.kind === "department" && f.id === d.id);
                    return (
                      <ResultRow
                        key={d.id}
                        primary={d.name}
                        secondary={d.code}
                        active={index === highlighted}
                        onSelect={() => select({ kind: "department", id: d.id, name: d.name, code: d.code })}
                      />
                    );
                  })}
                </ResultGroup>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ResultGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-neutral-100 last:border-b-0">
      <p className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-400">{label}</p>
      {children}
    </div>
  );
}

function ResultRow({
  primary,
  secondary,
  active,
  onSelect,
}: {
  primary: string;
  secondary?: string | null;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full flex items-center justify-between gap-3 px-4 py-2 text-left text-sm",
        active ? "bg-primary-50" : "hover:bg-neutral-50"
      )}
    >
      <span className="font-medium text-neutral-900 truncate">{primary}</span>
      {secondary && <span className="text-xs text-neutral-400 uppercase shrink-0">{secondary}</span>}
    </button>
  );
}
