/* Pale Blue Signal: listening, new-update badges, X posts, and copy-link. No tracking. */
(function () {
  "use strict";
  var doc = document;

  // Copy link
  doc.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest(".copy-link") : null;
    if (!b) return;
    var url = b.getAttribute("data-url") || location.href, label = b.textContent;
    function done(ok) {
      b.textContent = ok ? "Link copied" : "Copy failed";
      setTimeout(function () { b.textContent = label; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(fallbackCopy(url)); });
    } else {
      done(fallbackCopy(url));
    }
  });
  function fallbackCopy(text) {
    var t = doc.createElement("textarea");
    t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
    doc.body.appendChild(t); t.select();
    var ok = false;
    try { ok = doc.execCommand("copy"); } catch (err) { ok = false; }
    t.remove();
    return ok;
  }

  var post = doc.querySelector(".post[data-slug]");

  // Updates added since this reader last opened the post get a "new" badge.
  if (post) {
    var key = "pbs:seen:" + post.getAttribute("data-slug"), last = null;
    try { last = localStorage.getItem(key); } catch (err) { last = null; }
    if (last) {
      Array.prototype.forEach.call(doc.querySelectorAll(".update[data-at]"), function (u) {
        if (u.getAttribute("data-at") > last) {
          var badge = u.querySelector(".u-new");
          if (badge) badge.hidden = false;
        }
      });
    }
    try { localStorage.setItem(key, new Date().toISOString().replace(/\.\d+Z$/, "Z")); } catch (err) { /* private mode */ }
  }

  // Embedded X posts follow the page's theme: a data-theme on <html> if one is set, otherwise
  // the phone's or computer's light/dark setting. If that setting changes while the post is
  // open, the posts are drawn again in the new theme.
  var darkQuery = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  function theme() {
    var forced = doc.documentElement.getAttribute("data-theme");
    if (forced === "dark" || forced === "light") return forced;
    return darkQuery && darkQuery.matches ? "dark" : "light";
  }
  if (post && post.getAttribute("data-x")) {
    var xposts = Array.prototype.slice.call(doc.querySelectorAll("figure.xpost"));
    var originals = xposts.map(function (f) { return f.innerHTML; });
    var themeX = function () {
      var t = theme();
      xposts.forEach(function (f) {
        Array.prototype.forEach.call(f.querySelectorAll("blockquote.twitter-tweet"), function (b) { b.setAttribute("data-theme", t); });
      });
    };
    themeX();
    var s = doc.createElement("script");
    s.async = true; s.charset = "utf-8"; s.src = "https://platform.twitter.com/widgets.js";
    doc.body.appendChild(s);
    var redraw = function () {
      xposts.forEach(function (f, i) { f.innerHTML = originals[i]; });
      themeX();
      if (window.twttr && twttr.widgets && twttr.widgets.load) twttr.widgets.load(post);
    };
    if (darkQuery) {
      if (darkQuery.addEventListener) darkQuery.addEventListener("change", redraw);
      else if (darkQuery.addListener) darkQuery.addListener(redraw);
    }
  }

  var box = doc.querySelector(".listen");
  if (box) setupListen(box);

  function setupListen(box) {
    var playBtn = box.querySelector(".l-play"), speedBtn = box.querySelector(".l-speed");
    var barWrap = box.querySelector(".l-bar"), bar = box.querySelector(".l-bar > span");
    var RATES = [1, 1.25, 1.5, 0.85], ri = 0;
    function rate() { return RATES[ri]; }
    function showRate() {
      var r = rate();
      speedBtn.textContent = (r === 1 ? "1" : String(r)) + "×";
      speedBtn.setAttribute("aria-label", "Reading speed, " + r + " times");
    }
    function setPlaying(on) {
      box.classList.toggle("playing", on);
      if (on) box.classList.add("started");
      playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
    }
    function progress(f) { bar.style.width = Math.max(0, Math.min(1, f)) * 100 + "%"; }
    var title = (doc.querySelector(".post h1") || {}).textContent || doc.title;

    if (box.getAttribute("data-mode") === "file") {
      var audio = new Audio();
      audio.preload = "none";
      audio.src = box.getAttribute("data-src");
      playBtn.addEventListener("click", function () {
        if (audio.paused) {
          audio.playbackRate = rate();
          var p = audio.play();
          if (p && p.catch) p.catch(function () { setPlaying(false); });
        } else {
          audio.pause();
        }
      });
      audio.addEventListener("play", function () { setPlaying(true); });
      audio.addEventListener("pause", function () { setPlaying(false); });
      audio.addEventListener("ended", function () { setPlaying(false); progress(1); });
      audio.addEventListener("timeupdate", function () { if (audio.duration) progress(audio.currentTime / audio.duration); });
      speedBtn.addEventListener("click", function () { ri = (ri + 1) % RATES.length; audio.playbackRate = rate(); showRate(); });
      barWrap.addEventListener("click", function (e) {
        if (!audio.duration) return;
        var r = barWrap.getBoundingClientRect();
        audio.currentTime = audio.duration * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      });
      if ("mediaSession" in navigator && window.MediaMetadata) {
        audio.addEventListener("play", function () {
          var site = doc.querySelector('meta[property="og:site_name"]');
          try { navigator.mediaSession.metadata = new MediaMetadata({ title: title, artist: site ? site.getAttribute("content") : "" }); } catch (err) { /* older browsers */ }
        }, { once: true });
      }
      box.hidden = false;
      return;
    }

    // No recording: read the post with the reader's own device voice.
    var synth = window.speechSynthesis;
    if (!synth || typeof window.SpeechSynthesisUtterance === "undefined") return;
    var chunks = null, at = 0, speaking = false, paused = false, gen = 0, current = null;

    function clean(node) {
      var c = node.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll(".cite, sup"), function (x) { x.remove(); });
      return c.textContent.replace(/\s+/g, " ").trim();
    }
    function stop(text) { return /[.!?…:]["”’)]?$/.test(text) ? text : text + "."; }
    function parts() {
      var out = [];
      var h1 = doc.querySelector(".post h1"), dek = doc.querySelector(".post .dek");
      if (h1) out.push(stop(clean(h1)));
      if (dek) out.push(stop(clean(dek)));
      Array.prototype.forEach.call(doc.querySelectorAll(".update"), function (u) {
        var n = u.querySelector(".u-n"), t = u.querySelector("time"), x = u.querySelector(".u-text");
        out.push((n ? n.textContent : "Update") + ", " + (t ? t.textContent : "") + ". " + (x ? clean(x) : ""));
      });
      var body = doc.querySelector(".post-body");
      if (body) {
        Array.prototype.forEach.call(body.children, function (el) {
          var tag = el.tagName;
          if (tag === "H2") out.push(stop(clean(el)));
          else if (tag === "P" || tag === "BLOCKQUOTE") out.push(clean(el));
          else if (tag === "UL") Array.prototype.forEach.call(el.children, function (li) { out.push(stop(clean(li))); });
          else if (tag === "FIGURE" && el.getAttribute("data-say")) out.push(el.getAttribute("data-say"));
        });
      }
      return out.filter(Boolean);
    }
    function split(text) {
      var sentences = text.match(/[^.!?…]+[.!?…]+["”’)\]]*\s*|[^.!?…]+$/g) || [text], out = [], cur = "";
      sentences.forEach(function (s) {
        s = s.trim();
        while (s.length > 230) {
          var cut = s.lastIndexOf(", ", 220);
          if (cut < 80) cut = s.lastIndexOf(" ", 220);
          if (cut < 40) cut = 220;
          out.push(s.slice(0, cut + 1).trim()); s = s.slice(cut + 1).trim();
        }
        if (cur && (cur + " " + s).length > 230) { out.push(cur); cur = s; } else { cur = cur ? cur + " " + s : s; }
      });
      if (cur) out.push(cur);
      return out;
    }
    function build() {
      var list = [];
      parts().forEach(function (p) { list = list.concat(split(p)); });
      return list;
    }
    function voice() {
      var vs = synth.getVoices().filter(function (v) { return /^en([-_]|$)/i.test(v.lang); });
      var odd = /Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley/i;
      function score(v) {
        var s = 0;
        if (/premium/i.test(v.name)) s += 40;
        if (/enhanced|natural|neural/i.test(v.name)) s += 30;
        if (/^en[-_]US/i.test(v.lang)) s += 8;
        if (v.localService) s += 4;
        if (v["default"]) s += 2;
        if (odd.test(v.name)) s -= 60;
        return s;
      }
      vs.sort(function (a, b) { return score(b) - score(a); });
      return vs[0] || null;
    }
    function next(g) {
      if (g !== gen) return;
      if (at >= chunks.length) { finish(true); return; }
      var u = new SpeechSynthesisUtterance(chunks[at]);
      current = u;
      u.rate = rate();
      var v = voice();
      if (v) { u.voice = v; u.lang = v.lang; }
      u.onend = function () { if (g !== gen) return; at += 1; progress(at / chunks.length); next(g); };
      u.onerror = function (ev) {
        if (g !== gen || ev.error === "interrupted" || ev.error === "canceled") return;
        at += 1; next(g);
      };
      synth.speak(u);
    }
    function finish(done) {
      speaking = false; paused = false; gen += 1;
      synth.cancel();
      setPlaying(false);
      if (done) { progress(1); at = 0; }
    }
    playBtn.addEventListener("click", function () {
      if (!speaking) {
        chunks = chunks || build();
        if (!chunks.length) return;
        if (at >= chunks.length) at = 0;
        speaking = true; paused = false; gen += 1;
        synth.cancel(); setPlaying(true); next(gen);
      } else if (paused) {
        paused = false; gen += 1; synth.cancel(); setPlaying(true); next(gen);
      } else {
        paused = true; gen += 1; synth.cancel(); setPlaying(false);
      }
    });
    speedBtn.addEventListener("click", function () {
      ri = (ri + 1) % RATES.length; showRate();
      if (speaking && !paused) { gen += 1; synth.cancel(); next(gen); }
    });
    window.addEventListener("pagehide", function () { synth.cancel(); });
    if (synth.getVoices().length === 0 && "onvoiceschanged" in synth) synth.onvoiceschanged = function () {};
    box.hidden = false;
  }
})();
