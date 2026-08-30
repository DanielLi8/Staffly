"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  searchScheduleTargets,
  type ScheduleSearchResult,
  type ScheduleSearchScope,
} from "@/app/actions/schedule-search";

/**
 * The search-driven entry point for `/admin/schedule` - there is no
 * department picker sidebar, these two boxes ARE the navigation. Staff and
 * departments are deliberately two separate, clearly labeled search inputs
 * rather than one combined typeahead, so an admin picks their search mode up
 * front instead of scanning a mixed result list. Built fresh for this page:
 * the header's "Search shifts..." input (`staffly-header.tsx`) is a
 * decorative, read-only redirect-on-focus control for a different surface,
 * not a real search.
 */
export function ScheduleSearchBox() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
      <SingleScopeSearch scope="staff" label="Search staff" placeholder="Search staff by name..." />
      <SingleScopeSearch
        scope="department"
        label="Search departments"
        placeholder="Search departments by name or code..."
      />
    </div>
  );
}

function SingleScopeSearch({
  scope,
  label,
  placeholder,
}: {
  scope: ScheduleSearchScope;
  label: string;
  placeholder: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ScheduleSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

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
      setResults([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const r = await searchScheduleTargets(trimmed, scope);
        setResults(r);
        setOpen(true);
      });
    }, 200);
  }

  function select(item: ScheduleSearchResult) {
    setOpen(false);
    router.push(`/admin/schedule?type=${item.type}&id=${item.id}&view=week`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(results[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const inputId = `schedule-search-${scope}`;

  return (
    <div ref={containerRef} className="relative w-full">
      <label className="relative block" htmlFor={inputId}>
        <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-neutral-500">{label}</span>
        <span className="relative block">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400"
            aria-hidden
          />
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${inputId}-results`}
            aria-autocomplete="list"
            className="h-11 w-full rounded-xl border border-neutral-200 bg-white pl-9 pr-9 text-sm placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
          />
          {isPending && (
            <Loader2
              className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-300 animate-spin"
              aria-hidden
            />
          )}
        </span>
      </label>

      {open && (
        <div
          id={`${inputId}-results`}
          role="listbox"
          className="absolute z-20 mt-2 w-full rounded-xl border border-neutral-200 bg-white shadow-lg overflow-hidden max-h-80 overflow-y-auto"
        >
          {results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-neutral-500 text-center">No matches for &ldquo;{query}&rdquo;.</p>
          ) : (
            results.map((item, index) => (
              <ResultRow
                key={item.id}
                primary={item.name}
                secondary={item.type === "staff" ? item.position : item.code}
                active={index === highlighted}
                onSelect={() => select(item)}
              />
            ))
          )}
        </div>
      )}
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
