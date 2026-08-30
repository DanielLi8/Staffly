import { LoginForm } from "@/features/auth/login-form";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = { title: "Sign In – Staffly" };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-10 bg-staffly-bg">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-primary-700 items-center justify-center mb-4 shadow-card">
            <span className="text-white text-2xl font-bold">+</span>
          </div>
          <h1 className="font-display text-3xl font-bold text-primary-900">Staffly</h1>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-neutral-400 mt-2 uppercase">
            Secure internal access
          </p>
        </div>

        <div className="card-base p-8 shadow-card">
          <LoginForm />
        </div>

        <div className="mt-8 text-center space-y-3 text-[10px] uppercase tracking-wider text-neutral-400">
          <div className="flex flex-wrap justify-center gap-4">
            <span className="cursor-default">Privacy Policy</span>
            <span className="cursor-default">Terms of Service</span>
            <span className="cursor-default">IT Support</span>
          </div>
          <p>© {new Date().getFullYear()} Staffly Systems. Secure internal access only.</p>
        </div>

        <div className="mt-8 p-4 rounded-xl bg-primary-50/80 border border-primary-100 text-xs text-neutral-600">
          <p className="font-semibold text-primary-800 mb-2">Demo accounts</p>
          <p>
            Admin: <span className="font-mono">admin@staffly.com</span> /{" "}
            <span className="font-mono">admin123</span>
          </p>
          <p className="mt-1">
            Staff: <span className="font-mono">worker1@staffly.com</span> /{" "}
            <span className="font-mono">worker123</span>
          </p>
          <p className="mt-1">
            Unit Clerk: <span className="font-mono">clerk@staffly.com</span> /{" "}
            <span className="font-mono">clerk123</span>
          </p>
          <p className="mt-2 text-neutral-500">Select the matching portal tab before signing in.</p>
        </div>
      </div>
    </main>
  );
}
