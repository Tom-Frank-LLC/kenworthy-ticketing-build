import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DiscountRulesEditor from '@/components/admin/DiscountRulesEditor';

/**
 * Admin → Promo codes (BRIEF-promo-codes).
 *
 * Site-wide codes belong to no film or event, so the per-production Discounts
 * sections can never show them; this is their home. It also lists every coded
 * rule made on a film, event or showing, so one place answers "which codes
 * exist, where do they work, and how much have they been used?".
 */
export default function PromoCodesTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display tracking-wide">Promo codes</CardTitle>
      </CardHeader>
      <CardContent>
        <DiscountRulesEditor scope={{ sitewide: true }} audience="every film, event and live performance" />
      </CardContent>
    </Card>
  );
}
