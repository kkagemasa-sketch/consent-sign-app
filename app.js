function dbg(s){ var e=document.getElementById('dbg'); if(e){ e.textContent='診断: '+s; } }
window.addEventListener('error', function(ev){ dbg('エラー → '+ev.message+' (行'+ev.lineno+')'); });
dbg('起動中…(app.js 読み込み)');

// --- 同意書画像の表示制御（インライン属性を使わない）---
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
// 空のままなら自動アップロードは行わず、従来どおりダウンロードのみ動作します（安全）。
const SUPABASE_URL = "";        // 例: https://xxxxxxxx.supabase.co
const SUPABASE_ANON_KEY = "";   // 例: eyJhbGciOi... （anon public キー）
const SUPABASE_BUCKET = "signed-consents";
const supaEnabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);
const supa = supaEnabled ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// 署名済みPDFをクラウド保管庫へアップロード（お客様は送り返し不要）
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

// 実測座標（PyMuPDF・原点は左上/y下向き、ページ高さ841.92pt）。pdf-libは左下原点なので y=PAGE_H-yTop で変換
const PAGE_H = 841.92;
// 署名: 「ご署名:」の右。日付行と被らないよう上端を658に下げ、下方向へ伸ばす
const SIG_BOX  = { x: 85, yTopAnchor: 658, maxW: 220, maxH: 46 };
const DATE_LINE_TOP = 644;                                      // 「年 月 日」の下端（やや上げて署名と離す）
const DATE_PADS = {                                             // 各数字の右端を漢字の直前に合わせる
  year:  { rightX: 104, maxW: 30, maxH: 22 },
  month: { rightX: 153, maxW: 33, maxH: 22 },
  day:   { rightX: 204, maxW: 33, maxH: 22 }
};

let pdfBytes = null, signedPdfBytes = null, lastRecord = null;

// --- 署名埋め込み用に元PDFのデータだけ取得（表示は document.png の<img>が担当）---
(async function loadPdfBytes(){
  try{
    const resp = await fetch(PDF_URL);
    if(!resp.ok) throw new Error("PDFの取得に失敗しました ("+resp.status+")");
    pdfBytes = await resp.arrayBuffer();
    refresh();
  }catch(e){
    showError("同意書PDFを取得できませんでした。"+e.message);
  }
})();
function showError(msg){ document.getElementById('errArea').innerHTML = `<div class="errbox">${msg}</div>`; }

// ============ 手書きパッド共通 ============
function makePad(canvas, onFirstInk){
  const ctx = canvas.getContext('2d');
  let drawing=false, hasInk=false;
  function setup(){
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width*dpr; canvas.height = rect.height*dpr;
    ctx.scale(dpr,dpr); ctx.lineWidth=3.4; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#13294b';
  }
  setup();
  // 指・Apple Pencil は touch、PCは mouse で扱う（iOS Safari で最も確実な方式）
  function pos(e){ const r=canvas.getBoundingClientRect();
    const t=(e.touches&&e.touches[0])?e.touches[0]:(e.changedTouches&&e.changedTouches[0])?e.changedTouches[0]:e;
    return {x:t.clientX-r.left, y:t.clientY-r.top}; }
  // なめらかな手書き：直前点と中点を二次曲線でつなぐ（カクつき防止）
  let lx,ly,lmx,lmy;
  function ink(){ if(!hasInk){ hasInk=true; dbg('描画OK ✓'); if(onFirstInk) onFirstInk(); } }
  function start(e){ if(e.cancelable) e.preventDefault(); drawing=true; dbg('タッチ検知 ✓');
    const p=pos(e); lx=p.x; ly=p.y; lmx=p.x; lmy=p.y;
    ctx.beginPath(); ctx.arc(p.x,p.y,ctx.lineWidth/2,0,Math.PI*2); ctx.fillStyle=ctx.strokeStyle; ctx.fill();
    ink(); }
  function move(e){ if(!drawing)return; if(e.cancelable) e.preventDefault(); const p=pos(e);
    const mx=(lx+p.x)/2, my=(ly+p.y)/2;
    ctx.beginPath(); ctx.moveTo(lmx,lmy); ctx.quadraticCurveTo(lx,ly,mx,my); ctx.stroke();
    lx=p.x; ly=p.y; lmx=mx; lmy=my; ink(); }
  function end(){ drawing=false; }
  canvas.style.touchAction='none';
  canvas.addEventListener('touchstart',start,{passive:false});
  canvas.addEventListener('touchmove',move,{passive:false});
  canvas.addEventListener('touchend',end);
  canvas.addEventListener('touchcancel',end);
  canvas.addEventListener('mousedown',start);
  canvas.addEventListener('mousemove',move);
  window.addEventListener('mouseup',end);
  // 画面回転・リサイズ時にキャンバスを取り直す（座標ズレ防止）。描いた内容は保持
  function resize(){
    const prev = (canvas.width && canvas.height && hasInk) ? canvas.toDataURL() : null;
    setup();
    if(prev){ const im=new Image(); im.onload=function(){ const dpr=window.devicePixelRatio||1;
      ctx.drawImage(im,0,0,canvas.width/dpr,canvas.height/dpr); }; im.src=prev; }
  }
  return {
    get hasInk(){ return hasInk; },
    resize,
    clear(){ ctx.clearRect(0,0,canvas.width,canvas.height); hasInk=false; },
    trimmed(){
      const w=canvas.width,h=canvas.height,d=ctx.getImageData(0,0,w,h).data;
      let minX=w,minY=h,maxX=0,maxY=0,f=false;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){ if(d[(y*w+x)*4+3]!==0){f=true;
        if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;} }
      if(!f) return null;
      const pad=6; minX=Math.max(0,minX-pad);minY=Math.max(0,minY-pad);maxX=Math.min(w,maxX+pad);maxY=Math.min(h,maxY+pad);
      const tw=maxX-minX,th=maxY-minY,tc=document.createElement('canvas'); tc.width=tw;tc.height=th;
      tc.getContext('2d').drawImage(canvas,minX,minY,tw,th,0,0,tw,th);
      return {url:tc.toDataURL('image/png'), ratio:tw/th};
    }
  };
}

// --- 署名パッド ---
const sigWrap=document.getElementById('sigWrap'), sigHint=document.getElementById('sigHint');
const sigPad = makePad(document.getElementById('sigCanvas'), ()=>{ sigHint.style.display='none'; sigWrap.classList.add('filled'); refresh(); });
document.getElementById('clearBtn').addEventListener('click',()=>{ sigPad.clear(); sigHint.style.display='flex'; sigWrap.classList.remove('filled'); refresh(); });

// --- 日付パッド3つ ---
const datePads = {};
document.querySelectorAll('.pad').forEach(div=>{
  const k=div.dataset.k, cv=div.querySelector('canvas'), ph=div.querySelector('.ph');
  datePads[k]=makePad(cv, ()=>{ ph.style.display='none'; div.classList.add('filled'); refresh(); });
  datePads[k]._div=div; datePads[k]._ph=ph;
});
function clearAllDates(){ Object.values(datePads).forEach(p=>{ p.clear(); p._ph.style.display='flex'; p._div.classList.remove('filled'); }); refresh(); }
document.getElementById('clearDateBtn').addEventListener('click',clearAllDates);

// 画面回転・リサイズ時に全キャンバスを取り直す（横向きで指と線がズレる問題の対策）
let _rzTimer=null;
function resizeAllPads(){ sigPad.resize(); Object.values(datePads).forEach(p=>p.resize()); }
window.addEventListener('resize', ()=>{ clearTimeout(_rzTimer); _rzTimer=setTimeout(resizeAllPads,200); });
window.addEventListener('orientationchange', ()=>{ setTimeout(resizeAllPads,300); });

// 今日の日付を参考表示
document.getElementById('todayBtn').addEventListener('click',()=>{
  const n=new Date();
  alert(`今日の日付は ${n.getFullYear()}年 ${n.getMonth()+1}月 ${n.getDate()}日 です。\n各枠に数字を手書きしてください。`);
});

// --- 入力チェック ---
const nameInput=document.getElementById('nameInput'), agreeChk=document.getElementById('agreeChk'), submitBtn=document.getElementById('submitBtn');
[nameInput,agreeChk].forEach(el=>el.addEventListener('input',refresh));
function datesFilled(){ return datePads.year.hasInk && datePads.month.hasInk && datePads.day.hasInk; }
function refresh(){ submitBtn.disabled = !(nameInput.value.trim() && sigPad.hasInk && datesFilled() && agreeChk.checked && pdfBytes); }

// --- 署名確定 → 元PDFに署名・手書き日付を埋め込み ---
document.getElementById('submitBtn').addEventListener('click',async()=>{
  try{
    submitBtn.disabled=true; submitBtn.textContent='処理中…';
    if(typeof PDFLib==='undefined'){ submitBtn.disabled=false; submitBtn.textContent='同意して署名を確定する';
      showError('準備中です。数秒おいてから、もう一度「確定」を押してください。'); return; }
    const now=new Date();
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.load(pdfBytes.slice(0));
    const page = pdfDoc.getPages()[0];

    // 署名画像（上端を yTopAnchor に合わせて下方向へ配置 → 日付行と被らない）
    const sig = sigPad.trimmed();
    const png = await pdfDoc.embedPng(sig.url);
    let sh=SIG_BOX.maxH, sw=sh*sig.ratio; if(sw>SIG_BOX.maxW){ sw=SIG_BOX.maxW; sh=sw/sig.ratio; }
    page.drawImage(png,{ x:SIG_BOX.x, y:PAGE_H-(SIG_BOX.yTopAnchor+sh), width:sw, height:sh });

    // 手書き日付3つ（右端を漢字の直前に合わせる）
    for(const k of ['year','month','day']){
      const t = datePads[k].trimmed(); if(!t) continue;
      const cfg = DATE_PADS[k];
      let h=cfg.maxH, w=h*t.ratio; if(w>cfg.maxW){ w=cfg.maxW; h=w/t.ratio; }
      const img = await pdfDoc.embedPng(t.url);
      page.drawImage(img,{ x:cfg.rightX-w, y:PAGE_H-DATE_LINE_TOP, width:w, height:h });
    }

    signedPdfBytes = await pdfDoc.save();

    const stamp = now.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
    lastRecord = { name:nameInput.value.trim(), signedAt:now.toISOString(), signedAtLocal:stamp, docVersion:DOC_VERSION };
    saveRecord(lastRecord);

    // クラウド保管庫へ自動アップロード（設定済みの場合）
    let up = { ok:false, skipped:true };
    if(supaEnabled){
      submitBtn.textContent='送信中…';
      up = await uploadSigned(signedPdfBytes, lastRecord);
    }

    const head = document.getElementById('doneHead');
    const sub  = document.getElementById('doneSub');
    if(up.ok){
      head.textContent='送信が完了しました';
      sub.textContent='署名済みの同意書を担当者へお送りしました。これで完了です（送り返す必要はありません）。';
    }else if(up.skipped){
      head.textContent='署名が完了しました';
      sub.textContent='署名と日付を反映した同意書（PDF）を保存できます。';
    }else{
      head.textContent='署名は完了しました（送信のみ未完了）';
      sub.textContent='通信エラーで自動送信ができませんでした。お手数ですが下のボタンでPDFを保存し、担当者へお送りください。';
      showError('自動送信に失敗しました：'+(up.error||'不明なエラー'));
    }

    document.getElementById('formView').classList.add('hidden');
    document.getElementById('doneView').classList.remove('hidden');
    document.getElementById('recordInfo').textContent =
      `署名者：${lastRecord.name}／受付日時：${stamp}／文面：${DOC_VERSION}`;
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
  sigPad.clear(); sigHint.style.display='flex'; sigWrap.classList.remove('filled');
  clearAllDates(); signedPdfBytes=null; refresh();
  document.getElementById('doneView').classList.add('hidden');
  document.getElementById('formView').classList.remove('hidden');
  window.scrollTo(0,0);
});

document.getElementById('metaInfo').textContent = `文面バージョン：${DOC_VERSION}`;
dbg(`準備OK（タッチ方式）`);
