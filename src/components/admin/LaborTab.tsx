import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LaborRoster } from './LaborRoster';
import { LaborTimecards } from './LaborTimecards';
import { ScheduleBuilder } from './labor/ScheduleBuilder';
import { ShiftRequestsInbox } from './labor/ShiftRequestsInbox';
import { LaborVsSales } from './labor/LaborVsSales';
import { WageTipRules } from './labor/WageTipRules';
import { PayrollExport } from './labor/PayrollExport';
import StaffBios from './StaffBios';
import { Card, CardContent } from '@/components/ui/card';
import { Info } from 'lucide-react';

export default function LaborTab() {
  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-3 flex items-start gap-2 text-sm">
          <Info className="h-4 w-4 text-primary mt-0.5" />
          <span>
            Scheduling, timecards, labor-vs-sales and payroll read live from Square Labor. Which Square account they use follows the <code>SQUARE_ENV</code> secret, the same as ticket payments — set it to <code>production</code> with the matching <code>SQUARE_PRODUCTION_*</code> credentials to go live. The Timecards tab says so when it is reading the sandbox. <span className="text-muted-foreground">Bios is the exception: it is our own table, and it feeds the public About page rather than Square.</span>
          </span>
        </CardContent>
      </Card>
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