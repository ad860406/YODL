// popup.js — muestra los videos detectados y ofrece descarga directa o vía servidor YODL.
const list = document.getElementById("list");
const msg = document.getElementById("msg");
const foot = document.getElementById("foot");

function avisar(texto, err = false) {
  msg.textContent = texto;
  msg.classList.toggle("err", err);
  msg.classList.toggle("msg", true);
}

function nombreDesdeUrl(url) {
  try {
    const u = new URL(url);
    const base = u.pathname.split("/").pop() || "video";
    return base.replace(/[\\/:*?"<>|]/g, "_");
  } catch {
    return "video";
  }
}

function render(videos) {
  if (!videos || !videos.length) {
    list.innerHTML = '<div class="empty">No se detectaron videos aún.<br>Ten el video visible mientras se reproduce.</div>';
    return;
  }
  foot.textContent = videos.length + (videos.length === 1 ? " video detectado" : " videos detectados");
  list.innerHTML = "";
  videos.forEach((v) => {
    const card = document.createElement("div");
    card.className = "video";
    const host = (() => {
      try { return new URL(v.url).hostname; } catch { return ""; }
    })();
    card.innerHTML = `
      <span class="tag">${host}</span><span>${v.tipo || "video"}</span>
      <div class="url">${v.url}</div>
      <div class="btns">
        <button class="b-video" data-act="descargar">Descargar MP4</button>
        <button class="b-audio" data-act="mp3">Enviar MP3 a YODL</button>
      </div>`;
    card.querySelector('[data-act="descargar"]').addEventListener("click", () => {
      avisar("Descargando...");
      chrome.runtime.sendMessage({ type: "YODL_DESCARGAR", url: v.url, filename: nombreDesdeUrl(v.url) }, (r) => {
        if (r && r.ok) avisar("✅ Descarga iniciada.");
        else avisar("❌ Error: " + (r?.error || ""), true);
      });
    });
    card.querySelector('[data-act="mp3"]').addEventListener("click", () => {
      avisar("Enviando al servidor YODL (MP3)...");
      chrome.runtime.sendMessage({ type: "YODL_SERVIDOR", url: v.url, tipo: "audio" }, (r) => {
        if (r && r.ok) avisar("✅ Agregado a la cola de YODL (MP3).");
        else avisar("❌ No conecta con YODL. ¿Servidor iniciado?", true);
      });
    });
    list.appendChild(card);
  });
}

function actualizar() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) return;
    // envía mensaje al content script para pedir la lista actual
    chrome.tabs.sendMessage(tab.id, { type: "YODL_PEDIR_VIDEOS" }, (resp) => {
      if (chrome.runtime.lastError) {
        // sin content script; intentar inyección
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }, () => {
          if (chrome.runtime.lastError) {
            list.innerHTML = '<div class="empty">Esta página no permite inyección.</div>';
            return;
          }
          setTimeout(actualizar, 300);
        });
        return;
      }
      render(resp && resp.videos);
    });
  });
}

actualizar();
setInterval(actualizar, 2000);
