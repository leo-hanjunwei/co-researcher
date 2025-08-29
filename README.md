# CO-Researcher
<p align="center"> <img width="2048" height="1031" alt="image" src="https://github.com/user-attachments/assets/a6631f19-ee9d-4916-b8c1-8dec44c345f7" /> </p>

<p align="center"> <img width="436" height="1018" alt="image" src="https://github.com/user-attachments/assets/f937ec41-ce54-4576-b59c-14c6303171b4" /> </p>

**CO-Researcher** is a browser-embedded AI assistant. Its core purpose is to **streamline the “last-mile” data analysis process** by allowing users to query and extract insights from large volumes of structured or unstructured data.

Whether you're working with copied text, internal documents, or ad-hoc questions, **CO-Researcher** helps bridge the gap between data and actionable insight.

---


## 1. Configuration Requirements

Before using **CO-Researcher**, you need to replace several placeholders with your own API details. These are located in the source files:

### In `background.js`

* **Endpoint and Version Placeholder:**

  ```
  Replace_with_your_own_endpoint/openai/deployments/${model}/chat/completions?api-version=Replace_with_your_own_version
  ```
* **Token Placeholder:**

  ```
  Replace_with_your_own_key
  ```

### In `modelList.js`

* **Model ID Placeholder:**

  ```
  Your_own_model_id
  ```

Be sure to replace all three placeholders with valid values from your own AI API provider before running the extension.

---

## 2. Key Features

### Saved Prompt Dropdown

Avoid repetitive typing and maintain consistency in your queries by saving commonly used prompts.

* **Case-by-Case Prompts:** Save prompts you reuse frequently.
* **Universal Templates:** Build general-purpose prompts with placeholders that can be adapted per use case.

---

### Keyboard Shortcuts

Boost your workflow with built-in shortcuts. Use them regularly to speed up repetitive tasks and keep your hands on the keyboard.

---

### Output Formatting

Specify the structure of responses for better readability.

* Request formats naturally (e.g., “present results in a table”).
* Use KaTeX/LaTeX for equations and advanced formatting.

---

### Clipboard Mode vs. Question Mode

* **Clipboard Mode:** Query copied content (emails, reports, code, etc.).
* **Question Mode:** Direct ad-hoc or follow-up questions.

**Recommended Workflow:**

1. Start in **Clipboard Mode** to load primary content.
2. Switch to **Question Mode** for follow-ups without reloading data.

---

### Clean Chats with Tab Deletion

Unlike most LLM chat tools, **CO-Researcher** lets you delete individual response tabs to avoid “chat pollution” from irrelevant or off-track answers.

---

### Continue / Isolate Toggle

Control whether your query:

* **Continues** the current conversation with memory context, or
* Runs as an **Isolated** side query without influence from prior chats.

---

## 3. Setup

### Activation Shortcut

You can assign a custom shortcut to launch **CO-Researcher** instantly:

1. Go to **Manage Extensions** in your browser.
2. Select **Keyboard Shortcuts**.
3. Find **CO-Researcher** in the list.
4. Define your preferred key combination.

---

## 4. Built-In Shortcuts

| **Action**                             | **Shortcut**           |
| -------------------------------------- | ---------------------- |
| Switch between analysis modes          | `Cmd + Shift + ↑ / ↓`  |
| Cycle through saved prompts            | `Cmd + ↑ / ↓`          |
| Switch between AI models               | `Cmd + Option + ↑ / ↓` |
| Submit request (Clipboard or Question) | `Cmd + Enter`          |
| Navigate between response tabs         | `Cmd + Shift + ← / →`  |
| Expand / Collapse interface            | `Cmd + H`              |
| Hide / Show input pane                 | `Cmd + J`              |

---

## 5. Interaction Modes

### Clipboard Mode

* Ask questions based on copied content.
* Ideal for structured (tables, code) or unstructured (emails, reports) text.

### Question Mode

* Direct input for ad-hoc or follow-up questions.
* Great for iterative exploration.

---

## 6. Functionality Highlights

* **Model Selection Dropdown** – Switch between supported LLMs.
* **Saved Prompt System** – Save, reuse, and manage prompts.
* **Expand / Collapse Interface** – Switch between side pane and full-screen.
* **Markdown-Supported Copy** – Copy responses with formatting preserved.
* **Clear Output & Tabs** – Remove all or individual responses.
* **Continue/Isolate Toggle** – Choose context-aware or context-free queries.
* **Hide Input Pane** – Maximize space for outputs.

---

## 7. Formatting Guidelines

**CO-Researcher** supports **Markdown** and **KaTeX** for structured, professional outputs.

### Examples:

* **Headings:** `## Heading`
* **Equations:** `$E = mc^2$`
* **Bold/Italic:** `**bold**`, `*italic*`
* **Lists:** `- Item A`, `1. Item B`
* **Block Quotes:** `> This is a quote`
* **Horizontal Rule:** `---`
* **Tables:**

```
| Header 1 | Header 2 |
|----------|----------|
| Row 1    | Data     |
| Row 2    | Data     |
```

---

## 8. Summary

**CO-Researcher** empowers you to:

* Analyze copied or direct input data.
* Keep conversations clean and relevant.
* Save and reuse prompts for efficiency.
* Toggle between isolated or continuous workflows.
* Control formatting for readability and export.

---

With **CO-Researcher**, you can work faster, cleaner, and more effectively—bridging the gap between data and decision-making.


