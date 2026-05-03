# Review Request Templates

Post-job customer review request templates for Beit Building Contractors. Use after every completed job.

## Best-practice rules (read first)

1. **Timing matters.** Send within 24-48 hours of job completion. Beyond 7 days, response rates drop sharply.
2. **Never offer compensation.** Discounts, gift cards, and rebates in exchange for reviews violate Google's policy AND the FTC's December 2024 rule. Penalties include listing suspension and (for repeated violations) federal fines.
3. **Never review-gate.** "Review-gating" is the practice of asking happy customers publicly while routing unhappy ones to private feedback. The FTC explicitly bans this. The honest version: ask EVERY customer, accept the review they choose to leave, respond professionally to all of them.
4. **One ask per customer.** Don't follow up more than once. A polite single ask converts at 15-25%; nagging tanks both response rate AND reputation.
5. **ADA-friendly language.** Avoid jargon, keep sentences short, prefer "tap the link" over "click here."
6. **Document the ask.** Maintain a spreadsheet of who you asked, when, and whether they reviewed — for compliance + analytics.

The direct Google review link comes from the GBP dashboard once the listing is verified ("Get more reviews" → "Share review form"). Format is typically `https://g.page/r/<place-id>/review`. **Replace `https://g.page/r/PLACEHOLDER/review` everywhere below with your real URL once verified.**

---

## English email — post-job thank-you

### Subject lines (pick one, or A/B test)

1. Quick favor — would you share your experience?
2. Thanks for choosing Beit Building Contractors
3. We'd love your feedback on the {{job_type}}

### Body

```
Subject: Quick favor — would you share your experience?

Hi {{customer_name}},

Thank you for choosing Beit Building Contractors for your {{job_type}}.
We finished up on {{completion_date}} and we hope you're as happy with
the result as we are.

If you have a moment, would you mind sharing a quick review on Google?
It takes less than 60 seconds and helps other Orlando-area homeowners
find a licensed local contractor when they need one.

Tap here to leave a review:
https://g.page/r/PLACEHOLDER/review

Whatever you write — good or constructive — we read every word and use
it to improve. If something didn't go right, please reply to this
email first so we can fix it directly.

Thanks again,
The Beit Building team

—
Beit Building Contractors LLC
(407) 942-6459 · beitbuilding@gmail.com
2703 Dobbin Dr, Orlando, FL 32817
Licensed CCC1337413 · CGC1534077
Verify: myfloridalicense.com
```

---

## Spanish email — post-job thank-you

### Subject lines

1. Un favor rápido — ¿podría compartir su experiencia?
2. Gracias por elegir Beit Building Contractors
3. Nos encantaría su opinión sobre {{job_type}}

### Body

```
Subject: Un favor rápido — ¿podría compartir su experiencia?

Hola {{customer_name}},

Gracias por elegir a Beit Building Contractors para su {{job_type}}.
Terminamos el {{completion_date}} y esperamos que esté tan satisfecho
con el resultado como nosotros.

Si tiene un momento, ¿podría compartir una breve reseña en Google?
Toma menos de 60 segundos y ayuda a otros propietarios del área de
Orlando a encontrar un contratista local con licencia cuando lo
necesitan.

Toque aquí para dejar una reseña:
https://g.page/r/PLACEHOLDER/review

Lo que escriba — bueno o constructivo — lo leemos y lo usamos para
mejorar. Si algo no salió bien, por favor responda a este correo
primero para que podamos solucionarlo directamente.

Gracias nuevamente,
El equipo de Beit Building

—
Beit Building Contractors LLC
(407) 942-6459 · beitbuilding@gmail.com
2703 Dobbin Dr, Orlando, FL 32817
Con licencia CCC1337413 · CGC1534077
Verifique: myfloridalicense.com
```

---

## SMS template (160 chars target)

Plain SMS works well as a 24-hour follow-up to the email — most customers see SMS faster than email. Keep it under 160 characters so it sends as a single message (160 is the GSM-7 limit).

### English (158 chars)

```
Hi {{customer_name}}, thanks again for choosing Beit Building. If you have a sec, a quick Google review really helps: https://g.page/r/PLACEHOLDER/review
```

### Spanish (159 chars)

```
Hola {{customer_name}}, gracias por elegir Beit Building. ¿Tiene un segundo para una reseña en Google? Nos ayuda mucho: https://g.page/r/PLACEHOLDER/review
```

---

## Replying to reviews (template)

Every review — positive or negative — should get a reply within 48 hours. Replies are public and signal active management.

### Positive review reply (5 stars)

```
Thank you so much, {{reviewer_first_name}}! It was a pleasure working
on your {{job_type}}. We appreciate you taking the time to share your
experience and look forward to being your contractor of choice for
anything else you need down the line.

— The Beit Building team
```

### Constructive review reply (3-4 stars or critical-but-fair)

```
Thank you for the honest feedback, {{reviewer_first_name}}. We take
every comment seriously — would you mind giving us a call at
(407) 942-6459 so we can talk through what we could have done better?
We'd appreciate the chance to make it right.

— The Beit Building team
```

### Negative review reply (1-2 stars)

```
{{reviewer_first_name}}, we're sorry your experience didn't meet
expectations. We'd like to understand what happened and see what we
can do to address it. Please call us directly at (407) 942-6459 or
email beitbuilding@gmail.com so we can speak with you privately.

— The Beit Building team
```

NEVER respond defensively in public — even when the review is unfair or factually wrong. Acknowledge the customer's experience, take the conversation private, and let your overall review distribution speak for itself.

---

## Tracking spreadsheet (suggested format)

Maintain a simple Google Sheet with these columns:

| Job ID | Customer Name | Email | Phone | Job Type | Completion Date | Email Sent Date | SMS Sent Date | Reviewed (Y/N) | Star Rating | Replied (Y/N) | Notes |

This doubles as your customer-relationship-management starter and is the source for the testimonials we eventually mirror into `src/data/reviews.ts` (after Phase 12 GBP integration brings in real source attribution).

---

## Variables glossary

| Variable | Description | Example |
| --- | --- | --- |
| `{{customer_name}}` | Customer's first name (or first + last for formal) | "Maria" |
| `{{job_type}}` | Specific service performed | "tile roof replacement" |
| `{{completion_date}}` | Date the job was completed | "April 22, 2026" |
| `{{reviewer_first_name}}` | Reviewer's first name (from GBP) | "James" |

When using a CRM or email tool, configure these as merge tags. Test the merge on a sample customer before sending to the full list.
