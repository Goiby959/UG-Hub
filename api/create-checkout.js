// api/create-checkout.js
// Vercel serverless function — creates a Stripe Checkout session for
// a one-time "buy me a coffee" donation of any amount between $1-$1000.

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { amount, userId, username } = req.body;

  const dollars = parseFloat(amount);
  if (isNaN(dollars) || dollars < 1 || dollars > 1000) {
    return res.status(400).json({ error: "Amount must be between $1 and $1000." });
  }

  const cents = Math.round(dollars * 100);
  const origin = req.headers.origin || "https://ug-hub.vercel.app";
  const successUrl = origin + "/#coffee-success";
  const cancelUrl  = origin + "/#coffee-cancel";

  try {
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
    console.error("Stripe error:", err.message);
    return res.status(500).json({ error: "Failed to create checkout session." });
  }
};
