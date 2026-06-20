
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

function buildResultFilename(platform = 'unknown', now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const datePart = `${pad(now.getDate())}_${pad(now.getMonth() + 1)}_${now.getFullYear()}`;
  const safePlatform = String(platform || 'unknown').trim().toLowerCase() || 'unknown';
  return `${safePlatform}_result_${datePart}.jsonl`;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadJsonl') {
    try {
      const blob = new Blob([request.content || ''], { type: 'application/x-ndjson;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({
        url,
        filename: request.filename || buildResultFilename(request.platform || 'unknown'),
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId });
        }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  if (request.action === 'sendPostToServer') {
    fetch('http://localhost:8080/api/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request.data)
    })
    .then(response => {
      if (response.ok) {
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, status: response.status });
      }
    })
    .catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // Указывает, что ответ будет отправлен асинхронно
  }
});

