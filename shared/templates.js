/* Starting points for a new book: a few empty chapters with the right structure, no text.
   Works in the app and in Node (tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Templates = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [chapter title, true when the chapter has no number]
  const SPECS = {
    blank: null,
    novel: [['', false], ['', false], ['', false]],
    story: [['', false]],
    nonfiction: [['Introduction', true], ['', false], ['', false], ['', false], ['Conclusion', true]],
    article: [['Abstract', true], ['Introduction', true], ['Methods', true], ['Results', true], ['Discussion', true], ['References', true]],
  };

  const list = [
    { id: 'blank', name: 'Blank book', desc: 'An empty page. Start writing.' },
    { id: 'novel', name: 'Novel', desc: 'Three empty chapters, numbered for you. Add more as you go.' },
    { id: 'story', name: 'Short story', desc: 'One chapter and nothing else to maintain.' },
    { id: 'nonfiction', name: 'Non-fiction book', desc: 'An introduction, three chapters and a conclusion.' },
    { id: 'article', name: 'Scientific article', desc: 'Abstract, Introduction, Methods, Results, Discussion and References.' },
  ];

  // D is the document module (shared/doc.js).
  function build(D, id) {
    const doc = D.newDoc();
    const spec = SPECS[id];
    if (spec) {
      doc.chapters = spec.map((s) => { const c = D.newChapter(s[0]); if (s[1]) c.nonum = true; return c; });
    }
    return doc;
  }

  return { list, build };
});
