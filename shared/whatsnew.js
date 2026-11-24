/* One short line per release, shown once after an update (nothing is shown for a version that has no line here).
   Keep it to a sentence or two. Works in the app and in Node (tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WhatsNew = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    '1.4.0': 'New in 1.4.0: placeholders (type TK, jump with Ctrl+J), sprints, name suggestions, caret styles, a writing calendar, book templates and read aloud.',
  };
});
