import test from 'node:test';
import assert from 'node:assert/strict';
import {fileLink} from '../public/file-links.js';
test('document links support Windows paths, file URLs and document-relative siblings',()=>{
  assert.deepEqual(fileLink('/C:/dev/a%20b.md:12'),{local:'C:/dev/a b.md'});
  assert.deepEqual(fileLink('file:///C:/dev/%E5%8F%B0%E6%9C%AC.md'),{local:'C:/dev/台本.md'});
  assert.deepEqual(fileLink('/C:/dev/report.md#L12'),{local:'C:/dev/report.md'});
  assert.deepEqual(fileLink('file:/C:/dev/report.md:12:3'),{local:'C:/dev/report.md'});
  assert.deepEqual(fileLink('file:///C:/dev/report%23draft.md'),{local:'C:/dev/report#draft.md'});
  assert.equal(fileLink('file://server/share/report.md'),null);
  assert.deepEqual(fileLink('clip.mp4','C:\\dev\\project\\note.md'),{local:'C:/dev/project/clip.mp4'});
  assert.deepEqual(fileLink('../clip.mp4','project/note.md','C:\\dev'),{relative:'project/../clip.mp4'});
  assert.deepEqual(fileLink('/C:/dev/project/script.md:5','','C:\\dev'),{relative:'project/script.md'});
  assert.deepEqual(fileLink('https://example.com/a'),{web:'https://example.com/a'});
  assert.deepEqual(fileLink('#section'),{anchor:'section'});
  assert.equal(fileLink('javascript:alert(1)'),null);
  assert.equal(fileLink('data:text/html,hello'),null);
});
