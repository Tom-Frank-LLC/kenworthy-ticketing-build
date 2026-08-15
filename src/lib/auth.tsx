import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logAuthEvent, logFailedLogin } from '@/lib/auditClient';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  isStaff: boolean;
  isHost: boolean;
  isSuperadmin: boolean;
  loading: boolean;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function fetchRoles(userId: string): Promise<string[]> {
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', userId);
  return (data || []).map(r => r.role);
}

/**
 * Log a sign-in, but only for accounts that can change something.
 *
 * The role lookup is what makes this an operations log rather than a record of
 * who bought a ticket, and it is also what the INSERT policy on
 * admin_audit_log will check — a member's browser calling this would simply be
 * refused, so the check here is about not making a pointless request.
 *
 * Not awaited by the caller: sign-in must not wait on the audit write, and a
 * failed write must not look like a failed sign-in.
 */
async function recordStaffLogin(user: User): Promise<void> {
  try {
    const roles = await fetchRoles(user.id);
    const privileged = roles.some(r => r === 'admin' || r === 'staff' || r === 'superadmin');
    if (!privileged) return;
    await logAuthEvent('auth.login', { id: user.id, email: user.email });
  } catch (e) {
    console.error('[audit] sign-in not recorded', e);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkRoles = async (userId: string) => {
    const roles = await fetchRoles(userId);
    const superadmin = roles.includes('superadmin');
    setIsSuperadmin(superadmin);
    setIsAdmin(roles.includes('admin') || superadmin);
    setIsStaff(roles.includes('staff') || roles.includes('admin') || superadmin);
    setIsHost(roles.includes('host'));
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) await checkRoles(session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        // Defer role fetch so we don't block the auth callback; still resolve loading after.
        checkRoles(session.user.id).finally(() => setLoading(false));
      } else {
        setIsAdmin(false);
        setIsStaff(false);
        setIsHost(false);
        setIsSuperadmin(false);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, displayName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) throw error;
  };

  // Logged here rather than from onAuthStateChange, which also fires SIGNED_IN
  // on token refresh and on returning to the tab — a listener would record
  // "signed in" several times a shift for someone who signed in once. This is
  // the only path into the admin screens: Auth.tsx offers password sign-in and
  // a password reset, and no magic-link or OTP entry point exists.
  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      void logFailedLogin(email);
      throw error;
    }
    if (data.user) void recordStaffLogin(data.user);
  };

  const signOut = async () => {
    // Before signOut, not after: the INSERT policy needs a session, and there
    // is none a moment later.
    if (user && isStaff) await logAuthEvent('auth.logout', { id: user.id, email: user.email });
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ user, session, isAdmin, isStaff, isHost, isSuperadmin, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
