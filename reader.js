(function () {
  'use strict';
  var root = document.documentElement;
  var article = document.querySelector('.reader-article');
  var prose = document.querySelector('.reader-prose');
  if (!article || !prose) return;
  var defaults = { theme: 'paper', font: 'serif', size: 20, width: 'standard' };
  var measures = { narrow: '55ch', standard: '65ch', wide: '75ch' };
  function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }
  var stored = read('t-lind-reader-preferences') || {};
  var preferences = {
    theme: ['paper', 'dusk', 'night'].includes(stored.theme) ? stored.theme : defaults.theme,
    font: ['serif', 'sans'].includes(stored.font) ? stored.font : defaults.font,
    size: Number.isFinite(stored.size) ? Math.max(16, Math.min(28, stored.size)) : defaults.size,
    width: Object.hasOwn(measures, stored.width) ? stored.width : defaults.width
  };
  var settings = document.querySelector('.reader-settings');
  var focusButton = document.querySelector('[data-reader-focus]');
  var exitButton = document.querySelector('.reader-focus-exit');
  var resumeButton = document.querySelector('.reader-resume');
  var fill = document.querySelector('.reader-progress-fill');
  var progressLabel = document.querySelector('.reader-progress-label');
  var positionKey = 't-lind-reader-position:' + location.pathname;
  var previousPosition = read(positionKey);
  var blocks = Array.from(prose.querySelectorAll('p, h2, h3')).filter(function (el) { return !el.closest('blockquote'); });
  blocks.forEach(function (el, index) { if (!el.id) el.id = 'paragraph-' + (index + 1); });
  function visibleBlock() {
    return blocks.find(function (el) { return el.getBoundingClientRect().bottom > 100; }) || blocks[blocks.length - 1];
  }
  function keepPlace(change) {
    var block = visibleBlock();
    var offset = block ? block.getBoundingClientRect().top : 0;
    var reading = prose.getBoundingClientRect().top < 100;
    change();
    if (reading && block) window.scrollBy(0, block.getBoundingClientRect().top - offset);
    updateProgress();
  }
  function applyPreferences() {
    root.dataset.readerTheme = preferences.theme;
    root.dataset.readerFont = preferences.font;
    root.style.setProperty('--reader-size', preferences.size + 'px');
    root.style.setProperty('--reader-measure', measures[preferences.width]);
    document.querySelectorAll('[data-reader-preference]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(preferences[button.dataset.readerPreference] === button.dataset.value));
    });
    document.querySelector('[data-reader-size-output]').textContent = preferences.size + ' px';
    document.querySelector('[data-reader-size="-2"]').disabled = preferences.size <= 16;
    document.querySelector('[data-reader-size="2"]').disabled = preferences.size >= 28;
    save('t-lind-reader-preferences', preferences);
  }
  document.querySelectorAll('[data-reader-preference]').forEach(function (button) {
    button.addEventListener('click', function () {
      keepPlace(function () { preferences[button.dataset.readerPreference] = button.dataset.value; applyPreferences(); });
    });
  });
  document.querySelectorAll('[data-reader-size]').forEach(function (button) {
    button.addEventListener('click', function () {
      keepPlace(function () { preferences.size = Math.max(16, Math.min(28, preferences.size + Number(button.dataset.readerSize))); applyPreferences(); });
    });
  });
  document.querySelector('[data-reader-reset]').addEventListener('click', function () {
    keepPlace(function () { preferences = Object.assign({}, defaults); applyPreferences(); });
  });
  function setFocus(enabled) {
    if (settings) settings.open = false;
    keepPlace(function () {
      document.body.classList.toggle('reader-focused', enabled);
      focusButton.setAttribute('aria-pressed', String(enabled));
      exitButton.hidden = !enabled;
    });
    (enabled ? exitButton : focusButton).focus({ preventScroll: true });
  }
  focusButton.addEventListener('click', function () { setFocus(true); });
  exitButton.addEventListener('click', function () { setFocus(false); });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (document.body.classList.contains('reader-focused')) setFocus(false);
    else if (settings.open) { settings.open = false; settings.querySelector('summary').focus(); }
  });
  document.addEventListener('click', function (event) { if (settings.open && !settings.contains(event.target)) settings.open = false; });
  document.addEventListener('focusin', function (event) { if (settings.open && !settings.contains(event.target)) settings.open = false; });
  function progress() {
    var bounds = prose.getBoundingClientRect();
    var start = bounds.top + window.scrollY;
    var travel = bounds.height - Math.max(1, window.innerHeight - 100);
    return Math.max(0, Math.min(100, travel > 0 ? (window.scrollY + 100 - start) / travel * 100 : bounds.bottom <= window.innerHeight ? 100 : 0));
  }
  function updateProgress() {
    var percent = Math.round(progress());
    fill.style.width = percent + '%';
    progressLabel.textContent = percent + '%';
    progressLabel.setAttribute('aria-label', percent + '% read');
  }
  var scrollTimer;
  var framePending = false;
  window.addEventListener('scroll', function () {
    if (!framePending) { framePending = true; requestAnimationFrame(function () { updateProgress(); framePending = false; }); }
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      var block = visibleBlock();
      if (block && progress() > 2) save(positionKey, { id: block.id, percent: Math.round(progress()) });
    }, 300);
  }, { passive: true });
  window.addEventListener('resize', updateProgress);
  if (previousPosition && previousPosition.percent > 2 && previousPosition.percent < 98 && blocks.some(function (el) { return el.id === previousPosition.id; })) {
    resumeButton.hidden = false;
    resumeButton.textContent = 'Continue reading · ' + previousPosition.percent + '%';
    resumeButton.addEventListener('click', function () {
      document.getElementById(previousPosition.id).scrollIntoView({ block: 'start' });
      resumeButton.hidden = true;
    });
  }
  var contents = document.querySelector('.reader-contents');
  var headings = prose.querySelectorAll('h2, h3');
  if (headings.length) {
    var list = contents.querySelector('ol');
    headings.forEach(function (heading) {
      var item = document.createElement('li');
      var link = document.createElement('a'); link.href = '#' + heading.id; link.textContent = heading.textContent;
      item.appendChild(link); list.appendChild(item);
    });
    contents.hidden = false;
    contents.addEventListener('click', function (event) { if (event.target.closest('a')) contents.open = false; });
  }
  applyPreferences();
  document.querySelectorAll('[data-reader-control]').forEach(function (el) { el.hidden = false; });
  updateProgress();
})();
