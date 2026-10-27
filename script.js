'use strict';

const $ = (id) => document.getElementById(id);
const STORAGE = {caregivers:'smartcane_caregivers_v1', settings:'smartcane_settings_v1', events:'smartcane_events_v1'};
let cameraStream = null;
let model = null;
let scanning = false;
let scanTimer = null;
let lastSpoken = '';
let lastPosition = null;
let toastTimer = null;
let settings = {speechEnabled:true, speechRate:1, vibrationIntensity:2, largeText:false, highContrast:false};
let caregivers = [];

function safeRead(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (_) { return fallback; }
}
function safeWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (_) { showToast('Could not save data in this browser.'); return false; }
}
function showToast(message) {
  const toast = $('toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3400);
}
function speak(text) {
  lastSpoken = text;
  if (!settings.speechEnabled) { showToast(text); return; }
  if (!('speechSynthesis' in window)) { showToast('Speech is not supported in this browser.'); return; }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = Number(settings.speechRate) || 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}
function vibrate(level = 'caution') {
  if (!navigator.vibrate) return;
  const intensity = Number(settings.vibrationIntensity) || 2;
  const patterns = {
    danger: [180, 70, 180, 70, 240],
    caution: [100, 70, 100],
    awareness: [70]
  };
  const pattern = patterns[level] || patterns.caution;
  navigator.vibrate(pattern.map((n, i) => i % 2 === 0 ? Math.round(n * intensity / 2) : n));
}
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => {
    const active = p.id === `page-${page}`;
    p.classList.toggle('active', active); p.hidden = !active;
  });
  document.querySelectorAll('.nav-item').forEach(b => {
    const active = b.dataset.page === page;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
  $('main').focus({preventScroll:true});
  window.scrollTo({top:0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
}
document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => navigateTo(b.dataset.page)));
document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => navigateTo(b.dataset.goto)));
$('todayDate').textContent = new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'});
$('speakWelcome').addEventListener('click', () => speak('Welcome to AI SmartCane Assist. Use the navigation to explore obstacle detection, route planning, caregiver contacts and accessibility settings.'));
$('footerHelp').addEventListener('click', () => speak('Safety reminder. This website is a prototype and must not be used as your only mobility aid. Always use your usual mobility aid and stay aware of your surroundings.'));
$('speakNavigationTip').addEventListener('click', () => speak('Before walking, confirm your route. Keep ambient sounds audible and use your usual mobility aid. This website does not replace orientation and mobility training.'));

function levelForClass(className, score) {
  const dangerous = ['car','truck','bus','motorcycle','bicycle'];
  if (dangerous.includes(className) && score > .65) return 'caution';
  if (score > .78) return 'caution';
  return 'awareness';
}
function cueForClass(className) {
  const cues = {
    car:'Vehicle ahead', truck:'Vehicle ahead', bus:'Vehicle ahead', motorcycle:'Vehicle ahead',
    bicycle:'Bicycle ahead', person:'Person ahead', chair:'Object ahead', bench:'Object ahead',
    dog:'Animal ahead', pottedplant:'Object ahead', stop_sign:'Sign ahead'
  };
  return cues[className] || `${className.replaceAll('_',' ')} detected`;
}
function announceDetection(item) {
  const level = item.level;
  const cue = cueForClass(item.className);
  $('feedbackText').textContent = `${level.toUpperCase()}: ${cue}. Confidence ${Math.round(item.score*100)} percent.`;
  speak(`${level === 'danger' ? 'Danger. ' : level === 'caution' ? 'Caution. ' : ''}${cue}`);
  vibrate(level);
  const events = safeRead(STORAGE.events, []);
  events.unshift({className:item.className, score:item.score, level, time:Date.now()});
  safeWrite(STORAGE.events, events.slice(0,30));
}
function renderResults(items) {
  $('detectionCount').textContent = items.length;
  const root = $('detectionResults'); root.replaceChildren();
  if (!items.length) { root.innerHTML = '<div class="empty-state">No supported objects detected in this frame.</div>'; return; }
  items.slice(0,8).forEach(item => {
    const row = document.createElement('div'); row.className = 'result-item';
    const color = document.createElement('span'); color.className = `result-color ${item.level}`;
    const copy = document.createElement('div'); copy.className = 'result-copy';
    const title = document.createElement('b'); title.textContent = item.className.replaceAll('_',' ');
    const desc = document.createElement('small'); desc.textContent = item.level === 'danger' ? 'High alert' : item.level === 'caution' ? 'Caution alert' : 'Awareness alert';
    copy.append(title,desc);
    const confidence = document.createElement('span'); confidence.className = 'confidence'; confidence.textContent = `${Math.round(item.score*100)}%`;
    row.append(color,copy,confidence); root.append(row);
  });
}
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Camera access is not available. Open the site on localhost or HTTPS in a supported browser.'); return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}, audio:false});
    $('cameraVideo').srcObject = cameraStream;
    await $('cameraVideo').play();
    $('cameraPlaceholder').hidden = true;
    $('cameraStatus').textContent = 'Camera active';
    $('startCamera').disabled = true; $('stopCamera').disabled = false;
    $('systemStatus').textContent = 'Camera active';
    showToast('Camera started. Keep the phone still while testing.');
    if (window.cocoSsd) {
      try {
        $('feedbackText').textContent = 'Loading the browser object-detection model…';
        model = await cocoSsd.load();
        scanning = true;
        runDetectionLoop();
      } catch (e) {
        $('feedbackText').textContent = 'Model could not load. You can still try a demo alert.';
        showToast('AI model did not load. Check your internet connection.');
      }
    } else {
      $('feedbackText').textContent = 'AI model library is unavailable. Try a demo alert.';
    }
  } catch (error) {
    showToast(error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in browser settings.' : 'Unable to start camera. Check device permissions and try again.');
  }
}
async function runDetectionLoop() {
  if (!scanning || !model || !$('cameraVideo').videoWidth) {
    if (scanning) scanTimer = setTimeout(runDetectionLoop, 700);
    return;
  }
  try {
    const video = $('cameraVideo');
    const predictions = await model.detect(video);
    const canvas = $('detectionCanvas');
    const rect = video.getBoundingClientRect();
    const vw = video.videoWidth, vh = video.videoHeight;
    canvas.width = vw; canvas.height = vh;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,vw,vh);
    const items = predictions.filter(p => p.score >= .55).map(p => ({
      className:p.class, score:p.score, bbox:p.bbox, level:levelForClass(p.class,p.score)
    }));
    items.forEach(item => {
      const [x,y,w,h] = item.bbox;
      ctx.strokeStyle = item.level === 'danger' ? '#f05260' : item.level === 'caution' ? '#ffc14d' : '#51d6aa';
      ctx.lineWidth = Math.max(3, vw/240); ctx.strokeRect(x,y,w,h);
      ctx.fillStyle = ctx.strokeStyle; ctx.font = `bold ${Math.max(16,vw/45)}px sans-serif`;
      ctx.fillText(`${item.className} ${Math.round(item.score*100)}%`, x, Math.max(22,y-7));
    });
    renderResults(items);
    if (items.length) {
      const now = Date.now();
      const priority = [...items].sort((a,b) => (b.bbox[2]*b.bbox[3]*b.score)-(a.bbox[2]*a.bbox[3]*a.score))[0];
      const signature = `${priority.className}-${priority.level}`;
      if (signature !== window.lastDetectionSignature || now - (window.lastDetectionAt||0) > 6000) {
        window.lastDetectionSignature = signature; window.lastDetectionAt = now;
        announceDetection(priority);
      }
    } else if (Date.now() - (window.lastDetectionAt||0) > 8000) {
      $('feedbackText').textContent = 'No supported objects detected in the latest frame.';
    }
  } catch (e) { /* A temporary frame error should not crash the page. */ }
  scanTimer = setTimeout(runDetectionLoop, 700);
}
function stopCamera() {
  scanning = false; clearTimeout(scanTimer);
  if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
  cameraStream = null; $('cameraVideo').srcObject = null;
  $('cameraPlaceholder').hidden = false;
  const ctx = $('detectionCanvas').getContext('2d'); ctx.clearRect(0,0,$('detectionCanvas').width,$('detectionCanvas').height);
  $('cameraStatus').textContent = 'Camera off'; $('startCamera').disabled = false; $('stopCamera').disabled = true;
  $('systemStatus').textContent = 'Browser demo ready';
}
$('startCamera').addEventListener('click', startCamera);
$('stopCamera').addEventListener('click', stopCamera);
window.addEventListener('beforeunload', stopCamera);
$('scanDemo').addEventListener('click', () => {
  const demos = [
    {className:'vehicle',score:.91,level:'caution'},
    {className:'person',score:.87,level:'awareness'},
    {className:'ground hazard',score:.95,level:'danger'}
  ];
  const item = demos[Math.floor(Math.random()*demos.length)];
  renderResults([item]); announceDetection(item);
  showToast('Demo alert only — this is not a real camera detection.');
});
$('repeatFeedback').addEventListener('click', () => lastSpoken ? speak(lastSpoken) : showToast('There is no alert to repeat yet.'));

$('routeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const destination = $('destination').value.trim();
  if (!destination) return;
  const mode = $('travelMode').value;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=${encodeURIComponent(mode)}`;
  window.open(url,'_blank','noopener,noreferrer');
  speak(`Opening directions to ${destination}. Please confirm your route before moving.`);
});
$('voiceDestination').addEventListener('click', () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $('voiceStatus').textContent = 'Voice recognition is not supported in this browser. Type your destination instead.'; return; }
  const recognition = new SR(); recognition.lang = navigator.language || 'en-IN'; recognition.interimResults = false; recognition.maxAlternatives = 1;
  $('voiceStatus').textContent = 'Listening. Say your destination now.';
  recognition.onresult = event => { $('destination').value = event.results[0][0].transcript; $('voiceStatus').textContent = `Heard: ${event.results[0][0].transcript}`; speak(`Destination entered: ${event.results[0][0].transcript}`); };
  recognition.onerror = () => { $('voiceStatus').textContent = 'Could not recognise speech. Please type your destination.'; };
  recognition.onend = () => { if ($('voiceStatus').textContent.startsWith('Listening')) $('voiceStatus').textContent = 'Voice input ended.'; };
  try { recognition.start(); } catch (_) { $('voiceStatus').textContent = 'Unable to start microphone. Please type your destination.'; }
});

function renderCaregivers() {
  const root = $('caregiverList'); root.replaceChildren();
  $('caregiverCount').textContent = `${caregivers.length} trusted contact${caregivers.length===1?'':'s'}`;
  if (!caregivers.length) { root.innerHTML = '<div class="empty-state">No contacts added yet.</div>'; return; }
  caregivers.forEach(person => {
    const row = document.createElement('div'); row.className = 'caregiver-item';
    const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = person.name.trim().charAt(0).toUpperCase();
    const info = document.createElement('div'); info.className = 'caregiver-info';
    const name = document.createElement('b'); name.textContent = person.name;
    const detail = document.createElement('small'); detail.textContent = [person.relation,person.phone].filter(Boolean).join(' · ');
    info.append(name,detail);
    const del = document.createElement('button'); del.className = 'delete-contact'; del.type = 'button'; del.textContent = 'Remove'; del.setAttribute('aria-label',`Remove ${person.name}`);
    del.addEventListener('click', () => { if (confirm(`Remove ${person.name} from caregiver contacts?`)) { caregivers = caregivers.filter(p => p.id !== person.id); safeWrite(STORAGE.caregivers,caregivers); renderCaregivers(); showToast('Caregiver removed.'); } });
    row.append(avatar,info,del); root.append(row);
  });
}
$('caregiverForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('caregiverName').value.trim(), relation = $('caregiverRelation').value.trim(), phone = $('caregiverPhone').value.trim();
  if (!name || !phone) { showToast('Enter a name and phone number.'); return; }
  caregivers.push({id:crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),name,relation,phone});
  safeWrite(STORAGE.caregivers,caregivers); renderCaregivers(); e.target.reset(); showToast('Caregiver saved in this browser.');
});
function openSosDialog() {
  const select = $('sosContact'); select.replaceChildren();
  if (!caregivers.length) {
    const opt = document.createElement('option'); opt.value=''; opt.textContent='No saved caregiver — add one first'; select.append(opt);
  } else caregivers.forEach(p => {
    const opt = document.createElement('option'); opt.value=p.id; opt.textContent=`${p.name} (${p.phone})`; select.append(opt);
  });
  $('locationStatus').textContent = 'Location has not been requested.';
  $('sosMessage').value = 'I may need assistance. Please contact me.';
  $('sosDialog').showModal();
}
$('openSOS').addEventListener('click',openSosDialog);
$('getLocation').addEventListener('click', () => {
  if (!navigator.geolocation) { $('locationStatus').textContent='Location is not supported by this browser.'; return; }
  $('locationStatus').textContent='Requesting location permission…';
  navigator.geolocation.getCurrentPosition(pos => {
    lastPosition = {lat:pos.coords.latitude,lon:pos.coords.longitude};
    const link = `https://maps.google.com/?q=${lastPosition.lat},${lastPosition.lon}`;
    $('locationStatus').textContent=`Location ready: ${lastPosition.lat.toFixed(5)}, ${lastPosition.lon.toFixed(5)}`;
    $('sosMessage').value=`SOS: I may need assistance. My current location: ${link}`;
    speak('Location ready for the emergency message. Please review it before sending.');
  }, err => {
    $('locationStatus').textContent=err.code===1?'Location permission denied. You can still prepare a message without location.':'Could not get location. Check GPS and try again.';
  },{enableHighAccuracy:true,timeout:12000,maximumAge:10000});
});
$('sendSOS').addEventListener('click', () => {
  const person = caregivers.find(p => p.id === $('sosContact').value);
  if (!person) { showToast('Add a caregiver before preparing an SOS message.'); return; }
  const body = $('sosMessage').value.trim();
  if (!body) { showToast('Enter an emergency message first.'); return; }
  const smsUrl = `sms:${person.phone}?body=${encodeURIComponent(body)}`;
  $('sosDialog').close();
  window.location.href = smsUrl;
  showToast('Messaging app opened if supported. Review and send the message yourself.');
  speak('Your messaging app is opening. Confirm the recipient and send the message if appropriate.');
});

function applySettings() {
  document.body.classList.toggle('large-text',!!settings.largeText);
  document.body.classList.toggle('high-contrast',!!settings.highContrast);
  $('speechEnabled').checked=!!settings.speechEnabled;
  $('speechRate').value=Number(settings.speechRate)||1;
  $('speechRateValue').textContent=`${(Number(settings.speechRate)||1).toFixed(1)}×`;
  $('vibrationIntensity').value=Number(settings.vibrationIntensity)||2;
  $('vibrationValue').textContent=({1:'Low',2:'Medium',3:'High'})[settings.vibrationIntensity]||'Medium';
  $('largeText').checked=!!settings.largeText; $('highContrast').checked=!!settings.highContrast;
}
function readSettingsForm() {
  settings = {
    speechEnabled:$('speechEnabled').checked,
    speechRate:Number($('speechRate').value),
    vibrationIntensity:Number($('vibrationIntensity').value),
    largeText:$('largeText').checked,
    highContrast:$('highContrast').checked
  };
}
$('speechRate').addEventListener('input', () => $('speechRateValue').textContent=`${Number($('speechRate').value).toFixed(1)}×`);
$('vibrationIntensity').addEventListener('input', () => $('vibrationValue').textContent=({1:'Low',2:'Medium',3:'High'})[$('vibrationIntensity').value]);
$('saveSettings').addEventListener('click', () => { readSettingsForm(); safeWrite(STORAGE.settings,settings); applySettings(); $('settingsStatus').textContent='Settings saved in this browser.'; showToast('Accessibility settings saved.'); });
$('testSpeech').addEventListener('click', () => { readSettingsForm(); speak('This is a SmartCane Assist accessibility test alert. Please remain aware of your surroundings.'); vibrate('caution'); });
$('speechSupport').textContent = ('speechSynthesis' in window) ? 'Text-to-speech available in this browser' : 'Text-to-speech not supported in this browser';

caregivers = safeRead(STORAGE.caregivers,[]);
settings = {...settings,...safeRead(STORAGE.settings,{})};
renderCaregivers();
applySettings();
