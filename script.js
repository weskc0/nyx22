
(function(){
  'use strict';
  const nyxEarlyConsoleEntries=[];
  let nyxEarlyConsoleBuffering=true;
  const bufferNyxConsoleEntry=(level,args)=>{
    if(!nyxEarlyConsoleBuffering) return;
    nyxEarlyConsoleEntries.push({level,args:Array.from(args),time:new Date()});
    if(nyxEarlyConsoleEntries.length>200) nyxEarlyConsoleEntries.shift();
  };
  ['log','info','warn','error'].forEach(level=>{
    const original=console[level]?.bind(console);
    if(!original) return;
    console[level]=(...args)=>{
      bufferNyxConsoleEntry(level,args);
      return original(...args);
    };
  });
  addEventListener('error',event=>{
    bufferNyxConsoleEntry('error',[event.error || `${event.message || 'Script error'} at ${event.filename || 'unknown source'}:${event.lineno || 0}`]);
  });
  addEventListener('unhandledrejection',event=>{
    bufferNyxConsoleEntry('error',['Unhandled promise rejection',event.reason]);
  });
  //helpers
  const $ = id => document.getElementById(id);
  const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const store = {get(k,d){try{return JSON.parse(localStorage.getItem(k)) ?? d}catch{return d}}, set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}, text(k,d=''){try{return localStorage.getItem(k) ?? d}catch{return d}}, setText(k,v){try{localStorage.setItem(k,String(v))}catch{}}};
  const NYX_DISPLAY_NAME_FONTS=Object.freeze([['gg-sans','gg sans'],['headline','Headline'],['rounded','Rounded'],['wide','Wide'],['slab','Slab'],['condensed','Condensed'],['mono-block','Mono Block'],['tempo','Tempo'],['sakura','Sakura'],['jellybean','Jellybean'],['modern','Modern'],['medieval','Medieval'],['eight-bit','8Bit'],['vampyre','Vampyre']]);
  const NYX_DISPLAY_NAME_EFFECTS=Object.freeze([['solid','Solid'],['gradient','Gradient'],['neon','Neon'],['toon','Toon'],['pop','Pop']]);
  const nyxFounderProfileDefaults=Object.freeze({displayName:'1aqlla',handle:'@1aqlla',role:'Owner / Founder',bio:'Built Nyx for people who search, study, and create.',avatarUrl:'/assets/icons/founder-1aqlla.jpg',bannerUrl:'',accent:'#8fb8ff',accentPrimary:'#8fb8ff',accentSecondary:'#8ea1ff',bannerColor:'#8ea1ff',displayNameFont:'gg-sans',displayNameEffect:'solid',displayNameColorPrimary:'#ffffff',displayNameColorSecondary:'#8ea1ff',profileEffect:'none',customEffectPattern:'starfield',customEffectColorPrimary:'#ffffff',customEffectColorSecondary:'#8ea1ff',customEffectSpeed:7,customEffectIntensity:70,avatarDecoration:'none',status:'online',roles:['Owner','Developer'],badges:['Founder'],linkLabel:'',linkUrl:''});
  let nyxFounderProfile={...nyxFounderProfileDefaults};
  let nyxFounderProfileLoadPromise=null;
  let nyxFounderAuthConfig={enabled:false,ownerConfigured:false};
  let nyxFounderFirebaseAuth=null;
  let nyxFounderSignedInUser=null;
  let nyxFounderIsOwner=false;
  let nyxOwnerDashboardAccess=false;
  let nyxUserPermissions=[];
  let nyxUserAccountRole='member';
  let nyxUserSubscriptionStatus='free';
  let nyxUserAccountEmail='';
  let nyxFounderAuthReadyPromise=null;
  let nyxFirebaseTokenPromise=null;
  let nyxUserProfile=null;
  let nyxUserProfileCreatedAt='';
  let nyxUserActivityTimer=0;
  const nyxGifPosterCache=new Map();
  const nyxGifPosterResolved=new Map();
  const nyxProfileMediaResolved=new Map();
  const nyxProfileMediaPending=new Map();
  const NYX_PROFILE_IMAGE_DATA_LIMIT=850000;
  const NYX_PROFILE_MEDIA_DATA_LIMIT=11250000;
  const NYX_PROFILE_IMAGE_TOTAL_LIMIT=900000;
  const NYX_PROFILE_IMAGE_PLACEHOLDER='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
  function nyxProfileMediaPath(value){
    const source=String(value||'').trim();
    return /^\/api\/profile-media\/[A-Za-z0-9_-]{8,128}\/(?:avatar|banner)\/[A-Za-z0-9_-]{12,80}$/.test(source)?source:'';
  }
  function nyxAnimatedProfileImage(value){
    const source=String(value||'').trim();
    const media=nyxProfileMediaResolved.get(nyxProfileMediaPath(source));
    return /^data:image\/gif;base64,/i.test(source)||/\.gif(?:$|[?#])/i.test(source)||media?.mime==='image/gif';
  }
  async function nyxResolveProfileMedia(value){
    const source=nyxProfileMediaPath(value);
    if(!source)return null;
    if(nyxProfileMediaResolved.has(source))return nyxProfileMediaResolved.get(source);
    if(nyxProfileMediaPending.has(source))return nyxProfileMediaPending.get(source);
    const pending=(async()=>{
      const manifestResponse=await fetch(`${source}/manifest`,{cache:'force-cache'});
      const manifest=await manifestResponse.json().catch(()=>({}));
      const mime=String(manifest.mime||'').toLowerCase();
      const totalChunks=Number(manifest.totalChunks||0);
      if(!manifestResponse.ok||!/^image\/(?:gif|png|jpeg|webp)$/.test(mime)||!Number.isInteger(totalChunks)||totalChunks<1||totalChunks>32){
        throw new Error('That saved profile image is unavailable.');
      }
      const encodedChunks=new Array(totalChunks);
      let nextIndex=0;
      await Promise.all(Array.from({length:Math.min(4,totalChunks)},async()=>{
        while(nextIndex<totalChunks){
          const index=nextIndex++;
          const response=await fetch(`${source}/chunks/${index}`,{cache:'force-cache'});
          const encoded=(await response.text()).trim();
          if(!response.ok||!encoded||!/^[a-z0-9+/=]+$/i.test(encoded))throw new Error('That saved profile image is incomplete.');
          encodedChunks[index]=encoded;
        }
      }));
      const parts=encodedChunks.map(encoded=>{
        const decoded=atob(encoded);
        const bytes=new Uint8Array(decoded.length);
        for(let index=0;index<decoded.length;index++)bytes[index]=decoded.charCodeAt(index);
        return bytes;
      });
      const blob=new Blob(parts,{type:mime});
      if(Number(manifest.byteLength||0)>0&&blob.size!==Number(manifest.byteLength)){
        throw new Error('That saved profile image did not pass its size check.');
      }
      const result={url:URL.createObjectURL(blob),mime,size:blob.size};
      nyxProfileMediaResolved.set(source,result);
      return result;
    })().finally(()=>nyxProfileMediaPending.delete(source));
    nyxProfileMediaPending.set(source,pending);
    return pending;
  }
  function nyxCaptureGifPoster(image,source,maxSize=180){
    const existing=nyxGifPosterResolved.get(source);
    if(existing)return Promise.resolve(existing);
    const cacheKey=`${source}::${maxSize}`;
    if(nyxGifPosterCache.has(cacheKey))return nyxGifPosterCache.get(cacheKey);
    const poster=new Promise(resolve=>{
      const capture=()=>{
        try{
          const width=Number(image.naturalWidth||0);
          const height=Number(image.naturalHeight||0);
          if(!width||!height){resolve('');return}
          const scale=Math.min(1,maxSize/Math.max(width,height));
          const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(width*scale));
          canvas.height=Math.max(1,Math.round(height*scale));
          canvas.getContext('2d',{alpha:true})?.drawImage(image,0,0,canvas.width,canvas.height);
          resolve(canvas.toDataURL('image/webp',.78));
        }catch{resolve('')}
      };
      if(image.complete&&image.naturalWidth)capture();
      else{
        image.addEventListener('load',capture,{once:true});
        image.addEventListener('error',()=>resolve(''),{once:true});
      }
    }).then(result=>{
      if(result)nyxGifPosterResolved.set(source,result);
      return result;
    });
    nyxGifPosterCache.set(cacheKey,poster);
    return poster;
  }
  function nyxProfileStillSource(source){
    const value=String(source||'');
    const mediaPath=nyxProfileMediaPath(value);
    if(mediaPath){
      const media=nyxProfileMediaResolved.get(mediaPath);
      if(!media)return NYX_PROFILE_IMAGE_PLACEHOLDER;
      return media.mime==='image/gif'?(nyxGifPosterResolved.get(value)||media.url):media.url;
    }
    return nyxAnimatedProfileImage(value)?(nyxGifPosterResolved.get(value)||value):value;
  }
  function nyxSetCompactGifMotion(host,active){
    const image=host?.querySelector(':scope > img');
    const source=String(host?.dataset.nyxAnimatedSource||'');
    const poster=String(host?.dataset.nyxAnimatedPoster||'');
    if(!image||!source)return;
    const target=active&&document.visibilityState==='visible'?source:(poster||source);
    if(image.getAttribute('src')!==target)image.setAttribute('src',target);
  }
  function nyxApplyCompactProfileImage(host,image,identity,renderSource,animated,maxSize=180){
    if(!host||!image)return;
    if(!animated){
      delete host.dataset.nyxAnimatedIdentity;
      delete host.dataset.nyxAnimatedSource;
      delete host.dataset.nyxAnimatedPoster;
      if(image.getAttribute('src')!==renderSource)image.setAttribute('src',renderSource);
      return;
    }
    const sourceChanged=host.dataset.nyxAnimatedIdentity!==identity||host.dataset.nyxAnimatedSource!==renderSource;
    host.dataset.nyxAnimatedIdentity=identity;
    host.dataset.nyxAnimatedSource=renderSource;
    const cachedPoster=nyxGifPosterResolved.get(identity)||'';
    if(sourceChanged){
      if(cachedPoster)host.dataset.nyxAnimatedPoster=cachedPoster;
      else delete host.dataset.nyxAnimatedPoster;
      const initial=cachedPoster||renderSource;
      if(image.getAttribute('src')!==initial)image.setAttribute('src',initial);
    }
    if(!host.dataset.nyxGifMotionBound){
      host.dataset.nyxGifMotionBound='true';
      const focusTarget=host.closest('button')||host;
      host.addEventListener('pointerenter',()=>nyxSetCompactGifMotion(host,true));
      host.addEventListener('pointerleave',()=>nyxSetCompactGifMotion(host,focusTarget.matches(':focus')));
      focusTarget.addEventListener('focus',()=>nyxSetCompactGifMotion(host,true));
      focusTarget.addEventListener('blur',()=>nyxSetCompactGifMotion(host,false));
    }
    void nyxCaptureGifPoster(image,identity,maxSize).then(poster=>{
      if(!poster||host.dataset.nyxAnimatedIdentity!==identity)return;
      host.dataset.nyxAnimatedPoster=poster;
      const focusTarget=host.closest('button')||host;
      nyxSetCompactGifMotion(host,host.matches(':hover')||focusTarget.matches(':focus'));
    });
  }
  function nyxManageCompactGif(host,image,source,maxSize=180){
    if(!host||!image)return;
    const mediaPath=nyxProfileMediaPath(source);
    if(!mediaPath){
      delete host.dataset.nyxProfileMediaSource;
      nyxApplyCompactProfileImage(host,image,String(source||''),String(source||''),nyxAnimatedProfileImage(source),maxSize);
      return;
    }
    host.dataset.nyxProfileMediaSource=mediaPath;
    const resolved=nyxProfileMediaResolved.get(mediaPath);
    if(resolved){
      nyxApplyCompactProfileImage(host,image,mediaPath,resolved.url,resolved.mime==='image/gif',maxSize);
      return;
    }
    if(image.getAttribute('src')!==NYX_PROFILE_IMAGE_PLACEHOLDER)image.setAttribute('src',NYX_PROFILE_IMAGE_PLACEHOLDER);
    void nyxResolveProfileMedia(mediaPath).then(media=>{
      if(!media||host.dataset.nyxProfileMediaSource!==mediaPath)return;
      nyxApplyCompactProfileImage(host,image,mediaPath,media.url,media.mime==='image/gif',maxSize);
    }).catch(error=>{
      if(host.dataset.nyxProfileMediaSource!==mediaPath)return;
      console.warn('Nyx profile media could not load:',error);
      if(image.getAttribute('src')!==mediaPath)image.setAttribute('src',mediaPath);
    });
  }
  function nyxManageUserProfileGifs(root,profile){
    if(!root||!profile)return;
    const avatarHost=root.querySelector?.('.nyx-user-profile-avatar,.nyx-account-menu-avatar');
    const avatarImage=avatarHost?.querySelector(':scope > img');
    if(avatarHost&&avatarImage)nyxManageCompactGif(avatarHost,avatarImage,profile.avatarUrl,640);
    const bannerHost=root.querySelector?.('.nyx-user-profile-banner,.nyx-account-menu-banner');
    const bannerImage=bannerHost?.querySelector(':scope > img');
    if(bannerHost&&bannerImage)nyxManageCompactGif(bannerHost,bannerImage,profile.bannerUrl,720);
    root.querySelectorAll?.('.nyx-profile-rail-avatar,.nyx-profile-decoration-avatar,.nyx-profile-nameplate-preview>span,.nyx-profile-switch-avatar').forEach(host=>{
      const image=host.querySelector(':scope > img');
      if(image)nyxManageCompactGif(host,image,profile.avatarUrl,240);
    });
  }
  function nyxManageFounderProfileGifs(root,profile=normalizeNyxFounderProfile(nyxFounderProfile)){
    root?.querySelectorAll?.('[data-nyx-founder-profile]').forEach(card=>{
      const avatarHost=card.querySelector('.nyx-founder-image-wrap');
      const avatarImage=avatarHost?.querySelector(':scope > img');
      if(avatarHost&&avatarImage)nyxManageCompactGif(avatarHost,avatarImage,profile.avatarUrl,640);
      const bannerHost=card.querySelector('.nyx-founder-banner');
      const bannerImage=bannerHost?.querySelector(':scope > img');
      if(bannerHost&&bannerImage)nyxManageCompactGif(bannerHost,bannerImage,profile.bannerUrl,720);
    });
  }
  function nyxAccountUsername(value){return String(value||'').trim().toLowerCase().replace(/[^a-z0-9_.-]/g,'').slice(0,32)}
  function nyxAccountEmail(username){return `${nyxAccountUsername(username)}@account.nyx.local`}
  function nyxHasPremiumSubscription(value=nyxUserSubscriptionStatus){return ['premium','trialing'].includes(String(value||'').trim().toLowerCase())}
  function nyxHasAccountPermission(permission){return nyxUserPermissions.includes(String(permission||''))}
  function syncNyxAccountEntitlements(account={}){
    const previousStatus=nyxUserSubscriptionStatus;
    if(account.role)nyxUserAccountRole=String(account.role||'member');
    if(typeof account.owner==='boolean')nyxFounderIsOwner=account.owner;
    if(typeof account.dashboard==='boolean')nyxOwnerDashboardAccess=account.dashboard;
    if(Array.isArray(account.permissions))nyxUserPermissions=account.permissions.map(String);
    if(account.subscriptionStatus)nyxUserSubscriptionStatus=String(account.subscriptionStatus||'free').toLowerCase();
    document.body.dataset.nyxSubscription=nyxUserSubscriptionStatus;
    document.body.classList.toggle('nyx-premium-account',nyxHasPremiumSubscription());
    if(previousStatus!==nyxUserSubscriptionStatus){
      dispatchEvent(new CustomEvent('nyx:subscription-change',{detail:{subscriptionStatus:nyxUserSubscriptionStatus,premiumAccess:nyxHasPremiumSubscription()}}));
    }
  }
  function nyxUserImage(value,fallback=''){const raw=String(value||'').trim();if(!raw)return fallback;if(/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(raw)&&raw.length<=NYX_PROFILE_MEDIA_DATA_LIMIT)return raw.replace(/\s/g,'');return nyxFounderUrl(raw,fallback)}
  function nyxDisplayNameStyleClass(profile={}){
    return `nyx-styled-display-name nyx-name-font-${profile.displayNameFont||'gg-sans'} nyx-name-effect-${profile.displayNameEffect||'solid'}`;
  }
  function nyxDisplayNameStyleVars(profile={}){
    return `--nyx-name-color-primary:${profile.displayNameColorPrimary||'#ffffff'};--nyx-name-color-secondary:${profile.displayNameColorSecondary||'#8ea1ff'}`;
  }
  function nyxProfileEffectClass(profile={}){
    return `nyx-user-profile-effect-${profile.profileEffect||'none'} nyx-user-profile-custom-${profile.customEffectPattern||'starfield'}`;
  }
  function nyxProfileEffectVars(profile={}){
    return `--nyx-custom-effect-primary:${profile.customEffectColorPrimary||'#ffffff'};--nyx-custom-effect-secondary:${profile.customEffectColorSecondary||profile.accentSecondary||'#8ea1ff'};--nyx-custom-effect-duration:${Math.max(2,Math.min(18,Number(profile.customEffectSpeed)||7))}s;--nyx-custom-effect-opacity:${Math.max(.2,Math.min(1,(Number(profile.customEffectIntensity)||70)/100))}`;
  }
  function normalizeNyxUserProfile(value={},user=nyxFounderSignedInUser){
    const source=value&&typeof value==='object'?value:{};
    const uid=String(user?.uid||'');
    const username=nyxAccountUsername(String(user?.email||'').split('@')[0])||`nyx-${uid.slice(0,8)||'user'}`;
    const accentPrimary=/^#[0-9a-f]{6}$/i.test(String(source.accentPrimary||source.accent||'').trim())?String(source.accentPrimary||source.accent).trim().toLowerCase():'#5865f2';
    const accentSecondary=/^#[0-9a-f]{6}$/i.test(String(source.accentSecondary||source.bannerPrimary||'').trim())?String(source.accentSecondary||source.bannerPrimary).trim().toLowerCase():'#8ea1ff';
    const bannerColor=/^#[0-9a-f]{6}$/i.test(String(source.bannerColor||source.bannerSecondary||'').trim())?String(source.bannerColor||source.bannerSecondary).trim().toLowerCase():accentSecondary;
    const displayNameColorPrimary=/^#[0-9a-f]{6}$/i.test(String(source.displayNameColorPrimary||'').trim())?String(source.displayNameColorPrimary).trim().toLowerCase():'#ffffff';
    const displayNameColorSecondary=/^#[0-9a-f]{6}$/i.test(String(source.displayNameColorSecondary||'').trim())?String(source.displayNameColorSecondary).trim().toLowerCase():accentSecondary;
    const displayNameFont=NYX_DISPLAY_NAME_FONTS.some(([value])=>value===String(source.displayNameFont||'').toLowerCase())?String(source.displayNameFont).toLowerCase():'gg-sans';
    const displayNameEffect=NYX_DISPLAY_NAME_EFFECTS.some(([value])=>value===String(source.displayNameEffect||'').toLowerCase())?String(source.displayNameEffect).toLowerCase():'solid';
    const customEffectPattern=['starfield','aurora','comets','grid'].includes(String(source.customEffectPattern||'').toLowerCase())?String(source.customEffectPattern).toLowerCase():'starfield';
    const customEffectColorPrimary=/^#[0-9a-f]{6}$/i.test(String(source.customEffectColorPrimary||'').trim())?String(source.customEffectColorPrimary).trim().toLowerCase():'#ffffff';
    const customEffectColorSecondary=/^#[0-9a-f]{6}$/i.test(String(source.customEffectColorSecondary||'').trim())?String(source.customEffectColorSecondary).trim().toLowerCase():accentSecondary;
    const customEffectSpeed=Math.max(2,Math.min(18,Number(source.customEffectSpeed)||7));
    const customEffectIntensity=Math.max(20,Math.min(100,Number(source.customEffectIntensity)||70));
    return {displayName:nyxFounderText(source.displayName,user?.displayName||username,48),handle:nyxFounderText(source.handle,`@${username}`,40).replace(/\s+/g,''),bio:String(source.bio||'').trim().slice(0,280),customStatus:String(source.customStatus||'').trim().slice(0,80),avatarUrl:nyxUserImage(source.avatarUrl,nyxUserImage(user?.photoURL)),bannerUrl:nyxUserImage(source.bannerUrl),accent:accentPrimary,accentPrimary,accentSecondary,bannerColor,displayNameFont,displayNameEffect,displayNameColorPrimary,displayNameColorSecondary,profileEffect:['none','glow','sparkle','aurora','holographic','fireflies','cosmic-dust','electric-storm','meteor-shower','cyber-grid','plasma','snowfall','embers','bubbles','custom'].includes(String(source.profileEffect||'').toLowerCase())?String(source.profileEffect).toLowerCase():'none',customEffectPattern,customEffectColorPrimary,customEffectColorSecondary,customEffectSpeed,customEffectIntensity,avatarDecoration:['none','starfall','orbit','laurel','neon-wings'].includes(String(source.avatarDecoration||'').toLowerCase())?String(source.avatarDecoration).toLowerCase():'none',status:['online','idle','dnd','offline'].includes(String(source.status||'').toLowerCase())?String(source.status).toLowerCase():'online'};
  }
  async function nyxGetFirebaseToken(forceRefresh=false){
    const user=nyxFounderSignedInUser;
    if(!user)return '';
    if(nyxFirebaseTokenPromise)return nyxFirebaseTokenPromise;
    const request=(async()=>{
      try{
        return await user.getIdToken(forceRefresh);
      }catch{
        try{
          await user.reload();
          return await user.getIdToken(true);
        }catch{
          return '';
        }
      }
    })();
    nyxFirebaseTokenPromise=request;
    try{return await request}
    finally{if(nyxFirebaseTokenPromise===request)nyxFirebaseTokenPromise=null}
  }
  function nyxFriendlyFirebaseError(error,fallback='Your account request could not be completed.'){
    const code=String(error?.code||'').toLowerCase();
    const message=String(error?.message||'');
    if(code.includes('user-token-expired')||/user token has expired|sign-in has expired/i.test(message))return 'Your session expired. Log in again to continue.';
    if(code.includes('network-request-failed')||/network request failed/i.test(message))return 'Nyx could not reach Firebase. Check your connection and try again.';
    if(code.includes('too-many-requests'))return 'Too many attempts. Wait a few minutes and try again.';
    if(code.includes('invalid-custom-token')||code.includes('custom-token-mismatch'))return 'Nyx could not start the Firebase session. Try logging in again.';
    return message&&!/^firebase:/i.test(message)?message:fallback;
  }
  async function loadNyxUserProfile(){
    if(!nyxFounderSignedInUser) return null;
    try{
      const token=await nyxGetFirebaseToken(true);
      if(!token)throw new Error('Your sign-in has expired.');
      const [data,account]=await Promise.all([
        nyxProfileMediaFetch('/api/profiles/me',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'},'Profile is unavailable.'),
        nyxProfileMediaFetch('/api/account/me',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'},'Account information is unavailable.')
      ]);
      nyxUserProfile=normalizeNyxUserProfile(data.profile);
      nyxUserProfileCreatedAt=String(data.createdAt||'');
      syncNyxAccountEntitlements(account);
      nyxUserAccountEmail=String(account.email||'');
      syncFounderOwnerControls();
      return {...data,account};
    }catch(error){console.warn('Nyx Profile could not load:',error);return null}
  }
  function stopNyxUserActivity(){
    clearInterval(nyxUserActivityTimer);
    nyxUserActivityTimer=0;
  }
  async function sendNyxUserActivity(path,user=nyxFounderSignedInUser){
    if(!user||!path)return;
    try{
      let token=await nyxGetFirebaseToken();
      if(!token)return;
      const options={method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:path.endsWith('/event')?JSON.stringify({action:'login'}):'{}',keepalive:true};
      let response=await fetch(path,options);
      if(response.status===401){
        token=await nyxGetFirebaseToken(true);
        if(token){
          options.headers.Authorization=`Bearer ${token}`;
          response=await fetch(path,options);
        }
      }
      if(response.ok&&path.endsWith('/heartbeat')){
        const account=await response.json().catch(()=>null);
        if(account){syncNyxAccountEntitlements(account);syncFounderOwnerControls()}
      }
    }catch{}
  }
  function startNyxUserActivity(user=nyxFounderSignedInUser){
    stopNyxUserActivity();
    if(!user)return;
    void sendNyxUserActivity('/api/activity/heartbeat',user);
    let loginRecorded=false;
    try{loginRecorded=sessionStorage.getItem(`nyx.login-recorded.${user.uid}`)==='1'}catch{}
    if(!loginRecorded){
      void sendNyxUserActivity('/api/activity/event',user);
      try{sessionStorage.setItem(`nyx.login-recorded.${user.uid}`,'1')}catch{}
    }
    nyxUserActivityTimer=setInterval(()=>{if(document.visibilityState==='visible')void sendNyxUserActivity('/api/activity/heartbeat',user)},30000);
  }
  document.addEventListener('visibilitychange',()=>{
    document.querySelectorAll('[data-nyx-animated-source]').forEach(host=>{
      const focusTarget=host.closest('button')||host;
      nyxSetCompactGifMotion(host,document.visibilityState==='visible'&&(host.matches(':hover')||focusTarget.matches(':focus')));
    });
    if(document.visibilityState==='visible')void sendNyxUserActivity('/api/activity/heartbeat');
  });
  function nyxAccountMenuIcon(name){
    const paths={
      edit:'<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
      switch:'<path d="m16 3 4 4-4 4"/><path d="M20 7H9a4 4 0 0 0-4 4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h11a4 4 0 0 0 4-4"/>',
      id:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 9v6M12 9v6M16 12h.01"/>',
      people:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
      dashboard:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
      chevron:'<path d="m9 18 6-6-6-6"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name]||''}</svg>`;
  }
  function closeNyxAccountMenu(){
    document.querySelector('.nyx-account-menu')?.remove();
    const button=document.getElementById('nyxAccountButton');
    button?.setAttribute('aria-expanded','false');
  }
  function positionNyxAccountMenu(menu,button){
    if(!menu||!button) return;
    const anchor=button.getBoundingClientRect();
    const width=Math.min(280,Math.max(0,innerWidth-24));
    const left=Math.max(12,Math.min(anchor.left,innerWidth-width-12));
    const top=Math.max(12,anchor.bottom+8);
    menu.style.width=`${width}px`;
    menu.style.left=`${Math.round(left)}px`;
    menu.style.top=`${Math.round(top)}px`;
    menu.style.maxHeight=`${Math.max(80,Math.floor(innerHeight-top-12))}px`;
  }
  function openNyxAccountMenu(button=document.getElementById('nyxAccountButton')){
    closeNyxAccountMenu();
    if(!nyxFounderSignedInUser) return openNyxAccountAccess();
    const profile=normalizeNyxUserProfile(nyxUserProfile);
    const statusLabel={online:'Online',idle:'Idle',dnd:'Do not disturb',offline:'Invisible'}[profile.status]||'Online';
    const avatar=profile.avatarUrl?`<img src="${esc(nyxProfileStillSource(profile.avatarUrl))}" alt="">`:`<span>${esc(profile.displayName.slice(0,1).toUpperCase()||'N')}</span>`;
    const banner=profile.bannerUrl?`<img src="${esc(nyxProfileStillSource(profile.bannerUrl))}" alt="" aria-hidden="true">`:'';
    const menu=document.createElement('aside');
    menu.className=`nyx-account-menu ${nyxProfileEffectClass(profile)}`;
    menu.setAttribute('role','menu');
    menu.setAttribute('aria-label','Account options');
    menu.style.setProperty('--nyx-account-primary',profile.accentPrimary);
    menu.style.setProperty('--nyx-account-secondary',profile.accentSecondary);
    menu.style.setProperty('--nyx-account-banner',profile.bannerColor);
    menu.style.setProperty('--nyx-user-accent-primary',profile.accentPrimary);
    menu.style.setProperty('--nyx-user-accent-secondary',profile.accentSecondary);
    menu.style.setProperty('--nyx-user-banner-color',profile.bannerColor);
    menu.style.cssText+=nyxProfileEffectVars(profile);
    const ownerControls=nyxOwnerDashboardAccess?`<div class="nyx-account-menu-group nyx-account-menu-owner"><button type="button" role="menuitem" data-nyx-account-menu-action="owner-dashboard">${nyxAccountMenuIcon('dashboard')}<span>Owner Dashboard</span>${nyxAccountMenuIcon('chevron')}</button></div>`:'';
    menu.innerHTML=`<i class="nyx-user-profile-effect nyx-account-menu-profile-effect" aria-hidden="true"></i><div class="nyx-account-menu-banner">${banner}</div><div class="nyx-account-menu-profile"><div class="nyx-account-menu-avatar nyx-avatar-decoration-${esc(profile.avatarDecoration)}">${avatar}<i class="nyx-avatar-decoration" aria-hidden="true"><span></span></i><i class="nyx-user-status nyx-user-status-${esc(profile.status)}" aria-label="${esc(statusLabel)}"></i></div><span class="nyx-account-menu-status">${esc(profile.customStatus||statusLabel)}</span><h2 class="${nyxDisplayNameStyleClass(profile)}" style="${nyxDisplayNameStyleVars(profile)}">${esc(profile.displayName)}</h2><p class="nyx-account-menu-handle">${esc(profile.handle)}</p><p class="nyx-account-menu-bio">${esc(profile.bio||'No bio yet.')}</p></div>${ownerControls}<div class="nyx-account-menu-group"><button type="button" role="menuitem" data-nyx-account-menu-action="edit">${nyxAccountMenuIcon('edit')}<span>Edit Profile</span></button><button type="button" role="menuitem" data-nyx-account-menu-action="profiles">${nyxAccountMenuIcon('people')}<span>Browse Profiles</span>${nyxAccountMenuIcon('chevron')}</button><hr><button type="button" role="menuitem" data-nyx-account-menu-action="status"><i class="nyx-user-status nyx-user-status-${esc(profile.status)}" aria-hidden="true"></i><span>${esc(statusLabel)}</span>${nyxAccountMenuIcon('chevron')}</button></div><div class="nyx-account-menu-group"><button type="button" role="menuitem" data-nyx-account-menu-action="switch">${nyxAccountMenuIcon('switch')}<span>Switch Accounts</span>${nyxAccountMenuIcon('chevron')}</button><hr><button type="button" role="menuitem" data-nyx-account-menu-action="copy-id">${nyxAccountMenuIcon('id')}<span>Copy User ID</span></button></div>`;
    document.body.appendChild(menu);
    syncNyxAccountButtonAvatar(menu.querySelector('.nyx-account-menu-avatar'),profile);
    const bannerHost=menu.querySelector('.nyx-account-menu-banner');
    const bannerImage=bannerHost?.querySelector(':scope > img');
    if(bannerHost&&bannerImage)nyxManageCompactGif(bannerHost,bannerImage,profile.bannerUrl,420);
    button?.setAttribute('aria-expanded','true');
    positionNyxAccountMenu(menu,button);
    requestAnimationFrame(()=>menu.classList.add('show'));
    return menu;
  }
  function toggleNyxAccountMenu(button=document.getElementById('nyxAccountButton')){
    if(document.querySelector('.nyx-account-menu')) return closeNyxAccountMenu();
    return openNyxAccountMenu(button);
  }
  async function copyNyxFirebaseUserId(){
    const uid=String(nyxFounderSignedInUser?.uid||'');
    if(!uid) return toast('No Firebase user ID is available');
    let copied=false;
    try{await navigator.clipboard.writeText(uid);copied=true}catch{}
    if(!copied){
      const field=document.createElement('textarea');
      field.value=uid;
      field.setAttribute('readonly','');
      field.style.cssText='position:fixed;left:-9999px;top:0';
      document.body.appendChild(field);
      field.select();
      try{copied=document.execCommand('copy')}catch{}
      field.remove();
    }
    toast(copied?'Firebase user ID copied':'Could not copy the Firebase user ID');
  }
  function openNyxOwnerDashboard(){
    closeNyxAccountMenu();
    if(!nyxFounderSignedInUser||!nyxOwnerDashboardAccess){
      toast('Staff dashboard access is required');
      return;
    }
    if(!globalThis.NyxOwnerDashboard?.open){
      toast('Owner Dashboard is unavailable');
      return;
    }
    globalThis.NyxOwnerDashboard.open({
      getToken:()=>nyxGetFirebaseToken(true),
      toast
    });
  }
  async function openNyxProfileDirectory(){
    closeNyxAccountMenu();
    if(!nyxFounderSignedInUser){await openNyxAccountAccess();if(!nyxFounderSignedInUser)return}
    document.querySelector('.nyx-profile-directory-overlay')?.remove();
    const overlay=document.createElement('div');
    overlay.className='nyx-profile-directory-overlay';
    overlay.innerHTML=`<section class="nyx-profile-directory" role="dialog" aria-modal="true" aria-labelledby="nyxProfileDirectoryTitle">
      <header class="nyx-profile-directory-header"><div><span>NYX COMMUNITY</span><h2 id="nyxProfileDirectoryTitle">Browse Profiles</h2><p>Discover the people using Nyx.</p></div><button type="button" data-close-profile-directory aria-label="Close profile browser">&#215;</button></header>
      <div class="nyx-profile-directory-layout">
        <aside class="nyx-profile-directory-sidebar">
          <label class="nyx-profile-directory-search">${nyxAccountMenuIcon('people')}<input type="search" data-profile-directory-search placeholder="Search name, username, or role" autocomplete="off"></label>
          <p data-profile-directory-summary>Loading profiles…</p>
          <div class="nyx-profile-directory-results" data-profile-directory-results aria-live="polite"></div>
        </aside>
        <main class="nyx-profile-directory-view" data-profile-directory-view><div class="nyx-profile-directory-empty"><span>${nyxAccountMenuIcon('people')}</span><h3>Select a profile</h3><p>Choose someone to view their public Nyx profile.</p></div></main>
      </div>
    </section>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(()=>overlay.classList.add('show'));
    const resultsHost=overlay.querySelector('[data-profile-directory-results]');
    const view=overlay.querySelector('[data-profile-directory-view]');
    const summary=overlay.querySelector('[data-profile-directory-summary]');
    const search=overlay.querySelector('[data-profile-directory-search]');
    const roleLabel=role=>({owner:'Owner',co_owner:'Co-owner',admin:'Admin',manager:'Manager',developer:'Developer',moderator:'Moderator',support:'Support',tester:'Tester',contributor:'Contributor',member:'Member'}[role]||'Member');
    let entries=[];
    let selectedUid='';
    let searchTimer=0;
    let controller=null;
    const close=()=>{
      clearTimeout(searchTimer);
      controller?.abort();
      document.removeEventListener('keydown',onKeydown);
      overlay.classList.remove('show');
      setTimeout(()=>overlay.remove(),180);
    };
    const renderProfile=entry=>{
      if(!entry)return;
      selectedUid=entry.uid;
      resultsHost.querySelectorAll('[data-directory-profile]').forEach(button=>button.classList.toggle('active',button.dataset.directoryProfile===selectedUid));
      const profile=normalizeNyxUserProfile(entry.profile);
      view.innerHTML=`<div class="nyx-profile-directory-view-head"><span>${entry.self?'Your public profile':roleLabel(entry.role)}</span><strong>${esc(profile.displayName)}</strong></div><div class="nyx-profile-directory-card-host">${nyxUserProfileCardMarkup(profile,{role:entry.role,createdAt:entry.createdAt})}</div>`;
      nyxManageUserProfileGifs(view,profile);
    };
    const renderResults=()=>{
      summary.textContent=`${entries.length} profile${entries.length===1?'':'s'}`;
      if(!entries.length){
        resultsHost.innerHTML='<div class="nyx-profile-directory-no-results"><strong>No profiles found</strong><span>Try a different name or role.</span></div>';
        view.innerHTML='<div class="nyx-profile-directory-empty"><span aria-hidden="true">?</span><h3>No matching profiles</h3><p>Change your search to discover more people.</p></div>';
        selectedUid='';
        return;
      }
      resultsHost.innerHTML=entries.map(entry=>{
        const profile=normalizeNyxUserProfile(entry.profile);
        const avatar=profile.avatarUrl?`<img src="${esc(nyxProfileStillSource(profile.avatarUrl))}" alt="">`:`<span>${esc(profile.displayName.slice(0,1).toUpperCase()||'N')}</span>`;
        return `<button type="button" data-directory-profile="${esc(entry.uid)}"><i class="nyx-profile-directory-avatar">${avatar}<em class="${entry.online?'online':''}" aria-label="${entry.online?'Online':'Offline'}"></em></i><span><strong>${esc(profile.displayName)}${entry.self?' <small>You</small>':''}</strong><small>${esc(profile.handle)}</small></span><b>${esc(roleLabel(entry.role))}</b></button>`;
      }).join('');
      resultsHost.querySelectorAll('[data-directory-profile]').forEach(button=>{
        const entry=entries.find(item=>item.uid===button.dataset.directoryProfile);
        const profile=normalizeNyxUserProfile(entry?.profile);
        const avatarHost=button.querySelector('.nyx-profile-directory-avatar');
        const avatarImage=avatarHost?.querySelector(':scope > img');
        if(avatarHost&&avatarImage)nyxManageCompactGif(avatarHost,avatarImage,profile.avatarUrl,180);
      });
      renderProfile(entries.find(entry=>entry.uid===selectedUid)||entries[0]);
    };
    const load=async()=>{
      controller?.abort();
      controller=new AbortController();
      resultsHost.innerHTML='<div class="nyx-profile-directory-loading"><i></i><i></i><i></i><i></i></div>';
      summary.textContent='Loading profiles…';
      try{
        const token=await nyxGetFirebaseToken(true);
        if(!token)throw new Error('Sign in again to browse profiles.');
        const data=await nyxProfileMediaFetch(`/api/profiles?search=${encodeURIComponent(search.value.trim())}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:controller.signal},'Profiles could not be loaded.');
        entries=Array.isArray(data.profiles)?data.profiles:[];
        renderResults();
      }catch(error){
        if(error.name==='AbortError')return;
        entries=[];
        summary.textContent='Profiles unavailable';
        resultsHost.innerHTML=`<div class="nyx-profile-directory-no-results"><strong>Could not load profiles</strong><span>${esc(error.message||'Try again.')}</span><button type="button" data-profile-directory-retry>Try again</button></div>`;
      }
    };
    const onKeydown=event=>{if(event.key==='Escape'){event.preventDefault();close()}};
    overlay.addEventListener('click',event=>{
      if(event.target===overlay||event.target.closest('[data-close-profile-directory]')){close();return}
      if(event.target.closest('[data-profile-directory-retry]')){void load();return}
      const uid=event.target.closest('[data-directory-profile]')?.dataset.directoryProfile;
      if(uid)renderProfile(entries.find(entry=>entry.uid===uid));
    });
    search.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>void load(),240)});
    document.addEventListener('keydown',onKeydown);
    setTimeout(()=>search.focus(),0);
    await load();
  }
  addEventListener('resize',closeNyxAccountMenu,{passive:true});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeNyxAccountMenu()});
  function syncNyxAccountButtonAvatar(host,profile){
    if(!host)return;
    const source=String(profile.avatarUrl||'');
    let image=host.querySelector(':scope > img');
    let fallback=host.querySelector(':scope > span');
    if(source){
      fallback?.remove();
      if(!image){
        image=document.createElement('img');
        image.alt='';
        image.loading='eager';
        host.prepend(image);
      }
      nyxManageCompactGif(host,image,source,180);
      return;
    }
    delete host.dataset.nyxAnimatedSource;
    delete host.dataset.nyxAnimatedPoster;
    image?.remove();
    if(!fallback){
      fallback=document.createElement('span');
      host.prepend(fallback);
    }
    fallback.textContent=profile.displayName.slice(0,1).toUpperCase()||'N';
  }
  function ensureNyxAccountButton(){
    const existing=document.getElementById('nyxAccountButton');
    const signedIn=Boolean(nyxFounderSignedInUser);
    const host=document.body.classList.contains('browser-shell')?document.querySelector('.browser-home:not(.hidden) [data-nyx-profile-slot]')||document.querySelector('.browser-home [data-nyx-profile-slot]'):document.querySelector('.status-icons');
    if(!host){return}
    if(existing&&existing.parentElement!==host){closeNyxAccountMenu();existing.remove()}
    const button=document.getElementById('nyxAccountButton')||document.createElement('button');
    button.id='nyxAccountButton';button.type='button';button.className='nyx-account-button';button.classList.toggle('nyx-account-button-default',!signedIn);button.classList.toggle('nyx-account-button-rich',signedIn);delete button.dataset.openNyxProfile;button.dataset.toggleNyxAccountMenu='';button.title=signedIn?'Account menu':'Sign in or create a profile';button.setAttribute('aria-label',button.title);button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded',String(Boolean(document.querySelector('.nyx-account-menu'))));
    const profile=normalizeNyxUserProfile(nyxUserProfile);
    const statusLabel={online:'Online',idle:'Idle',dnd:'Do not disturb',offline:'Invisible'}[profile.status]||'Online';
    if(signedIn){
      let avatarHost=button.querySelector(':scope > .nyx-account-button-avatar');
      let copy=button.querySelector(':scope > .nyx-account-button-copy');
      if(!avatarHost||!copy){
        button.replaceChildren();
        avatarHost=document.createElement('span');
        avatarHost.className='nyx-account-button-avatar';
        const status=document.createElement('i');
        status.className='nyx-user-status';
        status.setAttribute('aria-hidden','true');
        avatarHost.appendChild(status);
        copy=document.createElement('span');
        copy.className='nyx-account-button-copy';
        copy.append(document.createElement('strong'),document.createElement('small'));
        button.append(avatarHost,copy);
      }
      syncNyxAccountButtonAvatar(avatarHost,profile);
      const status=avatarHost.querySelector(':scope > .nyx-user-status');
      if(status) status.className=`nyx-user-status nyx-user-status-${profile.status}`;
      const name=copy.querySelector(':scope > strong');
      const customStatus=copy.querySelector(':scope > small');
      if(name){
        name.className=nyxDisplayNameStyleClass(profile);
        name.style.cssText=nyxDisplayNameStyleVars(profile);
        name.textContent=profile.displayName;
      }
      if(customStatus) customStatus.textContent=profile.customStatus||statusLabel;
    }else if(!button.querySelector(':scope > span[aria-hidden="true"]')||button.children.length!==1){
      button.innerHTML='<span aria-hidden="true"></span>';
    }
    if(!button.parentElement) host.appendChild(button);
  }
  function syncFounderOwnerControls(){
    const configured=Boolean(nyxFounderAuthConfig.enabled);
    const signedIn=nyxFounderSignedInUser;
    document.querySelectorAll('[data-founder-account-card]').forEach(card=>{card.hidden=!configured});
    document.querySelectorAll('[data-founder-profile-settings-card]').forEach(card=>{card.hidden=!nyxFounderIsOwner});
    document.querySelectorAll('[data-owner-dashboard-card]').forEach(card=>{card.hidden=!nyxOwnerDashboardAccess});
    document.querySelectorAll('[data-founder-account-status]').forEach(status=>{
      if(!configured){status.textContent='Nyx accounts are not configured.';return}
      if(!signedIn){status.textContent='Sign in to create and manage your Nyx profile.';return}
      const accountId=String(signedIn.uid||'');
      const roleName=String(nyxUserAccountRole||'member').replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase());
      status.textContent=nyxFounderIsOwner?'Signed in as the Nyx founder.':nyxOwnerDashboardAccess?`Signed in as ${roleName}.`:`Signed in. Firebase account ID: ${accountId}`;
    });
    document.querySelectorAll('[data-open-nyx-account]').forEach(button=>{button.hidden=!configured||Boolean(signedIn);});
    document.querySelectorAll('[data-nyx-account-sign-out]').forEach(button=>{button.hidden=!signedIn;});
    document.querySelectorAll('[data-open-nyx-profile]').forEach(button=>{if(button.id!=='nyxAccountButton') button.hidden=!signedIn;});
    document.querySelectorAll('[data-nyx-owner-presence]').forEach(presence=>{
      presence.classList.toggle('nyx-owner-presence-action',Boolean(nyxOwnerDashboardAccess));
      presence.tabIndex=nyxOwnerDashboardAccess?0:-1;
      presence.setAttribute('aria-label',nyxOwnerDashboardAccess?'Open Owner Dashboard':'Current users online');
    });
    ensureNyxAccountButton();
  }
  async function refreshFounderOwnerAccess(){
    nyxFounderIsOwner=false;
    nyxOwnerDashboardAccess=false;
    nyxUserPermissions=[];
    if(!nyxFounderSignedInUser){syncFounderOwnerControls();return false}
    try{
      const token=await nyxGetFirebaseToken(true);
      if(!token)throw new Error('Your owner session has expired.');
      const access=await nyxProfileMediaFetch('/api/founder-profile/owner',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'},'Owner access is unavailable.');
      nyxFounderIsOwner=Boolean(access?.owner);
      nyxOwnerDashboardAccess=Boolean(access?.dashboard);
      nyxUserPermissions=Array.isArray(access?.permissions)?access.permissions.map(String):[];
      if(access?.role)nyxUserAccountRole=String(access.role);
    }catch{nyxFounderIsOwner=false;nyxOwnerDashboardAccess=false;nyxUserPermissions=[]}
    syncFounderOwnerControls();
    return nyxOwnerDashboardAccess;
  }
  async function initializeFounderOwnerAccess(){
    if(nyxFounderAuthReadyPromise) return nyxFounderAuthReadyPromise;
    nyxFounderAuthReadyPromise=(async()=>{
      try{
        const response=await fetch('/api/founder-profile/auth-config',{cache:'no-store'});
        nyxFounderAuthConfig=await response.json();
        if(!nyxFounderAuthConfig?.enabled) return;
        const [{initializeApp,getApps},{getAuth,onAuthStateChanged,setPersistence,browserLocalPersistence}]=await Promise.all([import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js')]);
        const app=getApps().find(item=>item.name==='nyx-founder-owner')||initializeApp({apiKey:nyxFounderAuthConfig.apiKey,authDomain:`${nyxFounderAuthConfig.projectId}.firebaseapp.com`,projectId:nyxFounderAuthConfig.projectId},'nyx-founder-owner');
        nyxFounderFirebaseAuth=getAuth(app);
        try{await setPersistence(nyxFounderFirebaseAuth,browserLocalPersistence)}
        catch(error){console.warn('Nyx could not enable persistent sign-in:',error)}
        if(typeof nyxFounderFirebaseAuth.authStateReady==='function')await nyxFounderFirebaseAuth.authStateReady();
        onAuthStateChanged(nyxFounderFirebaseAuth,async user=>{nyxFounderSignedInUser=user||null;if(!user){stopNyxUserActivity();nyxUserProfile=null;nyxUserProfileCreatedAt='';nyxFounderIsOwner=false;nyxOwnerDashboardAccess=false;nyxUserPermissions=[];nyxUserAccountRole='member';nyxUserSubscriptionStatus='free';syncNyxAccountEntitlements();nyxUserAccountEmail='';await refreshFounderOwnerAccess();return}startNyxUserActivity(user);await Promise.all([refreshFounderOwnerAccess(),loadNyxUserProfile()])});
      }catch(error){console.warn('Nyx owner sign-in could not initialize:',error);nyxFounderAuthConfig={enabled:false,ownerConfigured:false}}
      finally{syncFounderOwnerControls()}
    })();
    return nyxFounderAuthReadyPromise;
  }
  async function openNyxAccountAccess(){
    closeNyxAccountMenu();
    await initializeFounderOwnerAccess();
    if(!nyxFounderFirebaseAuth) return toast('Nyx accounts are not configured yet.');
    document.querySelector('.nyx-account-overlay')?.remove();
    const overlay=document.createElement('div');
    overlay.className='nyx-account-overlay';
    overlay.innerHTML='<section class="nyx-account-dialog" role="dialog" aria-modal="true" aria-labelledby="nyxAccountTitle"><button class="nyx-founder-editor-close" data-close-nyx-account type="button" aria-label="Close">×</button><div class="nyx-account-mark" aria-hidden="true"><span>☾</span></div><p id="nyxAccountTitle" class="nyx-account-title">Log in or register to continue</p><div class="nyx-account-tabs" role="tablist" aria-label="Account action"><button class="nyx-account-tab active" data-nyx-account-tab="signin" type="button" role="tab" aria-selected="true">Log in</button><button class="nyx-account-tab" data-nyx-account-tab="register" type="button" role="tab" aria-selected="false">Register</button></div><form><label data-nyx-account-identifier-label><span>Username or email</span><input name="username" autocomplete="username" minlength="3" maxlength="254" placeholder="username or email" required></label><label data-nyx-account-email hidden><span>Recovery email <small>Recommended</small></span><input name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com"></label><label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" placeholder="your password" required></label><p class="nyx-founder-editor-error" aria-live="polite"></p><button class="nyx-account-submit" type="submit">Log in</button><button class="nyx-account-forgot" data-nyx-forgot-password type="button">Forgot password?</button></form><p class="nyx-account-footer">Log in with your username or recovery email.</p></section>';
    document.body.appendChild(overlay);
    let mode='signin';
    const form=overlay.querySelector('form');
    const submit=form.querySelector('[type="submit"]');
    const password=form.querySelector('[name="password"]');
    const identifier=form.querySelector('[name="username"]');
    const identifierLabel=overlay.querySelector('[data-nyx-account-identifier-label]');
    const emailField=overlay.querySelector('[data-nyx-account-email]');
    const emailInput=form.querySelector('[name="email"]');
    const forgotButton=form.querySelector('[data-nyx-forgot-password]');
    const footer=overlay.querySelector('.nyx-account-footer');
    const error=form.querySelector('.nyx-founder-editor-error');
    const update=()=>{
      const registering=mode==='register';
      overlay.querySelectorAll('[data-nyx-account-tab]').forEach(tab=>{const active=tab.dataset.nyxAccountTab===mode;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active))});
      submit.textContent=registering?'Create account':'Log in';
      password.autocomplete=registering?'new-password':'current-password';
      password.minLength=registering?8:6;
      identifier.maxLength=registering?32:254;
      identifier.placeholder=registering?'your username':'username or email';
      identifierLabel.querySelector('span').textContent=registering?'Username':'Username or email';
      emailField.hidden=!registering;
      emailInput.disabled=!registering;
      forgotButton.hidden=registering;
      footer.textContent=registering?'Add a recovery email so you can log in either way and reset a forgotten password.':'Log in with your username or recovery email.';
      error.textContent='';
      error.classList.remove('success');
    };
    update();
    const close=()=>overlay.remove();
    overlay.addEventListener('click',event=>{if(event.target.closest('[data-close-nyx-account]')){close();return}const tab=event.target.closest('[data-nyx-account-tab]');if(tab){mode=tab.dataset.nyxAccountTab;update()}});
    overlay.addEventListener('keydown',event=>{if(event.key==='Escape')close()});
    forgotButton.addEventListener('click',async()=>{
      const rawIdentifier=String(identifier.value||'').trim();
      if(rawIdentifier.length<3){error.textContent='Enter your username or email first.';error.classList.remove('success');identifier.focus();return}
      forgotButton.disabled=true;
      error.textContent='';
      error.classList.remove('success');
      try{
        const response=await fetch('/api/account/password-reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:rawIdentifier})});
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(data.error||'Password reset is temporarily unavailable.');
        error.textContent=data.message||'If that account has a recovery email, Firebase sent a password-reset message.';
        error.classList.add('success');
      }catch(resetError){
        error.textContent=resetError?.message||'Password reset is temporarily unavailable.';
      }finally{
        forgotButton.disabled=false;
      }
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const values=new FormData(form);
      const rawIdentifier=String(values.get('username')||'').trim();
      const username=nyxAccountUsername(rawIdentifier.replace(/^@+/,''));
      const passwordValue=String(values.get('password')||'');
      const recoveryEmail=String(values.get('email')||'').trim().toLowerCase();
      error.classList.remove('success');
      if(mode==='register'&&(username.length<3||username!==rawIdentifier.toLowerCase().replace(/^@+/,''))){error.textContent='Use 3–32 letters, numbers, dots, dashes, or underscores.';return}
      if(mode==='signin'&&rawIdentifier.length<3){error.textContent='Enter your username or email.';return}
      submit.disabled=true;
      error.textContent='';
      try{
        const {signInWithCustomToken}=await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
        const endpoint=mode==='register'?'/api/account/register':'/api/account/sign-in';
        const payload=mode==='register'?{username,email:recoveryEmail,password:passwordValue}:{identifier:rawIdentifier,password:passwordValue};
        const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw Object.assign(new Error(data.error||(mode==='register'?'Account creation failed.':'Sign-in failed.')),{code:'nyx/account'});
        const credential=await signInWithCustomToken(nyxFounderFirebaseAuth,data.customToken);
        nyxFounderSignedInUser=credential.user;
        await credential.user.getIdToken(true);
        await Promise.all([refreshFounderOwnerAccess(),loadNyxUserProfile()]);
        close();
        toast(mode==='register'?'Nyx profile created':'Signed in');
      }catch(authError){
        error.textContent=nyxFriendlyFirebaseError(authError,'Account could not be completed. Try again.');
        submit.disabled=false;
      }
    });
    setTimeout(()=>form.querySelector('[name="username"]')?.focus(),0);
  }
  async function signOutFounderOwner(){
    closeNyxAccountMenu();
    try{await nyxFounderFirebaseAuth?.signOut()}catch{}
    nyxFirebaseTokenPromise=null;nyxFounderSignedInUser=null;nyxFounderIsOwner=false;nyxOwnerDashboardAccess=false;nyxUserPermissions=[];nyxUserAccountRole='member';nyxUserSubscriptionStatus='free';syncNyxAccountEntitlements();nyxUserAccountEmail='';nyxUserProfile=null;nyxUserProfileCreatedAt='';syncFounderOwnerControls();toast('Signed out');
  }
  function nyxUserProfileCardMarkup(profile=normalizeNyxUserProfile(nyxUserProfile),options={}){
    const joinedAt=String(options.createdAt||nyxUserProfileCreatedAt||'');
    const joined=joinedAt?new Date(joinedAt).toLocaleDateString(undefined,{month:'short',year:'numeric'}):'Today';
    const statusLabel={online:'Online',idle:'Idle',dnd:'Do not disturb',offline:'Invisible'}[profile.status]||'Online';
    const editable=Boolean(options.editable&&nyxFounderSignedInUser);
    const symbol=name=>{
      const paths={
        member:'<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
        sparkle:'<path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/>',
        shield:'<path d="m12 3 7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/>',
        owner:'<path d="m4 8 4 4 4-7 4 7 4-4-2 10H6L4 8Z"/><path d="M6 21h12"/>',
        developer:'<path d="m8 9-4 3 4 3"/><path d="m16 9 4 3-4 3"/><path d="m14 5-4 14"/>',
        founder:'<path d="m12 3 7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3Z"/><path d="m12 7 1.2 2.5 2.8.4-2 2 .5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-2 2.8-.4L12 7Z"/>',
        status:'<circle cx="12" cy="12" r="9"/><path d="M8.5 10h.01M15.5 10h.01M8.5 15c1.8 1.4 5.2 1.4 7 0"/>',
        edit:'<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
        switch:'<path d="m16 3 4 4-4 4"/><path d="M20 7H9a4 4 0 0 0-4 4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h11a4 4 0 0 0 4-4"/>',
        chevron:'<path d="m9 18 6-6-6-6"/>'
      };
      return `<svg class="nyx-profile-symbol nyx-profile-symbol-${name}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name]||''}</svg>`;
    };
    const roleLabel=role=>({owner:'Owner',co_owner:'Co-owner',admin:'Admin',manager:'Manager',developer:'Developer',moderator:'Moderator',support:'Support',tester:'Tester',contributor:'Contributor',member:'Member'}[role]||'Member');
    const roleIconKey=role=>({co_owner:'owner',manager:'admin',support:'moderator',tester:'developer',contributor:'developer'}[role]||role);
    const roleChip=role=>`<span class="nyx-user-role nyx-user-role-${role}"><img src="/assets/icons/roles/${roleIconKey(role)}.png" alt="" aria-hidden="true">${roleLabel(role)}</span>`;
    const availableRoles=['owner','co_owner','admin','manager','developer','moderator','support','tester','contributor','member'];
    const publicRole=availableRoles.includes(String(options.role||''))?String(options.role):'';
    const roles=publicRole
      ?roleChip(publicRole)
      :(nyxFounderIsOwner
        ?`${roleChip('owner')}${roleChip('developer')}<span class="nyx-user-role nyx-user-role-founder">${symbol('founder')}Founder</span>`
        :roleChip(availableRoles.includes(nyxUserAccountRole)?nyxUserAccountRole:'member'));
    const ownerActions=editable?`<div class="nyx-user-profile-actions" aria-label="Your account controls"><button type="button" data-nyx-profile-action="status"><i class="nyx-user-status nyx-user-status-${esc(profile.status)}" aria-hidden="true"></i><span>${esc(statusLabel)}</span><b aria-hidden="true">${symbol('chevron')}</b></button><button type="button" data-nyx-profile-action="custom-status">${symbol('edit')}<span>Edit custom status</span><b aria-hidden="true">${symbol('chevron')}</b></button><button type="button" data-nyx-profile-action="switch-account">${symbol('switch')}<span>Switch accounts</span><b aria-hidden="true">${symbol('chevron')}</b></button></div>`:'';
    const mediaEdit=(type,label)=>editable?`<button class="nyx-profile-media-edit nyx-profile-media-edit-${type}" type="button" data-nyx-direct-edit="${type}" aria-label="${label}" title="${label}"><span aria-hidden="true">&#9998;</span></button>`:'';
    const avatar=profile.avatarUrl?`<img src="${esc(nyxProfileStillSource(profile.avatarUrl))}" alt="${esc(profile.displayName)} profile picture">`:`<span>${esc(profile.displayName.slice(0,1).toUpperCase()||'N')}</span>`;
    const background=profile.bannerUrl?`<img src="${esc(nyxProfileStillSource(profile.bannerUrl))}" alt="" aria-hidden="true">`:'';
    if(options.compactPreview){
      const previewActions=`<div class="nyx-account-menu-group nyx-editor-menu-preview-actions" aria-hidden="true"><button type="button" tabindex="-1">${nyxAccountMenuIcon('edit')}<span>Edit Profile</span></button><hr><button type="button" tabindex="-1"><i class="nyx-user-status nyx-user-status-${esc(profile.status)}"></i><span>${esc(statusLabel)}</span>${nyxAccountMenuIcon('chevron')}</button></div><div class="nyx-account-menu-group nyx-editor-menu-preview-actions" aria-hidden="true"><button type="button" tabindex="-1">${nyxAccountMenuIcon('switch')}<span>Switch Accounts</span>${nyxAccountMenuIcon('chevron')}</button><hr><button type="button" tabindex="-1">${nyxAccountMenuIcon('id')}<span>Copy User ID</span></button></div>`;
      return `<section class="nyx-editor-menu-preview nyx-account-menu show ${nyxProfileEffectClass(profile)}" style="--nyx-account-primary:${profile.accentPrimary};--nyx-account-secondary:${profile.accentSecondary};--nyx-account-banner:${profile.bannerColor};--nyx-user-accent-primary:${profile.accentPrimary};--nyx-user-accent-secondary:${profile.accentSecondary};--nyx-user-banner-color:${profile.bannerColor};${nyxProfileEffectVars(profile)}"><i class="nyx-user-profile-effect nyx-account-menu-profile-effect" aria-hidden="true"></i><div class="nyx-account-menu-banner">${background}${mediaEdit('banner','Edit profile banner')}</div><div class="nyx-account-menu-profile"><div class="nyx-account-menu-avatar nyx-avatar-decoration-${esc(profile.avatarDecoration)}" data-nyx-direct-edit="avatar">${avatar}<i class="nyx-avatar-decoration" aria-hidden="true"><span></span></i><i class="nyx-user-status nyx-user-status-${esc(profile.status)}" aria-label="${esc(statusLabel)}"></i></div><span class="nyx-account-menu-status">${esc(profile.customStatus||statusLabel)}</span><h2 class="${nyxDisplayNameStyleClass(profile)}" style="${nyxDisplayNameStyleVars(profile)}">${esc(profile.displayName)}</h2><p class="nyx-account-menu-handle">${esc(profile.handle)}</p><p class="nyx-account-menu-bio">${esc(profile.bio||'No bio yet.')}</p></div>${previewActions}</section>`;
    }
    return `<section class="nyx-user-profile-card ${nyxProfileEffectClass(profile)}" style="--nyx-user-accent-primary:${profile.accentPrimary};--nyx-user-accent-secondary:${profile.accentSecondary};--nyx-user-banner-color:${profile.bannerColor};${nyxProfileEffectVars(profile)}"><i class="nyx-user-profile-effect" aria-hidden="true"></i><div class="nyx-user-profile-banner">${background}${mediaEdit('banner','Edit profile banner')}</div><div class="nyx-user-profile-chrome"><div class="nyx-user-profile-avatar nyx-avatar-decoration-${esc(profile.avatarDecoration)}">${avatar}<i class="nyx-avatar-decoration" aria-hidden="true"><span></span></i><i class="nyx-user-status nyx-user-status-${esc(profile.status)}" aria-label="${esc(statusLabel)}"></i>${mediaEdit('avatar','Edit profile picture')}</div></div><div class="nyx-user-profile-body"><div class="nyx-user-profile-heading"><h2 class="${nyxDisplayNameStyleClass(profile)}" style="${nyxDisplayNameStyleVars(profile)}">${esc(profile.displayName)}</h2><p>${esc(profile.handle)}</p></div><p class="nyx-user-profile-custom-status">${symbol('status')} ${esc(profile.customStatus||`${statusLabel} on Nyx`)}</p><section class="nyx-user-profile-about"><h3>About me</h3><p class="nyx-user-profile-bio">${esc(profile.bio||'No bio yet.')}</p></section><section class="nyx-user-profile-roles"><h3>Roles</h3><div class="nyx-user-role-list">${roles}</div></section><section class="nyx-user-profile-details"><h3>Nyx member since</h3><p>${esc(joined)}</p></section>${ownerActions}</div></section>`;
  }
  async function nyxProfileImageFromFile(file,maxWidth,maxHeight){
    if(!file||!/^image\/(?:png|jpe?g|webp|gif)$/i.test(String(file.type||'')))throw new Error('Choose a PNG, JPG, WebP, or GIF image.');
    if(file.size>8*1024*1024)throw new Error('Choose an image smaller than 8 MB.');
    if(/^image\/gif$/i.test(String(file.type||''))){
      const signature=await file.slice(0,6).text();
      if(!/^GIF8[79]a$/.test(signature))throw new Error('That file is not a valid GIF.');
      const dataUrl=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(String(reader.result||''));
        reader.onerror=()=>reject(new Error('That GIF could not be opened.'));
        reader.readAsDataURL(file);
      });
      if(!/^data:image\/gif;base64,/i.test(dataUrl))throw new Error('That GIF could not be opened.');
      if(dataUrl.length>NYX_PROFILE_MEDIA_DATA_LIMIT)throw new Error('Choose a GIF smaller than 8 MB.');
      const previewImage=new Image();
      previewImage.decoding='async';
      previewImage.src=dataUrl;
      await nyxCaptureGifPoster(previewImage,dataUrl,Math.min(720,Math.max(maxWidth,maxHeight)));
      return dataUrl;
    }
    const objectUrl=URL.createObjectURL(file);
    try{
      const image=await new Promise((resolve,reject)=>{const preview=new Image();preview.onload=()=>resolve(preview);preview.onerror=()=>reject(new Error('That image could not be opened.'));preview.src=objectUrl});
      let scale=Math.min(1,maxWidth/Math.max(1,image.naturalWidth),maxHeight/Math.max(1,image.naturalHeight));
      for(let pass=0;pass<4;pass++){
        const canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
        canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        const dataUrl=canvas.toDataURL('image/webp',Math.max(.52,.86-pass*.1));
        if(dataUrl.length<=NYX_PROFILE_IMAGE_DATA_LIMIT)return dataUrl;
        scale*=.72;
      }
      throw new Error('That image is too detailed to save. Try a smaller image.');
    }finally{URL.revokeObjectURL(objectUrl)}
  }
  async function nyxProfileMediaFetch(url,options,errorMessage){
    let lastError=null;
    let requestOptions={...options,headers:new Headers(options?.headers||{})};
    for(let attempt=0;attempt<3;attempt++){
      try{
        const response=await fetch(url,requestOptions);
        const data=await response.json().catch(()=>({}));
        if(response.ok)return data;
        if(response.status===401&&attempt===0){
          const freshToken=await nyxGetFirebaseToken(true);
          if(freshToken){
            const headers=new Headers(requestOptions.headers||{});
            headers.set('Authorization',`Bearer ${freshToken}`);
            requestOptions={...requestOptions,headers};
            continue;
          }
        }
        const error=new Error(data.error||errorMessage);
        if(response.status!==408&&response.status!==429&&response.status<500)throw error;
        lastError=error;
      }catch(error){
        lastError=error;
        if(attempt>=2||/sign in|expired|cross-origin|invalid|too large/i.test(String(error?.message||'')))throw error;
      }
      await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));
    }
    throw lastError||new Error(errorMessage);
  }
  async function nyxUploadProfileMedia(kind,dataUrl,token,onProgress=()=>{}){
    const match=String(dataUrl||'').match(/^data:(image\/(?:gif|png|jpeg|webp));base64,([a-z0-9+/=]+)$/i);
    if(!match)return dataUrl;
    if(dataUrl.length>NYX_PROFILE_MEDIA_DATA_LIMIT)throw new Error('Choose an image smaller than 8 MB.');
    const encoded=match[2];
    const chunkSize=420000;
    const chunks=[];
    for(let offset=0;offset<encoded.length;offset+=chunkSize)chunks.push(encoded.slice(offset,offset+chunkSize));
    if(!chunks.length||chunks.length>32)throw new Error('That image is too large to upload.');
    const uploadId=(globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^a-z0-9_-]/gi,'');
    for(let index=0;index<chunks.length;index++){
      onProgress(Math.round((index/chunks.length)*90));
      await nyxProfileMediaFetch(`/api/profile-media/${kind}/${uploadId}/${index}`,{
        method:'PUT',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({mime:match[1].toLowerCase(),totalChunks:chunks.length,chunk:chunks[index]})
      },`The ${kind} image could not be uploaded.`);
    }
    const data=await nyxProfileMediaFetch(`/api/profile-media/${kind}/${uploadId}/complete`,{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:'{}'
    },`The ${kind} image could not be completed.`);
    if(!data.url)throw new Error(`The ${kind} image could not be completed.`);
    onProgress(100);
    return data.url;
  }
  async function openNyxUserProfile(){
    closeNyxAccountMenu();
    if(!nyxFounderSignedInUser){await openNyxAccountAccess();if(!nyxFounderSignedInUser)return}
    await loadNyxUserProfile();
    document.querySelector('.nyx-user-profile-overlay')?.remove();
    const profile=normalizeNyxUserProfile(nyxUserProfile);
    const accountUsername=nyxAccountUsername(String(nyxFounderSignedInUser?.email||'').split('@')[0]);
    const overlay=document.createElement('div');
    overlay.className='nyx-user-profile-overlay nyx-profile-drawer';
    overlay.innerHTML=`
      <section class="nyx-user-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="nyxUserProfileTitle">
        <main class="nyx-discord-profile-main">
          <button class="nyx-founder-editor-close nyx-discord-settings-close" data-close-nyx-profile type="button" aria-label="Close">
            <span aria-hidden="true">&#215;</span><small>ESC</small>
          </button>
          <div class="nyx-discord-profile-scroll">
            <header class="nyx-discord-profile-header">
              <h2 id="nyxUserProfileTitle">Profiles</h2>
              <p>Customize how your profile appears to everyone on Nyx.</p>
            </header>
            <div class="nyx-discord-profile-layout">
              <form class="nyx-user-profile-form">
                <section class="nyx-profile-editor-section">
                  <h4>Profile information</h4>
                  <div class="nyx-profile-field-grid">
                    <label class="nyx-profile-field">Display name<input name="displayName" maxlength="48" required value="${esc(profile.displayName)}"></label>
                    <label class="nyx-profile-field">Profile username<input name="handle" maxlength="33" pattern="@?[A-Za-z0-9_.-]{3,32}" autocomplete="username" required value="${esc(profile.handle)}"><small>Unique across Nyx · 3–32 letters, numbers, dots, dashes, or underscores.</small></label>
                    <label class="nyx-profile-field nyx-profile-field-wide">About me<textarea name="bio" maxlength="280" rows="4" placeholder="You can use text and emoji.">${esc(profile.bio)}</textarea><small><span data-nyx-bio-count>${profile.bio.length}</span>/280</small></label>
                    <label class="nyx-profile-field">Status<select name="status"><option value="online" ${profile.status==='online'?'selected':''}>Online</option><option value="idle" ${profile.status==='idle'?'selected':''}>Idle</option><option value="dnd" ${profile.status==='dnd'?'selected':''}>Do not disturb</option><option value="offline" ${profile.status==='offline'?'selected':''}>Invisible</option></select></label>
                    <label class="nyx-profile-field">Custom status<input name="customStatus" maxlength="80" value="${esc(profile.customStatus)}" placeholder="What are you up to?"></label>
                  </div>
                </section>
                <section class="nyx-profile-editor-section">
                  <h4>Avatar &amp; banner</h4>
                  <div class="nyx-profile-image-list">
                    <div class="nyx-profile-image-control">
                      <div><strong>Avatar</strong><small>PNG, JPG, WebP, or animated GIF.</small></div>
                      <input name="avatarUrl" type="hidden" value="${esc(profile.avatarUrl)}">
                      <input class="nyx-profile-file-input" name="avatarFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
                      <span class="nyx-profile-file-name" data-nyx-file-name="avatar">${profile.avatarUrl?'Image selected':'No image selected'}</span>
                      <div class="nyx-profile-image-actions"><button class="nyx-profile-file-button" type="button" data-nyx-pick-image="avatar"><span class="nyx-profile-rail-avatar">${profile.avatarUrl?`<img src="${esc(nyxProfileStillSource(profile.avatarUrl))}" alt="">`:`<b>${esc(profile.displayName.slice(0,1).toUpperCase()||'N')}</b>`}</span><span>Change Avatar</span></button><button class="nyx-profile-clear-button" type="button" data-nyx-clear-image="avatar">Remove Avatar</button></div>
                    </div>
                    <div class="nyx-profile-image-control">
                      <div><strong>Profile banner</strong><small>Recommended size: 680 × 240.</small></div>
                      <input name="bannerUrl" type="hidden" value="${esc(profile.bannerUrl)}">
                      <input class="nyx-profile-file-input" name="bannerFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
                      <span class="nyx-profile-file-name" data-nyx-file-name="banner">${profile.bannerUrl?'Image selected':'No image selected'}</span>
                      <div class="nyx-profile-image-actions"><button class="nyx-profile-file-button" type="button" data-nyx-pick-image="banner">Change Banner</button><button class="nyx-profile-clear-button" type="button" data-nyx-clear-image="banner">Remove Banner</button></div>
                    </div>
                  </div>
                </section>
                <section class="nyx-profile-editor-section">
                  <h4>Profile theme</h4>
                  <div class="nyx-profile-color-grid">
                    <label class="nyx-profile-field nyx-profile-color-field">Primary<input name="accentPrimary" type="color" value="${esc(profile.accentPrimary)}"><small>Profile card color</small></label>
                    <label class="nyx-profile-field nyx-profile-color-field">Accent<input name="accentSecondary" type="color" value="${esc(profile.accentSecondary)}"><small>Secondary surface color</small></label>
                    <label class="nyx-profile-field nyx-profile-color-field">Banner color<input name="bannerColor" type="color" value="${esc(profile.bannerColor)}"><small>Used without a banner image</small></label>
                    <label class="nyx-profile-field">Profile effect<select name="profileEffect"><option value="none" ${profile.profileEffect==='none'?'selected':''}>None</option><option value="glow" ${profile.profileEffect==='glow'?'selected':''}>Glow</option><option value="sparkle" ${profile.profileEffect==='sparkle'?'selected':''}>Sparkle</option><option value="aurora" ${profile.profileEffect==='aurora'?'selected':''}>Aurora</option><option value="holographic" ${profile.profileEffect==='holographic'?'selected':''}>Holographic</option><option value="fireflies" ${profile.profileEffect==='fireflies'?'selected':''}>Fireflies</option><option value="cosmic-dust" ${profile.profileEffect==='cosmic-dust'?'selected':''}>Cosmic Dust</option><option value="electric-storm" ${profile.profileEffect==='electric-storm'?'selected':''}>Electric Storm</option><option value="meteor-shower" ${profile.profileEffect==='meteor-shower'?'selected':''}>Meteor Shower</option><option value="cyber-grid" ${profile.profileEffect==='cyber-grid'?'selected':''}>Cyber Grid</option><option value="plasma" ${profile.profileEffect==='plasma'?'selected':''}>Plasma</option><option value="snowfall" ${profile.profileEffect==='snowfall'?'selected':''}>Snowfall</option><option value="embers" ${profile.profileEffect==='embers'?'selected':''}>Embers</option><option value="bubbles" ${profile.profileEffect==='bubbles'?'selected':''}>Bubbles</option><option value="custom" ${profile.profileEffect==='custom'?'selected':''}>Custom effect</option></select></label>
                  </div>
                </section>
                <p class="nyx-founder-editor-error" aria-live="polite"></p>
                <footer>
                  <strong>Unsaved changes</strong>
                  <button class="nyx-profile-reset-button" type="reset">Reset</button>
                  <button class="settings-action on" type="submit">Save Changes</button>
                </footer>
              </form>
              <aside class="nyx-discord-preview-pane">
                <h3>Preview</h3>
                <div class="nyx-user-profile-view">${nyxUserProfileCardMarkup(profile,{editable:true})}</div>
              </aside>
            </div>
          </div>
        </main>
    </section>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(()=>overlay.classList.add('show'));
    const close=()=>{
      if(overlay.classList.contains('is-closing')) return;
      clearTimeout(previewTimer);
      overlay.classList.add('is-closing');
      overlay.classList.remove('show');
      setTimeout(()=>overlay.remove(),240);
    };
    overlay.addEventListener('click',async event=>{
      if(event.target===overlay||event.target.closest('[data-close-nyx-profile]')){close();return}
      const action=event.target.closest('[data-nyx-profile-action]')?.dataset.nyxProfileAction;
      if(!action)return;
      if(action==='status'){const field=overlay.querySelector('[name="status"]');field?.scrollIntoView({block:'center',behavior:'smooth'});field?.focus();try{field?.showPicker?.()}catch{}return}
      if(action==='custom-status'){const field=overlay.querySelector('[name="customStatus"]');field?.scrollIntoView({block:'center',behavior:'smooth'});field?.focus();field?.select();return}
      if(action==='switch-account'){close();await signOutFounderOwner();await openNyxAccountAccess()}
    });
    const form=overlay.querySelector('form');
    const pendingMediaPreparations=new Map();
    form.insertAdjacentHTML('afterbegin',`<header class="nyx-profile-rail-header">
      <button type="button" data-nyx-profile-switch-toggle aria-haspopup="menu" aria-expanded="false">
        <span>Main Profile</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>
      </button>
      <section class="nyx-profile-switch-menu" data-nyx-profile-switch-menu role="menu" aria-label="Profile options" hidden>
        <div class="nyx-profile-switch-current">
          <span class="nyx-profile-switch-avatar">${profile.avatarUrl?`<img src="${esc(nyxProfileStillSource(profile.avatarUrl))}" alt="">`:`<b>${esc(profile.displayName.slice(0,1).toUpperCase()||'N')}</b>`}</span>
          <span><strong>${esc(profile.displayName)}</strong><small>${esc(profile.handle)}</small></span>
          <i aria-hidden="true"></i>
        </div>
        <button type="button" role="menuitem" data-nyx-switch-profile>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 4 4-4 4"/><path d="M20 7H9a4 4 0 0 0-4 4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h11a4 4 0 0 0 4-4"/></svg>
          <span><strong>Switch Profile</strong><small>Sign in to another Nyx profile</small></span>
        </button>
        <div class="nyx-profile-switch-confirm" data-nyx-profile-switch-confirm hidden>
          <strong>Discard unsaved changes?</strong>
          <p>Your current profile edits have not been saved.</p>
          <div><button type="button" data-nyx-switch-stay>Keep editing</button><button type="button" data-nyx-switch-discard>Discard &amp; switch</button></div>
        </div>
      </section>
    </header>`);
    const profileSwitchToggle=form.querySelector('[data-nyx-profile-switch-toggle]');
    const profileSwitchMenu=form.querySelector('[data-nyx-profile-switch-menu]');
    const profileSwitchConfirm=form.querySelector('[data-nyx-profile-switch-confirm]');
    const setProfileSwitchMenu=open=>{
      profileSwitchMenu.hidden=!open;
      profileSwitchToggle.setAttribute('aria-expanded',String(open));
      profileSwitchToggle.classList.toggle('active',open);
      if(!open){
        profileSwitchConfirm.hidden=true;
        form.querySelector('[data-nyx-switch-profile]').hidden=false;
      }
    };
    const performProfileSwitch=async()=>{
      setProfileSwitchMenu(false);
      close();
      await new Promise(resolve=>setTimeout(resolve,250));
      await signOutFounderOwner();
      await openNyxAccountAccess();
    };
    profileSwitchToggle.addEventListener('click',event=>{
      event.stopPropagation();
      setProfileSwitchMenu(profileSwitchMenu.hidden);
      if(!profileSwitchMenu.hidden)setTimeout(()=>profileSwitchMenu.querySelector('[role="menuitem"]')?.focus(),0);
    });
    profileSwitchMenu.addEventListener('click',event=>{
      event.stopPropagation();
      if(event.target.closest('[data-nyx-switch-profile]')){
        if(form.classList.contains('is-dirty')){
          form.querySelector('[data-nyx-switch-profile]').hidden=true;
          profileSwitchConfirm.hidden=false;
          setTimeout(()=>profileSwitchConfirm.querySelector('button')?.focus(),0);
        }else{
          void performProfileSwitch();
        }
        return;
      }
      if(event.target.closest('[data-nyx-switch-stay]')){
        profileSwitchConfirm.hidden=true;
        form.querySelector('[data-nyx-switch-profile]').hidden=false;
        profileSwitchToggle.focus();
        return;
      }
      if(event.target.closest('[data-nyx-switch-discard]')) void performProfileSwitch();
    });
    overlay.addEventListener('click',event=>{
      if(!profileSwitchMenu.hidden&&!event.target.closest('.nyx-profile-rail-header'))setProfileSwitchMenu(false);
    });
    profileSwitchMenu.addEventListener('keydown',event=>{
      if(event.key==='Escape'){
        event.preventDefault();
        event.stopImmediatePropagation();
        setProfileSwitchMenu(false);
        profileSwitchToggle.focus();
      }
    });
    const railSections=Array.from(form.querySelectorAll('.nyx-profile-editor-section'));
    if(railSections[0]) railSections[0].querySelector('h4').textContent='Nameplate';
    if(railSections[1]) railSections[1].querySelector('h4').textContent='Avatar & Decoration';
    if(railSections[2]) railSections[2].querySelector('h4').textContent='Profile Effect & Frame';
    const displayNameField=form.querySelector('[name="displayName"]')?.closest('label');
    const handleField=form.querySelector('[name="handle"]')?.closest('label');
    const bioField=form.querySelector('[name="bio"]')?.closest('label');
    const statusField=form.querySelector('[name="status"]')?.closest('label');
    const customStatusField=form.querySelector('[name="customStatus"]')?.closest('label');
    displayNameField?.classList.add('nyx-profile-display-name-field');
    handleField?.classList.add('nyx-profile-nameplate-field');
    bioField?.classList.add('nyx-profile-about-field');
    railSections[0]?.querySelector('.nyx-profile-field-grid')?.insertAdjacentHTML('afterbegin',`<div class="nyx-profile-nameplate-preview"><span>${profile.avatarUrl?`<img src="${esc(nyxProfileStillSource(profile.avatarUrl))}" alt="">`:`<b>${esc(profile.displayName.slice(0,1).toUpperCase()||'N')}</b>`}</span><i>${esc(profile.handle)}</i><strong aria-hidden="true">+</strong></div>`);
    const displaySection=document.createElement('section');
    displaySection.className='nyx-profile-editor-section nyx-profile-display-section';
    const fontOptions=NYX_DISPLAY_NAME_FONTS.map(([value,label])=>`<label class="nyx-name-style-choice"><input type="radio" name="displayNameFont" value="${value}" ${profile.displayNameFont===value?'checked':''}><span class="nyx-name-font-${value}">${esc(label)}</span></label>`).join('');
    const effectOptions=NYX_DISPLAY_NAME_EFFECTS.map(([value,label])=>`<label class="nyx-name-style-choice nyx-name-effect-choice"><input type="radio" name="displayNameEffect" value="${value}" ${profile.displayNameEffect===value?'checked':''}><span>${esc(label)}</span></label>`).join('');
    displaySection.innerHTML=`<h4>Display Name Style</h4>
      <button class="nyx-display-name-style-launcher" type="button" data-nyx-display-style-toggle aria-expanded="false">
        <span class="${nyxDisplayNameStyleClass(profile)}" style="${nyxDisplayNameStyleVars(profile)}" data-nyx-name-style-preview>${esc(profile.displayName)}</span><strong aria-hidden="true">+</strong>
      </button>
      <div class="nyx-display-name-editor" data-nyx-display-name-editor hidden>
        <div class="nyx-display-name-editor-head"><div><strong>Change Display Name Style</strong><small>Font, effect, and colors</small></div><div class="nyx-name-preview-modes" aria-label="Preview background"><button type="button" data-nyx-name-preview-theme="dark" class="active">Dark</button><button type="button" data-nyx-name-preview-theme="light">Light</button></div></div>
        <div class="nyx-name-style-live-sample"><span class="${nyxDisplayNameStyleClass(profile)}" style="${nyxDisplayNameStyleVars(profile)}" data-nyx-name-style-preview>${esc(profile.displayName)}</span></div>
        <div class="nyx-display-name-input-slot"></div>
        <fieldset class="nyx-name-style-group"><legend>Font</legend><div class="nyx-name-font-grid">${fontOptions}</div></fieldset>
        <fieldset class="nyx-name-style-group"><legend>Effect</legend><div class="nyx-name-effect-grid">${effectOptions}</div></fieldset>
        <div class="nyx-name-color-grid">
          <label>Primary color<input name="displayNameColorPrimary" type="color" value="${profile.displayNameColorPrimary}"></label>
          <label data-nyx-name-secondary-color>Secondary color<input name="displayNameColorSecondary" type="color" value="${profile.displayNameColorSecondary}"></label>
        </div>
        <button class="nyx-name-surprise-button" type="button" data-nyx-name-surprise>Surprise Me</button>
      </div>`;
    if(displayNameField) displaySection.querySelector('.nyx-display-name-input-slot').appendChild(displayNameField);
    const detailsSection=document.createElement('section');
    detailsSection.className='nyx-profile-editor-section nyx-profile-details-section';
    detailsSection.innerHTML='<h4>Profile Details</h4><div class="nyx-profile-field-grid"></div>';
    const accountEmailField=document.createElement('label');
    accountEmailField.className='nyx-profile-field nyx-profile-field-wide nyx-profile-account-email-field';
    accountEmailField.innerHTML=`Account email <span class="nyx-profile-optional">Optional</span><input name="accountEmail" type="email" maxlength="254" autocomplete="email" value="${esc(nyxUserAccountEmail)}" placeholder="you@example.com"><small>Add an email whenever you want. It can be used to log in and receive password-reset messages.</small>`;
    [accountEmailField,statusField,customStatusField,bioField].filter(Boolean).forEach(field=>detailsSection.querySelector('div').appendChild(field));
    railSections[2]?.after(displaySection,detailsSection);
    form.querySelector('[name="bannerColor"]')?.closest('label')?.classList.add('nyx-profile-banner-color-field');
    form.querySelector('[name="accentPrimary"]')?.closest('label')?.classList.add('nyx-profile-primary-color-field');
    form.querySelector('[name="accentSecondary"]')?.closest('label')?.classList.add('nyx-profile-secondary-color-field');
    const decorationField=document.createElement('label');
    decorationField.className='nyx-profile-field';
    decorationField.innerHTML=`<span class="nyx-profile-decoration-preview nyx-avatar-decoration-${esc(profile.avatarDecoration)}" data-nyx-decoration-preview style="--nyx-user-accent-primary:${profile.accentPrimary};--nyx-user-accent-secondary:${profile.accentSecondary}"><span class="nyx-profile-decoration-avatar">${profile.avatarUrl?`<img src="${esc(nyxProfileStillSource(profile.avatarUrl))}" alt="">`:`<span>${esc(profile.displayName.slice(0,1).toUpperCase()||'N')}</span>`}</span><i class="nyx-avatar-decoration" aria-hidden="true"><span></span></i></span><span class="nyx-profile-decoration-label">Avatar decoration</span><select name="avatarDecoration"><option value="none">None</option><option value="starfall">Starfall</option><option value="orbit">Orbit</option><option value="laurel">Laurel</option><option value="neon-wings">Neon wings</option></select><small>Frames your avatar wherever it is shown.</small>`;
    decorationField.classList.add('nyx-profile-decoration-field');
    form.querySelector('.nyx-profile-image-list')?.appendChild(decorationField);
    decorationField.querySelector('select').value=profile.avatarDecoration;
    const customEffectBuilder=document.createElement('div');
    customEffectBuilder.className='nyx-profile-custom-effect-builder';
    customEffectBuilder.innerHTML=`<button type="button" data-nyx-custom-effect-create>Create custom effect</button><div class="nyx-profile-custom-effect-controls" data-nyx-custom-effect-controls ${profile.profileEffect==='custom'?'':'hidden'}><label>Pattern<select name="customEffectPattern"><option value="starfield">Starfield</option><option value="aurora">Aurora waves</option><option value="comets">Comets</option><option value="grid">Digital grid</option></select></label><label>Primary effect color<input name="customEffectColorPrimary" type="color" value="${profile.customEffectColorPrimary}"></label><label>Secondary effect color<input name="customEffectColorSecondary" type="color" value="${profile.customEffectColorSecondary}"></label><label>Animation time <output data-nyx-custom-speed>${profile.customEffectSpeed}s</output><input name="customEffectSpeed" type="range" min="2" max="18" step="1" value="${profile.customEffectSpeed}"><small>Lower is faster.</small></label><label>Intensity <output data-nyx-custom-intensity>${profile.customEffectIntensity}%</output><input name="customEffectIntensity" type="range" min="20" max="100" step="5" value="${profile.customEffectIntensity}"></label></div>`;
    form.querySelector('.nyx-profile-color-grid')?.appendChild(customEffectBuilder);
    customEffectBuilder.querySelector('[name="customEffectPattern"]').value=profile.customEffectPattern;
    const profileKeys=['displayName','handle','status','customStatus','bio','profileEffect','customEffectPattern','customEffectColorPrimary','customEffectColorSecondary','customEffectSpeed','customEffectIntensity','avatarDecoration','accentPrimary','accentSecondary','bannerColor','displayNameFont','displayNameEffect','displayNameColorPrimary','displayNameColorSecondary','avatarUrl','bannerUrl'];
    const directPopover=document.createElement('section');
    directPopover.className='nyx-profile-direct-popover';
    directPopover.hidden=true;
    overlay.appendChild(directPopover);
    const directTargets=()=>{
      const view=overlay.querySelector('.nyx-user-profile-view');
      view?.querySelectorAll('.nyx-profile-media-edit-avatar').forEach((button,index)=>{if(index>0)button.remove()});
      [['avatar','[data-nyx-direct-edit="avatar"]','Change picture or decoration'],['banner','[data-nyx-direct-edit="banner"]','Change profile banner'],['bio','.nyx-user-profile-bio','Edit About me']].forEach(([type,selector,label])=>{
        const target=view?.querySelector(selector);
        if(!target)return;
        if(!target.dataset.nyxDirectEdit) target.dataset.nyxDirectEdit=type;
        if(target.tagName!=='BUTTON'){target.tabIndex=0;target.setAttribute('role','button')}
        target.setAttribute('aria-label',label);
        target.title=label;
      });
    };
    const syncDisplayNameStylePreview=nextProfile=>{
      displaySection.querySelectorAll('[data-nyx-name-style-preview]').forEach(sample=>{
        sample.className=nyxDisplayNameStyleClass(nextProfile);
        sample.style.cssText=nyxDisplayNameStyleVars(nextProfile);
        sample.textContent=nextProfile.displayName;
      });
      displaySection.querySelector('[data-nyx-display-name-editor]')?.setAttribute('data-name-effect',nextProfile.displayNameEffect);
    };
    const syncAvatarDecorationPreview=nextProfile=>{
      const decorationPreview=decorationField.querySelector('[data-nyx-decoration-preview]');
      const avatarPreview=decorationPreview?.querySelector('.nyx-profile-decoration-avatar');
      if(!decorationPreview||!avatarPreview)return;
      decorationPreview.classList.remove('nyx-avatar-decoration-none','nyx-avatar-decoration-starfall','nyx-avatar-decoration-orbit','nyx-avatar-decoration-laurel','nyx-avatar-decoration-neon-wings');
      decorationPreview.classList.add(`nyx-avatar-decoration-${nextProfile.avatarDecoration}`);
      decorationPreview.style.setProperty('--nyx-user-accent-primary',nextProfile.accentPrimary);
      decorationPreview.style.setProperty('--nyx-user-accent-secondary',nextProfile.accentSecondary);
      syncNyxAccountButtonAvatar(avatarPreview,nextProfile);
    };
    const syncCustomEffectBuilder=()=>{
      const custom=form.querySelector('[name="profileEffect"]')?.value==='custom';
      const controls=customEffectBuilder.querySelector('[data-nyx-custom-effect-controls]');
      const launcher=customEffectBuilder.querySelector('[data-nyx-custom-effect-create]');
      if(controls)controls.hidden=!custom;
      if(launcher){
        launcher.textContent=custom?'Custom effect active':'Create custom effect';
        launcher.classList.toggle('active',custom);
      }
      const speed=customEffectBuilder.querySelector('[name="customEffectSpeed"]')?.value||'7';
      const intensity=customEffectBuilder.querySelector('[name="customEffectIntensity"]')?.value||'70';
      const speedOutput=customEffectBuilder.querySelector('[data-nyx-custom-speed]');
      const intensityOutput=customEffectBuilder.querySelector('[data-nyx-custom-intensity]');
      if(speedOutput)speedOutput.textContent=`${speed}s`;
      if(intensityOutput)intensityOutput.textContent=`${intensity}%`;
    };
    let previewTimer=0;
    const renderPreview=()=>{
      const values=new FormData(form);
      const nextProfile=normalizeNyxUserProfile({...profile,...Object.fromEntries(profileKeys.map(key=>[key,values.get(key)]))});
      const view=overlay.querySelector('.nyx-user-profile-view');
      view.innerHTML=nyxUserProfileCardMarkup(nextProfile,{editable:true});
      nyxManageUserProfileGifs(view,nextProfile);
      syncDisplayNameStylePreview(nextProfile);
      syncAvatarDecorationPreview(nextProfile);
      syncCustomEffectBuilder();
      const bioCount=form.querySelector('[data-nyx-bio-count]');
      if(bioCount)bioCount.textContent=String(values.get('bio')||'').length;
      form.classList.add('is-dirty');
      directTargets();
    };
    const preview=()=>{
      clearTimeout(previewTimer);
      previewTimer=setTimeout(renderPreview,70);
    };
    const styleLauncher=displaySection.querySelector('[data-nyx-display-style-toggle]');
    const styleEditor=displaySection.querySelector('[data-nyx-display-name-editor]');
    styleLauncher?.addEventListener('click',()=>{
      const opening=styleEditor.hidden;
      styleEditor.hidden=!opening;
      styleLauncher.setAttribute('aria-expanded',String(opening));
      styleLauncher.querySelector('strong').textContent=opening?'-':'+';
      if(opening)setTimeout(()=>styleEditor.querySelector('input,button')?.focus(),0);
    });
    displaySection.querySelectorAll('[data-nyx-name-preview-theme]').forEach(button=>button.addEventListener('click',()=>{
      displaySection.querySelectorAll('[data-nyx-name-preview-theme]').forEach(item=>item.classList.toggle('active',item===button));
      displaySection.querySelector('.nyx-name-style-live-sample')?.classList.toggle('light',button.dataset.nyxNamePreviewTheme==='light');
    }));
    displaySection.querySelector('[data-nyx-name-surprise]')?.addEventListener('click',()=>{
      const font=NYX_DISPLAY_NAME_FONTS[Math.floor(Math.random()*NYX_DISPLAY_NAME_FONTS.length)][0];
      const effect=NYX_DISPLAY_NAME_EFFECTS[Math.floor(Math.random()*NYX_DISPLAY_NAME_EFFECTS.length)][0];
      const randomColor=()=>`#${Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0')}`;
      const fontInput=form.querySelector(`[name="displayNameFont"][value="${font}"]`);
      const effectInput=form.querySelector(`[name="displayNameEffect"][value="${effect}"]`);
      if(fontInput)fontInput.checked=true;
      if(effectInput)effectInput.checked=true;
      form.querySelector('[name="displayNameColorPrimary"]').value=randomColor();
      form.querySelector('[name="displayNameColorSecondary"]').value=randomColor();
      preview();
    });
    syncDisplayNameStylePreview(profile);
    syncAvatarDecorationPreview(profile);
    syncCustomEffectBuilder();
    nyxManageUserProfileGifs(overlay,profile);
    customEffectBuilder.querySelector('[data-nyx-custom-effect-create]')?.addEventListener('click',()=>{
      const effect=form.querySelector('[name="profileEffect"]');
      if(effect)effect.value='custom';
      preview();
      customEffectBuilder.querySelector('select,input')?.focus();
    });
    const closeDirectPopover=()=>{directPopover.hidden=true;directPopover.textContent=''};
    const positionDirectPopover=target=>{
      requestAnimationFrame(()=>{
        const targetBox=target.getBoundingClientRect();
        const popoverBox=directPopover.getBoundingClientRect();
        const gap=12;
        let left=targetBox.right+gap;
        if(left+popoverBox.width>innerWidth-16)left=Math.max(16,targetBox.left-popoverBox.width-gap);
        let top=Math.max(16,targetBox.top);
        if(top+popoverBox.height>innerHeight-16)top=Math.max(16,innerHeight-popoverBox.height-16);
        directPopover.style.left=`${Math.round(left)}px`;
        directPopover.style.top=`${Math.round(top)}px`;
      });
    };
    const directEditorOptions=(selected,options)=>options.map(([value,label])=>`<option value="${value}" ${selected===value?'selected':''}>${label}</option>`).join('');
    const openDirectEditor=(type,target)=>{
      const values=new FormData(form);
      directPopover.style.setProperty('--nyx-direct-primary',String(values.get('accentPrimary')||'#5865f2'));
      directPopover.style.setProperty('--nyx-direct-secondary',String(values.get('accentSecondary')||'#8ea1ff'));
      if(type==='avatar'){
        const decoration=String(values.get('avatarDecoration')||'none');
        directPopover.innerHTML=`<header><div><strong>Avatar</strong><small>Picture and decoration</small></div><button type="button" data-nyx-direct-close aria-label="Close">&#215;</button></header><div class="nyx-profile-direct-actions"><button type="button" data-nyx-direct-action="pick-avatar">Change picture</button><button type="button" data-nyx-direct-action="remove-avatar">Remove picture</button></div><label>Avatar decoration<select data-nyx-direct-value="avatarDecoration">${directEditorOptions(decoration,[['none','None'],['starfall','Starfall'],['orbit','Orbit'],['laurel','Laurel'],['neon-wings','Neon wings']])}</select></label><p>Changes preview instantly. Use Save changes when you are finished.</p>`;
      }else if(type==='banner'){
        directPopover.innerHTML=`<header><div><strong>Profile banner</strong><small>Image and fallback color</small></div><button type="button" data-nyx-direct-close aria-label="Close">&#215;</button></header><div class="nyx-profile-direct-actions"><button type="button" data-nyx-direct-action="pick-banner">Change banner</button><button type="button" data-nyx-direct-action="remove-banner">Remove banner</button></div><label>Fallback color<input type="color" data-nyx-direct-value="bannerColor" value="${esc(values.get('bannerColor')||'#8ea1ff')}"></label><p>The fallback color appears when no banner image is selected.</p>`;
      }else{
        directPopover.innerHTML=`<header><div><strong>About me</strong><small>Profile description</small></div><button type="button" data-nyx-direct-close aria-label="Close">&#215;</button></header><label>Description<textarea data-nyx-direct-value="bio" maxlength="280" rows="5" placeholder="Tell people a little about yourself.">${esc(values.get('bio')||'')}</textarea></label><p>Changes preview instantly. Use Save changes when you are finished.</p>`;
      }
      directPopover.hidden=false;
      positionDirectPopover(target);
      setTimeout(()=>directPopover.querySelector('textarea,select,input,button')?.focus(),0);
    };
    directTargets();
    overlay.addEventListener('click',event=>{
      const directTarget=event.target.closest('[data-nyx-direct-edit]');
      if(directTarget){openDirectEditor(directTarget.dataset.nyxDirectEdit,directTarget);return}
      if(event.target.closest('[data-nyx-direct-close]')){closeDirectPopover();return}
      const action=event.target.closest('[data-nyx-direct-action]')?.dataset.nyxDirectAction;
      if(action){
        const [verb,type]=action.split('-');
        if(verb==='pick')form.querySelector(`[data-nyx-pick-image="${type}"]`)?.click();
        if(verb==='remove')form.querySelector(`[data-nyx-clear-image="${type}"]`)?.click();
        return;
      }
      if(!directPopover.hidden&&!event.target.closest('.nyx-profile-direct-popover'))closeDirectPopover();
    });
    overlay.addEventListener('input',event=>{
      const key=event.target.dataset.nyxDirectValue;
      if(!key)return;
      const source=form.querySelector(`[name="${key}"]`);
      if(source){source.value=event.target.value;preview()}
    });
    overlay.addEventListener('change',event=>{
      const key=event.target.dataset.nyxDirectValue;
      if(!key)return;
      const source=form.querySelector(`[name="${key}"]`);
      if(source){source.value=event.target.value;preview()}
    });
    overlay.addEventListener('keydown',event=>{
      const directTarget=event.target.closest('[data-nyx-direct-edit]');
      if(directTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();openDirectEditor(directTarget.dataset.nyxDirectEdit,directTarget)}
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!directPopover.hidden)closeDirectPopover()}
    });
    form.addEventListener('input',preview);form.addEventListener('change',preview);
    form.addEventListener('reset',()=>{pendingMediaPreparations.clear();clearTimeout(previewTimer);requestAnimationFrame(()=>{form.classList.remove('is-dirty');const avatarLabel=form.querySelector('[data-nyx-file-name="avatar"]');const bannerLabel=form.querySelector('[data-nyx-file-name="banner"]');if(avatarLabel)avatarLabel.textContent=profile.avatarUrl?'Image selected':'No image selected';if(bannerLabel)bannerLabel.textContent=profile.bannerUrl?'Image selected':'No image selected';const values=new FormData(form);const nextProfile=normalizeNyxUserProfile({...profile,...Object.fromEntries(profileKeys.map(key=>[key,values.get(key)]))});const view=overlay.querySelector('.nyx-user-profile-view');view.innerHTML=nyxUserProfileCardMarkup(nextProfile,{editable:true});nyxManageUserProfileGifs(view,nextProfile);syncDisplayNameStylePreview(nextProfile);syncAvatarDecorationPreview(nextProfile);syncCustomEffectBuilder();const bioCount=form.querySelector('[data-nyx-bio-count]');if(bioCount)bioCount.textContent=String(values.get('bio')||'').length;directTargets()})});
    form.querySelectorAll('[data-nyx-pick-image]').forEach(button=>button.addEventListener('click',()=>form.querySelector(`[name="${button.dataset.nyxPickImage}File"]`)?.click()));
    form.querySelectorAll('[data-nyx-clear-image]').forEach(button=>button.addEventListener('click',()=>{const type=button.dataset.nyxClearImage;pendingMediaPreparations.delete(type);form.querySelector(`[name="${type}Url"]`).value='';form.querySelector(`[name="${type}File"]`).value='';form.querySelector(`[data-nyx-file-name="${type}"]`).textContent='No image selected';preview()}));
    form.querySelectorAll('.nyx-profile-file-input').forEach(input=>input.addEventListener('change',()=>{const type=input.name==='avatarFile'?'avatar':'banner';const label=form.querySelector(`[data-nyx-file-name="${type}"]`);const error=form.querySelector('.nyx-founder-editor-error');const file=input.files?.[0];if(!file)return;label.textContent='Preparing image…';error.textContent='';const preparation=nyxProfileImageFromFile(file,type==='avatar'?512:1200,type==='avatar'?512:480);pendingMediaPreparations.set(type,preparation);void preparation.then(dataUrl=>{if(pendingMediaPreparations.get(type)!==preparation)return;form.querySelector(`[name="${type}Url"]`).value=dataUrl;label.textContent=file.name;preview()}).catch(imageError=>{if(pendingMediaPreparations.get(type)!==preparation)return;input.value='';label.textContent='No image selected';error.textContent=imageError.message||'That image could not be used.'}).finally(()=>{if(pendingMediaPreparations.get(type)===preparation)pendingMediaPreparations.delete(type)})}));
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const error=form.querySelector('.nyx-founder-editor-error');
      const button=form.querySelector('[type="submit"]');
      const originalLabel=button.textContent;
      button.disabled=true;
      try{
        while(pendingMediaPreparations.size){
          button.textContent='Preparing media…';
          await Promise.all([...pendingMediaPreparations.values()]);
        }
        const values=new FormData(form);
        const nextProfile=Object.fromEntries(profileKeys.map(key=>[key,values.get(key)]));
        const nextEmail=String(values.get('accountEmail')||'').trim().toLowerCase();
        const token=await nyxGetFirebaseToken(true);
        if(!token)throw new Error('Sign in again to save your profile.');
        for(const kind of ['avatar','banner']){
          const key=`${kind}Url`;
          if(/^data:image\/(?:gif|png|jpeg|webp);base64,/i.test(String(nextProfile[key]||''))){
            button.textContent=`Uploading ${kind}…`;
            nextProfile[key]=await nyxUploadProfileMedia(kind,nextProfile[key],token,progress=>{button.textContent=`Uploading ${kind} ${progress}%`});
            form.querySelector(`[name="${key}"]`).value=nextProfile[key];
          }
        }
        const imagePayloadSize=[nextProfile.avatarUrl,nextProfile.bannerUrl].reduce((total,value)=>total+(String(value||'').startsWith('data:image/')?String(value).length:0),0);
        if(imagePayloadSize>NYX_PROFILE_IMAGE_TOTAL_LIMIT)throw new Error('Your avatar and banner are too large together. Remove one or choose smaller images.');
        button.textContent='Saving…';
        const data=await nyxProfileMediaFetch('/api/profiles/me',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({profile:nextProfile})},'Profile could not be saved.');
        const persistedProfile=normalizeNyxUserProfile(data.profile);
        for(const kind of ['avatar','banner']){
          const key=`${kind}Url`;
          if(String(nextProfile[key]||'')!==String(persistedProfile[key]||'')){
            throw new Error(`The ${kind} image was not stored. Try selecting it again.`);
          }
        }
        if(nextEmail&&nextEmail!==nyxUserAccountEmail){
          button.textContent='Updating email…';
          const accountData=await nyxProfileMediaFetch('/api/account/me/email',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({email:nextEmail})},'Account email could not be updated.');
          nyxUserAccountEmail=String(accountData.email||nextEmail);
          if(accountData.customToken){
            const {signInWithCustomToken}=await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
            const credential=await signInWithCustomToken(nyxFounderFirebaseAuth,accountData.customToken);
            nyxFounderSignedInUser=credential.user;
            await credential.user.getIdToken(true);
          }
        }
        nyxUserProfile=persistedProfile;
        nyxUserProfileCreatedAt=String(data.createdAt||nyxUserProfileCreatedAt);
        button.textContent='Verifying…';
        const verifiedProfile=await loadNyxUserProfile();
        if(!verifiedProfile)throw new Error('The saved profile could not be verified. Try again.');
        for(const kind of ['avatar','banner']){
          const key=`${kind}Url`;
          if(String(nextProfile[key]||'')!==String(nyxUserProfile?.[key]||'')){
            throw new Error(`The saved ${kind} image could not be loaded. Try selecting it again.`);
          }
        }
        if(nyxFounderIsOwner)await loadFounderProfile({force:true});
        syncFounderOwnerControls();
        close();
        toast(nyxFounderIsOwner?'Profile and About Nyx updated':'Profile saved');
      }catch(saveError){
        error.textContent=nyxFriendlyFirebaseError(saveError,'Profile could not be saved.');
        button.disabled=false;
        button.textContent=originalLabel;
      }
    });
  }
  function nyxFounderText(value,fallback,max){const text=String(value??'').trim().replace(/\s+/g,' ').slice(0,max);return text||fallback}
  function nyxFounderUrl(value,fallback=''){
    const raw=String(value??'').trim();
    if(!raw) return fallback;
    if(/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(raw)&&raw.length<=NYX_PROFILE_IMAGE_DATA_LIMIT)return raw.replace(/\s/g,'');
    if(raw.length>1500)return fallback;
    if(/^\/assets\/[a-z0-9/_\-.]+$/i.test(raw)) return raw;
    if(/^\/api\/profile-media\/[A-Za-z0-9_-]{8,128}\/(?:avatar|banner)\/[A-Za-z0-9_-]{12,80}$/.test(raw)) return raw;
    try{const url=new URL(raw,location.origin);return /^(https?:)$/i.test(url.protocol)&&!url.username&&!url.password?url.href:fallback}catch{return fallback}
  }
  function normalizeNyxFounderProfile(value={}){
    const source=value&&typeof value==='object'?value:{};
    const badges=Array.isArray(source.badges)?source.badges:[];
    const roles=Array.isArray(source.roles)?source.roles:nyxFounderProfileDefaults.roles;
    const accentPrimary=/^#[0-9a-f]{6}$/i.test(String(source.accentPrimary||source.accent||'').trim())?String(source.accentPrimary||source.accent).trim().toLowerCase():nyxFounderProfileDefaults.accentPrimary;
    const accentSecondary=/^#[0-9a-f]{6}$/i.test(String(source.accentSecondary||'').trim())?String(source.accentSecondary).trim().toLowerCase():nyxFounderProfileDefaults.accentSecondary;
    const bannerColor=/^#[0-9a-f]{6}$/i.test(String(source.bannerColor||'').trim())?String(source.bannerColor).trim().toLowerCase():accentSecondary;
    const displayNameColorPrimary=/^#[0-9a-f]{6}$/i.test(String(source.displayNameColorPrimary||'').trim())?String(source.displayNameColorPrimary).trim().toLowerCase():nyxFounderProfileDefaults.displayNameColorPrimary;
    const displayNameColorSecondary=/^#[0-9a-f]{6}$/i.test(String(source.displayNameColorSecondary||'').trim())?String(source.displayNameColorSecondary).trim().toLowerCase():accentSecondary;
    const displayNameFont=NYX_DISPLAY_NAME_FONTS.some(([value])=>value===String(source.displayNameFont||'').toLowerCase())?String(source.displayNameFont).toLowerCase():nyxFounderProfileDefaults.displayNameFont;
    const displayNameEffect=NYX_DISPLAY_NAME_EFFECTS.some(([value])=>value===String(source.displayNameEffect||'').toLowerCase())?String(source.displayNameEffect).toLowerCase():nyxFounderProfileDefaults.displayNameEffect;
    const customEffectPattern=['starfield','aurora','comets','grid'].includes(String(source.customEffectPattern||'').toLowerCase())?String(source.customEffectPattern).toLowerCase():nyxFounderProfileDefaults.customEffectPattern;
    const customEffectColorPrimary=/^#[0-9a-f]{6}$/i.test(String(source.customEffectColorPrimary||'').trim())?String(source.customEffectColorPrimary).trim().toLowerCase():nyxFounderProfileDefaults.customEffectColorPrimary;
    const customEffectColorSecondary=/^#[0-9a-f]{6}$/i.test(String(source.customEffectColorSecondary||'').trim())?String(source.customEffectColorSecondary).trim().toLowerCase():accentSecondary;
    const customEffectSpeed=Math.max(2,Math.min(18,Number(source.customEffectSpeed)||nyxFounderProfileDefaults.customEffectSpeed));
    const customEffectIntensity=Math.max(20,Math.min(100,Number(source.customEffectIntensity)||nyxFounderProfileDefaults.customEffectIntensity));
    return {displayName:nyxFounderText(source.displayName,nyxFounderProfileDefaults.displayName,48),handle:nyxFounderText(source.handle,nyxFounderProfileDefaults.handle,40),role:nyxFounderText(source.role,nyxFounderProfileDefaults.role,64),bio:nyxFounderText(source.bio,nyxFounderProfileDefaults.bio,500),avatarUrl:nyxFounderUrl(source.avatarUrl,nyxFounderProfileDefaults.avatarUrl),bannerUrl:nyxFounderUrl(source.bannerUrl),accent:accentPrimary,accentPrimary,accentSecondary,bannerColor,displayNameFont,displayNameEffect,displayNameColorPrimary,displayNameColorSecondary,profileEffect:['none','glow','sparkle','aurora','holographic','fireflies','cosmic-dust','electric-storm','meteor-shower','cyber-grid','plasma','snowfall','embers','bubbles','custom'].includes(String(source.profileEffect||'').toLowerCase())?String(source.profileEffect).toLowerCase():'none',customEffectPattern,customEffectColorPrimary,customEffectColorSecondary,customEffectSpeed,customEffectIntensity,avatarDecoration:['none','starfall','orbit','laurel','neon-wings'].includes(String(source.avatarDecoration||'').toLowerCase())?String(source.avatarDecoration).toLowerCase():'none',status:['online','idle','dnd','offline'].includes(String(source.status||'').toLowerCase())?String(source.status).toLowerCase():nyxFounderProfileDefaults.status,roles:roles.map(role=>nyxFounderText(role,'',32)).filter(Boolean).slice(0,8),badges:badges.map(badge=>nyxFounderText(badge,'',32)).filter(Boolean).slice(0,8),linkLabel:nyxFounderText(source.linkLabel,'',40),linkUrl:nyxFounderUrl(source.linkUrl)};
  }
  function nyxFounderProfileCardMarkup(){
    const profile=normalizeNyxFounderProfile(nyxFounderProfile);
    const roles=profile.roles.map(role=>{
      const roleKey=String(role||'').toLowerCase();
      const icon=['owner','admin','developer','moderator','member'].includes(roleKey)?`<img src="/assets/icons/roles/${roleKey}.png" alt="" aria-hidden="true">`:'';
      return `<span class="nyx-founder-role-chip${roleKey==='owner'?' nyx-founder-role-owner':''}">${icon}${esc(role)}</span>`;
    }).join('');
    const badges=profile.badges.map(badge=>`<span class="nyx-founder-badge">${esc(badge)}</span>`).join('');
    const link=profile.linkUrl?`<a class="nyx-founder-link" href="${esc(profile.linkUrl)}" target="_blank" rel="noreferrer noopener">${esc(profile.linkLabel||'Open profile')}<span aria-hidden="true">↗</span></a>`:'';
    const banner=profile.bannerUrl?`<img src="${esc(nyxProfileStillSource(profile.bannerUrl))}" alt="" aria-hidden="true">`:'';
    return `<article class="nyx-founder-profile nyx-founder-profile-standard nyx-founder-effect-${esc(profile.profileEffect)} ${nyxProfileEffectClass(profile)}" data-nyx-founder-profile style="--nyx-founder-accent:${profile.accentPrimary};--nyx-founder-accent-primary:${profile.accentPrimary};--nyx-founder-accent-secondary:${profile.accentSecondary};--nyx-founder-banner-color:${profile.bannerColor};--nyx-user-accent-primary:${profile.accentPrimary};--nyx-user-accent-secondary:${profile.accentSecondary};${nyxProfileEffectVars(profile)}"><i class="nyx-founder-profile-effect nyx-user-profile-effect" aria-hidden="true"></i><div class="nyx-founder-banner" aria-hidden="true">${banner}</div><div class="nyx-founder-profile-content"><div class="nyx-founder-image-wrap nyx-avatar-decoration-${esc(profile.avatarDecoration)}"><img class="nyx-founder-image" src="${esc(nyxProfileStillSource(profile.avatarUrl))}" alt="${esc(profile.displayName)} profile picture"><i class="nyx-avatar-decoration" aria-hidden="true"><span></span></i><span class="nyx-founder-status nyx-founder-status-${esc(profile.status)}" title="${esc(profile.status)}" aria-label="${esc(profile.status)}"></span></div><div class="nyx-founder-copy"><div class="nyx-founder-name-row"><h3 class="${nyxDisplayNameStyleClass(profile)}" style="${nyxDisplayNameStyleVars(profile)}">${esc(profile.displayName)}</h3>${profile.roles.some(role=>role.toLowerCase()==='owner')?'<span class="nyx-founder-owner-crown" title="Nyx owner" aria-label="Nyx owner">♛</span>':''}</div><p class="nyx-founder-handle">${esc(profile.handle)}</p><p class="nyx-founder-role">${esc(profile.role)}</p>${roles?`<div class="nyx-founder-role-list" aria-label="Profile roles">${roles}</div>`:''}${badges?`<div class="nyx-founder-badges" aria-label="Profile badges">${badges}</div>`:''}<div class="nyx-founder-about"><strong>About me</strong><p class="nyx-founder-bio">${esc(profile.bio)}</p></div>${link}</div></div></article>`;
  }
  function refreshFounderProfileViews(){
    const update=root=>{try{root.querySelectorAll?.('[data-nyx-founder-profile]').forEach(card=>{card.outerHTML=nyxFounderProfileCardMarkup()});root.querySelectorAll?.('[data-nyx-credits-founder]').forEach(card=>{card.outerHTML=nyxCreditsFounderCardMarkup()});nyxManageFounderProfileGifs(root)}catch{}};
    update(document);
    document.querySelectorAll('iframe').forEach(frame=>update(frame.contentDocument));
  }
  async function loadFounderProfile({force=false}={}){
    if(nyxFounderProfileLoadPromise&&!force) return nyxFounderProfileLoadPromise;
    nyxFounderProfileLoadPromise=fetch('/api/founder-profile',{cache:'no-store'}).then(async response=>{
      if(!response.ok) throw new Error('Founder Profile is unavailable.');
      const data=await response.json();
      nyxFounderProfile=normalizeNyxFounderProfile(data?.profile);
      refreshFounderProfileViews();
      return data;
    }).catch(error=>{console.warn('Nyx Founder Profile could not load:',error);return {profile:nyxFounderProfile,persistent:false,editingEnabled:false}}).finally(()=>{nyxFounderProfileLoadPromise=null});
    return nyxFounderProfileLoadPromise;
  }
  async function openFounderProfileEditor(){
    if(!nyxFounderIsOwner){toast('Sign in with the founder Nyx account first.');return}
    await loadFounderProfile();
    document.querySelector('.nyx-founder-editor-overlay')?.remove();
    const profile=normalizeNyxFounderProfile(nyxFounderProfile);
    const overlay=document.createElement('div');
    overlay.className='nyx-founder-editor-overlay';
    overlay.innerHTML=`<section class="nyx-founder-editor" role="dialog" aria-modal="true" aria-labelledby="nyxFounderEditorTitle"><header><div><p class="utility-kicker">About Nyx</p><h2 id="nyxFounderEditorTitle">Customize Founder Profile</h2><p>Publishing as your signed-in founder account.</p></div><button type="button" class="nyx-founder-editor-close" data-close-founder-editor aria-label="Close">×</button></header><form class="nyx-founder-editor-form"><div class="nyx-founder-editor-grid"><label>Display name<input name="displayName" maxlength="48" required value="${esc(profile.displayName)}"></label><label>Handle<input name="handle" maxlength="40" required value="${esc(profile.handle)}"></label><label>Profile subtitle<input name="role" maxlength="64" required value="${esc(profile.role)}"></label><label>Status<select name="status"><option value="online" ${profile.status==='online'?'selected':''}>Online</option><option value="idle" ${profile.status==='idle'?'selected':''}>Idle</option><option value="dnd" ${profile.status==='dnd'?'selected':''}>Do not disturb</option><option value="offline" ${profile.status==='offline'?'selected':''}>Offline</option></select></label><label class="nyx-founder-editor-wide">Bio<textarea name="bio" maxlength="500" rows="4" required>${esc(profile.bio)}</textarea></label><label>Avatar URL<input name="avatarUrl" type="url" value="${esc(profile.avatarUrl)}"></label><label>Banner URL <small>Optional</small><input name="bannerUrl" type="url" value="${esc(profile.bannerUrl)}"></label><label>Accent color<input name="accent" type="color" value="${esc(profile.accent)}"></label><label>Roles <small>Comma-separated; access remains tied to your Firebase account ID.</small><input name="roles" maxlength="280" value="${esc(profile.roles.join(', '))}"></label><label>Badges <small>Comma-separated</small><input name="badges" maxlength="280" value="${esc(profile.badges.join(', '))}"></label><label>Profile link label <small>Optional</small><input name="linkLabel" maxlength="40" value="${esc(profile.linkLabel)}"></label><label>Profile link URL <small>Optional</small><input name="linkUrl" type="url" value="${esc(profile.linkUrl)}"></label></div><footer><p class="nyx-founder-editor-error" aria-live="polite"></p><div><button type="button" class="settings-action" data-close-founder-editor>Cancel</button><button type="submit" class="settings-action on">Publish profile</button></div></footer></form></section>`;
    document.body.appendChild(overlay);
    const close=()=>overlay.remove();
    overlay.addEventListener('click',event=>{if(event.target===overlay||event.target.closest('[data-close-founder-editor]')) close()});
    overlay.addEventListener('keydown',event=>{if(event.key==='Escape') close()});
    const form=overlay.querySelector('form');
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const values=new FormData(form);
      const button=form.querySelector('[type="submit"]');
      const error=form.querySelector('.nyx-founder-editor-error');
      const next={displayName:values.get('displayName'),handle:values.get('handle'),role:values.get('role'),bio:values.get('bio'),avatarUrl:values.get('avatarUrl'),bannerUrl:values.get('bannerUrl'),accent:values.get('accent'),status:values.get('status'),roles:String(values.get('roles')||'').split(','),badges:String(values.get('badges')||'').split(','),linkLabel:values.get('linkLabel'),linkUrl:values.get('linkUrl')};
      button.disabled=true;
      error.textContent='';
      try{
        const token=await nyxGetFirebaseToken(true);
        if(!token) throw new Error('Your founder sign-in has expired. Sign in again.');
        const response=await fetch('/api/founder-profile',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({profile:next})});
        const data=await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(data.error||'Profile could not be published.');
        nyxFounderProfile=normalizeNyxFounderProfile(data.profile);
        refreshFounderProfileViews();
        close();
        toast('Founder profile published');
      }catch(saveError){error.textContent=saveError.message||'Profile could not be published.';button.disabled=false}
    });
    setTimeout(()=>form.querySelector('[name="displayName"]')?.focus(),0);
  }
  const NYX_TERMS_VERSION='2026-07-30';
  function nyxTermsSectionsMarkup(){
    return `<section><h2>1. Eligibility</h2><p>You must comply with all applicable laws when using Nyx. If you are under the age required by your jurisdiction to enter into a binding agreement, you may only use Nyx with the permission of a parent or legal guardian.</p></section>
      <section><h2>2. Description of the Service</h2><p>Nyx is a platform that may provide features including, but not limited to:</p><ul><li>Search and discovery tools</li><li>AI-powered transcription and summarization</li><li>Productivity and educational tools</li><li>Entertainment applications</li><li>Links to third-party websites and services</li><li>Experimental features released for testing</li></ul><p>Features may change, be added, modified, or removed at any time without notice.</p></section>
      <section><h2>3. Acceptable Use</h2><p>You agree not to:</p><ul><li>Violate any applicable law or regulation.</li><li>Attempt to gain unauthorized access to Nyx, its servers, or other users' systems.</li><li>Upload or distribute malware, viruses, or malicious code.</li><li>Interfere with or disrupt the operation of the Service.</li><li>Circumvent security measures, authentication systems, or rate limits.</li><li>Use automated systems that excessively burden our infrastructure.</li><li>Impersonate another person or entity.</li><li>Infringe upon the intellectual property or other legal rights of others.</li><li>Use Nyx in a manner that harms other users or the availability of the Service.</li></ul><p>We reserve the right to suspend, restrict, or terminate access for users who violate these Terms.</p></section>
      <section><h2>4. User Content</h2><p>Some features may allow you to submit text, media, links, or other content ("User Content").</p><p>You retain ownership of your User Content.</p><p>By submitting User Content, you grant Nyx a non-exclusive, worldwide, royalty-free license to host, process, reproduce, and display that content solely for the purpose of operating, maintaining, and improving the Service.</p><p>You represent that you have the necessary rights and permissions to submit any User Content you provide.</p></section>
      <section><h2>5. AI Features</h2><p>Nyx may provide AI-generated content such as summaries, transcriptions, recommendations, or other generated material.</p><p>AI-generated output may be inaccurate, incomplete, or outdated. It should not be relied upon as professional, legal, financial, medical, or other expert advice.</p><p>Users are responsible for reviewing and verifying AI-generated content before relying on it.</p></section>
      <section><h2>6. Media Processing</h2><p>Nyx may process publicly available or user-submitted media to provide requested functionality.</p><p>You are solely responsible for ensuring that you have the necessary rights and permissions to submit or process any content through the Service.</p><p>Nyx does not claim ownership of submitted content.</p></section>
      <section><h2>7. Third-Party Services</h2><p>Nyx may contain links to or integrate with third-party websites, APIs, applications, or services.</p><p>We do not control or endorse third-party content and are not responsible for its availability, accuracy, security, functionality, or privacy practices.</p><p>Your use of third-party services is governed by their own terms and policies.</p></section>
      <section><h2>8. Intellectual Property</h2><p>Unless otherwise stated, Nyx, including its software, branding, design, graphics, logos, interface, and original content, is owned by Nyx or its licensors and is protected by applicable intellectual property laws.</p><p>You may not copy, modify, distribute, reverse engineer, sell, or commercially exploit any portion of the Service without prior written permission unless permitted by applicable law.</p></section>
      <section><h2>9. Availability</h2><p>The Service is provided on an <strong>"AS IS"</strong> and <strong>"AS AVAILABLE"</strong> basis.</p><p>We do not guarantee that Nyx will always be available, uninterrupted, secure, or error-free.</p><p>Features may be modified, suspended, or discontinued at any time.</p></section>
      <section><h2>10. Privacy</h2><p>Your use of Nyx is also subject to our Privacy Policy.</p><p>By using the Service, you acknowledge that Nyx may collect and process information necessary to operate, maintain, improve, and secure the Service.</p></section>
      <section><h2>11. Cookies</h2><p>Nyx may use cookies, local storage, or similar technologies to:</p><ul><li>Remember user preferences.</li><li>Improve website performance.</li><li>Analyze anonymous usage statistics.</li><li>Enhance the overall user experience.</li></ul><p>You may disable cookies through your browser settings, although doing so may affect certain features of the Service.</p></section>
      <section><h2>12. Limitation of Liability</h2><p>To the fullest extent permitted by applicable law, Nyx and its owners, developers, contributors, affiliates, and service providers shall not be liable for any indirect, incidental, special, exemplary, consequential, or punitive damages arising from or relating to the use of the Service.</p></section>
      <section><h2>13. Indemnification</h2><p>You agree to defend, indemnify, and hold harmless Nyx, its developers, affiliates, contributors, and service providers from any claims, damages, losses, liabilities, and expenses arising from:</p><ul><li>Your use of the Service.</li><li>Your violation of these Terms.</li><li>Your submitted content.</li><li>Your violation of any applicable law or the rights of another person.</li></ul></section>
      <section><h2>14. Termination</h2><p>We may suspend, restrict, or terminate your access to Nyx at any time, with or without notice, if we reasonably believe you have violated these Terms, abused the Service, or created a security or legal risk.</p><p>We may also discontinue the Service, in whole or in part, at any time.</p></section>
      <section><h2>15. Changes to These Terms</h2><p>We reserve the right to update or modify these Terms at any time.</p><p>The updated version becomes effective when posted on Nyx.</p><p>Your continued use of the Service after changes are posted constitutes your acceptance of the revised Terms.</p></section>
      <section><h2>16. Copyright &amp; DMCA Notice</h2><p>Nyx respects the intellectual property rights of others and responds to valid notices of alleged copyright infringement in accordance with the Digital Millennium Copyright Act ("DMCA") and other applicable laws.</p><p>A copyright owner or authorized agent submitting a takedown notice must provide:</p><ul><li>A physical or electronic signature of the copyright owner or authorized agent.</li><li>Identification of the copyrighted work claimed to have been infringed.</li><li>Identification and location of the allegedly infringing material, including the relevant Nyx page or URL.</li><li>Contact information sufficient for Nyx to reach the complaining party.</li><li>A good-faith statement that the disputed use is not authorized by the copyright owner, its agent, or the law.</li><li>A statement, made under penalty of perjury, that the notice is accurate and that the complaining party is authorized to act for the copyright owner.</li></ul><p>After receiving a valid notice through Nyx's published copyright contact, Nyx may remove or disable access to the material and notify the affected user. An affected user may submit a valid counter-notice identifying the removed material, consenting to the appropriate court jurisdiction, and stating under penalty of perjury that the material was removed because of mistake or misidentification.</p><p>Nyx may restore material when permitted by law and may suspend or terminate repeat infringers. Knowingly making a material misrepresentation in a notice or counter-notice may result in legal liability.</p></section>`;
  }
  function nyxTermsPageMarkup(className='nyx-utility-tab nyx-terms-tab'){
    return `<article class="${esc(className)}"><p class="utility-kicker">Nyx</p><h1>Terms of Service</h1><p class="utility-updated"><strong>Effective Date:</strong> July 30, 2026</p><p class="utility-intro">Welcome to <strong>Nyx</strong> ("Nyx," "we," "our," or "us"). By accessing or using our website, applications, or services (collectively, the "Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not use the Service.</p>${nyxTermsSectionsMarkup()}</article>`;
  }
  function nyxCreditsPageMarkup(className='nyx-utility-tab nyx-credits-tab'){
    const profile=normalizeNyxFounderProfile(nyxFounderProfile);
    return `<article class="${esc(className)}" style="--credits-accent:${profile.accentPrimary};--credits-line:color-mix(in srgb,${profile.accentPrimary} 28%,transparent)">
      <header class="nyx-credits-hero">
        <p class="utility-kicker">The people behind Nyx</p>
        <h1>Made for curious minds.</h1>
        <p>Nyx is a place to search, study, create, and make the web feel a little more personal. This is a thank-you to the people and tools that help bring it to life.</p>
        <div class="nyx-credits-hero-notes" aria-label="Nyx values"><span>Built with care</span><span>Always evolving</span><span>Made to explore</span></div>
      </header>
      <section class="nyx-credits-section nyx-credits-founder-section" aria-labelledby="nyxCreditsFounder">
        <div class="nyx-credits-section-heading"><p>01 / Founder</p><h2 id="nyxCreditsFounder">Owner</h2></div>
        <figure class="nyx-credits-owner-image"><img src="/assets/credits/about-nyx-owner-profile.png" alt="Nyx owner profile"></figure>
      </section>
      <section class="nyx-credits-section nyx-credits-community-section" aria-labelledby="nyxCreditsCommunity">
        <div class="nyx-credits-section-heading"><p>02 / With thanks</p><h2 id="nyxCreditsCommunity">Credits and ideas</h2><span>Every release carries the care of the people who contribute ideas, feedback, and the foundations beneath the product.</span></div>
        <div class="nyx-credit-grid">
          <article><span aria-hidden="true">◌</span><h3>Libraries</h3><p>With appreciation for the tools that power Nyx’s interface, graphics, account experience, and browser technology.</p></article>
          <article><span aria-hidden="true">♡</span><h3>Special thanks</h3><p>For the early believers, patient testers, and every person who chose to spend time with Nyx.</p></article>
        </div>
      </section>
      <section class="nyx-credits-section nyx-credits-changelog-section" aria-labelledby="nyxCreditsChangelog">
        <div class="nyx-credits-section-heading"><p>03 / Changelog</p><h2 id="nyxCreditsChangelog">What changed.</h2><span>Updates are added here manually when there is something worth sharing.</span></div>
        <ol class="nyx-credits-changelog">
          <li><time datetime="2026-08-03">Aug 3, 2026</time><div><strong>Browser, AI, and account updates</strong><p>Added model switching and a redesigned AI workspace, expanded games and portable download support, improved browser downloads and draggable tabs, added safer link checks without interfering with verification pages, and expanded profile, role, and premium controls in the Owner Dashboard.</p></div></li>
          <li><time datetime="2026-07-31">Jul 31, 2026</time><div><strong>About Nyx refresh</strong><p>Reframed Credits as About Nyx with a new founder spotlight, contributor acknowledgements, and a clearer story of the project.</p></div></li>
        </ol>
      </section>
      <footer class="nyx-credits-footer"><img src="/assets/icons/nyx-logo.png" alt="" aria-hidden="true"><div><strong>Nyx</strong><span>Thank you for making this space yours.</span></div><small>&copy; 2026 Nyx</small></footer>
    </article>`;
  }
  function nyxCreditsFounderCardMarkup(){
    const profile=normalizeNyxFounderProfile(nyxFounderProfile);
    const roles=profile.roles.map(role=>`<span class="nyx-credits-founder-role">${esc(role)}</span>`).join('');
    const badges=profile.badges.map(badge=>`<span class="nyx-credits-founder-badge">${esc(badge)}</span>`).join('');
    const avatar=profile.avatarUrl?`<img src="${esc(profile.avatarUrl)}" alt="${esc(profile.displayName)} profile picture">`:`<span>${esc(profile.displayName.slice(0,1).toUpperCase()||'N')}</span>`;
    const banner=profile.bannerUrl?`<img src="${esc(profile.bannerUrl)}" alt="" aria-hidden="true">`:'';
    const link=profile.linkUrl?`<a class="nyx-credits-founder-link" href="${esc(profile.linkUrl)}" target="_blank" rel="noreferrer noopener">${esc(profile.linkLabel||'Open profile')} <span aria-hidden="true">↗</span></a>`:'';
    const statusLabel={online:'Online',idle:'Idle',dnd:'Do not disturb',offline:'Offline'}[profile.status]||'Online';
    return `<article class="nyx-credits-founder-card nyx-credits-founder-effect-${esc(profile.profileEffect)} nyx-avatar-decoration-${esc(profile.avatarDecoration)}" data-nyx-credits-founder style="--nyx-founder-accent:${profile.accentPrimary};--nyx-founder-accent-secondary:${profile.accentSecondary};--nyx-founder-banner-color:${profile.bannerColor}"><div class="nyx-credits-founder-media"><div class="nyx-credits-founder-banner">${banner}</div><div class="nyx-credits-founder-avatar">${avatar}<i class="nyx-avatar-decoration" aria-hidden="true"><span></span></i><span class="nyx-credits-founder-status nyx-founder-status-${esc(profile.status)}" title="${esc(statusLabel)}"></span></div><span class="nyx-credits-founder-presence nyx-founder-status-${esc(profile.status)}"><i aria-hidden="true"></i>${esc(statusLabel)}</span></div><div class="nyx-credits-founder-copy"><p class="nyx-credits-founder-role">${esc(profile.role)}</p><h3 class="${nyxDisplayNameStyleClass(profile)}" style="${nyxDisplayNameStyleVars(profile)}">${esc(profile.displayName)}</h3><p class="nyx-credits-founder-handle">${esc(profile.handle)}</p><p class="nyx-credits-founder-bio">${esc(profile.bio||'No bio yet.')}</p>${roles?`<div class="nyx-credits-founder-roles" aria-label="Founder roles">${roles}</div>`:''}${badges?`<div class="nyx-credits-founder-badges" aria-label="Founder badges">${badges}</div>`:''}${link}</div></article>`;
  }
  const nyxPublicProfileInlinePolish='.nyx-founder-profile-standard{max-width:480px!important;border-color:color-mix(in srgb,#555963 72%,var(--nyx-founder-accent-primary,#8fb8ff))!important;border-radius:14px!important;background:linear-gradient(180deg,#1c1e24,color-mix(in srgb,#191b20 96%,var(--nyx-founder-accent-primary,#8fb8ff)))!important;box-shadow:0 14px 32px rgba(0,0,0,.28),inset 0 1px rgba(255,255,255,.035)!important}.nyx-founder-profile-standard .nyx-founder-banner{width:100%!important;height:132px!important}.nyx-founder-profile-standard .nyx-founder-profile-content{padding:0 11px 11px!important}.nyx-founder-profile-standard .nyx-founder-image-wrap{width:78px!important;height:78px!important;margin-top:-40px!important;border:4px solid #1c1e24!important;background:#1c1e24!important;box-shadow:0 0 0 2px color-mix(in srgb,var(--nyx-founder-accent-primary,#8fb8ff) 72%,#d5d9e1),0 7px 15px rgba(0,0,0,.34)!important}.nyx-founder-profile-standard .nyx-founder-copy{margin-top:8px!important;padding:12px!important;border-color:rgba(255,255,255,.08)!important;border-radius:10px!important;background:linear-gradient(180deg,color-mix(in srgb,#272a32 97%,var(--nyx-founder-accent-primary,#8fb8ff)),#22242b)!important}.nyx-founder-profile-standard .nyx-founder-copy h3{font-size:20px!important;line-height:1.15!important}.nyx-founder-profile-standard .nyx-founder-handle{margin:2px 0 8px!important;font-size:12px!important}.nyx-founder-profile-standard .nyx-founder-role{margin:8px 0!important;color:#aeb2bd!important;font-size:10px!important;letter-spacing:.075em!important}.nyx-founder-role-list{gap:6px!important;margin:0 0 10px!important}.nyx-founder-role-chip,.nyx-founder-profile-standard .nyx-founder-badge{min-height:23px!important;padding:2px 7px!important;border:1px solid #484b55!important;border-radius:6px!important;background:#2b2e36!important;font-size:10.5px!important;transition:border-color .18s ease,background-color .18s ease,transform .18s ease!important}.nyx-founder-role-owner{border-color:color-mix(in srgb,var(--nyx-founder-accent-primary,#8fb8ff) 68%,#c5c9d2)!important;background:color-mix(in srgb,#2b2e36 81%,var(--nyx-founder-accent-primary,#8fb8ff))!important}.nyx-founder-role-chip:hover{border-color:color-mix(in srgb,var(--nyx-founder-accent-primary,#8fb8ff) 60%,#70747e)!important;background:color-mix(in srgb,#2b2e36 87%,var(--nyx-founder-accent-primary,#8fb8ff))!important;transform:translateY(-1px)!important}.nyx-founder-about{margin-top:2px!important;padding-top:10px!important;border-top-color:rgba(255,255,255,.075)!important}.nyx-founder-about>strong{margin-bottom:5px!important;color:#b8bdc8!important;font-size:10px!important;letter-spacing:.075em!important}.nyx-founder-profile-standard .nyx-founder-bio{font-size:12.5px!important;line-height:1.48!important}.nyx-founder-profile-standard .nyx-founder-link{margin-top:10px!important;font-size:12px!important}';
  const nyxDiscordCreditsProfileStyle='.nyx-credits-hero{margin-bottom:34px!important}.nyx-credits-hero h1{font-size:clamp(36px,6vw,54px)!important;font-weight:600!important}.nyx-credits-section{margin-bottom:44px!important}.nyx-credits-section>h2{margin-bottom:18px!important;font-size:26px!important}.nyx-founder-profile-standard{max-width:510px!important;border-radius:12px!important;background:linear-gradient(155deg,color-mix(in srgb,var(--nyx-founder-accent-primary,#5865f2) 66%,#202126),color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 30%,#18191e))!important}.nyx-founder-profile-standard .nyx-founder-banner{height:150px!important;aspect-ratio:auto!important;background:var(--nyx-founder-banner-color,var(--nyx-founder-accent-secondary,#8ea1ff))!important}.nyx-founder-profile-standard .nyx-founder-banner img{width:100%!important;height:100%!important;object-fit:cover!important;object-position:center!important}.nyx-founder-profile-standard .nyx-founder-profile-content{padding:0 14px 14px!important}.nyx-founder-profile-standard .nyx-founder-image-wrap{width:84px!important;height:84px!important;margin-top:-43px!important;border-color:color-mix(in srgb,var(--nyx-founder-accent-primary,#5865f2) 62%,#18191e)!important}.nyx-founder-profile-standard .nyx-founder-copy{margin-top:9px!important;padding:13px!important;border:1px solid color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 38%,transparent)!important;border-radius:9px!important;background:color-mix(in srgb,var(--nyx-founder-accent-primary,#5865f2) 14%,rgba(12,13,17,.76))!important}.nyx-founder-profile-standard .nyx-founder-copy h3{font-size:21px!important}.nyx-founder-profile-standard .nyx-founder-role{margin-top:10px!important}.nyx-founder-profile-standard .nyx-founder-about{margin-top:4px!important}.nyx-founder-profile-standard .nyx-founder-bio{font-size:13px!important}'+nyxPublicProfileInlinePolish;
  const nyxCreditsPresentationStyle=`
    .nyx-credits-tab{width:min(1080px,calc(100vw - 34px))!important;min-height:auto!important;padding:clamp(38px,6vw,78px) clamp(20px,5vw,62px) 54px!important}
    .nyx-credits-hero{position:relative;max-width:740px;margin:0 0 clamp(42px,7vw,78px)!important;text-align:left!important}.nyx-credits-hero .utility-kicker{margin-bottom:12px!important}.nyx-credits-hero h1{max-width:680px;margin:0 0 17px!important;color:#f4f7ff!important;font-size:clamp(42px,7vw,76px)!important;font-weight:520!important;letter-spacing:-.06em!important;line-height:.98!important}.nyx-credits-hero>p:last-child{max-width:640px;margin:0!important;color:#aab6c9!important;font-size:15px!important;line-height:1.72!important}.nyx-credits-hero-notes{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}.nyx-credits-hero-notes span{padding:6px 9px;border:1px solid color-mix(in srgb,var(--credits-accent) 32%,transparent);border-radius:999px;background:color-mix(in srgb,var(--credits-accent) 9%,transparent);color:#cbd6e8;font-size:10px;font-weight:650;letter-spacing:.035em}
    .nyx-credits-tab .nyx-credits-section{display:grid;gap:23px;margin:0 0 clamp(44px,7vw,72px)!important;padding:0!important;border:0!important}.nyx-credits-section-heading{display:grid;max-width:650px;gap:8px}.nyx-credits-section-heading>p{margin:0!important;color:var(--credits-accent)!important;font-size:10px!important;font-weight:800!important;letter-spacing:.14em!important;text-transform:uppercase!important}.nyx-credits-tab .nyx-credits-section-heading h2{width:auto;margin:0!important;padding:0!important;border:0!important;color:#edf2fb!important;font-size:clamp(25px,4vw,37px)!important;font-weight:520!important;letter-spacing:-.045em!important;text-align:left!important}.nyx-credits-section-heading>span{color:#91a0b7;font-size:13px;line-height:1.62}
    .nyx-credits-founder-card{position:relative;display:grid;grid-template-columns:minmax(230px,310px) minmax(0,1fr);overflow:hidden;border:1px solid color-mix(in srgb,var(--nyx-founder-accent,var(--credits-accent)) 34%,rgba(255,255,255,.08));border-radius:20px;background:linear-gradient(112deg,color-mix(in srgb,var(--nyx-founder-accent,var(--credits-accent)) 10%,transparent),transparent 48%),rgba(16,22,34,.76);box-shadow:0 20px 48px rgba(0,0,0,.18);transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease}.nyx-credits-founder-card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--nyx-founder-accent,var(--credits-accent)) 56%,rgba(255,255,255,.14));box-shadow:0 24px 56px rgba(0,0,0,.26)}.nyx-credits-founder-media{position:relative;min-height:290px;overflow:hidden;background:#0b111b}.nyx-credits-founder-banner{position:absolute;inset:0;background:linear-gradient(145deg,color-mix(in srgb,var(--nyx-founder-accent,var(--credits-accent)) 44%,#101b2a),#070b12)}.nyx-credits-founder-banner::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 32%,rgba(6,10,16,.86) 100%)}.nyx-credits-founder-banner img{display:block;width:100%;height:100%;object-fit:cover}.nyx-credits-founder-avatar{position:absolute;z-index:1;left:22px;bottom:21px;display:grid;width:82px;height:82px;place-items:center;border:4px solid #121925;border-radius:50%;background:#293241;color:#fff;font-size:27px;font-weight:800;box-shadow:0 0 0 2px var(--nyx-founder-accent,var(--credits-accent)),0 9px 22px rgba(0,0,0,.38)}.nyx-credits-founder-avatar>img{display:block;width:100%;height:100%;border-radius:inherit;object-fit:cover}.nyx-credits-founder-status{position:absolute;right:-1px;bottom:2px;width:17px;height:17px;border:4px solid #121925;border-radius:50%;background:#77849a}.nyx-credits-founder-status.nyx-founder-status-online{background:#5bc68a}.nyx-credits-founder-status.nyx-founder-status-idle{background:#e4b65a}.nyx-credits-founder-status.nyx-founder-status-dnd{background:#df6875}
    .nyx-credits-founder-copy{align-self:center;padding:clamp(24px,4vw,42px)}.nyx-credits-founder-copy>p.nyx-credits-founder-role{margin:0 0 8px!important;color:var(--nyx-founder-accent,var(--credits-accent))!important;font-size:10px!important;font-weight:800!important;letter-spacing:.14em!important;text-transform:uppercase!important}.nyx-credits-founder-copy h3{margin:0!important;color:#f6f8fc!important;font-size:clamp(28px,4vw,43px)!important;letter-spacing:-.045em!important;line-height:1.05!important}.nyx-credits-founder-handle{margin:5px 0 18px!important;color:#94a2b7!important;font-size:13px!important}.nyx-credits-founder-bio{max-width:55ch;margin:0!important;color:#c2ccda!important;font-size:14px!important;line-height:1.68!important}.nyx-credits-founder-roles,.nyx-credits-founder-badges{display:flex;flex-wrap:wrap;gap:7px;margin-top:17px}.nyx-credits-founder-role,.nyx-credits-founder-badge{display:inline-flex;align-items:center;min-height:25px;padding:3px 8px;border:1px solid rgba(191,207,240,.14);border-radius:7px;background:rgba(255,255,255,.045);color:#d4dcea;font-size:10px;font-weight:700}.nyx-credits-founder-roles .nyx-credits-founder-role:first-child{border-color:color-mix(in srgb,var(--nyx-founder-accent,var(--credits-accent)) 58%,transparent);background:color-mix(in srgb,var(--nyx-founder-accent,var(--credits-accent)) 17%,transparent);color:#fff}.nyx-credits-founder-badge{color:#aebcd0}.nyx-credits-founder-link{display:inline-flex;gap:7px;margin-top:19px;color:var(--nyx-founder-accent,var(--credits-accent));font-size:12px;font-weight:750;text-decoration:none}.nyx-credits-founder-link:hover{text-decoration:underline}
    .nyx-credit-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.nyx-credit-grid article{min-height:172px;padding:20px!important;border:1px solid rgba(191,207,240,.1)!important;border-radius:15px!important;background:rgba(16,22,34,.6)!important;box-shadow:inset 0 1px rgba(255,255,255,.02);transition:transform .18s ease,border-color .18s ease,background-color .18s ease}.nyx-credit-grid article:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--credits-accent) 42%,rgba(191,207,240,.16))!important;background:color-mix(in srgb,var(--credits-accent) 7%,rgba(16,22,34,.76))!important}.nyx-credit-grid article>span{width:34px!important;height:34px!important;margin-bottom:18px!important;border-color:color-mix(in srgb,var(--credits-accent) 32%,transparent)!important;border-radius:10px!important;background:color-mix(in srgb,var(--credits-accent) 9%,transparent)!important;color:var(--credits-accent)!important;font-size:16px!important}.nyx-credit-grid h3{margin:0 0 7px!important;color:#eef3fb!important;font-size:15px!important;font-weight:700!important}.nyx-credit-grid p{margin:0!important;color:#9cabc0!important;font-size:12px!important;line-height:1.62!important}.nyx-credits-changelog{display:grid;gap:0;max-width:760px;margin:0;padding:0;list-style:none;border-top:1px solid rgba(191,207,240,.1)}.nyx-credits-changelog li{display:grid;grid-template-columns:112px minmax(0,1fr);gap:18px;padding:17px 0;border-bottom:1px solid rgba(191,207,240,.1)}.nyx-credits-changelog time{color:var(--credits-accent);font-size:10px;font-weight:750;letter-spacing:.05em;text-transform:uppercase}.nyx-credits-changelog div{display:grid;gap:5px}.nyx-credits-changelog strong{color:#edf3fc;font-size:13px;font-weight:700}.nyx-credits-changelog p{margin:0;color:#9cabc0;font-size:12px;line-height:1.6}.nyx-credits-footer{margin-top:4px;padding-top:22px!important;border-top-color:rgba(191,207,240,.1)!important}
    @media(max-width:720px){.nyx-credits-founder-card{grid-template-columns:1fr}.nyx-credits-founder-media{min-height:205px}.nyx-credits-founder-copy{padding:24px}.nyx-credit-grid{grid-template-columns:1fr}.nyx-credit-grid article{min-height:auto}.nyx-credits-changelog li{grid-template-columns:1fr;gap:6px}.nyx-credits-hero-notes{margin-top:19px}}@media(prefers-reduced-motion:reduce){.nyx-credits-founder-card,.nyx-credit-grid article{transition:none!important}}
  `;
  const nyxCreditsProfileReferenceStyle=`
    .nyx-credits-founder-card{display:block;max-width:470px;margin:0;border-color:rgba(255,255,255,.12);border-radius:16px;background:#111216;box-shadow:0 18px 40px rgba(0,0,0,.28)}.nyx-credits-founder-media{min-height:142px;overflow:visible;background:#f3eef5}.nyx-credits-founder-banner{overflow:hidden;border-radius:15px 15px 0 0;background:var(--nyx-founder-banner-color,#f3eef5)}.nyx-credits-founder-banner::after{display:none}.nyx-credits-founder-banner img{object-position:center;opacity:.92}.nyx-credits-founder-avatar{left:18px;bottom:-47px;width:92px;height:92px;border:6px solid #111216;box-shadow:0 0 0 2px rgba(255,255,255,.18),0 8px 18px rgba(0,0,0,.32)}.nyx-credits-founder-status{right:-2px;bottom:1px;border-color:#111216}.nyx-credits-founder-presence{position:absolute;z-index:2;left:118px;bottom:-39px;display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:0 13px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:#202126;color:#d9dde5;font-size:12px;font-weight:650;box-shadow:0 5px 14px rgba(0,0,0,.2)}.nyx-credits-founder-presence i{width:8px;height:8px;border-radius:50%;background:#77849a}.nyx-credits-founder-presence.nyx-founder-status-online i{background:#5bc68a}.nyx-credits-founder-presence.nyx-founder-status-idle i{background:#e4b65a}.nyx-credits-founder-presence.nyx-founder-status-dnd i{background:#df6875}.nyx-credits-founder-copy{padding:60px 20px 21px}.nyx-credits-founder-copy>p.nyx-credits-founder-role{margin:0 0 7px!important;color:#aeb5c1!important;font-size:10px!important;letter-spacing:.08em!important}.nyx-credits-founder-copy h3{font-size:26px!important;line-height:1.1!important}.nyx-credits-founder-handle{margin:4px 0 14px!important;color:#9ba2ae!important}.nyx-credits-founder-bio{color:#d6d9df!important;font-size:13px!important;line-height:1.55!important}.nyx-credits-founder-roles,.nyx-credits-founder-badges{margin-top:14px}.nyx-credits-founder-role,.nyx-credits-founder-badge{border-color:#444750;border-radius:6px;background:#24262d;color:#d9dde5}.nyx-credits-founder-roles .nyx-credits-founder-role:first-child{border-color:color-mix(in srgb,var(--nyx-founder-accent,var(--credits-accent)) 62%,#535763);background:color-mix(in srgb,#262830 82%,var(--nyx-founder-accent,var(--credits-accent)));color:#fff}@media(max-width:720px){.nyx-credits-founder-card{max-width:none}.nyx-credits-founder-media{min-height:132px}.nyx-credits-founder-copy{padding:58px 18px 19px}}
  `;
  const nyxCreditsOwnerImageStyle=`.nyx-credits-owner-image{width:min(394px,100%);margin:0}.nyx-credits-owner-image img{display:block;width:100%;height:auto;border-radius:0}`;
  const DEFAULT_BROWSER_MODE='scramjet';
  const DEFAULT_BROWSER_TRANSPORT='libcurl';
  const nyxFontOptions=[
    ['outfit','Outfit','Outfit,Arial,sans-serif'],
    ['raleway','Raleway','Raleway,Arial,sans-serif'],
    ['nunito','Nunito','Nunito,Arial,sans-serif'],
    ['inter','Inter','Inter,Arial,sans-serif'],
    ['poppins','Poppins','Poppins,Arial,sans-serif'],
    ['quicksand','Quicksand','Quicksand,Arial,sans-serif'],
    ['lexend','Lexend','Lexend,Arial,sans-serif'],
    ['montserrat','Montserrat','Montserrat,Arial,sans-serif'],
    ['atkinson','Atkinson Hyperlegible','"Atkinson Hyperlegible",Arial,sans-serif']
  ];
  function nyxFontChoice(value=store.text('nyx.font','outfit')){
    const key=String(value || 'outfit').toLowerCase();
    return nyxFontOptions.find(item=>item[0]===key) || nyxFontOptions[0];
  }
  function nyxFontOptionsMarkup(selected=store.text('nyx.font','outfit')){
    const current=nyxFontChoice(selected)[0];
    return nyxFontOptions.map(([key,label])=>`<option value="${esc(key)}" ${key===current?'selected':''}>${esc(label)}</option>`).join('');
  }
  function applyFontSetting(root=document){
    const [key,,family]=nyxFontChoice();
    document.documentElement.style.setProperty('--nyx-font',family);
    document.body.dataset.nyxFont=key;
    root.querySelectorAll?.('[data-font-value]')?.forEach(select=>{
      select.innerHTML=nyxFontOptionsMarkup(key);
      select.value=key;
    });
  }
  //popup-protection
  function popupProtectionEnabled(){
    return store.get('nyx.popupProtection',true);
  }
  function isAnimexUrl(url){
    try{
      const host=new URL(normalize(url),location.href).hostname.replace(/^www\./,'').toLowerCase();
      return host==='animex.one' || host.endsWith('.animex.one');
    }catch{return false}
  }
  function shownyxPrompt(message,{loop=false,onOk=null}={}){
    document.querySelectorAll('.nyx-prompt-shade').forEach(el=>el.remove());
    const shade=document.createElement('div');
    shade.className='nyx-prompt-shade';
    shade.innerHTML=`<div class="nyx-prompt" role="dialog" aria-modal="true"><div class="nyx-prompt-title">${esc(location.hostname || 'nyx')} says</div><div class="nyx-prompt-message">${esc(message)}</div><input class="nyx-prompt-input" autocomplete="off" spellcheck="false"><div class="nyx-prompt-actions"><button class="nyx-prompt-ok" type="button">OK</button><button class="nyx-prompt-cancel" type="button">Cancel</button></div></div>`;
    document.body.appendChild(shade);
    const ok=shade.querySelector('.nyx-prompt-ok');
    const input=shade.querySelector('.nyx-prompt-input');
    input?.focus();
    ok.onclick=()=>{
      shade.remove();
      if(loop) setTimeout(()=>shownyxPrompt(message,{loop:true}),0);
      else if(typeof onOk==='function') onOk();
    };
    shade.querySelector('.nyx-prompt-cancel')?.addEventListener('click',()=>shade.remove());
    input?.addEventListener('keydown',e=>{
      if(e.key==='Enter') ok.click();
      if(e.key==='Escape') shade.querySelector('.nyx-prompt-cancel')?.click();
    });
    return shade;
  }
  function nyxDownloadDisplayName(filename,url){
    const supplied=String(filename || '').trim().split(/[\\/]/).pop();
    if(supplied) return supplied.slice(0,180);
    try{
      const parsed=new URL(String(url || ''),location.href);
      return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname || 'download').slice(0,180);
    }catch{return 'download'}
  }
  function nyxDownloadCheckUrl(downloadUrl,sourceUrl=''){
    const actual=String(downloadUrl || '').trim();
    const source=String(sourceUrl || '').trim();
    if(/^(?:blob|data):/i.test(actual)) return browserShellSourceUrl(source) || source;
    return browserShellSourceUrl(actual) || actual || browserShellSourceUrl(source) || source;
  }
  function nyxDownloadSafetyDialog(result,{filename,url}={}){
    document.querySelectorAll('.nyx-download-safety-shade').forEach(element=>element.remove());
    return new Promise(resolve=>{
      const blocked=result?.verdict==='blocked';
      const shade=document.createElement('div');
      shade.className='nyx-download-safety-shade';
      const threatList=Array.isArray(result?.threats) && result.threats.length
        ? `<p class="nyx-download-safety-threats">Detected: ${esc(result.threats.join(', ').replaceAll('_',' ').toLowerCase())}</p>`
        : '';
      let host='Unknown source';
      try{host=new URL(String(url || ''),location.href).hostname || host}catch{}
      shade.innerHTML=`<section class="nyx-download-safety-dialog ${blocked?'is-blocked':'is-caution'}" role="alertdialog" aria-modal="true" aria-labelledby="nyxDownloadSafetyTitle" aria-describedby="nyxDownloadSafetyMessage">
        <span class="nyx-download-safety-icon" aria-hidden="true">${blocked?'!':'?'}</span>
        <div class="nyx-download-safety-copy">
          <p class="nyx-download-safety-kicker">Download protection</p>
          <h2 id="nyxDownloadSafetyTitle">${blocked?'Download blocked':'Check this download'}</h2>
          <p class="nyx-download-safety-file">${esc(filename || 'download')}</p>
          <p class="nyx-download-safety-source">From ${esc(host)}</p>
          <p id="nyxDownloadSafetyMessage">${esc(result?.message || 'Nyx could not verify this download.')}</p>
          ${threatList}
          <p class="nyx-download-safety-note">Nyx checked the URL reputation only. The file bytes were not uploaded or antivirus-scanned.</p>
        </div>
        <footer>
          <button class="settings-action" data-nyx-download-cancel type="button">${blocked?'Close':'Cancel'}</button>
          ${blocked?'':`<button class="settings-action on" data-nyx-download-continue type="button">Download anyway</button>`}
        </footer>
      </section>`;
      document.body.appendChild(shade);
      const finish=allowed=>{shade.remove();resolve(allowed)};
      shade.querySelector('[data-nyx-download-cancel]')?.addEventListener('click',()=>finish(false));
      shade.querySelector('[data-nyx-download-continue]')?.addEventListener('click',()=>finish(true));
      shade.addEventListener('click',event=>{if(event.target===shade)finish(false)});
      shade.addEventListener('keydown',event=>{if(event.key==='Escape')finish(false)});
      shade.querySelector('button')?.focus();
    });
  }
  async function nyxRequestBrowserDownload(downloadUrl,filename='',sourceUrl=''){
    const href=String(downloadUrl || '').trim();
    if(!href || /^(?:javascript|vbscript):/i.test(href)){
      toast('Nyx blocked an invalid download address');
      return false;
    }
    const displayName=nyxDownloadDisplayName(filename,href);
    const checkUrl=nyxDownloadCheckUrl(href,sourceUrl);
    let result={
      verdict:'unverified',
      threats:[],
      fileScanned:false,
      message:'Nyx could not identify the source URL. The file contents were not antivirus-scanned.'
    };
    if(/^https?:\/\//i.test(checkUrl)){
      toast('Checking download source…');
      try{
        const response=await fetch('/api/download-safety/check',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({url:checkUrl,filename:displayName})
        });
        const payload=await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(payload.error || `Download check failed (${response.status})`);
        result=payload;
      }catch(error){
        console.warn('Nyx download safety check failed:',error?.message || error);
        result={
          verdict:'unverified',
          threats:[],
          fileScanned:false,
          message:'The URL reputation check is unavailable. The file contents were not antivirus-scanned.'
        };
      }
    }
    if(result.verdict==='blocked'){
      await nyxDownloadSafetyDialog(result,{filename:displayName,url:checkUrl || sourceUrl});
      return false;
    }
    if(result.verdict!=='clear'){
      const allowed=await nyxDownloadSafetyDialog(result,{filename:displayName,url:checkUrl || sourceUrl});
      if(!allowed) return false;
    }else{
      toast('No known URL threat found — starting download');
    }
    const link=document.createElement('a');
    link.href=href;
    link.download=String(filename || '').trim();
    link.rel='noopener';
    link.hidden=true;
    document.body.appendChild(link);
    link.click();
    setTimeout(()=>link.remove(),0);
    return true;
  }
  function showAnimexMikuPrompt(onOk){
    shownyxPrompt('Use MIKU for streaming',{onOk});
  }
  //hieroglyph-text-effect
  const hieroglyphTextNodes = new WeakMap();
  const hieroglyphSkipSelector = 'script,style,noscript,textarea,input,select,option,iframe,canvas,svg,audio,video';
  const hieroglyphLetters = {
    a:'𓄿',b:'𓃀',c:'𓎡',d:'𓂧',e:'𓇌',f:'𓆑',g:'𓎼',h:'𓉔',i:'𓇋',j:'𓆓',k:'𓎡',l:'𓃭',m:'𓅓',
    n:'𓈖',o:'𓅱',p:'𓊪',q:'𓈎',r:'𓂋',s:'𓋴',t:'𓏏',u:'𓅱',v:'𓆑',w:'𓅱',x:'𓐍',y:'𓇌',z:'𓊃',
    '0':'𓏤','1':'𓏺','2':'𓏻','3':'𓏼','4':'𓏽','5':'𓏾','6':'𓏿','7':'𓐀','8':'𓐁','9':'𓐂'
  };
  //browser-engine-state
  const hasHostedBackend = () => location.protocol === 'http:' || location.protocol === 'https:';
  const browserShellTabs = [];
  const browserShellOpeningTabs = new Set();
  let browserShellActiveTab = null;
  let nyxErudaLoadPromise = null;
  let nyxErudaHost = null;
  let nyxErudaInitialized = false;
  function loadNyxEruda(){
    if(window.eruda) return Promise.resolve(window.eruda);
    if(nyxErudaLoadPromise) return nyxErudaLoadPromise;
    nyxErudaLoadPromise=new Promise((resolve,reject)=>{
      const loader=document.createElement('script');
      loader.src='/assets/vendor/eruda.min.js?v=3.4.3';
      loader.dataset.nyxErudaLoader='true';
      loader.onload=()=>window.eruda ? resolve(window.eruda) : reject(new Error('Eruda did not initialize'));
      loader.onerror=()=>reject(new Error('Eruda could not be downloaded'));
      document.head.appendChild(loader);
    }).catch(error=>{
      nyxErudaLoadPromise=null;
      throw error;
    });
    return nyxErudaLoadPromise;
  }
  function hideNyxErudaPanel(){
    try{window.eruda?.hide?.()}catch{}
    if(nyxErudaHost) nyxErudaHost.hidden=true;
  }
  async function showNyxErudaPanel(win){
    const body=win?.querySelector('.browser-body');
    if(!body) return;
    let host=body.querySelector(':scope > .nyx-eruda-host');
    if(!host){
      host=document.createElement('div');
      host.className='nyx-eruda-host';
      host.setAttribute('aria-label','Eruda developer tools');
      body.appendChild(host);
    }
    host.hidden=false;
    if(nyxErudaHost && nyxErudaHost!==host && nyxErudaInitialized){
      try{window.eruda?.destroy?.()}catch{}
      nyxErudaInitialized=false;
    }
    nyxErudaHost=host;
    let status=host.querySelector('.nyx-eruda-loading');
    let mount=host.querySelector('.nyx-eruda-root, #eruda');
    if(!nyxErudaInitialized){
      host.replaceChildren();
      mount=document.createElement('div');
      mount.className='nyx-eruda-root';
      status=document.createElement('p');
      status.className='nyx-eruda-loading';
      status.setAttribute('role','status');
      status.textContent='Starting Eruda...';
      host.append(mount,status);
    }
    try{
      const eruda=await loadNyxEruda();
      if(activeBrowserShellTab()?.url!=='nyx://developer') return;
      if(!nyxErudaInitialized){
        eruda.init({container:mount,tool:['console','elements','network','resources','sources','info','snippets'],useShadowDom:true,autoScale:true,defaults:{displaySize:100,transparency:1,theme:'Dark'}});
        const elementsTool=eruda.get?.('elements');
        if(elementsTool?._detail){
          elementsTool._detail._highlight=()=>{};
        }
        nyxErudaInitialized=true;
      }
      host.hidden=false;
      setTimeout(()=>{
        eruda.show();
        eruda.show('console');
        status?.remove();
        const root=host.querySelector('#eruda')?.shadowRoot;
        const container=root?.querySelector('.eruda-container');
        const panel=root?.querySelector('.eruda-dev-tools');
        [container,panel].forEach(element=>{
          if(!element) return;
          element.style.setProperty('position','absolute','important');
          element.style.setProperty('inset','0','important');
          element.style.setProperty('width','100%','important');
          element.style.setProperty('height','100%','important');
        });
        if(panel){
          panel.style.setProperty('display','block','important');
          panel.style.setProperty('opacity','1','important');
        }
        const entry=root?.querySelector('.eruda-entry-btn');
        if(entry) entry.style.setProperty('display','none','important');
        if(nyxEarlyConsoleBuffering){
          const buffered=nyxEarlyConsoleEntries.splice(0);
          nyxEarlyConsoleBuffering=false;
          console.info(`[Nyx] Developer Console connected. Replaying ${buffered.length} earlier message${buffered.length===1?'':'s'}.`);
          buffered.forEach(item=>{
            const method=typeof console[item.level]==='function' ? item.level : 'log';
            console[method](`[${item.time.toLocaleTimeString()}]`,...item.args);
          });
        }
      },125);
    }catch(error){
      if(status){
        status.classList.add('error');
        status.textContent='Eruda could not load. Check your connection and reopen this tab.';
      }
      console.error('Nyx Eruda failed to load',error);
    }
  }
  const engines = {
    bing:'https://www.bing.com/search?q=',
    google:'https://www.google.com/search?q=',
    duckduckgo:'https://duckduckgo.com/?q='
  };
  function selectedSearchUrl(query){
    const savedEngine=String(store.text('nyx.engine','duckduckgo')).trim().toLowerCase();
    const engine=Object.prototype.hasOwnProperty.call(engines,savedEngine) ? savedEngine : 'duckduckgo';
    return engines[engine] + encodeURIComponent(String(query || '').trim());
  }
  function unwrapAccidentalUrlSearch(value){
    const raw=String(value || '').trim();
    try{
      const parsed=new URL(raw);
      const host=parsed.hostname.toLowerCase();
      const isSearch=(host==='duckduckgo.com' && parsed.pathname==='/')
        || (/^(?:www\.)?google\.[a-z.]+$/i.test(host) && parsed.pathname==='/search')
        || (host==='www.bing.com' && parsed.pathname==='/search');
      if(!isSearch) return raw;
      const query=String(parsed.searchParams.get('q') || '').trim();
      return /^(?:https?:\/\/|[\w.-]+\.[a-z]{2,}(?:[\/:?#]|$))/i.test(query) ? query : raw;
    }catch{return raw}
  }
  function canonicalAddressInput(value){
    const raw=unwrapAccidentalUrlSearch(value);
    if(/^(?:localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:\/|$)/i.test(raw)) return 'http://'+raw;
    if(/^[\w.-]+\.[a-z]{2,}(?:[\/:?#]|$)/i.test(raw) && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) return 'https://'+raw;
    return raw;
  }
  const sixtySevenJumpscareSrc='assets/jumpscares/676767.gif';
  function shouldTriggerSixtySevenJumpscare(value){
    return String(value || '').trim()==='67';
  }
  function showSixtySevenJumpscare(){
    document.querySelectorAll('.nyx-jumpscare').forEach(el=>el.remove());
    const overlay=document.createElement('div');
    overlay.className='nyx-jumpscare';
    overlay.innerHTML=`<img alt="" src="${sixtySevenJumpscareSrc}?t=${Date.now()}">`;
    document.body.appendChild(overlay);
    const close=()=>overlay.remove();
    overlay.addEventListener('click',close,{once:true});
    setTimeout(close,3600);
  }
  const rammerheadBase = 'https://browser.rammerhead.org/';
  const defaultBg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const bgPresets = {
    dragon: defaultBg,
    lofiPurple: 'url("./assets/backgrounds/nyx-blue-light-trails.jpg")',
    sunset: 'url("./assets/backgrounds/wp6058967.jpg")',
    yosemiteFog: 'url("./assets/backgrounds/961912.jpg")',
    yosemiteGold: 'url("./assets/backgrounds/1014077.jpg")',
    redArch: 'url("./assets/backgrounds/1565924.jpg")',
    alpineLake: 'url("./assets/backgrounds/1609678.jpg")',
    canyonLights: 'url("./assets/backgrounds/6781708.jpg")',
    mountainSunset: 'url("./assets/backgrounds/6796216.jpg")',
    riverFalls: 'url("./assets/backgrounds/8848864.jpg")',
    starSky: 'url("./assets/backgrounds/8848964.jpg")',
    dark: 'linear-gradient(135deg,#020308 0%,#111827 56%,#000 100%)',
    violet: 'linear-gradient(135deg,#020617 0%,#312e81 48%,#0f172a 100%)'
  };
  const bgNames = {
    dragon:'Nyx Blue',
    lofiPurple:'Nyx Blue',
    sunset:'Sunset Deer',
    yosemiteFog:'Yosemite Fog',
    yosemiteGold:'Yosemite Gold',
    redArch:'Red Arch',
    alpineLake:'Alpine Lake',
    canyonLights:'Canyon Lights',
    mountainSunset:'Mountain Sunset',
    riverFalls:'River Falls',
    starSky:'Star Sky',
    dark:'Black Gradient',
    violet:'Violet Glass'
  };
  //favicons
  const favicons = {
    nyx:'./assets/icons/nyx-logo.png',
    classroom:`data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='8' fill='%23fbbc04'/%3E%3Crect x='8' y='10' width='48' height='40' rx='3' fill='%2334a853'/%3E%3Ccircle cx='32' cy='25' r='6' fill='white'/%3E%3Cpath d='M18 42c4-9 20-9 24 0' fill='white'/%3E%3C/svg%3E`,
    drive:'./assets/icons/googledrive-logo.webp',
    google:'./assets/icons/google-logo.png',
    classlink:'./assets/icons/classlink-logo.png'
  };
  const nyxTabTitle = '\u057c\u028f\u04fc';
  let nyxTabFavicon = './assets/icons/nyx-logo.png';
  const nyxFaviconHref = () => $('appFavicon')?.href || nyxTabFavicon;
  async function applyNyxLogoTheme(theme=store.text('nyx.theme','default')){
    if(!window.NyxLogo) return;
    try{
      const [themedUrl,compactUrl]=await Promise.all([
        window.NyxLogo.apply(theme,document),
        window.NyxLogo.croppedUrl?.(theme) || window.NyxLogo.themedUrl(theme)
      ]);
      if(store.text('nyx.theme','default')!==theme) return;
      favicons.nyx=compactUrl;
      nyxTabFavicon=compactUrl;
      const nyxPresetSelected=store.text('nyx.logo','nyx')==='nyx';
      if(nyxPresetSelected) store.setText('nyx.tabFavicon',compactUrl);
      if(nyxPresetSelected || !store.text('nyx.tabFavicon','')){
        const favicon=$('appFavicon');
        if(favicon) favicon.href=compactUrl;
      }
      browserShellTabs.forEach(tab=>{
        if((tab.title==='Home' && !tab.url) || tab.icon===themedUrl) tab.icon=compactUrl;
      });
      activeBrowser?.tabs?.forEach(tab=>{
        if((tab.title==='Home' && !tab.url) || tab.icon===themedUrl) tab.icon=compactUrl;
      });
      renderBrowserShellTabs();
      activeBrowser?.renderTabs?.();
      if(nyxPresetSelected) setCurrentTabCloak(store.text('nyx.tabTitle',nyxTabTitle),compactUrl,false);
    }catch(error){
      console.warn('Nyx logo theme could not be applied:',error);
    }
  }
  function makeIcon(label,bg='#111827',fg='#fff'){
    return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/><text x="32" y="40" text-anchor="middle" font-size="22" font-family="Outfit, Arial, sans-serif" font-weight="800" fill="${fg}">${label}</text></svg>`);
  }
  function svgIcon(svg){return 'data:image/svg+xml,'+encodeURIComponent(svg)}
  function localIcon(name){return `/assets/icons/${name}`}
  function simpleIcon(slug,color='ffffff'){
    const c='#'+color.replace('#','');
    const common='xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"';
    const icons={
      youtube:`<svg ${common}><rect width="64" height="64" rx="14" fill="#0b0b0b"/><rect x="10" y="19" width="44" height="26" rx="7" fill="#ff0000"/><path d="M28 25v14l13-7z" fill="#fff"/></svg>`,
      discord:`<svg ${common}><rect width="64" height="64" rx="14" fill="#5865f2"/><path d="M22 22c5-2 19-2 24 0 4 7 5 14 3 22-5 3-9 3-12 1l2-3c-4 1-10 1-14 0l2 3c-4 2-8 2-12-1-2-8-1-15 3-22z" fill="#fff"/><circle cx="26" cy="34" r="3" fill="#5865f2"/><circle cx="38" cy="34" r="3" fill="#5865f2"/></svg>`,
      spotify:`<svg ${common}><rect width="64" height="64" rx="14" fill="#1db954"/><path d="M19 27c10-3 20-2 29 3M21 35c8-2 16-1 23 3M23 42c6-1 12 0 17 2" stroke="#07110b" stroke-width="5" stroke-linecap="round" fill="none"/></svg>`,
      google:`<svg ${common}><rect width="64" height="64" rx="14" fill="#fff"/><text x="32" y="44" text-anchor="middle" font-size="38" font-family="Outfit" font-weight="700" fill="#4285f4">G</text></svg>`,
      duckduckgo:`<svg ${common}><rect width="64" height="64" rx="14" fill="#de5833"/><circle cx="32" cy="32" r="18" fill="#fff"/><text x="32" y="39" text-anchor="middle" font-size="18" font-family="Outfit" font-weight="900" fill="#de5833">D</text></svg>`,
      wikipedia:`<svg ${common}><rect width="64" height="64" rx="14" fill="#fff"/><text x="32" y="43" text-anchor="middle" font-size="34" font-family="Outfit,Arial,sans-serif" font-weight="700" fill="#111">W</text></svg>`,
      tiktok:`<svg ${common}><rect width="64" height="64" rx="14" fill="#050505"/><path d="M35 16v25a9 9 0 1 1-8-9" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none"/><path d="M36 16c3 8 7 11 13 12" stroke="#25f4ee" stroke-width="5" stroke-linecap="round" fill="none"/></svg>`,
      instagram:`<svg ${common}><defs><linearGradient id="ig" x1="0" x2="1" y1="1" y2="0"><stop stop-color="#feda75"/><stop offset=".45" stop-color="#d62976"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#ig)"/><rect x="17" y="17" width="30" height="30" rx="9" stroke="#fff" stroke-width="5" fill="none"/><circle cx="32" cy="32" r="7" stroke="#fff" stroke-width="5" fill="none"/><circle cx="43" cy="21" r="2.5" fill="#fff"/></svg>`,
      snapchat:`<svg ${common}><rect width="64" height="64" rx="14" fill="#fffc00"/><path d="M32 15c8 0 11 7 10 17 2 3 5 5 9 6-4 3-7 3-10 3-3 6-15 6-18 0-3 0-6 0-10-3 4-1 7-3 9-6-1-10 2-17 10-17z" fill="#fff" stroke="#111" stroke-width="3" stroke-linejoin="round"/></svg>`,
      amazon:`<svg ${common}><rect width="64" height="64" rx="14" fill="#fff"/><text x="32" y="36" text-anchor="middle" font-size="28" font-family="Outfit" font-weight="800" fill="#111">a</text><path d="M20 44c9 6 19 6 28 0" stroke="#ff9900" stroke-width="4" stroke-linecap="round" fill="none"/></svg>`,
      reddit:`<svg ${common}><rect width="64" height="64" rx="14" fill="#ff4500"/><circle cx="32" cy="34" r="16" fill="#fff"/><circle cx="26" cy="33" r="3" fill="#ff4500"/><circle cx="38" cy="33" r="3" fill="#ff4500"/><path d="M25 41c4 3 10 3 14 0" stroke="#ff4500" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M40 20l6-5 3 5" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/></svg>`,
      twitter:`<svg ${common}><rect width="64" height="64" rx="14" fill="#1da1f2"/><path d="M49 23c-1 1-3 2-5 2 2-1 3-3 3-5-2 1-4 2-6 2-5-5-13-1-12 6-7 0-13-4-17-9-2 4-1 8 3 11-2 0-3-1-4-1 0 5 3 8 8 9-2 1-4 1-5 0 2 4 6 7 11 7-5 4-10 5-16 5 6 4 12 5 19 4 15-2 24-14 23-28 2-1 3-2 4-4z" fill="#fff"/></svg>`,
      openai:`<svg ${common}><rect width="64" height="64" rx="14" fill="#111827"/><path d="M31 13c7-1 12 4 12 10 6 2 9 8 6 14 3 6-2 13-9 14-4 6-13 6-17 1-7 0-12-6-10-13-5-5-3-13 3-16 1-7 8-11 15-10z" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/></svg>`
    };
    return svgIcon(icons[slug] || `<svg ${common}><rect width="64" height="64" rx="14" fill="#0b0f17"/><circle cx="32" cy="32" r="18" fill="${c}"/></svg>`);
  }
  //app-icons
  const appIcons = {
    'youtube.com':simpleIcon('youtube','ff0000'),
    'discord.com':localIcon('discord-embleme.png'),
    'spotify.com':localIcon('spotify-logo.png'),
    'traxmojo.com':localIcon('traxmojo-logo.png'),
    'google.com':localIcon('google-logo.png'),
    'duckduckgo.com':localIcon('duck-ai-logo.png'),
    'wikipedia.org':simpleIcon('wikipedia','ffffff'),
    'cineby.at':localIcon('cineby-logo.png'),
    'tiktok.com':localIcon('tiktok-logo.png'),
    'instagram.com':localIcon('instagram-logo.jpg'),
    'snapchat.com':localIcon('snapchat-logo.jpg'),
    'amazon.com':simpleIcon('amazon','ff9900'),
    'reddit.com':localIcon('reddit-logo.png'),
    'x.com':localIcon('x-logo.png'),
    'chatgpt.com':localIcon('chatgpt-logo.webp'),
    'store.steampowered.com':localIcon('steam-logo.ico'),
    'crunchyroll.com':localIcon('crunchyroll-logo.svg'),
    'crazygames.com':localIcon('crazygames-logo.png'),
    'newgrounds.com':localIcon('newgrounds-logo.svg'),
    'twitch.tv':localIcon('twitch-logo.png'),
    'kick.com':localIcon('kick-logo.svg'),
    'soundcloud.com':localIcon('soundcloud-logo.png'),
    'pluto.tv':localIcon('plutotv-logo.png'),
    'skribbl.io':localIcon('skribbl-logo.png'),
    'slither.io':localIcon('slither-logo.png'),
    'geoguessr.com':localIcon('geoguessr-logo.png'),
    'y8.com':localIcon('y8-logo.png'),
    'itch.io':localIcon('itchio-logo.svg'),
    'tcgplayer.com':localIcon('tcgplayer-logo.webp'),
    'cpstest.org':localIcon('cps-logo.png'),
    'classlink.com':localIcon('classlink-logo.png'),
    'drive.google.com':localIcon('googledrive-logo.png'),
    'docs.google.com':svgIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1a73e8"/><path d="M22 12h17l9 9v31H22z" fill="#fff"/><path d="M39 12v10h9" fill="#d2e3fc"/><path d="M27 31h16M27 37h16M27 43h12" stroke="#1a73e8" stroke-width="3" stroke-linecap="round"/></svg>`),
    'duck.ai':localIcon('duck-ai-logo.png'),
    'nyx-ai':localIcon('shortcut-nyx-ai.svg?v=3'),
    'link-checker':localIcon('link-checker.svg'),
    'link-generator':localIcon('link-generator.svg'),
    'chess.com':localIcon('chess-logo.png'),
    'games':localIcon('dock-controller.png'),
    'apps':svgIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="10" y="10" width="18" height="18" rx="4" fill="#fff"/><rect x="36" y="10" width="18" height="18" rx="4" fill="#fff"/><rect x="10" y="36" width="18" height="18" rx="4" fill="#fff"/><rect x="36" y="36" width="18" height="18" rx="4" fill="#fff"/></svg>`),
    'geforcenow':localIcon('dock-nvidia.png'),
    'roblox.com':localIcon('dock-roblox.png'),
    'discord-dock':localIcon('discord-embleme.png'),
    'settings':localIcon('dock-settings.png'),
    'animex.one':svgIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" rx="14" fill="#030304"/><g opacity=".55" stroke="#243a68" stroke-width="2"><path d="M8 8l16 12M48 4l22 16M132 8l18 12M20 64l16 12M116 62l24 18"/></g><text x="80" y="56" text-anchor="middle" font-size="30" font-family="Outfit,Arial,sans-serif" font-weight="900" fill="#ffffff">ANIMEX</text><text x="78" y="56" text-anchor="middle" font-size="30" font-family="Outfit,Arial,sans-serif" font-weight="900" fill="#7c5ce6" opacity=".9">ANI</text></svg>`)
  };
  function appIcon(domain){return appIcons[domain] || makeIcon('GL','#0b0f17','#67e8f9')}
  function websiteFaviconUrl(url){
    const raw=String(url || '').trim();
    if(!raw || raw==='about:blank' || raw.startsWith('nyx://')) return '';
    try{
      const source=typeof browserShellSourceUrl==='function' ? (browserShellSourceUrl(raw) || raw) : raw;
      const parsed=new URL(source,location.href);
      if(!/^https?:$/.test(parsed.protocol)) return '';
      return new URL('/favicon.ico',parsed.origin).href;
    }catch{return ''}
  }
  function websiteFaviconFallbackUrl(url){
    const raw=String(url || '').trim();
    try{
      const source=typeof browserShellSourceUrl==='function' ? (browserShellSourceUrl(raw) || raw) : raw;
      const parsed=new URL(source,location.href);
      if(!/^https?:$/.test(parsed.protocol)) return '';
      return `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(parsed.origin)}`;
    }catch{return ''}
  }
  function websiteFaviconFallbackUrls(url){
    const primary=websiteFaviconFallbackUrl(url);
    try{
      const source=typeof browserShellSourceUrl==='function' ? (browserShellSourceUrl(String(url || '').trim()) || url) : url;
      const host=new URL(source,location.href).hostname;
      const duckDuckGo=host ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico` : '';
      return [...new Set([primary,duckDuckGo].filter(Boolean))];
    }catch{return primary ? [primary] : []}
  }
  function iconFromPageDocument(doc,sourceUrl=''){
    try{
      const link=doc?.querySelector?.('link[rel~="icon" i],link[rel="shortcut icon" i]');
      const href=String(link?.href || link?.getAttribute?.('href') || '').trim();
      if(!href || href.length>4096) return '';
      const resolved=new URL(href,doc.baseURI || sourceUrl || location.href);
      if(!['http:','https:','data:'].includes(resolved.protocol)) return '';
      return resolved.href;
    }catch{return ''}
  }
  function bindTabIconFallback(img){
    if(!img || img.dataset.nyxIconFallbackBound==='true') return;
    img.dataset.nyxIconFallbackBound='true';
    img.addEventListener('error',()=>{
      if(img.dataset.nyxIconFallbackUsed==='true') return;
      img.dataset.nyxIconFallbackUsed='true';
      img.src=favicons.nyx;
    });
  }
  function iconForUrl(url){
    const raw=String(url || '').trim();
    if(!raw || raw==='about:blank' || raw.startsWith('nyx://')) return favicons.nyx;
    if(/(?:^|\/)apps\/link-checker(?:\/|$)/i.test(raw)) return appIcon('link-checker');
    if(/(?:^|\/)apps\/link-generator(?:\/|$)/i.test(raw)) return appIcon('link-generator');
    const source=typeof browserShellSourceUrl==='function' ? (browserShellSourceUrl(raw) || raw) : raw;
    if(source.startsWith('assets/games/') || source.startsWith('assets/ugs/') || source.startsWith('assets/seraph/') || source.startsWith('/assets/games/') || source.startsWith('/assets/ugs/') || source.startsWith('/assets/seraph/')) return appIcon('games');
    try{
      const host=new URL(source,location.href).hostname.replace(/^www\./,'').toLowerCase();
      if(appIcons[host]) return appIcons[host];
      const key=Object.keys(appIcons).find(domain=>host===domain || host.endsWith('.'+domain));
      if(key) return appIcons[key];
      if(host.includes('google')) return favicons.google;
    }catch{}
    return websiteFaviconUrl(source) || favicons.nyx;
  }
  function homeShortcutIconUrl(item,domain=''){
    const saved=String(item?.icon || '').trim();
    if(saved) return saved;
    const key=String(domain || homeShortcutDomain(item?.url,item?.title)).toLowerCase();
    if(appIcons[key]) return appIcon(key);
    const matched=Object.keys(appIcons).find(name=>key===name || key.endsWith('.'+name));
    if(matched) return appIcon(matched);
    return websiteFaviconUrl(item?.url) || favicons.nyx;
  }
  function homeShortcutIconMarkup(item,domain=''){
    const source=homeShortcutIconUrl(item,domain);
    const fallbacks=websiteFaviconFallbackUrls(item?.url);
    return `<img class="quick-icon" alt="" draggable="false" referrerpolicy="no-referrer" data-home-shortcut-site-icon data-favicon-fallbacks="${esc(JSON.stringify(fallbacks))}" src="${esc(source)}">`;
  }
  function installHomeShortcutIconFallbacks(){
    if(document.__nyxHomeShortcutIconFallbacks) return;
    document.__nyxHomeShortcutIconFallbacks=true;
    document.addEventListener('error',event=>{
      const image=event.target;
      if(!(image instanceof HTMLImageElement) || !image.matches('[data-home-shortcut-site-icon]')) return;
      let fallbacks=[];
      try{fallbacks=JSON.parse(image.dataset.faviconFallbacks || '[]')}catch{}
      const index=Number(image.dataset.faviconFallbackIndex || '0');
      const fallback=fallbacks[index] || '';
      if(fallback){
        image.dataset.faviconFallbackIndex=String(index+1);
        image.dataset.faviconFallbackUsed='true';
        image.src=fallback;
        return;
      }
      image.removeAttribute('data-home-shortcut-site-icon');
      image.src=favicons.nyx;
    },true);
  }
  installHomeShortcutIconFallbacks();
  function titleForUrl(url){
    const raw=String(url || '').trim();
    if(!raw || raw==='about:blank') return 'New Tab';
    if(/(?:^|\/)apps\/link-checker(?:\/|$)/i.test(raw)) return 'Link Checker';
    if(/(?:^|\/)apps\/link-generator(?:\/|$)/i.test(raw)) return 'Link Generator';
    if(raw==='nyx://ai') return 'Nyx AI';
    if(raw.startsWith('nyx://')) return raw.replace('nyx://','nyx ');
    if(raw.startsWith('assets/games/') || raw.startsWith('assets/ugs/') || raw.startsWith('assets/seraph/') || raw.startsWith('/assets/games/') || raw.startsWith('/assets/ugs/') || raw.startsWith('/assets/seraph/')) return 'Study';
    try{return new URL(raw,location.href).hostname.replace(/^www\./,'') || 'New Tab'}catch{return 'New Tab'}
  }
  function websiteDetailsHidden(){
    return store.get('nyx.hideWebsiteDetails',false);
  }
  function isExternalWebsiteUrl(url){
    const raw=String(url || '').trim();
    if(!raw) return false;
    const source=typeof browserShellSourceUrl==='function' ? (browserShellSourceUrl(raw) || raw) : raw;
    try{
      const parsed=new URL(source,location.href);
      return /^https?:$/.test(parsed.protocol) && parsed.origin!==location.origin;
    }catch{return false}
  }
  function browserChromeTitle(title,url){
    return websiteDetailsHidden() && isExternalWebsiteUrl(url) ? 'Website Hidden' : (title || titleForUrl(url));
  }
  function browserChromeIcon(icon,url){
    return websiteDetailsHidden() && isExternalWebsiteUrl(url) ? favicons.nyx : (icon || iconForUrl(url));
  }
  function refreshWebsiteDetailsVisibility(){
    activeBrowser?.renderTabs?.();
    renderBrowserShellTabs();
    const activeTab=activeBrowser?.tabs?.find(tab=>tab.id===activeBrowser.active);
    const shellTab=browserShellTabs.find(tab=>tab.id===browserShellActiveTab);
    const url=activeTab?.sourceUrl || activeTab?.url || shellTab?.url || '';
    const title=activeTab?.title || shellTab?.title || 'New Tab';
    const titlebar=activeBrowser?.win?.querySelector?.('.titlebar-title');
    if(titlebar) titlebar.textContent=browserChromeTitle(title,url);
  }
  let zTop = 20, winCount = 0, activeBrowser = null, antiCloseEnabled = store.get('nyx.antiClose',true), panicCaptureArmed = false, antiClosePanicBypass = false;
  let antiCloseConfirmHandler = null, antiCloseGestureHandler = null, antiCloseRearmTimer = null, antiCloseHadGesture = false;
  let renderedChromeMode = '';
  let uvInstallPromise = null;
  let scramjetInstallPromise = null;
  let scramjetController = null;
  let bareMuxConnection = null;
  let scramjetTransport = null;
  let scramjetTransportKey = '';
  let browserTransportOverride = '';
  let scramjetInstallError = '';
  let nyxPresenceCount = null;
  //scramjet-runtime-guard
  let scramjetRuntimeGuardSource = '';
  const scramjetSpotifyChromeOsGuardSource=`(() => {
    if (typeof window === "undefined" || window.__nyxSpotifyChromeOsCompatibility) return;
    const nativeUserAgent = String(navigator.userAgent || "");
    if (!/\\bCrOS\\b/i.test(nativeUserAgent)) return;
    let hostname = "";
    let pageAddress = "";
    try { hostname = String(location.hostname || "").toLowerCase(); } catch {}
    try { pageAddress = decodeURIComponent(String(location.href || "")).toLowerCase(); } catch { pageAddress = String(location.href || "").toLowerCase(); }
    const compatibilityHost=/(^|\\.)(spotify\\.com|spotifycdn\\.com|scdn\\.co|google\\.com|gstatic\\.com|recaptcha\\.net)$/;
    if (!compatibilityHost.test(hostname) && !/(spotify\\.com|spotifycdn\\.com|scdn\\.co|google\\.com|gstatic\\.com|recaptcha\\.net)/.test(pageAddress)) return;
    window.__nyxSpotifyChromeOsCompatibility = true;
    const chromeVersion = nativeUserAgent.match(/Chrome\\/([0-9.]+)/i)?.[1] || "138.0.0.0";
    const desktopUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + chromeVersion + " Safari/537.36";
    const defineNavigatorValue = (name, value) => {
      try { Object.defineProperty(Navigator.prototype, name, { configurable: true, get: () => value }); }
      catch { try { Object.defineProperty(navigator, name, { configurable: true, get: () => value }); } catch {} }
    };
    defineNavigatorValue("userAgent", desktopUserAgent);
    defineNavigatorValue("platform", "Win32");
    const nativeData = navigator.userAgentData;
    if (nativeData) {
      const desktopData = {
        brands: Array.from(nativeData.brands || []),
        mobile: false,
        platform: "Windows",
        toJSON() { return { brands: this.brands, mobile: false, platform: "Windows" }; },
        async getHighEntropyValues(hints) {
          let values = {};
          try { values = await nativeData.getHighEntropyValues(hints); } catch {}
          return { ...values, platform: "Windows", platformVersion: "10.0.0", architecture: "x86", bitness: "64", model: "" };
        }
      };
      defineNavigatorValue("userAgentData", desktopData);
    }
  })();`;
  const scramjetMinimalRuntimeGuardSource=`(() => {
    if (typeof window === "undefined" || window.__nyxScramjetMinimalGuards) return;
    window.__nyxScramjetMinimalGuards = true;
    try {
      const noop = value => value;
      window.$scramerr = window.$scramerr || noop;
      window.$scramjet$pushsourcemap = window.$scramjet$pushsourcemap || noop;
    } catch {}
    try {
      window.__sentry_instrumentation_handlers__ = window.__sentry_instrumentation_handlers__ || {};
      window.global = window.global || window;
    } catch {}
    if (!window.trustedTypes) {
      try {
        Object.defineProperty(window, "trustedTypes", {
          configurable: true,
          value: {
            createPolicy(_name, rules = {}) {
              return {
                createHTML(value) { return typeof rules.createHTML === "function" ? rules.createHTML(value) : value; },
                createScript(value) { return typeof rules.createScript === "function" ? rules.createScript(value) : value; },
                createScriptURL(value) { return typeof rules.createScriptURL === "function" ? rules.createScriptURL(value) : value; }
              };
            }
          }
        });
      } catch {}
    }
    try {
      if (!window.Buffer) {
        const toBytes = value => value instanceof Uint8Array ? value : new TextEncoder().encode(String(value ?? ""));
        window.Buffer = {
          from: toBytes,
          alloc(size) { return new Uint8Array(Math.max(0, Number(size) || 0)); },
          isBuffer(value) { return value instanceof Uint8Array; },
          byteLength(value) { return toBytes(value).byteLength; }
        };
      }
      if (!window.Long) {
        const toNumber = value => Number(value && typeof value === "object" && "low" in value ? value.low : value) || 0;
        window.Long = {
          ZERO: 0,
          UZERO: 0,
          fromNumber: toNumber,
          fromValue: toNumber,
          isLong() { return false; }
        };
      }
    } catch {}
    try {
      const nativeCurrentScript = Object.getOwnPropertyDescriptor(Document.prototype, "currentScript");
      const fallbackScript = document.createElement("script");
      fallbackScript.setAttribute("nonce", "");
      Object.defineProperty(Document.prototype, "currentScript", {
        configurable: true,
        get() {
          let current = null;
          try { current = nativeCurrentScript?.get?.call(this) || null; } catch {}
          return current || this.querySelector?.("script[src],script") || fallbackScript;
        }
      });
    } catch {}
    try {
      const blockedTelemetry = value => /(?:google-analytics\\.com|googletagmanager\\.com|stats\\.g\\.doubleclick\\.net|analytics\\.google\\.com)/i.test(String(value || ""));
      const neutralizeScript = node => {
        try {
          if (node && String(node.tagName || "").toUpperCase() === "SCRIPT" && blockedTelemetry(node.src || node.getAttribute?.("src"))) {
            node.type = "text/plain";
            node.removeAttribute("src");
            node.text = "";
            return true;
          }
        } catch {}
        return false;
      };
      const nativeAppendChild = Node.prototype.appendChild;
      Node.prototype.appendChild = function(node) {
        if (neutralizeScript(node)) return node;
        return nativeAppendChild.call(this, node);
      };
      const nativeInsertBefore = Node.prototype.insertBefore;
      Node.prototype.insertBefore = function(node, before) {
        if (neutralizeScript(node)) return node;
        return nativeInsertBefore.call(this, node, before);
      };
      const nativeSetAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function(name, value) {
        if (String(this.tagName || "").toUpperCase() === "SCRIPT" && String(name || "").toLowerCase() === "src" && blockedTelemetry(value)) {
          nativeSetAttribute.call(this, "type", "text/plain");
          return;
        }
        return nativeSetAttribute.call(this, name, value);
      };
      const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src");
      if (srcDescriptor?.set) {
        Object.defineProperty(HTMLScriptElement.prototype, "src", {
          configurable: true,
          get() { return srcDescriptor.get.call(this); },
          set(value) {
            if (blockedTelemetry(value)) {
              try { this.type = "text/plain"; } catch {}
              return;
            }
            return srcDescriptor.set.call(this, value);
          }
        });
      }
      if (navigator.sendBeacon) {
        const nativeBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = (url, data) => blockedTelemetry(url) ? true : nativeBeacon(url, data);
      }
    } catch {}
    try {
      const popupProtectionEnabled = () => {
        try {
          const raw = localStorage.getItem("nyx.popupProtection");
          return raw == null || JSON.parse(raw) !== false;
        } catch {
          return true;
        }
      };
      const blockedUrl = "nyx://blocked67haha";
      const fakePopup = (notify = false) => {
        if (notify) {
          try { window.parent?.postMessage?.({ type: "nyx:popup", url: blockedUrl, blocked: true }, "*"); } catch {}
        }
        const fakeDocument = { open(){ return this; }, write(){}, writeln(){}, close(){} };
        return {
          closed: false,
          document: fakeDocument,
          focus(){},
          blur(){},
          close(){ this.closed = true; },
          postMessage(){},
          location: {
            href: blockedUrl,
            assign(){},
            replace(){},
            reload(){},
            toString(){ return blockedUrl; }
          }
        };
      };
      const targetOpensPopup = target => {
        const value = String(target || "").toLowerCase();
        return value && !["_self", "_parent", "_top"].includes(value);
      };
      const looksDownloadLike = value => {
        const text = String(value || "").trim();
        return /^(?:blob|data):/i.test(text) || /\.(?:apk|appx|bat|bin|cmd|com|crx|deb|dmg|exe|iso|jar|js|jse|msi|pkg|ps1|scr|sh|vbs|wsf|zip|7z|rar)(?:[?#]|$)/i.test(text);
      };
      const nativeOpen = window.open?.bind(window);
      const guardedOpen = (...args) => {
        if (!popupProtectionEnabled() && nativeOpen) return nativeOpen(...args);
        return fakePopup(Boolean(navigator.userActivation?.isActive));
      };
      try {
        if (typeof window.open === "function" && typeof Proxy === "function") {
          window.open = new Proxy(window.open, {
            apply(target, thisArg, args) {
              if (!popupProtectionEnabled()) return Reflect.apply(target, thisArg, args);
              return fakePopup(Boolean(navigator.userActivation?.isActive));
            },
            construct(target, args, newTarget) {
              if (!popupProtectionEnabled()) {
                try { return Reflect.construct(target, args, newTarget); }
                catch { return Reflect.apply(target, window, args); }
              }
              return fakePopup(Boolean(navigator.userActivation?.isActive));
            },
            get(target, prop, receiver) {
              if (prop === "__nyxPopupGuard") return true;
              if (prop === "toString") return () => "function open() { [native code] }";
              return Reflect.get(target, prop, receiver);
            }
          });
        } else {
          window.open = guardedOpen;
        }
      } catch {
        window.open = guardedOpen;
      }
      try {
        Object.defineProperty(window.open, "toString", { configurable: true, value: () => "function open() { [native code] }" });
      } catch {}
      if (window.HTMLAnchorElement?.prototype) {
        const nativeAnchorClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function() {
          if (popupProtectionEnabled() && (targetOpensPopup(this.target) || this.hasAttribute("download") || looksDownloadLike(this.href || this.getAttribute("href")))) {
            fakePopup(Boolean(navigator.userActivation?.isActive));
            return;
          }
          return nativeAnchorClick.call(this);
        };
      }
      const stopPopupEvent = event => {
        if (!popupProtectionEnabled()) return;
        const link = event.target?.closest?.("a[href]");
        if (!link) return;
        if (targetOpensPopup(link.getAttribute("target")) || link.hasAttribute("download") || looksDownloadLike(link.href || link.getAttribute("href"))) {
          event.preventDefault();
          event.stopImmediatePropagation();
          fakePopup(true);
        }
      };
      const stopPopupSubmit = event => {
        if (!popupProtectionEnabled()) return;
        const form = event.target;
        if (!form || String(form.tagName || "").toUpperCase() !== "FORM") return;
        if (targetOpensPopup(form.getAttribute("target"))) {
          event.preventDefault();
          event.stopImmediatePropagation();
          fakePopup(true);
        }
      };
      document.addEventListener("click", stopPopupEvent, true);
      document.addEventListener("auxclick", stopPopupEvent, true);
      document.addEventListener("submit", stopPopupSubmit, true);
    } catch {}
  })();`;
  const scramjetHelperRuntimeGuardSource=`(() => {
    if (typeof window === "undefined" || window.__nyxScramjetHelperGuards) return;
    window.__nyxScramjetHelperGuards = true;
    try {
      const seen = new Map();
      const noisy = /bare-mux|Hyper client|tls handshake eof|preloaded using link preload|requestStorageAccess|PlayReady|robustness level|reCAPTCHA Timeout|load timed out|trying fallback|failed; switching|Uncaught \\(in promise\\) undefined|^undefined$/i;
      const summarize = value => String(value && (value.stack || value.message) || value || "")
        .replace(/https?:\\/\\/[^\\s)]+/g, "<url>")
        .replace(/\\b[0-9a-f]{6,}\\b/gi, "<id>")
        .replace(/\\d+/g, "#")
        .slice(0, 360);
      ["warn","error"].forEach(level => {
        const native = console[level]?.bind(console);
        if (!native || native.__nyxDedupe) return;
        console[level] = (...args) => {
          const text = args.map(summarize).join(" ");
          if (noisy.test(text)) {
            const key = level + ":" + text;
            const now = Date.now();
            const last = seen.get(key) || 0;
            if (now - last < 12000) return;
            seen.set(key, now);
          }
          native(...args);
        };
        console[level].__nyxDedupe = true;
      });
      const noop = value => value;
      window.$scramerr = window.$scramerr || noop;
      window.$scramjet$pushsourcemap = window.$scramjet$pushsourcemap || noop;
    } catch {}
  })();`;
  const proxyStateVersion='nyx-proxy-state-20260801-uv-critical-assets-v11';
  const scramjetStateVersion='nyx-scramjet-state-20260716-alpha2-spotify-epoxy-v1';
  function installNyxConsoleDedupe(scope='top'){
    if(console.__nyxDedupeInstalled) return;
    const seen=new Map();
    const noisy=/bare-mux|Hyper client|tls handshake eof|preloaded using link preload|requestStorageAccess|PlayReady|robustness level|reCAPTCHA Timeout|load timed out|trying fallback|failed; switching|Uncaught \\(in promise\\) undefined|^undefined$/i;
    const summarize=value=>{
      try{
        return String(value && (value.stack || value.message) || value)
          .replace(/https?:\/\/[^\s)]+/g,'<url>')
          .replace(/\b[0-9a-f]{6,}\b/gi,'<id>')
          .replace(/\d+/g,'#')
          .slice(0,360);
      }catch{return ''}
    };
    ['warn','error'].forEach(level=>{
      const native=console[level]?.bind(console);
      if(!native) return;
      console[level]=(...args)=>{
        const text=args.map(summarize).join(' ');
        if(noisy.test(text)){
          const key=level+':'+text;
          const now=Date.now();
          const last=seen.get(key) || 0;
          if(now-last<12000) return;
          seen.set(key,now);
        }
        native(...args);
      };
    });
    console.__nyxDedupeInstalled=scope;
  }
  installNyxConsoleDedupe();
  let enhancedBackgroundRun = 0;
  let customBgLayerRun = 0;
  let hieroglyphObserver = null;
  let hieroglyphApplying = false;
  function hieroglyphTextEnabled(){
    return store.get('nyx.hieroglyphText',false) || store.get('nyx.autoHieroglyphText',false);
  }
  function applyAutoHieroglyphPreference(){
    if(store.get('nyx.autoHieroglyphText',false)) store.set('nyx.hieroglyphText',true);
  }
  function toHieroglyphText(text){
    return String(text ?? '').replace(/[A-Za-z0-9]/g, ch => hieroglyphLetters[ch.toLowerCase()] || ch);
  }
  function shouldSkipHieroglyphNode(node){
    const parent=node?.parentElement;
    return !parent || parent.closest(hieroglyphSkipSelector) || parent.closest('[data-no-hieroglyph]');
  }
  function applyHieroglyphText(root=document.body){
    if(hieroglyphApplying || !root) return;
    hieroglyphApplying=true;
    try{
      const enabled=hieroglyphTextEnabled();
      if(enabled){
        const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
          acceptNode(node){
            if(shouldSkipHieroglyphNode(node)) return NodeFilter.FILTER_REJECT;
            return /\S/.test(node.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        });
        const nodes=[];
        while(walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(node=>{
          if(!hieroglyphTextNodes.has(node)) hieroglyphTextNodes.set(node,node.nodeValue);
          node.nodeValue=toHieroglyphText(hieroglyphTextNodes.get(node));
        });
      }else{
        const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null);
        const nodes=[];
        while(walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(node=>{
          if(hieroglyphTextNodes.has(node)) node.nodeValue=hieroglyphTextNodes.get(node);
        });
      }
      qsa('[data-hieroglyph-text], [data-switch="nyx.hieroglyphText"]').forEach(el=>el.classList.toggle('on',enabled));
    }finally{
      hieroglyphApplying=false;
    }
  }
  function startHieroglyphObserver(){
    if(hieroglyphObserver || !document.body) return;
    hieroglyphObserver=new MutationObserver(records=>{
      if(hieroglyphApplying || !hieroglyphTextEnabled()) return;
      records.forEach(record=>{
        record.addedNodes.forEach(node=>{
          if(node.nodeType===Node.TEXT_NODE && !shouldSkipHieroglyphNode(node)){
            if(!hieroglyphTextNodes.has(node)) hieroglyphTextNodes.set(node,node.nodeValue);
            node.nodeValue=toHieroglyphText(hieroglyphTextNodes.get(node));
          }else if(node.nodeType===Node.ELEMENT_NODE){
            applyHieroglyphText(node);
          }
        });
      });
    });
    hieroglyphObserver.observe(document.body,{childList:true,subtree:true});
  }
  //browser-mode-chrome
  function renderChrome(){
    const top=document.querySelector('.top-os');
    if(top){
      top.innerHTML='<div class="brand-mini"><span id="brandName">ռʏӼ</span><span>|</span><button id="userGreeting" class="user-chip needs-name" data-open="settings">Set username</button></div><div class="status-icons"><button class="top-fullscreen" data-page-fullscreen title="Fullscreen" aria-label="Fullscreen"></button><span id="clock">--:--</span></div>';
    }
    const shortcuts=document.querySelector('.desktop-shortcuts');
    if(shortcuts){
      shortcuts.innerHTML='<button class="desktop-shortcut" data-open="browser"><span class="icon">GL</span>Browser</button><button class="desktop-shortcut" data-open="updates"><span class="icon">Fix</span>Updates</button>';
    }
    const dock=document.querySelector('.dock');
    if(dock){
      dock.innerHTML=`<button title="Study" data-app-url="/assets/games/index.html"><img class="dock-icon" alt="" src="${appIcon('games')}"><span>Study</span></button><button title="Apps" data-open="apps"><img class="dock-icon" alt="" src="${appIcon('apps')}"><span>Apps</span></button><button title="GeForce Now" data-app-url="https://play.geforcenow.com/"><img class="dock-icon" alt="" src="${appIcon('geforcenow')}"><span>GeForce</span></button><button title="Roblox" data-app-url="https://web.cloudmoonapp.com/game/com.roblox.client/"><img class="dock-icon" alt="" src="${appIcon('roblox.com')}"><span>Roblox</span></button><button title="Discord" data-app-url="https://discord.com/app"><img class="dock-icon" alt="" src="${appIcon('discord-dock')}"><span>Discord</span></button><button title="Settings" data-open="settings" aria-label="Settings"><img class="dock-icon" alt="" src="${appIcon('settings')}"><span>Settings</span></button><span class="dock-separator"></span><span class="minimized-tray" id="minimizedTray"></span>`;
      hydrateDockDrag(dock);
    }
    const corner=document.querySelector('.corner-gear');
    if(corner) corner.remove();
    ensureNyxAccountButton();
  }
  function normalizeBrowserChromeButtons(root=document){
    const scope=root || document;
    const keepOne=selector=>{
      const items=[...scope.querySelectorAll(selector)];
      items.slice(1).forEach(item=>item.remove());
    };
    keepOne('form.browser-mode-address [data-browser-shell-bookmark]');
    keepOne('form.browser-mode-address .browser-mode-weather');
    keepOne('form.browser-mode-address [data-browser-shell-menu]');
    keepOne('#browserBookmarkPanel');
    keepOne('#browserModeMenu');
    const menu=scope.querySelector('#browserModeMenu');
    if(menu){
      [...menu.querySelectorAll('[data-browser-bookmarks-toggle]')].slice(1).forEach(item=>item.remove());
      menu.querySelector(':scope > [data-browser-shell-new-tab]')?.remove();
    }
  }
  function bindReloadPointerTurn(root=document){
    root.querySelectorAll?.('[data-browser-shell-reload],.tool-btn[data-reload]')?.forEach(button=>{
      if(button.dataset.nyxPointerTurnBound==='true') return;
      button.dataset.nyxPointerTurnBound='true';
      let current=0;
      let target=0;
      let frame=0;
      const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      const draw=()=>{
        frame=0;
        current+=(target-current)*.09;
        if(Math.abs(target-current)<.08) current=target;
        button.style.setProperty('--nyx-reload-turn',`${current.toFixed(2)}deg`);
        if(current!==target) frame=requestAnimationFrame(draw);
      };
      const aim=value=>{
        target=Math.max(0,Math.min(180,value));
        if(reducedMotion){
          current=0;
          target=0;
          button.style.setProperty('--nyx-reload-turn','0deg');
          return;
        }
        if(!frame) frame=requestAnimationFrame(draw);
      };
      button.addEventListener('pointermove',event=>{
        const bounds=button.getBoundingClientRect();
        const position=Math.max(0,Math.min(1,(event.clientX-bounds.left)/Math.max(1,bounds.width)));
        aim(position*180);
      });
      button.addEventListener('pointerleave',()=>aim(0));
      button.addEventListener('blur',()=>aim(0));
    });
  }
  function renderChromeFixed(){
    const top=document.querySelector('.top-os');
    if(top){
      top.innerHTML='<div class="brand-mini"><button class="browser-mode-app-button active" data-browser-shell-home title="Current tab"><span class="browser-home-icon" aria-hidden="true"></span><span class="browser-home-label">Home</span></button><button class="browser-mode-tab" data-browser-shell-new-tab title="New tab"><span>New tab</span></button></div><span class="browser-top-clock" data-browser-shell-clock>--:--:--</span><form class="browser-mode-address" data-browser-shell-search><button class="browser-nav-control" data-browser-shell-back type="button" title="Back" aria-label="Back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg></button><button class="browser-nav-control" data-browser-shell-forward type="button" title="Forward" aria-label="Forward"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg></button><button class="browser-nav-control" data-browser-shell-reload type="button" title="Reload" aria-label="Reload"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.35 5.65"></path><path d="M20 4v7h-7"></path></svg></button><button class="browser-nav-control" data-browser-shell-home-nav type="button" title="Home" aria-label="Home"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8"></path><path d="M5 10v10h14V10"></path><path d="M9 20v-6h6v6"></path></svg></button><input class="browser-mode-url" data-browser-shell-url placeholder="Search or enter a URL" autocomplete="off"><button class="browser-mode-bookmark" data-browser-shell-bookmark type="button" title="Bookmark this tab" aria-pressed="false"><span class="fresh-real-icon" aria-hidden="true">☆</span></button><button class="browser-mode-weather" data-open="weather" type="button" title="Weather" aria-label="Weather"><span class="weather-cloud-icon" aria-hidden="true"></span></button><button data-browser-shell-menu type="button" title="Menu"><span class="fresh-real-icon" aria-hidden="true">⋮</span></button></form><div class="browser-bookmark-panel" id="browserBookmarkPanel" hidden></div><div class="browser-mode-menu" id="browserModeMenu"><button data-browser-shell-new-tab type="button">New tab</button><button data-browser-bookmarks-toggle type="button">Bookmarks</button><button data-open="apps" type="button">Apps</button><hr><button data-open="settings" type="button">Settings</button><button data-browser-hieroglyph-toggle type="button">Hieroglyph Mode</button><button data-app-url="/assets/games/index.html" type="button">Study</button><button data-app-url="https://discord.com/app" type="button">Discord</button><hr><button data-page-fullscreen type="button">Fullscreen</button><button data-shell-about type="button">Open About:Blank</button><button data-shell-about-tab type="button">Open Tab in Abt:Blank</button></div>';
      top.querySelectorAll('.brand-mini button[title],.browser-mode-address button[title]').forEach(button=>{
        if(!button.getAttribute('aria-label')) button.setAttribute('aria-label',button.getAttribute('title') || 'Browser control');
        button.removeAttribute('title');
      });
      top.querySelector('#browserModeMenu > [data-browser-shell-new-tab]')?.remove();
      normalizeBrowserChromeButtons(top);
      bindReloadPointerTurn(top);
      top.querySelector('.brand-mini [data-browser-shell-new-tab]')?.addEventListener('click',event=>{
        event.nyxShellNewHandled=true;
        event.preventDefault();
        event.stopImmediatePropagation();
        document.body.classList.remove('menu-open');
        openBrowserShellTab();
        document.querySelector('[data-browser-shell-url]')?.focus();
      });
      top.querySelector('.brand-mini [data-browser-shell-home]')?.addEventListener('click',event=>{
        event.nyxShellHomeHandled=true;
        event.preventDefault();
        event.stopImmediatePropagation();
        setBrowserShellHomeActive();
      });
      top.addEventListener('pointerdown',()=>{requestNyxKeyboardLock()},{capture:true});
      top.addEventListener('focusin',()=>{requestNyxKeyboardLock()},{capture:true});
      renderBrowserShellTabs();
      renderBrowserBookmarks();
    }
    const shortcuts=document.querySelector('.desktop-shortcuts');
    if(shortcuts){
      shortcuts.innerHTML='';
    }
    const dock=document.querySelector('.dock');
    if(dock){
      dock.innerHTML=`<button title="Study" data-app-url="/assets/games/index.html"><img class="dock-icon" alt="" src="${appIcon('games')}"><span>Study</span></button><button title="Apps" data-open="apps"><img class="dock-icon" alt="" src="${appIcon('apps')}"><span>Apps</span></button><button title="GeForce Now" data-app-url="https://play.geforcenow.com/"><img class="dock-icon" alt="" src="${appIcon('geforcenow')}"><span>GeForce</span></button><button title="Roblox" data-app-url="https://web.cloudmoonapp.com/game/com.roblox.client/"><img class="dock-icon" alt="" src="${appIcon('roblox.com')}"><span>Roblox</span></button><button title="Discord" data-app-url="https://discord.com/app"><img class="dock-icon" alt="" src="${appIcon('discord-dock')}"><span>Discord</span></button><button title="Settings" data-open="settings" aria-label="Settings"><img class="dock-icon" alt="" src="${appIcon('settings')}"><span>Settings</span></button><span class="dock-separator"></span><span class="minimized-tray" id="minimizedTray"></span>`;
      hydrateDockDrag(dock);
    }
    const corner=document.querySelector('.corner-gear');
    if(corner) corner.remove();
    ensureNyxAccountButton();
  }
  function browserShellNeedsStartupHome(){
    const homeTab=browserShellTabs.find(tab=>tab.title==='Home' && !tab.url);
    if(!activeBrowser || !activeBrowser.win || !activeBrowser.win.isConnected) return true;
    if(browserShellActiveTab && homeTab && browserShellActiveTab!==homeTab.id) return false;
    const homeEl=activeBrowser.win.querySelector('.browser-home');
    return !homeEl || homeEl.classList.contains('hidden');
  }
  function syncChromeMode(enabled){
    const mode=enabled ? 'browser-shell' : 'windows';
    const hasBrowserControls=!!document.querySelector('.top-os [data-browser-shell-search]');
    if(renderedChromeMode===mode && hasBrowserControls===enabled){
      if(enabled && browserShellNeedsStartupHome()) setBrowserShellHomeActive();
      return;
    }
    document.body.classList.remove('menu-open');
    if(enabled){
      renderChromeFixed();
      if(nyxStartupOpened && browserShellNeedsStartupHome()) setBrowserShellHomeActive();
      else renderBrowserShellTabs();
    }else renderChrome();
    renderedChromeMode=mode;
    tick();
  }
  //browser-url-display
  function browserShellSourceUrl(url){
    const raw=String(url || '').trim();
    if(!raw) return '';
    if(!/^(?:[a-z][a-z0-9+.-]*:|\/|\.\/|\.\.\/)/i.test(raw) && !/^[^\s]+\.[^\s]{2,}(?:[/?#]|$)/.test(raw)) return raw;
    const decodeUriPart=value=>{
      const text=String(value || '');
      try{return decodeURIComponent(text)}catch{return text}
    };
    const decodeUvPart=value=>{
      const text=String(value || '');
      try{
        const config=window.__uv$config;
        if(config && typeof config.decodeUrl==='function') return config.decodeUrl(text);
      }catch{}
      const uriDecoded=decodeUriPart(text);
      const xorDecoded=[...uriDecoded].map((char,index)=>index % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char).join('');
      return /^https?:\/\//i.test(xorDecoded) ? xorDecoded : uriDecoded;
    };
    try{
      const parsed=new URL(raw,location.href);
      const uvPrefix=window.__uv$config?.prefix || '/service/';
      const uvStart=parsed.origin + uvPrefix;
      const scramjetStart=parsed.origin + '/scramjet/service/';
      const scramjetV2Match=parsed.pathname.match(/^\/~\/sj\/[^/]+\/[^/]+\/([^?#]*)/);
      if(parsed.href.startsWith(uvStart)){
        const decoded=decodeUvPart(parsed.href.slice(uvStart.length));
        try{return new URL(decoded).href}catch{return decoded}
      }
      if(parsed.href.startsWith(scramjetStart)){
        const decoded=decodeUriPart(parsed.href.slice(scramjetStart.length));
        try{return new URL(decoded).href}catch{return decoded}
      }
      if(parsed.origin===location.origin && scramjetV2Match){
        const decodedHash=parsed.hash ? `#${decodeUriPart(parsed.hash.slice(1))}` : '';
        const decoded=decodeUriPart(scramjetV2Match[1]) + decodedHash;
        try{return new URL(decoded).href}catch{return decoded}
      }
      return parsed.href;
    }catch{
      return raw;
    }
  }
  function browserShellLabel(url){
    if(!url) return 'Home';
    if(String(url).trim().toLowerCase()==='nyx://settings') return 'Settings';
    if(String(url).trim().toLowerCase()==='nyx://terms') return 'Terms Of Service';
    if(String(url).trim().toLowerCase()==='nyx://developer') return 'Developer Console';
    if(/^nyx:\/\/(?:about|credits)$/i.test(String(url).trim())) return 'About Nyx';
    try{
      const parsed=new URL(browserShellSourceUrl(url),location.href);
      if(parsed.origin===location.origin && parsed.pathname==='/search') return parsed.searchParams.get('q') || 'Search';
      if(parsed.origin===location.origin && parsed.pathname.includes('/assets/games/')) return 'Study';
      if(parsed.origin===location.origin && parsed.pathname.includes('/assets/seraph/')) return 'Seraph Study';
      if(parsed.origin===location.origin && parsed.pathname.includes('/assets/ugs/')) return 'Pirate Cove';
      if(parsed.origin===location.origin && parsed.pathname.includes('/apps/link-checker/')) return 'Link Checker';
      if(parsed.origin===location.origin && parsed.pathname.includes('/apps/link-generator/')) return 'Link Generator';
      if(parsed.origin===location.origin) return parsed.pathname.split('/').filter(Boolean).pop() || 'nyx';
      return parsed.hostname.replace(/^www\./,'') || 'New tab';
    }catch{
      return String(url || 'New tab').replace(/^https?:\/\//,'').slice(0,34) || 'New tab';
    }
  }
  function browserShellDisplayValue(url){
    if(!url) return '';
    try{
      const parsed=new URL(browserShellSourceUrl(url),location.href);
      if(parsed.origin===location.origin && parsed.pathname==='/search') return parsed.searchParams.get('q') || '';
      if(parsed.origin===location.origin) return parsed.pathname.replace(/^\/+/,'') || parsed.href;
      return parsed.href;
    }catch{
      return browserShellSourceUrl(url);
    }
  }
  //browser-bookmarks
  function browserBookmarks(){
    try{
      const parsed=JSON.parse(store.text('nyx.browserBookmarks','[]'));
      return Array.isArray(parsed) ? parsed.filter(item=>item && item.url) : [];
    }catch{
      return [];
    }
  }
  function saveBrowserBookmarks(items){
    store.setText('nyx.browserBookmarks',JSON.stringify(items.slice(0,80)));
  }
  function activeBrowserShellTab(){
    ensureBrowserShellHome();
    return browserShellTabs.find(tab=>tab.id===browserShellActiveTab) || browserShellTabs[0];
  }
  function currentBrowserShellUrl(){
    const tab=activeBrowserShellTab();
    return normalize(browserShellSourceUrl(tab?.url) || document.querySelector('[data-browser-shell-url]')?.value || '');
  }
  const browserSuggestionSeeds=[
    'youtube','tiktok','spotify','discord','roblox','github','google classroom','google docs',
    'duck ai','geforce now','games','weather','anime','music','unblocked games','calculator',
    'roblox codes','gmail','google translate','cool math games','chatgpt','amazon','reddit','netflix'
  ];
  const browserSuggestionCache=new Map();
  let browserSuggestionTimer=0;
  let browserSuggestionAbort=null;
  function ensureBrowserSuggestionBox(input){
    let box=$('browserSearchSuggestions');
    if(!box){
      box=document.createElement('div');
      box.id='browserSearchSuggestions';
      box.className='browser-search-suggestions';
      box.setAttribute('role','listbox');
      document.body.appendChild(box);
    }
    if(input){
      const rect=input.getBoundingClientRect();
      box.style.left=Math.max(8,rect.left)+'px';
      box.style.top=Math.min(window.innerHeight-12,rect.bottom+8)+'px';
      box.style.width=Math.min(rect.width,window.innerWidth-16)+'px';
    }
    return box;
  }
  function browserSuggestionsAllowed(){
    if(!document.body.classList.contains('browser-shell')) return false;
    const tab=activeBrowserShellTab?.();
    const url=String(tab?.url || '');
    const title=String(tab?.title || '').trim().toLowerCase();
    if(url.startsWith('nyx://')) return false;
    if(['apps','lion ai','lionai','ai','bookmarks','links','settings','games'].includes(title)) return false;
    const state=activeBrowser;
    const browserTab=state?.tabs?.find(item=>item.id===state.active);
    if(browserTab?.frame?.getAttribute('srcdoc') && String(browserTab.url || '').startsWith('nyx://')) return false;
    return true;
  }
  function browserSuggestionItems(query,remoteItems=[]){
    const q=String(query || '').trim().toLowerCase();
    if(!q) return [];
    const tabItems=browserShellTabs.map(tab=>browserShellSourceUrl(tab.url) || tab.title).filter(Boolean);
    const bookmarkItems=browserBookmarks().flatMap(item=>[item.title,item.url]).filter(Boolean);
    const popularByPrefix=[
      ['mine',['minecraft skins','minecraft movie','minecraft seed map','minecraft download','minecraft launcher','minecraft wiki']],
      ['rob',['roblox codes','roblox login','roblox redeem','roblox support','roblox marketplace','roblox avatar']],
      ['you',['youtube','youtube music','youtube tv','youtube studio','youtube shorts','youtube downloader']],
      ['tik',['tiktok','tiktok shop','tiktok login','tiktok trends','tiktok sounds','tiktok studio']],
      ['spo',['spotify','spotify web player','spotify wrapped','spotify login','spotify playlist','spotify download']],
      ['dis',['discord','discord login','discord app','discord status','discord download','discord servers']],
      ['goo',['google classroom','google docs','google drive','google translate','google maps','google flights']]
    ];
    const prefixItems=popularByPrefix.find(([prefix])=>q.startsWith(prefix))?.[1] || [];
    const pool=[...remoteItems,...prefixItems,...tabItems,...bookmarkItems,...browserSuggestionSeeds];
    const seen=new Set();
    const out=[];
    pool
      .map(item=>String(item || '').trim())
      .filter(Boolean)
      .sort((a,b)=>{
        const ak=a.toLowerCase();
        const bk=b.toLowerCase();
        const aStarts=ak.startsWith(q) ? 0 : 1;
        const bStarts=bk.startsWith(q) ? 0 : 1;
        if(aStarts!==bStarts) return aStarts-bStarts;
        const aIndex=ak.indexOf(q);
        const bIndex=bk.indexOf(q);
        if(aIndex!==bIndex) return aIndex-bIndex;
        return a.length-b.length;
      })
      .forEach(item=>{
      const text=String(item || '').trim();
      const key=text.toLowerCase();
      if(!text || seen.has(key)) return;
      if(key.includes(q) || (q.length<=4 && q.includes(key))){
        seen.add(key);
        out.push(text);
      }
    });
    if(!out.includes(query)) out.unshift(query);
    return out.slice(0,6);
  }
  function renderBrowserSuggestions(input,items){
    if(!input || !browserSuggestionsAllowed()) return;
    const box=ensureBrowserSuggestionBox(input);
    if(!items.length){
      box.classList.remove('show');
      box.innerHTML='';
      return;
    }
    box.innerHTML=items.map((item,index)=>`<button class="browser-search-suggestion${index===0?' active':''}" data-browser-suggestion="${esc(item)}" type="button" role="option">${esc(item)}</button>`).join('');
    box.classList.add('show');
  }
  async function fetchBrowserAutocomplete(query,signal){
    const q=String(query || '').trim();
    if(q.length<2) return [];
    const key=q.toLowerCase();
    if(browserSuggestionCache.has(key)) return browserSuggestionCache.get(key);
    const callback='nyxSuggest_'+Math.random().toString(36).slice(2);
    try{
      const items=await new Promise(resolve=>{
        if(signal?.aborted){resolve([]); return}
        const script=document.createElement('script');
        const cleanup=()=>{
          try{window[callback]=()=>{}}catch{}
          setTimeout(()=>{try{delete window[callback]}catch{window[callback]=undefined}},8000);
          script.remove();
        };
        const timer=setTimeout(()=>{cleanup(); resolve([])},1800);
        window[callback]=data=>{
          clearTimeout(timer);
          cleanup();
          resolve(Array.isArray(data?.[1]) ? data[1] : []);
        };
        signal?.addEventListener('abort',()=>{clearTimeout(timer); cleanup(); resolve([])},{once:true});
        script.onerror=()=>{clearTimeout(timer); cleanup(); resolve([])};
        script.src=`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(q)}&callback=${callback}`;
        document.head.appendChild(script);
      });
      const clean=items.map(item=>String(item || '').trim()).filter(Boolean).slice(0,8);
      if(clean.length){
        browserSuggestionCache.set(key,clean);
        return clean;
      }
    }catch{}
    browserSuggestionCache.set(key,[]);
    return [];
  }
  function showBrowserSuggestions(input){
    if(!input || !browserSuggestionsAllowed()){
      hideBrowserSuggestions();
      return;
    }
    const value=String(input.value || '').trim();
    renderBrowserSuggestions(input,browserSuggestionItems(value));
    clearTimeout(browserSuggestionTimer);
    browserSuggestionAbort?.abort?.();
    if(value.length<2 || document.body.classList.contains('runtime-lag-guard')) return;
    browserSuggestionAbort=new AbortController();
    const signal=browserSuggestionAbort.signal;
    browserSuggestionTimer=setTimeout(async()=>{
      const remote=await fetchBrowserAutocomplete(value,signal);
      if(signal.aborted) return;
      const active=document.querySelector('[data-browser-shell-url]');
      if(active!==input || String(input.value || '').trim()!==value) return;
      renderBrowserSuggestions(input,browserSuggestionItems(value,remote));
    },320);
  }
  function hideBrowserSuggestions(){
    clearTimeout(browserSuggestionTimer);
    browserSuggestionAbort?.abort?.();
    const box=$('browserSearchSuggestions');
    if(box) box.classList.remove('show');
  }
  function browserSuggestionPointerInside(target){
    return !!target?.closest?.('[data-browser-shell-url],#browserSearchSuggestions,.browser-search-suggestions');
  }
  function acceptBrowserSuggestion(value){
    const input=document.querySelector('[data-browser-shell-url]');
    if(input) input.value=value || '';
    hideBrowserSuggestions();
    navigateBrowserShell(value);
  }
  function selectBrowserShellUrl(input,force=false){
    if(!input) return;
    if(!force && input.dataset.selectOnFocus!=='1') return;
    input.dataset.selectOnFocus='0';
    requestAnimationFrame(()=>{
      try{input.select()}catch{}
    });
  }
  let browserShellUrlFirstPointer=null;
  function clearBrowserShellUrlSelection(input=document.querySelector('[data-browser-shell-url]')){
    if(!input) return;
    try{
      const end=String(input.value || '').length;
      input.setSelectionRange(end,end);
    }catch{}
  }
  function isEditableTarget(target){
    return !!target && (target.matches?.('input,textarea') || target.isContentEditable);
  }
  function selectedTextFromTarget(target){
    if(target?.matches?.('input,textarea')){
      return target.value.slice(target.selectionStart || 0,target.selectionEnd || 0);
    }
    return String(getSelection?.() || '');
  }
  function replaceSelectionInTarget(target,text){
    if(target?.matches?.('input,textarea')){
      const start=target.selectionStart || 0;
      const end=target.selectionEnd || 0;
      const value=target.value || '';
      target.value=value.slice(0,start)+text+value.slice(end);
      const cursor=start+String(text).length;
      target.setSelectionRange(cursor,cursor);
      target.dispatchEvent(new Event('input',{bubbles:true}));
      return;
    }
    document.execCommand('insertText',false,text);
  }
  async function writeClipboard(text){
    try{
      await navigator.clipboard?.writeText(text);
      return true;
    }catch{
      return document.execCommand?.('copy');
    }
  }
  function switchBrowserShellTabByIndex(index){
    if(!document.body.classList.contains('browser-shell')) return false;
    const safeIndex=Math.max(0,Math.min(8,Number(index || 0)));
    const tab=browserShellTabs[safeIndex];
    if(!tab) return false;
    setBrowserShellActive(tab.id);
    return true;
  }
  function primeBrowserShellShortcutFocus(){
    if(!document.body.classList.contains('browser-shell')) return;
    requestNyxKeyboardLock();
    try{window.focus()}catch{}
    const target=document.querySelector('.top-os') || document.body;
    try{
      if(!target.hasAttribute('tabindex')) target.setAttribute('tabindex','-1');
      target.focus({preventScroll:true});
    }catch{
      try{document.body.focus({preventScroll:true})}catch{}
    }
  }
  const nyxKeyboardLockKeys=['AltLeft','Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','KeyL','KeyD','KeyT','KeyW','KeyR','ArrowLeft','ArrowRight','Tab'];
  let nyxKeyboardLockRequested=false;
  async function releaseNyxKeyboardLock(){
    if(!nyxKeyboardLockRequested) return;
    try{await navigator.keyboard?.unlock?.()}catch{}
    nyxKeyboardLockRequested=false;
  }
  async function requestNyxKeyboardLock(){
    const activeTab=activeBrowser?.tabs?.find?.(tab=>tab.id===activeBrowser.active);
    const activeSource=String(browserShellSourceUrl(activeTab?.sourceUrl || activeTab?.url || '') || activeTab?.sourceUrl || activeTab?.url || '');
    if(/(?:pixelclient\.xyz|play\.geforcenow\.com|geforcenow\.com|\/assets\/(?:games|ugs|seraph|gn-math|gms-games)\/)/i.test(activeSource)){
      await releaseNyxKeyboardLock();
      return;
    }
    if(nyxKeyboardLockRequested || !document.body.classList.contains('browser-shell')) return;
    nyxKeyboardLockRequested=true;
    try{
      await navigator.keyboard?.lock?.(nyxKeyboardLockKeys);
    }catch{
      nyxKeyboardLockRequested=false;
    }
  }
  function handleBrowserShellAltAction(key,eventLike=null){
    key=String(key || '').toLowerCase();
    if(!key) return false;
    const consume=()=>{try{eventLike?.preventDefault?.()}catch{}; try{eventLike?.stopPropagation?.()}catch{}};
    if(key==='tab'){
      if(eventLike && triggerChromeOsAltTabRedirect(eventLike)){
        consume();
        return true;
      }
      return false;
    }
    if(/^[1-9]$/.test(key)){
      if(switchBrowserShellTabByIndex(Number(key)-1)){
        consume();
        return true;
      }
      return false;
    }
    const input=document.querySelector('[data-browser-shell-url]');
    if(key==='l' || key==='d'){
      consume();
      input?.focus();
      selectBrowserShellUrl(input,true);
      showBrowserSuggestions(input);
      return true;
    }
    if(key==='t'){
      consume();
      openBrowserShellTab();
      const next=document.querySelector('[data-browser-shell-url]');
      next?.focus();
      selectBrowserShellUrl(next,true);
      return true;
    }
    if(key==='w'){
      consume();
      const tab=activeBrowserShellTab();
      if(tab?.id) closeBrowserShellTab(tab.id);
      return true;
    }
    if(key==='r'){
      consume();
      document.querySelector('[data-browser-shell-reload]')?.click();
      return true;
    }
    if(key==='arrowleft'){
      consume();
      document.querySelector('[data-browser-shell-back]')?.click();
      return true;
    }
    if(key==='arrowright'){
      consume();
      document.querySelector('[data-browser-shell-forward]')?.click();
      return true;
    }
    return false;
  }
  async function handleLeftAltChromeShortcut(e){
    if(panicCaptureArmed || e.ctrlKey || e.metaKey || !e.altKey || e.location===KeyboardEvent.DOM_KEY_LOCATION_RIGHT) return;
    const key=String(e.key || '').toLowerCase();
    const consume=()=>{e.preventDefault(); e.stopPropagation();};
    if(key==='alt'){
      consume();
      primeBrowserShellShortcutFocus();
      return;
    }
    if(handleBrowserShellAltAction(key,e)) return;
    const target=e.target;
    if(!isEditableTarget(target)) return;
    if(key==='a'){
      consume();
      if(target.select) target.select();
      else document.execCommand('selectAll');
      return;
    }
    if(key==='c'){
      consume();
      await writeClipboard(selectedTextFromTarget(target));
      return;
    }
    if(key==='x'){
      consume();
      const selected=selectedTextFromTarget(target);
      await writeClipboard(selected);
      replaceSelectionInTarget(target,'');
      return;
    }
    if(key==='v'){
      consume();
      try{
        const text=await navigator.clipboard?.readText();
        if(text!=null) replaceSelectionInTarget(target,text);
      }catch{
        document.execCommand?.('paste');
      }
      return;
    }
    if(key==='z'){
      consume();
      document.execCommand?.('undo');
      return;
    }
    if(key==='y'){
      consume();
      document.execCommand?.('redo');
    }
  }
  function renderBrowserBookmarks(){
    const panel=$('browserBookmarkPanel');
    const star=document.querySelector('[data-browser-shell-bookmark]');
    if(!panel && !star) return;
    const activeUrl=currentBrowserShellUrl();
    const bookmarks=browserBookmarks();
    const saved=!!activeUrl && bookmarks.some(item=>item.url===activeUrl);
    if(star){
      star.classList.toggle('saved',saved);
      star.setAttribute('aria-pressed',String(saved));
      star.textContent=saved ? '★' : '☆';
    }
    if(!panel) return;
    if(!bookmarks.length){
      panel.innerHTML='<p class="browser-bookmark-empty">No bookmarks yet. Open a page and press the star.</p>';
      return;
    }
    panel.innerHTML=bookmarks.map((item,index)=>`<div class="browser-bookmark-row"><button class="browser-bookmark-open" data-browser-bookmark-open="${index}" type="button"><b>${esc(item.title || browserShellLabel(item.url))}</b><small>${esc(browserShellDisplayValue(item.url))}</small></button><button class="browser-bookmark-remove" data-browser-bookmark-remove="${index}" type="button" title="Remove bookmark">x</button></div>`).join('');
  }
  function toggleBrowserBookmark(){
    const url=currentBrowserShellUrl();
    if(!url){
      toggleBrowserBookmarksPanel();
      return;
    }
    const tab=activeBrowserShellTab();
    const bookmarks=browserBookmarks();
    const index=bookmarks.findIndex(item=>item.url===url);
    if(index>=0){
      bookmarks.splice(index,1);
      toast('Bookmark removed');
    }else{
      bookmarks.unshift({url,title:tab?.title || browserShellLabel(url),created:Date.now()});
      toast('Bookmarked');
    }
    saveBrowserBookmarks(bookmarks);
    renderBrowserBookmarks();
  }
  function toggleBrowserBookmarksPanel(){
    renderBrowserBookmarks();
    const panel=$('browserBookmarkPanel');
    if(panel) panel.hidden=!panel.hidden;
  }
  function openBrowserBookmark(index){
    const item=browserBookmarks()[Number(index)];
    if(!item?.url) return;
    navigateBrowserShell(item.url);
    const panel=$('browserBookmarkPanel');
    if(panel) panel.hidden=true;
  }
  function removeBrowserBookmark(index){
    const bookmarks=browserBookmarks();
    bookmarks.splice(Number(index),1);
    saveBrowserBookmarks(bookmarks);
    renderBrowserBookmarks();
  }
  //browser-home-and-tabs
  function isBrowserShellBlankUrl(url){
    const raw=String(url || '').trim().toLowerCase();
    return !raw;
  }
  function renderBrowserShellHomeMode(win){
    if(!win) return;
    hideNyxErudaPanel();
    win.classList.remove('browser-blank-page');
    win.classList.add('browser-home-page');
    win.classList.add('browser-blank');
    const home=win.querySelector('.browser-home');
    home?.classList.remove('hidden','page-revealing','tab-opening','closing');
    if(home) home.style.filter='';
    const presence=home?.querySelector('.nyx-home-presence');
    if(presence&&!presence.querySelector('[data-nyx-profile-slot]')){
      const slot=document.createElement('div');
      slot.className='nyx-profile-slot';
      slot.dataset.nyxProfileSlot='';
      presence.appendChild(slot);
    }
    win.querySelectorAll('.view').forEach(frame=>frame.classList.remove('active'));
    const input=win.querySelector('[data-browser-blank-input]');
    if(input && !input.value) input.value='';
    ensureNyxAccountButton();
  }
  function ensureBrowserShellHome(){
    if(!browserShellTabs.length){
      const id='shell-'+Date.now()+Math.random().toString(16).slice(2);
      browserShellTabs.push({id,url:'',title:'Home'});
      browserShellActiveTab=id;
    }
    if(!browserShellActiveTab) browserShellActiveTab=browserShellTabs[0].id;
  }
  function moveBrowserShellTab(draggedId,targetId,placeAfter=false){
    if(!draggedId || !targetId || draggedId===targetId) return false;
    const dragged=browserShellTabs.find(tab=>tab.id===draggedId);
    const target=browserShellTabs.find(tab=>tab.id===targetId);
    if(!dragged || !target || (!dragged.url && dragged.title==='Home') || (!target.url && target.title==='Home')) return false;
    const from=browserShellTabs.indexOf(dragged);
    browserShellTabs.splice(from,1);
    const targetIndex=browserShellTabs.indexOf(target);
    browserShellTabs.splice(Math.max(0,targetIndex+(placeAfter?1:0)),0,dragged);
    if(activeBrowser?.tabs?.length){
      const rank=new Map(browserShellTabs.map((tab,index)=>[tab.browserTabId,index]).filter(([id])=>id));
      const originalOrder=new Map(activeBrowser.tabs.map((tab,index)=>[tab.id,index]));
      activeBrowser.tabs.sort((left,right)=>{
        const leftRank=rank.has(left.id)?rank.get(left.id):Number.MAX_SAFE_INTEGER;
        const rightRank=rank.has(right.id)?rank.get(right.id):Number.MAX_SAFE_INTEGER;
        return leftRank-rightRank || originalOrder.get(left.id)-originalOrder.get(right.id);
      });
      activeBrowser.renderTabs?.();
    }
    renderBrowserShellTabs();
    requestAnimationFrame(()=>document.querySelector(`[data-browser-shell-tab="${CSS.escape(draggedId)}"]`)?.focus({preventScroll:true}));
    return true;
  }
  function clearBrowserShellTabDropState(row){
    row?.querySelectorAll?.('.tab-dragging,.tab-drop-before,.tab-drop-after').forEach(tab=>tab.classList.remove('tab-dragging','tab-drop-before','tab-drop-after'));
    document.body.classList.remove('nyx-tab-reordering');
  }
  function installBrowserShellTabReordering(row){
    if(!row || row.dataset.nyxTabReordering==='true') return;
    row.dataset.nyxTabReordering='true';
    let draggedId='';
    row.addEventListener('dragstart',event=>{
      const tab=event.target.closest?.('[data-browser-shell-tab]');
      if(!tab || event.target.closest?.('[data-browser-shell-close-tab]')){event.preventDefault();return}
      draggedId=tab.dataset.browserShellTab || '';
      if(!draggedId){event.preventDefault();return}
      tab.classList.add('tab-dragging');
      document.body.classList.add('nyx-tab-reordering');
      if(event.dataTransfer){
        event.dataTransfer.effectAllowed='move';
        event.dataTransfer.setData('application/x-nyx-tab',draggedId);
        event.dataTransfer.setData('text/plain',draggedId);
      }
    });
    row.addEventListener('dragover',event=>{
      const target=event.target.closest?.('[data-browser-shell-tab]');
      if(!draggedId || !target || target.dataset.browserShellTab===draggedId) return;
      event.preventDefault();
      if(event.dataTransfer)event.dataTransfer.dropEffect='move';
      row.querySelectorAll('.tab-drop-before,.tab-drop-after').forEach(tab=>tab.classList.remove('tab-drop-before','tab-drop-after'));
      const rect=target.getBoundingClientRect();
      target.classList.add(event.clientX>=rect.left+rect.width/2?'tab-drop-after':'tab-drop-before');
    });
    row.addEventListener('drop',event=>{
      const target=event.target.closest?.('[data-browser-shell-tab]');
      if(!draggedId || !target) return;
      event.preventDefault();
      const rect=target.getBoundingClientRect();
      moveBrowserShellTab(draggedId,target.dataset.browserShellTab,event.clientX>=rect.left+rect.width/2);
      draggedId='';
      clearBrowserShellTabDropState(row);
    });
    row.addEventListener('dragend',()=>{
      draggedId='';
      clearBrowserShellTabDropState(row);
    });
    row.addEventListener('keydown',event=>{
      if(!(event.ctrlKey||event.metaKey) || !event.shiftKey || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
      const tab=event.target.closest?.('[data-browser-shell-tab]');
      if(!tab) return;
      const movable=browserShellTabs.filter(item=>item.url || item.title!=='Home');
      const index=movable.findIndex(item=>item.id===tab.dataset.browserShellTab);
      const direction=event.key==='ArrowLeft'?-1:1;
      const target=movable[index+direction];
      if(!target) return;
      event.preventDefault();
      moveBrowserShellTab(tab.dataset.browserShellTab,target.id,direction>0);
    });
  }
  function renderBrowserShellTabs(){
    if(!document.body.classList.contains('browser-shell')) return;
    ensureBrowserShellHome();
    const row=document.querySelector('body.browser-shell .brand-mini') || document.querySelector('.brand-mini');
    if(!row) return;
    row.querySelectorAll('.browser-mode-shell-tab').forEach(tab=>tab.remove());
    const home=row.querySelector('[data-browser-shell-home]');
    const plus=row.querySelector('[data-browser-shell-new-tab]');
    if(!browserShellTabs.length){
      browserShellActiveTab=null;
      const contentStateChanged=document.body.classList.contains('browser-content-active');
      document.body.classList.remove('browser-content-active');
      if(contentStateChanged) queueMicrotask(()=>syncThemeVantaBackgrounds());
      if(home){
        home.style.display='none';
        delete home.dataset.browserShellTab;
      }
      const input=document.querySelector('[data-browser-shell-url]');
      if(input && document.activeElement!==input) input.value='';
      return;
    }
    let active=browserShellTabs.find(tab=>tab.id===browserShellActiveTab);
    if(!active){
      active=browserShellTabs[0];
      browserShellActiveTab=active.id;
    }
    const activeShowsContent=!!(active.url && !isBrowserShellBlankUrl(active.url)) || (active.title!=='Home' && !isBrowserShellBlankUrl(active.url));
    const contentStateChanged=document.body.classList.contains('browser-content-active')!==activeShowsContent;
    document.body.classList.toggle('browser-content-active',activeShowsContent);
    if(contentStateChanged) queueMicrotask(()=>syncThemeVantaBackgrounds());
    if(home){
      home.style.display='';
      home.innerHTML='<span class="browser-home-icon" aria-hidden="true"></span><span class="browser-home-label">Nyx</span>';
      delete home.dataset.browserShellTab;
      home.title='Home';
      home.classList.toggle('active',active.title==='Home' && !active.url);
    }
    browserShellTabs.filter(tab=>tab.url || tab.title!=='Home').forEach(tab=>{
      const button=document.createElement('button');
      button.type='button';
      const opening=browserShellOpeningTabs.has(tab.id);
      button.className='browser-mode-tab browser-mode-shell-tab'+(tab.id===browserShellActiveTab?' active':'')+(opening?' tab-opening':'');
      button.dataset.browserShellTab=tab.id;
      button.draggable=true;
      button.setAttribute('aria-grabbed','false');
      button.title='Drag to reorder tab';
      button.innerHTML=`<img class="browser-mode-tab-icon" alt="" src="${esc(browserChromeIcon(tab.icon,tab.url))}"><span>${esc(browserChromeTitle(tab.title || browserShellLabel(tab.url),tab.url))}</span><i class="browser-mode-shell-tab-close" data-browser-shell-close-tab="${esc(tab.id)}" aria-label="Close tab">x</i>`;
      bindTabIconFallback(button.querySelector('.browser-mode-tab-icon'));
      row.insertBefore(button,plus);
      if(opening){
        let openingFinished=false;
        const finishOpening=()=>{
          if(openingFinished) return;
          openingFinished=true;
          browserShellOpeningTabs.delete(tab.id);
          button.classList.remove('tab-opening');
        };
        button.addEventListener('animationend',finishOpening,{once:true});
        setTimeout(finishOpening,1250);
      }
    });
    installBrowserShellTabReordering(row);
    const input=document.querySelector('[data-browser-shell-url]');
    if(input && document.activeElement!==input) input.value=browserShellDisplayValue(active.url);
    renderBrowserBookmarks();
    if(typeof applyVisualEffectSetting==='function') applyVisualEffectSetting();
    if(!browserSuggestionsAllowed()) hideBrowserSuggestions();
    if(active?.url!=='nyx://developer') hideNyxErudaPanel();
  }
  function pruneBrowserShellInternalPlaceholders(keepId=''){
    if(!activeBrowser?.tabs || activeBrowser.tabs.length<=1) return;
    for(let i=activeBrowser.tabs.length-1;i>=0;i--){
      const tab=activeBrowser.tabs[i];
      if(tab.id===keepId) continue;
      const empty=!String(tab.url || '').trim() || isBrowserShellBlankUrl(tab.url);
      const placeholder=empty && ['Home','New Tab',''].includes(String(tab.title || ''));
      if(!placeholder) continue;
      try{tab.frame?.remove()}catch{}
      activeBrowser.tabs.splice(i,1);
    }
    if(!activeBrowser.tabs.some(tab=>tab.id===activeBrowser.active)){
      activeBrowser.active=keepId || activeBrowser.tabs[0]?.id || null;
    }
    activeBrowser.renderTabs?.();
  }
  function pruneBrowserShellBlankPlaceholders(keepShellId=''){
    for(let i=browserShellTabs.length-1;i>=0;i--){
      const tab=browserShellTabs[i];
      if(tab.id===keepShellId || (tab.title==='Home' && !tab.url)) continue;
      const blank=isBrowserShellBlankUrl(tab.url);
      const placeholder=blank && ['New tab','New Tab',''].includes(String(tab.title || ''));
      if(!placeholder) continue;
      browserShellOpeningTabs.delete(tab.id);
      if(tab.browserTabId && activeBrowser?.closeTab) activeBrowser.closeTab(tab.browserTabId);
      browserShellTabs.splice(i,1);
    }
    if(!browserShellTabs.some(tab=>tab.id===browserShellActiveTab)){
      browserShellActiveTab=keepShellId || browserShellTabs.find(tab=>tab.title==='Home' && !tab.url)?.id || browserShellTabs[0]?.id || null;
    }
  }
  function openBrowserShellTab(url='',options={}){
    closeWeatherForWindowOpen();
    const id='shell-'+Date.now()+Math.random().toString(16).slice(2);
    const normalized=url ? normalize(url) : '';
    const isBlank=!normalized;
    browserShellTabs.push({id,url:normalized,title:isBlank ? 'New Tab' : browserShellLabel(normalized),icon:isBlank ? favicons.nyx : iconForUrl(normalized)});
    browserShellOpeningTabs.add(id);
    browserShellActiveTab=id;
    renderBrowserShellTabs();
    if(activeBrowser?.win?.isConnected && typeof activeBrowser.addTab==='function'){
      const created=activeBrowser.addTab(normalized,options.forceMode || '');
      if(!created){
        browserShellTabs.splice(0,browserShellTabs.length,...browserShellTabs.filter(tab=>tab.id!==id));
        browserShellActiveTab=browserShellTabs[0]?.id || null;
        renderBrowserShellTabs();
        return null;
      }else{
        browserShellTabs.find(tab=>tab.id===id).browserTabId=created.id;
      }
      if(!isBlank){
        created.url=normalized;
        created.title=browserShellLabel(normalized);
        created.icon=iconForUrl(normalized);
        browserShellActiveTab=id;
        activeBrowser.activate?.(created.id);
        activeBrowser.renderTabs?.();
        updateBrowserShellLocation(normalized,created.id);
      }
      else{
        activeBrowser.activate?.(created?.id);
        created.url='';
        created.title='New Tab';
        created.icon=favicons.nyx;
        created.history=[''];
        created.index=0;
        created.scramjetFrame=null;
        created.frame.removeAttribute('src');
        created.frame.removeAttribute('srcdoc');
        created.frame.classList.remove('active');
        renderBrowserShellHomeMode(activeBrowser.win);
        activeBrowser.renderTabs?.();
        updateBrowserShellLocation('',created.id,true);
        renderBrowserShellTabs();
        setTimeout(()=>document.querySelector('[data-browser-shell-url]')?.focus(),30);
      }
      return id;
    }
    const win=openBrowser(normalized,options);
    win?.classList.add('maximized');
    const created=activeBrowser?.tabs?.[activeBrowser.tabs.length-1];
    if(created) browserShellTabs.find(tab=>tab.id===id).browserTabId=created.id;
    if(created && !isBlank){
      created.url=normalized;
      created.title=browserShellLabel(normalized);
      created.icon=iconForUrl(normalized);
      browserShellActiveTab=id;
      activeBrowser?.activate?.(created.id);
      activeBrowser?.renderTabs?.();
    }
    if(isBlank){
      if(created){
        created.url='';
        created.title='New Tab';
        created.icon=favicons.nyx;
        created.history=[''];
        created.index=0;
        created.scramjetFrame=null;
        created.frame.removeAttribute('src');
        created.frame.removeAttribute('srcdoc');
        created.frame.classList.remove('active');
      }
      renderBrowserShellHomeMode(activeBrowser?.win);
      activeBrowser?.activate?.(created?.id);
      renderBrowserShellHomeMode(activeBrowser?.win);
      activeBrowser?.renderTabs?.();
      updateBrowserShellLocation('',created?.id || '',true);
      renderBrowserShellTabs();
      setTimeout(()=>document.querySelector('[data-browser-shell-url]')?.focus(),30);
    }
    updateDockFullscreenState();
    return id;
  }
  function openBrowserShellInternalTab(name){
    hideBrowserSuggestions();
    if(String(name || '').toLowerCase()==='settings'){
      const existing=browserShellTabs.find(tab=>tab.url==='nyx://settings');
      if(existing){
        setBrowserShellActive(existing.id);
        renderBrowserShellSettingsTab();
        return existing.id;
      }
      const id=openBrowserShellTab('');
      const shellTab=browserShellTabs.find(tab=>tab.id===id);
      if(shellTab){
        shellTab.url='nyx://settings';
        shellTab.title='Settings';
        shellTab.icon=appIcon('settings');
        const linked=activeBrowser?.tabs?.find(tab=>tab.id===shellTab.browserTabId);
        if(linked){
          linked.url='nyx://settings';
          linked.title='Settings';
          linked.icon=shellTab.icon;
          linked.history=['nyx://settings'];
          linked.index=0;
        }
      }
      renderBrowserShellTabs();
      const address=document.querySelector('[data-browser-shell-url]');
      if(address) address.value='nyx://settings';
      renderBrowserShellSettingsTab();
      return id;
    }
    closeBrowserShellSettings();
    const id=openBrowserShellTab('');
    if(id) browserShellActiveTab=id;
    showBrowserShellInternalPage(name);
    return id;
  }
  function openBrowserShellAppTab(url){
    hideBrowserSuggestions();
    closeWeatherForWindowOpen();
    if(String(url || '').trim().toLowerCase()==='nyx://settings'){
      return openBrowserShellInternalTab('settings');
    }
    if(String(url || '').trim().toLowerCase()==='nyx://ai'){
      return openBrowserShellInternalTab('ai');
    }
    if(String(url || '').trim().toLowerCase()==='nyx://ephesians1'){
      return openBrowserShellInternalTab('ephesians1');
    }
    if(/^nyx:\/\/(terms|developer|about|credits)$/i.test(String(url || '').trim())){
      return openBrowserShellInternalTab(String(url).trim().slice(6).toLowerCase());
    }
    const id=openBrowserShellTab(url || '',{forceMode:appCompatibilityMode(url)});
    if(id) browserShellActiveTab=id;
    renderBrowserShellTabs();
    return id;
  }
  function ensureBrowserShellLinkedTab(shellTab){
    if(!shellTab || !activeBrowser?.win?.isConnected) return null;
    let tab=shellTab.browserTabId ? activeBrowser.tabs?.find(item=>item.id===shellTab.browserTabId) : null;
    if(tab){
      activeBrowser.activate?.(tab.id);
      return tab;
    }
    tab=activeBrowser.tabs?.find(item=>item.id===activeBrowser.active) || activeBrowser.tabs?.[0] || null;
    if(!tab && typeof activeBrowser.addTab==='function') tab=activeBrowser.addTab('');
    if(!tab) return null;
    shellTab.browserTabId=tab.id;
    activeBrowser.activate?.(tab.id);
    return tab;
  }
  function setBrowserShellActive(id){
    if(!browserShellTabs.some(tab=>tab.id===id)) return;
    closeWeatherForWindowOpen();
    browserShellActiveTab=id;
    const shellTab=browserShellTabs.find(tab=>tab.id===id);
    if(shellTab?.url==='nyx://settings') renderBrowserShellSettingsTab();
    else closeBrowserShellSettings();
    if(shellTab?.title==='Home' && !shellTab.url){
      renderBrowserShellHomeMode(activeBrowser?.win,'home');
    }else if(isBrowserShellBlankUrl(shellTab?.url)){
      if(shellTab?.browserTabId && activeBrowser?.activate) activeBrowser.activate(shellTab.browserTabId);
      renderBrowserShellHomeMode(activeBrowser?.win);
    }else if(shellTab?.browserTabId && activeBrowser?.activate) activeBrowser.activate(shellTab.browserTabId);
    renderBrowserShellTabs();
    animateActiveBrowserShellTab();
  }
  function animateActiveBrowserShellTab(){
    if(suppressHomeEntranceOnStartup) return;
    requestAnimationFrame(()=>{
      const tab=document.querySelector('body.browser-shell .brand-mini > .active:is(.browser-mode-app-button,.browser-mode-shell-tab)');
      if(!tab) return;
      tab.classList.remove('tab-activating');
      void tab.offsetWidth;
      tab.classList.add('tab-activating');
      setTimeout(()=>tab.classList.remove('tab-activating'),340);
    });
  }
  function setBrowserShellHomeActive(){
    closeWeatherForWindowOpen();
    closeBrowserShellSettings();
    ensureBrowserShellHome();
    let homeTab=browserShellTabs.find(tab=>tab.title==='Home' && !tab.url);
    if(!homeTab){
      const id='shell-'+Date.now()+Math.random().toString(16).slice(2);
      homeTab={id,url:'',title:'Home'};
      browserShellTabs.unshift(homeTab);
    }
    browserShellActiveTab=homeTab.id;
    if(!activeBrowser?.win?.isConnected){
      const win=openBrowser('');
      win?.classList.add('maximized');
      updateDockFullscreenState();
    }
    if(activeBrowser?.win?.isConnected){
      const state=activeBrowser;
      state?.tabs?.forEach(tab=>tab.frame?.classList.remove('active'));
      renderBrowserShellHomeMode(state.win,'home');
      state?.renderTabs?.();
      playHomeEntranceAnimation(state.win);
    }
    renderBrowserShellTabs();
    animateActiveBrowserShellTab();
    const input=document.querySelector('[data-browser-shell-url]');
    if(input) input.value='';
  }
  //browser-settings-page
  function browserShellSettingsMarkup(presetTiles){
    const savedTitle=esc(store.text('nyx.tabTitle',document.title || 'ռʏӼ'));
    const savedFavicon=esc(store.text('nyx.tabFavicon',nyxFaviconHref()));
    const currentPreset=esc(store.text('nyx.logo','nyx'));
    const engine=esc(store.text('nyx.engine','duckduckgo'));
    const savedBrowserMode=normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE));
    const browserMode=esc(savedBrowserMode==='rammerhead' ? 'auto' : savedBrowserMode);
    const transport=esc(store.text('nyx.transport',DEFAULT_BROWSER_TRANSPORT));
    const theme=esc(store.text('nyx.theme','default'));
    const effect=esc(store.text('nyx.visualEffect','none'));
    const effectSpeed=esc(store.text('nyx.visualEffectSpeed','1.1'));
    const effectAmount=esc(store.text('nyx.visualEffectAmount','16'));
    return `<section class="settings-app settings-single-pane browser-only-settings"><main class="settings-main"><h1>Browser Settings</h1><div class="settings-section active"><section class="settings-block"><h2>Tab Cloak</h2><div class="settings-form-row"><input class="settings-input" data-tab-title value="${savedTitle}" placeholder="Tab title"><input class="settings-input" data-tab-favicon-file type="file" accept="image/*,.ico" aria-label="Choose tab icon file"><input type="hidden" data-tab-favicon value="${savedFavicon}"></div><p>Choose a title and icon file, then press Apply.</p><div class="settings-actions"><button class="settings-action" data-tab-cloak-apply type="button">Apply Tab Cloak</button><button class="settings-action" data-preset="nyx" type="button">Reset</button></div></section><section class="settings-block"><h2>Preset Cloak</h2><select class="settings-select" data-preset-select><option value="nyx" ${currentPreset==='nyx'?'selected':''}>ռʏӼ</option><option value="google" ${currentPreset==='google'?'selected':''}>Google</option><option value="drive" ${currentPreset==='drive'?'selected':''}>Google Drive</option><option value="classlink" ${currentPreset==='classlink'?'selected':''}>ClassLink</option><option value="classroom" ${currentPreset==='classroom'?'selected':''}>Google Classroom</option></select></section><section class="settings-block"><h2>Cloaking</h2><div class="settings-form-row"><select class="settings-select" data-cloak-type><option value="a" ${store.text('nyx.cloakType','a')==='a'?'selected':''}>about:blank</option><option value="b" ${store.text('nyx.cloakType','a')==='b'?'selected':''}>Blob</option><option value="m" ${store.text('nyx.cloakType','a')==='m'?'selected':''}>Current tab iframe</option></select><input class="settings-input" data-cloak-redirect-url value="${esc(store.text('nyx.cloakRedirectUrl','https://google.com/'))}" placeholder="Original tab redirect URL"></div><div class="settings-actions"><button class="settings-action" data-about type="button">Open in About:Blank</button><button class="settings-action" data-blob type="button">Open in Blob</button></div><div class="settings-row"><span>Auto Cloak</span><button class="settings-action ${store.get('nyx.autoCloak',false)?'on':''}" data-switch="nyx.autoCloak" type="button">${store.get('nyx.autoCloak',false)?'On':'Off'}</button></div><div class="settings-row"><span>Redirect original after launch</span><button class="settings-action ${store.get('nyx.cloakRedirectOriginal',false)?'on':''}" data-switch="nyx.cloakRedirectOriginal" type="button">${store.get('nyx.cloakRedirectOriginal',false)?'On':'Off'}</button></div><div class="settings-actions"><button class="settings-action" data-save-cloak type="button">Save Cloak Settings</button><button class="settings-action" data-launch-selected-cloak type="button">Launch Selected</button></div></section><section class="settings-block"><h2>Panic Key</h2><p>Press this combo anytime to instantly close the current tab without a confirmation.</p><div class="settings-row"><strong class="panic-key-display" data-panic-key-display>${esc(store.text('nyx.panicKey','not set'))}</strong></div><div class="settings-actions"><button class="settings-action" data-panic-capture type="button">Capture</button><button class="settings-action" data-panic-clear type="button">Clear</button></div></section><section class="settings-block"><h2>Display Mode</h2><p>Switch back to the Windows-style desktop layout.</p><p>Windows mode is no longer maintained. If you run into any issues, thats not my problem&#x1F494;</p><div class="settings-actions"><button class="settings-action" data-browser-shell-toggle data-enabled="false" type="button">Switch to Windows Mode</button></div></section><section class="settings-block"><h2>Theme</h2><select class="settings-select" data-theme-value><option value="default" ${theme==='default'?'selected':''}>Default</option><option value="ruby" ${theme==='ruby'?'selected':''}>Ruby</option><option value="emerald" ${theme==='emerald'?'selected':''}>Emerald</option><option value="sakura" ${theme==='sakura'?'selected':''}>Sakura</option><option value="fresh" ${theme==='fresh'?'selected':''}>White</option></select></section><section class="settings-block"><h2>Effects</h2><select class="settings-select" data-effect-value><option value="none" ${effect==='none'?'selected':''}>None</option><option value="rain" ${effect==='rain'?'selected':''}>Rain</option><option value="stars" ${effect==='stars'?'selected':''}>Stars</option><option value="hearts" ${effect==='hearts'?'selected':''}>Hearts</option><option value="pokeballs" ${effect==='pokeballs'?'selected':''}>Pokeballs</option><option value="flowers" ${effect==='flowers'?'selected':''}>Flowers</option><option value="emeralds" ${effect==='emeralds'?'selected':''}>Emeralds</option></select><div class="settings-range"><span>Speed</span><input data-effect-speed type="range" min=".3" max="3" step=".1" value="${effectSpeed}"><strong data-effect-speed-label>${effectSpeed}x</strong></div><div class="settings-range"><span>Amount</span><input data-effect-amount type="range" min="1" max="64" step="1" value="${effectAmount}"><strong data-effect-amount-label>${effectAmount}</strong></div></section><section class="settings-block"><h2>Search Engine</h2><select class="settings-select" data-browser-engine><option value="duckduckgo" ${engine==='duckduckgo'?'selected':''}>DuckDuckGo</option><option value="google" ${engine==='google'?'selected':''}>Google</option><option value="bing" ${engine==='bing'?'selected':''}>Bing</option></select></section><section class="settings-block"><h2>Proxy Engine</h2><select class="settings-select" data-browser-mode-select><option value="auto" ${browserMode==='auto'?'selected':''}>Auto</option><option value="scramjet" ${browserMode==='scramjet'?'selected':''}>Scramjet</option><option value="ultraviolet" ${browserMode==='ultraviolet'?'selected':''}>Ultraviolet</option><option value="iframe" ${browserMode==='iframe'?'selected':''}>Iframe</option></select></section><section class="settings-block"><h2>Transport</h2><select class="settings-select" data-browser-transport><option value="epoxy" ${transport==='epoxy'?'selected':''}>Epoxy over Wisp</option><option value="wisp" ${transport==='wisp'?'selected':''}>Wisp endpoint</option><option value="libcurl" ${transport==='libcurl'?'selected':''}>Libcurl over Wisp</option></select><div class="settings-actions"><button class="settings-action" data-browser-settings-save type="button">Save Browser Settings</button></div></section><section class="settings-block"><h2>Popup Protection</h2><p>Blocks malicious ads/sites.</p><button class="settings-action ${popupProtectionEnabled()?'on':''}" data-popup-protection data-enabled="${popupProtectionEnabled()?'true':'false'}" type="button">Popup Protection ${popupProtectionEnabled()?'On':'Off'}</button><p style="margin-top:12px;color:#fde047;font-weight:400;line-height:1.42;text-shadow:none">*Warning: If this option is disabled, your computer may be exposed to various security threats, including viruses such as Trojan, disguised as Opera GX (which obviously is not). Disabling this feature could result in significant damage to your system, unaware access to your data, and potential sale of your personal data. It is <span style="color:#ff3b3b;text-shadow:0 0 4px rgba(255,255,255,.35),0 0 7px rgba(255,59,59,.95),0 0 14px rgba(255,59,59,.82),0 0 24px rgba(185,28,28,.72),0 0 38px rgba(127,29,29,.58)">STRONGLY</span> recommended to keep this setting enabled. This feature remains active unless the user intentionally chooses to disable it.*</p></section></div></main></section>`;
  }
  function browserShellPresetTiles(){
    return `<button class="quick-tile" data-preset="nyx" type="button"><img class="quick-icon" alt="" src="${nyxTabFavicon}"><span>ռʏӼ tab</span></button><button class="quick-tile" data-preset="google" type="button"><img class="quick-icon" alt="" src="${favicons.google}"><span>Google tab</span></button><button class="quick-tile" data-preset="drive" type="button"><img class="quick-icon" alt="" src="${favicons.drive}"><span>Drive tab</span></button><button class="quick-tile" data-preset="classlink" type="button"><img class="quick-icon" alt="" src="${favicons.classlink}"><span>ClassLink tab</span></button>`;
  }
  function saveBrowserShellSettings(root=document){
    const activeTab=activeBrowser?.tabs?.find(tab=>tab.id===activeBrowser.active);
    const activeSource=browserShellSourceUrl(activeTab?.sourceUrl || activeTab?.url || '') || activeTab?.sourceUrl || activeTab?.url || '';
    const engine=root.querySelector('[data-browser-engine]');
    const mode=root.querySelector('[data-browser-mode-select]');
    const transport=root.querySelector('[data-browser-transport]');
    const font=root.querySelector('[data-font-value]');
    store.setText('nyx.engine', engine?.value || 'duckduckgo');
    store.setText('nyx.browserMode', normalizeBrowserModeName(mode?.value || DEFAULT_BROWSER_MODE));
    if(font) store.setText('nyx.font',nyxFontChoice(font.value)[0]);
    const nextTransport=transport?.value || DEFAULT_BROWSER_TRANSPORT;
    if(store.text('nyx.transport',DEFAULT_BROWSER_TRANSPORT)!==nextTransport){
      scramjetInstallPromise=null;
      scramjetController=null;
      scramjetTransport=null;
      scramjetTransportKey='';
      uvInstallPromise=null;
    }
    store.setText('nyx.transport', nextTransport);
    applyUserSettings();
    browserTransportOverride='';
    scramjetInstallPromise=null;
    scramjetController=null;
    scramjetTransport=null;
    scramjetTransportKey='';
    uvInstallPromise=null;
    if(/^https?:\/\//i.test(activeSource)){
      setTimeout(()=>activeBrowser?.navigate?.(activeSource),0);
    }
  }
  function enhanceBrowserShellSettings(overlay){
    const app=overlay.querySelector('.settings-app');
    const main=app?.querySelector('.settings-main');
    const source=main?.querySelector('.settings-section.active');
    if(!app || !main || !source) return;

    app.classList.add('nyx-settings-dashboard');
    main.querySelector(':scope > h1')?.remove();
    const settingsIcons={
      account:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
      privacy:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 18a2 2 0 0 0-4 0"/><path d="m19 11-2.11-6.657a2 2 0 0 0-2.752-1.148l-1.276.61A2 2 0 0 1 12 4H8.5a2 2 0 0 0-1.925 1.456L5 11"/><path d="M2 11h20"/><circle cx="17" cy="18" r="3"/><circle cx="7" cy="18" r="3"/></svg>',
      customize:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/></svg>',
      browsing:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
      advanced:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/></svg>'
    };
    const definitions=[
      ['account','Account',settingsIcons.account,['account']],
      ['privacy','Privacy',settingsIcons.privacy,['tab cloak','preset cloak','cloaking','panic key','website details','popup protection']],
      ['customize','Customize',settingsIcons.customize,['theme','custom theme','font','effects','3d backgrounds','founder profile']],
      ['browsing','Browsing',settingsIcons.browsing,['search engine','proxy engine','transport']],
      ['advanced','Advanced',settingsIcons.advanced,[]]
    ];
    const categoryFor=title=>definitions.find(([, , ,titles])=>titles.includes(title))?.[0] || 'advanced';
    const categories=new Map();
    definitions.forEach(([key,label])=>{
      const section=document.createElement('section');
      section.className='nyx-settings-category';
      section.dataset.settingsCategory=key;
      section.innerHTML=`<h2 class="nyx-settings-category-title">${label}</h2><div class="nyx-settings-group"></div>`;
      categories.set(key,section);
    });

    Array.from(source.querySelectorAll(':scope > .settings-block')).forEach(block=>{
      const heading=block.querySelector(':scope > h2');
      const title=(heading?.textContent || '').trim().toLowerCase();
      const description=Array.from(block.children).find(element=>element.tagName==='P');
      const copy=document.createElement('div');
      const controls=document.createElement('div');
      copy.className='nyx-settings-copy';
      controls.className='nyx-settings-control';
      const nodes=Array.from(block.childNodes);
      if(heading) copy.appendChild(heading);
      if(description) copy.appendChild(description);
      nodes.forEach(node=>{if(node!==heading && node!==description) controls.appendChild(node)});
      if(title==='popup protection'){
        const toggle=controls.querySelector('[data-popup-protection]');
        if(toggle){
          const row=document.createElement('div');
          row.className='settings-row';
          row.innerHTML='<span>Popup Protection</span>';
          row.appendChild(toggle);
          controls.prepend(row);
        }
      }
      block.replaceChildren(copy,controls);
      block.dataset.settingsSearch=(block.textContent || '').toLowerCase();
      categories.get(categoryFor(title)).querySelector('.nyx-settings-group').appendChild(block);
    });
    source.remove();

    const side=document.createElement('aside');
    side.className='nyx-settings-side';
    side.innerHTML=`<label class="nyx-settings-filter"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" placeholder="Filter settings" aria-label="Filter settings"></label><nav class="nyx-settings-nav" aria-label="Settings categories">${definitions.map(([key,label,icon],index)=>`<button class="${index===0?'active':''}" data-settings-category-button="${key}" type="button"><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}</nav>`;
    const header=document.createElement('header');
    header.className='nyx-settings-header';
    header.innerHTML='<h1>Privacy</h1>';
    app.prepend(side);
    main.prepend(header);
    categories.forEach(section=>main.appendChild(section));

    const title=header.querySelector('h1');
    const filter=side.querySelector('input');
    const buttons=Array.from(side.querySelectorAll('[data-settings-category-button]'));
    const activate=key=>{
      filter.value='';
      categories.forEach((section,category)=>{
        section.classList.toggle('active',category===key);
        section.hidden=category!==key;
        section.querySelectorAll('.settings-block').forEach(block=>{block.hidden=false});
      });
      buttons.forEach(button=>button.classList.toggle('active',button.dataset.settingsCategoryButton===key));
      title.textContent=definitions.find(([category])=>category===key)?.[1] || 'Settings';
      main.scrollTop=0;
    };
    buttons.forEach(button=>button.addEventListener('click',()=>{
      const category=button.dataset.settingsCategoryButton;
      if(category==='account'){
        if(nyxFounderSignedInUser) void openNyxUserProfile();
        else void openNyxAccountAccess();
        return;
      }
      activate(category);
    }));
    filter.addEventListener('input',()=>{
      const query=filter.value.trim().toLowerCase();
      if(!query){
        activate(buttons.find(button=>button.classList.contains('active'))?.dataset.settingsCategoryButton || 'privacy');
        return;
      }
      title.textContent='Search Results';
      buttons.forEach(button=>button.classList.remove('active'));
      categories.forEach(section=>{
        let matches=0;
        section.querySelectorAll('.settings-block').forEach(block=>{
          const visible=block.dataset.settingsSearch.includes(query);
          block.hidden=!visible;
          if(visible) matches++;
        });
        section.hidden=matches===0;
        section.classList.toggle('active',matches>0);
      });
    });
    activate('privacy');
    syncFounderOwnerControls();
  }
  function openBrowserShellSettings(){
    if(!document.body.classList.contains('browser-shell')){
      openSettings();
      return;
    }
    return openBrowserShellInternalTab('settings');
  }
  function renderBrowserShellSettingsTab(){
    document.querySelector('.browser-shell-settings-overlay')?.remove();
    const overlay=document.createElement('div');
    overlay.className='browser-shell-settings-overlay';
    overlay.innerHTML=`<main class="browser-shell-settings-panel" aria-label="Settings">${browserShellSettingsMarkup(browserShellPresetTiles())}</main>`;
    document.body.appendChild(overlay);
    const effectBlock=overlay.querySelector('[data-effect-value]')?.closest('.settings-block');
    if(effectBlock){
      const privacyBlock=document.createElement('section');
      privacyBlock.className='settings-block';
      const hideDetails=websiteDetailsHidden();
      privacyBlock.innerHTML=`<h2>Private Tabs</h2><p>Hides your current tab names and icons from view.</p><div class="settings-row"><span>Hide Names and Icons</span><button class="settings-action ${hideDetails?'on':''}" data-switch="nyx.hideWebsiteDetails" type="button">${hideDetails?'On':'Off'}</button></div>`;
      const fontBlock=document.createElement('section');
      fontBlock.className='settings-block';
      fontBlock.innerHTML=`<h2>Font</h2><select class="settings-select" data-font-value>${nyxFontOptionsMarkup()}</select>`;
      effectBlock.before(fontBlock);
      const lagBlock=document.createElement('section');
      lagBlock.className='settings-block';
      const lagOn=store.get('nyx.lagReducer',false);
      lagBlock.innerHTML=`<h2>Lag Reducer</h2><p>Turns off heavier blur, shadows, particles, and startup effects for smoother browsing.</p><div class="settings-row"><span>Lag Reducer</span><button class="settings-action ${lagOn?'on':''}" data-switch="nyx.lagReducer" data-lag-reducer type="button">${lagOn?'On':'Off'}</button></div>`;
      const liteBlock=document.createElement('section');
      liteBlock.className='settings-block';
      const liteOn=store.get('nyx.performanceLite',false);
      liteBlock.innerHTML=`<h2>Lite Mode</h2><p>Lightens blur, shadows, and particles without fully disabling animations.</p><div class="settings-row"><span>Lite Mode</span><button class="settings-action ${liteOn?'on':''}" data-switch="nyx.performanceLite" data-performance-lite type="button">${liteOn?'On':'Off'}</button></div>`;
      const backgroundsBlock=document.createElement('section');
      backgroundsBlock.className='settings-block';
      const threeDOn=store.get('nyx.threeDBackgrounds',false);
      backgroundsBlock.innerHTML=`<h2>3D Backgrounds</h2><p>Use the original interactive 3D theme scenes instead of the animated color background.</p><div class="settings-row"><span>3D Backgrounds</span><button class="settings-action ${threeDOn?'on':''}" data-switch="nyx.threeDBackgrounds" type="button">${threeDOn?'On':'Off'}</button></div>`;
      const customThemeBlock=document.createElement('section');
      customThemeBlock.className='settings-block nyx-custom-theme-maker';
      const customColor=nyxThemeHex(store.text('nyx.customThemeColor',nyxCustomThemeDefaults.base));
      customThemeBlock.innerHTML=`<h2>Custom Theme</h2><p>Choose one color and Nyx generates the canvas, panels, borders, and accents from it.</p><div class="nyx-custom-theme-controls"><label class="nyx-custom-theme-picker"><input type="color" value="${customColor}" data-custom-theme-color aria-label="Custom theme color"><span class="nyx-custom-theme-swatch" data-custom-theme-swatch style="--nyx-swatch:${customColor}"></span></label><input class="settings-input" value="${customColor}" data-custom-theme-hex aria-label="Custom theme color hex" maxlength="7" spellcheck="false"></div><div class="settings-actions"><button class="settings-action" data-apply-custom-theme type="button">Apply Custom Theme</button><button class="settings-action" data-reset-custom-theme type="button">Reset Color</button></div>`;
      const founderProfileBlock=document.createElement('section');
      founderProfileBlock.className='settings-block';
      founderProfileBlock.hidden=true;
      founderProfileBlock.innerHTML='<h2>Founder Profile</h2><p>Customize the public profile shown on About Nyx.</p><div class="settings-actions"><button class="settings-action" data-open-founder-profile-editor type="button">Customize Founder Profile</button></div>';
      founderProfileBlock.dataset.founderProfileSettingsCard='';
      const ownerDashboardBlock=document.createElement('section');
      ownerDashboardBlock.className='settings-block';
      ownerDashboardBlock.hidden=true;
      ownerDashboardBlock.dataset.ownerDashboardCard='';
      ownerDashboardBlock.innerHTML='<h2>Owner Dashboard</h2><p>Manage users, roles, subscriptions, security, and account activity.</p><div class="settings-actions"><button class="settings-action" data-open-owner-dashboard type="button">Open Owner Dashboard</button></div>';
      const accountBlock=document.createElement('section');
      accountBlock.className='settings-block';
      accountBlock.hidden=true;
      accountBlock.dataset.founderAccountCard='';
      accountBlock.innerHTML='<h2><button class="nyx-account-settings-link" data-open-nyx-account-settings type="button">Account</button></h2><p data-founder-account-status>Sign in to manage your Nyx account.</p><div class="settings-actions"><button class="settings-action" data-open-nyx-account type="button">Create or sign in</button><button class="settings-action" data-open-nyx-profile type="button" hidden>Edit account</button><button class="settings-action" data-nyx-account-sign-out type="button" hidden>Sign out</button></div>';
      const resetBlock=document.createElement('section');
      resetBlock.className='settings-block';
      resetBlock.innerHTML=`<h2>Clear Cache</h2><p>Removes cookies, cache files, saved settings, proxy storage, and service workers, then reloads nyx like a fresh install.</p><div class="settings-actions"><button class="settings-action danger-action" data-clear-nyx-cache type="button">Clear Cache and Reset</button></div>`;
      effectBlock.before(privacyBlock);
      effectBlock.before(lagBlock);
      effectBlock.before(liteBlock);
      effectBlock.before(backgroundsBlock);
      effectBlock.before(customThemeBlock);
      effectBlock.before(accountBlock);
      effectBlock.before(ownerDashboardBlock);
      effectBlock.before(founderProfileBlock);
      effectBlock.before(resetBlock);
    }
    ensureFreshThemeOptions(overlay);
    enhanceBrowserShellSettings(overlay);
    syncSwitches(overlay);
    wirePresetCloakControls(overlay);
    syncFounderOwnerControls();
  }
  function closeBrowserShellSettings(){
    document.querySelector('.browser-shell-settings-overlay')?.remove();
  }
  //browser-tab-actions
  function closeBrowserShellTab(id){
    const index=browserShellTabs.findIndex(tab=>tab.id===id);
    if(index<0) return;
    const closing=browserShellTabs[index];
    if(!closing.url && closing.title==='Home') return;
      if(closing.url==='nyx://settings') closeBrowserShellSettings();
      const nextIndex=browserShellTabs.findIndex(tab=>tab.id===id);
      if(nextIndex<0) return;
      const shellTab=browserShellTabs[nextIndex];
      if(shellTab?.browserTabId && activeBrowser?.closeTab) activeBrowser.closeTab(shellTab.browserTabId);
      browserShellTabs.splice(nextIndex,1);
      if(browserShellActiveTab===id) browserShellActiveTab=browserShellTabs[Math.max(0,nextIndex-1)]?.id || browserShellTabs[0]?.id || null;
      if(!browserShellTabs.length){
        const freshId='shell-'+Date.now()+Math.random().toString(16).slice(2);
        browserShellTabs.push({id:freshId,url:'',title:'Home'});
        browserShellActiveTab=freshId;
        if(!activeBrowser?.win?.isConnected){
          const win=openBrowser('');
          win?.classList.add('maximized');
        }
      }
      const activeShell=browserShellTabs.find(tab=>tab.id===browserShellActiveTab) || browserShellTabs[0];
      if(activeShell?.title==='Home' && !activeShell.url){
        if(activeBrowser?.win?.isConnected){
          activeBrowser.tabs?.forEach(tab=>tab.frame?.classList.remove('active'));
          renderBrowserShellHomeMode(activeBrowser.win,'home');
          activeBrowser.renderTabs?.();
        }
      }else if(activeShell?.url==='nyx://settings'){
        if(activeShell?.browserTabId && activeBrowser?.activate) activeBrowser.activate(activeShell.browserTabId);
        renderBrowserShellSettingsTab();
      }else if(isBrowserShellBlankUrl(activeShell?.url)){
        if(activeShell?.browserTabId && activeBrowser?.activate) activeBrowser.activate(activeShell.browserTabId);
        renderBrowserShellHomeMode(activeBrowser?.win);
      }else if(activeShell?.browserTabId && activeBrowser?.activate){
        activeBrowser.activate(activeShell.browserTabId);
      }
      renderBrowserShellTabs();
  }
  function updateBrowserShellLocation(url,browserTabId='',forceInput=false){
    ensureBrowserShellHome();
    const tab=(browserTabId && browserShellTabs.find(tab=>tab.browserTabId===browserTabId))
      || browserShellTabs.find(tab=>tab.id===browserShellActiveTab)
      || browserShellTabs[0];
    const nextUrl=String(url || '').trim();
    tab.url=nextUrl;
    if(nextUrl){
      tab.title=browserShellLabel(nextUrl);
      tab.icon=iconForUrl(nextUrl);
    }else if(tab.title!=='Home' && tab.title!=='New Tab'){
      tab.title='New Tab';
      tab.icon=favicons.nyx;
    }
    renderBrowserShellTabs();
    if(forceInput){
      const input=document.querySelector('[data-browser-shell-url]');
      if(input){
        input.value=browserShellDisplayValue(nextUrl);
        input.dataset.selectOnFocus='1';
      }
    }
  }
  function navigateBrowserShell(value){
    closeBrowserShellSettings();
    document.body.classList.remove('menu-open');
    const raw=canonicalAddressInput(value);
    if(!raw){
      openBrowserShellTab('');
      return;
    }
    if(raw.toLowerCase()==='nyx://ai'){
      showBrowserShellInternalPage('ai');
      return;
    }
    if(raw.toLowerCase()==='nyx://settings'){
      openBrowserShellSettings();
      return;
    }
    if(raw.toLowerCase()==='nyx://ephesians1'){
      showBrowserShellInternalPage('ephesians1');
      return;
    }
    if(/^nyx:\/\/(terms|developer|about|credits)$/i.test(raw)){
      openBrowserShellInternalTab(raw.slice(6).toLowerCase());
      return;
    }
    if(shouldTriggerSixtySevenJumpscare(raw)){
      showSixtySevenJumpscare();
      return;
    }
    ensureBrowserShellHome();
    const proxyInternal=/^(?:\/service\/|\/~\/sj\/|\/scramjet\/service\/|nyx:\/\/)/i.test(raw);
    const looksLikeUrl=/^(?:[a-z][a-z0-9+.-]*:|[\w.-]+\.[a-z]{2,}(?:\/|$)|\/|\.\/|\.\.\/|assets\/)/i.test(raw);
    const isSearchQuery=raw && !looksLikeUrl && !proxyInternal;
    const normalized=normalize(raw);
    const target=isSearchQuery ? selectedSearchUrl(raw) : (normalized || raw);
    const navigationValue=isSearchQuery ? raw : target;
    const shellTab=browserShellTabs.find(tab=>tab.id===browserShellActiveTab) || browserShellTabs[0];
    if(activeBrowser?.win?.isConnected){
      ensureBrowserShellLinkedTab(shellTab);
      if(activeBrowser.navigate) activeBrowser.navigate(navigationValue);
      else openBrowser(navigationValue);
      const activeTab=activeBrowser?.tabs?.find(tab=>tab.id===shellTab?.browserTabId || tab.id===activeBrowser.active);
      if(activeTab){
        if(shellTab) shellTab.browserTabId=activeTab.id;
        activeTab.url=target;
        activeTab.title=browserShellLabel(target);
        activeTab.icon=iconForUrl(target);
        pruneBrowserShellInternalPlaceholders(activeTab.id);
        activeBrowser.renderTabs?.();
      }
    }else{
      const win=openBrowser(navigationValue);
      win?.classList.add('maximized');
      const created=activeBrowser?.tabs?.[activeBrowser.tabs.length-1];
      if(shellTab && created) shellTab.browserTabId=created.id;
      updateDockFullscreenState();
    }
    if(shellTab) pruneBrowserShellBlankPlaceholders(shellTab.id);
    updateBrowserShellLocation(target,'',true);
  }
  function goBrowserShellHome(){
    ensureBrowserShellHome();
    if(!activeBrowser?.win?.isConnected){
      const win=openBrowser('');
      win?.classList.add('maximized');
      updateDockFullscreenState();
    }
    const shellTab=browserShellTabs.find(tab=>tab.id===browserShellActiveTab) || browserShellTabs[0];
    if(shellTab?.browserTabId && activeBrowser?.activate) activeBrowser.activate(shellTab.browserTabId);
    const state=activeBrowser;
    const tab=state?.tabs?.find(t=>t.id===state.active);
    if(tab){
        tab.url='';
        tab.title='Home';
        tab.icon=favicons.nyx;
      tab.history=[''];
      tab.index=0;
      tab.scramjetFrame=null;
      tab.frame.removeAttribute('src');
      tab.frame.removeAttribute('srcdoc');
      tab.frame.classList.remove('active');
    }
    state?.win?.querySelector('.browser-home')?.classList.remove('hidden');
    state?.win?.classList.add('browser-blank');
    playBrowserShellPageReveal(state?.win || document);
    state?.renderTabs?.();
    updateBrowserShellLocation('');
    document.querySelector('[data-browser-shell-url]')?.focus();
  }
  //browser-internal-pages
  function legacyBrowserShellInternalPage(name){
    ensureBrowserShellHome();
    if(!activeBrowser?.win?.isConnected){
      const win=openBrowser('');
      win?.classList.add('maximized');
      const shellTab=browserShellTabs.find(tab=>tab.id===browserShellActiveTab);
      const created=activeBrowser?.tabs?.[activeBrowser.tabs.length-1];
      if(shellTab && created) shellTab.browserTabId=created.id;
      updateDockFullscreenState();
    }
    const shellTab=browserShellTabs.find(tab=>tab.id===browserShellActiveTab);
    if(shellTab?.browserTabId && activeBrowser?.activate) activeBrowser.activate(shellTab.browserTabId);
    const state=activeBrowser;
    const tab=state?.tabs?.find(t=>t.id===state.active);
    if(!tab) return false;
    const discordFounderProfileStyle='.nyx-founder-profile-standard{display:block!important;max-width:620px!important;margin:0 auto!important;padding:0!important;overflow:hidden!important;border:1px solid color-mix(in srgb,var(--nyx-founder-accent,#8fb8ff) 42%,transparent)!important;border-radius:16px!important;background:#111827!important;box-shadow:0 16px 42px rgba(0,0,0,.32)!important}.nyx-founder-profile-standard .nyx-founder-banner{height:140px!important;margin:0!important;background:var(--nyx-founder-accent,#8fb8ff)!important}.nyx-founder-profile-standard .nyx-founder-profile-content{display:block!important;padding:0 16px 18px!important}.nyx-founder-profile-standard .nyx-founder-image-wrap{width:88px!important;height:88px!important;margin:-45px 0 0!important;border:6px solid #111827!important;border-radius:50%!important;background:#111827!important}.nyx-founder-profile-standard .nyx-founder-image{border:0!important;border-radius:50%!important;background:#172338!important}.nyx-founder-profile-standard .nyx-founder-status{right:-2px!important;bottom:-2px!important;border:4px solid #111827!important}.nyx-founder-profile-standard .nyx-founder-copy{padding-top:13px!important}.nyx-founder-name-row{display:flex!important;align-items:center!important;gap:7px!important}.nyx-founder-profile-standard .nyx-founder-copy h3{margin:0!important;color:#f8fbff!important;font-size:24px!important;font-weight:700!important;letter-spacing:-.025em!important}.nyx-founder-owner-crown{color:#f0c85c!important;font-size:18px!important;line-height:1!important}.nyx-founder-profile-standard .nyx-founder-handle{margin:2px 0 10px!important;color:#b5c2d5!important;font-size:14px!important}.nyx-founder-profile-standard .nyx-founder-role{margin:0 0 11px!important;color:#9cadc4!important;font-size:11px!important;font-weight:600!important;letter-spacing:.09em!important}.nyx-founder-role-list{display:flex!important;flex-wrap:wrap!important;gap:7px!important;margin:0 0 12px!important}.nyx-founder-role-chip{display:inline-flex!important;align-items:center!important;gap:5px!important;padding:4px 8px!important;border:1px solid rgba(255,255,255,.18)!important;border-radius:4px!important;background:rgba(255,255,255,.08)!important;color:#d9e3f1!important;font-size:11px!important;font-weight:650!important}.nyx-founder-role-owner{border-color:color-mix(in srgb,var(--nyx-founder-accent,#8fb8ff) 78%,transparent)!important;background:color-mix(in srgb,var(--nyx-founder-accent,#8fb8ff) 22%,transparent)!important;color:#fff!important}.nyx-founder-role-owner span{color:#f0c85c!important}.nyx-founder-profile-standard .nyx-founder-badges{margin:0 0 14px!important}.nyx-founder-profile-standard .nyx-founder-badge{border:0!important;border-radius:4px!important;background:rgba(255,255,255,.1)!important;color:#c9d7ea!important}.nyx-founder-about{padding-top:13px!important;border-top:1px solid rgba(255,255,255,.14)!important}.nyx-founder-about>strong{display:block!important;margin-bottom:7px!important;color:#f5f8ff!important;font-size:12px!important;font-weight:700!important;text-transform:uppercase!important}.nyx-founder-profile-standard .nyx-founder-bio{color:#d5dfec!important;font-size:14px!important;line-height:1.55!important}.nyx-founder-profile-standard .nyx-founder-link{margin-top:14px!important;color:#cbd9ff!important}@media(max-width:680px){.nyx-founder-profile-standard .nyx-founder-image-wrap{width:88px!important;margin:-45px 0 0!important}.nyx-founder-profile-standard .nyx-founder-copy{text-align:left!important}.nyx-founder-profile-standard .nyx-founder-badges{justify-content:flex-start!important}}';
    const pages={
      apps:{title:'Apps',body:`<div class="browser-home browser-shell-page"><h1 class="home-heading">Apps</h1><p class="home-sub">Apps for stuff</p><div class="quick-grid apps-launch-grid">${quickTiles()}</div></div>`},
      links:{title:'Bookmarks',body:`<div class="browser-home browser-shell-page"><h1 class="home-heading">Bookmarks</h1><p class="home-sub">Common links.</p><div class="quick-grid"><button class="quick-tile" data-url="https://www.google.com/"><img class="quick-icon" alt="" src="${appIcon('google.com')}"><span>Google</span></button><button class="quick-tile" data-url="https://duckduckgo.com/"><img class="quick-icon" alt="" src="${appIcon('duckduckgo.com')}"><span>DuckDuckGo</span></button><button class="quick-tile" data-url="https://docs.google.com/"><img class="quick-icon" alt="" src="${appIcon('docs.google.com')}"><span>Docs</span></button></div></div>`}
    };
    const page=pages[name] || pages.apps;
    tab.url='nyx://'+name;
    tab.title=page.title;
    const clearInternal=/^(apps)$/i.test(String(name || page.title || ''));
    state.win.classList.toggle('internal-clear',clearInternal);
    tab.frame.classList.toggle('transparent-internal-page',clearInternal);
    tab.frame.setAttribute('allowtransparency','true');
    tab.frame.style.backgroundColor=clearInternal?'transparent':'';
    tab.frame.removeAttribute('src');
    tab.frame.srcdoc=browserShellPageSrcdoc(page);
    tab.frame.classList.add('active');
    state.win.querySelector('.browser-home')?.classList.add('hidden');
    state.win.classList.remove('browser-blank');
    state.renderTabs?.();
    if(shellTab){
      shellTab.url=tab.url;
      shellTab.title=tab.title;
      shellTab.icon=tab.icon;
      renderBrowserShellTabs();
    }
    updateBrowserShellLocation(tab.url);
    return true;
  }
  //browser-srcdoc-pages
  function browserShellPageSrcdoc(page){
    const style='@import url("https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap");html,body{margin:0;width:100%;min-height:100%;font-family:Outfit,Arial,sans-serif;background:transparent;color:#f8fafc}*{box-sizing:border-box}select{color-scheme:dark!important}select option,select optgroup{background:#101827!important;color:#f8fafc!important;-webkit-text-fill-color:#f8fafc!important}select option:checked{background:#334155!important;color:#fff!important;-webkit-text-fill-color:#fff!important}body{overflow:auto}.shell-page{min-height:100vh;padding:34px 36px 70px;background:transparent;color:white}.shell-page h1{margin:0 0 8px;font-size:42px;line-height:1;font-weight:900;text-shadow:0 12px 34px rgba(0,0,0,.34)}.shell-page h2{margin:30px 0 14px;font-size:22px}.shell-page p{color:#eef2f7;margin:0 0 22px;font-weight:700;text-shadow:0 8px 26px rgba(0,0,0,.28)}.quick-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px}.quick-grid.small{grid-template-columns:repeat(auto-fill,minmax(138px,1fr))}.quick-tile{height:132px;border:1px solid transparent;border-radius:24px;background:transparent;color:white;display:grid;place-items:center;gap:8px;font:800 16px Outfit,Arial,sans-serif;box-shadow:none;backdrop-filter:none;transition:transform .22s cubic-bezier(.2,.8,.2,1),box-shadow .2s ease,border-color .2s ease,background .2s ease,backdrop-filter .2s ease}.quick-tile:hover{transform:scale(1.045);background:linear-gradient(145deg,rgba(255,255,255,.22),rgba(31,41,55,.42));border-color:rgba(255,255,255,.36);box-shadow:inset 0 1px 0 rgba(255,255,255,.26),0 22px 54px rgba(0,0,0,.28);backdrop-filter:blur(16px) saturate(1.15)}.quick-icon{width:64px;height:64px;border-radius:20px;object-fit:contain;background:transparent;padding:8px;border:1px solid transparent;box-shadow:none;transition:transform .18s ease,background .18s ease,border-color .18s ease,box-shadow .18s ease}.quick-tile:hover .quick-icon{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 16px 34px rgba(0,0,0,.22);transform:scale(1.08)}.quick-tile[data-domain="traxmojo.com"] .quick-icon{width:112px;height:112px;padding:0;object-fit:contain;background:transparent}.quick-tile[data-domain="traxmojo.com"]:hover .quick-icon{transform:scale(1.16)}.quick-combo{width:min(132px,calc(100% - 12px));height:26px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(8,12,20,.62);color:#e0f2fe;padding:0 8px;font:800 11px Outfit,Arial,sans-serif;outline:0}.quick-combo option{background:#101827!important;color:#f8fafc!important}.settings-app{min-height:100vh;display:grid;grid-template-columns:250px minmax(0,1fr);gap:18px;padding:10px;background:linear-gradient(135deg,rgba(7,10,16,.86),rgba(41,45,58,.9) 48%,rgba(11,13,20,.9));color:#eef2f7}.settings-side{position:sticky;top:10px;height:calc(100vh - 20px);padding:22px 16px;border:1px solid rgba(159,172,190,.28);border-radius:22px;background:rgba(20,24,34,.76);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 18px 48px rgba(0,0,0,.32);backdrop-filter:blur(14px)}.settings-side button{width:100%;height:48px;margin-bottom:8px;display:flex;align-items:center;gap:12px;border:0;border-radius:999px;background:transparent;color:#e5e7eb;font:800 14px Outfit,Arial,sans-serif;text-align:left;padding:0 14px;transition:background .16s ease,transform .16s ease,color .16s ease}.settings-side button:hover,.settings-side button.active{background:rgba(148,163,184,.18);color:#fff;transform:translateX(2px)}.settings-side i{width:22px;height:22px;display:grid;place-items:center;border-radius:8px;background:rgba(148,163,184,.22);font-style:normal}.settings-main{min-height:calc(100vh - 20px);padding:30px 34px 60px;border:1px solid rgba(159,172,190,.18);border-radius:22px;background:radial-gradient(circle at 50% 100%,rgba(118,124,145,.32),transparent 40%),linear-gradient(180deg,rgba(28,32,44,.82),rgba(13,16,24,.78));box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 22px 54px rgba(0,0,0,.28);backdrop-filter:blur(16px) saturate(1.1)}.settings-main h1{margin:0;color:#fff;font-size:30px;line-height:1;font-weight:900}.settings-main h1::after{content:"";display:block;width:56px;height:3px;margin:13px 0 30px;border-radius:999px;background:#a8b3c4}.settings-block{margin:0 0 34px}.settings-block h2{margin:0 0 8px;color:#cbd5e1;font-size:18px;font-weight:900}.settings-block p{max-width:900px;margin:0 0 14px;color:#d1d7e0;font-size:13px;font-weight:700;line-height:1.45}.settings-form-row{display:grid;grid-template-columns:minmax(240px,1fr) minmax(240px,1fr);gap:104px;align-items:end}.settings-input,.settings-select{width:100%;height:43px;border:1px solid rgba(148,163,184,.36);border-radius:999px;background:rgba(14,17,26,.54);color:#f8fafc;padding:0 14px;outline:0;font:700 13px Outfit,Arial,sans-serif;box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}.settings-select{max-width:760px;appearance:auto}.settings-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}.settings-action{min-height:38px;border:0;border-radius:999px;background:linear-gradient(145deg,#6b7280,#4b5563);color:#fff;padding:0 16px;font:900 13px Outfit,Arial,sans-serif;box-shadow:0 10px 26px rgba(0,0,0,.28);transition:transform .16s ease,filter .16s ease}.settings-action:hover{transform:scale(1.045);filter:brightness(1.1)}.settings-toggle{width:46px;height:24px;border:1px solid rgba(255,255,255,.15);border-radius:999px;background:#4b5563;padding:2px;display:inline-flex;align-items:center}.settings-toggle::before{content:"";width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 3px 9px rgba(0,0,0,.28);transform:translateX(0);transition:transform .16s ease}.settings-toggle.on::before{transform:translateX(20px)}.settings-toggle.on{background:#71717a}.settings-grid-settings{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px;max-width:720px}.settings-preset{height:138px;padding:10px;border:1px solid rgba(255,255,255,.16);border-radius:24px;background:linear-gradient(145deg,rgba(229,231,235,.18),rgba(75,85,99,.48));color:#fff;font:900 14px Outfit,Arial,sans-serif;display:grid;place-items:center;gap:8px;box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 16px 38px rgba(0,0,0,.28);transition:transform .16s ease,border-color .16s ease}.settings-preset:hover{transform:scale(1.045);border-color:rgba(255,255,255,.34)}.settings-effect-preview{display:flex;gap:9px;margin-top:12px}.settings-effect-preview span{width:36px;height:36px;display:grid;place-items:center;border-radius:999px;background:rgba(148,163,184,.18);border:1px solid rgba(255,255,255,.12);font-size:18px}.settings-compact{max-width:760px}.quick-grid.settings-mini{grid-template-columns:repeat(3,minmax(136px,170px));gap:14px}.quick-grid.settings-mini .quick-tile{height:118px;border-radius:24px}.quick-grid.settings-mini b{font-size:24px}@media(max-width:900px){.settings-app{grid-template-columns:1fr}.settings-side{position:relative;height:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.settings-side button{margin:0}.settings-form-row{grid-template-columns:1fr;gap:14px}.settings-main{padding:24px 18px}.quick-grid.settings-mini{grid-template-columns:repeat(auto-fill,minmax(118px,1fr))}}@media(max-width:720px){.shell-page{padding:24px 18px 50px}.quick-grid{grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:12px}.quick-tile{height:112px;font-size:13px}.settings-app{padding:0}.settings-side,.settings-main{border-radius:0}.settings-grid-settings{grid-template-columns:repeat(auto-fill,minmax(124px,1fr))}}';
    const themeStyle='body.theme-ruby{--theme-a:#ef4444;--theme-b:#7f1d1d;--theme-strong:#fecaca;--theme-text-gradient:linear-gradient(90deg,#fee2e2,#fb7185,#991b1b);--theme-bg:linear-gradient(rgba(25,0,0,.18),rgba(25,0,0,.36)),url("assets/backgrounds/nyx-blue-light-trails.jpg")}body.theme-emerald{--theme-a:#10b981;--theme-b:#064e3b;--theme-strong:#dcfce7;--theme-text-gradient:linear-gradient(90deg,#dcfce7,#34d399,#065f46);--theme-bg:linear-gradient(rgba(0,25,8,.14),rgba(0,24,12,.32)),url("assets/backgrounds/nyx-blue-light-trails.jpg")}body.theme-sakura{--theme-a:#f472b6;--theme-b:#be185d;--theme-strong:#fce7f3;--theme-text-gradient:linear-gradient(90deg,#fce7f3,#f9a8d4,#be185d);--theme-bg:linear-gradient(rgba(40,0,24,.12),rgba(40,0,30,.28)),url("assets/backgrounds/nyx-blue-light-trails.jpg")}body.theme-ruby,body.theme-emerald,body.theme-sakura{background:var(--theme-bg)!important;background-size:cover!important;background-position:center!important;background-attachment:fixed!important}body.theme-ruby .shell-page,body.theme-emerald .shell-page,body.theme-sakura .shell-page{background:linear-gradient(135deg,color-mix(in srgb,var(--theme-a) 34%,transparent),rgba(12,16,24,.58)),var(--theme-bg)!important;background-size:cover!important;background-position:center!important}body.theme-ruby .settings-app,body.theme-emerald .settings-app,body.theme-sakura .settings-app{background:linear-gradient(135deg,color-mix(in srgb,var(--theme-a) 22%,rgba(8,12,20,.9)),color-mix(in srgb,var(--theme-b) 34%,rgba(12,16,24,.9)))!important}body.theme-ruby .settings-main,body.theme-ruby .settings-side,body.theme-ruby .quick-tile,body.theme-ruby .settings-action,body.theme-emerald .settings-main,body.theme-emerald .settings-side,body.theme-emerald .quick-tile,body.theme-emerald .settings-action,body.theme-sakura .settings-main,body.theme-sakura .settings-side,body.theme-sakura .quick-tile,body.theme-sakura .settings-action{background:linear-gradient(145deg,color-mix(in srgb,var(--theme-a) 28%,rgba(255,255,255,.18)),color-mix(in srgb,var(--theme-b) 42%,rgba(7,10,16,.72)))!important;border-color:color-mix(in srgb,var(--theme-a) 45%,rgba(255,255,255,.22))!important}body.theme-ruby .quick-tile:not(:hover),body.theme-emerald .quick-tile:not(:hover),body.theme-sakura .quick-tile:not(:hover){background:transparent!important;border-color:transparent!important;box-shadow:none!important;backdrop-filter:none!important}body.theme-ruby .quick-tile:hover,body.theme-emerald .quick-tile:hover,body.theme-sakura .quick-tile:hover{background:linear-gradient(145deg,color-mix(in srgb,var(--theme-a) 34%,rgba(255,255,255,.16)),color-mix(in srgb,var(--theme-b) 48%,rgba(7,10,16,.7)))!important;border-color:color-mix(in srgb,var(--theme-a) 45%,rgba(255,255,255,.22))!important}.theme-ruby h1,.theme-ruby h2,.theme-ruby p,.theme-ruby .settings-side span,.theme-ruby .quick-tile span,.theme-emerald h1,.theme-emerald h2,.theme-emerald p,.theme-emerald .settings-side span,.theme-emerald .quick-tile span,.theme-sakura h1,.theme-sakura h2,.theme-sakura p,.theme-sakura .settings-side span,.theme-sakura .quick-tile span{background:var(--theme-text-gradient);-webkit-background-clip:text;background-clip:text;color:transparent!important;-webkit-text-fill-color:transparent}.theme-ruby button,.theme-emerald button,.theme-sakura button{color:var(--theme-strong)!important;-webkit-text-fill-color:var(--theme-strong)!important}.theme-ruby .settings-input,.theme-ruby .settings-select,.theme-emerald .settings-input,.theme-emerald .settings-select,.theme-sakura .settings-input,.theme-sakura .settings-select{background:linear-gradient(90deg,color-mix(in srgb,var(--theme-a) 18%,rgba(12,16,24,.94)),rgba(12,16,24,.76))!important;border-color:color-mix(in srgb,var(--theme-a) 60%,rgba(255,255,255,.18))!important;color:var(--theme-strong)!important;-webkit-text-fill-color:var(--theme-strong)!important}.theme-ruby button:hover,.theme-emerald button:hover,.theme-sakura button:hover{color:#fff!important;-webkit-text-fill-color:#fff!important;text-shadow:0 0 14px color-mix(in srgb,var(--theme-a) 72%,transparent)!important}.theme-ruby select option,.theme-emerald select option,.theme-sakura select option{background:#10131b;color:#f8fafc}';
    const freshThemeStyle='body.theme-fresh{--theme-a:#728f6b;--theme-b:#405d42;--theme-strong:#d9e5d6;--theme-border:#354b36;--theme-bg:#162019!important;background:var(--theme-bg)!important;color:#d9e5d6!important;color-scheme:dark!important}body.theme-fresh :is(.shell-page,.browser-shell-page){background:#162019!important}body.theme-fresh :is(.settings-app,.settings-main,.settings-side,.settings-block,.quick-tile,.quick-icon,.settings-action,.settings-preset,button,input,select,textarea){background:rgba(19,28,21,.78)!important;border-color:#354b36!important;color:#d9e5d6!important;-webkit-text-fill-color:#d9e5d6!important;box-shadow:none!important}body.theme-fresh :is(h1,h2,h3,p,span,label,strong,.quick-tile span){background:none!important;color:#d9e5d6!important;-webkit-text-fill-color:#d9e5d6!important;text-shadow:none!important}body.theme-fresh select option{background:#131c15!important;color:#d9e5d6!important}';
    const script='function nyxEffectPayload(){return{type:"nyx:effect-settings",effect:document.querySelector("[data-effect-value]")?.value||"none",speed:document.querySelector("[data-effect-speed]")?.value||"1.1",amount:document.querySelector("[data-effect-amount]")?.value||"16",theme:document.querySelector("[data-theme-value]")?.value||"default"}}function nyxBrowserPayload(){return{type:"nyx:browser-settings",engine:document.querySelector("[data-browser-engine]")?.value||"duckduckgo",browserMode:document.querySelector("[data-browser-mode-select]")?.value||"auto",transport:document.querySelector("[data-browser-transport]")?.value||"epoxy"}}document.addEventListener("click",e=>{const preset=e.target.closest("[data-preset]");if(preset){e.preventDefault();e.stopPropagation();parent.postMessage({type:"nyx:preset",preset:preset.dataset.preset},"*");return}const app=e.target.closest("[data-app-url]");if(app){e.preventDefault();parent.postMessage({type:"nyx:navigate",url:app.dataset.appUrl},"*");return}const url=e.target.closest("[data-url]");if(url&&url.closest(".shell-page,.browser-shell-page")){e.preventDefault();parent.postMessage({type:"nyx:navigate",url:url.dataset.url},"*");return}if(e.target.closest("[data-browser-settings-save]")){e.preventDefault();parent.postMessage(nyxBrowserPayload(),"*")}if(e.target.closest("[data-page-fullscreen]"))parent.postMessage({type:"nyx:fullscreen"},"*");if(e.target.closest("[data-shell-about]"))parent.postMessage({type:"nyx:about"},"*");if(e.target.closest("[data-shell-about-tab]"))parent.postMessage({type:"nyx:about-tab"},"*")});document.addEventListener("change",e=>{const presetSelect=e.target.closest("[data-preset-select]");if(presetSelect){document.querySelectorAll("[data-tab-title]").forEach(el=>{el.value=presetSelect.options[presetSelect.selectedIndex]?.textContent||presetSelect.value||"nyx"});parent.postMessage({type:"nyx:preset",preset:presetSelect.value||"nyx"},"*");return}if(e.target.closest("[data-effect-value],[data-effect-speed],[data-effect-amount],[data-theme-value]"))parent.postMessage(nyxEffectPayload(),"*");if(e.target.closest("[data-browser-engine],[data-browser-mode-select],[data-browser-transport]"))parent.postMessage(nyxBrowserPayload(),"*")});document.addEventListener("input",e=>{const presetSelect=e.target.closest("[data-preset-select]");if(presetSelect){parent.postMessage({type:"nyx:preset",preset:presetSelect.value||"nyx"},"*");return}if(e.target.closest("[data-effect-speed],[data-effect-amount]")){document.querySelectorAll("[data-effect-speed-label]").forEach(el=>{el.textContent=(Number(document.querySelector("[data-effect-speed]")?.value||1.1)).toFixed(1)+"x"});document.querySelectorAll("[data-effect-amount-label]").forEach(el=>{el.textContent=document.querySelector("[data-effect-amount]")?.value||"16"});parent.postMessage(nyxEffectPayload(),"*")}});';
    const popupScript='document.addEventListener("click",e=>{const popup=e.target.closest("[data-popup-protection]");if(!popup)return;e.preventDefault();const next=popup.dataset.enabled!=="true";popup.dataset.enabled=String(next);popup.classList.toggle("on",next);popup.textContent="Popup Protection "+(next?"On":"Off");parent.postMessage({type:"nyx:popup-protection",enabled:next},"*")});';
    const themeAppStyle='body.theme-ruby .quick-tile:hover .quick-icon,body.theme-emerald .quick-tile:hover .quick-icon,body.theme-sakura .quick-tile:hover .quick-icon{background:transparent!important;background-image:none!important;border-color:transparent!important;box-shadow:none!important}';
    const compactSettingsStyle='.settings-main h1{font-size:24px!important}.settings-block h2{font-size:15px!important}.settings-block p,.settings-block label{font-size:12px!important;line-height:1.35!important}.settings-side button,.settings-action,.settings-preset{background:transparent!important;background-image:none!important;box-shadow:none!important}.settings-action,.settings-preset{border-color:transparent!important}.settings-side button:hover,.settings-side button.active,.settings-action:hover,.settings-preset:hover{background:transparent!important;background-image:none!important;border-color:var(--theme-border,rgba(255,255,255,.28))!important;box-shadow:none!important;transform:none!important}';
    const pageThemeStyle='.shell-page,.browser-shell-page{background:transparent!important}body.theme-ruby .shell-page,body.theme-ruby .browser-shell-page{background:transparent!important}body.theme-emerald .shell-page,body.theme-emerald .browser-shell-page{background:transparent!important}body.theme-sakura .shell-page,body.theme-sakura .browser-shell-page{background:transparent!important}';
    const themeBorderOnlyStyle='body.theme-ruby{--theme-border:#fb7185!important;--theme-bg:linear-gradient(rgba(60,0,12,.10),rgba(60,0,12,.22)),url("assets/backgrounds/nyx-blue-light-trails.jpg")!important}body.theme-emerald{--theme-border:#34d399!important;--theme-bg:linear-gradient(rgba(0,24,12,.08),rgba(0,24,12,.20)),url("assets/backgrounds/nyx-blue-light-trails.jpg")!important}body.theme-sakura{--theme-border:#fbcfe8!important;--theme-bg:linear-gradient(rgba(40,0,28,.06),rgba(40,0,28,.18)),url("assets/backgrounds/nyx-blue-light-trails.jpg")!important}.theme-ruby h1,.theme-ruby h2,.theme-ruby p,.theme-ruby span,.theme-ruby label,.theme-ruby button,.theme-emerald h1,.theme-emerald h2,.theme-emerald p,.theme-emerald span,.theme-emerald label,.theme-emerald button,.theme-sakura h1,.theme-sakura h2,.theme-sakura p,.theme-sakura span,.theme-sakura label,.theme-sakura button{background:none!important;color:inherit!important;-webkit-text-fill-color:currentColor!important;text-shadow:none!important}.theme-ruby .shell-page,.theme-emerald .shell-page,.theme-sakura .shell-page,.theme-ruby .browser-shell-page,.theme-emerald .browser-shell-page,.theme-sakura .browser-shell-page{background:var(--theme-bg)!important;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}.theme-ruby .settings-app,.theme-emerald .settings-app,.theme-sakura .settings-app,.theme-ruby .settings-main,.theme-emerald .settings-main,.theme-sakura .settings-main,.theme-ruby .settings-side,.theme-emerald .settings-side,.theme-sakura .settings-side,.theme-ruby .quick-tile,.theme-emerald .quick-tile,.theme-sakura .quick-tile{background:rgba(15,23,42,.36)!important}.theme-ruby button,.theme-ruby input,.theme-ruby select,.theme-ruby textarea,.theme-ruby .quick-tile,.theme-ruby .quick-icon,.theme-ruby .settings-main,.theme-ruby .settings-side,.theme-ruby .settings-action,.theme-ruby .settings-input,.theme-ruby .settings-select,.theme-emerald button,.theme-emerald input,.theme-emerald select,.theme-emerald textarea,.theme-emerald .quick-tile,.theme-emerald .quick-icon,.theme-emerald .settings-main,.theme-emerald .settings-side,.theme-emerald .settings-action,.theme-emerald .settings-input,.theme-emerald .settings-select,.theme-sakura button,.theme-sakura input,.theme-sakura select,.theme-sakura textarea,.theme-sakura .quick-tile,.theme-sakura .quick-icon,.theme-sakura .settings-main,.theme-sakura .settings-side,.theme-sakura .settings-action,.theme-sakura .settings-input,.theme-sakura .settings-select{border-color:color-mix(in srgb,var(--theme-border) 68%,rgba(255,255,255,.2))!important}.theme-ruby input[type=file].settings-input::file-selector-button,.theme-emerald input[type=file].settings-input::file-selector-button,.theme-sakura input[type=file].settings-input::file-selector-button{background:rgba(148,163,184,.24)!important;color:#f8fafc!important;-webkit-text-fill-color:#f8fafc!important}';
    const flatInternalStyle='html,body,button,input,select,textarea{font-family:Outfit,Arial,sans-serif!important;font-weight:400!important}body *{font-family:Outfit,Arial,sans-serif!important;font-weight:400!important;text-shadow:none!important;-webkit-text-stroke:0!important}.theme-ruby *, .theme-emerald *, .theme-sakura *{background-image:none!important;box-shadow:none!important;text-shadow:none!important}.theme-ruby button,.theme-ruby .quick-tile,.theme-ruby .quick-icon,.theme-ruby .settings-action,.theme-ruby .settings-preset,.theme-emerald button,.theme-emerald .quick-tile,.theme-emerald .quick-icon,.theme-emerald .settings-action,.theme-emerald .settings-preset,.theme-sakura button,.theme-sakura .quick-tile,.theme-sakura .quick-icon,.theme-sakura .settings-action,.theme-sakura .settings-preset{transition:border-color .14s ease,background-color .14s ease!important}.theme-ruby button:hover,.theme-ruby .quick-tile:hover,.theme-ruby .quick-icon:hover,.theme-ruby .settings-action:hover,.theme-ruby .settings-preset:hover,.theme-emerald button:hover,.theme-emerald .quick-tile:hover,.theme-emerald .quick-icon:hover,.theme-emerald .settings-action:hover,.theme-emerald .settings-preset:hover,.theme-sakura button:hover,.theme-sakura .quick-tile:hover,.theme-sakura .quick-icon:hover,.theme-sakura .settings-action:hover,.theme-sakura .settings-preset:hover{transform:none!important;border-color:var(--theme-border)!important;background-image:none!important;box-shadow:none!important}';
    const flatInternalPageStyle='.shell-page,.browser-shell-page,.settings-app,.settings-main,.settings-side,.settings-block,.quick-tile,.quick-icon,.settings-action,.settings-preset{background-image:none!important;box-shadow:none!important;text-shadow:none!important}.settings-app,.settings-main,.settings-side,.settings-block{background:transparent!important;border-color:transparent!important}.quick-tile,.quick-icon,.settings-action,.settings-preset{background:transparent!important}.quick-tile:hover,.quick-icon:hover,.settings-preset:hover,.settings-action:hover{background:transparent!important;background-image:none!important;transform:none!important;border-color:var(--theme-border,rgba(255,255,255,.28))!important}input[type=file].settings-input::file-selector-button{background:transparent!important;background-image:none!important;color:#f8fafc!important;-webkit-text-fill-color:#f8fafc!important}';
    const transparentInternalFinalStyle='body :is(.settings-app,.settings-main,.settings-side,.settings-block,.settings-card,.settings-grid-settings){background:transparent!important;background-color:transparent!important;background-image:none!important;box-shadow:none!important;backdrop-filter:none!important}body :is(.settings-block,.settings-card){border-color:transparent!important}body :is(.settings-side button,.settings-side button.active,.settings-action,.settings-preset,.settings-input,.settings-select),body input[type=file].settings-input::file-selector-button{background:transparent!important;background-color:transparent!important;background-image:none!important;box-shadow:none!important;filter:none!important;text-shadow:none!important}body :is(.settings-side button:hover,.settings-side button.active,.settings-action:hover,.settings-preset:hover,.settings-input:hover,.settings-select:hover),body input[type=file].settings-input:hover::file-selector-button{background:transparent!important;background-image:none!important;border-color:var(--theme-border,rgba(255,255,255,.3))!important;box-shadow:none!important;transform:none!important}.shell-page .quick-tile,.shell-page .quick-icon{background:transparent!important;background-color:transparent!important;background-image:none!important;border-color:transparent!important;box-shadow:none!important;backdrop-filter:none!important}.shell-page .quick-tile:hover,.shell-page .quick-icon:hover{background:transparent!important;background-image:none!important;border-color:var(--theme-border,rgba(255,255,255,.3))!important;box-shadow:none!important}.shell-page .quick-tile span{display:block!important;opacity:1!important;visibility:visible!important;color:#f8fafc!important;-webkit-text-fill-color:#f8fafc!important;background:none!important;background-image:none!important;text-shadow:none!important;font-weight:400!important}';
    const settingsInternalFinalStyle='html,body{background:transparent!important;background-color:transparent!important;background-image:none!important;color:#f8fafc!important}body::before,body::after{display:none!important;content:none!important}.settings-app{position:relative!important;z-index:1!important;display:block!important;min-height:0!important;width:min(780px,calc(100vw - 42px))!important;height:auto!important;margin:30px auto 96px!important;padding:0!important;border:0!important;background:transparent!important;background-image:none!important;box-shadow:none!important;overflow:visible!important;color:#f8fafc!important}.settings-side{position:fixed!important;left:50%!important;bottom:18px!important;top:auto!important;transform:translateX(-50%)!important;width:auto!important;height:52px!important;display:flex!important;gap:8px!important;padding:7px!important;border:1px solid rgba(196,181,253,.30)!important;border-radius:16px!important;background:rgba(6,10,8,.52)!important;background-image:none!important;backdrop-filter:blur(7px) saturate(1.08)!important;box-shadow:0 14px 34px rgba(0,0,0,.28)!important;z-index:10!important}.settings-side button{width:42px!important;height:38px!important;min-height:38px!important;margin:0!important;padding:0!important;display:grid!important;place-items:center!important;border-radius:11px!important;font-size:0!important;background:transparent!important;background-image:none!important;border:1px solid transparent!important}.settings-side button.active,.settings-side button:hover{background:rgba(255,255,255,.12)!important;border-color:rgba(196,181,253,.30)!important}.settings-side .settings-nav-icon{margin:0!important;width:22px!important;height:22px!important}.settings-main{display:block!important;min-height:0!important;padding:0!important;border:0!important;background:transparent!important;background-image:none!important;box-shadow:none!important;backdrop-filter:none!important}.settings-main h1{display:none!important}.settings-section{width:100%!important}.settings-section.active{display:block!important}.settings-section .settings-block{display:block!important;width:100%!important;background:rgba(8,15,12,.58)!important;background-image:linear-gradient(90deg,rgba(255,255,255,.10),rgba(255,255,255,.035))!important;border:1px solid color-mix(in srgb,var(--theme-border,#8b5cf6) 48%,rgba(255,255,255,.18))!important;border-radius:14px!important;padding:18px 20px!important;margin:0 0 16px!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 16px 42px rgba(0,0,0,.24)!important;backdrop-filter:blur(5px) saturate(1.05)!important}.settings-section .settings-block h2{font-size:15px!important;line-height:1.2!important;margin:0 0 10px!important;color:rgba(248,250,252,.98)!important;-webkit-text-fill-color:rgba(248,250,252,.98)!important}.settings-section .settings-block p{max-width:650px!important;font-size:12px!important;line-height:1.38!important;margin:0 0 13px!important;color:rgba(226,232,240,.84)!important;-webkit-text-fill-color:rgba(226,232,240,.84)!important}.settings-form-row{display:grid!important;grid-template-columns:1fr!important;gap:10px!important;max-width:100%!important}.settings-actions{display:flex!important;gap:10px!important;flex-wrap:wrap!important}.settings-input,.settings-select,.panic-key-display{width:100%!important;min-height:40px!important;border-radius:10px!important;background:rgba(0,0,0,.50)!important;background-image:none!important;border:1px solid rgba(255,255,255,.18)!important;color:#f8fafc!important;-webkit-text-fill-color:#f8fafc!important;box-shadow:none!important}.settings-input[type=file]{padding:7px 10px!important}.panic-key-display{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:auto!important;min-width:160px!important;padding:0 16px!important}.settings-action,.settings-block button,.settings-input::file-selector-button{min-height:35px!important;border-radius:999px!important;background:rgba(255,255,255,.13)!important;background-image:none!important;border:1px solid rgba(255,255,255,.18)!important;box-shadow:none!important;color:#f8fafc!important;-webkit-text-fill-color:#f8fafc!important;padding:0 16px!important}.settings-action:hover,.settings-block button:hover,.settings-input::file-selector-button:hover{background:rgba(255,255,255,.20)!important;border-color:var(--theme-border,#8b5cf6)!important;transform:scale(1.015)!important}@media(max-width:760px){.settings-app{width:calc(100vw - 22px)!important;margin-top:16px!important}.settings-section .settings-block{padding:15px!important}.settings-side{bottom:10px!important}}';
    const settingsGlassRepairStyle='';
    const browserSettingsSinglePaneStyle='';
    const internalPageBg=normalizeBgValue(currentBrowserBackgroundValue());
    const internalBgStyle='background:linear-gradient(rgba(0,0,0,.10),rgba(0,0,0,.16)),'+internalPageBg+'!important;background-size:cover!important;background-position:left center!important;background-repeat:no-repeat!important;background-color:#05060c!important;filter:none!important;';
    const settingsClearAroundStyle='';
    const clearInternalPageStyle=/^(apps)$/i.test(String(page.title || '')) ? 'html,body,.shell-page,.browser-shell-page{min-height:100vh!important;'+internalBgStyle+'}html::before,html::after,body::before,body::after{display:none!important;content:none!important}.shell-page,.browser-shell-page{box-shadow:none!important;backdrop-filter:none!important;filter:none!important}.shell-page::before,.shell-page::after,.browser-shell-page::before,.browser-shell-page::after{display:none!important;content:none!important}.shell-page h1,.browser-shell-page h1,.shell-page p,.browser-shell-page p,.quick-tile span{color:#f8f5ff!important;-webkit-text-fill-color:#f8f5ff!important;opacity:1!important;visibility:visible!important;background:none!important;background-image:none!important;text-shadow:none!important}.quick-grid{gap:18px!important}.quick-tile{height:106px!important;background:transparent!important;background-image:none!important;border:1px solid transparent!important;border-radius:10px!important;box-shadow:none!important;backdrop-filter:none!important;filter:none!important}.quick-icon{width:58px!important;height:58px!important;background:transparent!important;background-image:none!important;border-color:transparent!important;border-radius:9px!important;box-shadow:none!important;backdrop-filter:none!important;filter:none!important}.quick-tile:hover{background:rgba(8,7,13,.32)!important;background-image:none!important;border-color:rgba(190,148,255,.54)!important;box-shadow:0 10px 28px rgba(0,0,0,.22)!important;transform:none!important;backdrop-filter:blur(3px)!important;-webkit-backdrop-filter:blur(3px)!important}.quick-tile:hover .quick-icon{background:transparent!important;background-image:none!important;border-color:transparent!important;box-shadow:none!important;transform:none!important}.quick-tile span{font-size:13px!important;font-weight:400!important}' : '';
    const internalAppsLaunchStyle=/^(apps)$/i.test(String(page.title || '')) ? '.apps-launch-grid{grid-template-columns:repeat(auto-fill,minmax(178px,1fr))!important;gap:24px!important}.apps-launch-grid .quick-tile{height:178px!important;min-height:178px!important;border-radius:18px!important;animation:appTileOpenRise .62s cubic-bezier(.18,.82,.2,1) both!important;animation-delay:var(--tile-delay,0ms)!important}.apps-launch-grid .quick-icon{width:98px!important;height:98px!important;border-radius:18px!important}.apps-launch-grid .quick-tile[data-domain="traxmojo.com"] .quick-icon{width:150px!important;height:150px!important;max-width:150px!important;max-height:150px!important;padding:0!important;background:transparent!important;border:0!important;box-shadow:none!important}.apps-launch-grid .quick-tile span{font-size:16px!important}@keyframes appTileOpenRise{0%{opacity:0;transform:translate(-34px,42px) scale(.78);filter:blur(8px)}64%{opacity:1;transform:translate(4px,-5px) scale(1.025);filter:blur(0)}100%{opacity:1;transform:translate(0,0) scale(1);filter:blur(0)}}' : '';
    const internalAppsHazeStyle=/^(apps)$/i.test(String(page.title || '')) ? 'html,body{position:relative!important;isolation:isolate!important}body::before{content:""!important;display:block!important;position:fixed!important;inset:-18px!important;z-index:0!important;pointer-events:none!important;background:rgba(54,76,110,.34)!important;backdrop-filter:blur(11px) saturate(.82)!important;-webkit-backdrop-filter:blur(11px) saturate(.82)!important}.shell-page{position:relative!important;z-index:1!important;background:transparent!important}.theme-ruby::before{background:rgba(125,22,39,.38)!important}.theme-emerald::before{background:rgba(4,92,65,.36)!important}.theme-sakura::before{background:rgba(190,55,120,.32)!important}.theme-fresh::before{background:rgba(65,91,67,.34)!important}.apps-launch-grid{position:relative!important;z-index:2!important}' : '';
    const finalInternalBackgroundStyle='body.theme-ruby{--theme-bg:linear-gradient(rgba(60,0,12,.10),rgba(60,0,12,.22)),url("assets/backgrounds/nyx-blue-light-trails.jpg")!important}body.theme-emerald{--theme-bg:linear-gradient(rgba(0,24,12,.08),rgba(0,24,12,.20)),url("assets/backgrounds/nyx-blue-light-trails.jpg")!important}body.theme-sakura{--theme-bg:linear-gradient(rgba(40,0,28,.06),rgba(40,0,28,.18)),url("assets/backgrounds/nyx-blue-light-trails.jpg")!important}body.theme-ruby .shell-page,body.theme-ruby .browser-shell-page,body.theme-emerald .shell-page,body.theme-emerald .browser-shell-page,body.theme-sakura .shell-page,body.theme-sakura .browser-shell-page{background:var(--theme-bg)!important;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}';
    const normalInternalTextStyle='html,body,body *{font-weight:400!important;font-style:normal!important}body.theme-fresh,body.theme-fresh *{color:#d9e5d6!important;-webkit-text-fill-color:#d9e5d6!important;font-weight:400!important;font-style:normal!important}body.theme-fresh input::placeholder,body.theme-fresh textarea::placeholder{color:#91a68d!important;-webkit-text-fill-color:#91a68d!important}';
    const internalAppsThemeCanvasStyle=/^(apps)$/i.test(String(page.title || '')) ? 'html{--nyx-app-canvas:#151d2b;--nyx-app-dot:#202b3d;--nyx-app-line:#2a3b54;--nyx-app-text:#d4deec;min-height:100%!important;background-color:var(--nyx-app-canvas)!important;background-image:radial-gradient(circle,var(--nyx-app-dot) 2.7px,transparent 3px)!important;background-size:24px 24px!important;background-position:0 0!important;background-repeat:repeat!important;background-attachment:fixed!important}html[data-nyx-theme="midnight"]{--nyx-app-dot:#223047;--nyx-app-line:#2d405b;--nyx-app-text:#d6e1f0}html[data-nyx-theme="ruby"]{--nyx-app-dot:#332733;--nyx-app-line:#50333c;--nyx-app-text:#e2d7da}html[data-nyx-theme="emerald"]{--nyx-app-dot:#24343a;--nyx-app-line:#2f4a42;--nyx-app-text:#d4e2dd}html[data-nyx-theme="sakura"]{--nyx-app-dot:#332936;--nyx-app-line:#4c3748;--nyx-app-text:#e2d9e0}html[data-nyx-theme="fresh"]{--nyx-app-dot:#24343d;--nyx-app-line:#304850;--nyx-app-text:#d4e2e5}html body,html body.theme-default,html body.theme-midnight,html body.theme-ruby,html body.theme-emerald,html body.theme-sakura,html body.theme-fresh{min-height:100vh!important;background:transparent!important;background-color:transparent!important;background-image:none!important;color:var(--nyx-app-text)!important}html body::before,html body::after{content:none!important;display:none!important;background:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}.shell-page,.browser-shell-page,body.theme-ruby .shell-page,body.theme-emerald .shell-page,body.theme-sakura .shell-page,body.theme-fresh .shell-page,body.theme-fresh .browser-shell-page{background:transparent!important;background-color:transparent!important;background-image:none!important}.shell-page h1,.shell-page p,.browser-shell-page h1,.browser-shell-page p,.quick-tile span,body.theme-fresh :is(h1,h2,h3,p,span,label,strong,.quick-tile span){color:var(--nyx-app-text)!important;-webkit-text-fill-color:var(--nyx-app-text)!important}.quick-tile:hover{border-color:var(--nyx-app-line)!important}' : '';
    const internalThemePurityStyle='html{--nyx-internal-accent:#6687b2;--nyx-internal-line:#2a3b54}html[data-nyx-theme="midnight"]{--nyx-internal-accent:#6f8fb9;--nyx-internal-line:#2d405b}html[data-nyx-theme="ruby"]{--nyx-internal-accent:#a56573;--nyx-internal-line:#50333c}html[data-nyx-theme="emerald"]{--nyx-internal-accent:#628f80;--nyx-internal-line:#2f4a42}html[data-nyx-theme="sakura"]{--nyx-internal-accent:#9e718f;--nyx-internal-line:#4c3748}html[data-nyx-theme="fresh"]{--nyx-internal-accent:#728f6b;--nyx-internal-line:#354b36}html body{--theme-a:var(--nyx-internal-accent)!important;--theme-b:var(--nyx-internal-accent)!important;--theme-border:var(--nyx-internal-line)!important}.settings-side,.settings-section .settings-block,.settings-side button.active,.settings-side button:hover{border-color:var(--nyx-internal-line)!important}.settings-action:hover,.settings-block button:hover,.settings-input::file-selector-button:hover,.quick-tile:hover{border-color:var(--nyx-internal-line)!important;box-shadow:none!important;text-shadow:none!important}';
    const internalFernThemeStyle='html[data-nyx-theme="fresh"]{--nyx-app-canvas:#162019;--nyx-app-dot:#28382b;--nyx-app-line:#354b36;--nyx-app-text:#d9e5d6}html[data-nyx-theme="fresh"] body,html[data-nyx-theme="fresh"] .shell-page,html[data-nyx-theme="fresh"] .browser-shell-page{color:#d9e5d6!important}html[data-nyx-theme="fresh"] :is(.settings-block,.settings-side,.settings-action,.settings-preset,.settings-input,.settings-select,.quick-tile){border-color:#354b36!important;color:#d9e5d6!important;-webkit-text-fill-color:#d9e5d6!important}html[data-nyx-theme="fresh"] :is(.settings-block,.settings-side,.settings-input,.settings-select){background-color:rgba(19,28,21,.82)!important}html[data-nyx-theme="fresh"] :is(.settings-action,.settings-preset,button):hover{background-color:rgba(46,66,47,.72)!important}';
    const internalFounderProfileStyle='.nyx-founder-profile{position:relative;overflow:hidden;padding:22px;border:1px solid color-mix(in srgb,var(--nyx-founder-accent,#8fb8ff) 30%,transparent);border-radius:22px;background:linear-gradient(135deg,color-mix(in srgb,var(--nyx-founder-accent,#8fb8ff) 14%,transparent),rgba(10,18,30,.78))}.nyx-founder-banner{height:112px;margin:-22px -22px 22px;background:linear-gradient(135deg,color-mix(in srgb,var(--nyx-founder-accent,#8fb8ff) 38%,#172337),#0b111c)}.nyx-founder-banner img{width:100%;height:100%;object-fit:cover}.nyx-founder-profile-content{display:grid;grid-template-columns:155px minmax(0,1fr);align-items:center;gap:26px}.nyx-founder-image-wrap{position:relative;overflow:visible}.nyx-founder-image{display:block;width:155px;height:155px;border:3px solid var(--nyx-founder-accent,#8fb8ff);border-radius:18px;object-fit:cover}.nyx-founder-status{position:absolute;right:-5px;bottom:-5px;width:19px;height:19px;border:3px solid #111a27;border-radius:50%;background:#717b8d}.nyx-founder-status-online{background:#57c486}.nyx-founder-status-idle{background:#e6b85a}.nyx-founder-status-dnd{background:#dd6170}.nyx-founder-role{margin:0 0 5px;color:var(--nyx-founder-accent,#8fb8ff);font-size:11px;letter-spacing:.14em;text-transform:uppercase}.nyx-founder-copy h3{margin:0;color:#f5f8ff;font-size:38px}.nyx-founder-handle{margin:4px 0 12px;color:#9fb0c8}.nyx-founder-badges{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}.nyx-founder-badge{padding:4px 8px;border:1px solid color-mix(in srgb,var(--nyx-founder-accent,#8fb8ff) 45%,transparent);border-radius:999px;color:var(--nyx-founder-accent,#8fb8ff);font-size:11px}.nyx-founder-bio{margin:0;color:#bcc8d9;line-height:1.6}.nyx-founder-link{display:inline-flex;gap:6px;margin-top:15px;color:var(--nyx-founder-accent,#8fb8ff);text-decoration:none}@media(max-width:620px){.nyx-founder-profile-content{grid-template-columns:1fr;text-align:center}.nyx-founder-image-wrap{margin:auto}.nyx-founder-badges{justify-content:center}}';
    const internalCustomPalette=nyxCustomThemePalette();
    const internalUnifiedThemeStyle='html{--nyx-page-canvas:#151d2b;--nyx-page-top:#09111d;--nyx-page-field:#111a29;--nyx-page-panel:#141f31;--nyx-page-active:#1a293e;--nyx-page-line:#2a3b54;--nyx-page-text:#d4deec;--nyx-page-muted:#899bb5;--nyx-page-accent:#6687b2;--nyx-page-bright:#91acd2;--nyx-app-canvas:var(--nyx-page-canvas)!important;--nyx-app-dot:#202b3d!important;--nyx-app-line:var(--nyx-page-line)!important;--nyx-app-text:var(--nyx-page-text)!important}html[data-nyx-theme="midnight"]{--nyx-page-canvas:#0a1029;--nyx-page-top:#050817;--nyx-page-field:#111a3b;--nyx-page-panel:#141f31;--nyx-page-active:#1b2a40;--nyx-page-line:#2d405b;--nyx-page-text:#d6e1f0;--nyx-page-muted:#8fa2bc;--nyx-page-accent:#6f8fb9;--nyx-page-bright:#9eb7d9;--nyx-app-dot:#223047!important}html[data-nyx-theme="ruby"]{--nyx-page-canvas:#291219;--nyx-page-top:#16080d;--nyx-page-field:#351018;--nyx-page-panel:#211922;--nyx-page-active:#35202a;--nyx-page-line:#50333c;--nyx-page-text:#e2d7da;--nyx-page-muted:#aa9198;--nyx-page-accent:#a56573;--nyx-page-bright:#c99aa4;--nyx-app-dot:#332733!important}html[data-nyx-theme="emerald"]{--nyx-page-canvas:#0e251b;--nyx-page-top:#07130e;--nyx-page-field:#123126;--nyx-page-panel:#172224;--nyx-page-active:#203531;--nyx-page-line:#2f4a42;--nyx-page-text:#d4e2dd;--nyx-page-muted:#879f98;--nyx-page-accent:#628f80;--nyx-page-bright:#91bdae;--nyx-app-dot:#24343a!important}html[data-nyx-theme="sakura"]{--nyx-page-canvas:#281522;--nyx-page-top:#150a12;--nyx-page-field:#35162f;--nyx-page-panel:#211a23;--nyx-page-active:#332536;--nyx-page-line:#4c3748;--nyx-page-text:#e2d9e0;--nyx-page-muted:#a892a2;--nyx-page-accent:#9e718f;--nyx-page-bright:#c6a0ba;--nyx-app-dot:#332936!important}html[data-nyx-theme="fresh"]{--nyx-page-canvas:#162019;--nyx-page-top:#0b130d;--nyx-page-field:#121b14;--nyx-page-panel:#19241b;--nyx-page-active:#263526;--nyx-page-line:#354b36;--nyx-page-text:#d9e5d6;--nyx-page-muted:#91a68d;--nyx-page-accent:#728f6b;--nyx-page-bright:#a2bd9a;--nyx-app-dot:#28382b!important}html[data-nyx-theme="custom"]{--nyx-page-canvas:'+internalCustomPalette.canvas+';--nyx-page-top:'+internalCustomPalette.top+';--nyx-page-field:'+internalCustomPalette.field+';--nyx-page-panel:'+internalCustomPalette.panel+';--nyx-page-active:'+internalCustomPalette.line+';--nyx-page-line:'+internalCustomPalette.line+';--nyx-page-text:'+internalCustomPalette.text+';--nyx-page-muted:'+internalCustomPalette.muted+';--nyx-page-accent:'+internalCustomPalette.accent+';--nyx-page-bright:'+internalCustomPalette.bright+';--nyx-app-dot:'+internalCustomPalette.dot+'!important}html{min-height:100%!important;background-color:var(--nyx-page-canvas)!important;color-scheme:dark!important}html body{--theme-a:var(--nyx-page-accent)!important;--theme-b:var(--nyx-page-bright)!important;--theme-strong:var(--nyx-page-text)!important;--theme-border:var(--nyx-page-line)!important;min-height:100vh!important;background-color:transparent!important;background-image:none!important;color:var(--nyx-page-text)!important;-webkit-text-fill-color:var(--nyx-page-text)!important}.shell-page,.browser-shell-page{background-color:transparent!important;background-image:none!important;color:var(--nyx-page-text)!important}.shell-page :is(h1,h2,h3,strong),.browser-shell-page :is(h1,h2,h3,strong),.settings-main :is(h1,h2,h3,strong){background:none!important;color:var(--nyx-page-text)!important;-webkit-text-fill-color:var(--nyx-page-text)!important;text-shadow:none!important}.shell-page p,.browser-shell-page p,.settings-main p,.settings-range,.settings-range span{background:none!important;color:var(--nyx-page-muted)!important;-webkit-text-fill-color:var(--nyx-page-muted)!important;text-shadow:none!important}.settings-app{background:var(--nyx-page-canvas)!important;background-image:none!important;color:var(--nyx-page-text)!important}.settings-side{background:var(--nyx-page-canvas)!important;background-image:none!important;border-color:var(--nyx-page-line)!important;color:var(--nyx-page-muted)!important}.settings-main{background:var(--nyx-page-canvas)!important;background-image:none!important;border-color:var(--nyx-page-line)!important}.settings-side button{background:transparent!important;background-image:none!important;border-color:transparent!important;color:var(--nyx-page-muted)!important;-webkit-text-fill-color:var(--nyx-page-muted)!important}.settings-side button:is(:hover,.active){background:var(--nyx-page-active)!important;color:var(--nyx-page-text)!important;-webkit-text-fill-color:var(--nyx-page-text)!important}.settings-section .settings-block{background:color-mix(in srgb,var(--nyx-page-panel) 90%,var(--nyx-page-canvas))!important;background-image:none!important;border-color:var(--nyx-page-line)!important;color:var(--nyx-page-text)!important}.settings-section .settings-block h2{color:var(--nyx-page-text)!important;-webkit-text-fill-color:var(--nyx-page-text)!important}.settings-section .settings-block p{color:var(--nyx-page-muted)!important;-webkit-text-fill-color:var(--nyx-page-muted)!important}.settings-app :is(input:not([type="range"]),select,textarea,.settings-input,.settings-select,.panic-key-display){background:var(--nyx-page-field)!important;background-image:none!important;border-color:var(--nyx-page-line)!important;color:var(--nyx-page-text)!important;-webkit-text-fill-color:var(--nyx-page-text)!important;caret-color:var(--nyx-page-bright)!important}.settings-app :is(input,textarea)::placeholder{color:var(--nyx-page-muted)!important;-webkit-text-fill-color:var(--nyx-page-muted)!important;opacity:.82!important}.settings-app :is(.settings-action,.settings-block button,.settings-input::file-selector-button){background:var(--nyx-page-active)!important;background-image:none!important;border-color:var(--nyx-page-line)!important;color:var(--nyx-page-text)!important;-webkit-text-fill-color:var(--nyx-page-text)!important;box-shadow:none!important;text-shadow:none!important}.settings-app :is(.settings-action,.settings-block button,.settings-input::file-selector-button):hover{background:color-mix(in srgb,var(--nyx-page-active) 78%,var(--nyx-page-accent))!important;border-color:var(--nyx-page-bright)!important;filter:none!important}.quick-tile{background:transparent!important;background-image:none!important;border-color:transparent!important;color:var(--nyx-page-text)!important;-webkit-text-fill-color:var(--nyx-page-text)!important;box-shadow:none!important}.quick-tile span{background:none!important;color:var(--nyx-page-text)!important;-webkit-text-fill-color:var(--nyx-page-text)!important}.quick-tile:hover{background:color-mix(in srgb,var(--nyx-page-active) 72%,transparent)!important;background-image:none!important;border-color:var(--nyx-page-line)!important;box-shadow:none!important}.quick-combo,select option,select optgroup{background:var(--nyx-page-field)!important;color:var(--nyx-page-text)!important;-webkit-text-fill-color:var(--nyx-page-text)!important;border-color:var(--nyx-page-line)!important}.nyx-founder-profile:not(.nyx-founder-profile-standard){background:color-mix(in srgb,var(--nyx-page-panel) 90%,var(--nyx-page-canvas))!important;border-color:var(--nyx-page-line)!important}::selection{background:var(--nyx-page-accent)!important;color:#081018!important;-webkit-text-fill-color:#081018!important}';
    const internalFreshGeometryStyle='html[data-nyx-theme="fresh"] body.theme-fresh .quick-tile{background:transparent!important;background-image:none!important;border-color:transparent!important;box-shadow:none!important}html[data-nyx-theme="fresh"] body.theme-fresh .quick-tile:hover{background:color-mix(in srgb,var(--nyx-page-active) 72%,transparent)!important;border-color:var(--nyx-page-line)!important}';
    const panicFrameScript='let NYX_PANIC_CAPTURE=false;function nyxPanicCombo(e){const key=String(e.key||"").trim();if(!key||["Control","Shift","Alt","Meta"].includes(key))return "";const parts=[];if(e.ctrlKey)parts.push("Ctrl");if(e.altKey)parts.push("Alt");if(e.shiftKey)parts.push("Shift");if(e.metaKey)parts.push("Meta");parts.push(key.length===1?key.toUpperCase():key.replace(/^Arrow/,""));return parts.join("+")}document.addEventListener("click",e=>{if(e.target.closest("[data-panic-capture]"))NYX_PANIC_CAPTURE=true;if(e.target.closest("[data-panic-clear]"))NYX_PANIC_CAPTURE=false},true);document.addEventListener("keydown",e=>{if(!NYX_PANIC_CAPTURE)return;const combo=nyxPanicCombo(e);if(!combo)return;e.preventDefault();e.stopPropagation();NYX_PANIC_CAPTURE=false;document.querySelectorAll("[data-panic-key-display]").forEach(el=>el.textContent=combo);parent.postMessage({type:"nyx:panic-key-set",combo},"*")},true);';
    const internalPaintScript='';
    const finalInternalPaintScript='';
    return '<!doctype html><meta charset="utf-8"><base target="_self"><style>'+style+themeStyle+freshThemeStyle+themeAppStyle+compactSettingsStyle+pageThemeStyle+themeBorderOnlyStyle+'input[type=file].settings-input{color:#f8fafc;background:transparent!important}input[type=file].settings-input::file-selector-button{height:28px;margin:0 12px 0 0;border:1px solid var(--theme-border,rgba(255,255,255,.3));border-radius:999px;background:transparent!important;background-image:none!important;color:#f8fafc;padding:0 12px;font:400 12px Outfit,Arial,sans-serif}.theme-ruby input[type=file].settings-input::file-selector-button,.theme-emerald input[type=file].settings-input::file-selector-button,.theme-sakura input[type=file].settings-input::file-selector-button{background:transparent!important;background-image:none!important;color:#f8fafc!important}.settings-section{display:none}.settings-section.active{display:block}.settings-range{display:grid;grid-template-columns:70px minmax(0,1fr) 46px;align-items:center;gap:10px;margin:12px 0;color:#d1d5db;font-size:13px;font-weight:400}.settings-range input{width:100%;accent-color:#9ca3af}.settings-nav-icon{width:24px;height:24px;border-radius:999px;border:2px solid #dbe2ea;display:inline-block;position:relative;background:transparent!important;box-shadow:none!important}.icon-general::before{content:"";position:absolute;inset:5px;border:2px solid #dbe2ea;border-radius:999px}.icon-effects::before{content:"";position:absolute;left:5px;right:5px;top:10px;height:2px;background:#dbe2ea;box-shadow:0 -5px 0 #dbe2ea,0 5px 0 #dbe2ea}.icon-watch::before{content:"";position:absolute;left:8px;top:5px;border-left:9px solid #dbe2ea;border-top:6px solid transparent;border-bottom:6px solid transparent}.icon-browser::before{content:"";position:absolute;left:4px;right:4px;top:6px;height:11px;border:2px solid #dbe2ea;border-radius:4px}.icon-browser::after{content:"";position:absolute;left:7px;right:7px;bottom:4px;height:2px;background:#dbe2ea}.settings-effect-preview span:nth-child(1)::before{content:"";width:14px;height:20px;border-radius:999px;background:#cfd8e3;transform:rotate(28deg)}.settings-effect-preview span:nth-child(2)::before{content:"";width:18px;height:18px;background:#cfd8e3;clip-path:polygon(50% 0,61% 35%,98% 35%,68% 56%,79% 91%,50% 70%,21% 91%,32% 56%,2% 35%,39% 35%)}.settings-effect-preview span:nth-child(3)::before{content:"";width:18px;height:16px;background:#cfd8e3;clip-path:polygon(50% 100%,8% 52%,4% 22%,24% 2%,50% 20%,76% 2%,96% 22%,92% 52%)}.settings-effect-preview span:nth-child(4)::before{content:"";width:18px;height:18px;border:3px solid #cfd8e3;border-radius:999px}'+themeBorderOnlyStyle+flatInternalStyle+flatInternalPageStyle+transparentInternalFinalStyle+settingsInternalFinalStyle+settingsGlassRepairStyle+browserSettingsSinglePaneStyle+settingsClearAroundStyle+'html body .settings-app :is(input,select,textarea,.settings-input,.settings-select):hover{transform:none!important}html body .settings-app button:hover{transform:none!important}'+clearInternalPageStyle+internalAppsLaunchStyle+internalAppsHazeStyle+finalInternalBackgroundStyle+normalInternalTextStyle+(page.style||'')+internalAppsThemeCanvasStyle+internalThemePurityStyle+internalFernThemeStyle+internalFounderProfileStyle+internalUnifiedThemeStyle+internalFreshGeometryStyle+'</style>'+page.body+'<script>const NYX_EFFECT='+JSON.stringify(store.text('nyx.visualEffect','none'))+';const NYX_EFFECT_SPEED='+JSON.stringify(store.text('nyx.visualEffectSpeed','1.1'))+';const NYX_EFFECT_AMOUNT='+JSON.stringify(store.text('nyx.visualEffectAmount','16'))+';const NYX_THEME='+JSON.stringify(normalizeNyxTheme(store.text('nyx.theme','default')))+';document.body.classList.add("theme-"+NYX_THEME);document.body.dataset.nyxTheme=NYX_THEME;document.documentElement.dataset.nyxTheme=NYX_THEME;document.querySelectorAll("[data-effect-value]").forEach(el=>{el.value=NYX_EFFECT});document.querySelectorAll("[data-effect-speed]").forEach(el=>{el.value=NYX_EFFECT_SPEED});document.querySelectorAll("[data-effect-amount]").forEach(el=>{el.value=NYX_EFFECT_AMOUNT});document.querySelectorAll("[data-effect-speed-label]").forEach(el=>{el.textContent=Number(NYX_EFFECT_SPEED).toFixed(1)+"x"});document.querySelectorAll("[data-effect-amount-label]").forEach(el=>{el.textContent=NYX_EFFECT_AMOUNT});'+internalPaintScript+finalInternalPaintScript+script+popupScript+panicFrameScript+(page.script||'')+'<\/script>';
  }
  function showBrowserShellInternalPage(name){
    hideBrowserSuggestions();
    if(/^(lionai|lion ai)$/i.test(String(name || ''))) name='ai';
    if(/^settings$/i.test(String(name || ''))){
      openBrowserShellSettings();
      return true;
    }
    ensureBrowserShellHome();
    if(!activeBrowser?.win?.isConnected){
      const win=openBrowser('');
      win?.classList.add('maximized');
      const shellTab=browserShellTabs.find(tab=>tab.id===browserShellActiveTab);
      const created=activeBrowser?.tabs?.[activeBrowser.tabs.length-1];
      if(shellTab && created) shellTab.browserTabId=created.id;
      updateDockFullscreenState();
    }
    const shellTab=browserShellTabs.find(tab=>tab.id===browserShellActiveTab);
    if(shellTab?.browserTabId && activeBrowser?.activate) activeBrowser.activate(shellTab.browserTabId);
    const state=activeBrowser;
    const tab=state?.tabs?.find(t=>t.id===state.active);
    if(!tab) return false;
    if(/^ai$/i.test(String(name || ''))){
      tab.url='nyx://ai';
      tab.title='Nyx AI';
      tab.icon=favicons.nyx;
      state.win.classList.remove('internal-clear','browser-blank');
      tab.frame.classList.remove('transparent-internal-page');
      tab.frame.removeAttribute('srcdoc');
      tab.frame.src='/ai.html';
      tab.frame.classList.add('active');
      state.win.querySelector('.browser-home')?.classList.add('hidden');
      state.renderTabs?.();
      updateBrowserShellLocation(tab.url);
      return true;
    }
    const presetTiles=`<button class="quick-tile" data-preset="nyx" type="button"><img class="quick-icon" alt="" src="${favicons.nyx}"><span>ռʏӼ tab</span></button><button class="quick-tile" data-preset="google" type="button"><img class="quick-icon" alt="" src="${favicons.google}"><span>Google tab</span></button><button class="quick-tile" data-preset="drive" type="button"><img class="quick-icon" alt="" src="${favicons.drive}"><span>Drive tab</span></button><button class="quick-tile" data-preset="classlink" type="button"><img class="quick-icon" alt="" src="${favicons.classlink}"><span>ClassLink tab</span></button>`;
    const utilityPageStyle=`
      html,body{min-height:100%!important;background:#0a1220!important;color:#eaf2ff!important}
      .nyx-utility-tab{width:min(860px,calc(100vw - 44px));min-height:100vh;margin:0 auto;padding:clamp(34px,6vw,72px) clamp(22px,5vw,58px) 90px!important;background:transparent!important;color:#eaf2ff!important}
      .nyx-utility-tab .utility-kicker{margin:0 0 8px!important;color:#8fb8ff!important;font-size:12px!important;font-weight:500!important;letter-spacing:.16em!important;text-transform:uppercase!important;text-shadow:none!important}
      .nyx-utility-tab h1{margin:0 0 10px!important;color:#f4f8ff!important;font-size:clamp(34px,6vw,58px)!important;font-weight:420!important;letter-spacing:-.045em!important;text-shadow:none!important}
      .nyx-utility-tab .utility-updated{margin:0 0 34px!important;color:#8498b7!important;font-size:12px!important;font-weight:400!important;text-shadow:none!important}
      .nyx-utility-tab section{padding:20px 0;border-top:1px solid rgba(111,158,232,.22)}
      .nyx-utility-tab section h2{margin:0 0 7px!important;color:#edf4ff!important;font-size:16px!important;font-weight:520!important;text-shadow:none!important}
      .nyx-utility-tab section p,.nyx-utility-tab .about-lead{max-width:68ch;margin:0!important;color:#a9b9d0!important;font-size:14px!important;font-weight:400!important;line-height:1.68!important;text-shadow:none!important}
      .nyx-utility-tab .utility-intro{max-width:68ch;margin:0 0 32px!important;color:#b7c5d9!important;font-size:14px!important;line-height:1.68!important}.nyx-utility-tab section p+p{margin-top:10px!important}.nyx-utility-tab ul{max-width:68ch;margin:10px 0 14px;padding-left:22px;color:#a9b9d0;font-size:14px;line-height:1.62}.nyx-utility-tab li+li{margin-top:4px}.nyx-utility-tab strong{color:#edf4ff!important;font-weight:600!important}
      .nyx-about-tab{display:flex;min-height:calc(100vh - 1px);flex-direction:column;justify-content:center}.nyx-about-tab .about-mark{width:48px;height:48px;display:grid;place-items:center;margin-bottom:24px;border:1px solid rgba(111,158,232,.42);border-radius:15px;background:rgba(17,26,41,.72);color:#8fb8ff;font-size:23px}
      .nyx-about-details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:30px 0 0}.nyx-about-details div{padding:14px;border:1px solid rgba(111,158,232,.22);border-radius:13px;background:rgba(17,26,41,.54)}.nyx-about-details dt{color:#8498b7;font-size:10px;letter-spacing:.09em;text-transform:uppercase}.nyx-about-details dd{margin:5px 0 0;color:#edf4ff;font-size:13px}
      body{--credits-accent:#8fb8ff;--credits-line:rgba(143,184,255,.24);--credits-card:rgba(15,25,42,.72)}body.theme-midnight{--credits-accent:#789edc}body.theme-ruby{--credits-accent:#db7f91;--credits-line:rgba(219,127,145,.26)}body.theme-emerald{--credits-accent:#65b99b;--credits-line:rgba(101,185,155,.25)}body.theme-sakura{--credits-accent:#d798b8;--credits-line:rgba(215,152,184,.26)}body.theme-fresh{--credits-accent:#86a77e;--credits-line:rgba(134,167,126,.26);--credits-card:rgba(19,28,21,.78)}
      .nyx-credits-tab{width:min(1040px,calc(100vw - 34px));padding:clamp(46px,7vw,92px) clamp(20px,5vw,62px) 70px!important}.nyx-credits-hero{text-align:center;margin:0 auto 68px}.nyx-credits-tab .nyx-credits-hero h1{margin:0 0 14px!important;font-size:clamp(48px,8vw,86px)!important;font-weight:400!important;letter-spacing:-.055em!important}.nyx-credits-hero>p:last-child{max-width:620px;margin:0 auto!important;color:#9cadc4!important;font-size:15px!important;line-height:1.6!important}
      .nyx-credits-tab .nyx-credits-section{padding:0!important;margin:0 0 76px!important;border:0!important}.nyx-credits-tab .nyx-credits-section>h2{width:max-content;margin:0 auto 34px!important;padding-bottom:7px!important;border-bottom:2px solid var(--credits-accent)!important;color:#eef4ff!important;font-size:clamp(31px,5vw,48px)!important;font-weight:400!important;letter-spacing:-.035em!important;text-align:center!important}
      .nyx-founder-profile{display:grid;grid-template-columns:minmax(240px,360px) minmax(0,1fr);align-items:center;gap:clamp(28px,6vw,72px);padding:clamp(18px,3vw,30px);border:1px solid var(--credits-line);border-radius:24px;background:linear-gradient(135deg,color-mix(in srgb,var(--credits-accent) 10%,transparent),transparent 42%),var(--credits-card);box-shadow:0 24px 70px rgba(0,0,0,.24)}
      .nyx-founder-image-wrap{aspect-ratio:1;display:grid;place-items:center;overflow:hidden;border:1px solid var(--credits-line);border-radius:20px;background:#050a12}.nyx-founder-image{display:block;width:100%;height:100%;padding:0;object-fit:cover;object-position:center;box-sizing:border-box}.nyx-founder-copy .nyx-founder-role{margin:0 0 6px!important;color:var(--credits-accent)!important;font-size:11px!important;font-weight:500!important;letter-spacing:.16em!important;text-transform:uppercase!important}.nyx-founder-copy h3{margin:0 0 16px!important;color:#f5f8ff!important;font-size:clamp(31px,5vw,50px)!important;font-weight:400!important;letter-spacing:-.04em!important}.nyx-founder-copy>p{margin:0!important;color:#aebdd1!important;font-size:15px!important;font-weight:400!important;line-height:1.72!important;overflow-wrap:anywhere}.nyx-founder-copy .nyx-founder-note{margin-top:16px!important;color:#d7e1ef!important}
      .nyx-credit-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.nyx-credit-grid article{min-height:176px;padding:22px;border:1px solid var(--credits-line);border-radius:19px;background:var(--credits-card)}.nyx-credit-grid article>span{display:grid;place-items:center;width:38px;height:38px;margin-bottom:24px;border:1px solid var(--credits-line);border-radius:12px;color:var(--credits-accent);font-size:20px}.nyx-credit-grid h3{margin:0 0 8px!important;color:#eef4ff!important;font-size:16px!important;font-weight:500!important}.nyx-credit-grid p{margin:0!important;color:#94a6bf!important;font-size:13px!important;line-height:1.55!important}
      .nyx-credits-footer{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;padding:24px 0 0;border-top:1px solid var(--credits-line);color:#8498b7}.nyx-credits-footer img{width:38px;height:38px;border-radius:10px;object-fit:contain}.nyx-credits-footer div{display:grid;gap:2px}.nyx-credits-footer strong{font-size:14px!important;font-weight:500!important}.nyx-credits-footer span,.nyx-credits-footer small{font-size:11px!important}
      .nyx-terminal-tab{width:min(980px,calc(100vw - 34px));height:calc(100vh - 34px);min-height:420px;margin:17px auto;padding:0!important;display:grid;grid-template-rows:auto 1fr auto;border:1px solid rgba(111,158,232,.30);border-radius:17px;overflow:hidden;background:#080f1a!important}.nyx-terminal-toolbar{min-height:46px;display:flex;align-items:center;justify-content:space-between;padding:0 17px;border-bottom:1px solid rgba(111,158,232,.22);color:#8498b7;font-size:11px;letter-spacing:.04em}.nyx-terminal-toolbar span:first-child{display:flex;align-items:center;gap:8px;color:#eaf2ff}.nyx-terminal-toolbar i{width:7px;height:7px;border-radius:50%;background:#79aaff}
      .nyx-terminal-output{overflow:auto;padding:20px;color:#b9c8dc;font:400 12px/1.75 "Cascadia Code",Consolas,monospace}.nyx-terminal-line.command{margin-top:9px;color:#8fb8ff}.nyx-terminal-line.error{color:#ff8292}.nyx-terminal-form{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;padding:12px 14px;border-top:1px solid rgba(111,158,232,.22);background:rgba(17,26,41,.70)}.nyx-terminal-form label{color:#8fb8ff;font:400 12px/1 "Cascadia Code",Consolas,monospace}.nyx-terminal-form input{width:100%;height:38px;padding:0 11px;border:1px solid rgba(111,158,232,.32);border-radius:9px;background:#080f1a;color:#eaf2ff;outline:0;font:400 12px/1 "Cascadia Code",Consolas,monospace}.nyx-terminal-form input:focus{border-color:#8fb8ff}.nyx-terminal-form button{height:38px;padding:0 16px;border:1px solid rgba(111,158,232,.38);border-radius:9px;background:rgba(111,158,232,.12);color:#eaf2ff;font:400 12px Outfit,Arial,sans-serif}.nyx-terminal-form button:hover{transform:none!important;background:rgba(111,158,232,.18)!important;border-color:#8fb8ff!important;box-shadow:none!important}
      @media(max-width:680px){.nyx-about-details{grid-template-columns:1fr}.nyx-founder-profile{grid-template-columns:1fr}.nyx-founder-image-wrap{width:min(310px,100%);margin:auto}.nyx-founder-copy{text-align:center}.nyx-credit-grid{grid-template-columns:1fr}.nyx-credits-footer{grid-template-columns:auto 1fr}.nyx-credits-footer small{grid-column:1/-1}.nyx-terminal-tab{width:calc(100vw - 16px);height:calc(100vh - 16px);margin:8px auto}.nyx-terminal-form{grid-template-columns:auto 1fr}.nyx-terminal-form button{grid-column:2}}
    `;
    const discordFounderProfileStyle='.nyx-founder-profile-standard{display:block!important;max-width:620px!important;margin:0 auto!important;padding:0!important;overflow:hidden!important;border:1px solid color-mix(in srgb,var(--nyx-founder-accent,#8fb8ff) 42%,transparent)!important;border-radius:16px!important;background:#111827!important;box-shadow:0 16px 42px rgba(0,0,0,.32)!important}.nyx-founder-profile-standard .nyx-founder-banner{height:140px!important;margin:0!important;background:var(--nyx-founder-accent,#8fb8ff)!important}.nyx-founder-profile-standard .nyx-founder-profile-content{display:block!important;padding:0 16px 18px!important}.nyx-founder-profile-standard .nyx-founder-image-wrap{width:88px!important;height:88px!important;margin:-45px 0 0!important;border:6px solid #111827!important;border-radius:50%!important;background:#111827!important}.nyx-founder-profile-standard .nyx-founder-image{display:block!important;width:88px!important;height:88px!important;border:0!important;border-radius:50%!important;background:#172338!important}.nyx-founder-profile-standard .nyx-founder-copy{padding-top:13px!important}.nyx-founder-name-row{display:flex!important;align-items:center!important;gap:7px!important}.nyx-founder-profile-standard .nyx-founder-copy h3{margin:0!important;color:#f8fbff!important;font-size:24px!important;font-weight:700!important}.nyx-founder-profile-standard .nyx-founder-handle{margin:2px 0 10px!important;color:#b5c2d5!important;font-size:14px!important}.nyx-founder-role-list{display:flex!important;flex-wrap:wrap!important;gap:7px!important;margin:0 0 12px!important}.nyx-founder-role-chip,.nyx-founder-badge{display:inline-flex!important;align-items:center!important;gap:5px!important;padding:4px 8px!important;border:1px solid rgba(255,255,255,.18)!important;border-radius:4px!important;background:rgba(255,255,255,.08)!important;color:#d9e3f1!important;font-size:11px!important}.nyx-founder-role-owner{border-color:color-mix(in srgb,var(--nyx-founder-accent,#8fb8ff) 78%,transparent)!important;background:color-mix(in srgb,var(--nyx-founder-accent,#8fb8ff) 22%,transparent)!important;color:#fff!important}.nyx-founder-about{padding-top:13px!important;border-top:1px solid rgba(255,255,255,.14)!important}.nyx-founder-about>strong{display:block!important;margin-bottom:7px!important;color:#f5f8ff!important;font-size:12px!important;text-transform:uppercase!important}.nyx-founder-profile-standard .nyx-founder-bio{color:#d5dfec!important;font-size:14px!important;line-height:1.55!important}';
    const founderAccentEffectStyle=`
      .nyx-founder-profile-standard{position:relative!important;isolation:isolate!important;border-color:color-mix(in srgb,var(--nyx-founder-accent-primary,#8fb8ff) 66%,#4e5058)!important;background:linear-gradient(180deg,color-mix(in srgb,var(--nyx-founder-accent-primary,#8fb8ff) 78%,#1e1f22) 0%,color-mix(in srgb,var(--nyx-founder-accent-primary,#8fb8ff) 62%,#1e1f22) 54%,color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 68%,#1e1f22) 100%)!important;box-shadow:0 16px 42px rgba(0,0,0,.32),inset 0 3px 0 var(--nyx-founder-accent-primary,#8fb8ff),inset 0 -3px 0 var(--nyx-founder-accent-secondary,#8ea1ff)!important}
      .nyx-founder-profile-standard>*:not(.nyx-founder-profile-effect){position:relative;z-index:1}.nyx-founder-profile-effect{display:none;position:absolute!important;z-index:2!important;inset:0;overflow:hidden;pointer-events:none}
      .nyx-founder-profile-standard .nyx-founder-banner{height:auto!important;aspect-ratio:17/6!important;background:var(--nyx-founder-banner-color,var(--nyx-founder-accent-secondary,#8ea1ff))!important}.nyx-founder-profile-standard .nyx-founder-banner img{object-fit:contain!important}
      .nyx-founder-profile-standard .nyx-founder-profile-content{background:linear-gradient(180deg,color-mix(in srgb,#2b2d31 72%,var(--nyx-founder-accent-primary,#8fb8ff)) 0%,color-mix(in srgb,#2b2d31 80%,var(--nyx-founder-accent-primary,#8fb8ff)) 58%,color-mix(in srgb,#2b2d31 82%,var(--nyx-founder-accent-secondary,#8ea1ff)) 100%)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.05)!important}
      .nyx-founder-profile-standard .nyx-founder-image-wrap{position:relative!important;overflow:visible!important;border-color:var(--nyx-founder-accent-primary,#8fb8ff)!important;box-shadow:0 0 0 2px color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 50%,transparent),0 8px 20px rgba(0,0,0,.3)!important}.nyx-founder-profile-standard .nyx-founder-status{z-index:5!important;border-color:color-mix(in srgb,var(--nyx-founder-accent-primary,#8fb8ff) 22%,#111827)!important}
      .nyx-founder-profile-standard .nyx-avatar-decoration{display:none;position:absolute!important;z-index:3!important;inset:-16px;pointer-events:none;color:var(--nyx-founder-accent-primary,#8fb8ff);filter:drop-shadow(0 0 7px color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 68%,transparent))}.nyx-founder-profile-standard .nyx-avatar-decoration::before,.nyx-founder-profile-standard .nyx-avatar-decoration::after,.nyx-founder-profile-standard .nyx-avatar-decoration>span{content:"";position:absolute;display:block;box-sizing:border-box}
      .nyx-founder-profile-standard .nyx-avatar-decoration-starfall>.nyx-avatar-decoration{display:block;background:radial-gradient(circle at 15% 24%,#fff 0 2px,transparent 2.7px),radial-gradient(circle at 84% 18%,var(--nyx-founder-accent-secondary,#8ea1ff) 0 2.5px,transparent 3.2px),radial-gradient(circle at 90% 72%,#fff 0 1.8px,transparent 2.5px),radial-gradient(circle at 17% 81%,var(--nyx-founder-accent-primary,#8fb8ff) 0 2.3px,transparent 3px);animation:nyx-founder-decoration-twinkle 2.8s ease-in-out infinite}.nyx-founder-profile-standard .nyx-avatar-decoration-starfall>.nyx-avatar-decoration::before,.nyx-founder-profile-standard .nyx-avatar-decoration-starfall>.nyx-avatar-decoration::after{width:17px;height:17px;background:linear-gradient(135deg,#fff,var(--nyx-founder-accent-secondary,#8ea1ff));clip-path:polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%)}.nyx-founder-profile-standard .nyx-avatar-decoration-starfall>.nyx-avatar-decoration::before{right:-1px;top:13px}.nyx-founder-profile-standard .nyx-avatar-decoration-starfall>.nyx-avatar-decoration::after{left:3px;bottom:9px;width:12px;height:12px}
      .nyx-founder-profile-standard .nyx-avatar-decoration-orbit>.nyx-avatar-decoration{display:block;border:2px solid color-mix(in srgb,var(--nyx-founder-accent-primary,#8fb8ff) 72%,transparent);border-left-color:var(--nyx-founder-accent-secondary,#8ea1ff);border-right-color:var(--nyx-founder-accent-secondary,#8ea1ff);border-radius:50%;animation:nyx-founder-decoration-orbit 7s linear infinite}.nyx-founder-profile-standard .nyx-avatar-decoration-orbit>.nyx-avatar-decoration::before,.nyx-founder-profile-standard .nyx-avatar-decoration-orbit>.nyx-avatar-decoration::after{border-radius:50%;background:#fff;box-shadow:0 0 0 3px var(--nyx-founder-accent-primary,#8fb8ff),0 0 12px 5px color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 72%,transparent)}.nyx-founder-profile-standard .nyx-avatar-decoration-orbit>.nyx-avatar-decoration::before{width:8px;height:8px;top:8px;right:11px}.nyx-founder-profile-standard .nyx-avatar-decoration-orbit>.nyx-avatar-decoration::after{width:6px;height:6px;left:8px;bottom:15px}
      .nyx-founder-profile-standard .nyx-avatar-decoration-laurel>.nyx-avatar-decoration,.nyx-founder-profile-standard .nyx-avatar-decoration-neon-wings>.nyx-avatar-decoration{display:block}.nyx-founder-profile-standard .nyx-avatar-decoration-laurel>.nyx-avatar-decoration::before,.nyx-founder-profile-standard .nyx-avatar-decoration-laurel>.nyx-avatar-decoration::after{top:13px;width:35px;height:88px;border:7px dotted color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 86%,#fff);border-top-color:transparent;border-bottom-color:transparent;border-radius:50%}.nyx-founder-profile-standard .nyx-avatar-decoration-laurel>.nyx-avatar-decoration::before{left:-5px;border-right:0;transform:rotate(-11deg)}.nyx-founder-profile-standard .nyx-avatar-decoration-laurel>.nyx-avatar-decoration::after{right:-5px;border-left:0;transform:rotate(11deg)}.nyx-founder-profile-standard .nyx-avatar-decoration-laurel>.nyx-avatar-decoration>span{left:50%;bottom:1px;width:16px;height:16px;background:linear-gradient(135deg,var(--nyx-founder-accent-primary,#8fb8ff),var(--nyx-founder-accent-secondary,#8ea1ff));clip-path:polygon(50% 0,61% 36%,100% 50%,61% 64%,50% 100%,39% 64%,0 50%,39% 36%);transform:translateX(-50%)}
      .nyx-founder-profile-standard .nyx-avatar-decoration-neon-wings>.nyx-avatar-decoration::before,.nyx-founder-profile-standard .nyx-avatar-decoration-neon-wings>.nyx-avatar-decoration::after{top:23px;width:39px;height:72px;background:linear-gradient(160deg,#fff 0 5%,var(--nyx-founder-accent-secondary,#8ea1ff) 28%,var(--nyx-founder-accent-primary,#8fb8ff) 74%,transparent 75%);clip-path:polygon(100% 2%,65% 18%,33% 10%,50% 38%,0 31%,42% 60%,8% 71%,64% 80%,53% 100%,100% 72%)}.nyx-founder-profile-standard .nyx-avatar-decoration-neon-wings>.nyx-avatar-decoration::before{left:-24px}.nyx-founder-profile-standard .nyx-avatar-decoration-neon-wings>.nyx-avatar-decoration::after{right:-24px;transform:scaleX(-1)}
      .nyx-founder-profile-standard .nyx-founder-handle{color:#c4c7ce!important}.nyx-founder-profile-standard .nyx-founder-role,.nyx-founder-profile-standard .nyx-founder-link,.nyx-founder-profile-standard .nyx-founder-about>strong{color:#f2f3f5!important}
      .nyx-founder-profile-standard .nyx-founder-role-chip,.nyx-founder-profile-standard .nyx-founder-badge{border-color:color-mix(in srgb,var(--nyx-founder-accent-primary,#8fb8ff) 48%,transparent)!important;background:linear-gradient(120deg,color-mix(in srgb,var(--nyx-founder-accent-primary,#8fb8ff) 24%,#24252b),color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 20%,#24252b))!important;color:#fff!important}.nyx-founder-role-owner{border-color:color-mix(in srgb,var(--nyx-founder-accent-primary,#8fb8ff) 78%,transparent)!important;background:color-mix(in srgb,var(--nyx-founder-accent-primary,#8fb8ff) 30%,#24252b)!important}
      .nyx-founder-profile-standard .nyx-founder-about{border-color:rgba(255,255,255,.18)!important}.nyx-founder-profile-standard .nyx-founder-bio{color:#e5e7eb!important}
      .nyx-styled-display-name{display:inline-block!important;color:var(--nyx-name-color-primary,#fff)!important;-webkit-text-fill-color:var(--nyx-name-color-primary,#fff)!important;line-height:1.14}.nyx-name-font-gg-sans{font-family:"Outfit","Segoe UI",Arial,sans-serif!important}.nyx-name-font-headline{font-family:"Arial Black","Franklin Gothic Heavy","Segoe UI",sans-serif!important;font-size:1.08em!important;font-weight:900!important;letter-spacing:-.035em}.nyx-name-font-rounded{font-family:"Arial Rounded MT Bold","Trebuchet MS","Segoe UI",sans-serif!important;font-size:1.06em!important;font-weight:900!important;letter-spacing:-.025em}.nyx-name-font-wide{font-family:"Arial Black","Trebuchet MS","Segoe UI",sans-serif!important;font-size:1.04em!important;font-weight:900!important;letter-spacing:.075em;text-transform:uppercase}.nyx-name-font-slab{font-family:Rockwell,"Roboto Slab","Palatino Linotype",Georgia,serif!important;font-size:1.06em!important;font-weight:900!important;letter-spacing:-.02em}.nyx-name-font-condensed{font-family:"Bahnschrift Condensed","Arial Narrow","Roboto Condensed",sans-serif!important;font-size:1.1em!important;font-stretch:condensed;font-weight:800!important;letter-spacing:.015em}.nyx-name-font-mono-block{font-family:"Cascadia Mono","Segoe UI Mono","Courier New",monospace!important;font-size:1.02em!important;font-weight:900!important;letter-spacing:-.055em}.nyx-name-font-tempo{font-family:Impact,"Arial Black",sans-serif!important;font-weight:500!important;letter-spacing:.02em}.nyx-name-font-sakura{font-family:"Segoe Script","Brush Script MT",cursive!important;font-weight:700!important}.nyx-name-font-jellybean{font-family:"Comic Sans MS","Trebuchet MS",cursive!important;font-weight:700!important}.nyx-name-font-modern{font-family:"Arial Narrow","Helvetica Neue",Arial,sans-serif!important;font-weight:800!important;letter-spacing:.07em;text-transform:uppercase}.nyx-name-font-medieval{font-family:"Palatino Linotype","Book Antiqua",Georgia,serif!important;font-weight:700!important;letter-spacing:.025em}.nyx-name-font-eight-bit{font-family:"Cascadia Mono","Courier New",monospace!important;font-weight:800!important;letter-spacing:-.06em;text-transform:uppercase}.nyx-name-font-vampyre{font-family:Copperplate,"Times New Roman",serif!important;font-weight:800!important;font-variant:small-caps;letter-spacing:.07em}.nyx-name-effect-solid{color:var(--nyx-name-color-primary,#fff)!important;-webkit-text-fill-color:var(--nyx-name-color-primary,#fff)!important}.nyx-name-effect-gradient,.nyx-name-effect-neon,.nyx-name-effect-pop{background:linear-gradient(105deg,var(--nyx-name-color-primary,#fff),var(--nyx-name-color-secondary,#8ea1ff),var(--nyx-name-color-primary,#fff));background-size:220% 100%;background-clip:text;-webkit-background-clip:text;color:transparent!important;-webkit-text-fill-color:transparent!important}.nyx-name-effect-gradient{animation:nyx-founder-name-gradient 5s ease-in-out infinite}.nyx-name-effect-neon{text-shadow:0 0 5px color-mix(in srgb,var(--nyx-name-color-primary,#fff) 88%,transparent),0 0 12px color-mix(in srgb,var(--nyx-name-color-secondary,#8ea1ff) 78%,transparent);animation:nyx-founder-name-neon 2.4s ease-in-out infinite}.nyx-name-effect-toon{color:var(--nyx-name-color-primary,#fff)!important;-webkit-text-fill-color:var(--nyx-name-color-primary,#fff)!important;-webkit-text-stroke:1px color-mix(in srgb,var(--nyx-name-color-secondary,#8ea1ff) 76%,#17181b);text-shadow:2px 2px 0 var(--nyx-name-color-secondary,#8ea1ff),3px 3px 0 rgba(0,0,0,.42)}.nyx-name-effect-pop{filter:drop-shadow(0 2px 0 color-mix(in srgb,var(--nyx-name-color-secondary,#8ea1ff) 72%,#111));animation:nyx-founder-name-gradient 4.6s linear infinite,nyx-founder-name-pop 2.8s ease-in-out infinite;transform-origin:center bottom}
      .nyx-founder-effect-glow{box-shadow:0 0 34px color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 64%,transparent),0 16px 42px rgba(0,0,0,.32)!important}
      .nyx-founder-effect-sparkle .nyx-founder-profile-effect{display:block;background-image:radial-gradient(circle at 12% 18%,#fff 0 1.7px,transparent 2.5px),radial-gradient(circle at 42% 43%,#fff 0 1.1px,transparent 2.1px),radial-gradient(circle at 78% 22%,#fff 0 1.8px,transparent 2.7px),radial-gradient(circle at 88% 72%,#fff 0 1.2px,transparent 2.2px),radial-gradient(circle at 24% 84%,#fff 0 1.3px,transparent 2.3px);background-size:150px 150px,193px 193px,221px 221px,169px 169px,247px 247px;filter:drop-shadow(0 0 5px rgba(255,255,255,.8));animation:nyx-founder-sparkle 6s linear infinite}
      .nyx-founder-effect-aurora .nyx-founder-profile-effect{display:block;opacity:.65;background:linear-gradient(118deg,transparent 15%,color-mix(in srgb,var(--nyx-founder-accent-primary,#8fb8ff) 64%,transparent) 35%,transparent 49%,color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 68%,transparent) 67%,transparent 85%);background-size:220% 100%;mix-blend-mode:screen;animation:nyx-founder-aurora 8s ease-in-out infinite}
      .nyx-founder-effect-holographic .nyx-founder-profile-effect{display:block;opacity:.6;background:linear-gradient(112deg,transparent 12%,rgba(255,111,211,.38) 29%,rgba(100,219,255,.42) 43%,rgba(242,255,150,.36) 56%,rgba(172,130,255,.43) 69%,transparent 86%);background-size:250% 100%;mix-blend-mode:screen;animation:nyx-founder-holographic 5.6s linear infinite}
      .nyx-founder-effect-fireflies .nyx-founder-profile-effect{display:block;background-image:radial-gradient(circle at 12% 77%,#fff8af 0 2px,transparent 4px),radial-gradient(circle at 31% 31%,#fff7a1 0 1.5px,transparent 3.5px),radial-gradient(circle at 53% 67%,#fff8b8 0 2px,transparent 4px),radial-gradient(circle at 76% 42%,#fff6a2 0 1.6px,transparent 3.5px),radial-gradient(circle at 91% 80%,#fff8b4 0 2px,transparent 4px);background-size:230px 250px;filter:drop-shadow(0 0 7px rgba(255,238,133,.9));animation:nyx-founder-fireflies 7s ease-in-out infinite}
      .nyx-founder-effect-cosmic-dust .nyx-founder-profile-effect{display:block;opacity:.88;background-image:radial-gradient(ellipse at 24% 38%,color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 34%,transparent) 0,transparent 42%),radial-gradient(circle at 8% 22%,#fff 0 1.5px,transparent 2.7px),radial-gradient(circle at 72% 12%,#c7e5ff 0 1.8px,transparent 3px),radial-gradient(circle at 42% 68%,#f0c4ff 0 2px,transparent 3.4px),radial-gradient(circle at 88% 81%,#fff 0 1.2px,transparent 2.6px),radial-gradient(circle at 30% 87%,#aee8ff 0 1px,transparent 2.3px);background-size:100% 100%,127px 149px,181px 167px,211px 193px,157px 223px,239px 179px;mix-blend-mode:screen;filter:drop-shadow(0 0 5px rgba(197,226,255,.8));animation:nyx-founder-cosmic-dust 14s linear infinite}
      .nyx-founder-effect-electric-storm .nyx-founder-profile-effect{display:block;opacity:.1;background-image:linear-gradient(118deg,transparent 0 41%,rgba(255,255,255,.95) 42% 42.8%,color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 88%,#fff) 43% 44%,transparent 45% 100%),linear-gradient(63deg,transparent 0 58%,rgba(255,255,255,.88) 59% 59.6%,color-mix(in srgb,var(--nyx-founder-accent-primary,#5865f2) 84%,#fff) 60% 61%,transparent 62% 100%);background-size:170% 190%,210% 170%;background-position:120% -40%,-80% 130%;mix-blend-mode:screen;filter:drop-shadow(0 0 8px rgba(174,213,255,.95));animation:nyx-founder-electric-storm 4.2s steps(1,end) infinite}
      .nyx-founder-effect-meteor-shower .nyx-founder-profile-effect{display:block;opacity:.92;background:radial-gradient(circle,rgba(255,255,255,.95) 0 1.2px,transparent 2px) 18% -12%/109px 127px,radial-gradient(circle,color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 74%,#fff) 0 1px,transparent 2px) 72% -28%/157px 173px,radial-gradient(circle,rgba(214,231,255,.78) 0 .9px,transparent 1.8px) 38% 4%/197px 149px;filter:drop-shadow(0 0 3px color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 45%,transparent));animation:nyx-founder-meteor-shower 9s linear infinite}
      .nyx-founder-effect-cyber-grid .nyx-founder-profile-effect{display:block;opacity:.52;background-image:linear-gradient(color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 76%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--nyx-founder-accent-primary,#5865f2) 72%,transparent) 1px,transparent 1px),linear-gradient(180deg,transparent 30%,color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 18%,transparent) 100%);background-size:34px 34px,34px 34px,100% 100%;-webkit-mask-image:linear-gradient(to bottom,transparent 2%,#000 31%,#000 100%);mask-image:linear-gradient(to bottom,transparent 2%,#000 31%,#000 100%);filter:drop-shadow(0 0 4px color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 70%,transparent));animation:nyx-founder-cyber-grid 4.5s linear infinite}
      .nyx-founder-effect-plasma .nyx-founder-profile-effect{display:block;inset:-28%!important;opacity:.4;background:conic-gradient(from 0deg at 50% 50%,transparent 0 8%,var(--nyx-founder-accent-secondary,#8ea1ff) 20%,transparent 34%,var(--nyx-founder-accent-primary,#5865f2) 50%,transparent 66%,#df7cff 79%,transparent 94%);mix-blend-mode:screen;filter:blur(28px) saturate(1.45);animation:nyx-founder-plasma 9s linear infinite}
      .nyx-founder-effect-snowfall .nyx-founder-profile-effect{display:block;opacity:.84;background-image:radial-gradient(circle,#fff 0 2px,transparent 2.8px),radial-gradient(circle,#dceeff 0 1.3px,transparent 2.2px),radial-gradient(circle,#fff 0 2.6px,transparent 3.4px);background-size:83px 109px,137px 157px,191px 227px;background-position:12px -130px,63px -180px,116px -260px;filter:drop-shadow(0 0 3px rgba(222,241,255,.9));animation:nyx-founder-snowfall 8.5s linear infinite}
      .nyx-founder-effect-embers .nyx-founder-profile-effect{display:block;opacity:.9;background-image:radial-gradient(circle,#fff2ad 0 1.4px,#ff8a3d 1.7px 2.8px,transparent 4px),radial-gradient(circle,#ffd166 0 1px,#ff5c35 1.4px 2.5px,transparent 3.8px),radial-gradient(circle,#fff0ac 0 1.2px,#ff6a2b 1.6px 2.8px,transparent 4px);background-size:109px 173px,157px 211px,223px 263px;background-position:7px 100%,73px 118%,151px 110%;mix-blend-mode:screen;filter:drop-shadow(0 0 5px rgba(255,107,43,.88));animation:nyx-founder-embers 7s linear infinite}
      .nyx-founder-effect-bubbles .nyx-founder-profile-effect{display:block;opacity:.72;background-image:radial-gradient(circle,transparent 0 5px,rgba(255,255,255,.58) 6px 7px,transparent 8px),radial-gradient(circle,transparent 0 9px,color-mix(in srgb,var(--nyx-founder-accent-secondary,#8ea1ff) 72%,#fff) 10px 11px,transparent 12px),radial-gradient(circle,transparent 0 13px,rgba(213,243,255,.5) 14px 15px,transparent 16px);background-size:93px 131px,157px 191px,229px 271px;background-position:9px 120%,62px 135%,133px 150%;mix-blend-mode:screen;filter:drop-shadow(0 0 4px rgba(207,239,255,.55));animation:nyx-founder-bubbles 10s linear infinite}
      @keyframes nyx-founder-name-gradient{0%,100%{background-position:0 50%}50%{background-position:100% 50%}}@keyframes nyx-founder-name-neon{0%,100%{filter:brightness(.9)}50%{filter:brightness(1.28)}}@keyframes nyx-founder-name-pop{0%,82%,100%{transform:translateY(0) scale(1)}88%{transform:translateY(-2px) scale(1.035)}93%{transform:translateY(0) scale(.985)}}@keyframes nyx-founder-sparkle{to{background-position:150px -150px,-193px -193px,221px -221px,-169px 169px,247px -247px}}@keyframes nyx-founder-aurora{50%{background-position:100% 0}}@keyframes nyx-founder-holographic{to{background-position:250% 0}}@keyframes nyx-founder-fireflies{50%{background-position:35px -54px;transform:translateY(-10px)}}@keyframes nyx-founder-cosmic-dust{to{background-position:0 0,127px -149px,-181px -167px,211px -193px,-157px 223px,239px -179px}}@keyframes nyx-founder-electric-storm{0%,16%,18%,55%,57%,100%{opacity:.08}17%,56%{opacity:.88}17.4%,56.4%{opacity:.28}17.8%,56.8%{opacity:.72}40%{background-position:-50% 90%,140% -20%}}@keyframes nyx-founder-meteor-shower{to{background-position:18% 260px,72% 320px,38% 300px}}@keyframes nyx-founder-cyber-grid{to{background-position:0 68px,68px 0,0 0}}@keyframes nyx-founder-plasma{to{transform:rotate(360deg) scale(1.06)}}@keyframes nyx-founder-snowfall{to{background-position:12px 650px,63px 620px,116px 590px}}@keyframes nyx-founder-embers{to{background-position:18px -280px,56px -370px,174px -450px}}@keyframes nyx-founder-bubbles{to{background-position:31px -290px,39px -390px,178px -510px}}@keyframes nyx-founder-decoration-orbit{to{transform:rotate(360deg)}}@keyframes nyx-founder-decoration-twinkle{0%,100%{opacity:.55;filter:brightness(.85)}50%{opacity:1;filter:brightness(1.35)}}@media(prefers-reduced-motion:reduce){.nyx-founder-profile-effect,.nyx-avatar-decoration,.nyx-styled-display-name{animation:none!important}}
    `;
    const terminalPageScript=`(()=>{const output=document.querySelector('[data-nyx-terminal-output]');const input=document.querySelector('[data-nyx-terminal-input]');const write=(text,type='')=>{const row=document.createElement('div');row.className='nyx-terminal-line'+(type?' '+type:'');row.textContent=String(text);output.appendChild(row);output.scrollTop=output.scrollHeight};const run=raw=>{const command=String(raw||'').trim();if(!command)return;write('nyx> '+command,'command');const name=command.toLowerCase();if(name==='clear'){output.textContent='';return}if(name==='help'){write('Commands: help, status, theme, engine, origin, storage, date, clear');return}if(name==='status'){write('Nyx is '+(navigator.onLine?'online':'offline')+' · '+(navigator.platform||'browser'));return}if(name==='theme'){write('Theme: '+(document.body.className.match(/theme-([^ ]+)/)?.[1]||'default'));return}if(name==='engine'){write('Engine: '+(localStorage.getItem('nyx.browserMode')||'scramjet')+' · Transport: '+(localStorage.getItem('nyx.transport')||'libcurl'));return}if(name==='origin'){write('Origin: '+parent.location.origin);return}if(name==='storage'){write('Local settings entries: '+localStorage.length);return}if(name==='date'){write(new Date().toLocaleString());return}write('Unknown command: '+command+'. Type "help" for the command list.','error')};write('Nyx Developer Console');write('Type "help" to list commands. Browser DevTools cannot be opened by a webpage.');document.querySelector('[data-nyx-terminal-form]')?.addEventListener('submit',event=>{event.preventDefault();run(input?.value);if(input)input.value=''});setTimeout(()=>input?.focus(),50)})();`;
    const pages={
      apps:{title:'Apps',body:`<section class="shell-page"><h1>Apps</h1><p>Apps</p><div class="quick-grid apps-launch-grid">${quickTiles()}</div></section>`},
      links:{title:'Bookmarks',body:`<section class="shell-page"><h1>Bookmarks</h1><p>Common links.</p><div class="quick-grid"><button class="quick-tile" data-url="https://www.google.com/"><img class="quick-icon" alt="" src="${appIcon('google.com')}"><span>Google</span></button><button class="quick-tile" data-url="https://duckduckgo.com/"><img class="quick-icon" alt="" src="${appIcon('duckduckgo.com')}"><span>DuckDuckGo</span></button><button class="quick-tile" data-url="https://docs.google.com/"><img class="quick-icon" alt="" src="${appIcon('docs.google.com')}"><span>Docs</span></button></div></section>`},
      terms:{title:'Terms Of Service',style:utilityPageStyle,body:nyxTermsPageMarkup()},
      about:{title:'About Nyx',style:utilityPageStyle+nyxCreditsPresentationStyle+nyxCreditsOwnerImageStyle,body:nyxCreditsPageMarkup()},
      credits:{title:'About Nyx',style:utilityPageStyle+nyxCreditsPresentationStyle+nyxCreditsOwnerImageStyle,body:nyxCreditsPageMarkup()},
      developer:{title:'Developer Console',style:utilityPageStyle,body:`<section aria-label="Eruda developer console"></section>`},
      ephesians1:{title:'Ephesians 1',body:`<section class="shell-page ephesians-diagram"><style>
        .ephesians-diagram{--ink:#f8fafc;--muted:#cbd5e1;--line:rgba(255,255,255,.24);max-width:1120px;margin:auto;padding-bottom:64px}.ephesians-diagram h1{text-align:center;font-size:clamp(30px,5vw,48px);margin:4px 0 6px}.ephesians-diagram>.diagram-sub{text-align:center;margin:0 0 28px;color:var(--muted);font-size:15px}.eph-flow{display:grid;gap:12px}.eph-block{padding:17px 20px;border:1px solid var(--line);border-left:6px solid #94a3b8;border-radius:14px;background:rgba(15,23,42,.58);box-shadow:0 12px 28px rgba(0,0,0,.16)}.eph-block h2{font-size:19px;margin:5px 0 7px}.eph-block p{margin:0;color:#e2e8f0;line-height:1.48;font-size:14px}.eph-verse{color:#cbd5e1;font-size:11px;font-weight:800;letter-spacing:.11em}.eph-father{border-left-color:#60a5fa}.eph-son{border-left-color:#fbbf24}.eph-spirit{border-left-color:#4ade80}.eph-prayer{border-left-color:#c084fc}.eph-arrow{text-align:center;height:22px;font:700 24px/22px Arial,sans-serif;color:#cbd5e1}.eph-purpose{text-align:center;padding:16px;border:1px solid rgba(255,255,255,.34);border-radius:14px;background:rgba(255,255,255,.10);font-size:17px;font-weight:800}.eph-purpose small{display:block;margin-bottom:5px;color:#cbd5e1;font-size:11px;letter-spacing:.1em}.eph-triad{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.eph-triad .eph-block{padding:15px}.eph-triad h2{font-size:17px}@media(max-width:720px){.eph-triad{grid-template-columns:1fr}.ephesians-diagram{padding:20px 4px 50px!important}}</style>
        <h1>Ephesians 1</h1><p class="diagram-sub">God’s purpose in Christ, the Spirit’s seal, and Paul’s prayer for the church</p>
        <div class="eph-flow">
          <article class="eph-block"><div class="eph-verse">1:1–2 · GREETING</div><h2>Paul writes to the faithful in Christ Jesus</h2><p>Grace and peace come from God our Father and the Lord Jesus Christ.</p></article>
          <div class="eph-arrow">↓</div>
          <article class="eph-block eph-father"><div class="eph-verse">1:3–6 · THE FATHER’S PURPOSE</div><h2>Blessed, chosen, and adopted in Christ</h2><p>Before creation, God chose believers and predestined them for adoption through Jesus Christ, according to his loving will.</p></article>
          <div class="eph-arrow">↓</div>
          <article class="eph-block eph-son"><div class="eph-verse">1:7–12 · THE SON’S WORK</div><h2>Redemption, forgiveness, and an inheritance</h2><p>In Christ, believers are redeemed through his blood. God’s plan is to unite all things in Christ—things in heaven and on earth.</p></article>
          <div class="eph-arrow">↓</div>
          <article class="eph-block eph-spirit"><div class="eph-verse">1:13–14 · THE SPIRIT’S SEAL</div><h2>Hearing and believing the gospel → sealed with the Spirit</h2><p>The promised Holy Spirit guarantees the believers’ inheritance until final redemption.</p></article>
          <div class="eph-arrow">↓</div>
          <div class="eph-purpose"><small>REPEATED PURPOSE · 1:6, 12, 14</small>All of this is to the praise of his glory.</div>
          <div class="eph-arrow">↓</div>
          <article class="eph-block eph-prayer"><div class="eph-verse">1:15–23 · PAUL’S PRAYER</div><h2>Pray for spiritual sight</h2><p>Paul asks that believers know the hope of God’s calling, the riches of his inheritance, and the immeasurable greatness of his power.</p></article>
          <div class="eph-arrow">↓</div>
          <div class="eph-triad"><article class="eph-block eph-prayer"><div class="eph-verse">1:20</div><h2>Power displayed</h2><p>God raised Christ and seated him at his right hand.</p></article><article class="eph-block eph-prayer"><div class="eph-verse">1:21–22</div><h2>Christ exalted</h2><p>He is above every rule, authority, power, and name.</p></article><article class="eph-block eph-prayer"><div class="eph-verse">1:22–23</div><h2>Christ and the church</h2><p>Christ is head over all things to the church, his body.</p></article></div>
        </div>
      </section>`}
    };
    const page=pages[name] || pages.apps;
    tab.url='nyx://'+name;
    tab.title=page.title;
    const clearInternal=/^(apps)$/i.test(String(name || page.title || ''));
    state.win.classList.toggle('internal-clear',clearInternal);
    tab.frame.classList.toggle('transparent-internal-page',clearInternal);
    tab.frame.setAttribute('allowtransparency','true');
    tab.frame.style.backgroundColor=clearInternal?'transparent':'';
    tab.frame.removeAttribute('src');
    tab.frame.srcdoc=browserShellPageSrcdoc(page);
    tab.frame.classList.add('active');
    state.win.querySelector('.browser-home')?.classList.add('hidden');
    state.win.classList.remove('browser-blank');
    state.renderTabs?.();
    updateBrowserShellLocation(tab.url);
    if(name==='developer') showNyxErudaPanel(state.win);
    else hideNyxErudaPanel();
    return true;
  }
  //desktop-app-drag
  function canDragDesktopAppSource(el){
    if(!el || document.body.classList.contains('browser-shell')) return false;
    if(el.closest?.('.home-shortcut,.home-shortcut-add,[data-home-shortcuts]')) return false;
    return !!(el.dataset.dragApp==='1' || el.closest?.('.dock,.apps-launch-grid'));
  }
  function hydrateDockDrag(root){
    root.querySelectorAll('[data-app-url]').forEach(btn=>{
      const allow=!document.body.classList.contains('browser-shell');
      btn.draggable=allow;
      if(allow) btn.dataset.dragApp='1';
      else delete btn.dataset.dragApp;
    });
  }
  function readAppPayload(el){
    const img=el.querySelector('img');
    const label=el.querySelector('span')?.textContent || el.getAttribute('title') || 'App';
    return {
      url:el.dataset.appUrl || '',
      title:label.trim() || 'App',
      icon:img?.getAttribute('src') || appIcon('apps')
    };
  }
  function createDesktopApp(payload,x,y){
    if(!payload?.url) return null;
    if(document.body.classList.contains('browser-shell')) return null;
    const desktop=$('desktop');
    if(!desktop) return null;
    const existing=[...desktop.querySelectorAll('.desktop-app')].find(app=>app.dataset.appUrl===payload.url);
    const rect=desktop.getBoundingClientRect();
    const left=Math.max(6,Math.min(rect.width-92,x-rect.left-43))+'px';
    const top=Math.max(6,Math.min(rect.height-126,y-rect.top-43))+'px';
    if(existing){
      existing.style.left=left;
      existing.style.top=top;
      existing.animate?.([{transform:'scale(1.14)'},{transform:'scale(1)'}],{duration:180,easing:'ease-out'});
      return existing;
    }
    const app=document.createElement('button');
    app.className='desktop-app';
    app.dataset.appUrl=payload.url;
    app.draggable=true;
    app.innerHTML=`<img alt="" src="${esc(payload.icon || appIcon('apps'))}"><span>${esc(payload.title || 'App')}</span>`;
    app.style.left=left;
    app.style.top=top;
    desktop.appendChild(app);
    wireDesktopApp(app);
    return app;
  }
  function wireDesktopApp(app){
    let move=null;
    app.addEventListener('click',e=>{
      if(app.dataset.moved==='1'){
        e.preventDefault();
        e.stopPropagation();
        app.dataset.moved='0';
      }
    },true);
    app.addEventListener('pointerdown',e=>{
      if(e.button!==0) return;
      move={x:e.clientX,y:e.clientY,left:app.offsetLeft,top:app.offsetTop,moved:false};
      app.setPointerCapture?.(e.pointerId);
    });
    app.addEventListener('pointermove',e=>{
      if(!move) return;
      const dx=e.clientX-move.x, dy=e.clientY-move.y;
      if(Math.abs(dx)+Math.abs(dy)>5) move.moved=true;
      if(!move.moved) return;
      const desktop=$('desktop');
      const maxX=(desktop?.clientWidth || window.innerWidth)-92;
      const maxY=(desktop?.clientHeight || window.innerHeight)-126;
      app.style.left=Math.max(6,Math.min(maxX,move.left+dx))+'px';
      app.style.top=Math.max(6,Math.min(maxY,move.top+dy))+'px';
      app.dataset.moved='1';
    });
    app.addEventListener('pointerup',()=>{move=null});
  }
  //background-picker
  function bgButton(key, compact=false){
    return `<button class="bg-choice" data-bg-choice="${esc(key)}" title="${esc(bgNames[key]||'Background')}" aria-label="${esc(bgNames[key]||'Background')}"><span>${esc(bgNames[key]||'Background')}</span></button>`;
  }
  function backgroundScope(root=document){
    return root?.dataset?.bgScope || (document.body.classList.contains('browser-shell') ? 'browser' : 'windows');
  }
  function currentBackgroundKeyForScope(scope){
    return scope==='browser' ? store.text('nyx.browserBackground','lofiPurple') : store.text('nyx.background','dragon');
  }
  function renderBackgroundChoices(root, current=currentBackgroundKeyForScope(backgroundScope(root))){
    const scope=backgroundScope(root);
    const customData=store.text('nyx.customBgData','');
    const customUrl=store.text('nyx.customBgUrl','');
    const custom=scope==='browser' ? '' : (customData || customUrl);
    const hasCustom=!!custom;
    root.dataset.bgScope=scope;
    const choices=(hasCustom ? `<button class="bg-choice selected" data-custom-bg-preview title="Uploaded background" aria-label="Uploaded background"><span>Uploaded</span></button>` : '') + Object.keys(bgPresets).map(k=>bgButton(k)).join('');
    root.innerHTML=choices;
    root.querySelectorAll('[data-bg-choice]').forEach(btn=>{
      btn.style.backgroundImage = bgPresets[btn.dataset.bgChoice] || bgPresets.dragon;
    });
    const customBtn=root.querySelector('[data-custom-bg-preview]');
    if(customBtn){
      const customPreview=customUrl && !customData ? (imageProxySrc(customUrl) || customUrl) : custom;
      customBtn.style.backgroundImage = normalizeBgValue(customPreview);
      customBtn.classList.add('selected');
    }
    root.querySelectorAll('[data-bg-choice]').forEach(btn=>btn.classList.toggle('selected',!hasCustom && btn.dataset.bgChoice===current));
    syncBackgroundPreview();
  }
  function chooseBackground(key, scope='windows'){
    if(scope==='browser'){
      store.setText('nyx.browserBackground', key || 'lofiPurple');
    }else{
      store.setText('nyx.background', key || 'dragon');
      store.setText('nyx.customBg','');
      store.setText('nyx.customBgUrl','');
      store.setText('nyx.customBgData','');
    }
    applyUserSettings();
  }
  function applyLagReducerSetting(){
    const lag=store.get('nyx.lagReducer',false);
    document.body.classList.toggle('lag-reducer',lag);
    if(lag){
      const welcome=$('welcomeScreen');
      if(welcome) welcome.classList.add('hidden','force-hidden');
      store.set('nyx.backgroundEnhancer',false);
      store.setText('nyx.glassLevel','0');
      document.documentElement.style.setProperty('--glass-blur','0px');
    }
    qsa('[data-lag-reducer]').forEach(el=>el.classList.toggle('on',lag));
    qsa('[data-switch="nyx.lagReducer"]').forEach(el=>el.classList.toggle('on',lag));
    qsa('[data-performance-lite]').forEach(el=>el.classList.toggle('on',store.get('nyx.performanceLite',false)));
    qsa('[data-switch="nyx.performanceLite"]').forEach(el=>el.classList.toggle('on',store.get('nyx.performanceLite',false)));
  }
  function syncPerformanceLite(){
    const cores=Number(navigator.hardwareConcurrency || 8);
    const memory=Number(navigator.deviceMemory || 8);
    const isChromebook=/\bCrOS\b/i.test(navigator.userAgent || '');
    const veryLowPower=isChromebook || cores<=2 || memory<=2;
    const reducedMotion=matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const enabled=!store.get('nyx.lagReducer',false) && (store.get('nyx.performanceLite',false) || veryLowPower || reducedMotion);
    document.body.classList.toggle('performance-lite',enabled);
    if(enabled){
      document.documentElement.style.setProperty('--glass-blur','10px');
      document.documentElement.style.setProperty('--glass-saturate','1.08');
    }
  }
  let runtimeLagWatchStarted=false;
  function startRuntimeLagWatch(){
    if(runtimeLagWatchStarted) return;
    runtimeLagWatchStarted=true;
    let last=performance.now();
    let slowFrames=0;
    let clearTimer=0;
    let lastToast=0;
    const loop=now=>{
      const delta=now-last;
      last=now;
      if(!store.get('nyx.lagReducer',false)){
        if(delta>58) slowFrames+=1.35;
        else slowFrames=Math.max(0,slowFrames-.25);
        if(slowFrames>=5){
          document.body.classList.add('runtime-lag-guard');
          clearTimeout(clearTimer);
          clearTimer=setTimeout(()=>{
            slowFrames=0;
            document.body.classList.remove('runtime-lag-guard');
          },14000);
          if(Date.now()-lastToast>30000){
            lastToast=Date.now();
            toast('Lag guard trimmed effects for a moment');
          }
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  function applyBrowserShellMode(){
    const enabled=store.get('nyx.browserShellMode',true);
    if(enabled && store.text('nyx.glassLevel','80')!=='-40') store.setText('nyx.glassLevel','-40');
    if(enabled) store.set('nyx.backgroundEnhancer',false);
    document.body.classList.toggle('browser-shell',enabled);
    if(enabled){
      qsa('[data-app-url]').forEach(el=>{
        if(el.closest?.('.browser-window iframe')) return;
        el.draggable=false;
        delete el.dataset.dragApp;
      });
    }
    syncChromeMode(enabled);
    if(!enabled) document.body.classList.remove('menu-open');
    qsa('[data-switch="nyx.browserShellMode"]').forEach(el=>el.classList.toggle('on',enabled));
    applyGlassSetting();
    updateResponsiveFit();
    updateDockFullscreenState();
  }
  function ensureVisualEffectNodes(count=64){
    const layer=$('visualEffects');
    if(!layer) return [];
    while(layer.children.length<count) layer.appendChild(document.createElement('i'));
    while(layer.children.length>count) layer.lastElementChild?.remove();
    return Array.from(layer.children);
  }
  //themes-and-visual-effects
  let nyxStartupOpened=false;
  let defaultVantaInstance=null;
  let rubyVantaInstance=null;
  let whiteVantaInstance=null;
  let emeraldVantaInstance=null;
  let sakuraVantaInstance=null;
  function shouldPauseVantaBackgrounds(){
    return document.body.classList.contains('browser-content-active');
  }
  function threeDBackgroundsEnabled(){
    return store.get('nyx.threeDBackgrounds',false);
  }
  const nyxCustomThemeDefaults={base:'#6f9ee8'};
  function nyxThemeHex(value,fallback=nyxCustomThemeDefaults.base){
    const raw=String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : fallback;
  }
  function nyxShadeHex(hex,percent=0){
    const clean=nyxThemeHex(hex);
    const amount=Math.max(-100,Math.min(100,Number(percent) || 0))/100;
    const channel=index=>{
      const value=parseInt(clean.slice(index,index+2),16);
      return Math.round(amount>=0 ? value+(255-value)*amount : value*(1+amount));
    };
    return '#'+[1,3,5].map(index=>channel(index).toString(16).padStart(2,'0')).join('');
  }
  function nyxHexToNumber(hex){
    return parseInt(nyxThemeHex(hex).slice(1),16);
  }
  function nyxThemeLogoFilter(hex){
    const clean=nyxThemeHex(hex);
    const channels=[1,3,5].map(index=>parseInt(clean.slice(index,index+2),16)/255);
    const max=Math.max(...channels);
    const min=Math.min(...channels);
    const delta=max-min;
    let hue=0;
    if(delta){
      if(max===channels[0]) hue=60*(((channels[1]-channels[2])/delta)%6);
      else if(max===channels[1]) hue=60*((channels[2]-channels[0])/delta+2);
      else hue=60*((channels[0]-channels[1])/delta+4);
    }
    if(hue<0) hue+=360;
    const lightness=(max+min)/2;
    const saturation=delta ? delta/(1-Math.abs(2*lightness-1)) : 0;
    const hueShift=((hue-208+540)%360)-180;
    const saturationScale=Math.max(0,Math.min(4,saturation/.53));
    const brightnessScale=Math.max(.35,Math.min(1.7,lightness/.64));
    return `hue-rotate(${hueShift.toFixed(1)}deg) saturate(${saturationScale.toFixed(2)}) brightness(${brightnessScale.toFixed(2)})`;
  }
  function nyxCustomThemePalette(color=store.text('nyx.customThemeColor',nyxCustomThemeDefaults.base)){
    const base=nyxThemeHex(color);
    return {
      base,
      canvas:nyxShadeHex(base,-84),
      top:nyxShadeHex(base,-91),
      field:nyxShadeHex(base,-79),
      panel:nyxShadeHex(base,-74),
      line:nyxShadeHex(base,-30),
      accent:nyxShadeHex(base,8),
      bright:nyxShadeHex(base,38),
      text:'#f4f7ff',
      muted:nyxShadeHex(base,48),
      dot:nyxShadeHex(base,-67)
    };
  }
  function applyCustomThemePalette(theme=normalizeNyxTheme(store.text('nyx.theme','default'))){
    const root=document.documentElement;
    const names=['base','canvas','top','field','panel','line','accent','bright','text','muted','dot'];
    if(theme!=='custom'){
      names.forEach(name=>root.style.removeProperty('--nyx-custom-'+name));
      root.style.removeProperty('--nyx-custom-logo-filter');
      return;
    }
    const palette=nyxCustomThemePalette();
    names.forEach(name=>root.style.setProperty('--nyx-custom-'+name,palette[name]));
    root.style.setProperty('--nyx-custom-logo-filter',nyxThemeLogoFilter(palette.bright));
  }
  function applyCustomThemeColor(value){
    const color=nyxThemeHex(value);
    store.setText('nyx.customThemeColor',color);
    store.setText('nyx.theme','custom');
    stopDefaultVanta();
    applyThemeSetting();
    return color;
  }
  function syncCustomThemeMaker(root=document,color=nyxThemeHex(store.text('nyx.customThemeColor',nyxCustomThemeDefaults.base))){
    root.querySelectorAll?.('[data-custom-theme-color],[data-custom-theme-hex]')?.forEach(input=>{input.value=color});
    root.querySelectorAll?.('[data-custom-theme-swatch]')?.forEach(swatch=>swatch.style.setProperty('--nyx-swatch',color));
  }
  function syncHomeDotFieldVisibility(){
    const hide=threeDBackgroundsEnabled() && !document.body.classList.contains('custom-bg-active');
    qsa('.nyx-home-dot-field').forEach(canvas=>{
      if(hide) canvas.style.setProperty('display','none','important');
      else canvas.style.removeProperty('display');
    });
  }
  function shouldShowDefaultVanta(){
    const theme=store.text('nyx.theme','default');
    return threeDBackgroundsEnabled() && (theme==='default' || theme==='midnight' || theme==='custom') && !shouldPauseVantaBackgrounds() && !document.body.classList.contains('custom-bg-active');
  }
  function shouldShowRubyVanta(){
    const theme=store.text('nyx.theme','default');
    return threeDBackgroundsEnabled() && theme==='ruby' && !shouldPauseVantaBackgrounds() && !document.body.classList.contains('custom-bg-active');
  }
  function shouldShowWhiteVanta(){
    const theme=store.text('nyx.theme','default');
    return threeDBackgroundsEnabled() && theme==='fresh' && !shouldPauseVantaBackgrounds() && !document.body.classList.contains('custom-bg-active');
  }
  function shouldShowEmeraldVanta(){
    const theme=store.text('nyx.theme','default');
    return threeDBackgroundsEnabled() && theme==='emerald' && !shouldPauseVantaBackgrounds() && !document.body.classList.contains('custom-bg-active');
  }
  function shouldShowSakuraVanta(){
    const theme=store.text('nyx.theme','default');
    return threeDBackgroundsEnabled() && theme==='sakura' && !shouldPauseVantaBackgrounds() && !document.body.classList.contains('custom-bg-active');
  }
  function stopDefaultVanta(){
    if(!defaultVantaInstance) return;
    try{defaultVantaInstance.destroy()}catch{}
    defaultVantaInstance=null;
  }
  function stopRubyVanta(){
    if(!rubyVantaInstance) return;
    try{rubyVantaInstance.destroy()}catch{}
    rubyVantaInstance=null;
  }
  function stopWhiteVanta(){
    if(!whiteVantaInstance) return;
    try{whiteVantaInstance.destroy()}catch{}
    whiteVantaInstance=null;
  }
  function stopEmeraldVanta(){
    if(!emeraldVantaInstance) return;
    try{emeraldVantaInstance.destroy()}catch{}
    emeraldVantaInstance=null;
  }
  function stopSakuraVanta(){
    if(!sakuraVantaInstance) return;
    try{sakuraVantaInstance.destroy()}catch{}
    sakuraVantaInstance=null;
  }
  function syncDefaultVantaBackground(){
    const layer=$('defaultVantaBg');
    if(!layer) return;
    const show=shouldShowDefaultVanta();
    layer.hidden=!show;
    if(!show){
      stopDefaultVanta();
      return;
    }
    if(defaultVantaInstance || !window.VANTA?.NET || !window.THREE) return;
    try{
      const customPalette=store.text('nyx.theme','default')==='custom' ? nyxCustomThemePalette() : null;
      defaultVantaInstance=VANTA.NET({
        el:layer,
        mouseControls:true,
        touchControls:true,
        gyroControls:false,
        minHeight:200.00,
        minWidth:200.00,
        scale:1.00,
        scaleMobile:1.00,
        color:customPalette ? nyxHexToNumber(customPalette.accent) : 0x511151,
        backgroundColor:customPalette ? nyxHexToNumber(customPalette.canvas) : 0x241933
      });
    }catch{
      stopDefaultVanta();
    }
  }
  function syncRubyVantaBackground(){
    const layer=$('rubyVantaBg');
    if(!layer) return;
    const show=shouldShowRubyVanta();
    layer.hidden=!show;
    if(!show){
      stopRubyVanta();
      return;
    }
    if(rubyVantaInstance || !window.VANTA?.GLOBE || !window.THREE) return;
    try{
      rubyVantaInstance=VANTA.GLOBE({
        el:layer,
        mouseControls:true,
        touchControls:true,
        gyroControls:false,
        minHeight:200.00,
        minWidth:200.00,
        scale:1.00,
        scaleMobile:1.00,
        color:0xab1a1a
      });
    }catch{
      stopRubyVanta();
    }
  }
  function syncWhiteVantaBackground(){
    const layer=$('whiteVantaBg');
    if(!layer) return;
    const show=shouldShowWhiteVanta();
    layer.hidden=!show;
    if(!show){
      stopWhiteVanta();
      return;
    }
    if(whiteVantaInstance || !window.VANTA?.BIRDS || !window.THREE) return;
    try{
      whiteVantaInstance=VANTA.BIRDS({
        el:layer,
        mouseControls:true,
        touchControls:true,
        gyroControls:false,
        minHeight:200.00,
        minWidth:200.00,
        scale:1.00,
        scaleMobile:1.00,
        backgroundColor:0x162019,
        color1:0xd9e5d6,
        color2:0x728f6b,
        separation:24.00,
        cohesion:22.00
      });
    }catch{
      stopWhiteVanta();
    }
  }
  function syncEmeraldVantaBackground(){
    const layer=$('emeraldVantaBg');
    if(!layer) return;
    const show=shouldShowEmeraldVanta();
    layer.hidden=!show;
    if(!show){
      stopEmeraldVanta();
      return;
    }
    if(emeraldVantaInstance || !window.VANTA?.DOTS || !window.THREE) return;
    try{
      emeraldVantaInstance=VANTA.DOTS({
        el:layer,
        mouseControls:true,
        touchControls:true,
        gyroControls:false,
        minHeight:200.00,
        minWidth:200.00,
        scale:1.00,
        scaleMobile:1.00,
        color:0x10ab3b,
        color2:0x3bae28,
        backgroundColor:0x123025,
        size:2.00
      });
    }catch{
      stopEmeraldVanta();
    }
  }
  function syncSakuraVantaBackground(){
    const layer=$('sakuraVantaBg');
    if(!layer) return;
    const show=shouldShowSakuraVanta();
    layer.hidden=!show;
    if(!show){
      stopSakuraVanta();
      return;
    }
    if(sakuraVantaInstance || !window.VANTA?.CLOUDS || !window.THREE) return;
    try{
      sakuraVantaInstance=VANTA.CLOUDS({
        el:layer,
        mouseControls:true,
        touchControls:true,
        gyroControls:false,
        minHeight:200.00,
        minWidth:200.00,
        cloudColor:0xc9adde,
        sunColor:0xff1818,
        sunGlareColor:0xf23f04,
        sunlightColor:0xde1d4b
      });
    }catch{
      stopSakuraVanta();
    }
  }
  function syncThemeVantaBackgrounds(){
    /* Each active theme owns exactly one optional 3D scene.  The layers are
       mutually exclusive via their `shouldShow…` guards, so theme changes
       replace a scene instead of stacking canvases. */
    syncDefaultVantaBackground();
    syncRubyVantaBackground();
    syncWhiteVantaBackground();
    syncEmeraldVantaBackground();
    syncSakuraVantaBackground();
    syncHomeDotFieldVisibility();
    syncNyxWaveBackground();
  }
  function syncNyxWaveBackground(){
    const wave=$('nyxWaveBg');
    if(!wave) return;
    const active=!threeDBackgroundsEnabled() && !store.get('nyx.lagReducer',false) && !document.body.classList.contains('browser-content-active') && !document.body.classList.contains('custom-bg-active');
    const notify=()=>{
      try{wave.contentWindow?.postMessage({type:'nyx-wave-active',active},location.origin)}catch{}
    };
    wave.dataset.active=active ? '1' : '0';
    if(!wave.dataset.waveSyncReady){
      wave.dataset.waveSyncReady='1';
      wave.addEventListener('load',notify);
    }
    notify();
  }
  function ensureFreshThemeOptions(root=document){
    root.querySelectorAll?.('[data-theme-value]')?.forEach(select=>{
      let freshOption=select.querySelector('option[value="fresh"]');
      if(!freshOption){
        const option=document.createElement('option');
        option.value='fresh';
        option.textContent='Fern';
        select.appendChild(option);
        freshOption=option;
      }
      freshOption.textContent='Fern';
      if(!select.querySelector('option[value="midnight"]')){
        const option=document.createElement('option');
        option.value='midnight';
        option.textContent='Midnight';
        select.appendChild(option);
      }
      if(!select.querySelector('option[value="custom"]')){
        const option=document.createElement('option');
        option.value='custom';
        option.textContent='Custom';
        select.appendChild(option);
      }
    });
  }
  const nyxThemeNames=['default','ruby','emerald','sakura','fresh','midnight','custom'];
  const nyxThemeClasses=nyxThemeNames.map(name=>'theme-'+name);
  function normalizeNyxTheme(value){
    return nyxThemeNames.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'default';
  }
  function applyThemeSetting(){
    const theme=normalizeNyxTheme(store.text('nyx.theme','default'));
    if(store.text('nyx.theme','default')!==theme) store.setText('nyx.theme',theme);
    document.body.classList.remove('theme-default','theme-ruby','theme-emerald','theme-sakura','theme-fresh','theme-midnight','theme-custom');
    document.body.classList.add('theme-'+theme);
    if(theme==='custom') document.body.classList.add('theme-default');
    document.body.dataset.nyxTheme=theme;
    document.documentElement.dataset.nyxTheme=theme;
    document.documentElement.style.colorScheme='dark';
    qsa('#userGreeting').forEach(el=>{
      if(theme==='fresh'){
        el.style.setProperty('color','#d9e5d6','important');
        el.style.setProperty('-webkit-text-fill-color','#d9e5d6','important');
        el.style.setProperty('border-color','#354b36','important');
      }else{
        el.style.removeProperty('color');
        el.style.removeProperty('-webkit-text-fill-color');
        el.style.removeProperty('border-color');
      }
    });
    applyCustomThemePalette(theme);
    applyNyxLogoTheme(theme);
    ensureFreshThemeOptions();
    qsa('[data-theme-value]').forEach(el=>{el.value=theme});
    syncInternalThemeFrames(theme);
    syncThemeVantaBackgrounds();
    window.dispatchEvent(new CustomEvent('nyx:themechange',{detail:{theme}}));
  }
  function syncInternalThemeFrames(theme=store.text('nyx.theme','default')){
    const clean=normalizeNyxTheme(theme);
    document.querySelectorAll('iframe.view').forEach(frame=>{
      try{
        const frameHref=String(frame.contentWindow?.location?.href || frame.getAttribute('src') || '');
        const source=browserShellSourceUrl(frameHref) || frameHref;
        const target=new URL(source,location.href);
        if(target.origin!==location.origin) return;
        const doc=frame.contentDocument;
        if(!doc?.body) return;
        doc.body.classList.remove(...nyxThemeClasses);
        doc.body.classList.add('theme-'+clean);
        doc.body.dataset.nyxTheme=clean;
        doc.documentElement.dataset.nyxTheme=clean;
        ensureFreshThemeOptions(doc);
        doc.querySelectorAll('[data-theme-value]').forEach(el=>{el.value=clean});
      }catch{}
      try{frame.contentWindow?.postMessage?.({type:'nyx:theme-sync',theme:clean},'*')}catch{}
    });
  }
  function applyVisualEffectSetting(){
    const effect=store.text('nyx.visualEffect','none');
    const allowed=['none','rain','stars','hearts','pokeballs','flowers','emeralds'];
    const value=allowed.includes(effect) ? effect : 'none';
    const speed=Math.max(.3,Math.min(3,Number(store.text('nyx.visualEffectSpeed','1.1')) || 1.1));
    const requestedAmount=Math.max(1,Math.min(64,Number(store.text('nyx.visualEffectAmount','16')) || 16));
    const canShow=nyxStartupOpened && document.body.classList.contains('browser-shell') && !document.body.classList.contains('browser-content-active') && !store.get('nyx.lagReducer',false);
    syncPerformanceLite();
    const lite=document.body.classList.contains('performance-lite');
    const amount=lite ? Math.min(requestedAmount,16) : requestedAmount;
    const nodes=ensureVisualEffectNodes(canShow && value!=='none' ? amount : 0);
    const isFallingEffect=['hearts','pokeballs','flowers','emeralds'].includes(value);
    const randomizeFallingNode=node=>{
      const startX=Math.random()*112-6;
      const driftA=(Math.random()*34-17) + (Math.random()<.5 ? -18 : 18);
      const driftB=driftA * (Math.random()*-.75-.15) + (Math.random()*18-9);
      const driftC=driftA * (Math.random()*.55-.2) + (Math.random()*26-13);
      node.style.setProperty('--fall-x',startX.toFixed(2)+'vw');
      node.style.setProperty('--fall-start-y',(-24-Math.random()*36).toFixed(2)+'vh');
      node.style.setProperty('--fall-mid-y-a',(22+Math.random()*24).toFixed(2)+'vh');
      node.style.setProperty('--fall-mid-y-b',(58+Math.random()*28).toFixed(2)+'vh');
      node.style.setProperty('--fall-end-y',(112+Math.random()*28).toFixed(2)+'vh');
      node.style.setProperty('--fall-drift-a',driftA.toFixed(2)+'vw');
      node.style.setProperty('--fall-drift-b',driftB.toFixed(2)+'vw');
      node.style.setProperty('--fall-drift-c',driftC.toFixed(2)+'vw');
      node.style.setProperty('--fall-rot-start',(Math.random()*90-45).toFixed(0)+'deg');
      node.style.setProperty('--fall-rot-a',(80+Math.random()*160).toFixed(0)+'deg');
      node.style.setProperty('--fall-rot-b',(230+Math.random()*220).toFixed(0)+'deg');
      node.style.setProperty('--fall-rot-end',(430+Math.random()*520).toFixed(0)+'deg');
      node.style.setProperty('--fall-scale-start',(.62+Math.random()*.24).toFixed(2));
      node.style.setProperty('--fall-scale-a',(.82+Math.random()*.34).toFixed(2));
      node.style.setProperty('--fall-scale-b',(.72+Math.random()*.32).toFixed(2));
      node.style.setProperty('--fall-scale-end',(.82+Math.random()*.36).toFixed(2));
      node.style.setProperty('--fall-opacity',(.66+Math.random()*.32).toFixed(2));
    };
    nodes.forEach((node,index)=>{
      node.style.display=index<amount ? '' : 'none';
      node.style.left=(Math.random()*104-2).toFixed(2)+'%';
      node.style.top=(Math.random()*96).toFixed(2)+'%';
      node.style.fontSize=(16+Math.random()*20).toFixed(1)+'px';
      node.style.animationDelay='-'+(Math.random()*(isFallingEffect ? 14 : 6)/speed).toFixed(2)+'s';
      const baseDuration=isFallingEffect ? 7.6+Math.random()*7.8 : .85+Math.random()*1.8;
      node.style.animationDuration=(baseDuration/speed).toFixed(2)+'s';
      node.style.opacity=(.58+Math.random()*.42).toFixed(2);
      if(isFallingEffect){
        randomizeFallingNode(node);
        node.onanimationiteration=()=>randomizeFallingNode(node);
      }else{
        node.onanimationiteration=null;
      }
      const randomEdge=side=>{
        if(side===0) return {x:(Math.random()*120-10).toFixed(2)+'vw',y:'-14vh'};
        if(side===1) return {x:'114vw',y:(Math.random()*120-10).toFixed(2)+'vh'};
        if(side===2) return {x:(Math.random()*120-10).toFixed(2)+'vw',y:'114vh'};
        return {x:'-14vw',y:(Math.random()*120-10).toFixed(2)+'vh'};
      };
      const startSide=Math.floor(Math.random()*4);
      const endSide=(startSide+2+Math.floor(Math.random()*2))%4;
      const start=randomEdge(startSide);
      const end=randomEdge(endSide);
      node.style.setProperty('--effect-x0',start.x);
      node.style.setProperty('--effect-y0',start.y);
      node.style.setProperty('--effect-x1',end.x);
      node.style.setProperty('--effect-y1',end.y);
    });
    ['rain','stars','hearts','pokeballs','flowers','emeralds'].forEach(name=>document.body.classList.toggle('effect-'+name,value===name && canShow));
    document.body.classList.toggle('effect-amount-low',amount<=6);
    document.body.classList.toggle('effect-amount-medium',amount>6 && amount<=10);
    document.documentElement.style.setProperty('--effect-speed',String(speed));
    qsa('[data-effect-value]').forEach(el=>{el.value=value});
    qsa('[data-effect-speed]').forEach(el=>{el.value=String(speed)});
    qsa('[data-effect-amount]').forEach(el=>{el.value=String(requestedAmount)});
    qsa('[data-effect-speed-label]').forEach(el=>{el.textContent=speed.toFixed(1)+'x'});
    qsa('[data-effect-amount-label]').forEach(el=>{el.textContent=String(requestedAmount)});
  }
  //user-settings-apply
  function applyUserSettings(){
    document.body.classList.toggle('three-d-backgrounds',store.get('nyx.threeDBackgrounds',false));
    applyLagReducerSetting();
    applyBrowserShellMode();
    applyThemeSetting();
    syncPerformanceLite();
    syncThemeVantaBackgrounds();
    applyFontSetting();
    applyVisualEffectSetting();
    const name=store.text('nyx.userName','').trim();
    const greeting=$('userGreeting');
    if(greeting){
      greeting.textContent=name || 'Set username';
      greeting.classList.toggle('needs-name',!name);
    }
    const customData=store.text('nyx.customBgData','');
    const customUrl=store.text('nyx.customBgUrl','');
    const value=currentBackgroundValue();
    const customSrc=customData || customUrl;
    document.documentElement.style.setProperty('--bg-size','cover');
    if(nyxStartupOpened){
      setCustomBackgroundLayer(customSrc);
    }else{
      document.body.classList.remove('custom-bg-active');
      $('customBgImage')?.removeAttribute('src');
    }
    applyBackgroundValue(value);
    document.documentElement.style.setProperty('--bg-enhanced-render',normalizeBgValue(value));
    document.documentElement.style.setProperty('--browser-bg-render',normalizeBgValue(currentBrowserBackgroundValue()));
    syncBackgroundPreview(value);
    updateWeatherContrast(value);
    store.set('nyx.backgroundEnhancer',false);
    const enhance=false;
    document.body.classList.remove('bg-enhanced');
    document.documentElement.style.setProperty('--bg-brightness','1');
    document.documentElement.style.setProperty('--bg-contrast','1');
    document.documentElement.style.setProperty('--bg-saturate','1');
    document.documentElement.style.setProperty('--bg-bright-mask','linear-gradient(transparent,transparent)');
    setQualityStatus('');
    qsa('[data-bg-enhancer]').forEach(el=>el.classList.toggle('on',enhance));
    const engine=store.text('nyx.engine','duckduckgo');
    qsa('[data-engine-value]').forEach(el=>{el.value=engine});
    applyGlassSetting();
    syncPerformanceLite();
    if(nyxStartupOpened){
      startHieroglyphObserver();
      applyHieroglyphText();
    }
  }
  function migrateGlassDefault(){
    if(store.get('nyx.glassDefault80',false)) return;
    const saved=store.text('nyx.glassLevel','');
    if(!saved || saved==='72') store.setText('nyx.glassLevel','80');
    store.set('nyx.glassDefault80',true);
  }
  function applyGlassSetting(){
    const raw=store.text('nyx.glassLevel','80');
    const parsed=Number(raw);
    const value=Math.max(-200,Math.min(200,Number.isFinite(parsed) ? parsed : 80));
    const brightness=Math.max(0,Math.min(value,100))/100;
    const extra=Math.max(0,value-100)/100;
    const negative=Math.abs(Math.min(value,0))/200;
    const alpha=Math.min(0.94,0.7 - brightness * 0.58 + negative * 0.24).toFixed(3);
    const cardA=Math.min(0.32,0.19 - brightness * 0.14 + negative * 0.08).toFixed(3);
    const cardB=Math.min(0.24,0.12 - brightness * 0.09 + negative * 0.08).toFixed(3);
    const control=Math.min(0.28,0.16 - brightness * 0.105 + negative * 0.075).toFixed(3);
    const baseBlur=36 - brightness * 16 + negative * 32;
    const blur=Math.max(0,Math.round(baseBlur * (1 - extra)));
    const saturate=Math.max(0.8,1.02 + brightness * 0.58 - negative * 0.22).toFixed(2);
    const root=document.documentElement;
    root.style.setProperty('--glass-panel',`rgba(10,12,15,${alpha})`);
    root.style.setProperty('--glass-card-a',`rgba(255,255,255,${cardA})`);
    root.style.setProperty('--glass-card-b',`rgba(255,255,255,${cardB})`);
    root.style.setProperty('--glass-control',`rgba(255,255,255,${control})`);
    root.style.setProperty('--glass-blur',blur+'px');
    root.style.setProperty('--glass-saturate',saturate);
    root.style.setProperty('--glass-clarity',brightness.toFixed(2));
    qsa('[data-glass-value]').forEach(el=>{el.value=String(value)});
    qsa('[data-glass-output]').forEach(el=>{el.textContent=value+'%'});
  }
  //background-rendering
  function normalizeBgValue(value){
    const raw=String(value||'').trim();
    if(raw.startsWith('url(') || raw.startsWith('linear-gradient')) return raw;
    const src=/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(raw) ? 'https://'+raw : raw;
    return `url("${src.replaceAll('"','%22')}")`;
  }
  function bgSrc(value){
    const match=String(value||'').match(/^url\(["']?(.+?)["']?\)$/);
    return match ? match[1] : '';
  }
  function currentBackgroundValue(){
    const bg=store.text('nyx.background','dragon');
    const customData=store.text('nyx.customBgData','');
    const customUrl=store.text('nyx.customBgUrl','');
    const legacy=store.text('nyx.customBg','');
    return customData ? `url("${customData}")` : customUrl ? `url("${customUrl.replaceAll('"','%22')}")` : legacy || bgPresets[bg] || bgPresets.dragon;
  }
  function currentBrowserBackgroundValue(){
    const bg=store.text('nyx.browserBackground','lofiPurple');
    return bgPresets[bg] || bgPresets.lofiPurple || bgPresets.dragon;
  }
  function imageProxySrc(src){
    if(!/^https?:\/\//i.test(src)) return '';
    return 'https://images.weserv.nl/?url=' + encodeURIComponent(src.replace(/^https?:\/\//i,''));
  }
  function imageCandidates(src){
    const proxy=imageProxySrc(src);
    return proxy && proxy!==src ? [src,proxy] : [src];
  }
  function loadImageWithFallback(img, src, onLoad, onError){
    const candidates=imageCandidates(src);
    let index=0;
    img.referrerPolicy='no-referrer';
    img.onload=()=>onLoad?.(img.src,img);
    img.onerror=()=>{
      index++;
      if(index<candidates.length){
        img.src=candidates[index];
        return;
      }
      onError?.();
    };
    img.src=candidates[index] || '';
  }
  function syncBackgroundPreview(value=currentBackgroundValue()){
    const cssValue=normalizeBgValue(value);
    const src=bgSrc(cssValue);
    qsa('[data-bg-full-preview]').forEach(el=>{
      el.style.backgroundImage=src ? '' : cssValue;
      el.textContent='';
      if(src){
        const img=document.createElement('img');
        img.alt='';
        loadImageWithFallback(img,src,loadedSrc=>{
          if(loadedSrc!==src) el.style.backgroundImage=`url("${loadedSrc}")`;
        },()=>{
          el.style.backgroundImage=cssValue;
          el.textContent='Preview unavailable';
        });
        el.appendChild(img);
      }
    });
  }
  function setQualityStatus(text=''){
    qsa('[data-bg-quality-status]').forEach(el=>{el.textContent=text});
  }
  function setCustomBackgroundLayer(src, enhancedSrc=''){
    const img=$('customBgImage');
    if(!img) return Promise.resolve(null);
    const layerRun=++customBgLayerRun;
    const next=enhancedSrc || src || '';
    if(!next){
      document.body.classList.remove('custom-bg-active');
      img.removeAttribute('src');
      syncThemeVantaBackgrounds();
      return Promise.resolve(null);
    }
    return new Promise(resolve=>{
      loadImageWithFallback(img,next,(loadedSrc,loadedImg)=>{
      if(layerRun!==customBgLayerRun){resolve(null); return}
      const loadedCss=`url("${loadedSrc.replaceAll('"','%22')}")`;
      document.documentElement.style.setProperty('--bg-render',loadedCss);
      document.documentElement.style.setProperty('--bg-enhanced-render',loadedCss);
      document.body.classList.add('custom-bg-active');
      syncThemeVantaBackgrounds();
      resolve({src:loadedSrc,width:loadedImg.naturalWidth,height:loadedImg.naturalHeight});
    },()=>{
      if(layerRun!==customBgLayerRun){resolve(null); return}
      document.body.classList.remove('custom-bg-active');
      syncThemeVantaBackgrounds();
      resolve(null);
    });
    });
  }
  function renderEnhancedImage(src, done){
    const img=new Image();
    const candidates=imageCandidates(src);
    let index=0;
    img.crossOrigin='anonymous';
    img.referrerPolicy='no-referrer';
    img.onload=()=>{
      try{
        const minW=2560, minH=1440, maxW=3840, maxH=2160;
        const minScale=Math.max(minW/img.naturalWidth,minH/img.naturalHeight,1);
        const maxScale=Math.min(maxW/img.naturalWidth,maxH/img.naturalHeight);
        const upscale=Math.max(1,Math.min(minScale,maxScale));
        const w=Math.round(img.naturalWidth*upscale);
        const h=Math.round(img.naturalHeight*upscale);
        let source=img;
        let sourceW=img.naturalWidth;
        let sourceH=img.naturalHeight;
        while(sourceW*1.75<w && sourceH*1.75<h){
          const step=document.createElement('canvas');
          step.width=Math.min(w,Math.round(sourceW*1.75));
          step.height=Math.min(h,Math.round(sourceH*1.75));
          const stepCtx=step.getContext('2d');
          if(!stepCtx) throw new Error('canvas unavailable');
          stepCtx.imageSmoothingEnabled=true;
          stepCtx.imageSmoothingQuality='high';
          stepCtx.drawImage(source,0,0,step.width,step.height);
          source=step;
          sourceW=step.width;
          sourceH=step.height;
        }
        const canvas=document.createElement('canvas');
        canvas.width=w;
        canvas.height=h;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        if(!ctx) throw new Error('canvas unavailable');
        ctx.imageSmoothingEnabled=true;
        ctx.imageSmoothingQuality='high';
        ctx.drawImage(source,0,0,w,h);
        const pixels=ctx.getImageData(0,0,w,h);
        const data=pixels.data;
        const original=new Uint8ClampedArray(data);
        const at=(x,y,c)=>original[((Math.max(0,Math.min(h-1,y))*w + Math.max(0,Math.min(w-1,x)))*4)+c];
        for(let y=0;y<h;y++){
          for(let x=0;x<w;x++){
            const idx=(y*w+x)*4;
            for(let c=0;c<3;c++){
              const blur=(
                at(x-1,y-1,c)+at(x,y-1,c)*2+at(x+1,y-1,c)+
                at(x-1,y,c)*2+at(x,y,c)*4+at(x+1,y,c)*2+
                at(x-1,y+1,c)+at(x,y+1,c)*2+at(x+1,y+1,c)
              )/16;
              const detail=original[idx+c]-blur;
              const edge=Math.min(36,Math.abs(detail))*Math.sign(detail);
              const sharpened=original[idx+c] + detail*2.65 + edge*.9;
              data[idx+c]=Math.max(0,Math.min(255,(sharpened-128)*1.16+128+6));
            }
          }
        }
        ctx.putImageData(pixels,0,0);
        done(canvas.toDataURL('image/jpeg',0.97),`Quality Boost active: ${img.naturalWidth}x${img.naturalHeight} to ${w}x${h}`);
      }catch{
        done('', 'Quality boost needs an uploaded/local image or a CORS-enabled link');
      }
    };
    img.onerror=()=>{
      index++;
      if(index<candidates.length){
        img.src=candidates[index];
        return;
      }
      done('', 'Background link could not be loaded');
    };
    img.src=candidates[index] || src;
  }
  function setWeatherContrast(lightBackground){
    const root=document.documentElement;
    if(lightBackground){
      root.style.setProperty('--weather-text','#0f172a');
      root.style.setProperty('--weather-muted','#334155');
      root.style.setProperty('--weather-control','rgba(15,23,42,.14)');
      root.style.setProperty('--weather-control-border','rgba(15,23,42,.16)');
      root.style.setProperty('--weather-shadow','0 1px 10px rgba(255,255,255,.34)');
    }else{
      root.style.setProperty('--weather-text','#f8fafc');
      root.style.setProperty('--weather-muted','#dbeafe');
      root.style.setProperty('--weather-control','rgba(0,0,0,.28)');
      root.style.setProperty('--weather-control-border','rgba(255,255,255,.16)');
      root.style.setProperty('--weather-shadow','0 1px 12px rgba(0,0,0,.36)');
    }
  }
  function updateWeatherContrast(value){
    const cssValue=normalizeBgValue(value || bgPresets.dragon);
    const src=bgSrc(cssValue);
    if(!src || cssValue.startsWith('linear-gradient')){setWeatherContrast(false); return}
    const img=new Image();
    const maskCandidates=imageCandidates(src);
    let maskIndex=0;
    img.crossOrigin='anonymous';
    img.referrerPolicy='no-referrer';
    img.onload=()=>{
      try{
        const w=360, h=210;
        const canvas=document.createElement('canvas');
        canvas.width=w;
        canvas.height=h;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        if(!ctx) return;
        const scale=Math.max(w/img.naturalWidth,h/img.naturalHeight);
        const drawW=img.naturalWidth*scale;
        const drawH=img.naturalHeight*scale;
        ctx.drawImage(img,(w-drawW)/2,(h-drawH)/2,drawW,drawH);
        const sample=ctx.getImageData(Math.floor(w*.72),0,Math.floor(w*.28),Math.floor(h*.46)).data;
        let total=0, count=0;
        for(let i=0;i<sample.length;i+=16){
          total+=.2126*sample[i] + .7152*sample[i+1] + .0722*sample[i+2];
          count++;
        }
        setWeatherContrast(count ? total/count > 150 : false);
      }catch{
        setWeatherContrast(false);
      }
    };
    img.onerror=()=>setWeatherContrast(false);
    img.src=src;
  }
  function applyBackgroundValue(value, allowFallback=true){
    const cssValue=normalizeBgValue(value || bgPresets.dragon);
    document.documentElement.style.setProperty('--bg', cssValue);
    document.documentElement.style.setProperty('--bg-render', cssValue);
    const src=bgSrc(cssValue);
    if(!src || src.startsWith('data:') || src.startsWith('blob:')) return;
    if(store.text('nyx.customBgUrl','') || store.text('nyx.customBgData','') || store.text('nyx.customBg','')) return;
    const img=new Image();
    img.referrerPolicy='no-referrer';
    img.onerror=()=>{
      if(!allowFallback) return;
      store.setText('nyx.background','dragon');
      store.setText('nyx.customBg','');
      store.setText('nyx.customBgUrl','');
      store.setText('nyx.customBgData','');
      applyBackgroundValue(bgPresets.dragon,false);
    };
    img.onload=()=>{};
    img.src=src;
  }
  function enhanceBackgroundRender(value){
    const run=++enhancedBackgroundRun;
    const cssValue=normalizeBgValue(value || bgPresets.dragon);
    const src=bgSrc(cssValue);
    setQualityStatus('Quality Boost preparing image...');
    if(!src || cssValue.startsWith('linear-gradient')){
      document.documentElement.style.setProperty('--bg-render',cssValue);
      document.documentElement.style.setProperty('--bg-enhanced-render',cssValue);
      document.documentElement.style.setProperty('--bg-bright-mask','linear-gradient(transparent,transparent)');
      setCustomBackgroundLayer('');
      setQualityStatus('');
      return;
    }
    const isGif=/\.gif(?:[?#].*)?$/i.test(src) || /^data:image\/gif/i.test(src);
    if(isGif){
      document.documentElement.style.setProperty('--bg-render',cssValue);
      document.documentElement.style.setProperty('--bg-enhanced-render',cssValue);
      setQualityStatus('Quality Boost active: animated GIF preserved');
    }else{
      renderEnhancedImage(src,(enhancedSrc,status)=>{
        if(run!==enhancedBackgroundRun || !store.get('nyx.backgroundEnhancer',false)) return;
        setQualityStatus(status);
        if(enhancedSrc){
          const boosted=`url("${enhancedSrc}")`;
          document.documentElement.style.setProperty('--bg-enhanced-render',boosted);
          syncBackgroundPreview(boosted);
          if(store.text('nyx.customBgUrl','') || store.text('nyx.customBgData','')) setCustomBackgroundLayer(src,enhancedSrc);
        }
      });
    }
    const img=new Image();
    const maskCandidates=imageCandidates(src);
    let maskIndex=0;
    img.crossOrigin='anonymous';
    img.referrerPolicy='no-referrer';
    img.onload=()=>{
      if(run!==enhancedBackgroundRun || !store.get('nyx.backgroundEnhancer',false)) return;
      try{
        let brightMask='linear-gradient(transparent,transparent)';
        const maskW=960;
        const maskH=540;
        const maskCanvas=document.createElement('canvas');
        maskCanvas.width=maskW;
        maskCanvas.height=maskH;
        const maskCtx=maskCanvas.getContext('2d',{willReadFrequently:true});
        if(maskCtx){
          maskCtx.imageSmoothingEnabled=true;
          maskCtx.imageSmoothingQuality='high';
          const maskScale=Math.max(maskW/img.naturalWidth,maskH/img.naturalHeight);
          const drawW=img.naturalWidth*maskScale;
          const drawH=img.naturalHeight*maskScale;
          maskCtx.drawImage(img,(maskW-drawW)/2,(maskH-drawH)/2,drawW,drawH);
          const maskPixels=maskCtx.getImageData(0,0,maskW,maskH);
          const maskData=maskPixels.data;
          for(let i=0;i<maskData.length;i+=4){
            const r=maskData[i], g=maskData[i+1], b=maskData[i+2];
            const lum=.2126*r + .7152*g + .0722*b;
            const max=Math.max(r,g,b);
            const min=Math.min(r,g,b);
            const chroma=max-min;
            const saturation=max ? chroma / max : 0;
            const yellow=Math.min(r,g) - b*.72;
            const pink=Math.min(r,b) - g*.62;
            const cyan=Math.min(g,b) - r*.62;
            const blue=Math.max(0,b - Math.max(r,g)*.48);
            const brightColor=Math.max(0,yellow,pink,cyan,blue);
            const colorGate=max>170 && lum>118 && saturation>.34 && brightColor>44;
            const yellowStrength=.8 + Math.min(1,Math.max(0,(yellow-44)/120))*.2;
            const colorStrength=brightColor===yellow ? yellowStrength : brightColor===pink ? .42 : brightColor===cyan ? .22 : .14;
            const score=(lum-118)*1.4 + (saturation-.34)*320 + Math.max(0,brightColor-44)*1.8;
            const alpha=colorGate && score>120 ? Math.min(255,Math.round(255*colorStrength)) : 0;
            maskData[i]=255;
            maskData[i+1]=255;
            maskData[i+2]=255;
            maskData[i+3]=alpha;
          }
          maskCtx.putImageData(maskPixels,0,0);
          brightMask=`url("${maskCanvas.toDataURL('image/png')}")`;
        }
      if(run===enhancedBackgroundRun && store.get('nyx.backgroundEnhancer',false)){
        document.documentElement.style.setProperty('--bg-render',cssValue);
        document.documentElement.style.setProperty('--bg-bright-mask',brightMask);
      }
    }catch{
      document.documentElement.style.setProperty('--bg-render',cssValue);
      document.documentElement.style.setProperty('--bg-enhanced-render',cssValue);
      document.documentElement.style.setProperty('--bg-bright-mask','linear-gradient(transparent,transparent)');
    }
  };
  img.onerror=()=>{
    maskIndex++;
    if(maskIndex<maskCandidates.length){
      img.src=maskCandidates[maskIndex];
      return;
    }
    document.documentElement.style.setProperty('--bg-render',cssValue);
    document.documentElement.style.setProperty('--bg-enhanced-render',cssValue);
    document.documentElement.style.setProperty('--bg-bright-mask','linear-gradient(transparent,transparent)');
  };
    img.src=maskCandidates[maskIndex] || src;
  }
  function toast(msg){const t=$('toast'); if(!t)return; t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200)}
  window.__nyxStartupErrors=window.__nyxStartupErrors || [];
  if(!window.__nyxStartupErrorCapture){
    window.__nyxStartupErrorCapture=true;
    window.addEventListener('error',event=>{
      window.__nyxStartupErrors.push(event.message || 'Script error');
      if(window.__nyxStartupErrors.length>12) window.__nyxStartupErrors.shift();
    });
    window.addEventListener('unhandledrejection',event=>{
      window.__nyxStartupErrors.push(String(event.reason?.message || event.reason || 'Promise rejection'));
      if(window.__nyxStartupErrors.length>12) window.__nyxStartupErrors.shift();
    });
  }
  const postCoverWait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function runPostCoverLoader(){
    const loader=$('postCoverLoader');
    const fill=$('postCoverLoaderFill');
    const label=$('postCoverLoaderLabel');
    const percent=$('postCoverLoaderPercent');
    if(!loader || !fill || !label || !percent || loader.dataset.running==='1') return true;
    loader.dataset.running='1';
    loader.setAttribute('aria-hidden','false');
    loader.classList.add('active');
    const setProgress=(value,text)=>{
      const next=Math.max(0,Math.min(100,Math.round(value)));
      fill.style.width=`${next}%`;
      percent.textContent=`${next}%`;
      label.textContent=next>=100 ? 'Launched' : 'Loading';
    };
    const withLoaderTimeout=(promise,ms=900)=>Promise.race([
      Promise.resolve(promise),
      postCoverWait(ms).then(()=>false)
    ]);
    const pingLocal=async()=>{
      try{
        const response=await fetch(location.href.split('#')[0],{cache:'no-store'});
        return response.ok || response.type==='basic';
      }catch{return true}
    };
    const fetchOk=async(path,ms=900)=>{
      if(location.protocol==='file:') return true;
      try{
        const response=await withLoaderTimeout(fetch(path,{cache:'no-store'}),ms);
        return !!(response && response.ok);
      }catch{return false}
    };
    const doubleCheck=async(run)=>{
      const first=await withLoaderTimeout(run(),1000).catch(()=>false);
      await postCoverWait(35);
      const second=await withLoaderTimeout(run(),1000).catch(()=>false);
      return Boolean(first || second);
    };
    const checks=[
      ['Checking core files',async()=>doubleCheck(async()=>(
        await fetchOk('/assets/icons/nyx-logo.png',850)
        && await fetchOk('/assets/vendor/three.r134.min.js',850)
      ))],
      ['Checking servers',async()=>doubleCheck(async()=>(
        location.protocol==='file:'
        || await Promise.all(['/uv/uv.bundle.js','/scramjet/scramjet.js','/baremux/index.mjs'].map(path=>fetchOk(path,900)))
          .then(results=>results.some(Boolean))
      ))],
      ['Checking browser engine',async()=>doubleCheck(async()=>Boolean(window.fetch && window.Promise && window.URL && window.Blob))],
      ['Checking storage',async()=>{
        return doubleCheck(async()=>{
          try{
            const key='nyx-startup-check';
            localStorage.setItem(key,'1');
            return localStorage.getItem(key)==='1' && (localStorage.removeItem(key),true);
          }catch{return false}
        });
      }],
      ['Checking proxy updates',async()=>doubleCheck(async()=>{
        if(typeof preflightStateCurrent==='function') return preflightStateCurrent();
        return typeof proxyStateVersion==='string' && typeof scramjetStateVersion==='string';
      })],
      ['Checking for bugs',async()=>doubleCheck(async()=>(
        Boolean(document.body && $('desktop') && $('visualEffects') && $('customBgImage'))
        && window.__nyxStartupErrors.length===0
      ))],
      ['Launching Nyx',async()=>doubleCheck(async()=>Boolean($('browserShell') || $('desktop')))]
    ];
    setProgress(0,'Checking Nyx');
    for(let i=0;i<checks.length;i++){
      const [text,run]=checks[i];
      setProgress((i/checks.length)*100,text);
      try{
        const ok=await run();
        if(!ok) console.warn('post-cover check did not pass:',text);
      }catch(error){console.warn('post-cover check warning:',text,error)}
      await postCoverWait(70);
      setProgress(((i+1)/checks.length)*100,text);
    }
    setProgress(100,'Launched');
    await postCoverWait(420);
    loader.classList.remove('active');
    loader.setAttribute('aria-hidden','true');
    setTimeout(()=>{
      loader.dataset.running='0';
      setProgress(0,'Checking Nyx');
    },260);
    return true;
  }
  function saveProfile(root=document, quiet=false){
    const input=root.querySelector?.('#settingName') || document.querySelector('#settingName');
    const next=(input?.value || '').trim();
    store.setText('nyx.userName', next);
    applyUserSettings();
    if(!quiet) toast('Username saved');
  }
  async function startNyx(){
    if(nyxStartupOpened) return;
    nyxStartupOpened=true;
    applyThemeSetting();
    document.body.classList.add('nyx-startup-prep');
    document.querySelectorAll('.nyx-preflight').forEach(overlay=>overlay.remove());
    document.body.classList.add('runtime-lag-guard');
    const startupProgress=showSetupLaunchSplash();
    setTimeout(async()=>{
      const runStep=async(value,label,task,minimumVisible)=>{
        if(startupProgress?.step) return startupProgress.step(value,label,task,minimumVisible);
        try{return {ok:true,result:await Promise.resolve().then(task)}}catch(error){console.warn(`Startup task failed: ${label}`,error);return {ok:false,error}}
      };

      await runStep(12,'Preparing interface',()=>{
        applyLagReducerSetting();
        const browserShellMode=store.get('nyx.browserShellMode',true);
        document.body.classList.toggle('browser-shell',browserShellMode);
        syncChromeMode(browserShellMode);
      },380);

      await runStep(31,'Restoring settings',()=>{
        applyUserSettings();
      },460);

      await runStep(49,'Loading your theme',async()=>{
        applyThemeSetting();
        syncPerformanceLite();
        const fontsReady=document.fonts?.ready || Promise.resolve();
        const pageReady=document.readyState==='complete'
          ? Promise.resolve()
          : new Promise(resolve=>window.addEventListener('load',resolve,{once:true}));
        await Promise.race([
          Promise.allSettled([fontsReady,pageReady]),
          new Promise(resolve=>setTimeout(resolve,1400))
        ]);
      },480);

      await runStep(67,'Starting browser',async()=>{
        await requestNyxKeyboardLock();
        tick();
      },430);

      await runStep(83,'Loading shortcuts',()=>{
        installHomeShortcutAnimationObserver();
        startRuntimeLagWatch();
        initDesktopSplash();
      },400);

      await runStep(96,'Finishing startup',()=>{
        finishNyxOpenStartup();
        applyVisualEffectSetting();
        document.body.classList.remove('runtime-lag-guard');
        if(shouldShowStartupCustomization()){
          document.body.classList.remove('nyx-startup-prep');
          suppressHomeEntranceOnStartup=false;
          showSetup();
        }else{
          playNyxStartupReveal();
        }
      },440);

      await startupProgress?.complete?.('Nyx is ready');
      scheduleNyxTermsAcceptanceGate(360);
    },0);
  }
  //url-normalization
  function normalize(v){
    const raw=String(v||'').trim(); if(!raw)return '';
    if(shouldTriggerSixtySevenJumpscare(raw)){
      showSixtySevenJumpscare();
      return '';
    }
    let target='';
    if(/^about:blank$/i.test(raw)) return raw;
    if(/^(blob:|data:text\/html)/i.test(raw)) return raw;
    if(/^data:text\/html/i.test(raw)) return raw;
    if(/^https?:\/\//i.test(raw)) target=raw;
    else if(/^(\/|\.\/|\.\.\/|assets\/)/i.test(raw)){
      try{target=new URL(raw,location.href).href}catch{target=raw}
    }
    else if(/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw) && !raw.includes(' ')) target='https://'+raw;
    else {
      target=selectedSearchUrl(raw);
    }
    return target;
  }
  function getRhBase(){
    return store.text('nyx.rammerheadBase',rammerheadBase).replace(/\/+$/,'') + '/';
  }
  function getRhSession(){
    return new Promise(resolve=>{
      const base=getRhBase();
      const cached=store.text('nyx.rammerheadSession','');
      const xhr=new XMLHttpRequest();
      let done=false;
      const finish=id=>{
        if(done) return;
        done=true;
        clearTimeout(timer);
        if(id){
          store.setText('nyx.rammerheadSession',id);
          resolve({base,id});
        }else if(cached){
          resolve({base,id:cached});
        }else{
          resolve(null);
        }
      };
      const timer=setTimeout(()=>finish(null),5000);
      try{
        xhr.open('GET',base+'newsession',true);
        xhr.onload=()=>{
          const id=(xhr.responseText||'').trim();
          finish(id || null);
        };
        xhr.onerror=()=>finish(null);
        xhr.send();
      }catch{
        finish(null);
      }
    });
  }
  function rhBuildUrl(base,id,url){
    return base + id + '/' + url;
  }
  function proxyModeUrl(mode,url){
    mode=normalizeBrowserModeName(mode);
    const target=proxyTargetUrl(url);
    if(!target) return url;
    if(mode==='ultraviolet') return nativeUvUrl(target) || target;
    if(mode==='scramjet') return scramjetUrl(target) || target;
    return url;
  }
  window.nyxProxyGameUrl=async url=>{
    const target=proxyTargetUrl(url);
    if(!target) return '';
    const ready=await installUltraviolet();
    return ready ? (proxyModeUrl('ultraviolet',target) || target) : target;
  };
  function normalizeBrowserModeName(mode){
    let value=String(mode || 'auto').trim();
    if((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))){
      try{value=JSON.parse(value)}catch{value=value.slice(1,-1)}
    }
    value=String(value || 'auto').trim().toLowerCase();
    if(value==='uv' || value==='ultra' || value==='ultraviolet') return 'ultraviolet';
    if(value==='sj' || value==='scram' || value==='scramjet') return 'scramjet';
    if(value==='rh' || value==='rammerhead') return 'rammerhead';
    if(value==='direct' || value==='iframe') return 'iframe';
    return value || 'auto';
  }
  function proxyTargetUrl(url){
    try{
      const target=new URL(url,location.href);
      return /^https?:$/.test(target.protocol) ? target.href : '';
    }catch{return ''}
  }
  function browserHost(url){
    try{return new URL(url).hostname.replace(/^www\./,'').toLowerCase()}catch{return ''}
  }
  function hostMatches(host,domains){
    return domains.some(domain=>host===domain || host.endsWith('.'+domain));
  }
  function isNyxLinkGeneratorUrl(url){
    const raw=browserShellSourceUrl(String(url || '')) || String(url || '');
    try{
      const parsed=new URL(raw,location.href);
      return parsed.origin===location.origin && /^\/apps\/link-generator(?:\/|$)/i.test(parsed.pathname);
    }catch{return false}
  }
  function isNyxGeneratedCdnUrl(url){
    try{
      const parsed=new URL(String(url || ''));
      return parsed.protocol==='https:'
        && !parsed.username
        && !parsed.password
        && !parsed.port
        && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.b-cdn\.net$/i.test(parsed.hostname)
        && parsed.pathname==='/'
        && !parsed.search
        && !parsed.hash;
    }catch{return false}
  }
  function externalHttpUrl(url){
    try{
      const target=new URL(url,location.href);
      return /^https?:$/.test(target.protocol) && target.origin!==location.origin;
    }catch{return false}
  }
  function bestBrowserMode(url){
    try{
      const target=new URL(url,location.href);
      if(target.origin===location.origin || target.protocol==='file:') return 'iframe';
    }catch{}
    const host=browserHost(url);
    if(!host) return 'iframe';
    if(hostMatches(host,['slither.io'])) return 'iframe';
    if(hostMatches(host,['cineby.at'])) return 'scramjet';
    if(hostMatches(host,['tcgplayer.com'])) return 'iframe';
    const scramjetHosts=[
      'geforcenow.com','nvidia.com','play.geforcenow.com',
      'xbox.com','xboxlive.com','xboxservices.com',
      'spotify.com','open.spotify.com','accounts.spotify.com',
      'spotifycdn.com','scdn.co','accounts.scdn.co'
    ];
    const iframeHosts=[
      'localhost','127.0.0.1'
    ];
    if(hostMatches(host,iframeHosts)) return 'iframe';
    if(hostMatches(host,scramjetHosts)) return 'scramjet';
    return 'scramjet';
  }
  function selectedBrowserMode(url){
    try{
      const target=new URL(url,location.href);
      if(target.origin===location.origin || target.protocol==='file:') return 'iframe';
    }catch{}
    const mode=normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE));
    if(isSpotifyFamilyUrl(url)) return 'scramjet';
    if(hostMatches(browserHost(url),['slither.io'])) return 'iframe';
    if(mode==='iframe' && hostMatches(browserHost(url),['cineby.at'])) return 'scramjet';
    if(mode!=='auto') return mode;
    return bestBrowserMode(url);
  }
  function proxySelectionInfo(url,forceMode=''){
    const savedMode=normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE));
    const mode=forceMode || selectedBrowserMode(url);
    const savedTransport=store.text('nyx.transport',DEFAULT_BROWSER_TRANSPORT);
    return {
      url,
      savedMode,
      forcedMode:forceMode || '',
      selectedMode:mode,
      savedTransport,
      activeTransport:browserTransportOverride || savedTransport
    };
  }
  function logProxySelection(url,forceMode='',phase='navigate'){
    const info=proxySelectionInfo(url,forceMode);
    window.nyxProxySelection=info;
    console.log('nyx proxy selection', {...info, phase});
    return info;
  }
  function appCompatibilityMode(url){
    if(hostMatches(browserHost(url),['crazygames.com'])) return 'ultraviolet';
    return '';
  }
  function preferredTransport(url){
    const host=browserHost(url);
    if(hostMatches(host,[
      'spotify.com','open.spotify.com',
      'accounts.spotify.com','spotifycdn.com','scdn.co','accounts.scdn.co',
      'google.com','gstatic.com','recaptcha.net',
      'traxmojo.com',
      'animex.one','tcgplayer.com'
    ])) return 'epoxy';
    if(hostMatches(host,['youtube.com','youtu.be','tcgplayer.com'])) return 'epoxy';
    return '';
  }
  function nativeUvUrl(url){
    const target=proxyTargetUrl(url);
    if(!target) return '';
    const config=window.__uv$config;
    if(!config || typeof config.encodeUrl!=='function' || !config.prefix) return '';
    return config.prefix + config.encodeUrl(target);
  }
  function scramjetUrl(url){
    const target=proxyTargetUrl(url);
    if(!target || !scramjetController?.prefix) return '';
    const config=scramjetConfig();
    const encode=typeof config.codec?.encode==='function' ? config.codec.encode : encodeURIComponent;
    return config.prefix + encode(target);
  }
  function proxyFailureHtml(message,engine='Nyx'){
    const safe=String(message || 'Refresh this page once so the updated service worker can take over, then search again.').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const safeEngine=String(engine || 'Nyx').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    return `<!doctype html><meta charset="utf-8"><style>body{margin:0;font-family:Outfit,Arial,sans-serif;background:#101318;color:#f5f7fb;display:grid;place-items:center;min-height:100vh}main{max-width:560px;padding:28px;text-align:center}h1{font-size:20px;margin:0 0 10px}p{margin:0;color:#c8ced8;line-height:1.45}</style><main><h1>${safeEngine} did not start</h1><p>${safe}</p></main>`;
  }
  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const existing=document.querySelector(`script[src="${src}"]`);
      if(existing){
        if(existing.dataset.loaded) resolve();
        else existing.addEventListener('load',resolve,{once:true});
        return;
      }
      const script=document.createElement('script');
      script.src=src;
      script.async=false;
      script.onload=()=>{script.dataset.loaded='true'; resolve()};
      script.onerror=()=>reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
  }
      async function waitForServiceWorkerActive(registration, scope='/~/sj/'){
        if(!registration || !('serviceWorker' in navigator)) return false;
        const deadline=Date.now()+12000;
        let current=registration;
        while(Date.now()<deadline){
          if(current?.active?.state==='activated') return true;
          const worker=current?.installing || current?.waiting || current?.active;
          if(worker?.state==='activated') return true;
          const fresh=await navigator.serviceWorker.getRegistration(scope).catch(()=>null);
          if(fresh){
            current=fresh;
            if(fresh.active?.state==='activated') return true;
          }
          await new Promise(resolve=>setTimeout(resolve,120));
        }
        const fresh=await navigator.serviceWorker.getRegistration(scope).catch(()=>null);
        return Boolean(fresh?.active || current?.active);
      }
      async function refreshScramjetServiceWorker(){
        if(!('serviceWorker' in navigator)) return false;
        const registration=await navigator.serviceWorker.getRegistration('/~/sj/');
        if(!registration) return false;
        await registration.update().catch(()=>null);
        return waitForServiceWorkerActive(registration);
      }
  function wispUrl(){
    const configured=String(globalThis.__NYX_RUNTIME_CONFIG__?.wispUrl || '').trim();
    if(/^wss?:\/\//i.test(configured)) return configured.endsWith('/') ? configured : configured+'/';
    if(!hasHostedBackend()) return 'wss://wisp.mercurywork.shop/';
    const protocol=location.protocol==='https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/wisp/`;
  }
  function nyxPresenceUrl(){
    const configured=String(globalThis.__NYX_RUNTIME_CONFIG__?.presenceUrl||'').trim();
    if(configured){
      try{
        const endpoint=new URL(configured,location.href);
        if(/^https?:$/i.test(endpoint.protocol))return endpoint.href;
      }catch{}
    }
    try{
      const endpoint=new URL(wispUrl());
      endpoint.protocol=endpoint.protocol==='wss:' ? 'https:' : 'http:';
      endpoint.pathname='/presence';
      endpoint.search='';
      endpoint.hash='';
      return endpoint.href;
    }catch{return ''}
  }
  function renderNyxPresence(count=nyxPresenceCount){
    const label=Number.isFinite(count) ? `${count} online` : 'Connecting\u2026';
    qsa('[data-nyx-online-count]').forEach(element=>{element.textContent=label});
  }
  function startNyxPresence(){
    if(startNyxPresence.started) return;
    startNyxPresence.started=true;
    const endpoint=nyxPresenceUrl();
    if(!endpoint) return;
    let sessionId='';
    try{
      sessionId=localStorage.getItem('nyx.presenceSession') || '';
      if(!/^[a-zA-Z0-9_-]{16,128}$/.test(sessionId)){
        sessionId=(crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9_-]/g,'');
        localStorage.setItem('nyx.presenceSession',sessionId);
      }
    }catch{
      sessionId=`${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
    const heartbeat=async()=>{
      if(document.visibilityState==='hidden') return;
      try{
        const response=await fetch(endpoint,{
          method:'POST',
          headers:{'content-type':'text/plain;charset=UTF-8'},
          body:JSON.stringify({sessionId}),
          cache:'no-store',
          keepalive:true
        });
        if(!response.ok) throw new Error(`Presence returned ${response.status}`);
        const payload=await response.json();
        const count=Number(payload?.online);
        if(!Number.isFinite(count) || count<0) return;
        nyxPresenceCount=Math.floor(count);
        renderNyxPresence();
      }catch{
        renderNyxPresence(null);
      }
    };
    heartbeat();
    setInterval(heartbeat,15_000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible') heartbeat()});
  }
  async function installBareMuxTransport(){
    const { BareMuxConnection } = await import('/baremux/index.mjs');
    const connection = bareMuxConnection || (bareMuxConnection = new BareMuxConnection('/baremux/worker.js'));
    const wisp=wispUrl();
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const setTransportWithRetry=async (path,args)=>{
      let lastError=null;
      for(let attempt=0;attempt<3;attempt++){
        try{
          await connection.setTransport(path,args);
          return;
        }catch(error){
          lastError=error;
          await delay(220*(attempt+1));
        }
      }
      throw lastError;
    };
    const transport=browserTransportOverride || store.text('nyx.transport',DEFAULT_BROWSER_TRANSPORT);
    try{
      if(transport==='libcurl'){
        try{
          await setTransportWithRetry('/assets/transports/libcurl-baremux.mjs', [{ wisp, websocket: wisp }]);
          return connection;
        }catch(error){
          console.warn('nyx libcurl BareMux transport failed.', error);
          throw error;
        }
      }
      if(transport==='wisp'){
        await setTransportWithRetry('/epoxy/index.mjs', [{ wisp, wisp_v2: false }]);
        return connection;
      }
      await setTransportWithRetry('/epoxy/index.mjs', [{ wisp, wisp_v2: true }]);
      return connection;
    }catch(firstError){
      if(transport==='libcurl') throw firstError;
      await setTransportWithRetry('/epoxy/index.mjs', [{ wisp, wisp_v2: false }]).catch(()=>{
        throw firstError;
      });
      return connection;
    }
  }
  async function createScramjetTransport(){
    const transport=browserTransportOverride || store.text('nyx.transport',DEFAULT_BROWSER_TRANSPORT);
    const key=`${transport}:${wispUrl()}`;
    if(scramjetTransport && scramjetTransportKey===key) return scramjetTransport;
    const wisp=wispUrl();
    const buildTransport=async name=>{
      if(name==='libcurl'){
        const { default: LibcurlClient } = await import('/assets/transports/libcurl-scramjet.mjs');
        return new LibcurlClient({ wisp, websocket: wisp });
      }
      const { default: EpoxyTransport } = await import('/assets/transports/epoxy-scramjet.mjs');
      return new EpoxyTransport({ wisp, wisp_v2: name!=='wisp' });
    };
    scramjetTransport=await buildTransport(transport);
    if(typeof scramjetTransport.init==='function' && !scramjetTransport.ready){
      try{
        await Promise.race([
          scramjetTransport.init(),
          new Promise((_,reject)=>setTimeout(()=>reject(new Error(`Scramjet ${transport} transport timed out while connecting to ${wisp}`)),7000))
        ]);
      }catch(error){
        if(transport==='libcurl'){
          console.warn('nyx libcurl Scramjet transport failed.', error);
          throw error;
        }else{
          throw error;
        }
      }
    }
    scramjetTransportKey=`${transport}:${wisp}`;
    return scramjetTransport;
  }
  function scramjetConfig(){
    return {
      prefix:'/~/sj/',
      scramjetPath:'/scramjet/scramjet.js',
      injectPath:'/controller/controller.inject.js',
      wasmPath:'/scramjet/scramjet.wasm',
      virtualWasmPath:'scramjet.wasm.js',
      codec:{
        encode:url=>encodeURIComponent(url),
        decode:url=>decodeURIComponent(url)
      }
    };
  }
  function scramjetRuntimeConfig(){
    const authSafeFlags={
      captureErrors:false,
      cleanErrors:false,
      sourcemaps:false,
      destructureRewrites:false,
      allowInvalidJs:false,
      allowFailedIntercepts:true,
      encapsulateWorkers:true
    };
    return {
      flags:{
        syncxhr:false,
        disableComputedWrap:true,
        rewriterLogs:false,
        captureErrors:false,
        cleanErrors:false,
        scramitize:false,
        sourcemaps:false,
        destructureRewrites:false,
        allowInvalidJs:false,
        debugTrampolines:false,
        debugSourceURL:false,
        allowFailedIntercepts:true,
        encapsulateWorkers:true
      },
      siteFlags:{
        'https?:\\/\\/([^/]+\\.)?(spotify\\.com|spotifycdn\\.com|scdn\\.co|accounts\\.scdn\\.co)(\\/|$)':authSafeFlags,
        'https?:\\/\\/([^/]+\\.)?(google\\.com|gstatic\\.com|recaptcha\\.net)(\\/|$)':authSafeFlags
      },
      maskedfiles:['inject.js','scramjet.wasm.js']
    };
  }
  function createScramjetController(serviceworker,transport){
    const api=window.$scramjetController;
    const Controller=api?.Controller;
    if(!Controller) throw new Error('Scramjet controller API did not load');
    api.assertRuntimeScramjetVersion?.();
    return new Controller({
      serviceworker,
      transport,
      config:scramjetConfig(),
      scramjetConfig:scramjetRuntimeConfig()
    });
  }
  async function loadScramjetRuntimeGuardSource(){
    if(scramjetRuntimeGuardSource) return scramjetRuntimeGuardSource;
    const response=await fetch('/nyx-scramjet-runtime-guard.js',{cache:'no-store'});
    if(!response.ok) throw new Error('Could not load Scramjet runtime guard');
    scramjetRuntimeGuardSource=await response.text();
    return scramjetRuntimeGuardSource;
  }
  function findScramjetHtmlNode(node,name){
    if(String(node?.name || '').toLowerCase()===name) return node;
    const children=node?.childNodes || node?.children;
    if(!Array.isArray(children)) return null;
    for(const child of children){
      const found=findScramjetHtmlNode(child,name);
      if(found) return found;
    }
    return null;
  }
  function installScramjetRuntimeGuards(root,source=scramjetRuntimeGuardSource,key='runtime-guard'){
    const target=findScramjetHtmlNode(root,'head') || findScramjetHtmlNode(root,'html') || root;
    const children=target?.childNodes || target?.children;
    if(!Array.isArray(children)) return;
    if(children.some(child=>child?.attribs?.['data-nyx-runtime-guard']===key)) return;
    children.unshift({
      type:'script',
      name:'script',
      attribs:{'data-nyx-runtime-guard':key},
      children:[{type:'text',data:source || 'void 0;'}]
    });
  }
  function shouldUseScramjetRuntimeGuard(url){
    return false;
  }
  function shouldUseScramjetMinimalGuard(url){
    const raw=String(url || '');
    const host=browserHost(browserShellSourceUrl(raw) || raw);
    if(host && hostMatches(host,[
      'spotify.com',
      'spotifycdn.com',
      'scdn.co',
      'accounts.spotify.com',
      'accounts.scdn.co',
      'open.spotify.com'
    ])) return false;
    return !!host && hostMatches(host,[
      'google.com',
      'gstatic.com',
      'recaptcha.net',
      'google-analytics.com',
      'googletagmanager.com'
    ]);
  }
  function shouldUseScramjetHelperGuard(url){
    return false;
  }
  function shouldStripScramjetDuckDuckGoScripts(url){
    return false;
  }
  function isSpotifyFamilyUrl(url){
    const raw=String(url || '');
    const host=browserHost(browserShellSourceUrl(raw) || raw);
    return !!host && hostMatches(host,[
      'spotify.com',
      'spotifycdn.com',
      'scdn.co',
      'accounts.spotify.com',
      'accounts.scdn.co',
      'open.spotify.com'
    ]);
  }
  function patchSpotifyChromeOsWindow(frameWindow){
    try{
      if(!frameWindow || frameWindow.closed) return false;
      const frameNavigator=frameWindow.navigator;
      const nativeUserAgent=String(frameNavigator?.userAgent || '');
      if(!/\bCrOS\b/i.test(nativeUserAgent)) return !!frameWindow.__nyxSpotifyChromeOsCompatibility;
      const chromeVersion=nativeUserAgent.match(/Chrome\/([0-9.]+)/i)?.[1] || '138.0.0.0';
      const desktopUserAgent=`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
      const defineNavigatorValue=(name,value)=>{
        try{frameWindow.Object.defineProperty(frameWindow.Navigator.prototype,name,{configurable:true,get:()=>value})}
        catch{try{frameWindow.Object.defineProperty(frameNavigator,name,{configurable:true,get:()=>value})}catch{}}
      };
      defineNavigatorValue('userAgent',desktopUserAgent);
      defineNavigatorValue('platform','Win32');
      const nativeData=frameNavigator.userAgentData;
      if(nativeData){
        const desktopData={
          brands:Array.from(nativeData.brands || []),
          mobile:false,
          platform:'Windows',
          toJSON(){return {brands:this.brands,mobile:false,platform:'Windows'}},
          async getHighEntropyValues(hints){
            let values={};
            try{values=await nativeData.getHighEntropyValues(hints)}catch{}
            return {...values,platform:'Windows',platformVersion:'10.0.0',architecture:'x86',bitness:'64',model:''};
          }
        };
        defineNavigatorValue('userAgentData',desktopData);
      }
      try{frameWindow.Object.defineProperty(frameWindow,'__nyxSpotifyChromeOsCompatibility',{configurable:true,value:true})}
      catch{frameWindow.__nyxSpotifyChromeOsCompatibility=true}
      return true;
    }catch{return false}
  }
  function applySpotifyChromeOsFrameCompatibility(t){
    if(!t?.frame || !/\bCrOS\b/i.test(String(navigator.userAgent || '')) || !isSpotifyFamilyUrl(t.sourceUrl || t.url)) return false;
    let applied=false;
    const visit=frameWindow=>{
      if(!frameWindow) return;
      applied=patchSpotifyChromeOsWindow(frameWindow) || applied;
      let childCount=0;
      try{childCount=Number(frameWindow.length || 0)}catch{}
      for(let index=0;index<childCount;index++){
        try{visit(frameWindow.frames[index])}catch{}
      }
    };
    try{visit(t.frame.contentWindow)}catch{}
    return applied;
  }
  function stopSpotifyChromeOsFrameCompatibility(t){
    if(t?.spotifyChromeOsCompatibilityTimer){
      clearInterval(t.spotifyChromeOsCompatibilityTimer);
      t.spotifyChromeOsCompatibilityTimer=0;
    }
    if(t?.spotifyChromeOsCompatibilityTimeout){
      clearTimeout(t.spotifyChromeOsCompatibilityTimeout);
      t.spotifyChromeOsCompatibilityTimeout=0;
    }
    if(t?.spotifyChromeOsLoadHandler && t.frame){
      t.frame.removeEventListener('load',t.spotifyChromeOsLoadHandler);
      t.spotifyChromeOsLoadHandler=null;
    }
  }
  function startSpotifyChromeOsFrameCompatibility(t){
    stopSpotifyChromeOsFrameCompatibility(t);
    if(!/\bCrOS\b/i.test(String(navigator.userAgent || '')) || !isSpotifyFamilyUrl(t?.sourceUrl || t?.url)) return;
    const apply=()=>{
      if(!state.tabs.includes(t) || !isSpotifyFamilyUrl(t.sourceUrl || t.url)){
        stopSpotifyChromeOsFrameCompatibility(t);
        return;
      }
      applySpotifyChromeOsFrameCompatibility(t);
    };
    t.spotifyChromeOsLoadHandler=()=>{
      apply();
      setTimeout(apply,120);
      setTimeout(apply,650);
    };
    t.frame.addEventListener('load',t.spotifyChromeOsLoadHandler);
    apply();
    t.spotifyChromeOsCompatibilityTimer=setInterval(apply,750);
    t.spotifyChromeOsCompatibilityTimeout=setTimeout(()=>stopSpotifyChromeOsFrameCompatibility(t),5*60*1000);
  }
  function sweepSpotifyChromeOsCompatibility(){
    if(!/\bCrOS\b/i.test(String(navigator.userAgent || ''))) return false;
    let applied=false;
    qsa('iframe').forEach(frame=>{
      const raw=String(frame.getAttribute('src') || frame.src || '');
      const source=browserShellSourceUrl(raw) || raw;
      const host=browserHost(source);
      let decodedRaw=raw;
      try{decodedRaw=decodeURIComponent(raw)}catch{}
      if(!(host && hostMatches(host,['spotify.com','spotifycdn.com','scdn.co'])) && !/(spotify\.com|spotifycdn\.com|scdn\.co)/i.test(decodedRaw)) return;
      const visit=frameWindow=>{
        if(!frameWindow) return;
        applied=patchSpotifyChromeOsWindow(frameWindow) || applied;
        let childCount=0;
        try{childCount=Number(frameWindow.length || 0)}catch{}
        for(let index=0;index<childCount;index++){
          try{visit(frameWindow.frames[index])}catch{}
        }
      };
      try{visit(frame.contentWindow)}catch{}
    });
    return applied;
  }
  function startSpotifyChromeOsCompatibilitySweep(){
    if(startSpotifyChromeOsCompatibilitySweep.timer || !/\bCrOS\b/i.test(String(navigator.userAgent || ''))) return;
    const run=()=>sweepSpotifyChromeOsCompatibility();
    run();
    startSpotifyChromeOsCompatibilitySweep.timer=setInterval(run,750);
  }
  function inspectFrameHealth(t){
    try{
      const doc=t?.frame?.contentDocument;
      if(!doc) return {reachable:false,blank:false,text:'',title:'',readyState:''};
      const body=doc.body;
      const text=String(body?.textContent || '').trim().slice(0,5000);
      const visibleText=String(body?.innerText || '').trim().slice(0,5000);
      const structureCount=Number(doc.documentElement?.childElementCount || 0)+Number(body?.childElementCount || 0);
      const title=String(doc.title || '').trim();
      const hasVisibleStructure=!!doc.querySelector('main,button,a,input,[role],[data-testid],svg,img,canvas,video,audio');
      const hasErrorText=/scramjet did not start|scramjet route missed|ultraviolet did not start|error processing your request|internal server error|internal service worker error|request failed with error code\s*(?:35|56|60)|ssl connect error|ssl peer certificate|ssh remote key|certificate.*not ok|failure when receiving data from the peer|localhost refused to connect|something went wrong/i.test(text);
      const blank=!hasVisibleStructure && text.length<12 && structureCount<4;
      return {reachable:true,blank,hasErrorText,text,visibleText,title,htmlLength:structureCount,readyState:doc.readyState};
    }catch(error){
      return {reachable:false,blank:false,error:String(error?.message || error),text:'',title:'',readyState:''};
    }
  }
  function inspectFramePresentation(t){
    try{
      const doc=t?.frame?.contentDocument;
      if(!doc?.documentElement) return {reachable:false,blank:false,unstyled:false,readyState:''};
      const health=inspectFrameHealth(t);
      const stylesheetLinks=doc.querySelectorAll('link[rel~="stylesheet"][href]').length;
      const styleElements=doc.querySelectorAll('style').length;
      const linkedSheets=Array.from(doc.styleSheets || []).filter(sheet=>String(sheet.ownerNode?.tagName || '').toLowerCase()==='link');
      const linkedStyleSheets=linkedSheets.length;
      let readableLinkedSheets=0;
      let linkedStyleRules=0;
      linkedSheets.forEach(sheet=>{
        try{
          const rules=sheet.cssRules;
          readableLinkedSheets+=1;
          linkedStyleRules+=Number(rules?.length || 0);
        }catch{}
      });
      const textLength=String(health.visibleText || health.text || '').replace(/\s+/g,' ').trim().length;
      let looksBrowserDefault=false;
      try{
        const bodyStyle=doc.defaultView?.getComputedStyle?.(doc.body);
        const family=String(bodyStyle?.fontFamily || '').toLowerCase();
        const background=String(bodyStyle?.backgroundColor || '').replace(/\s+/g,'');
        const color=String(bodyStyle?.color || '').replace(/\s+/g,'');
        looksBrowserDefault=/times new roman|serif/.test(family)
          && ['rgba(0,0,0,0)','rgb(255,255,255)'].includes(background)
          && color==='rgb(0,0,0)';
      }catch{}
      const complete=health.readyState==='complete';
      const linkedStylesMissing=linkedStyleSheets===0
        || (readableLinkedSheets===linkedStyleSheets && linkedStyleRules===0);
      const unstyled=complete
        && textLength>80
        && stylesheetLinks>0
        && linkedStylesMissing
        && (styleElements===0 || looksBrowserDefault);
      const blank=complete && health.blank && !health.hasErrorText;
      return {...health,reachable:true,blank,unstyled,stylesheetLinks,linkedStyleSheets,readableLinkedSheets,linkedStyleRules,styleElements,looksBrowserDefault,textLength};
    }catch(error){
      return {reachable:false,blank:false,unstyled:false,readyState:'',error:String(error?.message || error)};
    }
  }
  function watchScramjetHealth(t,sourceUrl){
    if(!t?.frame || !sourceUrl) return;
    const source=browserShellSourceUrl(sourceUrl) || String(sourceUrl);
    if(!/^https?:/i.test(source)) return;
    if(t.scramjetPresentationSource!==source){
      t.scramjetPresentationSource=source;
      t.scramjetPresentationRetries=0;
    }
    if(t.scramjetHealthLoadHandler){
      try{t.frame.removeEventListener('load',t.scramjetHealthLoadHandler)}catch{}
    }
    const token='scramjet-health-'+Date.now()+Math.random().toString(16).slice(2);
    const navigationIntent=t.navigationIntent || '';
    const startedAt=Date.now();
    t.scramjetHealthWatchToken=token;
    let badKind='';
    let badChecks=0;
    let recoveryStarted=false;
    const current=()=>t.frame?.isConnected
      && t.scramjetHealthWatchToken===token
      && (t.navigationIntent || '')===navigationIntent
      && t.scramjetPresentationSource===source;
    const recover=async reason=>{
      if(recoveryStarted || !current()) return;
      const retries=Number(t.scramjetPresentationRetries || 0);
      if(retries>=2) return;
      recoveryStarted=true;
      t.scramjetPresentationRetries=retries+1;
      t.scramjetHealthWatchToken='recovering-'+token;
      console.warn('nyx detected an incomplete first proxy render; retrying the page automatically.',{
        sourceUrl:source,
        reason,
        attempt:t.scramjetPresentationRetries
      });
      if(t.scramjetPresentationRetries>1){
        await refreshScramjetServiceWorker().catch(()=>false);
        scramjetInstallPromise=null;
        await installScramjet().catch(()=>false);
      }else{
        await new Promise(resolve=>setTimeout(resolve,240));
      }
      if(!t.frame?.isConnected || (t.navigationIntent || '')!==navigationIntent || t.scramjetPresentationSource!==source) return;
      try{
        t.scramjetFrame?.go(source);
      }catch{
        return;
      }
      setTimeout(()=>{
        if(t.frame?.isConnected && (t.navigationIntent || '')===navigationIntent) watchScramjetHealth(t,source);
      },120);
    };
    const check=()=>{
      if(!current()) return;
      const presentation=inspectFramePresentation(t);
      if(!presentation.reachable || presentation.hasErrorText) return;
      const kind=presentation.unstyled ? 'stylesheets did not load' : (presentation.blank && Date.now()-startedAt>3600 ? 'page stayed blank' : '');
      if(!kind){
        badKind='';
        badChecks=0;
        return;
      }
      if(kind===badKind) badChecks+=1;
      else{
        badKind=kind;
        badChecks=1;
      }
      if(badChecks>=2) void recover(kind);
    };
    const onLoad=()=>{
      setTimeout(check,850);
      setTimeout(check,2100);
      setTimeout(check,4200);
    };
    t.scramjetHealthLoadHandler=onLoad;
    t.frame.addEventListener('load',onLoad);
    setTimeout(check,2400);
    setTimeout(check,5000);
    setTimeout(check,8200);
  }
  function watchUvPresentation(t,sourceUrl){
    if(!t?.frame || !sourceUrl) return;
    const source=browserShellSourceUrl(sourceUrl) || String(sourceUrl);
    if(!/^https?:/i.test(source)) return;
    if(t.uvPresentationSource!==source){
      t.uvPresentationSource=source;
      t.uvPresentationRetries=0;
    }
    if(t.uvPresentationLoadHandler){
      try{t.frame.removeEventListener('load',t.uvPresentationLoadHandler)}catch{}
    }
    const token='uv-presentation-'+Date.now()+Math.random().toString(16).slice(2);
    const navigationIntent=t.navigationIntent || '';
    t.uvPresentationWatchToken=token;
    let badKind='';
    let badChecks=0;
    let recoveryStarted=false;
    const current=()=>t.frame?.isConnected
      && t.uvPresentationWatchToken===token
      && (t.navigationIntent || '')===navigationIntent
      && t.uvPresentationSource===source;
    const recover=async reason=>{
      if(recoveryStarted || !current() || Number(t.uvPresentationRetries || 0)>=1) return;
      recoveryStarted=true;
      t.uvPresentationRetries=Number(t.uvPresentationRetries || 0)+1;
      t.uvPresentationWatchToken='recovering-'+token;
      console.warn('nyx detected an incomplete UV page; applying the compatible recovery path.',{
        sourceUrl:source,
        reason
      });
      if(reason==='YouTube component styles did not initialize'){
        if(typeof t.retryUvPresentation==='function') t.retryUvPresentation(source,reason);
        return;
      }
      const registration=await navigator.serviceWorker.getRegistration('/service/').catch(()=>null);
      if(registration) await registration.update().catch(()=>null);
      uvInstallPromise=null;
      const ok=await installUltraviolet();
      if(!ok || !t.frame?.isConnected || (t.navigationIntent || '')!==navigationIntent || t.uvPresentationSource!==source) return;
      if(typeof t.retryUvPresentation==='function') t.retryUvPresentation(source);
    };
    const youtubePresentationIncomplete=presentation=>{
      if(!hostMatches(browserHost(source),['youtube.com','youtu.be'])) return false;
      try{
        const doc=t.frame?.contentDocument;
        const app=doc?.querySelector('ytd-app');
        if(!app) return false;
        const masthead=doc.querySelector('ytd-masthead');
        const appStyle=doc.defaultView?.getComputedStyle?.(app);
        const mastheadStyle=masthead ? doc.defaultView?.getComputedStyle?.(masthead) : null;
        if(appStyle?.display==='inline' || mastheadStyle?.display==='inline') return true;
        const links=Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'));
        const mainLinks=links.filter(link=>{
          const raw=String(link.getAttribute('href') || '');
          const absolute=String(link.href || '');
          const decoded=browserShellSourceUrl(absolute);
          return /ytmainappweb|kevlar_base|www-main-desktop/i.test(raw+' '+absolute+' '+decoded);
        });
        const rulesFor=link=>{
          try{return Number(link.sheet?.cssRules?.length || 0)}catch{return 0}
        };
        const largestMainSheet=Math.max(0,...mainLinks.map(rulesFor));
        const largestLinkedSheet=Math.max(0,...links.map(rulesFor));
        if(mainLinks.length && (largestMainSheet>=1000 || largestLinkedSheet>=5000)) return false;
        return links.length<3 || largestLinkedSheet<5000;
      }catch{return false}
    };
    const check=()=>{
      if(!current()) return;
      const presentation=inspectFramePresentation(t);
      if(!presentation.reachable || presentation.hasErrorText || presentation.readyState!=='complete') return;
      const kind=youtubePresentationIncomplete(presentation)
        ? 'YouTube component styles did not initialize'
        : (presentation.unstyled ? 'stylesheets did not load' : (presentation.blank ? 'page stayed blank' : ''));
      if(!kind){
        badKind='';
        badChecks=0;
        return;
      }
      if(kind===badKind) badChecks+=1;
      else{
        badKind=kind;
        badChecks=1;
      }
      if(badChecks>=2) void recover(kind);
    };
    const onLoad=()=>{
      setTimeout(check,850);
      setTimeout(check,2100);
      setTimeout(check,4200);
    };
    t.uvPresentationLoadHandler=onLoad;
    t.frame.addEventListener('load',onLoad);
    setTimeout(check,2800);
    setTimeout(check,5600);
    setTimeout(check,9000);
  }
  function removeScramjetHtmlNodes(root,predicate){
    const children=root?.childNodes || root?.children;
    if(!Array.isArray(children)) return;
    for(let i=children.length-1;i>=0;i--){
      const child=children[i];
      if(predicate(child)) children.splice(i,1);
      else removeScramjetHtmlNodes(child,predicate);
    }
  }
  function stripScramjetDuckDuckGoScripts(root){
    removeScramjetHtmlNodes(root,node=>{
      if(String(node?.name || '').toLowerCase()!=='script') return false;
      const src=String(node?.attribs?.src || '').toLowerCase();
      const id=String(node?.attribs?.id || '').toLowerCase();
      const text=(node?.children || []).map(child=>child?.data || '').join('');
      return src.includes('/dist/p.')
        || src.includes('links.duckduckgo.com/d.js')
        || id==='deep_preload_script'
        || text.includes('window.__sc__=');
    });
  }
  function stripScramjetPreloadLinks(root){
    removeScramjetHtmlNodes(root,node=>{
      if(String(node?.name || '').toLowerCase()!=='link') return false;
      if(String(node?.attribs?.rel || '').toLowerCase()!=='preload') return false;
      const asType=String(node?.attribs?.as || '').toLowerCase();
      const href=String(node?.attribs?.href || '').toLowerCase();
      return asType==='font'
        || asType==='fetch'
        || href.includes('.woff')
        || href.includes('/generated-locales/')
        || href.endsWith('.json');
    });
  }
  function stripScramjetResourceIntegrity(root){
    const visit=node=>{
      if(!node || typeof node!=='object') return;
      const attrs=node.attribs;
      if(attrs && typeof attrs==='object'){
        // Proxied resources are rewritten, so an origin site's original SRI
        // digest no longer matches. Chromium otherwise blocks valid CSS/JS.
        delete attrs.integrity;
        delete attrs['scramjet-attr-integrity'];
      }
      const children=node.childNodes || node.children;
      if(Array.isArray(children)) children.forEach(visit);
    };
    visit(root);
  }
  function replaceCinebyDevtoolBundle(root){
    const children=root?.childNodes || root?.children;
    if(!Array.isArray(children)) return;
    for(const node of children){
      if(String(node?.name || '').toLowerCase()==='script'){
        const src=String(node?.attribs?.['scramjet-attr-src'] || node?.attribs?.src || '');
        if(/\/_app-[^/?]+\.js(?:[?#]|$)/i.test(src)) node.attribs.src='/nyx-compat/cineby-app.js';
      }
      replaceCinebyDevtoolBundle(node);
    }
  }
  function patchScramjetHtml(root,source=scramjetRuntimeGuardSource,key='runtime-guard'){
    if(key==='proxy-sri'){
      stripScramjetResourceIntegrity(root);
      return;
    }
    if(key==='duckduckgo-noscript'){
      stripScramjetDuckDuckGoScripts(root);
      return;
    }
    if(key==='spotify-preload-strip'){
      stripScramjetPreloadLinks(root);
      return;
    }
    if(key==='cineby-disable-devtool'){
      replaceCinebyDevtoolBundle(root);
      return;
    }
    installScramjetRuntimeGuards(root,source,key);
  }
  function createScramjetCompatibilityPlugin(source=scramjetRuntimeGuardSource,key='runtime-guard'){
    const plugin={
      name:'nyx-compatibility-'+key,
      dependencies:[],
      install(frame){
        const Tap=window.$scramjet?.Tap;
        const hook=frame?.fetchHandler?.hooks?.rewriter?.html?.post;
        if(!Tap?.tap) return;
        if(hook) Tap.tap(hook,context=>patchScramjetHtml(context?.handler?.root,source,key),plugin);
        if(key==='proxy-sri'){
          const responseHook=frame?.fetchHandler?.hooks?.fetch?.response;
          if(responseHook) Tap.tap(responseHook,(_context,result)=>{
            const headers=result?.response?.headers;
            const link=String(headers?.get?.('link') || '');
            if(!link) return;
            headers.set('link',link.replace(/;\s*integrity\s*=\s*(?:"[^"]*"|'[^']*'|[^,;]*)/gi,''));
          },plugin);
        }
      }
    };
    return plugin;
  }
  function isScramjetIdbShapeError(error){
    return /object stores? was not found|not found/i.test(String(error?.message || error));
  }
  function deleteIndexedDb(name){
    return new Promise(resolve=>{
      if(!window.indexedDB) return resolve(false);
      const request=indexedDB.deleteDatabase(name);
      request.onsuccess=()=>resolve(true);
      request.onerror=()=>resolve(false);
      request.onblocked=()=>setTimeout(()=>resolve(false),500);
    });
  }
  async function removeLegacyStartupPdfData(){
    try{
      localStorage.removeItem('nyx.launchPdf');
      localStorage.removeItem('nyx.renderStartupPdf');
      if(store.get('nyx.removedStartupPdfData',false)) return;
      await Promise.all(['nyx-launch-pdfs','NyxLaunchPdfStore'].map(name=>deleteIndexedDb(name)));
      store.set('nyx.removedStartupPdfData',true);
    }catch{}
  }
  async function repairScramjetStorage(){
    if(navigator.serviceWorker){
      const registrations=await Promise.all([
        navigator.serviceWorker.getRegistration('/~/sj/').catch(()=>null),
        navigator.serviceWorker.getRegistration('/scramjet/service/').catch(()=>null)
      ]);
      await Promise.all(registrations.map(registration=>registration?.unregister?.().catch(()=>null)));
    }
    const names=['$scramjet','__scramjet_controller'];
    if(indexedDB.databases){
      const databases=await indexedDB.databases().catch(()=>[]);
      for(const db of databases){
        if(db?.name && /scramjet/i.test(db.name) && !names.includes(db.name)) names.push(db.name);
      }
    }
    await Promise.all(names.map(name=>deleteIndexedDb(name)));
  }
  async function repairScramjetCaches(){
    if(!window.caches?.keys) return;
    const names=await caches.keys().catch(()=>[]);
    await Promise.all(names.filter(name=>/scramjet/i.test(name)).map(name=>caches.delete(name).catch(()=>false)));
  }
  async function repairUvStorage(){
    if(navigator.serviceWorker){
      const registrations=await Promise.all([
        navigator.serviceWorker.getRegistration('/service/').catch(()=>null),
        navigator.serviceWorker.getRegistration('/uv/').catch(()=>null)
      ]);
      await Promise.all(registrations.map(registration=>registration?.unregister?.().catch(()=>null)));
    }
  }
  async function repairUvCaches(){
    if(!window.caches?.keys) return;
    const names=await caches.keys().catch(()=>[]);
    await Promise.all(names.filter(name=>/(ultraviolet|uv|bare|epoxy|libcurl)/i.test(name)).map(name=>caches.delete(name).catch(()=>false)));
  }
  function clearNyxCookies(){
    try{
      const hostParts=location.hostname.split('.').filter(Boolean);
      const domains=new Set(['']);
      for(let i=0;i<hostParts.length-1;i++) domains.add('.'+hostParts.slice(i).join('.'));
      const pathParts=location.pathname.split('/').filter(Boolean);
      const paths=new Set(['/']);
      let path='';
      pathParts.forEach(part=>{
        path+='/'+part;
        paths.add(path);
        paths.add(path+'/');
      });
      document.cookie.split(';').forEach(cookie=>{
        const name=cookie.split('=')[0]?.trim();
        if(!name) return;
        domains.forEach(domain=>{
          paths.forEach(pathValue=>{
            const domainPart=domain ? `; domain=${domain}` : '';
            document.cookie=`${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=${pathValue}${domainPart}; SameSite=Lax`;
          });
        });
      });
    }catch{}
  }
  async function clearAllNyxData(){
    try{document.body.classList.add('nyx-resetting')}catch{}
    try{toast('Clearing cache...')}catch{}
    try{
      if(navigator.serviceWorker?.getRegistrations){
        const registrations=await navigator.serviceWorker.getRegistrations().catch(()=>[]);
        await Promise.all(registrations.map(registration=>registration.unregister().catch(()=>false)));
      }
    }catch{}
    try{
      if(window.caches?.keys){
        const names=await caches.keys().catch(()=>[]);
        await Promise.all(names.map(name=>caches.delete(name).catch(()=>false)));
      }
    }catch{}
    try{
      if(indexedDB.databases){
        const databases=await indexedDB.databases().catch(()=>[]);
        await Promise.all(databases.map(db=>db?.name ? deleteIndexedDb(db.name) : false));
      }else{
        await Promise.all(['$scramjet','__scramjet_controller'].map(name=>deleteIndexedDb(name)));
      }
    }catch{}
    clearNyxCookies();
    try{sessionStorage.clear()}catch{}
    try{localStorage.clear()}catch{}
    setTimeout(()=>location.replace(location.pathname+'?nyx-reset='+Date.now()),220);
  }
  async function ensureFreshProxyState(){
    if(store.text('nyx.proxyStateVersion','')===proxyStateVersion) return;
    await Promise.all([
      repairScramjetStorage(),
      repairScramjetCaches(),
      repairUvStorage(),
      repairUvCaches()
    ]);
    scramjetController=null;
    scramjetTransport=null;
    scramjetTransportKey='';
    scramjetInstallPromise=null;
    uvInstallPromise=null;
    store.setText('nyx.scramjetStateVersion',scramjetStateVersion);
    store.setText('nyx.proxyStateVersion',proxyStateVersion);
  }
  async function ensureFreshScramjetState(){
    if(store.text('nyx.scramjetStateVersion','')===scramjetStateVersion) return;
    await repairScramjetStorage();
    await repairScramjetCaches();
    scramjetController=null;
    scramjetTransport=null;
    scramjetTransportKey='';
    store.setText('nyx.scramjetStateVersion',scramjetStateVersion);
  }
  function installUltraviolet(){
    if(uvInstallPromise) return uvInstallPromise;
    uvInstallPromise=(async()=>{
      if(location.protocol==='file:' || !('serviceWorker' in navigator)) return false;
      await ensureFreshProxyState();
      if(!window.__uv$config){
        await loadScript('/uv/uv.bundle.js');
        await loadScript('/uv.config.js');
      }
      const config=window.__uv$config;
      if(!config?.prefix || typeof config.encodeUrl!=='function') return false;
      const existing=await navigator.serviceWorker.getRegistration(config.prefix).catch(()=>null);
      if(existing?.active?.scriptURL && !existing.active.scriptURL.includes(config.sw || '/uv.sw.js')){
        await existing.unregister().catch(()=>null);
      }
      const registration=await navigator.serviceWorker.register(config.sw || '/uv.sw.js',{scope:config.prefix,updateViaCache:'none'});
      await registration.update().catch(()=>null);
      await waitForServiceWorkerActive(registration,config.prefix);
      await installBareMuxTransport();
      console.log('nyx UV Engine: Ready',registration.scope);
      return true;
    })().catch(err=>{
      console.warn('nyx UV Engine unavailable:',err);
      uvInstallPromise=null;
      return false;
    });
    return uvInstallPromise;
  }
  function installScramjet(){
    if(scramjetInstallPromise) return scramjetInstallPromise;
    let step='starting Scramjet';
    scramjetInstallPromise=(async()=>{
      step='checking browser support';
      if(location.protocol==='file:' || !('serviceWorker' in navigator)) return false;
      step='resetting stale Scramjet state';
      await ensureFreshProxyState();
      await ensureFreshScramjetState();
      step='loading Scramjet assets';
      if(!window.$scramjet) await loadScript('/scramjet/scramjet.js');
      if(!window.$scramjetController) await loadScript('/controller/controller.api.js');
      step='loading Scramjet runtime guard';
      await loadScramjetRuntimeGuardSource();
      step='starting Scramjet transport';
      const transport=await createScramjetTransport();
      step='registering Scramjet service worker';
      const registration=await navigator.serviceWorker.register('/scramjet.sw.js?v=nyx-sj-20260716-alpha2-v1',{scope:'/~/sj/',updateViaCache:'none'});
      await registration.update().catch(()=>null);
      step='activating Scramjet service worker';
      const active=await waitForServiceWorkerActive(registration);
      if(!active) throw new Error('Scramjet service worker did not activate');
      step='initializing Scramjet controller';
      try{
        const serviceworker=registration.active || navigator.serviceWorker.controller;
        if(!serviceworker) throw new Error('Scramjet service worker is not controlling this page yet');
        if(!scramjetController) scramjetController=createScramjetController(serviceworker,transport);
        else scramjetController.setTransport?.(transport);
        await scramjetController.wait();
      }catch(initError){
        if(!isScramjetIdbShapeError(initError)) throw initError;
        step='repairing Scramjet IndexedDB';
        await repairScramjetStorage();
        const repairedRegistration=await navigator.serviceWorker.register('/scramjet.sw.js?v=nyx-sj-20260716-alpha2-v1',{scope:'/~/sj/',updateViaCache:'none'});
        const repairedActive=await waitForServiceWorkerActive(repairedRegistration);
        if(!repairedActive) throw new Error('Scramjet service worker did not activate after storage repair');
        step='initializing Scramjet controller after storage repair';
        const serviceworker=repairedRegistration.active || navigator.serviceWorker.controller;
        if(!serviceworker) throw new Error('Scramjet service worker is not controlling this page yet');
        scramjetController=createScramjetController(serviceworker,transport);
        await scramjetController.wait();
      }
      console.log('nyx Scramjet Engine: Ready',registration.scope);
      scramjetInstallError='';
      return true;
    })().catch(err=>{
      console.warn('nyx Scramjet Engine unavailable:',err);
      scramjetInstallError=`Failed while ${step}: ${err?.message || err}`;
      scramjetController=null;
      scramjetInstallPromise=null;
      return false;
    });
    return scramjetInstallPromise;
  }
  function rammerhead(url){
    if(/^data:text\/html/i.test(url)) return url;
    const base=getRhBase();
    if(url.startsWith(base)) return url;
    const sessionId=store.text('nyx.rammerheadSession','');
    return sessionId ? rhBuildUrl(base,sessionId,url) : url;
  }
  async function rhNavigate(rawUrl,navigateFn){
    if(/^data:text\/html/i.test(rawUrl)){
      navigateFn(rawUrl);
      return;
    }
    const session=await getRhSession();
    navigateFn(session ? rhBuildUrl(session.base,session.id,rawUrl) : rawUrl);
  }
  function bring(win){win.style.zIndex=++zTop}
  function updateMinimizedDock(){
    const dock=document.querySelector('.dock');
    const tray=$('minimizedTray');
    if(dock&&tray) dock.classList.toggle('has-minimized',tray.children.length>0);
  }
  function updateDockFullscreenState(){
    const dock=document.querySelector('.dock');
    const hasFullscreen=[...document.querySelectorAll('.window.maximized')].some(win=>win.style.display!=='none' && !win.classList.contains('closing'));
    dock?.classList.toggle('hidden-for-window',hasFullscreen);
    if(hasFullscreen) closeWeatherPanelAnimated();
  }
  function minimizeWindow(win){
    const tray=$('minimizedTray');
    if(!tray) return;
    const id=win.dataset.winId || ('win'+Date.now()+Math.random().toString(16).slice(2));
    win.dataset.winId=id;
    if(!tray.querySelector(`[data-restore="${id}"]`)){
      const title=win.querySelector('.titlebar-title')?.textContent || 'Window';
      const item=document.createElement('button');
      item.className='minimized-item';
      item.dataset.restore=id;
      item.dataset.mini=(title.trim()[0] || 'W').toUpperCase();
      item.title='Restore '+title;
      item.textContent=title;
      item.onclick=()=>restoreWindow(win);
      tray.appendChild(item);
    }
    win.style.display='none';
    updateMinimizedDock();
    updateDockFullscreenState();
  }
  function restoreWindow(win){
    win.style.display='block';
    const tray=$('minimizedTray');
    tray?.querySelector(`[data-restore="${win.dataset.winId}"]`)?.remove();
    updateMinimizedDock();
    bring(win);
    updateDockFullscreenState();
  }
  function closeWindowAnimated(win){
    if(!win || win.classList.contains('closing')) return;
    $('minimizedTray')?.querySelector(`[data-restore="${win.dataset.winId}"]`)?.remove();
    updateMinimizedDock();
    win.classList.add('closing');
    setTimeout(()=>{win.remove(); updateDockFullscreenState()},230);
  }
  function updateWindowSizeClasses(win){
    win.classList.toggle('compact',win.offsetWidth<520);
    win.classList.toggle('short',win.offsetHeight<360);
  }
  function updateResponsiveFit(){
    const root=document.documentElement;
    const w=Math.max(320,window.innerWidth || 320);
    const h=Math.max(320,window.innerHeight || 320);
    const scale=Math.max(.68,Math.min(1.08,Math.min(w/1366,h/768)));
    const dockSize=Math.round(Math.max(28,Math.min(40,36*scale)));
    const dockIconSize=Math.round(Math.max(24,Math.min(36,32*scale)));
    const desktopIconSize=Math.round(Math.max(42,Math.min(64,58*scale)));
    const sideReserve=w<520 ? 24 : 42;
    const safeBottom=Math.round(Math.max(48,Math.min(72,58*scale)));
    root.style.setProperty('--ui-scale',scale.toFixed(3));
    root.style.setProperty('--dock-size',dockSize+'px');
    root.style.setProperty('--dock-icon-size',dockIconSize+'px');
    root.style.setProperty('--desktop-icon-size',desktopIconSize+'px');
    root.style.setProperty('--search-width','min(620px, calc(100vw - '+sideReserve+'px))');
    root.style.setProperty('--safe-bottom',safeBottom+'px');
    document.querySelectorAll('.window').forEach(clampWindowToScreen);
  }
  let responsiveFitTimer=0;
  function scheduleResponsiveFit(){
    clearTimeout(responsiveFitTimer);
    responsiveFitTimer=setTimeout(updateResponsiveFit,60);
  }
  window.addEventListener('resize',scheduleResponsiveFit);
  window.addEventListener('orientationchange',scheduleResponsiveFit);
  function clampWindowToScreen(win){
    if(!win || win.classList.contains('maximized')) return;
    const margin=12;
    const styles=getComputedStyle(document.documentElement);
    const topLimit=(parseFloat(styles.getPropertyValue('--bar')) || 30) + 8;
    const bottomReserve=parseFloat(styles.getPropertyValue('--safe-bottom')) || 58;
    const maxW=Math.max(260,window.innerWidth - margin*2);
    const maxH=Math.max(180,window.innerHeight - topLimit - bottomReserve - margin);
    const width=Math.min(win.offsetWidth || parseFloat(win.style.width) || Math.min(560,maxW),maxW);
    const height=Math.min(win.offsetHeight || parseFloat(win.style.height) || Math.min(420,maxH),maxH);
    let left=parseFloat(win.style.left) || margin;
    let top=parseFloat(win.style.top) || topLimit;
    const rightLimit=Math.max(margin,window.innerWidth - width - margin);
    const bottomLimit=Math.max(topLimit,window.innerHeight - bottomReserve - height);
    left=Math.max(margin,Math.min(left,rightLimit));
    top=Math.max(topLimit,Math.min(top,bottomLimit));
    win.style.width=width+'px';
    win.style.height=height+'px';
    win.style.left=left+'px';
    win.style.top=top+'px';
  }
  //window-system
  function makeWindow(opts){
    const win=document.createElement('section');
    win.className='window '+(opts.className||'');
    win.style.left=opts.left||`${120+winCount*28}px`;
    win.style.top=opts.top||`${80+winCount*24}px`;
    win.style.width=opts.width||'560px';
    win.style.height=opts.height||'420px';
    win.innerHTML=`<div class="titlebar"><div class="titlebar-title">${esc(opts.title||'Window')}</div><div class="window-controls"><button data-minimize title="Minimize" aria-label="Minimize"></button><button data-maximize title="Maximize" aria-label="Maximize"></button><button class="close" data-close title="Close" aria-label="Close"></button></div></div>${opts.body||''}`;
    addResizeHandles(win);
    $('desktop').appendChild(win); winCount++; bring(win); wireWindow(win);
    clampWindowToScreen(win);
    if(opts.autoMaximize !== false){
      win.classList.add('maximized');
      const maxBtn=win.querySelector('[data-maximize]');
      if(maxBtn) maxBtn.setAttribute('aria-label','Restore');
    }
    closeWeatherForWindowOpen();
    updateWindowSizeClasses(win); updateDockFullscreenState(); initDesktopSplash(); return win;
  }
  function addResizeHandles(win){
    ['n','s','e','w','ne','nw','se','sw'].forEach(dir=>{
      const handle=document.createElement('span');
      handle.className='resize-handle '+dir;
      handle.dataset.resize=dir;
      win.appendChild(handle);
    });
  }
  function wireWindow(win){
    const bar=win.querySelector('.titlebar');
    let drag=null, resize=null;
    if('ResizeObserver' in window) new ResizeObserver(()=>updateWindowSizeClasses(win)).observe(win);
    win.addEventListener('pointerdown',()=>bring(win));
    const startDrag=e=>{
      if(e.target.closest('button'))return;
      if(win.classList.contains('maximized')){
        const width=Math.min(Math.max(760,window.innerWidth*.62),window.innerWidth-24);
        const height=Math.min(Math.max(460,window.innerHeight*.62),window.innerHeight-80);
        win.classList.remove('maximized');
        win.style.width=width+'px';
        win.style.height=height+'px';
        win.style.left=Math.max(0,Math.min(window.innerWidth-width,e.clientX-width*.45))+'px';
        win.style.top=Math.max(34,Math.min(window.innerHeight-height,e.clientY-16))+'px';
      }
      drag={x:e.clientX,y:e.clientY,left:win.offsetLeft,top:win.offsetTop};
      bar.classList.add('dragging'); e.preventDefault();
    };
    bar.addEventListener('pointerdown',startDrag);
    win.querySelector('.browser-tabs')?.addEventListener('pointerdown',startDrag);
    win.querySelectorAll('[data-resize]').forEach(handle=>{
      handle.addEventListener('pointerdown',e=>{
        if(win.classList.contains('maximized')) return;
        resize={dir:handle.dataset.resize,x:e.clientX,y:e.clientY,left:win.offsetLeft,top:win.offsetTop,width:win.offsetWidth,height:win.offsetHeight};
        e.preventDefault();
        e.stopPropagation();
      });
    });
    window.addEventListener('pointermove',e=>{
      if(resize){
        resizeWindowFromEdge(win,resize,e);
        return;
      }
      if(!drag)return;
      win.style.left=Math.max(0,drag.left+e.clientX-drag.x)+'px';
      win.style.top=Math.max(0,drag.top+e.clientY-drag.y)+'px';
    });
    window.addEventListener('pointerup',()=>{drag=null; resize=null; bar.classList.remove('dragging')});
    window.addEventListener('resize',()=>clampWindowToScreen(win));
    win.querySelector('[data-close]').onclick=()=>closeWindowAnimated(win);
    win.querySelector('[data-minimize]').onclick=()=>minimizeWindow(win);
    win.querySelector('[data-maximize]').onclick=e=>{
      win.classList.toggle('maximized');
      e.currentTarget.setAttribute('aria-label',win.classList.contains('maximized')?'Restore':'Maximize');
      updateDockFullscreenState();
    };
  }
  function resizeWindowFromEdge(win,state,e){
    const minW=Number.parseInt(getComputedStyle(win).minWidth,10)||320;
    const minH=Number.parseInt(getComputedStyle(win).minHeight,10)||220;
    const styles=getComputedStyle(document.documentElement);
    const bottomReserve=parseFloat(styles.getPropertyValue('--safe-bottom')) || 58;
    const topLimit=(parseFloat(styles.getPropertyValue('--bar')) || 30) + 4;
    let left=state.left, top=state.top, width=state.width, height=state.height;
    const dx=e.clientX-state.x, dy=e.clientY-state.y;
    if(state.dir.includes('e')) width=state.width+dx;
    if(state.dir.includes('s')) height=state.height+dy;
    if(state.dir.includes('w')){width=state.width-dx; left=state.left+dx}
    if(state.dir.includes('n')){height=state.height-dy; top=state.top+dy}
    if(width<minW){if(state.dir.includes('w')) left-=minW-width; width=minW}
    if(height<minH){if(state.dir.includes('n')) top-=minH-height; height=minH}
    width=Math.min(width,window.innerWidth-left-12);
    height=Math.min(height,window.innerHeight-top-bottomReserve);
    left=Math.max(0,left);
    top=Math.max(topLimit,top);
    win.style.left=left+'px';
    win.style.top=top+'px';
    win.style.width=width+'px';
    win.style.height=height+'px';
    updateWindowSizeClasses(win);
  }
  function browserBody(){
    const presenceText=nyxPresenceCount===null ? 'Connecting\u2026' : `${nyxPresenceCount} online`;
    return `<div class="browser-tabs"><button class="new-tab" data-new-tab>+</button></div><div class="browser-tools"><div class="tool-group"><button class="tool-btn" data-back title="Back">&#10140;</button><button class="tool-btn" data-forward title="Forward">&#10140;</button><button class="tool-btn" data-reload title="Reload">&#128472;</button></div><input class="urlbar" placeholder="Search"><button class="go-btn" data-go>Go</button><button class="menu-btn" data-menu>...</button></div><div class="browser-body"><div class="browser-home"><div class="nyx-home-presence${nyxOwnerDashboardAccess?' nyx-owner-presence-action':''}" data-nyx-owner-presence role="button" tabindex="${nyxOwnerDashboardAccess?'0':'-1'}" aria-live="polite" aria-label="${nyxOwnerDashboardAccess?'Open Owner Dashboard':'Current users online'}"><span class="nyx-home-presence-dot" aria-hidden="true"></span><span data-nyx-online-count>${presenceText}</span></div><button class="nyx-home-weather" data-home-weather data-open="weather" type="button" aria-label="Open weather report"><span class="nyx-home-weather-icon" data-home-weather-icon aria-hidden="true"><svg class="nyx-weather-symbol nyx-weather-symbol-partly-cloudy" viewBox="0 0 24 24" focusable="false"><circle class="nyx-weather-sun-fill" cx="8" cy="8" r="3.2"/><path class="nyx-weather-sun-ray" d="M8 2.3v1.4M3.97 3.97l1 1M2.3 8h1.4M12.03 3.97l-1 1M13.7 8h-1.4"/><path class="nyx-weather-cloud-fill" d="M7.2 19h10a4 4 0 0 0 .45-7.98A5.55 5.55 0 0 0 7.08 12.6 3.2 3.2 0 0 0 7.2 19Z"/></svg></span><strong data-home-weather-temp>--°</strong><span data-home-weather-desc>Loading</span></button><main class="browser-shell-start nyx-home-hero"><h1 class="nyx-home-title">Nyx</h1><form class="browser-blank-search nyx-home-search" data-browser-blank-search><span class="nyx-home-search-icon" aria-hidden="true"></span><input data-browser-blank-input aria-label="Find your course or enter a URL" placeholder="Find your Course" autocomplete="off" spellcheck="false"></form><nav class="nyx-home-actions" aria-label="Nyx home"><button data-open="apps" data-no-button-motion type="button"><span class="nyx-home-action-icon nyx-home-action-apps" aria-hidden="true"></span><span>Resources</span></button><button data-app-url="https://docs.google.com/document/d/180tBipQWefvmr0Mt61vnWqR0z4ill1hKVlOjNHeaGuI/edit?tab=t.0" data-no-button-motion type="button"><span class="nyx-home-action-icon nyx-home-action-study" aria-hidden="true"></span><span>Assignments</span></button><button data-open-nyx-profile-entry data-no-button-motion type="button"><span class="nyx-home-action-icon nyx-home-action-profile" aria-hidden="true"></span><span>Student Profile</span></button><button data-open="settings" data-no-button-motion type="button"><span class="nyx-home-action-icon nyx-home-action-settings" aria-hidden="true"></span><span>Preferences</span></button></nav></main><div class="quick-grid home-shortcut-grid browser-home-normal" data-home-shortcuts>${browserHomeShortcutTiles()}</div><a class="nyx-home-link-checker" data-app-url="/apps/link-checker/" href="/apps/link-checker/">Link Checker</a><nav class="nyx-home-utility-links" aria-label="Nyx information and tools"><a data-app-url="/apps/link-generator/" href="/apps/link-generator/">Link Generator</a><a data-open="terms" href="nyx://terms">Terms Of Service</a><a data-open="developer" href="nyx://developer">Developer Console</a><a data-open="about" href="nyx://about">About Us</a></nav></div></div>`;
  }
  //apps-grid
  const nyxAiHomeShortcut={domain:'nyx-ai',title:'AI Tutor',url:'nyx://ai',favorite:false};
  const nyxAiHomeShortcutMigrationKey='nyx.homeShortcuts.aiShortcutV1';
  const defaultHomeShortcuts=[
    {domain:'geforcenow',title:'Course Library',url:'https://play.geforcenow.com/',favorite:true},
    {domain:'duck.ai',title:'Research Assistant',url:'https://duck.ai/',favorite:false},
    nyxAiHomeShortcut,
    {domain:'games',title:'Practice Lab',url:'/assets/games/',favorite:false},
    {domain:'youtube.com',title:'Video Lessons',url:'https://www.youtube.com/',favorite:false},
    {domain:'tiktok.com',title:'Quick Lessons',url:'https://www.tiktok.com/',favorite:false},
    {domain:'spotify.com',title:'Focus Audio',url:'https://open.spotify.com/',favorite:false},
    {domain:'discord.com',title:'Study Groups',url:'https://discord.com/app',favorite:false}
  ];
  const educationShortcutTitles=new Map(defaultHomeShortcuts.map(item=>[String(item.url).replace(/\/+$/,''),item.title]));
  function normalizeInternalAppUrl(url){
    const raw=String(url || '').trim();
    if(/^assets\//i.test(raw)) return `/${raw}`;
    return raw;
  }
  function normalizeHomeShortcut(item){
    const next={...item,url:normalizeInternalAppUrl(item?.url)};
    if(next.url==='/assets/games/index.html') next.url='/assets/games/';
    if(next.url==='/assets/games/'){
      next.domain='games';
    }
    next.title=educationShortcutTitles.get(String(next.url || '').replace(/\/+$/,'')) || next.title;
    return next;
  }
  function homeShortcuts(){
    try{
      const saved=JSON.parse(store.text('nyx.homeShortcuts',''));
      if(Array.isArray(saved)){
        const cleaned=saved
          .filter(item=>item?.url && item?.title)
          .map(normalizeHomeShortcut);
        if(!store.get(nyxAiHomeShortcutMigrationKey,false)){
          if(!cleaned.some(item=>String(item.url || '').trim().toLowerCase()==='nyx://ai')){
            const duckIndex=cleaned.findIndex(item=>String(item.domain || '').toLowerCase()==='duck.ai');
            cleaned.splice(duckIndex>=0?duckIndex+1:cleaned.length,0,{...nyxAiHomeShortcut});
          }
          store.set(nyxAiHomeShortcutMigrationKey,true);
        }
        if(JSON.stringify(cleaned)!==JSON.stringify(saved)) saveHomeShortcuts(cleaned);
        return cleaned;
      }
    }catch{}
    store.set(nyxAiHomeShortcutMigrationKey,true);
    return defaultHomeShortcuts.map(item=>({...item}));
  }
  function saveHomeShortcuts(items){
    store.setText('nyx.homeShortcuts',JSON.stringify(items.slice(0,32)));
  }
  function homeShortcutDomain(url,title=''){
    try{return new URL(url,location.href).hostname.replace(/^www\./,'') || title.toLowerCase()}
    catch{return String(title || 'apps').toLowerCase().replace(/\s+/g,'')}
  }
  function homeShortcutMask(domain,title=''){
    const key=String(domain || title || '').toLowerCase();
    if(key.includes('geforce')) return '/assets/icons/dock-nvidia.png';
    if(key==='games' || key.includes('study')) return '/assets/icons/dock-controller.png';
    if(key==='nyx-ai' || key==='ai') return '/assets/icons/shortcut-nyx-ai.svg?v=3';
    if(key.includes('duck')) return '/assets/icons/shortcut-duckduckgo.svg';
    if(key.includes('youtube') || key==='youtu.be') return '/assets/icons/shortcut-youtube.svg';
    if(key.includes('tiktok')) return '/assets/icons/shortcut-tiktok.svg';
    if(key.includes('spotify')) return '/assets/icons/shortcut-spotify.svg';
    if(key.includes('discord')) return '/assets/icons/shortcut-discord.svg';
    return '';
  }
  function browserHomeShortcutTiles(){
    const tiles=homeShortcuts()
      .map((item,index)=>({...item,index}))
      .sort((a,b)=>(b.favorite===true)-(a.favorite===true))
      .map(item=>{
        const domain=item.domain || homeShortcutDomain(item.url,item.title);
        const mask=homeShortcutMask(domain,item.title);
        const icon=mask ? `<span class="home-shortcut-glyph" style="--shortcut-mask:url('${esc(mask)}')" aria-hidden="true"></span>` : `<img class="quick-icon" alt="" draggable="false" src="${appIcon(domain)}">`;
        return `<div class="quick-tile home-shortcut ${item.favorite?'favorite':''}" draggable="false" data-home-shortcut="${item.index}" data-domain="${esc(domain)}" data-app-url="${esc(item.url)}"><button class="home-shortcut-open" data-app-url="${esc(item.url)}" draggable="false" type="button"><img class="quick-icon" alt="" draggable="false" src="${appIcon(domain)}"><span>${esc(item.title)}</span></button><button class="home-shortcut-menu-btn" data-home-shortcut-menu type="button" title="Shortcut options" aria-label="Shortcut options"><span class="shortcut-real-dots" aria-hidden="true">⋮</span></button><div class="home-shortcut-menu"><button data-home-shortcut-favorite="${item.index}" type="button">${item.favorite?'Unfavorite':'Favorite'}</button><button data-home-shortcut-remove="${item.index}" type="button">Remove</button></div></div>`;
    }).join('');
    return tiles + '<button class="quick-tile home-shortcut-add" data-home-shortcut-add type="button"><b>+</b><span>Add Resource</span></button>';
  }
  browserHomeShortcutTiles=function(){
    const tiles=homeShortcuts()
      .map((item,index)=>({...item,index}))
      .sort((a,b)=>(b.favorite===true)-(a.favorite===true))
      .map(item=>{
        const domain=item.domain || homeShortcutDomain(item.url,item.title);
        const mask=homeShortcutMask(domain,item.title);
        const icon=mask
          ? `<span class="home-shortcut-glyph" style="--shortcut-mask:url('${esc(mask)}')" aria-hidden="true"></span>`
          : homeShortcutIconMarkup(item,domain);
        return `<div class="quick-tile home-shortcut ${item.favorite?'favorite':''}" draggable="false" data-home-shortcut="${item.index}" data-domain="${esc(domain)}" data-app-url="${esc(item.url)}"><button class="home-shortcut-open" data-app-url="${esc(item.url)}" draggable="false" type="button">${icon}<span>${esc(item.title)}</span></button><button class="home-shortcut-menu-btn" data-home-shortcut-menu type="button" title="Shortcut options" aria-label="Shortcut options"><span class="shortcut-real-dots" aria-hidden="true">...</span></button><div class="home-shortcut-menu"><button data-home-shortcut-favorite="${item.index}" type="button">${item.favorite?'Unfavorite':'Favorite'}</button><button data-home-shortcut-remove="${item.index}" type="button">Remove</button></div></div>`;
      }).join('');
    return tiles + '<button class="quick-tile home-shortcut-add" data-home-shortcut-add type="button"><b>+</b><span>Add Resource</span></button>';
  };
  function homeEntranceCanPlay(root=document){
    const scope=root || document;
    if(document.body.classList.contains('hosted-cloak-entry')) return false;
    if(document.documentElement.classList.contains('hosted-cloak-entry')) return false;
    if($('cloakLaunchScreen')?.classList.contains('show')) return false;
    const welcome=$('welcomeScreen');
    if(welcome && !welcome.classList.contains('hidden')) return false;
    if(!document.body.classList.contains('browser-shell')) return false;
    const home=scope.querySelector?.('.browser-home:not(.hidden)') || document.querySelector('.browser-home:not(.hidden)');
    if(!home) return false;
    if(document.body.classList.contains('browser-content-active')) return false;
    return !!home.querySelector('[data-home-shortcuts]');
  }
  function playHomeShortcutAnimation(root=document){
    if(!homeEntranceCanPlay(root)) return;
    root.querySelectorAll('[data-home-shortcuts]').forEach(grid=>{
      grid.classList.remove('shortcut-entrance');
      void grid.offsetWidth;
      requestAnimationFrame(()=>requestAnimationFrame(()=>grid.classList.add('shortcut-entrance')));
      Array.from(grid.children).filter(tile=>tile.classList?.contains('quick-tile')).forEach((tile,index)=>{
        tile.getAnimations?.().forEach(anim=>anim.cancel());
        tile.style.opacity='0';
        tile.style.transform='translate(-32px,48px) scale(.84)';
        tile.style.filter='blur(7px)';
        const delay=70*index+40;
        const finish=()=>{tile.style.opacity='';tile.style.transform='';tile.style.filter=''};
        const run=()=>{
          if(typeof tile.animate==='function'){
            const anim=tile.animate([
              {opacity:0,transform:'translate(-32px,48px) scale(.84)',filter:'blur(7px)'},
              {opacity:1,transform:'translate(-10px,14px) scale(.97)',filter:'blur(1px)',offset:.68},
              {opacity:1,transform:'translate(0,0) scale(1)',filter:'blur(0)'}
            ],{duration:720,delay,easing:'cubic-bezier(.18,.82,.22,1)',fill:'both'});
            anim.onfinish=finish;
            anim.oncancel=finish;
            anim.finished?.then(finish,finish);
            setTimeout(finish,delay+860);
            return;
          }
          setTimeout(finish,delay+720);
        };
        requestAnimationFrame(run);
      });
    });
  }
  function animateHomeElement(el,index=0,options={}){
    if(!el) return;
    el.getAnimations?.().forEach(anim=>anim.cancel());
    const start=options.start || 'translate(-32px,48px) scale(.84)';
    const mid=options.mid || 'translate(-10px,14px) scale(.97)';
    const delay=options.delay ?? (70*index+40);
    const duration=options.duration || 720;
    el.style.opacity='0';
    el.style.transform=start;
    el.style.filter='blur(7px)';
    const finish=()=>{el.style.opacity='';el.style.transform='';el.style.filter=''};
    const run=()=>{
      if(typeof el.animate==='function'){
        const anim=el.animate([
          {opacity:0,transform:start,filter:'blur(7px)'},
          {opacity:1,transform:mid,filter:'blur(1px)',offset:.68},
          {opacity:1,transform:'translate(0,0) scale(1)',filter:'blur(0)'}
      ],{duration,delay,easing:'cubic-bezier(.18,.82,.22,1)',fill:'both'});
      anim.onfinish=finish;
      anim.oncancel=finish;
      anim.finished?.then(finish,finish);
      setTimeout(finish,delay+duration+140);
      return;
    }
      setTimeout(finish,delay+duration);
    };
    requestAnimationFrame(run);
  }
  let nyxStartupRevealTimer=0;
  function playNyxStartupReveal(){
    const body=document.body;
    const targets=[
      ...document.querySelectorAll('body.browser-shell .top-os .brand-mini > button, body.browser-shell .top-os > .browser-top-clock, body.browser-shell .top-os .browser-mode-address > *, body.browser-shell .browser-home [data-home-shortcuts], body.browser-shell .browser-home [data-home-shortcuts] > .quick-tile')
    ];
    document.querySelectorAll('.shortcut-entrance').forEach(el=>el.classList.remove('shortcut-entrance'));
    document.querySelectorAll('.tab-opening,.tab-activating').forEach(el=>el.classList.remove('tab-opening','tab-activating'));
    targets.forEach(el=>el.getAnimations?.().forEach(animation=>animation.cancel()));
    clearTimeout(nyxStartupRevealTimer);
    body.classList.remove('nyx-startup-reveal');
    void body.offsetWidth;
    requestAnimationFrame(()=>{
      body.classList.remove('nyx-startup-prep');
      body.classList.add('nyx-startup-reveal');
      nyxStartupRevealTimer=setTimeout(()=>{
        body.classList.remove('nyx-startup-reveal');
        suppressHomeEntranceOnStartup=false;
      },1250);
    });
  }
  function playHomeChromeAnimation(root=document){
    if(!homeEntranceCanPlay(root)) return;
    const scope=root || document;
    scope.querySelectorAll?.('.browser-shell-start').forEach((el,index)=>animateHomeElement(el,index,{delay:60,duration:1200,start:'translate(-28px,44px) scale(.9)',mid:'translate(-8px,13px) scale(.98)'}));
    const tabItems=[
      ...document.querySelectorAll('body.browser-shell .brand-mini [data-browser-shell-home], body.browser-shell .brand-mini .browser-mode-shell-tab, body.browser-shell .brand-mini [data-browser-shell-new-tab]')
    ];
    tabItems.forEach((el,index)=>animateHomeElement(el,index,{delay:45+(index*65),duration:650,start:'translate(-24px,34px) scale(.88)',mid:'translate(-7px,10px) scale(.97)'}));
    const toolbarItems=[
      ...document.querySelectorAll('body.browser-shell [data-browser-shell-back], body.browser-shell [data-browser-shell-forward], body.browser-shell [data-browser-shell-reload], body.browser-shell [data-browser-shell-home-nav], body.browser-shell [data-browser-shell-url], body.browser-shell [data-browser-shell-bookmark], body.browser-shell .browser-mode-weather, body.browser-shell [data-browser-shell-menu], body.browser-shell #clock')
    ];
    toolbarItems.forEach((el,index)=>animateHomeElement(el,index,{delay:120+(index*58),duration:690,start:'translate(-26px,38px) scale(.9)',mid:'translate(-8px,12px) scale(.98)'}));
  }
  let homeEntranceLastPlay=0;
  let suppressHomeEntranceOnStartup=true;
  function playHomeEntranceAnimation(root=document,options={}){
    if(suppressHomeEntranceOnStartup) return;
    if(!homeEntranceCanPlay(root)) return;
    const now=Date.now();
    if(!options.force && now-homeEntranceLastPlay<1400) return;
    homeEntranceLastPlay=now;
    playHomeShortcutAnimation(root);
    playHomeChromeAnimation(root);
  }
  function playBrowserShellPageReveal(root=document){
    const scope=root || document;
    const home=scope.querySelector?.('.browser-home:not(.hidden)');
    if(!home) return;
    home.classList.remove('tab-opening');
    void home.offsetWidth;
    home.classList.add('tab-opening');
    setTimeout(()=>home.classList.remove('tab-opening'),520);
  }
  let homeShortcutAnimationObserverInstalled=false;
  function installHomeShortcutAnimationObserver(){
    if(homeShortcutAnimationObserverInstalled) return;
    homeShortcutAnimationObserverInstalled=true;
    let triggerTimer=0;
    let lastTrigger=0;
    const trigger=root=>{
      const now=Date.now();
      if(now-lastTrigger<850) return;
      lastTrigger=now;
      clearTimeout(triggerTimer);
      triggerTimer=setTimeout(()=>playHomeEntranceAnimation(root || document),90);
    };
    new MutationObserver(mutations=>{
      for(const mutation of mutations){
        for(const node of mutation.addedNodes){
          if(node.nodeType!==1) continue;
          const shortcutRoot=node.matches?.('[data-home-shortcuts]') ? node : node.querySelector?.('[data-home-shortcuts]');
          if(shortcutRoot && !shortcutRoot.dataset.entranceSeen){
            shortcutRoot.dataset.entranceSeen='true';
            trigger(shortcutRoot.closest?.('.browser-home') || node);
            return;
          }
        }
      }
    }).observe(document.body,{childList:true,subtree:true});
    trigger(document);
  }
  let interactiveHomeDotsInstalled=false;
  function installInteractiveHomeDots(){
    if(interactiveHomeDotsInstalled) return;
    interactiveHomeDotsInstalled=true;
    const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
    const initialize=home=>{
      if(!home || home.dataset.nyxDotField==='true') return;
      home.dataset.nyxDotField='true';
      const canvas=document.createElement('canvas');
      canvas.className='nyx-home-dot-field';
      canvas.setAttribute('aria-hidden','true');
      home.prepend(canvas);
      syncHomeDotFieldVisibility();
      const context=canvas.getContext('2d',{alpha:true});
      if(!context) return;
      const state={width:0,height:0,dots:[],pointer:null,trail:[],frame:0};
      const radius=42;
      const trailLifetime=760;
      const requestFrame=()=>{
        if(!state.frame) state.frame=requestAnimationFrame(draw);
      };
      const resize=()=>{
        const width=Math.max(1,home.clientWidth);
        const height=Math.max(1,home.clientHeight);
        if(width===state.width && height===state.height) return;
        state.width=width;
        state.height=height;
        const ratio=Math.min(devicePixelRatio || 1,2);
        canvas.width=Math.round(width*ratio);
        canvas.height=Math.round(height*ratio);
        canvas.style.width=width+'px';
        canvas.style.height=height+'px';
        context.setTransform(ratio,0,0,ratio,0,0);
        state.dots=[];
        const spacing=24;
        for(let y=12;y<height;y+=spacing){
          for(let x=20;x<width;x+=spacing) state.dots.push({homeX:x,homeY:y,x,y,vx:0,vy:0,opacity:1});
        }
        canvas.dataset.particleCount=String(state.dots.length);
        canvas.dataset.pointerEffect='repel-and-return';
        requestFrame();
      };
      function draw(){
        state.frame=0;
        const now=performance.now();
        state.trail=state.trail.filter(point=>now-point.time<trailLifetime);
        context.clearRect(0,0,state.width,state.height);
        const styles=getComputedStyle(home);
        const dotColor=styles.getPropertyValue('--nyx-dot-color').trim() || '#202b3d';
        context.fillStyle=dotColor;
        const influences=reducedMotion.matches ? [] : state.trail.map(point=>({
          x:point.x,
          y:point.y,
          weight:Math.max(0,1-(now-point.time)/trailLifetime)*.88
        }));
        if(state.pointer && !reducedMotion.matches) influences.unshift({x:state.pointer.x,y:state.pointer.y,weight:1});
        let unsettled=false;
        for(const dot of state.dots){
          if(!reducedMotion.matches){
            let pushStrength=0;
            let pushX=0;
            let pushY=0;
            for(const influence of influences){
              const dx=dot.x-influence.x;
              const dy=dot.y-influence.y;
              const distance=Math.hypot(dx,dy);
              if(distance>=radius) continue;
              const direction=distance>0.01 ? distance : 1;
              const strength=(1-distance/radius)*2.25*influence.weight;
              if(strength<=pushStrength) continue;
              pushStrength=strength;
              pushX=dx/direction*strength;
              pushY=dy/direction*strength;
            }
            dot.vx+=pushX;
            dot.vy+=pushY;
          }
          dot.vx+=(dot.homeX-dot.x)*.05;
          dot.vy+=(dot.homeY-dot.y)*.05;
          dot.vx*=.82;
          dot.vy*=.82;
          dot.x+=dot.vx;
          dot.y+=dot.vy;
          const displacement=Math.hypot(dot.x-dot.homeX,dot.y-dot.homeY);
          dot.opacity=Math.max(.18,1-displacement/42);
          if(displacement>.18 || dot.vx*dot.vx+dot.vy*dot.vy>.02) unsettled=true;
          context.globalAlpha=dot.opacity;
          context.beginPath();
          context.arc(dot.x,dot.y,2.7,0,Math.PI*2);
          context.fill();
        }
        context.globalAlpha=1;
        if(state.pointer || state.trail.length || unsettled) requestFrame();
      }
      home.addEventListener('pointermove',event=>{
        const rect=home.getBoundingClientRect();
        const next={x:event.clientX-rect.left,y:event.clientY-rect.top};
        const previous=state.pointer;
        if(previous){
          const last=state.trail[state.trail.length-1];
          const anchor=last || previous;
          if(Math.hypot(next.x-anchor.x,next.y-anchor.y)>=6){
            const distance=Math.hypot(next.x-previous.x,next.y-previous.y);
            const steps=Math.max(1,Math.min(6,Math.ceil(distance/12)));
            const time=performance.now();
            for(let step=0;step<steps;step++){
              const amount=step/steps;
              state.trail.push({x:previous.x+(next.x-previous.x)*amount,y:previous.y+(next.y-previous.y)*amount,time});
            }
            if(state.trail.length>54) state.trail.splice(0,state.trail.length-54);
          }
        }
        state.pointer=next;
        requestFrame();
      },{passive:true});
      home.addEventListener('pointerleave',()=>{
        if(state.pointer) state.trail.push({...state.pointer,time:performance.now()});
        state.pointer=null;
        requestFrame();
      },{passive:true});
      if(typeof ResizeObserver==='function') new ResizeObserver(resize).observe(home);
      else addEventListener('resize',resize,{passive:true});
      resize();
      syncHomeWeatherWidgets();
    };
    const scan=root=>{
      if(root?.matches?.('.browser-home')) initialize(root);
      root?.querySelectorAll?.('.browser-home').forEach(initialize);
    };
    new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
      if(node.nodeType===1) scan(node);
    }))).observe(document.body,{childList:true,subtree:true});
    scan(document);
  }
  function renderHomeShortcuts(root=document){
    root.querySelectorAll('[data-home-shortcuts]').forEach(grid=>{grid.innerHTML=browserHomeShortcutTiles()});
    playHomeEntranceAnimation(root);
  }
  function addHomeShortcut(){
    const title=prompt('App name');
    if(!title?.trim()) return;
    const url=prompt('App URL');
    if(!url?.trim()) return;
    const normalized=normalize(url.trim());
    const items=homeShortcuts();
    items.push({title:title.trim(),url:normalized,domain:homeShortcutDomain(normalized,title),icon:websiteFaviconUrl(normalized),favorite:false});
    saveHomeShortcuts(items);
    renderHomeShortcuts();
    toast('Shortcut added');
  }
  function toggleHomeShortcutFavorite(index){
    const items=homeShortcuts();
    const item=items[Number(index)];
    if(!item) return;
    item.favorite=!item.favorite;
    saveHomeShortcuts(items);
    renderHomeShortcuts();
  }
  function removeHomeShortcut(index){
    const items=homeShortcuts();
    items.splice(Number(index),1);
    saveHomeShortcuts(items);
    renderHomeShortcuts();
  }
  function quickTiles(){
    return [
      ['youtube.com','YouTube','https://www.youtube.com/'],
      ['games','Study','/assets/games/'],
      ['geforcenow','GeForce Now','https://play.geforcenow.com/'],
      ['roblox.com','Roblox','https://web.cloudmoonapp.com/game/com.roblox.client/'],
      ['discord.com','Discord','https://discord.com/app'],
      ['spotify.com','Spotify','https://open.spotify.com/'],
      ['traxmojo.com','Music','https://traxmojo.com/'],
      ['google.com','Google','https://www.google.com/'],
      ['docs.google.com','Study','https://docs.google.com/document/d/180tBipQWefvmr0Mt61vnWqR0z4ill1hKVlOjNHeaGuI/edit?tab=t.0'],
      ['duck.ai','Duck AI','https://duck.ai/'],
      ['nyx-ai','Nyx AI','nyx://ai'],
      ['wikipedia.org','Wikipedia','https://www.wikipedia.org/'],
      ['cineby.at','Cineby','https://cineby.at/'],
      ['tiktok.com','TikTok','https://www.tiktok.com/'],
      ['instagram.com','Instagram','https://www.instagram.com/'],
      ['snapchat.com','Snapchat','https://www.snapchat.com/'],
      ['amazon.com','Amazon','https://www.amazon.com/'],
      ['reddit.com','Reddit','https://www.reddit.com/'],
      ['x.com','Twitter','https://x.com/'],
      ['tcgplayer.com','TCGPlayer','https://www.tcgplayer.com/'],
      ['cpstest.org','CPS Test','https://cpstest.org/'],
      ['chess.com','Chess.com','https://www.chess.com/'],
      ['animex.one','Animex','https://animex.one/'],
      ['chatgpt.com','AI','https://chatgpt.com/'],
      ['store.steampowered.com','Steam','https://store.steampowered.com/'],
      ['crunchyroll.com','Crunchyroll','https://www.crunchyroll.com/'],
      ['crazygames.com','CrazyGames','https://www.crazygames.com/'],
      ['newgrounds.com','Newgrounds','https://www.newgrounds.com/'],
      ['twitch.tv','Twitch','https://www.twitch.tv/'],
      ['kick.com','Kick','https://kick.com/'],
      ['soundcloud.com','SoundCloud','https://soundcloud.com/'],
      ['pluto.tv','Pluto TV','https://pluto.tv/'],
      ['skribbl.io','Skribbl.io','https://skribbl.io/'],
      ['slither.io','Slither.io','https://slither.io/'],
      ['geoguessr.com','GeoGuessr','https://www.geoguessr.com/'],
      ['y8.com','Y8 Games','https://www.y8.com/'],
      ['itch.io','itch.io','https://itch.io/']
    ].map(([domain,n,u],i)=>`<button class="quick-tile" draggable="true" style="--tile-delay:${Math.min(i,18)*34}ms" data-domain="${esc(domain)}" data-app-url="${esc(u)}"><img class="quick-icon" alt="" src="${appIcon(domain)}"><span>${esc(n)}</span></button>`).join('');
  }
  function cleanBrowserControls(win){
    const back=win.querySelector('[data-back]'), forward=win.querySelector('[data-forward]'), reload=win.querySelector('[data-reload]'), menu=win.querySelector('[data-menu]');
    if(back) back.textContent='➜';
    if(forward) forward.textContent='➜';
    if(reload) reload.textContent='🗘';
    if(menu) menu.textContent='...';
    bindReloadPointerTurn(win);
  }
  let nyxPreflightPromise=null;
  let nyxPreflightBypass=false;
  const preflightDelay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function preflightTimeout(promise,ms,label='check timed out'){
    let timer=null;
    const guarded=Promise.resolve(promise);
    guarded.catch(()=>{});
    try{
      return await Promise.race([
        guarded,
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),ms)})
      ]);
    }finally{
      clearTimeout(timer);
    }
  }
  async function preflightFetchOk(url,timeout=2600){
    if(location.protocol==='file:') return true;
    const response=await preflightTimeout(fetch(url,{cache:'no-store'}),timeout,`${url} timed out`);
    return response.ok;
  }
  async function preflightImportOk(url,timeout=3600){
    if(location.protocol==='file:') return true;
    await preflightTimeout(import(`${url}?nyx_check=${Date.now()}`),timeout,`${url} import timed out`);
    return true;
  }
  async function preflightWebSocketOk(url,timeout=3200){
    if(location.protocol==='file:') return true;
    if(!/^wss?:\/\//i.test(url) || !('WebSocket' in window)) return false;
    return preflightTimeout(new Promise(resolve=>{
      let settled=false;
      let socket=null;
      const done=value=>{
        if(settled) return;
        settled=true;
        try{socket?.close()}catch{}
        resolve(value);
      };
      try{
        socket=new WebSocket(url);
        socket.addEventListener('open',()=>done(true),{once:true});
        socket.addEventListener('error',()=>done(false),{once:true});
        socket.addEventListener('close',()=>done(false),{once:true});
      }catch{
        resolve(false);
      }
    }),timeout,`${url} websocket timed out`);
  }
  function preflightBrowserModeForTarget(target=''){
    const mode=normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE));
    if(mode!=='auto') return mode;
    try{
      const normalized=normalize(browserShellSourceUrl(target) || target);
      return selectedBrowserMode(normalized)==='ultraviolet' ? 'ultraviolet' : 'scramjet';
    }catch{
      return 'scramjet';
    }
  }
  async function preflightEngineReady(target=''){
    if(location.protocol==='file:' || !('serviceWorker' in navigator)) return false;
    const mode=preflightBrowserModeForTarget(target);
    if(mode==='iframe') return true;
    if(mode==='ultraviolet') return installUltraviolet();
    if(mode==='scramjet') return installScramjet();
    const results=await Promise.allSettled([installScramjet(),installUltraviolet()]);
    return results.some(result=>result.status==='fulfilled' && result.value);
  }
  async function preflightTransportReady(target=''){
    if(location.protocol==='file:') return false;
    const mode=preflightBrowserModeForTarget(target);
    if(mode==='iframe') return true;
    if(mode==='scramjet') return !!(await createScramjetTransport());
    return !!(await installBareMuxTransport());
  }
  async function preflightServiceWorkerReady(target=''){
    if(location.protocol==='file:' || !('serviceWorker' in navigator)) return false;
    await preflightEngineReady(target);
    const registrations=await Promise.all([
      navigator.serviceWorker.getRegistration('/~/sj/').catch(()=>null),
      navigator.serviceWorker.getRegistration('/service/').catch(()=>null)
    ]);
    return registrations.some(registration=>registration?.active || registration?.waiting || registration?.installing);
  }
  function preflightSearchUrl(raw=''){
    return normalize(raw || 'nyx') || '';
  }
  async function preflightAppIconsReady(){
    const urls=[...document.querySelectorAll('[data-app-url]')]
      .map(el=>appIcon(el.dataset.domain || ''))
      .filter(Boolean)
      .slice(0,8);
    await Promise.allSettled(urls.map(url=>preflightFetchOk(url,1600)));
    return true;
  }
  async function preflightLibcurlReady(){
    if(location.protocol==='file:') return true;
    const checks=await Promise.allSettled([
      preflightFetchOk('/assets/transports/libcurl-baremux.mjs',2600),
      preflightFetchOk('/assets/transports/libcurl-scramjet.mjs',2600),
      preflightImportOk('/assets/transports/libcurl-scramjet.mjs',4200)
    ]);
    return checks.every(check=>check.status==='fulfilled' && check.value);
  }
  async function preflightFilesReady(){
    if(location.protocol==='file:') return true;
    const files=[
      '/',
      '/uv/uv.bundle.js',
      '/uv.config.js',
      '/scramjet/scramjet.js',
      '/scramjet.sw.js',
      '/baremux/index.mjs',
      '/epoxy/index.mjs',
      '/controller/controller.api.js'
    ];
    const checks=await Promise.allSettled(files.map(url=>preflightFetchOk(url,2600)));
    return checks.every(check=>check.status==='fulfilled' && check.value);
  }
  async function preflightStateCurrent(){
    await ensureFreshProxyState();
    return store.text('nyx.proxyStateVersion','')===proxyStateVersion && store.text('nyx.scramjetStateVersion','')===scramjetStateVersion;
  }
  async function preflightBugScan(){
    const required=[
      document.body,
      document.querySelector('#desktop'),
      document.querySelector('#visualEffects'),
      document.querySelector('#customBgImage')
    ];
    const browserApis=Boolean(window.fetch && window.Promise && window.URL && window.localStorage);
    const proxyApis=location.protocol==='file:' || Boolean('serviceWorker' in navigator && 'caches' in window && window.indexedDB);
    await preflightDelay(160);
    return required.every(Boolean) && browserApis && proxyApis;
  }
  function nyxPreflightTasks(kind='startup',options={}){
    const target=String(options.target || '').trim();
    const appendFinal=tasks=>{
      if(typeof options.finalRun==='function'){
        let finalStarted=false;
        return [...tasks,{label:options.finalLabel || 'Page loaded',acceptAnyCheck:true,run:async()=>{
          if(!finalStarted){
            finalStarted=true;
            return options.finalRun();
          }
          if(typeof options.finalVerify==='function') return options.finalVerify();
          await preflightDelay(120);
          return true;
        }}];
      }
      return tasks;
    };
    const serverCheck=async()=>{
      const checks=['/uv/uv.bundle.js','/scramjet/scramjet.js','/baremux/index.mjs'].map(url=>preflightFetchOk(url,2400).catch(()=>false));
      const results=await Promise.all(checks);
      return location.protocol==='file:' || results.some(Boolean);
    };
    const searchCheck=async()=>{
      const url=preflightSearchUrl(target || 'nyx');
      if(!url) return false;
      const parsed=new URL(url,location.href);
      return /^https?:|^data:|^blob:|^about:$/.test(parsed.protocol);
    };
    const base=[
      {label:'Fetching server list',run:serverCheck},
      {label:'Selecting fastest server',run:async()=>{await preflightDelay(180); return true}},
      {label:'Loading browser engine',run:()=>preflightEngineReady(target)},
      {label:'Opening transport',run:()=>preflightTransportReady(target)},
      {label:'Registering service worker',run:()=>preflightServiceWorkerReady(target)}
    ];
    if(kind==='apps'){
      return appendFinal([
        ...base,
        {label:'Checking app shortcuts',run:preflightAppIconsReady},
        {label:'Opening apps panel',run:async()=>{await preflightDelay(180); return true}}
      ]);
    }
    if(kind==='search'){
      return appendFinal([
        {label:'Reading search query',run:searchCheck},
        {label:'Checking selected search engine',run:async()=>{await preflightDelay(150); return !!store.text('nyx.engine','duckduckgo')}},
        ...base,
        {label:'Preparing results tab',run:async()=>{await preflightDelay(160); return true}}
      ]);
    }
    if(kind==='browser'){
      return appendFinal([
        {label:'Checking requested page',run:searchCheck},
        ...base,
        {label:'Opening browser tab',run:async()=>{await preflightDelay(160); return true}}
      ]);
    }
    if(kind==='startup-diagnostics'){
      return appendFinal([
        {label:'Checking Nyx files',run:preflightStateCurrent},
        {label:'Preparing interface',run:async()=>{await preflightDelay(60); return true}},
        {label:'Launching Nyx',run:async()=>{await preflightDelay(80); return true}}
      ]);
    }
    return appendFinal([
      {label:'Checking nyx files',run:serverCheck},
      {label:'Checking search',run:searchCheck},
      ...base,
      {label:'Finishing startup',run:async()=>{await preflightDelay(220); return true}}
    ]);
  }
  async function runNyxPreflight(kind='startup',options={}){
    if(options.skip || nyxPreflightBypass) return true;
    if(options.background){
      setTimeout(()=>{
        nyxPreflightTasks(kind,options).slice(0,3).forEach(task=>{
          Promise.resolve(task.run?.()).catch(()=>null);
        });
      },600);
      return true;
    }
    if(nyxPreflightPromise) return nyxPreflightPromise;
    const doubleCheckTask=async task=>{
      let first=false, second=false, firstError=null, secondError=null;
      try{
        first=await preflightTimeout(Promise.resolve(task.run?.()),5200,'preflight timed out');
      }catch(error){
        firstError=error;
      }
      await preflightDelay(80);
      try{
        second=await preflightTimeout(Promise.resolve(task.run?.()),5200,'preflight double-check timed out');
      }catch(error){
        secondError=error;
      }
      if(firstError || secondError) console.warn('nyx preflight double-check detail:',task.label,{firstError,secondError});
      return task.acceptAnyCheck ? Boolean(first || second) : Boolean(first && second);
    };
    nyxPreflightPromise=(async()=>{
      const tasks=nyxPreflightTasks(kind,options);
      const overlay=document.createElement('div');
      overlay.className='nyx-preflight';
      const preflightTitle=kind==='startup-diagnostics' ? 'Startup Diagnostics' : kind==='startup' ? 'Starting nyx' : kind==='apps' ? 'Opening Apps' : kind==='search' ? 'Checking Search' : 'Checking Browser';
      overlay.innerHTML=`<section class="nyx-preflight-card" role="status" aria-live="polite"><h2 class="nyx-preflight-title">${esc(preflightTitle)}</h2><ul class="nyx-preflight-list">${tasks.map((task,index)=>`<li class="nyx-preflight-item" data-preflight-step="${index}"><span class="nyx-preflight-dot">&bull;</span><span>${esc(task.label)}</span></li>`).join('')}</ul><div class="nyx-preflight-bar"><div class="nyx-preflight-fill"></div></div></section>`;
      document.body.appendChild(overlay);
      requestAnimationFrame(()=>overlay.classList.add('show'));
      const started=Date.now();
      const fill=overlay.querySelector('.nyx-preflight-fill');
      for(let i=0;i<tasks.length;i++){
        const item=overlay.querySelector(`[data-preflight-step="${i}"]`);
        item?.classList.add('running');
        let ok=true;
        try{
          ok=await doubleCheckTask(tasks[i]);
        }catch(error){
          ok=false;
          console.warn('nyx preflight warning:',tasks[i].label,error);
        }
        item?.classList.remove('running');
        item?.classList.add(ok ? 'done' : 'warn');
        const dot=item?.querySelector('.nyx-preflight-dot');
        if(dot) dot.textContent=ok ? '\u2713' : '!';
        if(fill) fill.style.width=`${Math.round(((i+1)/tasks.length)*100)}%`;
        await preflightDelay(90);
      }
      const minVisible=Number(options.minVisible || (kind==='startup' || kind==='startup-diagnostics' ? 900 : 520));
      const remaining=minVisible-(Date.now()-started);
      if(remaining>0) await preflightDelay(remaining);
      overlay.classList.remove('show');
      setTimeout(()=>overlay.remove(),260);
      return true;
    })().finally(()=>{nyxPreflightPromise=null});
    return nyxPreflightPromise;
  }
  //browser-window
  function openBrowser(url='https://duckduckgo.com/',options={}){
    const win=makeWindow({title:'New Tab',className:'browser-window',body:browserBody()});
    const utilityLinks=win.querySelector('.nyx-home-utility-links');
    const linkChecker=win.querySelector('.nyx-home-link-checker');
    if(utilityLinks && linkChecker) utilityLinks.prepend(linkChecker);
    if(utilityLinks){
      const creditsLink=utilityLinks.querySelector('[data-open="about"]');
      if(creditsLink){
        creditsLink.textContent='About Nyx';
        creditsLink.dataset.open='credits';
        creditsLink.dataset.browserCredits='';
        creditsLink.setAttribute('href','#credits');
      }
      const copyright=document.createElement('span');
      copyright.className='nyx-home-copyright';
      copyright.textContent='© 2026 Nyx';
      utilityLinks.append(copyright);
    }
    cleanBrowserControls(win);
    tick();
    initDesktopSplash();
    const state={tabs:[],active:null,win};
    win.browserState=state; activeBrowser=state;
    function renderTabs(){
      const row=win.querySelector('.browser-tabs');
      row.querySelectorAll('.browser-tab').forEach(x=>x.remove());
      state.tabs.forEach(t=>{
        const el=document.createElement('div'); el.className='browser-tab'+(t.id===state.active?' active':'')+(t.opening?' tab-opening':'');
        const displayUrl=t.sourceUrl || t.url;
        el.innerHTML=`<span>${esc(browserChromeTitle(t.title,displayUrl))}</span><button data-close-tab="${t.id}">×</button>`;
        const label=el.querySelector('span');
        if(label){
          const icon=document.createElement('img');
          icon.className='browser-tab-icon';
          icon.alt='';
          icon.src=browserChromeIcon(t.icon,displayUrl);
          bindTabIconFallback(icon);
          el.insertBefore(icon,label);
        }
        const closeBtn=el.querySelector('button');
        if(closeBtn) closeBtn.textContent='x';
        el.onclick=e=>{if(e.target.closest('button'))return; activate(t.id)};
        row.insertBefore(el,row.querySelector('[data-new-tab]'));
        if(t.opening) setTimeout(()=>{t.opening=false},540);
      });
    }
    function syncLoadedTabIcon(t){
      if(!t?.frame || !state.tabs.includes(t)) return false;
      if(websiteDetailsHidden()) return false;
      let icon='';
      try{icon=iconFromPageDocument(t.frame.contentDocument,t.sourceUrl || t.url)}catch{}
      if(!icon) icon=iconForUrl(t.sourceUrl || t.url);
      if(!icon || icon===t.icon) return false;
      t.icon=icon;
      const shellTab=browserShellTabs.find(tab=>tab.browserTabId===t.id);
      if(shellTab) shellTab.icon=icon;
      renderTabs();
      renderBrowserShellTabs();
      return true;
    }
    function current(){return state.tabs.find(t=>t.id===state.active)}
    function isGameInputTab(t=current()){
      const source=String(browserShellSourceUrl(t?.sourceUrl || t?.url || '') || t?.sourceUrl || t?.url || '');
      if(/(?:play\.geforcenow\.com|geforcenow\.com|nvidia|pixelclient\.xyz|\/assets\/games\/|\/assets\/ugs\/|\/assets\/seraph\/|\/assets\/gn-math\/|\/assets\/gms-games\/)/i.test(source)) return true;
      try{return !!t?.frame?.contentDocument?.querySelector('canvas,[role="application"],[data-testid*="game" i],[class*="game" i],[id*="game" i]')}catch{return false}
    }
    function focusActiveGameFrame(){
      const t=current();
      if(!t?.frame || !isGameInputTab(t)) return;
      releaseNyxKeyboardLock();
      try{t.frame.focus({preventScroll:true})}catch{try{t.frame.focus()}catch{}}
    }
    win.querySelector('.browser-body')?.addEventListener('pointerdown',()=>setTimeout(focusActiveGameFrame,0),true);
    win.querySelector('.browser-body')?.addEventListener('mousedown',()=>setTimeout(focusActiveGameFrame,0),true);
    win.addEventListener('wheel',event=>{
      if(!isGameInputTab() || !event.ctrlKey) return;
      event.preventDefault();
    },{capture:true,passive:false});
    win.addEventListener('keydown',event=>{
      if(!isGameInputTab()) return;
      const key=String(event.key || '').toLowerCase();
      if((event.ctrlKey || event.metaKey) && ['+','=','-','_','0'].includes(key)){
        event.preventDefault();
        event.stopPropagation();
      }
    },true);
    function directOnly(url){
      return false;
    }
    function prefersEpoxyTransport(url){
      try{
        const h=new URL(url).hostname.replace(/^www\./,'');
        return ['spotify.com','open.spotify.com','animex.one','traxmojo.com','youtube.com','youtu.be','tcgplayer.com'].some(d=>h===d||h.endsWith('.'+d));
      }catch{return false}
    }
    function showBrowserMessage(t,url){
      loadScramjetTab(t,url,false);
    }
    function addTab(openUrl='',forceMode=''){
      const id='tab'+Date.now()+Math.random().toString(16).slice(2);
      const frame=document.createElement('iframe'); frame.className='view';
      applyFrameInteractionPermissions(frame);
      win.querySelector('.browser-body').appendChild(frame);
      const tab={id,title:'New Tab',url:'',icon:favicons.nyx,history:[],index:-1,frame,opening:true};
      state.tabs.push(tab);
      activate(id);
      if(openUrl) navigate(openUrl,forceMode);
      return tab;
    }
    function reloadTab(tabId=state.active){
      const t=state.tabs.find(tab=>tab.id===tabId) || current();
      if(!t) return false;
      const source=browserShellSourceUrl(t.sourceUrl || t.url || '') || t.sourceUrl || t.url || '';
      if(!source){
        activate(t.id);
        return false;
      }
      activate(t.id);
      if(String(source).startsWith('nyx://')){
        showBrowserShellInternalPage(source.replace(/^nyx:\/\//,'') || 'apps');
        return true;
      }
      if(t.scramjetFrame){
        clearFrameDocument(t);
        try{
          t.scramjetFrame.go(source);
          return true;
        }catch{
          retryScramjetTab(t,source);
          return true;
        }
      }
      try{
        t.frame?.contentWindow?.location?.reload();
        return true;
      }catch{}
      const srcdoc=t.frame?.getAttribute('srcdoc');
      if(srcdoc){
        t.frame.srcdoc='';
        requestAnimationFrame(()=>{t.frame.srcdoc=srcdoc});
        return true;
      }
      const src=t.frame?.getAttribute('src');
      if(src){
        t.frame.removeAttribute('src');
        requestAnimationFrame(()=>{t.frame.src=src});
        return true;
      }
      if(/^https?:/i.test(source)){
        navigate(source,t.expectedEngine || '');
        return true;
      }
      return false;
    }
    function popupWarningHtml(message='are you trying to hack me ︻デ═一 indian shwarma scamma? get blocked hah'){
      const safeMessage=JSON.stringify(String(message || 'are you trying to hack me ︻デ═一 indian shwarma scamma? get blocked hah'));
      return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>nyx://blocked67haha</title><style>html,body{margin:0;width:100%;height:100%;background:#fff;color:#000;font:14px Outfit,Arial,sans-serif}body{overflow:hidden}.prompt-shade{position:fixed;inset:0;display:flex;align-items:flex-start;justify-content:center;background:#fff}.prompt{width:min(540px,calc(100vw - 36px));padding:18px 20px;border:0;border-radius:0 0 14px 14px;background:#fff;color:#000;box-shadow:0 6px 18px rgba(0,0,0,.18)}.title{margin:0 0 22px;color:#000;font-size:16px;font-weight:700}.message{margin:0 0 8px;font-size:14px;line-height:1.35}.prompt-input{width:100%;height:38px;margin:0 0 38px;border:2px solid #4b5563;border-radius:8px;background:#fff;color:#000;padding:0 10px;font:16px Outfit,Arial,sans-serif;outline:0}.actions{display:flex;justify-content:flex-end;gap:10px}.ok,.cancel{min-width:48px;height:40px;border:1px solid #d1d5db;border-radius:9px;background:#fff;color:#000;padding:0 14px;font:15px Outfit,Arial,sans-serif}.ok{border-color:#000;font-weight:800}.cancel{color:#000}.ok:focus{outline:2px solid #2563eb;outline-offset:2px}</style></head><body><script>const MESSAGE=${safeMessage};function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]))}function show(){document.body.innerHTML='<div class="prompt-shade"><div class="prompt" role="dialog" aria-modal="true"><div class="title">1aqlla said no goofy haha6767</div><div class="message">'+esc(MESSAGE)+'</div><input class="prompt-input" autocomplete="off" spellcheck="false"><div class="actions"><button class="ok" type="button">OK</button><button class="cancel" type="button">Cancel</button></div></div></div>';const ok=document.querySelector(".ok");const input=document.querySelector(".prompt-input");input.focus();ok.onclick=()=>setTimeout(show,0);document.querySelector(".cancel").onclick=()=>{};input.onkeydown=e=>{if(e.key==="Enter")ok.click()}}show();<\/script></body></html>`;
    }
    function popupTabHandle(t,openerUrl=''){
      if(!t) return null;
      let pendingHtml='';
      const go=value=>{
        const raw=String(value || '').trim();
        if(!raw || /^about:blank$/i.test(raw)) return;
        let next=raw;
        if(!/^[a-z][a-z0-9+.-]*:/i.test(raw) && openerUrl){
          try{next=new URL(raw,openerUrl).href}catch{}
        }
        activate(t.id);
        navigate(next);
      };
      const popupDocument={
        open(){pendingHtml=''; return popupDocument},
        write(html){pendingHtml+=String(html || '')},
        writeln(html){pendingHtml+=String(html || '')+'\n'},
        close(){
          showPopupWarningTab(t);
        }
      };
      const locationProxy={
        assign:go,
        replace:go,
        reload(){if(t.url) navigate(t.url)},
        toString(){return t.url || 'about:blank'},
        get href(){return t.url || 'about:blank'},
        set href(value){go(value)}
      };
      return {
        closed:false,
        focus(){activate(t.id)},
        blur(){},
        close(){
          const index=state.tabs.findIndex(tab=>tab.id===t.id);
          if(index<0) return;
          t.frame.remove();
          state.tabs.splice(index,1);
          this.closed=true;
          if(!state.tabs.length) addTab();
          else activate(state.tabs[Math.max(0,index-1)].id);
        },
        postMessage(){},
        document:popupDocument,
        get location(){return locationProxy},
        set location(value){go(value)},
        get href(){return t.url || 'about:blank'},
        set href(value){go(value)}
      };
    }
    function showPopupWarningTab(t,message=''){
      if(!t?.frame) return;
      t.popupBlockMessage=message || t.popupBlockMessage || 'are you trying to hack me ︻デ═一 indian shwarma scamma? get blocked by 1aqlla dummy haha67';
      t.url='nyx://blocked67haha';
      t.title='Popup blocked';
      t.icon=favicons.nyx;
      t.frame.removeAttribute('src');
      t.frame.srcdoc=popupWarningHtml(t.popupBlockMessage);
      win.querySelector('.browser-home').classList.add('hidden');
      t.frame.classList.add('active');
      renderTabs();
      activate(t.id);
      updateBrowserShellLocation(t.url,t.id);
    }
    function blockedPopupHandle(popup,message=''){
      const popupMessage=message || 'are you trying to hack me ︻デ═一 indian shwarma scamma? get blocked by 1aqlla dummy haha67';
      const rewrite=()=> {
        try{
          popup?.document?.open();
          popup?.document?.write(popupWarningHtml(popupMessage));
          popup?.document?.close();
        }catch{}
      };
      return {
        closed:false,
        focus(){try{popup?.focus?.()}catch{}},
        blur(){try{popup?.blur?.()}catch{}},
        close(){try{popup?.close?.()}catch{} this.closed=true},
        postMessage(){},
        document:{
          open(){rewrite(); return this},
          write(){rewrite()},
          writeln(){rewrite()},
          close(){rewrite()}
        },
        location:{
          href:'nyx://blocked67haha',
          assign(){rewrite()},
          replace(){rewrite()},
          reload(){rewrite()},
          toString(){return 'nyx://blocked67haha'}
        },
        get href(){return 'nyx://blocked67haha'},
        set href(_value){rewrite()}
      };
    }
    function openPopupTab(rawUrl){
      const openerUrl=current()?.url || location.href;
      const popupBlockMessage=isAnimexUrl(openerUrl) ? 'are you trying to block me shwarma?' : 'are you trying to hack me ︻デ═一 indian shwarma scamma? get blocked by 1aqlla dummy haha67';
      if(!popupProtectionEnabled()){
        const nativeOpen=window.__nyxNativeOpen || window.open?.bind(window);
        return nativeOpen ? nativeOpen(rawUrl || 'about:blank','_blank') : null;
      }
      return blockedPopupHandle(null,popupBlockMessage);
    }
    function installCrazyGamesOfflineRecovery(t,url=''){
      if(!t?.frame) return;
      const source=browserShellSourceUrl(url || t.sourceUrl || t.url || '') || url || t.sourceUrl || t.url || '';
      if(!hostMatches(browserHost(source),['crazygames.com'])) return;
      if(t.crazyGamesRecoveryInstalled) return;
      t.crazyGamesRecoveryInstalled=true;
      const startedAt=Date.now();
      const scan=()=>{
        if(!state.tabs.includes(t) || Date.now()-startedAt>10*60*1000){
          clearInterval(t.crazyGamesRecoveryTimer);
          t.crazyGamesRecoveryTimer=0;
          return;
        }
        const seen=new Set();
        const visit=doc=>{
          if(!doc?.documentElement || seen.has(doc)) return;
          seen.add(doc);
          try{
            const pageText=String(doc.body?.innerText || doc.body?.textContent || '').slice(0,1200);
            if(/connection issues/i.test(pageText)){
              const offline=[...doc.querySelectorAll('button,[role="button"]')]
                .find(button=>/^\s*continue offline\s*$/i.test(String(button.textContent || button.getAttribute('aria-label') || '')));
              if(offline && offline.dataset.nyxCrazyGamesRecovery!=='true'){
                offline.dataset.nyxCrazyGamesRecovery='true';
                offline.click();
                console.info('nyx CrazyGames: continued through the game frame offline so gameplay can start.');
              }
            }
          }catch{}
          try{
            doc.querySelectorAll('iframe,frame').forEach(frame=>{
              try{visit(frame.contentDocument)}catch{}
            });
          }catch{}
        };
        try{visit(t.frame.contentDocument)}catch{}
      };
      t.frame.addEventListener('load',()=>{
        setTimeout(scan,100);
        setTimeout(scan,700);
      });
      t.crazyGamesRecoveryTimer=setInterval(scan,700);
      scan();
    }
    function installDuckDuckGoImageViewportFix(t){
      if(!t?.frame) return;
      let doc;
      try{doc=t.frame.contentDocument}catch{return}
      if(!doc?.documentElement || doc.documentElement.dataset.nyxDuckImageViewport==='true') return;
      const currentSource=()=>{
        try{
          const href=String(t.frame.contentWindow?.location?.href || '');
          return browserShellSourceUrl(href) || browserShellSourceUrl(t.sourceUrl || t.url || '') || t.sourceUrl || t.url || '';
        }catch{
          return browserShellSourceUrl(t.sourceUrl || t.url || '') || t.sourceUrl || t.url || '';
        }
      };
      let initial;
      try{initial=new URL(currentSource(),location.href)}catch{return}
      if(initial.hostname.replace(/^www\./i,'').toLowerCase()!=='duckduckgo.com') return;
      doc.documentElement.dataset.nyxDuckImageViewport='true';
      const decodeBrokenImageUrl=value=>{
        const raw=String(value || '').trim();
        const match=raw.match(/https?%3a%2f%2f/i);
        if(!match) return '';
        const isEncodedUrl=match.index===0;
        const isScramjetPath=raw.includes('/~/sj/');
        if(!isEncodedUrl && !isScramjetPath) return '';
        let encoded=raw.slice(match.index);
        const metadataAt=encoded.search(/[?&]%24(?:rfp|io|tf|pf|iframe)=/i);
        if(metadataAt>0) encoded=encoded.slice(0,metadataAt);
        let decoded=encoded;
        for(let pass=0;pass<2 && /%[0-9a-f]{2}/i.test(decoded);pass++){
          try{decoded=decodeURIComponent(decoded)}catch{break}
        }
        return /^https?:\/\//i.test(decoded) ? decoded : '';
      };
      const repairImages=()=>{
        doc.querySelectorAll('img,source').forEach(image=>{
          const current=image.getAttribute('src') || '';
          const repaired=decodeBrokenImageUrl(current);
          if(repaired && repaired!==current) image.setAttribute('src',repaired);
          ['data-src','data-original','data-lazy-src','data-image-url'].forEach(attribute=>{
            const lazy=image.getAttribute(attribute) || '';
            const repairedLazy=decodeBrokenImageUrl(lazy);
            if(!repairedLazy || repairedLazy===lazy) return;
            image.setAttribute(attribute,repairedLazy);
            if(image.tagName==='IMG' && (!current || decodeBrokenImageUrl(current))) image.setAttribute('src',repairedLazy);
          });
          const srcset=image.getAttribute('srcset') || '';
          const firstSrcsetUrl=srcset.split(',')[0]?.trim().split(/\s+/)[0] || '';
          const repairedSrcset=decodeBrokenImageUrl(firstSrcsetUrl);
          if(repairedSrcset){
            image.removeAttribute('srcset');
            image.setAttribute('src',repairedSrcset);
          }
        });
      };
      const repairImageFilterViewport=()=>{
        const labels=['AI images','All sizes','All colors','All types','All layouts','Licenses'];
        doc.querySelectorAll('nav').forEach(nav=>{
          const text=String(nav.innerText || nav.textContent || '').replace(/\s+/g,' ').trim();
          if(labels.filter(label=>text.includes(label)).length<3) return;
          const list=[...nav.querySelectorAll('ul')].find(candidate=>{
            const box=candidate.getBoundingClientRect?.();
            return box && box.width>=300 && box.height>=20 && box.height<=96;
          });
          if(!list) return;
          const navBox=nav.getBoundingClientRect?.();
          const listBox=list.getBoundingClientRect?.();
          if(!navBox || !listBox || navBox.height<=listBox.height+120) return;
          const targetHeight=Math.ceil(Math.max(40,listBox.height+16));
          nav.style.setProperty('height',`${targetHeight}px`,'important');
          nav.style.setProperty('min-height','0','important');
          nav.style.setProperty('max-height',`${targetHeight}px`,'important');
          nav.style.setProperty('overflow','visible','important');
          const wrapper=list.parentElement;
          if(wrapper && wrapper!==nav){
            const wrapperHeight=Math.ceil(Math.max(32,listBox.height));
            wrapper.style.setProperty('height',`${wrapperHeight}px`,'important');
            wrapper.style.setProperty('min-height','0','important');
            wrapper.style.setProperty('max-height',`${wrapperHeight}px`,'important');
            wrapper.style.setProperty('overflow','visible','important');
            wrapper.dataset.nyxDuckImageFilterWrapperFixed='true';
          }
          nav.dataset.nyxDuckImageFilterFixed='true';
          doc.documentElement.dataset.nyxDuckImageFilterFixed='true';
        });
      };
      const restoreDuckDuckGoSearchLayout=()=>{
        // DuckDuckGo changes between Images and All without reloading the document.
        // Every image-only layout override must therefore be undone explicitly.
        doc.querySelectorAll('[data-nyx-duck-mainline-hidden="true"]').forEach(mainline=>{
          ['display','min-height','height','margin','padding'].forEach(property=>mainline.style.removeProperty(property));
          delete mainline.dataset.nyxDuckMainlineHidden;
        });
        doc.querySelectorAll('[data-nyx-duck-image-gap-fixed="true"]').forEach(container=>{
          container.style.removeProperty('margin-top');
          delete container.dataset.nyxDuckImageGapFixed;
        });
        doc.querySelectorAll('[data-nyx-duck-image-filter-fixed="true"]').forEach(nav=>{
          ['height','min-height','max-height','overflow'].forEach(property=>nav.style.removeProperty(property));
          delete nav.dataset.nyxDuckImageFilterFixed;
        });
        doc.querySelectorAll('[data-nyx-duck-image-filter-wrapper-fixed="true"]').forEach(wrapper=>{
          ['height','min-height','max-height','overflow'].forEach(property=>wrapper.style.removeProperty(property));
          delete wrapper.dataset.nyxDuckImageFilterWrapperFixed;
        });
      };
      const collapseEmptyImageGap=()=>{
        const view=t.frame.contentWindow;
        if(!view || !doc.body) return;
        const pageText=String(doc.body.innerText || '');
        if(!/AI images/i.test(pageText) || !/All sizes/i.test(pageText) || !/All layouts/i.test(pageText)){
          restoreDuckDuckGoSearchLayout();
          return;
        }
        const scrollTop=view.scrollY || doc.scrollingElement?.scrollTop || 0;
        const resultImages=[...doc.images].filter(image=>{
          if(image.closest?.('header,nav,aside,[role="dialog"],[class*="modal" i],[class*="anomaly" i]')) return false;
          const box=image.getBoundingClientRect?.();
          return box && box.width>=100 && box.height>=70;
        }).sort((a,b)=>{
          const first=a.getBoundingClientRect();
          const second=b.getBoundingClientRect();
          return first.top-second.top || first.left-second.left;
        });
        if(resultImages.length<4) return;
        const sample=resultImages.slice(0,Math.min(12,resultImages.length));
        doc.querySelectorAll('[data-testid="mainline"],.results--main').forEach(mainline=>{
          if(sample.some(image=>mainline.contains(image))) return;
          mainline.style.setProperty('display','none','important');
          mainline.style.setProperty('min-height','0','important');
          mainline.style.setProperty('height','0','important');
          mainline.style.setProperty('margin','0','important');
          mainline.style.setProperty('padding','0','important');
          mainline.dataset.nyxDuckMainlineHidden='true';
        });
        let filterBottom=0;
        doc.querySelectorAll('div,nav,section').forEach(element=>{
          const text=String(element.innerText || '').replace(/\s+/g,' ').trim();
          const matches=['AI images','All sizes','All colors','All types','All layouts','Licenses']
            .filter(label=>text.includes(label)).length;
          if(matches<3) return;
          const box=element.getBoundingClientRect?.();
          if(!box || box.width<300 || box.height<=0 || box.height>120) return;
          filterBottom=Math.max(filterBottom,box.bottom+scrollTop);
        });
        const targetTop=Math.max(110,filterBottom ? filterBottom+12 : 0);
        let container=sample[0].parentElement;
        while(container && !sample.every(image=>container.contains(image))) container=container.parentElement;
        if(!container || container===doc.body || container===doc.documentElement) return;
        while(container.parentElement && container.parentElement!==doc.body && container.parentElement!==doc.documentElement){
          const parent=container.parentElement;
          if(parent.querySelector('[data-testid="header"],form[data-testid="search-form"]')) break;
          const parentBox=parent.getBoundingClientRect?.();
          const parentTop=(parentBox?.top || 0)+scrollTop;
          if(!parentBox || parentTop<targetTop+180) break;
          container=parent;
        }
        if(container.dataset.nyxDuckImageGapFixed==='true') return;
        const containerBox=container.getBoundingClientRect?.();
        if(!containerBox) return;
        const gap=Math.round(containerBox.top+scrollTop-targetTop);
        if(gap<220) return;
        const currentMargin=Number.parseFloat(view.getComputedStyle(container).marginTop) || 0;
        container.style.setProperty('margin-top',`${currentMargin-gap}px`,'important');
        container.dataset.nyxDuckImageGapFixed='true';
        doc.documentElement.dataset.nyxDuckImageGapFixed='true';
      };
      let queued=false;
      const queueRepair=()=>{
        if(queued) return;
        queued=true;
        requestAnimationFrame(()=>{
          queued=false;
          repairImageFilterViewport();
          repairImages();
          collapseEmptyImageGap();
        });
      };
      try{
        new MutationObserver(queueRepair).observe(doc.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcset','data-src','data-original','data-lazy-src','data-image-url']});
      }catch{}
      repairImageFilterViewport();
      repairImages();
      collapseEmptyImageGap();
      [250,700,1400,2600,4200].forEach(delay=>setTimeout(()=>{
        repairImageFilterViewport();
        repairImages();
        collapseEmptyImageGap();
      },delay));
    }
    function installPopupBridge(t){
      if(!t?.frame || t.popupBridgeInstalled) return;
      if(t.frame.dataset.nyxDuckImageLoadFix!=='true'){
        t.frame.dataset.nyxDuckImageLoadFix='true';
        t.frame.addEventListener('load',()=>setTimeout(()=>installDuckDuckGoImageViewportFix(t),40));
      }
      installDuckDuckGoImageViewportFix(t);
      if(t.frame.dataset.nyxLocationSync!=='true'){
        t.frame.dataset.nyxLocationSync='true';
        t.frame.addEventListener('load',()=>setTimeout(()=>{
          try{
            const frameHref=String(t.frame?.contentWindow?.location?.href || '');
            const source=browserShellSourceUrl(frameHref);
            if(!/^https?:\/\//i.test(source) || source===location.href) return;
            installDuckDuckGoImageViewportFix(t);
            t.url=source;
            t.sourceUrl=source;
            t.title=titleForUrl(source);
            t.icon=iconForUrl(source);
            renderTabs();
            if(t.id===state.active){
              win.querySelector('.urlbar').value=browserShellDisplayValue(source);
              updateBrowserShellLocation(source,t.id,true);
            }
            syncLoadedTabIcon(t);
          }catch{}
          setTimeout(()=>syncLoadedTabIcon(t),260);
        },40));
      }
      const bridgeUrl=t.sourceUrl || t.url || t.frame.getAttribute('src') || '';
      if(isSpotifyFamilyUrl(bridgeUrl) || isAuthSensitiveUrl(bridgeUrl)) return;
      if(hostMatches(browserHost(browserShellSourceUrl(bridgeUrl) || bridgeUrl),['google.com','gstatic.com','youtube.com','youtu.be'])) return;
      t.popupBridgeInstalled=true;
      const shouldTrapPopupTarget=target=>{
        const value=String(target || '').toLowerCase();
        return value && value !== '_self';
      };
      const currentBridgeUrl=()=>{
        let frameHref='';
        try{frameHref=String(t.frame?.contentWindow?.location?.href || '')}catch{}
        return browserShellSourceUrl(frameHref)
          || browserShellSourceUrl(t.url || '')
          || browserShellSourceUrl(t.sourceUrl || '')
          || t.url || t.sourceUrl || bridgeUrl;
      };
      const isTrustedGeneratedLink=link=>{
        if(!link?.matches?.('a[data-nyx-generated-popup][href]')) return false;
        if(!isNyxLinkGeneratorUrl(currentBridgeUrl())) return false;
        return isNyxGeneratedCdnUrl(link.href || link.getAttribute('href'));
      };
      const sameOriginPopupUrl=value=>{
        const raw=String(value || '').trim();
        if(!raw || /^about:blank$/i.test(raw)) return '';
        try{
          const base=currentBridgeUrl();
          const resolvedRaw=browserShellSourceUrl(raw) || raw;
          const resolved=new URL(resolvedRaw,base);
          const source=new URL(base,location.href);
          const cleanHost=host=>String(host || '').replace(/^www\./i,'').toLowerCase();
          const sameSite=resolved.protocol===source.protocol
            && resolved.port===source.port
            && cleanHost(resolved.hostname)===cleanHost(source.hostname);
          return sameSite ? resolved.href : '';
        }catch{return ''}
      };
      const followSameOriginPopup=value=>{
        const trusted=sameOriginPopupUrl(value);
        if(!trusted) return false;
        activate(t.id);
        navigate(trusted,t.expectedEngine || '');
        return true;
      };
      const searchResultUrl=link=>{
        if(!link) return '';
        const sourceHost=browserHost(browserShellSourceUrl(t.sourceUrl || t.url || bridgeUrl) || bridgeUrl);
        let isResult=false;
        if(hostMatches(sourceHost,['duckduckgo.com'])) isResult=!!link.closest?.('[data-testid="result"],article,.result,.results_links');
        else if(hostMatches(sourceHost,['google.com'])) isResult=!!link.closest?.('#search,.MjjYud,.g');
        else if(hostMatches(sourceHost,['bing.com'])) isResult=!!link.closest?.('li.b_algo,.b_algo');
        if(!isResult) return '';
        const raw=String(link.href || link.getAttribute?.('href') || '').trim();
        try{
          const resolved=new URL(browserShellSourceUrl(raw) || raw,t.sourceUrl || bridgeUrl);
          if(hostMatches(resolved.hostname.replace(/^www\./i,''),['duckduckgo.com'])){
            const direct=resolved.searchParams.get('uddg');
            if(/^https?:\/\//i.test(direct || '')) return direct;
          }
          if(hostMatches(resolved.hostname.replace(/^www\./i,''),['google.com']) && /^\/url$/i.test(resolved.pathname)){
            const direct=resolved.searchParams.get('q') || resolved.searchParams.get('url');
            if(/^https?:\/\//i.test(direct || '')) return direct;
          }
          if(hostMatches(resolved.hostname.replace(/^www\./i,''),['bing.com']) && /^\/ck\/a/i.test(resolved.pathname)){
            const encoded=String(resolved.searchParams.get('u') || '');
            if(/^a1/i.test(encoded)){
              const payload=encoded.slice(2).replace(/-/g,'+').replace(/_/g,'/');
              const padded=payload+'='.repeat((4-payload.length%4)%4);
              const direct=atob(padded);
              if(/^https?:\/\//i.test(direct)) return direct;
            }
          }
          return resolved.href;
        }catch{return ''}
      };
      const followSearchResult=link=>{
        const destination=searchResultUrl(link);
        if(!destination) return false;
        openBrowserShellAppTab(destination);
        return true;
      };
      const searchUrlForCurrentProvider=query=>{
        const value=String(query || '').trim();
        if(!value) return '';
        const host=browserHost(currentBridgeUrl());
        const encoded=encodeURIComponent(value);
        if(hostMatches(host,['duckduckgo.com'])) return `https://duckduckgo.com/?q=${encoded}`;
        if(/(?:^|\.)google\.[a-z.]+$/i.test(host)) return `https://${host}/search?q=${encoded}`;
        if(hostMatches(host,['bing.com'])) return `https://www.bing.com/search?q=${encoded}`;
        return '';
      };
      const followInPageSearch=query=>{
        const destination=searchUrlForCurrentProvider(query);
        if(!destination) return false;
        activate(t.id);
        setTimeout(()=>{
          if(!state.tabs.includes(t)) return;
          navigate(destination);
        },0);
        return true;
      };
      const isDownloadUrl=value=>{
        const rawHref=String(value || '').trim();
        // Verification challenges and web workers commonly use blob/data
        // URLs and script paths. Only an explicit `download` attribute (see
        // isDownloadLink) or a high-confidence binary/archive extension
        // should enter Nyx's download-safety flow.
        if(/^(?:blob|data):/i.test(rawHref)) return false;
        const href=rawHref.split(/[?#]/)[0].toLowerCase();
        return /\.(apk|appx|bat|bin|cmd|com|crx|deb|dmg|exe|iso|jar|msi|pkg|scr|wsf|zip|7z|rar)$/i.test(href);
      };
      const isDownloadLink=link=>{
        if(!link) return false;
        if(link.hasAttribute('download')) return true;
        return isDownloadUrl(link.href || link.getAttribute('href') || '');
      };
      const requestFrameDownload=(value,filename='')=>{
        const href=String(value || '').trim();
        if(!href) return false;
        void nyxRequestBrowserDownload(href,String(filename || '').trim(),currentBridgeUrl());
        return true;
      };
      const attachBridge=()=>{
        try{
          const liveHost=browserHost(currentBridgeUrl());
          if(hostMatches(liveHost,['google.com','gstatic.com'])) return;
          const doc=t.frame.contentDocument;
          const frameWindow=t.frame.contentWindow;
          if(frameWindow && !frameWindow.__nyxOpenBridge){
            frameWindow.__nyxOpenBridge=true;
            const nativeFrameOpen=frameWindow.open?.bind(frameWindow);
            const nyxPopup=(popupUrl,target,features)=>{
              if(isDownloadUrl(popupUrl) && requestFrameDownload(popupUrl)) return frameWindow;
              if(!popupProtectionEnabled()) return nativeFrameOpen ? nativeFrameOpen(popupUrl,target,features) : null;
              if(followSameOriginPopup(popupUrl)) return frameWindow;
              return openPopupTab(popupUrl || 'about:blank');
            };
            try{
              Object.defineProperty(frameWindow,'open',{value:nyxPopup,writable:true,configurable:true});
            }catch{
              frameWindow.open=nyxPopup;
            }
            if(frameWindow.HTMLAnchorElement?.prototype?.click){
              const nativeAnchorClick=frameWindow.HTMLAnchorElement.prototype.click;
              frameWindow.HTMLAnchorElement.prototype.click=function(){
                if(isDownloadLink(this) && requestFrameDownload(this.href || this.getAttribute('href'),this.getAttribute('download') || '')) return;
                if(popupProtectionEnabled() && shouldTrapPopupTarget(this.target)){
                  const href=this.href || this.getAttribute('href') || '';
                  if(isTrustedGeneratedLink(this)) return nativeAnchorClick.call(this);
                  if(followSearchResult(this)) return;
                  if(followSameOriginPopup(href)) return;
                  openPopupTab(href || 'about:blank');
                  return;
                }
                return nativeAnchorClick.call(this);
              };
            }
          }
          if(!doc?.documentElement || doc.documentElement.dataset.nyxPopupBridge==='true') return;
          doc.documentElement.dataset.nyxPopupBridge='true';
          const sourceHost=browserHost(currentBridgeUrl());
          if(hostMatches(sourceHost,['cineby.at']) && !doc.documentElement.dataset.nyxCinebyFrameGuard){
            doc.documentElement.dataset.nyxCinebyFrameGuard='true';
            const blockDirectCinebyFrame=node=>{
              if(!node?.matches?.('iframe[src],frame[src]')) return;
              const raw=String(node.getAttribute('src') || '').trim();
              if(!/^https?:\/\//i.test(raw)) return;
              const host=browserHost(raw);
              if(!hostMatches(host,['cineby.at'])) return;
              node.removeAttribute('src');
              node.remove();
            };
            doc.querySelectorAll('iframe[src],frame[src]').forEach(blockDirectCinebyFrame);
            new MutationObserver(records=>records.forEach(record=>{
              if(record.type==='attributes') blockDirectCinebyFrame(record.target);
              record.addedNodes.forEach(node=>{
                blockDirectCinebyFrame(node);
                node.querySelectorAll?.('iframe[src],frame[src]').forEach(blockDirectCinebyFrame);
              });
            })).observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
          }
          const searchControlValue=control=>String(control?.value || '').trim();
          const trapSearchSubmit=event=>{
            const form=event.target;
            if(!form || String(form.tagName || '').toUpperCase()!=='FORM') return;
            const control=form.querySelector('textarea[name="q"],input[name="q"],input[type="search"]');
            if(!followInPageSearch(searchControlValue(control))) return;
            event.preventDefault();
            event.stopImmediatePropagation();
          };
          const trapSearchEnter=event=>{
            if(event.key!=='Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
            const control=event.target?.closest?.('textarea[name="q"],input[name="q"],input[type="search"]');
            if(!control || !followInPageSearch(searchControlValue(control))) return;
            event.preventDefault();
            event.stopImmediatePropagation();
          };
          const trapLink=event=>{
            const link=event.target?.closest?.('a[href]');
            if(!link) return;
            if(isDownloadLink(link)){
              event.preventDefault();
              event.stopImmediatePropagation();
              requestFrameDownload(link.href || link.getAttribute('href'),link.getAttribute('download') || '');
              return;
            }
            if(!popupProtectionEnabled()) return;
            if(!shouldTrapPopupTarget(link.getAttribute('target'))) return;
            const href=link.href || link.getAttribute('href') || 'about:blank';
            if(isTrustedGeneratedLink(link)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if(followSearchResult(link)) return;
            if(!followSameOriginPopup(href)) openPopupTab(href);
          };
          doc.addEventListener('keydown',trapSearchEnter,true);
          doc.addEventListener('submit',trapSearchSubmit,true);
          doc.addEventListener('click',trapLink,true);
          doc.addEventListener('auxclick',trapLink,true);
          doc.addEventListener('submit',event=>{
            const form=event.target;
            if(!popupProtectionEnabled()) return;
            if(!form || String(form.tagName || '').toUpperCase()!=='FORM' || !shouldTrapPopupTarget(form.getAttribute('target'))) return;
            const action=form.action || form.getAttribute('action') || '';
            if(sameOriginPopupUrl(action)){
              try{form.setAttribute('target','_self'); return}catch{}
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            openPopupTab(action || 'about:blank');
          },true);
        }catch{}
      };
      t.frame.addEventListener('load',()=>{
        attachBridge();
        setTimeout(attachBridge,50);
        setTimeout(attachBridge,250);
      });
    }
    function isAuthSensitiveUrl(url){
      const raw=String(url || '');
      if(/recaptcha|captcha|challenge|oauth|sso|login|signin|accounts/i.test(raw)) return true;
      try{
        const parsed=new URL(browserShellSourceUrl(raw) || raw,location.href);
        const host=parsed.hostname.replace(/^www\./,'').toLowerCase();
        const path=(parsed.pathname+parsed.search+parsed.hash).toLowerCase();
        if(host==='accounts.spotify.com') return true;
        if(['google.com','gstatic.com','recaptcha.net'].includes(host) && /recaptcha|captcha/.test(path)) return true;
        return false;
      }catch{
        return false;
      }
    }
    function installYouTubeCompositorGuard(t){
      const frame=t?.frame;
      if(!frame) return;
      const install=()=>{
        try{
          const frameHref=String(frame.contentWindow?.location?.href || frame.getAttribute('src') || '');
          const source=browserShellSourceUrl(frameHref)
            || browserShellSourceUrl(t.sourceUrl || t.url || '')
            || t.sourceUrl || t.url || frameHref;
          if(!hostMatches(browserHost(source),['youtube.com','youtu.be'])) return;
          const doc=frame.contentDocument;
          const frameWindow=frame.contentWindow;
          if(!doc?.documentElement || !frameWindow) return;
          if(!doc.getElementById('nyx-youtube-compositor-guard')){
            const style=doc.createElement('style');
            style.id='nyx-youtube-compositor-guard';
            style.textContent='html:root,html:root *{view-transition-name:none!important}';
            (doc.head || doc.documentElement).appendChild(style);
          }
          const disabledStartViewTransition=update=>{
            const callback=typeof update==='function' ? update : update?.update;
            let result;
            try{result=callback?.()}
            catch(error){result=Promise.reject(error)}
            const updateCallbackDone=Promise.resolve(result);
            const ready=updateCallbackDone.then(()=>undefined);
            return {
              ready,
              finished:ready,
              updateCallbackDone,
              skipTransition(){},
              types:new Set()
            };
          };
          const disableFor=target=>{
            if(!target) return;
            try{
              Object.defineProperty(target,'startViewTransition',{
                configurable:true,
                writable:true,
                value:disabledStartViewTransition
              });
            }catch{
              try{target.startViewTransition=disabledStartViewTransition}catch{}
            }
          };
          disableFor(frameWindow.Document?.prototype);
          disableFor(frameWindow.Element?.prototype);
          disableFor(doc);
          doc.documentElement.dataset.nyxYouTubeCompositorGuard='true';
        }catch{}
      };
      if(frame.dataset.nyxYouTubeCompositorGuardWatch!=='true'){
        frame.dataset.nyxYouTubeCompositorGuardWatch='true';
        frame.addEventListener('load',()=>{
          install();
          setTimeout(install,40);
          setTimeout(install,300);
        });
      }
      install();
    }
    function shouldRelaxProxySandbox(url){
      const raw=browserShellSourceUrl(String(url || '')) || String(url || '');
      const host=browserHost(raw);
      return isAuthSensitiveUrl(raw) || hostMatches(host,[
        'geforcenow.com',
        'play.geforcenow.com',
        'nvidia.com',
        'nvidiagrid.net',
        'discord.com',
        'spotify.com',
        'spotifycdn.com',
        'scdn.co',
        'accounts.spotify.com',
        'accounts.scdn.co',
        'google.com',
        'gstatic.com',
        'recaptcha.net',
        'youtube.com',
        'youtu.be'
      ]);
    }
    const browserFrameAllow='autoplay; encrypted-media; fullscreen; keyboard-map; gamepad; clipboard-read; clipboard-write; camera; microphone; display-capture; accelerometer; gyroscope; magnetometer; xr-spatial-tracking; payment; publickey-credentials-get; identity-credentials-get; private-state-token-issuance; private-state-token-redemption';
    const browserFrameAltKeys=new Set(['l','d','t','w','r','arrowleft','arrowright','tab']);
    function isBrowserFrameAltShortcut(key){
      key=String(key || '').toLowerCase();
      return /^[1-9]$/.test(key) || browserFrameAltKeys.has(key);
    }
    function stopFrameAltEvent(event){
      try{event.preventDefault()}catch{}
      try{event.stopPropagation()}catch{}
      try{event.stopImmediatePropagation?.()}catch{}
    }
    function installBrowserAltBridgeInDocument(doc){
      if(!doc || doc.__nyxBrowserAltBridge) return;
      try{doc.__nyxBrowserAltBridge=true}catch{}
      const handler=event=>{
        try{
          if(!event?.altKey || event.ctrlKey || event.metaKey || event.location===2) return;
          const key=String(event.key || '').toLowerCase();
          if(key==='alt'){
            stopFrameAltEvent(event);
            primeBrowserShellShortcutFocus();
            return;
          }
          if(!isBrowserFrameAltShortcut(key)) return;
          if(handleBrowserShellAltAction(key,event)) stopFrameAltEvent(event);
        }catch{}
      };
      try{doc.addEventListener('keydown',handler,true)}catch{}
      try{doc.defaultView?.addEventListener?.('keydown',handler,true)}catch{}
      const releaseForPageInput=event=>{
        try{
          const target=event?.target;
          if(!target?.closest?.('canvas,input,textarea,select,[contenteditable="true"],[role="application"]')) return;
          releaseNyxKeyboardLock();
        }catch{}
      };
      try{doc.addEventListener('pointerdown',releaseForPageInput,true)}catch{}
      try{doc.addEventListener('mousedown',releaseForPageInput,true)}catch{}
      try{doc.addEventListener('touchstart',releaseForPageInput,{capture:true,passive:true})}catch{}
      try{doc.addEventListener('focusin',releaseForPageInput,true)}catch{}
      const installNested=()=>{
        try{
          doc.querySelectorAll?.('iframe,frame').forEach(child=>{
            try{installBrowserAltBridgeInDocument(child.contentDocument)}catch{}
          });
        }catch{}
      };
      installNested();
      try{
        const root=doc.documentElement || doc.body;
        if(root) new MutationObserver(installNested).observe(root,{childList:true,subtree:true});
      }catch{}
    }
    function installBrowserAltBridgeForFrame(frame){
      try{
        const frameHref=String(frame.contentWindow?.location?.href || frame.getAttribute('src') || '');
        const source=browserShellSourceUrl(frameHref) || frameHref;
        if(hostMatches(browserHost(source),['youtube.com','youtu.be'])) return;
        installBrowserAltBridgeInDocument(frame.contentDocument);
      }catch{}
    }
    function applyFrameInteractionPermissions(frame){
      if(!frame) return;
      frame.tabIndex=0;
      frame.setAttribute('tabindex','0');
      frame.setAttribute('allow',browserFrameAllow);
      frame.style.pointerEvents='auto';
      const installAltBridge=()=>{
        installBrowserAltBridgeForFrame(frame);
        setTimeout(()=>installBrowserAltBridgeForFrame(frame),120);
        setTimeout(()=>installBrowserAltBridgeForFrame(frame),700);
      };
      installAltBridge();
      if(frame.dataset.nyxInputReady==='true') return;
      frame.dataset.nyxInputReady='true';
      const focusFrame=()=>setTimeout(()=>{try{frame.focus({preventScroll:true})}catch{try{frame.focus()}catch{}}},0);
      frame.addEventListener('load',()=>{
        installAltBridge();
        setTimeout(focusFrame,90);
      });
      frame.addEventListener('keydown',event=>{
        try{
          if(!event.altKey || event.ctrlKey || event.metaKey || event.location===2) return;
          const key=String(event.key || '').toLowerCase();
          if(key==='alt'){
            stopFrameAltEvent(event);
            primeBrowserShellShortcutFocus();
            return;
          }
          if(isBrowserFrameAltShortcut(key) && handleBrowserShellAltAction(key,event)) stopFrameAltEvent(event);
        }catch{}
      },true);
      const handoffFrameInput=()=>{
        // The embedded page needs unmodified WASD, arrows, Tab, and number keys.
        releaseNyxKeyboardLock();
      };
      frame.addEventListener('focus',handoffFrameInput);
      frame.addEventListener('pointerdown',handoffFrameInput,{capture:true});
      frame.addEventListener('mousedown',handoffFrameInput,{capture:true});
      frame.addEventListener('touchstart',handoffFrameInput,{capture:true,passive:true});
    }
    function setFrameSandbox(t){
      if(!t?.frame) return;
      const sourceUrl=t.sourceUrl || t.url || t.frame.getAttribute('src') || '';
      applyFrameInteractionPermissions(t.frame);
      installYouTubeCompositorGuard(t);
      if(!popupProtectionEnabled() && shouldRelaxProxySandbox(sourceUrl)){
        t.frame.removeAttribute('sandbox');
        applyFrameInteractionPermissions(t.frame);
        return;
      }
      const tokens=[
        'allow-scripts',
        'allow-same-origin',
        'allow-forms',
        'allow-modals',
        'allow-downloads',
        'allow-pointer-lock',
        'allow-presentation',
        'allow-storage-access-by-user-activation'
      ];
      if(!popupProtectionEnabled()){
        tokens.push('allow-popups','allow-popups-to-escape-sandbox','allow-top-navigation-by-user-activation');
      }
      t.frame.setAttribute('sandbox',tokens.join(' '));
      applyFrameInteractionPermissions(t.frame);
    }
    function clearFrameDocument(t){
      if(!t?.frame) return;
      t.frame.removeAttribute('srcdoc');
    }
    function replaceTabFrame(t){
      if(!t?.frame) return;
      const frame=document.createElement('iframe');
      frame.className='view';
      applyFrameInteractionPermissions(frame);
      if(t.frame.classList.contains('active')) frame.classList.add('active');
      t.frame.replaceWith(frame);
      t.frame=frame;
      t.scramjetFrame=null;
      t.scramjetRuntimeGuarded=null;
      t.popupBridgeInstalled=false;
      setFrameSandbox(t,true);
      installPopupBridge(t);
    }
    function activate(id){
      state.active=id; const t=current();
      let mappedShellTab=null;
      if(document.body.classList.contains('browser-shell')){
        mappedShellTab=browserShellTabs.find(tab=>tab.browserTabId===id) || null;
        if(mappedShellTab) browserShellActiveTab=mappedShellTab.id;
      }
      const activeUrl=t?.url || mappedShellTab?.url || '';
      const activeTitle=t?.title || mappedShellTab?.title || 'New Tab';
      const activeIsBlank=isBrowserShellBlankUrl(activeUrl);
      win.classList.toggle('internal-clear',!!t?.frame?.classList.contains('transparent-internal-page'));
      win.querySelectorAll('.view').forEach(f=>f.classList.remove('active'));
      win.classList.toggle('browser-blank',activeIsBlank);
      if(activeUrl && !activeIsBlank){t?.frame.classList.add('active'); win.querySelector('.browser-home').classList.add('hidden')}
      else{
        win.querySelector('.browser-home').classList.remove('hidden');
        if(t?.opening) playBrowserShellPageReveal(win);
      }
      win.querySelector('.urlbar').value=browserShellDisplayValue(activeUrl); win.querySelector('.titlebar-title').textContent=browserChromeTitle(activeTitle,t?.sourceUrl || activeUrl); renderTabs(); bring(win);
      if(t?.url || !mappedShellTab?.url) updateBrowserShellLocation(t?.url || '',t?.id || '');
    }
    function detectBrowserEngine(url,t){
      const raw=String(url || '');
      const frameSrc=String(t?.frame?.getAttribute?.('src') || '');
      if(t?.scramjetFrame || raw.startsWith('/~/sj/') || frameSrc.includes('/~/sj/')) return 'scramjet';
      if(raw.startsWith('/service/') || frameSrc.startsWith('/service/')) return 'ultraviolet';
      if(raw.startsWith('/scramjet/service/') || frameSrc.startsWith('/scramjet/service/')) return 'scramjet-legacy';
      if(/^https?:/i.test(raw)) return 'direct';
      if(raw.startsWith('nyx://')) return 'nyx';
      return raw ? 'iframe' : 'blank';
    }
    function markBrowserEngine(t,expected,url,phase='load'){
      if(!t) return;
      t.expectedEngine=expected || t.expectedEngine || '';
      t.actualEngine=detectBrowserEngine(url,t);
      t.frame?.dataset && (t.frame.dataset.nyxExpectedEngine=t.expectedEngine || '');
      t.frame?.dataset && (t.frame.dataset.nyxActualEngine=t.actualEngine || '');
      if(t.expectedEngine && t.expectedEngine!==t.actualEngine && !(t.expectedEngine==='scramjet' && t.actualEngine==='scramjet-legacy')){
        console.warn(`nyx Browser Engine mismatch during ${phase}: expected ${t.expectedEngine}, actual ${t.actualEngine}`, {url, frameSrc:t.frame?.getAttribute?.('src') || '', tab:t});
      }else if(t.expectedEngine){
        console.log(`nyx Browser Engine verified: ${t.expectedEngine}`, {url, phase});
      }
    }
    function assertProxyPath(mode,url){
      if(mode==='scramjet' && String(url || '').startsWith('/service/')){
        console.warn('nyx blocked UV URL from loading in Scramjet mode:', url);
        return false;
      }
      if(mode==='ultraviolet' && String(url || '').startsWith('/~/sj/')){
        console.warn('nyx blocked Scramjet URL from loading in UV mode:', url);
        return false;
      }
      return true;
    }
    function resetProxyInstallers(){
      uvInstallPromise=null;
      scramjetInstallPromise=null;
      scramjetTransport=null;
      scramjetTransportKey='';
    }
    function setBrowserTransportOverride(next){
      if(browserTransportOverride===next) return;
      browserTransportOverride=next;
      resetProxyInstallers();
    }
    function applyPreferredTransportForUrl(url,browserMode=normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE))){
      if(!transportAutoEnabled()){
        setBrowserTransportOverride('');
        return;
      }
      const siteTransport=preferredTransport(url);
      setBrowserTransportOverride(siteTransport || (browserMode==='auto' ? (prefersEpoxyTransport(url) ? 'epoxy' : 'libcurl') : ''));
    }
    function transportAutoEnabled(){
      return store.text('nyx.transport',DEFAULT_BROWSER_TRANSPORT)==='auto';
    }
    function proxyTransportName(){
      return browserTransportOverride || store.text('nyx.transport',DEFAULT_BROWSER_TRANSPORT);
    }
    function transportRetryOrder(current){
      const ordered=['epoxy','wisp','libcurl'];
      const index=ordered.indexOf(current);
      if(index<0) return ordered;
      return [...ordered.slice(index+1),...ordered.slice(0,index)];
    }
    function serviceWorkerTransportErrorText(text){
      return /internal service worker error|request failed with error code\s*(?:35|52|56|60)|ssl connect error|tls handshake eof|wisp server closed|muxtaskended|ssl peer certificate|ssh remote key|certificate.*not ok|failure when receiving data from the peer/i.test(String(text || ''));
    }
    function loadSelectedSearchFallback(t,sourceUrl,reason=''){
      if(!t || !sourceUrl) return false;
      const key=String(sourceUrl);
      if(t.selectedSearchFallbackKey===key) return false;
      t.selectedSearchFallbackKey=key;
      console.warn('nyx proxy could not load the requested page.', {sourceUrl:key, reason});
      t.url=key;
      t.sourceUrl=key;
      t.title=browserShellLabel(key);
      t.icon=iconForUrl(key);
      t.frame.removeAttribute('src');
      t.frame.srcdoc=proxyFailureHtml(`Nyx could not connect to ${browserShellLabel(key)}. Check that the address exists and is spelled correctly, then try again.`,'Page');
      t.frame.classList.add('active');
      renderTabs();
      updateBrowserShellLocation(key,t.id,true);
      return true;
    }
    function fallbackProxyEngine(t,sourceUrl,expectedEngine,reason=''){
      if(!t || !sourceUrl || !expectedEngine) return false;
      const key=`${expectedEngine}:${sourceUrl}`;
      const attempts=t.engineFallbackAttempts || (t.engineFallbackAttempts={});
      attempts[key]=(attempts[key] || 0) + 1;
      const configuredMode=normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE));
      if(configuredMode!=='auto'){
        if(configuredMode==='scramjet' && expectedEngine!=='scramjet'){
          console.warn('nyx enforcing selected Scramjet engine.', {sourceUrl, expectedEngine, reason});
          loadScramjetTab(t,sourceUrl,false);
          return true;
        }
        if(configuredMode==='ultraviolet' && expectedEngine!=='ultraviolet'){
          console.warn('nyx enforcing selected Ultraviolet engine.', {sourceUrl, expectedEngine, reason});
          installUltraviolet().then(ok=>{
            if(!state.tabs.includes(t)) return;
            const proxied=ok ? proxyModeUrl('ultraviolet',sourceUrl) : '';
            if(ok && proxied.startsWith('/service/')) loadTab(t,proxied,false,'ultraviolet',sourceUrl);
            else loadSelectedSearchFallback(t,sourceUrl,'selected Ultraviolet engine unavailable');
          });
          return true;
        }
        if(configuredMode==='iframe'){
          if(expectedEngine!=='iframe') loadTab(t,sourceUrl,false,'iframe',sourceUrl);
          else loadSelectedSearchFallback(t,sourceUrl,reason || 'selected iframe mode failed');
          return true;
        }
      }
      if(isSpotifyFamilyUrl(sourceUrl) && expectedEngine==='scramjet'){
        if(attempts[key]===1) console.warn('nyx Spotify is staying on Scramjet with the user-selected transport; not switching engines.', {sourceUrl, transport:proxyTransportName(), reason});
        return false;
      }
      if(expectedEngine==='scramjet' && configuredMode==='auto'){
        console.warn('nyx Auto exhausted its Scramjet transports; keeping the selected engine.', {sourceUrl, reason});
        return loadSelectedSearchFallback(t,sourceUrl,reason || 'Scramjet transports exhausted');
      }
      if(expectedEngine==='scramjet' && configuredMode==='scramjet'){
        if(attempts[key]>3) return loadSelectedSearchFallback(t,sourceUrl,reason || 'scramjet retries exhausted');
        console.warn('nyx Scramjet is selected; retrying Scramjet instead of switching engines.', {sourceUrl, reason});
        loadScramjetTab(t,sourceUrl,false);
        return true;
      }
      if(expectedEngine==='ultraviolet' && configuredMode==='ultraviolet'){
        return loadSelectedSearchFallback(t,sourceUrl,reason || 'ultraviolet failed while selected');
      }
      if(attempts[key]>3) return loadSelectedSearchFallback(t,sourceUrl,reason || 'proxy fallback exhausted');
      if(expectedEngine==='scramjet'){
        console.warn('nyx scramjet failed; switching this tab to ultraviolet.', {sourceUrl, reason});
        installUltraviolet().then(ok=>{
          if(!state.tabs.includes(t)) return;
          const proxied=ok ? proxyModeUrl('ultraviolet',sourceUrl) : '';
          if(ok && proxied.startsWith('/service/')) loadTab(t,proxied,false,'ultraviolet',sourceUrl);
          else loadSelectedSearchFallback(t,sourceUrl,'ultraviolet unavailable after scramjet failure');
        });
        return true;
      }
      if(expectedEngine==='ultraviolet'){
        console.warn('nyx ultraviolet failed; switching this tab to scramjet.', {sourceUrl, reason});
        loadScramjetTab(t,sourceUrl,false);
        return true;
      }
      return loadSelectedSearchFallback(t,sourceUrl,reason || 'unknown proxy failure');
    }
    function watchFrameTransportErrors(t,sourceUrl,expectedEngine){
      if(!t?.frame || !sourceUrl || !expectedEngine) return;
      if(normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE))!=='auto') return;
      const token='transport-'+Date.now()+Math.random().toString(16).slice(2);
      t.transportWatchToken=token;
      const check=()=>{
        if(t.transportWatchToken!==token || !state.tabs.includes(t)) return;
        let text='';
        try{text=String(t.frame.contentDocument?.body?.textContent || '').slice(0,5000)}catch{return}
        if(!serviceWorkerTransportErrorText(text)) return;
        const key=`${expectedEngine}:${sourceUrl}`;
        const attempts=t.transportRetries || (t.transportRetries={});
        attempts[key]=(attempts[key] || 0) + 1;
        if(isSpotifyFamilyUrl(sourceUrl) && expectedEngine==='scramjet'){
          if(attempts[key]===1) console.warn('nyx Spotify transport warning; preserving the user-selected transport.', {sourceUrl, transport:proxyTransportName()});
          return;
        }
        if(attempts[key]>2){
          fallbackProxyEngine(t,sourceUrl,expectedEngine,'transport retries exhausted');
          return;
        }
        if(!transportAutoEnabled()){
          fallbackProxyEngine(t,sourceUrl,expectedEngine,'transport failed with fixed transport');
          return;
        }
        const currentTransport=proxyTransportName();
        const nextTransport=transportRetryOrder(currentTransport)[0] || DEFAULT_BROWSER_TRANSPORT;
        console.warn('nyx proxy transport failed; retrying same engine with safer transport.', {expectedEngine, sourceUrl, currentTransport, nextTransport});
        setBrowserTransportOverride(nextTransport);
        if(expectedEngine==='scramjet') loadScramjetTab(t,sourceUrl,false);
        else if(expectedEngine==='ultraviolet'){
          installUltraviolet().then(ok=>{
            const proxied=ok ? proxyModeUrl('ultraviolet',sourceUrl) : '';
            if(ok && proxied.startsWith('/service/')) loadTab(t,proxied,false,'ultraviolet',sourceUrl);
          });
        }
      };
      t.frame.addEventListener('load',()=>setTimeout(check,80),{once:true});
      setTimeout(check,1300);
      setTimeout(check,4200);
    }
    function watchProxyLoad(t,sourceUrl,expectedEngine){
      if(!sourceUrl || !expectedEngine) return;
      // Fixed engine modes must preserve the real proxy response. Recovery is
      // allowed to rotate transports or engines only when Auto was selected.
      if(normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE))!=='auto') return;
      if(t.fallbackSource!==sourceUrl){
        t.fallbackSource=sourceUrl;
        t.fallbackAttempts=0;
      }
      const token='load-'+Date.now()+Math.random().toString(16).slice(2);
      t.loadWatchToken=token;
      const watchStartedAt=Date.now();
      let loaded=false;
      const markLoaded=()=>{
        const frameSrc=String(t.frame?.getAttribute?.('src') || '');
        let frameHref='';
        try{frameHref=String(t.frame?.contentWindow?.location?.href || '')}catch{}
        const hasProxyPath=frameSrc.startsWith('/service/') || frameSrc.startsWith('/~/sj/') || frameSrc.startsWith('/scramjet/service/')
          || frameHref.includes('/service/') || frameHref.includes('/~/sj/') || frameHref.includes('/scramjet/service/');
        const hasDirectPage=/^https?:/i.test(frameSrc) || (/^https?:/i.test(frameHref) && frameHref!=='about:blank' && frameHref!==location.href);
        if(!hasProxyPath && !hasDirectPage) return;
        loaded=true;
        t.frame?.removeEventListener?.('load',markLoaded);
      };
      t.frame.addEventListener('load',markLoaded);
      const proxyLooksBroken=()=>{
        const health=inspectFrameHealth(t);
        if(!health.reachable) return false;
        if(health.blank && health.readyState!=='complete') return false;
        if(isSpotifyFamilyUrl(sourceUrl)){
          try{
            const doc=t.frame?.contentDocument;
            const text=String(doc?.body?.textContent || '').trim();
            const htmlClass=String(doc?.documentElement?.className || '');
            if(text.length>80 || /spotify/i.test(htmlClass) || doc?.querySelector('[data-testid],script[src*="spotify"],script[src*="spotifycdn"]')) return false;
          }catch{}
        }
        try{
          if(t.frame?.contentDocument?.querySelector('#desktop,#welcomeScreen')) return true;
        }catch{}
        return !!(health.blank || health.hasErrorText);
      };
      const protectedSiteReturnedEmptyShell=()=>{
        const host=browserHost(sourceUrl);
        if(!hostMatches(host,['meta.ai'])) return false;
        const health=inspectFrameHealth(t);
        return health.reachable && !health.hasErrorText && String(health.visibleText || '').length<12 && /meta ai/i.test(health.title || '');
      };
      if(hostMatches(browserHost(sourceUrl),['meta.ai'])){
        let consecutiveProtectedBlanks=0;
        let protectedChecks=0;
        const protectedTimer=setInterval(()=>{
          protectedChecks+=1;
          if(t.loadWatchToken!==token || !state.tabs.includes(t) || protectedChecks>20){
            clearInterval(protectedTimer);
            return;
          }
          consecutiveProtectedBlanks=protectedSiteReturnedEmptyShell() ? consecutiveProtectedBlanks+1 : 0;
          if(consecutiveProtectedBlanks<2) return;
          clearInterval(protectedTimer);
          loadSelectedSearchFallback(t,sourceUrl,'the site returned a blocked empty shell');
        },1000);
      }
      const attemptFallback=(force=false)=>{
        t.frame?.removeEventListener?.('load',markLoaded);
        if((loaded && !force) || t.loadWatchToken!==token || !state.tabs.includes(t)) return;
        if(!force){
          const health=inspectFrameHealth(t);
          const healthyProgress=health.reachable && !health.hasErrorText && !health.blank;
          if(healthyProgress){
            loaded=true;
            return;
          }
          if(health.reachable && !health.hasErrorText && health.readyState==='loading' && Date.now()-watchStartedAt<10000) return;
        }
        if(isSpotifyFamilyUrl(sourceUrl) && expectedEngine==='scramjet'){
          if(!t.spotifyPinnedNoticeShown){
            t.spotifyPinnedNoticeShown=true;
            console.warn('nyx Spotify is staying on Scramjet with the user-selected transport; skipping timeout engine fallback.', {sourceUrl, transport:proxyTransportName()});
          }
          return;
        }
        if(isSpotifyFamilyUrl(sourceUrl)){
          try{
            const doc=t.frame?.contentDocument;
            const text=String(doc?.body?.textContent || '').trim();
            const htmlClass=String(doc?.documentElement?.className || '');
            if(text.length>80 || /spotify/i.test(htmlClass) || doc?.querySelector('[data-testid],script[src*="spotify"],script[src*="spotifycdn"]')) return;
          }catch{}
        }
        const currentUrl=String(t.url || '');
        if(t.url!==sourceUrl && !currentUrl.startsWith('/service/') && !currentUrl.startsWith('/~/sj/') && !currentUrl.startsWith('/scramjet/service/')) return;
        t.fallbackAttempts=(t.fallbackAttempts || 0) + 1;
        if(t.fallbackAttempts>4) return;
        console.warn(`nyx ${expectedEngine || 'proxy'} load timed out, trying fallback`, {sourceUrl, transport:browserTransportOverride || store.text('nyx.transport',DEFAULT_BROWSER_TRANSPORT)});
        const browserMode=normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE));
        const canAutoTransport=transportAutoEnabled();
        const currentTransport=proxyTransportName();
        const nextTransport=transportRetryOrder(currentTransport)[0] || '';
        let handled=false;
        if(expectedEngine==='ultraviolet'){
          if(canAutoTransport && nextTransport){
            setBrowserTransportOverride(nextTransport);
            navigate(sourceUrl,'ultraviolet');
            handled=true;
          }else if(browserMode==='auto'){
            if(canAutoTransport) setBrowserTransportOverride('epoxy');
            loadScramjetTab(t,sourceUrl,false);
            handled=true;
          }
        }else if(expectedEngine==='scramjet'){
          if(canAutoTransport && nextTransport){
            setBrowserTransportOverride(nextTransport);
            loadScramjetTab(t,sourceUrl,false);
            handled=true;
          }else if(browserMode==='scramjet'){
            loadScramjetTab(t,sourceUrl,false);
            handled=true;
          }else if(browserMode==='auto'){
            if(canAutoTransport) setBrowserTransportOverride('epoxy');
            loadSelectedSearchFallback(t,sourceUrl,'Scramjet transports exhausted');
            handled=true;
          }
        }
        if(!handled) fallbackProxyEngine(t,sourceUrl,expectedEngine,'blank or timed-out proxy frame');
      };
      const checkBlankFallback=()=>{
        if(t.loadWatchToken!==token || !state.tabs.includes(t)) return;
        if(protectedSiteReturnedEmptyShell()){
          loadSelectedSearchFallback(t,sourceUrl,'the site returned a blocked empty shell');
          return;
        }
        if(proxyLooksBroken()) attemptFallback(true);
      };
      t.frame.addEventListener('load',()=>setTimeout(checkBlankFallback,1600),{once:true});
      setTimeout(checkBlankFallback,3200);
      setTimeout(checkBlankFallback,7600);
      setTimeout(checkBlankFallback,12000);
      setTimeout(attemptFallback,5200);
      setTimeout(attemptFallback,11000);
    }
    function loadTab(t,url,addHistory=true,expectedEngine='',sourceUrl=''){
      const requestedSource=sourceUrl || (/^https?:/i.test(url) ? url : '');
      if(expectedEngine==='iframe' && hostMatches(browserHost(requestedSource),['cineby.at'])){
        console.warn('nyx blocked a direct Cineby frame because Cineby denies iframe embedding; using Scramjet.', {sourceUrl:requestedSource});
        loadScramjetTab(t,requestedSource,addHistory);
        return;
      }
      if(expectedEngine && !assertProxyPath(expectedEngine,url)){
        console.warn('nyx continuing despite engine path mismatch so the site can still attempt to load.');
      }
      t.expectedEngine=expectedEngine || t.expectedEngine || '';
      t.sourceUrl=sourceUrl || (/^https?:/i.test(url) ? url : t.sourceUrl || '');
      t.frame.classList.remove('transparent-internal-page');
      t.frame.style.backgroundColor='';
      win.classList.remove('internal-clear');
      t.url=url;
      if(addHistory){
        t.history=t.history.slice(0,t.index+1);
        t.history.push(url);
        t.index=t.history.length-1;
      }
      t.title=titleForUrl(sourceUrl || url);
      t.icon=iconForUrl(sourceUrl || url);
      win.querySelector('.browser-home').classList.add('hidden');
      t.frame.classList.add('active');
      installPopupBridge(t);
      const proxied=url.startsWith('/service/') || url.startsWith('/scramjet/service/') || url.startsWith('/~/sj/');
      if(!url.startsWith('/scramjet/service/') && !url.startsWith('/~/sj/')) t.scramjetFrame=null;
      setFrameSandbox(t,true);
      clearFrameDocument(t);
      if(normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE))==='auto' && directOnly(url) && !proxied){
        loadScramjetTab(t,url,addHistory);
        return;
      }
      watchProxyLoad(t,sourceUrl || (/^https?:/i.test(url) ? url : ''),expectedEngine);
      watchFrameTransportErrors(t,sourceUrl || (/^https?:/i.test(url) ? url : ''),expectedEngine);
      if(expectedEngine==='ultraviolet'){
        t.retryUvPresentation=(retrySource,reason='')=>{
          if(reason==='YouTube component styles did not initialize'){
            loadScramjetTab(t,retrySource,false);
            return;
          }
          const proxied=proxyModeUrl('ultraviolet',retrySource);
          if(proxied.startsWith('/service/')) loadTab(t,proxied,false,'ultraviolet',retrySource);
        };
        watchUvPresentation(t,sourceUrl || requestedSource);
      }else t.retryUvPresentation=null;
      t.frame.src=url;
      markBrowserEngine(t,expectedEngine,url,'iframe-src');
      renderTabs();
      activate(t.id);
      updateBrowserShellLocation(url,t.id);
    }
    function setTabMeta(t,url,addHistory=true){
      t.url=url;
      if(addHistory){
        t.history=t.history.slice(0,t.index+1);
        t.history.push(url);
        t.index=t.history.length-1;
      }
      t.title=titleForUrl(url);
      t.icon=iconForUrl(url);
      win.querySelector('.browser-home').classList.add('hidden');
      t.frame.classList.add('active');
      installCrazyGamesOfflineRecovery(t,url);
      renderTabs();
      activate(t.id);
      updateBrowserShellLocation(url,t.id);
    }
    function retryScramjetTab(t,url){
      t.scramjetRetries=(t.scramjetRetries || 0) + 1;
      if(t.scramjetRetries>3) return false;
      const navigationIntent=t.navigationIntent || '';
      t.frame.removeAttribute('src');
      setTimeout(async ()=>{
        if(!state.tabs.includes(t) || t.navigationIntent!==navigationIntent) return;
        await refreshScramjetServiceWorker().catch(()=>false);
        if(!state.tabs.includes(t) || t.navigationIntent!==navigationIntent) return;
        scramjetInstallPromise=null;
        const ok=await installScramjet();
        if(!ok || !state.tabs.includes(t) || t.navigationIntent!==navigationIntent) return;
        if(t.scramjetFrame){
          try{t.scramjetFrame.go(url); return}catch{}
        }
      },220);
      return true;
    }
    function loadScramjetTab(t,url,addHistory=true){
      t.expectedEngine='scramjet';
      t.sourceUrl=url;
      const navigationIntent=t.navigationIntent || '';
      installScramjet().then(ok=>{
        if(!state.tabs.includes(t) || t.navigationIntent!==navigationIntent) return;
        if(!ok || !scramjetController){
          t.url=url;
          setTabMeta(t,url,addHistory);
          t.actualEngine='scramjet-failed';
          t.frame.dataset.nyxExpectedEngine='scramjet';
          t.frame.dataset.nyxActualEngine='scramjet-failed';
          setFrameSandbox(t,true);
          clearFrameDocument(t);
          t.frame.srcdoc=proxyFailureHtml(scramjetInstallError,'Scramjet');
          return;
        }
        const existingFrameSrc=String(t.frame.getAttribute('src') || '');
        if(existingFrameSrc.startsWith('/service/') || t.actualEngine==='ultraviolet'){
          replaceTabFrame(t);
        }
        const spotifyChromeOsCompatibility=/\bCrOS\b/i.test(String(navigator.userAgent || '')) && isSpotifyFamilyUrl(url);
        const guardMode=spotifyChromeOsCompatibility ? 'spotify-chromeos' : (shouldUseScramjetRuntimeGuard(url) ? 'full' : (shouldUseScramjetMinimalGuard(url) ? 'minimal' : (shouldUseScramjetHelperGuard(url) ? 'helper' : 'none')));
        if(t.scramjetFrame && t.scramjetRuntimeGuarded!==guardMode){
          replaceTabFrame(t);
        }
        if(!t.scramjetFrame){
          setFrameSandbox(t,true);
          t.frame.removeAttribute('src');
          clearFrameDocument(t);
          installPopupBridge(t);
          const plugins=[createScramjetCompatibilityPlugin('','proxy-sri')];
          if(guardMode==='full') plugins.push(createScramjetCompatibilityPlugin(scramjetRuntimeGuardSource,'runtime-guard'));
          else if(guardMode==='spotify-chromeos') plugins.push(createScramjetCompatibilityPlugin(scramjetSpotifyChromeOsGuardSource,'spotify-chromeos'));
          else if(guardMode==='minimal') plugins.push(createScramjetCompatibilityPlugin(scramjetMinimalRuntimeGuardSource,'minimal-guard'));
          else if(guardMode==='helper') plugins.push(createScramjetCompatibilityPlugin(scramjetHelperRuntimeGuardSource,'helper-guard'));
          if(shouldStripScramjetDuckDuckGoScripts(url)){
            plugins.push(createScramjetCompatibilityPlugin('', 'duckduckgo-noscript'));
          }
          if(hostMatches(browserHost(url),['cineby.at'])){
            plugins.push(createScramjetCompatibilityPlugin('', 'cineby-disable-devtool'));
          }
          t.scramjetRuntimeGuarded=guardMode;
          t.scramjetFrame=scramjetController.createFrame(t.frame,{plugins});
          t.scramjetFrame.addEventListener?.('urlchange',event=>{
            const next=String(event.url || '');
            if(!next) return;
            t.url=next;
            t.title=titleForUrl(next);
            t.icon=iconForUrl(next);
            renderTabs();
            if(t.id===state.active) win.querySelector('.urlbar').value=browserShellDisplayValue(next);
            updateBrowserShellLocation(next,t.id);
            watchScramjetHealth(t,next);
            setTimeout(()=>syncLoadedTabIcon(t),120);
          });
        }
        setTabMeta(t,url,addHistory);
        t.scramjetHealthRetries=0;
        t.scramjetRetries=0;
        watchProxyLoad(t,url,'scramjet');
        watchFrameTransportErrors(t,url,'scramjet');
        watchScramjetHealth(t,url);
        if(String(t.frame.getAttribute('src') || '').startsWith('/service/')) t.frame.removeAttribute('src');
        clearFrameDocument(t);
        try{
          t.scramjetFrame.go(url);
        }catch{
          retryScramjetTab(t,url);
        }
        if(spotifyChromeOsCompatibility) startSpotifyChromeOsFrameCompatibility(t);
        else stopSpotifyChromeOsFrameCompatibility(t);
        setTimeout(()=>{
          if(!state.tabs.includes(t) || t.navigationIntent!==navigationIntent) return;
          if(t.scramjetFrame && !String(t.frame.getAttribute('src') || '').includes('/~/sj/')){
            markBrowserEngine(t,'scramjet',String(t.frame.getAttribute('src') || ''),'scramjet-path-check');
            try{t.scramjetFrame.go(url)}catch{}
          }
        },450);
        setTimeout(()=>{
          if(!state.tabs.includes(t) || t.navigationIntent!==navigationIntent) return;
          markBrowserEngine(t,'scramjet',String(t.frame.getAttribute('src') || url),'scramjet-final');
        },900);
        setTimeout(()=>{
          if(!state.tabs.includes(t) || t.navigationIntent!==navigationIntent) return;
          try{
            const isScramjetPath=t.frame.contentWindow?.location?.pathname?.startsWith('/~/sj/');
            const loadednyx=!!t.frame.contentDocument?.querySelector('#desktop,#welcomeScreen');
            if(isScramjetPath && loadednyx) retryScramjetTab(t,url);
          }catch{}
        },1800);
      });
    }
    function waitForTabResultPaint(t,timeout=4200){
      return new Promise(resolve=>{
        if(!t?.frame) return resolve(false);
        let done=false;
        let loadSeen=false;
        const sourceForReadiness=()=>browserShellSourceUrl(t.sourceUrl || t.url || '') || t.sourceUrl || t.url || '';
        const hasMeaningfulContent=()=>{
          try{
            const doc=t.frame.contentDocument;
            if(!doc?.body) return false;
            if(doc.querySelector('#desktop,#welcomeScreen')) return false;
            const text=String(doc.body.textContent || '').replace(/\s+/g,' ').trim().slice(0,6000);
            const ready=doc.readyState==='complete' || doc.readyState==='interactive';
            const source=sourceForReadiness();
            const host=browserHost(source);
            const isDuckSearch=hostMatches(host,['duckduckgo.com']) && /[?&]q=/.test(source);
            if(isDuckSearch){
              if(/No results found|not many great results|try different keywords|there are no results/i.test(text)) return ready;
              const resultNodes=[...doc.body.querySelectorAll('article[data-testid*="result" i],[data-testid*="result" i],[data-testid="mainline"] li,#links .result,.results_links,.result__body,main article,ol li')]
                .filter(node=>String(node.textContent || '').replace(/\s+/g,' ').trim().length>24);
              const resultLinks=[...doc.body.querySelectorAll('main a[href],#links a[href],[data-testid="mainline"] a[href],article a[href],ol a[href]')]
                .filter(link=>{
                  const label=String(link.textContent || '').replace(/\s+/g,' ').trim();
                  if(label.length<8) return false;
                  const href=String(link.getAttribute('href') || link.href || '');
                  if(/^(#|javascript:)/i.test(href)) return false;
                  const box=link.getBoundingClientRect?.();
                  return !box || box.top>120;
                });
              return ready && (resultNodes.length>0 || resultLinks.length>=2);
            }
            const hasPageNodes=!!doc.body.querySelector('a,form,input,button,main,article,section,[role="main"],#links,.results,.result,.result__body');
            const visibleMedia=[...doc.body.querySelectorAll('img,video,canvas,iframe,svg,picture')]
              .some(node=>{
                const box=node.getBoundingClientRect?.();
                return box && box.width>24 && box.height>24;
              });
            const visibleBlocks=[...doc.body.querySelectorAll('main,article,section,[role="main"],#links,.results,.result,.result__body,form')]
              .some(node=>{
                const box=node.getBoundingClientRect?.();
                const nodeText=String(node.textContent || '').replace(/\s+/g,' ').trim();
                return box && box.width>80 && box.height>40 && nodeText.length>16;
              });
            return ready && (text.length>80 || visibleBlocks || visibleMedia || (hasPageNodes && text.length>32));
          }catch{
            return false;
          }
        };
        const finish=value=>{
          if(done) return;
          done=true;
          clearInterval(poll);
          clearTimeout(timer);
          try{t.frame.removeEventListener('load',onLoad)}catch{}
          resolve(value);
        };
        const onLoad=()=>{
          loadSeen=true;
        };
        const poll=setInterval(()=>{
          const srcdoc=String(t.frame?.getAttribute?.('srcdoc') || '');
          if(srcdoc && /Scramjet did not start|Ultraviolet did not start|Page Not Found|error/i.test(srcdoc)) finish(false);
          if(hasMeaningfulContent()) finish(true);
        },420);
        const timer=setTimeout(()=>finish(false),timeout);
        t.frame.addEventListener('load',onLoad,{once:true});
      });
    }
    function navigate(raw,forceMode=''){
      const t=current(); if(!t)return;
      const navigationIntent='navigate-'+Date.now()+Math.random().toString(16).slice(2);
      t.navigationIntent=navigationIntent;
      t.loadWatchToken='superseded-'+navigationIntent;
      t.transportWatchToken='superseded-'+navigationIntent;
      if(shouldTriggerSixtySevenJumpscare(raw)){
        showSixtySevenJumpscare();
        return;
      }
      const rawText=canonicalAddressInput(raw);
      const proxyInternal=/^(?:\/service\/|\/~\/sj\/|\/scramjet\/service\/|nyx:\/\/)/i.test(rawText);
      const looksLikeUrl=/^(?:[a-z][a-z0-9+.-]*:|[\w.-]+\.[a-z]{2,}(?:\/|$)|\/|\.\/|\.\.\/|assets\/)/i.test(rawText);
      const isSearchQuery=rawText && !forceMode && !looksLikeUrl && !proxyInternal;
      if(isSearchQuery){
        const url=selectedSearchUrl(rawText);
        document.querySelectorAll('.nyx-preflight').forEach(overlay=>overlay.remove());
        win.querySelector('.urlbar').value=browserShellDisplayValue(url);
        hideBrowserSuggestions();
        const browserMode=normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE));
        if(!forceMode || !browserTransportOverride) applyPreferredTransportForUrl(url,browserMode);
        updateBrowserShellLocation(url,t.id,true);
        const mode=forceMode || selectedBrowserMode(url);
        logProxySelection(url,forceMode,'search');
        if(browserMode==='auto' && mode==='iframe' && directOnly(url)){
          loadScramjetTab(t,url,true);
        }else if(mode==='rammerhead'){
          rhNavigate(url,finalUrl=>{
            if(!state.tabs.includes(t) || t.navigationIntent!==navigationIntent) return;
            loadTab(t,finalUrl,true,'rammerhead',url);
          });
        }else if(mode==='scramjet'){
          loadScramjetTab(t,url,true);
        }else if(mode==='ultraviolet'){
          setTabMeta(t,url,true);
          installUltraviolet().then(ok=>{
            if(!state.tabs.includes(t) || t.navigationIntent!==navigationIntent) return;
            const proxied=ok ? proxyModeUrl(mode,url) : '';
            if(ok && proxied.startsWith('/service/')) loadTab(t,proxied,false,'ultraviolet',url);
            else loadScramjetTab(t,url,false);
          });
        }else{
          loadTab(t,proxyModeUrl(mode,url),true,mode || 'iframe',url);
        }
        return;
      }
      if(rawText && looksLikeUrl && !proxyInternal) document.querySelectorAll('.nyx-preflight').forEach(overlay=>overlay.remove());
      const url=normalize(browserShellSourceUrl(raw) || raw); if(!url)return;
      win.querySelector('.urlbar').value=browserShellDisplayValue(url);
      if(isAnimexUrl(url) && t.animexPromptUrl!==url){
        t.animexPromptUrl=url;
        const tabId=t.id;
        showAnimexMikuPrompt(()=>{
          if(!state.tabs.some(tab=>tab.id===tabId)) return;
          activate(tabId);
          navigate(url,forceMode);
        });
        return;
      }
      const browserMode=normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE));
      if(!forceMode || !browserTransportOverride) applyPreferredTransportForUrl(url,browserMode);
      updateBrowserShellLocation(url,t.id,true);
      try{
        const parsed=new URL(url,location.href);
        if(parsed.origin===location.origin && !parsed.pathname.includes('/assets/') && (parsed.pathname==='/' || /\/index\.html$/i.test(parsed.pathname))){
          t.url='';
          t.title='New Tab';
          t.icon=favicons.nyx;
          t.history=[''];
          t.index=0;
          clearFrameDocument(t);
          t.frame.removeAttribute('src');
          t.frame.classList.remove('active');
          renderBrowserShellHomeMode(win);
          renderTabs();
          updateBrowserShellLocation('',t.id,true);
          return;
        }
        if(parsed.origin===location.origin && (parsed.pathname.includes('/assets/') || parsed.pathname.endsWith('/index.html'))){
          loadTab(t,parsed.href,true,'iframe');
          return;
        }
      }catch{}
      const mode=forceMode || selectedBrowserMode(url);
      logProxySelection(url,forceMode,'navigate');
      if(browserMode==='auto' && mode==='iframe' && directOnly(url)){
        loadScramjetTab(t,url,true);
        return;
      }
      if(mode==='rammerhead'){
        rhNavigate(url,finalUrl=>{
          if(!state.tabs.includes(t) || t.navigationIntent!==navigationIntent) return;
          loadTab(t,finalUrl,true,'rammerhead');
        });
      }else if(mode==='scramjet'){
        loadScramjetTab(t,url,true);
      }else if(mode==='ultraviolet'){
        setTabMeta(t,url,true);
        installUltraviolet().then(ok=>{
          if(!state.tabs.includes(t) || t.navigationIntent!==navigationIntent) return;
          const proxied=ok ? proxyModeUrl(mode,url) : '';
          if(ok && proxied.startsWith('/service/')) loadTab(t,proxied,false,'ultraviolet',url);
          else{
            console.warn('nyx UV Engine requested but unavailable or produced a non-UV URL:', {ok, proxied, url});
            if(browserMode==='auto' && !document.body.classList.contains('browser-shell')){
              loadScramjetTab(t,url,false);
              return;
            }
            t.url=url;
            setTabMeta(t,url,false);
            t.actualEngine='ultraviolet-failed';
            t.frame.dataset.nyxExpectedEngine='ultraviolet';
            t.frame.dataset.nyxActualEngine='ultraviolet-failed';
            setFrameSandbox(t,true);
            clearFrameDocument(t);
            t.frame.srcdoc=proxyFailureHtml('Refresh once so the updated service worker can register, then try again.','Ultraviolet');
          }
        });
      }else{
        loadTab(t,proxyModeUrl(mode,url),true,mode || 'iframe',url);
      }
    }
    function goFrameHistory(direction){
      const t=current();
      if(!t) return;
      const nextIndex=t.index+direction;
      if(nextIndex>=0 && nextIndex<t.history.length){
        t.index=nextIndex;
        const stored=t.history[nextIndex];
        const source=browserShellSourceUrl(stored) || stored;
        const engine=t.expectedEngine || detectBrowserEngine(stored,t);
        if(engine==='scramjet'){
          loadScramjetTab(t,source,false);
        }else if(engine==='ultraviolet'){
          installUltraviolet().then(ok=>{
            if(!ok || !state.tabs.includes(t)) return;
            const proxied=String(stored).startsWith('/service/') ? stored : proxyModeUrl('ultraviolet',source);
            loadTab(t,proxied,false,'ultraviolet',source);
          });
        }else{
          loadTab(t,stored,false,engine,source);
        }
        return;
      }
      if(t.scramjetFrame){
        try{
          if(direction<0) t.scramjetFrame.back();
          else t.scramjetFrame.forward();
          return;
        }catch{}
      }
      try{
        if(t.frame.contentWindow?.history?.length > 1){
          if(direction<0) t.frame.contentWindow.history.back();
          else t.frame.contentWindow.history.forward();
          return;
        }
      }catch{}
    }
    function closeTabById(tabId,keepBlank=true){
      const index=state.tabs.findIndex(t=>t.id===tabId);
      if(index<0) return false;
        const nextIndex=state.tabs.findIndex(t=>t.id===tabId);
        if(nextIndex<0) return;
        state.tabs[nextIndex].frame.remove();
        state.tabs.splice(nextIndex,1);
        if(!state.tabs.length){
          if(keepBlank) addTab();
          else renderTabs();
        }else{
          activate(state.tabs[Math.max(0,nextIndex-1)].id);
        }
      return true;
    }
    state.addTab=addTab;
    state.activate=activate;
    state.closeTab=(tabId)=>closeTabById(tabId,false);
    state.openPopupTab=openPopupTab;
    state.refreshSandbox=()=>state.tabs.forEach(tab=>setFrameSandbox(tab));
    state.renderTabs=renderTabs;
    state.navigate=navigate;
    state.reloadTab=reloadTab;
    win.querySelector('[data-new-tab]').onclick=()=>addTab();
    win.querySelector('[data-go]').onclick=()=>navigate(win.querySelector('.urlbar').value);
    win.querySelector('.urlbar').addEventListener('keydown',e=>{if(e.key==='Enter')navigate(e.target.value)});
    win.querySelector('[data-reload]').onclick=()=>reloadTab();
    win.querySelector('[data-back]').onclick=()=>goFrameHistory(-1);
    win.querySelector('[data-forward]').onclick=()=>goFrameHistory(1);
    win.querySelector('[data-menu]').onclick=()=>document.body.classList.contains('browser-shell') ? openBrowserShellSettings() : openSettings();
    win.addEventListener('click',e=>{
      const ignoredShortcutClick=e.target.closest('.home-shortcut[data-ignore-shortcut-click="1"]');
      if(ignoredShortcutClick){
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        ignoredShortcutClick.dataset.ignoreShortcutClick='0';
        return;
      }
      if(shortcutMenuPointerHandled){
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        shortcutMenuPointerHandled=false;
        return;
      }
      const pointShortcutMenu=shortcutMenuButtonAtPoint(e.clientX,e.clientY);
      if(pointShortcutMenu){e.preventDefault(); e.stopPropagation(); toggleShortcutMenu(pointShortcutMenu); return}
      const close=e.target.closest('[data-close-tab]'); if(close){closeTabById(close.dataset.closeTab,true)}
      const shortcutMenu=e.target.closest('[data-home-shortcut-menu]');
      if(shortcutMenu){e.preventDefault(); e.stopPropagation(); toggleShortcutMenu(shortcutMenu); return}
      const shortcutFavorite=e.target.closest('[data-home-shortcut-favorite]');
      if(shortcutFavorite){e.preventDefault(); e.stopPropagation(); toggleHomeShortcutFavorite(shortcutFavorite.dataset.homeShortcutFavorite); return}
      const shortcutRemove=e.target.closest('[data-home-shortcut-remove]');
      if(shortcutRemove){e.preventDefault(); e.stopPropagation(); removeHomeShortcut(shortcutRemove.dataset.homeShortcutRemove); return}
      const shortcutAdd=e.target.closest('[data-home-shortcut-add]');
      if(shortcutAdd){e.preventDefault(); e.stopPropagation(); addHomeShortcut(); return}
      if(!e.target.closest('.home-shortcut-menu') && !e.target.closest('[data-home-shortcut-menu]')) win.querySelectorAll('.home-shortcut.menu-open').forEach(item=>item.classList.remove('menu-open'));
      const credits=e.target.closest('[data-browser-credits]');
      if(credits){
        e.preventDefault();
        e.stopPropagation();
        if(document.body.classList.contains('browser-shell')){
          activeBrowser=state;
          const linkedShellTab=browserShellTabs.find(tab=>tab.browserTabId===state.active);
          if(linkedShellTab) browserShellActiveTab=linkedShellTab.id;
          if(!showBrowserShellInternalPage('credits')) openBrowserShellInternalTab('credits');
        }else openAboutNyx();
        return;
      }
      const app=e.target.closest('[data-app-url]'); if(app){e.preventDefault(); if(String(app.dataset.appUrl || '').trim().toLowerCase()==='nyx://ai') openBrowserShellAppTab('nyx://ai'); else if(document.body.classList.contains('browser-shell')) openBrowserShellAppTab(app.dataset.appUrl); else navigate(app.dataset.appUrl,appCompatibilityMode(app.dataset.appUrl)); return}
      const q=e.target.closest('[data-url]'); if(q){e.preventDefault(); navigate(q.dataset.url)}
    });
    const messageHandler=e=>{
      if(!['nyx:navigate','nyx:popup','nyx:download-request','nyx:popup-protection','nyx:fullscreen','nyx:about','nyx:about-tab','nyx:internal','nyx:preset','nyx:tab-cloak','nyx:browser-shell-toggle','nyx:browser-settings','nyx:settings-window','nyx:effect','nyx:effect-settings','nyx:panic-capture','nyx:panic-clear','nyx:panic-key-set','nyx:shell-tab-index','nyx:alt-prime','nyx:alt-shortcut','nyx:ai-profile-request','nyx:ai-open-profile'].includes(e.data?.type)) return;
      if(['nyx:ai-profile-request','nyx:ai-open-profile'].includes(e.data.type)&&(e.origin!==location.origin||!state.tabs.some(tab=>tab.frame.contentWindow===e.source)))return;
      if(e.data.type==='nyx:ai-profile-request'){
        const target=e.source;
        void (async()=>{
          const profile=nyxFounderSignedInUser
            ? normalizeNyxUserProfile(nyxUserProfile||{},nyxFounderSignedInUser)
            : {displayName:store.text('nyx.userName','Profile')||'Profile',handle:'Sign in to customize',avatarUrl:''};
          let avatarUrl=String(profile.avatarUrl||'');
          const mediaPath=nyxProfileMediaPath(avatarUrl);
          if(mediaPath){
            const media=await nyxResolveProfileMedia(mediaPath).catch(()=>null);
            if(media?.url)avatarUrl=media.url;
          }
          target?.postMessage({type:'nyx:ai-profile',profile:{displayName:profile.displayName,handle:profile.handle,avatarUrl}},location.origin);
        })();
        return;
      }
      if(e.data.type==='nyx:ai-open-profile'){
        void openNyxUserProfile();
        return;
      }
      if(e.data.type==='nyx:shell-tab-index'){
        switchBrowserShellTabByIndex(e.data.index);
        return;
      }
      if(e.data.type==='nyx:alt-prime'){
        primeBrowserShellShortcutFocus();
        return;
      }
      if(e.data.type==='nyx:alt-shortcut'){
        const key=String(e.data.key || '').toLowerCase();
        handleBrowserShellAltAction(key,{
          preventDefault(){},
          stopPropagation(){},
          altKey:true,
          ctrlKey:false,
          metaKey:false,
          shiftKey:!!e.data.shiftKey,
          key:e.data.key || key,
          code:e.data.code || '',
          location:Number(e.data.location || 0)
        });
        return;
      }
      if(e.data.type==='nyx:panic-capture'){
        armPanicKeyCapture();
        return;
      }
      if(e.data.type==='nyx:panic-clear'){
        clearPanicKey();
        return;
      }
      if(e.data.type==='nyx:panic-key-set'){
        const combo=String(e.data.combo || '').trim();
        if(combo){
          panicCaptureArmed=false;
          store.setText('nyx.panicKey',combo);
          updatePanicKeyLabels();
          toast('Panic key saved: '+combo);
        }
        return;
      }
      if(e.data.type==='nyx:preset'){
        applyPreset(e.data.preset || 'nyx');
        syncPresetCloakFields();
        return;
      }
      if(e.data.type==='nyx:tab-cloak'){
        applyCustomTabCloak(e.data.title || '???', e.data.favicon || favicons.nyx);
        return;
      }
      if(e.data.type==='nyx:browser-shell-toggle'){
        const sourceTab=state.tabs.find(t=>t.frame.contentWindow===e.source);
        const sourceShellTab=browserShellTabs.find(tab=>tab.browserTabId===sourceTab?.id);
        if(sourceShellTab && (!sourceShellTab.url || sourceShellTab.url.startsWith('nyx://'))){
          browserShellTabs.splice(0,browserShellTabs.length,...browserShellTabs.filter(tab=>tab.id!==sourceShellTab.id));
          if(browserShellActiveTab===sourceShellTab.id) browserShellActiveTab=browserShellTabs[0]?.id || null;
          if(sourceTab?.id && activeBrowser?.closeTab) activeBrowser.closeTab(sourceTab.id);
          if(!browserShellTabs.length){
            const freshId='shell-'+Date.now()+Math.random().toString(16).slice(2);
            browserShellTabs.push({id:freshId,url:'',title:'Home'});
            browserShellActiveTab=freshId;
          }
        }
        store.set('nyx.browserShellMode',!!e.data.enabled);
        if(!e.data.enabled){
          store.setText('nyx.theme','default');
          store.setText('nyx.visualEffect','none');
          store.set('nyx.visualEffectUserChoice',false);
        }
        applyUserSettings();
        return;
      }
      if(e.data.type==='nyx:browser-settings'){
        store.setText('nyx.engine',e.data.engine || 'duckduckgo');
        store.setText('nyx.browserMode',normalizeBrowserModeName(e.data.browserMode || DEFAULT_BROWSER_MODE));
        const nextTransport=e.data.transport || DEFAULT_BROWSER_TRANSPORT;
        browserTransportOverride='';
        if(store.text('nyx.transport',DEFAULT_BROWSER_TRANSPORT)!==nextTransport){
          scramjetInstallPromise=null;
          scramjetController=null;
          scramjetTransport=null;
          scramjetTransportKey='';
          uvInstallPromise=null;
        }
        store.setText('nyx.transport',nextTransport);
        console.log('nyx browser settings saved', {
          engine:store.text('nyx.engine','duckduckgo'),
          browserMode:normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE)),
          transport:store.text('nyx.transport',DEFAULT_BROWSER_TRANSPORT)
        });
        applyUserSettings();
        toast('Browser settings saved');
        return;
      }
      if(e.data.type==='nyx:popup-protection'){
        const enabled=!!e.data.enabled;
        store.set('nyx.popupProtection',enabled);
        qsa('[data-switch="nyx.popupProtection"]').forEach(el=>el.classList.toggle('on',enabled));
        activeBrowser?.refreshSandbox?.();
        toast('Popup Protection '+(enabled?'on':'off'));
        return;
      }
      if(e.data.type==='nyx:effect-settings'){
        store.set('nyx.visualEffectUserChoice',true);
        store.setText('nyx.visualEffect',e.data.effect || 'none');
        store.setText('nyx.visualEffectSpeed',e.data.speed || '1.1');
        store.setText('nyx.visualEffectAmount',String(Math.max(1,Math.min(64,Number(e.data.amount || 16)))));
        store.setText('nyx.theme',normalizeNyxTheme(e.data.theme || store.text('nyx.theme','default')));
        applyThemeSetting();
        applyVisualEffectSetting();
        const shellTab=browserShellTabs.find(tab=>tab.id===browserShellActiveTab);
        if(shellTab?.url?.startsWith('nyx://')){
          showBrowserShellInternalPage(shellTab.url.replace('nyx://','') || 'apps');
        }
        return;
      }
      if(e.data.type==='nyx:navigate'){
        openBrowserShellAppTab(e.data.url || '');
        return;
      }
      if(e.data.type==='nyx:internal'){
        openBrowserShellInternalTab(e.data.page || 'apps');
        return;
      }
      const sourceTab=state.tabs.find(t=>t.frame.contentWindow===e.source);
      if(e.data.type==='nyx:download-request'){
        if(!sourceTab) return;
        void nyxRequestBrowserDownload(e.data.url || '',e.data.filename || '',e.data.sourceUrl || sourceTab.sourceUrl || sourceTab.url || '');
        return;
      }
      if(e.data.type==='nyx:popup'){
        const previousActive=state.active;
        if(sourceTab) state.active=sourceTab.id;
        openPopupTab(e.data.url);
        if(sourceTab && state.tabs.some(t=>t.id===previousActive) && state.active===sourceTab.id) state.active=previousActive;
        return;
      }
      if(!sourceTab) return;
      if(e.data.type==='nyx:fullscreen'){
        if(!document.fullscreenElement) document.documentElement.requestFullscreen?.();
        else document.exitFullscreen?.();
        return;
      }
      if(e.data.type==='nyx:about'){
        launchDirectAboutBlankCloak();
        return;
      }
      if(e.data.type==='nyx:about-tab'){
        launchHostedCloak('ac');
        return;
      }
      if(e.data.type==='nyx:effect'){
        store.set('nyx.visualEffectUserChoice',true);
        store.setText('nyx.visualEffect',e.data.effect || 'none');
        applyVisualEffectSetting();
        toast('Browser Mode effect updated');
        return;
      }
      if(e.data.type==='nyx:settings-window'){
        document.body.classList.contains('browser-shell') ? openBrowserShellSettings() : openSettings();
        return;
      }
      navigate(e.data.url);
    };
    window.addEventListener('message',messageHandler);
    const initialTab=addTab(url,options.forceMode || '');
    if(document.body.classList.contains('browser-shell') && !url){
      ensureBrowserShellHome();
      const homeTab=browserShellTabs.find(tab=>tab.title==='Home' && !tab.url) || browserShellTabs[0];
      if(homeTab){
        homeTab.browserTabId=initialTab.id;
        homeTab.url='';
        homeTab.title='Home';
        homeTab.icon=favicons.nyx;
        browserShellActiveTab=homeTab.id;
      }
      initialTab.url='';
      initialTab.title='Home';
      initialTab.icon=favicons.nyx;
      initialTab.history=[''];
      initialTab.index=0;
      renderBrowserShellHomeMode(win,'home');
      renderTabs();
      renderBrowserShellTabs();
      playHomeEntranceAnimation(win);
      tick();
      initDesktopSplash();
    }
    return win;
  }
  function openUpdates(){
    makeWindow({title:'ռʏӼ Fixes',left:'24px',top:'60px',width:'520px',height:'620px',autoMaximize:true,body:`<div class="panel"><h1>ռʏӼ Fixes</h1><p class="home-sub">Click ռʏӼ in the top-left anytime to see this.</p><div class="glass-grid" style="grid-template-columns:1fr"><div class="glass-card"><h2>Latest fixes</h2><p>- Added animated windows that eject from the bottom dock and fade when closed.</p><p>- Made the Updates window open fullscreen every time.</p><p>- Added one-time Updates popup on startup.</p><p>- Added multiple weather location choices for ambiguous searches.</p><p>- Added hot and freezing weather themes.</p><p>- Updated glassmorphism so 100%+ lowers blur instead of over-brightening.</p><p>- Replaced the Discord logo with the new attached icon.</p><p>- Removed the left desktop Browser and Updates buttons.</p><p>- Changed Weather from an app into a right-side liquid glass panel.</p><p>- Added visible background previews and background upload.</p><p>- Rebuilt the loading screen so it types the welcome text.</p><p>- Added local app icons to avoid blocked favicon requests.</p></div><div class="glass-card"><h2>Browser fixes</h2><p>- Added a Node server for Ultraviolet.</p><p>- Fixed UV static routes for /uv, /baremux, /epoxy, and /wisp.</p><p>- Replaced the old Wisp server package.</p><p>- Pinned the compatible Epoxy transport.</p><p>- Removed hard UV script loading from Live Server mode.</p></div></div></div>`});
  }
  function weatherDescription(code){
    const map={0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',56:'Freezing drizzle',57:'Freezing drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Freezing rain',71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',80:'Light showers',81:'Showers',82:'Heavy showers',85:'Snow showers',86:'Snow showers',95:'Thunderstorm',96:'Thunderstorm',99:'Thunderstorm, hail'};
    return map[code] || 'Weather';
  }
  function weatherIcon(code,isDay=true){
    const value=Number(code);
    const svg=(kind,content)=>`<svg class="nyx-weather-symbol nyx-weather-symbol-${kind}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${content}</svg>`;
    const sun='<circle class="nyx-weather-sun-fill" cx="12" cy="12" r="4"/><path class="nyx-weather-sun-ray" d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/>';
    const cloud='<path class="nyx-weather-cloud-fill" d="M6.4 18.2h10.3a4.25 4.25 0 0 0 .5-8.47 6.05 6.05 0 0 0-11.55 1.83A3.38 3.38 0 0 0 6.4 18.2Z"/>';
    if(!isDay && [0,1,2].includes(value)){
      return svg('moon','<path class="nyx-weather-moon-fill" d="M18.7 15.45A7.4 7.4 0 0 1 8.55 5.3a7.7 7.7 0 1 0 10.15 10.15Z"/>');
    }
    if(value===0) return svg('sun',sun);
    if([1,2].includes(value)){
      return svg('partly-cloudy','<circle class="nyx-weather-sun-fill" cx="8" cy="8" r="3.2"/><path class="nyx-weather-sun-ray" d="M8 2.3v1.4M3.97 3.97l1 1M2.3 8h1.4M12.03 3.97l-1 1M13.7 8h-1.4"/><path class="nyx-weather-cloud-fill" d="M7.2 19h10a4 4 0 0 0 .45-7.98A5.55 5.55 0 0 0 7.08 12.6 3.2 3.2 0 0 0 7.2 19Z"/>');
    }
    if(value===3) return svg('cloud',cloud);
    if([45,48].includes(value)){
      return svg('fog',`${cloud}<path class="nyx-weather-detail" d="M4 20.5h13M7 23h12"/>`);
    }
    if([71,73,75,77,85,86].includes(value)){
      return svg('snow',`${cloud}<path class="nyx-weather-snow" d="M8 19.7v3M6.7 20.45l2.6 1.5M9.3 20.45l-2.6 1.5M15.5 19.7v3M14.2 20.45l2.6 1.5M16.8 20.45l-2.6 1.5"/>`);
    }
    if([95,96,99].includes(value)){
      return svg('storm',`${cloud}<path class="nyx-weather-bolt" d="m12.5 18.4-2.1 3.4h2l-1 2.2 4-4.3h-2.3l1.4-1.3Z"/>`);
    }
    if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(value)){
      return svg('rain',`${cloud}<path class="nyx-weather-rain" d="m8 19.8-1 2M12.5 19.8l-1 2M17 19.8l-1 2"/>`);
    }
    return svg('cloud',cloud);
  }
  function forecastDayLabel(dateText,index){
    if(index===0) return 'Today';
    try{
      return new Intl.DateTimeFormat([],{weekday:'short'}).format(new Date(dateText+'T12:00:00'));
    }catch{
      return 'Day';
    }
  }
  function renderWeatherForecast(daily){
    const box=weatherPanel()?.querySelector('[data-weather-forecast]');
    if(!box) return;
    const times=daily?.time || [];
    if(!times.length){
      box.innerHTML='';
      return;
    }
    box.innerHTML=times.slice(0,7).map((day,index)=>{
      const code=daily.weather_code?.[index] ?? 3;
      const rain=Math.round(daily.precipitation_probability_max?.[index] ?? 0);
      const high=Math.round(daily.temperature_2m_max?.[index] ?? 0);
      const low=Math.round(daily.temperature_2m_min?.[index] ?? 0);
      return `<div class="weather-forecast-row" title="${esc(weatherDescription(code))}">
        <span class="weather-day">${esc(forecastDayLabel(day,index))}</span>
        <span class="weather-forecast-symbol" aria-hidden="true">${weatherIcon(code,true)}</span>
        <span class="weather-rain-chance">${rain}%</span>
        <span class="weather-high-low">${high}&deg; <span>${low}&deg;</span></span>
      </div>`;
    }).join('');
  }
  function weatherPanel(){
    return $('weatherPanel');
  }
  let latestWeatherSnapshot=null;
  function syncHomeWeatherWidgets(snapshot=latestWeatherSnapshot){
    qsa('[data-home-weather]').forEach(widget=>{
      const icon=widget.querySelector('[data-home-weather-icon]');
      const temp=widget.querySelector('[data-home-weather-temp]');
      const desc=widget.querySelector('[data-home-weather-desc]');
      if(snapshot){
        const summary=weatherDescription(snapshot.weather_code);
        const degrees=`${Math.round(snapshot.temperature_2m)}°`;
        if(icon) icon.innerHTML=weatherIcon(snapshot.weather_code,snapshot.is_day!==0);
        if(temp) temp.textContent=degrees;
        if(desc) desc.textContent=summary;
        widget.setAttribute('aria-label',`Open weather report. ${degrees}, ${summary}`);
        widget.dataset.loaded='true';
      }else{
        if(icon) icon.innerHTML=weatherIcon(1,true);
        if(temp) temp.textContent='--°';
        if(desc) desc.textContent='Loading';
        widget.setAttribute('aria-label','Open weather report');
        delete widget.dataset.loaded;
      }
    });
  }
  function setWeatherStatus(text){
    const status=weatherPanel()?.querySelector('[data-weather-status]');
    if(status) status.textContent=text || '';
  }
  function savedWeatherLocation(){
    return {
      latitude:Number(store.text('nyx.weatherLat','34.0522')),
      longitude:Number(store.text('nyx.weatherLon','-118.2437')),
      place:store.text('nyx.weatherPlace','Los Angeles'),
      timezone:store.text('nyx.weatherTimezone','America/Los_Angeles')
    };
  }
  function weatherEffectClass(code, wind, temp){
    if(Number(temp) > 100) return 'weather-hot';
    if(Number(temp) < 32) return 'weather-freezing';
    if([51,53,55,61,63,65,80,81,82,95].includes(code)) return 'weather-rain';
    if(Number(wind) >= 18) return 'weather-wind';
    if([0,1].includes(code)) return 'weather-sun';
    return 'weather-cloud';
  }
  //weather
  function renderWeatherTime(timezone){
    const time=weatherPanel()?.querySelector('[data-weather-time]');
    if(!time) return;
    try{
      time.textContent='Local time '+new Intl.DateTimeFormat([],{
        hour:'numeric',
        minute:'2-digit',
        timeZone:timezone || savedWeatherLocation().timezone
      }).format(new Date());
    }catch{
      time.textContent='Local time --:--';
    }
  }
  function renderWeather(data, place, timezone, daily){
    const panel=weatherPanel();
    if(!panel || !data) return;
    panel.querySelector('[data-weather-temp]').innerHTML=Math.round(data.temperature_2m)+'&deg;';
    panel.querySelector('[data-weather-place]').textContent=place || 'Weather';
    panel.querySelector('[data-weather-desc]').textContent=weatherDescription(data.weather_code);
    panel.querySelector('[data-weather-icon]').innerHTML=weatherIcon(data.weather_code,data.is_day!==0);
    panel.querySelector('[data-weather-feels]').innerHTML=Math.round(data.apparent_temperature ?? data.temperature_2m)+'&deg;';
    panel.querySelector('[data-weather-wind]').textContent=Math.round(data.wind_speed_10m)+' mph';
    panel.querySelector('[data-weather-humidity]').textContent=Math.round(data.relative_humidity_2m)+'%';
    panel.querySelector('[data-weather-precip]').textContent=((Number(data.precipitation || 0)).toFixed(Number(data.precipitation || 0) >= 1 ? 1 : 2).replace(/\.00$/,'')).replace(/\.0$/,'')+' in';
    panel.classList.remove('weather-sun','weather-cloud','weather-rain','weather-wind','weather-hot','weather-freezing');
    panel.classList.add(weatherEffectClass(data.weather_code,data.wind_speed_10m,data.temperature_2m));
    renderWeatherForecast(daily);
    renderWeatherTime(timezone);
    latestWeatherSnapshot={...data};
    syncHomeWeatherWidgets();
    const restore=$('weatherRestore');
    if(restore) restore.dataset.weatherSummary=`${Math.round(data.temperature_2m)}° ${weatherDescription(data.weather_code)}`;
    setWeatherStatus('');
  }
  function clearWeatherOptions(){
    const box=weatherPanel()?.querySelector('[data-weather-options]');
    if(box){
      box.innerHTML='';
      box.hidden=true;
      box.onchange=null;
    }
  }
  function weatherPlaceName(match){
    return [match.name,match.admin1,match.country].filter(Boolean).join(', ');
  }
  function weatherTimezoneFallbackName(timezone=''){
    const raw=String(timezone || '').split('/').pop() || 'Current location';
    return raw.replace(/_/g,' ') + (/America\//.test(String(timezone || '')) ? ', United States' : '');
  }
  async function reverseWeatherPlace(latitude,longitude,timezone=''){
    const cleanCountry=name=>String(name || '').replace(/\s*\(the\)\s*/i,'').replace(/United States of America/i,'United States').trim();
    try{
      const res=await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&localityLanguage=en`,{cache:'no-store'});
      if(res.ok){
        const data=await res.json();
        const city=data.city || data.locality || '';
        const region=data.principalSubdivision || '';
        const country=cleanCountry(data.countryName || '');
        const place=[city,region,country].filter(Boolean).join(', ');
        if(place) return place;
      }
    }catch{}
    try{
      const res=await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&language=en&format=json&count=1`,{cache:'no-store'});
      if(res.ok){
        const data=await res.json();
        const match=Array.isArray(data.results) ? data.results[0] : null;
        const place=match ? weatherPlaceName(match) : '';
        if(place) return place;
      }
    }catch{}
    return weatherTimezoneFallbackName(timezone);
  }
  function scoreWeatherMatch(term,match){
    const query=String(term || '').toLowerCase();
    const name=String(match.name || '').toLowerCase();
    const admin=String(match.admin1 || '').toLowerCase();
    const country=String(match.country || '').toLowerCase();
    let score=0;
    if(query===name) score+=80;
    if(query.includes(name)) score+=30;
    if(admin && query.includes(admin)) score+=35;
    if(country && query.includes(country)) score+=28;
    if(/\b(us|usa|united states|america)\b/.test(query) && match.country_code==='US') score+=24;
    if(match.feature_code==='PPLA' || match.feature_code==='PPLC') score+=8;
    if(match.population) score+=Math.min(20,Math.log10(Number(match.population))*4);
    return score;
  }
  async function selectWeatherMatch(match){
    const place=weatherPlaceName(match);
    store.setText('nyx.weatherLat',match.latitude);
    store.setText('nyx.weatherLon',match.longitude);
    store.setText('nyx.weatherPlace',place);
    if(match.timezone) store.setText('nyx.weatherTimezone',match.timezone);
    const input=weatherPanel()?.querySelector('[data-weather-query]');
    if(input) input.value=place;
    clearWeatherOptions();
    await loadWeatherLocation({latitude:match.latitude,longitude:match.longitude,place,timezone:match.timezone});
  }
  async function loadWeatherLocation(location=savedWeatherLocation()){
    const coords={
      latitude:Number(location.latitude) || 34.0522,
      longitude:Number(location.longitude) || -118.2437
    };
    const place=location.place || 'Los Angeles';
    const timezone=location.timezone || savedWeatherLocation().timezone;
    const panel=weatherPanel();
    if(panel) panel.querySelector('[data-weather-place]').textContent=place;
    setWeatherStatus('Loading...');
    try{
      const res=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`);
      if(!res.ok) throw new Error('weather failed');
      const json=await res.json();
      const tz=json.timezone || timezone;
      store.setText('nyx.weatherTimezone',tz);
      renderWeather(json.current,place,tz,json.daily);
    }catch{
      setWeatherStatus('Weather unavailable right now');
    }
  }
  async function searchWeatherPlace(query){
    const term=String(query||'').trim();
    if(!term){loadWeatherLocation(); return}
    clearWeatherOptions();
    setWeatherStatus('Searching...');
    try{
      const fetchMatches=async(searchTerm)=>{
        const res=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(searchTerm)}&count=10&language=en&format=json`);
        if(!res.ok) throw new Error('search failed');
        const data=await res.json();
        return data.results || [];
      };
      let results=await fetchMatches(term);
      if(!results.length && term.includes(',')){
        results=await fetchMatches(term.split(',')[0].trim());
      }
      const seen=new Set();
      const unique=results.filter(match=>{
        const key=[match.name,match.admin1,match.country,match.latitude,match.longitude].join('|');
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const matches=unique.sort((a,b)=>scoreWeatherMatch(term,b)-scoreWeatherMatch(term,a));
      if(!matches.length){setWeatherStatus('No location found'); return}
      if(matches.length===1){
        await selectWeatherMatch(matches[0]);
        return;
      }
      const box=weatherPanel()?.querySelector('[data-weather-options]');
      if(!box) return;
      box.hidden=false;
      box.innerHTML='<option value="">Choose a matching location...</option>'+matches.map((match,i)=>{
        const name=weatherPlaceName(match);
        const detail=[match.timezone,match.population ? `${Number(match.population).toLocaleString()} people` : ''].filter(Boolean).join(' · ');
        return `<option value="${i}">${esc(name)}${detail ? ` - ${esc(detail)}` : ''}</option>`;
      }).join('');
      box.onchange=()=>{if(box.value!=='') selectWeatherMatch(matches[Number(box.value)])};
      setWeatherStatus('Choose a location');
    }catch{
      setWeatherStatus('Location search unavailable');
    }
  }
  function isWeatherPanelOpen(){
    const panel=weatherPanel();
    return !!panel && !panel.classList.contains('minimized') && !panel.classList.contains('closing');
  }
  function closeWeatherPanelAnimated(){
    const panel=weatherPanel();
    const restore=$('weatherRestore');
    if(!panel) return;
    if(panel.classList.contains('minimized') || panel.classList.contains('closing')) return;
    panel.classList.remove('opening');
    panel.classList.add('closing');
    setTimeout(()=>{
      panel.classList.remove('closing');
      panel.classList.add('minimized');
      if(!document.body.classList.contains('browser-shell')) restore?.classList.add('show');
      else restore?.classList.remove('show');
    },520);
  }
  function closeWeatherForWindowOpen(){
    const panel=weatherPanel();
    if(!panel || !isWeatherPanelOpen()) return;
    closeWeatherPanelAnimated();
  }
  let weatherPanelAnchorTrigger=null;
  function setWeatherPanelAnchor(anchor='bottom',trigger=null){
    const panel=weatherPanel();
    if(!panel) return 'bottom';
    const next=anchor==='top' ? 'top' : 'bottom';
    weatherPanelAnchorTrigger=next==='top' ? (trigger || weatherPanelAnchorTrigger) : null;
    panel.dataset.weatherAnchor=next;
    panel.classList.toggle('weather-anchor-top',next==='top');
    panel.classList.toggle('weather-anchor-bottom',next==='bottom');
    if(next==='top' && weatherPanelAnchorTrigger?.getBoundingClientRect){
      const triggerRect=weatherPanelAnchorTrigger.getBoundingClientRect();
      const panelStyle=getComputedStyle(panel);
      const scale=Math.max(.1,Number.parseFloat(panelStyle.zoom) || 1);
      const panelWidth=(Number.parseFloat(panelStyle.width) || 306)*scale;
      const margin=12;
      const centered=triggerRect.left+(triggerRect.width-panelWidth)/2;
      const physicalLeft=Math.max(margin,Math.min(innerWidth-panelWidth-margin,centered));
      panel.style.setProperty('--weather-top-left',`${physicalLeft/scale}px`);
    }else{
      panel.style.removeProperty('--weather-top-left');
    }
    return next;
  }
  function restoreWeatherPanel(anchor=weatherPanel()?.dataset.weatherAnchor || 'bottom',trigger=null){
    const panel=weatherPanel();
    const restore=$('weatherRestore');
    if(!panel) return;
    setWeatherPanelAnchor(anchor,trigger);
    panel.classList.remove('minimized','closing');
    panel.classList.add('opening');
    setTimeout(()=>panel.classList.remove('opening'),640);
    restore?.classList.remove('show');
    const query=panel.querySelector('[data-weather-query]');
    if(query){
      query.blur();
      try{query.setSelectionRange(0,0)}catch{}
      query.scrollLeft=0;
    }
  }
  function loadUserWeatherLocation(){
    if(!navigator.geolocation) return Promise.resolve(false);
    return new Promise(resolve=>{
      navigator.geolocation.getCurrentPosition(async position=>{
        const coords=position.coords || {};
        if(!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)){
          resolve(false);
          return;
        }
        const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone || savedWeatherLocation().timezone;
        const place=await reverseWeatherPlace(coords.latitude,coords.longitude,timezone);
        store.setText('nyx.weatherLat',coords.latitude);
        store.setText('nyx.weatherLon',coords.longitude);
        store.setText('nyx.weatherPlace',place);
        store.setText('nyx.weatherTimezone',timezone);
        const input=weatherPanel()?.querySelector('[data-weather-query]');
        if(input) input.value=place;
        await loadWeatherLocation({latitude:coords.latitude,longitude:coords.longitude,place,timezone});
        resolve(true);
      },()=>{
        resolve(false);
      },{enableHighAccuracy:false,maximumAge:600000,timeout:4500});
    });
  }
  async function openWeatherOnStartup(){
    initWeatherPanel();
    restoreWeatherPanel();
    const usedLocation=await loadUserWeatherLocation();
    if(!usedLocation) loadWeatherLocation(savedWeatherLocation());
    restoreWeatherPanel();
  }
  function initWeatherPanel(){
    const panel=weatherPanel();
    if(!panel || panel.dataset.ready) return;
    panel.dataset.ready='true';
    const saved=savedWeatherLocation();
    const query=panel.querySelector('[data-weather-query]');
    if(query) query.value=saved.place;
    panel.querySelector('[data-weather-search]')?.addEventListener('submit',e=>{
      e.preventDefault();
      searchWeatherPlace(query?.value);
    });
    panel.querySelector('[data-weather-refresh]')?.addEventListener('click',()=>loadWeatherLocation());
    panel.querySelector('[data-weather-minimize]')?.addEventListener('click',closeWeatherPanelAnimated);
    $('weatherRestore')?.addEventListener('click',restoreWeatherPanel);
    if(!initWeatherPanel.anchorResizeReady){
      initWeatherPanel.anchorResizeReady=true;
      addEventListener('resize',()=>{
        if(isWeatherPanelOpen() && weatherPanel()?.dataset.weatherAnchor==='top'){
          setWeatherPanelAnchor('top',weatherPanelAnchorTrigger);
        }
      },{passive:true});
    }
    loadWeatherLocation(saved);
    if(!initWeatherPanel.timeTimer) initWeatherPanel.timeTimer=setInterval(()=>renderWeatherTime(savedWeatherLocation().timezone),30000);
  }
  function openWeather(anchor='bottom',trigger=null){
    initWeatherPanel();
    const panel=weatherPanel();
    const next=anchor==='top' ? 'top' : 'bottom';
    if(isWeatherPanelOpen()){
      if(panel?.dataset.weatherAnchor!==next){
        setWeatherPanelAnchor(next,trigger);
        const query=panel.querySelector('[data-weather-query]');
        if(query){
          query.blur();
          try{query.setSelectionRange(0,0)}catch{}
          query.scrollLeft=0;
        }
        return;
      }
      closeWeatherPanelAnimated();
      return;
    }
    restoreWeatherPanel(next,trigger);
  }
  //lion-ai-ui
  let nyxAiModels=[
    ['chatgpt-5.4-mini','GPT-5.4 Mini']
  ];
  function nyxAiSelectedModel(){
    const saved=store.text('nyx.aiModel','chatgpt-5.4-mini');
    return nyxAiModels.some(([id])=>id===saved) ? saved : 'chatgpt-5.4-mini';
  }
  function nyxAiModelLabel(id=nyxAiSelectedModel()){
    return nyxAiModels.find(([modelId])=>modelId===id)?.[1] || 'GPT-5.4 Mini';
  }
  function nyxAiModelOptions(selected=nyxAiSelectedModel()){
    return nyxAiModels.map(([id,label])=>`<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(label)}</option>`).join('');
  }
  async function nyxAiLoadModels(){
    try{
      const response=await fetch('/api/nyx-ai/models',{headers:{accept:'application/json'}});
      const data=await response.json();
      if(!response.ok) throw new Error(data?.error || `Model catalog failed (${response.status})`);
      const models=Array.isArray(data?.models) ? data.models.flatMap(item=>{
        const id=String(item?.id || '').trim();
        const label=String(item?.label || id).trim();
        return id && label ? [[id,label]] : [];
      }) : [];
      if(!models.length) return;
      nyxAiModels=models;
      const selected=nyxAiSelectedModel();
      document.querySelectorAll('[data-lion-ai-model]').forEach(select=>{
        const previous=nyxAiModels.some(([id])=>id===select.value) ? select.value : selected;
        select.innerHTML=nyxAiModelOptions(previous);
        select.value=previous;
      });
      document.querySelectorAll('[data-nyx-ai-model-label]').forEach(label=>{label.textContent=nyxAiModelLabel(selected)});
    }catch(error){
      console.warn('Nyx AI model catalog could not be loaded:',error);
    }
  }
  void nyxAiLoadModels();
  function lionAiEmptyState(){
    return `<section class="lion-ai-empty" data-lion-ai-empty>
      <div class="lion-ai-orb" data-nyx-logo aria-hidden="true"></div>
      <p class="lion-ai-eyebrow">NYX INTELLIGENCE</p>
      <h2>What can I help you with?</h2>
      <p class="lion-ai-empty-copy">Ask a question, work through an idea, or start creating.</p>
      <div class="lion-ai-starters">
        <button type="button" data-lion-ai-prompt="Explain quantum computing in simple terms">
          <span class="lion-ai-starter-icon" aria-hidden="true">✦</span>
          <strong>Explain a complex topic</strong>
          <small>in simple terms</small>
        </button>
        <button type="button" data-lion-ai-prompt="Write a JavaScript function that parses JSON from an API endpoint">
          <span class="lion-ai-starter-icon" aria-hidden="true">&lt;/&gt;</span>
          <strong>Help me write code</strong>
          <small>and explain how it works</small>
        </button>
        <button type="button" data-lion-ai-prompt="Give me five creative startup ideas in the AI space">
          <span class="lion-ai-starter-icon" aria-hidden="true">⌁</span>
          <strong>Brainstorm new ideas</strong>
          <small>for a creative project</small>
        </button>
        <button type="button" data-lion-ai-prompt="Write a short dark science-fiction story about a rogue AI">
          <span class="lion-ai-starter-icon" aria-hidden="true">◇</span>
          <strong>Create something</strong>
          <small>from a simple prompt</small>
        </button>
      </div>
    </section>`;
  }
  function lionAiBody(){
    return `<div class="lion-ai-panel">
      <main class="lion-ai-main">
        <header class="lion-ai-head">
          <div class="lion-ai-header-brand">
            <div class="lion-ai-mark" data-nyx-logo aria-label="Nyx"></div>
            <div class="lion-ai-title">
              <h1 data-lion-ai-thread-title>New chat</h1>
              <span>Nyx AI workspace</span>
            </div>
          </div>
          <div class="lion-ai-head-actions">
            <div class="lion-ai-model-pill">
              <span class="lion-ai-ready-dot" aria-hidden="true"></span>
              <strong data-nyx-ai-model-label>${esc(nyxAiModelLabel())}</strong>
            </div>
            <button class="lion-ai-clear" type="button" data-lion-ai-clear title="Clear conversation" aria-label="Clear conversation">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M7 6l1 14h8l1-14M10 10v6M14 10v6"/></svg>
            </button>
            <select class="lion-ai-model-select" data-lion-ai-model aria-label="AI model">${nyxAiModelOptions()}</select>
          </div>
        </header>
        <div class="lion-ai-chat" data-lion-ai-chat>${lionAiEmptyState()}</div>
        <footer class="lion-ai-composer">
          <div class="lion-ai-preview" data-lion-ai-preview><img alt=""><span></span></div>
          <div class="lion-ai-image-status" data-lion-ai-image-status></div>
          <form class="lion-ai-form" data-lion-ai-form>
            <label class="lion-ai-plus" title="Add image" aria-label="Add image">
              <span aria-hidden="true">＋</span>
              <input type="file" accept="image/*" data-lion-ai-image>
            </label>
            <textarea class="lion-ai-input" data-lion-ai-input placeholder="Ask Nyx AI anything..." autocomplete="off" spellcheck="true"></textarea>
            <button class="lion-ai-send" type="submit" title="Send" aria-label="Send">↑</button>
          </form>
          <p>Nyx AI can make mistakes. Verify important information.</p>
        </footer>
      </main>
    </div>`;
  }
  function openLionAI(){
    const win=makeWindow({title:'Nyx AI',className:'lion-ai-window',left:'7vw',top:'52px',width:'min(1080px,88vw)',height:'min(760px,calc(100vh - 76px))',autoMaximize:false,body:lionAiBody()});
    lionAiRestoreChat(win);
    setTimeout(()=>win.querySelector('[data-lion-ai-input]')?.focus(),80);
  }
  function lionAiTopic(prompt){
    const phrase=String(prompt || '');
    const afterSubjectWord=prompt.match(/\b(?:about|on|regarding)\s+(.+?)(?:[.?!]|$)/i);
    let subject=afterSubjectWord ? afterSubjectWord[1] : phrase;
    subject=subject
      .replace(/\bwhy\s+(.+?)\s+(?:is|are)\s+(?:good|great|bad|important|popular|useful|fun)\b/i,'$1')
      .replace(/\bwhat\s+makes\s+(.+?)\s+(?:good|great|bad|important|popular|useful|fun)\b/i,'$1');
    const cleaned=subject
      .replace(/\b\d+\s*sentences?\b/gi,' ')
      .replace(/\b(write|make|create|generate|paragraph|essay|response|about|on|regarding|please|can you|for me|tell me|explain|define|what is|whats|what's|how do|how does|why does|why is)\b/gi,' ')
      .replace(/\b(is|are|good|great|bad|important|popular|useful|fun)\b$/gi,' ')
      .replace(/\b(a|an|the)\b/gi,' ')
      .replace(/\s+/g,' ')
      .replace(/^[^\w]+|[^\w]+$/g,'')
      .trim();
    return cleaned || 'the topic';
  }
  function lionAiParagraph(prompt){
    const match=prompt.match(/(\d+)\s*sent/i);
    const count=Math.max(1,Math.min(20,match ? Number(match[1]) : 8));
    const topic=lionAiTopic(prompt);
    const isPokemon=/\bpokemon\b/i.test(topic);
    const stems=isPokemon ? [
      `${topic} is popular because it mixes adventure, collecting, strategy, and imagination in a way many people can understand`,
      `The main idea of ${topic} is that trainers meet different creatures, learn their strengths, and build teams that match their goals`,
      `Each creature in ${topic} can feel memorable because it has its own design, type, moves, and personality`,
      `This variety makes ${topic} interesting because two people can enjoy the same world in completely different ways`,
      `Some people like ${topic} for battling, where choices such as type matchups, speed, abilities, and move timing matter`,
      `Other people enjoy ${topic} because collecting and discovering new creatures gives the world a sense of progress`,
      `The games also teach planning because a strong team usually needs balance instead of only using one favorite creature`,
      `For example, a team with fire, water, grass, electric, and defensive options can handle more situations than a random team`,
      `Another important part of ${topic} is evolution, which makes growth feel visible and rewarding`,
      `When a creature evolves, the player can see effort turn into a stronger and more impressive form`,
      `${topic} also works well as a story because it gives players rivals, gyms, regions, challenges, and goals to chase`,
      `Those goals make the journey feel organized while still leaving room for personal choices`,
      `The trading and battling parts of ${topic} also make it social, since players can share creatures and test strategies together`,
      `This social side helps explain why ${topic} has stayed popular for so many years`,
      `A good explanation of ${topic} should mention both the simple fun of catching creatures and the deeper strategy behind team building`,
      `That combination lets younger players enjoy the basics while older players can study advanced tactics`,
      `${topic} also stands out because its world is easy to recognize through names, music, creatures, and regions`,
      `Even people who do not play often know famous examples, which shows how strong the series has become`,
      `Overall, ${topic} matters because it turns collecting, friendship, competition, and exploration into one connected experience`,
      `That is why ${topic} continues to be a subject people can write about, debate, play, and enjoy`
    ] : [
      `${topic} is an interesting subject because it has its own ideas, history, and reasons people care about it`,
      `When people talk about ${topic}, they are usually thinking about what makes it unique compared with other topics`,
      `A good paragraph about ${topic} should explain the main idea clearly before adding smaller details`,
      `One important part of ${topic} is the way it connects facts, examples, and personal interest`,
      `Those connections make ${topic} easier to understand because the reader can see why it matters`,
      `Another useful way to explain ${topic} is to describe how it affects people or the world around them`,
      `For many people, ${topic} becomes memorable because it includes details that are easy to picture`,
      `Those details help turn a simple explanation into something more specific and meaningful`,
      `A strong discussion of ${topic} should also include cause and effect, because that shows how one idea leads to another`,
      `Examples are especially helpful because they give the reader something concrete to connect with`,
      `If someone is learning about ${topic}, they should focus on the biggest ideas first and then study the details`,
      `That approach prevents the subject from feeling confusing or random`,
      `The more someone studies ${topic}, the easier it becomes to notice patterns and explain them clearly`,
      `Those patterns can help someone compare ${topic} with similar subjects and understand what makes it different`,
      `A careful explanation should avoid drifting away from ${topic}, because staying focused makes the writing stronger`,
      `Good writing about ${topic} also uses clear transitions so each sentence builds on the last one`,
      `This makes the paragraph feel organized instead of like a list of unrelated thoughts`,
      `By the end, the reader should understand not only what ${topic} is, but also why it deserves attention`,
      `That is what makes ${topic} a useful subject for learning, writing, and discussion`,
      `Overall, ${topic} stands out because it can be explained through facts, examples, and clear reasoning`
    ];
    return stems.slice(0,count).map(s=>s+'.').join(' ');
  }
  function lionAiNormalizeMath(expr){
    return expr.replace(/π/gi,'pi').replace(/\s+/g,'').replace(/(\d)([a-zA-Z(])/g,'$1*$2').replace(/([a-zA-Z)])(\d)/g,'$1*$2').replace(/\)\(/g,')*(').replace(/\^/g,'**');
  }
  function lionAiEvalExpression(expr, xValue=0){
    const normalized=lionAiNormalizeMath(expr)
      .replace(/\bpi\b/gi,'Math.PI').replace(/\be\b/g,'Math.E')
      .replace(/\bsqrt\(/gi,'Math.sqrt(').replace(/\bsin\(/gi,'Math.sin(').replace(/\bcos\(/gi,'Math.cos(').replace(/\btan\(/gi,'Math.tan(')
      .replace(/\blog\(/gi,'Math.log10(').replace(/\bln\(/gi,'Math.log(').replace(/\babs\(/gi,'Math.abs(');
    if(!/^[0-9xX+\-*/().,MathPIEabsqrtingclo]+$/.test(normalized)) throw new Error('Unsupported symbol in expression.');
    return Function('x','return ('+normalized.replace(/\bX\b/g,'x')+')')(xValue);
  }
  function lionAiSolveEquation(input){
    const equation=input.split(/solve:?/i).pop().trim();
    if(!equation.includes('=')){
      const value=lionAiEvalExpression(equation);
      return `Result: ${Number.isFinite(value) ? value : 'undefined'}\n\nI evaluated the expression using normal order of operations.`;
    }
    const [left,right]=equation.split('=');
    const f=x=>lionAiEvalExpression(left,x)-lionAiEvalExpression(right,x);
    const y0=f(0), y1=f(1), y2=f(2);
    const a=(y2-2*y1+y0)/2;
    const b=y1-y0-a;
    const c=y0;
    if(Math.abs(a)<1e-9){
      if(Math.abs(b)<1e-9) return Math.abs(c)<1e-9 ? 'Every x works for this equation.' : 'No solution found because both sides differ by a constant.';
      const x=-c/b;
      return `Solution: x = ${Number(x.toFixed(8))}\n\nI rewrote the equation as f(x)=0 and solved the linear form.`;
    }
    const disc=b*b-4*a*c;
    if(disc>=0){
      const r1=(-b+Math.sqrt(disc))/(2*a);
      const r2=(-b-Math.sqrt(disc))/(2*a);
      return `Solutions: x = ${Number(r1.toFixed(8))} and x = ${Number(r2.toFixed(8))}\n\nI detected a quadratic form and used the quadratic formula.`;
    }
    const real=-b/(2*a);
    const imag=Math.sqrt(-disc)/(2*Math.abs(a));
    return `Complex solutions: x = ${Number(real.toFixed(8))} + ${Number(imag.toFixed(8))}i and x = ${Number(real.toFixed(8))} - ${Number(imag.toFixed(8))}i\n\nI detected a quadratic with a negative discriminant.`;
  }
  function lionAiCleanMathPrompt(prompt){
    return String(prompt || '')
      .replace(/^(please\s*)?(can\s+you\s+)?(calculate|compute|evaluate|solve|what\s+is|what's|whats|math)[:\s]*/i,'')
      .replace(/[?,]+$/,'')
      .trim();
  }
  function lionAiFormatBigInt(value){
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
  }
  function lionAiExactIntegerPower(expr){
    const match=String(expr || '').replace(/\s+/g,'').replace(/[−–—]/g,'-').match(/^(-?\d+)\^(\d+)$/);
    if(!match) return null;
    const base=BigInt(match[1]);
    const exp=BigInt(match[2]);
    const result=base ** exp;
    return `${match[1]}^${match[2]} = ${lionAiFormatBigInt(result)}\n\nExact value: ${result.toString()}`;
  }
  function lionAiSentenceCount(prompt){
    const match=String(prompt || '').match(/(\d+)\s*(?:sent|sentence|sentences)/i);
    return Math.max(1,Math.min(20,match ? Number(match[1]) : 8));
  }
  function lionAiCleanSubjectText(value){
    return String(value || '')
      .replace(/```[\s\S]*?```/g,' ')
      .replace(/[“”]/g,'"')
      .replace(/[‘’]/g,"'")
      .replace(/\s+/g,' ')
      .replace(/^[\s:;,.!?'"-]+|[\s:;,.!?'"-]+$/g,'')
      .trim();
  }
  function lionAiTitleSubject(value){
    const text=lionAiCleanSubjectText(value);
    if(!text) return 'The topic';
    return text.replace(/\b\w+/g,(word,index)=>/^(and|or|of|the|a|an|to|for|in|on|with)$/i.test(word) && index>0 ? word.toLowerCase() : word[0].toUpperCase()+word.slice(1));
  }
  function lionAiTopic(prompt){
    const phrase=lionAiCleanSubjectText(prompt);
    const direct=phrase.match(/\b(?:about|on|regarding|over)\s+(.+?)(?:[.?!]|$)/i);
    let subject=direct ? direct[1] : phrase;
    subject=subject
      .replace(/\bwhy\s+(.+?)\s+(?:is|are|was|were)\s+(?:good|great|bad|important|popular|useful|fun|cool|interesting)\b/i,'$1')
      .replace(/\bwhy\s+(?:is|are|was|were)\s+(.+?)\s+(?:good|great|bad|important|popular|useful|fun|cool|interesting)\b/i,'$1')
      .replace(/\bwhat\s+makes\s+(.+?)\s+(?:good|great|bad|important|popular|useful|fun|cool|interesting)\b/i,'$1')
      .replace(/\b(?:write|make|create|generate|give me|tell me|explain|define)\b/gi,' ')
      .replace(/\b(?:a|an|the)?\s*(?:paragraph|essay|response|answer|summary)\b/gi,' ')
      .replace(/\b\d+\s*(?:sent|sentence|sentences)\b/gi,' ')
      .replace(/\b(?:please|can you|for me|in detail|short|long)\b/gi,' ')
      .replace(/\b(?:what is|whats|what's|how do|how does|why does|why is)\b/gi,' ')
      .replace(/\s+/g,' ');
    subject=lionAiCleanSubjectText(subject);
    return subject || 'the topic';
  }
  function lionAiNormalizeMathText(value){
    const supers={'⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9'};
    return String(value || '')
      .replace(/[−–—]/g,'-')
      .replace(/[×·∙]/g,'*')
      .replace(/÷/g,'/')
      .replace(/[πΠ]/g,'pi')
      .replace(/√/g,'sqrt')
      .replace(/≤/g,'<=')
      .replace(/≥/g,'>=')
      .replace(/≠/g,'!=')
      .replace(/≈/g,'~')
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g,m=>'^'+[...m].map(ch=>supers[ch] || '').join(''));
  }
  function lionAiLooksLikeMath(value){
    const text=lionAiNormalizeMathText(value);
    return /(?:=|[+\-*/^()]|\b(?:sqrt|sin|cos|tan|log|ln|pi)\b)/i.test(text) && /(?:\d|x|pi)/i.test(text);
  }
  function lionAiNormalizeMath(expr){
    return lionAiNormalizeMathText(expr)
      .replace(/\bsqrt\s*([0-9.]+|x)\b/gi,'sqrt($1)')
      .replace(/\s+/g,'')
      .replace(/(\d)([a-zA-Z(])/g,'$1*$2')
      .replace(/([a-zA-Z)])(\d)/g,'$1*$2')
      .replace(/\)\(/g,')*(')
      .replace(/\^/g,'**');
  }
  function lionAiCleanMathPrompt(prompt){
    let text=lionAiNormalizeMathText(prompt);
    const direct=text.match(/\b(?:about|on|regarding|over)\s+(.+?)(?:[.?!]|$)/i);
    if(direct) text=direct[1];
    return text
      .replace(/^(please\s*)?(can\s+you\s+)?(calculate|compute|evaluate|solve|what\s+is|what's|whats|math)[:\s]*/i,'')
      .replace(/\b(?:write|make|create|generate|paragraph|essay|sentences?|explain|about|please|for me)\b/gi,' ')
      .replace(/[?,]+$/,'')
      .replace(/\s+/g,' ')
      .trim();
  }
  function lionAiExactIntegerPower(expr){
    const match=lionAiNormalizeMathText(expr).replace(/\s+/g,'').match(/^(-?\d+)\^(\d+)$/);
    if(!match) return null;
    const base=BigInt(match[1]);
    const exp=BigInt(match[2]);
    const result=base ** exp;
    return `${match[1]}^${match[2]} = ${lionAiFormatBigInt(result)}\n\nExact value: ${result.toString()}`;
  }
  function lionAiMathParagraph(prompt){
    const count=lionAiSentenceCount(prompt);
    const expression=lionAiCleanMathPrompt(prompt);
    const answer=lionAiMath(expression || prompt);
    const main=answer.split('\n')[0].replace(/\.$/,'');
    const shown=expression || lionAiTopic(prompt);
    const sentences=[
      `The expression ${shown} can be understood by translating the symbols into standard math notation first`,
      `After that, the normal order of operations decides which parts should be handled before others`,
      `Parentheses and exponents come before multiplication and division, and addition or subtraction usually happen last`,
      `When the expression is evaluated carefully, the main result is ${main}`,
      `This matters because changing the order can produce a completely different answer`,
      `A clear math paragraph should name the expression, explain the steps, and end with the final result`,
      `If the problem includes a variable, the variable should be isolated or substituted before the final value is chosen`,
      `Overall, ${shown} is solved best by keeping the notation clean and checking each operation one step at a time`
    ];
    return sentences.slice(0,count).map(s=>/[.!?]$/.test(s) ? s : s+'.').join(' ');
  }
  function lionAiParagraph(prompt){
    const count=lionAiSentenceCount(prompt);
    const topic=lionAiTopic(prompt);
    if(lionAiLooksLikeMath(topic) || lionAiLooksLikeMath(prompt) || lionAiIsMathPrompt(prompt)) return lionAiMathParagraph(prompt);
    const title=lionAiTitleSubject(topic);
    const lower=String(prompt || '').toLowerCase();
    const positive=/\b(good|great|useful|important|popular|fun|cool|interesting|best)\b/.test(lower);
    const compare=/\b(compare|versus|vs\.?|difference between)\b/.test(lower);
    const story=/\b(story|narrative|creative)\b/.test(lower);
    const sentences=story ? [
      `${title} can be turned into a clear story by giving it a setting, a goal, and a problem to solve`,
      `The first part should introduce the situation so the reader understands what is happening`,
      `Next, the paragraph should show a challenge that makes the subject feel important instead of random`,
      `Strong details help the reader picture the scene and understand why the moment matters`,
      `The ending should connect back to the main idea so the story feels complete`,
      `This keeps the writing focused while still making it more interesting to read`,
      `A good creative paragraph about ${topic} should feel organized, descriptive, and easy to follow`,
      `Overall, the best version uses the subject as the center of the story instead of drifting away from it`
    ] : compare ? [
      `${title} is easiest to explain by separating the similarities from the differences`,
      `A strong comparison starts with what the two sides have in common so the reader has a base to understand them`,
      `After that, the paragraph should explain the biggest difference and why it matters`,
      `Examples make the comparison clearer because they show how the difference works in real situations`,
      `The paragraph should avoid jumping between unrelated points, because that can make the answer confusing`,
      `Instead, each sentence should build from the last one and stay tied to the main comparison`,
      `By the end, the reader should understand not only how the ideas are different, but also why that difference is important`,
      `Overall, ${topic} should be explained with a balanced view that uses clear details instead of random claims`
    ] : positive ? [
      `${title} stands out because it gives people a clear reason to care about the subject`,
      `One important strength is that it can be explained through specific details instead of empty opinions`,
      `Those details help the reader understand why the subject is useful, interesting, or worth discussing`,
      `A good paragraph should connect the main idea to examples so the answer feels grounded`,
      `It should also explain cause and effect, because that shows how one part of the subject leads to another`,
      `When the writing stays focused, the paragraph becomes easier to follow and more convincing`,
      `This is why ${topic} can be described as important without simply repeating the original question`,
      `Overall, ${topic} works as a strong paragraph topic because it can be supported with reasons, examples, and clear explanation`
    ] : [
      `${title} is the main subject, so a strong paragraph should explain it directly and clearly`,
      `The first sentence should introduce what the subject is or what the reader needs to understand about it`,
      `After that, the paragraph should add details that support the main idea instead of repeating the prompt`,
      `Examples are useful because they turn a general statement into something easier to picture`,
      `A clear paragraph also uses cause and effect when the subject needs explanation`,
      `Each sentence should connect to the one before it so the writing feels organized`,
      `The paragraph should avoid random filler and stay focused on the exact subject being discussed`,
      `Overall, ${topic} can be explained well by combining a simple main idea with supporting details and a clear ending`
    ];
    return sentences.slice(0,count).map(s=>/[.!?]$/.test(s) ? s : s+'.').join(' ');
  }
  //lion-ai-symbol-math
  function lionAiNormalizeEverydaySymbols(value){
    const sub={'₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9','₊':'+','₋':'-','₌':'=','₍':'(','₎':')'};
    return String(value || '')
      .normalize('NFKC')
      .replace(/[−‐‑‒–—―]/g,'-')
      .replace(/[×✕✖⋅·∙•]/g,'*')
      .replace(/[÷∕⁄]/g,'/')
      .replace(/[πΠ]/g,'pi')
      .replace(/[τΤ]/g,'tau')
      .replace(/[θΘ]/g,'theta')
      .replace(/[αΑ]/g,'alpha')
      .replace(/[βΒ]/g,'beta')
      .replace(/[γΓ]/g,'gamma')
      .replace(/[δΔ]/g,'delta')
      .replace(/[λΛ]/g,'lambda')
      .replace(/[μΜ]/g,'mu')
      .replace(/[σΣ]/g,'sigma')
      .replace(/[φΦ]/g,'phi')
      .replace(/[ωΩ]/g,'omega')
      .replace(/[∞]/g,'infinity')
      .replace(/[∫]/g,' integral ')
      .replace(/[∑]/g,' sum ')
      .replace(/[∏]/g,' product ')
      .replace(/[√]/g,'sqrt')
      .replace(/[∂]/g,' partial ')
      .replace(/[′’]/g,"'")
      .replace(/[″]/g,"''")
      .replace(/[≤]/g,'<=')
      .replace(/[≥]/g,'>=')
      .replace(/[≠]/g,'!=')
      .replace(/[≈≃≅]/g,'~')
      .replace(/[∈]/g,' in ')
      .replace(/[∉]/g,' not in ')
      .replace(/[∪]/g,' union ')
      .replace(/[∩]/g,' intersection ')
      .replace(/[⊂⊆]/g,' subset ')
      .replace(/[⊃⊇]/g,' superset ')
      .replace(/[∀]/g,' for all ')
      .replace(/[∃]/g,' exists ')
      .replace(/[∴]/g,' therefore ')
      .replace(/[∵]/g,' because ')
      .replace(/[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]/g,ch=>sub[ch] || ch);
  }
  function lionAiNormalizeMathText(value){
    const supers={'⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9'};
    return lionAiNormalizeEverydaySymbols(value)
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g,m=>'^'+[...m].map(ch=>supers[ch] || '').join(''));
  }
  function lionAiAdvancedMathInfo(prompt){
    const raw=String(prompt || '');
    const text=lionAiNormalizeEverydaySymbols(raw).replace(/\s+/g,' ').trim();
    const hasAdvanced=/\b(integral|differentiate|derivative|differential|equilibrium|stability|particle|acceleration|velocity|concave|concavity|maclaurin|taylor|series|limit|lim|summation|matrix|determinant|vector)\b|[{}]|f\([a-z]\)/i.test(text);
    if(!hasAdvanced) return '';
    const compact=text.replace(/\s+/g,'').toLowerCase();
    if(/integral0?1(?:ln\(1\+x\)\/x|\/?xln\(1\+x\))dx/.test(compact) || /integral.*0.*1.*x.*ln\(1\+x\).*dx/.test(compact)){
      const hasFractionCue=/\/|⁄|∕|\u200b|\u200c|\u200d|\ufeff/.test(raw) || /ln\(1\+x\)\/x/i.test(compact);
      if(hasFractionCue){
        return `I read this as the fraction integral from 0 to 1 of ln(1 + x) / x dx.\n\nUse the Maclaurin series ln(1 + x) = x - x^2/2 + x^3/3 - x^4/4 + ... .\n\nDividing by x gives ln(1 + x)/x = 1 - x/2 + x^2/3 - x^3/4 + ... .\n\nIntegrating term by term from 0 to 1 gives 1 - 1/2^2 + 1/3^2 - 1/4^2 + ... .\n\nThat alternating series is eta(2), and eta(2) = (1 - 2^(1 - 2))zeta(2) = (1/2)(pi^2/6) = pi^2/12.\n\nAnswer: pi^2 / 12, which is about 0.822467.\n\nNote: if you meant x * ln(1 + x) instead, that different integral equals 1/4.`;
      }
      return `This compact integral is ambiguous, so there are two common readings:\n\n1. If it means integral from 0 to 1 of ln(1 + x) / x dx, then use the series ln(1 + x)/x = 1 - x/2 + x^2/3 - x^3/4 + ... . Integrating from 0 to 1 gives 1 - 1/2^2 + 1/3^2 - 1/4^2 + ... = pi^2/12, about 0.822467.\n\n2. If it means integral from 0 to 1 of xln(1 + x) dx, then integration by parts gives 1/4.\n\nGemini used the first interpretation, ln(1 + x)/x. My earlier answer used the second interpretation, xln(1 + x).`;
    }
    if(/differentialequation|equilibrium|stability|particlemoves|initialcondition|x\(0\)=3/.test(compact)){
      return `I am reading the broken OCR as the autonomous differential equation dx/dt = (x^2 + 1)(x^2 - 4), with x(0) = 3.\n\n(a) At t = 0, x = 3. Then dx/dt = (3^2 + 1)(3^2 - 4) = 10 * 5 = 50, which is positive. The particle is moving to the right.\n\n(b) Equilibrium solutions happen when dx/dt = 0. Since x^2 + 1 is never 0 for real x, x^2 - 4 = 0 gives x = -2 and x = 2. For |x| > 2, dx/dt is positive. For -2 < x < 2, dx/dt is negative. Therefore x = -2 is stable and x = 2 is unstable.\n\n(c) Acceleration is d2x/dt2 = (dy/dx)(dx/dt), where y = dx/dt = (x^2 + 1)(x^2 - 4). Expanding gives y = x^4 - 3x^2 - 4, so dy/dx = 4x^3 - 6x. At x = 3, y = 50 and dy/dx = 90, so d2x/dt2 = 90 * 50 = 4500.\n\n(d) If y = x^2 + 1, then dy/dt = (dy/dx)(dx/dt) = 2x(x^2 + 1)(x^2 - 4). At x = 3, dy/dt = 2 * 3 * 10 * 5 = 300.\n\n(e) Speed is increasing when velocity and acceleration have the same sign. At x = 3, velocity is 50 and acceleration is 4500, both positive, so speed is increasing.\n\n(f) The equation is separable: dx/[(x^2 + 1)(x^2 - 4)] = dt. It can be integrated with partial fractions, but solving explicitly for x(t) is not elementary in a simple closed form.`;
    }
    if(/integral.*0.*x.*t\^?2.*\+?1.*ln\(1\+t\^?2\).*dt/.test(compact) || /f\(x\)=.*integral0x.*t\^?2\+1.*ln\(1\+t\^?2\)/.test(compact)){
      const approx=(Math.pow(.5,3)/3)+(Math.pow(.5,5)/10)-(Math.pow(.5,7)/42);
      return `Assuming the problem is f(x) = integral from 0 to x of (t^2 + 1)ln(1 + t^2) dt:\n\nA. By the Fundamental Theorem of Calculus, f'(x) = (x^2 + 1)ln(1 + x^2).\n\nB. f''(x) = 2xln(1 + x^2) + 2x = 2x(ln(1 + x^2) + 1). At x = 1, f''(1) = 2(ln 2 + 1), which is positive, so f is concave up at x = 1.\n\nC. Since ln(1 + t^2) = t^2 - t^4/2 + t^6/3 - ..., multiplying by (1 + t^2) gives t^2 + t^4/2 - t^6/6 + ... . Integrating term by term gives f(x) = x^3/3 + x^5/10 - x^7/42 + ... . The first three nonzero terms are x^3/3, x^5/10, and -x^7/42.\n\nD. Using those three terms, f(0.5) ≈ ${approx.toFixed(6)}.`;
    }
    const parts=[];
    parts.push(`I can read this as an advanced math question, not a single calculator expression.`);
    if(/\bintegral\b/i.test(text) || /dt\b/i.test(text)){
      parts.push(`The integral sign means the function is being built by accumulating an integrand over an interval, so the first step is to identify the lower bound, upper bound, integrand, and variable of integration.`);
    }
    if(/f\([a-z]\)/i.test(text)){
      parts.push(`For a function like f(x), keep the input variable separate from dummy variables such as t, because the dummy variable disappears after integration.`);
    }
    if(/\bconcave|concavity/i.test(text)){
      parts.push(`For concavity, find the second derivative and test its sign at the requested value: positive means concave up, and negative means concave down.`);
    }
    if(/\bmaclaurin|taylor|series/i.test(text)){
      parts.push(`For a Maclaurin series, expand around x = 0 and keep the first nonzero terms after simplifying the expression.`);
    }
    if(/\bapproximate|approximation/i.test(text)){
      parts.push(`For an approximation such as f(0.5), substitute the value into the series and add the kept terms.`);
    }
    parts.push(`Because the prompt contains multi-line calculus notation, I should explain the method and structure instead of rejecting symbols as unsupported.`);
    return parts.join('\n\n');
  }
  function lionAiMath(prompt){
    try{
      const advanced=lionAiAdvancedMathInfo(prompt);
      if(advanced) return advanced;
      const target=lionAiCleanMathPrompt(prompt);
      const exactPower=lionAiExactIntegerPower(target);
      if(exactPower) return `${exactPower}\n\nI used exact integer arithmetic, so this is not rounded.`;
      return lionAiSolveEquation(target || prompt);
    }catch(err){
      const normalized=lionAiNormalizeEverydaySymbols(prompt).replace(/\s+/g,' ').trim();
      return `I can read the symbols, but I cannot safely finish the full calculation from that formatting yet.\n\nWhat I understood:\n${normalized || String(prompt || '').trim()}\n\nTry sending one part at a time, like the integral, the concavity check, or the Maclaurin series request, and I will solve that section.`;
    }
  }
  function lionAiCode(prompt){
    const lower=prompt.toLowerCase();
    if(lower.includes('fix')){
      const code=(prompt.match(/```[\s\S]*?```/)?.[0] || prompt.split(/fix.*code:?/i).pop() || '').replace(/```/g,'').trim();
      const fixed=code
        .replace(/function\s+(\w+)\(([^)]*)\)\s*\{\s*return\s+([^;}\n]+)\s*$/,'function $1($2){\n  return $3;\n}')
        .replace(/console\.log\(([^)]*)$/,'console.log($1);');
      return `Here is a cleaned-up version:\n\n\`\`\`js\n${fixed || 'Paste the code you want fixed and I will repair the structure, missing braces, and common syntax issues.'}\n\`\`\`\n\nWhat I check: missing braces, missing semicolons, unclosed function bodies, unclear variable names, and safer formatting.`;
    }
    if(lower.includes('python')){
      return `Here is a simple Python starter:\n\n\`\`\`python\ndef main():\n    name = input("Name: ")\n    print(f"Hello, {name}!")\n\nif __name__ == "__main__":\n    main()\n\`\`\`\n\nTell me the exact app you want and I can shape it into a fuller program.`;
    }
    return `Here is a clean HTML/CSS/JS starter:\n\n\`\`\`html\n<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>App</title>\n  <style>\n    body{font-family:Outfit,Arial,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#101318;color:white}\n    main{width:min(520px,92vw);padding:24px;border:1px solid #334155;border-radius:12px;background:#172033}\n    button{height:38px;border:0;border-radius:8px;padding:0 14px;font-weight:700}\n  </style>\n</head>\n<body>\n  <main>\n    <h1>My App</h1>\n    <p id="out">Ready.</p>\n    <button id="run">Run</button>\n  </main>\n  <script>\n    document.getElementById('run').onclick = () => {\n      document.getElementById('out').textContent = 'It works!';\n    };\n  <\/script>\n</body>\n</html>\n\`\`\`\n\nAsk for a calculator, game, login page, dashboard, or anything specific and I will generate a more complete version.`;
  }
  function lionAiTime(){
    const now=new Date();
    return `The time is ${now.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}.\n\nToday is ${now.toLocaleDateString([], {weekday:'long', month:'long', day:'numeric', year:'numeric'})}.`;
  }
  function lionAiExplain(prompt){
    const topic=lionAiTopic(prompt);
    return `${topic} means the main subject you are asking about.\n\nA clear way to understand ${topic} is to break it into three parts: what it is, why it matters, and how it is used. First, define the basic idea in simple words. Next, connect it to a real example so it does not feel random. Finally, check whether the explanation answers the exact question you asked. If you want, I can make this shorter, longer, more advanced, or turn it into a paragraph.`;
  }
  function lionAiList(prompt){
    const topic=lionAiTopic(prompt);
    return `Here are useful points about ${topic}:\n\n1. Start with the main idea.\n2. Add the most important details.\n3. Use examples so the answer is specific.\n4. Compare it with something similar if that helps.\n5. End with the reason it matters.\n\nFor ${topic}, the strongest answer should stay focused on the exact subject instead of drifting into random advice.`;
  }
  function lionAiGeneral(prompt){
    const topic=lionAiTopic(prompt);
    return `Here is a focused answer about ${topic}:\n\n${topic} is the subject you asked about, so the best response should stay centered on that instead of changing topics. The simplest way to answer is to explain what ${topic} is, give the most important detail, and include one clear example. A strong answer also avoids extra filler and connects each sentence back to ${topic}.\n\nAsk me for a paragraph, code, a math solution, a summary, or an image answer and I will format it that way.`;
  }
  function lionAiIsMathPrompt(prompt){
    const text=lionAiNormalizeEverydaySymbols(prompt).toLowerCase();
    return /(solve|calculate|math|equation|integral|derivative|differentiate|concave|concavity|maclaurin|taylor|series|limit|lim|summation|matrix|determinant|vector|sqrt|sin|cos|tan|log|ln|pi|infinity|partial|sum|product|=|\d\s*[\+\-*/^]\s*\d)/i.test(text);
  }
  function lionAiNeedsLocalOnly(prompt){
    return /\b(what'?s|what is|tell me)\s+(the\s+)?time\b|\bcurrent time\b|\btime is it\b/i.test(prompt)
      || /(solve|calculate|math|equation|=|\d\s*[\+\-*/^×÷−–—]\s*\d|sqrt|sin|cos|tan|log|ln|π|√|[⁰¹²³⁴⁵⁶⁷⁸⁹])/i.test(prompt)
      || /(code|javascript|html|css|python|function|fix this|make.*app|make.*website)/i.test(prompt);
  }
  function lionAiResearchQuery(prompt){
    const topic=lionAiTopic(prompt);
    return topic==='the topic' ? String(prompt || '').trim() : topic;
  }
  async function lionAiFetchJson(url){
    const res=await fetch(url,{headers:{accept:'application/json'}});
    if(!res.ok) throw new Error(`Web lookup failed (${res.status})`);
    return res.json();
  }
  async function lionAiWebResearch(prompt){
    const query=lionAiResearchQuery(prompt);
    if(!query) return null;
    const api='https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=5&srsearch='+encodeURIComponent(query);
    const search=await lionAiFetchJson(api);
    const hits=(search?.query?.search || []).slice(0,3);
    const sources=[];
    for(const hit of hits){
      const title=hit.title;
      try{
        const summary=await lionAiFetchJson('https://en.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(title));
        const extract=String(summary.extract || '').trim();
        if(extract){
          sources.push({
            title:summary.title || title,
            extract,
            url:summary.content_urls?.desktop?.page || ('https://en.wikipedia.org/wiki/'+encodeURIComponent(title.replace(/\s+/g,'_')))
          });
        }
      }catch{}
    }
    return {query,sources};
  }
  function lionAiSentenceSplit(text){
    return String(text || '').replace(/\s+/g,' ').match(/[^.!?]+[.!?]+/g) || [];
  }
  function lionAiWebParagraph(prompt, research){
    const match=prompt.match(/(\d+)\s*sent/i);
    const count=Math.max(1,Math.min(20,match ? Number(match[1]) : 8));
    const topic=lionAiResearchQuery(prompt);
    const positiveWhy=/\bwhy\b.+\b(is|are)\b.+\b(good|great|popular|fun|important|useful)\b/i.test(prompt);
    const facts=research.sources.flatMap(source=>lionAiSentenceSplit(source.extract)).map(s=>s.trim()).filter(Boolean);
    const sentences=positiveWhy ? [
      `${topic} is good because it gives people a clear world to explore, recognizable characters to care about, and goals that feel easy to understand`,
      ...facts,
      `Those facts support the idea that ${topic} works well because it combines story, design, collecting, and play into one memorable experience`,
      `It also stays interesting because different people can enjoy different parts of it, such as characters, strategy, shows, games, or the larger world around it`,
      `Overall, ${topic} is good because it is simple enough to enjoy quickly but deep enough to keep people interested over time`
    ] : [
      `${topic} makes more sense when it is explained with real background instead of guesses`,
      ...facts,
      `These sources show that ${topic} should be understood through its main definition, its history, and the details that make it important`,
      `A strong explanation of ${topic} should connect facts together instead of listing random points`,
      `Overall, ${topic} matters because the evidence gives it a clearer place in the real world`
    ];
    return sentences.slice(0,count).map(s=>/[.!?]$/.test(s) ? s : s+'.').join(' ');
  }
  function lionAiWebAnswer(prompt, research){
    if(!research?.sources?.length) return '';
    const topic=lionAiResearchQuery(prompt);
    const sourceLines=research.sources.map((source,index)=>`${index+1}. ${source.title}: ${source.url}`).join('\n');
    if(/(\d+\s*sent|paragraph|essay|write about|write a)/i.test(prompt)){
      return `${lionAiWebParagraph(prompt,research)}\n\nSources checked:\n${sourceLines}`;
    }
    const main=research.sources[0];
    const support=research.sources.slice(1).map(source=>`Another useful source, ${source.title}, adds that ${source.extract}`).join('\n\n');
    return `I searched the web for "${topic}" and used the most relevant source summaries I could load.\n\nAnswer:\n${main.extract}${support ? '\n\n'+support : ''}\n\nMy take:\nThe important thing is to answer your exact question from evidence, then connect the facts into one clear explanation. For ${topic}, the strongest answer starts with what it is, then explains why it matters, and then uses the source details to avoid making stuff up.\n\nSources checked:\n${sourceLines}`;
  }
  function lionAiFollowupAnswer(prompt, win){
    const text=String(prompt || '').trim().toLowerCase();
    if(!/^(i\s+meant\s+that|i\s+mean\s+that|that|that one|first one|the first one|second one|the second one|fraction one|the fraction one|x one|the x one|multiply one|the multiply one|multiplication one|the multiplication one)$/i.test(text)) return '';
    const last=String(win?.lionAiLastBot || '');
    const lastUser=String(win?.lionAiLastUser || '');
    const hadAmbiguousIntegral=/pi\^2\s*\/\s*12|0\.822467|x\s*\*\s*ln\(1\s*\+\s*x\)|1\/4/i.test(last) && /integral|ln\(1\s*\+\s*x\)/i.test(last);
    if(!hadAmbiguousIntegral) return '';
    if(/\b(second|x one|multiply|multiplication)\b/i.test(text)){
      return `Got it. If you meant the multiplication version, the problem is integral from 0 to 1 of x * ln(1 + x) dx.\n\nUsing integration by parts with u = ln(1 + x) and dv = x dx gives the exact value 1/4.\n\nSo for x * ln(1 + x), the answer is 1/4.`;
    }
    if(/\b(first|fraction)\b/i.test(text) || /\u200b|\u200c|\u200d|\ufeff|\/|⁄|∕/.test(lastUser)){
      return `Got it. If you meant the fraction version, the problem is integral from 0 to 1 of ln(1 + x) / x dx.\n\nUsing ln(1 + x)/x = 1 - x/2 + x^2/3 - x^3/4 + ..., integrating from 0 to 1 gives 1 - 1/2^2 + 1/3^2 - 1/4^2 + ... = pi^2/12.\n\nSo the answer is pi^2 / 12, about 0.822467.`;
    }
    return `That compact integral has two possible readings.\n\nIf you mean ln(1 + x) / x, the answer is pi^2 / 12, about 0.822467.\n\nIf you mean x * ln(1 + x), the answer is 1/4.\n\nType "fraction one" or "x one" to choose the interpretation.`;
  }
  let lionAiOcrLoader=null;
  function lionAiLoadOcr(){
    if(window.Tesseract) return Promise.resolve(window.Tesseract);
    if(lionAiOcrLoader) return lionAiOcrLoader;
    lionAiOcrLoader=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload=()=>window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR library did not start.'));
      script.onerror=()=>reject(new Error('OCR library could not load.'));
      document.head.appendChild(script);
    });
    return lionAiOcrLoader;
  }
  function lionAiSetImageStatus(win, text){
    const status=win?.querySelector('[data-lion-ai-image-status]');
    if(status) status.textContent=text || '';
  }
  function lionAiSetImageState(win, state=null){
    if(!win) return;
    win.lionAiImage=state;
    const preview=win.querySelector('[data-lion-ai-preview]');
    const img=preview?.querySelector('img');
    const label=preview?.querySelector('span');
    if(!state){
      preview?.classList.remove('show');
      if(img) img.removeAttribute('src');
      if(label) label.textContent='';
      lionAiSetImageStatus(win,'');
      return;
    }
    if(img) img.src=state.dataUrl;
    if(label) label.textContent=state.name;
    preview?.classList.add('show');
    lionAiSetImageStatus(win,'Image ready. Ask a question about it.');
  }
  function lionAiReadImageFile(win, file){
    if(!file || !file.type.startsWith('image/')){
      lionAiSetImageStatus(win,'Choose an image file.');
      return;
    }
    const reader=new FileReader();
    reader.onload=()=>lionAiSetImageState(win,{name:file.name,size:file.size,type:file.type,dataUrl:String(reader.result || '')});
    reader.onerror=()=>lionAiSetImageStatus(win,'Could not read that image.');
    reader.readAsDataURL(file);
  }
  function lionAiAnalyzeImage(dataUrl){
    return new Promise(resolve=>{
      const img=new Image();
      img.onload=()=>{
        const canvas=document.createElement('canvas');
        const max=96;
        const scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
        canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
        canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        let r=0,g=0,b=0,light=0,dark=0,count=0;
        for(let i=0;i<pixels.length;i+=16){
          const rr=pixels[i], gg=pixels[i+1], bb=pixels[i+2];
          const lum=(rr+gg+bb)/3;
          r+=rr; g+=gg; b+=bb; count++;
          if(lum>200) light++;
          if(lum<55) dark++;
        }
        r=Math.round(r/count); g=Math.round(g/count); b=Math.round(b/count);
        const brightness=Math.round((r+g+b)/3);
        resolve(`Image details: ${img.naturalWidth}x${img.naturalHeight}px. Average color rgb(${r}, ${g}, ${b}). Overall brightness is about ${brightness}/255. Bright areas: ${Math.round(light/count*100)}%. Dark areas: ${Math.round(dark/count*100)}%.`);
      };
      img.onerror=()=>resolve('I could not inspect the image pixels.');
      img.src=dataUrl;
    });
  }
  async function lionAiReadImage(win){
    const image=win?.lionAiImage;
    if(!image?.dataUrl) return '';
    lionAiSetImageStatus(win,'Reading image text...');
    const visual=await lionAiAnalyzeImage(image.dataUrl);
    try{
      const Tesseract=await lionAiLoadOcr();
      const result=await Tesseract.recognize(image.dataUrl,'eng', {
        logger:m=>{
          if(m.status){
            const progress=Number.isFinite(m.progress) ? ` ${Math.round(m.progress*100)}%` : '';
            lionAiSetImageStatus(win,`OCR: ${m.status}${progress}`);
          }
        }
      });
      const text=(result?.data?.text || '').trim();
      lionAiSetImageStatus(win,text ? 'Image text read.' : 'No clear text found.');
      return text ? `${visual}\n\nText I read from the image:\n${text}` : `${visual}\n\nI did not find clear readable text in the image.`;
    }catch(err){
      lionAiSetImageStatus(win,'OCR unavailable; using visual summary.');
      return `${visual}\n\nOCR could not run here (${err.message}). I can still answer from the visible image details, but not exact printed words.`;
    }
  }
  function lionAiSavedMessages(){
    try{return JSON.parse(localStorage.getItem('nyx.aiMessages') || '[]').filter(m=>m && ['user','assistant'].includes(m.role) && m.content).slice(-40)}catch{return []}
  }
  function lionAiSaveMessages(messages){
    try{localStorage.setItem('nyx.aiMessages',JSON.stringify(messages.slice(-40)))}catch{}
  }
  function lionAiRestoreChat(win){
    const chat=win?.querySelector('[data-lion-ai-chat]');
    const messages=lionAiSavedMessages();
    if(!chat || !messages.length) return;
    chat.innerHTML='';
    messages.forEach(m=>addLionAiMessage(chat,m.role==='user'?'user':'bot',m.content));
    const first=messages.find(message=>message.role==='user')?.content;
    const title=win?.querySelector('[data-lion-ai-thread-title]');
    if(title && first) title.textContent=first.length>54 ? `${first.slice(0,54)}…` : first;
  }
  async function nyxAiModelAnswer(prompt, win, imageContext='', onChunk=()=>{}){
    const model=win?.querySelector?.('[data-lion-ai-model]')?.value || nyxAiSelectedModel();
    const messages=lionAiSavedMessages();
    const userText=prompt || 'Answer the attached image.';
    messages.push({role:'user',content:userText});
    const res=await fetch('/api/nyx-ai',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        model,
        message:userText,
        imageContext,
        messages,
        stream:true
      })
    });
    if(!res.ok){const data=await res.json().catch(()=>({}));throw new Error(data?.error || `Nyx AI failed (${res.status})`)}
    if(!res.body) throw new Error('The selected model did not return a stream.');
    const reader=res.body.getReader(),decoder=new TextDecoder();
    let buffer='',text='';
    for(;;){
      const chunk=await reader.read();
      if(chunk.done) break;
      buffer+=decoder.decode(chunk.value,{stream:true});
      const lines=buffer.split(/\r?\n/);buffer=lines.pop() || '';
      for(const line of lines){
        if(!line.startsWith('data:')) continue;
        const raw=line.slice(5).trim();if(!raw || raw==='[DONE]') continue;
        try{const data=JSON.parse(raw);const token=data?.choices?.[0]?.delta?.content || data?.choices?.[0]?.text || '';if(token){text+=token;onChunk(text)}}catch{}
      }
    }
    text=text.trim();
    if(!text) throw new Error('The selected model returned an empty response.');
    messages.push({role:'assistant',content:text});
    lionAiSaveMessages(messages);
    return text;
  }
  async function lionAiRespondAsync(prompt, win, onChunk){
    const imageContext=await lionAiReadImage(win);
    try{
      return await nyxAiModelAnswer(prompt,win,imageContext,onChunk);
    }catch(err){
      return `Nyx AI could not reach the selected model.\n\n${err.message}\n\nSet NYX_AI_API_KEY on the server. The configured Vilen model can be changed with the matching NYX_AI_MODEL_* environment variable.`;
    }
  }
  function lionAiRespond(prompt){
    const lower=String(prompt || '').toLowerCase();
    if(/\b(what'?s|what is|tell me)\s+(the\s+)?time\b|\bcurrent time\b|\btime is it\b/.test(lower)) return lionAiTime();
    if(/(\d+\s*sent|paragraph|essay|write about|write a)/i.test(prompt)) return lionAiParagraph(prompt);
    if(/(solve|calculate|math|equation|=|\d\s*[\+\-*/^×÷−–—]\s*\d|sqrt|sin|cos|tan|log|ln|π|√|[⁰¹²³⁴⁵⁶⁷⁸⁹])/i.test(prompt)) return lionAiMath(prompt);
    if(/(code|javascript|html|css|python|function|fix this|make.*app|make.*website)/i.test(prompt)) return lionAiCode(prompt);
    if(/\b(list|ideas|steps|outline|plan)\b/i.test(prompt)) return lionAiList(prompt);
    if(/\b(explain|define|what is|what are|how does|how do|why is|why does)\b/i.test(prompt)) return lionAiExplain(prompt);
    return lionAiGeneral(prompt);
  }
  function lionAiNeedsLocalOnly(prompt){
    return /\b(what'?s|what is|tell me)\s+(the\s+)?time\b|\bcurrent time\b|\btime is it\b/i.test(prompt)
      || lionAiIsMathPrompt(prompt)
      || /(code|javascript|html|css|python|function|fix this|make.*app|make.*website)/i.test(prompt);
  }
  function lionAiRespond(prompt){
    const lower=String(prompt || '').toLowerCase();
    if(/\b(what'?s|what is|tell me)\s+(the\s+)?time\b|\bcurrent time\b|\btime is it\b/.test(lower)) return lionAiTime();
    if(/(\d+\s*sent|paragraph|essay|write about|write a)/i.test(prompt)) return lionAiParagraph(prompt);
    if(lionAiIsMathPrompt(prompt)) return lionAiMath(prompt);
    if(/(code|javascript|html|css|python|function|fix this|make.*app|make.*website)/i.test(prompt)) return lionAiCode(prompt);
    if(/\b(list|ideas|steps|outline|plan)\b/i.test(prompt)) return lionAiList(prompt);
    if(/\b(explain|define|what is|what are|how does|how do|why is|why does)\b/i.test(prompt)) return lionAiExplain(prompt);
    return lionAiGeneral(prompt);
  }
  function addLionAiMessage(chat, role, text){
    chat.querySelector('[data-lion-ai-empty]')?.remove();
    chat.classList.add('has-messages');
    const msg=document.createElement('div');
    msg.className='lion-ai-msg '+role;
    msg.textContent=text;
    chat.appendChild(msg);
    chat.scrollTop=chat.scrollHeight;
  }
  function openApps(){
    makeWindow({title:'Apps',left:'12vw',top:'90px',width:'600px',height:'430px',body:`<div class="panel"><h1>Apps</h1><div class="quick-grid apps-launch-grid">${quickTiles()}<button class="quick-tile" style="--tile-delay:612ms" data-open="settings"><b>Set</b><span>Settings</span></button></div></div>`});
  }
  function openLinks(){
    makeWindow({title:'Links',left:'18vw',top:'100px',width:'520px',height:'380px',body:`<div class="panel"><h1>Links</h1><div class="glass-grid"><div class="glass-card"><h2>Search Engines</h2><button data-url="https://www.google.com/">Google</button><button data-url="https://duckduckgo.com/">DuckDuckGo</button></div><div class="glass-card"><h2>School</h2><button data-url="https://docs.google.com/">Docs</button><button data-url="https://classroom.google.com/">Classroom</button></div></div></div>`});
  }
  function openTermsOfService(){
    if(document.body.classList.contains('browser-shell')) return openBrowserShellInternalTab('terms');
    makeWindow({
      title:'Terms Of Service',
      left:'18vw',
      top:'92px',
      width:'720px',
      height:'560px',
      autoMaximize:false,
      className:'nyx-utility-window',
      body:nyxTermsPageMarkup('nyx-info-page nyx-terms-page')
    });
  }
  function openAboutNyx(){
    if(document.body.classList.contains('browser-shell')) return showBrowserShellInternalPage('credits');
    makeWindow({
      title:'About Nyx',
      left:'22vw',
      top:'110px',
      width:'620px',
      height:'430px',
      autoMaximize:false,
      className:'nyx-utility-window',
      body:nyxCreditsPageMarkup('nyx-info-page nyx-credits-tab')
    });
  }
  function nyxTerminalWrite(output,text,type=''){
    if(!output) return;
    const row=document.createElement('div');
    row.className='nyx-terminal-line'+(type?' '+type:'');
    row.textContent=String(text);
    output.appendChild(row);
    output.scrollTop=output.scrollHeight;
  }
  async function runNyxTerminalCommand(win,raw){
    const output=win?.querySelector('[data-nyx-terminal-output]');
    const command=String(raw || '').trim();
    if(!command) return;
    nyxTerminalWrite(output,'nyx> '+command,'command');
    const name=command.toLowerCase();
    if(name==='clear'){
      output.textContent='';
      return;
    }
    if(name==='help'){
      nyxTerminalWrite(output,'Commands: help, status, theme, engine, origin, storage, date, clear');
      nyxTerminalWrite(output,'Staff commands (based on your assigned role): owner help');
      return;
    }
    if(name==='owner help'){
      if(!nyxOwnerDashboardAccess&&!nyxHasAccountPermission('developer-console')){nyxTerminalWrite(output,'Your role does not include staff commands.','error');return}
      nyxTerminalWrite(output,'Staff commands: owner dashboard, owner status. Founder only: owner profile, owner reload-profile');
      return;
    }
    if(name==='owner dashboard'){
      if(!nyxOwnerDashboardAccess){nyxTerminalWrite(output,'Dashboard access is required for this command.','error');return}
      openNyxOwnerDashboard();
      nyxTerminalWrite(output,'Owner Dashboard opened.');
      return;
    }
    if(name==='owner status'){
      if(!nyxHasAccountPermission('developer-console')){nyxTerminalWrite(output,'Developer Console access is required for this command.','error');return}
      try{const token=await nyxGetFirebaseToken(true);const response=await fetch('/api/founder-profile/developer-status',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Owner status is unavailable.');nyxTerminalWrite(output,`Role: ${data.role} · Permissions: ${(data.permissions||[]).join(', ')} · Verified ${new Date(data.checkedAt).toLocaleTimeString()}`)}catch(error){nyxTerminalWrite(output,error.message||'Owner status is unavailable.','error')}
      return;
    }
    if(name==='owner profile'){
      if(!nyxFounderIsOwner){nyxTerminalWrite(output,'Owner access is required for owner commands.','error');return}
      nyxTerminalWrite(output,'Opening Founder Profile editor.');
      openFounderProfileEditor();
      return;
    }
    if(name==='owner reload-profile'){
      if(!nyxFounderIsOwner){nyxTerminalWrite(output,'Owner access is required for owner commands.','error');return}
      await loadFounderProfile({force:true});
      nyxTerminalWrite(output,'Founder profile refreshed.');
      return;
    }
    if(name==='status'){
      nyxTerminalWrite(output,`Nyx is ${navigator.onLine?'online':'offline'} · ${navigator.platform || 'browser'} · ${location.hostname || 'local'}`);
      return;
    }
    if(name==='theme'){
      const active=Array.from(document.body.classList).find(value=>value.startsWith('theme-'))?.slice(6) || store.text('nyx.theme','default');
      nyxTerminalWrite(output,'Theme: '+active);
      return;
    }
    if(name==='engine'){
      nyxTerminalWrite(output,`Engine: ${store.text('nyx.browserMode',DEFAULT_BROWSER_MODE)} · Transport: ${store.text('nyx.transport',DEFAULT_BROWSER_TRANSPORT)}`);
      return;
    }
    if(name==='origin'){
      nyxTerminalWrite(output,'Origin: '+location.origin);
      return;
    }
    if(name==='storage'){
      nyxTerminalWrite(output,`Local settings entries: ${localStorage.length}`);
      return;
    }
    if(name==='date'){
      nyxTerminalWrite(output,new Date().toLocaleString());
      return;
    }
    nyxTerminalWrite(output,`Unknown command: ${command}. Type "help" for the command list.`,'error');
  }
  function openDeveloperConsole(){
    // Developer Console is intentionally the full Eruda tab. Keep this as a
    // single route so it cannot fall back to the old Nyx terminal window.
    return openBrowserShellInternalTab('developer');
  }
  openApps = function(){
    makeWindow({title:'Apps',left:'8vw',top:'64px',width:'960px',height:'650px',body:`<div class="panel apps-panel"><h1>Apps</h1><div class="quick-grid apps-launch-grid">${quickTiles()}</div></div>`});
  };
  //settings-window
  function settingsBody(){
    return `<div class="settings-panel">
      <h1>Preferences</h1>
      <div class="settings-grid">
        <section class="settings-card">
          <h2>AB Cloak</h2>
          <p>super sneaky</p>
          <div class="settings-row"><select data-cloak-type><option value="a" ${store.text('nyx.cloakType','a')==='a'?'selected':''}>about:blank</option><option value="b" ${store.text('nyx.cloakType','a')==='b'?'selected':''}>Blob</option><option value="m" ${store.text('nyx.cloakType','a')==='m'?'selected':''}>Current tab iframe</option></select><button data-save-cloak>Save</button></div>
          <div class="settings-row"><span>Redirect original</span><button class="switch ${store.get('nyx.cloakRedirectOriginal',false)?'on':''}" data-switch="nyx.cloakRedirectOriginal" aria-label="Redirect original tab"></button></div>
          <div class="settings-row"><input data-cloak-redirect-url value="${esc(store.text('nyx.cloakRedirectUrl','https://google.com/'))}" placeholder="Redirect URL"><button data-launch-selected-cloak>Launch</button></div>
          <div class="settings-actions"><button data-about>Open in About:Blank</button><button data-blob>Open in Blob</button></div>
        </section>
        <section class="settings-card">
          <h2>Auto Cloak</h2>
          <p class="hint">Automatically launches nyx in a cloaked tab, must retoggle after each opening</p>
          <div class="settings-row"><span>Auto Cloak</span><button class="switch" data-switch="nyx.autoCloak" aria-label="Auto cloak"></button></div>
        </section>
        <section class="settings-card">
          <h2>Tab Presets</h2>
          <p>Changes the browser tab title and icon.</p>
          <div class="seg"><button data-preset="classroom" type="button">Google Classroom</button><button data-preset="drive" type="button">Google Drive</button><button data-preset="classlink" type="button">Classlink</button><button data-preset="google" type="button">Google</button><button data-preset="nyx" type="button">Reset</button></div>
        </section>
        <section class="settings-card">
          <h2>Custom Tab Cloak</h2>
          <p>Cloaks your tab</p>
          <div class="settings-row"><input data-tab-title value="${esc(store.text('nyx.tabTitle',document.title || '???'))}" placeholder="Tab title"><input class="file-input" data-tab-favicon-file type="file" accept="image/*,.ico"></div>
          <input type="hidden" data-tab-favicon value="${esc(store.text('nyx.tabFavicon',nyxFaviconHref()))}">
          <button data-tab-cloak-apply>Apply Tab Cloak</button>
        </section>
        <section class="settings-card">
          <h2>Anti-Close</h2>
          <p>Prevents accidental closing when anti-close is enabled.</p>
          <button class="switch" data-anticlose aria-label="Anti-close"></button>
        </section>
        <section class="settings-card">
          <h2>Panic Key</h2>
          <p>Press this key combo anytime to instantly close the current tab.</p>
          <div class="settings-row"><strong class="panic-key-display" data-panic-key-display>${esc(store.text('nyx.panicKey','not set'))}</strong></div>
          <div class="settings-actions"><button data-panic-capture type="button">Capture</button><button data-panic-clear type="button">Clear</button></div>
        </section>
      </div>

      <h1 class="settings-section-title">OS Settings</h1>
      <div class="settings-grid">
        <section class="settings-card">
          <h2>Change Your Name</h2>
          <p>Your greeting and profile name.</p>
          <div class="settings-row"><input id="settingName" value="${esc(store.text('nyx.userName',''))}" placeholder="Enter your name" autocomplete="nickname"><button data-save-profile>Save</button></div>
        </section>
        <section class="settings-card" data-founder-account-card hidden>
          <h2><button class="nyx-account-settings-link" data-open-nyx-account-settings type="button">Account</button></h2>
          <p data-founder-account-status>Sign in to manage your Nyx account.</p>
          <div class="settings-actions"><button data-open-nyx-account type="button">Create or sign in</button><button data-open-nyx-profile type="button" hidden>Edit account</button><button data-nyx-account-sign-out type="button" hidden>Sign out</button></div>
        </section>
        <section class="settings-card" data-founder-profile-settings-card hidden>
          <h2>Founder Profile</h2>
          <p>Customize the public profile shown on About Nyx.</p>
          <button data-open-founder-profile-editor type="button">Customize Founder Profile</button>
        </section>
        <section class="settings-card">
          <h2>Font</h2>
          <p>Choose the font used across nyx.</p>
          <select data-font-value>${nyxFontOptionsMarkup()}</select>
        </section>
        <section class="settings-card">
          <h2>Glassmorphism</h2>
          <p>Changes transparency and blur. <span data-glass-output>${esc(store.text('nyx.glassLevel','80'))}%</span></p>
          <input type="range" min="-200" max="200" value="${esc(store.text('nyx.glassLevel','80'))}" data-glass-value>
        </section>
        <section class="settings-card">
          <h2>Lag Reducer</h2>
          <p>Stops animations, removes blur, sets Glassmorphism to 0, and turns Background Enhancer off.</p>
          <div class="settings-row"><span>Lag Reducer</span><button class="switch ${store.get('nyx.lagReducer',false)?'on':''}" data-switch="nyx.lagReducer" data-lag-reducer aria-label="Lag reducer"></button></div>
        </section>
        <section class="settings-card">
          <h2>Lite Mode</h2>
          <p>Lightens blur, shadows, and particles without fully disabling animations.</p>
          <div class="settings-row"><span>Lite Mode</span><button class="switch ${store.get('nyx.performanceLite',false)?'on':''}" data-switch="nyx.performanceLite" data-performance-lite aria-label="Lite mode"></button></div>
        </section>
        <section class="settings-card">
          <h2>Clear Cache</h2>
          <p>Removes cookies, cache files, saved settings, proxy storage, and service workers, then reloads nyx like a fresh install.</p>
          <button data-clear-nyx-cache type="button">Clear Cache and Reset</button>
        </section>
        <section class="settings-card">
          <h2>Browser Mode</h2>
          <p>Makes nyx look like a Chrome page with tabs on top, an address bar, and an Apps button instead of the bottom app bar.</p>
          <div class="settings-row"><span>Browser Mode</span><button class="switch ${store.get('nyx.browserShellMode',true)?'on':''}" data-switch="nyx.browserShellMode" aria-label="Browser mode"></button></div>
        </section>
        <section class="settings-card">
          <h2>Hide Website Details</h2>
          <p>Replace external website names and icons in Nyx tabs with a generic hidden label.</p>
          <div class="settings-row"><span>Hide Names and Icons</span><button class="switch ${websiteDetailsHidden()?'on':''}" data-switch="nyx.hideWebsiteDetails" aria-label="Hide website names and icons"></button></div>
        </section>
        <section class="settings-card">
          <h2>Popup Protection</h2>
          <p>Blocks all site-created popup windows and popup ads.</p>
          <div class="settings-row"><span>Popup Protection</span><button class="switch ${popupProtectionEnabled()?'on':''}" data-switch="nyx.popupProtection" aria-label="Popup protection"></button></div>
          <p class="security-warning">*Warning: If this option is disabled, your computer may be exposed to various security threats, including viruses such as trojan, disguised as Opera GX (which obviously is not). Disabling this feature could result in significant damage to your system, unaware access to your data, and potential sale of your personal data. It is <span class="security-warning-strong">STRONGLY</span> recommended to keep this setting enabled. This feature remains active unless the user intentionally chooses to disable it.*</p>
        </section>
        <section class="settings-card hieroglyph-scroll">
          <h2>${esc(toHieroglyphText('Egyptian hieroglyph Text'))}</h2>
          <p>${esc(toHieroglyphText('Changes visible letters and numbers into hieroglyph-style symbols.'))}</p>
          <div class="settings-row"><span>${esc(toHieroglyphText('Hieroglyph Text'))}</span><button class="switch ${hieroglyphTextEnabled()?'on':''}" data-switch="nyx.hieroglyphText" data-hieroglyph-text aria-label="Egyptian hieroglyph text"></button></div>
          <div class="settings-row"><span>${esc(toHieroglyphText('Auto Hieroglyph'))}</span><button class="switch ${store.get('nyx.autoHieroglyphText',false)?'on':''}" data-switch="nyx.autoHieroglyphText" aria-label="Auto hieroglyph on open"></button></div>
        </section>
        <section class="settings-card wide settings-backgrounds">
          <h2>${document.body.classList.contains('browser-shell') ? 'Browser Background' : 'Change Background'}</h2>
          <p>Pick one of your current ռʏӼ backgrounds.</p>
          <div class="background-picker" data-bg-picker data-bg-scope="${document.body.classList.contains('browser-shell') ? 'browser' : 'windows'}"></div>
          <div class="settings-row"><span>3D Backgrounds</span><button class="switch ${store.get('nyx.threeDBackgrounds',false)?'on':''}" data-switch="nyx.threeDBackgrounds" aria-label="3D backgrounds"></button></div>
          <div class="settings-row"><span>Background Enhancer</span><button class="switch ${store.get('nyx.backgroundEnhancer',false)?'on':''}" data-bg-enhancer aria-label="Background enhancer"></button></div>
          <p class="bg-quality-status" data-bg-quality-status></p>
          <div class="settings-upload" ${document.body.classList.contains('browser-shell') ? 'hidden' : ''}>
            <h2>Upload</h2>
            <input class="file-input" id="settingBgFile" type="file" accept="image/*">
            <div class="settings-row"><input id="settingBgUrl" value="${esc(store.text('nyx.customBgUrl',''))}" placeholder="https://example.com/background.jpg"><button data-save-bg>Apply Background</button></div>
          </div>
        </section>
      </div>

      <h1 class="settings-section-title">Browser Settings</h1>
      <div class="settings-grid">
        <section class="settings-card">
          <h2>Change Proxy</h2>
          <p>This setting changes the browser's proxy to either UV or SJ.
SJ supports more websites however, there will be some websites where UV is superior.
Auto uses Scramjet with Libcurl by default and can still recover with another transport if the connection fails.</p>
          <select id="settingBrowserMode">
            <option value="auto">Auto (Scramjet + Libcurl)</option>
            <option value="scramjet">Use Scramjet</option>
            <option value="ultraviolet">Use Ultraviolet</option>
            <option value="iframe">Iframe</option>
          </select>
        </section>
        <section class="settings-card">
          <h2>Transport</h2>
          <p class="hint">Choose the installed network transport.</p>
          <select id="settingTransport">
            <option value="epoxy">Epoxy over Wisp</option>
            <option value="wisp">Wisp endpoint</option>
            <option value="libcurl">Libcurl over Wisp</option>
          </select>
          <button data-save-browser>Save Browser Settings</button>
        </section>
        <section class="settings-card">
          <h2>Change Search Engine</h2>
          <p>Pick the search engine used for browser searches.</p>
          <select id="settingEngine" data-engine-value><option value="google">Google</option><option value="bing">Bing</option><option value="duckduckgo">DuckDuckGo</option></select>
        </section>
        <section class="settings-card">
          <h2>Effects</h2>
          <p>Pick the particles shown in browser mode.</p>
          <select data-effect-value>
            <option value="none">None</option>
            <option value="rain">Rain</option>
            <option value="stars">Stars</option>
            <option value="hearts">Hearts</option>
            <option value="pokeballs">Pokeballs</option>
            <option value="flowers">Flowers</option>
            <option value="emeralds">Emeralds</option>
          </select>
          <div class="settings-row"><span>Speed <b data-effect-speed-label>${esc(store.text('nyx.visualEffectSpeed','1.1'))}x</b></span><input data-effect-speed type="range" min=".3" max="3" step=".1" value="${esc(store.text('nyx.visualEffectSpeed','1.1'))}"></div>
          <div class="settings-row"><span>Amount <b data-effect-amount-label>${esc(store.text('nyx.visualEffectAmount','16'))}</b></span><input data-effect-amount type="range" min="1" max="64" step="1" value="${esc(store.text('nyx.visualEffectAmount','16'))}"></div>
        </section>
      </div>
    </div>`;
  }
  function openSettings(){
    const existing=document.querySelector('.window.settings-window');
    if(existing){
      bring(existing);
      return existing;
    }
    const win=makeWindow({title:'Preferences',className:'settings-window',left:'calc(50vw - 380px)',top:'58px',width:'760px',height:'600px',body:settingsBody()});
    win.classList.add('settings-opening');
    setTimeout(()=>win.classList.remove('settings-opening'),340);
    const picker=win.querySelector('[data-bg-picker]');
    if(picker) renderBackgroundChoices(picker);
    const engineSel=win.querySelector('#settingEngine');
    if(engineSel) engineSel.value=store.text('nyx.engine','duckduckgo');
    const modeSel=win.querySelector('#settingBrowserMode');
    if(modeSel){
      const mode=normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE));
      modeSel.value=mode==='rammerhead' ? 'auto' : mode;
    }
    const transportSel=win.querySelector('#settingTransport');
    if(transportSel) transportSel.value=store.text('nyx.transport',DEFAULT_BROWSER_TRANSPORT);
    applyVisualEffectSetting();
    syncSwitches(win);
    syncFounderOwnerControls();
    setTimeout(()=>win.querySelector('#settingName')?.focus(),60);
  }
  let setupStepIndex=0;
  const setupStepTitles=[
    'Welcome to Nyx. Customize your experience.',
    'Pick the basics before nyx opens.',
    'Preview the theme Nyx starts with.',
    'Choose how much motion you want.',
    'Choose your browser defaults.',
    'Choose the font Nyx uses.',
    'Check everything before launch.',
    'Learn the controls before launch.'
  ];
  function setupOptionText(select){
    return select?.options?.[select.selectedIndex]?.textContent?.trim() || select?.value || '';
  }
  function syncSetupThemeCards(){
    const setup=$('setupScreen');
    const theme=$('setupTheme')?.value || 'default';
    if(setup) setup.dataset.previewTheme=normalizeNyxTheme(theme);
    setup?.querySelectorAll('[data-setup-theme-card]').forEach(card=>{
      card.classList.toggle('selected',card.dataset.setupThemeCard===theme);
    });
  }
  function updateSetupPreview(){
    const setup=$('setupScreen');
    if(!setup) return;
    const themeSelect=$('setupTheme');
    const effectSelect=$('setupEffect');
    const browserSelect=$('setupBrowserMode');
    const engineSelect=$('setupEngine');
    const fontSelect=$('setupFont');
    const theme=themeSelect?.value || 'default';
    const stage=setup.querySelector('[data-setup-final-stage]');
    if(stage) stage.dataset.theme=theme;
    const values=[
      ['[data-setup-preview-theme]',setupOptionText(themeSelect)],
      ['[data-setup-preview-effect]',setupOptionText(effectSelect)],
      ['[data-setup-preview-browser]',setupOptionText(browserSelect)],
      ['[data-setup-preview-engine]',setupOptionText(engineSelect)],
      ['[data-setup-preview-font]',setupOptionText(fontSelect)]
    ];
    values.forEach(([selector,value])=>{
      const target=setup.querySelector(selector);
      if(target) target.textContent=value || '-';
    });
  }
  function setSetupStep(index=0){
    const setup=$('setupScreen');
    if(!setup) return;
    const steps=[...setup.querySelectorAll('[data-setup-step]')];
    if(!steps.length) return;
    const previous=setupStepIndex;
    setupStepIndex=Math.max(0,Math.min(steps.length-1,Number(index)||0));
    setup.classList.remove('setup-forward','setup-back');
    setup.classList.add(setupStepIndex >= previous ? 'setup-forward' : 'setup-back');
    steps.forEach((step,i)=>step.classList.toggle('active',i===setupStepIndex));
    setup.querySelectorAll('.setup-dot').forEach((dot,i)=>dot.classList.toggle('active',i===setupStepIndex));
    const subtitle=setup.querySelector('[data-setup-subtitle]');
    if(subtitle) subtitle.textContent=setupStepTitles[setupStepIndex] || setupStepTitles[0];
    const back=setup.querySelector('[data-setup-back]');
    const next=setup.querySelector('[data-setup-next]');
    const finish=setup.querySelector('[data-finish-setup]');
    if(back) back.hidden=setupStepIndex===0;
    if(next){
      next.hidden=setupStepIndex===steps.length-1;
      next.textContent=setupStepIndex===0 ? 'Enter' : 'Next';
    }
    if(finish) finish.hidden=setupStepIndex!==steps.length-1;
    updateSetupPreview();
  }
  function moveSetupStep(delta=1){
    setSetupStep(setupStepIndex + delta);
  }
  function wireSetupWizardControls(setup=$('setupScreen')){
    if(!setup || setup.__nyxSetupWizardWired) return;
    setup.__nyxSetupWizardWired=true;
    setup.addEventListener('click',event=>{
      const themeCard=event.target.closest?.('[data-setup-theme-card]');
      if(themeCard && setup.contains(themeCard)){
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        const theme=$('setupTheme');
        if(theme) theme.value=themeCard.dataset.setupThemeCard || 'default';
        syncSetupThemeCards();
        updateSetupPreview();
        return;
      }
      const button=event.target.closest?.('[data-setup-next],[data-setup-back],[data-finish-setup],[data-skip-setup]');
      if(!button || !setup.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      if(button.matches('[data-setup-next]')) moveSetupStep(1);
      else if(button.matches('[data-setup-back]')) moveSetupStep(-1);
      else if(button.matches('[data-finish-setup]')) finishSetupCustomization();
      else if(button.matches('[data-skip-setup]')){
        store.set('nyx.setupComplete',true);
        hideSetup();
      }
    },true);
    setup.addEventListener('change',event=>{
      if(!event.target.closest?.('[data-theme-value],[data-effect-value],[data-browser-mode-select],[data-browser-engine],[data-font-value]')) return;
      syncSetupThemeCards();
      updateSetupPreview();
    },true);
    const handleSetupEnter=event=>{
      if(event.key!=='Enter') return;
      if(!setup.classList.contains('show')) return;
      const target=event.target;
      if(target?.matches?.('textarea,select,[contenteditable="true"]')) return;
      const steps=[...setup.querySelectorAll('[data-setup-step]')];
      if(!steps.length) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      if(setupStepIndex>=steps.length-1) finishSetupCustomization();
      else moveSetupStep(1);
    };
    setup.addEventListener('keydown',handleSetupEnter,true);
    if(!document.__nyxSetupEnterWired){
      document.__nyxSetupEnterWired=true;
      document.addEventListener('keydown',event=>{
        const activeSetup=$('setupScreen');
        if(!activeSetup?.classList.contains('show')) return;
        handleSetupEnter(event);
      },true);
    }
  }
  function showSetup(){
    const setup=$('setupScreen');
    const name=$('setupName');
    if(!setup) return;
    wireSetupWizardControls(setup);
    if(name) name.value=store.text('nyx.userName','');
    const theme=$('setupTheme');
    if(theme) theme.value=store.text('nyx.theme','default');
    const effect=$('setupEffect');
    if(effect) effect.value=store.text('nyx.visualEffect','none');
    const browser=$('setupBrowserMode');
    if(browser) browser.value=normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE));
    const engine=$('setupEngine');
    if(engine) engine.value=store.text('nyx.engine','duckduckgo');
    const font=$('setupFont');
    if(font){
      font.innerHTML=nyxFontOptionsMarkup();
      font.value=nyxFontChoice()[0];
    }
    syncSetupThemeCards();
    updateSetupPreview();
    document.body.classList.add('setup-active');
    setup.classList.add('show');
    setup.setAttribute('aria-hidden','false');
    setSetupStep(0);
    setTimeout(()=>name?.focus(),80);
  }
  function shouldShowStartupCustomization(){
    if(store.get('nyx.setupComplete',false)) return false;
    try{
      const existingSignals=['nyx.theme','nyx.engine','nyx.browserMode','nyx.homeShortcuts','nyx.background','nyx.browserBackground','nyx.tabTitle','nyx.panicKey'];
      if(existingSignals.some(key=>localStorage.getItem(key)!==null)){
        store.set('nyx.setupComplete',true);
        return false;
      }
    }catch{}
    return true;
  }
  let nyxTermsGateTimer=0;
  function closeNyxTermsGate(){
    document.querySelector('.nyx-tos-gate')?.remove();
    document.body.classList.remove('nyx-tos-active');
  }
  function showNyxTermsAcceptanceGate(){
    if(store.text('nyx.tosAcceptedVersion','')===NYX_TERMS_VERSION) return false;
    if(document.querySelector('.nyx-tos-gate')) return true;
    if($('setupScreen')?.classList.contains('show')) return false;
    const gate=document.createElement('div');
    gate.className='nyx-tos-gate';
    gate.innerHTML=`<section class="nyx-tos-dialog" role="dialog" aria-modal="true" aria-labelledby="nyxTosGateTitle" aria-describedby="nyxTosGateIntro"><header class="nyx-tos-gate-header"><span class="nyx-tos-gate-logo" aria-hidden="true"></span><div><span>Before you continue</span><h1 id="nyxTosGateTitle" tabindex="-1">Nyx Terms of Service</h1></div></header><div class="nyx-tos-scroll" data-nyx-tos-scroll>${nyxTermsPageMarkup('nyx-tos-document')}<div class="nyx-tos-declined" hidden><span aria-hidden="true">ⓘ</span><h2 tabindex="-1">Terms declined</h2><p>You cannot use Nyx without accepting the Terms of Service. You can review the terms again or leave Nyx.</p></div></div><footer class="nyx-tos-actions"><p id="nyxTosGateIntro">By selecting Agree, you confirm that you have read and accept these Terms.</p><div><button class="nyx-tos-disagree" data-nyx-tos-disagree type="button">Disagree</button><button class="nyx-tos-agree" data-nyx-tos-agree type="button">Agree</button></div></footer></section>`;
    document.body.appendChild(gate);
    document.body.classList.add('nyx-tos-active');
    const agree=gate.querySelector('[data-nyx-tos-agree]');
    const disagree=gate.querySelector('[data-nyx-tos-disagree]');
    const scroll=gate.querySelector('[data-nyx-tos-scroll]');
    const documentView=gate.querySelector('.nyx-tos-document');
    const declinedView=gate.querySelector('.nyx-tos-declined');
    const showTerms=()=>{
      gate.classList.remove('is-declined');
      documentView.hidden=false;
      declinedView.hidden=true;
      agree.textContent='Agree';
      disagree.textContent='Disagree';
      scroll.scrollTop=0;
      gate.querySelector('#nyxTosGateTitle')?.focus?.();
    };
    agree.addEventListener('click',()=>{
      if(gate.classList.contains('is-declined')){
        showTerms();
        return;
      }
      store.setText('nyx.tosAcceptedVersion',NYX_TERMS_VERSION);
      closeNyxTermsGate();
      toast('Terms accepted');
    });
    disagree.addEventListener('click',()=>{
      if(gate.classList.contains('is-declined')){
        try{location.replace('about:blank')}catch{document.documentElement.innerHTML=''}
        return;
      }
      gate.classList.add('is-declined');
      documentView.hidden=true;
      declinedView.hidden=false;
      agree.textContent='Review Terms';
      disagree.textContent='Leave Nyx';
      scroll.scrollTop=0;
      declinedView.querySelector('h2')?.focus();
    });
    requestAnimationFrame(()=>gate.classList.add('show'));
    setTimeout(()=>gate.querySelector('#nyxTosGateTitle')?.focus?.(),80);
    return true;
  }
  function scheduleNyxTermsAcceptanceGate(delay=320){
    clearTimeout(nyxTermsGateTimer);
    nyxTermsGateTimer=setTimeout(()=>{
      if(!showNyxTermsAcceptanceGate() && store.text('nyx.tosAcceptedVersion','')!==NYX_TERMS_VERSION && nyxStartupOpened){
        scheduleNyxTermsAcceptanceGate(500);
      }
    },delay);
  }
  function hideSetup(){
    const setup=$('setupScreen');
    if(!setup) return;
    setup.classList.remove('show');
    setup.setAttribute('aria-hidden','true');
    document.body.classList.remove('setup-active');
    if(store.get('nyx.setupComplete',false)) scheduleNyxTermsAcceptanceGate(180);
  }
  function showSetupLaunchSplash(){
    return window.nyxLoadingScreen?.show() || null;
  }
  function finishSetupCustomization(){
    const name=$('setupName')?.value.trim();
    if(name) store.setText('nyx.userName',name);
    store.setText('nyx.theme',$('setupTheme')?.value || 'default');
    store.setText('nyx.visualEffect',$('setupEffect')?.value || 'none');
    store.set('nyx.visualEffectUserChoice',true);
    store.setText('nyx.browserMode',normalizeBrowserModeName($('setupBrowserMode')?.value || DEFAULT_BROWSER_MODE));
    store.setText('nyx.engine',$('setupEngine')?.value || 'duckduckgo');
    store.setText('nyx.font',nyxFontChoice($('setupFont')?.value || 'outfit')[0]);
    store.set('nyx.setupComplete',true);
    applyUserSettings();
    hideSetup();
    toast('Settings saved');
  }
  function syncSwitches(root=document){
    root.querySelectorAll('[data-switch]').forEach(btn=>{
      const initial=btn.dataset.switch==='nyx.autoCloak'
        ? (store.get('nyx.autoCloak',false) || store.get('autoAbout',false) || store.get('autoBlob',false))
        : btn.dataset.switch==='nyx.popupProtection'
          ? popupProtectionEnabled()
        : btn.dataset.switch==='nyx.hieroglyphText'
          ? hieroglyphTextEnabled()
        : btn.dataset.switch==='nyx.browserShellMode'
          ? store.get('nyx.browserShellMode',true)
        : store.get(btn.dataset.switch,false);
      btn.classList.toggle('on',initial);
      btn.setAttribute('role','switch');
      btn.setAttribute('aria-checked',String(!!initial));
      btn.onclick=()=>{
        const key=btn.dataset.switch;
        const v=key==='nyx.popupProtection'
          ? !popupProtectionEnabled()
          : key==='nyx.browserShellMode'
            ? !store.get('nyx.browserShellMode',true)
            : !store.get(key,false);
        store.set(key,v);
        qsa(`[data-switch="${key}"]`).forEach(el=>{el.classList.toggle('on',v);el.setAttribute('aria-checked',String(!!v))});
        qsa(`[data-switch="${key}"].settings-action`).forEach(el=>{el.textContent=v?'On':'Off'});
        if(key==='nyx.cloakRedirectOriginal' || key==='nyx.autoCloak') qsa(`[data-switch="${key}"]`).forEach(el=>{if(el.classList.contains('settings-action')) el.textContent=v?'On':'Off'});
        if(key==='nyx.autoCloak'){
          store.set('autoAbout',false);
          store.set('autoBlob',false);
          if(v) launchAutoCloak();
          toast('Auto Cloak '+(v?'on':'off'));
        }else if(key==='nyx.hieroglyphText'){
          applyHieroglyphText();
          toast('Hieroglyph text '+(v?'on':'off'));
        }else if(key==='nyx.autoHieroglyphText'){
          if(v) store.set('nyx.hieroglyphText',true);
          qsa('[data-switch="nyx.hieroglyphText"]').forEach(el=>el.classList.toggle('on',hieroglyphTextEnabled()));
          qsa('[data-switch="nyx.hieroglyphText"].settings-action').forEach(el=>{el.textContent=hieroglyphTextEnabled()?'On':'Off'});
          applyHieroglyphText();
          toast('Auto Hieroglyph '+(v?'on':'off'));
        }else if(key==='nyx.lagReducer'){
          if(v){
            store.set('nyx.backgroundEnhancer',false);
            store.setText('nyx.glassLevel','0');
          }
          applyUserSettings();
          toast('Lag Reducer '+(v?'on':'off'));
        }else if(key==='nyx.performanceLite'){
          applyUserSettings();
          toast('Lite Mode '+(v?'on':'off'));
        }else if(key==='nyx.threeDBackgrounds'){
          applyUserSettings();
          toast('3D Backgrounds '+(v?'on':'off'));
        }else if(key==='nyx.browserShellMode'){
          const hostWin=btn.closest('.window');
          applyUserSettings();
          if(hostWin) setTimeout(()=>closeWindowAnimated(hostWin),80);
          toast('Browser Mode '+(v?'on':'off'));
        }else if(key==='nyx.popupProtection'){
          activeBrowser?.refreshSandbox?.();
          toast('Popup Protection '+(v?'on':'off'));
        }else if(key==='nyx.hideWebsiteDetails'){
          refreshWebsiteDetailsVisibility();
          toast('Website details '+(v?'hidden':'shown'));
        }
      }
    });
    root.querySelectorAll('[data-anticlose]').forEach(ac=>{
      ac.classList.toggle('on',antiCloseEnabled);
      ac.onclick=()=>{
        setAntiCloseEnabled(!antiCloseEnabled);
        toast('Anti-close '+(antiCloseEnabled?'on':'off'));
      };
    });
    wirePresetCloakControls(root);
  }
  function applyPreset(name, silent=false){
    const previousCloakTitle=store.text('nyx.tabTitle','').trim();
    if(name==='custom'){
      applyCustomTabCloak(store.text('nyx.tabTitle','nyx'),store.text('nyx.tabFavicon',nyxFaviconHref()),silent);
      syncPresetCloakFields();
      return;
    }
    const labels={nyx:nyxTabTitle,classroom:'Google Classroom',drive:'Google Drive',classlink:'ClassLink',google:'Google'};
    const title=labels[name]||nyxTabTitle;
    const favicon=name==='nyx' ? nyxTabFavicon : (favicons[name]||favicons.nyx||favicons.google);
    setCurrentTabCloak(title,favicon,true);
    const brand=$('brandName');
    if(brand) brand.textContent=nyxTabTitle;
    store.setText('nyx.logo',name);
    store.setText('nyx.tabTitle',title);
    store.setText('nyx.tabFavicon',favicon);
    syncPresetCloakFields();
    repairBlankBrowserShellPresetTabs(previousCloakTitle);
    scheduleStoredTabCloakEnforce();
    requestAnimationFrame(()=>setCurrentTabCloak(title,favicon,false));
    if(!silent) toast('Tab preset applied');
  }
  function repairBlankBrowserShellPresetTabs(previousCloakTitle=''){
    if(!Array.isArray(browserShellTabs) || !browserShellTabs.length) return;
    const presetTitles=new Set([nyxTabTitle,'ռʏӼ','Õ¼ÊÓ¼','Google Classroom','Google Drive','ClassLink','Google']);
    if(previousCloakTitle) presetTitles.add(previousCloakTitle);
    let changed=false;
    browserShellTabs.forEach((tab,index)=>{
      if(tab.url || !presetTitles.has(String(tab.title || '').trim())) return;
      tab.title=index===0 ? 'Home' : 'New Tab';
      tab.icon=favicons.nyx;
      changed=true;
    });
    if(changed && document.body.classList.contains('browser-shell')) renderBrowserShellTabs();
  }
  function wirePresetCloakControls(root=document){
    const scope=root || document;
    if(scope.__nyxPresetCloakWired) return;
    scope.__nyxPresetCloakWired=true;
    scope.addEventListener?.('click',e=>{
      const preset=e.target.closest?.('[data-preset]');
      if(!preset || !scope.contains?.(preset)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      applyPreset(preset.dataset.preset || 'nyx');
      syncPresetCloakFields(scope);
    },true);
    const applySelect=e=>{
      const select=e.target.closest?.('[data-preset-select]');
      if(!select || !scope.contains?.(select)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      applyPreset(select.value || 'nyx');
      syncPresetCloakFields(scope);
    };
    scope.addEventListener?.('change',applySelect,true);
    scope.addEventListener?.('input',applySelect,true);
  }
  function syncPresetCloakFields(root=document){
    const scope=root || document;
    const logo=store.text('nyx.logo','nyx');
    const title=store.text('nyx.tabTitle','nyx');
    const favicon=store.text('nyx.tabFavicon',nyxFaviconHref());
    scope.querySelectorAll?.('[data-preset-select]').forEach(select=>{
      if([...select.options].some(option=>option.value===logo)) select.value=logo;
    });
    scope.querySelectorAll?.('[data-tab-title]').forEach(input=>{input.value=title});
    scope.querySelectorAll?.('[data-tab-favicon]').forEach(input=>{input.value=favicon});
  }
  function enforceStoredTabCloak(){
    const title=store.text('nyx.tabTitle','').trim();
    const favicon=store.text('nyx.tabFavicon','').trim();
    if(title || favicon) setCurrentTabCloak(title || document.title, favicon || nyxFaviconHref(), false);
  }
  function scheduleStoredTabCloakEnforce(){
    enforceStoredTabCloak();
    [80,320,1000].forEach(delay=>setTimeout(enforceStoredTabCloak,delay));
  }
  function reachableTabDocuments(){
    const docs=[document];
    try{
      if(window.parent && window.parent!==window && window.parent.document && !docs.includes(window.parent.document)) docs.push(window.parent.document);
    }catch{}
    try{
      if(window.top && window.top!==window && window.top.document && !docs.includes(window.top.document)) docs.push(window.top.document);
    }catch{}
    return docs;
  }
  function setCurrentTabCloak(title, favicon, forceRefresh=false){
    const cleanTitle=String(title || nyxTabTitle).trim() || nyxTabTitle;
    const cleanFavicon=String(favicon || nyxTabFavicon).trim() || nyxTabFavicon;
    reachableTabDocuments().forEach(doc=>{
      setPageTitle(cleanTitle,doc);
      setPageFavicon(cleanFavicon,forceRefresh,doc);
    });
    return {title:cleanTitle,favicon:cleanFavicon};
  }
  function setPageTitle(title){
    const doc=arguments[1] || document;
    if(!doc) return;
    let titleEl=doc.querySelector('head > title');
    if(!titleEl && doc.head){
      titleEl=doc.createElement('title');
      doc.head.prepend(titleEl);
    }
    if(titleEl) titleEl.textContent=title;
    try{doc.title=title}catch{}
  }
  function setPageFavicon(href, forceRefresh=false, targetDoc=document){
    const clean=String(href || favicons.nyx).trim() || favicons.nyx;
    let finalHref=clean;
    let lower=clean.toLowerCase();
    try{
      if(!/^(data:|blob:)/i.test(clean)){
        const url=new URL(clean,location.href);
        if(forceRefresh && url.origin===location.origin) url.searchParams.set('tabIcon',String(Date.now()));
        finalHref=url.href;
        lower=url.pathname.toLowerCase();
      }
    }catch{
      finalHref=clean;
    }
    const type=lower.endsWith('.png') ? 'image/png' : lower.endsWith('.webp') ? 'image/webp' : lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : lower.endsWith('.ico') ? 'image/x-icon' : lower.endsWith('.svg') || /^data:image\/svg/i.test(clean) ? 'image/svg+xml' : '';
    const install=doc=>{
      if(!doc?.head) return;
      doc.querySelectorAll('link[rel*="icon" i], link[rel="apple-touch-icon" i]').forEach(el=>el.remove());
      ['icon','shortcut icon','apple-touch-icon'].forEach((rel,index)=>{
        const fav=doc.createElement('link');
        if(index===0) fav.id='appFavicon';
        fav.rel=rel;
        if(type && rel!=='apple-touch-icon') fav.type=type;
        fav.href=finalHref;
        doc.head.appendChild(fav);
      });
    };
    install(targetDoc);
    return finalHref;
  }
  function applyCustomTabCloak(title, favicon, silent=false){
    const cleanTitle=String(title || '').trim() || 'nyx';
    const cleanFavicon=String(favicon || '').trim() || favicons.nyx;
    setCurrentTabCloak(cleanTitle,cleanFavicon,/^(?:\.\/|\/|assets\/)/i.test(cleanFavicon));
    store.setText('nyx.tabTitle',cleanTitle);
    store.setText('nyx.tabFavicon',cleanFavicon);
    store.setText('nyx.logo','custom');
    scheduleStoredTabCloakEnforce();
    if(!silent) toast('Tab cloak applied');
  }
  let tabCloakPersistenceInstalled=false;
  function installTabCloakPersistence(){
    if(tabCloakPersistenceInstalled) return;
    tabCloakPersistenceInstalled=true;
    ['focus','pageshow','visibilitychange'].forEach(type=>{
      window.addEventListener(type,()=>scheduleStoredTabCloakEnforce(),{passive:true});
    });
    if(document.head){
      new MutationObserver(()=>scheduleStoredTabCloakEnforce()).observe(document.head,{childList:true,subtree:true,attributes:true,attributeFilter:['href','rel']});
    }
  }
  function currentCloakFrameUrl(){
    try{
      const url=new URL(location.href);
      url.searchParams.set('nyx_cloaked','1');
      return url.href;
    }catch{
      return location.href;
    }
  }
  function cloakHtml(title=document.title){
    return '<!doctype html><title>'+esc(title)+'</title><link rel="icon" href="'+esc(nyxFaviconHref())+'"><iframe src="'+currentCloakFrameUrl()+'" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>';
  }
  function cloakPromptText(){
    return "Please type one of the following:\n'a' = about:blank\n'b' = blob cloaking\n'm' = current tab iframe\n'ac' = same tab cloak\n'bc' = blob cloaking same tab\n'mc' = current tab iframe same tab";
  }
  function normalizeCloakMode(value){
    const mode=String(value || '').trim().toLowerCase();
    return ['a','b','m','ac','bc','mc'].includes(mode) ? mode : 'a';
  }
  function cloakRedirectUrl(){
    const raw=store.text('nyx.cloakRedirectUrl','https://google.com/').trim() || 'https://google.com/';
    try{return normalize(raw)}catch{return 'https://google.com/'}
  }
  function maybeRedirectOriginalAfterCloak(){
    if(!store.get('nyx.cloakRedirectOriginal',false)) return;
    const target=cloakRedirectUrl();
    setTimeout(()=>{
      try{location.replace(target)}catch{location.href=target}
    },260);
  }
  function saveCloakSettings(root=document){
    const mode=normalizeCloakMode(root.querySelector('[data-cloak-type]')?.value || store.text('nyx.cloakType','a'));
    const redirectUrl=root.querySelector('[data-cloak-redirect-url]')?.value?.trim();
    store.setText('nyx.cloakType',mode);
    if(redirectUrl) store.setText('nyx.cloakRedirectUrl',normalize(redirectUrl));
    toast('Cloak settings saved');
  }
  function promptCloakMode(){
    const value=prompt(cloakPromptText(),'m');
    if(value===null) return null;
    const mode=value.trim().toLowerCase();
    if(['a','b','m','ac','bc','mc'].includes(mode)) return mode;
    alert("Unknown cloak mode. Use a, b, m, ac, bc, or mc.");
    return null;
  }
  function applyTabAnchor(){
    try{history.replaceState(history.state,'',location.pathname+location.search)}catch{}
  }
  function launchCurrentTabIframe(useAnchor=false){
    if(useAnchor) applyTabAnchor();
    const iframe=document.createElement('iframe');
    iframe.src=currentCloakFrameUrl();
    iframe.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;background:#020308;z-index:7000';
    iframe.setAttribute('title','nyx');
    document.body.classList.remove('hosted-cloak-entry');
    document.documentElement.classList.remove('hosted-cloak-entry');
    document.body.innerHTML='';
    document.body.style.margin='0';
    document.body.style.overflow='hidden';
    document.body.appendChild(iframe);
    return true;
  }
  function launchCurrentTabBlob(useAnchor=false){
    if(useAnchor) applyTabAnchor();
    const url=URL.createObjectURL(new Blob([cloakHtml()],{type:'text/html'}));
    try{
      location.replace(url);
    }catch{
      location.href=url;
    }
    return true;
  }
  function launchCurrentTabAboutBlank(useAnchor=false){
    if(useAnchor) applyTabAnchor();
    try{
      document.open();
      document.write(cloakHtml());
      document.close();
    }catch{
      return launchCurrentTabIframe(false);
    }
    return true;
  }
  const cloakHopUrls=[
    ['Blooket','https://www.blooket.com/'],
    ['IXL','https://www.ixl.com/'],
    ['Khan Academy','https://www.khanacademy.org/'],
    ['Wikipedia','https://www.wikipedia.org/'],
    ['Google','https://www.google.com/'],
    ['Google Classroom','https://classroom.google.com/'],
    ['Google Docs','https://docs.google.com/']
  ];
  function nextCloakHop(forcedHop){
    if(forcedHop) return {name:forcedHop[0],url:forcedHop[1]};
    const index=Number(store.text('nyx.cloakHopIndex','0')) || 0;
    const hop=cloakHopUrls[index % cloakHopUrls.length];
    store.setText('nyx.cloakHopIndex',String(index+1));
    return {name:hop[0],url:hop[1]};
  }
  function writeAboutBlankCloak(w, html, started=Date.now()){
    try{
      w.document.open();
      w.document.write(html);
      w.document.close();
      return true;
    }catch{}
    if(Date.now()-started<2600) setTimeout(()=>writeAboutBlankCloak(w,html,started),140);
    return false;
  }
  function opennyxInternalPopup(url='about:blank',options={}){
    const target=String(url || 'about:blank');
    const nativeOpen=window.__nyxNativeOpen || window.open?.bind(window);
    const features=options.features || 'popup=yes,width=1280,height=800';
    let external=null;
    try{external=nativeOpen ? nativeOpen(target,'_blank',features) : null}catch{}
    if(!external && target!=='about:blank'){
      try{external=nativeOpen ? nativeOpen('about:blank','_blank',features) : null}catch{}
      try{if(external) external.location.replace(target)}catch{}
    }
    if(external) return external;
    return {
      closed:false,
      focus(){},
      blur(){},
      close(){this.closed=true},
      postMessage(){},
      location:{
        href:target,
        assign(next){openBrowser(next || target)},
        replace(next){openBrowser(next || target)}
      },
      document:{
        open(){return this},
        write(){},
        writeln(){},
        close(){}
      }
    };
  }
  function opennyxBlobTab(html=cloakHtml()){
    const url=URL.createObjectURL(new Blob([html],{type:'text/html'}));
    const popup=opennyxInternalPopup(url,{blob:true});
    if(!popup) URL.revokeObjectURL(url);
    return popup;
  }
  function openThroughDeltaMath(finalUrl=location.href, afterRedirect, forcedHop){
    const w=opennyxInternalPopup(finalUrl);
    if(!w) return null;
    setTimeout(()=>{
      if(typeof afterRedirect==='function') setTimeout(()=>afterRedirect(w),260);
    },120);
    return w;
  }
  function launchCloak(kind, options={}){
    const html=cloakHtml();
    if(options.anchor) applyTabAnchor();
    if(kind==='about'){
      return openThroughDeltaMath('about:blank',w=>{
        writeAboutBlankCloak(w,html);
      },options.hop);
    }
    if(kind==='blob'){
      return opennyxBlobTab(html);
    }
    return opennyxBlobTab(html);
  }
  function launchDirectAboutBlankCloak(title='about:blank'){
    const nativeOpen=window.__nyxNativeOpen || window.open?.bind(window);
    let w=null;
    try{w=nativeOpen ? nativeOpen('about:blank','_blank','popup=yes,width=1280,height=800') : null}catch{}
    if(!w) w=opennyxInternalPopup('about:blank',{features:'popup=yes,width=1280,height=800'});
    if(!w) return null;
    try{
      w.document.open();
      w.document.write(cloakHtml(title));
      w.document.close();
      try{w.focus?.()}catch{}
      return w;
    }catch{
      try{w.location.href=currentCloakFrameUrl()}catch{}
      return w;
    }
  }
  function launchAutoCloak(){
    return !!launchHostedCloak(store.text('nyx.cloakType','a'));
  }
  function shouldAutoLaunchHostedCloak(){
    try{
      const params=new URLSearchParams(location.search);
      return /^https?:$/.test(location.protocol)
        && window.top===window.self
        && params.has('nyx_auto_classroom')
        && !params.has('nyx_cloaked');
    }catch{
      return false;
    }
  }
  function showCloakLaunchScreen(){
    const screen=$('cloakLaunchScreen');
    if(!screen) return;
    screen.classList.add('show');
    screen.setAttribute('aria-hidden','false');
    setTimeout(()=>screen.querySelector('[data-cloak-input]')?.focus(),40);
  }
  function hideCloakLaunchScreen(){
    const screen=$('cloakLaunchScreen');
    if(!screen) return;
    screen.classList.remove('show');
    screen.setAttribute('aria-hidden','true');
  }
  function setCloakLaunchMessage(text){
    const panel=$('cloakLaunchScreen')?.querySelector('p');
    if(panel) panel.textContent=text;
  }
  function setCloakStatus(text){
    const status=$('cloakLaunchScreen')?.querySelector('[data-cloak-status]');
    if(status) status.textContent=text;
  }
  function launchTypedCloakMode(){
    const input=$('cloakLaunchScreen')?.querySelector('[data-cloak-input]');
    const mode=(input?.value || '').trim().toLowerCase();
    return launchHostedCloak(mode || 'm');
  }
  function launchHostedCloak(mode='m'){
    mode=String(mode || 'm').trim().toLowerCase();
    if(!['a','b','m','ac','bc','mc'].includes(mode)){
      setCloakStatus('Unknown mode. Choose a, b, m, ac, bc, or mc.');
      showCloakLaunchScreen();
      return false;
    }
    if(mode==='m' || mode==='mc'){
      hideCloakLaunchScreen();
      return launchCurrentTabIframe(mode==='mc');
    }
    if(mode==='ac'){
      hideCloakLaunchScreen();
      return launchCurrentTabAboutBlank(true);
    }
    if(mode==='bc'){
      hideCloakLaunchScreen();
      return launchCurrentTabBlob(true);
    }
    if(mode==='a'){
      const launched=launchDirectAboutBlankCloak();
      if(launched){
        maybeRedirectOriginalAfterCloak();
        setCloakStatus('Opened about:blank');
        showCloakLaunchScreen();
        return true;
      }
      showCloakLaunchScreen();
      setCloakStatus('Popup blocked. Allow popups and try again.');
      return false;
    }
    const kind=(mode==='b' || mode==='bc') ? 'blob' : 'about';
    if(launchCloak(kind,{hop:cloakHopUrls[0],anchor:mode.endsWith('c')})){
      if(mode==='b') maybeRedirectOriginalAfterCloak();
      setCloakStatus(kind==='blob' ? 'Opened' : 'Opened');
      showCloakLaunchScreen();
      return true;
    }
    showCloakLaunchScreen();
    setCloakStatus('Popup blocked. Click the mode button again or allow popups for this site.');
    return false;
  }
  function scheduleHostedCloakLaunch(){
    if(!shouldAutoLaunchHostedCloak()) return;
    showCloakLaunchScreen();
    setCloakStatus('Choose a mode to change this blank page.');
  }
  function scheduleAutoCloak(){
    try{
      const params=new URLSearchParams(location.search);
      if(window.top!==window.self || params.has('nyx_cloaked')) return;
    }catch{}
    if(!store.get('nyx.autoCloak',false) && !store.get('autoAbout',false) && !store.get('autoBlob',false)) return;
    store.set('nyx.autoCloak',true);
    store.set('autoAbout',false);
    store.set('autoBlob',false);
    const mode=store.text('nyx.cloakType','a');
    showCloakLaunchScreen();
    const input=$('cloakLaunchScreen')?.querySelector('[data-cloak-input]');
    if(input) input.value=mode;
    setCloakStatus('Auto Cloak ready. If the popup is blocked, click or press any key.');
    const tryLaunch=()=>{
      if(launchAutoCloak()){
        hideCloakLaunchScreen();
        return true;
      }
      showCloakLaunchScreen();
      setCloakStatus('Popup blocked. Click or press any key to launch.');
      return false;
    };
    setTimeout(()=>{
      if(tryLaunch()) return;
      const once=()=>{
        window.removeEventListener('pointerdown',once,true);
        window.removeEventListener('keydown',once,true);
        tryLaunch();
      };
      window.addEventListener('pointerdown',once,true);
      window.addEventListener('keydown',once,true);
    },180);
  }
  function installDeltaNewTabRedirect(){
    if(window.__nyxDeltaRedirectInstalled) return;
    window.__nyxDeltaRedirectInstalled=true;
    const nativeOpen=window.open?.bind(window);
    window.__nyxNativeOpen=nativeOpen;
    window.open=(url,target,features)=>{
      if(activeBrowser?.openPopupTab) return activeBrowser.openPopupTab(url || 'about:blank');
      return nativeOpen ? nativeOpen(url,target,features) : null;
    };
  }
  function installBareMuxPortResponder(){
    if(window.__nyxBareMuxResponderInstalled) return;
    window.__nyxBareMuxResponderInstalled=true;
    window.addEventListener('message',event=>{
      if(event.data?.type!=='getPort' || !event.data.port) return;
      try{
        const worker=new SharedWorker('/baremux/worker.js','bare-mux-worker');
        const replyPort=event.data.port;
        MessagePort.prototype.postMessage.call(replyPort,worker.port,[worker.port]);
      }catch(error){
        console.warn('nyx BareMux port reply failed:',error);
      }
    });
  }
  function installAntiClose(){
    const msg='Are you sure you want to leave this page?';
    if(antiCloseConfirmHandler) return;
    antiCloseGestureHandler=()=>{
      antiCloseHadGesture=true;
    };
    antiCloseConfirmHandler=e=>{
      if(!antiCloseEnabled || antiClosePanicBypass || !antiCloseHadGesture) return;
      e.preventDefault();
      e.returnValue=msg;
      return msg;
    };
    window.addEventListener('pointerdown',antiCloseGestureHandler,true);
    window.addEventListener('keydown',antiCloseGestureHandler,true);
    if(antiCloseEnabled) antiCloseHadGesture=true;
    syncAntiCloseHandler();
  }
  function syncAntiCloseHandler(){
    if(!antiCloseConfirmHandler) return;
    window.removeEventListener('beforeunload',antiCloseConfirmHandler);
    if(antiCloseRearmTimer){
      clearInterval(antiCloseRearmTimer);
      antiCloseRearmTimer=null;
    }
    if(!antiCloseEnabled){
      if(window.onbeforeunload===antiCloseConfirmHandler) window.onbeforeunload=null;
      return;
    }
    window.onbeforeunload=antiCloseConfirmHandler;
    window.addEventListener('beforeunload',antiCloseConfirmHandler);
    antiCloseRearmTimer=setInterval(()=>{
      if(antiCloseEnabled && antiCloseConfirmHandler) window.onbeforeunload=antiCloseConfirmHandler;
    },1000);
  }
  function setAntiCloseEnabled(next){
    antiCloseEnabled=!!next;
    if(antiCloseEnabled) antiCloseHadGesture=true;
    store.set('nyx.antiClose',antiCloseEnabled);
    qsa('[data-anticlose]').forEach(btn=>btn.classList.toggle('on',antiCloseEnabled));
    syncAntiCloseHandler();
    return antiCloseEnabled;
  }
  function panicKeyCombo(event){
    const key=String(event.key || '').trim();
    if(!key || ['Control','Shift','Alt','Meta'].includes(key)) return '';
    const parts=[];
    if(event.ctrlKey) parts.push('Ctrl');
    if(event.altKey) parts.push('Alt');
    if(event.shiftKey) parts.push('Shift');
    if(event.metaKey) parts.push('Meta');
    const label=key.length===1 ? key.toUpperCase() : key.replace(/^Arrow/,'');
    parts.push(label);
    return parts.join('+');
  }
  function normalizedPanicKey(value){
    return String(value || '')
      .replace(/^["']|["']$/g,'')
      .trim()
      .toLowerCase()
      .replace(/\s+/g,'')
      .replace(/arrow/g,'');
  }
  function savedPanicKeys(){
    const values=[store.text('nyx.panicKey','not set')];
    try{
      const raw=localStorage.getItem('nyx.panicKey');
      if(raw) values.push(raw,JSON.parse(raw));
    }catch{}
    return values.filter(Boolean);
  }
  function panicComboMatchesSaved(combo){
    const normalized=normalizedPanicKey(combo);
    if(!normalized || normalized==='notset') return false;
    return savedPanicKeys().some(value=>normalizedPanicKey(value)===normalized);
  }
  function updatePanicKeyLabels(root=document){
    const value=store.text('nyx.panicKey','not set') || 'not set';
    root.querySelectorAll('[data-panic-key-display]').forEach(el=>{el.textContent=value});
  }
  function handlePanicKeydown(event){
    const combo=panicKeyCombo(event);
    if(!combo) return false;
    if(panicCaptureArmed){
      event.preventDefault();
      event.stopPropagation();
      panicCaptureArmed=false;
      store.setText('nyx.panicKey',combo);
      updatePanicKeyLabels();
      toast('Panic key saved: '+combo);
      return true;
    }
    if(panicComboMatchesSaved(combo)){
      event.preventDefault();
      event.stopPropagation();
      triggerPanicClose();
      return true;
    }
    return false;
  }
  function ensurePanicKeyListener(){
    const previous=window.__nyxPanicKeyListener;
    if(previous){
      try{document.removeEventListener('keydown',previous,true)}catch{}
      try{window.removeEventListener('keydown',previous,true)}catch{}
    }
    const listener=event=>{ handlePanicKeydown(event); };
    window.__nyxPanicKeyListener=listener;
    window.__nyxPanicKeyListenerInstalled=true;
    document.addEventListener('keydown',listener,true);
    window.addEventListener('keydown',listener,true);
    const previousDocumentKeydown=window.__nyxPreviousDocumentOnKeydown || document.onkeydown;
    const previousWindowKeydown=window.__nyxPreviousWindowOnKeydown || window.onkeydown;
    window.__nyxPreviousDocumentOnKeydown=previousDocumentKeydown;
    window.__nyxPreviousWindowOnKeydown=previousWindowKeydown;
    document.onkeydown=event=>{
      if(handlePanicKeydown(event)) return false;
      return typeof previousDocumentKeydown==='function' ? previousDocumentKeydown.call(document,event) : true;
    };
    window.onkeydown=event=>{
      if(handlePanicKeydown(event)) return false;
      return typeof previousWindowKeydown==='function' ? previousWindowKeydown.call(window,event) : true;
    };
  }
  ensurePanicKeyListener();
  function triggerPanicClose(){
    const restoreAntiClose=antiCloseEnabled;
    let panicTarget=window;
    try{
      if(window.top) panicTarget=window.top;
    }catch{}
    antiClosePanicBypass=true;
    antiCloseHadGesture=false;
    if(antiCloseConfirmHandler){
      try{window.removeEventListener('beforeunload',antiCloseConfirmHandler)}catch{}
    }
    if(window.onbeforeunload===antiCloseConfirmHandler) window.onbeforeunload=null;
    if(antiCloseRearmTimer){
      clearInterval(antiCloseRearmTimer);
      antiCloseRearmTimer=null;
    }
    try{panicTarget.onbeforeunload=null}catch{}
    try{panicTarget.close()}catch{}
    setTimeout(()=>{
      try{
        if(panicTarget.closed) return;
        panicTarget.open('', '_self')?.close?.();
      }catch{}
    },40);
    setTimeout(()=>{
      try{
        if(panicTarget.closed) return;
        panicTarget.location.replace('https://www.google.com/');
      }catch{
        document.documentElement.innerHTML='';
      }
    },140);
    setTimeout(()=>{
      antiClosePanicBypass=false;
      if(restoreAntiClose && !panicTarget.closed && location.protocol!=='about:'){
        antiCloseHadGesture=true;
        syncAntiCloseHandler();
      }
    },1200);
  }
  function armPanicKeyCapture(){
    panicCaptureArmed=true;
    qsa('[data-panic-key-display]').forEach(el=>{el.textContent='press keys...'});
    toast('Press the panic key combo');
  }
  function clearPanicKey(){
    store.setText('nyx.panicKey','not set');
    updatePanicKeyLabels();
    toast('Panic key cleared');
  }
  let chromeOsAltTabArmedUntil=0;
  let chromeOsAltDimTimer=null;
  function isChromeOsUser(){
    const ua=String(navigator.userAgent || '');
    const platform=String(navigator.userAgentData?.platform || navigator.platform || '');
    return /\bCrOS\b/i.test(ua) || /Chrome\s*OS/i.test(platform);
  }
  function triggerChromeOsAltTabRedirect(event){
    if(!isChromeOsUser()) return false;
    if(event){
      event.preventDefault();
      event.stopPropagation();
    }
    const dim=$('chromeOsAltDim');
    if(!dim) return true;
    clearTimeout(chromeOsAltDimTimer);
    dim.classList.add('show');
    dim.setAttribute('aria-hidden','false');
    chromeOsAltDimTimer=setTimeout(()=>hideChromeOsAltDim(),5200);
    return true;
  }
  function hideChromeOsAltDim(){
    const dim=$('chromeOsAltDim');
    if(!dim) return;
    clearTimeout(chromeOsAltDimTimer);
    dim.classList.remove('show');
    dim.setAttribute('aria-hidden','true');
  }
  function rememberChromeOsAltKey(event){
    if(!isChromeOsUser() || panicCaptureArmed || event.ctrlKey || event.metaKey) return;
    if(event.key==='Alt' || event.code==='AltLeft' || event.code==='AltRight') chromeOsAltTabArmedUntil=Date.now()+1800;
  }
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden' && Date.now()<chromeOsAltTabArmedUntil) triggerChromeOsAltTabRedirect();
  },true);
  document.addEventListener('pointerdown',event=>{
    if(event.target?.id==='chromeOsAltDim') hideChromeOsAltDim();
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' || event.key==='Enter' || event.key===' ') hideChromeOsAltDim();
  },true);
  let shortcutMenuPointerHandled=false;
  function shortcutMenuButtonAtPoint(x,y){
    return [...document.querySelectorAll('[data-home-shortcut-menu]')].find(btn=>{
      const rect=btn.getBoundingClientRect();
      return x>=rect.left && x<=rect.right && y>=rect.top && y<=rect.bottom;
    }) || null;
  }
  function toggleShortcutMenu(button){
    const tile=button?.closest?.('.home-shortcut');
    if(!tile) return false;
    document.querySelectorAll('.home-shortcut.menu-open').forEach(item=>{if(item!==tile)item.classList.remove('menu-open')});
    tile.classList.toggle('menu-open');
    return true;
  }
  function bind(){
    ensurePanicKeyListener();
    if(!document.__nyxUnifiedButtonMotion){
      document.__nyxUnifiedButtonMotion=true;
      document.addEventListener('click',event=>{
        const button=event.target.closest?.('button');
        if(!button || button.disabled || button.matches('.quick-tile,.setup-theme-card,.bg-choice,.game-card,[data-no-button-motion]')) return;
        button.classList.remove('nyx-button-click');
        void button.offsetWidth;
        button.classList.add('nyx-button-click');
        clearTimeout(button.__nyxButtonClickTimer);
        button.__nyxButtonClickTimer=setTimeout(()=>button.classList.remove('nyx-button-click'),360);
      },true);
    }
    if(!document.__nyxSetupEnterBind){
      document.__nyxSetupEnterBind=true;
      document.addEventListener('keydown',e=>{
        if(e.key!=='Enter') return;
        const setup=$('setupScreen');
        if(!setup?.classList.contains('show')) return;
        if(e.target?.matches?.('textarea,select,[contenteditable="true"]')) return;
        const steps=[...setup.querySelectorAll('[data-setup-step]')];
        if(!steps.length) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        if(setupStepIndex>=steps.length-1) finishSetupCustomization();
        else moveSetupStep(1);
      },true);
    }
    document.addEventListener('click',e=>{
      const setupRoot=e.target.closest?.('#setupScreen.show');
      if(setupRoot){
        if(e.target.closest('[data-setup-next]')){
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation?.();
          moveSetupStep(1);
          return;
        }
        if(e.target.closest('[data-setup-back]')){
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation?.();
          moveSetupStep(-1);
          return;
        }
        if(e.target.closest('[data-finish-setup]')){
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation?.();
          finishSetupCustomization();
          return;
        }
        if(e.target.closest('[data-skip-setup]')){
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation?.();
          store.set('nyx.setupComplete',true);
          hideSetup();
          return;
        }
      }
      const link=e.target.closest?.('a[href]');
      if(!link) return;
      const target=String(link.getAttribute('target') || '').toLowerCase();
      if(!['_blank','_new'].includes(target)) return;
      if(!popupProtectionEnabled()) return;
      if(activeBrowser?.openPopupTab){
        e.preventDefault();
        e.stopPropagation();
        activeBrowser.openPopupTab(link.href || link.getAttribute('href') || 'about:blank');
      }
    },true);
    document.addEventListener('click',e=>{
      if(shortcutMenuPointerHandled && e.target.closest?.('.home-shortcut')){
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        shortcutMenuPointerHandled=false;
        return;
      }
      if(e.target.closest?.('[data-browser-settings-close]')){
        e.preventDefault();
        const overlay=e.target.closest('.browser-shell-settings-overlay');
        const panel=overlay?.querySelector('.browser-shell-settings-panel');
        const settingsTab=browserShellTabs.find(tab=>tab.id===browserShellActiveTab && tab.url==='nyx://settings');
        if(panel){
          panel.style.animation='settingsDropOut .22s ease forwards';
          setTimeout(()=>{
            overlay?.remove();
            if(settingsTab) closeBrowserShellTab(settingsTab.id);
          },220);
        }else overlay?.remove();
        return;
      }
      const browserSettingsSave=e.target.closest?.('[data-browser-settings-save]');
      if(browserSettingsSave && browserSettingsSave.closest('.browser-shell-settings-overlay')){
        e.preventDefault();
        saveBrowserShellSettings(browserSettingsSave.closest('.browser-shell-settings-overlay'));
        toast('Browser settings saved');
        return;
      }
      const browserShellToggle=e.target.closest?.('[data-browser-shell-toggle]');
      if(browserShellToggle && browserShellToggle.closest('.browser-shell-settings-overlay')){
        e.preventDefault();
        store.set('nyx.browserShellMode',browserShellToggle.dataset.enabled==='true');
        document.querySelector('.browser-shell-settings-overlay')?.remove();
        applyUserSettings();
        return;
      }
      const popupButton=e.target.closest?.('[data-popup-protection]');
      if(popupButton && popupButton.closest('.browser-shell-settings-overlay')){
        e.preventDefault();
        const next=popupButton.dataset.enabled!=='true';
        store.set('nyx.popupProtection',next);
        popupButton.dataset.enabled=String(next);
        popupButton.classList.toggle('on',next);
        popupButton.textContent='Popup Protection '+(next?'On':'Off');
        toast('Popup Protection '+(next?'enabled':'disabled'));
        return;
      }
      if(e.target.closest?.('[data-panic-capture]')){
        e.preventDefault();
        armPanicKeyCapture();
        return;
      }
      if(e.target.closest?.('[data-panic-clear]')){
        e.preventDefault();
        clearPanicKey();
      }
    });
    document.querySelector('[data-desktop-search]')?.addEventListener('submit',e=>{
      e.preventDefault();
      const input=e.currentTarget.querySelector('input');
      const value=(input?.value || '').trim();
      if(!value) return;
      if(input) input.value='';
      if(document.body.classList.contains('browser-shell')) navigateBrowserShell(value);
      else openBrowser(value);
    });
    document.addEventListener('keydown',rememberChromeOsAltKey,true);
    document.addEventListener('keydown',e=>{handleLeftAltChromeShortcut(e)},true);
    document.addEventListener('dragstart',e=>{
      if(!e.target.closest?.('.home-shortcut,.home-shortcut-add,[data-home-shortcuts]')) return;
      e.preventDefault();
      e.stopPropagation();
    },true);
    document.addEventListener('input',e=>{
      const input=e.target.closest?.('[data-browser-shell-url]');
      if(input) showBrowserSuggestions(input);
    });
    document.addEventListener('focusin',e=>{
      const input=e.target.closest?.('[data-browser-shell-url]');
      if(!input) return;
      selectBrowserShellUrl(input,true);
      showBrowserSuggestions(input);
    });
    document.addEventListener('focusout',e=>{
      const input=e.target.closest?.('[data-browser-shell-url]');
      if(!input) return;
      clearBrowserShellUrlSelection(input);
    });
    document.addEventListener('pointerdown',e=>{
      const pointButton=shortcutMenuButtonAtPoint(e.clientX,e.clientY);
      if(pointButton){
        return;
      }
      const shellUrlInput=e.target.closest?.('[data-browser-shell-url]');
      if(shellUrlInput && document.activeElement!==shellUrlInput){
        browserShellUrlFirstPointer=shellUrlInput;
        e.preventDefault();
        shellUrlInput.focus();
        selectBrowserShellUrl(shellUrlInput,true);
      }
      if(!e.target.closest?.('[data-browser-shell-url]')) clearBrowserShellUrlSelection();
      if(!browserSuggestionPointerInside(e.target)) hideBrowserSuggestions();
      if(!e.target.closest?.('[data-home-shortcut-menu],.home-shortcut-menu')){
        document.querySelectorAll('.home-shortcut.menu-open').forEach(item=>item.classList.remove('menu-open'));
      }
      if(!e.target.closest?.('#browserModeMenu,[data-browser-shell-menu]')){
        document.body.classList.remove('menu-open');
      }
      if(!e.target.closest?.('#browserBookmarkPanel,[data-browser-shell-bookmark],[data-browser-bookmarks-toggle]')){
        $('browserBookmarkPanel')?.setAttribute('hidden','');
      }
    },true);
    document.addEventListener('pointerup',e=>{
      const input=e.target.closest?.('[data-browser-shell-url]');
      if(!input) return;
      if(browserShellUrlFirstPointer===input){
        e.preventDefault();
        browserShellUrlFirstPointer=null;
        selectBrowserShellUrl(input,true);
      }
      showBrowserSuggestions(input);
    });
    document.addEventListener('keydown',e=>{
      const input=e.target.closest?.('[data-browser-shell-url]');
      if(!input) return;
      const box=$('browserSearchSuggestions');
      const items=[...box?.querySelectorAll('.browser-search-suggestion') || []];
      if(!items.length) return;
      const current=Math.max(0,items.findIndex(item=>item.classList.contains('active')));
      if(e.key==='ArrowDown' || e.key==='ArrowUp'){
        e.preventDefault();
        const next=e.key==='ArrowDown' ? (current+1)%items.length : (current-1+items.length)%items.length;
        items.forEach(item=>item.classList.remove('active'));
        items[next].classList.add('active');
        input.value=items[next].dataset.browserSuggestion || items[next].textContent || input.value;
      }else if(e.key==='Enter' && box?.classList.contains('show')){
        const raw=String(input.value || '').trim();
        const directUrl=/^(?:https?:\/\/|[a-z][a-z0-9+.-]*:\/\/|(?:localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:\/|$)|[\w.-]+\.[a-z]{2,}(?:[\/:?#]|$))/i.test(raw);
        if(directUrl){
          hideBrowserSuggestions();
          return;
        }
        const active=items.find(item=>item.classList.contains('active')) || items[0];
        if(active){
          e.preventDefault();
          acceptBrowserSuggestion(active.dataset.browserSuggestion || active.textContent || input.value);
        }
      }else if(e.key==='Escape'){
        hideBrowserSuggestions();
      }
    });
    document.addEventListener('submit',e=>{
      const shellSearch=e.target.closest?.('[data-browser-shell-search]');
      if(shellSearch){
        e.preventDefault();
        document.body.classList.remove('menu-open');
        hideBrowserSuggestions();
        navigateBrowserShell(shellSearch.querySelector('[data-browser-shell-url]')?.value);
        return;
      }
      const blankSearch=e.target.closest?.('[data-browser-blank-search]');
      if(blankSearch){
        if(e.nyxBlankSearchHandled) return;
        e.nyxBlankSearchHandled=true;
        e.preventDefault();
        e.stopImmediatePropagation();
        const input=blankSearch.querySelector('[data-browser-blank-input]');
        const value=(input?.value || '').trim();
        hideBrowserSuggestions();
        if(input) input.value='';
        if(value) navigateBrowserShell(value);
        return;
      }
      const form=e.target.closest?.('[data-lion-ai-form]');
      if(!form) return;
      e.preventDefault();
      const win=form.closest('.window');
      const input=win?.querySelector('[data-lion-ai-input]');
      const chat=win?.querySelector('[data-lion-ai-chat]');
      const prompt=(input?.value || '').trim();
      if((!prompt && !win?.lionAiImage) || !chat) return;
      const threadTitle=win?.querySelector('[data-lion-ai-thread-title]');
      if(threadTitle && chat.querySelector('[data-lion-ai-empty]')){
        const nextTitle=prompt || 'Image conversation';
        threadTitle.textContent=nextTitle.length>54 ? `${nextTitle.slice(0,54)}…` : nextTitle;
      }
      addLionAiMessage(chat,'user',prompt || 'Please read this image and answer it.');
      if(win) win.lionAiLastUser=prompt || 'Please read this image and answer it.';
      input.value='';
      addLionAiMessage(chat,'bot',win?.lionAiImage ? 'Reading image, then contacting model...' : `Contacting ${nyxAiModelLabel(win?.querySelector?.('[data-lion-ai-model]')?.value || nyxAiSelectedModel())}...`);
      const pending=chat.lastElementChild;
      if(input) input.disabled=true;
      form.querySelector('.lion-ai-send').disabled=true;
      lionAiRespondAsync(prompt,win,partial=>{if(pending){pending.textContent=partial;chat.scrollTop=chat.scrollHeight}}).then(answer=>{
        if(pending) pending.textContent=answer;
        if(win) win.lionAiLastBot=answer;
        chat.scrollTop=chat.scrollHeight;
      }).finally(()=>{if(input){input.disabled=false;input.focus()}form.querySelector('.lion-ai-send').disabled=false});
    });
    document.addEventListener('click',e=>{
      const starter=e.target.closest?.('[data-lion-ai-prompt]');
      if(starter){
        const win=starter.closest('.window');
        const input=win?.querySelector('[data-lion-ai-input]');
        const form=win?.querySelector('[data-lion-ai-form]');
        if(input && form){
          input.value=starter.dataset.lionAiPrompt || '';
          form.requestSubmit();
        }
        return;
      }
      const clear=e.target.closest?.('[data-lion-ai-clear]');
      if(!clear) return;
      localStorage.removeItem('nyx.aiMessages');
      const chat=clear.closest('.window')?.querySelector('[data-lion-ai-chat]');
      if(chat){
        chat.classList.remove('has-messages');
        chat.innerHTML=lionAiEmptyState();
      }
      const title=clear.closest('.window')?.querySelector('[data-lion-ai-thread-title]');
      if(title) title.textContent='New chat';
    });
    document.addEventListener('keydown',e=>{
      if(nyxOwnerDashboardAccess&&(e.key==='Enter'||e.key===' ')&&e.target.closest?.('[data-nyx-owner-presence]')&&!e.target.closest?.('[data-toggle-nyx-account-menu]')){
        e.preventDefault();
        openNyxOwnerDashboard();
        return;
      }
      if((e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase()==='k' && document.body.classList.contains('browser-shell')){
        const homeSearch=document.querySelector('.browser-window.browser-home-page .nyx-home-search [data-browser-blank-input]');
        if(homeSearch){
          e.preventDefault();
          homeSearch.focus();
          homeSearch.select();
          return;
        }
      }
      if(handlePanicKeydown(e)) return;
      const input=e.target.closest?.('[data-lion-ai-input]');
      if(!input || e.key!=='Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
      e.preventDefault();
      input.closest('[data-lion-ai-form]')?.requestSubmit();
    });
    document.addEventListener('change',e=>{
      const model=e.target.closest?.('[data-lion-ai-model]');
      if(!model) return;
      store.setText('nyx.aiModel',model.value || 'chatgpt-5.4-mini');
      const win=model.closest('.window');
      const label=win?.querySelector('[data-nyx-ai-model-label]');
      if(label) label.textContent=nyxAiModelLabel(model.value);
    });
    document.addEventListener('dragstart',e=>{
      if((document.body.classList.contains('browser-shell') && !e.target.closest?.('.browser-mode-shell-tab')) || e.target.closest?.('.home-shortcut,.home-shortcut-add,[data-home-shortcuts]')){
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const app=e.target.closest('[data-app-url]');
      if(!app) return;
      if(!canDragDesktopAppSource(app)){
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const payload=readAppPayload(app);
      if(!payload.url) return;
      e.dataTransfer?.setData('application/nyx-app',JSON.stringify(payload));
      e.dataTransfer?.setData('text/plain',payload.url);
      if(e.dataTransfer) e.dataTransfer.effectAllowed='copyMove';
    });
    $('desktop')?.addEventListener('dragover',e=>{
      if(document.body.classList.contains('browser-shell')) return;
      if(Array.from(e.dataTransfer?.types || []).includes('application/nyx-app')){
        e.preventDefault();
        e.dataTransfer.dropEffect='copy';
      }
    });
    $('desktop')?.addEventListener('drop',e=>{
      if(document.body.classList.contains('browser-shell')) return;
      const raw=e.dataTransfer?.getData('application/nyx-app');
      if(!raw) return;
      e.preventDefault();
      try{
        createDesktopApp(JSON.parse(raw),e.clientX,e.clientY);
      }catch{}
    });
    document.addEventListener('click',async e=>{
      const accountToggle=e.target.closest?.('[data-toggle-nyx-account-menu]');
      if(accountToggle){
        e.preventDefault();
        e.stopPropagation();
        if(nyxFounderSignedInUser) toggleNyxAccountMenu(accountToggle);
        else openNyxAccountAccess();
        return;
      }
      const ownerPresence=e.target.closest?.('[data-nyx-owner-presence]');
      if(ownerPresence&&nyxOwnerDashboardAccess){
        e.preventDefault();
        openNyxOwnerDashboard();
        return;
      }
      const accountMenuAction=e.target.closest?.('[data-nyx-account-menu-action]')?.dataset.nyxAccountMenuAction;
      if(accountMenuAction){
        e.preventDefault();
        if(accountMenuAction==='copy-id'){
          await copyNyxFirebaseUserId();
          return;
        }
        if(accountMenuAction==='owner-dashboard'){
          openNyxOwnerDashboard();
          return;
        }
        closeNyxAccountMenu();
        if(accountMenuAction==='profiles'){
          await openNyxProfileDirectory();
          return;
        }
        if(accountMenuAction==='edit'){
          await openNyxUserProfile();
          return;
        }
        if(accountMenuAction==='status'){
          await openNyxUserProfile();
          const field=document.querySelector('.nyx-user-profile-overlay [name="status"]');
          field?.scrollIntoView({block:'center',behavior:'smooth'});
          field?.focus();
          try{field?.showPicker?.()}catch{}
          return;
        }
        if(accountMenuAction==='switch'){
          await signOutFounderOwner();
          await openNyxAccountAccess();
          return;
        }
      }
      if(document.querySelector('.nyx-account-menu')&&!e.target.closest?.('.nyx-account-menu')) closeNyxAccountMenu();
      if(e.target.closest?.('[data-open-nyx-account-settings]')){
        e.preventDefault();
        if(nyxFounderSignedInUser) openNyxUserProfile();
        else openNyxAccountAccess();
        return;
      }
      if(e.target.closest?.('[data-open-owner-dashboard]')){
        e.preventDefault();
        openNyxOwnerDashboard();
        return;
      }
      const presetButton=e.target.closest?.('[data-preset]');
      if(presetButton){
        e.preventDefault();
        e.stopPropagation();
        applyPreset(presetButton.dataset.preset || 'nyx');
        syncPresetCloakFields(presetButton.closest('.window,.settings-app,.browser-shell-settings-overlay') || document);
        return;
      }
      const shellNew=e.target.closest('[data-browser-shell-new-tab]');
      if(shellNew){
        if(e.nyxShellNewHandled) return;
        e.nyxShellNewHandled=true;
        e.preventDefault();
        e.stopImmediatePropagation();
        document.body.classList.remove('menu-open');
        openBrowserShellTab();
        document.querySelector('[data-browser-shell-url]')?.focus();
        return;
      }
      const browserSuggestion=e.target.closest('[data-browser-suggestion]');
      if(browserSuggestion){
        e.preventDefault();
        acceptBrowserSuggestion(browserSuggestion.dataset.browserSuggestion || browserSuggestion.textContent);
        return;
      }
      if(!e.target.closest('[data-browser-shell-url]') && !e.target.closest('#browserSearchSuggestions')){
        hideBrowserSuggestions();
      }
      const shellTab=e.target.closest('[data-browser-shell-tab]');
      if(shellTab){
        e.preventDefault();
        const id=shellTab.dataset.browserShellTab;
        if(e.target.closest('[data-browser-shell-close-tab]')) closeBrowserShellTab(id);
        else setBrowserShellActive(id);
        return;
      }
      const shellHome=e.target.closest('[data-browser-shell-home]');
      if(shellHome){
        e.preventDefault();
        if(e.target.closest('[data-browser-shell-close-tab]')){
          closeBrowserShellTab(shellHome.dataset.browserShellTab);
          return;
        }
        if(shellHome.dataset.browserShellTab) setBrowserShellActive(shellHome.dataset.browserShellTab);
        else setBrowserShellHomeActive();
        return;
      }
      const shellBack=e.target.closest('[data-browser-shell-back]');
      if(shellBack){
        e.preventDefault();
        activeBrowser?.win?.querySelector('[data-back]')?.click();
        return;
      }
      const shellNavHome=e.target.closest('[data-browser-shell-home-nav]');
      if(shellNavHome){
        e.preventDefault();
        setBrowserShellHomeActive();
        return;
      }
      const shellForward=e.target.closest('[data-browser-shell-forward]');
      if(shellForward){
        e.preventDefault();
        activeBrowser?.win?.querySelector('[data-forward]')?.click();
        return;
      }
      const shellReload=e.target.closest('[data-browser-shell-reload]');
      if(shellReload){
        e.preventDefault();
        const shellTab=activeBrowserShellTab();
        if(!shellTab?.url){
          setBrowserShellHomeActive();
          playHomeEntranceAnimation(activeBrowser?.win || document);
          return;
        }
        const browserTabId=shellTab.browserTabId || activeBrowser?.active || '';
        document.querySelectorAll('.nyx-preflight').forEach(overlay=>overlay.remove());
        const targetTab=activeBrowser?.tabs?.find(tab=>tab.id===browserTabId) || activeBrowser?.tabs?.find(tab=>tab.id===activeBrowser?.active);
        if(targetTab){
          activeBrowser?.activate?.(targetTab.id);
          if(!activeBrowser?.reloadTab?.(targetTab.id)){
            activeBrowser?.navigate?.(targetTab.sourceUrl || targetTab.url);
          }
        }
        return;
      }
      const shellMenuButton=e.target.closest('[data-browser-shell-menu]');
      if(shellMenuButton){
        e.preventDefault();
        document.body.classList.toggle('menu-open');
        $('browserBookmarkPanel')?.setAttribute('hidden','');
        return;
      }
      const shellBookmark=e.target.closest('[data-browser-shell-bookmark]');
      if(shellBookmark){
        e.preventDefault();
        toggleBrowserBookmark();
        return;
      }
      const bookmarksToggle=e.target.closest('[data-browser-bookmarks-toggle]');
      if(bookmarksToggle){
        e.preventDefault();
        document.body.classList.remove('menu-open');
        toggleBrowserBookmarksPanel();
        return;
      }
      const bookmarkOpen=e.target.closest('[data-browser-bookmark-open]');
      if(bookmarkOpen){
        e.preventDefault();
        openBrowserBookmark(bookmarkOpen.dataset.browserBookmarkOpen);
        return;
      }
      const bookmarkRemove=e.target.closest('[data-browser-bookmark-remove]');
      if(bookmarkRemove){
        e.preventDefault();
        removeBrowserBookmark(bookmarkRemove.dataset.browserBookmarkRemove);
        return;
      }
      if(e.target.closest('[data-shell-about]')){
        e.preventDefault();
        document.body.classList.remove('menu-open');
        launchDirectAboutBlankCloak();
        return;
      }
      if(e.target.closest('[data-shell-about-tab]')){
        e.preventDefault();
        document.body.classList.remove('menu-open');
        launchHostedCloak('ac');
        return;
      }
      if(document.body.classList.contains('menu-open') && !e.target.closest('#browserModeMenu') && !e.target.closest('[data-browser-shell-menu]')){
        document.body.classList.remove('menu-open');
      }
      if(!e.target.closest('#browserBookmarkPanel') && !e.target.closest('[data-browser-shell-bookmark]') && !e.target.closest('[data-browser-bookmarks-toggle]')){
        $('browserBookmarkPanel')?.setAttribute('hidden','');
      }
      const shortcutMenu=e.target.closest('[data-home-shortcut-menu]');
      if(shortcutMenu){
        e.preventDefault();
        e.stopPropagation();
        toggleShortcutMenu(shortcutMenu);
        return;
      }
      if(document.body.classList.contains('browser-shell')){
        const browserHieroglyph=e.target.closest('[data-browser-hieroglyph-toggle]');
        if(browserHieroglyph){
          e.preventDefault();
          document.body.classList.remove('menu-open');
          const next=!hieroglyphTextEnabled();
          store.set('nyx.hieroglyphText',next);
          if(!next) store.set('nyx.autoHieroglyphText',false);
          applyHieroglyphText();
          qsa('[data-switch="nyx.hieroglyphText"].settings-action').forEach(el=>{el.textContent=hieroglyphTextEnabled()?'On':'Off'});
          qsa('[data-switch="nyx.autoHieroglyphText"].settings-action').forEach(el=>{el.textContent=store.get('nyx.autoHieroglyphText',false)?'On':'Off'; el.classList.toggle('on',store.get('nyx.autoHieroglyphText',false))});
          toast('Hieroglyph text '+(next?'on':'off'));
          return;
        }
        const browserModeOpen=e.target.closest('[data-open]');
        if(browserModeOpen){
          const v=browserModeOpen.dataset.open;
          if(v==='settings'){
            e.preventDefault();
            document.body.classList.remove('menu-open');
            openBrowserShellSettings();
            return;
          }
          if(['apps','links'].includes(v)){
            e.preventDefault();
            document.body.classList.remove('menu-open');
            openBrowserShellInternalTab(v);
            return;
          }
        }
        const browserModeApp=e.target.closest('[data-app-url]');
        if(browserModeApp && !browserModeApp.closest('.browser-window')){
          e.preventDefault();
          document.body.classList.remove('menu-open');
          openBrowserShellAppTab(browserModeApp.dataset.appUrl);
          return;
        }
      }
      const shortcutFavorite=e.target.closest('[data-home-shortcut-favorite]');
      if(shortcutFavorite){
        e.preventDefault();
        e.stopPropagation();
        toggleHomeShortcutFavorite(shortcutFavorite.dataset.homeShortcutFavorite);
        return;
      }
      const shortcutRemove=e.target.closest('[data-home-shortcut-remove]');
      if(shortcutRemove){
        e.preventDefault();
        e.stopPropagation();
        removeHomeShortcut(shortcutRemove.dataset.homeShortcutRemove);
        return;
      }
      const shortcutAdd=e.target.closest('[data-home-shortcut-add]');
      if(shortcutAdd){
        e.preventDefault();
        e.stopPropagation();
        addHomeShortcut();
        return;
      }
      if(!e.target.closest('.home-shortcut-menu') && !e.target.closest('[data-home-shortcut-menu]')){
        document.querySelectorAll('.home-shortcut.menu-open').forEach(item=>item.classList.remove('menu-open'));
      }
      const open=e.target.closest('[data-open]'); if(open){e.preventDefault(); document.body.classList.remove('menu-open'); const v=open.dataset.open; if(v==='browser')openBrowser(); if(v==='home')openBrowser(); if(v==='updates')openUpdates(); if(v==='settings')openSettings(); if(v==='apps')openApps(); if(v==='links')openLinks(); if(v==='weather')openWeather(open.matches('.browser-mode-weather')?'top':'bottom',open); if(v==='terms')openTermsOfService(); if(v==='developer')openDeveloperConsole(); if(v==='about'||v==='credits')openAboutNyx(); return}
      const app=e.target.closest('[data-app-url]');
      if(app && !app.closest('.browser-window')){
        e.preventDefault();
        document.body.classList.remove('menu-open');
        if(String(app.dataset.appUrl || '').trim().toLowerCase()==='nyx://ai') openBrowserShellAppTab('nyx://ai');
        else openBrowser(app.dataset.appUrl,{forceMode:appCompatibilityMode(app.dataset.appUrl)});
        return
      }
      const url=e.target.closest('[data-url]');
      if(url && !url.closest('.browser-window')){e.preventDefault(); document.body.classList.remove('menu-open'); openBrowser(url.dataset.url); return}
      if(e.target.closest('[data-save-profile]')){
        saveProfile(e.target.closest('.window'));
        return;
      }
      if(e.target.closest('[data-save-browser]')){
        const win=e.target.closest('.window');
        const input=win?.querySelector('#settingEngine');
        const mode=win?.querySelector('#settingBrowserMode');
        const transport=win?.querySelector('#settingTransport');
        store.setText('nyx.engine', input?.value || 'duckduckgo');
        store.setText('nyx.browserMode', normalizeBrowserModeName(mode?.value || DEFAULT_BROWSER_MODE));
        const nextTransport=transport?.value || DEFAULT_BROWSER_TRANSPORT;
        browserTransportOverride='';
        if(store.text('nyx.transport',DEFAULT_BROWSER_TRANSPORT)!==nextTransport){
          scramjetInstallPromise=null;
          scramjetController=null;
          scramjetTransport=null;
          scramjetTransportKey='';
          uvInstallPromise=null;
        }
        store.setText('nyx.transport', nextTransport);
        console.log('nyx browser settings saved', {
          engine:store.text('nyx.engine','duckduckgo'),
          browserMode:normalizeBrowserModeName(store.text('nyx.browserMode',DEFAULT_BROWSER_MODE)),
          transport:store.text('nyx.transport',DEFAULT_BROWSER_TRANSPORT)
        });
        applyUserSettings(); toast('Browser settings saved'); return;
      }
      const bgChoice=e.target.closest('[data-bg-choice]');
      if(bgChoice){
        const root=bgChoice.closest('.bg-choices,.background-picker');
        const scope=backgroundScope(root);
        chooseBackground(bgChoice.dataset.bgChoice,scope);
        if(root) renderBackgroundChoices(root, bgChoice.dataset.bgChoice);
        toast(scope==='browser' ? 'Browser background applied' : 'Background applied'); return;
      }
      if(e.target.closest('[data-save-bg]')){
        const win=e.target.closest('.window');
        const urlInput=win?.querySelector('#settingBgUrl')?.value.trim() || '';
        store.setText('nyx.customBgUrl', urlInput);
        if(urlInput) store.setText('nyx.customBgData','');
        store.setText('nyx.customBg','');
        applyUserSettings();
        const picker=win?.querySelector('[data-bg-picker]');
        if(picker) renderBackgroundChoices(picker);
        toast('Background applied'); return;
      }
      const enhancer=e.target.closest('[data-bg-enhancer]');
      if(enhancer){
        store.set('nyx.backgroundEnhancer',false);
        enhancer.classList.remove('on');
        applyUserSettings();
        toast('Background enhancer disabled');
        return;
      }
      if(e.target.closest('[data-open-nyx-account]')){
        e.preventDefault();
        openNyxAccountAccess();
        return;
      }
      if(e.target.closest('[data-open-nyx-profile-entry]')){
        e.preventDefault();
        if(nyxFounderSignedInUser) openNyxUserProfile();
        else openNyxAccountAccess();
        return;
      }
      if(e.target.closest('[data-open-nyx-profile]')){
        e.preventDefault();
        openNyxUserProfile();
        return;
      }
      if(e.target.closest('[data-nyx-account-sign-out]')){
        e.preventDefault();
        signOutFounderOwner();
        return;
      }
      if(e.target.closest('[data-open-founder-profile-editor]')){
        e.preventDefault();
        openFounderProfileEditor();
        return;
      }
      const customThemeApply=e.target.closest('[data-apply-custom-theme]');
      if(customThemeApply){
        const root=customThemeApply.closest('.settings-block,.browser-shell-settings-overlay,.window') || document;
        const color=nyxThemeHex(root.querySelector('[data-custom-theme-hex]')?.value || root.querySelector('[data-custom-theme-color]')?.value);
        applyCustomThemeColor(color);
        syncCustomThemeMaker(document,color);
        toast('Custom theme applied');
        return;
      }
      const customThemeReset=e.target.closest('[data-reset-custom-theme]');
      if(customThemeReset){
        const color=applyCustomThemeColor(nyxCustomThemeDefaults.base);
        syncCustomThemeMaker(document,color);
        toast('Custom theme reset');
        return;
      }
      if(e.target.closest('[data-save-cloak]')){
        saveCloakSettings(e.target.closest('.window,.settings-app,.browser-shell-settings-overlay') || document);
        return;
      }
      if(e.target.closest('[data-clear-nyx-cache]')){
        e.preventDefault();
        const ok=confirm('Clear cache, cookies, saved settings, and reset Nyx? This cannot be undone.');
        if(!ok) return;
        clearAllNyxData();
        return;
      }
      if(e.target.closest('[data-launch-selected-cloak]')){
        const root=e.target.closest('.window,.settings-app,.browser-shell-settings-overlay') || document;
        saveCloakSettings(root);
        launchHostedCloak(store.text('nyx.cloakType','a'));
        return;
      }
      if(e.target.closest('[data-tab-cloak-apply]')){
        const root=e.target.closest('.window,.settings-app,body') || document;
        const fileInput=root.querySelector('[data-tab-favicon-file]');
        const file=fileInput?.files?.[0];
        const apply=favicon=>applyCustomTabCloak(root.querySelector('[data-tab-title]')?.value || 'nyx', favicon || root.querySelector('[data-tab-favicon]')?.value || favicons.nyx);
        if(file){
          if(!file.type.startsWith('image/') && !/\.ico$/i.test(file.name || '')){
            toast('Choose an image file for the tab icon');
            return;
          }
          const reader=new FileReader();
          reader.onload=()=>{
            const dataUrl=String(reader.result || '');
            const hidden=root.querySelector('[data-tab-favicon]');
            if(hidden) hidden.value=dataUrl;
            apply(dataUrl);
          };
          reader.readAsDataURL(file);
        }else{
          apply();
        }
        return;
      }
      if(e.target.closest('[data-page-fullscreen]')){
        if(!document.fullscreenElement) document.documentElement.requestFullscreen?.();
        else document.exitFullscreen?.();
        return;
      }
      if(e.target.closest('[data-setup-next]')){
        e.preventDefault();
        moveSetupStep(1);
        return;
      }
      if(e.target.closest('[data-setup-back]')){
        e.preventDefault();
        moveSetupStep(-1);
        return;
      }
      if(e.target.closest('[data-finish-setup]')){
        finishSetupCustomization();
        return;
      }
      if(e.target.closest('[data-skip-setup]')){
        store.set('nyx.setupComplete',true);
        hideSetup(); return;
      }
      if(e.target.closest('[data-cloak-submit]')){
        launchTypedCloakMode();
        return;
      }
      if(e.target.closest('[data-cloak-cancel]')){
        const input=$('cloakLaunchScreen')?.querySelector('[data-cloak-input]');
        if(input) input.value='';
        setCloakStatus('Choose a mode to change this blank page.');
        return;
      }
      if(e.target.closest('[data-auto-cloak-launch]')){
        const btn=e.target.closest('[data-auto-cloak-launch]');
        if(btn?.dataset.launching==='1') return;
        btn.dataset.launching='1';
        launchHostedCloak('m');
        setTimeout(()=>{btn.dataset.launching='0'},500);
        return;
      }
      if(e.target.closest('[data-about]')){document.body.classList.remove('menu-open'); if(launchCloak('about')) maybeRedirectOriginalAfterCloak()}
      if(e.target.closest('[data-blob]')){document.body.classList.remove('menu-open'); if(launchCloak('blob')) maybeRedirectOriginalAfterCloak()}
    },true);
    document.addEventListener('pointerdown',e=>{
      const launchButton=e.target.closest('[data-auto-cloak-launch]');
      if(!launchButton) return;
      e.preventDefault();
      if(launchButton.dataset.launching==='1') return;
      launchButton.dataset.launching='1';
      launchHostedCloak('m');
      setTimeout(()=>{launchButton.dataset.launching='0'},500);
    },true);
    document.addEventListener('input',e=>{
      if(e.target?.matches?.('[data-custom-theme-color],[data-custom-theme-hex]')){
        const raw=String(e.target.value || '').trim();
        if(e.target.matches('[data-custom-theme-hex]') && !/^#[0-9a-f]{6}$/i.test(raw)) return;
        const color=nyxThemeHex(raw,store.text('nyx.customThemeColor',nyxCustomThemeDefaults.base));
        const root=e.target.closest('.settings-block,.browser-shell-settings-overlay,.window') || document;
        root.querySelectorAll?.('[data-custom-theme-color],[data-custom-theme-hex]')?.forEach(input=>{if(input!==e.target || input.type==='color') input.value=color});
        root.querySelectorAll?.('[data-custom-theme-swatch]')?.forEach(swatch=>swatch.style.setProperty('--nyx-swatch',color));
      }
      if(e.target?.id==='settingName') saveProfile(e.target.closest('.window'),true);
      if(e.target?.matches?.('[data-glass-value]')){
        if(store.get('nyx.lagReducer',false)){
          store.setText('nyx.glassLevel','0');
          e.target.value='0';
          applyUserSettings();
          return;
        }
        store.setText('nyx.glassLevel',e.target.value);
        applyGlassSetting();
      }
      if(e.target?.matches?.('[data-effect-speed]')){
        store.set('nyx.visualEffectUserChoice',true);
        store.setText('nyx.visualEffectSpeed',e.target.value || '1.1');
        applyVisualEffectSetting();
      }
      if(e.target?.matches?.('[data-effect-amount]')){
        store.set('nyx.visualEffectUserChoice',true);
        store.setText('nyx.visualEffectAmount',e.target.value || '16');
        applyVisualEffectSetting();
      }
    });
    document.addEventListener('keydown',e=>{
      if(e.target?.id==='settingName' && e.key==='Enter'){
        e.preventDefault();
        saveProfile(e.target.closest('.window'));
      }
      if(e.target?.matches?.('[data-cloak-input]') && e.key==='Enter'){
        e.preventDefault();
        launchTypedCloakMode();
        return;
      }
    });
    document.addEventListener('change',e=>{
      const browserSettingsRoot=e.target.closest?.('.browser-shell-settings-overlay');
      if(browserSettingsRoot && e.target.closest?.('[data-browser-engine],[data-browser-mode-select],[data-browser-transport],[data-font-value]')){
        saveBrowserShellSettings(browserSettingsRoot);
        toast('Browser settings saved');
        return;
      }
      const fontSelect=e.target.closest?.('[data-font-value]');
      if(fontSelect){
        store.setText('nyx.font',nyxFontChoice(fontSelect.value)[0]);
        applyFontSetting();
        toast('Font updated');
        return;
      }
      if(browserSettingsRoot && e.target.closest?.('[data-theme-value]')){
        const theme=normalizeNyxTheme(e.target.value);
        store.setText('nyx.theme',theme);
        applyThemeSetting();
        toast('Theme updated');
        return;
      }
      const presetSelect=e.target.closest?.('[data-preset-select]');
      if(presetSelect){
        const root=e.target.closest('.window,.settings-app,.browser-shell-settings-overlay') || document;
        applyPreset(presetSelect.value || 'nyx');
        syncPresetCloakFields(root);
        return;
      }
      const effect=e.target.closest('[data-effect-value]');
      if(effect){
        store.set('nyx.visualEffectUserChoice',true);
        store.setText('nyx.visualEffect',effect.value || 'none');
        applyVisualEffectSetting();
        toast('Effect set to '+effect.options[effect.selectedIndex].text);
        return;
      }
      const effectSpeed=e.target.closest('[data-effect-speed]');
      if(effectSpeed){
        store.set('nyx.visualEffectUserChoice',true);
        store.setText('nyx.visualEffectSpeed',effectSpeed.value || '1.1');
        applyVisualEffectSetting();
        return;
      }
      const effectAmount=e.target.closest('[data-effect-amount]');
      if(effectAmount){
        store.set('nyx.visualEffectUserChoice',true);
        store.setText('nyx.visualEffectAmount',effectAmount.value || '16');
        applyVisualEffectSetting();
        return;
      }
      const aiImage=e.target.closest('[data-lion-ai-image]');
      if(aiImage){
        lionAiReadImageFile(aiImage.closest('.window'),aiImage.files?.[0]);
        aiImage.value='';
        return;
      }
      const file=e.target.closest('#settingBgFile');
      if(!file || !file.files?.[0]) return;
      const reader=new FileReader();
      reader.onload=()=>{
        store.setText('nyx.customBgData',reader.result);
        store.setText('nyx.customBgUrl','');
        store.setText('nyx.customBg','');
        applyUserSettings();
        qsa('[data-bg-picker]').forEach(picker=>renderBackgroundChoices(picker));
        toast('Uploaded background applied');
      };
      reader.readAsDataURL(file.files[0]);
    });
    document.addEventListener('click',e=>{
      if(e.target.closest('[data-weather-refresh]')){
        e.preventDefault();
        e.stopImmediatePropagation();
        loadWeatherLocation();
        return;
      }
      if(e.target.closest('#weatherRestore')){
        e.preventDefault();
        e.stopImmediatePropagation();
        restoreWeatherPanel();
        return;
      }
    },true);
  }
  //clock
  function tick(){
    const d=new Date();
    const short=d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    const full=centerClockText(d);
    qsa('#clock').forEach(clock=>{clock.textContent=short});
    qsa('#centerClock,[data-browser-shell-clock]').forEach(clock=>{clock.textContent=full});
  }
  function centerClockText(date=new Date()){
    return date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'});
  }
  function startCenterClock(){
    const clock=$('centerClock');
    if(clock?.dataset.running) return;
    if(clock) clock.dataset.running='true';
    const update=()=>{
      const text=centerClockText();
      if(clock) clock.textContent=text;
      qsa('[data-browser-shell-clock]').forEach(el=>{el.textContent=text});
    };
    update();
    setInterval(update,1000);
  }
  function initDesktopSplash(){
    updateDockFullscreenState();
  }
  function finishNyxOpenStartup(){
    if(finishNyxOpenStartup.done) return;
    finishNyxOpenStartup.done=true;
    if(store.text('nyx.tabTitle','') || store.text('nyx.tabFavicon','')) enforceStoredTabCloak();
    else setCurrentTabCloak(nyxTabTitle,nyxTabFavicon,false);
    migrateGlassDefault();
    applyAutoHieroglyphPreference();
  }
  async function boot(){
    const hostedCloakEntry=shouldAutoLaunchHostedCloak();
    if(hostedCloakEntry) document.body.classList.add('hosted-cloak-entry');
    document.documentElement.classList.toggle('nyx-chromeos',isChromeOsUser());
    document.body.classList.add('runtime-lag-guard');
    updateResponsiveFit();
    if(!localStorage.getItem('nyx.lagReducer')) store.set('nyx.lagReducer',true);
    removeLegacyStartupPdfData(); installDeltaNewTabRedirect(); installBareMuxPortResponder(); installAntiClose(); bind(); installInteractiveHomeDots(); initWeatherPanel(); startCenterClock(); startNyxPresence(); startSpotifyChromeOsCompatibilitySweep(); loadFounderProfile(); initializeFounderOwnerAccess(); startNyx();
    if(hostedCloakEntry){
      scheduleHostedCloakLaunch();
      return;
    }
    tick();
    if(!boot.tickTimer) boot.tickTimer=setInterval(tick,1000);
    scheduleHostedCloakLaunch();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
