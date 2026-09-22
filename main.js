/* ============================================================
   Ryan Kelly — portfolio behaviour
   1. project image loading with graceful generated fallback
   2. scroll reveal, plus split-text reveals ([data-split])
   3. scroll-linked motion: the pinned project card deck on the home page
      and the fanned article deck (driven by scrolling, never autoplay)
   4. mobile nav
   5. footer year
   6. contact form submit handling (a form service, or the visitor's mail app)
   ============================================================ */

(function () {
  "use strict";

  /* ---------------------------------------------------------
     1. Project images
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
     2. Scroll reveal
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
     2b. Split text
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
     3. Scroll-linked motion
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
     4. Mobile nav
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
     5. Footer year + back-to-top
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
     6. Contact form
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
  const CONTACT_ACCESS_KEY = "";
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
