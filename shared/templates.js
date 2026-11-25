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
    nonfiction: [['Introduction', true], ['', false], ['', false], ['', false], ['Conclusion', true]],
    plain: null,
    story: [['', false]],
    article: [['Abstract', true], ['Introduction', true], ['Methods', true], ['Results', true], ['Discussion', true], ['References', true]],
    journal: null,
  };

  // kind is what the document becomes: a book, one text, or a journal
  const groups = [
    { kind: 'book', name: 'Book', desc: 'Chapters, a title page, page numbers.' },
    { kind: 'text', name: 'Single text', desc: 'A story, an essay or an article. One piece, no chapters to manage.' },
    { kind: 'journal', name: 'Journal', desc: 'Dated entries. Each one is stamped with the day and time.' },
  ];
  const list = [
    { id: 'blank', kind: 'book', name: 'Blank book', desc: 'An empty page. Start writing.' },
    { id: 'novel', kind: 'book', name: 'Novel', desc: 'Three empty chapters, numbered for you. Add more as you go.' },
    { id: 'nonfiction', kind: 'book', name: 'Non-fiction book', desc: 'An introduction, three chapters and a conclusion.' },
    { id: 'plain', kind: 'text', name: 'Blank text', desc: 'An empty page. Start writing.' },
    { id: 'story', kind: 'text', name: 'Short story', desc: 'One chapter and nothing else to maintain.' },
    { id: 'article', kind: 'text', name: 'Scientific article', desc: 'Abstract, Introduction, Methods, Results, Discussion and References.' },
    { id: 'journal', kind: 'journal', name: 'Journal', desc: 'Your first entry is ready. Add a new one whenever you like.' },
  ];

  // D is the document module (shared/doc.js).
  function build(D, id) {
    const item = list.find((x) => x.id === id);
    const doc = D.newDoc(item ? item.kind : 'book');
    const spec = SPECS[id];
    if (spec) {
      doc.chapters = spec.map((s) => { const c = D.newChapter(s[0]); if (s[1]) c.nonum = true; return c; });
    }
    return doc;
  }

  return { list, groups, build };
});
