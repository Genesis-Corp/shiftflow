import type { Metadata, Viewport } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import MobileTabBar from '@/components/MobileTabBar';
import AutomationFlagsBanner from '@/components/AutomationFlagsBanner';
import CompleteProfileGate from '@/components/CompleteProfileGate';
import StaffModalProvider from '@/components/StaffModalProvider';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const metadata: Metadata = {
  title: 'ShiftFlow',
  description: 'Supermarket shift cover management',
  // manifest.ts, icon.tsx and apple-icon.tsx are all picked up and linked
  // into <head> automatically by their file names — nothing to add here for
  // those. appleWebApp is the one thing iOS needs that isn't file-based: it
  // reads this to know the app should launch standalone (no Safari chrome)
  // once added to the home screen, and what title to show under the icon.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ShiftFlow',
  },
};

export const viewport: Viewport = {
  themeColor: '#1d4ed8',
  // Lets content draw into the safe areas around the iPhone's notch/home
  // indicator — required for the env(safe-area-inset-*) padding on
  // MobileTabBar to resolve to anything other than 0.
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read here (Server Component) rather than have Navbar fetch it client-side,
  // so the signed-in user's name is in the very first HTML sent, no flash of
  // "not signed in" while a client request is still in flight.
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  // manager_profiles has RLS with no policies (service-role only), so this
  // needs supabaseAdmin rather than the session-scoped client above. Null
  // until the manager has completed their profile (CompleteProfileGate) —
  // Navbar falls back to the email in that gap.
  let managerName: string | null = null;
  if (user) {
    const { data: profile } = await supabaseAdmin
      .from('manager_profiles').select('name').eq('user_id', user.id).maybeSingle();
    managerName = profile?.name ?? null;
  }

  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50">
        <StaffModalProvider>
          <Navbar userEmail={user?.email ?? null} userName={managerName} />
          <AutomationFlagsBanner />
          <CompleteProfileGate />
          {/* Extra bottom padding below lg clears the fixed MobileTabBar —
              without it the last card on every page sits half-hidden behind
              the bar rather than being unreachable by scroll (it's still
              reachable), just visually cut off at rest. */}
          <main className="px-4 sm:px-6 lg:px-8 py-6 pb-24 lg:pb-6">{children}</main>
          <MobileTabBar userEmail={user?.email ?? null} userName={managerName} />
        </StaffModalProvider>
      </body>
    </html>
  );
}
