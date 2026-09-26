(() => {
  let activeSession = 0;
  let backgroundedSession = 0;
  let lockedPageElements = [];

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && activeSession) backgroundedSession = activeSession;
  });

  const blockedInputEvents = ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'touchmove', 'keydown', 'keyup'];
  blockedInputEvents.forEach(type => {
    window.addEventListener(type, event => {
      if (!document.body?.classList.contains('nyx-loading-active')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, passive: false });
  });

  function unlockPage(splash) {
    lockedPageElements.forEach(({ element, hadInert }) => {
      if (!element?.isConnected || hadInert) return;
      element.removeAttribute('inert');
    });
    lockedPageElements = [];
    document.body?.classList.remove('nyx-loading-active');
    splash?.blur?.();
  }

  function lockPage(splash) {
    unlockPage(splash);
    lockedPageElements = Array.from(document.body?.children || [])
      .filter(element => (
        element !== splash
        && element.id !== 'nyxStudyHubStartup'
        && !['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName)
      ))
      .map(element => {
        const hadInert = element.hasAttribute('inert');
        if (!hadInert) element.setAttribute('inert', '');
        return { element, hadInert };
      });
    document.body?.classList.add('nyx-loading-active');
    splash.setAttribute('role', 'dialog');
    splash.setAttribute('aria-modal', 'true');
    splash.tabIndex = -1;
    splash.focus({ preventScroll: true });
  }

  function waitForVisualDelay(milliseconds, session) {
    if (session !== activeSession || document.hidden || backgroundedSession === session) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      let timer = 0;
      const finish = () => {
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', handleVisibility);
        resolve();
      };
      const handleVisibility = () => {
        if (document.hidden || session !== activeSession) finish();
      };
      document.addEventListener('visibilitychange', handleVisibility);
      timer = setTimeout(finish, Math.max(0, Number(milliseconds) || 0));
    });
  }

  function updateProgress(splash, value, label, emit = true, updateFill = true) {
    const progress = splash.querySelector('.nyx-loading-progress');
    const fill = progress?.querySelector('span');
    const percent = splash.querySelector('[data-nyx-loading-percent]');
    const stage = splash.querySelector('[data-nyx-loading-stage]');
    const visualValue = Math.max(0, Math.min(100, Number(value) || 0));
    const next = Math.round(visualValue);
    if (fill && updateFill) fill.style.transform = `scaleX(${visualValue / 100})`;
    if (percent) percent.textContent = `${next}%`;
    if (stage && label) stage.textContent = label;
    progress?.setAttribute('aria-valuenow', String(next));
    if (label) progress?.setAttribute('aria-valuetext', label);
    if (emit) window.dispatchEvent(new CustomEvent('nyx:loading-progress', { detail: { value: next, label: label || '' } }));
  }

  function progressValue(splash) {
    return Number(splash.querySelector('.nyx-loading-progress')?.getAttribute('aria-valuenow')) || 0;
  }

  function animateProgress(splash, target, label, duration, session) {
    const start = progressValue(splash);
    const end = Math.max(start, Math.min(100, Number(target) || 0));
    const fill = splash.querySelector('.nyx-loading-progress span');
    if (end === start) {
      updateProgress(splash, end, label);
      return Promise.resolve();
    }
    if (document.hidden || backgroundedSession === session) {
      updateProgress(splash, end, label);
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const started = Date.now();
      const animation = fill?.animate([
        { transform: `scaleX(${start / 100})` },
        { transform: `scaleX(${end / 100})` }
      ], {
        duration: Math.max(1, duration),
        easing: 'linear',
        fill: 'forwards'
      });
      let tickTimer = 0;
      let finished = false;
      const finish = (commit = true) => {
        if (finished) return;
        finished = true;
        clearTimeout(tickTimer);
        document.removeEventListener('visibilitychange', handleVisibility);
        animation?.cancel();
        if (commit) {
          if (fill) fill.style.transform = `scaleX(${end / 100})`;
          updateProgress(splash, end, label, true);
        }
        resolve();
      };
      const handleVisibility = () => {
        if (session !== activeSession) {
          finish(false);
        } else if (document.hidden || backgroundedSession === session) {
          finish();
        } else {
          tick();
        }
      };
      const tick = () => {
        if (session !== activeSession) {
          finish(false);
          return;
        }
        if (document.hidden || backgroundedSession === session) {
          finish();
          return;
        }
        const elapsed = Math.min(1, (Date.now() - started) / Math.max(1, duration));
        const value = start + ((end - start) * elapsed);
        updateProgress(splash, value, label, false, false);
        if (elapsed < 1) {
          tickTimer = setTimeout(tick, 32);
        } else {
          finish();
        }
      };
      document.addEventListener('visibilitychange', handleVisibility);
      tickTimer = setTimeout(tick, 0);
    });
  }

  window.nyxLoadingScreen = {
    show() {
      const splash = document.getElementById('setupLaunchScreen');
      const fill = splash?.querySelector('.nyx-loading-progress span');
      if (!splash || !fill) return null;

      const session = ++activeSession;
      if (document.hidden) backgroundedSession = session;
      splash.classList.remove('show', 'leaving');
      fill.getAnimations().forEach(animation => animation.cancel());
      updateProgress(splash, 0, 'Preparing Nyx');
      void splash.offsetWidth;
      splash.classList.add('show');
      splash.setAttribute('aria-hidden', 'false');
      lockPage(splash);

      return {
        async step(value, label, task, minimumVisible = 360) {
          if (session !== activeSession) return { ok: false, cancelled: true };
          updateProgress(splash, progressValue(splash), label);
          const started = performance.now();
          let result;
          let error = null;
          try {
            result = await Promise.resolve().then(task);
          } catch (caught) {
            error = caught;
            console.warn(`Startup task failed: ${label}`, caught);
          }
          const remaining = Math.max(480, Number(minimumVisible) - (performance.now() - started));
          await animateProgress(splash, value, error ? `${label} (warning)` : label, remaining, session);
          if (session !== activeSession) return { ok: false, cancelled: true };
          return { ok: !error, result, error };
        },

        async complete(label = 'Nyx is ready') {
          if (session !== activeSession) return;
          await animateProgress(splash, 100, label, 300, session);
          await waitForVisualDelay(620, session);
          if (session !== activeSession) return;
          splash.classList.add('leaving');
          await waitForVisualDelay(780, session);
          if (session !== activeSession) return;
          splash.classList.remove('show', 'leaving');
          splash.setAttribute('aria-hidden', 'true');
          updateProgress(splash, 0, 'Preparing Nyx');
          unlockPage(splash);
        }
      };
    }
  };
})();
