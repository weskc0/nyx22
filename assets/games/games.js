const elements = {
  grid: document.getElementById('gameGrid'),
  search: document.getElementById('gameSearch'),
  library: document.getElementById('gameLibrary'),
  sort: document.getElementById('gameSort'),
  count: document.getElementById('gameCount'),
  progress: document.getElementById('catalogProgress'),
  empty: document.getElementById('emptyState'),
  player: document.getElementById('gamePlayer'),
  playerTitle: document.getElementById('playerTitle'),
  playerLoading: document.getElementById('playerLoading'),
  playerLoadingText: document.getElementById('playerLoadingText'),
  playerRetry: document.getElementById('retryGame'),
  frame: document.getElementById('gameFrame'),
  close: document.getElementById('closePlayer'),
  reload: document.getElementById('reloadGame'),
  fullscreen: document.getElementById('fullscreenGame')
};

const state = {
  games: [],
  gamesByKey: new Map(),
  manifest: null,
  lastFocused: null,
  activeGame: null,
  activeSourceIndex: 0,
  sourceAttempt: 0,
  sourceTimer: 0,
  failedSources: new Set()
};

const ugsPlayerOverrides = new Map([
  ['F/clfnafps.html', 'https://classroomlesson.github.io/basic-ruffle-player/html/fnaf_pizzeria_simulator/index.html'],
  ['F/clfnafsl.html', 'https://classroomlesson.github.io/basic-ruffle-player/html/fnaf5/index.html'],
  ['minecraft/Dragonxclient.html', 'https://classroomlesson.github.io/basic-ruffle-player/html/minecraft/index.html'],
  ['minecraft/EaglercraftL_1.9_v0_7_0_Offline_Signed.html', 'https://classroomlesson.github.io/basic-ruffle-player/html/minecraft/index.html'],
  ['minecraft/EaglercraftX 1.8.8(u29).html', 'https://classroomlesson.github.io/basic-ruffle-player/html/minecraft/index.html'],
  ['minecraft/EaglercraftZ_1.11.2.html', 'https://classroomlesson.github.io/basic-ruffle-player/html/minecraft/index.html'],
  ['minecraft/eaglercraft.1.5.2.html', 'https://classroomlesson.github.io/basic-ruffle-player/html/minecraft/index.html']
]);

function titleCase(value) {
  const title = String(value || 'Game')
    .replace(/\.html?$/i, '')
    .replace(/\bindex$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/gi, '$1 $2')
    .replace(/[\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, character => character.toUpperCase());
  return title || 'Game';
}

const gameTitleCorrections = new Map([
  ['1v1lol', '1v1.LOL'],
  ['attackhole', 'Attack Hole'],
  ['achievmentunlocked', 'Achievement Unlocked'],
  ['achievmentunlocked2', 'Achievement Unlocked 2'],
  ['achievmentunlocked3', 'Achievement Unlocked 3'],
  ['amongus', 'Among Us'],
  ['animalcrossingwildworld', 'Animal Crossing: Wild World'],
  ['aquaparkio', 'Aquapark.io'],
  ['armormayhem2', 'Armor Mayhem 2'],
  ['bloonstd1', 'Bloons TD 1'],
  ['bloonstd3', 'Bloons TD 3'],
  ['bobtherobber', 'Bob the Robber'],
  ['bobtherobber2', 'Bob the Robber 2'],
  ['buckshotroulette', 'Buckshot Roulette'],
  ['burritobisonlaunchalibre', 'Burrito Bison: Launcha Libre'],
  ['colorwatersort3d', 'Color Water Sort 3D'],
  ['crazycattle3d', 'Crazy Cattle 3D'],
  ['dadnme', "Dad 'n Me"],
  ['deadestate', 'Dead Estate'],
  ['deadzed', 'Dead Zed'],
  ['deadzed2', 'Dead Zed 2'],
  ['deepersleep', 'Deeper Sleep'],
  ['deepestsword', 'Deepest Sword'],
  ['deepsleep', 'Deep Sleep'],
  ['defendyournuts', 'Defend Your Nuts'],
  ['defendyournuts2', 'Defend Your Nuts 2'],
  ['eaglercraft188u29', 'Eaglercraft 1.8.8'],
  ['eaglercraftalpha126offline', 'Eaglercraft Alpha 1.2.6'],
  ['eaglercraftbeta13offline', 'Eaglercraft Beta 1.3'],
  ['eaglercraftindevoffline', 'Eaglercraft Indev'],
  ['593275fpaworld3', 'Fancy Pants Adventures: World 3'],
  ['750785fpaworld4p1', 'Fancy Pants Adventures: World 4 Part 1'],
  ['752737fpaworld4p2', 'Fancy Pants Adventures: World 4 Part 2'],
  ['fancypantsadventuresworld3', 'Fancy Pants Adventures: World 3'],
  ['fancypantsadventuresworld4part1', 'Fancy Pants Adventures: World 4 Part 1'],
  ['fancypantsadventuresworld4part2', 'Fancy Pants Adventures: World 4 Part 2'],
  ['fivenightsatfreddysworld', "Five Nights at Freddy's World"],
  ['gunspin', 'Gun Spin'],
  ['gunmayhem', 'Gun Mayhem'],
  ['gunmayhem2', 'Gun Mayhem 2'],
  ['gunmayhemredux', 'Gun Mayhem Redux'],
  ['html5doodlejump', 'Doodle Jump'],
  ['1datedanger', '1 Date Danger'],
  ['clickteamfusiondeveloper25html5runtime', "Five Nights at Freddy's World Refreshed"],
  ['antonblastdemov12', 'Antonblast'],
  ['shapezdemofactoryautomationgame', 'shapez'],
  ['ducklife2worldchampion', 'Duck Life 2: World Champion'],
  ['pacmanworld', 'Pac-Man World'],
  ['roadoffury', 'Road of Fury'],
  ['stateioyt', 'State.io'],
  ['tombofthemask', 'Tomb of the Mask'],
  ['vex2', 'Vex 2'],
  ['worldshardestgame', "World's Hardest Game"],
  ['worldshardestgame2', "World's Hardest Game 2"],
  ['worldshardestgame3', "World's Hardest Game 3"],
  ['worldshardestgame4', "World's Hardest Game 4"],
  ['theworldshardestgame', "World's Hardest Game"],
  ['theworldshardestgame2', "World's Hardest Game 2"],
  ['theworldshardestgame3', "World's Hardest Game 3"],
  ['theworldshardestgame4', "World's Hardest Game 4"],
  ['worlds4', "World's Hardest Game 4"],
  ['worldbox', 'WorldBox'],
  ['wormsworldparty', 'Worms World Party']
]);

function cleanGameTitle(value, format = '') {
  let title = String(value || '')
    .replace(/@[a-f0-9]{8,}$/i, '')
    .replace(/\?s\b/gi, "'s")
    .replace(/\s*[-|]\s*(?:play online\b.*|poki\b.*|free (?:online )?.*|demo)\s*$/i, '')
    .replace(/\s+html5\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) return '';
  title = titleCase(title)
    .replace(/\b(\d)\s+D\b/g, '$1D')
    .replace(/\b(\d)\s+V\s+(\d)\b/gi, '$1v$2');
  const key = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const generic = /^(?:ytgamewrapperwebgltemplate|piplayables|runnertemplate|fix|f|a|win|manifest|offlineclient|internetexplorer|jquerymin|easeljs\d+combined|emulatorjsdemo|youtubeplayable|ruffleplayer|soundboard|coolgames|\d*firebasefirestore|aaafunworld)$/i;
  if (format === 'gn' && (generic.test(key) || /^\d{2,}$/.test(key))) return '';
  return gameTitleCorrections.get(key) || title;
}

function gameTitleScore(title, source = '') {
  const clean = String(title || '').trim();
  if (!clean) return -Infinity;
  const words = clean.split(/\s+/).filter(Boolean);
  let score = Math.min(clean.length, 36) + words.length * 9;
  if (words.length === 1 && clean.length > 11) score -= 16;
  if (clean.length > 48) score -= clean.length - 48;
  if (/[?@]|(?:template|wrapper|play online|demo)$/i.test(clean)) score -= 35;
  if (source === 'duckmath') score += 5;
  if (source === 'seraph') score += 3;
  return score;
}

function gameKey(value) {
  const key = titleCase(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases = {
    '10minutestilldawn': '10minutestildawn',
    fnaf: 'fivenightsatfreddys1',
    fnaf2: 'fivenightsatfreddys2',
    fnaf3: 'fivenightsatfreddys3',
    fnaf4: 'fivenightsatfreddys4',
    fnaf4halloween: 'fivenightsatfreddys4halloween',
    fnafworld: 'fivenightsatfreddysworld',
    fnafps: 'fivenightsatfreddyspizzeriasimulator',
    fnafsl: 'fivenightsatfreddyssisterlocation',
    fnafucn: 'fivenightsatfreddysucn',
    fivenightsatfreddys: 'fivenightsatfreddys1',
    fivenightsatfreddys5: 'fivenightsatfreddyssisterlocation',
    theworldshardestgame: 'worldshardestgame',
    theworldshardestgame2: 'worldshardestgame2',
    theworldshardestgame3: 'worldshardestgame3',
    theworldshardestgame4: 'worldshardestgame4'
  };
  return aliases[key] || key;
}

function fillTemplate(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(values[key] ?? ''));
}

function externalGamePlayer(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!/^https?:$/.test(url.protocol)) return '';
    url.username = '';
    url.password = '';
    url.hash = '';
    return `/assets/games/remote-play.html?v=20260803-catclass-v1&url=${encodeURIComponent(url.href)}`;
  } catch {
    return '';
  }
}

function ugsThumbnailName(path) {
  return String(path)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() + '.png';
}

function safeCover(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url, location.href);
    const proxiedHosts = new Set(['raw.githubusercontent.com', 'cdn.jsdelivr.net', 'rawcdn.githack.com', 'raw.githack.com']);
    return proxiedHosts.has(parsed.hostname)
      ? `/gms-games-proxy?url=${encodeURIComponent(parsed.href)}`
      : parsed.href;
  } catch {
    return '';
  }
}

function directCover(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url, location.href);
    if (parsed.hostname === 'raw.githubusercontent.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length >= 4) {
        const [owner, repository, branch, ...path] = parts;
        if (owner.toLowerCase() === 'gn-math' && repository.toLowerCase() === 'covers') {
          return `https://raw.githack.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${encodeURIComponent(branch)}/${path.map(encodeURIComponent).join('/')}`;
        }
        return `https://cdn.jsdelivr.net/gh/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}@${encodeURIComponent(branch)}/${path.map(encodeURIComponent).join('/')}`;
      }
    }
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function rawItems(data) {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.games) ? data.games : [];
}

async function adaptCatalog(catalog) {
  const response = await fetch(catalog.url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${catalog.id} returned ${response.status}`);
  const items = rawItems(await response.json());
  let knownCovers = new Set();

  if (catalog.coversUrl) {
    try {
      const coverResponse = await fetch(catalog.coversUrl, { cache: 'no-store' });
      if (coverResponse.ok) knownCovers = new Set(await coverResponse.json());
    } catch {
      knownCovers = new Set();
    }
  }

  return items.flatMap(item => {
    const path = String(item.path || '').replace(/^\/+/, '');
    if (!path && catalog.format !== 'duckmath' && catalog.format !== 'external') return [];
    if (catalog.format === 'seraph' && !/(^|\/)index\.html?$/i.test(path)) return [];

    const suppliedTitle = String(item.title || item.name || '').replace(/\s+/g, ' ').trim();
    if (/^@[a-f0-9]{24,}$/i.test(suppliedTitle)) return [];
    const title = cleanGameTitle(catalog.format === 'seraph' || catalog.format === 'duckmath'
      ? titleCase(suppliedTitle || path)
      : suppliedTitle || titleCase(path), catalog.format);
    if (!title) return [];
    let player = catalog.format === 'duckmath'
      ? String(item.url || '')
      : catalog.format === 'external'
        ? externalGamePlayer(item.url)
        : fillTemplate(catalog.player, { path });
    if (!player) return [];
    let covers = [];

    if (catalog.format === 'ugs') {
      player = ugsPlayerOverrides.get(path) || player;
      const thumbnail = ugsThumbnailName(path);
      if (knownCovers.has(thumbnail)) covers.push(`/assets/ugs/thumbs/${encodeURIComponent(thumbnail)}`);
    } else if (catalog.format === 'gn') {
      // Prefer Nyx's same-origin asset route. Managed Chromebook networks often
      // block raw GitHub/CDN hosts even though the Nyx origin itself is allowed.
      covers.push(item.cover, directCover(item.coverFallback), directCover(item.cover));
    } else if (catalog.format === 'gms') {
      if (item.type === 'gba' && item.romId && catalog.gbaPlayer) {
        player = fillTemplate(catalog.gbaPlayer, { romId: item.romId });
      }
      covers.push(safeCover(item.cover), directCover(item.cover));
    } else if (catalog.format === 'seraph' && item.thumbnail) {
      const thumbnailPath = String(item.thumbnail).replace(/^\/+/, '');
      covers.push(
        `/seraph-asset?path=${encodeURIComponent(thumbnailPath)}`,
        `https://cdn.jsdelivr.net/gh/a456pur/seraph@main/${thumbnailPath.split('/').map(encodeURIComponent).join('/')}`
      );
    } else if (catalog.format === 'external') {
      covers.push(safeCover(item.cover), directCover(item.cover));
    }

    covers = [...new Set(covers.filter(Boolean))];

    return [{
      key: gameKey(title),
      title,
      url: player,
      cover: covers[0] || '',
      covers,
      priority: Number(catalog.priority) || 0,
      source: catalog.id,
      fallbackOnly: Boolean(catalog.fallbackOnly),
      sources: [{
        url: player,
        source: catalog.id,
        priority: Number(catalog.priority) || 0,
        title
      }]
    }];
  });
}

function sourceScore(source) {
  const priority = Number(source?.priority) || 0;
  return source?.source === 'gn' ? priority - 1000 : priority;
}

function mergeCatalogs(catalogs) {
  const unique = new Map();

  for (const game of catalogs.flat()) {
    if (!game.key || !game.url) continue;
    const current = unique.get(game.key);
    if (game.fallbackOnly && !current) continue;
    const sources = [...(current?.sources || []), ...(game.sources || [])]
      .filter(source => source?.url)
      .filter((source, index, list) => list.findIndex(candidate => candidate.url === source.url) === index)
      .sort((a, b) => sourceScore(b) - sourceScore(a));
    const covers = [...new Set([
      ...(current?.covers || []),
      ...(game.covers || []),
      game.cover
    ].filter(Boolean))];
    const selected = !current || sourceScore(game) > sourceScore(current) ? { ...game } : { ...current };
    const primary = sources[0];
    selected.url = primary.url;
    selected.source = primary.source;
    selected.priority = primary.priority;
    selected.sources = sources;
    selected.title = sources
      .map(source => ({ title: source.title, score: gameTitleScore(source.title, source.source) }))
      .sort((a, b) => b.score - a.score)[0]?.title || selected.title;
    selected.covers = covers;
    unique.set(game.key, selected);
  }

  const fallback = state.manifest?.fallbackCover || '';
  return [...unique.values()].map(game => {
    const suppliedCovers = [...new Set(game.covers.filter(Boolean))];
    return {
      ...game,
      hasIcon: suppliedCovers.length > 0,
      covers: suppliedCovers.length ? [...new Set([
        ...suppliedCovers,
        fallback ? fillTemplate(fallback, { title: game.title }) : ''
      ].filter(Boolean))] : []
    };
  });
}

function makeFallback(title) {
  const fallback = document.createElement('span');
  fallback.className = 'cover-fallback';
  fallback.textContent = title.trim().charAt(0).toUpperCase() || '?';
  return fallback;
}

function makeCover(game) {
  const cover = document.createElement('span');
  cover.className = 'game-cover';
  if (!game.covers.length) {
    cover.append(makeFallback(game.title));
    return cover;
  }

  const image = document.createElement('img');
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  let index = 0;
  image.src = game.covers[index];
  image.addEventListener('error', () => {
    index += 1;
    if (index < game.covers.length) {
      image.src = game.covers[index];
    } else {
      image.replaceWith(makeFallback(game.title));
    }
  });
  cover.append(image);
  return cover;
}

function makeCard(game) {
  const card = document.createElement('button');
  card.className = 'game-card';
  card.type = 'button';
  card.dataset.gameKey = game.key;
  card.setAttribute('aria-label', `Play ${game.title}`);
  card.append(makeCover(game));

  const name = document.createElement('span');
  name.className = 'game-name';
  name.textContent = game.title;
  card.append(name);
  return card;
}

function visibleGames() {
  const query = elements.search.value.trim().toLowerCase();
  const showMisc = elements.library.value === 'misc';
  const games = state.games.filter(game =>
    game.hasIcon !== showMisc && (!query || game.title.toLowerCase().includes(query))
  );
  return games.sort((a, b) => elements.sort.value === 'za'
    ? b.title.localeCompare(a.title, undefined, { numeric: true })
    : a.title.localeCompare(b.title, undefined, { numeric: true }));
}

function render() {
  const games = visibleGames();
  const fragment = document.createDocumentFragment();
  for (const game of games) fragment.append(makeCard(game));
  elements.grid.replaceChildren(fragment);
  elements.empty.hidden = games.length > 0;
  elements.count.textContent = `${games.length.toLocaleString()} game${games.length === 1 ? '' : 's'}`;
}

function updateGameQuery(key) {
  try {
    const url = new URL(location.href);
    if (key) url.searchParams.set('game', key);
    else url.searchParams.delete('game');
    history.replaceState(null, '', url);
  } catch {
    // The catalog still works if history is unavailable inside an embedded page.
  }
}

function clearSourceTimer() {
  clearTimeout(state.sourceTimer);
  state.sourceTimer = 0;
}

function setPlayerLoading(message, failed = false) {
  elements.playerLoading.classList.remove('done');
  elements.playerLoading.classList.toggle('failed', failed);
  elements.playerLoadingText.textContent = message;
  elements.playerRetry.hidden = !failed;
}

function gameSources(game = state.activeGame) {
  if (!game) return [];
  return game.sources?.length
    ? game.sources
    : [{ url: game.url, source: game.source || 'game', priority: game.priority || 0 }];
}

function finishGameLaunch() {
  if (!state.activeGame) return;
  clearSourceTimer();
  elements.playerLoading.classList.add('done');
  try { parent.postMessage({ type: 'nyx:game-launched' }, '*'); } catch {}
}

function showGameFailure() {
  clearSourceTimer();
  elements.frame.src = 'about:blank';
  setPlayerLoading('This game could not load from any available source.', true);
  try { parent.postMessage({ type: 'nyx:game-failed' }, '*'); } catch {}
}

function launchGameSource(index, reason = '') {
  const sources = gameSources();
  if (!state.activeGame || index < 0 || index >= sources.length) {
    showGameFailure();
    return;
  }

  clearSourceTimer();
  state.activeSourceIndex = index;
  state.sourceAttempt += 1;
  const attempt = state.sourceAttempt;
  const source = sources[index];
  const message = reason && sources.length > 1
    ? `Trying another source… ${index + 1} of ${sources.length}`
    : `Loading game…${sources.length > 1 ? ` Source ${index + 1} of ${sources.length}` : ''}`;
  setPlayerLoading(message);
  elements.frame.src = source.url;

  let sameOrigin = false;
  try { sameOrigin = new URL(source.url, location.href).origin === location.origin; } catch {}
  if (sameOrigin) {
    state.sourceTimer = setTimeout(() => {
      if (attempt !== state.sourceAttempt || !state.activeGame) return;
      launchGameSource(index + 1, 'The current source did not finish loading.');
    }, 18_000);
  }
}

function tryNextGameSource(reason = '') {
  if (!state.activeGame) return;
  const sources = gameSources();
  const current = sources[state.activeSourceIndex];
  if (current?.url) state.failedSources.add(current.url);
  let next = state.activeSourceIndex + 1;
  while (next < sources.length && state.failedSources.has(sources[next].url)) next += 1;
  if (next < sources.length) launchGameSource(next, reason);
  else showGameFailure();
}

function openGame(game, updateHistory = true) {
  if (!game) return;
  state.lastFocused = document.activeElement;
  state.activeGame = game;
  const firstAvailable = gameSources(game).findIndex(source => !state.failedSources.has(source.url));
  state.activeSourceIndex = firstAvailable >= 0 ? firstAvailable : 0;
  elements.playerTitle.textContent = game.title;
  elements.frame.title = game.title;
  elements.player.hidden = false;
  launchGameSource(state.activeSourceIndex);
  elements.close.focus();
  if (updateHistory) updateGameQuery(game.key);
  try { parent.postMessage({ type: 'nyx:game-loading' }, '*'); } catch {}
}

function closeGame() {
  clearSourceTimer();
  state.sourceAttempt += 1;
  state.activeGame = null;
  elements.frame.src = 'about:blank';
  elements.player.hidden = true;
  setPlayerLoading('Loading game…');
  updateGameQuery('');
  state.lastFocused?.focus?.();
}

async function loadLibrary() {
  const manifestResponse = await fetch('/assets/games/games.json', { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`Catalog manifest returned ${manifestResponse.status}`);
  state.manifest = await manifestResponse.json();

  const results = await Promise.allSettled(state.manifest.catalogs.map(adaptCatalog));
  const loaded = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  const failed = results.length - loaded.length;
  state.games = mergeCatalogs(loaded);
  state.gamesByKey = new Map(state.games.map(game => [game.key, game]));
  const iconCount = state.games.filter(game => game.hasIcon).length;
  const miscCount = state.games.length - iconCount;
  elements.library.options[0].textContent = `Study (${iconCount.toLocaleString()})`;
  elements.library.options[1].textContent = `Misc. Study (${miscCount.toLocaleString()})`;
  elements.progress.classList.add('done');
  render();

  if (failed) {
    elements.count.textContent += ` · ${failed} catalog${failed === 1 ? '' : 's'} unavailable`;
  }

  const requested = new URLSearchParams(location.search).get('game');
  if (requested && state.gamesByKey.has(requested)) openGame(state.gamesByKey.get(requested), false);
}

elements.grid.addEventListener('click', event => {
  const card = event.target.closest('[data-game-key]');
  if (card) openGame(state.gamesByKey.get(card.dataset.gameKey));
});
elements.search.addEventListener('input', render);
elements.library.addEventListener('change', render);
elements.sort.addEventListener('change', render);
elements.close.addEventListener('click', closeGame);
elements.reload.addEventListener('click', () => {
  if (state.activeGame) launchGameSource(state.activeSourceIndex);
});
elements.playerRetry.addEventListener('click', () => {
  for (const source of gameSources()) state.failedSources.delete(source.url);
  launchGameSource(0);
});
elements.fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await elements.player.requestFullscreen();
  } catch {}
});
elements.frame.addEventListener('load', () => {
  if (elements.player.hidden || !state.activeGame || elements.frame.src === 'about:blank') return;
  const source = gameSources()[state.activeSourceIndex];
  let sameOrigin = false;
  let managedRunner = false;
  try {
    const parsed = new URL(source?.url || '', location.href);
    sameOrigin = parsed.origin === location.origin;
    managedRunner = sameOrigin && /^\/assets\/(?:ugs|gn-math|gms-games|reds-misc|seraph)\/play\.html$/i.test(parsed.pathname);
    if (sameOrigin && parsed.pathname === '/assets/games/remote-play.html') managedRunner = true;
  } catch {}
  // Nyx's runner pages own their detailed loading/error state. Reveal them as
  // soon as the runner document is available instead of requiring a custom
  // ready message that a short or DOM-only game may never emit.
  if (!sameOrigin || managedRunner) setTimeout(finishGameLaunch, 900);
});
elements.frame.addEventListener('error', () => tryNextGameSource('The current source could not be opened.'));
window.addEventListener('message', event => {
  if (event.source !== elements.frame.contentWindow || !state.activeGame) return;
  if (event.data?.type === 'nyx:game-launched') finishGameLaunch();
  if (event.data?.type === 'nyx:game-failed') tryNextGameSource('The current source reported a loading error.');
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !elements.player.hidden && !document.fullscreenElement) closeGame();
});

loadLibrary().catch(error => {
  console.error('Unable to load game library', error);
  elements.progress.classList.add('done');
  elements.count.textContent = 'Could not load the game library';
  elements.empty.querySelector('h2').textContent = 'Library unavailable';
  elements.empty.querySelector('p').textContent = 'Reload Nyx and try again.';
  elements.empty.hidden = false;
});
