export function StafflyFooter() {
  return (
    <footer className="mt-auto border-t border-neutral-200/80 bg-white/80 py-6 px-4 lg:px-8">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] uppercase tracking-wider text-neutral-400">
        <p>© {new Date().getFullYear()} Staffly Clinical Systems</p>
        <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          <span className="cursor-default">Privacy Policy</span>
          <span className="cursor-default">Terms of Service</span>
          <span className="cursor-default">Compliance</span>
        </nav>
      </div>
    </footer>
  );
}
