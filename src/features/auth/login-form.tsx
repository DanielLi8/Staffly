"use client";

import { useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [portalRole, setPortalRole] = useState<Role>("STAFF");
  const [remember, setRemember] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        portalRole,
        remember: remember ? "true" : "false",
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        setError("Invalid credentials, or the selected portal does not match this account.");
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error && (
        <div
          role="alert"
          className="px-4 py-3 bg-accent-50 border border-accent-200 rounded-lg text-sm text-accent-700"
        >
          {error}
        </div>
      )}

      <PortalToggle value={portalRole} onChange={setPortalRole} />

      <div>
        <label htmlFor="email" className="text-2xs font-bold uppercase tracking-wide text-neutral-500">
          Email address
        </label>
        <div className="relative mt-1.5">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" aria-hidden />
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="staff.id@clinicserenity.com"
            className="w-full h-11 pl-10 pr-3 rounded-xl border border-neutral-200 bg-neutral-50 text-base sm:text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-2xs font-bold uppercase tracking-wide text-neutral-500">
            Password
          </label>
        </div>
        <div className="relative mt-1.5">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" aria-hidden />
          <input
            id="password"
            type={showPw ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full h-11 pl-10 pr-11 rounded-xl border border-neutral-200 bg-neutral-50 text-base sm:text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-neutral-500 hover:text-neutral-600"
            aria-label={showPw ? "Hide password" : "Show password"}
          >
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-600 cursor-pointer">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="rounded border-neutral-300 text-primary-700 focus:ring-primary-500"
        />
        Remember me for 30 days
      </label>

      <Button type="submit" className="w-full h-12 rounded-xl text-base font-semibold" size="lg" loading={loading}>
        Sign In to Portal
      </Button>
    </form>
  );
}

const PORTALS = [
  ["STAFF", "Staff"],
  ["ADMIN", "Admin"],
] as const;

/**
 * Staff | Admin portal picker. A single white pill slides under the active
 * label (transform only, so it stays on the compositor) while the labels
 * crossfade color; both drop to an instant switch under
 * `prefers-reduced-motion`. Exposed as a radio group: one tab stop, arrow
 * keys move (and select), matching the native radio pattern.
 */
function PortalToggle({ value, onChange }: { value: Role; onChange: (role: Role) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = PORTALS.findIndex(([v]) => v === value);

  function handleKeyDown(e: React.KeyboardEvent) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (activeIndex + step + PORTALS.length) % PORTALS.length;
    onChange(PORTALS[next][0]);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Sign-in portal"
      onKeyDown={handleKeyDown}
      className="relative grid grid-cols-2 rounded-xl border border-neutral-200 bg-neutral-100/80 p-1"
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />
      {PORTALS.map(([role, label], i) => {
        const checked = role === value;
        return (
          <button
            key={role}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(role)}
            className={cn(
              "relative z-10 whitespace-nowrap rounded-lg py-2.5 text-sm font-semibold transition-colors duration-200 ease-out motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
              checked ? "text-neutral-900" : "text-neutral-600 hover:text-neutral-900"
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
