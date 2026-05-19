export const SALES_CHANNELS = [
  "amazon",
  "walmart",
  "shopify",
  "tiktok",
  "ebay",
  "etsy",
  "faire",
] as const;

export type SalesChannel = (typeof SALES_CHANNELS)[number];

export const CHANNEL_LABELS: Record<SalesChannel, string> = {
  amazon: "Amazon",
  walmart: "Walmart",
  shopify: "Shopify",
  tiktok: "TikTok",
  ebay: "eBay",
  etsy: "Etsy",
  faire: "Faire",
};

export const SKU_STATUSES = ["active", "inactive", "incomplete"] as const;
export type SkuStatus = (typeof SKU_STATUSES)[number];

export const SCHEDULE_TYPES = ["single", "weekly", "monthly"] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export const SCHEDULE_STATUSES = [
  "scheduled",
  "running",
  "completed",
  "reverted",
  "cancelled",
  "failed",
] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const AUTOMATION_TYPES = [
  "increasing",
  "decreasing-cycling",
  "random",
  "quantity-cycling",
  "age-by-day",
] as const;
export type AutomationType = (typeof AUTOMATION_TYPES)[number];

export const ALERT_KINDS = ["price", "sales", "stock", "buybox"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const USER_ROLES = ["admin", "user"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  user: "User",
};

export const ACTIVITY_ACTIONS = [
  "created",
  "updated",
  "deleted",
  "price_changed",
  "price_reverted",
  "rule_triggered",
  "login",
  "import",
  "export",
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export const SESSION_COOKIE = "fbm_session";
export const DEFAULT_TIMEZONE = "America/New_York";
export const DEFAULT_CURRENCY = "USD";

/** All navigable pages in the SPA — keep in sync with the sidebar. */
export const NAV_PAGES = [
  "dashboard",
  "calendar",
  "products",
  "skus",
  "inventory",
  "price-alert",
  "pricing-v2",
  "automation",
  "buybox",
  "price-alert-v2",
  "sales-alert",
  "buybox-alert",
  "report",
  "activity-log",
  "status",
  "history",
  "settings",
] as const;
export type NavPage = (typeof NAV_PAGES)[number];
