/**
 * NineYard REST API response shapes — mirrors what /swagger/v1/swagger.json
 * declares. Only the fields we actually read are typed; everything else stays
 * loose so an upstream additive change doesn't break our sync.
 */

export interface NyToken {
  accessToken: string;
  expiresIn: number;
  expires: string;
}

/** One row of /api/Skus — a per-account, per-channel marketplace listing. */
export interface NyApiSku {
  accountSkuId: number;
  id: number;
  sku: string | null;
  channelId: string | null;
  account: string | null;
  isActive: boolean;
  image: string | null;
  title: string | null;
  channel: string | null;
  fulfillmentType: string | null;
  qty: number;
  price: number;
  rank: number | null;
  category: string | null;
  fbaType: string | null;
  minPrice: number;
  isMinPriceManual: boolean;
  maxPrice: number;
  isMaxPriceManual: boolean;
  defaultPrice: number;
  cost: number;
  shipCost: number;
  prepCost: number;
  markup: number;
  minMarkup: number;
  mapPrice: number | null;
  isMapActive: boolean;
  priceModel: number | null;
  priceModelName: string | null;
  reserve: number | null;
  inboundStock: number | null;
}

/** One row of /api/Items — master inventory item (image, title, total stock). */
export interface NyApiItem {
  itemId: number;
  itemVendorId: number | null;
  itemName: string;
  vendorItemName: string | null;
  vendorName: string | null;
  vendorId: number | null;
  title: string | null;
  brand: string | null;
  length: number;
  height: number;
  width: number;
  weight: number;
  price: number;
  avgPrice: number;
  caseQty: number | null;
  notes: string | null;
  qtyOnHand: number;
  leadDays: number | null;
  purchaseDays: number | null;
  inboundStock: number;
  localstock: number;
  totalStock: number;
  imageUrl: string | null;
  deleteFlag: boolean;
}

export interface NyItemsResponse {
  totalRecords: number;
  totalPages: number;
  itemMapping: NyApiItem[];
}

/** /api/Skus/GetSkuMappings response: accountSkuId → master item ids. */
export interface NySkuMapping {
  accountSkuId: number;
  mappedItems: { itemId: number; name: string; qty: number }[];
}

/** /api/Items/GetItemLocations response: per-warehouse stock breakdown
 *  for a single master item. Returned as an array of locations; the sync
 *  groups them by `warehouseName` into a flat map. */
export interface NyItemLocation {
  warehouseName: string | null;
  locationCode: string | null;
  locationName: string | null;
  qty: number;
  lastUpdate: string | null;
  locationId: number;
  warehouseId: number;
  itemId: number;
  note: string | null;
}
