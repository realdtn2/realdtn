// ==UserScript==
// @name         Show OLM Answers
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Show answers that the website leaks
// @author       realdtn
// @match        *://*.olm.vn/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/realdtn2/realdtn/main/show-olm-answers.user.js
// @downloadURL  https://raw.githubusercontent.com/realdtn2/realdtn/main/show-olm-answers.user.js
// ==/UserScript==

(function () {
    'use strict';

    const mathjaxScript = document.createElement('script');
    mathjaxScript.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
    mathjaxScript.async = true;
    document.head.appendChild(mathjaxScript);

    window.addEventListener('load', () => {
        const logStorage = [];
        const filterKeyword = '"bttl"';

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

                if (combinedText.includes(filterKeyword)) {
                    logStorage.push(`[${timestamp}] ${combinedText}`);
                }

                original.apply(console, args);
            };
        });

        function extractCorrectAnswers() {
            const matches = [];

            logStorage.forEach(entry => {
                if (entry.includes('correctAnswer')) {
                    // Get all potential matches that include 'correctAnswer'
                    const allMatches = [...entry.matchAll(/<li[^>]*correctAnswer[^>]*>.*?<\/li>/gi)];
                    if (allMatches.length > 0) {
                        // Only push the last one
                        const lastMatch = allMatches[allMatches.length - 1][0];
                        matches.push(lastMatch);
                    }
                }

                // Still include Đáp án: pattern
                const dapAnPattern = /Đáp án:\s*([\s\S]*?)(<[^>]+>|\\n|\\r|$)/gi;
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

        container.style.width = 'min(90vw, 300px)';
        container.style.height = '300px';
        container.style.resize = 'both';
        container.style.overflow = 'hidden';

        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'stretch';

        container.style.direction = 'rtl';
        container.style.textAlign = 'left';

        container.style.fontFamily = 'sans-serif';
        container.style.fontSize = '12px';
        container.style.display = localStorage.getItem('olmAnswersVisible') === 'false' ? 'none' : 'block';

        const buttonRow = document.createElement('div');
        buttonRow.style.display = 'flex';
        buttonRow.style.flexWrap = 'wrap';
        buttonRow.style.gap = '4px';
        buttonRow.style.direction = 'ltr';

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
        resultsPanel.style.direction = 'ltr';
        resultsPanel.style.flex = '1';
        resultsPanel.style.overflowY = 'auto';

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

        const responsiveStyle = document.createElement('style');
        responsiveStyle.textContent = `
        @media (max-width: 600px) {
            #olm-answer-container {
                width: 95vw !important;
                max-height: 60vh !important;
            }
        }
        `;
        document.head.appendChild(responsiveStyle);

        const toggleButton = document.createElement('button');
        toggleButton.textContent = '☰';
        toggleButton.title = 'Toggle OLM Answers GUI';
        toggleButton.id = 'olm-toggle-btn';

        Object.assign(toggleButton.style, {
            position: 'fixed',
            top: '10px',
            right: '10px',
            width: '30px',
            height: '30px',
            zIndex: '999999', // super high to float above all
            opacity: '0.2',
            border: 'none',
            borderRadius: '50%',
            backgroundColor: '#222',
            color: '#fff',
            fontSize: '20px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'opacity 0.3s, transform 0.2s',
            touchAction: 'manipulation',
        });

        toggleButton.onmouseenter = () => {
            toggleButton.style.opacity = '1';
        };
        toggleButton.onmouseleave = () => {
            toggleButton.style.opacity = '0.8';
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
