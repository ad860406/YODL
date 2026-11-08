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

    document.querySelectorAll("video").forEach((v) => {
      const fuentes = [
        v.currentSrc,
        v.src,
        ...Array.from(v.querySelectorAll("source")).map((s) => s.src || s.srcset?.split(",")[0]?.trim().split(" ")[0]),
      ];
      fuentes.forEach((f) => f && agregar(f, "video", v));
    });

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
    }
  });
})();
