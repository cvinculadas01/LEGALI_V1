// ============================================================
// LEGALI v3.1 — js/docx.iife.js
// Loader de la librería docx para exportar Word.
// Usa el build UMD/IIFE correcto (no ES module).
// ============================================================

(function() {
  'use strict';

  if (typeof window.docx !== 'undefined') return;

  window._docxReady = new Promise(function(resolve, reject) {
    var script = document.createElement('script');
    // UMD build correcto — no usa 'export', compatible con script tag
    script.src = 'https://cdn.jsdelivr.net/npm/docx@8/build/index.umd.js';
    script.onload = function() {
      console.log('[LEGALI] docx.js cargado desde CDN');
      resolve(window.docx);
    };
    script.onerror = function() {
      console.warn('[LEGALI] No se pudo cargar docx.js — exportar Word no disponible');
      window.docx = {
        Document:      function() {},
        Packer:        { toBlob: async function() { throw new Error('docx no disponible'); } },
        Paragraph:     function() {},
        TextRun:       function() {},
        HeadingLevel:  {},
        AlignmentType: {},
      };
      resolve(window.docx);
    };
    document.head.appendChild(script);
  });
})();
