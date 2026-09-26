(()=>{
  'use strict';
  const API='https://getuwu.christmas/api/v1';
  const $=selector=>document.querySelector(selector);
  const refs={
    form:$('[data-check-form]'),
    input:$('[data-url-input]'),
    filter:$('[data-filter-select]'),
    button:$('[data-check-button]'),
    apiStatus:$('[data-api-status]'),
    notice:$('[data-notice]'),
    resultsSection:$('[data-results-section]'),
    resultsTitle:$('[data-results-title]'),
    resultList:$('[data-result-list]'),
    previewSection:$('[data-preview-section]'),
    screenshotButton:$('[data-screenshot-button]'),
    screenshotWrap:$('[data-screenshot-wrap]'),
    screenshotLoading:$('[data-screenshot-loading]'),
    screenshotImage:$('[data-screenshot-image]')
  };
  let activeController=null;
  let lastReport=null;
  let currentTarget='';

  function applyTheme(){
    let theme='default';
    try{theme=localStorage.getItem('nyx.theme') || 'default'}catch{}
    if(theme && theme!=='default') document.body.classList.add(`theme-${theme}`);
  }
  function normalizeTarget(value){
    const raw=String(value || '').trim();
    if(!raw) throw new Error('Enter a website to check.');
    const candidate=/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    let parsed;
    try{parsed=new URL(candidate)}catch{throw new Error('Enter a valid website or URL.');}
    if(!['http:','https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS links can be checked.');
    return parsed.href;
  }
  function endpoint(path,params={}){
    const url=new URL(API+path);
    Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,value));
    return url.href;
  }
  function showNotice(message,type=''){
    refs.notice.textContent=message;
    refs.notice.className=`notice${type ? ` ${type}` : ''}`;
    refs.notice.hidden=!message;
  }
  function setLoading(loading){
    document.body.classList.toggle('loading',loading);
    refs.button.disabled=loading;
    refs.button.querySelector('span').textContent=loading ? 'Checking…' : 'Run check';
  }
  function setApiStatus(online,label=online?'API online':'API unavailable'){
    refs.apiStatus.classList.toggle('online',online);
    refs.apiStatus.classList.toggle('offline',!online);
    refs.apiStatus.querySelector('span').textContent=label;
  }
  function filterDisplayLabel(filter){
    const key=String(filter?.filter || filter?.key || '').trim().toLowerCase();
    const label=String(filter?.label || filter?.filter || filter?.key || 'Filter');
    return key==='cisco' || /^cisco talos$/i.test(label) ? 'Cisco Umbrella' : label;
  }
  async function fetchJson(url,options={}){
    const response=await fetch(url,{...options,headers:{Accept:'application/json',...(options.headers || {})}});
    if(!response.ok){
      let message=`Request failed (${response.status})`;
      try{const body=await response.json();message=body.error || body.message || message}catch{}
      throw new Error(message);
    }
    return response.json();
  }
  async function loadFilters(){
    try{
      const filters=await fetchJson(endpoint('/filters'));
      const rows=Array.isArray(filters) ? filters : filters.filters;
      if(!Array.isArray(rows)) throw new Error('Unexpected filter response.');
      const fragment=document.createDocumentFragment();
      rows.forEach(item=>{
        if(!item?.key) return;
        const option=document.createElement('option');
        option.value=String(item.key);
        option.textContent=filterDisplayLabel(item);
        fragment.append(option);
      });
      refs.filter.append(fragment);
      setApiStatus(true,`${rows.length} filters ready`);
    }catch(error){
      setApiStatus(false);
      showNotice(`Could not load the filter list: ${error.message}`,'error');
    }
  }
  function resultState(result){
    if(result?.error || result?.ok===false) return {key:'error',label:'Error'};
    if(result?.blocked===true) return {key:'blocked',label:'Blocked'};
    if(result?.blocked===false) return {key:'allowed',label:'Allowed'};
    return {key:'info',label:'Info only'};
  }
  function renderResults(report){
    const results=Array.isArray(report?.results) ? report.results : [];
    const counts={blocked:0,allowed:0,info:0,error:0};
    refs.resultList.replaceChildren();
    results.forEach(result=>{
      const state=resultState(result);
      counts[state.key]+=1;
      const row=document.createElement('article');
      row.className=`result-row ${state.key}`;
      const dot=document.createElement('span');
      dot.className='result-dot';
      dot.setAttribute('aria-hidden','true');
      const copy=document.createElement('div');
      copy.className='result-copy';
      const label=document.createElement('strong');
      label.textContent=filterDisplayLabel(result);
      const category=document.createElement('span');
      category.textContent=result.error || result.category || 'No category returned';
      copy.append(label,category);
      const meta=document.createElement('div');
      meta.className='result-meta';
      const status=document.createElement('span');
      status.className='result-state';
      status.textContent=state.label;
      const timing=document.createElement('span');
      timing.className='result-time';
      timing.textContent=Number.isFinite(Number(result.ms)) ? `${Math.round(Number(result.ms))} ms` : '—';
      meta.append(status,timing);
      row.append(dot,copy,meta);
      refs.resultList.append(row);
    });
    Object.entries(counts).forEach(([key,value])=>{
      const node=$(`[data-count-${key}]`);
      if(node) node.textContent=String(value);
    });
    refs.resultsTitle.textContent=report?.target ? `Results for ${report.target}` : 'Results';
    refs.resultsSection.hidden=false;
    lastReport={...report,results};
  }
  function safeImageUrl(value){
    try{const parsed=new URL(String(value || ''));return ['http:','https:','data:'].includes(parsed.protocol) ? parsed.href : ''}catch{return ''}
  }
  function renderPreview(preview,target){
    const resolved=preview?.url || target;
    $('[data-preview-title]').textContent=preview?.title || 'Untitled website';
    $('[data-preview-host]').textContent=preview?.host || new URL(resolved).hostname;
    $('[data-preview-description]').textContent=preview?.description || 'No description available.';
    const favicon=safeImageUrl(preview?.favicon);
    const faviconNode=$('[data-preview-favicon]');
    faviconNode.src=favicon || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(resolved).hostname)}&sz=64`;
    $('[data-preview-link]').href=resolved;
    refs.previewSection.hidden=false;
  }
  async function loadPreview(target,signal){
    try{
      const preview=await fetchJson(endpoint('/preview',{url:target}),{signal});
      renderPreview(preview,target);
    }catch(error){
      if(error.name!=='AbortError') showNotice(`Checks finished, but the page preview failed: ${error.message}`);
    }
  }
  async function runCheck(event){
    event?.preventDefault();
    let target;
    try{target=normalizeTarget(refs.input.value)}catch(error){showNotice(error.message,'error');refs.input.focus();return;}
    activeController?.abort();
    activeController=new AbortController();
    currentTarget=target;
    refs.screenshotWrap.hidden=true;
    refs.screenshotImage.hidden=true;
    refs.previewSection.hidden=true;
    refs.resultsSection.hidden=true;
    showNotice('');
    setLoading(true);
    try{
      const filter=refs.filter.value || 'all';
      const [report]=await Promise.all([
        fetchJson(endpoint('/check',{url:target,filter}),{signal:activeController.signal}),
        loadPreview(target,activeController.signal)
      ]);
      renderResults(report);
      setApiStatus(true);
      refs.resultsSection.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
    }catch(error){
      if(error.name!=='AbortError'){
        showNotice(`Check failed: ${error.message}`,'error');
        setApiStatus(false,'Request failed');
      }
    }finally{
      setLoading(false);
    }
  }
  function showScreenshot(){
    if(!currentTarget) return;
    const currentlyOpen=!refs.screenshotWrap.hidden;
    if(currentlyOpen){
      refs.screenshotWrap.hidden=true;
      refs.screenshotButton.textContent='View screenshot';
      return;
    }
    refs.screenshotWrap.hidden=false;
    refs.screenshotLoading.hidden=false;
    refs.screenshotImage.hidden=true;
    refs.screenshotButton.textContent='Hide screenshot';
    refs.screenshotImage.onload=()=>{
      refs.screenshotLoading.hidden=true;
      refs.screenshotImage.hidden=false;
    };
    refs.screenshotImage.onerror=()=>{
      refs.screenshotLoading.textContent='Screenshot unavailable for this website.';
    };
    refs.screenshotImage.src=endpoint('/screenshot',{url:currentTarget});
  }
  async function copyReport(){
    if(!lastReport) return;
    const lines=[`Link Checker report for ${lastReport.target || currentTarget}`];
    lastReport.results.forEach(result=>{
      const state=resultState(result);
      lines.push(`${filterDisplayLabel(result)}: ${state.label}${result.category ? ` — ${result.category}` : ''}`);
    });
    try{
      await navigator.clipboard.writeText(lines.join('\n'));
      showNotice('Report copied to the clipboard.');
    }catch{showNotice('Clipboard access was unavailable.','error');}
  }
  applyTheme();
  refs.form.addEventListener('submit',runCheck);
  refs.screenshotButton.addEventListener('click',showScreenshot);
  $('[data-copy-results]').addEventListener('click',copyReport);
  loadFilters();
})();
