/* تطبيق محاسبة — عميل فقط (LocalStorage)
   اللغة: العربية — العملة: الشيقل الإسرائيلي (₪)
   ملاحظة: يتضمن صلاحيات مستخدمين، مخازن متعددة، فواتير بيع/شراء، عملاء/موردين،
   إدارة أصناف مع باركود Code39، خصومات/ضرائب، تقارير أرباح، نسخ احتياطي (تصدير/استيراد JSON)،
   وطباعة بفواصل صفحات تلقائية.
*/

/* ====== أدوات مساعدة عامة ====== */
const $ = (sel, parent=document) => parent.querySelector(sel);
const $$ = (sel, parent=document) => Array.from(parent.querySelectorAll(sel));
const ILS = new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'ILS', currencyDisplay:'symbol' });
const fmt = n => (n===null||n===undefined||Number.isNaN(+n))? '' : ILS.format(+n);
const uid = (p='ID') => p + '_' + Math.random().toString(36).slice(2,9);
const todayStr = () => new Date().toISOString().slice(0,10);
const sum = arr => arr.reduce((a,b)=>a+(+b||0),0);

/* تمنع كتابة 0 تلقائياً في الحقول العددية، وتتركها فارغة */
function bindEmptyZero(el){
  el.addEventListener('input',()=>{
    if(el.value==='0') el.value='';
  });
}

/* LocalStorage */
const DB_KEY = 'acc_db_v1_ar';
const defaultDB = {
  users:[
    {id:'u_admin', username:'admin', password:'admin12', role:'مدير', perms:['كل شيء']},
  ],
  currentUser: null,
  settings:{
    companyName:'شركة نور الدين ميتاني',
    taxPercent: 0, // ضريبة افتراضية للفواتير
    paperSize:'A4',
    resetStockAllowed:true,
  },
  warehouses:[{id:'w1', name:'المخزن الرئيسي'}],
  items:[
    // {id, code, name, category, unit, priceBuy, priceSell, stock:{[warehouseId]:qty} }
  ],
  partners:{
    customers:[],
    suppliers:[]
  },
  invoices:{
    sales:[],     // {id,date,customerId,warehouseId,lines:[{itemId,qty,price,discount,tax}], note, total}
    purchases:[]  // {id,date,supplierId,warehouseId,lines:...}
  },
  payments:[
    // {id,date,type:'عميل'|'مورد', partnerId, amount, note}
  ],
  logs:[]
};

let db = loadDB();
function loadDB(){
  try{
    const s = localStorage.getItem(DB_KEY);
    return s? JSON.parse(s): structuredClone(defaultDB);
  }catch{ return structuredClone(defaultDB); }
}
function saveDB(){
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

/* صلاحيات مبسطة */
function can(user, action){
  if(!user) return false;
  if(user.perms?.includes('كل شيء')) return true;
  const map = {
    'قراءة': ['عرض','تقارير'],
    'فاتورة': ['فواتير','عرض'],
    'تقارير': ['تقارير','عرض']
  };
  for(const p of user.perms||[]){
    if(map[p]?.includes(action)) return true;
  }
  return false;
}

/* ====== تسجيل الدخول ====== */
const loginForm = $('#login-form');
const loginErr = $('#login-error');
const loginScreen = $('#login-screen');
const appRoot = $('#app');
const currentUserBadge = $('#current-user');
const logoutBtn = $('#logout-btn');
const menuToggle = $('#menu-toggle');
const sidebar = $('#sidebar');
menuToggle.addEventListener('click',()=> sidebar.classList.toggle('open'));

loginForm.addEventListener('submit', e=>{
  e.preventDefault();
  const u = $('#login-username').value.trim();
  const p = $('#login-password').value;
  const user = db.users.find(x=>x.username===u && x.password===p);
  if(user){
    db.currentUser = {id:user.id, username:user.username};
    saveDB();
    enterApp();
  }else{
    loginErr.textContent = 'بيانات دخول غير صحيحة';
    loginErr.hidden = false;
  }
});
logoutBtn.addEventListener('click',()=>{
  db.currentUser = null; saveDB();
  location.reload();
});

function enterApp(){
  loginScreen.classList.remove('active');
  loginScreen.classList.add('hidden');
  appRoot.classList.remove('hidden');
  const user = db.users.find(u=>u.id===db.currentUser?.id);
  currentUserBadge.textContent = `المستخدم: ${user?.username||''} — الدور: ${user?.role||''}`;
  route();
}

if(db.currentUser){ enterApp(); } // جلسة سابقة

/* ====== التوجيه (Routing) ====== */
window.addEventListener('hashchange', route);
const view = $('#view');
function route(){
  const hash = (location.hash||'#dashboard').split('?')[0];
  $$('.nav-link').forEach(a=> a.classList.toggle('active', a.getAttribute('href')===hash));
  switch(hash){
    case '#dashboard': renderDashboard(); break;
    case '#inventory': renderInventory(); break;
    case '#customers': renderPartners('customers'); break;
    case '#suppliers': renderPartners('suppliers'); break;
    case '#sales': renderInvoiceList('sales'); break;
    case '#purchases': renderInvoiceList('purchases'); break;
    case '#payments': renderPayments(); break;
    case '#reports': renderReports(); break;
    case '#backup': renderBackup(); break;
    case '#settings': renderSettings(); break;
    default: renderDashboard();
  }
}

/* ====== لوحة التحكم ====== */
function renderDashboard(){
  view.innerHTML = `
    <div class="grid cols-4">
      <div class="kpi"><div class="t">قيمة المخزون</div><div class="v">${fmt(stockValue())}</div></div>
      <div class="kpi"><div class="t">مبيعات اليوم</div><div class="v">${fmt(todaysTotal('sales'))}</div></div>
      <div class="kpi"><div class="t">مشتريات اليوم</div><div class="v">${fmt(todaysTotal('purchases'))}</div></div>
      <div class="kpi"><div class="t">عدد العملاء</div><div class="v">${db.partners.customers.length}</div></div>
    </div>
    <div class="card">
      <h3>اختصارات</h3>
      <div class="actions">
        <a class="btn primary" href="#sales">فاتورة بيع جديدة</a>
        <a class="btn" href="#purchases">فاتورة شراء جديدة</a>
        <a class="btn" href="#inventory">إضافة صنف</a>
        <a class="btn" href="#reports">التقارير</a>
      </div>
      <div class="help">العملة الافتراضية: الشيقل الإسرائيلي (₪). يتم حفظ كل البيانات على هذا الجهاز (LocalStorage). استخدم النسخ الاحتياطي لحفظ ملف JSON.</div>
    </div>
  `;
}
function stockValue(){
  let total = 0;
  for(const it of db.items){
    const price = +it.priceSell||0;
    const q = Object.values(it.stock||{}).reduce((a,b)=>a+(+b||0),0);
    total += price*q;
  }
  return total;
}
function todaysTotal(kind){
  const arr = db.invoices[kind];
  const today = todayStr();
  return sum(arr.filter(i=>i.date===today).map(i=>i.total||0));
}

/* ====== إدارة المخازن والأصناف ====== */
function renderInventory(){
  const whOpts = db.warehouses.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
  view.innerHTML = `
    <div class="card">
      <h3>إضافة/تعديل صنف</h3>
      <div class="row-3">
        <div><label>الكود/باركود</label><input id="itm-code" placeholder="مثال: A100" /></div>
        <div><label>الاسم</label><input id="itm-name" /></div>
        <div><label>التصنيف</label><input id="itm-cat" placeholder="مثال: قطع غيار" /></div>
        <div><label>الوحدة</label><input id="itm-unit" placeholder="حبة/علبة..." /></div>
        <div><label>سعر الشراء (₪)</label><input id="itm-pbuy" type="number" min="0" step="0.01" /></div>
        <div><label>سعر البيع (₪)</label><input id="itm-psell" type="number" min="0" step="0.01" /></div>
      </div>
      <div class="row">
        <div>
          <label>المخزن</label>
          <select id="itm-wh">${whOpts}</select>
        </div>
        <div>
          <label>الكمية (تُترك فارغة إن لم توجد)</label>
          <input id="itm-qty" type="number" min="0" step="1" />
        </div>
      </div>
      <div class="actions">
        <button class="btn success" id="itm-save">حفظ الصنف</button>
        <button class="btn" id="itm-new">جديد</button>
        <button class="btn ghost" id="itm-barcode">طباعة باركود</button>
      </div>
    </div>
    <div class="card">
      <h3>الأصناف</h3>
      <div class="toolbar">
        <input id="itm-search" placeholder="بحث بالاسم/الكود" />
        <select id="wh-filter"><option value="">كل المخازن</option>${whOpts}</select>
      </div>
      <table class="table" id="items-table">
        <thead><tr><th>كود</th><th>اسم</th><th>تصنيف</th><th>سعر بيع</th><th>مخزن</th><th>كمية</th><th></th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  `;
  bindEmptyZero($('#itm-qty')); bindEmptyZero($('#itm-pbuy')); bindEmptyZero($('#itm-psell'));
  $('#itm-save').onclick = saveItem;
  $('#itm-new').onclick = () => $$('#itm-code,#itm-name,#itm-cat,#itm-unit,#itm-pbuy,#itm-psell,#itm-qty').forEach(x=>x.value='');
  $('#itm-barcode').onclick = ()=> printBarcode($('#itm-code').value || '-----');
  $('#itm-search').oninput = renderItemsRows;
  $('#wh-filter').onchange = renderItemsRows;
  renderItemsRows();
}
function saveItem(){
  const code = $('#itm-code').value.trim();
  if(!code){ alert('يجب إدخال كود الصنف'); return; }
  let it = db.items.find(i=>i.code===code);
  if(!it){
    it = {id: uid('it'), code, stock:{} };
    db.items.push(it);
  }
  it.name = $('#itm-name').value.trim();
  it.category = $('#itm-cat').value.trim();
  it.unit = $('#itm-unit').value.trim();
  it.priceBuy = +$('#itm-pbuy').value || null;
  it.priceSell = +$('#itm-psell').value || null;
  const wh = $('#itm-wh').value;
  const qty = $('#itm-qty').value===''? 0 : (+$('#itm-qty').value||0);
  it.stock[wh] = (it.stock[wh]||0) + qty;
  saveDB(); renderItemsRows(); alert('تم الحفظ');
}
function renderItemsRows(){
  const q = ($('#itm-search')?.value||'').trim();
  const wh = ($('#wh-filter')?.value||'');
  const tbody = $('#items-table tbody');
  tbody.innerHTML = '';
  db.items.filter(it=> !q || it.name?.includes(q) || it.code?.includes(q)).forEach(it=>{
    const whs = wh? [db.warehouses.find(w=>w.id===wh)] : db.warehouses;
    for(const w of whs){
      const qty = it.stock?.[w.id]||0;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${it.code||''}</td><td>${it.name||''}</td><td>${it.category||''}</td>
        <td>${fmt(it.priceSell||0)}</td><td>${w.name}</td><td>${qty}</td>
        <td><button class="btn" data-edit="${it.id}">تعديل</button> <button class="btn danger" data-del="${it.id}">حذف</button></td>`;
      tbody.appendChild(tr);
    }
  });
  tbody.onclick = (e)=>{
    const id = e.target.dataset.edit || e.target.dataset.del;
    if(!id) return;
    const it = db.items.find(x=>x.id===id);
    if(e.target.dataset.edit){
      $('#itm-code').value = it.code||'';
      $('#itm-name').value = it.name||'';
      $('#itm-cat').value = it.category||'';
      $('#itm-unit').value = it.unit||'';
      $('#itm-pbuy').value = it.priceBuy||'';
      $('#itm-psell').value = it.priceSell||'';
    }else if(e.target.dataset.del){
      if(confirm('حذف الصنف؟')){
        db.items = db.items.filter(x=>x.id!==id);
        saveDB(); renderItemsRows();
      }
    }
  };
}

/* ====== باركود Code39 بسيط إلى SVG ====== */
function code39Pattern(ch){
  const map = {
    '0':"101001101101",'1':"110100101011",'2':"101100101011",'3':"110110010101",
    '4':"101001101011",'5':"110100110101",'6':"101100110101",'7':"101001011011",
    '8':"110100101101",'9':"101100101101",
    'A':"110101001011",'B':"101101001011",'C':"110110100101",'D':"101011001011",
    'E':"110101100101",'F':"101101100101",'G':"101010011011",'H':"110101001101",
    'I':"101101001101",'J':"101011001101",'K':"110101010011",'L':"101101010011",
    'M':"110110101001",'N':"101011010011",'O':"110101101001",'P':"101101101001",
    'Q':"101010110011",'R':"110101011001",'S':"101101011001",'T':"101011011001",
    'U':"110010101011",'V':"100110101011",'W':"110011010101",'X':"100101101011",
    'Y':"110010110101",'Z':"100110110101","-":"100101011011",".":"110010101101",
    " ":"100110101101","$":"100100100101","/":"100100101001","+":"100101001001",
    "%":"101001001001","*":"100101101101"
  };
  return map[ch] || map['-'];
}
function generateCode39(text){
  const t = `*${String(text).toUpperCase().replace(/[^0-9A-Z\-\.\ \$\/\+\%]/g,'-')}*`;
  const module = 2, height = 60, quiet=10;
  let x = quiet;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${t.length*module*13+quiet*2}" height="${height+20}">`;
  for(const ch of t){
    const patt = code39Pattern(ch);
    for(let i=0;i<patt.length;i++){
      if(patt[i]==='1'){
        svg += `<rect x="${x}" y="0" width="${module}" height="${height}" />`;
      }
      x += module;
    }
    x += module; // فاصلة بين الحروف
  }
  svg += `<text x="${(t.length*module*13+quiet*2)/2}" y="${height+16}" font-size="14" text-anchor="middle">${text}</text></svg>`;
  return svg;
}
function printBarcode(code){
  const svg = generateCode39(code||'');
  const w = window.open('','_blank');
  w.document.write(`<html dir="rtl"><head><title>باركود ${code}</title></head><body>${svg}<script>print()</script></body></html>`);
  w.document.close();
}

/* ====== الأطراف: عملاء/موردون ====== */
function renderPartners(kind){
  const title = kind==='customers' ? 'العملاء' : 'الموردون';
  view.innerHTML = `
    <div class="card">
      <h3>إضافة ${title.slice(0,-1)}</h3>
      <div class="row-3">
        <div><label>الاسم</label><input id="p-name" /></div>
        <div><label>الهاتف</label><input id="p-phone" /></div>
        <div><label>الرصيد الافتتاحي (₪)</label><input id="p-balance" type="number" /></div>
      </div>
      <div class="actions">
        <button class="btn success" id="p-save">حفظ</button>
        <button class="btn" id="p-new">جديد</button>
      </div>
    </div>
    <div class="card">
      <h3>${title}</h3>
      <table class="table" id="p-table">
        <thead><tr><th>الاسم</th><th>الهاتف</th><th>الرصيد</th><th></th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  `;
  bindEmptyZero($('#p-balance'));
  $('#p-save').onclick = ()=>{
    const name = $('#p-name').value.trim(); if(!name) return alert('أدخل الاسم');
    const phone = $('#p-phone').value.trim();
    const bal = $('#p-balance').value===''? 0 : (+$('#p-balance').value||0);
    db.partners[kind].push({id:uid('p'), name, phone, balance:bal});
    saveDB(); renderPartners(kind);
  };
  $('#p-new').onclick = ()=> $$('#p-name,#p-phone,#p-balance').forEach(x=>x.value='');
  const tbody = $('#p-table tbody');
  tbody.innerHTML = '';
  db.partners[kind].forEach(p=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.name}</td><td>${p.phone||''}</td><td>${fmt(p.balance||0)}</td>
      <td><button class="btn" data-edit="${p.id}">تعديل</button> <button class="btn danger" data-del="${p.id}">حذف</button></td>`;
    tbody.appendChild(tr);
  });
  tbody.onclick = e=>{
    const id = e.target.dataset.edit || e.target.dataset.del; if(!id) return;
    if(e.target.dataset.edit){
      const p = db.partners[kind].find(x=>x.id===id);
      $('#p-name').value = p.name||''; $('#p-phone').value = p.phone||''; $('#p-balance').value = p.balance||'';
      db.partners[kind] = db.partners[kind].filter(x=>x.id!==id); // سيُعاد حفظه عند الضغط حفظ
    }else if(e.target.dataset.del){
      if(confirm('حذف؟')){ db.partners[kind]=db.partners[kind].filter(x=>x.id!==id); saveDB(); renderPartners(kind); }
    }
  };
}

/* ====== فواتير بيع/شراء ====== */
function renderInvoiceList(kind){
  const isSales = kind==='sales';
  const partners = isSales? db.partners.customers : db.partners.suppliers;
  const whOpts = db.warehouses.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
  const partOpts = partners.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  view.innerHTML = `
    <div class="card">
      <h3>${isSales?'فاتورة بيع':'فاتورة شراء'} جديدة</h3>
      <div class="row-3">
        <div><label>التاريخ</label><input id="inv-date" type="date" value="${todayStr()}" /></div>
        <div><label>${isSales?'العميل':'المورد'}</label><select id="inv-partner"><option value="">— اختر —</option>${partOpts}</select></div>
        <div><label>المخزن</label><select id="inv-wh">${whOpts}</select></div>
      </div>
      <div class="actions">
        <button class="btn success" id="inv-add-line">إضافة صنف</button>
        <button class="btn primary" id="inv-save">حفظ الفاتورة</button>
        <button class="btn" id="inv-print">طباعة</button>
      </div>
      <table class="table" id="inv-table">
        <thead><tr><th>كود</th><th>اسم الصنف</th><th>كمية</th><th>سعر (₪)</th><th>خصم (₪)</th><th>ضريبة %</th><th>الإجمالي</th><th></th></tr></thead>
        <tbody></tbody>
        <tfoot>
          <tr><td colspan="6" style="text-align:left">الإجمالي الفرعي</td><td id="inv-sub">0</td><td></td></tr>
          <tr><td colspan="6" style="text-align:left">إجمالي الخصومات</td><td id="inv-disc">0</td><td></td></tr>
          <tr><td colspan="6" style="text-align:left">إجمالي الضريبة</td><td id="inv-tax">0</td><td></td></tr>
          <tr><td colspan="6" style="text-align:left;font-weight:700">الإجمالي النهائي</td><td id="inv-total">0</td><td></td></tr>
        </tfoot>
      </table>
      <div class="help">الفاتورة تدعم عدة صفحات عند الطباعة تلقائياً.</div>
    </div>
    <div class="card">
      <h3>سجل ${isSales?'فواتير البيع':'فواتير الشراء'}</h3>
      <table class="table">
        <thead><tr><th>رقم</th><th>التاريخ</th><th>${isSales?'عميل':'مورد'}</th><th>مخزن</th><th>الإجمالي</th><th></th></tr></thead>
        <tbody id="inv-list-rows"></tbody>
      </table>
    </div>
  `;
  $('#inv-add-line').onclick = ()=> addInvLine(kind);
  $('#inv-save').onclick = ()=> saveInvoice(kind);
  $('#inv-print').onclick = ()=> printCurrentInvoice(kind);
  renderInvRows(kind);
  renderInvList(kind);
}
function addInvLine(kind, preset){
  const tbody = $('#inv-table tbody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="code" placeholder="كود"/></td>
    <td class="name"></td>
    <td><input class="qty" type="number" min="0" step="1" /></td>
    <td><input class="price" type="number" min="0" step="0.01"/></td>
    <td><input class="disc" type="number" min="0" step="0.01"/></td>
    <td><input class="tax" type="number" min="0" step="0.01" /></td>
    <td class="line-total">0</td>
    <td><button class="btn danger del">حذف</button></td>
  `;
  tbody.appendChild(tr);
  const [code, name, qty, price, disc, tax] = [$('.code',tr),$('.name',tr),$('.qty',tr),$('.price',tr),$('.disc',tr),$('.tax',tr)];
  [qty,price,disc,tax].forEach(bindEmptyZero);
  if(preset){
    code.value = preset.code; name.textContent = preset.name||''; price.value = preset.price||'';
  }
  code.addEventListener('change', ()=>{
    const it = db.items.find(i=>i.code===code.value.trim());
    if(it){ name.textContent = it.name||''; price.value = it.priceSell||it.priceBuy||''; }
    calcInvoiceTotals();
  });
  [qty,price,disc,tax].forEach(el=> el.addEventListener('input', calcInvoiceTotals));
  $('.del',tr).onclick = ()=>{ tr.remove(); calcInvoiceTotals(); };
}
function renderInvRows(kind){
  $('#inv-table tbody').innerHTML='';
  addInvLine(kind);
}
function calcInvoiceTotals(){
  let sub=0, discT=0, taxT=0;
  $$('#inv-table tbody tr').forEach(tr=>{
    const qty = +$('.qty',tr).value || 0;
    const price = +$('.price',tr).value || 0;
    const disc = +$('.disc',tr).value || 0;
    const taxP = +$('.tax',tr).value || 0;
    const line = Math.max(qty*price - disc, 0);
    const tax = line * (taxP/100);
    $('.line-total',tr).textContent = fmt(line + tax);
    sub += qty*price;
    discT += disc;
    taxT += tax;
  });
  $('#inv-sub').textContent = fmt(sub);
  $('#inv-disc').textContent = fmt(discT);
  $('#inv-tax').textContent = fmt(taxT);
  $('#inv-total').textContent = fmt(Math.max(sub - discT + taxT,0));
}
function saveInvoice(kind){
  const isSales = kind==='sales';
  const date = $('#inv-date').value || todayStr();
  const partnerId = $('#inv-partner').value;
  const wh = $('#inv-wh').value;
  const lines = $$('#inv-table tbody tr').map(tr=>{
    const code = $('.code',tr).value.trim();
    const it = db.items.find(i=>i.code===code);
    return {
      itemId: it?.id || null,
      code, name: it?.name || $('.name',tr).textContent || '',
      qty: +$('.qty',tr).value || 0,
      price: +$('.price',tr).value || 0,
      discount: +$('.disc',tr).value || 0,
      tax: +$('.tax',tr).value || 0
    };
  }).filter(l=>l.qty>0 && l.price>=0);
  calcInvoiceTotals();
  const total = unfmt($('#inv-total').textContent);
  const inv = {id:uid(isSales?'S':'P'), date, warehouseId:wh, lines, total, note:''};
  if(isSales){ inv.customerId = partnerId; db.invoices.sales.push(inv); }
  else { inv.supplierId = partnerId; db.invoices.purchases.push(inv); }
  // تحديث المخزون
  for(const l of lines){
    const it = db.items.find(i=>i.id===l.itemId || i.code===l.code);
    if(!it) continue;
    it.stock = it.stock||{};
    if(isSales){
      it.stock[wh] = (it.stock[wh]||0) - l.qty;
    }else{
      it.stock[wh] = (it.stock[wh]||0) + l.qty;
    }
  }
  saveDB();
  renderInvoiceList(kind);
  alert('تم حفظ الفاتورة');
}
function unfmt(s){
  // يحاول استخراج الرقم من نص منسّق
  return +String(s).replace(/[^\d\.\-]/g,'')||0;
}
function renderInvList(kind){
  const tbody = $('#inv-list-rows');
  tbody.innerHTML = '';
  db.invoices[kind].slice().reverse().forEach(inv=>{
    const part = (kind==='sales')? db.partners.customers.find(p=>p.id===inv.customerId) : db.partners.suppliers.find(p=>p.id===inv.supplierId);
    const wh = db.warehouses.find(w=>w.id===inv.warehouseId);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${inv.id}</td><td>${inv.date}</td><td>${part?.name||''}</td><td>${wh?.name||''}</td><td>${fmt(inv.total||0)}</td>
      <td><button class="btn" data-print="${inv.id}">طباعة</button></td>`;
    tbody.appendChild(tr);
  });
  tbody.onclick = e=>{
    const id = e.target.dataset.print;
    if(!id) return;
    const inv = db.invoices[kind].find(x=>x.id===id);
    printInvoice(inv, kind);
  };
}
function printCurrentInvoice(kind){
  // يجمع من النموذج الحالي مباشرة
  const wh = $('#inv-wh').value;
  const date = $('#inv-date').value || todayStr();
  const partnerId = $('#inv-partner').value;
  const isSales = kind==='sales';
  const lines = $$('#inv-table tbody tr').map(tr=> ({
    code: $('.code',tr).value.trim(),
    name: $('.name',tr).textContent,
    qty: +$('.qty',tr).value || 0,
    price: +$('.price',tr).value || 0,
    discount: +$('.disc',tr).value || 0,
    tax: +$('.tax',tr).value || 0,
  })).filter(l=>l.qty>0);
  const total = unfmt($('#inv-total').textContent);
  const inv = {id:'(غير محفوظ)', date, warehouseId:wh, lines, total, [isSales?'customerId':'supplierId']: partnerId};
  printInvoice(inv, kind);
}
function printInvoice(inv, kind){
  const company = db.settings.companyName || 'الشركة';
  const part = (kind==='sales')? db.partners.customers.find(p=>p.id===inv.customerId) : db.partners.suppliers.find(p=>p.id===inv.supplierId);
  const title = kind==='sales' ? 'فاتورة بيع' : 'فاتورة شراء';
  const rows = inv.lines.map(l=>`<tr>
    <td>${l.code||''}</td><td>${l.name||''}</td><td>${l.qty}</td><td>${fmt(l.price)}</td>
    <td>${fmt(l.discount||0)}</td><td>${l.tax||0}%</td><td>${fmt(Math.max(l.qty*l.price-(l.discount||0) + (l.qty*l.price-(l.discount||0))*(l.tax||0)/100,0))}</td>
  </tr>`).join('');
  const html = `
  <html dir="rtl"><head><meta charset="utf-8"><title>${title}</title>
  <style>@page{size:${db.settings.paperSize||'A4'};margin:12mm} body{font-family:Cairo,Tahoma,sans-serif}
    table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid #ddd;padding:6px;text-align:right}
    header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
    .muted{color:#666}
  </style></head><body>
    <header>
      <div><h2 style="margin:0">${title}</h2><div class="muted">${company}</div></div>
      <div>التاريخ: ${inv.date}<br/>الرقم: ${inv.id}</div>
    </header>
    <div>الطرف: ${(part?.name)||''}</div>
    <table><thead><tr><th>كود</th><th>اسم</th><th>كمية</th><th>سعر</th><th>خصم</th><th>ضريبة%</th><th>الإجمالي</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h3 style="text-align:left">الإجمالي: ${fmt(inv.total||0)}</h3>
    <div class="sign"><div>توقيع المستلم</div><div>توقيع المحاسب</div></div>
    <script>window.print()</script>
  </body></html>`;
  const w = window.open('','_blank'); w.document.write(html); w.document.close();
}

/* ====== الدفعات (من العملاء/إلى الموردين) ====== */
function renderPayments(){
  const custOpts = db.partners.customers.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const suppOpts = db.partners.suppliers.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  view.innerHTML = `
    <div class="card">
      <h3>إدارة الدفعات</h3>
      <div class="row-3">
        <div><label>التاريخ</label><input id="pay-date" type="date" value="${todayStr()}" /></div>
        <div><label>النوع</label><select id="pay-type"><option>عميل</option><option>مورد</option></select></div>
        <div><label>الجهة</label>
          <select id="pay-partner"></select>
        </div>
      </div>
      <div class="row">
        <div><label>المبلغ (₪)</label><input id="pay-amount" type="number" min="0" step="0.01" /></div>
        <div><label>ملاحظة</label><input id="pay-note" /></div>
      </div>
      <div class="actions"><button class="btn success" id="pay-save">حفظ الدفعة</button></div>
    </div>
    <div class="card">
      <h3>السجل</h3>
      <table class="table" id="pay-table">
        <thead><tr><th>التاريخ</th><th>النوع</th><th>الجهة</th><th>المبلغ</th><th>ملاحظة</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  `;
  const partnerSel = $('#pay-partner');
  function refreshPartnerOptions(){
    const type = $('#pay-type').value;
    partnerSel.innerHTML = (type==='عميل'? db.partners.customers : db.partners.suppliers)
      .map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  }
  $('#pay-type').onchange = refreshPartnerOptions; refreshPartnerOptions();
  bindEmptyZero($('#pay-amount'));
  $('#pay-save').onclick = ()=>{
    const date=$('#pay-date').value, type=$('#pay-type').value, partnerId=$('#pay-partner').value, amount= +$('#pay-amount').value || 0, note=$('#pay-note').value;
    db.payments.push({id:uid('py'),date,type,partnerId,amount,note});
    // أثر على الرصيد
    if(type==='عميل'){
      const c = db.partners.customers.find(p=>p.id===partnerId); if(c) c.balance = (c.balance||0) - amount;
    }else{
      const s = db.partners.suppliers.find(p=>p.id===partnerId); if(s) s.balance = (s.balance||0) + amount;
    }
    saveDB(); renderPayments();
  };
  const tbody = $('#pay-table tbody');
  db.payments.slice().reverse().forEach(p=>{
    const pr = (p.type==='عميل'? db.partners.customers : db.partners.suppliers).find(x=>x.id===p.partnerId);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.date}</td><td>${p.type}</td><td>${pr?.name||''}</td><td>${fmt(p.amount)}</td><td>${p.note||''}</td>`;
    tbody.appendChild(tr);
  });
}

/* ====== التقارير ====== */
function renderReports(){
  view.innerHTML = `
    <div class="card">
      <h3>تقارير</h3>
      <div class="row">
        <div>
          <label>من تاريخ</label><input id="r-from" type="date" />
        </div>
        <div>
          <label>إلى تاريخ</label><input id="r-to" type="date" />
        </div>
      </div>
      <div class="actions">
        <button class="btn" id="r-sales">تقرير المبيعات</button>
        <button class="btn" id="r-purchases">تقرير المشتريات</button>
        <button class="btn primary" id="r-profit">تقرير أرباح تفصيلي لكل صنف</button>
      </div>
    </div>
    <div class="card"><h3>النتيجة</h3><div id="r-out"></div></div>
  `;
  $('#r-sales').onclick = ()=> runReport('sales');
  $('#r-purchases').onclick = ()=> runReport('purchases');
  $('#r-profit').onclick = ()=> runProfitReport();
}
function inRange(d, from, to){
  if(from && d<from) return false;
  if(to && d>to) return false;
  return true;
}
function runReport(kind){
  const out = $('#r-out'); out.innerHTML='';
  const from=$('#r-from').value, to=$('#r-to').value;
  const rows = db.invoices[kind].filter(i=>inRange(i.date,from,to)).map(i=>`<tr><td>${i.id}</td><td>${i.date}</td><td>${fmt(i.total)}</td></tr>`).join('');
  out.innerHTML = `<table class="table"><thead><tr><th>رقم</th><th>تاريخ</th><th>إجمالي</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function runProfitReport(){
  const out = $('#r-out'); out.innerHTML='';
  const from=$('#r-from').value, to=$('#r-to').value;
  const map = {}; // code -> {name, soldQty, rev, cost}
  for(const inv of db.invoices.sales){
    if(!inRange(inv.date,from,to)) continue;
    for(const l of inv.lines){
      const it = db.items.find(i=>i.code===l.code);
      const key = l.code||it?.code;
      if(!key) continue;
      map[key] = map[key] || {name: it?.name||l.name||'', soldQty:0, rev:0, cost:0};
      const linePrice = Math.max(l.qty*l.price-(l.discount||0),0);
      const lineTax = linePrice*(l.tax||0)/100;
      map[key].soldQty += l.qty;
      map[key].rev += linePrice + lineTax;
      const cost = (it?.priceBuy||0) * l.qty;
      map[key].cost += cost;
    }
  }
  const rows = Object.entries(map).map(([code,v])=>{
    const profit = v.rev - v.cost;
    return `<tr><td>${code}</td><td>${v.name}</td><td>${v.soldQty}</td><td>${fmt(v.rev)}</td><td>${fmt(v.cost)}</td><td>${fmt(profit)}</td></tr>`;
  }).join('');
  out.innerHTML = `<table class="table"><thead><tr><th>كود</th><th>اسم</th><th>كمية مباعة</th><th>الإيراد</th><th>التكلفة</th><th>الربح</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ====== نسخ احتياطي/مزامنة (تصدير/استيراد JSON) ====== */
function renderBackup(){
  view.innerHTML = `
    <div class="card">
      <h3>نسخ احتياطي</h3>
      <div class="actions">
        <button class="btn primary" id="bk-export">تصدير ملف JSON</button>
        <input id="bk-file" type="file" accept="application/json" style="display:none" />
        <button class="btn" id="bk-import">استيراد ملف JSON</button>
      </div>
      <div class="help">للمزامنة عبر البريد، يمكنك تصدير الملف وإرساله عبر جيميل يدويًا. (يتطلب المزامنة التلقائية خادم OAuth خارجي).</div>
    </div>
  `;
  $('#bk-export').onclick = ()=>{
    const data = JSON.stringify(db, null, 2);
    const blob = new Blob([data],{type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  };
  $('#bk-import').onclick = ()=> $('#bk-file').click();
  $('#bk-file').onchange = e=>{
    const f = e.target.files[0]; if(!f) return;
    const r = new FileReader();
    r.onload = ()=>{ try{ db = JSON.parse(r.result); saveDB(); alert('تم الاستيراد'); location.reload(); }catch{ alert('ملف غير صالح'); } };
    r.readAsText(f);
  };
}

/* ====== إعدادات النظام والمستخدمين ====== */
function renderSettings(){
  view.innerHTML = `
    <div class="card">
      <h3>إعدادات عامة</h3>
      <div class="row-3">
        <div><label>اسم الشركة</label><input id="set-company" value="${db.settings.companyName||''}" /></div>
        <div><label>مقاس الورق للطباعة</label>
          <select id="set-paper"><option${db.settings.paperSize==='A4'?' selected':''}>A4</option><option${db.settings.paperSize==='A5'?' selected':''}>A5</option></select>
        </div>
        <div><label>نسبة ضريبة افتراضية %</label><input id="set-tax" type="number" step="0.01" value="${db.settings.taxPercent||0}" /></div>
      </div>
      <div class="actions">
        <button class="btn success" id="set-save">حفظ</button>
        <button class="btn danger" id="set-reset-stock">تصفير كميات المخزون</button>
      </div>
    </div>
    <div class="card">
      <h3>المخازن</h3>
      <div class="actions">
        <input id="wh-name" placeholder="اسم مخزن جديد"/>
        <button class="btn" id="wh-add">إضافة مخزن</button>
      </div>
      <ul id="wh-list"></ul>
    </div>
    <div class="card">
      <h3>المستخدمون وصلاحياتهم</h3>
      <div class="row-3">
        <div><label>اسم مستخدم</label><input id="u-username" /></div>
        <div><label>كلمة المرور</label><input id="u-pass" type="password" /></div>
        <div><label>الدور</label><input id="u-role" placeholder="مثال: محاسب"/></div>
      </div>
      <div class="actions">
        <label><input type="checkbox" id="perm-all" /> كل شيء</label>
        <label><input type="checkbox" id="perm-read" /> قراءة فقط</label>
        <label><input type="checkbox" id="perm-invoice" /> فاتورة</label>
        <label><input type="checkbox" id="perm-report" /> تقارير</label>
        <button class="btn success" id="u-add">إضافة مستخدم</button>
      </div>
      <table class="table">
        <thead><tr><th>مستخدم</th><th>دور</th><th>صلاحيات</th><th></th></tr></thead>
        <tbody id="u-rows"></tbody>
      </table>
    </div>
  `;
  bindEmptyZero($('#set-tax'));
  $('#set-save').onclick = ()=>{
    db.settings.companyName = $('#set-company').value||db.settings.companyName;
    db.settings.paperSize = $('#set-paper').value;
    db.settings.taxPercent = +$('#set-tax').value || 0;
    saveDB(); alert('تم الحفظ');
  };
  $('#set-reset-stock').onclick = ()=>{
    if(confirm('هل تريد تصفير كميات جميع الأصناف؟')){
      for(const it of db.items){ for(const k of Object.keys(it.stock||{})) it.stock[k]=0; }
      saveDB(); alert('تم التصفير');
    }
  };
  $('#wh-add').onclick = ()=>{
    const name = $('#wh-name').value.trim(); if(!name) return;
    db.warehouses.push({id:uid('w'), name}); saveDB(); renderSettings();
  };
  const ul = $('#wh-list'); ul.innerHTML='';
  db.warehouses.forEach(w=>{
    const li = document.createElement('li');
    li.innerHTML = `${w.name} <button class="btn danger" data-del="${w.id}">حذف</button>`;
    ul.appendChild(li);
  });
  ul.onclick = e=>{
    const id = e.target.dataset.del; if(!id) return;
    if(confirm('حذف المخزن؟')){ db.warehouses = db.warehouses.filter(w=>w.id!==id); saveDB(); renderSettings(); }
  };
  $('#u-add').onclick = ()=>{
    const username=$('#u-username').value.trim(); const password=$('#u-pass').value; const role=$('#u-role').value;
    if(!username || !password) return alert('أدخل اسم مستخدم وكلمة مرور');
    const perms = [];
    if($('#perm-all').checked) perms.push('كل شيء');
    if($('#perm-read').checked) perms.push('قراءة');
    if($('#perm-invoice').checked) perms.push('فاتورة');
    if($('#perm-report').checked) perms.push('تقارير');
    db.users.push({id:uid('u'), username, password, role, perms});
    saveDB(); renderSettings();
  };
  const tbody = $('#u-rows'); tbody.innerHTML='';
  db.users.forEach(u=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${u.username}</td><td>${u.role||''}</td><td>${(u.perms||[]).join(', ')}</td>
      <td>${u.username!=='admin'? '<button class="btn danger" data-del="'+u.id+'">حذف</button>':''}</td>`;
    tbody.appendChild(tr);
  });
  tbody.onclick = e=>{
    const id = e.target.dataset.del; if(!id) return;
    db.users = db.users.filter(u=>u.id!==id); saveDB(); renderSettings();
  };
}

/* تهيئة أولية للمدخلات كي لا تملأ بـ 0 */
window.addEventListener('input', e=>{
  if(e.target.matches('input[type="number"]')) bindEmptyZero(e.target);
});
/* بدء التطبيق على المسار الحالي */
route();
