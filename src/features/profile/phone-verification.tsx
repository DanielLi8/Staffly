"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startPhoneVerification, confirmPhoneVerification } from "@/app/actions/profile";

interface PhoneVerificationProps {
  initialPhone: string | null;
  verified: boolean;
  /** False when Twilio Verify is not configured (e.g. the credential-free demo). */
  available: boolean;
}

/**
 * Two-step phone verification at profile setup: enter a number to receive an
 * OTP, then confirm it. On success the server stamps `phoneVerifiedAt`, which is
 * what unlocks SMS/voice outreach. Degrades to a clear notice when Twilio Verify
 * is unavailable.
 */
export function PhoneVerification({ initialPhone, verified, available }: PhoneVerificationProps) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"idle" | "code">("idle");
  const [isVerified, setIsVerified] = useState(verified);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isPending, startTransition] = useTransition();

  if (isVerified) {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-700">
        <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden />
        <span>
          <span className="font-medium">{phone}</span> is verified for text and call alerts.
        </span>
      </div>
    );
  }

  if (!available) {
    return (
      <div className="flex items-start gap-2 text-sm text-neutral-500">
        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
        <span>
          Phone verification is unavailable in this environment. You&apos;ll still receive
          email and in-app alerts.
        </span>
      </div>
    );
  }

  function sendCode() {
    setError("");
    setInfo("");
    startTransition(async () => {
      const result = await startPhoneVerification(phone);
      switch (result.status) {
        case "sent":
          setStage("code");
          setInfo("We sent a verification code by text.");
          break;
        case "unavailable":
          setError("Phone verification is unavailable right now.");
          break;
        default:
          setError(result.status === "error" ? result.message : "Something went wrong.");
      }
    });
  }

  function confirmCode() {
    setError("");
    setInfo("");
    startTransition(async () => {
      const result = await confirmPhoneVerification(phone, code);
      switch (result.status) {
        case "verified":
          setIsVerified(true);
          break;
        case "incorrect":
          setError("That code didn't match. Check it and try again.");
          break;
        case "unavailable":
          setError("Phone verification is unavailable right now.");
          break;
        default:
          setError(result.status === "error" ? result.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="phone">Mobile number</Label>
        <div className="flex gap-2">
          <Input
            id="phone"
            type="tel"
            placeholder="+14165551234"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={isPending || stage === "code"}
          />
          {stage === "idle" && (
            <Button type="button" onClick={sendCode} loading={isPending} disabled={!phone}>
              Send code
            </Button>
          )}
        </div>
      </div>

      {stage === "code" && (
        <div className="space-y-1.5">
          <Label htmlFor="code">Verification code</Label>
          <div className="flex gap-2">
            <Input
              id="code"
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={isPending}
            />
            <Button type="button" onClick={confirmCode} loading={isPending} disabled={!code}>
              Verify
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStage("idle");
                setCode("");
                setInfo("");
                setError("");
              }}
              disabled={isPending}
            >
              Change number
            </Button>
          </div>
        </div>
      )}

      {info && <p className="text-xs text-neutral-500">{info}</p>}
      {error && <p className="text-xs text-accent">{error}</p>}
    </div>
  );
}
