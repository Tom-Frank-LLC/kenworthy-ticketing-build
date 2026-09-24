import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';
import { LaborRoster } from './LaborRoster';
import { LaborTimecards } from './LaborTimecards';
import { ScheduleBuilder } from './labor/ScheduleBuilder';
import { ShiftRequestsInbox } from './labor/ShiftRequestsInbox';
import { PayrollExport } from './labor/PayrollExport';
import { AccountRolesManager } from './AccountRolesManager';
import StaffBios from './StaffBios';
import { CollapsibleSection } from './CollapsibleSection';
import { Info, Link2, ShieldCheck, Users } from 'lucide-react';

export default function LaborTab() {
  const { isSuperadmin } = useAuth();
  return (
    <div className="space-y-4">
      {/* Collapsed by default: it explains a wiring decision that is made once
          and then true forever, so it does not need to cost a paragraph of
          vertical space on every visit to a tab someone opens daily. */}
      <CollapsibleSection
        id="labor.square-note"
        title="How this reads from Square"
        icon={Info}
      >
        <div className="flex items-start gap-2 text-sm">
          <span>
            Scheduling, timecards and payroll read live from Square Labor. Which Square account they use follows the <code>SQUARE_ENV</code> secret, the same as ticket payments — set it to <code>production</code> with the matching <code>SQUARE_PRODUCTION_*</code> credentials to go live. The Timecards tab says so when it is reading the sandbox. <span className="text-muted-foreground">Team Members is the exception: accounts, roles and bios are our own tables. Bios feed the public About page rather than Square, and the Square Labor linking there is what ties an account here to a team member over there.</span>
          </span>
        </div>
      </CollapsibleSection>
      <Tabs defaultValue="timecards" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="timecards">Timecards</TabsTrigger>
          <TabsTrigger value="schedule">Scheduling</TabsTrigger>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="payroll">Payroll → QBO</TabsTrigger>
          <TabsTrigger value="members">Team Members</TabsTrigger>
        </TabsList>
        <TabsContent value="timecards"><LaborTimecards /></TabsContent>
        <TabsContent value="schedule"><ScheduleBuilder /></TabsContent>
        <TabsContent value="requests"><ShiftRequestsInbox /></TabsContent>
        <TabsContent value="payroll"><PayrollExport /></TabsContent>
        {/* One sub-tab for the people themselves, in three sections that used
            to be scattered: the accounts and roles (once its own page at
            /admin/accounts), the Square Labor linking, and the public bios.
            The role controls are the same component /superadmin renders, so
            the admin rules here cannot drift from that page or from RLS. */}
        <TabsContent value="members" className="space-y-4">
          <CollapsibleSection
            id="labor.members.roles"
            title="Members & roles"
            icon={ShieldCheck}
            description={isSuperadmin
              ? 'Grant or revoke roles, or invite someone new. Superadmin inherits admin and staff access.'
              : 'Grant or revoke staff and host access, or invite someone new. Accounts that hold admin or superadmin are managed by a superadmin and show as locked here.'}
            defaultOpen
          >
            <AccountRolesManager />
          </CollapsibleSection>
          <CollapsibleSection
            id="labor.members.linking"
            title="Square Labor linking"
            icon={Link2}
            description="Which Square team member each account here is, so timecards and payroll land on the right person."
          >
            <LaborRoster />
          </CollapsibleSection>
          <CollapsibleSection
            id="labor.members.bios"
            title="Public bios"
            icon={Users}
            description="The staff cards on the public About page."
          >
            <StaffBios />
          </CollapsibleSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}
