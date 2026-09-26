try{const params=new URLSearchParams(location.search);
  const canCloakLaunch=/^https?:$/.test(location.protocol) && window.top===window.self && params.has('nyx_auto_classroom') && !params.has('nyx_real') && !params.has('nyx_no_classroom') && !params.has('nyx_cloaked');
  if(canCloakLaunch){
    const next=new URL(location.href);
    next.searchParams.set('nyx_real','1');
    const nyxTab=window.open('about:blank','_blank');
    const delayHtml=`<!doctype html><html><head><meta charset="utf-8"><title>about:blank</title><style>html,body{margin:0;width:100%;height:100%;background:#fff}</style></head><body><script>setTimeout(function(){location.replace(${JSON.stringify(next.href)});},5000);<\/script></body></html>`;
    try{
      if(nyxTab && !nyxTab.closed && nyxTab.document){
        nyxTab.document.open();
        nyxTab.document.write(delayHtml);
        nyxTab.document.close();
      }
    }catch{}
    setTimeout(()=>{
      try{
        if(nyxTab && !nyxTab.closed && nyxTab.location.href==='about:blank') nyxTab.location.replace(next.href);
        else window.open(next.href,'_blank','noopener');
      }catch{
        window.open(next.href,'_blank','noopener');
      }
    },5000);
    location.replace('https://classroom.google.com/');
  }
  if(/^https?:$/.test(location.protocol) && window.top===window.self && params.has('nyx_auto_classroom') && !params.has('nyx_cloaked')){
    document.documentElement.classList.add('hosted-cloak-entry');
  }
}catch{}
