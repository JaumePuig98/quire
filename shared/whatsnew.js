/* One short line per release, shown once after an update (nothing is shown for a version that has no line here).
   Keep it to a sentence or two. Works in the app and in Node (tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WhatsNew = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    '1.4.0': 'New in 1.4: placeholders (type TK, jump with Ctrl+J), sprints, name suggestions, caret styles, a writing calendar, book templates and read aloud.',
    '1.4.1': 'New in 1.4.1: the status line counts the words you have selected, and About has a Report a problem link that fills in your version for you.',
    '1.5.0': 'New in 1.5: choose Book, Single text or Journal when you start. Journals get dated entries (Ctrl+Shift+E), a fresh entry each new day, your own date format, and exports that begin each entry with its date.',
  };


});
