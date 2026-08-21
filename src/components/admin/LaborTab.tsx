import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LaborRoster } from './LaborRoster';
import { LaborTimecards } from './LaborTimecards';
import { ScheduleBuilder } from './labor/ScheduleBuilder';
import { ShiftRequestsInbox } from './labor/ShiftRequestsInbox';
import { LaborVsSales } from './labor/LaborVsSales';
import { WageTipRules } from './labor/WageTipRules';
import { PayrollExport } from './labor/PayrollExport';
import StaffBios from './StaffBios';
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
            Scheduling, timecards, labor-vs-sales and payroll read live from Square Labor. Which Square account they use follows the <code>SQUARE_ENV</code> secret, the same as ticket payments — set it to <code>production</code> with the matching <code>SQUARE_PRODUCTION_*</code> credentials to go live. The Timecards tab says so when it is reading the sandbox. <span className="text-muted-foreground">Bios is the exception: it is our own table, and it feeds the public About page rather than Square.</span>
          </span>
        </div>
      </CollapsibleSection>
      <Tabs defaultValue="timecards" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="timecards">Timecards</TabsTrigger>
          <TabsTrigger value="schedule">Scheduling</TabsTrigger>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="vs-sales">Labor vs Sales</TabsTrigger>
          <TabsTrigger value="rules">Wage & Tip Rules</TabsTrigger>
          <TabsTrigger value="payroll">Payroll → QBO</TabsTrigger>
          <TabsTrigger value="roster">Team & Linking</TabsTrigger>
          <TabsTrigger value="bios">Bios</TabsTrigger>
        </TabsList>
        <TabsContent value="timecards"><LaborTimecards /></TabsContent>
        <TabsContent value="schedule"><ScheduleBuilder /></TabsContent>
        <TabsContent value="requests"><ShiftRequestsInbox /></TabsContent>
        <TabsContent value="vs-sales"><LaborVsSales /></TabsContent>
        <TabsContent value="rules"><WageTipRules /></TabsContent>
        <TabsContent value="payroll"><PayrollExport /></TabsContent>
        <TabsContent value="roster"><LaborRoster /></TabsContent>
        <TabsContent value="bios"><StaffBios /></TabsContent>
      </Tabs>
    </div>
  );
}