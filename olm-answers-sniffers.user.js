// ==UserScript==
// @name         OLM Answers Sniffers
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Sniffers answers from the network requests
// @author       realdtn
// @match        *://*.olm.vn/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/realdtn2/realdtn/main/olm-answers-sniffers.user.js
// @downloadURL  https://raw.githubusercontent.com/realdtn2/realdtn/main/olm-answers-sniffers.user.js
// ==/UserScript==

(function () {
    'use strict';

    let allParsedCorrect = [];
    let allRawDecoded = [];
    let allDapAnOnly = [];
    let questionCounter = 1;

    function decodeBase64ToHTML(base64) {
        try {
            return decodeURIComponent(escape(atob(base64)));
        } catch (e) {
            console.error("Decoding failed:", e);
            return null;
        }
    }

    function convertDollarLatexToMathJax(html) {
        return html.replace(/\$(.+?)\$/g, (_, expr) => `\\(${expr}\\)`);
    }

    function extractDapAnFromHTML(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        const answers = [];

        const lines = div.innerHTML.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes('Đáp án:')) {
                const match = line.match(/Đáp án\s*:\s*(.*)/i);
                if (match) {
                    const answerLine = match[1].trim();
                    const inputMatch = line.match(/<input[^>]*data-accept="([^"]+)"[^>]*>/);
                    if (inputMatch) {
                        answers.push(inputMatch[1].trim());
                    } else {
                        answers.push(answerLine);
                    }
                }
            }
        }
        return answers;
    }

    function extractQuestionAndAnswer(html) {
        const div = document.createElement('div');
        div.innerHTML = html;

        let question = '[No question]';
        let correctAnswers = [];

        const lines = div.innerHTML.split('\n').map(l => l.trim()).filter(Boolean);
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].includes('<input') && lines[i].includes('data-accept=')) {
                let prevLine = lines[i - 1].replace(/<[^>]*>/g, '').trim();
                if (prevLine) {
                    question = prevLine;
                }
                break;
            }
        }

        const listToCheck = div.querySelector('.quiz-list.trigger-curriculum-catemake') ||
                            div.querySelector('.true-false.trigger-curriculum-cate');

        if (listToCheck) {
            const correctItems = listToCheck.querySelectorAll('li.correctAnswer');
            correctAnswers = Array.from(correctItems).map(li => li.innerText.trim());
        } else {
            const single = div.querySelector('li.correctAnswer');
            if (single) correctAnswers.push(single.innerText.trim());
        }

        let dapAn = null;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('Đáp án:')) {
                const match = lines[i].match(/Đáp án\s*:\s*(.*)/i);
                if (match) {
                    const inputMatch = lines[i].match(/<input[^>]*data-accept="([^"]+)"[^>]*>/);
                    if (inputMatch) {
                        dapAn = inputMatch[1].trim();
                    } else {
                        dapAn = match[1].trim();
                    }
                    break;
                }
            }
        }

        return { question, correctAnswers, dapAn };
    }

    function processResponse(json) {
        if (!json || typeof json !== 'object') return;

        const contents = [];

        function extractAllContent(obj) {
            if (Array.isArray(obj)) {
                obj.forEach(item => extractAllContent(item));
            } else if (typeof obj === 'object') {
                for (const key in obj) {
                    if (key === 'content') contents.push(obj[key]);
                    else extractAllContent(obj[key]);
                }
            }
        }

        extractAllContent(json);
        contents.forEach(b64 => handleContent(b64));
    }

    function handleContent(b64) {
        let html = decodeBase64ToHTML(b64);
        if (!html) return;

        html = convertDollarLatexToMathJax(html);
        allRawDecoded.push(html + '\n\n');

        const { question, correctAnswers, dapAn } = extractQuestionAndAnswer(html);
        const formatted = `Question ${questionCounter++}: ${question}\nAnswer(s):\n${correctAnswers.map(ans => `- ${ans}`).join('\n') || '[None]'}\nDap An: ${dapAn ?? '[None]'}\n\n`;

        if (correctAnswers.length || dapAn) {
            allParsedCorrect.push(formatted);
        }

        const dapAnList = extractDapAnFromHTML(html);
        allDapAnOnly.push(...dapAnList);

        const subQuestions = html.split('<hr').filter(item => item.includes('<ol'));
        subQuestions.forEach(subHtml => {
            subHtml = convertDollarLatexToMathJax(subHtml);
            const { question, correctAnswers, dapAn } = extractQuestionAndAnswer(subHtml);
            const cleanQuestion = question.replace(/\(Sub-question.*?\)/i, '').trim();
            const formattedSub = `Question ${questionCounter++}: ${cleanQuestion}\nAnswer(s):\n${correctAnswers.map(ans => `- ${ans}`).join('\n') || '[None]'}\nDap An: ${dapAn ?? '[None]'}\n\n`;

            if (correctAnswers.length || dapAn) {
                allParsedCorrect.push(formattedSub);
            }

            const subDaps = extractDapAnFromHTML(subHtml);
            allDapAnOnly.push(...subDaps);
        });
    }

    function createGUI() {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const iconColor = prefersDark ? '#fff' : '#000';
        const backgroundColor = 'transparent';
        const opacity = '0.8';

        const toggleBtn = document.createElement('button');
        toggleBtn.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="7" x2="21" y2="7" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="17" x2="21" y2="17" />
        </svg>
    `;
        Object.assign(toggleBtn.style, {
            position: 'fixed', top: '10px', right: '10px', zIndex: '10000', opacity,
            width: '40px', height: '40px', backgroundColor,
            border: '2px solid ' + iconColor, borderRadius: '50%',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0'
        });

        const downloadBtn = document.createElement('button');
        downloadBtn.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
    `;
        Object.assign(downloadBtn.style, {
            position: 'fixed', top: '10px', right: '60px', zIndex: '10000', opacity,
            width: '40px', height: '40px', backgroundColor,
            border: '2px solid ' + iconColor, borderRadius: '50%',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0'
        });

        downloadBtn.onclick = () => {
            const blob = new Blob([allRawDecoded.join('')], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'olm_raw_decoded.txt';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        };

        const container = document.createElement('div');
        Object.assign(container.style, {
            position: 'fixed', top: '60px', right: '10px', width: '250px', height: '40%',
            overflowY: 'auto', backgroundColor: 'white', zIndex: '9999', padding: '10px',
            boxShadow: '0 0 6px rgba(0,0,0,0.3)', borderRadius: '8px', display: 'none',
            fontSize: '14px', lineHeight: '1.5'
        });

        const contentArea = document.createElement('div');
        contentArea.id = 'content-area';
        Object.assign(contentArea.style, {
            whiteSpace: 'normal',
            wordBreak: 'break-word'
        });

        const tabContainer = document.createElement('div');
        tabContainer.style.marginBottom = '10px';

        const answerTab = document.createElement('button');
        answerTab.textContent = 'Answers';
        const dapAnTab = document.createElement('button');
        dapAnTab.textContent = 'Đáp án';

        [answerTab, dapAnTab].forEach(btn => {
            Object.assign(btn.style, {
                padding: '6px 12px', marginRight: '6px',
                border: 'none', backgroundColor: '#2196F3',
                color: 'white', borderRadius: '4px', cursor: 'pointer'
            });
        });

        answerTab.onclick = () => {
            contentArea.innerHTML = allParsedCorrect.join('<br><br>').replace(/\n/g, '<br>');
            if (window.MathJax) MathJax.typesetPromise([contentArea]);
        };

        dapAnTab.onclick = () => {
            contentArea.innerHTML = allDapAnOnly.length
                ? allDapAnOnly.map((a, i) => `Đáp án ${i + 1}: ${a}`).join('<br>')
            : '[No Đáp án found]';
            if (window.MathJax) MathJax.typesetPromise([contentArea]);
        };

        tabContainer.appendChild(answerTab);
        tabContainer.appendChild(dapAnTab);
        container.appendChild(tabContainer);
        container.appendChild(contentArea);

        toggleBtn.onclick = () => {
            container.style.display = container.style.display === 'none' ? 'block' : 'none';
            if (window.MathJax) MathJax.typesetPromise([contentArea]);
        };

        document.body.appendChild(toggleBtn);
        document.body.appendChild(downloadBtn);
        document.body.appendChild(container);

        const style = document.createElement('style');
        style.textContent = `
        #content-area img {
            max-width: 100%;
            height: auto;
        }
    `;
        document.head.appendChild(style);

        const mj = document.createElement('script');
        mj.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
        mj.async = true;
        document.head.appendChild(mj);
    }

    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (...args) {
        this._url = args[1];
        return open.apply(this, args);
    };

    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener("load", function () {
            if (this._url && this._url.includes("get-question-of-ids")) {
                try {
                    const response = JSON.parse(this.responseText);
                    processResponse(response);
                    setTimeout(() => {
                        createGUI();
                    }, 500);
                } catch (e) {
                    console.error("Error parsing response", e);
                }
            }
        });
        return send.apply(this, args);
    };
})();