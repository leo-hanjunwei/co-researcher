/* eslint-disable no-alert, no-console */
/* global chrome, marked */
let pane = null;
let host = null;
let activeSpinnerCount = 0;
let globalStopSpinner = null;
let floatingBall = null;
let cleanupFns = [];
let isMinimized = false;
const SESSION_KEY = "ask_gena_session_v1";
let tabCounter = 1;
const tabs = {};
const tabOrder = [];
let currentTabIndex = -1;
let chatMemoryEnabled = false;

// === Merge session updates across tabs ===
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SESSION_KEY]) return;

  const { newValue } = changes[SESSION_KEY];
  if (!newValue) return;

  Object.assign(tabs, newValue.tabs);
  tabOrder.length = 0;
  tabOrder.push(...newValue.tabOrder);
  tabCounter = Math.max(tabCounter, newValue.tabCounter || 1);
  currentTabIndex = newValue.currentTabIndex ?? -1;

  if (tabOrder[currentTabIndex]) {
    renderTab(tabOrder[currentTabIndex]);
  }
});


// ===== Global key-blocker to stop host site from responding to input =====
const OUR_KEYS = new Set([
  'arrowup',
  'arrowdown',
  'enter',
  'h',
  'j',
]);

const isOurShortcut = e =>
  (e.metaKey || e.ctrlKey) && (
    OUR_KEYS.has(e.key.toLowerCase()) ||
    // explicitly allow the tab-cycle combo: ⌘/Ctrl + Shift + ← / →
    (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))
  );


const swallowKeyEvents = e => {
  const realTarget = e.composedPath()[0];

  // Allow keys inside input
  if (realTarget && realTarget.id === 'gpt-instruction') {
    if (!isOurShortcut(e)) {
      e.stopImmediatePropagation();
    }
    return;
  }

  // Allow copy from output area
  if (
    host?.shadowRoot?.getElementById("output-text")?.contains(realTarget) &&
    e.type === "copy"
  ) {
    return; // Allow copying from output
  }

  if (!host?.contains(e.target)) return;

  if (isOurShortcut(e)) return;

  e.stopImmediatePropagation();

  // Only suppress cut/paste, NOT copy
  if (['cut', 'paste'].includes(e.type)) {
    e.preventDefault();
  }
};


const killEvent = e => {
  e.preventDefault();
  e.stopImmediatePropagation();
};


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "togglePane") {
    if (pane) {
      destroyPane();
    } else {
      createPane();
    }
  }

  if (message.action === "openPanel" && !pane) {
    createPane();
  }
  if (message.action === "promptDynamicValue") {
    const userInput = prompt(`Enter value for "${message.property}":`);
    sendResponse(userInput);
    return true;
  }

});


const MODEL_OPTIONS = window.MODEL_OPTIONS;

let originalFaviconNode = null;


/* ----------  favicon helpers ---------- */

function captureOriginalFavicon() {
  try {
    const existing = document.querySelector("link[rel~='icon']");
    originalFaviconNode = existing ? existing.cloneNode(true) : null;
  } catch (e) {
    console.warn("Could not capture original favicon:", e);
  }
}

function removeOldFavicons() {
  try {
    document.querySelectorAll("link[rel~='icon']").forEach(el => el.remove());
  } catch (e) {
    console.warn("Failed to remove old favicons:", e);
  }
}

function restoreFavicon() {
  try {
    if (!document.head || typeof document.head.appendChild !== "function") {
      console.warn("document.head is not available or writable");
      return;
    }

    removeOldFavicons();

    if (originalFaviconNode) {
      document.head.appendChild(originalFaviconNode.cloneNode(true));
    }
    // No fallback icon. Just don't change anything if original wasn't captured.
  } catch (e) {
    console.warn("Failed to restore favicon:", e);
  }
}


function startFaviconSpinner() {
  if (!originalFaviconNode) captureOriginalFavicon();

  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  let angle = 0;
  let alive = true; // ← this flag ensures no stale spinner runs

  const spinnerInterval = setInterval(() => {
    if (!alive) return;

    try {
      ctx.clearRect(0, 0, 32, 32);
      ctx.beginPath();
      ctx.strokeStyle = "#2E7D32";
      ctx.lineWidth = 4;
      ctx.arc(16, 16, 12, angle, angle + Math.PI * 1.5);
      ctx.stroke();
      angle += 0.6;

      const link = document.createElement("link");
      Object.assign(link, {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: canvas.toDataURL("image/png")
      });

      removeOldFavicons();
      document.head.appendChild(link);
    } catch (e) {
      console.warn("Could not update favicon spinner:", e);
      clearInterval(spinnerInterval);
    }
  }, 100);

  return () => {
    alive = false; // ← this prevents any queued interval from drawing
    clearInterval(spinnerInterval);
    restoreFavicon();
  };
}


/* ----------  main pane creation ---------- */
function destroyPane() {
  if (host && host.parentNode) host.remove();
  if (floatingBall && floatingBall.parentNode) floatingBall.remove();
  floatingBall = null;
  pane = null;
  host = null;
  isMinimized = false;

  // Remove global key listeners
  ['keydown','keypress','keyup','copy','cut','paste','beforeinput']
    .forEach(type =>
      document.removeEventListener(type, swallowKeyEvents, true));
  // allow the listener to be added again after we recreate the pane
  delete window.__genaListenersAttached;

  cleanupFns.forEach(fn => fn());
  cleanupFns = [];

  // Stop shared favicon spinner if running
  activeSpinnerCount = 0;
  if (typeof globalStopSpinner === "function") {
    globalStopSpinner();
    globalStopSpinner = null;
  }

  restoreFavicon();
}



function createPane() {
  if (!originalFaviconNode) captureOriginalFavicon();
  let currentMode = "clipboard";
  /* ---------- asset paths ---------- */
  const icon = chrome.runtime.getURL("icons/icon.png");
  const screen = chrome.runtime.getURL("icons/Placeholder.png");
  const copyIcon = chrome.runtime.getURL("icons/Copy.png");
  const clearIcon = chrome.runtime.getURL("icons/Clear.png");
  const chatLinkedIcon = chrome.runtime.getURL("icons/chat-linked.png");
  const chatUnlinkedIcon = chrome.runtime.getURL("icons/chat-unlinked.png");
  const saveIcon = chrome.runtime.getURL("icons/Save.png");
  const deleteIcon = chrome.runtime.getURL("icons/Delete.png");
  const collapseIcon = chrome.runtime.getURL("icons/Down.png");
  const expandIcon = chrome.runtime.getURL("icons/Up.png");
  const leftIcon = chrome.runtime.getURL("icons/Left.png");
  const rightIcon = chrome.runtime.getURL("icons/Right.png");
  const highlightScript = chrome.runtime.getURL("libs/highlight.min.js");
  const highlightStyle = chrome.runtime.getURL("libs/github.min.css");


  const loadSession = (cb = () => {}) => {
    chrome.storage.local.get(SESSION_KEY, ({ [SESSION_KEY]: s }) => {
      if (!s) return cb();

      // ❗ Clear everything before restoring
      tabOrder.length = 0;
      for (const key in tabs) delete tabs[key];
      const tabBar = shadow.getElementById("tab-bar");
      tabBar.innerHTML = "";

      // Restore from saved state
      tabCounter        = s.tabCounter ?? 1;
      currentTabIndex   = s.currentTabIndex ?? -1;
      chatMemoryEnabled = !!s.chatMemoryEnabled;

      Object.assign(tabs, s.tabs || {});
      tabOrder.push(...(s.tabOrder || []));
      // 🧹 De-duplicate any old corrupted tabOrder values
      const seen = new Set();
      for (let i = tabOrder.length - 1; i >= 0; i--) {
        if (seen.has(tabOrder[i])) {
          tabOrder.splice(i, 1);
        } else {
          seen.add(tabOrder[i]);
        }
      }

      // Create tab buttons
      tabOrder.forEach(id => {
        const btn = document.createElement("button");
        btn.dataset.id = id; // ADD THIS LINE so we can find this tab later
        btn.textContent = id.split("-")[1];
        Object.assign(btn.style, {
          display: "inline-flex",
          alignItems: "center",
          gap: "12px",
          padding: "4px 8px",
          border: "1px solid #1b5e20",
          borderRadius: "6px",
          background: "#2E7D32",
          cursor: "pointer",
          fontSize: "12px",
          color: "#fff"
        });
        btn.addEventListener("click", () => renderTab(id));
        tabBar.appendChild(btn);
      });


      // Safely render selected tab
      if (tabOrder[currentTabIndex]) {
        renderTab(tabOrder[currentTabIndex]);
      }

      // Reset counter properly
      const lastNum = Math.max(...tabOrder.map(id => parseInt(id.split("-")[1], 10) || 0));
      tabCounter = lastNum + 1;

      cb();
    });
  };


  const saveSession = () => {
    const activeTabs = {};
    tabOrder.forEach(id => { activeTabs[id] = tabs[id]; });

    chrome.storage.local.set({
      [SESSION_KEY]: {
        tabCounter,
        currentTabIndex,
        chatMemoryEnabled,
        tabs: activeTabs,
        tabOrder: [...tabOrder]
      }
    });
  };



  /* ---------- host & shadow root ---------- */
  host = document.createElement("div");
  host.id = "askgena-host";
  Object.assign(host.style, {
    position: "fixed",
    top: 0,
    right: 0,
    width: "25vw",
    height: "100vh",
    zIndex: 2147483647,
    background: "transparent",
    pointerEvents: "auto"             
  });


  const shadow = host.attachShadow({ mode: "open" });
  document.body.appendChild(host);

  floatingBall = document.createElement("div");
  floatingBall.id = "gena-floating-ball";
  Object.assign(floatingBall.style, {
    display: "none",
    position: "fixed",
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    background: `url(${icon}) center/cover no-repeat`,
    zIndex: 2147483647,
    cursor: "pointer",
    bottom: "20px",
    right: "20px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
  });
  document.body.appendChild(floatingBall);
  floatingBall.style.transition = "transform 0.2s ease";
  floatingBall.addEventListener("mouseenter", () => {
    floatingBall.style.transform = "scale(1.1)";
  });
  floatingBall.addEventListener("mouseleave", () => {
    floatingBall.style.transform = "scale(1)";
  });




  host.tabIndex = -1;
  host.focus();

  function toggleMinimize() {
    isMinimized = !isMinimized;

    if (isMinimized) {
      host.style.display = "none";
      floatingBall.style.display = "block";
    } else {
      host.style.display = "block";
      floatingBall.style.display = "none";
    }
  }






  const highlightLink = document.createElement("link");
  highlightLink.rel = "stylesheet";
  highlightLink.href = highlightStyle;
  highlightLink.type = "text/css";

  const highlightScriptTag = document.createElement("script");
  highlightScriptTag.src = highlightScript;
  highlightScriptTag.type = "text/javascript";

  shadow.appendChild(highlightLink);
  shadow.appendChild(highlightScriptTag);

  // --- KaTeX local files ---
  const katexCSS = document.createElement("link");
  katexCSS.rel = "stylesheet";
  katexCSS.href = chrome.runtime.getURL("libs/katex.min.css");

  const katexScript = document.createElement("script");
  katexScript.src = chrome.runtime.getURL("libs/katex.min.js");
  katexScript.defer = true;

  const autoRenderScript = document.createElement("script");
  autoRenderScript.src = chrome.runtime.getURL("libs/auto-render.min.js");
  autoRenderScript.defer = true;

  autoRenderScript.onload = () => {
    if (typeof renderMathInElement === "function") {
      renderMathInElement(shadow.getElementById("output-text"), {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false }
        ],
        throwOnError: false
      });
    }
  };

  shadow.appendChild(katexCSS);
  shadow.appendChild(katexScript);
  shadow.appendChild(autoRenderScript);


  /* ---------- pane container ---------- */
  pane = document.createElement("div");
  Object.assign(pane.style, {
    width: "100%",
    height: "100%",
    backgroundColor: "#fff",
    display: "flex",
    flexDirection: "column",
    fontFamily: "sans-serif",
    padding: "10px",
    borderLeft: "1px solid #ccc",
    boxShadow: "-2px 0 5px rgba(0,0,0,0.2)",
    pointerEvents: "auto",

    /* 👇 NEW */
    borderTopLeftRadius: "12px",
    borderBottomLeftRadius: "12px",
    overflow: "hidden"        // clips the inside items to the curve
  });

  pane.id = "askgena-pane";

  /* ---------- styles ---------- */
  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing: border-box; }

    @keyframes pulse-click {
      0% { transform: scale(1); }
      50% { transform: scale(0.85); }
      100% { transform: scale(1); }
    }

    .pulse { animation: pulse-click 150ms ease; }
    .icon-btn { width: 20px; height: 20px; cursor: pointer; position: relative; }

    .icon-btn .tooltip {
      visibility: hidden;
      opacity: 0;
      background: #333;
      color: #fff;
      text-align: center;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
      position: absolute;
      bottom: 130%;
      left: 50%;
      transform: translateX(-50%);
      white-space: nowrap;
      z-index: 1;
      transition: opacity 0.2s;
    }
    .icon-btn:hover .tooltip { visibility: visible; opacity: 1; }

    .analyze-button {
      background: #2E7D32;
      color: #fff;
      border: none;
      padding: 10px;
      border-radius: 8px;
      font-weight: 700;
      cursor: pointer;
      font-size: 14px;
      transition: background-color 0.3s ease;
      flex: 1;
    }
    .analyze-button:hover { background: #388E3C; }

    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .loading-spinner {
      border: 3px solid #ccc;
      border-top: 3px solid #2E7D32;
      border-radius: 50%;
      width: 16px;
      height: 16px;
      animation: spin 1s linear infinite;
      margin-left: 8px;
    }

    .analyze-option {
      padding: 10px 14px;
      cursor: pointer;
      transition: all 0.25s ease;
      font-size: 14px;
      font-weight: 700;
      text-align: center;
      border-radius: 8px;
    }

    .analyze-option:hover { background: #f2f7f4; }

    #prompt-dropdown-menu .analyze-option:hover {
      background-color: #f2f7f4;
    }


    /* Markdown content fix */
    #output-text ul {
      padding-left: 1.4em;
      margin: 0.5em 0;
      list-style-type: disc;
    }
    #output-text li { line-height: 1.5; margin: 4px 0; overflow: visible; }
    #model-dropdown {
      font-size: 13px;
      padding: 8px 12px;
      border: 1.5px solid #2E7D32;
      border-radius: 8px;
      background-color: #f0fff4;
      color: #1b5e20;
      font-weight: 600;
      font-family: system-ui, sans-serif;
      appearance: none;
      transition: all 0.2s ease;
      cursor: pointer;

      text-align: center;
      text-align-last: center;

      /* Hide default arrow */
      background-image: none !important;
    }


    #model-dropdown:hover {
      background-color: #e8f5e9;
      border-color: #1b5e20;
    }

    #model-dropdown:focus {
      outline: none;
      border-color: #66bb6a;
      box-shadow: 0 0 0 2px rgba(46, 125, 50, 0.25);
    }
    
    #expanded-pane-content {
      width: 100%;
      max-width: 50vw;
      margin: 0 auto;
      padding-top: 0;
    }
    #tab-bar {
      margin-top: 0 !important;
      padding-top: 0 !important; 
    }
      
    #tab-bar button {
      border-radius: 12px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    }
    #gpt-instruction {
      border-radius: 12px !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    #output-text table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      border: 1px solid #ccc;
      border-radius: 8px;
      overflow: hidden;
      font-size: 14px;
    }

    #output-text th,
    #output-text td {
      border-right: 1px solid #ccc;
      border-bottom: 1px solid #ccc;
      padding: 10px 14px;
      text-align: left;
      background-color: #fff;
    }

    #output-text th {
      background-color: #f4f4f4;
      font-weight: bold;
    }

    #output-text tr:last-child td {
      border-bottom: none;
    }

    #output-text tr td:last-child,
    #output-text tr th:last-child {
      border-right: none;
    }

    #output-text thead tr:first-child th:first-child {
      border-top-left-radius: 8px;
    }

    #output-text thead tr:first-child th:last-child {
      border-top-right-radius: 8px;
    }

    #output-text tbody tr:last-child td:first-child {
      border-bottom-left-radius: 8px;
    }

    #output-text tbody tr:last-child td:last-child {
      border-bottom-right-radius: 8px;
    }

    .code-wrapper {
      position: relative;
      border: 1px solid #ccc;
      border-radius: 8px;
      margin: 16px 0 0px 0;
      overflow: hidden;
      background: #f9f9f9;
    }

    .code-wrapper pre {
      margin: 0;
      padding: 28px 12px 12px 12px;
      overflow-x: auto;
      background: #f9f9f9;
    }

    pre code {
      background: transparent !important;
    }

    .code-lang-label {
      position: absolute;
      top: 0;
      left: 0;
      background: #d5e8d4;
      color: #2e7d32;
      font-size: 12px;
      font-weight: bold;
      padding: 4px 8px;
      border-bottom-right-radius: 8px;
      z-index: 1;
    }


    #output-text code:not(pre code) {
      background: #f2f2f2;
      color:rgb(233, 82, 79);
      padding: 2px 6px;
      border-radius: 6px;
      font-family: 'JetBrains Mono', 'Courier New', monospace;
      font-weight: 700;
      font-size: 14px;
      white-space: nowrap;
      letter-spacing: 0.25px;
      line-height: 1.4;
    }


    /* ─── Output scrollbar: keep width stable ─── */
    #gpt-output {
      scrollbar-gutter: stable;                      /* modern browsers */
      scrollbar-width: thin;                         /* Firefox */
      scrollbar-color: transparent transparent;      /* hide by default */
    }

    #gpt-output:hover {
      scrollbar-color: rgba(0, 0, 0, 0.35) transparent;
    }

    /* WebKit / Blink (Chrome, Edge, Safari) */
    #gpt-output::-webkit-scrollbar {
      width: 8px;                                     /* always reserved */
    }
    #gpt-output::-webkit-scrollbar-track {
      background: transparent;
    }
    #gpt-output::-webkit-scrollbar-thumb {
      background-color: transparent;                 /* hidden thumb */
      border-radius: 4px;
      transition: background-color 0.2s ease;
    }
    #gpt-output:hover::-webkit-scrollbar-thumb {
      background-color: rgba(0, 0, 0, 0.25);          /* visible on hover */
    }

    /* Allow text selection in GPT output */
    #gpt-output, #output-text {
      user-select: text !important;
      -webkit-user-select: text !important;
      -moz-user-select: text !important;
      -ms-user-select: text !important;
      pointer-events: auto !important;
    }

  `;

  /* ---------- pane HTML ---------- */
  pane.innerHTML = `
    <div id="gpt-resize-handle"
         style="position:absolute;left:0;top:0;width:6px;height:100%;cursor:ew-resize;background:transparent;z-index:100001;"></div>
    
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <label style="display:flex;align-items:center;gap:6px;">
        <img id="header-icon" src="${icon}" width="20" height="20" alt="icon" style="cursor:pointer;" title="Minimize/Restore">
        <strong style="font-family:Consolas,'Fira Code',monospace; font-weight: 400;">
          <span style="color:#080c09;">ASK</span><span style="color:#00661a; display:inline-block; transform: scaleX(0.5);">-</span><span style="color:#00753b;">GENA</span>
        </strong>
      </label>

      <div style="display:flex;align-items:center;gap:6px;font-size:12px;">
        <div style="position:relative;">
          <button id="model-dropdown-button"
            style="
              width: 140px;
              height: 28px;
              padding: 0 10px;
              font-size: 13px;
              line-height: 26px;
              border: 1.5px solid #145708;
              border-radius: 8px;
              background: #fff;
              color: #145708;
              font-weight: 600;
              cursor: pointer;
              display: inline-block;
              text-align: center;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            ">
            ${MODEL_OPTIONS[0].label}
          </button>
          <div id="model-dropdown-menu"
            style="display:none;position:absolute;top:110%;left:0;width:100%;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:10000;">
          </div>
        </div>


      </div>
    </div>
    

    <!-- Output -->
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
      <div id="gpt-output"
           style="flex:1;overflow-y:auto;padding:10px;margin:0;white-space:pre-wrap;font-size:14px;box-sizing:border-box;background:#fff;text-align:left;position:relative;">
        <img id="output-placeholder" src="${screen}"
             style="max-width:60%;opacity:0.4;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;">
        <div id="expanded-pane-content">
          <div id="output-text"></div>
        </div>
      </div>
    </div>

    <div id="expanded-pane-content">
    <!-- Tabs -->
    <div id="tab-bar"
         style="display:flex;flex-wrap:wrap;gap:4px;padding:4px 0;overflow-y:auto;max-height:100px;"></div>
    <!-- Input -->
    <div id="gpt-input-wrapper">
      <textarea id="gpt-instruction" placeholder="Typing..."
              style="height:90px;width:100%;margin-bottom:1px;margin-top:1px;border:2px solid #2f9644;border-radius:8px;padding:8px;font-size:14px;resize:vertical;background:#fff;pointer-events:auto;"></textarea>
      <div style="display:flex;position:relative;margin-bottom:10px;width:100%;">
        <button id="analyze-main" class="analyze-button"
                style="flex:9;position:relative;border-top-right-radius:0;border-bottom-right-radius:0;height:40px;overflow:hidden;">
          <span id="analyze-label"
                style="position:absolute;left:55.56%;top:50%;transform:translate(-50%,-50%);white-space:nowrap;">Clipboard</span>
        </button>

        <button id="analyze-dropdown" class="analyze-button"
                style="flex:1;display:flex;justify-content:center;align-items:center;border-top-left-radius:0;border-bottom-left-radius:0;font-size:10px;padding:0;">
          ▲
        </button>

        <div id="analyze-menu"
             style="display:none;position:absolute;bottom:100%;right:0;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:1000;width:100%;overflow:hidden;font-family:sans-serif;">
          <div class="analyze-option" data-mode="clipboard" style="border-bottom:1px solid #eee;">Clipboard</div>
          <div class="analyze-option" data-mode="question">Question</div>
        </div>
      </div>
    </div>
    
    <!-- Actions -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 12px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <div style="position:relative;">
          <button id="prompt-dropdown-button"
            style="
              width: 140px;
              height: 28px;
              padding: 0 10px;
              font-size: 13px;
              line-height: 26px;
              border: 1px solid rgb(197, 226, 199);
              border-radius: 8px;
              background:rgb(241, 255, 241);
              color: #145708;
              font-weight: 600;
              cursor: pointer;
              display: inline-block;
              text-align: center;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            ">
            Saved prompts
          </button>

          <div id="prompt-dropdown-menu"
              style="display:none;position:absolute;bottom:110%;left:0;width:100%;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:10000;">
          </div>
        </div>


        <div class="icon-btn" id="save-prompt-btn">
          <img src="${saveIcon}" width="14" height="14" alt="save"><span class="tooltip">Save prompt</span>
        </div>
        <div class="icon-btn" id="delete-prompt-btn">
          <img src="${deleteIcon}" width="16" height="16" alt="delete"><span class="tooltip">Delete prompt</span>
        </div>
      </div>

      <div style="display:flex;gap:10px;">
        <div class="icon-btn" id="expand-panel-toggle">
          <img src="${leftIcon}" width="16" height="16" alt="expand"><span class="tooltip">Expand</span>
        </div>
        <div class="icon-btn" id="copy-result">
          <img src="${copyIcon}" width="16" height="16" alt="copy"><span class="tooltip">Copy</span>
        </div>
        <div class="icon-btn" id="clear-result">
          <img src="${clearIcon}" width="16" height="16" alt="clear"><span class="tooltip">Clear output</span>
        </div>
        <!-- Chat-memory toggle button -->
        <div class="icon-btn" id="chat-mode-toggle">
          <img src="${chatLinkedIcon}" id="chat-mode-icon" width="16" height="16" alt="toggle"><span class="tooltip">Continue Chat</span>
        </div>


        <div class="icon-btn" id="toggle-input-area">
          <img src="${collapseIcon}" width="16" height="16" alt="hide"><span class="tooltip">Hide</span>
        </div>
      </div>
    </div>
    </div>
  `;

  /* ---------- attach and focus ---------- */
  pane.prepend(style);
  shadow.appendChild(pane);

  // Register listeners in capture phase
  if (!window.__genaListenersAttached) {
    window.__genaListenersAttached = true;
    ['keydown', 'keypress', 'keyup', 'copy', 'cut', 'paste', 'beforeinput']
      .forEach(type =>
        document.addEventListener(type, swallowKeyEvents, true));
  }



  shadow.getElementById("header-icon").addEventListener("click", () => {
    toggleMinimize();
  });


  let offsetX = 0, offsetY = 0, isDragging = false, dragMoved = false;

  floatingBall.addEventListener("mousedown", e => {
    isDragging = true;
    dragMoved = false;
    offsetX = e.clientX - floatingBall.offsetLeft;
    offsetY = e.clientY - floatingBall.offsetTop;
  });

  document.addEventListener("mousemove", e => {
    if (!isDragging) return;
    dragMoved = true;
    floatingBall.style.left = `${e.clientX - offsetX}px`;
    floatingBall.style.top = `${e.clientY - offsetY}px`;
    floatingBall.style.right = "";
  });

  document.addEventListener("mouseup", () => {
    if (!isDragging) return;
    isDragging = false;

    const screenWidth = window.innerWidth;
    const left = floatingBall.offsetLeft;
    const snapLeft = left < screenWidth / 2;

    floatingBall.style.left = snapLeft ? "10px" : "";
    floatingBall.style.right = snapLeft ? "" : "10px";

    // Prevent click from firing immediately after drag
    setTimeout(() => {
      dragMoved = false;
    }, 0);
  });

  floatingBall.addEventListener("click", () => {
    if (dragMoved) return; // ignore accidental restore
    toggleMinimize();
  });




  const inputBox = shadow.getElementById("gpt-instruction");

  let shadowActiveElement = null;

  const shadowFocusInHandler = e => {
    shadowActiveElement = e.target;
  };

  shadow.addEventListener("focusin", shadowFocusInHandler);
  cleanupFns.push(() => shadow.removeEventListener("focusin", shadowFocusInHandler));

  const shadowKeyHandler = e => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const metaKey = isMac ? e.metaKey : e.ctrlKey;
      const active = shadowActiveElement;

      if (!active) return;

      // Cmd + A
      if (metaKey && e.key.toLowerCase() === "a" && active.id === "gpt-instruction") {
        e.preventDefault();
        e.stopPropagation();
        active.select();
        return;
      }

      // Arrow keys
      if (
        active.id === "gpt-instruction" &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        const hasModifier = e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;

        if (!hasModifier) {
          e.stopPropagation(); // Only block plain arrow keys
        }

        // Let the default behavior (caret movement or shortcut) happen
        return;
      }


      // Delete and Backspace
      if (
        active.id === "gpt-instruction" &&
        ["Backspace", "Delete"].includes(e.key)
      ) {
        e.stopPropagation();
        return;
      }
    };
  shadow.addEventListener("keydown", shadowKeyHandler, true);
  cleanupFns.push(() => shadow.removeEventListener("keydown", shadowKeyHandler, true));







  shadow.getElementById("gpt-instruction").focus();
  loadSession(() => {
    chatMemoryEnabled = false;
    refreshChatToggleUI();
  });




  /* ---------- site-specific overrides ---------- */
  chrome.storage.sync.get(["hideInputArea", "siteOverrides"], data => {
    const url = location.href;
    const overrides = data.siteOverrides || {};
    const match = matchSiteOverride(url, overrides);

    if (match?.paused) return;

    /* hide / prefill input ------------------------------------------------ */
    const shouldHideInput = match?.hideInput ?? data.hideInputArea;
    if (shouldHideInput) {
      const wrapper = shadow.getElementById("gpt-input-wrapper");
      const icon = shadow.querySelector("#toggle-input-area img");
      const tooltip = shadow.querySelector("#toggle-input-area .tooltip");
      wrapper.style.display = "none";
      if (icon) icon.src = expandIcon;
      if (tooltip) tooltip.textContent = "Show";
    }

    if (match?.prefillPrompt) {
      shadow.getElementById("gpt-instruction").value = match.prefillPrompt;
    }

    /* model toggle -------------------------------------------------------- */
    if (match?.defaultModel) {
      const matched = MODEL_OPTIONS.find(opt => opt.id === match.defaultModel);
      if (matched) {
        selectedModelId = matched.id;
        modelDropdownBtn.textContent = matched.label;
        modelDropdownBtn.title = matched.label;
      }
    }



    /* auto-run ------------------------------------------------------------ */
    if (match?.autoRun) {
      setTimeout(() => {
        const analyzeVisible = async () => {
          if (currentMode === "clipboard") {
            const text = await navigator.clipboard.readText();
            analyze(text, "analyze-main");
          } else {
            analyze(" ", "analyze-main");
          }
        };
        analyzeVisible();
      }, 300);
    }
  });

  /* ---------- helper: wildcard site match ---------- */
  function matchSiteOverride(url, overrides) {
    for (const pattern in overrides) {
      const regex = new RegExp(
        `^${pattern.replace(/[.+^${}()|[\\]\\\\]/g, "\\$&").replace(/\*/g, ".*")}$`
      );
      if (regex.test(url)) return overrides[pattern];
    }
    return null;
  }



  /* ---------- resize handle ---------- */
  const resizeHandle = shadow.getElementById("gpt-resize-handle");
  let isResizing = false;

  resizeHandle.addEventListener("mousedown", () => {
    isResizing = true;
    document.body.style.userSelect = "none";
  });

  const mouseMoveHandler = e => {
    if (!isResizing) return;

    const newW = Math.min(Math.max(window.innerWidth - e.clientX, 300), 800);
    host.style.width = `${newW}px`;

    // 👇 Adjust corners dynamically based on width
    const isFullWidth = newW >= window.innerWidth - 2;  // 2-px buffer
    pane.style.borderTopLeftRadius    = isFullWidth ? "0" : "12px";
    pane.style.borderBottomLeftRadius = isFullWidth ? "0" : "12px";

  };

  document.addEventListener("mousemove", mouseMoveHandler);
  cleanupFns.push(() => document.removeEventListener("mousemove", mouseMoveHandler));

  const mouseUpHandler = () => {
    isResizing = false;
    document.body.style.userSelect = "";
  };
  document.addEventListener("mouseup", mouseUpHandler);
  cleanupFns.push(() => document.removeEventListener("mouseup", mouseUpHandler));

  /* ---------- small helpers ---------- */
  const pulse = el => {
    el.classList.add("pulse");
    setTimeout(() => el.classList.remove("pulse"), 150);
  };

  /* ---------- tab management ---------- */
  function renderTab(id) {
    const outputText = shadow.getElementById("output-text");
    const outputContainer = shadow.getElementById("gpt-output");
    const placeholder = shadow.getElementById("output-placeholder");
    const tabBar = shadow.getElementById("tab-bar");

    outputText.innerHTML = tabs[id].html;

    if (typeof renderMathInElement === "function") {
      renderMathInElement(outputText, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false }
        ],
        throwOnError: false
      });
    }

    function applyHighlighting() {
      if (window.hljs) {
        outputText.querySelectorAll("pre code").forEach(block => {
          hljs.highlightElement(block);
        });
      } else {
        setTimeout(applyHighlighting, 100);
      }
    }
    applyHighlighting();

    // === Copy Table and Code Buttons ===

    // 🟡 Match all markdown tables from the original content
    const tableRegex = /((?:\|[^\n]*\|\n)+\|[-:| ]+\|\n(?:\|[^\n]*\|\n?)*)/g;
    const markdownTables = [...tabs[id].markdown.matchAll(tableRegex)].map(m => m[0]);

    // 🟣 Add copy buttons after each HTML table
    const tableElements = outputText.querySelectorAll("table");
    tableElements.forEach((table, index) => {
      const btn = document.createElement("button");
      btn.textContent = "📋 Copy Table";
      btn.style.cssText =
        "margin:6px 0 14px 0;padding:4px 8px;font-size:12px;cursor:pointer;" +
        "background:#f7f7f7;border:1px solid #ccc;border-radius:6px;color:#747474;";

      btn.addEventListener("click", async () => {
        const text = markdownTables[index] || "*Table markdown not found.*";
        await navigator.clipboard.writeText(text);
        btn.textContent = "✅ Copied!";
        setTimeout(() => (btn.textContent = "📋 Copy Table"), 1500);
      });

      table.insertAdjacentElement("afterend", btn);
    });

    // 🔵 Add language label + copy button to code blocks
    const codeBlocks = outputText.querySelectorAll("pre > code");
    codeBlocks.forEach((code, index) => {
      const pre = code.parentElement;
      const langClass = [...code.classList].find(c => c.startsWith("language-"));
      const lang = langClass ? langClass.replace("language-", "") : "plaintext";

      const wrapper = document.createElement("div");
      wrapper.className = "code-wrapper";

      const label = document.createElement("div");
      label.className = "code-lang-label";
      label.textContent = lang;

      pre.replaceWith(wrapper);
      wrapper.appendChild(label);
      wrapper.appendChild(pre);

      const btn = document.createElement("button");
      btn.textContent = "📋 Copy Code";
      btn.style.cssText =
        "margin:6px 0 14px 0;padding:4px 8px;font-size:12px;cursor:pointer;" +
        "background:#f7f7f7;border:1px solid #ccc;border-radius:6px;color:#747474;";

      btn.addEventListener("click", async () => {
        const markdownCode = `\`\`\`${lang}\n${code.textContent}\n\`\`\``;
        await navigator.clipboard.writeText(markdownCode);
        btn.textContent = "✅ Copied!";
        setTimeout(() => (btn.textContent = "📋 Copy Code"), 1500);
      });

      wrapper.insertAdjacentElement("afterend", btn);
    });


    currentTabIndex = tabOrder.indexOf(id);
    placeholder.style.display = "none";
    outputContainer.style.display = "block";
    outputContainer.style.justifyContent = "unset";
    outputContainer.style.alignItems = "unset";
    outputText.style.textAlign = "left";
    outputText.style.color = "#000";

    [...tabBar.children].forEach(btn => {
      btn.style.background = "#7cbd88";
      btn.style.padding = "4px 8px";
      btn.querySelector(".tab-close")?.remove();
    });

    const selectedBtn = [...tabBar.children].find(btn => btn.dataset.id === id);
    if (selectedBtn) {
      selectedBtn.style.background = "#388E3C";
      selectedBtn.style.padding = "4px 12px";

      // Add ✕ close button if not present
      if (!selectedBtn.querySelector(".tab-close")) {
        const close = document.createElement("span");
        close.textContent = "✕";
        close.className = "tab-close";
        Object.assign(close.style, {
          cursor: "pointer",
          fontWeight: "bold"
        });
        close.addEventListener("click", e => {
          e.stopPropagation(); // don’t trigger tab switch
          closeTab(id);
        });
        selectedBtn.appendChild(close);
      }
    }


    saveSession();
  }

  // Close tab function
  function closeTab(id) {
    const tabBar = shadow.getElementById("tab-bar");

    // Remove tab data
    delete tabs[id];
    const idx = tabOrder.indexOf(id);
    if (idx !== -1) tabOrder.splice(idx, 1);

    // Remove the tab button
    const btn = [...tabBar.children].find(b => b.dataset.id === id);
    if (btn) btn.remove();

    // Switch to next tab or clear output
    if (tabOrder.length === 0) {
      updateOutput("", true);
      currentTabIndex = -1;
    } else {
      currentTabIndex = Math.max(0, idx - 1);
      renderTab(tabOrder[currentTabIndex]);
    }

    saveSession();
  }


  /* ---------- tabbed output ---------- */

  const updateOutput = (content, isStatus = false) => {
    const outputText = shadow.getElementById("output-text");
    const outputContainer = shadow.getElementById("gpt-output");
    const placeholder = shadow.getElementById("output-placeholder");
    const tabBar = shadow.getElementById("tab-bar");

    if (isStatus) {
      outputText.innerHTML = content;
      placeholder.style.display = content.trim() ? "none" : "block";
      outputContainer.style.display = "flex";
      outputContainer.style.justifyContent = "center";
      outputContainer.style.alignItems = "center";
      outputText.style.textAlign = "center";
      outputText.style.color = "#888";
      return;
    }

    /* regular output ----------------------------------------------------- */
    outputContainer.style.display = "block";
    outputText.style.textAlign = "left";
    outputText.style.color = "#000";

    const tabId = `tab-${tabCounter++}`;
    if (!tabOrder.includes(tabId)) {
      tabOrder.push(tabId);
    }
    const tabBtn = document.createElement("button");
    tabBtn.dataset.id = tabId; // store ID for later use




    Object.assign(tabBtn.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      padding: "4px 8px",
      border: "1px solid #1b5e20",
      borderRadius: "6px",
      background: "#2E7D32",
      cursor: "pointer",
      fontSize: "12px",
      color: "#fff"
    });

    tabBtn.textContent = `${tabCounter - 1}`;
    tabBar.appendChild(tabBtn);
    marked.setOptions({
      langPrefix: 'language-',
      highlight: function (code, lang) {
        if (window.hljs && lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return code; // fallback
      }
    });

    const escaped = content.replace(/\\([;:{}%&$#_])/g, '\\\\$1');
    tabs[tabId] = {
      markdown: content,
      html: marked.parse(escaped)
    };







    tabBtn.addEventListener("click", () => renderTab(tabId));
    renderTab(tabId);
  };

  /* ---------- copy / clear ---------- */
  shadow.getElementById("copy-result").addEventListener("click", async () => {
    const tabId = tabOrder[currentTabIndex];
    const rawMarkdown = tabs[tabId]?.markdown || "";
    await navigator.clipboard.writeText(rawMarkdown);

    // Tooltip feedback
    const tooltip = shadow.querySelector("#copy-result .tooltip");
    if (tooltip) {
      tooltip.textContent = "Copied!";
      setTimeout(() => {
        tooltip.textContent = "Copy";
      }, 1500);
    }

    pulse(shadow.getElementById("copy-result"));
  });


  shadow.getElementById("clear-result").addEventListener("click", () => {
    updateOutput("", true);
    shadow.getElementById("tab-bar").innerHTML = "";
    tabCounter = 1;
    Object.keys(tabs).forEach(k => delete tabs[k]);
    tabOrder.length = 0;
    chrome.storage.local.remove(SESSION_KEY);
    pulse(shadow.getElementById("clear-result"));
  });


  /* ---------- panel expand ---------- */
  const expandToggle = shadow.getElementById("expand-panel-toggle");
  let isExpanded = false;

  expandToggle.addEventListener("click", () => {
    const icon    = expandToggle.querySelector("img");
    const tooltip = expandToggle.querySelector(".tooltip");
    isExpanded = !isExpanded;

    host.style.width = isExpanded ? "100vw" : "400px";
    icon.src          = isExpanded ? rightIcon : leftIcon;
    tooltip.textContent = isExpanded ? "Collapse" : "Expand";

    // 👉 toggle radius on the pane instead of the host
    pane.style.borderTopLeftRadius    = isExpanded ? "0"  : "12px";
    pane.style.borderBottomLeftRadius = isExpanded ? "0"  : "12px";

    pulse(expandToggle);
  });







  /* ---------- hide / show input area ---------- */
  shadow.getElementById("toggle-input-area").addEventListener("click", () => {
    const wrapper = shadow.getElementById("gpt-input-wrapper");
    const icon = shadow.querySelector("#toggle-input-area img");
    const tooltip = shadow.querySelector("#toggle-input-area .tooltip");
    const hidden = wrapper.style.display === "none";
    wrapper.style.display = hidden ? "block" : "none";
    icon.src = hidden ? collapseIcon : expandIcon;
    tooltip.textContent = hidden ? "Hide" : "Show";
    pulse(shadow.getElementById("toggle-input-area"));
  });

  // ---------- toggle chat memory ----------
  const chatToggle = shadow.getElementById("chat-mode-toggle");
  const chatToggleIcon = shadow.getElementById("chat-mode-icon");

  const refreshChatToggleUI = () => {
    chatToggleIcon.src = chatMemoryEnabled ? chatLinkedIcon : chatUnlinkedIcon;
    chatToggle.querySelector(".tooltip").textContent =
      chatMemoryEnabled ? "Isolated Chat" : "Continue Chat";
  };


  chatToggle.addEventListener("click", () => {
    chatMemoryEnabled = !chatMemoryEnabled;
    refreshChatToggleUI();
    saveSession();
    pulse(chatToggle);
  });

  refreshChatToggleUI();

  // ---------- favicon spinner ----------
  function beginRequestSpinner() {
    if (activeSpinnerCount++ === 0) {
      globalStopSpinner = startFaviconSpinner();
    }
  }

  function endRequestSpinner() {
    if (--activeSpinnerCount <= 0) {
      activeSpinnerCount = 0;
      if (typeof globalStopSpinner === "function") {
        globalStopSpinner();
        globalStopSpinner = null;
      }
    }
  }


  /* ---------- main analyze function ---------- */
  const analyze = (text, buttonId) => {
    const prompt = shadow.getElementById("gpt-instruction").value.trim();
    const model = selectedModelId;

    if (!prompt) {
      updateOutput("Prompt is empty.", true);
      return;
    }

    // Gather context for chat memory
    let historyMessages = [];

    if (chatMemoryEnabled) {
      tabOrder.forEach(id => {
        const t = tabs[id];
        if (t) historyMessages.push({ role: "assistant", content: t.markdown });
      });
      historyMessages.push({ role: "user", content: prompt });
    }


    shadow.getElementById(buttonId);
    beginRequestSpinner(); // 🔁 replaces individual spinner

    const loadingIcon = chrome.runtime.getURL("icons/iconrotate.gif");
    shadow.getElementById("header-icon").src = loadingIcon;
    if (floatingBall) {
      floatingBall.style.backgroundImage = `url(${loadingIcon})`;
    }
    updateOutput(`<div style="text-align:center;color:#888;">Thinking...</div>`, true);


    chrome.runtime.sendMessage(
      {
        action: "callOpenAI",
        prompt,
        text,
        model,
        chatHistory: chatMemoryEnabled ? historyMessages : null
      },
      response => {
        endRequestSpinner()
        const defaultIcon = chrome.runtime.getURL("icons/icon.png");
        shadow.getElementById("header-icon").src = defaultIcon;
        if (floatingBall) {
          floatingBall.style.backgroundImage = `url(${defaultIcon})`;
        }

        if (response.success && response.content) {
          const cleaned = response.content.replace(/\n{2,}/g, "\n");
          updateOutput(cleaned);
        } else {
          updateOutput(response.error ? `Error: ${response.error}` : "No response", true);
        }
      }
    );
  };

  /* ---------- analyze modes ---------- */
  const mainButton = shadow.getElementById("analyze-main");
  const dropdownButton = shadow.getElementById("analyze-dropdown");
  const menu = shadow.getElementById("analyze-menu");

  const analyzeOptions = [
    { mode: "clipboard", label: "Clipboard" },
    { mode: "question", label: "Question" }
  ];

  function getTwitterText() {
    const tweetSelectors = [
      'article div[lang]',                    // Main tweet content
      'article div[dir="auto"]:not([lang])'   // Other visible labels
    ];

    let text = '';
    tweetSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(node => {
        const visible = window.getComputedStyle(node).visibility !== 'hidden' &&
                        window.getComputedStyle(node).display !== 'none' &&
                        node.offsetHeight > 0;

        if (visible) {
          text += node.innerText.trim() + '\n';
        }
      });
    });

    return text.trim();
  }


  mainButton.addEventListener("click", async () => {
    if (currentMode === "clipboard") {
      analyze(await navigator.clipboard.readText(), "analyze-main");
    } else {
      analyze(" ", "analyze-main");
    }
  });



  let analyzeMenuOpen = false;

  dropdownButton.addEventListener("click", e => {
    e.stopPropagation();
    menu.style.display = analyzeMenuOpen ? "none" : "block";
    analyzeMenuOpen = !analyzeMenuOpen;

    if (analyzeMenuOpen) {
      menu.innerHTML = "";
      analyzeOptions
        .filter(opt => opt.mode !== currentMode)
        .forEach(opt => {
          const div = document.createElement("div");
          div.className = "analyze-option";
          div.dataset.mode = opt.mode;
          div.textContent = opt.label;
          div.style.borderBottom = "1px solid #eee";
          div.addEventListener("click", () => {
            currentMode = opt.mode;
            shadow.getElementById("analyze-label").textContent = opt.label;
            menu.style.display = "none";
            analyzeMenuOpen = false;
          });
          menu.appendChild(div);
        });
    }
  });

  const analyzeMenuClickHandler = e => {
    if (!menu.contains(e.target) && !dropdownButton.contains(e.target)) {
      menu.style.display = "none";
      analyzeMenuOpen = false;
    }
  };
  document.addEventListener("click", analyzeMenuClickHandler);
  cleanupFns.push(() => document.removeEventListener("click", analyzeMenuClickHandler));
  /* ---------- prompt save / load / delete ---------- */
  shadow.getElementById("delete-prompt-btn").addEventListener("click", () => {
    const key = dropdownBtn.textContent;
    if (!key || key === "Saved prompts") return alert("No prompt selected.");
    if (!confirm(`Delete prompt "${key}"?`)) return;

    chrome.storage.local.get("savedPrompts", (data) => {
      const prompts = data.savedPrompts || {};
      delete prompts[key];
      chrome.storage.local.set({ savedPrompts: prompts }, () => {
        dropdownBtn.textContent = "Saved prompts";
        shadow.getElementById("gpt-instruction").value = "";
        renderPromptMenu();
        pulse(shadow.getElementById("delete-prompt-btn"));
      });
    });

  });

  shadow.getElementById("save-prompt-btn").addEventListener("click", () => {
    const promptText = shadow.getElementById("gpt-instruction").value.trim();
    if (!promptText) return alert("Prompt is empty.");

    const name = prompt("Enter a name for this prompt:");
    if (!name) return;

  chrome.storage.local.get("savedPrompts", (data) => {
    const prompts = data.savedPrompts || {};
    prompts[name] = promptText;
    chrome.storage.local.set({ savedPrompts: prompts }, () => {
      dropdownBtn.textContent = name;
      dropdownBtn.title = name;
      renderPromptMenu();
      pulse(shadow.getElementById("save-prompt-btn"));
    });
  });


  });



  const dropdownBtn = shadow.getElementById("prompt-dropdown-button");
  const dropdownMenu = shadow.getElementById("prompt-dropdown-menu");

  const modelDropdownBtn = shadow.getElementById("model-dropdown-button");
  const modelDropdownMenu = shadow.getElementById("model-dropdown-menu");

  let selectedModelId = MODEL_OPTIONS[0].id;

  const renderModelMenu = () => {
    modelDropdownMenu.innerHTML = "";
    MODEL_OPTIONS.forEach(opt => {
      const div = document.createElement("div");
      div.className = "analyze-option";
      div.textContent = opt.label;
      div.dataset.id = opt.id;
      div.addEventListener("click", () => {
        selectedModelId = opt.id;
        modelDropdownBtn.textContent = opt.label;
        modelDropdownBtn.title = opt.label;
        modelDropdownMenu.style.display = "none";
      });
      modelDropdownMenu.appendChild(div);
    });
  };

  modelDropdownBtn.addEventListener("click", e => {
    e.stopPropagation();
    renderModelMenu();
    modelDropdownMenu.style.display = modelDropdownMenu.style.display === "block" ? "none" : "block";
  });

  const modelMenuClickHandler = e => {
    if (!modelDropdownMenu.contains(e.target) && !modelDropdownBtn.contains(e.target)) {
      modelDropdownMenu.style.display = "none";
    }
  };
  document.addEventListener("click", modelMenuClickHandler);
  cleanupFns.push(() => document.removeEventListener("click", modelMenuClickHandler));



  const renderPromptMenu = () => {
    dropdownMenu.innerHTML = "";
    chrome.storage.local.get("savedPrompts", (data) => {
      const items = data.savedPrompts || {};
      Object.keys(items).forEach((key) => {
        const div = document.createElement("div");
        div.className = "analyze-option";
        div.textContent = key;
        div.dataset.key = key;
        div.addEventListener("click", () => {
          shadow.getElementById("gpt-instruction").value = items[key];
          dropdownBtn.textContent = key;
          dropdownBtn.title = key;
          dropdownMenu.style.display = "none";
        });
        dropdownMenu.appendChild(div);
      });
    });
  };


  dropdownBtn.addEventListener("click", e => {
    e.stopPropagation();
    renderPromptMenu();
    dropdownMenu.style.display = dropdownMenu.style.display === "block" ? "none" : "block";
  });

  const promptMenuClickHandler = e => {
    if (!dropdownMenu.contains(e.target) && !dropdownBtn.contains(e.target)) {
      dropdownMenu.style.display = "none";
    }
  };
  document.addEventListener("click", promptMenuClickHandler);
  cleanupFns.push(() => document.removeEventListener("click", promptMenuClickHandler));





  /* ---------- Cmd + Enter shortcut ---------- */
  shadow.getElementById("gpt-instruction").addEventListener("keydown", async e => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      if (currentMode === "clipboard") {
        analyze(await navigator.clipboard.readText(), "analyze-main");
      } else {
        analyze(" ", "analyze-main");
      }
    }
  });




  /* ---------- Cmd+Shift+ArrowUp/Down menu selection ---------- */

  const cycleAnalyzeModeHandler = e => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const meta = isMac ? e.metaKey : e.ctrlKey;
    const shift = e.shiftKey;

    if (meta && shift && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      killEvent(e);

      const wrapper = shadow.getElementById("gpt-input-wrapper");
      const icon = shadow.querySelector("#toggle-input-area img");
      const tooltip = shadow.querySelector("#toggle-input-area .tooltip");

      if (wrapper.style.display === "none") {
        wrapper.style.display = "block";
        if (icon) icon.src = collapseIcon;
        if (tooltip) tooltip.textContent = "Hide";
        pulse(shadow.getElementById("toggle-input-area"));
      }

      const direction = e.key === "ArrowDown" ? 1 : -1;
      const index = analyzeOptions.findIndex(opt => opt.mode === currentMode);
      const nextIndex = (index + direction + analyzeOptions.length) % analyzeOptions.length;
      const nextOption = analyzeOptions[nextIndex];

      currentMode = nextOption.mode;
      shadow.getElementById("analyze-label").textContent = nextOption.label;
    }
  };

  document.addEventListener("keydown", cycleAnalyzeModeHandler, true); // Use capture phase

  cleanupFns.push(() => document.removeEventListener("keydown", cycleAnalyzeModeHandler, true));


  // ---------- Cmd + H: Expand or Collapse Panel ----------
  const toggleExpandHandler = e => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const meta  = isMac ? e.metaKey : e.ctrlKey;

    if (meta && e.key.toLowerCase() === "h") {
      killEvent(e);
      expandToggle.click();
    }
  };
  document.addEventListener("keydown", toggleExpandHandler, true); // Use capture phase
  cleanupFns.push(() => document.removeEventListener("keydown", toggleExpandHandler, true));

  // ---------- Cmd + J: Hide or Show Input Area + Focus ----------
  const toggleInputHandler = e => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const meta = isMac ? e.metaKey : e.ctrlKey;

    if (meta && e.key.toLowerCase() === "j") {
      killEvent(e);

      const wrapper = shadow.getElementById("gpt-input-wrapper");
      const icon = shadow.querySelector("#toggle-input-area img");
      const tooltip = shadow.querySelector("#toggle-input-area .tooltip");

      const hidden = wrapper.style.display === "none";
      wrapper.style.display = hidden ? "block" : "none";

      if (icon) icon.src = hidden ? collapseIcon : expandIcon;
      if (tooltip) tooltip.textContent = hidden ? "Hide" : "Show";

      pulse(shadow.getElementById("toggle-input-area"));

      if (hidden) {
        const inputBox = shadow.getElementById("gpt-instruction");
        inputBox?.focus();
      }
    }
  };
  document.addEventListener("keydown", toggleInputHandler, true); // Use capture phase
  cleanupFns.push(() => document.removeEventListener("keydown", toggleInputHandler, true));


  // ---------- Cmd + options + ↑ / ↓ to cycle prompt dropdown ----------
  let promptKeys = [];
  let promptIndex = -1;
  let promptStore = {}; 


  const cyclePromptHandler = e => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const meta = isMac ? e.metaKey : e.ctrlKey;

    if (meta && !e.altKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      killEvent(e);

      shadow.getElementById("gpt-instruction").focus();

      const direction = e.key === "ArrowDown" ? 1 : -1;

      if (promptKeys.length === 0) {
        chrome.storage.local.get("savedPrompts", (data) => {
          promptStore = data.savedPrompts || {};
          promptKeys = Object.keys(promptStore);
          cyclePrompt(direction);
        });
      } else {
        cyclePrompt(direction);
      }
    }
  };

  document.addEventListener("keydown", cyclePromptHandler, true); // ✅ Use capture phase

  cleanupFns.push(() => document.removeEventListener("keydown", cyclePromptHandler, true));

  function cyclePrompt(direction) {
    if (promptKeys.length === 0) return;

    promptIndex = (promptIndex + direction + promptKeys.length) % promptKeys.length;
    const key = promptKeys[promptIndex];

    const value = promptStore[key];
    if (value !== undefined) {
      shadow.getElementById("gpt-instruction").value = value;
      dropdownBtn.textContent = key;
      dropdownBtn.title = key;
    }
  }



  // ---------- Cmd + ↑ / ↓ to cycle model dropdown ----------
  let modelIndex = MODEL_OPTIONS.findIndex(opt => opt.id === selectedModelId);

  const cycleModelHandler = e => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const meta = isMac ? e.metaKey : e.ctrlKey;
    const alt = e.altKey;

    if (meta && alt && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      killEvent(e);

      shadow.getElementById("gpt-instruction").focus();

      const direction = e.key === "ArrowDown" ? 1 : -1;
      modelIndex = (modelIndex + direction + MODEL_OPTIONS.length) % MODEL_OPTIONS.length;

      const next = MODEL_OPTIONS[modelIndex];
      selectedModelId = next.id;
      modelDropdownBtn.textContent = next.label;
      modelDropdownBtn.title = next.label;
    }
  };

  document.addEventListener("keydown", cycleModelHandler, true); 
  cleanupFns.push(() => document.removeEventListener("keydown", cycleModelHandler, true));

  
  // ---------- Cmd + Shift + ← / → to switch tabs ----------
  
  const switchTabHandler = e => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const meta = isMac ? e.metaKey : e.ctrlKey;

    if (meta && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      killEvent(e);

      if (tabOrder.length <= 1) return;

      const direction = e.key === "ArrowRight" ? 1 : -1;
      currentTabIndex = (currentTabIndex + direction + tabOrder.length) % tabOrder.length;

      const nextTabId = tabOrder[currentTabIndex];
      const tabBarButtons = [...shadow.getElementById("tab-bar").children];

      const nextButton = tabBarButtons.find(btn =>
        btn.textContent.trim().startsWith(nextTabId.split("-")[1])
      );

      nextButton?.click();
    }
  };

  document.addEventListener("keydown", switchTabHandler, true);
  cleanupFns.push(() => document.removeEventListener("keydown", switchTabHandler, true));
}

