import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fail} from './files.mjs';
export const maxImageBytes=12*1024*1024,maxImages=8;
const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'};
export function imageMime(data){
 if(data.length>=24&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(data.length>=4&&data[0]===255&&data[1]===216&&data[2]===255)return 'image/jpeg';
 if(data.length>=12&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP')return 'image/webp';
 if(data.length>=13&&/^GIF8[79]a$/.test(data.toString('ascii',0,6)))return 'image/gif';
 fail('PNG・JPEG・WebP・GIFの画像を選んでください');
}
export function imagePath(dir,image){
 if(!/^[a-f0-9]{48}$/.test(image?.id)||!extensions[image.mime])fail('添付画像が見つかりません',404);
 return path.join(dir,'images',image.id+'.'+extensions[image.mime]);
}
export async function uploadImage(dir,task,req,name){
 if((task.images||[]).filter(i=>!i.sentAt).length>=maxImages)fail('一度に添付できる画像は8枚までです');
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>maxImageBytes)fail('画像は1枚12MBまでです',413);chunks.push(chunk);}
 const bytes=Buffer.concat(chunks),mime=imageMime(bytes);
 const image={id:crypto.randomBytes(24).toString('hex'),name:String(name||'貼り付け画像').replace(/[\x00-\x1f]/g,'').slice(0,160),mime,size,createdAt:Date.now(),sentAt:null};
 await fs.mkdir(path.join(dir,'images'),{recursive:true});await fs.writeFile(imagePath(dir,image),bytes,{flag:'wx'});
 (task.images||=[]).push(image);return image;
}
export function selectedImages(task,ids=[]){
 if(!Array.isArray(ids)||ids.length>maxImages||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)fail('添付画像の指定を確認してください');
 return ids.map(id=>{const image=task.images?.find(i=>i.id===id);if(!image)fail('添付画像が見つかりません',404);return image;});
}
export function imageInputs(dir,images){return images.map(i=>({type:'localImage',path:imagePath(dir,i)}));}
export function sentImages(images){for(const i of images)i.sentAt=Date.now();}
