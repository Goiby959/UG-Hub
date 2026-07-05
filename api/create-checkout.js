// api/create-checkout.js
// Vercel serverless function — creates a Stripe Checkout session for
// a one-time "buy me a coffee" donation of any amount between $1-$1000.

import Stripe from "stripe";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      console.error("STRIPE_SECRET_KEY is missing from environment");
      return res.status(500).json({ error: "Server misconfigured: missing Stripe key." });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // req.body may already be a parsed object, or a raw string depending
    // on the runtime — handle both cases defensively.
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: "Invalid JSON body." });
      }
    }
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Missing request body." });
    }

    const { amount, userId, username } = body;

    const dollars = parseFloat(amount);
    if (isNaN(dollars) || dollars < 1 || dollars > 1000) {
      return res.status(400).json({ error: "Amount must be between $1 and $1000." });
    }

    const cents = Math.round(dollars * 100);
    const origin = req.headers.origin || "https://ug-hub.vercel.app";
    const successUrl = origin + "/#coffee-success";
    const cancelUrl  = origin + "/#coffee-cancel";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Buy GoibyJr a coffee",
              description: "A one-time donation to support UG Hub. Thank you!",
            },
            unit_amount: cents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: successUrl,
      cancel_url:  cancelUrl,
      metadata: {
        user_id:    userId   || "",
        username:   username || "",
        amount_usd: String(dollars),
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    // Log full error server-side, and return the message to the client
    // temporarily so we can see exactly what's failing.
    console.error("create-checkout error:", err);
    return res.status(500).json({ error: "Server error: " + (err.message || String(err)) });
  }
}
