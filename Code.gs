/**
 * Angerly Google Apps Script backend.
 * Persistent data is stored in a dedicated AngerlyData sheet as one JSON document per row.
 * Existing unrelated sheets and columns are not deleted or rewritten.
 */
const ANGERLY_CONFIG = {
  SPREADSHEET_ID: '1T8GTU6wO1aGHwu3cNCxla1qOc_KKxRR5hCSp4C1HOYE',
  DATA_SHEET: 'AngerlyData',
  LOG_SHEET: 'AngerlyNotificationLog',
  SENDER_EMAIL: 'csoguilon24-0063@cca.edu.ph',
  TIME_ZONE: 'Asia/Manila',
  APP_NAME: 'Angerly'
};

function doGet(e) {
  const action = String((e && e.parameter && e.parameter.action) || 'get').toLowerCase();
  if (action !== 'get') return output_({ok:false,error:'Unsupported GET action.'});
  let result;
  try { result = {ok:true,data:getAppData_()}; }
  catch (err) { result = {ok:false,error:safeError_(err)}; }
  const callback = e && e.parameter && e.parameter.callback;
  if (callback) {
    if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback)) return ContentService.createTextOutput('/* invalid callback */').setMimeType(ContentService.MimeType.JAVASCRIPT);
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(result).replace(/</g,'\\u003c') + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return output_(result);
}

function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents;
    if (!body || body.length > 500000) throw new Error('Missing or oversized request body.');
    const request = JSON.parse(body);
    const action = String(request.action || '').toLowerCase();
    if (action === 'save') return output_(saveAppData_(request.data, request.requestId));
    if (action === 'notify') return output_(sendTaskNotifications_(request.payload, request.requestId));
    throw new Error('Unsupported operation.');
  } catch (err) {
    return output_({ok:false,error:safeError_(err)});
  }
}

function getAppData_() {
  const ss = SpreadsheetApp.openById(ANGERLY_CONFIG.SPREADSHEET_ID);
  const sheet = getOrCreateSheet_(ss, ANGERLY_CONFIG.DATA_SHEET, ['Key','Value','UpdatedAt']);
  const rows = sheet.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) {
    if (rows[i][0] === 'appData' && rows[i][1]) {
      const data = JSON.parse(String(rows[i][1]));
      validateData_(data);
      data.spreadsheetUrl = ss.getUrl();
      return data;
    }
  }
  const initial = getSeedData_();
  writeData_(sheet, initial);
  initial.spreadsheetUrl = ss.getUrl();
  return initial;
}

function saveAppData_(data, requestId) {
  validateData_(data);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = SpreadsheetApp.openById(ANGERLY_CONFIG.SPREADSHEET_ID);
    const sheet = getOrCreateSheet_(ss, ANGERLY_CONFIG.DATA_SHEET, ['Key','Value','UpdatedAt']);
    const current = getStoredData_(sheet);
    // Merge by stable ID to avoid dropping records that another client added since this client loaded.
    const incomingById = new Map(data.tasks.map(t => [String(t.id), t]));
    const currentTasks = current && Array.isArray(current.tasks) ? current.tasks : [];
    const merged = Object.assign({}, current || {}, data);
    const mergedById = new Map(currentTasks.map(t => [String(t.id), t]));
    incomingById.forEach((task,id) => mergedById.set(id, task));
    merged.tasks = Array.from(mergedById.values());
    merged.members = mergeMembers_(current && current.members || [], data.members || []);
    merged.spreadsheetUrl = ss.getUrl();
    writeData_(sheet, merged);
    return {ok:true,message:'Changes saved to Google Sheets.',data:merged,requestId:String(requestId || '')};
  } finally { lock.releaseLock(); }
}

function sendTaskNotifications_(payload, requestId) {
  if (!payload || !Array.isArray(payload.members) || !payload.members.length) throw new Error('No recipients supplied.');
  const sender = Session.getEffectiveUser().getEmail();
  if (sender && sender.toLowerCase() !== ANGERLY_CONFIG.SENDER_EMAIL.toLowerCase()) {
    throw new Error('Apps Script is executing as ' + sender + ', not ' + ANGERLY_CONFIG.SENDER_EMAIL + '. Deploy and authorize the web app using the designated sender account.');
  }
  const ss = SpreadsheetApp.openById(ANGERLY_CONFIG.SPREADSHEET_ID);
  const log = getOrCreateSheet_(ss, ANGERLY_CONFIG.LOG_SHEET, ['EventKey','Timestamp','Recipient','Status','Details']);
  const eventKey = String(requestId || Utilities.getUuid());
  const prior = log.getDataRange().getValues().slice(1).some(r => String(r[0]) === eventKey);
  if (prior) return {ok:true,message:'This notification request was already processed; no duplicate email was sent.',duplicate:true};
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const exists = log.getDataRange().getValues().slice(1).some(r => String(r[0]) === eventKey);
    if (exists) return {ok:true,message:'This notification request was already processed; no duplicate email was sent.',duplicate:true};
    let sent=0, failed=0, rows=[];
    payload.members.forEach(member => {
      const email = String(member.email || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { failed++; rows.push([eventKey,new Date(),email,'REJECTED','Invalid email']); return; }
      const tasks = Array.isArray(member.tasks) ? member.tasks : [];
      const subject = 'Angerly | Chapter 1 task assignments — ' + String(member.name || 'Team member');
      const plain = buildPlainEmail_(member,tasks);
      const html = buildHtmlEmail_(member,tasks);
      try {
        MailApp.sendEmail({to:email,subject:subject,body:plain,htmlBody:html,name:ANGERLY_CONFIG.APP_NAME});
        sent++; rows.push([eventKey,new Date(),email,'SUBMITTED','MailApp accepted the send request']);
      } catch (err) { failed++; rows.push([eventKey,new Date(),email,'FAILED',safeError_(err)]); }
    });
    if (rows.length) log.getRange(log.getLastRow()+1,1,rows.length,5).setValues(rows);
    return {ok:true,message:'Email submission complete: '+sent+' submitted, '+failed+' failed. Submission does not confirm inbox delivery.',sent:sent,failed:failed,requestId:eventKey};
  } finally { lock.releaseLock(); }
}

function buildPlainEmail_(member,tasks) {
  const lines=['Hello '+member.name+',','','Here are your Chapter 1 task assignments:',''];
  tasks.forEach((t,i)=>{lines.push((i+1)+'. '+t.task,'   Status: '+(t.status||'Not started'),'   Deadline: '+(t.deadline||'Not set'),'   Document: '+(isValidDocUrl_(t.docUrl)?t.docUrl:'No document link attached'));if(t.instructions)lines.push('   Instructions: '+t.instructions);lines.push('');});
  lines.push('Please work on your assigned sections and keep your team updated.','','Angerly · Academic productivity, made clearer.');
  return lines.join('\n');
}
function buildHtmlEmail_(member,tasks) {
  const rows=tasks.map((t,i)=>'<tr><td style="padding:14px;border-bottom:1px solid #eee;color:#4a3034"><strong>'+(i+1)+'. '+escapeHtml_(t.task)+'</strong><br><span style="font-size:12px;color:#75676a">Status: '+escapeHtml_(t.status||'Not started')+' · Deadline: '+escapeHtml_(t.deadline||'Not set')+'</span>'+(t.instructions?'<p style="margin:8px 0 0">'+escapeHtml_(t.instructions)+'</p>':'')+(isValidDocUrl_(t.docUrl)?'<p style="margin:10px 0 0"><a href="'+escapeHtml_(t.docUrl)+'" style="display:inline-block;padding:9px 12px;background:#b71c1c;color:#fff;text-decoration:none;border-radius:5px;font-weight:bold">Open Task Document</a></p>':'<p style="font-size:12px;color:#75676a">No document link attached.</p>')+'</td></tr>').join('');
  const logo=''; // Inline embedding is omitted because a static local GIF cannot be reliably accessed by the Apps Script server.
  return '<div style="margin:0;padding:24px;background:#f7f2f3;font-family:Arial,Helvetica,sans-serif;color:#24191c"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #eadcde;border-radius:10px;overflow:hidden"><div style="padding:22px;background:#5d0a0a;color:#fff"><div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffc5c5">ANGERLY · TASK MANAGER</div><h1 style="margin:10px 0 0;font-size:23px">Chapter 1 task assignments</h1></div><div style="padding:22px"><p>Hello '+escapeHtml_(member.name)+',</p><p>Here are your current assigned tasks:</p><table role="presentation" style="width:100%;border-collapse:collapse">'+rows+'</table><p style="line-height:1.6">Please work on your assigned sections and keep your team updated.</p><p style="border-top:1px solid #eee;padding-top:15px;font-size:12px;color:#75676a">Angerly · Academic productivity, made clearer.</p></div></div></div>';
}
function isValidDocUrl_(url) { return /^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+(?:\/|$)/.test(String(url || '')); }
function validateData_(data) {
  if (!data || !Array.isArray(data.members) || !Array.isArray(data.tasks)) throw new Error('Invalid application data: members and tasks must be arrays.');
  const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const memberNames=new Set();
  data.members.forEach(m=>{
    if(!m || !String(m.name||'').trim()) throw new Error('Every member needs a name.');
    const key=String(m.name).trim().toLowerCase();
    if(memberNames.has(key)) throw new Error('Duplicate member name: '+m.name);
    memberNames.add(key);
    if(m.email && !emailPattern.test(String(m.email).trim())) throw new Error('Invalid email for '+m.name);
  });
  const ids=new Set();
  data.tasks.forEach(t=>{
    if(!t || !String(t.id||'').trim() || !String(t.member||'').trim() || !String(t.task||'').trim()) throw new Error('Every task must have an ID, assigned member, and title.');
    if(ids.has(String(t.id))) throw new Error('Duplicate task ID: '+t.id);
    ids.add(String(t.id));
    if(!memberNames.has(String(t.member).trim().toLowerCase())) throw new Error('Task assigned to unknown member: '+t.member);
    if(!['Not started','In progress','Completed'].includes(t.status)) throw new Error('Invalid status for '+t.task);
    if(t.email && !emailPattern.test(String(t.email).trim())) throw new Error('Invalid task email for '+t.task);
    if(t.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(String(t.deadline))) throw new Error('Invalid deadline for '+t.task);
    if(t.docUrl && !/^https:\/\/(docs\.google\.com|drive\.google\.com)\//.test(String(t.docUrl))) throw new Error('Task document links must use Google Docs or Drive HTTPS URLs.');
    if(String(t.task).length>200) throw new Error('Task title exceeds 200 characters.');
    if(String(t.instructions||'').length>5000) throw new Error('Task instructions exceed 5,000 characters.');
  });
}
function getStoredData_(sheet) { const rows=sheet.getDataRange().getValues();for(let i=1;i<rows.length;i++)if(rows[i][0]==='appData'&&rows[i][1])return JSON.parse(String(rows[i][1]));return null; }
function writeData_(sheet,data) {
  const rows=sheet.getDataRange().getValues();let row=0;
  for(let i=1;i<rows.length;i++)if(rows[i][0]==='appData'){row=i+1;break;}
  const values=[['appData',JSON.stringify(data),new Date()]];
  if(row)sheet.getRange(row,1,1,3).setValues(values);else sheet.getRange(Math.max(2,sheet.getLastRow()+1),1,1,3).setValues(values);
}
function getOrCreateSheet_(ss,name,headers) { let sheet=ss.getSheetByName(name);if(!sheet){sheet=ss.insertSheet(name);sheet.getRange(1,1,1,headers.length).setValues([headers]);sheet.setFrozenRows(1);}else if(sheet.getLastRow()===0){sheet.getRange(1,1,1,headers.length).setValues([headers]);sheet.setFrozenRows(1);}return sheet; }
function mergeMembers_(oldMembers,newMembers) { const map=new Map();oldMembers.forEach(m=>map.set(m.name,m));newMembers.forEach(m=>map.set(m.name,Object.assign({},map.get(m.name)||{},m)));return Array.from(map.values()); }
function output_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function safeError_(err) { return String(err && err.message || err || 'Unexpected error').slice(0,500); }
function escapeHtml_(value) { return String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function getSeedData_() { return SEED_DATA; }
const SEED_DATA = {
  "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/1T8GTU6wO1aGHwu3cNCxla1qOc_KKxRR5hCSp4C1HOYE/edit",
  "members": [
    {
      "name": "Carl Asnef B. Soguilon",
      "short": "Carl",
      "email": "csoguilon24-0063@cca.edu.ph"
    },
    {
      "name": "John Paul Recapor",
      "short": "John",
      "email": "jrecapor24-0115@cca.edu.ph"
    },
    {
      "name": "Roanne E. Fajardo",
      "short": "Roanne",
      "email": "rfajardo24-0114@cca.edu.ph"
    },
    {
      "name": "Austin Karl C. Garcia",
      "short": "Austin",
      "email": "agarcia24-0017@cca.edu.ph"
    },
    {
      "name": "Kariel Justine C. Ignacio",
      "short": "Kariel",
      "email": "kignacio24-0538@cca.edu.ph"
    }
  ],
  "tasks": [
    {
      "id": "carl-asnef-b-soguilon-statement-of-the-problem",
      "member": "Carl Asnef B. Soguilon",
      "task": "Statement of the Problem",
      "email": "csoguilon24-0063@cca.edu.ph",
      "docUrl": "https://docs.google.com/document/d/1kIUr1ZLMzOJchbf9ca_4Mk7b_xrXDhrR30BitR4wvso/edit?usp=sharing",
      "deadline": "2026-10-28",
      "status": "Completed",
      "instructions": "Do this for all titles"
    },
    {
      "id": "carl-asnef-b-soguilon-chapter-1-revisions-checker",
      "member": "Carl Asnef B. Soguilon",
      "task": "Chapter 1 Revisions/Checker",
      "email": "csoguilon24-0063@cca.edu.ph",
      "docUrl": "https://docs.google.com/document/d/1kIUr1ZLMzOJchbf9ca_4Mk7b_xrXDhrR30BitR4wvso/edit?usp=sharing",
      "deadline": "2026-10-28",
      "status": "In progress",
      "instructions": "Do this for all titles"
    },
    {
      "id": "john-paul-recapor-definition-of-terms",
      "member": "John Paul Recapor",
      "task": "Definition of Terms",
      "email": "jrecapor24-0115@cca.edu.ph",
      "docUrl": "https://docs.google.com/document/d/1kIUr1ZLMzOJchbf9ca_4Mk7b_xrXDhrR30BitR4wvso/edit?usp=sharing",
      "deadline": "2026-10-28",
      "status": "Not started",
      "instructions": "Do this for all titles"
    },
    {
      "id": "john-paul-recapor-significance-of-the-study",
      "member": "John Paul Recapor",
      "task": "Significance of the Study",
      "email": "jrecapor24-0115@cca.edu.ph",
      "docUrl": "https://docs.google.com/document/d/1kIUr1ZLMzOJchbf9ca_4Mk7b_xrXDhrR30BitR4wvso/edit?usp=sharing",
      "deadline": "2026-10-28",
      "status": "Not started",
      "instructions": "Do this for all titles"
    },
    {
      "id": "roanne-e-fajardo-background-of-the-study",
      "member": "Roanne E. Fajardo",
      "task": "Background of the Study",
      "email": "rfajardo24-0114@cca.edu.ph",
      "docUrl": "https://docs.google.com/document/d/1kIUr1ZLMzOJchbf9ca_4Mk7b_xrXDhrR30BitR4wvso/edit?usp=sharing",
      "deadline": "2026-10-28",
      "status": "Completed",
      "instructions": "Do this for all titles"
    },
    {
      "id": "roanne-e-fajardo-references",
      "member": "Roanne E. Fajardo",
      "task": "References",
      "email": "rfajardo24-0114@cca.edu.ph",
      "docUrl": "https://docs.google.com/document/d/1kIUr1ZLMzOJchbf9ca_4Mk7b_xrXDhrR30BitR4wvso/edit?usp=sharing",
      "deadline": "2026-10-28",
      "status": "In progress",
      "instructions": "Do this for all titles"
    },
    {
      "id": "austin-karl-c-garcia-objectives-of-the-study",
      "member": "Austin Karl C. Garcia",
      "task": "Objectives of the Study",
      "email": "agarcia24-0017@cca.edu.ph",
      "docUrl": "https://docs.google.com/document/d/1kIUr1ZLMzOJchbf9ca_4Mk7b_xrXDhrR30BitR4wvso/edit?usp=sharing",
      "deadline": "2026-10-28",
      "status": "Not started",
      "instructions": "Do this for all titles"
    },
    {
      "id": "austin-karl-c-garcia-conceptual-framework",
      "member": "Austin Karl C. Garcia",
      "task": "Conceptual Framework",
      "email": "agarcia24-0017@cca.edu.ph",
      "docUrl": "https://docs.google.com/document/d/1kIUr1ZLMzOJchbf9ca_4Mk7b_xrXDhrR30BitR4wvso/edit?usp=sharing",
      "deadline": "2026-10-28",
      "status": "Not started",
      "instructions": "Do this for all titles"
    },
    {
      "id": "kariel-justine-c-ignacio-scope-of-the-study",
      "member": "Kariel Justine C. Ignacio",
      "task": "Scope of the Study",
      "email": "kignacio24-0538@cca.edu.ph",
      "docUrl": "https://docs.google.com/document/d/1kIUr1ZLMzOJchbf9ca_4Mk7b_xrXDhrR30BitR4wvso/edit?usp=sharing",
      "deadline": "2026-10-28",
      "status": "Not started",
      "instructions": "Do this for all titles"
    },
    {
      "id": "kariel-justine-c-ignacio-delimitations-of-the-study",
      "member": "Kariel Justine C. Ignacio",
      "task": "Delimitations of the Study",
      "email": "kignacio24-0538@cca.edu.ph",
      "docUrl": "https://docs.google.com/document/d/1kIUr1ZLMzOJchbf9ca_4Mk7b_xrXDhrR30BitR4wvso/edit?usp=sharing",
      "deadline": "2026-10-28",
      "status": "Not started",
      "instructions": "Do this for all titles"
    }
  ]
};
