import { z } from "zod";
import {
  SALES_CHANNELS,
  SKU_STATUSES,
  SCHEDULE_TYPES,
  SCHEDULE_STATUSES,
  AUTOMATION_TYPES,
  ALERT_KINDS,
  USER_ROLES,
  ACTIVITY_ACTIONS,
} from "./constants.js";

export const idSchema = z.string().uuid();

/* ----------------------------- Auth ----------------------------- */

export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const userSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  name: z.string(),
  role: z.enum(USER_ROLES),
  workspaceId: idSchema,
  createdAt: z.string(),
});
export type User = z.infer<typeof userSchema>;

/* Account creation is invite-only. An admin invites by email; the invitee
 * sets their own name + password via the link from the invite email. */

export const inviteCreateSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: z.enum(USER_ROLES).default("user"),
});
export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(16).max(200),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(200),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

/** Self-service or admin edit of a user. Role changes are admin-only and
 * enforced server-side; password is optional (only when changing it). */
export const userUpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    role: z.enum(USER_ROLES).optional(),
    password: z.string().min(8).max(200).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "No fields to update" });
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const invitationSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  name: z.string(),
  role: z.enum(USER_ROLES),
  invitedBy: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type Invitation = z.infer<typeof invitationSchema>;

/* ----------------------------- SKU ------------------------------ */

export const tagSchema = z.object({
  label: z.string().min(1).max(40),
  color: z.enum(["blue", "green", "orange", "purple", "neutral"]).default("neutral"),
});
export type Tag = z.infer<typeof tagSchema>;

/** Period code for SKU sales aggregates. Matches the legacy app's `time`
 *  field ("1 D" / "7 D" / "15 D" / "30 D"), normalized to a short code. */
export const SALES_PERIODS = ["1d", "7d", "15d", "30d"] as const;
export type SalesPeriod = (typeof SALES_PERIODS)[number];

export const salesMetricEntrySchema = z.object({
  period: z.enum(SALES_PERIODS),
  units: z.number().int(),
  revenue: z.number(),
});
export type SalesMetricEntry = z.infer<typeof salesMetricEntrySchema>;

export const skuSchema = z.object({
  id: idSchema,
  sku: z.string(),
  asin: z.string().nullable(),
  title: z.string(),
  imageUrl: z.string().nullable(),
  channel: z.enum(SALES_CHANNELS),
  /** Amazon fulfillment-channel: "DEFAULT" => FBM, else (AMAZON_*) => FBA. */
  fulfillmentChannel: z.string().nullable(),
  /** Amazon fulfillable barcode (from FBA inventory summaries). */
  fnSku: z.string().nullable(),
  price: z.number(),
  basePrice: z.number().nullable(),
  cost: z.number().nullable(),
  stock: z.number().int(),
  /** Legacy single 30-day units (kept for backward compat — derived from
   *  salesMetrics by the sales sync). */
  sales30d: z.number().int(),
  /** Per-period sales aggregates (1D / 7D / 15D / 30D). */
  salesMetrics: z.array(salesMetricEntrySchema).default([]),
  status: z.enum(SKU_STATUSES),
  favorite: z.boolean(),
  tags: z.array(tagSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Sku = z.infer<typeof skuSchema>;

export const skuCreateSchema = skuSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .partial({
    asin: true,
    imageUrl: true,
    fulfillmentChannel: true,
    fnSku: true,
    basePrice: true,
    cost: true,
    stock: true,
    sales30d: true,
    salesMetrics: true,
    favorite: true,
    tags: true,
  });
export type SkuCreateInput = z.infer<typeof skuCreateSchema>;

export const skuUpdateSchema = skuCreateSchema.partial();
export type SkuUpdateInput = z.infer<typeof skuUpdateSchema>;

/* --------------------------- Product ---------------------------- */

export const productSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  skuIds: z.array(idSchema),
  createdAt: z.string(),
});
export type Product = z.infer<typeof productSchema>;

export const productCreateSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  skuIds: z.array(idSchema).default([]),
});
export type ProductCreateInput = z.infer<typeof productCreateSchema>;

/* ------------------------- Price Schedule ----------------------- */

export const timeSlotSchema = z.object({
  /** 0=Sunday..6=Saturday for weekly, 1..31 for monthly */
  day: z.number().int(),
  /** "HH:MM" 24-hour, interpreted in the schedule's `timezone`. */
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** Price applied at startTime. */
  price: z.number().positive(),
  /** Price restored at endTime. Kept optional for single-shot legacy rows. */
  revertPrice: z.number().positive().optional(),
});
export type TimeSlot = z.infer<typeof timeSlotSchema>;

export const priceScheduleSchema = z.object({
  id: idSchema,
  skuId: idSchema,
  sku: z.string(),
  title: z.string(),
  type: z.enum(SCHEDULE_TYPES),
  status: z.enum(SCHEDULE_STATUSES),
  price: z.number().positive(),
  currentPrice: z.number().positive(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  /** No auto-revert; new price holds until the user changes it manually. */
  untilChanged: z.boolean().default(false),
  timeSlots: z.array(timeSlotSchema),
  timezone: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type PriceSchedule = z.infer<typeof priceScheduleSchema>;

export const priceScheduleCreateSchema = z.object({
  skuId: idSchema,
  type: z.enum(SCHEDULE_TYPES),
  price: z.number().positive(),
  currentPrice: z.number().positive(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  untilChanged: z.boolean().default(false),
  timeSlots: z.array(timeSlotSchema).default([]),
  timezone: z.string().default("America/New_York"),
});
export type PriceScheduleCreateInput = z.infer<typeof priceScheduleCreateSchema>;

/* ----------------------- Automation Rule ------------------------ */

export const automationRuleSchema = z.object({
  id: idSchema,
  name: z.string(),
  type: z.enum(AUTOMATION_TYPES),
  intervalHours: z.number().nullable(),
  amount: z.string(),
  active: z.boolean(),
  skuIds: z.array(idSchema),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type AutomationRule = z.infer<typeof automationRuleSchema>;

export const automationRuleCreateSchema = z.object({
  name: z.string().min(1).max(160),
  type: z.enum(AUTOMATION_TYPES),
  intervalHours: z.number().positive().nullable().optional(),
  amount: z.string().max(40).default("0"),
  active: z.boolean().default(true),
  skuIds: z.array(idSchema).default([]),
});
export type AutomationRuleCreateInput = z.infer<typeof automationRuleCreateSchema>;

/* ---------------------------- Alerts ---------------------------- */

export const alertSchema = z.object({
  id: idSchema,
  kind: z.enum(ALERT_KINDS),
  skuId: idSchema.nullable(),
  sku: z.string().nullable(),
  title: z.string(),
  message: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  acknowledged: z.boolean(),
  createdAt: z.string(),
});
export type Alert = z.infer<typeof alertSchema>;

export const notificationRuleSchema = z.object({
  id: idSchema,
  kind: z.enum(ALERT_KINDS),
  name: z.string(),
  config: z.record(z.unknown()),
  emails: z.array(z.string().email()),
  active: z.boolean(),
  createdAt: z.string(),
});
export type NotificationRule = z.infer<typeof notificationRuleSchema>;

export const notificationRuleCreateSchema = z.object({
  kind: z.enum(ALERT_KINDS),
  name: z.string().min(1).max(160),
  config: z.record(z.unknown()).default({}),
  emails: z.array(z.string().email()).default([]),
  active: z.boolean().default(true),
});
export type NotificationRuleCreateInput = z.infer<typeof notificationRuleCreateSchema>;

/* ------------------------ Lost Buy Box -------------------------- */

/** Why a SKU is not winning the Buy Box (mirrors the buy-box analyzer). */
export const LOST_BUYBOX_REASONS = [
  "other_seller_winning",
  "no_featured_offer",
  "unknown_winner_anonymized",
] as const;
export type LostBuyboxReason = (typeof LOST_BUYBOX_REASONS)[number];

/** One row of a Lost Buy Box report — an ASIN we are not winning. */
export const lostBuyboxRowSchema = z.object({
  asin: z.string(),
  /** Primary seller SKU (highest-quantity listing) — kept for export/snapshot. */
  sellerSku: z.string().nullable(),
  /** Every seller SKU mapped to this ASIN (a seller can list it many times). */
  skus: z.array(z.string()).default([]),
  productName: z.string().nullable(),
  /** Listing thumbnail (from the merchant listings report). */
  imageUrl: z.string().nullable().default(null),
  myPrice: z.number().nullable(),
  buyboxPrice: z.number().nullable(),
  buyboxSellerId: z.string().nullable(),
  reason: z.string(),
});
export type LostBuyboxRow = z.infer<typeof lostBuyboxRowSchema>;

export const lostBuyboxSummarySchema = z.object({
  total: z.number().int(),
  won: z.number().int(),
  missed: z.number().int(),
  missedOtherSeller: z.number().int(),
  missedNoFeatured: z.number().int(),
  missedAnonymized: z.number().int(),
  errors: z.number().int(),
});
export type LostBuyboxSummary = z.infer<typeof lostBuyboxSummarySchema>;

/** The most-recent scan snapshot for a workspace (null until first scan). */
export const lostBuyboxRunSchema = z.object({
  marketplaceId: z.string().nullable(),
  inventoryCount: z.number().int(),
  summary: lostBuyboxSummarySchema,
  rows: z.array(lostBuyboxRowSchema),
  erroredAsins: z.array(z.string()),
  updatedAt: z.string().nullable(),
});
export type LostBuyboxRun = z.infer<typeof lostBuyboxRunSchema>;

export const ignoredAsinSchema = z.object({
  asin: z.string(),
  note: z.string().nullable(),
  sellerSku: z.string().nullable(),
  productName: z.string().nullable(),
  imageUrl: z.string().nullable(),
  myPrice: z.number().nullable(),
  buyboxPrice: z.number().nullable(),
  buyboxSellerId: z.string().nullable(),
  marketplaceId: z.string().nullable(),
  ignoredAt: z.string(),
});
export type IgnoredAsin = z.infer<typeof ignoredAsinSchema>;

/** Add one or more ASINs to the ignore list, optionally with report-row
 * snapshots so the Ignored view keeps full context (SKU/product/prices). */
export const ignoreCreateSchema = z.object({
  asins: z.array(z.string().min(1)).min(1),
  note: z.string().max(500).optional(),
  rows: z.array(lostBuyboxRowSchema).optional(),
});
export type IgnoreCreateInput = z.infer<typeof ignoreCreateSchema>;

/* ---------------------- Buy Box Alert --------------------------- */

const HHMM = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:MM (24-hour)");

/** Scheduled buy-box-loss email digest config (one per workspace). */
export const buyboxAlertSchema = z.object({
  enabled: z.boolean(),
  /** Local time of day to send the digest, "HH:MM" 24-hour. */
  sendTime: HHMM,
  timezone: z.string(),
  emails: z.array(z.string().email()),
  /** Local date (YYYY-MM-DD) the digest was last handled; null = never. */
  lastSentOn: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type BuyboxAlert = z.infer<typeof buyboxAlertSchema>;

export const buyboxAlertUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    sendTime: HHMM.optional(),
    timezone: z.string().min(1).max(64).optional(),
    emails: z.array(z.string().email()).max(20).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "No fields to update" });
export type BuyboxAlertUpdateInput = z.infer<typeof buyboxAlertUpdateSchema>;

/* ---------------------- Sales Alert ----------------------------- */

/** Scheduled sales-alert email digest config (one per workspace). */
export const salesAlertSchema = z.object({
  enabled: z.boolean(),
  sendTime: HHMM,
  timezone: z.string(),
  emails: z.array(z.string().email()),
  /** 7d sales drop vs prior 7d window that triggers a "drop" alert (percent). */
  thresholdDropPct: z.number().int().min(1).max(100),
  /** Active SKU with no sales for ≥ N days → "stalled SKU" alert. */
  thresholdZeroDays: z.number().int().min(1).max(365),
  /** Days-of-supply (stock / daily-velocity) below this → "running out" alert. */
  thresholdLowDays: z.number().int().min(1).max(365),
  lastSentOn: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type SalesAlert = z.infer<typeof salesAlertSchema>;

export const salesAlertUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    sendTime: HHMM.optional(),
    timezone: z.string().min(1).max(64).optional(),
    emails: z.array(z.string().email()).max(20).optional(),
    thresholdDropPct: z.number().int().min(1).max(100).optional(),
    thresholdZeroDays: z.number().int().min(1).max(365).optional(),
    thresholdLowDays: z.number().int().min(1).max(365).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "No fields to update" });
export type SalesAlertUpdateInput = z.infer<typeof salesAlertUpdateSchema>;

/* -------------------------- Activity ---------------------------- */

export const activitySchema = z.object({
  id: idSchema,
  action: z.enum(ACTIVITY_ACTIONS),
  entityType: z.string(),
  entityId: z.string().nullable(),
  summary: z.string(),
  meta: z.record(z.unknown()),
  actor: z.string(),
  createdAt: z.string(),
});
export type Activity = z.infer<typeof activitySchema>;

/* --------------------------- Reports ---------------------------- */

export const reportRowSchema = z.object({
  skuId: idSchema,
  sku: z.string(),
  title: z.string(),
  units: z.number().int(),
  revenue: z.number(),
  prevUnits: z.number().int(),
  prevRevenue: z.number(),
});
export type ReportRow = z.infer<typeof reportRowSchema>;

/* ------------------------ Marketplaces -------------------------- */

export const marketplaceCredentialSchema = z.object({
  id: idSchema,
  channel: z.enum(SALES_CHANNELS),
  label: z.string(),
  connected: z.boolean(),
  sellerId: z.string().nullable(),
  marketplaceId: z.string().nullable(),
  createdAt: z.string(),
});
export type MarketplaceCredential = z.infer<typeof marketplaceCredentialSchema>;

export const marketplaceCredentialUpsertSchema = z.object({
  channel: z.enum(SALES_CHANNELS),
  label: z.string().min(1).max(120),
  sellerId: z.string().max(120).optional(),
  marketplaceId: z.string().max(120).optional(),
  refreshToken: z.string().max(4000).optional(),
  lwaAppId: z.string().max(200).optional(),
  lwaClientSecret: z.string().max(400).optional(),
});
export type MarketplaceCredentialUpsertInput = z.infer<
  typeof marketplaceCredentialUpsertSchema
>;

/* --------------------------- Settings --------------------------- */

export const workspaceSettingsSchema = z.object({
  workspaceId: idSchema,
  name: z.string(),
  timezone: z.string(),
  currency: z.string(),
  defaultChannel: z.enum(SALES_CHANNELS),
});
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;

export const workspaceSettingsUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(64).optional(),
  currency: z.string().min(1).max(8).optional(),
  defaultChannel: z.enum(SALES_CHANNELS).optional(),
});
export type WorkspaceSettingsUpdateInput = z.infer<
  typeof workspaceSettingsUpdateSchema
>;

/* ------------------------ API envelope -------------------------- */

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type Pagination = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
