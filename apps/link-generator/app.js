(()=>{
  'use strict';
  const LINK_CHECKER_API='https://getuwu.christmas/api/v1';
  const SESSION_KEY='nyx.linkGenerator.firebaseSession';
  const $=selector=>document.querySelector(selector);
  const refs={
    form:$('[data-generator-form]'),label:$('[data-label-input]'),filter:$('[data-filter-select]'),accessCode:$('[data-access-code]'),
    button:$('[data-generate-button]'),status:$('[data-service-status]'),origin:$('[data-origin]'),notice:$('[data-notice]'),
    resultCard:$('[data-result-card]'),resultUrl:$('[data-result-url]'),resultCount:$('[data-result-count]'),resultTitle:$('[data-result-title]'),resultSubtitle:$('[data-result-subtitle]'),copy:$('[data-copy]'),open:$('[data-open]'),
    filterCheck:$('[data-filter-check]'),filterCheckLabel:$('[data-filter-check-label]'),filterCheckState:$('[data-filter-check-state]'),filterCheckDetail:$('[data-filter-check-detail]'),
    modeButtons:[...document.querySelectorAll('[data-access-mode]')],accountPanel:$('[data-account-access]'),administratorPanel:$('[data-administrator-access]'),
    accountFields:$('[data-account-fields]'),email:$('[data-account-email]'),password:$('[data-account-password]'),accountStatus:$('[data-account-status]'),
    signIn:$('[data-account-sign-in]'),createAccount:$('[data-account-create]'),refreshAccount:$('[data-account-refresh]'),signOut:$('[data-account-sign-out]'),
    wizardCard:$('[data-wizard-card]'),wizardSteps:[...document.querySelectorAll('[data-wizard-step]')],wizardIndicators:[...document.querySelectorAll('[data-wizard-indicator]')],
    wizardProgress:$('[data-wizard-progress]'),wizardNext:[...document.querySelectorAll('[data-wizard-next]')],wizardBack:[...document.querySelectorAll('[data-wizard-back]')],wizardRestart:$('[data-wizard-restart]'),
    reviewAccess:$('[data-review-access]'),reviewLabel:$('[data-review-label]'),reviewFilter:$('[data-review-filter]'),reviewOrigin:$('[data-review-origin]'),reviewAmountRow:$('[data-review-amount-row]'),reviewAmount:$('[data-review-amount]'),confirm:$('[data-confirm]'),confirmText:$('[data-confirm-text]'),
    amount:$('[data-premium-amount]'),amountField:$('[data-premium-amount-field]'),amountHint:$('[data-premium-amount-hint]'),detailsGrid:$('[data-details-grid]')
  };
  let accessMode='account';
  let wizardStep=0;
  let premiumBatchLimit=10;
  let freeDailyLimit=3;
  let premiumImmediateCooldownAt=5;
  let premiumAccumulatedLimit=30;
  let premiumCooldownMinutes=10;
  let authConfig={enabled:false,apiKey:''};
  let authSession=readStoredSession();

  function applyTheme(){
    let theme='default';
    try{theme=localStorage.getItem('nyx.theme') || 'default'}catch{}
    if(theme && theme!=='default') document.body.classList.add(`theme-${theme}`);
  }
  function showNotice(message,type=''){
    refs.notice.textContent=message;
    refs.notice.className=`notice${type ? ` ${type}` : ''}`;
    refs.notice.hidden=!message;
  }
  function setStatus(online,label){
    refs.status.classList.toggle('online',online);
    refs.status.classList.toggle('offline',!online);
    refs.status.querySelector('span').textContent=label;
  }
  function setLoading(loading,label=''){
    refs.button.disabled=loading;
    const amount=selectedAmount();
    refs.button.querySelector('span').textContent=loading ? (label || `Creating ${amount} link${amount===1?'':'s'}...`) : `Generate ${amount===1?'link':`${amount} links`}`;
  }
  function setAuthBusy(busy){
    [refs.signIn,refs.createAccount,refs.refreshAccount,refs.signOut].forEach(button=>{button.disabled=busy});
  }
  async function readJson(response){
    let body={};
    try{body=await response.json()}catch{}
    if(!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status})`);
    return body;
  }
  function readStoredSession(){
    try{return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')}catch{return null}
  }
  function storeSession(session){
    authSession=session;
    try{sessionStorage.setItem(SESSION_KEY,JSON.stringify(session))}catch{}
    renderAccount();
    return session;
  }
  function clearSession(){
    authSession=null;
    try{sessionStorage.removeItem(SESSION_KEY)}catch{}
    renderAccount();
  }
  function friendlyFirebaseError(error){
    const message=String(error?.message || error || 'Authentication failed.').replace(/^Firebase:\s*/i,'');
    const labels={EMAIL_EXISTS:'That email already has an account.',EMAIL_NOT_FOUND:'Email or password is incorrect.',INVALID_PASSWORD:'Email or password is incorrect.',INVALID_LOGIN_CREDENTIALS:'Email or password is incorrect.',WEAK_PASSWORD:'Choose a stronger password.',TOO_MANY_ATTEMPTS_TRY_LATER:'Too many attempts. Try again later.',USER_DISABLED:'This account has been disabled.'};
    return labels[message] || message.replaceAll('_',' ').toLowerCase().replace(/^./,char=>char.toUpperCase());
  }
  async function firebaseRequest(service,path,body,form=false){
    if(!authConfig.enabled || !authConfig.apiKey) throw new Error('Free account access is not configured yet.');
    const base=service==='token' ? 'https://securetoken.googleapis.com/v1' : 'https://identitytoolkit.googleapis.com/v1';
    const response=await fetch(`${base}/${path}?key=${encodeURIComponent(authConfig.apiKey)}`,{
      method:'POST',headers:{'Content-Type':form ? 'application/x-www-form-urlencoded' : 'application/json'},body:form ? new URLSearchParams(body) : JSON.stringify(body)
    });
    let payload={};
    try{payload=await response.json()}catch{}
    if(!response.ok) throw new Error(payload?.error?.message || `Authentication failed (${response.status})`);
    return payload;
  }
  function sessionFromResponse(result,existing={}){
    return {
      idToken:result.idToken || result.id_token,
      refreshToken:result.refreshToken || result.refresh_token || existing.refreshToken,
      expiresAt:Date.now() + (Number(result.expiresIn || result.expires_in || 3600)*1000),
      email:result.email || existing.email || '',
      emailVerified:Boolean(existing.emailVerified),
      subscriptionStatus:existing.subscriptionStatus || 'free',
      premiumAccess:Boolean(existing.premiumAccess)
    };
  }
  async function lookupAccount(idToken){
    const result=await firebaseRequest('identity','accounts:lookup',{idToken});
    const user=result.users?.[0];
    return {email:user?.email || '',emailVerified:Boolean(user?.emailVerified)};
  }
  async function lookupNyxAccess(idToken){
    const account=await readJson(await fetch('/api/account/me',{headers:{Accept:'application/json',Authorization:`Bearer ${idToken}`},cache:'no-store'}));
    return {
      subscriptionStatus:String(account.subscriptionStatus || 'free').toLowerCase(),
      premiumAccess:Boolean(account.premiumAccess || ['premium','trialing'].includes(String(account.subscriptionStatus || '').toLowerCase()))
    };
  }
  function accountHasPremium(){return Boolean(authSession?.premiumAccess || ['premium','trialing'].includes(String(authSession?.subscriptionStatus || '').toLowerCase()))}
  function premiumAccessActive(){return accessMode==='administrator' || (accessMode==='account' && accountHasPremium())}
  async function refreshNyxAccess(){
    if(!authSession?.idToken)return authSession;
    const access=await lookupNyxAccess(authSession.idToken);
    return storeSession({...authSession,...access});
  }
  async function refreshSession(){
    if(!authSession?.refreshToken) throw new Error('Sign in again.');
    const result=await firebaseRequest('token','token',{grant_type:'refresh_token',refresh_token:authSession.refreshToken},true);
    return storeSession(sessionFromResponse(result,authSession));
  }
  async function refreshVerification(){
    await refreshSession();
    const [profile,access]=await Promise.all([lookupAccount(authSession.idToken),lookupNyxAccess(authSession.idToken)]);
    authSession={...authSession,...profile,...access};
    if(profile.emailVerified){
      await refreshSession();
      authSession.emailVerified=true;
    }
    storeSession(authSession);
    return authSession;
  }
  async function currentVerifiedSession(){
    if(!authSession) throw new Error(`Sign in to use your ${freeDailyLimit} free links.`);
    if(authSession.expiresAt-Date.now()<60_000) await refreshSession();
    await refreshNyxAccess();
    if(accountHasPremium()) return authSession;
    if(!authSession.emailVerified) await refreshVerification();
    if(!authSession.emailVerified) throw new Error('Verify your email address, then select “I verified my email.”');
    return authSession;
  }
  function renderAccount(){
    const signedIn=Boolean(authSession?.idToken);
    const premium=signedIn&&accountHasPremium();
    refs.accountFields.hidden=signedIn;
    refs.signIn.hidden=signedIn;
    refs.createAccount.hidden=signedIn;
    refs.signOut.hidden=!signedIn;
    refs.refreshAccount.hidden=!signedIn || premium || Boolean(authSession?.emailVerified);
    refs.accountStatus.className=`account-status${signedIn ? (premium || authSession.emailVerified ? ' good' : '') : ''}`;
    refs.accountStatus.textContent=signedIn
      ? (premium ? `${authSession.email || 'Account'} has Premium access. No access code is required.` : (authSession.emailVerified ? `${authSession.email || 'Account'} is verified. You can create up to ${freeDailyLimit} links today.` : `Verification sent to ${authSession.email || 'your email'}. Verify it before generating links.`))
      : `Sign in with a verified email to receive ${freeDailyLimit} free links per day.`;
    const accountButton=refs.modeButtons.find(button=>button.dataset.accessMode==='account');
    if(accountButton)accountButton.textContent=premium?'Premium account':'Account';
    if(accessMode==='account')setPremiumLayout();
  }
  function setPremiumLayout(){
    const premium=premiumAccessActive();
    refs.amountField.hidden=!premium;
    refs.detailsGrid.classList.toggle('premium',premium);
    if(!premium)refs.amount.value='1';
    updateAmountCopy();
  }
  function setAccessMode(mode){
    accessMode=mode;
    refs.accountPanel.hidden=mode!=='account';
    refs.administratorPanel.hidden=mode!=='administrator';
    setPremiumLayout();
    refs.modeButtons.forEach(button=>{
      const active=button.dataset.accessMode===mode;
      button.classList.toggle('active',active);
      button.setAttribute('aria-selected',String(active));
    });
  }
  function selectedAmount(){
    if(!premiumAccessActive()) return 1;
    const value=Number.parseInt(refs.amount.value,10);
    return Number.isInteger(value) ? Math.max(1,Math.min(premiumBatchLimit,value)) : 1;
  }
  function updateAmountCopy(){
    const amount=selectedAmount();
    refs.reviewAmountRow.hidden=!premiumAccessActive();
    refs.reviewAmount.textContent=`${amount} link${amount===1?'':'s'}`;
    refs.confirmText.textContent=`I understand this creates ${amount===1?'one resource':`${amount} resources`} on the Nyx Bunny account.`;
    if(!refs.button.disabled) refs.button.querySelector('span').textContent=`Generate ${amount===1?'link':`${amount} links`}`;
  }
  function setWizardStep(nextStep,direction=nextStep>=wizardStep?'forward':'back'){
    const index=Math.max(0,Math.min(refs.wizardSteps.length-1,Number(nextStep) || 0));
    wizardStep=index;
    refs.wizardCard.classList.remove('wizard-forward','wizard-back');
    void refs.wizardCard.offsetWidth;
    refs.wizardCard.classList.add(direction==='back' ? 'wizard-back' : 'wizard-forward');
    refs.wizardSteps.forEach((step,stepIndex)=>{
      const active=stepIndex===index;
      step.hidden=!active;
      step.classList.toggle('active',active);
    });
    refs.form.hidden=index===3;
    refs.wizardIndicators.forEach((indicator,stepIndex)=>{
      indicator.classList.toggle('active',stepIndex===index);
      indicator.classList.toggle('complete',stepIndex<index);
      if(stepIndex===index) indicator.setAttribute('aria-current','step');
      else indicator.removeAttribute('aria-current');
    });
    refs.wizardProgress.style.width=`${(index/(refs.wizardSteps.length-1))*100}%`;
  }
  function updateReview(){
    refs.reviewAccess.textContent=accessMode==='account' ? (accountHasPremium() ? `${authSession?.email || 'Account'} · Premium` : (authSession?.email || 'Free account')) : 'Premium access code';
    refs.reviewLabel.textContent=refs.label.value.trim() || 'Automatic';
    refs.reviewFilter.textContent=refs.filter.options[refs.filter.selectedIndex]?.textContent || 'Not selected';
    refs.reviewOrigin.textContent=refs.origin.textContent || 'Official Nyx origin';
    updateAmountCopy();
  }
  async function validateAccessStep(){
    showNotice('');
    if(accessMode==='administrator'){
      if(!refs.accessCode.value){showNotice('Enter your Premium access code to continue.','error');refs.accessCode.focus();return false}
      try{
        showNotice('Checking your Premium access code...');
        const result=await readJson(await fetch('/api/link-generator/validate-access',{
          method:'POST',
          headers:{Accept:'application/json','Content-Type':'application/json'},
          body:JSON.stringify({accessCode:refs.accessCode.value})
        }));
        if(result.valid!==true) throw new Error('The Premium access code could not be verified.');
        return true;
      }catch(error){
        showNotice(error.message || 'The Premium access code is incorrect.','error');
        refs.accessCode.focus();
        refs.accessCode.select();
        return false;
      }
    }
    if(!authConfig.enabled){showNotice('Free account access is not configured yet. Choose Premium users to continue.','error');return false}
    if(!authSession?.idToken){showNotice('Sign in or create a verified free account before continuing.','error');refs.email.focus();return false}
    try{await currentVerifiedSession();renderAccount();return true}
    catch(error){showNotice(friendlyFirebaseError(error),'error');return false}
  }
  async function handleWizardNext(event){
    const nextButton=event?.currentTarget;
    if(nextButton) nextButton.disabled=true;
    try{
    if(wizardStep===0){
      if(!await validateAccessStep()) return;
      showNotice('');setWizardStep(1);return;
    }
    if(wizardStep===1){
      if(!refs.filter.value){showNotice('Choose a content filter before continuing.','error');refs.filter.focus();return}
      if(premiumAccessActive()){
        const rawAmount=Number.parseInt(refs.amount.value,10);
        if(!Number.isInteger(rawAmount) || rawAmount<1 || rawAmount>premiumBatchLimit){showNotice(`Choose an amount from 1 to ${premiumBatchLimit}.`,'error');refs.amount.focus();return}
      }
      showNotice('');updateReview();setWizardStep(2);
    }
    }finally{
      if(nextButton) nextButton.disabled=false;
    }
  }
  async function loadAuthConfig(){
    try{
      authConfig=await readJson(await fetch('/api/link-generator/auth-config',{headers:{Accept:'application/json'},cache:'no-store'}));
    }catch{authConfig={enabled:false,apiKey:''}}
    const accountButton=refs.modeButtons.find(button=>button.dataset.accessMode==='account');
    accountButton.disabled=!authConfig.enabled;
    if(!authConfig.enabled) setAccessMode('administrator');
    if(authSession?.idToken){
      try{
        if(authSession.expiresAt-Date.now()<60_000)await refreshSession();
        await refreshNyxAccess();
      }catch{clearSession()}
    }
    renderAccount();
  }
  async function handleSignIn(){
    const email=refs.email.value.trim(),password=refs.password.value;
    if(!email || !password){refs.accountStatus.textContent='Enter your email and password.';refs.accountStatus.className='account-status error';return}
    setAuthBusy(true);
    try{
      const result=await firebaseRequest('identity','accounts:signInWithPassword',{email,password,returnSecureToken:true});
      storeSession(sessionFromResponse(result));
      const [profile,access]=await Promise.all([lookupAccount(authSession.idToken),lookupNyxAccess(authSession.idToken)]);
      storeSession({...authSession,...profile,...access});
      refs.password.value='';
    }catch(error){refs.accountStatus.textContent=friendlyFirebaseError(error);refs.accountStatus.className='account-status error'}
    finally{setAuthBusy(false)}
  }
  async function handleCreateAccount(){
    const email=refs.email.value.trim(),password=refs.password.value;
    if(!email || password.length<6){refs.accountStatus.textContent='Enter an email and a password with at least 6 characters.';refs.accountStatus.className='account-status error';return}
    setAuthBusy(true);
    try{
      const result=await firebaseRequest('identity','accounts:signUp',{email,password,returnSecureToken:true});
      storeSession(sessionFromResponse(result,{email,emailVerified:false}));
      await firebaseRequest('identity','accounts:sendOobCode',{requestType:'VERIFY_EMAIL',idToken:authSession.idToken});
      await refreshNyxAccess();
      refs.password.value='';
      renderAccount();
    }catch(error){refs.accountStatus.textContent=friendlyFirebaseError(error);refs.accountStatus.className='account-status error'}
    finally{setAuthBusy(false)}
  }

  function filterLabel(item){
    const key=String(item?.key || item?.filter || '').toLowerCase();
    const label=String(item?.label || item?.filter || item?.key || 'Content filter');
    return key==='cisco' || /^cisco talos$/i.test(label) ? 'Cisco Umbrella' : label;
  }
  async function loadFilters(){
    try{
      const response=await readJson(await fetch(`${LINK_CHECKER_API}/filters`,{headers:{Accept:'application/json'},cache:'no-store'}));
      const filters=Array.isArray(response) ? response : response.filters;
      if(!Array.isArray(filters) || !filters.length) throw new Error('No filters are currently available.');
      refs.filter.textContent='';
      const prompt=document.createElement('option');prompt.value='';prompt.textContent='Choose a content filter';refs.filter.append(prompt);
      filters.forEach(item=>{if(!item?.key)return;const option=document.createElement('option');option.value=String(item.key);option.textContent=filterLabel(item);refs.filter.append(option)});
      refs.filter.disabled=false;
    }catch(error){refs.filter.innerHTML='<option value="">Filter list unavailable</option>';refs.filter.disabled=true;showNotice(`Could not load the content filters: ${error.message}`,'error')}
  }
  function showFilterResult(kind,label,state,detail){refs.filterCheck.className=`filter-check ${kind}`;refs.filterCheckLabel.textContent=label;refs.filterCheckState.textContent=state;refs.filterCheckDetail.textContent=detail}
  function setOpenReady(ready,message=''){
    refs.open.dataset.ready=String(Boolean(ready));
    refs.open.classList.toggle('disabled',!ready);
    refs.open.setAttribute('aria-disabled',String(!ready));
    refs.open.textContent=ready ? 'Open first' : 'Starting CDN...';
    refs.open.dataset.readinessMessage=message || '';
  }
  async function checkCdnReadiness(url){
    return readJson(await fetch('/api/link-generator/readiness',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({url})}));
  }
  async function waitForCdnReadiness(url,attempts=12){
    setOpenReady(false,'Bunny is still provisioning this link.');
    let lastMessage='Bunny is still provisioning this link.';
    for(let attempt=0;attempt<attempts;attempt+=1){
      try{
        const result=await checkCdnReadiness(url);
        lastMessage=result.message || lastMessage;
        if(result.ready){setOpenReady(true,'');return true}
        if(result.state==='disabled' || result.state==='suspended'){setOpenReady(false,lastMessage);return false}
      }catch(error){lastMessage=error.message || lastMessage}
      if(attempt<attempts-1) await new Promise(resolve=>setTimeout(resolve,2500));
    }
    setOpenReady(false,lastMessage);
    return false;
  }
  async function checkOneGeneratedLink(url,filterKey){
    try{
      const endpoint=new URL(`${LINK_CHECKER_API}/check`);endpoint.searchParams.set('url',url);endpoint.searchParams.set('filter',filterKey);
      const report=await readJson(await fetch(endpoint,{headers:{Accept:'application/json'},cache:'no-store'}));
      const result=Array.isArray(report?.results) ? report.results[0] : report?.result || report;
      if(result?.error || result?.ok===false) return 'error';
      if(result?.blocked===true) return 'blocked';
      if(result?.blocked===false) return 'allowed';
      return 'info';
    }catch{return 'error'}
  }
  async function checkGeneratedLinks(urls,filterKey,filterName){
    const counts={allowed:0,blocked:0,info:0,error:0};
    showFilterResult('checking',filterName,`Checking 0 of ${urls.length}`,`Nyx is checking ${urls.length===1?'this link':'each generated link'} once.`);
    let nextIndex=0,completed=0;
    const worker=async()=>{
      while(nextIndex<urls.length){
        const index=nextIndex;nextIndex+=1;
        const result=await checkOneGeneratedLink(urls[index],filterKey);
        counts[result]+=1;completed+=1;
        showFilterResult('checking',filterName,`Checking ${completed} of ${urls.length}`,'Completed checks appear here when the batch finishes.');
      }
    };
    await Promise.all(Array.from({length:Math.min(5,urls.length)},worker));
    if(counts.blocked){showFilterResult('blocked',filterName,`${counts.blocked} blocked`,`Sorry, but ${counts.blocked===urls.length?'all of those links are':`${counts.blocked} of ${urls.length} links are`} currently blocked.`);return}
    if(counts.error){showFilterResult('error',filterName,`${counts.error} unchecked`,`${counts.allowed} allowed; ${counts.error} could not be checked.`);return}
    if(counts.info){showFilterResult('info',filterName,`${counts.info} informational`,`${counts.allowed} allowed; ${counts.info} did not return a blocked or allowed decision.`);return}
    showFilterResult('allowed',filterName,`${counts.allowed} allowed`,urls.length===1?'The selected filter currently reports this link as allowed.':'The selected filter currently reports every generated link as allowed.');
  }
  async function loadStatus(){
    try{
      const status=await readJson(await fetch('/api/link-generator/status',{headers:{Accept:'application/json'},cache:'no-store'}));
      premiumBatchLimit=Math.max(1,Math.min(10,Number.parseInt(status.premiumBatchLimit,10) || 10));freeDailyLimit=Math.max(1,Number.parseInt(status.freeDailyLimit,10) || 3);premiumImmediateCooldownAt=Math.max(1,Number.parseInt(status.premiumImmediateCooldownAt,10) || 5);premiumAccumulatedLimit=Math.max(premiumImmediateCooldownAt,Number.parseInt(status.premiumAccumulatedLimit,10) || 30);premiumCooldownMinutes=Math.max(1,Number.parseInt(status.premiumCooldownMinutes,10) || 10);refs.amount.max=String(premiumBatchLimit);refs.amountHint.textContent=`Choosing ${premiumImmediateCooldownAt}–${premiumBatchLimit} links starts a ${premiumCooldownMinutes}-minute cooldown. Smaller batches start it after ${premiumAccumulatedLimit} total links.`;renderAccount();
      refs.origin.textContent=status.origin || 'Not configured';setStatus(status.available,status.available ? 'Ready' : 'Setup required');
      if(!status.available) showNotice('The Nyx administrator still needs to finish the Link Generator environment settings in Netlify.','error');
    }catch(error){refs.origin.textContent='Unavailable';setStatus(false,'Unavailable');showNotice(`Could not check the generator: ${error.message}`,'error')}
  }

  refs.modeButtons.forEach(button=>button.addEventListener('click',()=>setAccessMode(button.dataset.accessMode)));
  refs.amount.addEventListener('input',updateAmountCopy);
  refs.wizardNext.forEach(button=>button.addEventListener('click',handleWizardNext));
  refs.wizardBack.forEach(button=>button.addEventListener('click',()=>{showNotice('');setWizardStep(wizardStep-1,'back')}));
  refs.wizardRestart.addEventListener('click',()=>{
    refs.label.value='';refs.filter.value='';refs.confirm.checked=false;refs.resultCard.hidden=true;showNotice('');setWizardStep(1,'back');
  });
  refs.signIn.addEventListener('click',handleSignIn);
  refs.createAccount.addEventListener('click',handleCreateAccount);
  refs.refreshAccount.addEventListener('click',async()=>{setAuthBusy(true);try{await refreshVerification();if(!authSession.emailVerified)throw new Error('Email is not verified yet.')}catch(error){refs.accountStatus.textContent=friendlyFirebaseError(error);refs.accountStatus.className='account-status error'}finally{setAuthBusy(false)}});
  refs.signOut.addEventListener('click',clearSession);
  refs.form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!refs.filter.value){showNotice('Choose a content filter before generating the link.','error');refs.filter.focus();return}
    const selectedFilter=refs.filter.value;
    const selectedFilterName=refs.filter.options[refs.filter.selectedIndex]?.textContent || selectedFilter;
    showNotice('');refs.resultCard.hidden=true;setLoading(true);
    try{
      const headers={Accept:'application/json','Content-Type':'application/json'};
      const body={label:refs.label.value};
      if(accessMode==='account'){
        const session=await currentVerifiedSession();
        headers.Authorization=`Bearer ${session.idToken}`;
        if(accountHasPremium())body.amount=selectedAmount();
      }else{
        if(!refs.accessCode.value) throw new Error('Enter your Premium access code.');
        body.accessCode=refs.accessCode.value;
        body.amount=selectedAmount();
      }
      const result=await readJson(await fetch('/api/link-generator',{method:'POST',headers,body:JSON.stringify(body)}));
      const links=(Array.isArray(result.links)?result.links:[]).map(item=>typeof item==='string'?item:item?.url).filter(Boolean);
      if(!links.length && result.url) links.push(result.url);
      if(!links.length) throw new Error('Bunny did not return any generated links.');
      refs.resultUrl.value=links.join('\n');refs.resultCount.textContent=`${links.length} link${links.length===1?'':'s'}`;refs.resultTitle.textContent=links.length===1?'Your Nyx link is ready':'Your Nyx links are ready';refs.resultSubtitle.textContent=result.partial?`${links.length} of ${result.requested} requested links were created.`:`${links.length===1?'The link was':'All links were'} created successfully.`;refs.open.href=links[0];setOpenReady(false);refs.resultCard.hidden=false;refs.accessCode.value='';setWizardStep(3);requestAnimationFrame(()=>refs.resultCard.scrollIntoView({behavior:'smooth',block:'nearest'}));
      const [,cdnReady]=await Promise.all([checkGeneratedLinks(links,selectedFilter,selectedFilterName),waitForCdnReadiness(links[0])]);
      const cooldown=result.premiumCooldown;
      const premiumResult=result.access==='administrator'||result.access==='premium';
      const premiumMessage=cooldown?.triggered
        ? `${links.length} link${links.length===1?' was':'s were'} created. A ${cooldown.minutes || premiumCooldownMinutes}-minute Premium cooldown is now active.`
        : `${links.length} link${links.length===1?' was':'s were'} created with Premium access. ${cooldown?.accumulated || 0} of ${cooldown?.accumulatedLimit || premiumAccumulatedLimit} links accumulated before cooldown.`;
      if(result.partial) showNotice(result.warning || `${links.length} of ${result.requested} links were created.`,'error');
      else if(!cdnReady) showNotice(`${premiumResult ? `${premiumMessage} ` : ''}${refs.open.dataset.readinessMessage || 'The link was created, but Bunny is still provisioning it. Try Open first again shortly.'}`,'error');
      else showNotice(premiumResult ? premiumMessage : `The link was created. ${result.remaining} free link${result.remaining===1?'':'s'} remaining today.`);
    }catch(error){showNotice(error.message,'error')}
    finally{setLoading(false)}
  });
  refs.open.addEventListener('click',async event=>{
    if(refs.open.dataset.ready==='true') return;
    event.preventDefault();
    const url=refs.open.href;
    showNotice(refs.open.dataset.readinessMessage || 'Bunny is still provisioning this link. Checking again...','error');
    const ready=await waitForCdnReadiness(url,1);
    showNotice(ready ? 'The CDN link is ready. Select Open first again.' : (refs.open.dataset.readinessMessage || 'The CDN link is not ready yet.'),ready ? '' : 'error');
  });
  refs.copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(refs.resultUrl.value);refs.copy.textContent='Copied all';setTimeout(()=>{refs.copy.textContent='Copy all'},1400)}catch{refs.resultUrl.select();document.execCommand('copy')}});

  applyTheme();renderAccount();setWizardStep(0);Promise.all([loadStatus(),loadAuthConfig(),loadFilters()]);
})();
