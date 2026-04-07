"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock, Eye, EyeOff, Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [portalRole, setPortalRole] = useState<Role>("WORKER");
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

      <div className="flex rounded-xl border border-neutral-200 p-1 bg-neutral-100/80">
        <button
          type="button"
          onClick={() => setPortalRole("WORKER")}
          className={cn(
            "flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors",
            portalRole === "WORKER" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500"
          )}
        >
          Staff Member
        </button>
        <button
          type="button"
          onClick={() => setPortalRole("ADMIN")}
          className={cn(
            "flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors",
            portalRole === "ADMIN" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500"
          )}
        >
          Administrator
        </button>
      </div>

      <div>
        <label htmlFor="email" className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
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
            className="w-full h-11 pl-10 pr-3 rounded-xl border border-neutral-200 bg-neutral-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/25"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
            Password
          </label>
          <button type="button" className="text-xs text-blue-600 hover:underline">
            Forgot Password?
          </button>
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
            className="w-full h-11 pl-10 pr-11 rounded-xl border border-neutral-200 bg-neutral-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/25"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-neutral-400 hover:text-neutral-600"
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

      <p className="flex items-center justify-center gap-2 text-xs text-neutral-500 pt-2">
        <Headphones className="w-4 h-4" aria-hidden />
        Need technical assistance? <span className="text-blue-600 font-medium">IT Support</span>
      </p>
    </form>
  );
}
