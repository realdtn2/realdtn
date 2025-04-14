// ==UserScript==
// @name         OLM Answers Sniffers
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Sniff answers from the network requests
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
            // Also capture input data-accept in trigger-curriculum-cate spans
            else if (line.includes('<span class="trigger-curriculum-cate">')) {
                const inputMatch = line.match(/<input[^>]*data-accept="([^"]+)"[^>]*>/);
                if (inputMatch) {
                    answers.push(inputMatch[1].trim());
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
        let dapAn = null;

        const lines = div.innerHTML.split('\n');

        // Special case for multiple trigger-curriculum-cate spans with input data-accept
        const triggerCurriculumCates = div.querySelectorAll('span.trigger-curriculum-cate');
        if (triggerCurriculumCates.length > 0) {
            // Collect all questions and answers from these spans
            const results = [];

            // First find all the input data-accept values
            const allInputs = div.querySelectorAll('span.trigger-curriculum-cate input[data-accept]');
            if (allInputs.length > 0) {
                correctAnswers = Array.from(allInputs).map(input => input.getAttribute('data-accept').trim());
                dapAn = correctAnswers.join(', ');
            }

            // Now find all the questions (text before each trigger-curriculum-cate span)
            let currentQuestion = '';
            const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT, null, false);
            let node;

            while (node = walker.nextNode()) {
                const text = node.nodeValue.trim();
                if (text) {
                    currentQuestion += ' ' + text;
                }

                if (node.parentNode && node.parentNode.classList &&
                    node.parentNode.classList.contains('trigger-curriculum-cate')) {
                    if (currentQuestion.trim()) {
                        results.push({
                            question: currentQuestion.trim(),
                            correctAnswers: [],
                            dapAn: node.parentNode.querySelector('input[data-accept]')?.getAttribute('data-accept') || ''
                        });
                        currentQuestion = '';
                    }
                }
            }

            // If we found multiple questions with answers, return them all
            if (results.length > 1) {
                // Filter out empty questions and combine answers
                const filteredResults = results.filter(r => r.question && r.question !== '[No question]');
                if (filteredResults.length > 0) {
                    // Combine all answers from all questions
                    const allAnswers = filteredResults.map(r => r.dapAn).filter(a => a);
                    return filteredResults.map((r, i) => ({
                        question: r.question,
                        correctAnswers: allAnswers[i] ? [allAnswers[i]] : [],
                        dapAn: allAnswers[i] || 'Không chọn gì (TN) / Không tìm thấy đáp án (TL)'
                    }));
                }
            }
            // Otherwise fall through to normal processing
        }

        // Special case for true-false questions
        if (html.includes("<ol class='true-false") || html.includes('<ol class="true-false')) {
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes("<ol class='true-false") || lines[i].includes('<ol class="true-false')) {
                    // Question is everything before the <ol class='true-false'
                    const olIndex = lines[i].indexOf("<ol class='true-false");
                    if (olIndex === -1) {
                        const olIndex2 = lines[i].indexOf('<ol class="true-false');
                        if (olIndex2 !== -1) {
                            question = lines[i].substring(0, olIndex2).trim();
                        }
                    } else {
                        question = lines[i].substring(0, olIndex).trim();
                    }

                    // Extract all correct answers from the true-false list
                    const trueFalseDiv = div.querySelector('ol[class*="true-false"]');
                    if (trueFalseDiv) {
                        const correctItems = trueFalseDiv.querySelectorAll('li.correctAnswer');
                        correctAnswers = Array.from(correctItems).map(li => li.innerHTML.trim());
                    }
                    break;
                }
            }
            return {
                question: question.replace(/<[^>]+>/g, '').trim(),
                correctAnswers,
                dapAn: correctAnswers.length ? correctAnswers.join(', ') : 'Không chọn gì (TN) / Không tìm thấy đáp án (TL)'
            };
        }

        // Handle quiz-list cases (including those without correct answers)
        if (html.includes("<ol class='quiz-list") || html.includes('<ol class="quiz-list"')) {
            // Find the question text before the quiz-list
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes("<ol class='quiz-list") || lines[i].includes('<ol class="quiz-list"')) {
                    // Backtrack to find the question line before <ol>
                    for (let j = i - 1; j >= 0; j--) {
                        if (lines[j].includes('<p') || lines[j].trim() !== '') {
                            question = lines[j].replace(/<[^>]+>/g, '').trim();
                            break;
                        }
                    }

                    // Check for correct answers in the quiz-list
                    const quizListDiv = div.querySelector('ol[class*="quiz-list"]');
                    if (quizListDiv) {
                        const correctItems = quizListDiv.querySelectorAll('li.correctAnswer');
                        correctAnswers = Array.from(correctItems).map(li => li.textContent.trim());

                        // If no correct answers found, set to "Không chọn gì (TN) / Không tìm thấy đáp án (TL)"
                        if (correctAnswers.length === 0) {
                            dapAn = 'Không chọn gì (TN) / Không tìm thấy đáp án (TL)';
                        } else {
                            dapAn = correctAnswers.join(', ');
                        }
                    }
                    break;
                }
            }

            return {
                question: question.replace(/<[^>]+>/g, '').trim(),
                correctAnswers,
                dapAn: dapAn || 'Không chọn gì (TN) / Không tìm thấy đáp án (TL)'
            };
        }

        // Handle the case with multiple questions separated by <hr> tags
        if (html.includes('<hr id=')) {
            const sections = html.split('<hr id=');
            if (sections.length > 1) {
                // Process the first section (main question)
                const mainSection = sections[0];
                const mainLines = mainSection.split('\n');
                for (let i = 0; i < mainLines.length; i++) {
                    if (mainLines[i].includes('<p dir="ltr" style="text-align: justify;">')) {
                        question = mainLines[i].replace(/<[^>]+>/g, '').trim();
                        break;
                    }
                }

                // Process each subsequent section (sub-questions)
                const results = [];
                for (let i = 1; i < sections.length; i++) {
                    const sectionHtml = '<hr id=' + sections[i];
                    const sectionLines = sectionHtml.split('\n');

                    let hrIndex = -1;
                    let abovePTags = [];
                    let belowPTags = [];
                    let quizListFound = false;
                    let inputDataAcceptFound = false;

                    // Find the HR line and collect surrounding p tags
                    for (let j = 0; j < sectionLines.length; j++) {
                        const line = sectionLines[j].trim();

                        if (line.includes('<hr id=')) {
                            hrIndex = j;
                            continue;
                        }

                        // Collect p tags above HR
                        if (hrIndex === -1 && line.startsWith('<p')) {
                            abovePTags.push(line);
                        }

                        // Collect p tags below HR
                        if (hrIndex !== -1 && line.startsWith('<p')) {
                            belowPTags.push(line);
                        }
                    }

                    // Check for quiz-list below the p tags
                    for (let j = hrIndex + 1; j < sectionLines.length; j++) {
                        const line = sectionLines[j].trim();
                        if (line.includes('class="quiz-list') || line.includes("class='quiz-list")) {
                            quizListFound = true;
                            break;
                        }
                        if (!line.startsWith('<p') && line !== '') {
                            break; // Stop if we hit non-p, non-empty line
                        }
                    }

                    // Check for input data-accept in p tags
                    const allPTags = [...abovePTags, ...belowPTags];
                    for (const pTag of allPTags) {
                        if (pTag.includes('<input data-accept="')) {
                            inputDataAcceptFound = true;
                            break;
                        }
                    }

                    // Build the question from p tags
                    const subQuestion = allPTags.map(p => p.replace(/<[^>]+>/g, '').trim()).join(' ').trim();

                    let subAnswers = [];
                    let subDapAn = 'Không chọn gì (TN) / Không tìm thấy đáp án (TL)'; // Default value

                    // Case 1: Quiz list found below p tags
                    if (quizListFound) {
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = sectionLines.join('\n');
                        const correctLis = tempDiv.querySelectorAll('li.correctAnswer');
                        subAnswers = Array.from(correctLis).map(li => li.textContent.trim());
                        subDapAn = subAnswers.length ? subAnswers.join(', ') : 'Không chọn gì (TN) / Không tìm thấy đáp án (TL)';
                    }
                    // Case 2: Input data-accept found in p tags
                    else if (inputDataAcceptFound) {
                        const inputs = [];
                        for (const pTag of allPTags) {
                            const tempDiv = document.createElement('div');
                            tempDiv.innerHTML = pTag;
                            const inputElements = tempDiv.querySelectorAll('input[data-accept]');
                            inputElements.forEach(input => {
                                inputs.push(input.getAttribute('data-accept').trim());
                            });
                        }
                        subAnswers = inputs;
                        subDapAn = inputs.join(', ');
                    }
                    // Case 3: Check for p dir="ltr" with input data-accept
                    else {
                        const pDirLtrTags = [];
                        // Collect p dir="ltr" tags above and below HR
                        for (let j = 0; j < sectionLines.length; j++) {
                            const line = sectionLines[j].trim();
                            if (line.startsWith('<p dir="ltr"')) {
                                pDirLtrTags.push(line);
                            }
                        }

                        // Check for input data-accept in these p dir="ltr" tags
                        const inputs = [];
                        for (const pTag of pDirLtrTags) {
                            const tempDiv = document.createElement('div');
                            tempDiv.innerHTML = pTag;
                            const inputElements = tempDiv.querySelectorAll('input[data-accept]');
                            inputElements.forEach(input => {
                                inputs.push(input.getAttribute('data-accept').trim());
                            });
                        }
                        subAnswers = inputs;
                        subDapAn = inputs.join(', ');
                    }

                    if (subQuestion || subAnswers.length || subDapAn) {
                        results.push({
                            question: subQuestion,
                            correctAnswers: subAnswers,
                            dapAn: subDapAn
                        });
                    }
                }

                // Return the first result if only one sub-question, or all if multiple
                if (results.length === 1) {
                    return results[0];
                } else if (results.length > 1) {
                    // Return the main question first, then sub-questions
                    const allResults = [{
                        question: question.replace(/<[^>]+>/g, '').trim(),
                        correctAnswers: [],
                        dapAn: 'Không chọn gì (TN) / Không tìm thấy đáp án (TL)'
                    }].concat(results);
                    return allResults;
                }
            }
        }

        // Original cases (fallbacks)
        if (question === '[No question]') {
            // Handle the case where question is formatted with <p dir="ltr"><span style="white-space: pre-wrap;">
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.includes('<p dir="ltr"><span style="white-space: pre-wrap;">')) {
                    const startTag = '<p dir="ltr"><span style="white-space: pre-wrap;">';
                    const startIndex = line.indexOf(startTag);
                    if (startIndex !== -1) {
                        const contentStart = startIndex + startTag.length;
                        const endIndex = line.indexOf('</span>', contentStart);
                        if (endIndex !== -1) {
                            question = line.substring(contentStart, endIndex).trim();
                        }
                    }
                    break;
                }
            }

            // Fallback to original extraction methods if not found in other formats
            if (question === '[No question]') {
                const cleanLines = div.innerHTML.split('\n').map(l => l.trim()).filter(Boolean);
                for (let i = 1; i < cleanLines.length; i++) {
                    if (cleanLines[i].includes('<input') && cleanLines[i].includes('data-accept=')) {
                        let prevLine = cleanLines[i - 1].replace(/<[^>]*>/g, '').trim();
                        if (prevLine) {
                            question = prevLine;
                        }
                        const inputMatch = cleanLines[i].match(/data-accept="([^"]+)"/);
                        if (inputMatch) {
                            correctAnswers = [inputMatch[1].trim()];
                            dapAn = inputMatch[1].trim();
                        }
                        break;
                    }
                }
            }

            // Extract correct answers using default method if not already found
            if (correctAnswers.length === 0) {
                const listToCheck = div.querySelector('.quiz-list.trigger-curriculum-catemake') ||
                      div.querySelector('.true-false.trigger-curriculum-cate');

                if (listToCheck) {
                    const correctItems = listToCheck.querySelectorAll('li.correctAnswer');
                    correctAnswers = Array.from(correctItems).map(li => li.innerHTML.trim());
                } else {
                    const single = div.querySelector('li.correctAnswer');
                    if (single) correctAnswers.push(single.innerHTML.trim());
                }
            }

            // Extract Đáp án if not already found
            if (!dapAn) {
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
            }
        }

        // Clean up question text - remove HTML tags but preserve line breaks for formatting
        question = question.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        // If we have multiple data-accept values but they weren't captured earlier
        if (correctAnswers.length === 0) {
            const allInputs = div.querySelectorAll('input[data-accept]');
            if (allInputs.length > 0) {
                correctAnswers = Array.from(allInputs).map(input => input.getAttribute('data-accept').trim());
                dapAn = correctAnswers.join(', ');
            }
        }

        return {
            question: question,
            correctAnswers,
            dapAn: dapAn || (correctAnswers.length ? correctAnswers.join(', ') : 'Không chọn gì (TN) / Không tìm thấy đáp án (TL)')
        };
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

        // First try to handle as multiple questions
        if (html.includes('<hr id=')) {
            const sections = html.split('<hr id=');
            if (sections.length > 1) {
                // Process the first section (main question)
                const mainSection = sections[0];
                const mainResult = extractQuestionAndAnswer(mainSection);
                if (mainResult.question && mainResult.question !== '[No question]') {
                    addToResults(mainResult);
                }

                // Process each subsequent section (sub-questions)
                for (let i = 1; i < sections.length; i++) {
                    const sectionHtml = '<hr id=' + sections[i];
                    const result = extractQuestionAndAnswer(sectionHtml);

                    // Handle case where extractQuestionAndAnswer returns an array of results
                    if (Array.isArray(result)) {
                        result.forEach(r => addToResults(r));
                    } else if (result.question && result.question !== '[No question]') {
                        addToResults(result);
                    }
                }
                return;
            }
        }

        // Fallback to single question processing
        const result = extractQuestionAndAnswer(html);
        if (Array.isArray(result)) {
            result.forEach(r => addToResults(r));
        } else {
            addToResults(result);
        }
    }

    function addToResults(result) {
        const { question, correctAnswers, dapAn } = result;

        // Build parts conditionally
        const answerPart = correctAnswers.length > 0
            ? `Answer(s):\n${correctAnswers.map(ans => `- ${ans}`).join('\n')}`
            : '';
        const dapAnPart = dapAn ? `Dap An: ${dapAn}` : '';

        // Format with single newlines between sections
        let formatted = `Question ${questionCounter++}: ${question}`;
        if (answerPart) formatted += `\n${answerPart}`;
        if (dapAnPart) formatted += `\n${dapAnPart}`;
        formatted += '\n'; // Single newline at end

        if (correctAnswers.length || dapAn) {
            allParsedCorrect.push(formatted);
        }

        if (dapAn) {
            allDapAnOnly.push(dapAn);
        }
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
            contentArea.innerHTML = allParsedCorrect.join('<br>').replace(/\n/g, '<br>');
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
            display: block;
            margin: 10px 0;
        }
    `;
        document.head.appendChild(style);

        const mj = document.createElement('script');
        mj.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
        mj.async = true;
        mj.onload = () => {
            // Force MathJax to render all content after it's loaded
            MathJax.typesetPromise([contentArea]);
        };
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
