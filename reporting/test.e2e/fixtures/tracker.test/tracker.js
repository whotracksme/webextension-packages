(function () {
  try {
    document.cookie = 'tid=' + Math.random().toString(16).slice(2) + '; path=/';
  } catch (e) {
    // ignore: some browsers reject document.cookie writes in this context
  }
  var img = new Image();
  img.src = 'http://tracker.test:3300/pixel.gif?from=script&t=' + Date.now();
})();
