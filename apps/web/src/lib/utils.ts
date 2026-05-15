import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(value: number | string | null | undefined, currency = 'USD') {
  if (value == null) return '—';
  const num = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(num)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(num);
}

export function formatNumber(value: number | null | undefined) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString();
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString();
}

export function relativeTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const MARKETPLACES = [
  { id: 'AMAZON', label: 'Amazon', color: '#ff9900', short: 'a' },
  { id: 'WALMART', label: 'Walmart', color: '#0071ce', short: 'W' },
  { id: 'SHOPIFY', label: 'Shopify', color: '#95bf47', short: 'S' },
  { id: 'TIKTOK', label: 'TikTok', color: '#000', short: 'T' },
  { id: 'EBAY', label: 'eBay', color: '#e53238', short: 'e' },
  { id: 'ETSY', label: 'Etsy', color: '#f1641e', short: 'E' },
  { id: 'FAIRE', label: 'Faire', color: '#1a1a1a', short: 'F' },
] as const;

export type MarketplaceId = (typeof MARKETPLACES)[number]['id'];

export function marketplaceMeta(id: string) {
  return MARKETPLACES.find((m) => m.id === id) ?? { id, label: id, color: '#888', short: id.charAt(0) };
}
