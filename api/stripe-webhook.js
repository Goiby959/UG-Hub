// api/stripe-webhook.js
// Vercel serverless function — Stripe calls this directly (not the
// browser) right after a checkout session finishes. It verifies the
// request really came from Stripe, then records the donation so the
// "total donated" automatic badge has real data to check against.
//
// This intentionally does NOT touch create-checkout.js — that file
// already puts user_id and amount_usd into the session metadata,
// which is all this needs.

import Stripe from "stripe";

// Stripe signature verification needs the raw, unparsed request body,
// so the default JSON body parser has to be turned off for this route.
export const config = {
  api: {
    bodyParser: false,
  },
};

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const SUPABASE_URL = "https://stuvbeomwuaholmimurt.supabase.co";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("Stripe env vars missing (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET)");
    return res.status(500).json({ error: "Server misconfigured." });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is missing from environment");
    return res.status(500).json({ error: "Server misconfigured." });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Verify this request is genuinely from Stripe before trusting anything
  // in it — this is what stops someone from faking a donation.
  let event;
  try {
    const rawBody = await buffer(req);
    const signature = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: "Invalid signature." });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    if (session.payment_status === "paid") {
      const userId = session.metadata && session.metadata.user_id ? session.metadata.user_id : null;
      const amount = session.metadata && session.metadata.amount_usd
        ? session.metadata.amount_usd
        : (session.amount_total / 100).toFixed(2);

      try {
        const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/donations`, {
          method: "POST",
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": "application/json",
            // return=minimal: don't bother returning the row.
            // resolution=ignore-duplicates: Stripe can send the same
            // event more than once, and stripe_session_id is unique,
            // so a retry just gets silently skipped instead of erroring.
            Prefer: "return=minimal,resolution=ignore-duplicates",
          },
          body: JSON.stringify({
            user_id: userId || null,
            amount: amount,
            stripe_session_id: session.id,
          }),
        });
        if (!dbRes.ok) {
          console.error("Failed to record donation:", await dbRes.text());
        }
      } catch (e) {
        console.error("Error recording donation:", e);
      }
    }
  }

  return res.status(200).json({ received: true });
}
