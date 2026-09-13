import test from 'node:test';
import assert from 'node:assert/strict';
import {editBookmark} from '../server/bookmarks.mjs';
test('bookmark registration is idempotent, edits preserve identity and unsafe URLs are rejected',()=>{
 const list=[],first=editBookmark(list,{title:'調べ物',url:'https://example.com'});
 assert.equal(editBookmark(list,{title:'重複',url:'https://example.com/'}).id,first.id);assert.equal(list.length,1);
 editBookmark(list,{id:first.id,title:'資料',url:'https://example.com/reference#section'});assert.equal(list[0].title,'資料');
 for(const url of ['javascript:alert(1)','file:///C:/secret','https://user:password@example.com','data:text/html,x'])assert.throws(()=>editBookmark(list,{url}));
 editBookmark(list,{id:first.id,remove:true});assert.equal(list.length,0);
});
