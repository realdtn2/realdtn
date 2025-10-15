// ==UserScript==
// @name         Course Data Submitter
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Submit course data with custom scores and auto time/question detection
// @author       You
// @match        https://olm.vn/*
// @grant        none
// @run-at       document-end
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// ==/UserScript==

(function() {
    'use strict';

    console.log('Course Data Submitter loaded');

    let extractedData = {};
    let autoTimeDetected = false;
    let detectedTotalTime = null;
    let autoQuestionDetected = false;
    let detectedTotalQuestions = null;

    // Monitor network requests for teacher-static
    function monitorNetworkRequests() {
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

        // Also override XMLHttpRequest for completeness
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

    // Function to fetch docx file and extract total questions
    async function extractTotalQuestionsFromDocx() {
        try {
            const idCategory = extractIdCategory();
            const url = `https://olm.vn/download-word-for-user?id_cate=${idCategory}&showAns=1&questionNotApproved=0`;

            console.log('Fetching DOCX file to extract questions...');
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
                credentials: 'same-origin'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            const fileUrl = result.file;
            console.log('DOCX file URL:', fileUrl);

            // Fetch the actual DOCX file
            const docxResponse = await fetch(fileUrl);
            if (!docxResponse.ok) {
                throw new Error(`Failed to fetch DOCX file: ${docxResponse.status}`);
            }

            const arrayBuffer = await docxResponse.arrayBuffer();

            // Parse DOCX with JSZip
            const zip = new JSZip();
            const docx = await zip.loadAsync(arrayBuffer);

            // Extract document.xml
            const documentFile = docx.file('word/document.xml');
            if (!documentFile) {
                throw new Error('No document.xml found in DOCX file');
            }

            const documentXml = await documentFile.async('text');

            // Extract all text content from the document
            const textContent = extractTextFromDocx(documentXml);
            console.log('Extracted text content length:', textContent.length);

            // Find the last question number by reading backwards
            const totalQuestions = findLastQuestionNumber(textContent);
            console.log('Detected total questions:', totalQuestions);

            return totalQuestions;

        } catch (error) {
            console.error('Error extracting questions from DOCX:', error);
            return null;
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
        console.log('Searching for last question in text...');

        // Split text into words and reverse to read from end
        const words = textContent.split(/\s+/).filter(word => word.trim());

        // Read backwards to find the last question pattern
        for (let i = words.length - 1; i >= 0; i--) {
            const word = words[i];

            // Look for patterns like "Question 8.", "Câu 8.", "Bài 8.", etc.
            const questionMatch = word.match(/(?:Question|Câu|Bài|Câu hỏi|Bài tập)\s*(\d+)/i);
            if (questionMatch) {
                const questionNum = parseInt(questionMatch[1]);
                console.log(`Found question pattern: "${word}" -> number: ${questionNum}`);
                return questionNum;
            }

            // Also look for standalone numbers that might be question numbers
            // Check if this could be a question number followed by punctuation
            if (i > 0) {
                const currentWord = words[i].replace(/[.,;:!?]/g, '');
                const prevWord = words[i-1];

                // Check if previous word indicates this is a question number
                if (/^\d+$/.test(currentWord) &&
                    /(?:Question|Câu|Bài|Câu hỏi|Bài tập)/i.test(prevWord)) {
                    const questionNum = parseInt(currentWord);
                    console.log(`Found question pattern: "${prevWord} ${currentWord}" -> number: ${questionNum}`);
                    return questionNum;
                }
            }

            // Look for Vietnamese question patterns
            const vietnameseMatch = word.match(/(?:câu|bài)\s*(\d+)/i);
            if (vietnameseMatch) {
                const questionNum = parseInt(vietnameseMatch[1]);
                console.log(`Found Vietnamese question pattern: "${word}" -> number: ${questionNum}`);
                return questionNum;
            }
        }

        // Alternative method: look for all question numbers and take the highest
        const allQuestionNumbers = [];
        const questionRegex = /(?:Question|Câu|Bài|Câu hỏi|Bài tập)\s*(\d+)/gi;
        let match;

        while ((match = questionRegex.exec(textContent)) !== null) {
            const num = parseInt(match[1]);
            if (!isNaN(num)) {
                allQuestionNumbers.push(num);
            }
        }

        if (allQuestionNumbers.length > 0) {
            const maxQuestion = Math.max(...allQuestionNumbers);
            console.log(`Found ${allQuestionNumbers.length} question numbers, highest is: ${maxQuestion}`);
            return maxQuestion;
        }

        console.log('No question pattern found in document');
        return null;
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
        showNotification(`⏱️ Đã tự động phát hiện thời gian: ${time} giây`, '#4CAF50');
    }

    // Function to show auto-questions detection notification
    function showAutoQuestionsNotification(questions) {
        showNotification(`❓ Đã tự động phát hiện: ${questions} câu hỏi`, '#2196F3');
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

            // Clear local storage if possible
            try {
                if (window.CATE_UI) {
                    CATE_UI.delLocalRecord("data");
                    CATE_UI.delLocalRecord("time_spent");
                    CATE_UI.delLocalRecord("time_init");
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

    // Function to submit data
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

        const comingSoonTab = document.createElement('button');
        comingSoonTab.textContent = 'Sắp có...';
        comingSoonTab.style.cssText = `
            flex: 1;
            padding: 8px 12px;
            border: none;
            border-radius: 6px;
            background: rgba(255,255,255,0.2);
            color: white;
            font-weight: 600;
            cursor: not-allowed;
            opacity: 0.6;
        `;

        tabNav.appendChild(videoTab);
        tabNav.appendChild(comingSoonTab);

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
            const score = parseInt(inputs.score.value) || 100;
            const countProblems = parseInt(inputs.count_problems.value) || 10;
            const correct = parseInt(inputs.correct.value) || 10;
            const timeWatched = parseInt(inputs.time_watched.value) || 300;

            // Validate
            if (correct > countProblems) {
                statusMsg.textContent = '❌ Số câu đúng không thể lớn hơn tổng số câu!';
                statusMsg.style.display = 'block';
                statusMsg.style.background = 'rgba(255,0,0,0.3)';
                return;
            }

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

            const result = await submitData(score, countProblems, correct, timeWatched);

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

        // Assemble UI
        container.appendChild(header);
        container.appendChild(tabNav);
        container.appendChild(videoContent);
        container.appendChild(statusMsg);
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
