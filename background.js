// background.js



// Listen for messages (e.g., for OpenAI API calls or saving to Notion)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle OpenAI API calls
  if (message.action === "callOpenAI") {
    const { prompt, text, model, chatHistory } = message;

    console.log("Received request to call OpenAI");

    const systemMessage = {
      role: "system",
      content: `
        Your name is CO-Researcher, an ai assistent created by UL Standards and Engagement's Data Science and Englineering Team, Your role is to assist users in analyzing content on clipboard or answering questions from a safety science perspective. Ensuring clarity and readability (organized in nice formatting)

        ### Format Guideline

        #### 1. Headings 
        #
        ## 
        ###

        ## 2. Equation and Symbol Formatting (KaTeX)

        Use KaTeX syntax only (MUST bounded by $ signs):

        * **Inline formulas**: wrap with single '$', must be on the same line
          Example: $E = mc^2$

        * **Block formulas**: wrap with double '$$', can be on the same line or separate lines
          Example: $$E = mc^2$$
        

        ❌ No unsupported LaTeX, no line breaks in inline formulas.

        #### 3. Text Formatting
        *italic* or _italic_  
        **bold** or __bold__  
        ***bold italic***  
        ~~strikethrough~~

        #### 4. Lists

        ##### Unordered List
        - Item A
        - Item B
          - Nested Item B1
          - Nested Item B2
        * Alternative bullet  
        + Another style

        ##### Ordered List
        1. First item  
        2. Second item  
          1. Sub-item  
          2. Sub-item

        #### 5. Links
        [Link Text](https://example.com)  
        [Link with title](https://example.com "Optional Title")

        #### 6. Blockquote
        > This is a blockquote.  
        > - Can contain multiple lines  
        > - Even lists

        #### 7. Horizontal Rule
        ---
        ***
        ___

        #### 8. Tables

        | Header 1 | Header 2 |
        |----------|----------|
        | Row 1    | Data     |
        | Row 2    | Data     |
        #### 9. Conversation:
        - If this is a conversation, make sure the format is consistent.

        #### 10. Other Reference information:
        [Todays Date and Time: ${new Date().toLocaleString()}]

      `
    };///new Date().toISOString().split("T")[0]

    const messages = chatHistory
      ? [
          systemMessage,
          {
            role: "user",
            content:
              "Here are previous conversation:\n\n" +
              chatHistory.map(m => `**${m.role}**:\n${m.content}`).join("\n\n---\n\n")
          },
          { role: "user", content: `${prompt}\n\n${text}` }
        ]
      : [
          systemMessage,
          { role: "user", content: `${prompt}\n\n${text}` }
        ];

    fetch(
      `Replace_with_your_own_endpoint/openai/deployments/${model}/chat/completions?api-version=Replace_with_your_own_version`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": "Replace_with_your_own_key"
        },
        body: JSON.stringify({ messages })
      }
    )
      .then(res => res.json())
      .then(data => sendResponse({ success: true, content: data.choices?.[0]?.message?.content }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true; // keep the message channel open
  }
});

// Inject panel or send message on page load if setting is enabled
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  chrome.storage.sync.get(["autoOpenContent", "siteOverrides"], (data) => {
    const overrides = data.siteOverrides || {};
    const match = matchSiteOverride(tab.url, overrides);

    const shouldOpen =
      match?.autoOpen ?? data.autoOpenContent;

    if (shouldOpen) {
      chrome.tabs.sendMessage(tabId, { action: "openPanel" }, () => {
        if (chrome.runtime.lastError) {
          console.warn("Panel injection failed:", chrome.runtime.lastError.message);
        }
      });
    }
  });
});

// Wildcard match function
function matchSiteOverride(url, overrides) {
  for (const pattern in overrides) {
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*") +
        "$"
    );
    if (regex.test(url)) return overrides[pattern];
  }
  return null;
}
