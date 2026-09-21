export function calculateDiscount(price: number, type: string): number {
  if (type === "VIP") {
    return price * 0.8;
  } else if (type === "SALE") {
    return price * 0.9;
  }
  return price;
}
