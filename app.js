function dbg(s){ var e=document.getElementById('dbg'); if(e){ e.textContent='診断: '+s; } }
window.addEventListener('error', function(ev){ dbg('エラー → '+ev.message+' (行'+ev.lineno+')'); });
dbg('起動中…(app.js 読み込み)');

// --- 同意書画像の表示制御 ---
(function(){
  var img=document.getElementById('docImg'), load=document.getElementById('pdfLoading');
  function show(){ if(load) load.style.display='none'; if(img) img.style.display='block'; }
  function fail(){ if(load) load.textContent='画像の読み込みに失敗しました'; }
  if(img){ if(img.complete && img.naturalWidth>0){ show(); } else { img.addEventListener('load',show); img.addEventListener('error',fail); } }
})();

const PDF_URL = "document.pdf";
const DOC_VERSION = "hoken-boshu-doui-v1";
const DOC_TITLE = "保険募集同意書";

// ===== Supabase 設定（プロジェクト作成後にここへ貼り付け）=====
const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = "";
const SUPABASE_BUCKET = "signed-consents";
const supaEnabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);
const supa = supaEnabled ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

async function uploadSigned(bytes, rec){
  if(!supaEnabled) return { ok:false, skipped:true };
  const safeName = (rec.name || "署名者").replace(/[\\/:*?"<>| -]/g,"_").slice(0,40);
  const d = new Date(rec.signedAt);
  const ts = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
  const path = `signed/${ts}_${safeName}.pdf`;
  const { error } = await supa.storage.from(SUPABASE_BUCKET)
    .upload(path, new Blob([bytes],{type:'application/pdf'}), { contentType:'application/pdf', upsert:false });
  if(error) return { ok:false, error: error.message };
  return { ok:true, path };
}

// 埋め込み座標
const PAGE_H = 841.92;
const SIG_BOX  = { x: 85, yTopAnchor: 658, maxW: 220, maxH: 46 };
// 日付は自動入力（テキストで記入）。各数字の左X位置と、行のベースライン
const DATE_BASELINE_TOP = 644;
const DATE_TEXT = { yearX: 78, monthX: 140, dayX: 190, size: 12 };

let pdfBytes = null, signedPdfBytes = null, lastRecord = null;

(async function loadPdfBytes(){
  try{
    const resp = await fetch(PDF_URL);
    if(!resp.ok) throw new Error("PDFの取得に失敗しました ("+resp.status+")");
    pdfBytes = await resp.arrayBuffer();
    refresh();
  }catch(e){ showError("同意書PDFを取得できませんでした。"+e.message); }
})();
function showError(msg){ document.getElementById('errArea').innerHTML = `<div class="errbox">${msg}</div>`; }

// ============ なめらか手書きエンジン（1キャンバス）============
function attachPad(canvas){
  const ctx = canvas.getContext('2d');
  let drawing=false, hasInk=false, lx,ly,lmx,lmy, sx,sy;
  const SMOOTH = 0.5; // 入力点の平滑化（手ブレ低減）0=最大平滑 1=平滑なし
  function setup(){
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1,Math.round(rect.width*dpr));
    canvas.height = Math.max(1,Math.round(rect.height*dpr));
    ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr,dpr);
    ctx.lineWidth=3.4; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#13294b';
  }
  setup();
  function pos(e){ const r=canvas.getBoundingClientRect();
    const t=(e.touches&&e.touches[0])?e.touches[0]:(e.changedTouches&&e.changedTouches[0])?e.changedTouches[0]:e;
    return {x:t.clientX-r.left, y:t.clientY-r.top}; }
  function start(e){ if(e.cancelable) e.preventDefault(); drawing=true; const p=pos(e);
    lx=p.x; ly=p.y; lmx=p.x; lmy=p.y; sx=p.x; sy=p.y;
    ctx.beginPath(); ctx.arc(p.x,p.y,ctx.lineWidth/2,0,Math.PI*2); ctx.fillStyle=ctx.strokeStyle; ctx.fill();
    hasInk=true; if(onInk) onInk(); }
  function move(e){ if(!drawing)return; if(e.cancelable) e.preventDefault(); const raw=pos(e);
    // 手ブレ低減：生の指位置へ少しずつ追従させる
    sx += (raw.x - sx)*SMOOTH; sy += (raw.y - sy)*SMOOTH;
    const mx=(lx+sx)/2, my=(ly+sy)/2;
    ctx.beginPath(); ctx.moveTo(lmx,lmy); ctx.quadraticCurveTo(lx,ly,mx,my); ctx.stroke();
    lx=sx; ly=sy; lmx=mx; lmy=my; hasInk=true; if(onInk) onInk(); }
  function end(){ drawing=false; }
  let onInk=null;
  canvas.style.touchAction='none';
  canvas.addEventListener('touchstart',start,{passive:false});
  canvas.addEventListener('touchmove',move,{passive:false});
  canvas.addEventListener('touchend',end);
  canvas.addEventListener('touchcancel',end);
  canvas.addEventListener('mousedown',start);
  canvas.addEventListener('mousemove',move);
  window.addEventListener('mouseup',end);
  return {
    get hasInk(){ return hasInk; },
    set onInk(fn){ onInk=fn; },
    resetSize(){ setup(); hasInk=false; },
    clear(){ ctx.clearRect(0,0,canvas.width,canvas.height); hasInk=false; },
    trimmed(){
      const w=canvas.width,h=canvas.height,d=ctx.getImageData(0,0,w,h).data;
      let minX=w,minY=h,maxX=0,maxY=0,f=false;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){ if(d[(y*w+x)*4+3]!==0){f=true;
        if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;} }
      if(!f) return null;
      const pad=8; minX=Math.max(0,minX-pad);minY=Math.max(0,minY-pad);maxX=Math.min(w,maxX+pad);maxY=Math.min(h,maxY+pad);
      const tw=maxX-minX,th=maxY-minY,tc=document.createElement('canvas'); tc.width=tw;tc.height=th;
      tc.getContext('2d').drawImage(canvas,minX,minY,tw,th,0,0,tw,th);
      return {url:tc.toDataURL('image/png'), ratio:tw/th};
    }
  };
}

// ============ 取得済みの手書き結果（署名のみ。日付は自動）============
const results = { sig:null };
const TITLES = { sig:'ここにご署名ください' };
const previewCanvas = { sig: document.getElementById('sigCanvas') };

// 本日の日付を画面に表示
(function(){ const n=new Date();
  const el=document.getElementById('autoDate');
  if(el) el.textContent = `${n.getFullYear()}年 ${n.getMonth()+1}月 ${n.getDate()}日`;
})();

// プレビュー（取得した手書きを元の枠に縮小表示）
function renderPreview(key){
  const cv = previewCanvas[key], res = results[key];
  const rect = cv.getBoundingClientRect(); const dpr=window.devicePixelRatio||1;
  cv.width=Math.max(1,Math.round(rect.width*dpr)); cv.height=Math.max(1,Math.round(rect.height*dpr));
  const ctx=cv.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,cv.width,cv.height);
  if(!res) return;
  const im=new Image();
  im.onload=function(){
    const cw=cv.width, ch=cv.height, pad=8*dpr;
    let dw=cw-pad*2, dh=dw/res.ratio; if(dh>ch-pad*2){ dh=ch-pad*2; dw=dh*res.ratio; }
    ctx.drawImage(im,(cw-dw)/2,(ch-dh)/2,dw,dh);
  };
  im.src=res.url;
}

// ============ フルスクリーン手書き ============
const overlay=document.getElementById('sigOverlay');
const ovPh=document.getElementById('ovPh');
const ovRotate=document.getElementById('ovRotate');
let ovPad=null, ovTarget=null;

function isPortrait(){
  if(window.matchMedia) return window.matchMedia('(orientation: portrait)').matches;
  return window.innerHeight >= window.innerWidth;
}
// 署名は縦向きだと書きにくい→縦のときは「横にして」を全面表示し、横にしたらキャンバスを使えるようにする
let _ovLastNeed=null;
function updateOvOrientation(){
  if(overlay.classList.contains('hidden')){ _ovLastNeed=null; return; }
  const needLandscape = (ovTarget==='sig' && isPortrait());
  if(needLandscape===_ovLastNeed) return; // 状態が変わったときだけ処理（描画中の誤クリア防止）
  _ovLastNeed=needLandscape;
  if(needLandscape){
    ovRotate.style.display='flex';
  }else{
    ovRotate.style.display='none';
    if(ovPad){ ovPad.resetSize(); ovPad.clear(); ovPh.style.display='flex'; }
  }
}

function openEditor(key){
  ovTarget=key;
  document.getElementById('ovTitle').textContent = TITLES[key];
  overlay.classList.remove('hidden');
  ovPh.style.display='flex';
  _ovLastNeed=null;
  requestAnimationFrame(()=>{ requestAnimationFrame(()=>{
    if(!ovPad){ ovPad=attachPad(document.getElementById('ovCanvas')); ovPad.onInk=()=>{ ovPh.style.display='none'; }; }
    ovPad.resetSize(); ovPad.clear();
    updateOvOrientation();
  }); });
}
function closeEditor(){ overlay.classList.add('hidden'); }
window.addEventListener('resize', ()=>{ if(!overlay.classList.contains('hidden')) updateOvOrientation(); });
window.addEventListener('orientationchange', ()=>{ setTimeout(updateOvOrientation,300); });

document.getElementById('ovCancel').addEventListener('click',closeEditor);
document.getElementById('ovClear').addEventListener('click',()=>{ if(ovPad){ ovPad.clear(); } ovPh.style.display='flex'; });
document.getElementById('ovDone').addEventListener('click',()=>{
  if(!ovPad){ closeEditor(); return; }
  const t = ovPad.trimmed();
  if(!t){ alert('まだ何も書かれていません。指やペンで書いてから「この内容で確定」を押してください。'); return; }
  results[ovTarget]=t;
  renderPreview(ovTarget);
  // 枠を「記入済み」表示に
  if(ovTarget==='sig'){ document.getElementById('sigWrap').classList.add('filled'); document.getElementById('sigHint').style.display='none'; }
  else { const div=document.querySelector('.pad[data-k="'+ovTarget+'"]'); div.classList.add('filled'); div.querySelector('.tap-hint').style.display='none'; }
  closeEditor(); refresh();
});

// 署名欄タップで全画面手書きを開く
document.getElementById('sigWrap').addEventListener('click',()=>openEditor('sig'));

// ============ 入力チェック・確定 ============
const nameInput=document.getElementById('nameInput'), agreeChk=document.getElementById('agreeChk'), submitBtn=document.getElementById('submitBtn');
[nameInput,agreeChk].forEach(el=>el.addEventListener('input',refresh));
function refresh(){ submitBtn.disabled = !(nameInput.value.trim() && results.sig && agreeChk.checked && pdfBytes); }

document.getElementById('submitBtn').addEventListener('click',async()=>{
  try{
    submitBtn.disabled=true; submitBtn.textContent='処理中…';
    if(typeof PDFLib==='undefined'){ submitBtn.disabled=false; submitBtn.textContent='同意して署名を確定する';
      showError('準備中です。数秒おいてから、もう一度「確定」を押してください。'); return; }
    const now=new Date();
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const pdfDoc = await PDFDocument.load(pdfBytes.slice(0));
    const page = pdfDoc.getPages()[0];

    // 署名
    const png = await pdfDoc.embedPng(results.sig.url);
    let sh=SIG_BOX.maxH, sw=sh*results.sig.ratio; if(sw>SIG_BOX.maxW){ sw=SIG_BOX.maxW; sh=sw/results.sig.ratio; }
    page.drawImage(png,{ x:SIG_BOX.x, y:PAGE_H-(SIG_BOX.yTopAnchor+sh), width:sw, height:sh });

    // 日付（本日を自動記入。数字なので標準フォントでOK）
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const yBase = PAGE_H - DATE_BASELINE_TOP, dcol = rgb(0.07,0.16,0.45);
    page.drawText(String(now.getFullYear()), { x:DATE_TEXT.yearX,  y:yBase, size:DATE_TEXT.size, font, color:dcol });
    page.drawText(String(now.getMonth()+1),  { x:DATE_TEXT.monthX, y:yBase, size:DATE_TEXT.size, font, color:dcol });
    page.drawText(String(now.getDate()),     { x:DATE_TEXT.dayX,   y:yBase, size:DATE_TEXT.size, font, color:dcol });

    signedPdfBytes = await pdfDoc.save();
    const stamp = now.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
    lastRecord = { name:nameInput.value.trim(), signedAt:now.toISOString(), signedAtLocal:stamp, docVersion:DOC_VERSION };
    saveRecord(lastRecord);

    let up = { ok:false, skipped:true };
    if(supaEnabled){ submitBtn.textContent='送信中…'; up = await uploadSigned(signedPdfBytes, lastRecord); }

    const head=document.getElementById('doneHead'), sub=document.getElementById('doneSub');
    if(up.ok){ head.textContent='送信が完了しました'; sub.textContent='署名済みの同意書を担当者へお送りしました。これで完了です（送り返す必要はありません）。'; }
    else if(up.skipped){ head.textContent='署名が完了しました'; sub.textContent='署名と日付を反映した同意書（PDF）を保存できます。'; }
    else { head.textContent='署名は完了しました（送信のみ未完了）'; sub.textContent='通信エラーで自動送信ができませんでした。下のボタンでPDFを保存し、担当者へお送りください。'; showError('自動送信に失敗しました：'+(up.error||'不明なエラー')); }

    document.getElementById('formView').classList.add('hidden');
    document.getElementById('doneView').classList.remove('hidden');
    document.getElementById('recordInfo').textContent = `署名者：${lastRecord.name}／受付日時：${stamp}／文面：${DOC_VERSION}`;
    window.scrollTo(0,0);
  }catch(e){
    submitBtn.disabled=false; submitBtn.textContent='同意して署名を確定する';
    showError("署名の埋め込みに失敗しました。"+e.message); window.scrollTo(0,0);
  }
});

function saveRecord(rec){ try{ const k='consentRecords'; const a=JSON.parse(localStorage.getItem(k)||'[]'); a.push(rec); localStorage.setItem(k,JSON.stringify(a)); }catch(e){ console.warn(e); } }

document.getElementById('pdfBtn').addEventListener('click',()=>{
  if(!signedPdfBytes) return;
  const blob=new Blob([signedPdfBytes],{type:'application/pdf'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`保険募集同意書_${lastRecord.name}_${dateTag()}.pdf`; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
});
function dateTag(){const d=new Date();return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;}

document.getElementById('againBtn').addEventListener('click',()=>{
  nameInput.value=''; agreeChk.checked=false;
  results.sig=null;
  const sc=previewCanvas.sig; sc.getContext('2d').clearRect(0,0,sc.width,sc.height);
  document.getElementById('sigWrap').classList.remove('filled'); document.getElementById('sigHint').style.display='flex';
  signedPdfBytes=null; refresh();
  document.getElementById('doneView').classList.add('hidden');
  document.getElementById('formView').classList.remove('hidden');
  window.scrollTo(0,0);
});

document.getElementById('metaInfo').textContent = `文面バージョン：${DOC_VERSION}`;
dbg('準備OK（タップして手書き）');
