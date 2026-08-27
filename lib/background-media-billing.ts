import type { BillingResourceType } from "@/lib/billing/types";
import type { SceneAsset } from "@/lib/types";

export type BackgroundMediaBillingResource = Extract<
  BillingResourceType,
  "image_standard" | "image_premium" | "speech"
>;

export type BackgroundMediaBillingMarker = {
  requestId: string;
  resourceType: BackgroundMediaBillingResource;
  quantity: number;
};

const REQUEST_ID_KEY = "backgroundGenerationRequestId";
const RESOURCE_TYPE_KEY = "backgroundBillingResourceType";
const QUANTITY_KEY = "backgroundBillingQuantity";

function validQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : undefined;
}

function validResourceType(value: unknown): value is BackgroundMediaBillingResource {
  return value === "image_standard" || value === "image_premium" || value === "speech";
}

export function tagAssetForBackgroundBilling(
  asset: SceneAsset,
  marker: BackgroundMediaBillingMarker
): SceneAsset {
  const quantity = validQuantity(marker.quantity);
  if (!marker.requestId.trim()) throw new Error("Background billing request id is required.");
  if (!quantity) throw new Error("Background billing quantity must be positive.");
  return {
    ...asset,
    metadata: {
      ...asset.metadata,
      [REQUEST_ID_KEY]: marker.requestId,
      [RESOURCE_TYPE_KEY]: marker.resourceType,
      [QUANTITY_KEY]: quantity
    }
  };
}

export function backgroundBillingMarkerForAsset(
  asset: SceneAsset | undefined,
  requestId: string
): BackgroundMediaBillingMarker | undefined {
  if (!asset?.metadata || asset.metadata[REQUEST_ID_KEY] !== requestId) return undefined;
  const resourceType = asset.metadata[RESOURCE_TYPE_KEY];
  const quantity = validQuantity(asset.metadata[QUANTITY_KEY]);
  if (!validResourceType(resourceType) || !quantity) return undefined;
  return { requestId, resourceType, quantity };
}
