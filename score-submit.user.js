// ==UserScript==
// @name         Course Data Submitter (iOS Compatible)
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Submit course data with custom scores and auto time/question detection - iOS Safari compatible
// @author       realdtn
// @match        https://olm.vn/*
// @grant        none
// @run-at       document-end
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    console.log('Course Data Submitter loaded (iOS Compatible)');

    // Detect iOS Safari
    const isIOSSafari = /iPad|iPhone|iPod/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent);
    if (isIOSSafari) {
        console.log('iOS Safari detected - using compatibility mode');
    }

    let extractedData = {};
    let autoTimeDetected = false;
    let detectedTotalTime = null;
    let autoQuestionDetected = false;
    let detectedTotalQuestions = null;

    // Use JSZip for proper DOCX parsing (same as OLM Docx Viewer)
    async function parseDocxWithJSZip(arrayBuffer) {
        console.log('Parsing DOCX with JSZip...');
        
        try {
            // Load JSZip if not already loaded
            if (typeof JSZip === 'undefined') {
                console.log('Loading JSZip library...');
                await loadJSZip();
            }
            
            const zip = new JSZip();
            const docx = await zip.loadAsync(arrayBuffer);
            
            console.log('DOCX loaded, files:', Object.keys(docx.files));
            
            // Extract document.xml
            const documentFile = docx.file('word/document.xml');
            if (!documentFile) {
                console.log('Available files in DOCX:', Object.keys(docx.files));
                throw new Error('No document.xml found in DOCX file');
            }
            
            const documentXml = await documentFile.async('text');
            console.log('Document XML length:', documentXml.length);
            
            return documentXml;
            
        } catch (error) {
            console.error('Error parsing DOCX with JSZip:', error);
            throw error;
        }
    }
    
    // Load JSZip library dynamically
    function loadJSZip() {
        return new Promise((resolve, reject) => {
            if (typeof JSZip !== 'undefined') {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            script.onload = () => {
                console.log('JSZip loaded successfully');
                resolve();
            };
            script.onerror = () => {
                reject(new Error('Failed to load JSZip library'));
            };
            document.head.appendChild(script);
        });
    }

    // Monitor network requests for teacher-static (iOS compatible)
    function monitorNetworkRequests() {
        // iOS Safari extensions have limited access to network interception
        // We'll use a more compatible approach with event listeners
        
        // Try to intercept fetch requests
        if (typeof window.fetch !== 'undefined') {
            const originalFetch = window.fetch;
            window.fetch = function(...args) {
                const url = args[0];

                if (typeof url === 'string' && url.includes('teacher-static')) {
                    console.log('Detected teacher-static request:', url);

                    // If it's a POST request, check the body for total_time
                    if (args[1] && args[1].method === 'POST' && args[1].body) {
                        try {
                            // Parse the body to get total_time
                            const bodyStr = args[1].body.toString();
                            const params = new URLSearchParams(bodyStr);
                            const totalTime = params.get('total_time');

                            if (totalTime && !autoTimeDetected) {
                                detectedTotalTime = parseInt(totalTime);
                                autoTimeDetected = true;
                                console.log('Auto-detected total_time:', detectedTotalTime);

                                // Update the UI if it exists
                                updateTimeInput();
                                updateAutoTimeStatus();
                            }
                        } catch (e) {
                            console.log('Error parsing request body:', e);
                        }
                    }
                }

                return originalFetch.apply(this, args);
            };
        }

        // Also override XMLHttpRequest for completeness (iOS compatible)
        if (typeof window.XMLHttpRequest !== 'undefined') {
            const originalXHR = window.XMLHttpRequest;
            window.XMLHttpRequest = function() {
                const xhr = new originalXHR();
                const originalOpen = xhr.open;

                xhr.open = function(method, url, ...rest) {
                    if (typeof url === 'string' && url.includes('teacher-static') && method === 'POST') {
                        const originalSend = xhr.send;

                        xhr.send = function(body) {
                            if (body && !autoTimeDetected) {
                                try {
                                    const params = new URLSearchParams(body);
                                    const totalTime = params.get('total_time');

                                    if (totalTime) {
                                        detectedTotalTime = parseInt(totalTime);
                                        autoTimeDetected = true;
                                        console.log('Auto-detected total_time (XHR):', detectedTotalTime);

                                        // Update the UI if it exists
                                        updateTimeInput();
                                        updateAutoTimeStatus();
                                    }
                                } catch (e) {
                                    console.log('Error parsing XHR body:', e);
                                }
                            }
                            return originalSend.call(this, body);
                        };
                    }
                    return originalOpen.call(this, method, url, ...rest);
                };

                return xhr;
            };
        }

        // Add fallback method for iOS - monitor DOM changes for time detection
        addFallbackTimeDetection();
    }

    // Fallback time detection method for iOS
    function addFallbackTimeDetection() {
        // Monitor for time-related elements in the DOM
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Look for time-related text content
                            const textContent = node.textContent || '';
                            const timeMatch = textContent.match(/(\d+)\s*(?:giây|second|sec)/i);
                            if (timeMatch && !autoTimeDetected) {
                                const time = parseInt(timeMatch[1]);
                                if (time > 0 && time < 3600) { // Reasonable time range
                                    detectedTotalTime = time;
                                    autoTimeDetected = true;
                                    console.log('Fallback time detection:', detectedTotalTime);
                                    updateTimeInput();
                                    updateAutoTimeStatus();
                                }
                            }
                        }
                    });
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Function to extract id_category (copied from docx viewer)
    function extractIdCategory() {
        if (typeof data_cate !== 'undefined' && data_cate.id_category) {
            return data_cate.id_category;
        }

        const scripts = document.getElementsByTagName('script');
        for (let script of scripts) {
            if (script.innerHTML.includes('data_cate')) {
                const match = script.innerHTML.match(/id_category:\s*"([^"]+)"/);
                if (match) {
                    return match[1];
                }
            }
        }

        const urlParams = new URLSearchParams(window.location.search);
        const fromUrl = urlParams.get('id_cate') || urlParams.get('id_category');
        if (fromUrl) return fromUrl;

        const pathMatch = window.location.pathname.match(/(\d{10,})/);
        if (pathMatch) return pathMatch[1];

        throw new Error('Could not extract id_category from page');
    }

    // Function to fetch docx file and extract total questions (iOS compatible)
    async function extractTotalQuestionsFromDocx() {
        try {
            const idCategory = extractIdCategory();
            const url = `https://olm.vn/download-word-for-user?id_cate=${idCategory}&showAns=1&questionNotApproved=0`;

            console.log('Fetching DOCX file to extract questions...');
            
            // iOS Safari compatible fetch with proper error handling
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': navigator.userAgent,
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                    'Accept-Language': navigator.language + ',en;q=0.5',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': window.location.href,
                    'Sec-Fetch-Dest': 'empty',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Site': 'same-origin'
                },
                credentials: 'same-origin',
                // Add timeout for iOS
                signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            const fileUrl = result.file;
            console.log('DOCX file URL:', fileUrl);

            // Fetch the actual DOCX file with iOS compatibility
            const docxResponse = await fetch(fileUrl, {
                signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined
            });
            if (!docxResponse.ok) {
                throw new Error(`Failed to fetch DOCX file: ${docxResponse.status}`);
            }

            const arrayBuffer = await docxResponse.arrayBuffer();
            console.log('DOCX file size:', arrayBuffer.byteLength, 'bytes');

            // Parse DOCX with JSZip (same as OLM Docx Viewer)
            const documentXml = await parseDocxWithJSZip(arrayBuffer);

            // Extract all text content from the document
            const textContent = extractTextFromDocx(documentXml);
            console.log('Extracted text content length:', textContent.length);
            console.log('First 500 characters of extracted text:', textContent.substring(0, 500));
            console.log('Last 500 characters of extracted text:', textContent.substring(Math.max(0, textContent.length - 500)));

            // Find the last question number by reading backwards
            const totalQuestions = findLastQuestionNumber(textContent);
            console.log('Detected total questions:', totalQuestions);

            return totalQuestions;

        } catch (error) {
            console.error('Error extracting questions from DOCX:', error);
            throw error;
        }
    }


    // Function to extract text content from DOCX XML
    function extractTextFromDocx(xmlContent) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');

        let allText = '';

        // Extract text from all text elements
        const textElements = doc.querySelectorAll('w\\:t, t');
        textElements.forEach(element => {
            const text = element.textContent || '';
            if (text.trim()) {
                allText += text + ' ';
            }
        });

        return allText;
    }

    // Function to find the last question number by reading backwards
    function findLastQuestionNumber(textContent) {
        console.log('Searching for last question in text from END to START...');

        // Search from the END of the document backwards to the START
        // and take the number of the very first question found
        return findFirstQuestionFromEnd(textContent);
    }

    // Function to search from END to START and find the first question
    function findFirstQuestionFromEnd(textContent) {
        console.log('Searching from end of document to start...');
        console.log('Document length:', textContent.length);
        
        // ACTUALLY READ FROM THE END - search backwards through the entire document
        const questionRegex = /(?:Câu|Question|Câu hỏi)\s+(\d+)[\s\.:]/gi;
        const matches = [];
        let match;
        
        // Find ALL matches in the ENTIRE document
        while ((match = questionRegex.exec(textContent)) !== null) {
            const matchData = {
                number: parseInt(match[1]),
                index: match.index,
                text: match[0],
                context: textContent.substring(Math.max(0, match.index - 20), match.index + match[0].length + 20)
            };
            matches.push(matchData);
            console.log(`Found match: "${match[0]}" -> number: ${matchData.number} at position ${match.index}`);
            console.log(`Context: "${matchData.context}"`);
        }
        
        console.log(`Found ${matches.length} question matches in entire document:`, matches);
        
        if (matches.length === 0) {
            console.log('No question patterns found in document');
            return null;
        }
        
        // Find the match that appears LATEST in the document (closest to the end)
        let latestMatch = matches[0];
        for (let i = 1; i < matches.length; i++) {
            if (matches[i].index > latestMatch.index) {
                latestMatch = matches[i];
            }
        }
        
        console.log(`Latest question in document: "${latestMatch.text}" at position ${latestMatch.index} -> number: ${latestMatch.number}`);
        console.log('All matches found:', matches.map(m => `${m.text} (${m.number}) at pos ${m.index}`));
        return latestMatch.number;
    }


    // Function to update the time input field
    function updateTimeInput() {
        if (detectedTotalTime && detectedTotalTime > 0) {
            const timeInput = document.getElementById('time_watched');
            if (timeInput) {
                timeInput.value = detectedTotalTime;
                console.log('Updated time_watched input to:', detectedTotalTime);

                // Show notification
                showAutoTimeNotification(detectedTotalTime);
            }
        }
    }

    // Function to update auto time status (iOS compatible)
    function updateAutoTimeStatus() {
        // This function can be used to update UI status indicators
        // For iOS compatibility, we'll keep it simple
        console.log('Auto time status updated:', detectedTotalTime);
    }

    // Function to update the questions input field
    function updateQuestionsInput() {
        if (detectedTotalQuestions && detectedTotalQuestions > 0) {
            const questionsInput = document.getElementById('count_problems');
            const correctInput = document.getElementById('correct');
            const scoreInput = document.getElementById('score');

            if (questionsInput) {
                questionsInput.value = detectedTotalQuestions;
                console.log('Updated count_problems input to:', detectedTotalQuestions);
            }

            // Also update correct answers to match total questions (100% score)
            if (correctInput) {
                correctInput.value = detectedTotalQuestions;
            }

            if (scoreInput) {
                scoreInput.value = 100;
            }

            // Show notification
            showAutoQuestionsNotification(detectedTotalQuestions);
        }
    }

    // Function to show auto-time detection notification
    function showAutoTimeNotification(time) {
        const message = isIOSSafari 
            ? `⏱️ Đã tự động phát hiện thời gian: ${time} giây (iOS)` 
            : `⏱️ Đã tự động phát hiện thời gian: ${time} giây`;
        showNotification(message, '#4CAF50');
    }

    // Function to show auto-questions detection notification
    function showAutoQuestionsNotification(questions) {
        const message = isIOSSafari 
            ? `❓ Đã tự động phát hiện: ${questions} câu hỏi (iOS)` 
            : `❓ Đã tự động phát hiện: ${questions} câu hỏi`;
        showNotification(message, '#2196F3');
    }

    // Generic notification function
    function showNotification(message, color) {
        // Remove existing notification if any
        const existingNotification = document.getElementById('auto-detection-notification');
        if (existingNotification) {
            existingNotification.remove();
        }

        const notification = document.createElement('div');
        notification.id = 'auto-detection-notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, ${color}, ${color}99);
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 1000000;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 14px;
            font-weight: 500;
            animation: slideIn 0.3s ease-out;
        `;

        // Add CSS animation if not already added
        if (!document.querySelector('#auto-detection-animation')) {
            const style = document.createElement('style');
            style.id = 'auto-detection-animation';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(notification);

        // Auto remove after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOut 0.3s ease-in';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.remove();
                    }
                }, 300);
            }
        }, 3000);
    }

    // Function to extract data from script tags
    function extractData() {
        const scripts = document.getElementsByTagName('script');
        let data = {};

        for (let i = 0; i < scripts.length; i++) {
            const script = scripts[i];
            const content = script.textContent || script.innerHTML;

            if (content.includes('data_cate') && content.includes('id_user')) {
                try {
                    const match = content.match(/var\s+data_cate\s*=\s*\{[\s\S]*?\};/);
                    if (match) {
                        const objString = match[0];

                        const id_user = objString.match(/id_user\s*:\s*["']?(-?\d+)["']?/);
                        const id_category = objString.match(/id_category\s*:\s*["']?(-?\d+)["']?/);
                        const id_courseware = objString.match(/id_courseware\s*:\s*["']?(-?\d+)["']?/);
                        const id_school = objString.match(/id_school\s*:\s*["']?(-?\d+)["']?/);
                        const id_grade = objString.match(/id_grade\s*:\s*["']?(-?\d+)["']?/);
                        const type_vip = objString.match(/type_vip\s*:\s*["']?(-?\d+)["']?/);
                        const id_group = objString.match(/id_group\s*:\s*["']?(-?\d+)["']?/);

                        if (id_user) data.id_user = id_user[1];
                        if (id_category) data.id_cate = id_category[1];
                        if (id_courseware) data.id_courseware = id_courseware[1];
                        if (id_school) data.id_school = id_school[1];
                        if (id_grade) data.id_grade = id_grade[1];
                        if (type_vip) data.type_vip = type_vip[1];
                        if (id_group) data.id_group = id_group[1];
                    }
                } catch (e) {
                    console.error('Error extracting data:', e);
                }
            }
        }

        return Object.keys(data).length > 0 ? data : null;
    }

    // Function to get CSRF token
    function getCookie(name) {
        const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : null;
    }

    // Function to delete existing work
    async function deleteWork() {
        try {
            const csrfToken =
                document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
                getCookie('XSRF-TOKEN') ||
                '';

            const deleteBody = new URLSearchParams({
                id_cate: extractedData.id_cate || '',
                id_user: extractedData.id_user || ''
            });

            const res = await fetch('https://olm.vn/course/teacher-static', {
                method: 'DELETE',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    ...(csrfToken ? { 'X-CSRF-TOKEN': csrfToken } : {})
                },
                body: deleteBody
            });

            const contentType = res.headers.get('content-type') || '';
            const data = contentType.includes('application/json') ? await res.json() : await res.text();

            console.log('Delete Status:', res.status);
            console.log('Delete Response:', data);

            // Clear local storage if possible (iOS compatible)
            try {
                // Try multiple methods for iOS compatibility
                if (window.CATE_UI && typeof CATE_UI.delLocalRecord === 'function') {
                    CATE_UI.delLocalRecord("data");
                    CATE_UI.delLocalRecord("time_spent");
                    CATE_UI.delLocalRecord("time_init");
                }
                
                // Fallback: try to clear localStorage directly
                if (typeof localStorage !== 'undefined') {
                    const keysToRemove = ['data', 'time_spent', 'time_init', 'CATE_UI_data'];
                    keysToRemove.forEach(key => {
                        try {
                            localStorage.removeItem(key);
                        } catch (e) {
                            console.log(`Could not remove ${key} from localStorage:`, e);
                        }
                    });
                }
                
                // Additional fallback: try sessionStorage
                if (typeof sessionStorage !== 'undefined') {
                    const keysToRemove = ['data', 'time_spent', 'time_init', 'CATE_UI_data'];
                    keysToRemove.forEach(key => {
                        try {
                            sessionStorage.removeItem(key);
                        } catch (e) {
                            console.log(`Could not remove ${key} from sessionStorage:`, e);
                        }
                    });
                }
            } catch (e) {
                console.log('Could not clear local storage:', e);
            }

            return { success: res.ok, status: res.status, data };
        } catch (error) {
            console.error('Delete error:', error);
            return { success: false, error: error.message };
        }
    }

    // Function to submit data for video
    async function submitData(score, countProblems, correct, timeWatched) {
        const csrfToken =
            document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
            getCookie('XSRF-TOKEN') ||
            '';

        const body = new URLSearchParams({
            id_user: extractedData.id_user || '',
            id_cate: extractedData.id_cate || '',
            id_grade: extractedData.id_grade || '',
            id_courseware: extractedData.id_courseware || '',
            id_group: extractedData.id_group || '',
            id_school: extractedData.id_school || '',
            time_init: '',
            name_user: '',
            type_vip: extractedData.type_vip || '',
            time_spent: timeWatched.toString(),
            score: score.toString(),
            data_log: '',
            total_time: timeWatched.toString(),
            current_time: timeWatched.toString(),
            correct: correct.toString(),
            totalq: '0',
            count_problems: countProblems.toString(),
            date_end: Math.floor(Date.now()/1000).toString(),
            ended: '1',
            save_star: '1'
        });

        try {
            const res = await fetch('https://olm.vn/course/teacher-static', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    ...(csrfToken ? { 'X-CSRF-TOKEN': csrfToken } : {})
                },
                body
            });

            const contentType = res.headers.get('content-type') || '';
            const data = contentType.includes('application/json') ? await res.json() : await res.text();

            console.log('Submit Status:', res.status);
            console.log('Submit Response:', data);

            return { success: res.ok, status: res.status, data };
        } catch (error) {
            console.error('Submit error:', error);
            return { success: false, error: error.message };
        }
    }

    // Function to submit data for normal questions
    async function submitNormalData(timeSpent, tlScore, tnScore, maxScore) {
        const csrfToken =
            document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
            getCookie('XSRF-TOKEN') ||
            '';

        const correct = tnScore;
        const wrong = maxScore - correct;
        const score = correct;

        const body = new URLSearchParams({
            id_user: extractedData.id_user || '',
            id_cate: extractedData.id_cate || '',
            id_grade: extractedData.id_grade || '',
            id_courseware: extractedData.id_courseware || '',
            id_group: extractedData.id_group || '',
            id_school: extractedData.id_school || '',
            time_init: '',
            name_user: '',
            type_vip: extractedData.type_vip || '',
            time_spent: timeSpent.toString(),
            tl_score: tlScore.toString(),
            tn_score: tnScore.toString(),
            ended: '1',
            missed: '0',
            correct: correct.toString(),
            wrong: wrong.toString(),
            times: '0',
            score: score.toString(),
            max_score: maxScore.toString(),
            type_exam: '1',
            save_star: '1'
        });

        try {
            const res = await fetch('https://olm.vn/course/teacher-static', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    ...(csrfToken ? { 'X-CSRF-TOKEN': csrfToken } : {})
                },
                body
            });

            const contentType = res.headers.get('content-type') || '';
            const data = contentType.includes('application/json') ? await res.json() : await res.text();

            console.log('Normal Submit Status:', res.status);
            console.log('Normal Submit Response:', data);

            return { success: res.ok, status: res.status, data };
        } catch (error) {
            console.error('Normal Submit error:', error);
            return { success: false, error: error.message };
        }
    }

    // Function to create UI
    function createUI() {
        // Create toggle button
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'course-submitter-toggle';
        toggleBtn.textContent = '⚙';
        toggleBtn.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border: none;
            color: white;
            font-size: 24px;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            z-index: 999998;
            opacity: 0.3;
            transition: opacity 0.3s;
        `;
        toggleBtn.onmouseover = () => toggleBtn.style.opacity = '1';
        toggleBtn.onmouseout = () => toggleBtn.style.opacity = '0.3';

        // Create form container
        const container = document.createElement('div');
        container.id = 'course-submitter-ui';
        container.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            z-index: 999999;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            width: 320px;
            color: white;
            display: none;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid rgba(255,255,255,0.3);
        `;

        const title = document.createElement('h3');
        title.textContent = 'Gửi Dữ Liệu Khóa Học';
        title.style.cssText = `
            margin: 0;
            font-size: 18px;
            font-weight: 600;
        `;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 16px;
            transition: background 0.3s;
        `;
        closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(255,255,255,0.3)';
        closeBtn.onmouseout = () => closeBtn.style.background = 'rgba(255,255,255,0.2)';
        closeBtn.onclick = () => container.style.display = 'none';

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Tab navigation
        const tabNav = document.createElement('div');
        tabNav.style.cssText = `
            display: flex;
            gap: 8px;
            margin-bottom: 15px;
        `;

        const videoTab = document.createElement('button');
        videoTab.textContent = 'Video';
        videoTab.style.cssText = `
            flex: 1;
            padding: 8px 12px;
            border: none;
            border-radius: 6px;
            background: rgba(255,255,255,0.9);
            color: #667eea;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        `;

        const normalTab = document.createElement('button');
        normalTab.textContent = 'Câu Hỏi Thường';
        normalTab.style.cssText = `
            flex: 1;
            padding: 8px 12px;
            border: none;
            border-radius: 6px;
            background: rgba(255,255,255,0.2);
            color: white;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        `;

        tabNav.appendChild(videoTab);
        tabNav.appendChild(normalTab);

        // Video tab content
        const videoContent = document.createElement('div');
        videoContent.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 12px;
        `;

        const fields = [
            { id: 'score', label: 'Điểm số (0-100)', type: 'number', min: 0, max: 100, defaultValue: 100 },
            { id: 'count_problems', label: 'Số câu hỏi', type: 'number', min: 1, defaultValue: detectedTotalQuestions || 0 },
            { id: 'correct', label: 'Số câu đúng', type: 'number', min: 0, defaultValue: detectedTotalQuestions || 0 },
            { id: 'time_watched', label: 'Thời gian xem (giây)', type: 'number', min: 0, defaultValue: detectedTotalTime || 0 }
        ];

        const inputs = {};

        fields.forEach(field => {
            const fieldContainer = document.createElement('div');
            fieldContainer.style.cssText = `
                background: rgba(255,255,255,0.15);
                padding: 10px 12px;
                border-radius: 8px;
                backdrop-filter: blur(10px);
            `;

            const label = document.createElement('label');
            label.textContent = field.label;
            label.style.cssText = `
                display: block;
                font-size: 12px;
                margin-bottom: 6px;
                font-weight: 500;
            `;

            const input = document.createElement('input');
            input.type = field.type;
            input.id = field.id;
            if (field.min !== undefined) input.min = field.min;
            if (field.max !== undefined) input.max = field.max;
            input.value = field.defaultValue;
            input.style.cssText = `
                width: 100%;
                padding: 8px;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                background: rgba(255,255,255,0.9);
                box-sizing: border-box;
            `;

            inputs[field.id] = input;

            // Auto-adjust score when correct answers change
            if (field.id === 'correct' || field.id === 'count_problems') {
                input.addEventListener('input', () => {
                    const correct = parseInt(inputs.correct.value) || 0;
                    const total = parseInt(inputs.count_problems.value) || 1;
                    if (correct < total) {
                        inputs.score.value = Math.round((correct / total) * 100);
                    } else {
                        inputs.score.value = 100;
                    }
                });
            }

            fieldContainer.appendChild(label);
            fieldContainer.appendChild(input);
            videoContent.appendChild(fieldContainer);
        });

        // Normal Questions tab content
        const normalContent = document.createElement('div');
        normalContent.style.cssText = `
            display: none;
            flex-direction: column;
            gap: 12px;
        `;

        const normalFields = [
            { id: 'time_spent', label: 'Thời gian làm bài (giây)', type: 'number', min: 0, defaultValue: 0 },
            { id: 'tl_score', label: 'Số câu tự luận đúng', type: 'number', min: 0, defaultValue: 0 },
            { id: 'tn_score', label: 'Số câu đúng', type: 'number', min: 0, defaultValue: 0 },
            { id: 'max_score', label: 'Tổng số câu hỏi', type: 'number', min: 0, defaultValue: 0 }
        ];

        const normalInputs = {};

        normalFields.forEach(field => {
            const fieldContainer = document.createElement('div');
            fieldContainer.style.cssText = `
                background: rgba(255,255,255,0.15);
                padding: 10px 12px;
                border-radius: 8px;
                backdrop-filter: blur(10px);
            `;

            const label = document.createElement('label');
            label.textContent = field.label;
            label.style.cssText = `
                display: block;
                font-size: 12px;
                margin-bottom: 6px;
                font-weight: 500;
            `;

            const input = document.createElement('input');
            input.type = field.type;
            input.id = field.id;
            if (field.min !== undefined) input.min = field.min;
            if (field.max !== undefined) input.max = field.max;
            input.value = field.defaultValue;
            input.style.cssText = `
                width: 100%;
                padding: 8px;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                background: rgba(255,255,255,0.9);
                box-sizing: border-box;
            `;

            normalInputs[field.id] = input;

            // Auto-calculate derived values and add validation
            if (field.id === 'tn_score' || field.id === 'max_score') {
                input.addEventListener('input', () => {
                    const tnScore = parseInt(normalInputs.tn_score.value) || 0;
                    const maxScore = parseInt(normalInputs.max_score.value) || 1;
                    
                    // Ensure tn_score doesn't exceed max_score
                    if (field.id === 'tn_score' && tnScore > maxScore) {
                        normalInputs.tn_score.value = maxScore;
                        const adjustedTnScore = maxScore;
                        
                        // Update correct (same as tn_score)
                        if (normalInputs.correct) {
                            normalInputs.correct.value = adjustedTnScore;
                        }
                        
                        // Update wrong (max_score - correct)
                        if (normalInputs.wrong) {
                            normalInputs.wrong.value = Math.max(0, maxScore - adjustedTnScore);
                        }
                        
                        // Update score (same as correct)
                        if (normalInputs.score) {
                            normalInputs.score.value = adjustedTnScore;
                        }
                    } else {
                        // Update correct (same as tn_score)
                        if (normalInputs.correct) {
                            normalInputs.correct.value = tnScore;
                        }
                        
                        // Update wrong (max_score - correct)
                        if (normalInputs.wrong) {
                            normalInputs.wrong.value = Math.max(0, maxScore - tnScore);
                        }
                        
                        // Update score (same as correct)
                        if (normalInputs.score) {
                            normalInputs.score.value = tnScore;
                        }
                    }
                });
            }

            fieldContainer.appendChild(label);
            fieldContainer.appendChild(input);
            normalContent.appendChild(fieldContainer);
        });

        // Add hidden fields for derived values
        const hiddenFields = [
            { id: 'correct', value: 5 },
            { id: 'wrong', value: 5 },
            { id: 'score', value: 5 }
        ];

        hiddenFields.forEach(field => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.id = field.id;
            input.value = field.value;
            normalInputs[field.id] = input;
            normalContent.appendChild(input);
        });

        // Status message
        const statusMsg = document.createElement('div');
        statusMsg.style.cssText = `
            background: rgba(255,255,255,0.2);
            padding: 10px;
            border-radius: 8px;
            font-size: 12px;
            text-align: center;
            display: none;
        `;

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '🗑️ Xóa Bài Làm';
        deleteBtn.style.cssText = `
            background: rgba(255,0,0,0.3);
            border: none;
            color: white;
            padding: 12px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
            margin-top: 10px;
            transition: background 0.3s;
        `;
        deleteBtn.onmouseover = () => deleteBtn.style.background = 'rgba(255,0,0,0.5)';
        deleteBtn.onmouseout = () => deleteBtn.style.background = 'rgba(255,0,0,0.3)';
        deleteBtn.onclick = async () => {
            // Show confirmation dialog
            const confirmed = confirm('Bạn có chắc chắn muốn xóa bài làm hiện tại? Hành động này không thể hoàn tác.');
            if (!confirmed) return;

            deleteBtn.disabled = true;
            deleteBtn.textContent = 'Đang xóa...';
            statusMsg.textContent = '🗑️ Đang xóa bài làm...';
            statusMsg.style.display = 'block';
            statusMsg.style.background = 'rgba(255,255,255,0.2)';

            const result = await deleteWork();

            if (result.success) {
                statusMsg.textContent = '✓ Xóa bài làm thành công!';
                statusMsg.style.background = 'rgba(0,255,0,0.3)';

                // Clear form inputs
                Object.values(inputs).forEach(input => {
                    input.value = '';
                });

                // Reset to default values
                inputs.score.value = 100;
                inputs.count_problems.value = detectedTotalQuestions || 0;
                inputs.correct.value = detectedTotalQuestions || 0;
                inputs.time_watched.value = detectedTotalTime || 0;
            } else {
                statusMsg.textContent = '❌ Lỗi xóa: ' + (result.error || result.status);
                statusMsg.style.background = 'rgba(255,0,0,0.3)';
            }

            deleteBtn.disabled = false;
            deleteBtn.textContent = '🗑️ Xóa Bài Làm';
        };

        // Submit button
        const submitBtn = document.createElement('button');
        submitBtn.textContent = 'Gửi Dữ Liệu';
        submitBtn.style.cssText = `
            background: rgba(255,255,255,0.25);
            border: none;
            color: white;
            padding: 12px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
            margin-top: 10px;
            transition: background 0.3s;
        `;
        submitBtn.onmouseover = () => submitBtn.style.background = 'rgba(255,255,255,0.35)';
        submitBtn.onmouseout = () => submitBtn.style.background = 'rgba(255,255,255,0.25)';
        submitBtn.onclick = async () => {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Đang xóa dữ liệu cũ...';
            statusMsg.textContent = '🗑️ Xóa dữ liệu cũ...';
            statusMsg.style.display = 'block';
            statusMsg.style.background = 'rgba(255,255,255,0.2)';

            // Delete existing work first
            const deleteResult = await deleteWork();
            console.log('Delete result:', deleteResult);

            // Proceed to submit after delete completes
            submitBtn.textContent = 'Đang gửi...';
            statusMsg.textContent = '⏳ Đang gửi dữ liệu mới...';

            let result;

            if (currentTab === 'video') {
                const score = parseInt(inputs.score.value) || 100;
                const countProblems = parseInt(inputs.count_problems.value) || 10;
                const correct = parseInt(inputs.correct.value) || 10;
                const timeWatched = parseInt(inputs.time_watched.value) || 300;

                // Validate
                if (correct > countProblems) {
                    statusMsg.textContent = '❌ Số câu đúng không thể lớn hơn tổng số câu!';
                    statusMsg.style.display = 'block';
                    statusMsg.style.background = 'rgba(255,0,0,0.3)';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Gửi Dữ Liệu';
                    return;
                }

                result = await submitData(score, countProblems, correct, timeWatched);
            } else {
                const timeSpent = parseInt(normalInputs.time_spent.value) || 0;
                const tlScore = parseInt(normalInputs.tl_score.value) || 0;
                const tnScore = parseInt(normalInputs.tn_score.value) || 5;
                const maxScore = parseInt(normalInputs.max_score.value) || 10;

                // Validate
                if (tnScore > maxScore) {
                    statusMsg.textContent = '❌ Số câu đúng không thể lớn hơn tổng số câu!';
                    statusMsg.style.display = 'block';
                    statusMsg.style.background = 'rgba(255,0,0,0.3)';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Gửi Dữ Liệu';
                    return;
                }

                result = await submitNormalData(timeSpent, tlScore, tnScore, maxScore);
            }

            if (result.success) {
                statusMsg.textContent = '✓ Gửi thành công!';
                statusMsg.style.background = 'rgba(0,255,0,0.3)';

                // Redirect after 1 second
                setTimeout(() => {
                    window.location.href = "https://olm.vn/lop-hoc-cua-toi/#menu-lop-hoc-cua-toi";
                }, 1000);
            } else {
                statusMsg.textContent = '❌ Lỗi: ' + (result.error || result.status);
                statusMsg.style.background = 'rgba(255,0,0,0.3)';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Gửi Dữ Liệu';
            }
        };

        // Tab switching functionality
        let currentTab = 'video';
        
        videoTab.onclick = () => {
            currentTab = 'video';
            videoTab.style.background = 'rgba(255,255,255,0.9)';
            videoTab.style.color = '#667eea';
            normalTab.style.background = 'rgba(255,255,255,0.2)';
            normalTab.style.color = 'white';
            videoContent.style.display = 'flex';
            normalContent.style.display = 'none';
        };
        
        normalTab.onclick = () => {
            currentTab = 'normal';
            normalTab.style.background = 'rgba(255,255,255,0.9)';
            normalTab.style.color = '#667eea';
            videoTab.style.background = 'rgba(255,255,255,0.2)';
            videoTab.style.color = 'white';
            normalContent.style.display = 'flex';
            videoContent.style.display = 'none';
        };

        // Assemble UI
        container.appendChild(header);
        container.appendChild(tabNav);
        container.appendChild(videoContent);
        container.appendChild(normalContent);
        container.appendChild(statusMsg);
        container.appendChild(deleteBtn);
        container.appendChild(submitBtn);

        // Toggle functionality
        toggleBtn.onclick = async () => {
            container.style.display = container.style.display === 'none' ? 'block' : 'none';

            // Auto-detect questions if not already done when opening
            if (container.style.display === 'block' && !autoQuestionDetected) {
                const totalQuestions = await extractTotalQuestionsFromDocx();
                if (totalQuestions) {
                    detectedTotalQuestions = totalQuestions;
                    autoQuestionDetected = true;
                    updateQuestionsInput();
                }
            }
        };

        document.body.appendChild(toggleBtn);
        document.body.appendChild(container);

        // Auto-detect questions when UI is created
        setTimeout(async () => {
            if (!autoQuestionDetected) {
                const totalQuestions = await extractTotalQuestionsFromDocx();
                if (totalQuestions) {
                    detectedTotalQuestions = totalQuestions;
                    autoQuestionDetected = true;
                    updateQuestionsInput();
                    updateAutoQuestionsStatus();
                }
            }
        }, 1000);
    }

    // Function to update auto questions status (iOS compatible)
    function updateAutoQuestionsStatus() {
        // This function can be used to update UI status indicators
        // For iOS compatibility, we'll keep it simple
        console.log('Auto questions status updated:', detectedTotalQuestions);
    }

    // Initialize
    function init() {
            // Start monitoring network requests immediately
            monitorNetworkRequests();

            const data = extractData();
            if (data) {
                extractedData = data;
                console.log('Extracted data:', extractedData);
                createUI();
            } else {
                console.log('Failed to extract data, retrying...');
                        setTimeout(init, 1000);
        }
    }

    // Start when ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
