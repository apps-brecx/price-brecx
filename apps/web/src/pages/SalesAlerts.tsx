import { AlertsView } from './PriceAlerts';

export default function SalesAlerts() {
  return <AlertsView title="Sales alerts" endpoint="/api/alerts/sales" />;
}
