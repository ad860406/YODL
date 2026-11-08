// content.js — busca elementos <video> y <source> en la página y los reporta.
// Corre dentro de la página (con tu sesión iniciada), así que ve los videos reales.

(function () {
  if (window.__yodlInjected) return;
  window.__yodlInjected = true;

  let ultNotifica = 0;

  function limpiar(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      // quitar query no necesaria en algunos casos
      return u.href;
    } catch {
      return url;
    }
  }

  function recolectarVideos() {
    const lista = [];
    const vistos = new Set();

    function agregar(url, tipo, contenedor) {
      const limpia = limpiar(url);
      if (!limpia || vistos.has(limpia)) return;
      vistos.add(limpia);
      lista.push({ url: limpia, tipo, tag: contenedor });
    }

    function videosDe(raiz) {
      return raiz.querySelectorAll("video");
    }

    // (A) video dentro del visor de stories/visitor dialog (prioridad)
    const viewer = document.querySelector("#viewer_dialog, [data-testviewer='dialog'], [role='dialog']");
    if (viewer) {
      videosDe(viewer).forEach((v) => {
        const fuentes = [v.currentSrc, v.src, ...Array.from(v.querySelectorAll("source")).map((s) => s.src)];
        fuentes.forEach((f) => {
          if (!f) return;
          agregar(f, f.startsWith("blob:") ? "story(blob)" : "story", v);
        });
      });
    }

    // (B) todos los video de la página
    document.querySelectorAll("video").forEach((v) => {
      const fuentes = [
        v.currentSrc,
        v.src,
        ...Array.from(v.querySelectorAll("source")).map((s) => s.src || s.srcset?.split(",")[0]?.trim().split(" ")[0]),
      ];
      fuentes.forEach((f) => f && agregar(f, f.startsWith("blob:") ? "video(blob)" : "video", v));
    });

    // iframes del mismo origen
    document.querySelectorAll("iframe").forEach((iv) => {
      try {
        if (!iv.contentDocument) return;
        iv.contentDocument.querySelectorAll("video").forEach((v) => {
          const fuentes = [v.currentSrc, v.src, ...Array.from(v.querySelectorAll("source")).map((s) => s.src)];
          fuentes.forEach((f) => f && agregar(f, "video(iframe)", v));
        });
      } catch (e) {
        /* cross-origin: skip */
      }
    });

    // entradas de rendimiento (recursos que ya se descargaron)
    try {
      performance.getEntriesByType("resource").forEach((e) => {
        if (/\.mp4|\.m3u8|video|videoplayback/i.test(e.name)) agregar(e.name, "network", null);
      });
    } catch (e) {}

    // <a href="...mp4"> o <meta og:video>
    document.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]').forEach((m) =>
      agregar(m.content, "og:video", m)
    );
    document.querySelectorAll("a[href*='.mp4'], a[href*='video']").forEach((a) => {
      if (a.href) agregar(a.href, "link", a);
    });

    return lista;
  }

  function notificar() {
    const vids = recolectarVideos();
    const ahora = Date.now();
    if (ahora - ultNotifica < 1500) return; // evitar spam
    ultNotifica = ahora;
    chrome.runtime.sendMessage({ type: "YODL_VIDEOS", videos: vids }).catch(() => {});
  }

  // cada 1.5s mira si hay videos nuevos (stories/reels se montan dinámicamente)
  setInterval(notificar, 1500);
  window.addEventListener("load", notificar);
  setTimeout(notificar, 3000);

  // permitir al popup pedir la lista on-demand
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "YODL_PEDIR_VIDEOS") {
      sendResponse({ videos: recolectarVideos() });
      return;
    }
    // devolver la URL del <video> que se está reproduciendo
    if (msg && msg.type === "YODL_ACTIVO") {
      const videos = document.querySelectorAll("video");
      let mejor = null;
      videos.forEach((v) => {
        if (mejor) return;
        const tocando = !v.paused && v.currentTime > 0 && !v.ended;
        if ((tocando || !v.paused) && (v.currentSrc || v.src)) {
          mejor = v;
        }
      });
      sendResponse({ video: mejor ? { currentSrc: mejor.currentSrc || mejor.src, src: mejor.src } : null });
      return;
    }
    // descargar un blob: convirtiéndolo a data URL
    if (msg && msg.type === "YODL_BLOB") {
      capturarBlob(msg.url, msg.filename)
        .then((dato) => sendResponse({ ok: true, ...dato }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    // grabar en vivo el <video> que se reproduce (para contenido MSE/blob sin URL directa)
    if (msg && (msg.type === "YODL_REC_START" || msg.type === "YODL_REC_STOP")) {
      manejarGrabacion(msg.type === "YODL_REC_START", msg.filename);
      sendResponse({ ok: true });
    }
  });

  // ---------- Grabación en vivo del video ----------
  let grabador = null;
  let fuenteStream = null;
  let grabandoTipo = "video/mp4";

  async function manejarGrabacion(iniciar, filename) {
    if (iniciar) {
      if (grabador) return;
      const video = buscarVideoActivo();
      if (!video) throw new Error("No hay video en reproducción.");
      try {
        if (video.captureStream) {
          fuenteStream = typeof video.captureStream === "function" ? video.captureStream() : video.webkitCaptureStream();
        } else {
          throw new Error("captureStream no soportado");
        }
        // el stream puede venir sin audio en algunos casos
        const mimetype = "video/mp4;codecs=avc1.42E01E,mp4a.40.2";
        grabandoTipo = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm";
        const opciones = { mimeType: MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : undefined };
        grabador = new MediaRecorder(fuenteStream, opciones);
        const chunks = [];
        grabador.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        grabador.onstop = () => {
          const blob = new Blob(chunks, { type: grabandoTipo });
          const ext = grabandoTipo.includes("webm") ? "webm" : "mp4";
          descargarBlobLocal(blob, (filename || `video_grabado`).replace(/\.[^.]+$/, "") + "." + ext);
          grabador = null;
        };
        grabador.start(500);
        return true;
      } catch (e) {
        throw e;
      }
    } else {
      if (grabador) grabador.stop();
      return true;
    }
  }

  function buscarVideoActivo() {
    // el video con más tiempo reproducido / el que está tocando
    let mejor = null;
    let mayor = -1;
    document.querySelectorAll("video").forEach((v) => {
      const tocando = !v.paused && v.currentTime > 0 && !v.ended && v.currentTime > mayor;
      if (tocando) { mejor = v; mayor = v.currentTime; }
    });
    if (!mejor) {
      document.querySelectorAll("video").forEach((v) => {
        if (v.currentTime > mayor) { mejor = v; mayor = v.currentTime; }
      });
    }
    return mejor;
  }

  function descargarBlobLocal(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  async function capturarBlob(blobUrl, filename) {
    const resp = await fetch(blobUrl);
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve({ dataUrl: fr.result, type: blob.type, filename });
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }
})();
