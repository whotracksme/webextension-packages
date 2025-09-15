if (window.outerWidth === 0) {
  Object.defineProperty(window, 'outerWidth', {
    get: () => 1920,
    configurable: true,
  });
}

if (window.outerHeight === 0) {
  Object.defineProperty(window, 'outerHeight', {
    get: () => 1080,
    configurable: true,
  });
}
