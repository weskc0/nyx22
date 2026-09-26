(function(){
  'use strict';

  const MESSAGE_KEY='nyx.aiMessages';
  const THREADS_KEY='nyx.aiThreads.v1';
  const ACTIVE_THREAD_KEY='nyx.aiActiveThread';
  const MODEL_KEY='nyx.aiModel';
  const DEFAULT_MODEL='chatgpt-5.4-mini';
  const MAX_MESSAGES=40;
  const MAX_THREADS=40;
  const MAX_INPUT_HEIGHT=190;
  const MAX_IMAGE_BYTES=8*1024*1024;

  const app=document.querySelector('[data-ai-app]');
  const feed=document.getElementById('feed');
  const conversation=document.getElementById('conversation');
  const form=document.getElementById('form');
  const input=document.getElementById('input');
  const send=document.getElementById('send');
  const model=document.getElementById('model');
  const modelPicker=document.getElementById('modelPicker');
  const modelTrigger=document.getElementById('modelTrigger');
  const modelSelected=document.getElementById('modelSelected');
  const modelMenu=document.getElementById('modelMenu');
  const modelOptionsHost=document.getElementById('modelOptions');
  const clear=document.getElementById('clear');
  const threadTitle=document.getElementById('threadTitle');
  const characterCount=document.getElementById('characterCount');
  const sidebar=document.getElementById('aiSidebar');
  const sidebarToggle=document.getElementById('sidebarToggle');
  const sidebarClose=document.getElementById('sidebarClose');
  const sidebarScrim=document.getElementById('sidebarScrim');
  const newChat=document.getElementById('newChat');
  const temporaryChat=document.getElementById('temporaryChat');
  const threadList=document.getElementById('threadList');
  const threadCount=document.getElementById('threadCount');
  const historyEmpty=document.getElementById('historyEmpty');
  const profileButton=document.getElementById('aiProfile');
  const profileAvatar=document.getElementById('profileAvatar');
  const profileInitial=document.getElementById('profileInitial');
  const profileName=document.getElementById('profileName');
  const profileHandle=document.getElementById('profileHandle');
  const imageInput=document.getElementById('imageInput');
  const attachImage=document.getElementById('attachImage');
  const attachmentPreview=document.getElementById('attachmentPreview');
  const attachmentThumbnail=document.getElementById('attachmentThumbnail');
  const attachmentName=document.getElementById('attachmentName');
  const attachmentStatus=document.getElementById('attachmentStatus');
  const removeAttachment=document.getElementById('removeAttachment');
  if(!app||!feed||!conversation||!form||!input||!send||!model||!modelPicker||!modelTrigger||!modelSelected||!modelMenu||!modelOptionsHost||!clear||!threadTitle||!sidebar||!sidebarToggle||!sidebarClose||!sidebarScrim||!newChat||!temporaryChat||!threadList||!threadCount||!historyEmpty||!profileButton||!profileAvatar||!profileInitial||!profileName||!profileHandle||!imageInput||!attachImage||!attachmentPreview||!attachmentThumbnail||!attachmentName||!attachmentStatus||!removeAttachment) return;

  let activeController=null;
  let followStream=true;
  let modelCatalog=[{id:DEFAULT_MODEL,label:'GPT-5.4 Mini',company:'ChatGPT'}];
  let threads=[];
  let activeThreadId='';
  let temporaryMode=false;
  let temporaryMessages=[];
  let attachedImage=null;
  let imageOcrLoader=null;

  function themeHex(value,fallback='#6687b2'){
    const raw=String(value||'').trim();
    return /^#[0-9a-f]{6}$/i.test(raw)?raw.toLowerCase():fallback;
  }

  function shadeThemeHex(value,percent=0){
    const color=themeHex(value);
    const amount=Math.max(-100,Math.min(100,Number(percent)||0))/100;
    const channel=index=>{
      const current=parseInt(color.slice(index,index+2),16);
      return Math.round(amount>=0?current+(255-current)*amount:current*(1+amount));
    };
    return '#'+[1,3,5].map(index=>channel(index).toString(16).padStart(2,'0')).join('');
  }

  function themeForeground(value){
    const color=themeHex(value);
    const channels=[1,3,5].map(index=>parseInt(color.slice(index,index+2),16)/255).map(channel=>channel<=.04045?channel/12.92:Math.pow((channel+.055)/1.055,2.4));
    return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722>.48?'#071018':'#f7f9ff';
  }

  function parentThemePalette(){
    try{
      if(parent===window||parent.location.origin!==location.origin) return null;
      const parentDocument=parent.document;
      const bodyStyle=parent.getComputedStyle(parentDocument.body);
      const rootStyle=parent.getComputedStyle(parentDocument.documentElement);
      const read=(name,fallback='')=>bodyStyle.getPropertyValue(name).trim()||rootStyle.getPropertyValue(name).trim()||fallback;
      const accent=read('--nyx-chrome-accent',read('--theme-a','#6687b2'));
      const bright=read('--nyx-final-shortcut-icon',read('--nyx-chrome-bright',accent));
      return {
        canvas:read('--nyx-unified-canvas',read('--nyx-chrome-deep','#080e18')),
        deep:read('--nyx-unified-top',read('--nyx-chrome-deep','#050912')),
        surface:read('--nyx-home-panel',read('--nyx-chrome-base','#101827')),
        raised:read('--nyx-home-panel-soft',read('--nyx-chrome-active','#141f31')),
        hover:read('--nyx-chrome-hover',read('--nyx-home-panel-soft','#1a293e')),
        line:read('--nyx-home-line','#2a3b54'),
        text:read('--nyx-home-text',read('--theme-strong','#d4deec')),
        muted:read('--nyx-home-muted','#899bb5'),
        accent,
        bright
      };
    }catch{return null}
  }

  function fallbackThemePalette(theme){
    const stored=theme==='custom'?localStorage.getItem('nyx.customThemeColor'):'';
    const accent=themeHex(stored||window.NyxLogo?.colors?.[theme]||window.NyxLogo?.colors?.default||'#6687b2');
    return {
      canvas:shadeThemeHex(accent,-84),
      deep:shadeThemeHex(accent,-91),
      surface:shadeThemeHex(accent,-74),
      raised:shadeThemeHex(accent,-68),
      hover:shadeThemeHex(accent,-58),
      line:shadeThemeHex(accent,-30),
      text:'#f4f7ff',
      muted:shadeThemeHex(accent,48),
      accent:shadeThemeHex(accent,8),
      bright:shadeThemeHex(accent,38)
    };
  }

  function applyWorkspaceTheme(theme=localStorage.getItem('nyx.theme')||'default'){
    const clean=String(theme||'default').trim().toLowerCase()||'default';
    const palette=parentThemePalette()||fallbackThemePalette(clean);
    const root=document.documentElement;
    const values={
      '--ai-bg':palette.canvas,
      '--ai-bg-deep':palette.deep,
      '--ai-surface':palette.surface,
      '--ai-surface-raised':palette.raised,
      '--ai-surface-hover':palette.hover,
      '--ai-border':`color-mix(in srgb,${palette.line} 62%,transparent)`,
      '--ai-border-strong':`color-mix(in srgb,${palette.bright} 34%,${palette.line})`,
      '--ai-text':palette.text,
      '--ai-text-soft':`color-mix(in srgb,${palette.text} 84%,${palette.muted})`,
      '--ai-muted':palette.muted,
      '--ai-muted-dark':`color-mix(in srgb,${palette.muted} 72%,${palette.canvas})`,
      '--ai-accent':palette.accent,
      '--ai-accent-bright':palette.bright,
      '--ai-accent-soft':`color-mix(in srgb,${palette.accent} 14%,transparent)`,
      '--ai-accent-border':`color-mix(in srgb,${palette.bright} 42%,transparent)`,
      '--ai-accent-foreground':themeForeground(palette.accent),
      '--ai-accent-glow':`color-mix(in srgb,${palette.accent} 28%,transparent)`
    };
    Object.entries(values).forEach(([name,value])=>root.style.setProperty(name,value));
    root.dataset.nyxTheme=clean;
    document.body.dataset.nyxTheme=clean;
    document.body.className=document.body.className.replace(/\btheme-[\w-]+\b/g,'').trim();
    document.body.classList.add(`theme-${clean}`);
    applyLogoTheme(clean);
  }

  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,character=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[character]);
  }

  function normalizedMessages(value){
    return Array.isArray(value)
      ? value.filter(item=>item&&['user','assistant'].includes(item.role)&&String(item.content||'').trim()).map(item=>({role:item.role,content:String(item.content)})).slice(-MAX_MESSAGES)
      : [];
  }

  function chatTitle(messages){
    const first=normalizedMessages(messages).find(item=>item.role==='user')?.content.trim()||'New conversation';
    return first.length>46?`${first.slice(0,46)}…`:first;
  }

  function normalizedThread(value){
    const messages=normalizedMessages(value?.messages);
    const createdAt=Number(value?.createdAt)||Date.now();
    return {
      id:String(value?.id||''),
      title:String(value?.title||chatTitle(messages)).trim().slice(0,64)||'New conversation',
      messages,
      model:String(value?.model||DEFAULT_MODEL),
      createdAt,
      updatedAt:Number(value?.updatedAt)||createdAt
    };
  }

  function storedThreads(){
    try{
      const value=JSON.parse(localStorage.getItem(THREADS_KEY)||'[]');
      return Array.isArray(value)
        ? value.map(normalizedThread).filter(thread=>thread.id&&thread.messages.length).sort((left,right)=>right.updatedAt-left.updatedAt).slice(0,MAX_THREADS)
        : [];
    }catch{return[]}
  }

  function legacyMessages(){
    try{return normalizedMessages(JSON.parse(localStorage.getItem(MESSAGE_KEY)||'[]'))}catch{return[]}
  }

  function persistThreads(){
    threads=threads.filter(thread=>thread.id&&thread.messages.length).sort((left,right)=>right.updatedAt-left.updatedAt).slice(0,MAX_THREADS);
    try{localStorage.setItem(THREADS_KEY,JSON.stringify(threads))}catch{}
  }

  function syncLegacyMessages(messages){
    try{
      if(messages.length) localStorage.setItem(MESSAGE_KEY,JSON.stringify(messages));
      else localStorage.removeItem(MESSAGE_KEY);
    }catch{}
  }

  function activeThread(){return threads.find(thread=>thread.id===activeThreadId)||null}

  function initializeThreads(){
    threads=storedThreads();
    if(!threads.length){
      const legacy=legacyMessages();
      if(legacy.length){
        const now=Date.now();
        const thread=normalizedThread({id:`chat-${now.toString(36)}`,messages:legacy,model:localStorage.getItem(MODEL_KEY)||DEFAULT_MODEL,createdAt:now,updatedAt:now});
        threads=[thread];
        activeThreadId=thread.id;
        persistThreads();
      }
    }
    if(!activeThreadId){
      const stored=localStorage.getItem(ACTIVE_THREAD_KEY)||'';
      activeThreadId=threads.some(thread=>thread.id===stored)?stored:(threads[0]?.id||'');
    }
    if(activeThreadId){
      localStorage.setItem(ACTIVE_THREAD_KEY,activeThreadId);
      syncLegacyMessages(activeThread()?.messages||[]);
    }
  }

  function savedMessages(){
    return temporaryMode?normalizedMessages(temporaryMessages):normalizedMessages(activeThread()?.messages||[]);
  }

  function saveMessages(value){
    const messages=normalizedMessages(value);
    if(temporaryMode){
      temporaryMessages=messages;
      return;
    }
    const now=Date.now();
    let thread=activeThread();
    if(!thread&&messages.length){
      thread=normalizedThread({id:`chat-${now.toString(36)}-${Math.random().toString(36).slice(2,7)}`,messages,model:model.value||DEFAULT_MODEL,createdAt:now,updatedAt:now});
      threads.unshift(thread);
      activeThreadId=thread.id;
      localStorage.setItem(ACTIVE_THREAD_KEY,activeThreadId);
    }else if(thread){
      thread.messages=messages;
      thread.title=chatTitle(messages);
      thread.model=model.value||thread.model||DEFAULT_MODEL;
      thread.updatedAt=now;
    }
    syncLegacyMessages(messages);
    persistThreads();
    renderThreadList();
  }

  function applyLogoTheme(theme){
    return window.NyxLogo?.apply(theme||localStorage.getItem('nyx.theme')||'default',document).catch?.(()=>{});
  }

  function inlineMarkdown(value){
    const code=[];
    let source=String(value??'').replace(/`([^`\n]+)`/g,(_match,text)=>{
      const token=`@@NYX_INLINE_${code.length}@@`;
      code.push(`<code>${escapeHtml(text)}</code>`);
      return token;
    });
    let html=escapeHtml(source);
    html=html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    html=html.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
    html=html.replace(/__([^_\n]+)__/g,'<strong>$1</strong>');
    html=html.replace(/~~([^~\n]+)~~/g,'<s>$1</s>');
    html=html.replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<em>$2</em>');
    code.forEach((token,index)=>{html=html.replace(`@@NYX_INLINE_${index}@@`,token)});
    return html;
  }

  function tableCells(line){
    return String(line).trim().replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim());
  }

  function isTableDivider(line){
    const cells=tableCells(line);
    return cells.length>1&&cells.every(cell=>/^:?-{3,}:?$/.test(cell));
  }

  function isBlockStart(lines,index){
    const line=lines[index]||'';
    return /^```/.test(line)||/^#{1,3}\s+/.test(line)||/^>\s?/.test(line)||/^\s*[-*+]\s+/.test(line)||/^\s*\d+[.)]\s+/.test(line)||/^\s*(?:---+|___+)\s*$/.test(line)||(line.includes('|')&&isTableDivider(lines[index+1]||''));
  }

  function markdown(value){
    const lines=String(value??'').replace(/\r\n?/g,'\n').split('\n');
    const blocks=[];
    for(let index=0;index<lines.length;){
      const line=lines[index];
      if(!line.trim()){index+=1;continue}

      const fence=line.match(/^```([^\s`]*)\s*$/);
      if(fence){
        const language=(fence[1]||'code').slice(0,24);
        const code=[];
        index+=1;
        while(index<lines.length&&!/^```\s*$/.test(lines[index])){code.push(lines[index]);index+=1}
        if(index<lines.length) index+=1;
        blocks.push(`<div class="ai-code-block"><div class="ai-code-head"><span>${escapeHtml(language)}</span><button class="ai-code-copy" type="button" data-copy-code aria-label="Copy code"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg><span>Copy</span></button></div><pre><code>${escapeHtml(code.join('\n'))}</code></pre></div>`);
        continue;
      }

      if(line.includes('|')&&isTableDivider(lines[index+1]||'')){
        const headers=tableCells(line);
        index+=2;
        const rows=[];
        while(index<lines.length&&lines[index].includes('|')&&lines[index].trim()){
          rows.push(tableCells(lines[index]));
          index+=1;
        }
        blocks.push(`<div class="ai-table-wrap"><table><thead><tr>${headers.map(cell=>`<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${headers.map((_header,cellIndex)=>`<td>${inlineMarkdown(row[cellIndex]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }

      const heading=line.match(/^(#{1,3})\s+(.+)$/);
      if(heading){
        const level=heading[1].length;
        blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        index+=1;
        continue;
      }

      if(/^>\s?/.test(line)){
        const quote=[];
        while(index<lines.length&&/^>\s?/.test(lines[index])){quote.push(lines[index].replace(/^>\s?/,''));index+=1}
        blocks.push(`<blockquote>${quote.map(inlineMarkdown).join('<br>')}</blockquote>`);
        continue;
      }

      const unordered=/^\s*[-*+]\s+/.test(line);
      const ordered=/^\s*\d+[.)]\s+/.test(line);
      if(unordered||ordered){
        const items=[];
        const pattern=ordered?/^\s*\d+[.)]\s+/:/^\s*[-*+]\s+/;
        while(index<lines.length&&pattern.test(lines[index])){items.push(lines[index].replace(pattern,''));index+=1}
        const tag=ordered?'ol':'ul';
        blocks.push(`<${tag}>${items.map(item=>`<li>${inlineMarkdown(item)}</li>`).join('')}</${tag}>`);
        continue;
      }

      if(/^\s*(?:---+|___+)\s*$/.test(line)){
        blocks.push('<hr>');
        index+=1;
        continue;
      }

      const paragraph=[line];
      index+=1;
      while(index<lines.length&&lines[index].trim()&&!isBlockStart(lines,index)){
        paragraph.push(lines[index]);
        index+=1;
      }
      blocks.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`);
    }
    return blocks.join('');
  }

  function messageCopyButton(){
    return `<button class="ai-message-copy" type="button" data-copy-message title="Copy message" aria-label="Copy message"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg></button>`;
  }

  function setAttachmentStatus(text){
    attachmentStatus.textContent=String(text||'');
  }

  function clearAttachment(){
    attachedImage=null;
    imageInput.value='';
    attachmentPreview.hidden=true;
    attachmentPreview.classList.remove('is-error');
    attachmentThumbnail.hidden=false;
    attachmentThumbnail.removeAttribute('src');
    attachmentName.textContent='';
    setAttachmentStatus('Ready to send');
    attachImage.classList.remove('has-attachment');
    attachImage.setAttribute('aria-label','Attach an image');
  }

  function showAttachmentError(message){
    clearAttachment();
    attachmentPreview.hidden=false;
    attachmentPreview.classList.add('is-error');
    attachmentThumbnail.hidden=true;
    attachmentName.textContent='Image not attached';
    setAttachmentStatus(message);
  }

  function setAttachment(image){
    attachedImage=image;
    attachmentPreview.hidden=false;
    attachmentPreview.classList.remove('is-error');
    attachmentThumbnail.hidden=false;
    attachmentThumbnail.src=image.dataUrl;
    attachmentName.textContent=image.name;
    setAttachmentStatus('Ready to send');
    attachImage.classList.add('has-attachment');
    attachImage.setAttribute('aria-label',`Replace attached image: ${image.name}`);
  }

  function readImageFile(file){
    if(!file||!String(file.type||'').startsWith('image/')){
      showAttachmentError('Choose a PNG, JPG, WebP, or GIF image.');
      return Promise.resolve(null);
    }
    if(file.size>MAX_IMAGE_BYTES){
      showAttachmentError('Choose an image smaller than 8 MB.');
      return Promise.resolve(null);
    }
    return new Promise(resolve=>{
      const reader=new FileReader();
      reader.onload=()=>{
        const image={name:file.name||'Attached image',size:file.size,type:file.type,dataUrl:String(reader.result||'')};
        setAttachment(image);
        resolve(image);
      };
      reader.onerror=()=>{
        showAttachmentError('Nyx could not read that image.');
        resolve(null);
      };
      reader.readAsDataURL(file);
    });
  }

  function loadImageOcr(){
    if(window.Tesseract) return Promise.resolve(window.Tesseract);
    if(imageOcrLoader) return imageOcrLoader;
    imageOcrLoader=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(new Error('OCR library did not start.'));
      script.onerror=()=>reject(new Error('OCR library could not load.'));
      document.head.appendChild(script);
    });
    return imageOcrLoader;
  }

  function analyzeImage(dataUrl){
    return new Promise(resolve=>{
      const image=new Image();
      image.onload=()=>{
        try{
          const canvas=document.createElement('canvas');
          const max=96;
          const scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight));
          canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
          canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
          const context=canvas.getContext('2d',{willReadFrequently:true});
          if(!context) throw new Error('Canvas is unavailable.');
          context.drawImage(image,0,0,canvas.width,canvas.height);
          const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
          let red=0,green=0,blue=0,light=0,dark=0,count=0;
          for(let index=0;index<pixels.length;index+=16){
            const r=pixels[index],g=pixels[index+1],b=pixels[index+2];
            const luminance=(r+g+b)/3;
            red+=r;green+=g;blue+=b;count+=1;
            if(luminance>200) light+=1;
            if(luminance<55) dark+=1;
          }
          red=Math.round(red/count);green=Math.round(green/count);blue=Math.round(blue/count);
          const brightness=Math.round((red+green+blue)/3);
          resolve(`Image details: ${image.naturalWidth}x${image.naturalHeight}px. Average color rgb(${red}, ${green}, ${blue}). Overall brightness is about ${brightness}/255. Bright areas: ${Math.round(light/count*100)}%. Dark areas: ${Math.round(dark/count*100)}%.`);
        }catch{
          resolve(`Image details: ${image.naturalWidth}x${image.naturalHeight}px.`);
        }
      };
      image.onerror=()=>resolve('Nyx could not inspect the image pixels.');
      image.src=dataUrl;
    });
  }

  async function readImageContext(image){
    if(!image?.dataUrl) return '';
    setAttachmentStatus('Reading image details…');
    const visual=await analyzeImage(image.dataUrl);
    try{
      const Tesseract=await loadImageOcr();
      const result=await Tesseract.recognize(image.dataUrl,'eng',{
        logger:event=>{
          if(!event?.status) return;
          const progress=Number.isFinite(event.progress)?` ${Math.round(event.progress*100)}%`:'';
          setAttachmentStatus(`Reading text: ${event.status}${progress}`);
        }
      });
      const text=String(result?.data?.text||'').trim().slice(0,12000);
      setAttachmentStatus(text?'Image text read':'No clear text found');
      return text?`${visual}\n\nText read from the image:\n${text}`:`${visual}\n\nNo clear readable text was found in the image.`;
    }catch(error){
      setAttachmentStatus('Using basic image details');
      return `${visual}\n\nOCR was unavailable (${error?.message||'unknown error'}).`;
    }
  }

  function setMessageContent(message,text,{error=false,thinking=false}={}){
    const content=message.querySelector('.ai-message-content');
    if(!content) return;
    message._nyxMessageText=String(text||'');
    message.classList.toggle('ai-message-error',error);
    message.classList.toggle('is-thinking',thinking);
    if(thinking){
      content.innerHTML='<span class="ai-thinking" aria-label="Nyx AI is thinking"><i></i><i></i><i></i></span>';
      return;
    }
    if(message.classList.contains('ai-message-user')||error){
      content.textContent=String(text||'');
      return;
    }
    content.innerHTML=markdown(text);
  }

  function addMessage(role,text,{error=false,thinking=false,attachment=null}={}){
    conversation.querySelector('[data-ai-welcome]')?.remove();
    conversation.classList.remove('is-empty');
    const assistant=role!=='user';
    const message=document.createElement('article');
    message.className=`ai-message ai-message-${assistant?'assistant':'user'}`;
    message.innerHTML=`
      <div class="ai-message-avatar" ${assistant?'data-nyx-logo aria-hidden="true"':'aria-hidden="true"'}>${assistant?'':'You'}</div>
      <div class="ai-message-body">
        <div class="ai-message-meta"><strong>${assistant?'Nyx AI':'You'}</strong><div class="ai-message-actions">${messageCopyButton()}</div></div>
        <div class="ai-message-content"></div>
      </div>`;
    if(attachment?.dataUrl&&!assistant){
      const figure=document.createElement('figure');
      figure.className='ai-message-attachment';
      const image=document.createElement('img');
      image.src=attachment.dataUrl;
      image.alt=attachment.name||'Attached image';
      const caption=document.createElement('figcaption');
      caption.textContent=attachment.name||'Attached image';
      figure.append(image,caption);
      message.querySelector('.ai-message-content')?.before(figure);
    }
    setMessageContent(message,text,{error,thinking});
    conversation.appendChild(message);
    applyLogoTheme();
    scrollToBottom(true);
    return message;
  }

  function starterIcon(kind){
    const icons={
      project:'<path d="M4 7.5h16M7.5 4v7M16.5 4v7M5 12h14v8H5z"/>',
      explain:'<path d="M12 3a7 7 0 0 0-4 12.74V19h8v-3.26A7 7 0 0 0 12 3Z"/><path d="M9 22h6M9.5 15h5"/>',
      code:'<path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/>',
      ideas:'<path d="M12 3v3M4.22 6.22l2.12 2.12M3 14h3M18 14h3M17.66 8.34l2.12-2.12"/><path d="M8.5 18h7M9.5 21h5M12 8a5 5 0 0 0-3 9h6a5 5 0 0 0-3-9Z"/>'
    };
    return `<svg aria-hidden="true" viewBox="0 0 24 24">${icons[kind]||icons.ideas}</svg>`;
  }

  function starter(prompt,title,description,kind){
    return `<button class="ai-starter" type="button" data-prompt="${escapeHtml(prompt)}"><span class="ai-starter-icon">${starterIcon(kind)}</span><span class="ai-starter-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span><svg class="ai-starter-arrow" aria-hidden="true" viewBox="0 0 20 20"><path d="m7 4 6 6-6 6"/></svg></button>`;
  }

  function welcome(){
    return `<section class="ai-welcome" data-ai-welcome>
      <div class="ai-welcome-mark" data-nyx-logo aria-hidden="true"></div>
      <p class="ai-welcome-kicker">NYX INTELLIGENCE</p>
      <h2>What can I help you create?</h2>
      <p class="ai-welcome-copy">Ask a question, explore an idea, or work through something complex. Choose a starting point or write your own prompt below.</p>
      <div class="ai-starters">
        ${starter('Help me plan and build a new project from scratch','Help me build a project','Turn an idea into clear next steps','project')}
        ${starter('Explain quantum computing in simple terms with a useful analogy','Explain a complex topic','Make difficult ideas easier to understand','explain')}
        ${starter('Review this code for bugs, clarity, and performance improvements','Review my code','Find issues and suggest improvements','code')}
        ${starter('Brainstorm ten original ideas for a creative side project','Brainstorm ideas','Generate thoughtful directions to explore','ideas')}
      </div>
    </section>`;
  }

  function threadDate(timestamp){
    const date=new Date(Number(timestamp)||Date.now());
    const today=new Date();
    if(date.toDateString()===today.toDateString()) return date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    const yesterday=new Date(today);
    yesterday.setDate(today.getDate()-1);
    if(date.toDateString()===yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([],{month:'short',day:'numeric'});
  }

  function threadIcon(){
    return '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5h14v11H9l-4 3V5Z"/></svg>';
  }

  function renderThreadList(){
    const items=[...threads].sort((left,right)=>right.updatedAt-left.updatedAt);
    threadCount.textContent=String(items.length);
    historyEmpty.hidden=items.length>0;
    threadList.innerHTML=items.map(thread=>`<div role="listitem"><button class="ai-thread-button" type="button" data-thread-id="${escapeHtml(thread.id)}" aria-current="${!temporaryMode&&thread.id===activeThreadId?'true':'false'}"><span class="ai-thread-icon">${threadIcon()}</span><span class="ai-thread-copy"><strong>${escapeHtml(thread.title)}</strong><small>${escapeHtml(threadDate(thread.updatedAt))}</small></span></button></div>`).join('');
    temporaryChat.setAttribute('aria-pressed',String(temporaryMode));
  }

  function stopRequest(){
    activeController?.abort();
    activeController=null;
    setBusy(false);
  }

  function setSidebarOpen(open){
    app.classList.toggle('is-sidebar-open',Boolean(open));
    sidebarToggle.setAttribute('aria-expanded',String(Boolean(open)));
  }

  function startNewChat({temporary=false}={}){
    stopRequest();
    clearAttachment();
    temporaryMode=temporary;
    temporaryMessages=[];
    activeThreadId='';
    if(!temporary){
      try{localStorage.removeItem(ACTIVE_THREAD_KEY)}catch{}
      syncLegacyMessages([]);
    }
    renderThreadList();
    render();
    input.value='';
    autoGrow();
    setSidebarOpen(false);
    input.focus();
  }

  function selectThread(id){
    const thread=threads.find(item=>item.id===id);
    if(!thread) return;
    stopRequest();
    clearAttachment();
    temporaryMode=false;
    temporaryMessages=[];
    activeThreadId=thread.id;
    localStorage.setItem(ACTIVE_THREAD_KEY,activeThreadId);
    syncLegacyMessages(thread.messages);
    if(modelCatalog.some(item=>item.id===thread.model)){
      model.value=thread.model;
      localStorage.setItem(MODEL_KEY,thread.model);
      syncModelControl();
    }
    renderThreadList();
    render();
    setSidebarOpen(false);
    input.focus();
  }

  function updateProfile(profile={}){
    const fallbackName=String(localStorage.getItem('nyx.userName')||'Profile').trim()||'Profile';
    const name=String(profile.displayName||fallbackName).trim()||'Profile';
    const handle=String(profile.handle||'Open your Nyx profile').trim();
    const avatar=String(profile.avatarUrl||'').trim();
    profileName.textContent=name;
    profileHandle.textContent=handle;
    profileInitial.textContent=(name[0]||'N').toUpperCase();
    if(/^(?:https?:|blob:|data:image\/|\/)/i.test(avatar)){
      profileAvatar.src=avatar;
      profileAvatar.hidden=false;
      profileInitial.hidden=true;
    }else{
      profileAvatar.removeAttribute('src');
      profileAvatar.hidden=true;
      profileInitial.hidden=false;
    }
  }

  function requestProfile(){
    updateProfile();
    if(parent!==window) parent.postMessage({type:'nyx:ai-profile-request'},location.origin);
  }

  function updateThreadTitle(items){
    const first=items.find(item=>item.role==='user')?.content||'';
    threadTitle.textContent=temporaryMode&&!first?'Temporary chat':(first ? (first.length>58?`${first.slice(0,58)}…`:first) : 'New conversation');
  }

  function render(){
    const items=savedMessages();
    conversation.innerHTML='';
    if(!items.length){
      conversation.classList.add('is-empty');
      conversation.innerHTML=welcome();
    }else{
      conversation.classList.remove('is-empty');
      items.forEach(item=>addMessage(item.role,item.content));
    }
    updateThreadTitle(items);
    applyLogoTheme();
  }

  function modelLabel(id){
    return modelCatalog.find(item=>item.id===id)?.label||id;
  }

  function groupedModels(models){
    const groups=new Map();
    models.forEach(item=>{
      const company=item.company||'Other models';
      if(!groups.has(company)) groups.set(company,[]);
      groups.get(company).push(item);
    });
    return [...groups];
  }

  function modelOptions(models){
    return groupedModels(models).map(([company,items])=>`<optgroup label="${escapeHtml(company)}">${items.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('')}</optgroup>`).join('');
  }

  function modelMenuOptions(models,selected){
    return groupedModels(models).map(([company,items],groupIndex)=>{
      const groupId=`modelGroup${groupIndex}`;
      return `<section class="ai-model-group" role="group" aria-labelledby="${groupId}">
        <p class="ai-model-group-label" id="${groupId}">${escapeHtml(company)}</p>
        ${items.map(item=>`<button class="ai-model-option" type="button" role="option" data-model-id="${escapeHtml(item.id)}" aria-selected="${item.id===selected?'true':'false'}">
          <span class="ai-model-option-label">${escapeHtml(item.label)}</span>
          <span class="ai-model-option-check" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m5 10 3 3 7-7"/></svg></span>
        </button>`).join('')}
      </section>`;
    }).join('');
  }

  function syncModelControl(){
    const selected=model.value||DEFAULT_MODEL;
    const label=modelLabel(selected);
    modelSelected.textContent=label;
    modelTrigger.title=`Model: ${label}`;
    modelTrigger.setAttribute('aria-label',`AI model: ${label}`);
    modelOptionsHost.querySelectorAll('[data-model-id]').forEach(option=>{
      option.setAttribute('aria-selected',String(option.dataset.modelId===selected));
    });
  }

  function renderModelOptions(models,selected){
    model.innerHTML=modelOptions(models);
    model.value=selected;
    modelOptionsHost.innerHTML=modelMenuOptions(models,selected);
    const count=modelMenu.querySelector('[data-model-count]');
    if(count) count.textContent=`${models.length} available`;
    syncModelControl();
  }

  function modelOptionElements(){
    return [...modelOptionsHost.querySelectorAll('[data-model-id]')];
  }

  function closeModelMenu({restoreFocus=false}={}){
    if(modelMenu.hidden) return;
    modelMenu.hidden=true;
    modelPicker.classList.remove('is-open');
    modelTrigger.setAttribute('aria-expanded','false');
    if(restoreFocus) modelTrigger.focus();
  }

  function openModelMenu(direction=0){
    if(modelTrigger.disabled) return;
    modelMenu.hidden=false;
    modelPicker.classList.add('is-open');
    modelTrigger.setAttribute('aria-expanded','true');
    requestAnimationFrame(()=>{
      const options=modelOptionElements();
      const selectedIndex=Math.max(0,options.findIndex(option=>option.getAttribute('aria-selected')==='true'));
      const index=direction<0?options.length-1:(direction>0?0:selectedIndex);
      options[index]?.focus({preventScroll:true});
      options[index]?.scrollIntoView({block:'nearest'});
    });
  }

  function selectModel(id){
    if(!modelCatalog.some(item=>item.id===id)) return;
    model.value=id;
    model.dispatchEvent(new Event('change',{bubbles:true}));
    closeModelMenu({restoreFocus:true});
  }

  async function loadModels(){
    const status=document.querySelector('.ai-model-status');
    model.disabled=true;
    modelTrigger.disabled=true;
    modelTrigger.setAttribute('aria-busy','true');
    try{
      const response=await fetch('/api/nyx-ai/models',{headers:{accept:'application/json'}});
      const data=await response.json();
      if(!response.ok) throw new Error(data?.error||`Model catalog failed (${response.status})`);
      const next=Array.isArray(data?.models)?data.models.flatMap(item=>{
        const id=String(item?.id||'').trim();
        const label=String(item?.label||id).trim();
        const company=String(item?.company||'').trim();
        return id&&label?[{id,label,company}]:[];
      }):[];
      if(!next.length) throw new Error('No models are currently available.');
      modelCatalog=next;
      const saved=activeThread()?.model||localStorage.getItem(MODEL_KEY)||DEFAULT_MODEL;
      const selected=next.some(item=>item.id===saved)?saved:(next.some(item=>item.id===DEFAULT_MODEL)?DEFAULT_MODEL:next[0].id);
      renderModelOptions(next,selected);
      localStorage.setItem(MODEL_KEY,selected);
      if(status) status.title=`${next.length} models available`;
    }catch(error){
      console.warn('Nyx AI model catalog could not be loaded:',error);
      if(status){status.classList.add('is-warning');status.title='Using the default model'}
    }finally{
      model.disabled=false;
      modelTrigger.disabled=false;
      modelTrigger.removeAttribute('aria-busy');
    }
  }

  function autoGrow(){
    input.style.height='auto';
    input.style.height=`${Math.min(input.scrollHeight,MAX_INPUT_HEIGHT)}px`;
    if(characterCount) characterCount.textContent=`${input.value.length} / ${input.maxLength}`;
  }

  function scrollToBottom(force=false){
    if(!force&&!followStream) return;
    requestAnimationFrame(()=>{feed.scrollTop=feed.scrollHeight});
  }

  function setBusy(busy){
    feed.setAttribute('aria-busy',String(busy));
    form.classList.toggle('is-busy',busy);
    input.disabled=busy;
    send.disabled=busy;
    imageInput.disabled=busy;
    attachImage.disabled=busy;
    removeAttachment.disabled=busy;
    send.setAttribute('aria-label',busy?'Waiting for Nyx AI':'Send message');
  }

  function clearChat(){
    stopRequest();
    clearAttachment();
    if(temporaryMode){
      temporaryMessages=[];
    }else if(activeThreadId){
      threads=threads.filter(thread=>thread.id!==activeThreadId);
      activeThreadId='';
      localStorage.removeItem(ACTIVE_THREAD_KEY);
      persistThreads();
    }
    syncLegacyMessages([]);
    renderThreadList();
    render();
    input.value='';
    autoGrow();
    input.focus();
  }

  async function copyText(value){
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(String(value||''));return}
    const helper=document.createElement('textarea');
    helper.value=String(value||'');
    helper.style.position='fixed';
    helper.style.opacity='0';
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
  }

  function showCopied(button){
    const label=button.querySelector('span');
    const previous=label?.textContent||'';
    button.classList.add('is-copied');
    button.setAttribute('aria-label','Copied');
    if(label) label.textContent='Copied';
    setTimeout(()=>{
      button.classList.remove('is-copied');
      button.setAttribute('aria-label',button.hasAttribute('data-copy-code')?'Copy code':'Copy message');
      if(label) label.textContent=previous||'Copy';
    },1200);
  }

  async function submitPrompt(){
    const prompt=input.value.trim();
    const attachment=attachedImage;
    if((!prompt&&!attachment)||send.disabled) return;
    const userText=prompt||'Please analyze this image.';
    const history=savedMessages();
    if(!history.length) updateThreadTitle([{role:'user',content:userText}]);
    history.push({role:'user',content:userText});
    saveMessages(history);
    addMessage('user',userText,{attachment});
    input.value='';
    autoGrow();
    const pending=addMessage('assistant','',{thinking:true});
    const requestedModel=model.value||DEFAULT_MODEL;
    activeController=new AbortController();
    setBusy(true);
    let answer='';
    let renderFrame=0;
    const renderAnswer=()=>{
      renderFrame=0;
      setMessageContent(pending,answer);
      scrollToBottom();
    };
    try{
      const imageContext=attachment?await readImageContext(attachment):'';
      const response=await fetch('/api/nyx-ai',{
        method:'POST',
        signal:activeController.signal,
        headers:{'content-type':'application/json'},
        body:JSON.stringify({model:requestedModel,message:userText,messages:history,imageContext,stream:true})
      });
      if(!response.ok){
        const data=await response.json().catch(()=>({}));
        throw new Error(data?.error||`Nyx AI failed (${response.status})`);
      }
      if(!response.body) throw new Error('The selected model did not return a stream.');
      const reader=response.body.getReader();
      const decoder=new TextDecoder();
      let buffer='';
      for(;;){
        const part=await reader.read();
        if(part.done) break;
        buffer+=decoder.decode(part.value,{stream:true});
        const lines=buffer.split(/\r?\n/);
        buffer=lines.pop()||'';
        for(const line of lines){
          if(!line.startsWith('data:')) continue;
          const raw=line.slice(5).trim();
          if(!raw||raw==='[DONE]') continue;
          try{
            const data=JSON.parse(raw);
            const token=data?.choices?.[0]?.delta?.content||data?.choices?.[0]?.text||'';
            if(token){
              answer+=token;
              if(!renderFrame) renderFrame=requestAnimationFrame(renderAnswer);
            }
          }catch{}
        }
      }
      if(renderFrame){cancelAnimationFrame(renderFrame);renderAnswer()}
      const clean=answer.trim();
      if(!clean) throw new Error('The selected model returned an empty response.');
      setMessageContent(pending,clean);
      history.push({role:'assistant',content:clean});
      saveMessages(history);
    }catch(error){
      if(error?.name==='AbortError') return;
      setMessageContent(pending,error?.message||'Nyx AI could not complete that request.',{error:true});
    }finally{
      activeController=null;
      setBusy(false);
      clearAttachment();
      input.focus();
      scrollToBottom();
    }
  }

  applyWorkspaceTheme();
  addEventListener('message',event=>{
    if(event.origin!==location.origin) return;
    if(event.data?.type==='nyx:theme-sync') applyWorkspaceTheme(event.data.theme);
    if(event.data?.type==='nyx:ai-profile') updateProfile(event.data.profile||{});
  });
  addEventListener('focus',requestProfile);
  addEventListener('storage',event=>{
    if(['nyx.theme','nyx.customThemeColor'].includes(event.key)) applyWorkspaceTheme();
    if(event.key===THREADS_KEY){
      threads=storedThreads();
      if(activeThreadId&&!threads.some(thread=>thread.id===activeThreadId)) activeThreadId='';
      renderThreadList();
      render();
    }
    if(event.key==='nyx.userName') requestProfile();
  });
  feed.addEventListener('scroll',()=>{
    followStream=feed.scrollHeight-feed.scrollTop-feed.clientHeight<100;
  },{passive:true});
  feed.addEventListener('click',async event=>{
    const starter=event.target.closest('[data-prompt]');
    if(starter){
      input.value=starter.dataset.prompt||'';
      autoGrow();
      input.focus();
      form.requestSubmit();
      return;
    }
    const copyCode=event.target.closest('[data-copy-code]');
    if(copyCode){
      await copyText(copyCode.closest('.ai-code-block')?.querySelector('pre code')?.textContent||'');
      showCopied(copyCode);
      return;
    }
    const copyMessage=event.target.closest('[data-copy-message]');
    if(copyMessage){
      const message=copyMessage.closest('.ai-message');
      await copyText(message?._nyxMessageText||'');
      showCopied(copyMessage);
    }
  });
  form.addEventListener('submit',event=>{event.preventDefault();void submitPrompt()});
  attachImage.addEventListener('click',()=>imageInput.click());
  imageInput.addEventListener('change',()=>{void readImageFile(imageInput.files?.[0])});
  removeAttachment.addEventListener('click',()=>{
    clearAttachment();
    input.focus();
  });
  input.addEventListener('paste',event=>{
    const image=[...(event.clipboardData?.files||[])].find(file=>String(file.type||'').startsWith('image/'));
    if(image) void readImageFile(image);
  });
  form.addEventListener('dragenter',event=>{
    if([...(event.dataTransfer?.items||[])].some(item=>item.kind==='file')) form.classList.add('is-dragging');
  });
  form.addEventListener('dragover',event=>{
    if([...(event.dataTransfer?.items||[])].some(item=>item.kind==='file')) event.preventDefault();
  });
  form.addEventListener('dragleave',event=>{
    if(!form.contains(event.relatedTarget)) form.classList.remove('is-dragging');
  });
  form.addEventListener('drop',event=>{
    form.classList.remove('is-dragging');
    const file=[...(event.dataTransfer?.files||[])][0];
    if(!file) return;
    event.preventDefault();
    void readImageFile(file);
  });
  input.addEventListener('input',autoGrow);
  input.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.isComposing){
      event.preventDefault();
      form.requestSubmit();
    }
  });
  modelTrigger.addEventListener('click',()=>{
    if(modelMenu.hidden) openModelMenu();
    else closeModelMenu();
  });
  modelTrigger.addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      openModelMenu(event.key==='ArrowDown'?1:-1);
    }else if(event.key==='Escape'){
      event.preventDefault();
      closeModelMenu();
    }
  });
  modelMenu.addEventListener('click',event=>{
    const option=event.target.closest('[data-model-id]');
    if(option) selectModel(option.dataset.modelId||'');
  });
  modelMenu.addEventListener('keydown',event=>{
    const option=event.target.closest('[data-model-id]');
    const options=modelOptionElements();
    const index=Math.max(0,options.indexOf(option));
    let target=-1;
    if(event.key==='ArrowDown') target=Math.min(options.length-1,index+1);
    else if(event.key==='ArrowUp') target=Math.max(0,index-1);
    else if(event.key==='Home') target=0;
    else if(event.key==='End') target=options.length-1;
    else if(event.key==='Enter'||event.key===' '){
      event.preventDefault();
      if(option) selectModel(option.dataset.modelId||'');
      return;
    }else if(event.key==='Escape'){
      event.preventDefault();
      closeModelMenu({restoreFocus:true});
      return;
    }else if(event.key==='Tab'){
      closeModelMenu();
      return;
    }
    if(target>=0){
      event.preventDefault();
      options[target]?.focus();
      options[target]?.scrollIntoView({block:'nearest'});
    }
  });
  document.addEventListener('pointerdown',event=>{
    if(!modelMenu.hidden&&!modelPicker.contains(event.target)) closeModelMenu();
  });
  model.addEventListener('change',()=>{
    localStorage.setItem(MODEL_KEY,model.value||DEFAULT_MODEL);
    model.title=modelLabel(model.value);
    const thread=activeThread();
    if(thread){
      thread.model=model.value||DEFAULT_MODEL;
      thread.updatedAt=Date.now();
      persistThreads();
      renderThreadList();
    }
    syncModelControl();
  });
  clear.addEventListener('click',clearChat);
  newChat.addEventListener('click',()=>startNewChat());
  temporaryChat.addEventListener('click',()=>startNewChat({temporary:true}));
  threadList.addEventListener('click',event=>{
    const button=event.target.closest('[data-thread-id]');
    if(button) selectThread(button.dataset.threadId||'');
  });
  sidebarToggle.addEventListener('click',()=>setSidebarOpen(!app.classList.contains('is-sidebar-open')));
  sidebarClose.addEventListener('click',()=>setSidebarOpen(false));
  sidebarScrim.addEventListener('click',()=>setSidebarOpen(false));
  profileButton.addEventListener('click',()=>{
    requestProfile();
    if(parent!==window) parent.postMessage({type:'nyx:ai-open-profile'},location.origin);
    else location.href='/';
  });
  profileAvatar.addEventListener('error',()=>{
    profileAvatar.hidden=true;
    profileInitial.hidden=false;
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&app.classList.contains('is-sidebar-open')){
      event.preventDefault();
      setSidebarOpen(false);
      sidebarToggle.focus();
    }
  });

  initializeThreads();
  renderModelOptions(modelCatalog,model.value||DEFAULT_MODEL);
  renderThreadList();
  render();
  autoGrow();
  requestProfile();
  void loadModels();
  input.focus();
})();
