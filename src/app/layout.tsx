import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import AutomationFlagsBanner from '@/components/AutomationFlagsBanner';
import CompleteProfileGate from '@/components/CompleteProfileGate';
import StaffModalProvider from '@/components/StaffModalProvider';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const metadata: Metadata = {
  title: 'ShiftFlow',
  description: 'Supermarket shift cover management',
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
          <main className="px-4 sm:px-6 lg:px-8 py-6">{children}</main>
        </StaffModalProvider>
      </body>
    </html>
  );
}
