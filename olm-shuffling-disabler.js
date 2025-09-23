// ==UserScript==
// @name         OLM Shuffling Disabler
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Disable question shuffling by overriding _shuffle function
// @author       realdtn
// @match        *://*.olm.vn/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/realdtn2/realdtn/refs/heads/main/olm-shuffling-disabler.js
// @downloadURL  https://raw.githubusercontent.com/realdtn2/realdtn/refs/heads/main/olm-shuffling-disabler.js
// ==/UserScript==

(function() {
    'use strict';

    // Override the global _shuffle function to prevent shuffling
    window._shuffle = function(array) {
        console.log('Shuffling disabled - returning array as-is');
        return array; // Return the original array without shuffling
    };

    // Also ensure not_shuffle is set to true
    const originalInit = window.EXAM_UI?.init;
    if (originalInit) {
        window.EXAM_UI.init = function(config) {
            // Force not_shuffle to be true
            config.not_shuffle = 1;
            return originalInit.call(this, config);
        };
    }

    console.log('Question shuffling has been disabled');
})();
