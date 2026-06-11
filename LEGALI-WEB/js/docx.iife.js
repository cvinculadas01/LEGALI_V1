// ============================================================
// LEGALI v2.0 — js/docx.iife.js
// Loader de la librería docx para exportar Word.
// Carga desde CDN si no está disponible localmente.
// ============================================================
// INSTRUCCIÓN: Este archivo es un puente temporal.
// Para producción, descarga el bundle real:
//   https://cdn.jsdelivr.net/npm/docx@8/build/index.js
// y reemplaza este archivo con ese contenido (~700KB).
// ============================================================

(function() {
  'use strict';

  // Si docx ya está cargado (bundle completo), no hacer nada
  if (typeof window.docx !== 'undefined') return;

  // Cargar desde CDN de forma síncrona-bloqueante no es posible,
  // así que usamos un script tag dinámico y un Promise global
  window._docxReady = new Promise(function(resolve, reject) {
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/docx@8/build/index.js';
    script.onload = function() {
      console.log('[LEGALI] docx.js cargado desde CDN');
      resolve(window.docx);
    };
    script.onerror = function() {
      console.warn('[LEGALI] No se pudo cargar docx.js — exportar Word no disponible');
      // Crear stub para que app.js no rompa
      window.docx = {
        Document: function() {},
        Packer:   { toBlob: async function() { throw new Error('docx no disponible'); } },
        Paragraph: function() {},
        TextRun:   function() {},
        HeadingLevel: {},
        AlignmentType: {},
      };
      resolve(window.docx);
    };
    document.head.appendChild(script);
  });
})();
