// ==UserScript==
// @name         OLM Answers Sniffers
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Sniff answers from the network requests
// @author       realdtn
// @match        *://*.olm.vn/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/realdtn2/realdtn/main/olm-answers-sniffers.user.js
// @downloadURL  https://raw.githubusercontent.com/realdtn2/realdtn/main/olm-answers-sniffers.user.js
// ==/UserScript==

(function() {
    'use strict';

    // State management
    const state = {
        questions: [],
        rawData: [],
        isVisible: false,
        currentTab: 'formatted',
        firstRequest: null
    };

    // Utility functions
    const utils = {
        decodeBase64ToHTML(base64) {
            try {
                return decodeURIComponent(escape(atob(base64)));
            } catch (e) {
                console.error("Decoding failed:", e);
                return null;
            }
        },

        convertLatexToMathJax(html) {
            if (!html) return html;

            // First, ensure MathJax is loaded before processing
            if (!mathRenderer.isLoaded) {
                // Queue for processing after MathJax loads
                setTimeout(() => {
                    if (mathRenderer.isLoaded) {
                        this.convertLatexToMathJax(html);
                    }
                }, 100);
                return html;
            }

            return mathRenderer.processText(html);
        },

        debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },

        sanitizeHTML(html) {
            const div = document.createElement('div');
            div.innerHTML = html;
            return div.innerHTML;
        }
    };

    // MathJax integration for mathematical and chemical rendering
    const mathRenderer = {
        isLoaded: false,
        isLoading: false,
        queue: [],

        init() {
            this.loadMathJax();
        },

        loadMathJax() {
            if (this.isLoaded || this.isLoading) return;

            this.isLoading = true;
            console.log('�� Loading MathJax...');

            // Configure MathJax before loading
            window.MathJax = {
                tex: {
                    inlineMath: [['$', '$'], ['\\(', '\\)']],
                    displayMath: [['$$', '$$'], ['\\[', '\\]']],
                    processEscapes: true,
                    processEnvironments: true,
                    packages: {'[+]': ['base', 'ams', 'noerrors', 'noundefined', 'mhchem']}
                },
                chtml: {
                    scale: 0.9,
                    minScale: 0.5,
                    matchFontHeight: false,
                    fontURL: 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/output/chtml/fonts/woff-v2'
                },
                loader: {
                    load: ['[tex]/mhchem']
                },
                startup: {
                    ready: () => {
                        console.log('✅ MathJax loaded successfully');
                        this.isLoaded = true;
                        this.isLoading = false;
                        MathJax.startup.defaultReady();

                        // Process queued content
                        this.processQueue();
                    }
                }
            };

            // Load MathJax script
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js';
            script.async = true;
            script.onerror = () => {
                console.error('❌ Failed to load MathJax');
                this.isLoading = false;
            };

            document.head.appendChild(script);
        },

        processQueue() {
            while (this.queue.length > 0) {
                const { element, callback } = this.queue.shift();
                this.renderMath(element);
                if (callback) callback();
            }
        },

        processText(text) {
            if (!text) return text;

            // If it already contains LaTeX delimiters, only do light normalization
            if (text.includes('$') || text.includes('\\(') || text.includes('\\[')) {
                return text
                    .replace(/_\{\{([^}]+)\}\}/g, '_{$1}')
                    .replace(/\^\{\{([^}]+)\}\}/g, '^{$1}')
                    .replace(/\^\{?\s*o\s*\}?/g, '^{\\circ}');
            }

            let s = text;

            // 1) Normalize HTML → LaTeX-ish (in case raw HTML leaked through)
            s = s.replace(/<sub[^>]*>\s*([^<]+?)\s*<\/sub>/gi, '_{$1}')
                 .replace(/<sup[^>]*>\s*([^<]+?)\s*<\/sup>/gi, '^{$1}')
                 .replace(/<span[^>]*class="[^"]*OlmEditorTheme[^"]*"[^>]*>(.*?)<\/span>/gi, '$1')
                 .replace(/<span[^>]*>(.*?)<\/span>/gi, '$1');

            // 2) Collapse editor double braces and normalize degree
            s = s.replace(/_\{\{([^}]+)\}\}/g, '_{$1}')
                 .replace(/\^\{\{([^}]+)\}\}/g, '^{$1}')
                 .replace(/\^\{?\s*o\s*\}?/g, '^{\\circ}');

            // 3) Normalize whitespace
            s = s.replace(/\s+/g, ' ').trim();

            // 4) Chemistry-friendly normalization:
            //    Convert tokens like C_{2}H_{5} -> C2H5 inside \ce later; keep digits for ce
            const ceReady = s.replace(/([A-Z][a-z]?)_\{(\d+)\}/g, '$1$2');

            // 5) Wrap obvious chemical fragments into \ce{...}
            //    Supports sequences with -, =, parentheses
            const wrapCE = (str) => str.replace(
                /(^|[^$\\])((?:[A-Z][a-z]?\d*(?:\([A-Z][a-z]?\d*\)\d*)*(?:\s*[-=]\s*)?)+)(?=$|[^A-Za-z0-9()=])/g,
                (match, pre, frag) => {
                    // Ignore very short fragments
                    if (frag.replace(/\s+/g, '').length < 2) return match;
                    return pre + '$\\ce{' + frag.replace(/\s+/g, '') + '}$';
                }
            );

            s = wrapCE(ceReady);

            // 6) If there are LaTeX markers (_{...}, ^{...}, \ce{...}) but no math delimiters, wrap in inline math
            if (!/\$/.test(s) && /(_\{|\^\{|\\ce\{|\\frac)/.test(s)) {
                s = '$' + s + '$';
            }

            return s;
        },

        renderMath(element) {
            if (!this.isLoaded) {
                // Queue for later rendering
                this.queue.push({ element, callback: null });
                return;
            }

            try {
                // Process text nodes more carefully
                const textNodes = this.getTextNodes(element);

                textNodes.forEach(node => {
                    const originalText = node.textContent;

                    // Skip if already processed or contains LaTeX
                    if (originalText.includes('$') ||
                        originalText.includes('\\(') ||
                        originalText.includes('\\[') ||
                        node.parentNode.classList.contains('MathJax')) {
                        return;
                    }

                    const processedText = this.processText(originalText);

                    if (processedText !== originalText) {
                        // Create a temporary container to parse the HTML
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = processedText;

                        // Replace the text node with the processed content
                        const parent = node.parentNode;
                        while (tempDiv.firstChild) {
                            parent.insertBefore(tempDiv.firstChild, node);
                        }
                        parent.removeChild(node);
                    }
                });

                // Typeset with MathJax
                if (MathJax && MathJax.typesetPromise) {
                    MathJax.typesetPromise([element]).catch((err) => {
                        console.warn('MathJax rendering error:', err);
                    });
                }

            } catch (error) {
                console.error('Math rendering error:', error);
            }
        },

        getTextNodes(element) {
            const textNodes = [];
            const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: function(node) {
                        // Skip nodes that are already processed or in script/style tags
                        if (node.parentNode.tagName === 'SCRIPT' ||
                            node.parentNode.tagName === 'STYLE' ||
                            node.parentNode.classList.contains('MathJax') ||
                            node.parentNode.classList.contains('olm-sniffer-answer') ||
                            node.parentNode.classList.contains('math-q')) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );

            let node;
            while (node = walker.nextNode()) {
                textNodes.push(node);
            }

            return textNodes;
        },

        // Enhanced detection methods
        detectChemicalFormula(text) {
            const chemicalPatterns = [
                /\b[A-Z][a-z]?(\d+)?(\([A-Z][a-z]?\d*\)\d*)*\b/g,
                /\b\d*[A-Z][a-z]?\d*([A-Z][a-z]?\d*)*\b/g,
                /\[[A-Z][a-z]?(\([A-Z][a-z]?\d*\)\d*)*\]\d*[-+]\d*/g,
            ];

            return chemicalPatterns.some(pattern => pattern.test(text));
        },

        detectMathFormula(text) {
            const mathPatterns = [
                /\$.*?\$/g,
                /\\\(.*?\\\)/g,
                /\\\[.*?\\\]/g,
                /\\[a-zA-Z]+/g,
                /\^[\w{}]+/g,
                /_[\w{}]+/g,
                /[±×÷≤≥≠∞√≈∝]/g,
                /\\frac\{.*?\}\{.*?\}/g,
            ];

            return mathPatterns.some(pattern => pattern.test(text));
        }
    };

    // Auto-scroll functionality
    const autoScroller = {
        init() {
            this.setupQuestionObserver();
            this.setupPanelScrollSync();
        },

        setupQuestionObserver() {
            // Create a MutationObserver to watch for changes in question buttons
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes' &&
                        mutation.attributeName === 'class') {

                        const target = mutation.target;

                        // Check for .item-q.active (original type)
                        if (target.classList.contains('item-q') &&
                            target.classList.contains('active')) {
                            const questionId = parseInt(target.getAttribute('data-id'));
                            this.scrollToAnswer(questionId);
                        }

                        // Check for .q-static.q-select (new type)
                        if (target.classList.contains('q-static') &&
                            target.classList.contains('q-select')) {
                            const questionId = parseInt(target.getAttribute('data-stt'));
                            this.scrollToAnswer(questionId);
                        }
                    }
                });
            });

            // Start observing
            this.startObserving(observer);

            // Also set up a periodic check in case MutationObserver misses something
            this.setupPeriodicCheck();
        },

        startObserving(observer) {
            // Function to start observing existing buttons
            const observeExistingButtons = () => {
                // Observe .item-q buttons (original type)
                const questionButtons = document.querySelectorAll('.item-q');
                questionButtons.forEach(button => {
                    observer.observe(button, {
                        attributes: true,
                        attributeFilter: ['class']
                    });
                });

                // Observe .q-static buttons (new type)
                const staticButtons = document.querySelectorAll('.q-static');
                staticButtons.forEach(button => {
                    observer.observe(button, {
                        attributes: true,
                        attributeFilter: ['class']
                    });
                });
            };

            // Observe existing buttons
            observeExistingButtons();

            // Also observe the document for new buttons being added
            const documentObserver = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1) { // Element node
                            // Check if the added node contains question buttons
                            const newItemButtons = node.querySelectorAll ?
                                node.querySelectorAll('.item-q') : [];
                            const newStaticButtons = node.querySelectorAll ?
                                node.querySelectorAll('.q-static') : [];

                            // Observe new .item-q buttons
                            newItemButtons.forEach(button => {
                                observer.observe(button, {
                                    attributes: true,
                                    attributeFilter: ['class']
                                });
                            });

                            // Observe new .q-static buttons
                            newStaticButtons.forEach(button => {
                                observer.observe(button, {
                                    attributes: true,
                                    attributeFilter: ['class']
                                });
                            });

                            // Also check if the node itself is a question button
                            if (node.classList &&
                                (node.classList.contains('item-q') || node.classList.contains('q-static'))) {
                                observer.observe(node, {
                                    attributes: true,
                                    attributeFilter: ['class']
                                });
                            }
                        }
                    });
                });
            });

            documentObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        },

        setupPeriodicCheck() {
            let lastActiveQuestion = -1;

            setInterval(() => {
                // Check for .item-q.active (original type)
                const activeButton = document.querySelector('.item-q.active');
                if (activeButton) {
                    const currentActiveQuestion = parseInt(activeButton.getAttribute('data-id'));

                    // Only scroll if the active question changed
                    if (currentActiveQuestion !== lastActiveQuestion) {
                        lastActiveQuestion = currentActiveQuestion;
                        this.scrollToAnswer(currentActiveQuestion);
                    }
                }

                // Check for .q-static.q-select (new type)
                const selectedStatic = document.querySelector('.q-static.q-select');
                if (selectedStatic) {
                    const currentActiveQuestion = parseInt(selectedStatic.getAttribute('data-stt'));

                    // Only scroll if the active question changed
                    if (currentActiveQuestion !== lastActiveQuestion) {
                        lastActiveQuestion = currentActiveQuestion;
                        this.scrollToAnswer(currentActiveQuestion);
                    }
                }
            }, 500); // Check every 500ms
        },

        setupPanelScrollSync() {
            // Add smooth scrolling behavior to the panel content
            if (ui.elements.content) {
                ui.elements.content.style.scrollBehavior = 'smooth';
            }
        },

        scrollToAnswer(questionIndex) {
            // Only scroll if the panel is visible
            if (!state.isVisible || !ui.elements.content) return;

            // Find the corresponding answer in the panel
            const questionElements = ui.elements.content.querySelectorAll('.olm-sniffer-question');

            if (questionElements[questionIndex]) {
                const targetElement = questionElements[questionIndex];

                // Calculate the scroll position
                const containerRect = ui.elements.content.getBoundingClientRect();
                const targetRect = targetElement.getBoundingClientRect();
                const currentScroll = ui.elements.content.scrollTop;

                // Calculate the desired scroll position (center the element)
                const scrollTo = currentScroll + targetRect.top - containerRect.top -
                            (containerRect.height / 2) + (targetRect.height / 2);

                // Smooth scroll to the answer
                ui.elements.content.scrollTo({
                    top: Math.max(0, scrollTo),
                    behavior: 'smooth'
                });

                // Add a temporary highlight effect
                this.highlightAnswer(targetElement);
            }
        },

        highlightAnswer(element) {
            // Remove existing highlights
            ui.elements.content.querySelectorAll('.olm-sniffer-question.highlighted')
                .forEach(el => el.classList.remove('highlighted'));

            // Add highlight class
            element.classList.add('highlighted');

            // Remove highlight after 2 seconds
            setTimeout(() => {
                element.classList.remove('highlighted');
            }, 2000);
        }
    };

    // Enhanced Answer Extraction Engine with HTML and LaTeX Support
    const answerExtractor = {
        extractAnswersFromHTML(html) {
            console.log("🔍 Processing HTML content...");

            const questions = [];
            const div = document.createElement('div');
            div.innerHTML = html;

            // Check for HR-separated multi-part questions first
            if (html.includes('<hr')) {
                return this.handleMultiPartQuestions(html);
            }

            // Handle single questions with quiz lists
            const quizLists = div.querySelectorAll('ol[class*="quiz-list"], ol.true-false, ol.singlechoice, ol.multichoice, ol[data-key]');
            if (quizLists.length > 0) {
                quizLists.forEach((list, index) => {
                    const questionData = this.extractCompleteQuestion(list, div);
                    const correctAnswers = this.extractCorrectAnswers(list);

                    questions.push({
                        id: index + 1,
                        question: questionData.question || `Question ${index + 1}`,
                        questionContext: questionData.context || '',
                        answers: correctAnswers,
                        rawAnswer: correctAnswers.join(', '),
                        type: this.determineQuestionType(list),
                        fullHTML: questionData.fullHTML || ''
                    });
                });
            }

            // Handle matching questions
            const matchingQuestions = this.extractMatchingQuestions(div);
            questions.push(...matchingQuestions);

            // Handle completion questions (only if no quiz lists found)
            if (quizLists.length === 0) {
                const completionQuestions = this.extractCompletionQuestions(div);
                questions.push(...completionQuestions);
            }

            // Handle fill-in-blank questions with input data-accept
            const inputQuestions = this.extractInputQuestions(div);
            questions.push(...inputQuestions);

            // Handle word form questions
            const wordFormQuestions = this.extractWordFormQuestions(div);
            questions.push(...wordFormQuestions);

            console.log(`📝 Extracted ${questions.length} question(s)`);
            return questions;
        },

        // Add this after the existing extractAnswersFromHTML function
        extractMatchingQuestions(div) {
            const questions = [];
            const matchingLists = div.querySelectorAll('ul.link-list');

            matchingLists.forEach((list, index) => {
                const items = list.querySelectorAll('li');
                const pairs = [];

                items.forEach(item => {
                    const text = this.cleanTextContent(item.textContent);
                    if (text.includes('||')) {
                        const [left, right] = text.split('||').map(s => s.trim());
                        pairs.push({ left, right });
                    }
                });

                if (pairs.length > 0) {
                    const questionText = this.extractMatchingQuestionText(list, div);
                    questions.push({
                        id: questions.length + 1,
                        question: questionText || `Match the items ${index + 1}`,
                        questionContext: '',
                        answers: pairs.map(pair => `${pair.left} → ${pair.right}`),
                        rawAnswer: pairs.map(pair => `${pair.left} → ${pair.right}`).join(', '),
                        type: 'matching',
                        details: pairs,
                        fullHTML: list.outerHTML
                    });
                }
            });

            return questions;
        },

        extractMatchingQuestionText(listElement, containerDiv) {
            // Look for preceding paragraph with matching instructions
            let current = listElement.previousElementSibling;
            let questionParts = [];

            while (current && questionParts.length < 3) {
                if (current.nodeType === 1) {
                    const text = this.cleanTextContent(current.textContent);
                    const html = this.preserveFormattingHTML(current.innerHTML);

                    if (text && text.length > 10) {
                        if (text.includes('Match') || text.includes('match') ||
                            text.includes('nối') || text.includes('ghép')) {
                            questionParts.unshift(html || text);
                            break;
                        }
                    }
                }
                current = current.previousElementSibling;
            }

            return questionParts.join(' ').trim();
        },

        extractCompletionQuestions(div) {
            const questions = [];

            // Look for completion exercises (sentences with blanks or paragraphs)
            const completionElements = div.querySelectorAll('p:not(:has(ol)):not(:has(ul)):not(:has(input))');

            completionElements.forEach((element, index) => {
                const text = this.cleanTextContent(element.textContent);
                const html = this.preserveFormattingHTML(element.innerHTML);

                // Check if this looks like a completion exercise
                if (this.isCompletionExercise(text)) {
                    const questionText = this.extractCompletionQuestionText(element, div);
                    questions.push({
                        id: questions.length + 1,
                        question: questionText || `Complete the text ${index + 1}`,
                        questionContext: '',
                        answers: [html || text],
                        rawAnswer: text,
                        type: 'completion',
                        fullHTML: element.outerHTML
                    });
                }
            });

            return questions;
        },

        isCompletionExercise(text) {
            const completionPatterns = [
                /^Complete the sentences? with the words and phrases given\.?$/i,
                /^Complete the paragraph with the words and phrases given\.?$/i,
                /^Complete the sentence using the correct form of the word in brackets\.?$/i,
                /^Hoàn thành/i,
                /^Điền vào/i,
                /^Chọn từ/i,
                /^Choose the words/i,
                /^Select the words/i
            ];

            // Only match if it's a standalone instruction, not part of a longer text
            return completionPatterns.some(pattern => pattern.test(text.trim())) && text.length < 100;
        },

        extractCompletionQuestionText(element, containerDiv) {
            // Look for preceding instructions
            let current = element.previousElementSibling;
            let questionParts = [];

            while (current && questionParts.length < 2) {
                if (current.nodeType === 1) {
                    const text = this.cleanTextContent(current.textContent);
                    const html = this.preserveFormattingHTML(current.innerHTML);

                    if (text && text.length > 10) {
                        if (this.isCompletionExercise(text)) {
                            questionParts.unshift(html || text);
                            break;
                        }
                    }
                }
                current = current.previousElementSibling;
            }

            return questionParts.join(' ').trim();
        },

        extractWordFormQuestions(div) {
            const questions = [];
            const inputs = div.querySelectorAll('input[data-accept]');

            // Group inputs by their parent paragraph to avoid duplicates
            const inputGroups = new Map();

            inputs.forEach((input) => {
                const parentP = input.closest('p');
                if (parentP) {
                    if (!inputGroups.has(parentP)) {
                        inputGroups.set(parentP, []);
                    }
                    inputGroups.get(parentP).push(input);
                }
            });

            inputGroups.forEach((inputList, parentP) => {
                const questionData = this.getWordFormQuestionContext(inputList[0], div);

                // Only create one question per paragraph
                if (questionData.question && questionData.question.length > 10) {
                    questions.push({
                        id: questions.length + 1,
                        question: questionData.question,
                        questionContext: questionData.context || '',
                        answers: inputList.map(input => input.getAttribute('data-accept')),
                        rawAnswer: inputList.map(input => input.getAttribute('data-accept')).join(', '),
                        type: 'word_form',
                        fullHTML: questionData.fullHTML || ''
                    });
                }
            });

            return questions;
        },

        getWordFormQuestionContext(inputElement, containerDiv) {
            const result = {
                question: '',
                context: '',
                fullHTML: ''
            };

            // Look for the sentence containing the input
            let current = inputElement.closest('p');
            if (current) {
                const text = this.cleanTextContent(current.textContent);
                const html = this.preserveFormattingHTML(current.innerHTML);

                // Replace the input with a blank
                const questionText = text.replace(/\s+/g, ' ').trim();
                const questionHTML = html.replace(/<input[^>]*>/g, '____');

                result.question = questionHTML || questionText;
                result.fullHTML = current.outerHTML;
            }

            // Look for instructions above
            let prevElement = current?.previousElementSibling;
            if (prevElement) {
                const instructionText = this.cleanTextContent(prevElement.textContent);
                const instructionHTML = this.preserveFormattingHTML(prevElement.innerHTML);

                if (instructionText.includes('Complete') || instructionText.includes('correct form') ||
                    instructionText.includes('brackets') || instructionText.includes('ngoặc')) {
                    result.context = instructionHTML || instructionText;
                }
            }

            return result;
        },

        handleMultiPartQuestions(html) {
            const questions = [];
            const sections = html.split(/<hr[^>]*>/);

            sections.forEach((section, index) => {
                if (!section.trim()) return;

                const sectionDiv = document.createElement('div');
                sectionDiv.innerHTML = section;

                // Look for quiz lists in this section
                const quizLists = sectionDiv.querySelectorAll('ol[class*="quiz-list"], ol.true-false, ol.singlechoice, ol.multichoice, ol[data-key]');
                quizLists.forEach(quizList => {
                    const questionData = this.extractCompleteQuestion(quizList, sectionDiv);
                    const correctAnswers = this.extractCorrectAnswers(quizList);

                    questions.push({
                        id: questions.length + 1,
                        question: questionData.question || `Question ${questions.length + 1}`,
                        questionContext: questionData.context || '',
                        answers: correctAnswers,
                        rawAnswer: correctAnswers.join(', '),
                        type: this.determineQuestionType(quizList),
                        fullHTML: questionData.fullHTML || '',
                        section: index + 1
                    });
                });

                // Handle matching questions
                const matchingQuestions = this.extractMatchingQuestions(sectionDiv);
                matchingQuestions.forEach(q => {
                    q.section = index + 1;
                    questions.push(q);
                });

                // Handle completion questions
                const completionQuestions = this.extractCompletionQuestions(sectionDiv);
                completionQuestions.forEach(q => {
                    q.section = index + 1;
                    questions.push(q);
                });

                // Handle conversation ordering questions
                const conversationParts = this.extractConversationParts(sectionDiv);
                if (conversationParts.length > 0) {
                    const questionText = this.extractConversationQuestion(sectionDiv);
                    questions.push({
                        id: questions.length + 1,
                        question: questionText || 'Arrange the conversation in correct order:',
                        questionContext: conversationParts.context || '',
                        answers: conversationParts.correctOrder ? [conversationParts.correctOrder] : ['Order not found'],
                        rawAnswer: conversationParts.correctOrder || 'Not found',
                        type: 'conversation_order',
                        details: conversationParts.parts,
                        section: index + 1
                    });
                }

                // Handle fill-in-blank questions
                const fillInBlanks = this.extractFillInBlanks(sectionDiv, index + 1);
                questions.push(...fillInBlanks);

                // Handle word form questions
                const wordFormQuestions = this.extractWordFormQuestions(sectionDiv);
                wordFormQuestions.forEach(q => {
                    q.section = index + 1;
                    questions.push(q);
                });
            });

            return questions;
        },

        extractCompleteQuestion(listElement, containerDiv) {
            const result = {
                question: '',
                context: '',
                fullHTML: ''
            };

            // Method 1: Look for question in preceding elements
            let current = listElement.previousElementSibling;
            let questionParts = [];
            let elementCount = 0;
            const maxElements = 15;

            while (current && elementCount < maxElements) {
                if (current.nodeType === 1) { // Element node
                    // Get both text content and HTML content
                    const textContent = this.cleanTextContent(current.textContent);
                    const htmlContent = this.preserveFormattingHTML(current.innerHTML);

                    if (textContent && textContent.length > 5) {
                        // Skip solution hints
                        if (textContent.startsWith('Hướng dẫn giải:') ||
                            textContent.startsWith('Giải thích:') ||
                            textContent.startsWith('Lời giải:')) {
                            current = current.previousElementSibling;
                            elementCount++;
                            continue;
                        }

                        // Capture full HTML for context
                        result.fullHTML = current.outerHTML + '\n' + result.fullHTML;

                        // Add formatted HTML content to question parts
                        questionParts.unshift(htmlContent || textContent);

                        // If this looks like a main question, break
                        if (this.isMainQuestion(textContent)) {
                            break;
                        }
                    }
                }

                current = current.previousElementSibling;
                elementCount++;
            }

            // Method 2: Look for question in parent containers
            if (questionParts.length === 0) {
                let parent = listElement.parentElement;
                let parentLevel = 0;

                while (parent && parentLevel < 3) {
                    const parentText = this.extractTextFromElement(parent, listElement);
                    const parentHTML = this.extractHTMLFromElement(parent, listElement);

                    if (parentText && parentText.length > 10) {
                        questionParts.push(parentHTML || parentText);
                        result.fullHTML = parent.outerHTML;
                        break;
                    }
                    parent = parent.parentElement;
                    parentLevel++;
                }
            }

            // Method 3: Search entire container for question patterns
            if (questionParts.length === 0) {
                const paragraphs = containerDiv.querySelectorAll('p, div:not(ol):not(ul):not(li)');
                for (const para of paragraphs) {
                    if (para.contains(listElement)) continue;

                    const text = this.cleanTextContent(para.textContent);
                    const html = this.preserveFormattingHTML(para.innerHTML);

                    if (this.isMainQuestion(text)) {
                        questionParts.push(html || text);
                        result.fullHTML = para.outerHTML;
                        break;
                    }
                }
            }

            // Compile the final question
            result.question = questionParts.join(' ').replace(/\s+/g, ' ').trim();
            result.context = this.extractAdditionalContext(containerDiv, listElement);

            // Fallback: If still no question, create a descriptive one
            if (!result.question || result.question.length < 5) {
                const answerCount = listElement.querySelectorAll('li').length;
                const questionType = this.determineQuestionType(listElement);
                result.question = `${questionType} question with ${answerCount} options`;
            }

            return result;
        },

        preserveFormattingHTML(html) {
            if (!html) return '';

            // If already contains LaTeX markers, don't transform further
            if (html.includes('$') || html.includes('\\(') || html.includes('\\[')) {
                return html;
            }

            let s = html;

            // Strip noisy wrapper spans first (Olm editor)
            s = s.replace(/<span[^>]*class="[^"]*OlmEditorTheme[^"]*"[^>]*>(.*?)<\/span>/gi, '$1')
                 .replace(/<span[^>]*>(.*?)<\/span>/gi, '$1');

            // Convert HTML sub/sup to LaTeX-style
            s = s.replace(/<sub[^>]*>\s*([^<]+?)\s*<\/sub>/gi, '_{$1}')
                 .replace(/<sup[^>]*>\s*([^<]+?)\s*<\/sup>/gi, '^{$1}');

            // Collapse double braces produced by editors: _{{n}} -> _{n}, ^{{o}} -> ^{o}
            s = s.replace(/_\{\{([^}]+)\}\}/g, '_{$1}')
                 .replace(/\^\{\{([^}]+)\}\}/g, '^{$1}');

            // Normalize degree: ^{o} -> ^{\circ}
            s = s.replace(/\^\{?\s*o\s*\}?/g, '^{\\circ}');

            // Keep basic emphasis
            s = s.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
                 .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
                 .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
                 .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

            // Remove residual tags we don't need
            s = s.replace(/<\/?(p|div|br|u)[^>]*>/gi, ' ')
                 .replace(/\s+/g, ' ')
                 .trim();

            return s;
        },

        cleanTextContent(text) {
            if (!text) return '';
            return text.replace(/\s+/g, ' ').trim();
        },

        extractTextFromElement(element, excludeElement) {
            const clone = element.cloneNode(true);

            // Remove the exclude element from the clone
            if (excludeElement) {
                const excludeSelectors = [
                    'ol[class*="quiz-list"]',
                    'ol.true-false',
                    'ol.singlechoice',
                    'ol.multichoice',
                    'ol[data-key]'
                ];

                excludeSelectors.forEach(selector => {
                    const excludeInClone = clone.querySelectorAll(selector);
                    excludeInClone.forEach(el => el.remove());
                });
            }

            return this.cleanTextContent(clone.textContent);
        },

        extractHTMLFromElement(element, excludeElement) {
            const clone = element.cloneNode(true);

            // Remove the exclude element from the clone
            if (excludeElement) {
                const excludeSelectors = [
                    'ol[class*="quiz-list"]',
                    'ol.true-false',
                    'ol.singlechoice',
                    'ol.multichoice',
                    'ol[data-key]'
                ];

                excludeSelectors.forEach(selector => {
                    const excludeInClone = clone.querySelectorAll(selector);
                    excludeInClone.forEach(el => el.remove());
                });
            }

            return this.preserveFormattingHTML(clone.innerHTML);
        },

        isMainQuestion(text) {
            const questionIndicators = [
                // English indicators
                /\?$/,
                /^(What|Where|When|Why|How|Which|Who)/i,
                /Choose|Select|Pick|Find/i,
                /correct|best|appropriate/i,

                // Vietnamese indicators
                /^(Gì|Ở đâu|Khi nào|Tại sao|Như thế nào|Cái nào|Ai)/i,
                /Chọn|Hãy|Tìm|Xác định|Cho|Có bao nhiêu|Số/i,
                /đúng|tốt nhất|phù hợp|công thức|phân tử/i,

                // Question patterns
                /_{2,}/,
                /\([0-9]+[Pp]\)/,
                /Complete|Fill/i,
                /bao nhiêu/i,
                /mấy chất/i,
            ];

            return questionIndicators.some(pattern => pattern.test(text)) && text.length > 10;
        },

        extractCorrectAnswers(listElement) {
            const correctItems = listElement.querySelectorAll('li.correctAnswer');
            return Array.from(correctItems).map(li => {
                // Preserve formatting in answers too
                return this.preserveFormattingHTML(li.innerHTML) || this.cleanTextContent(li.textContent);
            });
        },

        extractFillInBlanks(sectionDiv, sectionIndex = 0) {
            const questions = [];
            const inputs = sectionDiv.querySelectorAll('input[data-accept]');

            if (inputs.length > 0) {
                inputs.forEach((input, index) => {
                    const answer = input.getAttribute('data-accept');
                    const questionData = this.getInputQuestionContext(input, sectionDiv);

                    questions.push({
                        id: questions.length + 1,
                        question: questionData.question || `Fill in the blank ${index + 1}`,
                        questionContext: questionData.context || '',
                        answers: [answer],
                        rawAnswer: answer,
                        type: 'fill_blank',
                        section: sectionIndex,
                        fullHTML: questionData.fullHTML || ''
                    });
                });
            }

            return questions;
        },

        extractInputQuestions(div) {
            const questions = [];
            const inputs = div.querySelectorAll('input[data-accept]');

            inputs.forEach((input, index) => {
                const answer = input.getAttribute('data-accept');
                const questionData = this.getInputQuestionContext(input, div);

                questions.push({
                    id: questions.length + 1,
                    question: questionData.question || `Input question ${index + 1}`,
                    questionContext: questionData.context || '',
                    answers: [answer],
                    rawAnswer: answer,
                    type: 'input',
                    fullHTML: questionData.fullHTML || ''
                });
            });

            return questions;
        },

        getInputQuestionContext(inputElement, containerDiv) {
            const result = {
                question: '',
                context: '',
                fullHTML: ''
            };

            // Method 1: Look at preceding paragraph
            let current = inputElement.closest('p');
            if (current && current.previousElementSibling) {
                const prevElement = current.previousElementSibling;
                const text = this.cleanTextContent(prevElement.textContent);
                const html = this.preserveFormattingHTML(prevElement.innerHTML);

                if (text && text.length > 10) {
                    result.question = html || text;
                    result.fullHTML = prevElement.outerHTML;
                }
            }

            // Method 2: Look at parent elements
            if (!result.question) {
                current = inputElement.parentElement;
                let attempts = 0;

                while (current && attempts < 5) {
                    const text = this.cleanTextContent(current.textContent);
                    const html = this.preserveFormattingHTML(current.innerHTML);

                    if (text && text.length > 20) {
                        // Remove the input value from the text
                        const inputValue = inputElement.getAttribute('data-accept') || '';
                        const cleanText = text.replace(inputValue, '___').replace(/\s+/g, ' ').trim();

                        if (cleanText.length > 10) {
                            result.question = html || cleanText;
                            result.fullHTML = current.outerHTML;
                            break;
                        }
                    }
                    current = current.parentElement;
                    attempts++;
                }
            }

            // Method 3: Extract context from entire container
            if (!result.context) {
                const contextElements = containerDiv.querySelectorAll('p, div:not(:has(input))');
                const contextParts = [];

                for (const element of contextElements) {
                    if (element.contains(inputElement)) continue;

                    const text = this.cleanTextContent(element.textContent);
                    const html = this.preserveFormattingHTML(element.innerHTML);

                    if (text && text.length > 20) {
                        contextParts.push(html || text);
                    }
                }

                result.context = contextParts.slice(0, 3).join('\n\n');
            }

            return result;
        },

        extractAdditionalContext(containerDiv, listElement) {
            // Look for images, diagrams, or additional context
            const contextElements = containerDiv.querySelectorAll('img, figure, .context, .reading-passage, p:not(:empty)');
            const context = [];

            for (const element of contextElements) {
                if (element === listElement || listElement.contains(element)) continue;

                if (element.tagName === 'IMG') {
                    context.push(`[Image: ${element.alt || element.src}]`);
                } else {
                    const text = this.cleanTextContent(element.textContent);
                    const html = this.preserveFormattingHTML(element.innerHTML);

                    if (text && text.length > 20 && !text.startsWith('Hướng dẫn')) {
                        context.push(html || text);
                    }
                }
            }

            return context.join('\n\n');
        },

        extractConversationQuestion(sectionDiv) {
            const elements = sectionDiv.querySelectorAll('*');
            for (const element of elements) {
                const text = this.cleanTextContent(element.textContent);
                if (text.includes('arrange') || text.includes('order') || text.includes('sắp xếp')) {
                    return this.preserveFormattingHTML(element.innerHTML) || text;
                }
            }
            return 'Arrange the conversation in correct order:';
        },

        extractConversationParts(sectionDiv) {
            const parts = [];
            const correctOrder = sectionDiv.querySelector('li.correctAnswer')?.textContent.trim();

            // Get context before the conversation parts
            let context = '';
            const firstParagraph = sectionDiv.querySelector('p');
            if (firstParagraph && !firstParagraph.textContent.match(/^[a-z]\./)) {
                context = this.preserveFormattingHTML(firstParagraph.innerHTML) ||
                        this.cleanTextContent(firstParagraph.textContent);
            }

            // Extract conversation parts from paragraph text
            const paragraphs = sectionDiv.querySelectorAll('p');
            paragraphs.forEach(p => {
                const text = this.cleanTextContent(p.textContent);
                const match = text.match(/^([a-z])\.\s(.+)/);
                if (match) {
                    parts.push({
                        letter: match[1],
                        text: match[2]
                    });
                }
            });

            return {
                parts: parts,
                correctOrder: correctOrder,
                context: context
            };
        },

        determineQuestionType(listElement) {
            if (listElement.classList.contains('true-false')) return 'True/False';
            if (listElement.classList.contains('singlechoice')) return 'Single Choice';
            if (listElement.classList.contains('multichoice')) return 'Multiple Choice';

            // Determine by answer count
            const answerCount = listElement.querySelectorAll('li').length;
            if (answerCount === 2) return 'True/False';
            if (answerCount > 2) return 'Multiple Choice';

            return 'Quiz';
        }
    };

    // Network interception
    const networkHandler = {
        init() {
            this.interceptXHR();
        },

        interceptXHR() {
            const originalOpen = XMLHttpRequest.prototype.open;
            const originalSend = XMLHttpRequest.prototype.send;
            const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

            XMLHttpRequest.prototype.open = function(method, url, ...args) {
                this._intercepted = { method, url, headers: {} };
                return originalOpen.call(this, method, url, ...args);
            };

            XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
                if (this._intercepted) {
                    this._intercepted.headers[header] = value;
                }
                return originalSetRequestHeader.call(this, header, value);
            };

            XMLHttpRequest.prototype.send = function(data) {
                if (this._intercepted) {
                    this._intercepted.data = data;

                    this.addEventListener('load', () => {
                        if (this._intercepted.url.includes('get-question-of-ids')) {
                            this.handleResponse();
                        }
                    });
                }
                return originalSend.call(this, data);
            };

            XMLHttpRequest.prototype.handleResponse = function() {
                try {
                    if (!state.firstRequest) {
                        state.firstRequest = { ...this._intercepted };
                    }

                    const response = JSON.parse(this.responseText);
                    dataProcessor.processResponse(response);
                } catch (error) {
                    console.error('Response processing failed:', error);
                }
            };
        }
    };

    // Data processing
    const dataProcessor = {
        processResponse(jsonResponse) {
            console.log('📦 Processing response data...');
            const contents = this.extractContents(jsonResponse);

            contents.forEach(base64Content => {
                const decoded = utils.decodeBase64ToHTML(base64Content);
                if (decoded) {
                    const processed = utils.convertLatexToMathJax(decoded);
                    state.rawData.push(processed);

                    // Use the placeholder extraction engine
                    const questions = answerExtractor.extractAnswersFromHTML(processed);
                    state.questions.push(...questions);
                }
            });

            ui.updateContent();
        },

        extractContents(obj) {
            const contents = [];

            const traverse = (item) => {
                if (Array.isArray(item)) {
                    item.forEach(traverse);
                } else if (item && typeof item === 'object') {
                    if (item.content) contents.push(item.content);
                    Object.values(item).forEach(traverse);
                }
            };

            traverse(obj);
            return contents;
        }
    };

    // Enhanced UI
    const ui = {
        elements: {},

        init() {
            this.createStyles();
            this.createToggleButton();
            this.createPanel();
            this.setupEventListeners();
        },

        createStyles() {
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
                    opacity: 1;
                    border-color: rgba(0, 0, 0, 0.6);
                }
        
                .olm-sniffer-toggle:hover svg {
                    stroke: rgba(0, 0, 0, 0.6);
                }
        
                .olm-sniffer-toggle.active {
                    opacity: 1;
                    border-color: rgba(0, 0, 0, 0.6);
                }
        
                .olm-sniffer-toggle.active svg {
                    stroke: rgba(0, 0, 0, 0.6);
                }
        
                .olm-sniffer-panel {
                    position: fixed;
                    top: 60px;
                    right: 15px;
                    width: 280px;
                    height: 45vh;
                    background: rgba(255, 255, 255, 0.95);
                    backdrop-filter: blur(15px);
                    border-radius: 12px;
                    box-shadow: 0 15px 30px rgba(0,0,0,0.1);
                    z-index: 9999;
                    display: none;
                    flex-direction: column;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    overflow: hidden;
                    border: 1px solid rgba(255,255,255,0.2);
                }
        
                .olm-sniffer-panel.visible {
                    display: flex;
                    animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
        
                @keyframes slideIn {
                    from {
                        opacity: 0;
                        transform: translateX(20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }
        
                .olm-sniffer-header {
                    padding: 10px 12px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
        
                .olm-sniffer-title {
                    font-size: 12px;
                    font-weight: 600;
                    margin: 0;
                }
        
                .olm-sniffer-stats {
                    font-size: 9px;
                    opacity: 0.9;
                }
        
                .olm-sniffer-tabs {
                    display: flex;
                    background: rgba(0,0,0,0.02);
                    padding: 2px;
                    margin: 8px;
                    border-radius: 8px;
                }
        
                .olm-sniffer-tab {
                    flex: 1;
                    padding: 6px 8px;
                    border: none;
                    background: transparent;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    font-size: 10px;
                    font-weight: 500;
                }
        
                .olm-sniffer-tab.active {
                    background: white;
                    color: #667eea;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.1);
                }
        
                .olm-sniffer-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 0 8px 8px;
                }
        
                .olm-sniffer-question {
                    background: white;
                    border-radius: 8px;
                    padding: 8px;
                    margin-bottom: 6px;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
                    border-left: 2px solid #667eea;
                    overflow: hidden;
                }
        
                .olm-sniffer-question-title {
                    font-weight: 600;
                    color: #2d3748;
                    margin-bottom: 4px;
                    font-size: 10px;
                }
        
                .olm-sniffer-question-text {
                    color: #4a5568;
                    font-size: 12px;
                    line-height: 1.4;
                    margin-bottom: 6px;
                    overflow: hidden;
                }
        
                .olm-sniffer-answers {
                    background: rgba(102, 126, 234, 0.05);
                    border-radius: 4px;
                    padding: 6px;
                    overflow: hidden;
                }
        
                .olm-sniffer-answer {
                    display: flex;
                    align-items: flex-start;
                    margin-bottom: 3px;
                    font-size: 12px;
                    color: #2d3748;
                    line-height: 1.3;
                    overflow: hidden;
                    word-wrap: break-word;
                }
        
                .olm-sniffer-answer:last-child {
                    margin-bottom: 0;
                }
        
                .olm-sniffer-answer::before {
                    content: '✓';
                    color: #48bb78;
                    font-weight: bold;
                    margin-right: 4px;
                    margin-top: 1px;
                    flex-shrink: 0;
                    font-size: 10px;
                }
        
                .olm-sniffer-actions {
                    padding: 8px;
                    border-top: 1px solid rgba(0,0,0,0.1);
                    display: flex;
                    gap: 4px;
                }
        
                .olm-sniffer-btn {
                    flex: 1;
                    padding: 6px 8px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 9px;
                    font-weight: 500;
                    transition: all 0.2s ease;
                }
        
                .olm-sniffer-btn-primary {
                    background: #667eea;
                    color: white;
                }
        
                .olm-sniffer-btn-primary:hover {
                    background: #5a67d8;
                }
        
                .olm-sniffer-btn-secondary {
                    background: rgba(0,0,0,0.05);
                    color: #4a5568;
                }
        
                .olm-sniffer-btn-secondary:hover {
                    background: rgba(0,0,0,0.1);
                }
        
                .olm-sniffer-empty {
                    text-align: center;
                    padding: 20px 10px;
                    color: #a0aec0;
                    font-size: 9px;
                }
        
                /* Image handling - SMALLER */
                .olm-sniffer-answer img {
                    max-width: 100% !important;
                    width: auto !important;
                    height: auto !important;
                    max-height: 80px !important;
                    border-radius: 2px;
                    margin: 2px 0;
                    display: block;
                    object-fit: contain;
                }
        
                .olm-sniffer-question-text img {
                    max-width: 100% !important;
                    width: auto !important;
                    height: auto !important;
                    max-height: 80px !important;
                    border-radius: 2px;
                    margin: 2px 0;
                    display: block;
                    object-fit: contain;
                }
        
                /* MathJax styling */
                .olm-sniffer-answer .MathJax {
                    font-size: 12px !important;
                }
        
                .olm-sniffer-answer .MathJax_Display {
                    font-size: 13px !important;
                }
        
                /* Highlight effect for active answer */
                .olm-sniffer-question.highlighted {
                    border-left-color: #48bb78 !important;
                    background: rgba(72, 187, 120, 0.1) !important;
                    transform: scale(1.005);
                    transition: all 0.3s ease;
                    box-shadow: 0 2px 8px rgba(72, 187, 120, 0.2) !important;
                }
        
                /* Smooth scrolling for the content area */
                .olm-sniffer-content {
                    scroll-behavior: smooth;
                }
        
                /* Dark mode support */
                @media (prefers-color-scheme: dark) {
                    .olm-sniffer-panel {
                        background: rgba(26, 32, 44, 0.95);
                        color: #e2e8f0;
                    }
        
                    .olm-sniffer-question {
                        background: rgba(45, 55, 72, 0.8);
                        color: #e2e8f0;
                    }
        
                    .olm-sniffer-answer {
                        color: #e2e8f0;
                    }
                }
            `;
            document.head.appendChild(style);
        },

        createToggleButton() {
            const button = document.createElement('button');
            button.className = 'olm-sniffer-toggle';
            button.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(0, 0, 0, 0.4)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="3" y1="7" x2="21" y2="7" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="17" x2="21" y2="17" />
                </svg>
            `;

            // Apply the exact styling from your code
            Object.assign(button.style, {
                position: 'fixed',
                top: '10px',
                right: '10px',
                zIndex: '10000',
                opacity: '0.8',
                width: '40px',
                height: '40px',
                backgroundColor: 'transparent',
                border: '2px solid rgba(0, 0, 0, 0.4)',
                borderRadius: '50%',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0'
            });

            this.elements.toggle = button;
            document.body.appendChild(button);
        },

        createPanel() {
            const panel = document.createElement('div');
            panel.className = 'olm-sniffer-panel';

            panel.innerHTML = `
                <div class="olm-sniffer-header">
                    <div>
                        <h3 class="olm-sniffer-title">Answer Sniffer</h3>
                        <div class="olm-sniffer-stats">
                            <span id="question-count">0</span> questions found
                        </div>
                    </div>
                </div>

                <div class="olm-sniffer-tabs">
                    <button class="olm-sniffer-tab active" data-tab="formatted">Formatted</button>
                    <button class="olm-sniffer-tab" data-tab="raw">Raw Answers</button>
                </div>

                <div class="olm-sniffer-content" id="content-area">
                    <div class="olm-sniffer-empty">
                        <p>No questions captured yet</p>
                        <p style="font-size: 12px; margin-top: 8px;">Start a quiz to see answers appear here</p>
                    </div>
                </div>

                <div class="olm-sniffer-actions">
                    <button class="olm-sniffer-btn olm-sniffer-btn-secondary" id="refresh-btn">
                        🔄 Refresh
                    </button>
                    <button class="olm-sniffer-btn olm-sniffer-btn-primary" id="download-btn">
                        📥 Download
                    </button>
                </div>
            `;

            this.elements.panel = panel;
            this.elements.content = panel.querySelector('#content-area');
            this.elements.questionCount = panel.querySelector('#question-count');

            document.body.appendChild(panel);
        },

        setupEventListeners() {
            // Toggle button
            this.elements.toggle.addEventListener('click', () => this.togglePanel());

            // Tab switching
            this.elements.panel.querySelectorAll('.olm-sniffer-tab').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    const tabName = e.target.dataset.tab;
                    this.switchTab(tabName);
                });
            });

            // Action buttons
            const refreshBtn = this.elements.panel.querySelector('#refresh-btn');
            const downloadBtn = this.elements.panel.querySelector('#download-btn');

            refreshBtn.addEventListener('click', () => this.refreshData());
            downloadBtn.addEventListener('click', () => this.downloadData());
        },

        togglePanel() {
            state.isVisible = !state.isVisible;

            if (state.isVisible) {
                this.elements.panel.classList.add('visible');
                this.elements.toggle.classList.add('active');
                this.updateContent();
            } else {
                this.elements.panel.classList.remove('visible');
                this.elements.toggle.classList.remove('active');
            }
        },

        switchTab(tabName) {
            state.currentTab = tabName;

            // Update tab buttons
            this.elements.panel.querySelectorAll('.olm-sniffer-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.tab === tabName);
            });

            this.updateContent();
        },

        updateContent() {
            if (!this.elements.content) return;

            this.elements.questionCount.textContent = state.questions.length;

            if (state.questions.length === 0) {
                this.elements.content.innerHTML = `
                    <div class="olm-sniffer-empty">
                        <p>No questions captured yet</p>
                        <p style="font-size: 12px; margin-top: 8px;">Start a quiz to see answers appear here</p>
                    </div>
                `;
                return;
            }

            if (state.currentTab === 'formatted') {
                this.renderFormattedQuestions();
            } else {
                this.renderRawAnswers();
            }
        },

        renderFormattedQuestions() {
            const html = state.questions.map((q, index) => `
                <div class="olm-sniffer-question">
                    <div class="olm-sniffer-question-title">Question ${index + 1}</div>
                    <div class="olm-sniffer-question-text">${q.question}</div>
                    <div class="olm-sniffer-answers">
                        ${q.answers.map(answer => `<div class="olm-sniffer-answer">${answer}</div>`).join('')}
                    </div>
                </div>
            `).join('');

            this.elements.content.innerHTML = html;

            // Process images in answers to make them responsive
            this.elements.content.querySelectorAll('.olm-sniffer-answer img').forEach(img => {
                img.style.maxWidth = '100%';
                img.style.height = 'auto';
                img.style.maxHeight = '150px';
                img.style.borderRadius = '4px';
                img.style.margin = '4px 0';
                img.style.display = 'block';
            });

            // Render math after content is inserted with proper queuing
            if (mathRenderer.isLoaded) {
                mathRenderer.renderMath(this.elements.content);
            } else {
                // Queue for rendering when MathJax loads
                mathRenderer.queue.push({
                    element: this.elements.content,
                    callback: null
                });
            }
        },

        renderRawAnswers() {
            const html = state.questions.map((q, index) =>
                `<div class="olm-sniffer-question">
                    <div class="olm-sniffer-question-title">Answer ${index + 1}</div>
                    <div class="olm-sniffer-answer">${q.rawAnswer}</div>
                </div>`
            ).join('');

            this.elements.content.innerHTML = html;

            // Process images in answers to make them responsive
            this.elements.content.querySelectorAll('.olm-sniffer-answer img').forEach(img => {
                img.style.maxWidth = '100%';
                img.style.height = 'auto';
                img.style.maxHeight = '150px';
                img.style.borderRadius = '4px';
                img.style.margin = '4px 0';
                img.style.display = 'block';
            });

            // Render math after content is inserted with proper queuing
            if (mathRenderer.isLoaded) {
                mathRenderer.renderMath(this.elements.content);
            } else {
                // Queue for rendering when MathJax loads
                mathRenderer.queue.push({
                    element: this.elements.content,
                    callback: null
                });
            }
        },

        refreshData() {
            if (!state.firstRequest) {
                alert('No initial request found to refresh');
                return;
            }

            // Clear existing data
            state.questions = [];
            state.rawData = [];

            this.elements.content.innerHTML = '<div class="olm-sniffer-empty"><p>Refreshing...</p></div>';

            // Make new request
            const xhr = new XMLHttpRequest();
            xhr.open(state.firstRequest.method, state.firstRequest.url, true);

            Object.entries(state.firstRequest.headers || {}).forEach(([key, value]) => {
                xhr.setRequestHeader(key, value);
            });

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        dataProcessor.processResponse(response);
                    } catch (error) {
                        console.error('Refresh failed:', error);
                    }
                }
            };

            xhr.send(state.firstRequest.data || null);
        },

        downloadData() {
            const data = state.rawData.join('\n\n---\n\n');
            const blob = new Blob([data], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `olm-answers-${new Date().toISOString().split('T')[0]}.txt`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            URL.revokeObjectURL(url);
        }
    };

    // Initialize the application
    function init() {
        console.log('🚀 Enhanced OLM Answers Sniffer initialized');
        networkHandler.init();
        ui.init();
        autoScroller.init();
        mathRenderer.init();
    }

    // Start the application
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
