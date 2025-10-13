// ==UserScript==
// @name         Fill Helper GUI (Field Picker + Typer)
// @namespace    https://example.com/
// @version      0.2.0
// @description  Detect inputs on a page, pick one via GUI, fill text, auto-send on Enter, repeat sending, and save per-site presets/config. Toggle with Alt+Shift+I.
// @author       You
// @match        *://*/*
// @match        https://adultchat.chat-avenue.com/*
// @match        http://adultchat.chat-avenue.com/*
// @match        https://*.chat-avenue.com/*
// @match        http://*.chat-avenue.com/*
// @all-frames   true
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // Config
  const TOGGLE_KEY = { altKey: true, shiftKey: true, key: "I" };
  const TYPE_DELAY_MS = 20; // per character when simulate typing is ON

  let overlayRoot = null;
  let isOpen = false;
  let lastCandidates = [];
  let repeatTimer = null;
  let repeatInProgress = false;
  let lastSentMessage = null; // track last sent preset message to avoid immediate repeat in random mode

  const hostKey = location.host;
  function loadConfig() {
    const all = (typeof GM_getValue === "function" ? GM_getValue("tm_fill_helper_config", null) : null) || {};
    return all[hostKey] || {
      autoSendOnEnter: false,
      repeat: { count: 1, intervalSec: 2, infinite: false },
      minimized: false,
      presets: {}, // name -> { messages: string[], random: false, nextIndex: 0 }
      selectedPreset: "",
    };
  }
  function saveConfig(cfg) {
    const all = (typeof GM_getValue === "function" ? GM_getValue("tm_fill_helper_config", null) : null) || {};
    all[hostKey] = cfg;
    if (typeof GM_setValue === "function") GM_setValue("tm_fill_helper_config", all);
  }
  let config = loadConfig();

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getCandidates() {
    const inputs = Array.from(document.querySelectorAll("input, textarea, [contenteditable=''], [contenteditable='true']"));
    const filtered = inputs.filter((el) => {
      if (!isVisible(el)) return false;
      if (el.tagName === "INPUT") {
        const type = (el.getAttribute("type") || "text").toLowerCase();
        // Exclude button-like inputs
        if (["button", "submit", "reset", "checkbox", "radio", "file", "image", "range", "color", "hidden"].includes(type)) {
          return false;
        }
      }
      return true;
    });
    return filtered.map((el, idx) => ({ el, idx }));
  }

  function buildOverlay() {
    if (overlayRoot) return overlayRoot;
    overlayRoot = document.createElement("div");
    overlayRoot.id = "tm-fill-helper-root";
    overlayRoot.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.2); z-index: 2147483646; }
      .panel { position: fixed; right: 16px; top: 16px; width: 360px; max-height: 80vh; overflow: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.2); border-radius: 10px; background: #111827; color: white; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji"; z-index: 2147483647; }
      .header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #1f2937; }
      .title { font-weight: 600; font-size: 14px; }
      .close { cursor: pointer; border: none; background: transparent; color: #9ca3af; font-size: 18px; }
      .body { padding: 10px 12px; display: grid; gap: 10px; }
      .row { display: grid; gap: 6px; }
      .label { color: #9ca3af; font-size: 12px; }
      .textarea { width: 100%; min-height: 80px; padding: 8px; border-radius: 8px; border: 1px solid #374151; background: #0b1220; color: #e5e7eb; resize: vertical; }
      .checkbox { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
      .select { width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #374151; background: #0b1220; color: #e5e7eb; }
      .btn { padding: 8px 10px; border-radius: 8px; border: 1px solid #2563eb; background: #2563eb; color: white; cursor: pointer; font-weight: 600; }
      .btn.secondary { border-color: #374151; background: #111827; }
      .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
      .tip { color: #9ca3af; font-size: 11px; }
      .list { display: grid; gap: 6px; }
      .item { display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 8px; background: #0b1220; border: 1px solid #111827; }
      .item .index { width: 22px; height: 22px; display: grid; place-items: center; font-size: 12px; border-radius: 6px; background: #111827; color: #9ca3af; }
      .item .desc { color: #d1d5db; font-size: 12px; word-break: break-word; }
      .hl { position: absolute; pointer-events: none; border: 2px solid #10b981; border-radius: 6px; box-shadow: 0 0 0 2px rgba(16,185,129,0.3); z-index: 2147483645; }
      .minimized .body { display: none; }
      .minBtn { cursor: pointer; border: none; background: transparent; color: #9ca3af; font-size: 16px; margin-right: 6px; }
    `;

    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    backdrop.addEventListener("click", toggleUI);

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
      <div class="header">
        <div style="display:flex;align-items:center;gap:6px">
          <button class="minBtn" title="Minimize/Expand">–</button>
          <div class="title">Fill Helper</div>
        </div>
        <button class="close" title="Close">×</button>
      </div>
      <div class="body">
        <div class="row">
          <div class="label">Text to fill</div>
          <textarea class="textarea" placeholder="Type here..."></textarea>
        </div>
        <div class="row">
          <div class="label">Message presets</div>
          <div class="grid2">
            <div>
              <div class="label">Preset name</div>
              <input aria-label="Preset name" class="presetName" placeholder="Preset name" style="padding:8px;border-radius:8px;border:1px solid #374151;background:#0b1220;color:#e5e7eb;"/>
            </div>
            <div>
              <div class="label">Use preset</div>
              <select aria-label="Use preset" class="presetSelect" style="padding:8px;border-radius:8px;border:1px solid #374151;background:#0b1220;color:#e5e7eb;"></select>
            </div>
          </div>
          <textarea class="presetMessages textarea" placeholder="One message per line"></textarea>
          <div class="grid3">
            <label class="checkbox"><input type="checkbox" class="presetRandom"> Random select</label>
            <button class="btn savePreset">Save/Update</button>
            <button class="btn secondary deletePreset">Delete</button>
          </div>
          <div class="tip">If a preset is selected and has messages, sending will use it (randomly if enabled), otherwise it uses the single text above.</div>
        </div>
        <div class="row">
          <div class="label">Target field</div>
          <select class="select"></select>
          <div class="tip">Tip: Hover an input on the page and press Ctrl+Shift+X to pick it.</div>
        </div>
        <div class="row grid2">
          <label class="checkbox"><input type="checkbox" class="simulate" checked> Simulate typing</label>
          <label class="checkbox"><input type="checkbox" class="selectOnFill" checked> Select field before fill</label>
        </div>
        <div class="row grid3">
          <label class="checkbox"><input type="checkbox" class="autoSendEnter"> Auto-press Enter after fill</label>
          <div>
            <div class="label">Repeat count</div>
            <input aria-label="Repeat count" type="number" class="repeatCount" min="1" placeholder="Repeat" style="width:100%;padding:8px;border-radius:8px;border:1px solid #374151;background:#0b1220;color:#e5e7eb;"/>
          </div>
          <div>
            <div class="label">Interval (s)</div>
            <input aria-label="Interval in seconds" type="number" class="repeatInterval" min="0" step="0.1" placeholder="Interval (s)" style="width:100%;padding:8px;border-radius:8px;border:1px solid #374151;background:#0b1220;color:#e5e7eb;"/>
          </div>
        </div>
        <div class="row grid2">
          <label class="checkbox"><input type="checkbox" class="repeatInfinite"> Repeat infinitely</label>
          <button class="btn secondary stopRepeat" disabled>Stop repeating</button>
        </div>
        <div class="row grid2">
          <button class="btn doFill">Fill</button>
          <button class="btn secondary refresh">Refresh fields</button>
        </div>
        <div class="row">
          <div class="label">Detected fields</div>
          <div class="list listContainer"></div>
        </div>
        <div class="row">
          <div class="tip">Toggle UI: Alt+Shift+I • Quick-pick under cursor: Ctrl+Shift+X</div>
        </div>
      </div>
    `;

    overlayRoot.shadowRoot.append(style, backdrop, panel);
    document.documentElement.appendChild(overlayRoot);

    // Events
    panel.querySelector(".close").addEventListener("click", toggleUI);
    panel.querySelector(".minBtn").addEventListener("click", toggleMinimize);
    panel.querySelector(".doFill").addEventListener("click", onDoFill);
    panel.querySelector(".refresh").addEventListener("click", refreshCandidatesUI);
    panel.querySelector(".autoSendEnter").addEventListener("change", onCfgChanged);
    panel.querySelector(".repeatCount").addEventListener("change", onCfgChanged);
    panel.querySelector(".repeatInterval").addEventListener("change", onCfgChanged);
    panel.querySelector(".repeatInfinite").addEventListener("change", onCfgChanged);
    panel.querySelector(".stopRepeat").addEventListener("click", stopRepeating);
    panel.querySelector(".savePreset").addEventListener("click", onSavePreset);
    panel.querySelector(".deletePreset").addEventListener("click", onDeletePreset);
    panel.querySelector(".presetSelect").addEventListener("change", onSelectPreset);
    panel.querySelector(".presetRandom").addEventListener("change", onPresetRandomChange);
    // Remove textarea Enter-to-send; we auto-press Enter after fill when enabled

    return overlayRoot;
  }

  function describeElement(el) {
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute && (el.getAttribute("type") || "text");
    const name = el.getAttribute && (el.getAttribute("name") || el.getAttribute("id") || "");
    const placeholder = el.getAttribute && (el.getAttribute("placeholder") || "");
    const aria = el.getAttribute && (el.getAttribute("aria-label") || "");
    const labelText = getLabelText(el);
    const pieces = [tag, type && type !== "text" ? `(${type})` : "", name ? `#${name}` : "", labelText ? `• ${labelText}` : placeholder ? `• ${placeholder}` : aria ? `• ${aria}` : ""]
      .filter(Boolean)
      .join(" ");
    return pieces;
  }

  function getLabelText(el) {
    // associated label by for= or wrapping label
    const id = el.getAttribute && el.getAttribute("id");
    if (id) {
      const lbl = document.querySelector(`label[for='${CSS.escape(id)}']`);
      if (lbl) return lbl.textContent.trim();
    }
    const parentLabel = el.closest && el.closest("label");
    if (parentLabel) return parentLabel.textContent.trim();
    return "";
  }

  function clearHighlights() {
    const existing = document.querySelectorAll("#tm-fill-helper-hl");
    existing.forEach((e) => e.remove());
  }

  function highlightElement(el) {
    clearHighlights();
    const rect = el.getBoundingClientRect();
    const hl = document.createElement("div");
    hl.id = "tm-fill-helper-hl";
    hl.style.position = "fixed";
    hl.style.left = `${Math.max(0, rect.left - 2)}px`;
    hl.style.top = `${Math.max(0, rect.top - 2)}px`;
    hl.style.width = `${rect.width + 4}px`;
    hl.style.height = `${rect.height + 4}px`;
    hl.style.border = "2px solid #10b981";
    hl.style.borderRadius = "6px";
    hl.style.boxShadow = "0 0 0 2px rgba(16,185,129,0.3)";
    hl.style.zIndex = "2147483645";
    hl.style.pointerEvents = "none";
    document.documentElement.appendChild(hl);
  }

  function refreshCandidatesUI() {
    lastCandidates = getCandidates();
    const root = buildOverlay();
    const panel = root.shadowRoot.querySelector(".panel");
    const select = panel.querySelector(".select");
    const listContainer = panel.querySelector(".listContainer");

    // populate select
    select.innerHTML = "";
    lastCandidates.forEach(({ el, idx }) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = `#${idx + 1} — ${describeElement(el)}`;
      select.appendChild(opt);
    });

    // populate list
    listContainer.innerHTML = "";
    lastCandidates.forEach(({ el, idx }) => {
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `
        <div class="index">${idx + 1}</div>
        <div class="desc"></div>
      `;
      item.addEventListener("mouseenter", () => highlightElement(el));
      item.addEventListener("mouseleave", () => clearHighlights());
      item.addEventListener("click", () => {
        select.value = String(idx);
        highlightElement(el);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      item.querySelector(".desc").textContent = describeElement(el);
      listContainer.appendChild(item);
    });
  }

  async function setFieldValue(el, value, simulateTyping, selectBefore) {
    if (!el) return;

    const setNativeValue = (domEl, val) => {
      if (domEl instanceof HTMLInputElement || domEl instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(domEl.__proto__, "value")?.set;
        if (setter) setter.call(domEl, val);
        else domEl.value = val;
      } else if (domEl.isContentEditable) {
        domEl.textContent = val;
      }
    };

    if (selectBefore && el.focus) {
      el.focus();
      if (el.select) {
        try { el.select(); } catch {}
      }
    }

    if (!simulateTyping) {
      setNativeValue(el, value);
      dispatchAll(el);
      return;
    }

    // Simulated typing
    setNativeValue(el, "");
    dispatch(el, "input");
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      const key = ch;
      dispatch(el, "keydown", { key });
      dispatch(el, "keypress", { key });
      setNativeValue(el, (el.value ?? el.textContent ?? "") + ch);
      dispatch(el, "input");
      dispatch(el, "keyup", { key });
      await sleep(TYPE_DELAY_MS);
    }
    dispatchAll(el);
  }

  function dispatchAll(el) {
    dispatch(el, "input");
    dispatch(el, "change");
    dispatch(el, "blur");
  }

  function dispatch(el, type, init) {
    const evt = new Event(type, { bubbles: true });
    if (init && typeof init === "object") Object.assign(evt, init);
    el.dispatchEvent(evt);
  }

  async function autoSendAfterFill(targetEl) {
    try {
      if (targetEl && targetEl.focus) targetEl.focus();
      // Try form submission if inside a form
      const form = targetEl && targetEl.closest ? targetEl.closest("form") : null;
      if (form) {
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else if (typeof form.submit === "function") {
          form.submit();
        }
        await sleep(10);
      }

      // Try clicking a nearby send/submit button
      const btn = findNearbySendButton(targetEl);
      if (btn) {
        btn.click();
        await sleep(10);
      }

      // Try keyboard enter on the target
      safeKeyEnter(targetEl);
      await sleep(10);
      // Also try on active element (some editors move focus)
      if (document.activeElement) safeKeyEnter(document.activeElement);
    } catch {}
  }

  function safeKeyEnter(el) {
    try {
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      el.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, key: "Enter" }));
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
    } catch {}
  }

  function findNearbySendButton(fromEl) {
    // Search in common scopes: same form, ancestors, siblings
    const scopes = [];
    if (fromEl) scopes.push(fromEl.closest && fromEl.closest("form"));
    scopes.push(fromEl && fromEl.parentElement);
    scopes.push(document);

    const selectors = [
      "button[type='submit']",
      "input[type='submit']",
      "button[aria-label*='send' i]",
      "button[title*='send' i]",
      "button:has(svg[aria-label*='send' i])",
      "button",
    ];

    for (const scope of scopes) {
      if (!scope) continue;
      for (const sel of selectors) {
        const list = Array.from(scope.querySelectorAll(sel));
        const match = list.find((b) => isLikelySendButton(b));
        if (match) return match;
      }
    }
    return null;
  }

  function isLikelySendButton(el) {
    if (!el) return false;
    const text = (el.textContent || "").trim().toLowerCase();
    if (/(send|submit|post|enter|go|send message|chat|reply)/i.test(text)) return true;
    const aria = (el.getAttribute("aria-label") || el.getAttribute("title") || "").toLowerCase();
    if (/(send|submit|post|enter|go|send message|chat|reply)/i.test(aria)) return true;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "submit") return true;
    return false;
  }

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function toggleUI() {
    const root = buildOverlay();
    isOpen = !isOpen;
    root.style.display = isOpen ? "block" : "none";
    clearHighlights();
    if (isOpen) {
      refreshCandidatesUI();
      hydrateConfigToUI();
    }
  }

  function toggleMinimize() {
    const root = buildOverlay();
    const panel = root.shadowRoot.querySelector(".panel");
    panel.classList.toggle("minimized");
    config.minimized = panel.classList.contains("minimized");
    saveConfig(config);
  }

  function onKeyDown(e) {
    if (e.altKey === TOGGLE_KEY.altKey && e.shiftKey === TOGGLE_KEY.shiftKey && (e.key === TOGGLE_KEY.key || e.code === "KeyI")) {
      e.preventDefault();
      toggleUI();
    }
    // Quick-pick: Ctrl+Shift+X picks element under cursor
    if (e.ctrlKey && e.shiftKey && (e.key.toLowerCase?.() === "x" || e.code === "KeyX")) {
      const el = document.elementFromPoint(window._tm_lastMouseX ?? 0, window._tm_lastMouseY ?? 0);
      const target = el && findEditableAncestor(el);
      if (target) {
        buildOverlay();
        const panel = overlayRoot.shadowRoot.querySelector(".panel");
        const select = panel.querySelector(".select");
        lastCandidates = getCandidates();
        const idx = lastCandidates.findIndex(c => c.el === target);
        if (idx !== -1) {
          highlightElement(target);
          select.value = String(idx);
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          refreshCandidatesUI();
          const idx2 = lastCandidates.findIndex(c => c.el === target);
          if (idx2 !== -1) {
            highlightElement(target);
            select.value = String(idx2);
            target.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      }
    }
  }

  function onMouseMove(e) {
    window._tm_lastMouseX = e.clientX;
    window._tm_lastMouseY = e.clientY;
  }

  function findEditableAncestor(el) {
    let cur = el;
    while (cur && cur !== document.documentElement) {
      if (cur instanceof HTMLInputElement || cur instanceof HTMLTextAreaElement) return cur;
      if (cur.nodeType === 1 && cur.isContentEditable) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  async function onDoFill() {
    const root = buildOverlay();
    const panel = root.shadowRoot.querySelector(".panel");
    const textarea = panel.querySelector(".textarea");
    const select = panel.querySelector(".select");
    const simulate = panel.querySelector(".simulate");
    const selectOnFill = panel.querySelector(".selectOnFill");
    // Build lines to send: if a preset is selected use it; randomize per-cycle when enabled
    const preset = config.selectedPreset && config.presets[config.selectedPreset];
    let lines = getLinesToSend(textarea.value);
    if (preset && preset.random) {
      lines = shuffleArray(lines);
    }
    if (lines.length === 0) {
      alert("No message to send.");
      return;
    }
    const idx = Number(select.value);
    const candidate = lastCandidates[idx]?.el;
    if (!candidate) {
      alert("No target selected.");
      return;
    }
    // Send first line immediately
    const first = lines[0];
    await setFieldValue(candidate, first, simulate.checked, selectOnFill.checked);
    if (config.autoSendOnEnter) await autoSendAfterFill(candidate);

    // Start queue for remaining lines and repeat cycles
    const remaining = lines.slice(1);
    if (!repeatInProgress) startLineQueue(candidate, remaining, simulate.checked, selectOnFill.checked);
  }

  function getLinesToSend(singleText) {
    const presetName = config.selectedPreset;
    const preset = presetName && config.presets[presetName];
    if (preset && Array.isArray(preset.messages) && preset.messages.length > 0) {
      return preset.messages.slice(); // in order
    }
    return (singleText || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }

  async function resolveMessageToSend(singleText) {
    const presetName = config.selectedPreset;
    if (presetName && config.presets[presetName] && config.presets[presetName].messages.length > 0) {
      const p = config.presets[presetName];
      if (p.random) {
        const idx = Math.floor(Math.random() * p.messages.length);
        lastSentMessage = p.messages[idx];
        return lastSentMessage;
      } else {
        const idx = p.nextIndex % p.messages.length;
        p.nextIndex = (idx + 1) % p.messages.length;
        saveConfig(config);
        lastSentMessage = p.messages[idx];
        return lastSentMessage;
      }
    }
    lastSentMessage = singleText;
    return singleText;
  }

  function startLineQueue(candidate, initialQueue, simulateChecked, selectBefore) {
    const root = buildOverlay();
    const panel = root.shadowRoot.querySelector(".panel");
    const stopBtn = panel.querySelector(".stopRepeat");
    const { count, intervalSec, infinite } = config.repeat || {};
    const delay = Math.max(0, Number(intervalSec) || 0) * 1000;

    let queue = Array.isArray(initialQueue) ? initialQueue.slice() : [];
    const linesBase = getLinesToSend(root.shadowRoot.querySelector(".textarea").value);
    let cyclesRemaining = infinite ? Infinity : Math.max(0, (Number(count) || 1) - 1);

    const enqueueCycle = () => {
      const presetNow = config.selectedPreset && config.presets[config.selectedPreset];
      if (presetNow && presetNow.random) {
        queue.push(...shuffleArray(linesBase));
      } else {
        queue.push(...linesBase);
      }
    };

    if (Number.isFinite(cyclesRemaining)) {
      for (let c = 0; c < cyclesRemaining; c++) enqueueCycle();
      cyclesRemaining = 0;
    }

    repeatInProgress = true;
    stopBtn.disabled = false;

    const tick = async () => {
      if (!repeatInProgress) return;
      if (queue.length === 0) {
        if (infinite) enqueueCycle(); else return stopRepeating();
      }

      const nextValue = queue.shift();
      await setFieldValue(candidate, nextValue, simulateChecked, selectBefore);
      if (config.autoSendOnEnter) await autoSendAfterFill(candidate);
      repeatTimer = setTimeout(tick, delay);
    };
    repeatTimer = setTimeout(tick, delay);
  }

  function stopRepeating() {
    repeatInProgress = false;
    if (repeatTimer) clearTimeout(repeatTimer);
    repeatTimer = null;
    const root = buildOverlay();
    const panel = root.shadowRoot.querySelector(".panel");
    const stopBtn = panel.querySelector(".stopRepeat");
    if (stopBtn) stopBtn.disabled = true;
  }

  function onCfgChanged() {
    const root = buildOverlay();
    const panel = root.shadowRoot.querySelector(".panel");
    config.autoSendOnEnter = panel.querySelector(".autoSendEnter").checked;
    config.repeat.count = Number(panel.querySelector(".repeatCount").value || 1);
    config.repeat.intervalSec = Number(panel.querySelector(".repeatInterval").value || 2);
    config.repeat.infinite = panel.querySelector(".repeatInfinite").checked;
    saveConfig(config);
    // Disable count input when infinite is enabled
    panel.querySelector(".repeatCount").disabled = !!config.repeat.infinite;
  }

  function hydrateConfigToUI() {
    const root = buildOverlay();
    const panel = root.shadowRoot.querySelector(".panel");
    // minimized
    panel.classList.toggle("minimized", !!config.minimized);
    // simple config
    panel.querySelector(".autoSendEnter").checked = !!config.autoSendOnEnter;
    panel.querySelector(".repeatCount").value = config.repeat?.count ?? 1;
    panel.querySelector(".repeatInterval").value = config.repeat?.intervalSec ?? 2;
    panel.querySelector(".repeatInfinite").checked = !!config.repeat?.infinite;
    panel.querySelector(".repeatCount").disabled = !!config.repeat?.infinite;
    // presets dropdown
    const sel = panel.querySelector(".presetSelect");
    sel.innerHTML = "";
    const names = Object.keys(config.presets || {});
    const empty = document.createElement("option");
    empty.value = ""; empty.textContent = "(none)"; sel.appendChild(empty);
    names.forEach(n => {
      const o = document.createElement("option");
      o.value = n; o.textContent = n; sel.appendChild(o);
    });
    sel.value = config.selectedPreset || "";
    // load selected preset into editor
    const p = config.presets[config.selectedPreset || ""];
    panel.querySelector(".presetName").value = config.selectedPreset || "";
    panel.querySelector(".presetMessages").value = p ? p.messages.join("\n") : "";
    panel.querySelector(".presetRandom").checked = p ? !!p.random : false;
  }

  function onSavePreset() {
    const root = buildOverlay();
    const panel = root.shadowRoot.querySelector(".panel");
    const name = (panel.querySelector(".presetName").value || "").trim();
    if (!name) { alert("Preset name required"); return; }
    const messages = (panel.querySelector(".presetMessages").value || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const random = panel.querySelector(".presetRandom").checked;
    if (!config.presets[name]) config.presets[name] = { messages: [], random: false, nextIndex: 0 };
    config.presets[name].messages = messages;
    config.presets[name].random = random;
    config.selectedPreset = name;
    saveConfig(config);
    hydrateConfigToUI();
  }

  function onDeletePreset() {
    const root = buildOverlay();
    const panel = root.shadowRoot.querySelector(".panel");
    const name = (panel.querySelector(".presetName").value || "").trim();
    if (!name || !config.presets[name]) return;
    delete config.presets[name];
    if (config.selectedPreset === name) config.selectedPreset = "";
    saveConfig(config);
    hydrateConfigToUI();
  }

  function onSelectPreset() {
    const root = buildOverlay();
    const panel = root.shadowRoot.querySelector(".panel");
    const sel = panel.querySelector(".presetSelect");
    config.selectedPreset = sel.value || "";
    saveConfig(config);
    hydrateConfigToUI();
  }

  function onPresetRandomChange() {
    const root = buildOverlay();
    const panel = root.shadowRoot.querySelector(".panel");
    const name = (panel.querySelector(".presetName").value || config.selectedPreset || "").trim();
    if (!name || !config.presets[name]) return;
    config.presets[name].random = panel.querySelector(".presetRandom").checked;
    saveConfig(config);
  }

  // Removed textarea Enter shortcut; auto-press Enter happens after filling when enabled

  // Init
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("mousemove", onMouseMove, true);

  // Pre-create overlay but hidden
  buildOverlay();
  overlayRoot.style.display = "none";
  // hydrate minimized state on boot
  hydrateConfigToUI();
})();
