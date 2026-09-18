import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import AutomationFlagsBanner from '@/components/AutomationFlagsBanner';
import CompleteProfileGate from '@/components/CompleteProfileGate';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'ShiftFlow',
  description: 'Supermarket shift cover management',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read here (Server Component) rather than have Navbar fetch it client-side,
  // so the signed-in user's email is in the very first HTML sent, no flash of
  // "not signed in" while a client request is still in flight.
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50">
        <Navbar userEmail={user?.email ?? null} />
        <AutomationFlagsBanner />
        <CompleteProfileGate />
        <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
