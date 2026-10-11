/* Estimates count the reading content, excluding navigation and reader controls. */
(function () {
  'use strict';
  function update(label, prose) {
    if (!prose) return;
    var copy = prose.cloneNode(true);
    copy.querySelectorAll('script, style').forEach(function (element) { element.remove(); });
    copy.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, pre, td, th, br').forEach(function (element) { element.after(' '); });
    var words = (copy.textContent.trim().match(/\S+/g) || []).length;
    var minutes = Math.max(1, Math.ceil(words / 240));
    label.textContent = 'Est. ' + minutes + ' min read';
    label.title = words.toLocaleString() + ' words · estimated at 240 words per minute';
    label.setAttribute('aria-label', 'Estimated reading time: ' + minutes + (minutes === 1 ? ' minute' : ' minutes'));
  }
  document.querySelectorAll('[data-reading-time]').forEach(function (label) {
    var source = label.dataset.readingSource;
    if (!source) { update(label, document.querySelector('.reader-prose')); return; }
    fetch(new URL(source, document.baseURI)).then(function (response) {
      if (!response.ok) throw new Error('Reading content unavailable');
      return response.text();
    }).then(function (html) {
      update(label, new DOMParser().parseFromString(html, 'text/html').querySelector('.reader-prose'));
    }).catch(function () { /* The static estimate remains available offline. */ });
  });
})();
