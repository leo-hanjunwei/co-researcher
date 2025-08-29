(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { action: "togglePane" });
    window.close(); // Close the popup immediately
  } catch (err) {
    alert("This extension only works on regular webpages (not chrome:// or new tab).");
  }
})();
