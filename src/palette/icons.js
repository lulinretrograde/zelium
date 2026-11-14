/**
 * Tiny inline icon set: 16×16, 1.5px strokes, square caps and mitred joins
 * (sharp, to match the Zed look). Built with createElementNS so it works on
 * pages that enforce Trusted Types.
 */
(() => {
  const Z = (globalThis.Zelium ??= {});
  const NS = 'http://www.w3.org/2000/svg';

  const ring = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

  const PATHS = {
    tab: ['M2 3.5h12v9H2z', 'M2 6.5h5.5V3.5'],
    globe: [ring(8, 8, 6), 'M2 8h12', 'M8 2c2.4 2.2 2.4 9.8 0 12', 'M8 2c-2.4 2.2-2.4 9.8 0 12'],
    bookmark: ['M4 2h8v12l-4-3-4 3z'],
    history: [ring(8, 8, 6), 'M8 4.5V8l2.5 2'],
    command: ['M3 4l4 4-4 4', 'M8.5 12H13'],
    search: [ring(7, 7, 4.5), 'M10.5 10.5L14 14'],
    calc: ['M3 2h10v12H3z', 'M5 5h6', 'M5.5 8.5h1', 'M9.5 8.5h1', 'M5.5 11h1', 'M9.5 11h1'],
    link: ['M6.5 3H3v10h10V9.5', 'M9 2h5v5', 'M14 2L7.5 8.5'],
    bang: ['M8 2.5v7.5', 'M8 12.5V14'],
    close: ['M4 4l8 8', 'M12 4l-8 8'],
    closeOthers: ['M2 3.5h12v9H2z', 'M6 6l4 4', 'M10 6l-4 4'],
    closeRight: ['M3 3v10', 'M6 8h8', 'M11 5l3 3-3 3'],
    dupes: ['M5 5h9v9H5z', 'M2 11V2h9', 'M7.5 7.5l4 4', 'M11.5 7.5l-4 4'],
    pin: ['M6 2h4l-.5 4.5L12 9H4l2.5-2.5z', 'M8 9v5'],
    volume: ['M2 6h3l4-3v10l-4-3H2z', 'M11 6c1 1 1 3 0 4', 'M12.8 4.2c2.1 2.1 2.1 5.5 0 7.6'],
    mute: ['M2 6h3l4-3v10l-4-3H2z', 'M11 6l4 4', 'M15 6l-4 4'],
    copy: ['M5 5h9v9H5z', 'M2 11V2h9'],
    reload: ['M13 8a5 5 0 1 1-1.46-3.54', 'M13.5 2v3.5H10'],
    window: ['M2 3h12v10H2z', 'M2 6h12'],
    moveWindow: ['M2 3h12v10H2z', 'M2 6h12', 'M6 9.5h5', 'M9 7.5l2 2-2 2'],
    restore: ['M5 3L2 6l3 3', 'M2 6h8a3.5 3.5 0 0 1 0 7H6'],
    plus: ['M8 3v10', 'M3 8h10'],
    incognito: ['M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4z', 'M2 2l12 12'],
    sort: ['M4 2.5v11', 'M2 11.5l2 2 2-2', 'M8 4h6', 'M8 8h4', 'M8 12h2'],
    zoomIn: [ring(7, 7, 4.5), 'M10.5 10.5L14 14', 'M5 7h4', 'M7 5v4'],
    zoomOut: [ring(7, 7, 4.5), 'M10.5 10.5L14 14', 'M5 7h4'],
    zoomReset: [ring(7, 7, 4.5), 'M10.5 10.5L14 14', 'M5.5 7h3'],
    download: ['M8 2v8.5', 'M4.5 7l3.5 3.5L11.5 7', 'M2 14h12'],
    grid: ['M2.5 2.5h4.5v4.5H2.5z', 'M9 2.5h4.5v4.5H9z', 'M2.5 9h4.5v4.5H2.5z', 'M9 9h4.5v4.5H9z'],
    settings: ['M2 4h12', 'M2 8h12', 'M2 12h12', 'M5 2.5v3', 'M11 6.5v3', 'M7 10.5v3'],
    keyboard: ['M1.5 4h13v8h-13z', 'M4 6.5h1', 'M7.5 6.5h1', 'M11 6.5h1', 'M4.5 9.5h7'],
    markdown: ['M1.5 4h13v8h-13z', 'M3.5 10V6l2 2 2-2v4', 'M11 6v4', 'M9.5 8.5l1.5 1.5 1.5-1.5'],
    text: ['M3 3h10', 'M8 3v10', 'M6 13h4'],
  };

  function icon(name) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'square');
    svg.setAttribute('stroke-linejoin', 'miter');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of PATHS[name] || PATHS.command) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
  }

  Z.icons = { icon, names: Object.keys(PATHS) };
})();
