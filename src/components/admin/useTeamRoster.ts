import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TEAM_ROLES } from '@/lib/roleRules';

// A team member who can own a request. Same source as the Team tab's roster:
// anyone holding a TEAM_ROLES role, named from their profile.
export type TeamMember = { id: string; name: string };

/**
 * The roster behind the Rentals tabs' "Assigned to". Reading every user_roles
 * row and every profile is an admin-or-above read under RLS, which is who
 * these tabs are for (/admin is AdminOnly).
 */
export function useTeamRoster() {
  const [team, setTeam] = useState<TeamMember[]>([]);

  useEffect(() => {
    (async () => {
      const { data: roles, error } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('role', [...TEAM_ROLES]);
      if (error) { toast.error(error.message); return; }
      const ids = [...new Set((roles || []).map(r => r.user_id))];
      if (!ids.length) { setTeam([]); return; }
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, email, display_name')
        .in('id', ids);
      if (pErr) { toast.error(pErr.message); return; }
      setTeam(
        (profiles || [])
          .map(p => ({ id: p.id, name: p.display_name || p.email || 'Unnamed' }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    })();
  }, []);

  // Until the roster arrives every id would read as a former member.
  const teamName = (id: string | null | undefined) =>
    !id ? null : team.find(m => m.id === id)?.name ?? (team.length ? 'Former team member' : '…');

  return { team, teamName };
}
