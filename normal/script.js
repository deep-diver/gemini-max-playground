console.log("Script execution started.");
// --- Global Variables ---
let generatedCode = [];
let currentCleanedCode = [];

let evolutionTimeline = [];
let activeTimelineIndex = -1;
let selectedVariationGridIndex = -1;
let currentFullscreenHistoryIndex = -1;

let originalUserPromptForCurrentGeneration = '';
let lastPreviewUpdateTime = [];
let previewUpdateInterval = 500;
let numVariationsToGenerate = 4;
let activeApiControllers = [];

let lastGenerationConfig = {
    prompt: '',
    isRefinement: false,
    numVariations: 4,
    refinedTimelineIndex: -1,
    thinkingBudget: 0
};


// --- DOM Element References ---
let apiKeyEl, codeOutputEl, errorMessageEl;
let modelSelEl;
let selectButtons = [];
let fullscreenButtons = [];
let previewItems = [];

let refinementLoadingIndicator;
let mainContentEl, configButtonEl;
let intervalSliderEl, intervalValueDisplayEl;

let fullscreenOverlayEl, fullscreenIframeEl, exitFullscreenBtnEl;
let perspectiveViewportEl, previewGridWrapperEl;

let historyPanelEl, historyPanelPlaceholderEl;
let selectedCodeTitleH3El;
let mainContentTitleH1El, mainContentSubtitleH2El;
let fullscreenHistoryNavEl, historyNavPrevBtnEl, historyNavNextBtnEl;
let promptModalOverlayEl, promptModalContentEl, modalUserPromptEl, modalGenerateBtnEl, modalCancelBtnEl, modalLoadingIndicatorEl;
let modalRefinementCheckboxEl, numVariationsSliderEl, numVariationsValueDisplayEl;
let configModalOverlayEl, configModalContentEl, configModalCloseBtnEl, copyCodeButtonEl;
let historyToggleButtonEl, historyArrowDownEl, historyArrowUpEl;
let exportCodeButtonEl;
let newButtonEl;
let confirmModalOverlayEl, confirmModalMessageEl, confirmModalConfirmBtnEl, confirmModalCancelBtnEl;
let currentConfirmCallback = null;
let historyNavLeftBtnEl, historyNavRightBtnEl;
let modalThinkingBudgetSliderEl, modalThinkingBudgetValueDisplayEl;
let promptDisplayModalOverlayEl, promptDisplayModalContentEl, fullPromptTextEl, promptDisplayModalCloseBtnEl;
let showPromptModalButtonEl; // Added for the new button

// --- Elements for Initial Setup CTA ---
let initialSetupCtaEl;
let initialApiKeyInputEl;
let examplePromptsContainerEl;


// --- Constants ---
const API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';


// --- Helper Function to Process Stream for One Variation ---
async function processStreamForVariation(apiKey, prompt, variationIndex, modelName, signal) {
    console.log(`[Variation ${variationIndex + 1}] Starting generation with model ${modelName}...`);
    const previewFrame = document.getElementById(`preview-frame-${variationIndex + 1}`);
    const loader = document.getElementById(`preview-loader-${variationIndex + 1}`);
    const selectBtn = selectButtons[variationIndex];
    const fullscreenBtn = fullscreenButtons[variationIndex];

    const currentThinkingBudget = parseInt(lastGenerationConfig.thinkingBudget, 10);

    if (!previewFrame) { console.error(`[Variation ${variationIndex + 1}] Preview frame missing.`); return false; }
    if (!loader) { console.warn(`[Variation ${variationIndex + 1}] Loader missing.`); }


    if (loader) loader.classList.remove('hidden');
    if (selectBtn) selectBtn.disabled = true;
    if (fullscreenBtn) fullscreenBtn.disabled = true;

    if (previewFrame) updateLivePreviewInGrid(variationIndex, '<div class="flex items-center justify-center h-full"><p class="text-slate-500">Generating...</p></div>', false);
    if(lastPreviewUpdateTime[variationIndex] !== undefined) lastPreviewUpdateTime[variationIndex] = 0;


    const API_ENDPOINT = `${API_BASE_URL}${modelName}:streamGenerateContent?key=${apiKey}&alt=sse`;
    let rawGeneratedCode = '';
    let htmlBlockStarted = false;
    let accumulatedStreamData = '';
    let success = false;

    try {
        const requestBody = {
            contents: [{ parts: [{ text: prompt }] }]
        };

        if (currentThinkingBudget > 0) {
            requestBody.generationConfig = {
                thinkingConfig: {
                    thinkingBudget: currentThinkingBudget
                }
            };
            console.log(`[Variation ${variationIndex + 1}] Thinking Mode ENABLED. Budget: ${currentThinkingBudget}`);
        }

        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: signal
        });

        if (!response.ok) {
            let errorDetails = `HTTP Error: ${response.status} ${response.statusText}`;
            try { const errorData = await response.json(); errorDetails += ` - ${errorData?.error?.message || 'No msg.'}`; } catch (e) { /* Ignore */ }
            throw new Error(errorDetails);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            let eolIndex;
            while ((eolIndex = sseBuffer.indexOf('\n')) >= 0) {
                const line = sseBuffer.substring(0, eolIndex).trim();
                sseBuffer = sseBuffer.substring(eolIndex + 1);

                if (line.startsWith('data: ')) {
                    try {
                        const jsonData = JSON.parse(line.substring(5).trim());
                        if (jsonData.candidates?.[0]?.content?.parts?.[0]?.text) {
                            const textPart = jsonData.candidates[0].content.parts[0].text;

                            if (!htmlBlockStarted) {
                                accumulatedStreamData += textPart;
                                const marker = "```html";
                                const markerIndex = accumulatedStreamData.indexOf(marker);
                                if (markerIndex !== -1) {
                                    htmlBlockStarted = true;
                                    let codeStartIndex = markerIndex + marker.length;
                                    if (accumulatedStreamData[codeStartIndex] === '\n') {
                                        codeStartIndex++;
                                    }
                                    rawGeneratedCode = accumulatedStreamData.substring(codeStartIndex);
                                }
                            } else {
                                rawGeneratedCode += textPart;
                            }

                            if (htmlBlockStarted) {
                                const now = Date.now();
                                if (lastPreviewUpdateTime[variationIndex] !== undefined && (now - lastPreviewUpdateTime[variationIndex] >= previewUpdateInterval)) {
                                    updateLivePreviewInGrid(variationIndex, rawGeneratedCode, true);
                                    lastPreviewUpdateTime[variationIndex] = now;
                                }
                            }
                        }
                    } catch (e) { console.warn(`[Var ${variationIndex + 1}] JSON parse error:`, e, "Problematic Line:", line); }
                }
            }
        }

        console.log(`[Variation ${variationIndex + 1}] Streaming finished. HTML Block Started: ${htmlBlockStarted}. Raw content after marker: ${(rawGeneratedCode || "").substring(0, 200)}`);
        let finalExtractedHtml = null; 
        let processingErrorMessage = null; 

        if (htmlBlockStarted) {
            let tempHtml = rawGeneratedCode.trim();
            if (tempHtml.endsWith("```")) {
                tempHtml = tempHtml.substring(0, tempHtml.length - 3).trim();
            } else if (tempHtml.endsWith("```html")) {
                tempHtml = tempHtml.substring(0, tempHtml.length - 7).trim();
            }

            if (tempHtml.length > 0) {
                finalExtractedHtml = tempHtml;
                const minLength = 20;
                const hasStructuralTag = /<!DOCTYPE html|<html[^>]*>|<head[^>]*>|<body[^>]*>/i.test(finalExtractedHtml);
                const hasAnyTag = /<[a-zA-Z][^>]*>/.test(finalExtractedHtml);

                if (finalExtractedHtml.length >= minLength && (hasStructuralTag || hasAnyTag)) {
                    success = true;
                    console.log(`[Variation ${variationIndex + 1}] HTML validation SUCCEEDED.`);
                } else {
                    success = false; 
                    console.warn("[Variation " + (variationIndex + 1) + "] HTML validation FAILED (length: " + finalExtractedHtml.length + ", structural: " + hasStructuralTag + ", anyTag: " + hasAnyTag + "). Review content manually.");
                }
            } else { 
                processingErrorMessage = "// Error: No meaningful content found after '```html' marker.";
                console.warn(`[Variation ${variationIndex + 1}] ${processingErrorMessage}`);
                success = false;
            }
        } else { 
            processingErrorMessage = `// Error: '\`\`\`html' code block marker not found. Received:\n${(accumulatedStreamData || rawGeneratedCode || "").substring(0, 200)}`;
            console.warn(`[Variation ${variationIndex + 1}] ${processingErrorMessage}`);
            success = false;
        }

        if (success && finalExtractedHtml) {
            let processedHtml = finalExtractedHtml;
            const requiredHeadContent = `
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <script src="https://cdn.tailwindcss.com"><\\/script>
                        <link rel="preconnect" href="https://rsms.me/">
                        <link rel="stylesheet" href="https://rsms.me/inter/inter.css">
                        <style>
                        html { font-family: 'Inter', sans-serif; }
                        @supports (font-variation-settings: normal) {
                            html { font-family: 'Inter var', sans-serif; }
                        }
                        body {
                            background-color: #f8fafc; /* slate-50 */
                            color: #0f172a; /* slate-900 */
                            padding: 1rem;
                        }
                        </style>`; 

            if (!processedHtml.includes('<head>')) {
                processedHtml = `<head>${requiredHeadContent}</head><body>${processedHtml}</body>`;
            } else { 
                let tempRequired = "";
                if (!processedHtml.includes('cdn.tailwindcss.com')) tempRequired += `    <script src="https://cdn.tailwindcss.com"><\\/script>\\n`;
                if (!processedHtml.includes('inter.css')) tempRequired += `    <link rel="preconnect" href="https://rsms.me/">\\n    <link rel="stylesheet" href="https://rsms.me/inter/inter.css">\\n`;
                if (!processedHtml.includes("html { font-family: 'Inter', sans-serif; }")) { 
                    tempRequired += `    <style>\\n      html { font-family: 'Inter', sans-serif; }\\n      @supports (font-variation-settings: normal) { html { font-family: 'Inter var', sans-serif; } }\\n      body { background-color: #f8fafc; color: #0f172a; padding: 1rem; }\\n    </style>\\n`;
                }
                if (tempRequired) { 
                    processedHtml = processedHtml.replace(/<\/head>/i, `${tempRequired}</head>`);
                }
            }
            if(currentCleanedCode[variationIndex] !== undefined) currentCleanedCode[variationIndex] = processedHtml;

            const interactionScript = `<script>(function() { const VARIATION_INDEX = ${variationIndex}; })(); <\\/script>`;
            const bodyEndIndex = processedHtml.lastIndexOf('</body>');
            if(generatedCode[variationIndex] !== undefined) {
                generatedCode[variationIndex] = (bodyEndIndex !== -1)
                    ? processedHtml.slice(0, bodyEndIndex) + interactionScript + processedHtml.slice(bodyEndIndex)
                    : processedHtml + interactionScript;
            }
            updateLivePreviewInGrid(variationIndex, null, true);
        } else {
            generatedCode[variationIndex] = ''; 
            if (finalExtractedHtml) { 
                if(currentCleanedCode[variationIndex] !== undefined) currentCleanedCode[variationIndex] = finalExtractedHtml; 
                updateLivePreviewInGrid(variationIndex, finalExtractedHtml, false); 
            } else { 
                if(currentCleanedCode[variationIndex] !== undefined) currentCleanedCode[variationIndex] = processingErrorMessage; 
                updateLivePreviewInGrid(variationIndex, `<div class="p-4 text-red-400 font-medium">${processingErrorMessage.replace(/\\n/g, '<br>')}</div>`, false); 
            }
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log(`[Variation ${variationIndex + 1}] Fetch aborted.`);
            updateLivePreviewInGrid(variationIndex, `<div class="p-4 text-yellow-400 font-medium">Generation Cancelled.</div>`, false);
        } else {
            console.error(`[Variation ${variationIndex + 1}] Generation error:`, error);
            updateLivePreviewInGrid(variationIndex, `<div class="p-4 text-red-400 font-medium">Error: ${error.message}</div>`, false);
        }
        if(currentCleanedCode[variationIndex] !== undefined) currentCleanedCode[variationIndex] = `// Error: ${error.message}`;
        if(generatedCode[variationIndex] !== undefined) generatedCode[variationIndex] = '';
    } finally {
        const finalLoader = document.getElementById(`preview-loader-${variationIndex + 1}`);
        if (finalLoader) finalLoader.classList.add('hidden');
        if (selectBtn) selectBtn.disabled = !success; // Disable if not successful
        if (fullscreenBtn) fullscreenBtn.disabled = !success; // Disable if not successful
    }
    return success;
}

// --- Main Function to Generate Variations ---
async function generateVariations() {
    console.log("generateVariations called.");
    const userPrompt = modalUserPromptEl.value.trim();

    if (!apiKeyEl || !modalUserPromptEl || !modelSelEl || !previewGridWrapperEl || !modalGenerateBtnEl || !modalLoadingIndicatorEl || !errorMessageEl || !codeOutputEl) {
        console.error("Cannot generate variations: One or more critical elements are missing.");
        if (errorMessageEl) errorMessageEl.textContent = "Initialization error. Cannot generate.";
        return;
    }

    // Read API key: Prefer config modal, then initial input, then localStorage
    let apiKey = apiKeyEl.value.trim();
    if (!apiKey && initialApiKeyInputEl) {
        apiKey = initialApiKeyInputEl.value.trim();
    }
    if (!apiKey) {
        apiKey = localStorage.getItem('geminiApiKey') || '';
    }
    
    // Update input fields with the resolved API key
    if (apiKeyEl && apiKeyEl.value !== apiKey) apiKeyEl.value = apiKey;
    if (initialApiKeyInputEl && initialApiKeyInputEl.value !== apiKey) initialApiKeyInputEl.value = apiKey;


    const selectedModel = modelSelEl.value;
    const currentIsRefinementMode = modalRefinementCheckboxEl.checked;
    const currentNumVariations = parseInt(numVariationsSliderEl.value, 10);
    const currentThinkingBudget = parseInt(modalThinkingBudgetSliderEl.value, 10);

    if (!apiKey || !userPrompt) {
        errorMessageEl.textContent = 'Error: API Key and Prompt (via Alt+P) are required.';
        if (!apiKey && initialSetupCtaEl && initialSetupCtaEl.classList.contains('flex')) {
            if(initialApiKeyInputEl) initialApiKeyInputEl.focus();
        } else if (!userPrompt && !promptModalOverlayEl.classList.contains('visible')) {
            showPromptModal();
        }
        return;
    }
     if (!selectedModel) {
         errorMessageEl.textContent = 'Error: Please select a model.';
         return;
     }

    lastGenerationConfig = {
        prompt: userPrompt,
        isRefinement: currentIsRefinementMode,
        numVariations: currentNumVariations,
        refinedTimelineIndex: currentIsRefinementMode ? activeTimelineIndex : -1,
        thinkingBudget: currentThinkingBudget
    };


    errorMessageEl.textContent = '';
    console.log(`Mode: ${currentIsRefinementMode ? 'Refinement' : 'Initial'}, Model: ${selectedModel}, Variations: ${currentNumVariations}`);

    let baseCodeForRefinement = null;
    let contextPromptForRefinement = '';
    originalUserPromptForCurrentGeneration = userPrompt;

    if (currentIsRefinementMode && activeTimelineIndex !== -1 && evolutionTimeline[activeTimelineIndex]) {
        baseCodeForRefinement = evolutionTimeline[activeTimelineIndex].code;
        contextPromptForRefinement = evolutionTimeline[activeTimelineIndex].originalUserPrompt;
        console.log(`Refining Evolution ${activeTimelineIndex + 1}. Original context: "${contextPromptForRefinement}"`);
    } else if (currentIsRefinementMode) {
         errorMessageEl.textContent = 'Error: No active evolution selected to refine. Uncheck "refine" or select an evolution from history.';
         // Also hide the initial CTA if it's somehow visible
         if (initialSetupCtaEl) initialSetupCtaEl.classList.add('hidden');
         if (initialSetupCtaEl) initialSetupCtaEl.classList.remove('flex');
         if (previewGridWrapperEl) previewGridWrapperEl.classList.remove('hidden');
         return;
    }

    modalGenerateBtnEl.disabled = true;
    modalLoadingIndicatorEl.classList.remove('hidden');
    if (codeOutputEl && selectedCodeTitleH3El) {
        codeOutputEl.innerHTML = '<code class="language-html">// Select a variation to view its code.</code>';
        selectedCodeTitleH3El.textContent = "Selected Code:";
    }
    selectedVariationGridIndex = -1;

    numVariationsToGenerate = currentNumVariations;
    generatedCode = Array(numVariationsToGenerate).fill('');
    currentCleanedCode = Array(numVariationsToGenerate).fill('');
    lastPreviewUpdateTime = Array(numVariationsToGenerate).fill(0);
    selectButtons = Array(numVariationsToGenerate).fill(null);
    fullscreenButtons = Array(numVariationsToGenerate).fill(null);
    previewItems = Array(numVariationsToGenerate).fill(null);

    // Ensure correct layout state for generation
    if (initialSetupCtaEl) {
        initialSetupCtaEl.classList.remove('active-cta'); // Start hide animation
        // Hide example prompt buttons immediately or animate them out too
        if (examplePromptsContainerEl) {
            examplePromptsContainerEl.querySelectorAll('.example-prompt-button').forEach(btn => btn.classList.remove('visible'));
        }
        setTimeout(() => { // Wait for animation to roughly finish
            initialSetupCtaEl.style.display = 'none';
            initialSetupCtaEl.classList.remove('flex', 'flex-grow');
        }, 500); // Corresponds to CSS transition duration
    }
    if (mainContentEl) mainContentEl.classList.remove('justify-center-cta-active'); // Remove centering class from main-content
    if (perspectiveViewportEl) perspectiveViewportEl.classList.remove('hidden');
    // previewGridWrapperEl will be managed by showFourGridPreviewUI

    showFourGridPreviewUI();

    activeApiControllers = Array(numVariationsToGenerate).fill(null).map(() => new AbortController());

    const prompts = Array(numVariationsToGenerate).fill(null).map((_, i) => {
        if (currentIsRefinementMode && baseCodeForRefinement) {
            return `
You are an expert web developer specializing in HTML, Tailwind CSS, and JavaScript.
Original User Request (for context): "${contextPromptForRefinement}"
Base HTML Code to Refine:
\`\`\`html
${baseCodeForRefinement}
\`\`\`
User's Refinement Instructions: "${userPrompt}"
Instructions:
1. Analyze the Base Code and the User's Refinement Instructions.
2. Modify ONLY the necessary parts of the Base Code to implement the refinement.
3. This is Variation ${i + 1} of ${numVariationsToGenerate} attempting this refinement. Try a slightly different approach if possible.
4. Ensure the refined code remains a single, complete, runnable HTML document.
5. ALWAYS include Tailwind CSS CDN (<script src="https://cdn.tailwindcss.com"><\\/script>) and Inter font (<link rel="stylesheet" href="https://rsms.me/inter/inter.css">) in the <head>.
6. Add basic body styling for readability: <style>html { font-family: 'Inter', sans-serif; } body { background-color: #f8fafc; color: #0f172a; padding: 1rem; }</style>
7. Output ONLY the raw, complete, refined HTML code. Do NOT include explanations or markdown. Start your response with \`\`\`html.
Refined Code:`;
        } else {
            return `
You are an expert web developer specializing in clean, modern HTML, CSS (using Tailwind CSS classes), and JavaScript.
Generate the complete, runnable HTML code for the following request.
Ensure the code is self-contained.
1. ALWAYS include Tailwind CSS CDN (<script src="https://cdn.tailwindcss.com"><\\/script>) in the <head>.
2. ALWAYS include Inter font (<link rel="stylesheet" href="https://rsms.me/inter/inter.css">) and set html { font-family: 'Inter', sans-serif; } in a <style> tag in the <head>.
3. Add basic body styling for readability: body { background-color: #f8fafc; color: #0f172a; padding: 1rem; } in the same <style> tag.
4. Add HTML comments to explain the code.
5. This is Variation ${i + 1} of ${numVariationsToGenerate}. Try to make it distinct.
6. Output ONLY the raw HTML code. Do NOT include explanations or markdown. Start your response with \`\`\`html.
User Request:
"${originalUserPromptForCurrentGeneration}"
Code:`;
        }
    });

    const generationPromises = prompts.map((prompt, index) =>
        processStreamForVariation(apiKey, prompt, index, selectedModel, activeApiControllers[index].signal)
    );

    try {
        const results = await Promise.allSettled(generationPromises);
        console.log("Generation promises settled:", results);
        const successfulGenerations = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
        if (successfulGenerations === 0 && !results.some(r => r.status === 'rejected' && r.reason.name === 'AbortError')) {
            errorMessageElement.textContent = 'Error: All variations failed.';
        }
        else if (successfulGenerations < numVariationsToGenerate && !results.every(r => r.status === 'rejected' && r.reason.name === 'AbortError')) {
            errorMessageElement.textContent = `Warning: ${numVariationsToGenerate - successfulGenerations} var(s) failed or were cancelled.`;
        }

        updateMainContentTitles("Select a Variation", "Click 'Select' on a preview below.");

    } catch (error) {
        console.error("Parallel generation error:", error);
        errorMessageElement.textContent = `Unexpected Error: ${error.message}`;
        showInitialPreviewStateUI();
    } finally {
        modalGenerateBtnEl.disabled = false;
        modalLoadingIndicatorEl.classList.add('hidden');
        console.log("Generation process finished.");
    }
}

// --- UI Update Functions ---
function createPreviewItemDOM(index, isGridItem = true) {
    const item = document.createElement('div');
    item.id = `preview-item-${index + 1}`;
    item.className = isGridItem ? 'preview-item-perspective' : 'single-preview-item';
    if (isGridItem) item.dataset.variationGridIndex = index;

    const header = document.createElement('div'); header.className = 'preview-header';
    const title = document.createElement('span'); title.className = 'preview-header-title';
    title.textContent = isGridItem ? `Variation ${index + 1}` : (evolutionTimeline[activeTimelineIndex]?.prompt.substring(0,30) + '...' || `Evolution ${activeTimelineIndex + 1}`);
    header.appendChild(title);

    const btns = document.createElement('div'); btns.className = 'preview-header-buttons';

    const fsBtn = document.createElement('button');
    fsBtn.className = 'fullscreen-btn p-1 focus:outline-none focus:ring-1 focus:ring-cyan-500 rounded disabled:opacity-50';
    fsBtn.dataset.idx = index;
    fsBtn.title = 'Full Screen'; fsBtn.disabled = true;
    fsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
    fsBtn.addEventListener('click', (e) => {
        const idxToFullscreen = isGridItem ? parseInt(e.currentTarget.dataset.idx) : activeTimelineIndex;
        const fromHistory = !isGridItem;
        if (!isNaN(idxToFullscreen) && (isGridItem ? generatedCode[idxToFullscreen] : evolutionTimeline[idxToFullscreen]?.code)) {
            enterFullscreen(idxToFullscreen, fromHistory);
        }
    });

    btns.appendChild(fsBtn);

    if (isGridItem) {
        const selBtn = document.createElement('button');
        selBtn.className = 'select-variation-btn futuristic-button px-3 py-1 text-xs';
        selBtn.dataset.variationGridIndex = index; selBtn.disabled = true; selBtn.textContent = 'Select';
        selBtn.addEventListener('click', handleSelectVariationFromGrid);
        selectButtons[index] = selBtn;
        btns.appendChild(selBtn);
    }

    header.appendChild(btns);
    item.appendChild(header);

    const bodyEl = document.createElement('div'); bodyEl.className = 'preview-body';
    const loaderDiv = document.createElement('div'); loaderDiv.id = `preview-loader-${index + 1}`;
    loaderDiv.className = 'preview-loader ' + (isGridItem ? 'hidden' : '');
    loaderDiv.innerHTML = '<div class="spinner"></div>';
    bodyEl.appendChild(loaderDiv);

    const iframeEl = document.createElement('iframe');
    iframeEl.id = isGridItem ? `preview-frame-${index + 1}` : 'single-large-preview-frame';
    iframeEl.title = `Preview ${index + 1}`; iframeEl.className = 'preview-frame';
    iframeEl.srcdoc = '<div class="flex items-center justify-center h-full"><p class="text-slate-400">Preparing...</p></div>';
    bodyEl.appendChild(iframeEl);
    item.appendChild(bodyEl);

    if (isGridItem) {
        previewItems[index] = item;
        fullscreenButtons[index] = fsBtn;
    }
    return item;
}


function showFourGridPreviewUI() {
    previewGridWrapperEl.innerHTML = '';
    if (numVariationsToGenerate === 1) {
        previewGridWrapperEl.className = 'single-mode';
        if(perspectiveViewportEl) perspectiveViewportEl.style.perspective = 'none';
         const item = createPreviewItemDOM(0, true);
         previewGridWrapperEl.appendChild(item);

    } else if (numVariationsToGenerate === 2) {
        previewGridWrapperEl.className = 'grid grid-cols-2 grid-rows-1 gap-6';
        if(perspectiveViewportEl) perspectiveViewportEl.style.perspective = '1500px';
         for (let i = 0; i < numVariationsToGenerate; i++) {
            const item = createPreviewItemDOM(i, true);
            previewGridWrapperEl.appendChild(item);
        }
    } else {
         previewGridWrapperEl.className = 'grid-mode';
         if(perspectiveViewportEl) perspectiveViewportEl.style.perspective = '1500px';
         for (let i = 0; i < numVariationsToGenerate; i++) {
            const item = createPreviewItemDOM(i, true);
            previewGridWrapperEl.appendChild(item);
        }
    }
    updateSelectedGridItemUI();
}

function showSingleLargePreviewUI(htmlContent, titleText, fullPromptText) {
    previewGridWrapperEl.innerHTML = '';
    previewGridWrapperEl.className = 'single-mode';
     if(perspectiveViewportEl) perspectiveViewportEl.style.perspective = 'none';

    // Ensure correct layout state for single preview
    if (initialSetupCtaEl) {
        initialSetupCtaEl.classList.remove('active-cta');
        if (examplePromptsContainerEl) {
            examplePromptsContainerEl.querySelectorAll('.example-prompt-button').forEach(btn => btn.classList.remove('visible'));
        }
        setTimeout(() => {
            initialSetupCtaEl.style.display = 'none';
            initialSetupCtaEl.classList.remove('flex', 'flex-grow');
        }, 500);
    }
    if (mainContentEl) mainContentEl.classList.remove('justify-center-cta-active'); // Remove centering class from main-content
    if (perspectiveViewportEl) perspectiveViewportEl.classList.remove('hidden');
    if (previewGridWrapperEl) previewGridWrapperEl.classList.remove('hidden');

    const item = document.createElement('div');
    item.className = 'single-preview-item';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'preview-body';

    const iframeEl = document.createElement('iframe');
    iframeEl.id = `single-large-preview-frame`;
    iframeEl.title = titleText;
    iframeEl.className = 'preview-frame';
    iframeEl.srcdoc = htmlContent;

    bodyEl.appendChild(iframeEl);
    item.appendChild(bodyEl);
    previewGridWrapperEl.appendChild(item);

    // Handle subtitle truncation and clickability
    const maxPromptLength = 50;
    let displaySubtitle = fullPromptText;
    mainContentSubtitleH2El.classList.remove('prompt-truncated');
    delete mainContentSubtitleH2El.dataset.fullPrompt;

    if (fullPromptText && fullPromptText.length > maxPromptLength) {
        displaySubtitle = fullPromptText.substring(0, maxPromptLength) + "... (click to view full)";
        mainContentSubtitleH2El.classList.add('prompt-truncated');
        mainContentSubtitleH2El.dataset.fullPrompt = fullPromptText; // Store full prompt
    }

    updateMainContentTitles(titleText, displaySubtitle); // Use potentially truncated text
}

function showInitialPreviewStateUI() {
    // Hide the main preview grid and show the initial CTA
    if (previewGridWrapperEl) previewGridWrapperEl.classList.add('hidden');
    if (perspectiveViewportEl) perspectiveViewportEl.classList.add('hidden'); // Hide the whole viewport
    if (mainContentEl) mainContentEl.classList.add('justify-center-cta-active'); // Add centering class to main-content
    
    if (initialSetupCtaEl) {
        initialSetupCtaEl.style.display = 'flex'; // Set display before animation
        initialSetupCtaEl.classList.add('flex-grow');
        // Use requestAnimationFrame to ensure display:flex is applied before adding class for transition
        requestAnimationFrame(() => {
            initialSetupCtaEl.classList.add('active-cta');
        });
    }

    updateMainContentTitles("Welcome to Live Previews", "Set up your API Key or try an example below.");
    if (codeOutputEl) codeOutputEl.innerHTML = '<code class="language-html">// Select a variation or history item to view its code.</code>';
    if (selectedCodeTitleH3El) selectedCodeTitleH3El.textContent = "Selected Code:";
    selectedVariationGridIndex = -1;
    if (mainContentSubtitleH2El) {
        mainContentSubtitleH2El.classList.remove('prompt-truncated');
        delete mainContentSubtitleH2El.dataset.fullPrompt;
    }

    // Populate example prompts
    if (examplePromptsContainerEl) {
        examplePromptsContainerEl.innerHTML = ''; // Clear existing
        const prompts = [
            "A simple landing page for a new SaaS product.",
            "A responsive image gallery with a lightbox.",
            "A futuristic login form.",
            "A personal portfolio website with a blog section."
        ];
        prompts.forEach((promptText, index) => {
            const button = document.createElement('button');
            button.className = 'example-prompt-button';
            button.textContent = promptText;
            button.addEventListener('click', () => {
                if (modalUserPromptEl) modalUserPromptEl.value = promptText;
                showPromptModal();
            });
            examplePromptsContainerEl.appendChild(button);
            // Staggered animation for buttons
            setTimeout(() => {
                button.classList.add('visible');
            }, 300 + index * 120); // Delay after panel animation starts, then stagger
        });
    }
}

function updateMainContentTitles(title, subtitle) {
    if (mainContentTitleH1El) mainContentTitleH1El.textContent = title;
    if (mainContentSubtitleH2El) mainContentSubtitleH2El.textContent = subtitle;
}

function updateSelectedGridItemUI() {
    previewItems.forEach((item, index) => {
        if (!item) return;
        item.classList.toggle('selected', index === selectedVariationGridIndex);
    });
    selectButtons.forEach((button, index) => {
        if (!button) return;
        // Button enabled/disabled state is handled by procStream's success.
        // const hasCode = currentCleanedCode[index]?.length > 0 && !currentCleanedCode[index].startsWith("// Error");
        // button.disabled = !hasCode;
        // if (fullscreenButtons[index]) { fullscreenButtons[index].disabled = !hasCode; }

        button.classList.remove('selected-state');
        if (index === selectedVariationGridIndex) {
            button.textContent = 'Selected';
            button.classList.add('selected-state');
        } else {
            button.textContent = 'Select';
        }
    });
}

function updateLivePreviewInGrid(index, codeToRender = null, applyZoom = false) {
    let baseHtml = codeToRender !== null ? codeToRender : generatedCode[index];
    const frame = document.getElementById(`preview-frame-${index + 1}`);
    if (!frame) { console.warn(`[updateLivePreviewInGrid][Var ${index + 1}] Frame not found.`); return; }

    if (typeof baseHtml !== 'string') {
        baseHtml = '<div class="p-4 text-orange-500">Invalid content received</div>';
        applyZoom = false;
    }
    let finalHtml = baseHtml;
    try {
        if (applyZoom && numVariationsToGenerate > 1) {
            const scaleStyle = `<style>html { transform: scale(0.5); transform-origin: 0 0; width: 200%; height: 200%; overflow: auto !important; } body { overflow: visible !important; min-height: 100% !important; height: auto !important; width: auto !important; }</style>`;
            const headEndIndex = finalHtml.toLowerCase().lastIndexOf('</head>');
            if (headEndIndex !== -1) {
                finalHtml = finalHtml.slice(0, headEndIndex) + scaleStyle + finalHtml.slice(headEndIndex);
            } else {
                finalHtml = scaleStyle + finalHtml;
            }
        }
        frame.srcdoc = finalHtml;
    } catch (e) {
        console.error(`[Var ${index + 1}] Error setting srcdoc for grid:`, e);
        try {
            frame.srcdoc = `<div class="p-4 text-red-500 font-semibold">Preview Render Error</div>`;
        } catch (finalError) { console.error("Failed to display error in grid iframe:", finalError); }
    }
}

// --- Event Handlers ---
function handleSelectVariationFromGrid(event) {
    const idx = parseInt(event.target.dataset.variationGridIndex, 10);
     // Check if code for this variation is valid (not an error message)
    if (isNaN(idx) || !currentCleanedCode[idx] || currentCleanedCode[idx].startsWith("// Error")) {
        console.warn(`Cannot select variation ${idx + 1}, code is invalid or generation failed.`);
        return;
    }

    activeApiControllers.forEach((controller, controllerIndex) => {
        if (controllerIndex !== idx && controller) {
            console.log(`Aborting request for variation ${controllerIndex + 1}`);
            controller.abort();
        }
    });
    activeApiControllers = [];


    selectedVariationGridIndex = idx;
    const displayCode = generatedCode[idx];
    const storeCode = currentCleanedCode[idx];

    let originalPromptForThisEvolution;
    let parentTimelineIdx = null;

    const wasThisGenerationARefinement = lastGenerationConfig.isRefinement;
    const refinedIndexForThisGen = lastGenerationConfig.refinedTimelineIndex;

    if (wasThisGenerationARefinement && refinedIndexForThisGen !== -1 && evolutionTimeline[refinedIndexForThisGen]) {
        originalPromptForThisEvolution = evolutionTimeline[refinedIndexForThisGen].originalUserPrompt;
        parentTimelineIdx = refinedIndexForThisGen;
    } else {
        originalPromptForThisEvolution = originalUserPromptForCurrentGeneration;
    }

    const newHistoryEntry = {
        id: 'evo-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        prompt: originalUserPromptForCurrentGeneration,
        originalUserPrompt: originalPromptForThisEvolution,
        code: storeCode,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit'}),
        parentIndex: parentTimelineIdx
    };
    evolutionTimeline.push(newHistoryEntry);
    activeTimelineIndex = evolutionTimeline.length - 1;

    console.log(`Variation ${idx + 1} selected from grid. Added to timeline as Evolution ${activeTimelineIndex + 1}.`);

    renderHistoryPanel();
    showSingleLargePreviewUI(displayCode, `Evolution ${activeTimelineIndex + 1}: Active`, `Prompt: "${newHistoryEntry.prompt}"`);

    if (codeOutputEl) {
        codeOutputEl.textContent = storeCode;
        if (selectedCodeTitleH3El) selectedCodeTitleH3El.textContent = `Code (Evolution ${activeTimelineIndex + 1}):`;
        codeOutputEl.classList.remove('text-slate-200');
        codeOutputEl.classList.add('text-slate-400');
        if (codeOutputEl?.parentElement) { codeOutputEl.parentElement.scrollTop = 0; }
    }


    updateSelectedGridItemUI();
    updateHistoryNavigationButtons(); // Update nav buttons

    if(modalUserPromptEl) modalUserPromptEl.value = '';
    if(modalUserPromptEl) modalUserPromptEl.placeholder = `Refine Evolution ${activeTimelineIndex + 1}...`;
    if(modalRefinementCheckboxEl) modalRefinementCheckboxEl.checked = true;
}

function handleHistoryItemClick(timelineIdxToView) {
    if (timelineIdxToView < 0 || timelineIdxToView >= evolutionTimeline.length) {
        console.warn("Invalid history index clicked:", timelineIdxToView);
        return;
    }
    activeTimelineIndex = timelineIdxToView;
    const historyEntry = evolutionTimeline[activeTimelineIndex];

    console.log(`History item ${activeTimelineIndex + 1} selected.`);

    const displayCodeForHistory = historyEntry.code;

    showSingleLargePreviewUI(displayCodeForHistory, `Evolution ${activeTimelineIndex + 1}: Active (Historical)`, `Prompt: "${historyEntry.prompt}"`);

    if (codeOutputEl) {
        codeOutputEl.textContent = historyEntry.code;
        if (selectedCodeTitleH3El) selectedCodeTitleH3El.textContent = `Code (Evolution ${activeTimelineIndex + 1} - Historical):`;
        codeOutputEl.classList.remove('text-slate-200');
        codeOutputEl.classList.add('text-slate-400');
        if (codeOutputEl?.parentElement) { codeOutputEl.parentElement.scrollTop = 0; }
    }

    renderHistoryPanel();
    updateHistoryNavigationButtons(); // Update nav buttons

    if(modalUserPromptEl) modalUserPromptEl.value = '';
    if(modalUserPromptEl) modalUserPromptEl.placeholder = `Refine Evolution ${activeTimelineIndex + 1}...`;
    if(modalRefinementCheckboxEl) modalRefinementCheckboxEl.checked = true;
    selectedVariationGridIndex = -1;
    updateSelectedGridItemUI();
}


// --- Render History Panel ---
function createHistoryThumbnailDOM(entry, index) {
    const thumbItem = document.createElement('div');
    thumbItem.className = 'history-thumbnail-item group';
    thumbItem.dataset.timelineIndex = index;
    thumbItem.setAttribute('aria-label', `Evolution Step ${index + 1}: ${entry.prompt.substring(0, 30)}...`);

    // Note: Active class and dynamic transforms/z-index are applied in renderHistoryPanel

    const previewContainer = document.createElement('div');
    previewContainer.className = 'history-thumbnail-preview-container';
    previewContainer.title = `Click to view Evolution ${index + 1}`;
    previewContainer.addEventListener('click', () => handleHistoryItemClick(index));

    const iframe = document.createElement('iframe');
    iframe.className = 'history-thumbnail-preview';
    iframe.title = `Preview of Evolution ${index + 1}`;
    const scaledContent = `
                <style>
                    html { transform: scale(0.25); transform-origin: 0 0; width: 400%; height: 400%; overflow: hidden !important; background-color: #fff; }
                    body { width: 100%; height: 100%; overflow: hidden !important; padding: 0 !important; margin: 0 !important; }
                </style>
                ${entry.code}
            `;
    iframe.srcdoc = scaledContent;
    previewContainer.appendChild(iframe);

    const titleEl = document.createElement('div');
    titleEl.className = 'history-thumbnail-title';
    titleEl.textContent = `Evo ${index + 1}: ${entry.prompt.substring(0, 20)}${entry.prompt.length > 20 ? '...' : ''}`;
    titleEl.title = `Prompt: ${entry.prompt}\\nClick to view Evolution ${index + 1}`;
    titleEl.addEventListener('click', () => handleHistoryItemClick(index));

    const fsBtn = document.createElement('button');
    fsBtn.className = 'history-thumbnail-fullscreen-btn';
    fsBtn.title = 'View Fullscreen';
    fsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
    fsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        enterFullscreen(index, true);
    });

    thumbItem.appendChild(previewContainer);
    thumbItem.appendChild(titleEl);
    thumbItem.appendChild(fsBtn);
    return thumbItem;
}

function renderHistoryPanel() {
    if (!historyPanelEl || !historyPanelPlaceholderEl) return;
    historyPanelEl.innerHTML = ''; // Clear previous items

    if (evolutionTimeline.length === 0) {
        historyPanelEl.appendChild(historyPanelPlaceholderEl);
        historyPanelPlaceholderEl.classList.remove('hidden');
        return;
    }

    historyPanelPlaceholderEl.classList.add('hidden');

    const totalItems = evolutionTimeline.length;
    const middleIndex = Math.floor(totalItems / 2);
    // const maxRotation = 15; // Max rotation in degrees for edge items (rotation is now 0)
    const yOffsetFactor = 4; // How much non-active items lift towards the edges
    const zOffsetFactor = -15; // How much non-active items move back towards the edges
    const baseZIndex = 10; // Base z-index for non-active items

    // Define specific offsets for the active item to make it stand out
    const activeYOffset = -15; // Moves active item further up
    const activeZOffset = 25;  // Moves active item further forward

    evolutionTimeline.forEach((entry, index) => {
        const thumbItem = createHistoryThumbnailDOM(entry, index);
        let finalTransform;
        let finalZIndex;

        if (index === activeTimelineIndex) {
            thumbItem.classList.add('active-history-item');
            // Transform for the active item: more prominent
            finalTransform = `translateY(${activeYOffset}px) translateZ(${activeZOffset}px) rotate(0deg)`;
            // The .active-history-item class in CSS sets z-index: 50.
            // We can set it here too for consistency or rely on CSS.
            finalZIndex = 50; 
        } else {
            // Calculate transformations relative to the middle for non-active items
            const deltaFromMiddle = index - middleIndex;
            const rotation = 0; // Rotation is kept at 0
            const translateY = Math.abs(deltaFromMiddle) * yOffsetFactor;
            const translateZ = Math.abs(deltaFromMiddle) * zOffsetFactor;

            finalTransform = `translateY(${translateY}px) translateZ(${translateZ}px) rotate(${rotation}deg)`;
            finalZIndex = baseZIndex - Math.abs(deltaFromMiddle);
        }

        thumbItem.style.zIndex = `${finalZIndex}`;
        thumbItem.style.transform = finalTransform;

        historyPanelEl.appendChild(thumbItem);
    });
    const activeThumb = historyPanelEl.querySelector('.active-history-item');
    if (activeThumb) {
        // Keep scrollIntoView, maybe adjust behavior if needed
        activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
}

// --- Full Screen Logic ---
function enterFullscreen(index, isFromHistory = false) {
    if (!fullscreenIframeEl || !fullscreenOverlayEl || !document.body || !fullscreenHistoryNavEl || !historyNavPrevBtnEl || !historyNavNextBtnEl) {
        console.error("Cannot enter fullscreen: Overlay or nav elements missing.");
        return;
    }

    let codeToDisplay;
    currentFullscreenHistoryIndex = -1;
    fullscreenHistoryNavEl.classList.remove('visible');

    if (isFromHistory) {
        if (index < 0 || index >= evolutionTimeline.length || !evolutionTimeline[index]) {
             console.warn("Cannot enter fullscreen for history item", index); return;
        }
        codeToDisplay = evolutionTimeline[index].code;
        currentFullscreenHistoryIndex = index;

        fullscreenHistoryNavEl.classList.add('visible');
        historyNavPrevBtnEl.disabled = (currentFullscreenHistoryIndex <= 0);
        historyNavNextBtnEl.disabled = (currentFullscreenHistoryIndex >= evolutionTimeline.length - 1);

    } else {
         if (index < 0 || index >= numVariationsToGenerate || !generatedCode[index]) {
            console.warn("Cannot enter fullscreen for variation grid item", index); return;
         }
         codeToDisplay = generatedCode[index];
    }

    fullscreenIframeEl.srcdoc = codeToDisplay;
    fullscreenOverlayEl.classList.add('visible');
    document.body.classList.add('fullscreen-active');
    document.documentElement.style.overflow = 'hidden';
}
function exitFullscreen() {
    if (!fullscreenOverlayEl || !document.body || !fullscreenIframeEl || !fullscreenHistoryNavEl) {
        console.error("Cannot exit fullscreen: Overlay or nav elements missing.");
        return;
    }
    fullscreenOverlayEl.classList.remove('visible');
    document.body.classList.remove('fullscreen-active');
    document.documentElement.style.overflow = '';
    currentFullscreenHistoryIndex = -1;
    fullscreenHistoryNavEl.classList.remove('visible');
    setTimeout(() => { if (fullscreenIframeEl) fullscreenIframeEl.srcdoc = 'about:blank'; }, 300);
}

function showPreviousHistoryInFullscreen() {
    if (currentFullscreenHistoryIndex > 0) {
        currentFullscreenHistoryIndex--;
        activeTimelineIndex = currentFullscreenHistoryIndex;
        enterFullscreen(activeTimelineIndex, true);
        renderHistoryPanel();
        const historyEntry = evolutionTimeline[activeTimelineIndex];
        if (historyEntry && codeOutputEl) {
            codeOutputEl.textContent = historyEntry.code;
            if(selectedCodeTitleH3El) selectedCodeTitleH3El.textContent = `Code (Evolution ${activeTimelineIndex + 1} - Historical):`;
        }
    }
}

function showNextHistoryInFullscreen() {
    if (currentFullscreenHistoryIndex < evolutionTimeline.length - 1) {
        currentFullscreenHistoryIndex++;
        activeTimelineIndex = currentFullscreenHistoryIndex;
        enterFullscreen(activeTimelineIndex, true);
        renderHistoryPanel();
        const historyEntry = evolutionTimeline[activeTimelineIndex];
         if (historyEntry && codeOutputEl) {
            codeOutputEl.textContent = historyEntry.code;
            if(selectedCodeTitleH3El) selectedCodeTitleH3El.textContent = `Code (Evolution ${activeTimelineIndex + 1} - Historical):`;
        }
    }
}

// --- Prompt Modal Logic ---
function showPromptModal() {
    if (!promptModalOverlayEl || !modalUserPromptEl || !modalRefinementCheckboxEl || !numVariationsSliderEl || !modalThinkingBudgetSliderEl || !modalThinkingBudgetValueDisplayEl) return;

    modalRefinementCheckboxEl.checked = (activeTimelineIndex !== -1);
    numVariationsSliderEl.value = lastGenerationConfig.numVariations;
    if(numVariationsValueDisplayEl) numVariationsValueDisplayEl.textContent = numVariationsSliderEl.value;
    
    modalThinkingBudgetSliderEl.value = lastGenerationConfig.thinkingBudget;
    if(modalThinkingBudgetValueDisplayEl) modalThinkingBudgetValueDisplayEl.textContent = lastGenerationConfig.thinkingBudget;

    // Animation handling
    promptModalOverlayEl.classList.remove('modal-anim-fade-out');
    promptModalOverlayEl.style.display = 'flex'; // Or 'block' if that was its original display type
    promptModalOverlayEl.classList.add('modal-anim-fade-in');
    // promptModalOverlayEl.classList.add('visible'); // Keep this if it controls other things besides opacity/visibility

    modalUserPromptEl.focus();
}

function hidePromptModal() {
    if (!promptModalOverlayEl) return;

    promptModalOverlayEl.classList.remove('modal-anim-fade-in');
    promptModalOverlayEl.classList.add('modal-anim-fade-out');

    // Wait for animation to finish before hiding
    const handleAnimationEnd = () => {
        promptModalOverlayEl.style.display = 'none';
        // promptModalOverlayEl.classList.remove('visible'); // Keep this if it controls other things
        promptModalOverlayEl.removeEventListener('animationend', handleAnimationEnd);
    };
    promptModalOverlayEl.addEventListener('animationend', handleAnimationEnd);
}

function handleModalGenerate() {
    if (!modalUserPromptEl || !modalGenerateBtnEl) return;
    const modalPrompt = modalUserPromptEl.value.trim();
    if (modalPrompt) {
        hidePromptModal();
        if (!modalGenerateBtnEl.disabled) {
            generateVariations();
        }
    } else {
        console.warn("Modal prompt is empty. Not generating.");
    }
}

// --- Config Modal Logic ---
function showConfigModal() {
    if (!configModalOverlayEl) return;

    // Animation handling
    configModalOverlayEl.classList.remove('modal-anim-fade-out');
    configModalOverlayEl.style.display = 'flex'; // Or 'block'
    configModalOverlayEl.classList.add('modal-anim-fade-in');
    // configModalOverlayEl.classList.add('visible');
}
function hideConfigModal() {
    if (!configModalOverlayEl) return;

    configModalOverlayEl.classList.remove('modal-anim-fade-in');
    configModalOverlayEl.classList.add('modal-anim-fade-out');

    const handleAnimationEnd = () => {
        configModalOverlayEl.style.display = 'none';
        // configModalOverlayEl.classList.remove('visible');
        configModalOverlayEl.removeEventListener('animationend', handleAnimationEnd);
    };
    configModalOverlayEl.addEventListener('animationend', handleAnimationEnd);
}

// --- Confirmation Modal Logic ---
function showConfirmModal(message, onConfirmCallback) {
    if (!confirmModalOverlayEl || !confirmModalMessageEl || !confirmModalConfirmBtnEl || !confirmModalCancelBtnEl) {
        console.error("Confirmation modal elements not found!");
        // Fallback to default confirm if modal elements are missing
        if (confirm(message)) { 
            onConfirmCallback(); 
        }
        return;
    }

    confirmModalMessageEl.textContent = message;
    currentConfirmCallback = onConfirmCallback; // Store the callback

    // Clear previous listeners (important!)
    confirmModalConfirmBtnEl.replaceWith(confirmModalConfirmBtnEl.cloneNode(true));
    confirmModalCancelBtnEl.replaceWith(confirmModalCancelBtnEl.cloneNode(true));
    // Re-find buttons after cloning
    confirmModalConfirmBtnEl = document.getElementById('confirm-modal-confirm-button');
    confirmModalCancelBtnEl = document.getElementById('confirm-modal-cancel-button');

    // Add new listeners
    confirmModalConfirmBtnEl.addEventListener('click', handleConfirm); 
    confirmModalCancelBtnEl.addEventListener('click', hideConfirmModal);

    // Show modal with animation
    confirmModalOverlayEl.classList.remove('modal-anim-fade-out');
    confirmModalOverlayEl.style.display = 'flex'; 
    confirmModalOverlayEl.classList.add('modal-anim-fade-in');
}

function hideConfirmModal() {
    if (!confirmModalOverlayEl) return;

    confirmModalOverlayEl.classList.remove('modal-anim-fade-in');
    confirmModalOverlayEl.classList.add('modal-anim-fade-out');

    const handleAnimationEnd = () => {
        confirmModalOverlayEl.style.display = 'none';
        currentConfirmCallback = null; // Clear callback when hidden
        confirmModalOverlayEl.removeEventListener('animationend', handleAnimationEnd);
    };
    confirmModalOverlayEl.addEventListener('animationend', handleAnimationEnd);
}

function handleConfirm() {
    hideConfirmModal();
    if (typeof currentConfirmCallback === 'function') {
        currentConfirmCallback(); // Execute the stored callback
    }
    currentConfirmCallback = null; // Clear callback after execution
}

// --- History Navigation Logic ---
function navigateToPreviousHistory() {
    if (activeTimelineIndex > 0) {
        handleHistoryItemClick(activeTimelineIndex - 1);
    }
}

function navigateToNextHistory() {
    if (activeTimelineIndex < evolutionTimeline.length - 1) {
        handleHistoryItemClick(activeTimelineIndex + 1);
    }
}

function updateHistoryNavigationButtons() {
    if (!historyNavLeftBtnEl || !historyNavRightBtnEl) return;
    historyNavLeftBtnEl.disabled = activeTimelineIndex <= 0;
    historyNavRightBtnEl.disabled = activeTimelineIndex >= evolutionTimeline.length - 1;
}

// --- Helper function to call Gemini for code splitting ---
async function fetchCodeSplitFromGemini(apiKey, fullHtmlContent) {
    const exportModelName = "gemini-2.5-flash-preview-04-17"; // Hardcoded model for export
    const API_ENDPOINT = `${API_BASE_URL}${exportModelName}:generateContent?key=${apiKey}`;
    const prompt = `
You are an expert web developer. You are given a single HTML document that might contain inline CSS within <style> tags and inline JavaScript within <script> tags. Your task is to separate this document into three distinct components: HTML structure, CSS styles, and JavaScript code.

Follow these instructions carefully:
1.  **HTML Output**: This should be the main HTML structure. 
    *   If there were inline <style> tags, remove them. Add a <link rel="stylesheet" href="style.css"> in the <head> instead.
    *   If there were inline <script> tags (especially those not setting up initial variables or configurations that need to be in the head), try to move their content to what will become an external script.js file. Add <script src="script.js" defer><\\/script> before the closing </body> tag. For simple, short scripts that are clearly for page setup and are in the head, they can sometimes remain, but prefer externalizing functional code.
    *   Ensure the HTML output is clean and well-formed.
2.  **CSS Output**: This should contain ALL CSS rules extracted from any <style>...</style> blocks in the original HTML. If no <style> blocks were present, this should be an empty string or a comment indicating no CSS.
3.  **JavaScript Output**: This should contain ALL JavaScript code extracted from any <script>...</script> blocks (that are not JSON-LD or other non-executable script types). If no functional <script> blocks were present, this should be an empty string or a comment indicating no JavaScript.

Provide the output STRICTLY as a JSON object with the following keys: "html_code", "css_code", "js_code".

Example of desired JSON output format:
{
  "html_code": "<!DOCTYPE html>...<link rel=\\\"stylesheet\\\" href=\\\"style.css\\\"><script src=\\\"script.js\\\" defer><\\/script></body></html>",
  "css_code": "body { font-family: sans-serif; } ...",
  "js_code": "console.log(\\\'Hello World!\\\'); ...\"
}

Original HTML content:
\`\`\`html
${fullHtmlContent}\n\`\`\`

Return ONLY the JSON object. Do not include any other explanatory text or markdown formatting outside the JSON structure itself.
`;

    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            const errorMsg = errorData?.error?.message || `HTTP Error: ${response.status}`;
            console.error('Gemini API Error:', errorMsg);
            throw new Error(`API Error: ${errorMsg}`);
        }

        const responseData = await response.json();
        const candidate = responseData.candidates?.[0];
        if (candidate?.content?.parts?.[0]?.text) {
            let rawText = candidate.content.parts[0].text;
            console.log("Raw response from Gemini for splitting:", rawText); // Log the raw response

            let jsonString = null;

            // Attempt 1: Look for JSON within markdown code blocks
            const markdownJsonMatch = rawText.match(/```json\n(\{[\s\S]*\})\n```/s) || rawText.match(/```\n(\{[\s\S]*\})\n```/s);
            if (markdownJsonMatch && markdownJsonMatch[1]) {
                jsonString = markdownJsonMatch[1];
            } else {
                // Attempt 2: Fallback to existing regex if no markdown block found or it's malformed
                const directJsonMatch = rawText.match(/\{.*\}/s);
                if (directJsonMatch) {
                    jsonString = directJsonMatch[0];
                }
            }

            if (jsonString) {
                try {
                    return JSON.parse(jsonString);
                } catch (parseError) {
                    console.error("Failed to parse JSON string from model:", jsonString, parseError);
                    throw new Error("JSON parsing failed after attempting to clean model response."); // Simplified error
                }
            }
            throw new Error("Clean JSON object not found in model's response after attempting to extract.");
        }
        throw new Error("No valid content found in model's response.");

    } catch (error) {
        console.error('Error fetching or parsing split code:', error);
        throw error; // Re-throw to be caught by caller
    }
}

// --- Full Prompt Display Modal Logic ---
function showFullPromptModal(fullPrompt) {
    if (!promptDisplayModalOverlayEl || !fullPromptTextEl) return;

    fullPromptTextEl.textContent = fullPrompt;

    // Animation handling
    promptDisplayModalOverlayEl.classList.remove('modal-anim-fade-out');
    promptDisplayModalOverlayEl.style.display = 'flex';
    promptDisplayModalOverlayEl.classList.add('modal-anim-fade-in');
}

function hideFullPromptModal() {
    if (!promptDisplayModalOverlayEl) return;

    promptDisplayModalOverlayEl.classList.remove('modal-anim-fade-in');
    promptDisplayModalOverlayEl.classList.add('modal-anim-fade-out');

    const handleAnimationEnd = () => {
        promptDisplayModalOverlayEl.style.display = 'none';
        promptDisplayModalOverlayEl.removeEventListener('animationend', handleAnimationEnd);
    };
    promptDisplayModalOverlayEl.addEventListener('animationend', handleAnimationEnd);
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOMContentLoaded event fired.");

    apiKeyEl = document.getElementById('api-key');
    modelSelEl = document.getElementById('model-select');
    const codeOutputPre = document.getElementById('code-output');
    if (codeOutputPre) { codeOutputEl = codeOutputPre.querySelector('code'); } else { console.error("Code output <pre> not found");}
    errorMessageEl = document.getElementById('error-message');
    refinementLoadingIndicator = document.getElementById('refinement-loading-indicator');
    mainContentEl = document.getElementById('main-content');
    configButtonEl = document.getElementById('config-button');
    intervalSliderEl = document.getElementById('preview-interval-slider');
    intervalValueDisplayEl = document.getElementById('interval-value');
    fullscreenOverlayEl = document.getElementById('fullscreen-overlay');
    fullscreenIframeEl = document.getElementById('fullscreen-iframe');
    exitFullscreenBtnEl = document.getElementById('exit-fullscreen-btn');
    perspectiveViewportEl = document.getElementById('perspective-viewport');
    previewGridWrapperEl = document.getElementById('preview-grid-wrapper');
    historyPanelEl = document.getElementById('history-panel');
    historyPanelPlaceholderEl = document.getElementById('history-panel-placeholder');
    selectedCodeTitleH3El = document.getElementById('selected-code-title');
    mainContentTitleH1El = document.getElementById('main-content-title');
    mainContentSubtitleH2El = document.getElementById('main-content-subtitle');
    fullscreenHistoryNavEl = document.getElementById('fullscreen-history-nav');
    historyNavPrevBtnEl = document.getElementById('history-nav-prev');
    historyNavNextBtnEl = document.getElementById('history-nav-next');
    promptModalOverlayEl = document.getElementById('prompt-modal-overlay');
    promptModalContentEl = document.getElementById('prompt-modal-content');
    modalUserPromptEl = document.getElementById('modal-user-prompt');
    modalGenerateBtnEl = document.getElementById('modal-generate-button');
    modalCancelBtnEl = document.getElementById('modal-cancel-button');
    modalLoadingIndicatorEl = document.getElementById('modal-loading-indicator');
    modalRefinementCheckboxEl = document.getElementById('modal-refinement-checkbox');
    numVariationsSliderEl = document.getElementById('num-variations-slider');
    numVariationsValueDisplayEl = document.getElementById('num-variations-value');
    configModalOverlayEl = document.getElementById('config-modal-overlay');
    configModalContentEl = document.getElementById('config-modal-content');
    configModalCloseBtnEl = document.getElementById('config-modal-close-button');
    copyCodeButtonEl = document.getElementById('copy-code-button');
    exportCodeButtonEl = document.getElementById('export-code-button');
    historyToggleButtonEl = document.getElementById('history-toggle-button');
    historyArrowDownEl = document.getElementById('history-arrow-down');
    historyArrowUpEl = document.getElementById('history-arrow-up');
    newButtonEl = document.getElementById('new-button');
    confirmModalOverlayEl = document.getElementById('confirm-modal-overlay');
    confirmModalMessageEl = document.getElementById('confirm-modal-message');
    confirmModalConfirmBtnEl = document.getElementById('confirm-modal-confirm-button');
    confirmModalCancelBtnEl = document.getElementById('confirm-modal-cancel-button');
    historyNavLeftBtnEl = document.getElementById('history-nav-left-button');
    historyNavRightBtnEl = document.getElementById('history-nav-right-button');
    modalThinkingBudgetSliderEl = document.getElementById('modal-thinking-budget-slider');
    modalThinkingBudgetValueDisplayEl = document.getElementById('modal-thinking-budget-value');
    promptDisplayModalOverlayEl = document.getElementById('prompt-display-modal-overlay');
    promptDisplayModalContentEl = document.getElementById('prompt-display-modal-content');
    fullPromptTextEl = document.getElementById('full-prompt-text');
    promptDisplayModalCloseBtnEl = document.getElementById('prompt-display-modal-close-button');
    showPromptModalButtonEl = document.getElementById('show-prompt-modal-button'); // Added

    // --- Elements for Initial Setup CTA ---
    initialSetupCtaEl = document.getElementById('initial-setup-cta');
    initialApiKeyInputEl = document.getElementById('initial-api-key-input');
    examplePromptsContainerEl = document.getElementById('example-prompts-container');


    // --- Check if all required elements exist ---
    let missingElements = [];
    const requiredElements = { apiKeyEl, modelSelEl, codeOutputEl, errorMessageEl, refinementLoadingIndicator, mainContentEl, configButtonEl, intervalSliderEl, intervalValueDisplayEl, fullscreenOverlayEl, fullscreenIframeEl, exitFullscreenBtnEl, perspectiveViewportEl, previewGridWrapperEl, historyPanelEl, historyPanelPlaceholderEl, selectedCodeTitleH3El, mainContentTitleH1El, mainContentSubtitleH2El, fullscreenHistoryNavEl, historyNavPrevBtnEl, historyNavNextBtnEl, promptModalOverlayEl, promptModalContentEl, modalUserPromptEl, modalGenerateBtnEl, modalCancelBtnEl, modalLoadingIndicatorEl, modalRefinementCheckboxEl, numVariationsSliderEl, numVariationsValueDisplayEl, configModalOverlayEl, configModalContentEl, configModalCloseBtnEl, copyCodeButtonEl, exportCodeButtonEl, historyToggleButtonEl, historyArrowDownEl, historyArrowUpEl, newButtonEl, confirmModalOverlayEl, confirmModalMessageEl, confirmModalConfirmBtnEl, confirmModalCancelBtnEl, historyNavLeftBtnEl, historyNavRightBtnEl, modalThinkingBudgetSliderEl, modalThinkingBudgetValueDisplayEl, promptDisplayModalOverlayEl, promptDisplayModalContentEl, fullPromptTextEl, promptDisplayModalCloseBtnEl, showPromptModalButtonEl, initialSetupCtaEl, initialApiKeyInputEl, examplePromptsContainerEl }; // Added showPromptModalButtonEl
    for (const key in requiredElements) { if (!requiredElements[key]) { missingElements.push(key); } }

    if (missingElements.length > 0) {
        console.error("Initialization Error: Critical elements missing!", missingElements);
        if (document.body) { document.body.innerHTML = `<div class="fixed inset-0 bg-red-900 text-red-200 p-8 flex flex-col items-center justify-center text-center"><h2 class="text-2xl font-bold mb-4">Application Initialization Error</h2><p class="mb-2">Could not find element(s): ${missingElements.join(', ')}.</p><p>Please ensure the HTML structure is correct.</p></div>`; }
        else { alert(`Initialization Error: Critical elements missing: ${missingElements.join(', ')}.`); }
        return;
    }

    // --- Initial UI Setup ---
    showInitialPreviewStateUI();
    renderHistoryPanel();
    updateHistoryNavigationButtons(); // Initial button state

    // --- Event Listeners ---
    if (newButtonEl) {
        newButtonEl.addEventListener('click', () => {
            showConfirmModal(
                'Start a new session? This will clear the current state.', 
                () => { location.reload(); } // Pass the reload logic as the callback
            );
        });
    }

    if (configButtonEl) configButtonEl.addEventListener('click', showConfigModal);
    if (showPromptModalButtonEl) showPromptModalButtonEl.addEventListener('click', showPromptModal); // Added listener for new button
    if (configModalCloseBtnEl) configModalCloseBtnEl.addEventListener('click', hideConfigModal);
    if (configModalOverlayEl) configModalOverlayEl.addEventListener('click', (e) => {
        if (e.target === configModalOverlayEl) { hideConfigModal(); }
    });

    if (exitFullscreenBtnEl) exitFullscreenBtnEl.addEventListener('click', exitFullscreen);
    if (historyNavPrevBtnEl) historyNavPrevBtnEl.addEventListener('click', showPreviousHistoryInFullscreen);
    if (historyNavNextBtnEl) historyNavNextBtnEl.addEventListener('click', showNextHistoryInFullscreen);

    if (modalGenerateBtnEl) modalGenerateBtnEl.addEventListener('click', handleModalGenerate);
    if (modalCancelBtnEl) modalCancelBtnEl.addEventListener('click', hidePromptModal);
    if (promptModalOverlayEl) promptModalOverlayEl.addEventListener('click', (e) => {
        if (e.target === promptModalOverlayEl) { hidePromptModal(); }
    });
    if (confirmModalOverlayEl) { // Add overlay click listener for confirm modal
        confirmModalOverlayEl.addEventListener('click', (e) => {
            if (e.target === confirmModalOverlayEl) { hideConfirmModal(); }
        });
    }
    if (promptDisplayModalOverlayEl) { // Listener for full prompt display modal overlay click
        promptDisplayModalOverlayEl.addEventListener('click', (e) => {
            if (e.target === promptDisplayModalOverlayEl) { hideFullPromptModal(); }
        });
    }
    if (promptDisplayModalCloseBtnEl) { // Listener for full prompt display modal close button
        promptDisplayModalCloseBtnEl.addEventListener('click', hideFullPromptModal);
    }
    if (mainContentSubtitleH2El) { // Listener for clicking the subtitle
        mainContentSubtitleH2El.addEventListener('click', (e) => {
            const fullPrompt = e.target.dataset.fullPrompt;
            if (fullPrompt) { // Check if the data attribute exists (meaning it was truncated)
                showFullPromptModal(fullPrompt);
            }
        });
    }
     if (modalUserPromptEl) modalUserPromptEl.addEventListener('keydown', (event) => {
         if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
             event.preventDefault(); handleModalGenerate();
         }
     });
    if (numVariationsSliderEl) {
        numVariationsSliderEl.addEventListener('input', (event) => {
            if(numVariationsValueDisplayEl) numVariationsValueDisplayEl.textContent = event.target.value;
        });
        if(numVariationsValueDisplayEl) numVariationsValueDisplayEl.textContent = numVariationsSliderEl.value;
    }

    if (modalThinkingBudgetSliderEl) {
        modalThinkingBudgetSliderEl.addEventListener('input', (event) => {
            if(modalThinkingBudgetValueDisplayEl) modalThinkingBudgetValueDisplayEl.textContent = event.target.value;
        });
        if(modalThinkingBudgetValueDisplayEl) modalThinkingBudgetValueDisplayEl.textContent = modalThinkingBudgetSliderEl.value;
    }

    if (intervalSliderEl) {
        intervalSliderEl.addEventListener('input', (event) => {
            previewUpdateInterval = parseInt(event.target.value, 10);
            if(intervalValueDisplayEl) intervalValueDisplayEl.textContent = previewUpdateInterval;
        });
        previewUpdateInterval = parseInt(intervalSliderEl.value, 10);
        if(intervalValueDisplayEl) intervalValueDisplayEl.textContent = previewUpdateInterval;
    }

    if (copyCodeButtonEl) {
        copyCodeButtonEl.addEventListener('click', () => {
            if (codeOutputEl && codeOutputEl.textContent && codeOutputEl.textContent !== '// Select a variation or history item to view its code.') {
                const textToCopy = codeOutputEl.textContent;
                const textArea = document.createElement("textarea");
                textArea.value = textToCopy;
                textArea.style.position = "fixed"; // Prevent scrolling to bottom
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    const successful = document.execCommand('copy');
                    if (successful) {
                        const originalText = copyCodeButtonEl.innerHTML;
                        copyCodeButtonEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check inline-block mr-1"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!`;
                        copyCodeButtonEl.classList.add('copied');
                        setTimeout(() => {
                            copyCodeButtonEl.innerHTML = originalText;
                            copyCodeButtonEl.classList.remove('copied');
                        }, 2000);
                    } else {
                        console.error('Fallback: Failed to copy code using execCommand.');
                    }
                } catch (err) {
                    console.error('Fallback: Error copying code using execCommand: ', err);
                }
                document.body.removeChild(textArea);
            }
        });
    }

    if (exportCodeButtonEl) {
        exportCodeButtonEl.addEventListener('click', async () => {
            const currentCode = codeOutputEl?.textContent;
            const apiKey = apiKeyEl?.value;

            if (!currentCode || currentCode.startsWith('//') || currentCode.trim() === '') {
                alert('No code selected or available to export.');
                return;
            }
            if (!apiKey) {
                alert('API Key is missing. Please configure it in settings.');
                showConfigModal(); // Show config modal if API key is missing
                return;
            }
            if (typeof JSZip === 'undefined') {
                alert('JSZip library is not loaded. Export cannot proceed.');
                console.error("JSZip is not defined!");
                return;
            }

            const originalButtonContent = exportCodeButtonEl.innerHTML;
            exportCodeButtonEl.disabled = true;
            exportCodeButtonEl.innerHTML = '<svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Exporting...';

            try {
                const splitCode = await fetchCodeSplitFromGemini(apiKey, currentCode);
                
                if (!splitCode || typeof splitCode.html_code === 'undefined' || typeof splitCode.css_code === 'undefined' || typeof splitCode.js_code === 'undefined') {
                    throw new Error('Invalid response structure from code splitting model.');
                }

                const zip = new JSZip();
                zip.file("index.html", splitCode.html_code);
                zip.file("style.css", splitCode.css_code);
                zip.file("script.js", splitCode.js_code);

                const zipBlob = await zip.generateAsync({ type: "blob" });
                
                const downloadLink = document.createElement('a');
                downloadLink.href = URL.createObjectURL(zipBlob);
                downloadLink.download = "exported_code.zip";
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
                URL.revokeObjectURL(downloadLink.href); 

                exportCodeButtonEl.innerHTML = originalButtonContent;

            } catch (error) {
                console.error("Export failed:", error);
                alert(`Export failed: ${error.message}`);
                exportCodeButtonEl.innerHTML = originalButtonContent;
            } finally {
                exportCodeButtonEl.disabled = false;
            }
        });
    }

    if (historyToggleButtonEl && historyPanelEl && historyArrowDownEl && historyArrowUpEl) {
        historyToggleButtonEl.addEventListener('click', () => {
            const isCollapsed = historyPanelEl.classList.toggle('history-collapsed');
            const rootStyles = getComputedStyle(document.documentElement);
            const expandedHeight = rootStyles.getPropertyValue('--history-panel-expanded-height').trim();
            const collapsedHeight = rootStyles.getPropertyValue('--history-panel-collapsed-height').trim();

            if (isCollapsed) {
                document.documentElement.style.setProperty('--history-panel-current-height', collapsedHeight);
                historyArrowDownEl.classList.add('hidden');
                historyArrowUpEl.classList.remove('hidden');
            } else {
                document.documentElement.style.setProperty('--history-panel-current-height', expandedHeight);
                historyArrowDownEl.classList.remove('hidden');
                historyArrowUpEl.classList.add('hidden');
                // Ensure content is visible if re-expanding and it was set to display:none directly
                // This is now handled by the .history-collapsed CSS rule for children.
                 renderHistoryPanel(); // Re-render to ensure items are correctly displayed if they were hidden
            }
        });
    }

    if (historyNavLeftBtnEl) {
        historyNavLeftBtnEl.addEventListener('click', navigateToPreviousHistory);
    }
    if (historyNavRightBtnEl) {
        historyNavRightBtnEl.addEventListener('click', navigateToNextHistory);
    }

    // Keyboard Shortcuts Listener
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            // Check style.display instead of .visible class for animated modals
            if (configModalOverlayEl.style.display !== 'none' && !configModalOverlayEl.classList.contains('modal-anim-fade-out')) {
                hideConfigModal();
            } else if (promptModalOverlayEl.style.display !== 'none' && !promptModalOverlayEl.classList.contains('modal-anim-fade-out')) {
                 hidePromptModal();
            } else if (confirmModalOverlayEl.style.display !== 'none' && !confirmModalOverlayEl.classList.contains('modal-anim-fade-out')) { // Add Escape handler for confirm modal
                 hideConfirmModal();
            } else if (promptDisplayModalOverlayEl.style.display !== 'none' && !promptDisplayModalOverlayEl.classList.contains('modal-anim-fade-out')) { // Add Escape handler for prompt display modal
                 hideFullPromptModal();
            } else if (document.body.classList.contains('fullscreen-active')) {
                exitFullscreen();
            }
        }
        const targetTagName = event.target ? event.target.tagName.toLowerCase() : null;
        const isTypingInInputOrTextarea = targetTagName === 'input' || targetTagName === 'textarea';

        if (document.body.classList.contains('fullscreen-active') && currentFullscreenHistoryIndex !== -1 && !isTypingInInputOrTextarea) {
            if (event.key.toLowerCase() === 'w') {
                event.preventDefault();
                showPreviousHistoryInFullscreen();
            } else if (event.key.toLowerCase() === 'd') {
                event.preventDefault();
                showNextHistoryInFullscreen();
            }
        }
        if (event.altKey && !isTypingInInputOrTextarea) {
            if (event.key.toLowerCase() === 'p' || event.code === 'KeyP') {
                event.preventDefault();
                if (!promptModalOverlayEl.classList.contains('visible') && !configModalOverlayEl.classList.contains('visible')) {
                     showPromptModal();
                }
            }
            else if (event.key.toLowerCase() === 'j' || event.code === 'KeyJ') {
                event.preventDefault();
                if (lastGenerationConfig.prompt) {
                    console.log("Alt+R: Regenerating with last settings:", lastGenerationConfig);
                    modalUserPromptEl.value = lastGenerationConfig.prompt;
                    modalRefinementCheckboxEl.checked = lastGenerationConfig.isRefinement;
                    numVariationsSliderEl.value = lastGenerationConfig.numVariations;
                    if(numVariationsValueDisplayEl) numVariationsValueDisplayEl.textContent = numVariationsSliderEl.value;
                    modalThinkingBudgetSliderEl.value = lastGenerationConfig.thinkingBudget;
                    if(modalThinkingBudgetValueDisplayEl) modalThinkingBudgetValueDisplayEl.textContent = lastGenerationConfig.thinkingBudget;

                    if (lastGenerationConfig.isRefinement) {
                        activeTimelineIndex = lastGenerationConfig.refinedTimelineIndex;
                    }
                    handleModalGenerate();
                } else {
                    console.log("Alt+R: No last generation settings found. Opening prompt modal.");
                    showPromptModal();
                }
            }
            else if (event.key.toLowerCase() === 'o' || event.code === 'KeyO') {
                event.preventDefault();
                 if (!configModalOverlayEl.classList.contains('visible') && !promptModalOverlayEl.classList.contains('visible')) {
                    showConfigModal();
                }
            }
            // History navigation shortcuts (non-fullscreen)
            if (event.key === 'PageUp') {
                event.preventDefault();
                navigateToPreviousHistory();
            } else if (event.key === 'PageDown') {
                event.preventDefault();
                navigateToNextHistory();
            }
        }
    });
    console.log("Initialization setup complete.");
}); 
