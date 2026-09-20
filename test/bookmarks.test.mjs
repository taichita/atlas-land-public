import test from 'node:test';
import assert from 'node:assert/strict';
import {flatBookmarks} from '../public/bookmark-marks.js';

test('marks flatten legacy folders and edit or remove duplicate URLs together',()=>{
 const items=[{id:'folder',kind:'folder',title:'Chrome Profile 1'},
  {id:'a',url:'https://example.org/',parentId:'folder'},
  {id:'b',url:'https://example.org/',source:'chrome'},
  {id:'c',url:'https://example.com/',mark:'heart'}];
 assert.deepEqual(flatBookmarks(items).map(b=>b.id),['a','c']);
 editBookmark(items,{id:'a',url:'https://example.org/',title:'Reference',mark:'diamond',parentId:null});
 assert.deepEqual(items.filter(b=>b.url==='https://example.org/').map(b=>b.mark),['diamond','diamond']);
 assert.throws(()=>editBookmark(items,{url:'https://example.org/',mark:'unknown'}));
 editBookmark(items,{id:'a',remove:true});
 assert.deepEqual(flatBookmarks(items).map(b=>b.id),['c']);
});
import {editBookmark} from '../server/bookmarks.mjs';
test('bookmark registration is idempotent, edits preserve identity and unsafe URLs are rejected',()=>{
 const list=[],first=editBookmark(list,{title:'調べ物',url:'https://example.com'});
 assert.equal(editBookmark(list,{title:'重複',url:'https://example.com/'}).id,first.id);assert.equal(list.length,1);
 editBookmark(list,{id:first.id,title:'資料',url:'https://example.com/reference#section'});assert.equal(list[0].title,'資料');
 for(const url of ['javascript:alert(1)','file:///C:/secret','https://user:password@example.com','data:text/html,x'])assert.throws(()=>editBookmark(list,{url}));
 editBookmark(list,{id:first.id,remove:true});assert.equal(list.length,0);
});
test('nested folders preserve legacy bookmarks, reject cycles and nonempty deletion',()=>{
 const list=[],link=editBookmark(list,{url:'https://example.org',title:'legacy'}),folder=editBookmark(list,{kind:'folder',title:'Work'}),child=editBookmark(list,{kind:'folder',title:'Docs',parentId:folder.id});
 editBookmark(list,{...link,parentId:child.id});assert.equal(list.find(x=>x.id===link.id).parentId,child.id);
 assert.throws(()=>editBookmark(list,{...folder,parentId:child.id}));
 assert.throws(()=>editBookmark(list,{id:child.id,remove:true}));
 assert.throws(()=>editBookmark(list,{...link,parentId:link.id}));
 editBookmark(list,{...link,parentId:null});editBookmark(list,{id:child.id,remove:true});
 assert.equal(list.find(x=>x.id===link.id).url,'https://example.org/');
});
