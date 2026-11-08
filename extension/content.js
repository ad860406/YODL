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
      if (msg.type === "YODL_REC_STOP") {
        if (grabador) grabador.stop();
      } else {
        try {
          crearBotonFloat();
          tratarIniciar(buscarVideoRelevante());
        } catch (e) {
          /* el botón flotante avisa el error */
        }
      }
      sendResponse({ ok: true });
    }
  });

  // ---------- Grabación en vivo del video ----------
  let grabador = null;
  let fuenteStream = null;
  let grabandoTipo = "video/mp4";
  let botonFloat = null;
  let videoActual = null;

  function crearBotonFloat() {
    if (botonFloat) return;
    botonFloat = document.createElement("div");
    botonFloat.textContent = "● GRABAR";
    botonFloat.setAttribute("data-yodl", "1");
    Object.assign(botonFloat.style, {
      position: "fixed",
      zIndex: "2147483647",
      background: "#d93025",
      color: "#fff",
      font: "600 13px system-ui, sans-serif",
      padding: "8px 14px",
      borderRadius: "999px",
      cursor: "pointer",
      boxShadow: "0 2px 10px rgba(0,0,0,.4)",
      userSelect: "none",
      display: "none",
    });
    botonFloat.addEventListener("mouseenter", () => (botonFloat.style.opacity = "1"));
    botonFloat.addEventListener("mouseleave", () => (botonFloat.style.opacity = "0.6"));
    botonFloat.addEventListener("click", (e) => {
      e.stopPropagation();
      if (grabador) {
        grabador.stop();
        botonFloat.textContent = "● GRABAR";
        botonFloat.style.background = "#d93025";
      } else {
        tratarIniciar(videoActual || buscarVideoActivo());
      }
    });
    document.documentElement.appendChild(botonFloat);
  }

  function posicionarBoton(video) {
    if (!botonFloat || !video) return;
    const r = video.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      botonFloat.style.display = "none";
      return;
    }
    Object.assign(botonFloat.style, {
      display: "block",
      top: Math.max(8, r.top + 8) + "px",
      left: Math.max(8, r.right - 140) + "px",
    });
  }

  function buscarVideoRelevante() {
    const videos = document.querySelectorAll("video");
    // el que está tocando o visible (más grande)
    let mejorActivo = null;
    videos.forEach((v) => {
      if (!v.paused && v.currentTime > 0 && !v.ended) mejorActivo = v;
    });
    if (mejorActivo) return mejorActivo;
    let maxArea = 0;
    let grande = null;
    videos.forEach((v) => {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > maxArea) { maxArea = area; grande = v; }
    });
    return grande;
  }

  // vigilar y reposicionar el botón sobre el video visible
  setInterval(() => {
    if (grabador) return; // mientras graba, mantener donde está
    crearBotonFloat();
    const v = buscarVideoRelevante();
    videoActual = v;
    if (v) {
      posicionarBoton(v);
      v.addEventListener &&
        v.addEventListener("scroll", () => posicionarBoton(v), { passive: true });
    } else {
      botonFloat.style.display = "none";
    }
  }, 1200);

  async function tratarIniciar(video) {
    if (!video) return;
    try {
      iniciarGrabacion(video);
      botonFloat.textContent = "■ DETENER";
      botonFloat.style.background = "#1a73e8";
    } catch (e) {
      botonFloat.textContent = "⛔ " + e.message;
      setTimeout(() => (botonFloat.textContent = "● GRABAR"), 2500);
    }
  }

  async function iniciarGrabacion(video) {
    if (grabador) return;
    let stream;
    if (video.captureStream) {
      try {
        stream = video.captureStream();
      } catch {
        stream = video.webkitCaptureStream();
      }
    }
    if (!stream) throw new Error("Sin captureStream");
    const mp4 = MediaRecorder.isTypeSupported("video/mp4");
    grabandoTipo = mp4 ? "video/mp4" : "video/webm";
    const opciones = mp4 ? { mimeType: "video/mp4" } : undefined;
    grabador = new MediaRecorder(stream, opciones);
    const chunks = [];
    grabador.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    grabador.onstop = () => {
      const blob = new Blob(chunks, { type: grabandoTipo });
      const ext = grabandoTipo.includes("webm") ? "webm" : "mp4";
      descargarBlobLocal(blob, "video_grabado." + ext);
      grabador = null;
    };
    grabador.start(500);
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
