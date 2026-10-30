// Every prompt lives here — easy to tweak.

const ANGLE = {
  top_down: 'shot straight down from directly above (top-down flat lay)',
  high_angle: 'shot from above at roughly a 45 degree angle',
  eye_level: 'shot at eye level, straight on',
  low_angle: 'shot from slightly below',
};
export const angleText = (a) => ANGLE[a] || ANGLE.top_down;

/* ---------- 1. Analysis (sent to Gemini with your photos) ---------- */
export function analyze({ count, hasStyleRef, notes, language }) {
  return `You are an expert reseller assistant for Vinted (Europe). You get ${count} photo(s) of ONE product, labelled PHOTO 1..${count}${hasStyleRef ? ', plus one STYLE REFERENCE photo of a background the seller likes' : ''}.
Seller notes: ${notes || 'none'}

Return ONLY JSON. Do these 4 things:

1) IDENTIFY the product precisely: brand, model/name, category, colour, material, size (read it from tags or labels if visible) and condition. Judge condition honestly from what you see (wear, scuffs, creases, box damage). If unsure of the exact model, give the most likely one and set confidence lower.

2) FOR EACH PHOTO list what must be kept and removed for a background swap:
- shot_type: full_product | detail | label_or_tag | sole_or_bottom | packaging | other
- camera_angle: top_down | high_angle | eye_level | low_angle
- keep: EVERYTHING that is part of the sale or the photo's evidence — the product itself, its box/packaging (describe its exact condition, e.g. "torn, creased brown UGG box with damaged lid"), tissue paper, spare laces, booklets, cards, certificates, receipts, tags, dust bags, and ANY measuring tape or ruler. One short item per entry, including its condition.
- remove: only things that are NOT part of the sale: the floor/carpet/bed/table surface, random objects, cables, feet, phone shadows.
- In close-ups, a hand holding a tag goes under "keep" (removing it would change the shot).
- notes: anything risky for AI editing (small text, QR codes, transparent parts, black product on a dark surface, reflective parts).

3) SUGGEST exactly 4 SIMPLE backgrounds that make this product look its best and most premium. Only simple, realistic surfaces, e.g.: warm wooden table, light oak floor, dark grey concrete/stone tiles, black seamless studio backdrop, light grey seamless studio, white seamless studio, beige linen, white marble.${hasStyleRef ? ' Make option 1 match the STYLE REFERENCE photo as closely as possible.' : ''}
Choose for CONTRAST with the product (a black product needs lighter or mid-tone surfaces, or a dark studio with soft rim light). No props, no scenery.
Each: name (2-4 words), why (max 10 words), scene (one detailed sentence describing only the surface: material, colour, texture, finish, lighting).

4) WRITE a Vinted listing in ${language}:
- title: max 60 characters. Brand + model + key detail + size. No emojis, no hype words.
- description: 2-4 SHORT lines max: what it is, size, honest condition, what's included. Keep it slim.
- hashtags: 8-12 relevant hashtags (brand, model, category, style, colour), lowercase, no spaces inside a tag.

JSON shape:
{"product":{"name":"","brand":"","model":"","category":"","colour":"","material":"","size":"","condition":"New with tags | New without tags | Very good | Good | Satisfactory","condition_notes":"","confidence":"high | medium | low"},
"photos":[{"n":1,"shot_type":"","camera_angle":"","summary":"max 8 words","keep":[""],"remove":[""],"notes":""}],
"backgrounds":[{"name":"","why":"","scene":""}],
"listing":{"title":"","description":"","hashtags":["#tag"]}}`;
}

/* ---------- 2. Price (uses Google Search when available) ---------- */
export function price(p, notes) {
  return `Product: ${[p.brand, p.model || p.name].filter(Boolean).join(' ')} (${p.category || ''}, ${p.colour || ''}, size ${p.size || 'unknown'}). Condition: ${p.condition || 'unknown'}. ${p.condition_notes || ''} ${notes ? 'Seller notes: ' + notes : ''}
Find:
1) the retail price in EUR in Europe (official store or big retailers; if discontinued, the last known retail price),
2) what it realistically sells for second-hand on Vinted and similar EU resale sites in this condition.
Return ONLY JSON:
{"retail_eur": number or null, "retail_note": "where / short", "resale_low": number, "resale_high": number, "suggested": number, "reason": "max 20 words", "confidence": "high | medium | low"}`;
}

/* ---------- 3. Background generation prompt (you paste into Gemini / Flow) ---------- */
export function background(scene, angle, withRef = false) {
  return `${withRef ? 'Use the attached photo as the style reference and match its look closely.\n' : ''}Create a photorealistic, completely EMPTY product-photography background.
Surface: ${scene}.
Camera: ${angleText(angle)}, like a phone photo of a product placed on this surface.
Lighting: soft, natural, even light with gentle falloff. No harsh glare or hard reflections.
Keep it simple and clean: no objects, no props, no people, no hands, no shadows of people, no text, no logos, no watermark. Leave the centre empty for a product.
Ultra-detailed, sharp, high resolution, looks like a real photo, not a render. Vertical 4:5 format.`;
}

/* ---------- 4. Per-photo swap prompt (you paste with: your photo + the background) ---------- */
export function photo(ph, product) {
  const name = [product.brand, product.model || product.name].filter(Boolean).join(' ') || 'the product';
  const keep = (ph.keep?.length ? ph.keep : [name]).map((k) => `- ${k}`).join('\n');
  const remove = (ph.remove?.length ? ph.remove.join(', ') : 'the old floor / surface');
  const close = ['label_or_tag', 'detail'].includes(ph.shot_type);
  const dark = /black|dark|navy|charcoal/i.test(product.colour || '');

  return `I'm attaching 2 images.
IMAGE 1 = my real product photo. IMAGE 2 = the new background.

GOAL: Put everything listed below from Image 1 onto the background from Image 2, so it looks like it was really photographed there.

KEEP 100% IDENTICAL TO IMAGE 1 — do not redraw, clean, repair, straighten or "improve":
${keep}
Keep every scuff, crease, tear, mark and sign of wear exactly as it is — a worn or torn box must stay worn or torn. The buyer must receive exactly what they see.
Keep all logos, labels, text, numbers and QR codes exactly the same and readable.${/tape|ruler|measur/i.test(keep) ? '\nThe measuring tape must stay exactly where it is, with the same numbers visible.' : ''}
Keep the exact camera angle (${angleText(ph.camera_angle)}), crop and framing, and the exact position and size of everything above.

REMOVE: ${remove}, and anything else not listed under KEEP.

BACKGROUND: use Image 2 as it is — same material, colour and texture. Only adjust its perspective and scale to match the camera angle of Image 1.

MAKE IT REAL:
- soft, realistic contact shadows where the items touch the surface, matching the light direction
- only a subtle brightness / white-balance match on the items so they sit naturally in the scene — never change their real colours${dark ? '\n- the product is dark: separate it from the background with soft natural light on its edges, never by lightening its colour' : ''}
- clean, natural edges with no halo, glow or cut-out look
- photorealistic, sharp, like a real phone photo. No added objects, text or watermark.${close ? `

THIS IS A CLOSE-UP: change ONLY the small areas where the old surface is visible. Everything else — including the label, its text and any hand or fingers — stays pixel-identical.` : ''}${ph.notes ? `\n\nNote about this photo: ${ph.notes}` : ''}`;
}
