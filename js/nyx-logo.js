(function(){
  'use strict';

  const source='/assets/icons/nyx-logo.png';
  const colors={
    default:'#6687b2',
    midnight:'#6f8fb9',
    ruby:'#a56573',
    emerald:'#628f80',
    sakura:'#9e718f',
    fresh:'#728f6b'
  };
  const cache=new Map();
  const croppedCache=new Map();
  let imagePromise=null;

  function normalizeTheme(theme){
    const clean=String(theme || 'default').toLowerCase();
    return Object.prototype.hasOwnProperty.call(colors,clean) ? clean : 'default';
  }

  function rgb(hex){
    const value=parseInt(hex.slice(1),16);
    return {r:value>>16,g:(value>>8)&255,b:value&255};
  }

  function sourceImage(){
    if(imagePromise) return imagePromise;
    imagePromise=new Promise((resolve,reject)=>{
      const image=new Image();
      image.decoding='async';
      image.onload=()=>resolve(image);
      image.onerror=()=>reject(new Error('Unable to load the Nyx logo.'));
      image.src=source;
    });
    return imagePromise;
  }

  async function themedUrl(theme='default'){
    const clean=normalizeTheme(theme);
    if(cache.has(clean)) return cache.get(clean);
    const image=await sourceImage();
    const canvas=document.createElement('canvas');
    canvas.width=image.naturalWidth || image.width;
    canvas.height=image.naturalHeight || image.height;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    context.drawImage(image,0,0);
    const pixels=context.getImageData(0,0,canvas.width,canvas.height);
    const target=rgb(colors[clean]);
    for(let index=0;index<pixels.data.length;index+=4){
      const red=pixels.data[index];
      const green=pixels.data[index+1];
      const blue=pixels.data[index+2];
      if(pixels.data[index+3]>8 && blue>24 && blue>red+12 && blue>green+10){
        const shade=Math.min(1.18,Math.max(.08,blue/212));
        pixels.data[index]=Math.round(target.r*shade);
        pixels.data[index+1]=Math.round(target.g*shade);
        pixels.data[index+2]=Math.round(target.b*shade);
      }
    }
    context.putImageData(pixels,0,0);
    const url=canvas.toDataURL('image/png');
    cache.set(clean,url);
    return url;
  }

  async function croppedUrl(theme='default'){
    const clean=normalizeTheme(theme);
    if(croppedCache.has(clean)) return croppedCache.get(clean);
    const image=new Image();
    image.decoding='async';
    image.src=await themedUrl(clean);
    if(typeof image.decode==='function') await image.decode();
    else await new Promise((resolve,reject)=>{
      image.onload=resolve;
      image.onerror=reject;
    });
    const canvas=document.createElement('canvas');
    canvas.width=256;
    canvas.height=256;
    const context=canvas.getContext('2d');
    // Crop the large transparent margin from the supplied 500px artwork so
    // the crescent remains legible at favicon and tab-icon sizes.
    context.drawImage(image,122,122,256,256,0,0,256,256);
    const url=canvas.toDataURL('image/png');
    croppedCache.set(clean,url);
    return url;
  }

  async function apply(theme='default',root=document){
    const url=await themedUrl(theme);
    root.documentElement?.style.setProperty('--nyx-themed-logo-url',`url("${url}")`);
    root.body?.style.setProperty('--nyx-themed-logo-url',`url("${url}")`);
    root.querySelectorAll?.('[data-nyx-logo],img[src$="/assets/icons/nyx-logo.png"],img[src$="firefly-tab-logo-bold.png"]').forEach(element=>{
      element.dataset.nyxLogo='true';
      if(element.tagName==='IMG') element.src=url;
      if(element.tagName==='LINK') element.href=url;
    });
    return url;
  }

  window.NyxLogo={apply,themedUrl,croppedUrl,source,colors};
})();
