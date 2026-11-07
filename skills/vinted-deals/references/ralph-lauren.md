# Ralph Lauren: what to check in the photos

Read this before judging an RL listing. No single check proves a piece genuine; fakes copy logos and
tag numbers. Several checks agreeing, on clear photos, is what earns "likely genuine".

## Which line is it?

Labels, materials and value differ by line, so name the line before judging. On Vinted the brand field
is chosen by the seller; the neck label is what counts.

| Line | What it is |
|---|---|
| Polo Ralph Lauren | The core casual line: polos, Oxford shirts, knitwear, chinos, outerwear. Most listings, most fakes. |
| Ralph Lauren Purple Label | Top-tier men's line. Expensive; check composition (cashmere, fine wool) against the listing. |
| RRL (Double RL) | Premium heritage workwear and denim. |
| RLX / Polo Golf / Ralph Lauren Golf | Performance, golf and ski. Usually polyester blends: a "100% cotton" RLX tag is odd. |
| LAUREN Ralph Lauren | Lower-priced line, mostly womenswear. |
| Chaps | Budget licensed line sold through department stores. Low resale value, rarely worth faking. |
| Ralph Lauren Sport / Polo Sport | Women's sport line / 1990s–2000s sportswear line. |
| Polo Jeans Co., Denim & Supply | Discontinued denim/youth lines; common in vintage listings. |
| Ralph Lauren Collection | Women's luxury runway line. |

Older pieces can carry labels reading "Polo by Ralph Lauren" or just "Polo". That alone is not a fake
sign. Tags reading "Made in USA" are nearly always vintage.

## The checklist

Go through these with the original-size photos (`get_item_photos`). For each, say: matches,
doesn't match, or not shown.

**0. The gold QR label** — the user's first test
- Recent genuine pieces have a gold label with a QR code; each garment's code is unique and links into
  Ralph Lauren's product-ID system: `q-rl.us/<15 characters>`, or a `tn.gg` short link (EVRYTHNG,
  the platform RL uses). Both lead to `qrscan.ralphlauren.com`.
- `get_item` decodes the codes in the photos. The user opens the link (or scans the label) and RL's page
  shows the garment. The product record behind one code gave the style ("LS CABLE CN … SWEATER"),
  colour ("CAMEL MELANGE"), size (XL), cut (MENS) and fabric (90% wool, 10% cashmere); compare what
  the page shows with the listing.
- A QR code linking anywhere else, the same code in another seller's listing, or a label for a
  different colour, size or cut: treat as fake.
- No label: most cheap fakes, but also genuine pieces made before the labels came in, and sellers who
  didn't photograph it. Ask for a photo of the label.

**1. Neck label and size tab**
- Main logo label, with a small tab sticking out to the right carrying the size. Modern polos and
  shirts often add a fit tag (e.g. Classic Fit, Custom Slim Fit, Slim Fit) sewn in below the main label.
- Modern labels: silver/grey writing on navy, or a newer version with yellow writing on navy.
- Neat, straight stitching. Crooked, frayed or glued-looking labels are a warning sign.
- Sweaters use a similar layout to the polos.

**2. Care and composition tags** — the most useful check in photos
- Genuine pieces usually have several tags: composition and care instructions in several languages,
  crisply printed in a consistent font. Blue tags are usual; white is normal on women's, kids' and
  many post-2010 pieces.
- Red flag: a single small cheap tag with a few care symbols and little more than "100% Cotton".
- Misspellings, blurry or smudged print, uneven letter spacing: red flags.
- Check the tag's composition against the listing and the line (cotton piqué polo vs. polyester RLX).
- Many US-market tags show RN 41381, often cited as Ralph Lauren's registration number. Counterfeiters
  copy it, so seeing it proves nothing. Licensed lines can carry other numbers.
- Newer retail tags may have a QR code that should open the garment's page on ralphlauren.com, though
  where it lands depends on the country it's scanned from. The user can scan it from the photo with a
  phone.

**3. The pony (or other logo)**
- On most tops the pony is embroidered on the left chest.
- Genuine embroidery is dense and clean: horse and rider clearly separate, mallet raised, legs and
  tail distinct, edges sharp, no loose threads.
- Warning signs: a blobby or misshapen horse, rider merged into the horse, mallet missing or fused,
  sloppy or thin stitching, an odd size or position for the model.
- Pony present ≠ genuine (fakes have one), and pony absent ≠ fake (some genuine pieces have none).

**4. Buttons**
- Shirts: plain round mother-of-pearl-style buttons, sewn neatly with little excess thread.
- Buttons with printed words or images, or cheap clear plastic buttons, are a strong fake sign.
  Embossed buttons do exist on some genuine pieces.

**5. Construction**
- Polos have side vents at the hem. A hem seam sealed all the way down suggests a fake. This comes from
  one authenticator's observation, so treat it as a strong hint, not a rule.
- Stripes, checks and prints should line up across seams and pockets. Low-quality fakes don't bother.
- Fabric that looks thin, shiny or cheap in close-ups, or rough finishing at seams: warning signs. Some
  fakes use good fabric, though, so good fabric proves nothing.

**6. Fit**
- Menswear runs true to size, sometimes slim after about 2010; womenswear runs slim. A size S that is
  enormous suggests a fake. Ask for pit-to-pit and length measurements and compare with the size.

**7. Knitwear and Polo Bear**
- Cable knits: even, consistent knit; composition (cotton, wool, cashmere) should match the listing.
- Polo Bear sweaters: on Ralph Lauren's own product page the bear is intarsia-knit with embroidered
  details, and the current model has "RL" embroidered at the left hem. A printed bear or one sewn on as
  a patch is a warning sign.

## Weak signals: don't lean on them

- **Missing tags:** charity shops and outlets cut them off. Weak on its own, but it means you can't
  check, so ask for other photos.
- **"Polo"-only neck label:** fine on older pieces; check the rest.
- **White care tags:** normal on many genuine pieces.
- **Country of manufacture:** genuine RL is made in many countries (China, Sri Lanka, Vietnam, Peru,
  India and more).
- **RN 41381 present:** copied by fakes.
- **A QR code that merely decodes:** the link must also match the garment (see check 0).

## Fake patterns on resale sites

- The most-faked pieces are the classic polos (including Big Pony), cable-knit and Polo Bear jumpers,
  quarter-zips, hoodies and caps: popular and easy to copy.
- Brand-new-with-tags pieces far under the market, especially several sizes of the same item from one
  seller (`get_seller`: high new-with-tags share, repeated titles).
- Stock or catalogue photos, or the same polished photos as other listings, instead of the seller's own
  photos of the actual item.
- New accounts with no reviews selling many "new" designer pieces.

## Asking the seller

When key photos are missing, give the user a message to send, e.g.:

> Hi! Could you add a few close-up photos before I buy: the neck label with the size tab, both sides of
> the care/composition tags inside, a straight-on close-up of the pony logo, and the buttons? A
> pit-to-pit and length measurement would be great too. Thanks!

A seller with a genuine item usually obliges. Excuses, or the listing being "reserved" for someone
else, are informative too.

## Sources

- Sam Talks Style, "How to authenticate Polo Ralph Lauren garments" (2019):
  https://samtalksstyle.com/2019/05/29/is-your-polo-ralph-lauren-garment-authentic/ (labels, laundry
  tags, buttons, side vents, fit, weak signals).
- Ralph Lauren, Polo Bear sweater product page:
  https://www.ralphlauren.com/men-clothing-sweaters/polo-bear-sweater/100082617.html (intarsia bear,
  "RL" at the left hem).
- 1stDibs answers on vintage Polo Ralph Lauren (Made in USA tags):
  https://www.1stdibs.com/answers/how-to-tell-if-polo-ralph-lauren-is-vintage
- The line descriptions and the fake patterns are general background. Verify specifics against the
  label in front of you.
