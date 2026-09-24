/* ============================================================
   Ryan Kelly — portfolio behaviour
   1. hero ASCII particle field: the portrait sampled into a grid of
      characters that ripple and scatter around the pointer
   2. project image loading with graceful generated fallback
   3. scroll reveal, plus split-text reveals ([data-split])
      3b. those split texts, character by character or word by word
      3d. where the reader is — one answer, read by the navbar and by 8
   4. scroll-linked motion: the scroll progress bar, the pinned project card
      deck and its drifting shots, the fanned article deck, the experience
      rail, and the footer name (driven by scrolling, never autoplay)
      4b. the hero name, typing itself in on load
   5. mobile nav
   6. footer year
   7. contact form submit handling (a form service, or the visitor's mail app)
   8. ASCII section titles: the same field, spread across the page
   9. magnetic links: they lean toward the pointer
  10. roadtrip: the small run pinned to the bottom of the page — a car on a
      two-lane road, roadblocks that stop it with a question about the page
      you are reading, and a running record in local storage
   ============================================================ */

(function () {
  "use strict";

  /* ---------------------------------------------------------
     1. Hero ASCII particle field
     The portrait is read pixel by pixel and turned into a grid
     of monospace characters — one particle per character. The
     image itself is never drawn; only the characters are.
     The layout, the ramp and the physics are a port of the
     reference site's field: 7px monospace on a 0.7 / 1.1 grid,
     brightness taken as the plain mean of R,G,B, alpha running
     0.4 → 1.0, and alpha > 128 as the mask. At rest the field
     is still; moving the pointer over it makes it ripple and
     twinkle, and clicking sends a shockwave outward.
     --------------------------------------------------------- */
  const HERO_FIELD_IMAGE = "images/projects/ascii-portrait.png";
  // darkest → brightest — the reference site's own ramp, so the darkest
  // pixels of an image draw nothing at all. Both fields share it.
  const FIELD_RAMP = " .:-=+*#%@";
  // one colour per alpha step, so the draw loops swap fillStyle between
  // cached strings instead of building one per character per frame
  const COLOUR = [];
  for (let i = 0; i <= 100; i++) {
    COLOUR.push("rgba(100, 255, 218, " + (i / 100).toFixed(2) + ")");
  }
  // the reference sizes the field off the viewport rather than off a
  // container, and switches to a smaller type below 280px
  const HERO_FIELD_SIZE = function (width) {
    if (width <= 480) return Math.min(220, width - 40);
    if (width <= 768) return Math.min(280, width - 60);
    return 400;
  };

  function initHeroField() {
    const canvas = document.getElementById("ascii-field");
    if (!canvas || !canvas.getContext) return;

    const field = canvas.parentElement; // .hero-field, faded in on arrival
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const FILL = 0.8; // share of the square the portrait is fitted into
    const FOLLOW = 0.15; // how fast the smoothed pointer chases the real one
    const REPEL = 0.2; // repel radius, as a share of the field
    const REPEL_FORCE = 4;
    const SPRING_MIN = 0.01;
    const SPRING_MAX = 0.09;
    const DAMP_WAVE = 0.92; // while the field is rippling
    const DAMP_REST = 0.85; // while it is settling
    const WAVE = 0.15; // strength of the fluid ripple
    const TWINKLE = 0.1; // how much a character's alpha shimmers

    // on top of the reference's field: a ring that travels outward
    const SHOCK_SPEED = 1.05; // shares of the field per second
    const SHOCK_BAND = 0.1;
    const SHOCK_FORCE = 6;
    const MAX_SHOCKS = 4;

    const pointer = { x: -1000, y: -1000, tx: -1000, ty: -1000, active: false };

    let size = 400;
    let font = 7;
    let dpr = 1;
    let grid = null; // the sampled characters, one entry per cell
    let particles = [];
    let shocks = [];
    let raf = 0;
    let previous = 0;
    let clock = 0;
    let resizeTimer = 0;
    let onScreen = true;

    /* --- sizing --------------------------------------------------------- */
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = Math.round(HERO_FIELD_SIZE(window.innerWidth));
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      // only the width is set; CSS keeps the square shape and lets it
      // shrink if the column is narrower than the field wants to be
      canvas.style.width = size + "px";
    }

    /* --- portrait → characters ------------------------------------------ */
    function sample(portrait) {
      const aspect = portrait.naturalWidth / portrait.naturalHeight;
      let h = size * FILL;
      let w = h * aspect;
      if (w > size * FILL) {
        w = size * FILL;
        h = w / aspect;
      }
      const ox = (size - w) / 2;
      const oy = (size - h) / 2;

      const buffer = document.createElement("canvas");
      buffer.width = size;
      buffer.height = size;
      const bctx = buffer.getContext("2d", { willReadFrequently: true });
      if (!bctx) return null;
      bctx.drawImage(portrait, ox, oy, w, h);

      let pixels;
      try {
        pixels = bctx.getImageData(0, 0, size, size).data;
      } catch (error) {
        // a cross-origin pixel read (the page opened straight off the disk,
        // say) — leave the hero without a field rather than throwing
        return null;
      }

      font = size <= 280 ? 5 : 7;
      const stepX = font * 0.7;
      const stepY = font * 1.1;
      const ramp = FIELD_RAMP;
      const last = ramp.length - 1;
      const cells = [];

      for (let y = 0; y < size; y += stepY) {
        for (let x = 0; x < size; x += stepX) {
          const at = (Math.floor(y) * size + Math.floor(x)) * 4;
          // the portrait's own alpha is the mask
          if (pixels[at + 3] <= 128) continue;
          // brightness is the plain mean of R,G,B, as the reference reads it
          const bright = (pixels[at] + pixels[at + 1] + pixels[at + 2]) / 765;
          cells.push({
            x: Math.round(x * 10) / 10,
            y: Math.round(y * 10) / 10,
            char: ramp[Math.floor(bright * last)],
            alpha: 0.4 + bright * 0.6
          });
        }
      }

      return cells;
    }

    /* --- the live particles --------------------------------------------- */
    function spawn(cells, introduce) {
      particles = cells.map(function (cell) {
        // the reference throws everything a little way out and lets the
        // spring pull it home, one character after another
        const spread = introduce ? 400 : 0;
        return {
          x: cell.x + (Math.random() - 0.5) * spread,
          y: cell.y + (Math.random() - 0.5) * spread,
          tx: cell.x,
          ty: cell.y,
          vx: 0,
          vy: 0,
          char: cell.char,
          base: cell.alpha,
          alpha: introduce ? 0 : cell.alpha,
          delay: introduce ? Math.random() * 0.4 : 0,
          twinkle: Math.random() * Math.PI * 2
        };
      });
      shocks = [];
      clock = 0;
    }

    /* --- physics -------------------------------------------------------- */
    function step(dt) {
      clock += dt;
      // everything below is written per 1/60s frame
      const k = Math.min(dt * 60, 2);
      const repel = size * REPEL;
      const band = size * SHOCK_BAND;

      pointer.x += (pointer.tx - pointer.x) * FOLLOW * k;
      pointer.y += (pointer.ty - pointer.y) * FOLLOW * k;

      for (let i = shocks.length - 1; i >= 0; i--) {
        shocks[i].radius += size * SHOCK_SPEED * dt;
        shocks[i].life -= 0.87 * dt;
        if (shocks[i].life <= 0) shocks.splice(i, 1);
      }

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const age = clock - p.delay;
        if (age < 0) continue;

        // the field ripples and twinkles while the pointer is on it, and for
        // the first few seconds after it arrives — then it rests
        const live = pointer.active || age < 3;
        const shimmer = live ? Math.sin(clock * 2 + p.twinkle) * TWINKLE : 0;
        p.alpha = Math.max(
          0,
          p.base * (1 - Math.pow(1 - Math.min(age / 1.5, 1), 2)) + shimmer
        );

        if (pointer.active) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < repel && d > 0) {
            const shove = (1 - d / repel) * REPEL_FORCE * k;
            p.vx += (dx / d) * shove;
            p.vy += (dy / d) * shove;
          }
        }

        const ex = p.tx - p.x;
        const ey = p.ty - p.y;
        const settle = 1 - Math.pow(1 - Math.min(age / 2.5, 1), 3);
        const spring = (SPRING_MIN + settle * (SPRING_MAX - SPRING_MIN)) * k;
        p.vx += ex * spring;
        p.vy += ey * spring;

        if (live) {
          // the fluid part: a slow wave travelling across the whole field,
          // keyed off each character's resting position
          p.vx += Math.sin(clock * 0.5 + p.ty * 0.1) * WAVE * k;
          p.vy += Math.cos(clock * 0.5 + p.tx * 0.1) * WAVE * k;
          p.vx *= Math.pow(DAMP_WAVE, k);
          p.vy *= Math.pow(DAMP_WAVE, k);
        } else {
          p.vx *= Math.pow(DAMP_REST, k);
          p.vy *= Math.pow(DAMP_REST, k);
          // once it has settled, park it exactly on its cell
          if (age > 4 && Math.abs(ex) < 0.01 && Math.abs(ey) < 0.01) {
            p.x = p.tx;
            p.y = p.ty;
            p.vx = 0;
            p.vy = 0;
          }
        }

        for (let w = 0; w < shocks.length; w++) {
          const shock = shocks[w];
          const dx = p.x - shock.x;
          const dy = p.y - shock.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
          const gap = Math.abs(d - shock.radius);
          if (gap > band) continue;
          const blow = (1 - gap / band) * shock.life * SHOCK_FORCE * k;
          p.vx += (dx / d) * blow;
          p.vy += (dy / d) * blow;
        }

        p.x += p.vx * k;
        p.y += p.vy * k;
      }
    }

    /* --- drawing -------------------------------------------------------- */
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.font = font + "px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const level = Math.round(Math.max(0, Math.min(1, p.alpha)) * 100);
        ctx.fillStyle = COLOUR[level];
        ctx.fillText(p.char, p.x, p.y);
      }
    }

    /* --- the loop ------------------------------------------------------- */
    function tick(now) {
      raf = window.requestAnimationFrame(tick);
      const dt = previous ? Math.min(0.034, (now - previous) / 1000) : 0.016;
      previous = now;
      step(dt);
      draw();
    }

    function play() {
      if (still || raf || !particles.length) return;
      previous = 0;
      raf = window.requestAnimationFrame(tick);
    }

    function pause() {
      if (!raf) return;
      window.cancelAnimationFrame(raf);
      raf = 0;
    }

    /* --- input ---------------------------------------------------------- */
    function local(event) {
      const rect = canvas.getBoundingClientRect();
      // the canvas can be displayed smaller than its grid, so scale the
      // pointer into field coordinates
      const scale = size / (rect.width || size);
      return {
        x: (event.clientX - rect.left) * scale,
        y: (event.clientY - rect.top) * scale
      };
    }

    canvas.addEventListener("pointermove", function (event) {
      if (still) return;
      const point = local(event);
      pointer.tx = point.x;
      pointer.ty = point.y;
      if (!pointer.active) {
        // start the smoothed pointer where the real one is, so it does not
        // sweep in from the edge and blow the field apart on arrival
        pointer.x = point.x;
        pointer.y = point.y;
        pointer.active = true;
      }
    });

    canvas.addEventListener("pointerleave", function () {
      pointer.active = false;
    });

    canvas.addEventListener(
      "pointerdown",
      function (event) {
        if (still || !particles.length) return;
        const point = local(event);
        pointer.x = point.x;
        pointer.y = point.y;
        pointer.tx = point.x;
        pointer.ty = point.y;
        pointer.active = true;
        // only a few rings alive at once, so mashing the field stays cheap
        if (shocks.length >= MAX_SHOCKS) shocks.shift();
        shocks.push({ x: point.x, y: point.y, radius: 0, life: 1 });
      },
      { passive: true }
    );

    /* --- lifecycle ------------------------------------------------------ */
    // re-samples the portrait for the current field size and starts it going;
    // `introduce` replays the scattered entrance, which is only wanted when
    // the portrait first arrives
    function refresh(introduce) {
      grid = sample(portrait);
      if (!grid) return;
      // when motion is reduced the field holds a single settled frame, so it
      // is spawned at rest rather than scattered and faded in
      spawn(grid, introduce && !still);
      draw();
      // the portrait is on screen as characters now, so the field can fade in
      if (field) field.classList.add("is-ready");
      if (!still && onScreen && document.visibilityState !== "hidden") play();
    }

    const portrait = new Image();
    portrait.decoding = "async";
    portrait.addEventListener("load", function () {
      refresh(true);
    });

    resize();
    portrait.src = HERO_FIELD_IMAGE;

    window.addEventListener("resize", function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        const before = size;
        resize();
        // a move that does not change the breakpoint leaves the field alone
        if (size === before) return;
        refresh(false);
      }, 150);
    });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        function (entries) {
          onScreen = entries[0].isIntersecting;
          if (onScreen) play();
          else pause();
        },
        { threshold: 0 }
      ).observe(canvas);
    }

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") pause();
      else if (onScreen) play();
    });
  }

  initHeroField();

  /* ---------------------------------------------------------
     2. Project images
     Each project image points at its real file in images/projects/.
     If a file is missing the img falls back to a generated SVG,
     so nothing ever renders as a broken image.
     --------------------------------------------------------- */
  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function placeholder(label) {
    const safe = escapeXml(label);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#0a192f"/>' +
      '<stop offset="1" stop-color="#112240"/>' +
      '</linearGradient></defs>' +
      '<rect width="1600" height="900" fill="url(#g)"/>' +
      '<g stroke="#64ffda" stroke-opacity="0.12" stroke-width="1">' +
      '<path d="M0 300H1600M0 600H1600M400 0V900M800 0V900M1200 0V900"/>' +
      '</g>' +
      '<g fill="none" stroke="#64ffda" stroke-opacity="0.35">' +
      '<rect x="48" y="48" width="1504" height="804" rx="18"/>' +
      '</g>' +
      '<text x="96" y="720" font-family="NTR, Arial, sans-serif" font-size="140" ' +
      'letter-spacing="4" fill="#e6f1ff" fill-opacity="0.92">' + safe + '</text>' +
      '<text x="100" y="780" font-family="NTR, Arial, sans-serif" font-size="34" ' +
      'letter-spacing="6" fill="#64ffda">IMAGE COMING SOON</text>' +
      '</svg>';

    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function usePlaceholder(img) {
    if (img.dataset.placeholderApplied) return;
    img.dataset.placeholderApplied = "1";
    img.src = placeholder(img.dataset.label || img.getAttribute("alt") || "project");
    img.classList.add("is-placeholder");
  }

  document.querySelectorAll("img[data-label]").forEach(function (img) {
    img.addEventListener("error", function () {
      usePlaceholder(img);
    });
    // the request may already have failed before this script ran
    if (img.complete && img.naturalWidth === 0) usePlaceholder(img);
  });

  /* ---------------------------------------------------------
     3. Scroll reveal
     --------------------------------------------------------- */
  const revealTargets = document.querySelectorAll("[data-reveal]");

  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          // stagger siblings slightly for a flowing feel
          const siblings = Array.prototype.slice.call(
            entry.target.parentElement ? entry.target.parentElement.children : []
          );
          const order = siblings.indexOf(entry.target);
          entry.target.style.transitionDelay = Math.min(Math.max(order, 0) * 60, 300) + "ms";
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );

    revealTargets.forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    revealTargets.forEach(function (el) {
      el.classList.add("is-visible");
    });
  }

  /* ---------------------------------------------------------
     3b. Split text
     [data-split="char"] rises in character by character (the
     project names); [data-split="word"] pulls in word by word
     (the contact headline). Both play once, when scrolled to.
     --------------------------------------------------------- */
  const splitTargets = Array.prototype.slice.call(
    document.querySelectorAll("[data-split]")
  );

  splitTargets.forEach(function (target) {
    const mode = target.getAttribute("data-split") === "word" ? "word" : "char";
    const text = (target.textContent || "").trim();
    if (!text) return;

    // keep the readable line available to assistive tech while the visual
    // pieces are decorative
    target.setAttribute("aria-label", text);
    target.textContent = "";

    const units = mode === "word" ? text.split(/\s+/) : Array.from(text);
    // how many pieces there are, so CSS can time the typing caret to fit
    target.style.setProperty("--n", String(units.length));

    // a skill group types as one session: every line waits for the characters
    // above it, so a column reads as a terminal being used rather than every
    // line finishing at once. the earlier lines are already split by now, and
    // their spans hold the same text, so measuring them is exact.
    const list = target.closest(".skill-list");
    if (list) {
      const line = Array.prototype.indexOf.call(list.children, target);
      let before = 0;
      for (let earlier = 0; earlier < line; earlier++) {
        before += (list.children[earlier].textContent || "").length + 2;
      }
      target.style.setProperty("--pre", String(before));
    }

    units.forEach(function (unit, index) {
      const span = document.createElement("span");
      span.className = mode;
      span.setAttribute("aria-hidden", "true");
      span.style.setProperty("--i", String(index));
      span.textContent = unit;
      target.appendChild(span);

      // words need their spacing back; characters carry their own
      if (mode === "word" && index < units.length - 1) {
        target.appendChild(document.createTextNode(" "));
      }
    });
  });

  if ("IntersectionObserver" in window) {
    const splitObserver = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        });
      },
      { threshold: 0.35 }
    );

    splitTargets.forEach(function (target) {
      splitObserver.observe(target);
    });
  } else {
    splitTargets.forEach(function (target) {
      target.classList.add("is-visible");
    });
  }

  /* ---------------------------------------------------------
     3d. Where the reader is
     One rule answers "which section am I in": the last section
     whose top has passed the trigger line. The navbar highlight
     and the particle title in section 8 both read that one
     answer, so they can never disagree about what you are
     looking at.
     --------------------------------------------------------- */
  const sectionMarkers = [];
  const siteFooter = document.querySelector(".site-footer");

  Array.prototype.forEach.call(
    document.querySelectorAll(".section-title, .articles-title, .page-title"),
    function (title) {
      const section = title.closest("section, header, main") || title.parentElement;
      if (!section) return;
      // the titles read "/ about me" on screen; the field only wants the words
      const name = (title.textContent || "").replace(/^\/\s*/, "").trim();
      if (!name) return;
      const link = section.id
        ? document.querySelector('.nav-links a[href$="#' + section.id + '"]')
        : null;
      sectionMarkers.push({ section: section, name: name, link: link });
    }
  );

  let activeMarker = -1;
  let activeTitle = null;
  let onTitleChange = null; // section 8 pipes its field in here

  function updateCurrent(viewport) {
    if (!sectionMarkers.length) return;

    const trigger = viewport * 0.45;
    let index = -1;

    for (let i = 0; i < sectionMarkers.length; i++) {
      if (sectionMarkers[i].section.getBoundingClientRect().top <= trigger) {
        index = i;
      }
    }

    // the footer has its own moment, so nothing is current down there
    if (siteFooter && siteFooter.getBoundingClientRect().top <= trigger) index = -1;

    if (index === activeMarker) return;
    activeMarker = index;

    sectionMarkers.forEach(function (marker, i) {
      if (marker.link) marker.link.classList.toggle("active", i === index);
    });

    activeTitle = index >= 0 ? sectionMarkers[index].name : null;
    if (onTitleChange) onTitleChange(activeTitle);
  }

  /* ---------------------------------------------------------
     4. Scroll-linked motion
     Everything below is a pure function of scroll position, so
     nothing ever animates on its own.
     --------------------------------------------------------- */
  const deckCards =
    Array.prototype.slice.call(
      document.querySelectorAll(".project-flow .project-box")
    ) || [];
  const fanBand = document.querySelector("[data-fan]");
  const fanCards = fanBand
    ? Array.prototype.slice.call(fanBand.querySelectorAll(".article-card"))
    : [];
  const progressBar = document.querySelector(".scroll-progress");
  // the vector stand-in keeps its own composition, so it never drifts
  const mediaImages = Array.prototype.slice.call(
    document.querySelectorAll(".project-box-media img:not([src$='.svg'])")
  );
  const footerName = document.querySelector(".footer-name");
  const experienceList = document.querySelector(".experience-list");
  const experienceItems = experienceList
    ? Array.prototype.slice.call(
        experienceList.querySelectorAll(".experience-item")
      )
    : [];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  // 0 → 1 eased at both ends, so a card settles into place instead of stopping
  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  // below this width the cards are a plain list (the CSS un-pins them)
  const deckQuery = window.matchMedia("(min-width: 769px)");

  /* The home-page cards pin under the navbar and stack: each card rises into
     place while the one it covers eases back and dims a little. Every value is
     read off the scroll position, so nothing moves on its own. */
  function updateDeck(viewport) {
    if (!deckCards.length || reduceMotion) return;

    const stacked = deckQuery.matches;
    const rects = deckCards.map(function (card) {
      return card.getBoundingClientRect();
    });

    deckCards.forEach(function (card, index) {
      const rect = rects[index];
      // the pin position is set in CSS (and shifts per breakpoint), so read it
      const pinTop = parseFloat(window.getComputedStyle(card).top) || 92;

      // 0 while the card sits at the bottom of the viewport, 1 once it has
      // reached its pin position
      const travel = Math.max(1, viewport - pinTop);
      const enter = stacked ? smoothstep(clamp01((viewport - rect.top) / travel)) : 1;

      // how much of this card the next one has already slid over
      const next = rects[index + 1];
      const cover = stacked && next
        ? clamp01((rect.bottom - next.top) / Math.max(1, rect.height))
        : 0;

      card.style.setProperty("--deck-y", ((1 - enter) * 70).toFixed(2) + "px");
      card.style.setProperty("--deck-rx", ((1 - enter) * 7).toFixed(3) + "deg");
      card.style.setProperty("--deck-s", (0.9 + enter * 0.1 - cover * 0.05).toFixed(4));
      card.style.setProperty("--deck-b", (1 - cover * 0.2).toFixed(3));
    });
  }

  /* The article cards are a fanned deck. While the band is still off screen the
     cards sit edge-on and low; as it rises into view each one turns into the
     fan, a beat after the one before it, and settles well before the band
     reaches the middle of the screen. All scroll position, no timers. */
  function updateFan(viewport) {
    if (!fanCards.length || reduceMotion) return;

    const rect = fanBand.getBoundingClientRect();
    const stagger = 0.1;
    const span = Math.max(0.0001, 1 - (fanCards.length - 1) * stagger);

    // 0 while the band sits at the bottom of the screen, 1 once it has risen
    // a little over half a screen
    const progress = clamp01((viewport - rect.top) / (viewport * 0.6));

    fanCards.forEach(function (card, index) {
      const turned = smoothstep(clamp01((progress - index * stagger) / span));

      // turned away and low → turned into the fan, in place
      card.style.setProperty("--fan-rx", (-62 + turned * 32).toFixed(2) + "deg");
      card.style.setProperty("--fan-ry", (72 - turned * 22).toFixed(2) + "deg");
      card.style.setProperty("--fan-y", ((1 - turned) * 130).toFixed(1) + "px");
    });
  }

  /* The progress bar is an indicator rather than decoration, so it keeps up
     even when the rest of the motion is reduced. */
  function updateProgress() {
    if (!progressBar) return;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const value = scrollable > 0 ? clamp01(window.scrollY / scrollable) : 0;
    progressBar.style.setProperty("--progress", value.toFixed(4));
  }

  /* The card shots drift inside their frames. The frame is the same 3:2 as
     the shot, so the scale only ever provides the slack its own drift needs —
     the image is back at 1:1, and uncropped, the moment the card settles. */
  const MEDIA_DRIFT = 0.05; // share of the frame height, at full tilt

  function updateMedia(viewport) {
    if (!mediaImages.length) return;

    if (reduceMotion) {
      mediaImages.forEach(function (img) {
        img.style.setProperty("--media-y", "0px");
        img.style.setProperty("--media-s", "1");
      });
      return;
    }

    const centre = viewport / 2;
    mediaImages.forEach(function (img) {
      const rect = img.getBoundingClientRect();
      // 0 while the card sits in the middle of the screen, 1 once it is a
      // screen away from it, either side
      const distance = clamp((rect.top + rect.height / 2 - centre) / (viewport * 0.75), -1, 1);
      // offsetHeight, not the rect: the rect already includes the scale below
      const slack = img.offsetHeight * MEDIA_DRIFT;
      img.style.setProperty("--media-y", (distance * slack * 0.9).toFixed(2) + "px");
      img.style.setProperty("--media-s", (1 + MEDIA_DRIFT * 2 * Math.abs(distance)).toFixed(4));
    });
  }

  /* The footer's outline name slides across as the footer comes up, so the
     last thing on the page has some weight to it. */
  const NAME_DRIFT = 7; // vw either side

  function updateFooter(viewport) {
    if (!footerName) return;

    if (reduceMotion) {
      footerName.style.setProperty("--name-x", "0vw");
      return;
    }

    const rect = footerName.getBoundingClientRect();
    // 0 while the name is still below the fold, 1 once it has risen most of
    // the way up the screen
    const progress = clamp01((viewport - rect.top) / (viewport * 0.85));
    footerName.style.setProperty(
      "--name-x",
      ((0.5 - progress) * 2 * NAME_DRIFT).toFixed(2) + "vw"
    );
  }

  /* The experience rail. The line's tip and the markers are both read off the
     same trigger line, so a marker can never light before the line has
     reached it. */
  function updateTimeline(viewport) {
    if (!experienceList) return;

    if (reduceMotion) {
      experienceList.style.setProperty("--timeline", "1");
      experienceItems.forEach(function (item) {
        item.classList.add("is-lit");
      });
      return;
    }

    const list = experienceList.getBoundingClientRect();
    const tip = viewport * 0.62 - list.top;
    experienceList.style.setProperty(
      "--timeline",
      clamp01(tip / Math.max(1, list.height)).toFixed(4)
    );

    experienceItems.forEach(function (item) {
      const box = item.getBoundingClientRect();
      // the marker sits ~10px below the top of its row
      item.classList.toggle("is-lit", tip >= box.top - list.top + 10);
    });
  }

  if (
    deckCards.length ||
    fanCards.length ||
    progressBar ||
    mediaImages.length ||
    footerName ||
    experienceList
  ) {
    let ticking = false;

    function updateFlow() {
      const viewport = window.innerHeight;

      updateProgress();
      updateDeck(viewport);
      updateFan(viewport);
      updateMedia(viewport);
      updateFooter(viewport);
      updateTimeline(viewport);
      updateCurrent(viewport);

      ticking = false;
    }

    function requestFlow() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateFlow);
    }

    window.addEventListener("scroll", requestFlow, { passive: true });
    window.addEventListener("resize", requestFlow);
    // lazy images can land after the first pass and shift where everything is
    window.addEventListener("load", requestFlow);
    updateFlow();
  }

  /* ---------------------------------------------------------
     4b. The name types itself in
     Each character of the hero name is wrapped in its own span
     and revealed on a stagger — which reads as the name being
     typed. It runs off the page load, so there is nothing to
     observe and nothing to trigger: the CSS animation on each
     character does the work, and the cursor's own blink carries
     on afterwards. Only text nodes are touched, so the cursor
     span inside the heading survives.
     --------------------------------------------------------- */
  const heroName = document.querySelector(".hero-name");

  if (heroName) {
    let typed = 0;
    const label = [];

    Array.prototype.slice.call(heroName.childNodes).forEach(function (node) {
      if (node.nodeType !== 3) return; // leave the cursor where it is

      const fragment = document.createDocumentFragment();
      Array.from(node.textContent).forEach(function (character) {
        label.push(character);
        const span = document.createElement("span");
        span.className = "char";
        span.setAttribute("aria-hidden", "true");
        span.style.setProperty("--i", String(typed++));
        span.textContent = character;
        fragment.appendChild(span);
      });

      heroName.replaceChild(fragment, node);
    });

    // the pieces are decorative, so the heading keeps a real name to read.
    // built from the text nodes alone, which keeps the blinking cursor out of it.
    const text = label.join("").trim();
    if (text) heroName.setAttribute("aria-label", text);
  }

  /* ---------------------------------------------------------
     5. Mobile nav
     --------------------------------------------------------- */
  const navToggle = document.getElementById("navToggle");
  const navLinks = document.getElementById("navLinks");

  if (navToggle && navLinks) {
    navToggle.addEventListener("click", function () {
      const open = navLinks.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(open));
    });

    navLinks.addEventListener("click", function (event) {
      if (event.target.tagName === "A") {
        navLinks.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ---------------------------------------------------------
     6. Footer year + back-to-top
     --------------------------------------------------------- */
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  document.querySelectorAll(".to-top").forEach(function (link) {
    link.addEventListener("click", function (event) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    });
  });

  /* ---------------------------------------------------------
     7. Contact form
     The browser validates the fields first, so the submit event
     only fires on a complete form, and the message is POSTed to
     Web3Forms — a form endpoint that needs no server of your own
     and emails you each submission. Paste an access key below to
     switch it on. With no key set (and no data-endpoint override)
     the message is handed to the visitor's mail app instead,
     addressed via data-mailto, so the form always does something.
     --------------------------------------------------------- */
  // Free, no server: https://web3forms.com → enter your email, paste the key
  // it sends you here. It is a public form ID, not a secret.
  const CONTACT_ACCESS_KEY = "713bf0e3-5d10-4d98-a62f-fa5e6f50f265";
  const FORM_ENDPOINT = "https://api.web3forms.com/submit";

  const contactForm = document.querySelector("[data-contact-form]");

  if (contactForm) {
    const status = contactForm.querySelector("[data-form-status]");
    const submitButton = contactForm.querySelector("[type=submit]");
    const recipient = contactForm.getAttribute("data-mailto") || "";
    const endpoint =
      contactForm.getAttribute("data-endpoint") ||
      (CONTACT_ACCESS_KEY ? FORM_ENDPOINT : "");

    function setStatus(message, state) {
      if (!status) return;
      status.textContent = message;
      status.classList.remove("is-ok", "is-error");
      if (state) status.classList.add("is-" + state);
    }

    contactForm.addEventListener("submit", function (event) {
      event.preventDefault();

      const payload = new FormData(contactForm);
      const field = function (name) {
        return String(payload.get(name) || "").trim();
      };
      const about = field("subject");

      if (!endpoint) {
        // no form service wired up yet — hand the message to the mail app
        const body =
          "Name: " + field("name") + "\n" +
          "Email: " + field("email") + "\n" +
          (about ? "About: " + about + "\n" : "") +
          "\n" + field("message");

        window.location.href =
          "mailto:" + recipient +
          "?subject=" + encodeURIComponent(about || "Portfolio enquiry") +
          "&body=" + encodeURIComponent(body);

        setStatus("Your mail app should be opening with the message ready to send.", "ok");
        return;
      }

      // the endpoint wants the key in the body, and it treats these two fields
      // as the subject line and the sender name of the email it sends
      if (CONTACT_ACCESS_KEY) payload.set("access_key", CONTACT_ACCESS_KEY);
      payload.set("subject", about || "Portfolio enquiry");
      payload.set("from_name", field("name") || "Portfolio contact");

      if (submitButton) submitButton.disabled = true;
      setStatus("Sending…");

      fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: payload,
      })
        .then(function (response) {
          return response
            .json()
            .catch(function () {
              return null;
            })
            .then(function (data) {
              return { ok: response.ok, data: data };
            });
        })
        .then(function (result) {
          // a 200 with success:false is still a failure
          if (!result.ok || (result.data && result.data.success === false)) {
            throw new Error((result.data && result.data.message) || "Request failed");
          }
          contactForm.reset();
          setStatus("Thanks — your message is on its way.", "ok");
        })
        .catch(function () {
          setStatus(
            "That did not send. Please try again" +
              (recipient ? ", or email " + recipient : "") + ".",
            "error"
          );
        })
        .then(function () {
          if (submitButton) submitButton.disabled = false;
        });
    });
  }

  /* ---------------------------------------------------------
     8. ASCII section titles
     The hero's field, carried down the page: whichever section
     you are reading is redrawn as particles on a fixed canvas
     behind the content, and moving between sections springs the
     particles to their new places rather than cutting. Same
     ramp, same physics, same colour — drawn faintly, because
     down here it is a watermark rather than the subject.

     Section 3d decides which title is current, so the words are
     never guessed from scroll maths twice.
     --------------------------------------------------------- */
  const fieldCanvas = document.querySelector(".section-field");

  function initSectionField() {
    if (!fieldCanvas || !fieldCanvas.getContext) return;
    // a settled watermark is not worth any frames
    if (reduceMotion) return;

    const ctx = fieldCanvas.getContext("2d");
    if (!ctx) return;

    const FONT = 8; // the letters want a little size to stay legible
    const FONT_SMALL = 11; // fewer, chunkier particles are cheaper on a phone
    const ALPHA = 0.3; // the whole field is dialled down: prose sits over it
    const FILL = 0.72; // share of the width a title may take up
    const FOLLOW = 0.15;
    const REPEL = 0.22;
    const REPEL_FORCE = 3.5;
    const SPRING_REST = 0.01;
    const SPRING_WAVE = 0.08;
    const DAMP_WAVE = 0.92;
    const DAMP_REST = 0.85;
    const WAVE = 0.15;
    const TWINKLE = 0.08;
    const SHOCK_SPEED = 1.1;
    const SHOCK_BAND = 0.12;
    const SHOCK_FORCE = 5;
    const MAX_SHOCKS = 3;
    const IDLE = 1.6; // seconds with nothing to show before the loop stops

    const pointer = { x: -2000, y: -2000, tx: -2000, ty: -2000, active: false };

    let width = 0;
    let height = 0;
    let font = FONT;
    let particles = [];
    let shocks = [];
    let wanted = null; // the title the page has asked for
    let title = null; // the title actually on the canvas
    let built = false; // has anything been drawn yet
    let live = false;
    let idle = 0;
    let raf = 0;
    let previous = 0;
    let clock = 0;
    let resizeTimer = 0;

    /* --- one title → particles ----------------------------------------- */
    function sampleTitle(text) {
      const buffer = document.createElement("canvas");
      buffer.width = Math.max(1, Math.ceil(width));
      buffer.height = Math.max(1, Math.ceil(height));
      const bctx = buffer.getContext("2d", { willReadFrequently: true });
      if (!bctx) return [];

      const stepX = font * 0.7;
      const stepY = font * 1.1;
      const wantedWidth = width * FILL;

      let size = Math.min(height * 0.45, font * 9);
      bctx.font = "bold " + size + "px monospace";
      const measured = bctx.measureText(text).width || 1;
      if (measured > wantedWidth) size = Math.max(font * 2, size * (wantedWidth / measured));

      bctx.font = "bold " + size + "px monospace";
      bctx.textAlign = "center";
      bctx.textBaseline = "middle";
      // a gradient rather than a flat fill: the letters carry their own
      // light-to-dark falloff, and that is where the characters get their
      // range from. Without it every inked cell would be the same character.
      const gradient = bctx.createLinearGradient(
        0,
        height / 2 - size / 2,
        0,
        height / 2 + size / 2
      );
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(1, "#4d5462");
      bctx.fillStyle = gradient;
      bctx.fillText(text, width / 2, height / 2);

      let pixels;
      try {
        pixels = bctx.getImageData(0, 0, buffer.width, buffer.height).data;
      } catch (error) {
        // a cross-origin pixel read leaves the field empty rather than throwing
        return [];
      }

      const cells = [];
      const last = FIELD_RAMP.length - 1;

      for (let y = 0; y < height; y += stepY) {
        for (let x = 0; x < width; x += stepX) {
          const at = (Math.floor(y) * buffer.width + Math.floor(x)) * 4;
          if (pixels[at + 3] / 255 <= 0.4) continue; // outside the letters
          const tone = pixels[at] / 255;
          // a deterministic speckle, so the letters are not one flat wall of
          // the same character
          const speckle = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
          const level = clamp(tone - speckle * 0.3, 0.1, 1);
          cells.push({
            x: Math.round(x * 10) / 10,
            y: Math.round(y * 10) / 10,
            char: FIELD_RAMP[Math.max(1, Math.round(level * last))],
            alpha: ALPHA * (0.55 + 0.45 * level)
          });
        }
      }

      return cells;
    }

    /* --- retargeting ---------------------------------------------------- */
    function retarget(cells, atRest) {
      const count = cells.length;

      for (let i = 0; i < count; i++) {
        const cell = cells[i];
        const existing = particles[i];

        if (existing) {
          existing.tx = cell.x;
          existing.ty = cell.y;
          existing.char = cell.char;
          existing.base = cell.alpha;
          continue;
        }

        particles.push({
          x: atRest ? cell.x : width / 2 + (Math.random() - 0.5) * width * 0.4,
          y: atRest ? cell.y : height / 2 + (Math.random() - 0.5) * height * 0.4,
          tx: cell.x,
          ty: cell.y,
          vx: 0,
          vy: 0,
          char: cell.char,
          base: cell.alpha,
          alpha: atRest ? cell.alpha : 0,
          twinkle: Math.random() * Math.PI * 2
        });
      }

      // whatever the new title does not need drifts inward and fades out
      for (let i = count; i < particles.length; i++) {
        const leftover = particles[i];
        leftover.tx = width / 2 + (Math.random() - 0.5) * 40;
        leftover.ty = height / 2 + (Math.random() - 0.5) * 40;
        leftover.base = 0;
      }
    }

    /* --- physics -------------------------------------------------------- */
    function step(dt) {
      clock += dt;
      // written per 1/60s frame, like the hero's field
      const k = Math.min(dt * 60, 2);
      const reach = Math.min(width, height);
      const repel = reach * REPEL;
      const band = reach * SHOCK_BAND;

      pointer.x += (pointer.tx - pointer.x) * FOLLOW * k;
      pointer.y += (pointer.ty - pointer.y) * FOLLOW * k;

      for (let i = shocks.length - 1; i >= 0; i--) {
        shocks[i].radius += reach * SHOCK_SPEED * dt;
        shocks[i].life -= 0.9 * dt;
        if (shocks[i].life <= 0) shocks.splice(i, 1);
      }

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const ex = p.tx - p.x;
        const ey = p.ty - p.y;

        // the pointer stirs the field wherever it is on the page, not only
        // where the letters happen to be
        if (pointer.active) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < repel && d > 0) {
            const shove = (1 - d / repel) * REPEL_FORCE * k;
            p.vx += (dx / d) * shove;
            p.vy += (dy / d) * shove;
          }
        }

        const spring = (SPRING_REST + (live ? SPRING_WAVE : 0)) * k;
        p.vx += ex * spring;
        p.vy += ey * spring;

        if (live) {
          // the same fluid wave the hero uses
          p.vx += Math.sin(clock * 0.5 + p.ty * 0.1) * WAVE * k;
          p.vy += Math.cos(clock * 0.5 + p.tx * 0.1) * WAVE * k;
          p.vx *= Math.pow(DAMP_WAVE, k);
          p.vy *= Math.pow(DAMP_WAVE, k);
        } else {
          p.vx *= Math.pow(DAMP_REST, k);
          p.vy *= Math.pow(DAMP_REST, k);
        }

        for (let w = 0; w < shocks.length; w++) {
          const shock = shocks[w];
          const dx = p.x - shock.x;
          const dy = p.y - shock.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
          const gap = Math.abs(d - shock.radius);
          if (gap > band) continue;
          const blow = (1 - gap / band) * shock.life * SHOCK_FORCE * k;
          p.vx += (dx / d) * blow;
          p.vy += (dy / d) * blow;
        }

        // fade rather than cut, so a title change reads as a rebuild
        const shimmer = live ? Math.sin(clock * 2 + p.twinkle) * TWINKLE : 0;
        const target = Math.max(0, p.base + shimmer);
        p.alpha += (target - p.alpha) * Math.min(1, dt * 4);

        p.x += p.vx * k;
        p.y += p.vy * k;
      }
    }

    /* --- drawing -------------------------------------------------------- */
    function draw() {
      ctx.clearRect(0, 0, width, height);
      ctx.font = font + "px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (p.alpha <= 0.012) continue; // faded out: skip the glyph entirely
        const level = Math.round(clamp01(p.alpha) * 100);
        ctx.fillStyle = COLOUR[level];
        ctx.fillText(p.char, p.x, p.y);
      }
    }

    /* --- the loop ------------------------------------------------------- */
    function tick(now) {
      raf = window.requestAnimationFrame(tick);
      const dt = previous ? Math.min(0.034, (now - previous) / 1000) : 0.016;
      previous = now;
      step(dt);
      draw();

      // once nothing is live the particles have faded and drifted home, so
      // stop cycling a full-viewport canvas
      idle = live ? 0 : idle + dt;
      if (idle > IDLE && !shocks.length) pause();
    }

    function play() {
      if (raf || (!live && !shocks.length)) return;
      previous = 0;
      raf = window.requestAnimationFrame(tick);
    }

    function pause() {
      if (!raf) return;
      window.cancelAnimationFrame(raf);
      raf = 0;
    }

    /* --- swapping titles ------------------------------------------------ */
    function apply(name, atRest) {
      if (!name) {
        // nothing is current (the hero, or the footer): fade the field out
        title = null;
        live = false;
        fieldCanvas.classList.remove("is-live");
        retarget([], atRest);
        return;
      }

      const cells = sampleTitle(name);
      if (!cells.length) return;

      title = name;
      live = true;
      idle = 0;
      fieldCanvas.classList.add("is-live");
      retarget(cells, atRest);
      play();
    }

    function setTitle(name) {
      if (name === wanted) return; // still the same section
      wanted = name;
      // before the first layout there is nothing to sample into
      if (!width || !height) return;
      // the first title settles where it belongs, so a page opened part-way
      // down does not fly together; later ones morph, since that is the point
      const atRest = !built;
      built = true;
      apply(name, atRest);
    }

    /* --- lifecycle ------------------------------------------------------ */
    function resize() {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      // 1:1, deliberately: this canvas is a faint wash across the whole
      // viewport, and clearing it at device resolution every frame is a lot of
      // work for texture nobody inspects. The hero's field is the sharp one.
      fieldCanvas.width = width;
      fieldCanvas.height = height;
      font = width <= 768 ? FONT_SMALL : FONT;
      // particle positions are in canvas coordinates, so a resize is a rebuild
      if (wanted) apply(wanted, true);
    }

    window.addEventListener(
      "pointermove",
      function (event) {
        if (pointer.x < -1000) {
          // start the smoothed pointer where the real one is, so it does not
          // sweep in from the corner and blow the field apart on arrival
          pointer.x = event.clientX;
          pointer.y = event.clientY;
        }
        pointer.tx = event.clientX;
        pointer.ty = event.clientY;
        pointer.active = true;
      },
      { passive: true }
    );

    window.addEventListener("pointerdown", function (event) {
      if (!live) return;
      // only a few rings alive at once, so mashing the page stays cheap
      if (shocks.length >= MAX_SHOCKS) shocks.shift();
      shocks.push({ x: event.clientX, y: event.clientY, radius: 0, life: 1 });
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.tx = event.clientX;
      pointer.ty = event.clientY;
      pointer.active = true;
      idle = 0;
      play();
    });

    document.addEventListener("pointerleave", function () {
      pointer.active = false;
    });

    window.addEventListener("resize", function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 160);
    });

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") pause();
      else if (live || shocks.length) play();
    });

    resize();

    // section 3d feeds the current title in, and this catches up with a page
    // that was opened part-way down
    onTitleChange = setTitle;
    setTitle(activeTitle);
  }

  initSectionField();

  /* ---------------------------------------------------------
     9. Magnetic links
     Links lean a few pixels toward the pointer while it is on
     them, and ease back when it leaves. Small enough that it is
     felt rather than noticed. Touch pointers never trigger it,
     and neither does someone who asked for less motion.
     --------------------------------------------------------- */
  const MAGNETIC = [
    ".nav-name",
    ".nav-links a",
    ".nav-icons a",
    ".hero-links a",
    ".hero-play",
    ".section-link",
    ".project-box-arrow",
    ".to-top"
  ].join(", ");

  function initMagnetic() {
    if (reduceMotion) return;
    // a coarse pointer has no hover to lean away from
    if (window.matchMedia("(hover: none)").matches) return;

    const PULL = 0.3; // share of the pointer's offset from the centre
    const LIMIT = 9; // px, so nothing ever slides far enough to look broken

    const targets = Array.prototype.slice.call(document.querySelectorAll(MAGNETIC));

    targets.forEach(function (target) {
      target.addEventListener("pointermove", function (event) {
        const rect = target.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        target.style.setProperty("--mag-x", clamp(dx * PULL, -LIMIT, LIMIT).toFixed(2) + "px");
        target.style.setProperty("--mag-y", clamp(dy * PULL, -LIMIT, LIMIT).toFixed(2) + "px");
      });

      target.addEventListener("pointerleave", function () {
        target.style.setProperty("--mag-x", "0px");
        target.style.setProperty("--mag-y", "0px");
      });
    });
  }

  initMagnetic();

  /* ---------------------------------------------------------
     10. roadtrip — the run along the bottom of the page
     A small car on a two-lane road, in the same monospace and
     the same mint as the rest of the page, drawn into a strip
     pinned to the bottom of the viewport.

     A roadblock does not end the run by itself — it stops the
     car and asks a question about Ryan, drawn from the page you
     are already scrolling through. A right answer clears the
     block and scores; three in a row earns a shield, and a
     shield takes the next roadblock without asking anything.

     It is a strip, not a screen. It never takes the page over,
     it slides out of the way at the contact form, it can be
     folded away, arrow keys only mean a lane change while the
     road itself has focus, and nothing moves at all until the
     run is started.
     --------------------------------------------------------- */

  // the questions a roadblock stops you with. every one of them can be
  // answered from the page itself — that is the point of them.
  const QUESTIONS = [
    {
      q: "Where is Ryan based?",
      a: ["Nairobi, Kenya", "Kisumu, Kenya", "Mombasa, Kenya"],
      right: 1
    },
    {
      q: "Which language does Ryan work in primarily?",
      a: ["Rust", "Go", "Python"],
      right: 1
    },
    {
      q: "Who does Ryan currently work for?",
      a: ["Safaricom", "Andela", "Zone01 Kisumu"],
      right: 2
    },
    {
      q: "Which of these is one of Ryan's projects?",
      a: ["Kube-Shop", "Net-Cat", "FastAPI Chat"],
      right: 1
    },
    {
      q: "What is Ryan's main focus, per his about section?",
      a: [
        "Mobile UI design",
        "Game engines",
        "Backend systems, APIs, distributed systems and networking"
      ],
      right: 2
    },
    {
      q: "Which of these is NOT in Ryan's skills list?",
      a: ["SQLite", "Turso (libsql)", "MongoDB"],
      right: 2
    },
    {
      q: "What did Ryan learn at the Africa Free Routing bootcamp?",
      a: ["Ethereum smart contracts", "Bitcoin and the Lightning Network", "NFT marketplaces"],
      right: 1
    },
    {
      q: "What did Ryan's hackathon team build in 48 hours?",
      a: ["A ride-hailing app", "A music streaming service", "An app connecting donors and NGOs"],
      right: 2
    },
    {
      q: "Which of these is Ryan currently learning?",
      a: ["COBOL", "Kubernetes", "Ruby on Rails"],
      right: 1
    },
    {
      q: "How long was Ryan's blockchain hackathon?",
      a: ["24 hours", "48 hours", "72 hours"],
      right: 1
    },
    {
      q: "Which article did Ryan actually write?",
      a: [
        "Mastering React Hooks",
        "CSS Grid in Depth",
        "I Built a TCP Chat Server in Go Before I Understood Concurrency"
      ],
      right: 2
    },
    {
      q: "Where does Ryan publish his writing?",
      a: ["Medium", "Hashnode", "dev.to"],
      right: 2
    },
    {
      q: "Which of these is NOT one of Ryan's projects?",
      a: ["Net-Cat", "ElimuLocal", "Notely"],
      right: 2
    },
    {
      q: "Which tool is in Ryan's skills list?",
      a: ["Chef", "Cloudflare", "Jenkins"],
      right: 1
    },
    {
      q: "How does Ryan say he learns best?",
      a: [
        "Through reading textbooks",
        "Through concrete projects rather than isolated study",
        "Through long video courses"
      ],
      right: 1
    },
    {
      q: "What does Ryan say he enjoys building?",
      a: [
        "Designing pixel-perfect interfaces",
        "Writing documentation",
        "Things that are fast, reliable and useful"
      ],
      right: 2
    }
  ];

  const roadRoot = document.querySelector("[data-road]");

  function initRoad() {
    if (!roadRoot) return;

    const stage = roadRoot.querySelector("[data-road-stage]");
    const canvas = roadRoot.querySelector("[data-road-canvas]");
    const prompt = roadRoot.querySelector("[data-road-prompt]");
    const messageEl = roadRoot.querySelector("[data-road-message]");
    const go = roadRoot.querySelector('[data-road="go"]');
    const fold = roadRoot.querySelector('[data-road="fold"]');
    const card = roadRoot.querySelector("[data-road-card]");
    const questionEl = roadRoot.querySelector("[data-road-question]");
    const optionsEl = roadRoot.querySelector("[data-road-options]");
    const verdictEl = roadRoot.querySelector("[data-road-verdict]");
    const giveUp = roadRoot.querySelector('[data-road="giveup"]');
    const trigger = document.querySelector("[data-play]");
    const footer = document.querySelector(".site-footer");

    if (!stage || !canvas || !prompt || !go || !card || !optionsEl) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const readout = {
      dist: roadRoot.querySelector('[data-road="dist"]'),
      score: roadRoot.querySelector('[data-road="score"]'),
      best: roadRoot.querySelector('[data-road="best"]'),
      shield: roadRoot.querySelector('[data-road="shield"]')
    };

    const BEST_KEY = "ryankelly.roadtrip.best";
    const LANES = [0.28, 0.72]; // where each lane sits in the strip, top first
    const SPEED_START = 130; // px per second
    const SPEED_MAX = 400;
    const SPEED_RAMP = 9; // px per second gained per second of play
    const GAP_MIN = 220; // px of road between one roadblock and the next
    const GAP_MAX = 440;
    const POINTS = 50;
    const STREAK_FOR_SHIELD = 3;
    const CAR_HALF = 30; // half the drawn width of the car, for the hit test

    let width = 0;
    let height = 0;
    let dpr = 1;
    let fontSize = 10;
    let lineHeight = 13;
    let carX = 60;
    let blocks = [];
    let raf = 0;
    let previous = 0;
    let running = false;
    let state = "idle"; // idle | running | question | over
    let distance = 0;
    let shownMetres = 0;
    let speed = SPEED_START;
    let sinceBlock = 0;
    let nextGap = GAP_MIN;
    let score = 0;
    let streak = 0;
    let shields = 0;
    let correct = 0;
    let lane = 0;
    let carY = 0;
    let roadPhase = 0;
    let flash = 0;
    let best = 0;
    let pendingBlock = null;
    let used = [];

    try {
      const stored = window.localStorage.getItem(BEST_KEY);
      best = stored ? Math.max(0, parseInt(stored, 10) || 0) : 0;
    } catch (error) {
      best = 0; // private mode, or storage turned off
    }

    /* --- readouts ------------------------------------------------------- */
    function setReadout(key, value) {
      const el = readout[key];
      if (!el) return;
      const next = String(value);
      if (el.textContent !== next) el.textContent = next;
    }

    function renderShield() {
      if (!readout.shield) return;
      readout.shield.hidden = shields <= 0;
      readout.shield.textContent = "shield x" + shields;
    }

    /* --- sizing --------------------------------------------------------- */
    function resize() {
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.round(rect.width);
      height = Math.round(rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      // two lanes have to fit a three-row car between them
      fontSize = height <= 76 ? 9 : 10;
      lineHeight = Math.round(fontSize * 1.25);
      carX = Math.max(30, Math.round(width * 0.13));
    }

    /* --- the run -------------------------------------------------------- */
    function spawnBlock(x) {
      blocks.push({ x: x, lane: Math.random() < 0.5 ? 0 : 1 });
    }

    function reset() {
      resize();
      blocks = [];
      used = [];
      distance = 0;
      shownMetres = 0;
      speed = SPEED_START;
      sinceBlock = 0;
      nextGap = GAP_MIN;
      score = 0;
      streak = 0;
      shields = 0;
      correct = 0;
      lane = 0;
      carY = height * LANES[0];
      roadPhase = 0;
      flash = 0;
      pendingBlock = null;
      setReadout("dist", 0);
      setReadout("score", 0);
      setReadout("best", best);
      renderShield();
      // one roadblock is already on the road, so a run opens with something to read
      spawnBlock(width * 0.92);
      draw();
    }

    function start() {
      if (state === "running" || state === "question") return;
      roadRoot.classList.remove("is-folded");
      roadRoot.classList.add("is-running");
      if (fold) {
        fold.setAttribute("aria-expanded", "true");
        fold.setAttribute("aria-label", "Fold the road away");
        fold.textContent = "▾";
      }
      reset();
      prompt.hidden = true;
      card.hidden = true;
      messageEl.classList.remove("is-fail");
      go.textContent = "start the run";
      state = "running";
      running = true;
      previous = 0;
      play();
      stage.focus({ preventScroll: true });
    }

    function finish() {
      running = false;
      state = "over";
      pendingBlock = null;
      card.hidden = true;
      roadRoot.classList.remove("is-running");

      const metres = Math.floor(distance / 10);
      if (metres > best) {
        best = metres;
        setReadout("best", best);
        try {
          window.localStorage.setItem(BEST_KEY, String(best));
        } catch (error) {
          // nothing to do about it; the record just will not persist
        }
      }

      messageEl.textContent =
        "crashed at " + metres + "m · " + correct + " answered right";
      messageEl.classList.add("is-fail");
      go.textContent = "run again";
      prompt.hidden = false;
    }

    /* --- the question a roadblock asks ---------------------------------- */
    function pickQuestion() {
      if (used.length >= QUESTIONS.length) used = [];
      let index = Math.floor(Math.random() * QUESTIONS.length);
      while (used.indexOf(index) !== -1) {
        index = Math.floor(Math.random() * QUESTIONS.length);
      }
      used.push(index);

      const source = QUESTIONS[index];
      // shuffled every time, so the right answer is never in a fixed slot
      const options = source.a.map(function (text, i) {
        return { text: text, right: i === source.right };
      });
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const swap = options[i];
        options[i] = options[j];
        options[j] = swap;
      }
      let right = 0;
      options.forEach(function (option, i) {
        if (option.right) right = i;
      });

      return {
        text: source.q,
        options: options,
        right: right,
        answer: source.a[source.right]
      };
    }

    function askQuestion(block) {
      state = "question";
      running = false;
      pendingBlock = block;
      roadRoot.classList.remove("is-running");

      const question = pickQuestion();
      questionEl.textContent = question.text;
      optionsEl.textContent = "";
      verdictEl.textContent = "";
      verdictEl.className = "road-verdict";

      question.options.forEach(function (option, index) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "road-option";
        button.textContent = option.text;
        button.addEventListener("click", function () {
          answer(index === question.right, button, question);
        });
        optionsEl.appendChild(button);
      });

      card.hidden = false;
    }

    function answer(right, button, question) {
      if (state !== "question") return;

      if (right) {
        button.classList.add("is-right");
        score += POINTS;
        correct++;
        streak++;
        let earned = "";
        if (streak % STREAK_FOR_SHIELD === 0) {
          shields++;
          earned = " · shield earned";
        }
        verdictEl.textContent = "correct · +" + POINTS + " · cleared" + earned;
        verdictEl.className = "road-verdict is-right";
        setReadout("score", score);
        renderShield();
        flash = 0.4;

        // the roadblock is gone and the run carries on
        blocks = blocks.filter(function (b) {
          return b !== pendingBlock;
        });
        pendingBlock = null;
        state = "running";

        window.setTimeout(function () {
          card.hidden = true;
          running = true;
          roadRoot.classList.add("is-running");
          previous = 0;
          play();
        }, 620);
      } else {
        button.classList.add("is-wrong");
        verdictEl.textContent = "not quite — it's " + question.answer;
        verdictEl.className = "road-verdict";
        state = "over"; // so a second click cannot answer twice
        window.setTimeout(finish, 1100);
      }
    }

    /* --- one frame ------------------------------------------------------ */
    function step(dt) {
      if (flash > 0) flash = Math.max(0, flash - dt * 2);
      if (!running) return;

      speed = Math.min(SPEED_MAX, speed + SPEED_RAMP * dt);
      distance += speed * dt;
      roadPhase += speed * dt;

      const metres = Math.floor(distance / 10);
      if (metres !== shownMetres) {
        shownMetres = metres;
        setReadout("dist", metres);
      }

      // a lane change eases across rather than teleporting
      carY += (height * LANES[lane] - carY) * Math.min(1, dt * 11);

      sinceBlock += speed * dt;
      if (sinceBlock >= nextGap) {
        sinceBlock = 0;
        nextGap = GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN);
        spawnBlock(width + 26);
      }

      for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        block.x -= speed * dt;

        if (block.x < -30) {
          blocks.splice(i, 1);
          continue;
        }

        const nearX = Math.abs(block.x - carX) < CAR_HALF;
        const nearY = Math.abs(height * LANES[block.lane] - carY) < lineHeight * 1.3;
        if (!nearX || !nearY) continue;

        // a shield takes the roadblock without asking anything
        if (shields > 0) {
          shields--;
          renderShield();
          score += POINTS;
          setReadout("score", score);
          blocks.splice(i, 1);
          flash = 0.4;
          continue;
        }

        // otherwise it stops the run with a question about its subject
        askQuestion(block);
        return;
      }
    }

    function draw() {
      if (!width || !height) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      ctx.font = fontSize + "px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // the road itself, with a shoulder just inside each edge
      ctx.fillStyle = "rgba(17, 34, 64, 0.5)";
      ctx.fillRect(0, 2, width, height - 4);
      ctx.fillStyle = "rgba(100, 255, 218, 0.15)";
      ctx.fillRect(0, 3, width, 1);
      ctx.fillRect(0, height - 4, width, 1);

      // the centre line, which scrolls with the distance travelled
      ctx.fillStyle = "rgba(136, 146, 176, 0.45)";
      const stride = 52;
      const offset = -(roadPhase % stride);
      for (let x = offset; x < width; x += stride) {
        ctx.fillRect(x, Math.round(height / 2), 22, 1);
      }

      // the roadblocks
      blocks.forEach(function (block) {
        const y = height * LANES[block.lane];
        ctx.fillStyle = COLOUR[62];
        ctx.fillText("▓▓▓", block.x, y - lineHeight);
        ctx.fillText("▓▓▓", block.x, y);
        ctx.fillText("▓▓▓", block.x, y + lineHeight);
      });

      // the car, drawn over them
      ctx.fillStyle = flash > 0 ? "rgba(230, 241, 255, 0.95)" : COLOUR[90];
      ctx.fillText(" ▄▄▄▄ ", carX, carY - lineHeight);
      ctx.fillText("▐████▌", carX, carY);
      ctx.fillStyle = COLOUR[55];
      ctx.fillText(" ○  ○ ", carX, carY + lineHeight);
    }

    /* --- the loop ------------------------------------------------------- */
    function tick(now) {
      raf = window.requestAnimationFrame(tick);
      const dt = previous ? Math.min(0.034, (now - previous) / 1000) : 0.016;
      previous = now;
      step(dt);
      draw();
    }

    function play() {
      if (raf) return;
      previous = 0;
      raf = window.requestAnimationFrame(tick);
    }

    function stop() {
      if (!raf) return;
      window.cancelAnimationFrame(raf);
      raf = 0;
    }

    /* --- input ---------------------------------------------------------- */
    function steerTo(clientY) {
      const rect = stage.getBoundingClientRect();
      if (!rect.height) return;
      lane = clientY - rect.top < rect.height / 2 ? 0 : 1;
    }

    stage.addEventListener("pointerdown", function (event) {
      if (state !== "running") return;
      steerTo(event.clientY);
      stage.focus({ preventScroll: true });
    });

    stage.addEventListener(
      "pointermove",
      function (event) {
        if (state !== "running") return;
        steerTo(event.clientY);
      },
      { passive: true }
    );

    // arrows only mean a lane change while the road itself has focus, so the
    // page still scrolls normally the rest of the time
    stage.addEventListener("keydown", function (event) {
      const up = event.key === "ArrowUp" || event.key === "w" || event.key === "W";
      const down = event.key === "ArrowDown" || event.key === "s" || event.key === "S";
      if (!up && !down) return;
      event.preventDefault();
      if (state === "running") lane = up ? 0 : 1;
    });

    go.addEventListener("click", start);
    if (trigger) trigger.addEventListener("click", start);

    if (giveUp) {
      giveUp.addEventListener("click", function () {
        running = false;
        if (raf) stop();
        card.hidden = true;
        pendingBlock = null;
        state = "over";
        roadRoot.classList.remove("is-running");
        messageEl.textContent = "run ended · nothing asked was lost";
        messageEl.classList.remove("is-fail");
        go.textContent = "start the run";
        prompt.hidden = false;
      });
    }

    if (fold) {
      fold.addEventListener("click", function () {
        const folded = roadRoot.classList.toggle("is-folded");
        fold.setAttribute("aria-expanded", String(!folded));
        fold.setAttribute("aria-label", folded ? "Open the road" : "Fold the road away");
        fold.textContent = folded ? "▴" : "▾";
        if (folded) {
          // folding is an explicit "I am done with this", so the run ends
          // cleanly rather than waiting to be resumed from a stuck state
          running = false;
          if (raf) stop();
          state = "idle";
          roadRoot.classList.remove("is-running");
          messageEl.textContent = "the road is folded away.";
          messageEl.classList.remove("is-fail");
          go.textContent = "start the run";
          prompt.hidden = false;
        } else {
          // the stage had no size while it was folded, so it is measured and
          // drawn again now that there is something to measure
          resize();
          carY = height * LANES[0];
          draw();
        }
      });
    }

    document.addEventListener("visibilitychange", function () {
      if (state !== "running") return;
      if (document.visibilityState === "hidden") {
        running = false;
        if (raf) stop();
      } else {
        running = true;
        previous = 0;
        play();
      }
    });

    /* --- staying out of the way ---------------------------------------- */
    // it is pinned over the page, so it gets out from over the contact form
    if (footer && "IntersectionObserver" in window) {
      const parkObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            roadRoot.classList.toggle("is-parked", entry.isIntersecting);
          });
        },
        { threshold: 0.1 }
      );
      parkObserver.observe(footer);
    }

    let resizeTimer = 0;

    window.addEventListener("resize", function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        resize();
        carY = height * LANES[lane];
        blocks.forEach(function (block) {
          if (block.x > width) block.x = width + 26;
          // a resize must not drop a roadblock on top of the car
          if (Math.abs(block.x - carX) < 60 && block.lane === lane) block.x = carX + 60;
        });
        draw();
      }, 140);
    });

    resize();
    carY = height * LANES[0];
    setReadout("best", best);
    draw();
  }

  initRoad();
})();
