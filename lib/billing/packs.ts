export const creditPacks = [
  {
    id: "starter",
    name: "Starter",
    priceUsdCents: 900,
    credits: 1_000,
    bonusCredits: 100,
    standardVideoEstimate: 6,
    description: "For trying complete video workflows",
    featured: false
  },
  {
    id: "creator",
    name: "Creator",
    priceUsdCents: 2_900,
    credits: 3_500,
    bonusCredits: 600,
    standardVideoEstimate: 23,
    description: "For regular creators and small teams",
    featured: true
  },
  {
    id: "studio",
    name: "Studio",
    priceUsdCents: 7_900,
    credits: 10_500,
    bonusCredits: 2_600,
    standardVideoEstimate: 70,
    description: "For production teams with steady volume",
    featured: false
  }
] as const;

export type CreditPackId = typeof creditPacks[number]["id"];

export function creditPack(packId: string) {
  return creditPacks.find((pack) => pack.id === packId);
}

export function usdPrice(priceUsdCents: number) {
  return `$${(priceUsdCents / 100).toFixed(0)}`;
}

export function creditsPerUsd(pack: typeof creditPacks[number]) {
  return pack.credits / (pack.priceUsdCents / 100);
}
