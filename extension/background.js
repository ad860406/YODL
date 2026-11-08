// background.js — recibe la petición de descargar y lanza chrome.downloads
// También captura peticiones de red de video (webRequest) para detectar MP4 aunque usen blob/iframe.

const videosDetectados = new Map(); // url -> {url, tipo, hora}

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

// Capturar peticiones de red que parezcan video
function esVideo(url, tipo) {
  if (tipo === "media") return true;
  const u = (url || "").toLowerCase();
  return /\.mp4|\.m3u8|video|videoplayback|\.dash|\/hls\//.test(u);
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!esVideo(details.url, details.type)) return;
    {
      const info = { url: details.url, tipo: details.type || "media", hora: Date.now() };
      videosDetectados.set(details.url, info);
      // notificar a popup si está abierto
      chrome.runtime.sendMessage({ type: "YODL_NUEVOS", video: info }).catch(() => {});
    }
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

// entregar lista acumulada
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "YODL_RED") {
    const ahora = Date.now();
    const lista = [...videosDetectados.values()]
      .filter((v) => ahora - v.hora < 10 * 60 * 1000)
      .slice()
      .reverse();
    sendResponse({ videos: lista });
  }
});
