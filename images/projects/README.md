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
