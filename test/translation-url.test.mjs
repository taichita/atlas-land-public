import test from 'node:test';import assert from 'node:assert/strict';
import {googleTranslationURL} from '../public/translation-url.js';
test('Google website translation encodes the source and never uses local or credential URLs',()=>{
 const url=new URL(googleTranslationURL('https://example.com/article?q=hello%20world#section'));
 assert.equal(url.origin,'https://translate.google.com');assert.equal(url.searchParams.get('tl'),'ja');assert.equal(url.searchParams.get('u'),'https://example.com/article?q=hello%20world');
 for(const value of ['file:///C:/notes.md','http://localhost:5000','http://192.168.1.1','http://127.1','http://[::1]','http://intranet','http://host.internal','https://a:b@example.com','https://example.com?access_token=secret','https://translate.google.com/translate','https://example-com.translate.goog'])assert.throws(()=>googleTranslationURL(value));
});
