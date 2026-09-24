import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LaborTimecards } from './LaborTimecards';
import { ScheduleBuilder } from './labor/ScheduleBuilder';
import { ShiftRequestsInbox } from './labor/ShiftRequestsInbox';
import { PayrollExport } from './labor/PayrollExport';
import { TeamRoster } from './TeamRoster';
import { CollapsibleSection } from './CollapsibleSection';
import { Info } from 'lucide-react';

export default function LaborTab() {
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
            Scheduling, timecards and payroll read live from Square Labor. Which Square account they use follows the <code>SQUARE_ENV</code> secret, the same as ticket payments — set it to <code>production</code> with the matching <code>SQUARE_PRODUCTION_*</code> credentials to go live. The Timecards tab says so when it is reading the sandbox. <span className="text-muted-foreground">Team Members is our own: accounts, roles and bios live in this build. The Square link on each card is what ties an account here to a team member over there, and the bio feeds the public About page.</span>
          </span>
        </div>
      </CollapsibleSection>
      {/* Team Members first: who the team is comes before what they clocked. */}
      <Tabs defaultValue="members" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="members">Team Members</TabsTrigger>
          <TabsTrigger value="timecards">Timecards</TabsTrigger>
          <TabsTrigger value="schedule">Scheduling</TabsTrigger>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="payroll">Payroll → QBO</TabsTrigger>
        </TabsList>
        <TabsContent value="members"><TeamRoster /></TabsContent>
        <TabsContent value="timecards"><LaborTimecards /></TabsContent>
        <TabsContent value="schedule"><ScheduleBuilder /></TabsContent>
        <TabsContent value="requests"><ShiftRequestsInbox /></TabsContent>
        <TabsContent value="payroll"><PayrollExport /></TabsContent>
      </Tabs>
    </div>
  );
}
