// Clipboard access happens only in the browser's user-initiated paste event.
export function pastedImages(event){
 return [...(event.clipboardData?.items||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);
}
export function setupImagePaste({composer,prompt,picker,choose,upload,error}){
 let chain=Promise.resolve();
 const add=files=>{
   const selected=[...files];if(!selected.length)return;
   // Capture the task when the gesture occurs, before any asynchronous upload.
   const send=upload(selected.length);
   chain=chain.then(async()=>{for(const file of selected){try{await send(file);}catch(e){error(e.message);}}});
 };
 composer.addEventListener('paste',event=>{
   const files=pastedImages(event);if(!files.length)return;
   event.preventDefault();
   const text=event.clipboardData.getData('text/plain');
   if(text&&event.target===prompt){prompt.setRangeText(text,prompt.selectionStart,prompt.selectionEnd,'end');prompt.dispatchEvent(new Event('input',{bubbles:true}));}
   add(files);
 });
 choose.addEventListener('click',()=>picker.click());
 picker.addEventListener('change',()=>{add(picker.files);picker.value='';});
 composer.addEventListener('dragover',e=>{if([...e.dataTransfer.items].some(i=>i.kind==='file'))e.preventDefault();});
 composer.addEventListener('drop',e=>{const files=[...e.dataTransfer.files];if(!files.length)return;e.preventDefault();add(files);});
}
