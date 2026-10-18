/**
 * 클래식 산책 — Google Apps Script 웹앱 + 휴대폰 앱용 기록 API
 * 파일 구성: Code.gs / Index.html / Styles.html / Data.html / App.html
 *
 * 배포 두 가지
 *  1) PC용 페이지 배포  : 실행=나, 액세스=나만      → 기존 주소 그대로
 *  2) 휴대폰 앱 API 배포 : 실행=나, 액세스=모든 사용자 → 앱이 기록을 읽고 쓰는 용도
 *     (연결 코드가 맞아야만 기록에 접근 가능, 페이지는 주인 외에는 열리지 않음)
 */

const PROPS = PropertiesService.getScriptProperties();
const APP_URL = 'https:/' + '/kingboyx-sketch.github.io/classic-walk/';

function isOwner_() {
  try { return !!Session.getActiveUser().getEmail(); } catch (e) { return false; }
}

function doGet() {
  if (!isOwner_()) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px">이 페이지는 주인만 볼 수 있어요. 휴대폰에서는 클래식 산책 앱을 사용하세요.</p>')
      .setTitle('클래식 산책');
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('클래식 산책')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ---------- 휴대폰 앱 API (POST, 연결 코드 필요) ---------- */
function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents || '{}');
    if (!req.key || req.key !== appKey_()) throw new Error('연결 코드가 맞지 않아요. PC의 내 기록 화면에서 휴대폰 연결 링크를 다시 열어주세요.');
    const fns = { getState: getState_, setListened: setListened_, saveNote: saveNote_, saveVideo: saveVideo_, clearVideo: clearVideo_, ttsSample: ttsSample_, getClips: getClips_ };
    const fn = fns[req.fn];
    if (!fn) throw new Error('알 수 없는 요청');
    out = { ok: true, data: fn.apply(null, req.args || []) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function appKey_() {
  let k = PROPS.getProperty('APP_KEY');
  if (!k) { k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); PROPS.setProperty('APP_KEY', k); }
  return k;
}

/* ---------- 저장소 ---------- */
function readJson_(key) {
  try { return JSON.parse(PROPS.getProperty(key) || '{}'); } catch (e) { return {}; }
}
function writeJson_(key, obj) {
  PROPS.setProperty(key, JSON.stringify(obj));
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function owner_() { if (!isOwner_()) throw new Error('권한이 없어요'); }

/* ---------- PC 페이지(google.script.run)에서 호출 — 주인만 ---------- */
function getState() { owner_(); return getState_(); }
function setListened(id, on) { owner_(); return setListened_(id, on); }
function saveNote(id, text) { owner_(); return saveNote_(id, text); }
function saveVideo(id, u) { owner_(); return saveVideo_(id, u); }
function clearVideo(id) { owner_(); return clearVideo_(id); }
function findVideo(id, q) { owner_(); return findVideo_(id, q); }
function getPhoneLink() { owner_(); return APP_URL + '#k=' + appKey_(); }

/* ---------- 실제 처리 ---------- */
function getState_() {
  const all = PROPS.getProperties();
  const notes = {};
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('note_') === 0) notes[k.slice(5)] = all[k];
  });
  return {
    videos: readJson_('videos'),
    listened: readJson_('listened'),
    notes: notes,
    hasApiKey: !!all.YOUTUBE_API_KEY
  };
}

function setListened_(id, on) {
  return withLock_(function () {
    const m = readJson_('listened');
    if (on) m[id] = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    else delete m[id];
    writeJson_('listened', m);
    return m;
  });
}

function saveNote_(id, text) {
  text = String(text || '').trim();
  if (text) PROPS.setProperty('note_' + id, text.slice(0, 8000));
  else PROPS.deleteProperty('note_' + id);
  return true;
}

function saveVideo_(id, urlOrId) {
  const vid = parseVideoId_(urlOrId);
  if (!vid) throw new Error('유튜브 링크를 인식하지 못했어요. 영상 주소를 그대로 붙여넣어 주세요.');
  return withLock_(function () {
    const m = readJson_('videos');
    m[id] = vid;
    writeJson_('videos', m);
    return vid;
  });
}

function clearVideo_(id) {
  return withLock_(function () {
    const m = readJson_('videos');
    delete m[id];
    writeJson_('videos', m);
    return true;
  });
}

function findVideo_(id, query) {
  const saved = readJson_('videos');
  if (saved[id]) return saved[id];
  const key = PROPS.getProperty('YOUTUBE_API_KEY');
  if (!key) return null;
  const url = 'https:/' + '/www.googleapis.com/youtube/v3/search?part=snippet&type=video'
    + '&videoEmbeddable=true&maxResults=1&q=' + encodeURIComponent(query) + '&key=' + key;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('유튜브 검색 실패(' + res.getResponseCode() + ').');
  }
  const items = JSON.parse(res.getContentText()).items || [];
  if (!items.length) return null;
  return saveVideo_(id, items[0].id.videoId);
}

function parseVideoId_(s) {
  s = String(s || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

/* ---------- AI 음성 (Google Cloud Text-to-Speech, Chirp 3 HD) ---------- */
const TTS_VOICES = ['Charon', 'Puck', 'Fenrir', 'Orus', 'Kore', 'Leda', 'Aoede', 'Zephyr'];
function ttsSample(text, voice, rate) { owner_(); return ttsSample_(text, voice, rate); }
function ttsSample_(text, voice, rate) {
  const key = PROPS.getProperty('TTS_KEY');
  if (!key) throw new Error('TTS_KEY가 아직 없어요. 앱 스크립트 프로젝트 설정의 스크립트 속성에 넣어주세요.');
  if (TTS_VOICES.indexOf(voice) < 0) throw new Error('지원하지 않는 목소리');
  text = String(text || '').slice(0, 1500);
  const body = {
    input: { text: text },
    voice: { languageCode: 'ko-KR', name: 'ko-KR-Chirp3-HD-' + voice },
    audioConfig: { audioEncoding: 'MP3', speakingRate: Math.min(1.3, Math.max(0.8, Number(rate) || 1)) }
  };
  const url = 'https:/' + '/texttospeech.googleapis.com/v1/text:synthesize?key=' + encodeURIComponent(key);
  const res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    let msg = res.getContentText();
    try { msg = JSON.parse(msg).error.message; } catch (e) {}
    throw new Error('음성 생성 실패(' + res.getResponseCode() + '): ' + String(msg).slice(0, 200));
  }
  return JSON.parse(res.getContentText()).audioContent;
}

/* ---------- AI 해설 음성 파일 (드라이브 저장) ---------- */
// Narr.html의 원고를 음성으로 만들어 드라이브 '클래식 산책 음성' 폴더에 저장합니다.
// 편집기에서 ttsBuild 를 실행하면 아직 없는(또는 원고가 바뀐) 음성만 만들어요. 다 될 때까지 여러 번 실행하세요.
function narr_() {
  const html = HtmlService.createHtmlOutputFromFile('Narr').getContent();
  return JSON.parse(html.slice(html.indexOf('{'), html.lastIndexOf('}') + 1));
}
function ttsFolder_() {
  const id = PROPS.getProperty('TTS_FOLDER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('클래식 산책 음성');
  PROPS.setProperty('TTS_FOLDER', f.getId());
  return f;
}
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('').slice(0, 10);
}
function clipJobs_(N) {
  const jobs = [];
  const add = function (key, voice, text) { if (text) jobs.push({ key: key, voice: voice, text: text, h: hash_(voice + '|' + text) }); };
  Object.keys(N.p).forEach(function (id) {
    const v = N.v[N.p[id].c];
    add('a_' + id, v, N.p[id].a);
    add('b_' + id, v, N.p[id].b);
  });
  Object.keys(N.c).forEach(function (cid) {
    add('c_' + cid, N.v[cid], N.c[cid].s);
    add('w_' + cid, N.v[cid], N.c[cid].w);
  });
  N.voices.forEach(function (v) { Object.keys(N.g).forEach(function (k) { add('g_' + v + '_' + k, v, N.g[k]); }); });
  return jobs;
}
function clipIndex_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) { const c = cache.get('clipIndex'); if (c) return JSON.parse(c); }
  const idx = {};
  const it = ttsFolder_().getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const m = f.getName().match(/^(.+)\.mp3$/);
    if (m) idx[m[1]] = { id: f.getId(), h: f.getDescription() || '' };
  }
  const str = JSON.stringify(idx);
  if (str.length < 95000) cache.put('clipIndex', str, 21600);
  return idx;
}
function ttsBuild() {
  const key = PROPS.getProperty('TTS_KEY');
  if (!key) throw new Error('TTS_KEY가 없어요');
  const N = narr_(), folder = ttsFolder_(), idx = clipIndex_(true);
  const todo = clipJobs_(N).filter(function (j) { return !idx[j.key] || idx[j.key].h !== j.h; });
  const url = 'https:/' + '/texttospeech.googleapis.com/v1/text:synthesize?key=' + encodeURIComponent(key);
  const t0 = Date.now(); let made = 0, fail = 0;
  for (let i = 0; i < todo.length && Date.now() - t0 < 270000; i += 6) {
    const batch = todo.slice(i, i + 6);
    const res = UrlFetchApp.fetchAll(batch.map(function (j) {
      return { url: url, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({ input: { text: j.text }, voice: { languageCode: 'ko-KR', name: 'ko-KR-Chirp3-HD-' + j.voice },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 1 } }) };
    }));
    res.forEach(function (r, k) {
      const j = batch[k];
      if (r.getResponseCode() !== 200) { fail++; Logger.log('실패 ' + j.key + ': ' + r.getContentText().slice(0, 200)); return; }
      if (idx[j.key]) { try { DriveApp.getFileById(idx[j.key].id).setTrashed(true); } catch (e) {} }
      const blob = Utilities.newBlob(Utilities.base64Decode(JSON.parse(r.getContentText()).audioContent), 'audio/mpeg', j.key + '.mp3');
      const f = folder.createFile(blob);
      f.setDescription(j.h);
      idx[j.key] = { id: f.getId(), h: j.h };
      made++;
    });
  }
  CacheService.getScriptCache().remove('clipIndex');
  const left = todo.length - made;
  const msg = '새로 만든 음성 ' + made + '개, 실패 ' + fail + '개, 남은 것 ' + left + '개 (전체 ' + clipJobs_(N).length + '개)';
  Logger.log(msg);
  return msg;
}
function getClips(keys) { owner_(); return getClips_(keys); }
function getClips_(keys) {
  keys = (keys || []).slice(0, 8);
  let idx = clipIndex_(false);
  if (keys.some(function (k) { return !idx[k]; })) idx = clipIndex_(true);
  const out = {};
  keys.forEach(function (k) {
    if (!idx[k]) return;
    try { out[k] = Utilities.base64Encode(DriveApp.getFileById(idx[k].id).getBlob().getBytes()); } catch (e) {}
  });
  return out;
}
