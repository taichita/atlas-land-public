// Coalesce edits and serialize writes so a slower old request cannot overwrite
// a newer draft. Retry only local persistence, never AI messages or approvals.
export class Autosave {
  constructor({save, cache=()=>{}, clearCache=()=>{}, onError=()=>{}, delay=500, retryDelay=1000}) {
    Object.assign(this,{save,cache,clearCache,onError,delay,retryDelay});
    this.revision=0;this.saved=0;this.failures=0;
  }
  queue(value) {
    this.value=structuredClone(value);this.revision++;
    this.cache(this.value);
    this.schedule(this.delay);
  }
  schedule(delay) {
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>this.flush().catch(()=>{}),delay);
  }
  flush() {
    clearTimeout(this.timer);
    if(this.running)return this.running;
    this.running=this.drain().finally(()=>{this.running=null;});
    return this.running;
  }
  async drain() {
    while(this.saved<this.revision) {
      const revision=this.revision,value=this.value;
      try {await this.save(value);}
      catch(e) {
        if(!this.failures)this.onError(e);
        this.failures++;
        this.schedule(Math.min(15000,this.retryDelay*2**Math.min(4,this.failures-1)));
        throw e;
      }
      this.saved=revision;this.failures=0;
      if(this.saved===this.revision)this.clearCache();
    }
  }
}
