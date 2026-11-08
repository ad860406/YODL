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
    list.innerHTML = '<div class="empty">No se detectaron videos aún.<br>Reproduce el video en la página.</div>';
    return;
  }
  // prioridad: story real > video > network (evitar ruido de red)
  const peso = (t) =>
    (t || "").includes("story") ? 0 : (t || "").includes("video") || (t || "").includes("og") ? 1 : 2;
  videos.sort((a, b) => peso(a.tipo) - peso(b.tipo));
  foot.textContent = videos.length + (videos.length === 1 ? " video detectado" : " videos detectados");
  list.innerHTML = "";
  videos.forEach((v) => {
    const card = document.createElement("div");
    card.className = "video";
    const host = (() => {
      try { return new URL(v.url).hostname; } catch { return ""; }
    })();
    const blobTag = v.url.startsWith("blob:") ? '<span class="tag" style="background:#322;color:#ffd08f">blob</span>' : "";
    card.innerHTML = `
      <span class="tag">${host}</span><span>${v.tipo || "video"}</span>${blobTag}
      <div class="url">${v.url}</div>
      <div class="btns">
        <button class="b-video" data-act="descargar">Descargar MP4</button>
        <button class="b-audio" data-act="mp3">Enviar MP3 a YODL</button>
      </div>`;
    card.querySelector('[data-act="descargar"]').addEventListener("click", () => {
      avisar("Preparando descarga...");
      if (v.url.startsWith("blob:")) {
        // convertirlo a data URL en la página y luego descargar
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs[0];
          if (!tab || !tab.id) return;
          chrome.tabs.sendMessage(tab.id, { type: "YODL_BLOB", url: v.url, filename: nombreDesdeUrl(v.url) }, (r) => {
            if (r && r.ok && r.dataUrl) {
              chrome.runtime.sendMessage(
                { type: "YODL_DESCARGAR", dataUrl: r.dataUrl, filename: r.filename || "video.mp4", mime: r.type },
                (resp) => {
                  if (resp && resp.ok) avisar("✅ Descarga (blob) iniciada.");
                  else avisar("❌ Error blob: " + (resp?.error || ""), true);
                }
              );
            } else {
              avisar("❌ No se pudo leer el blob: " + (r?.error || ""), true);
            }
          });
        });
        return;
      }
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
  // 1) videos del content script (elementos <video>)
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "YODL_PEDIR_VIDEOS" }, (resp) => {
      if (chrome.runtime.lastError) {
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }, () => {
          if (chrome.runtime.lastError) {
            // sin permiso en la página: usar solo la lista de red
          }
        });
        return;
      }
      // 2) videos capturados por la red (webRequest)
      chrome.runtime.sendMessage({ type: "YODL_RED" }, (resp2) => {
        const unificar = [];
        const seen = new Set();
        (resp2?.videos || []).forEach((v) => { unificar.push(v); seen.add(v.url); });
        (resp?.videos || []).forEach((v) => { if (!seen.has(v.url)) unificar.push(v); });
        render(unificar);
      });
    });
  });
}

actualizar();
setInterval(actualizar, 2000);
