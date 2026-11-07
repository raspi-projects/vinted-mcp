# Vinted UK: buyer rules that matter

From Vinted's own pages, read 2026-11-07. Recheck them if a question turns on the exact rule.

## Paying and fees

- Buy only with the **"Buy now"** button. Payments made outside Vinted are not covered, and Vinted won't
  help with returns or refunds.
- The **Vinted fee** (renamed from "Buyer Protection fee" in October 2026; the calculation didn't change)
  is mandatory: "usually 3% to 8% + £0.3 to £0.8", depending on the item, order value and bundles. It
  appears in each listing's price breakdown. Example from the pricing API: £0.70 + 5% on a £95 jacket.
- Postage is extra and depends on the delivery option. Sellers can discount it, sometimes to free.
  `get_item` → `costs` shows the default option.
- Sellers abroad: the price is converted, and import VAT may apply (Vinted refunds it with a full
  refund where applicable).

## After delivery: the 2-day window

- **2 calendar days** to report an issue and request a refund, counted from when Vinted says the order
  should have been delivered. Purchases from **Pro (business) sellers: 14 days**.
- If you don't report in time, or confirm the order is OK, the money goes to the seller and Vinted can't
  help with a refund.
- So: open the parcel the day it arrives and check the labels and condition against the photos.
- **Significantly not as described:** the buyer pays return postage, and the return must be sent within
  5 business days of the seller asking for it. The refund covers the item, Vinted fee, postage and
  optional services, minus return postage.
- **Confirmed counterfeits** are refunded without sending the item back.
- When Vinted has strong evidence that a listing is counterfeit, the seller has 48 hours to prove it's
  authentic. Repeat offenders are banned.

## Item Verification (designer authenticity check)

- Optional, **£10 per item**, paid by the buyer at checkout. The fee covers the check and shipping from
  the seller to Vinted's hub; the Vinted fee still applies.
- **Eligible listings** meet all of: price **£85 or more**; brand on Vinted's eligible list; category
  clothing, bags, accessories, jewellery or shoes. They show a **diamond badge**.
- Only for items traded **within the UK**, and not for bundles. It checks authenticity, not condition,
  and Vinted may remove seals or tags during the check.
- The seller has 5 business days to ship to the hub; the check takes 1–2 business days; delivery
  usually takes up to 10 business days in total.
- **If the item fails:** it goes back to the seller, and the buyer gets a full refund (service, Vinted
  fee and all shipping) within 1–2 business days.
- If a verified item still seems wrong: "I have an issue" within 2 days of receiving it (14 for Pro
  sellers).
- The MCP server browses anonymously, and Vinted returned no Item Verification data to anonymous
  sessions for any listing tested. `get_item` then reports `offered: null` plus whether the published
  rules are met; the user confirms by looking for the diamond badge.

## Sources

- Refund policy: https://www.vinted.co.uk/help/465-the-vinted-refund-policy
- Item Verification for designer items: https://www.vinted.co.uk/help/1147
- Vinted fee: https://www.vinted.co.uk/help/342 and https://www.vinted.co.uk/pricelist (updated 08.10.2026)
- Safety: https://www.vinted.co.uk/safety
- Terms update summary (fee rename, 48-hour counterfeit window), Value Added Resource, Sep 2026:
  https://valueaddedresource.net/vinted-us-uk-australia-terms-october-2026/
