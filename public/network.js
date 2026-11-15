// A small pill, bottom right, when the connection drops: typing keeps saving locally in the page and
// retries when it's back.
(() => {
  const pill = document.getElementById('net-pill');
  if (!pill) return;
  const update = () => {
    pill.hidden = navigator.onLine;
  };
  addEventListener('online', update);
  addEventListener('offline', update);
  update();
})();
