window.MathJax = {
  loader: { load: ['[tex]/safe'] },
  tex: {
    inlineMath: [['$', '$'], ['\\(', '\\)']],
    displayMath: [['$$', '$$'], ['\\[', '\\]']],
    processEscapes: true,
    packages: { '[+]': ['safe'] },
  },
  options: {
    safeOptions: {
      allow: { URLs: 'safe', classes: 'none', cssIDs: 'none', styles: 'none' },
    },
  },
  startup: { typeset: false },
};

window.addEventListener('load', () => {
  window.MathJax?.startup?.promise?.then(() => {
    window.dispatchEvent(new Event('mathjax-ready'));
  }).catch(() => {});
});
