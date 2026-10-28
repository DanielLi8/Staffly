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

// Content-Security-Policy, REPORT-ONLY for now: violations reach
// /api/csp-report (logged) but nothing is blocked. Once production logs stay
// quiet, switch the header name to "Content-Security-Policy" to enforce it.
// 'unsafe-inline' scripts are needed by Next's inline bootstrap scripts until
// a nonce is wired through middleware; dev adds eval + websocket for HMR.
const isDev = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "report-uri /api/csp-report",
].join("; ");

const nextConfig = {
  // Don't advertise the framework (X-Powered-By: Next.js).
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
      ],
    }];
  },
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
