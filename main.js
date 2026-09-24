/* ============================================================
   Ryan Kelly — portfolio behaviour
   1. hero ASCII particle field: the portrait sampled into a grid of
      characters that ripple and scatter around the pointer
   2. project image loading with graceful generated fallback
   3. scroll reveal, plus split-text reveals ([data-split])
   4. scroll-linked motion: the pinned project card deck on the home page
      and the fanned article deck (driven by scrolling, never autoplay)
   5. mobile nav
   6. footer year
   7. contact form submit handling (a form service, or the visitor's mail app)
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
  // pixels of the portrait draw nothing at all
  const HERO_FIELD_RAMP = " .:-=+*#%@";
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

    // one colour per alpha step, so the draw loop swaps fillStyle between
    // cached strings instead of building one per character per frame
    const COLOUR = [];
    for (let i = 0; i <= 100; i++) {
      COLOUR.push("rgba(100, 255, 218, " + (i / 100).toFixed(2) + ")");
    }

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
      const ramp = HERO_FIELD_RAMP;
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
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
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
    if (!deckCards.length) return;

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
    if (!fanCards.length) return;

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

  if ((deckCards.length || fanCards.length) && !reduceMotion) {
    let ticking = false;

    function updateFlow() {
      const viewport = window.innerHeight;

      updateDeck(viewport);
      updateFan(viewport);

      ticking = false;
    }

    function requestFlow() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateFlow);
    }

    window.addEventListener("scroll", requestFlow, { passive: true });
    window.addEventListener("resize", requestFlow);
    updateFlow();
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
})();
