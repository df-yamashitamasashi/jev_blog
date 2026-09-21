const STRIPE_SECRET_KEY = "sk_live_xxxxxxxxxx";

export async function chargeCustomer(customerId: string, amount: number) {
  const res = await fetch("https://api.stripe.com/v1/charges", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `customer=${customerId}&amount=${amount}&currency=jpy`,
  });
  return res.json();
}
