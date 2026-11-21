// Run with:  npx electron test/pdf-test.js --no-sandbox   (writes /tmp/wa-test.pdf)
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const D = require('../shared/doc.js');
const X = require('../exporters.js');

app.whenReady().then(async () => {
  const doc = D.newDoc();
  doc.chapters = []; doc.title = 'A Long Rain';
  const lorem = 'The rain had been going since noon and by evening the street outside had stopped being a street and become a long grey mirror, and every car that passed left a seam in it that closed again behind them. ';
  for (let c = 1; c <= 3; c++) {
    const ch = D.newChapter('Chapter ' + c + ': The ' + ['Lamp', 'Window', 'Stairs'][c - 1]);
    ch.blocks = [];
    for (let i = 0; i < 14; i++) {
      if (i % 5 === 0) ch.blocks.push({ t: 'h1', runs: [{ text: 'A section heading ' + (i / 5 + 1) }] });
      ch.blocks.push({ t: 'p', runs: [{ text: lorem.repeat(3 + (i % 3)) }, { text: 'Emphasised ending.', i: 1 }] });
      if (i === 7) ch.blocks.push({ t: 'quote', runs: [{ text: 'A quoted passage that should never be split across pages if it can be avoided. ' + lorem }] });
    }
    doc.chapters.push(ch);
  }
  const buf = await X.renderPdf(doc, { font: process.env.FONT || 'serif', notes: false, titlePage: true, author: 'Pat Writer', chapterIds: doc.chapters.slice(0, 2).map((c) => c.id) }, path.join(__dirname, '..', 'renderer', 'fonts'));
  fs.writeFileSync('/tmp/wa-test.pdf', buf);
  console.log('PDF bytes', buf.length);
  app.quit();
});
