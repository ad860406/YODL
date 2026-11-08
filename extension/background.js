// background.js — recibe la petición de descargar y lanza chrome.downloads
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "YODL_DESCARGAR") return;
  const { url, filename } = msg;

  const ext = (filename || "").split(".").pop()?.toLowerCase() || "mp4";
  const nombre = filename || `video_${Date.now()}.${ext}`;

  chrome.downloads
    .download({ url, filename: nombre, saveAs: false })
    .then((id) => sendResponse({ ok: true, id }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // sendResponse asíncrono
});

// descarga hacia el servidor YODL mediante fetch
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "YODL_SERVIDOR") return;
  const { url, tipo } = msg;
  const target = "http://127.0.0.1:8790/api/descargar";
  fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, tipo }),
  })
    .then((r) => r.json())
    .then((d) => sendResponse({ ok: true, data: d }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
