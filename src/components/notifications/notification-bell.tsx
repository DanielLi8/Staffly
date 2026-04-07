"use client";

import { useState, useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import { cn, formatRelative } from "@/lib/utils";
import type { NotificationWithShift } from "@/types";
import Link from "next/link";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationWithShift[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unread = notifications.filter((n) => !n.read).length;

  async function fetchNotifications() {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications");
      const data = await res.json();
      setNotifications(data);
    } catch (_) {
    } finally {
      setLoading(false);
    }
  }

  async function markAllRead() {
    const ids = notifications.filter((n) => !n.read).map((n) => n.id);
    if (!ids.length) return;
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleOpen() {
    setOpen((v) => !v);
    if (!open) markAllRead();
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-md hover:bg-neutral-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
      >
        <Bell className="w-5 h-5 text-neutral-600" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white text-[10px] font-bold">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 bg-white border border-neutral-200 rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-800">Notifications</h2>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-primary-600 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <ul className="max-h-80 overflow-y-auto divide-y divide-neutral-100">
            {loading && (
              <li className="px-4 py-8 text-center text-sm text-neutral-400">Loading…</li>
            )}
            {!loading && notifications.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-neutral-400">
                No notifications yet.
              </li>
            )}
            {!loading &&
              notifications.map((n) => (
                <li key={n.id}>
                  <NotificationItem notification={n} onClose={() => setOpen(false)} />
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  onClose,
}: {
  notification: NotificationWithShift;
  onClose: () => void;
}) {
  const href =
    notification.shiftId
      ? notification.type === "BID_SUBMITTED"
        ? `/admin/shifts/${notification.shiftId}`
        : `/worker/shifts/${notification.shiftId}`
      : "#";

  return (
    <Link
      href={href}
      onClick={onClose}
      className={cn(
        "block px-4 py-3 hover:bg-neutral-50 transition-colors",
        !notification.read && "bg-primary-50"
      )}
    >
      <div className="flex items-start gap-2">
        {!notification.read && (
          <span className="mt-1.5 w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" aria-hidden="true" />
        )}
        <div className={cn("flex-1", notification.read && "pl-4")}>
          <p className="text-sm font-medium text-neutral-800">{notification.title}</p>
          <p className="text-xs text-neutral-500 mt-0.5 line-clamp-2">{notification.message}</p>
          <p className="text-xs text-neutral-400 mt-1">{formatRelative(notification.createdAt)}</p>
        </div>
      </div>
    </Link>
  );
}
