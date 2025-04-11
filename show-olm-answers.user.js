// ==UserScript==
// @name         Show OLM Answers
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Show answers that the website leaks
// @author       realdtn
// @match        *://*.olm.vn/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const mathjaxScript = document.createElement('script');
    mathjaxScript.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
    mathjaxScript.async = true;
    document.head.appendChild(mathjaxScript);

    window.addEventListener('load', () => {
        const logStorage = [];
        const filterPrefix = '{"bttl":false,';

        const methods = ['log', 'info', 'warn', 'error', 'debug'];
        methods.forEach(method => {
            const original = console[method];
            console[method] = function (...args) {
                const timestamp = new Date().toISOString();
                const combinedText = args.map(arg => {
                    try {
                        return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
                    } catch (e) {
                        return '[Unserializable Object]';
                    }
                }).join(' ');

                if (combinedText.startsWith(filterPrefix)) {
                    logStorage.push(`[${timestamp}] ${combinedText}`);
                }

                original.apply(console, args);
            };
        });

        function extractCorrectAnswers() {
            const correctAnswerPattern = /<li\s+class\s*=\s*['"]correctAnswer['"][^>]*>.*?<\/li>/gi;
            const dapAnPattern = /Đáp án:\s*([\s\S]*?)(<[^>]+>|\\n|\\r|$)/gi;

            const matches = [];

            logStorage.forEach(entry => {
                const correctMatches = entry.match(correctAnswerPattern);
                if (correctMatches) {
                    matches.push(...correctMatches);
                }

                let m;
                while ((m = dapAnPattern.exec(entry)) !== null) {
                    const answer = m[1].trim();
                    if (answer) matches.push(answer);
                }
            });

            return [...new Set(matches)];
        }

        function cleanupLinkHtml(html) {
            const allLinks = html.match(/https:\/\/[^"'<> ]+/g);
            if (allLinks && allLinks.length > 0) {
                const lastLink = allLinks[allLinks.length - 1]
                    .replace(/^"+/, '')
                    .replace(/"+$/, '')
                    .replace(/\\$/, '');
                return lastLink;
            }

            const latexMatch = html.match(/\\\\\((.+?)\\\\\)/);
            if (latexMatch) {
                const unescaped = latexMatch[1]
                    .replace(/\\{/g, '{')
                    .replace(/\\}/g, '}')
                    .replace(/\\\\/g, '\\');
                return `\\(${unescaped}\\)`;
            }

            return html;
        }

        function renderMathJax(container = document.body) {
            if (window.MathJax && window.MathJax.typesetPromise) {
                MathJax.typesetPromise([container]).catch((err) => console.error('MathJax render error:', err));
            }
        }

        const container = document.createElement('div');
        container.id = 'olm-answer-container';
        container.style.position = 'fixed';
        container.style.top = '50px';
        container.style.right = '10px';
        container.style.zIndex = 10000;
        container.style.backgroundColor = '#f0f0f0';
        container.style.border = '1px solid #aaa';
        container.style.borderRadius = '4px';
        container.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
        container.style.padding = '6px';
        container.style.maxWidth = '260px';
        container.style.fontFamily = 'sans-serif';
        container.style.fontSize = '12px';
        container.style.display = localStorage.getItem('olmAnswersVisible') === 'false' ? 'none' : 'block';

        const buttonRow = document.createElement('div');
        buttonRow.style.display = 'flex';
        buttonRow.style.flexWrap = 'wrap';
        buttonRow.style.gap = '4px';

        const showBtn = document.createElement('button');
        showBtn.textContent = 'Show Answers';
        showBtn.style.flex = '1';
        showBtn.style.fontSize = '12px';

        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear Logs';
        clearBtn.style.flex = '1';
        clearBtn.style.fontSize = '12px';

        const resultsPanel = document.createElement('div');
        resultsPanel.style.maxHeight = '200px';
        resultsPanel.style.overflowY = 'auto';
        resultsPanel.style.marginTop = '6px';
        resultsPanel.style.padding = '4px';
        resultsPanel.style.borderTop = '1px solid #ccc';
        resultsPanel.style.display = 'none';
        resultsPanel.style.backgroundColor = '#fff';

        showBtn.onclick = () => {
            const answers = extractCorrectAnswers();
            resultsPanel.innerHTML = '';

            if (answers.length === 0) {
                resultsPanel.innerHTML = '<em>No answers found.</em>';
            } else {
                answers.forEach((item, index) => {
                    const cleaned = cleanupLinkHtml(item);
                    const div = document.createElement('div');
                    div.style.marginBottom = '8px';

                    if (cleaned.match(/\.(svg|png|jpg|jpeg|gif)(\?|$)/i)) {
                        div.innerHTML = `<strong>${index + 1}.</strong><br><img src="${cleaned}" style="max-width: 100%; max-height: 150px;">`;
                    } else {
                        div.innerHTML = `<strong>${index + 1}.</strong> ${cleaned}`;
                    }

                    resultsPanel.appendChild(div);
                });
            }

            resultsPanel.style.display = 'block';
            renderMathJax(resultsPanel);
        };

        clearBtn.onclick = () => {
            logStorage.length = 0;
            resultsPanel.innerHTML = '';
            resultsPanel.style.display = 'none';
            console.clear();
            console.log('Filtered logs cleared!');
        };

        buttonRow.appendChild(showBtn);
        buttonRow.appendChild(clearBtn);
        container.appendChild(buttonRow);
        container.appendChild(resultsPanel);
        document.body.appendChild(container);

        const toggleButton = document.createElement('button');
        toggleButton.textContent = '☰';
        toggleButton.title = 'Toggle OLM Answers GUI';
        toggleButton.style.position = 'fixed';
        toggleButton.style.top = '10px';
        toggleButton.style.right = '10px';
        toggleButton.style.width = '48px';
        toggleButton.style.height = '48px';
        toggleButton.style.zIndex = 10001;
        toggleButton.style.opacity = '0.6';
        toggleButton.style.border = 'none';
        toggleButton.style.borderRadius = '24px';
        toggleButton.style.backgroundColor = '#333';
        toggleButton.style.color = '#fff';
        toggleButton.style.fontSize = '24px';
        toggleButton.style.fontWeight = 'bold';
        toggleButton.style.cursor = 'pointer';
        toggleButton.style.transition = 'opacity 0.3s';

        toggleButton.onmouseenter = () => {
            toggleButton.style.opacity = '0.9';
        };
        toggleButton.onmouseleave = () => {
            toggleButton.style.opacity = '0.6';
        };

        toggleButton.onclick = () => {
            const isVisible = container.style.display === 'block';
            container.style.display = isVisible ? 'none' : 'block';
            localStorage.setItem('olmAnswersVisible', !isVisible);
        };

        document.body.appendChild(toggleButton);
        console.log('CorrectAnswer and Đáp án log capture started.');
    });
})();
