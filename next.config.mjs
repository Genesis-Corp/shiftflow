/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // Vercel sets these automatically at build time (System Environment
    // Variables) — no manual configuration needed on the dashboard. Exposed
    // here so the branch tag in the navbar can show which deployment is
    // actually running, since two branches share this Vercel project and it
    // has repeatedly not been obvious which one a given URL is running.
    NEXT_PUBLIC_GIT_BRANCH: process.env.VERCEL_GIT_COMMIT_REF ?? 'local',
    NEXT_PUBLIC_GIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? '',
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? 'development',
  },
};
export default nextConfig;
