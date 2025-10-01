// ==UserScript==
// @name         OLM Answers Sniffer
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  v3 - Revamped OLM sniffer that sniffs answers from the network requests, extract, decode, organise, and display the answers.
// @author       realdtn
// @match        *://*.olm.vn/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const HOOK_CODE = `(() => {
      if (window.__olmHooked) return; window.__olmHooked = true;
  
      const tryParseJSON = (text) => { try { return JSON.parse(text); } catch { return null; } };
      const looksLikeBase64 = (s) => typeof s === 'string' && s.length > 16 && /^[A-Za-z0-9+/=]+$/.test(s);
      const collectContents = (obj, out) => {
        if (!obj) return;
        if (Array.isArray(obj)) { for (const it of obj) collectContents(it, out); return; }
        if (typeof obj === 'object') {
          for (const [k, v] of Object.entries(obj)) {
            if (k === 'content' && looksLikeBase64(v)) out.push(v);
            collectContents(v, out);
          }
        }
      };

      const postIfHasContents = (meta, text) => {
        const json = tryParseJSON(text); if (!json) return;
        const contents = []; collectContents(json, contents);
        if (contents.length) {
          window.postMessage({ type: 'OLM_SNIF_CONTENTS', meta, contents }, '*');
        }
      };
  
      // XHR hook
      (() => {
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          this.__olm = { method, url, headers: {}, body: null };
          try { this.addEventListener('load', () => {
            if (this.responseType && this.responseType !== 'text') return;
            postIfHasContents(this.__olm, this.responseText || '');
          }); } catch {}
          return origOpen.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.setRequestHeader = function(h, v) {
          try { if (this.__olm) this.__olm.headers[h] = v; } catch {}
          return origSetHeader.call(this, h, v);
        };
        XMLHttpRequest.prototype.send = function(body) {
          try { if (this.__olm) this.__olm.body = body; } catch {}
          return origSend.call(this, body);
        };
      })();
  
      // fetch hook
      (() => {
        const origFetch = window.fetch;
        window.fetch = function(input, init) {
            const method = (init && init.method) || (input && input.method) || 'GET';
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            const headers = (init && init.headers) || (input && input.headers) || {};
            const body = (init && init.body) || (input && input.body) || null;
          const meta = { method, url, headers, body };
            const p = origFetch(input, init);
          p.then(r => { try { const c = r.clone(); c.text().then(t => postIfHasContents(meta, t)).catch(()=>{}); } catch {} }).catch(()=>{});
            return p;
        };
      })();
    })();`;
  
    const inject = () => {
    const s = document.createElement('script');
    s.textContent = HOOK_CODE;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
    };
    inject();

    const state = { isVisible: false, items: [], originals: [], firstMeta: null };

    // Lazy loader for html beautifier
    let beautifierLoading = null;
    function ensureBeautifier() {
        if (window.html_beautify) return Promise.resolve();
        if (beautifierLoading) return beautifierLoading;
        beautifierLoading = new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/js-beautify@1.14.11/js/lib/beautify-html.min.js';
            s.async = true;
            s.onload = () => resolve();
            s.onerror = () => resolve();
            document.head.appendChild(s);
        });
        return beautifierLoading;
    }

    // Lazy loader for MathJax (with mhchem for chemical equations)
    let mathjaxLoading = null;
    function ensureMathJax() {
        if (window.MathJax && window.MathJax.typesetPromise) return Promise.resolve();
        if (mathjaxLoading) return mathjaxLoading;
        // Configure before loading
        window.MathJax = {
            tex: {
                inlineMath: [["$","$"],["\\(","\\)"]],
                displayMath: [["$$","$$"],["\\[","\\]"]],
                processEscapes: true,
                packages: { '[+]': ['mhchem'] }
            },
            loader: { load: ['[tex]/mhchem'] }
        };
        mathjaxLoading = new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js';
            s.async = true;
            s.onload = () => resolve();
            s.onerror = () => resolve();
            document.head.appendChild(s);
        });
        return mathjaxLoading;
    }

    const utils = {
        safeDecode(base64) {
            try { return decodeURIComponent(escape(atob(base64))); } catch { return null; }
        }
    };

    // Process HTML snippets: split by .exp markers (as end of a question),
    // then remove .exp blocks, beautify each segment, and append to state
    async function processAndAppend(htmlSnippets) {
        await ensureBeautifier();
        const beautify = window.html_beautify || ((s)=>s);
        const options = {
            indent_size: 2,
            preserve_newlines: true,
            max_preserve_newlines: 2,
            wrap_line_length: 0,
            content_unformatted: ['pre','code','textarea']
        };

        for (const html of htmlSnippets) {
            const container = document.createElement('div');
            container.innerHTML = html;

            // Keep a beautified, unmodified original snapshot
            try {
                state.originals.push(beautify(container.innerHTML, options));
            } catch {}

            const segments = [];
            let current = document.createElement('div');

            const pushCurrentIfAny = () => {
                const s = current.innerHTML.trim();
                if (s) segments.push(beautify(s, options));
                current = document.createElement('div');
            };

            Array.from(container.childNodes).forEach((node) => {
                if (node.nodeType === 1 && node.classList && node.classList.contains('exp')) {
                    // Treat '.exp' as the end of the current question
                    pushCurrentIfAny();
                    // Do NOT include the exp block itself
                return;
            }
                current.appendChild(node.cloneNode(true));
            });
            pushCurrentIfAny();

            if (segments.length) {
                state.items.push(...segments);
                } else {
                // If no split occurred, still remove .exp and beautify the whole
                container.querySelectorAll('.exp').forEach(el => el.remove());
                state.items.push(beautify(container.innerHTML, options));
            }
        }
        ui.update();
    }

    window.addEventListener('message', (ev) => {
        const msg = ev.data;
        if (!msg || msg.type !== 'OLM_SNIF_CONTENTS') return;
        if (!state.firstMeta) state.firstMeta = msg.meta || null;
        const decoded = (msg.contents || []).map(utils.safeDecode).filter(Boolean);
        if (!decoded.length) return;
        // Use beautified, segmented HTML for UI
        processAndAppend(decoded);
    }, false);

    const ui = {
        el: {},
        init() {
            const style = document.createElement('style');
            style.textContent = `
              .olm-sniffer-toggle {
                  position: fixed;
                  top: 10px;
                  right: 10px;
                  z-index: 10000;
                  opacity: 0.8;
                  width: 40px;
                  height: 40px;
                  background-color: transparent;
                  border: 2px solid rgba(0, 0, 0, 0.4);
                  border-radius: 50%;
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 0;
                  transition: all 0.2s ease;
              }

              .olm-sniffer-toggle:hover {
                  opacity: 0.8;
                  border-color: rgba(0, 0, 0, 0.4);
              }

              .olm-sniffer-toggle:hover svg {
                  stroke: rgba(0, 0, 0, 0.4);
              }

              .olm-sniffer-toggle.active {
                  opacity: 0.8;
                  border-color: rgba(0, 0, 0, 0.4);
              }

              .olm-sniffer-toggle.active svg {
                  stroke: rgba(0, 0, 0, 0.4);
              }
              .olm-mini-toggle{position:fixed;top:10px;right:10px;z-index:99999;width:36px;height:36px;border-radius:50%;border:1px solid #999;background:#fff8;backdrop-filter:blur(6px);cursor:pointer}
              .olm-mini-panel{position:fixed;top:56px;right:12px;width:280px;height:50vh;max-height:90vh;display:none;flex-direction:column;border:1px solid #999;border-radius:8px;background:#111e;color:#e2e8f0;z-index:99998;overflow:hidden;font:12px/1.4 system-ui,Segoe UI,Roboto}
              .olm-mini-panel.visible{display:flex}
              .olm-mini-head{display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:#2a3a}
              .olm-mini-actions{display:flex;gap:6px}
              .olm-mini-btn{border:0;border-radius:4px;padding:4px 6px;cursor:pointer;background:#445d;color:#fff}
              .olm-mini-body{overflow:auto;padding:8px;background:#1520}
              .olm-item{background:#2634;border-left:2px solid #6af;padding:6px;border-radius:6px;margin:6px 0}
              .olm-item img{max-width:100%;height:auto;max-height:100px}
              /* Resize handle (bottom-left) */
              .olm-mini-resize{position:absolute;bottom:0;left:0;width:28px;height:28px;cursor:nesw-resize;opacity:.7;touch-action:none;-webkit-user-select:none;user-select:none;background:linear-gradient(135deg,transparent 60%, rgba(255,255,255,.35) 60%, rgba(255,255,255,.35) 65%, transparent 65%)}
              .olm-mini-resize:active{opacity:1}
              /* Tighten spacing for answer lists */
              .olm-item ol.quiz-list{margin:0 0 6px 20px;padding:0}
              .olm-item ol.quiz-list li{margin:0;padding:0}
              /* Highlight correct answers */
              .olm-item li.correctAnswer{color:#48bb78;font-weight:600}
              /* Fill-in answers from data-accept */
              .olm-item .fill-answer{color:#48bb78;font-weight:600}
              /* Subtle black text outline/glow for readability */
              .olm-mini-panel, .olm-mini-panel *{
                text-shadow:
                  0 0 1px rgba(0,0,0,.55),
                  0 1px 0 rgba(0,0,0,.35),
                  0 -1px 0 rgba(0,0,0,.35),
                  1px 0 0 rgba(0,0,0,.35),
                  -1px 0 0 rgba(0,0,0,.35);
              }
            `;
            document.head.appendChild(style);

            const btn = document.createElement('button');
            btn.className = 'olm-sniffer-toggle';
            btn.title = 'Answers';
            btn.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(0, 0, 0, 0.4)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="3" y1="7" x2="21" y2="7" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="17" x2="21" y2="17" />
                </svg>
            `;

            const panel = document.createElement('div');
            panel.className = 'olm-mini-panel';
            panel.innerHTML = `
              <div class="olm-mini-head">
                <div>Answers <span id="olm-count">0</span></div>
                <div class="olm-mini-actions">
                  <button class="olm-mini-btn" id="olm-copy">Copy</button>
                  <button class="olm-mini-btn" id="olm-dl">Download</button>
                  <button class="olm-mini-btn" id="olm-copy-orig">Copy Original</button>
                  <button class="olm-mini-btn" id="olm-dl-orig">Download Original</button>
                        </div>
                    </div>
              <div class="olm-mini-body" id="olm-body"><div>No data yet. Start a quiz.</div></div>
            `;

            document.body.appendChild(btn);
            document.body.appendChild(panel);

            // Add resize handle (bottom-left)
            const resize = document.createElement('div');
            resize.className = 'olm-mini-resize';
            panel.appendChild(resize);

            btn.onclick = () => { state.isVisible = !state.isVisible; panel.classList.toggle('visible', state.isVisible); btn.classList.toggle('active', state.isVisible); if (state.isVisible) this.update(); };

            this.el = {
                btn,
                panel,
                body: panel.querySelector('#olm-body'),
                count: panel.querySelector('#olm-count'),
                copy: panel.querySelector('#olm-copy'),
                dl: panel.querySelector('#olm-dl'),
                copyOrig: panel.querySelector('#olm-copy-orig'),
                dlOrig: panel.querySelector('#olm-dl-orig'),
                resize
            };

            this.el.copy.onclick = () => {
                const text = state.items.join('\n\n---\n\n');
                navigator.clipboard?.writeText(text).catch(()=>{});
            };
            this.el.dl.onclick = async () => {
                await ensureBeautifier();
                const beautify = window.html_beautify || ((s)=>s);
                const options = { indent_size: 2, preserve_newlines: true, max_preserve_newlines: 2, wrap_line_length: 0, content_unformatted: ['pre','code','textarea'] };
                const prettyItems = state.items.map(html => beautify(html, options));
                const content = prettyItems.join('\n\n<!-- ---- separator ---- -->\n\n');
                const blob = new Blob([content], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `olm-answers-${Date.now()}.html`;
                document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
            };

            this.el.copyOrig.onclick = async () => {
                await ensureBeautifier();
                const beautify = window.html_beautify || ((s)=>s);
                const options = { indent_size: 2, preserve_newlines: true, max_preserve_newlines: 2, wrap_line_length: 0, content_unformatted: ['pre','code','textarea'] };
                const content = (state.originals || []).map(html => beautify(html, options)).join('\n\n<!-- ---- separator ---- -->\n\n');
                navigator.clipboard?.writeText(content).catch(()=>{});
            };
            this.el.dlOrig.onclick = async () => {
                await ensureBeautifier();
                const beautify = window.html_beautify || ((s)=>s);
                const options = { indent_size: 2, preserve_newlines: true, max_preserve_newlines: 2, wrap_line_length: 0, content_unformatted: ['pre','code','textarea'] };
                const content = (state.originals || []).map(html => beautify(html, options)).join('\n\n<!-- ---- separator ---- -->\n\n');
                const blob = new Blob([content], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `olm-answers-original-${Date.now()}.html`;
                document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
            };

            // Resizing logic (bottom-left handle), mouse + touch
            (function setupResize(panelEl, handle){
                let isResizing = false; let startX = 0; let startY = 0; let startW = 0; let startH = 0;
                const minW = 220; const minH = 180; const maxW = Math.round(window.innerWidth * 0.9); const maxH = Math.round(window.innerHeight * 0.9);
                const getSizes = () => {
                    const cs = window.getComputedStyle(panelEl);
                    return { w: parseInt(cs.width, 10) || panelEl.offsetWidth, h: parseInt(cs.height, 10) || panelEl.offsetHeight };
                };
                const onStart = (cx, cy) => { isResizing = true; const s = getSizes(); startW = s.w; startH = s.h; startX = cx; startY = cy; document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onEnd); document.addEventListener('touchmove', onTouchMove, { passive: false }); document.addEventListener('touchend', onEnd); };
                const onMove = (e) => { if (!isResizing) return; e.preventDefault(); const cx = e.clientX; const cy = e.clientY; applyResize(cx, cy); };
                const onTouchMove = (e) => { if (!isResizing) return; e.preventDefault(); const t = e.touches[0]; applyResize(t.clientX, t.clientY); };
                const applyResize = (cx, cy) => {
                    // bottom-left: width increases as cursor moves left (startX - cx), height increases as cursor moves down (cy - startY)
                    const newW = Math.max(minW, Math.min(maxW, startW + (startX - cx)));
                    const newH = Math.max(minH, Math.min(maxH, startH + (cy - startY)));
                    panelEl.style.width = newW + 'px';
                    panelEl.style.height = newH + 'px';
                };
                const onEnd = () => { isResizing = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onEnd); document.removeEventListener('touchmove', onTouchMove); document.removeEventListener('touchend', onEnd); };
                handle.addEventListener('mousedown', (e) => { onStart(e.clientX, e.clientY); });
                handle.addEventListener('touchstart', (e) => { if (!e.touches || !e.touches[0]) return; e.preventDefault(); const t = e.touches[0]; onStart(t.clientX, t.clientY); }, { passive: false });
            })(panel, resize);
        },
        update() {
            if (!this.el.body) return;
            this.el.count.textContent = String(state.items.length);
            if (!state.items.length) { this.el.body.innerHTML = '<div>No data yet. Start a quiz.</div>'; return; }
            const renderSegment = (html) => {
                const tmp = document.createElement('div');
                tmp.innerHTML = html;
                // If there is no li.correctAnswer, use input[data-accept] as answers
                if (!tmp.querySelector('li.correctAnswer')) {
                    tmp.querySelectorAll('input[data-accept]').forEach(inp => {
                        const v = inp.getAttribute('data-accept') || '';
                        const span = document.createElement('span');
                        span.className = 'fill-answer';
                        span.textContent = v;
                        inp.replaceWith(span);
                    });
                }
                return tmp.innerHTML;
            };
            this.el.body.innerHTML = state.items.map((html, i) => `<div class=\"olm-item\"><div style=\"opacity:.7;margin-bottom:4px\">Item ${i+1}</div>${renderSegment(html)}</div>`).join('');
            // Math typesetting for math and chemistry
            ensureMathJax().then(() => {
                try { window.MathJax.typesetPromise && window.MathJax.typesetPromise([this.el.body]); } catch {}
            });
        }
    };

    const onReady = () => ui.init();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
    else onReady();
})();
