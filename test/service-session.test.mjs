import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceBinding} from '../server/service-session.mjs';
test('recovery uses an explicit loopback port with a complete authentication token',()=>{
  assert.deepEqual(serviceBinding({}),{port:0,token:null});
  assert.deepEqual(serviceBinding({ATLAS_SERVICE_PORT:'54321',ATLAS_SERVICE_TOKEN:'a'.repeat(64)}),{port:54321,token:'a'.repeat(64)});
  for(const port of ['0','65536','-1','123x','http://example.com'])assert.throws(()=>serviceBinding({ATLAS_SERVICE_PORT:port,ATLAS_SERVICE_TOKEN:'a'.repeat(64)}));
  for(const value of [{ATLAS_SERVICE_PORT:'54321'},{ATLAS_SERVICE_TOKEN:'a'.repeat(64)},{ATLAS_SERVICE_PORT:'54321',ATLAS_SERVICE_TOKEN:'invalid'}])assert.throws(()=>serviceBinding(value));
});
