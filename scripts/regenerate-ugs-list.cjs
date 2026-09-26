const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'assets', 'ugs');
const titleOverrides = new Map(Object.entries({
  '1/cl1v1doubleimprettysureitsexactlythesameidk.html': '1v1.LOL',
  '1/cl1v1lolifnoaboutblank.html': '1v1.LOL',
  '1/cl1v1lolnoaboutblank.html': '1v1.LOL',
  '1/cl1v1maybeidk.html': '1v1.LOL',
  '1/cl1v1lol.html': '1v1.LOL',
  '1/cl100skibidistillwaterthosewhoknow.html': '100 Skibidi',
  '2/cl2Dshooting.html': '2D Shooting',
  '2/cl2dshooting(1).html': '2D Shooting',
  '4/cl4thandgoal.html': '4th And Goal',
  '4/cl40exescape.html': '40x Escape',
  '6/cl60secsantarun.html': '60 Seconds Santa Run',
  '8/cl8ballpool.html': '8 Ball Pool',
  'A/claceattorernefgsdg.html': 'Ace Attorney',
  'A/clacegangstertaxi.html': 'Ace Gangster Taxi',
  'A/clADarkRoom.html': 'A Dark Room',
  'A/cladayintheoffice.html': 'A Day In The Office',
  'A/clagariolite.html': 'Agar.io Lite',
  'A/clagesofconflict.html': 'Ages Of Conflict',
  'A/clageofwar.html': 'Age Of War',
  'A/clageofwar2.html': 'Age Of War 2',
  'A/clakoopasrevenge.html': 'A Koopa\'s Revenge',
  'A/clakoopasrevenge2.html': 'A Koopa\'s Revenge 2',
  'A/clakumanorgaiden.html': 'Aku Man Or Gaiden',
  'A/clalienhominidgba.html': 'Alien Hominid GBA',
  'A/clalienvspredator.html': 'Alien Vs Predator',
  'A/clallocation.html': 'Allocation',
  'A/clarewethereyet.html': 'Are We There Yet',
  'A/clasmallworldcup.html': 'A Small World Cup',
  'B/clbackrooms2D.html': 'Backrooms 2D',
  'B/clbaconmaydie.html': 'Bacon May Die',
  'B/clbaldidecomp.html': 'Baldi Decomp',
  'B/clbaldisbasics.html': 'Baldi\'s Basics',
  'B/clbaldisbasicsremaster.html': 'Baldi\'s Basics Remaster',
  'B/clbaldisfunnewschoolultimate.html': 'Baldi\'s Fun New School Ultimate',
  'B/clballsandbricks.html': 'Balls And Bricks',
  'B/clballsandbricksgood.html': 'Balls And Bricks',
  'B/clbanjokazooie.html': 'Banjo Kazooie',
  'B/clbanjotooie.html': 'Banjo Tooie',
  'B/clbarryhasasecret.html': 'Barry Has A Secret',
  'B/clbasketbros.html': 'Basket Bros',
  'B/clbasketslamdunk2.html': 'Basket Slam Dunk 2',
  'B/clbearbarians.html': 'Bearbarians',
  'B/clbigshotboxing.html': 'Big Shot Boxing',
  'B/clbindingofisaccsheeptime.html': 'Binding Of Isaac',
  'B/clblastronaut.html': 'Blastronaut',
  'B/clbleachvsnaruto.html': 'Bleach Vs Naruto',
  'B/clblockcraftparkour.html': 'Block Craft Parkour',
  'B/clblockcraftshooter.html': 'Block Craft Shooter',
  'B/clblockthepig.html': 'Block The Pig',
  'B/clbouncymotors.html': 'Bouncy Motors',
  'B/clboxhead2playrooms.html': 'Boxhead 2 Play Rooms',
  'C/clcrunchball3000.html': 'Crunchball 3000',
  'C/clcannonballs3d.html': 'Cannon Balls 3D',
  'C/clCartoonNetworkTableTennisUltimateTournament.html': 'Cartoon Network Table Tennis',
  'C/clcastlevania.html': 'Castlevania',
  'C/clcastlevania2.html': 'Castlevania 2',
  'C/clcastlevania3.html': 'Castlevania 3',
  'C/clcastlevaniaariaofsorrow.html': 'Castlevania: Aria Of Sorrow',
  'C/clcastlevanianes.html': 'Castlevania NES',
  'C/clcatslovecake2.html': 'Cat Loves Cake 2',
  'C/clchickenscream.html': 'Chicken Scream',
  'C/clCircloO2.html': 'CircloO 2',
  'C/clciviballs.html': 'Civiballs',
  'C/clciviballs2.html': 'Civiballs 2',
  'C/clclassof09.html': 'Class Of 09',
  'C/clcleanupio.html': 'Clean Up.io',
  'C/clcodblackops.html': 'COD Black Ops',
  'C/clcodmodernwarfare.html': 'COD Modern Warfare',
  'C/clcolorwatersort3d.html': 'Color Water Sort 3D',
  'D/cldborigins.html': 'Dragon Ball Origins',
  'D/cldborigins2.html': 'Dragon Ball Origins 2',
  'D/cldbzattacksaiyans.html': 'DBZ Attack Of The Saiyans',
  'D/cldbzsuperwarriorssonic.html': 'DBZ Super Warriors',
  'D/cldbzdevolution.html': 'DBZ Devolution'
}));
const wordList = [
  'minecraft','basketball','baseball','football','soccer','subway','surfers','super','mario','world',
  'bomberman','bloons','tower','defense','stickman','dragon','ball','zombie','shooter','clicker',
  'cookie','run','runner','race','racing','driving','simulator','battle','battles','stars','legends',
  'random','classic','ultimate','escape','adventure','war','wars','age','doom','tennis','bullets',
  'minutes','dawn','cupcakes','slices','goal','seconds','burger','abandoned','combat','taxi',
  'achievement','unlocked','dark','room','office','advance','neon','alien','angry','birds','apple',
  'archery','asteroids','attack','awesome','planes','tanks','backrooms','bad','ice','cream','piggies',
  'basic','blast','bricks','banana','bank','breakout','robbery','bear','boxing','bridge','bubble',
  'bunny','burrito','cactus','cannon','car','crash','castle','cat','celeste','chaos','checkers',
  'cheese','chess','chicken','chips','clean','clear','vision','cluster','rush','color','commander',
  'contra','cooking','crazy','crossy','curve','cut','rope','donkey','kong','drift','duck','life',
  'fireboy','watergirl','flappy','bird','friday','night','funkin','geometry','dash','happy','wheels',
  'house','hardest','game','impossible','kirby','legend','zelda','mega','man','mortal','kombat',
  'pacman','pokemon','portal','raft','retro','bowl','sonic','street','fighter','temple','tetris',
  'tiny','fishing','truck','tunnel','vex','wordle'
].sort((a, b) => b.length - a.length);

function titleCase(value) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(word => /^[A-Z0-9]+$/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function splitKnown(value) {
  let output = '';
  let index = 0;
  const lower = value.toLowerCase();
  while (index < value.length) {
    if (/\d/.test(value[index])) {
      let end = index + 1;
      while (end < value.length && /[\d.]/.test(value[end])) end++;
      output += value.slice(index, end) + ' ';
      index = end;
      continue;
    }
    const word = wordList.find(item => lower.startsWith(item, index));
    if (word) {
      output += value.slice(index, index + word.length) + ' ';
      index += word.length;
      continue;
    }
    let end = index + 1;
    while (end < value.length && /[a-z]/i.test(value[end]) && !wordList.some(item => lower.startsWith(item, end))) end++;
    output += value.slice(index, end) + ' ';
    index = end;
  }
  return output.trim();
}

function makeTitle(file) {
  let base = path.basename(file)
    .replace(/\.[^.]+$/, '')
    .replace(/^cl/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  base = base
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2');

  base = base
    .split(' ')
    .map(part => part.length > 8 && /^[a-z0-9]+$/i.test(part) ? splitKnown(part) : part)
    .join(' ');

  return titleCase(base || 'Game');
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.html?$/i.test(entry.name) && entry.name.toLowerCase() !== 'index.html') files.push(full);
  }
  return files;
}

const games = walk(root)
  .map(file => {
    const relativePath = path.relative(root, file).replace(/\\/g, '/');
    return {
      title: titleOverrides.get(relativePath) || makeTitle(file),
      path: relativePath
    };
  })
  .sort((a, b) => a.title.localeCompare(b.title));

fs.writeFileSync(path.join(root, 'games.json'), JSON.stringify(games), 'utf8');
console.log(`Generated ${games.length} UGS games`);
