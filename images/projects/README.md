# Project images

Project screenshots live here. Each `<img>` in `index.html` / `work.html` points
at its file directly, and falls back to a generated placeholder only if the file
is missing. To swap an image, either overwrite the file below or update that `src`.

| Project    | File in use      | Notes                                        |
| ---------- | ---------------- | -------------------------------------------- |
| Net-Cat    | `net-cat.svg`    | Designed stand-in; swap for a real shot      |
| ElimuLocal | `elimulocal.jpg` | Live landing page capture                    |
| StyleVault | `stylevault.jpg` | Live landing page capture                    |
| Wapi       | `wapi.jpg`       | Original signed-in feed capture (kept as-is) |

## Sizes

Every raster shot is authored at exactly **3:2** (currently 1620×1080, JPEG
quality 82) because every frame that shows them is 3:2. With matching ratios
`object-fit: cover` bleeds to the frame edges and crops nothing — no letterbox
padding, no clipped words — while still filling the cards on the home page and
the windows on the work page.

So: **capture new shots at a 3:2 viewport** (e.g. 1620×1080) and save them 1620px
wide or larger. A shot with a different ratio will either letterbox or lose its
edges.

`net-cat.svg` is the exception — it is 16:9, so it is set to `object-fit: contain`
and keeps its own composition. `wapi.jpg` is 3:2 but was cropped on the left
when it was taken, and nothing in the page can bring those columns back; re-shoot
it if a signed-in capture becomes available.

## The hero portrait

`ascii-portrait.png` is **not** a project shot — it is the portrait behind the
home-page hero, which `main.js` reads pixel by pixel and redraws as a field of
ASCII characters. Three things matter more than the file size:

- It must keep its **alpha channel**. The transparent background is the mask: only
  pixels above alpha 128 become characters. Flattening it onto a background would
  turn the whole frame into a block of text.
- The silhouette needs **room around it**. Anything that runs off the edge of the
  frame becomes a solid slab of characters down that edge, so the subject is
  cropped to finish inside its own frame.
- It should be **mostly dark**. A character's weight comes from mean RGB
  brightness, so a bright, flat area (a light garment, a pale backdrop) draws as a
  dense block of `%` no matter how good the silhouette is. Hair, skin and shadow
  in the lower half of the ramp are what make the field read as a figure.

A non-square file is fine — the sampler fits it into the field box preserving its
aspect ratio. This one is 384×448 (PNG-8, 42 KB) and is only ever sampled at
roughly 56×41, so a bigger export buys nothing.

### Where this file came from

`ChatGPT Image Sep 25, 2026, 12_02_15 AM.png` is the drop it was cut from — a
crop only: nothing was retouched, recoloured or cut out. It is worth keeping
because it is the only one of the three drops that carries a real alpha
silhouette; the other two were fully opaque, with a light backdrop reaching the
bottom corners, so there was nothing clean to key the background against. If you
ever want a wider crop, re-shoot rather than recompose this one — past y≈980 the
silhouette reaches both edges of the frame and would read as a slab.

To redo the crop: take the silhouette's bounding box above **y=760 of 1448**, add
a 4% margin, scale so the long side is 448 px, then quantise to a 256-colour PNG.
760 is the last row that still holds a neck rather than a shoulder line — the
silhouette narrows to its neck minimum (~294 px wide) at y=680 and starts flaring
into the shoulders past y=740. The quantiser round-trips the mask to within
0.003%, so the cut-out comes through the PNG-8 conversion exactly.
