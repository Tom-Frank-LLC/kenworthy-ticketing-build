import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LaborRoster } from './LaborRoster';
import { LaborTimecards } from './LaborTimecards';
import { Card, CardContent } from '@/components/ui/card';
import { Info } from 'lucide-react';

export default function LaborTab() {
  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-3 flex items-start gap-2 text-sm">
          <Info className="h-4 w-4 text-primary mt-0.5" />
          <span>
            Labor data flows live to your Square <strong>sandbox</strong> account. When you wire production credentials, the same UI will operate against real team members and shifts — no rebuild required.
          </span>
        </CardContent>
      </Card>
      <Tabs defaultValue="timecards" className="space-y-4">
        <TabsList>
          <TabsTrigger value="timecards">Timecards</TabsTrigger>
          <TabsTrigger value="roster">Team & Linking</TabsTrigger>
          <TabsTrigger value="schedule">Scheduling</TabsTrigger>
        </TabsList>
        <TabsContent value="timecards"><LaborTimecards /></TabsContent>
        <TabsContent value="roster"><LaborRoster /></TabsContent>
        <TabsContent value="schedule">
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            Square’s scheduled-shifts API has limited sandbox support. The week-view scheduler will activate automatically when production credentials are added.
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}