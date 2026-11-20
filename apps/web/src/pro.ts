/**
 * Tripica Pro, as shown in the app. Keep in sync with the Stripe prices (scripts/stripe-setup.ts
 * creates them with these amounts) and the PRO_MONTHLY_BUDGET / TRIAL_DAYS settings.
 */
export const PRO = {
  monthly: { price: "$8.99", per: "month" },
  yearly: { price: "$79", per: "year", note: "Save 27%" },
  credits: 500,
  trialDays: 3,
} as const;
