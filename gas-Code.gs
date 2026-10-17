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
    const fns = { getState: getState_, setListened: setListened_, saveNote: saveNote_, saveVideo: saveVideo_, clearVideo: clearVideo_ };
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
