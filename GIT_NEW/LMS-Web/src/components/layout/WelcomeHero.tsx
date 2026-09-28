"use client";

import { ReactNode, useState } from "react";

function greetingFor(hour: number) {
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

export function WelcomeHero({
  title,
  subtitle,
  actions,
  busy = false,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  busy?: boolean;
}) {
  // Signed-in pages only render on the client (after auth loads), so the
  // local clock is safe to read here.
  const [greeting] = useState(() => greetingFor(new Date().getHours()));

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white shadow-[0_10px_30px_-12px_rgba(37,99,235,0.35)] px-5 sm:px-8 py-7 sm:py-9 mb-5">
      {/* Sky backdrop (the app's cloud image) with a white wash on the left so
          the heading stays readable over the clouds. */}
      <div
        className="pointer-events-none absolute inset-0 bg-cover"
        // The cloud image has faint text around its middle; anchoring near the
        // top keeps it out of this short strip.
        style={{ backgroundImage: "url('/background.png')", backgroundPosition: "center 12%" }}
      />
      <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-white/95 via-white/70 to-white/0 sm:via-white/55" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-white/40 to-transparent" />

      <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-5">
        <div className="min-w-0">
          <p suppressHydrationWarning className="text-[11px] sm:text-xs font-semibold tracking-[0.35em] uppercase text-brand">
            {greeting}
          </p>
          <h1 className="mt-2 text-2xl sm:text-3xl lg:text-[34px] font-extrabold text-ink tracking-tight leading-tight flex items-center gap-3">
            <span className="break-words">{title}</span>
            {busy && (
              <svg className="animate-spin h-5 w-5 text-brand shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-slate-500">{subtitle}</p>
        </div>

        {/* View switch / date controls — on the right, in a frosted panel over the clouds */}
        {actions && (
          <div className="shrink-0 flex flex-wrap items-center gap-2 md:justify-end rounded-2xl md:bg-white/45 md:backdrop-blur-md md:border md:border-white/70 md:p-3 md:shadow-[0_8px_24px_-12px_rgba(15,30,70,0.25)]">
            {actions}
          </div>
        )}
      </div>
    </section>
  );
}
