/** @type {import('next').NextConfig} */
const vercelHost = process.env.VERCEL_URL;
const vercelOrigin = vercelHost ? `https://${vercelHost}` : undefined;

const nextAuthUrl =
  (process.env.NEXTAUTH_URL && process.env.NEXTAUTH_URL.trim()) ||
  vercelOrigin ||
  "http://localhost:3000";

const allowedOrigins = new Set(["localhost:3000"]);
if (vercelHost) allowedOrigins.add(vercelHost);
try {
  allowedOrigins.add(new URL(nextAuthUrl).host);
} catch {
  /* ignore invalid NEXTAUTH_URL here; NextAuth will surface config errors */
}

const nextConfig = {
  env: {
    // NextAuth middleware calls parseUrl(NEXTAUTH_URL) on every matched request.
    // Missing/empty values can crash Edge middleware (MIDDLEWARE_INVOCATION_FAILED).
    NEXTAUTH_URL: nextAuthUrl,
  },
  experimental: {
    serverActions: {
      allowedOrigins: [...allowedOrigins],
    },
  },
};

export default nextConfig;
