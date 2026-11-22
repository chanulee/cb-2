const $ = (selector) => document.querySelector(selector);

const previewNetworks = Object.freeze([
  Object.freeze({ ssid: 'Home 2.4G', rssi: -36, secure: true }),
  Object.freeze({ ssid: 'Studio 2.4G', rssi: -58, secure: true }),
  Object.freeze({ ssid: 'Guest', rssi: -72, secure: false }),
]);

const initialState = Object.freeze({
  view: 'springboard', phase: 'idle', prompt: '', promptIndex: 0,
  rotation: 0, brightness: 80, audioBytes: 0, error: '',
  networks: [], scanning: false, ssid: '', password: '', garden: '',
  wifiSaved: false, keyboardTarget: 'password', shift: false,
});

function typed(value, key, shift, maxLength) {
  if (key === 'backspace') return value.slice(0, -1);
  if (key === 'space') return `${value} `.slice(0, maxLength);
  const character = shift && /^[a-z]$/.test(key) ? key.toUpperCase() : key;
  return `${value}${character}`.slice(0, maxLength);
}

function previousView(view) {
  if (view === 'network-edit') return 'network-scan';
  if (view === 'network-scan') return 'settings';
  if (view === 'springboard') return 'springboard';
  return 'springboard';
}

function reduce(state, event) {
  switch (event.type) {
    case 'OPEN_POND': return { ...state, view: 'pond', phase: 'loading', error: '' };
    case 'OPEN_PARTICLES': return { ...state, view: 'particles', phase: 'idle', error: '' };
    case 'OPEN_SETTINGS': return { ...state, view: 'settings', phase: 'idle' };
    case 'OPEN_NETWORK': return { ...state, view: 'network-scan', phase: 'idle', scanning: true };
    case 'SCAN_START': return { ...state, scanning: true };
    case 'SCAN_RESULTS': return { ...state, scanning: false, networks: event.networks };
    case 'SELECT_AP': return { ...state, view: 'network-edit', ssid: event.ssid, password: '', keyboardTarget: 'password' };
    case 'BACK': return { ...state, view: previousView(state.view), phase: 'idle', error: '' };
    case 'PROMPT': return { ...state, view: 'pond', phase: 'wordstream', prompt: event.prompt, promptIndex: event.promptIndex, audioBytes: event.audioBytes || 0 };
    case 'WORDS_DONE': return { ...state, phase: 'listening' };
    case 'RECORDING': return { ...state, phase: 'recording' };
    case 'SENDING': return { ...state, phase: 'sending' };
    case 'ROTATE': return { ...state, rotation: event.rotation };
    case 'BRIGHTNESS': return { ...state, brightness: event.value };
    case 'KEYBOARD_TARGET': return { ...state, keyboardTarget: event.target };
    case 'SHIFT': return { ...state, shift: !state.shift };
    case 'KEY': {
      const maxLength = state.keyboardTarget === 'garden' ? 96 : 63;
      return { ...state, [state.keyboardTarget]: typed(state[state.keyboardTarget], event.key, state.shift, maxLength) };
    }
    case 'SAVE_WIFI': return state.ssid && state.garden
      ? { ...state, view: 'settings', wifiSaved: true }
      : state;
    case 'ERROR': return { ...state, phase: 'error', error: event.message };
    default: return state;
  }
}

let state = initialState;
let recorder;
let stream;
let chunks = [];
let wordRun = 0;
let scanRun = 0;

function dispatch(event) {
  state = Object.freeze(reduce(state, event));
  render(state);
}

function signal(rssi) {
  if (rssi > -50) return '●●●';
  if (rssi > -67) return '●●○';
  return '●○○';
}

function renderNetworks(current) {
  const list = $('#network-list');
  if (current.scanning && current.networks.length === 0) {
    list.replaceChildren(Object.assign(document.createElement('p'), { className: 'network-empty', textContent: 'Scanning nearby networks…' }));
    return;
  }
  const rows = current.networks.map((network) => {
    const button = document.createElement('button');
    button.type = 'button';
    const name = Object.assign(document.createElement('span'), { textContent: network.ssid });
    const detail = Object.assign(document.createElement('small'), { textContent: `${network.secure ? '🔒 ' : ''}${signal(network.rssi)}` });
    button.append(name, detail);
    button.addEventListener('click', () => dispatch({ type: 'SELECT_AP', ssid: network.ssid }));
    return button;
  });
  list.replaceChildren(...rows);
}

function render(current) {
  $('#springboard').hidden = current.view !== 'springboard';
  $('#pond-app').hidden = current.view !== 'pond';
  $('#particles-app').hidden = current.view !== 'particles';
  $('#settings').hidden = current.view !== 'settings';
  $('#network-scan').hidden = current.view !== 'network-scan';
  $('#network-edit').hidden = current.view !== 'network-edit';
  $('#screen-content').style.transform = `rotate(${current.rotation}deg)`;
  $('.screen').style.setProperty('--display-brightness', `${current.brightness}%`);
  $('#brightness').value = String(current.brightness);
  $('#brightness-output').textContent = `${current.brightness}%`;
  $('#network-summary').textContent = current.wifiSaved ? current.ssid : 'Choose a network';
  $('#ssid').value = current.ssid;
  $('#wifi-password').value = current.password;
  $('#garden-address').value = current.garden;
  $('#save-network').disabled = !(current.ssid && current.garden);
  document.querySelectorAll('[data-rotation]').forEach((button) => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.rotation) === current.rotation));
  });
  document.querySelectorAll('.credential-fields input').forEach((input) => input.classList.remove('active'));
  $(`#${current.keyboardTarget === 'garden' ? 'garden-address' : 'wifi-password'}`).classList.add('active');
  const shift = $('#keyboard [data-key="shift"]');
  if (shift) shift.setAttribute('aria-pressed', String(current.shift));
  $('#rescan').classList.toggle('scanning', current.scanning);
  $('#rescan').disabled = current.scanning;
  renderNetworks(current);
  $('#record').disabled = !['listening', 'recording'].includes(current.phase);
  $('#record').textContent = current.phase === 'recording' ? "I'm done" : 'Start speaking';
  $('#hint').textContent = ({ loading: 'finding Garden', wordstream: 'inner voice', listening: 'take the time I need', recording: 'listening', sending: 'thinking', error: current.error })[current.phase] || '';
  $('#result').textContent = current.audioBytes ? `${current.audioBytes} audio bytes reached Garden` : (current.error || 'Garden and Pond are idle.');
}

function scanNetworks() {
  const run = ++scanRun;
  dispatch({ type: 'SCAN_START' });
  setTimeout(() => {
    if (run === scanRun) dispatch({ type: 'SCAN_RESULTS', networks: previewNetworks });
  }, 550);
}

function pivotIndex(word) {
  if (word.length <= 1) return 0;
  if (word.length <= 5) return 1;
  if (word.length <= 9) return 2;
  return word.length <= 13 ? 3 : 4;
}

function showWord(word) {
  const index = pivotIndex(word);
  const focus = document.createElement('b');
  focus.textContent = word[index] || '';
  const label = $('#word');
  label.replaceChildren(word.slice(0, index), focus, word.slice(index + 1));
  let size = 58;
  label.style.fontSize = `${size}px`;
  while (label.scrollWidth > label.clientWidth && size > 18) {
    size -= 2;
    label.style.fontSize = `${size}px`;
  }
}

function makeParticles(count, width, height) {
  return Array.from({ length: count }, (_, index) => ({
    x: ((index * 83) % 97) / 97 * width,
    y: ((index * 47) % 89) / 89 * height,
    vx: Math.sin(index * 2.3) * 0.34,
    vy: Math.cos(index * 1.7) * 0.34,
    hue: 166 + (index * 11) % 65,
  }));
}

function stepParticle(particle, input, bounds) {
  const dx = particle.x - input.x;
  const dy = particle.y - input.y;
  const distance2 = Math.max(dx * dx + dy * dy, 36);
  const touchForce = input.touching && distance2 < 9500 ? 34 / distance2 : 0;
  const energy = 1 + input.mic * 2.8;
  const vx = (particle.vx + dx * touchForce) * 0.994;
  const vy = (particle.vy + dy * touchForce) * 0.994;
  return {
    ...particle,
    x: (particle.x + vx * energy + bounds.width) % bounds.width,
    y: (particle.y + vy * energy + bounds.height) % bounds.height,
    vx, vy,
  };
}

function stepParticles(particles, input, bounds) {
  return particles.map((particle) => stepParticle(particle, input, bounds));
}

let particles = [];
let particleFrame = 0;
let particleInput = { x: 233, y: 233, touching: false, mic: 0 };
let particleStream;
let particleAudioContext;
let particleAnalyser;

function drawParticles(context, items, mic) {
  context.fillStyle = 'rgba(5, 7, 7, .2)';
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  items.forEach((particle) => {
    context.beginPath();
    context.fillStyle = `hsla(${particle.hue}, 75%, 72%, ${0.4 + mic * 0.6})`;
    context.arc(particle.x, particle.y, 1.4 + mic * 4.5, 0, Math.PI * 2);
    context.fill();
  });
}

function microphoneLevel() {
  if (!particleAnalyser) return 0;
  const samples = new Uint8Array(particleAnalyser.frequencyBinCount);
  particleAnalyser.getByteFrequencyData(samples);
  return samples.reduce((sum, value) => sum + value, 0) / samples.length / 255;
}

function runParticles() {
  if (state.view !== 'particles') return;
  const canvas = $('#particles');
  const context = canvas.getContext('2d');
  particleInput = { ...particleInput, mic: microphoneLevel() };
  particles = stepParticles(particles, particleInput, { width: canvas.width, height: canvas.height });
  drawParticles(context, particles, particleInput.mic);
  particleFrame = setTimeout(runParticles, 33);
}

function startParticles() {
  clearTimeout(particleFrame);
  particles = makeParticles(72, 466, 466);
  runParticles();
}

async function enableParticleMic() {
  particleStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  particleAudioContext = new AudioContext();
  particleAnalyser = particleAudioContext.createAnalyser();
  particleAnalyser.fftSize = 256;
  particleAudioContext.createMediaStreamSource(particleStream).connect(particleAnalyser);
  $('#particle-mic').textContent = 'Mic active';
  $('#particle-mic').disabled = true;
}

function stopParticles() {
  clearTimeout(particleFrame);
  particleStream?.getTracks().forEach((track) => track.stop());
  particleAudioContext?.close();
  particleStream = undefined;
  particleAudioContext = undefined;
  particleAnalyser = undefined;
  $('#particle-mic').textContent = 'Enable mic';
  $('#particle-mic').disabled = false;
}

async function playWordstream(text) {
  const run = ++wordRun;
  const words = text.trim().split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (run !== wordRun) return;
    showWord(word);
    const wait = 60000 / 270 * (/[.!?]["']?$/.test(word) ? 1.65 : 1);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  if (run === wordRun) {
    $('#word').textContent = '';
    dispatch({ type: 'WORDS_DONE' });
  }
}

async function openPond() {
  dispatch({ type: 'OPEN_POND' });
  try {
    const response = await fetch('/api/start');
    if (!response.ok) throw new Error(`Garden returned ${response.status}`);
    const turn = await response.json();
    dispatch({ type: 'PROMPT', prompt: turn.prompt, promptIndex: turn.prompt_index });
    playWordstream(turn.prompt);
  } catch (error) {
    dispatch({ type: 'ERROR', message: error.message });
  }
}

async function startRecording() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.start();
  dispatch({ type: 'RECORDING' });
}

function recordedBlob() {
  return new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
    recorder.stop();
  });
}

async function finishTurn() {
  dispatch({ type: 'SENDING' });
  const audio = await recordedBlob();
  stream.getTracks().forEach((track) => track.stop());
  const response = await fetch('/api/turn', {
    method: 'POST',
    headers: {
      'Content-Type': audio.type,
      'X-Prompt-Index': String(state.promptIndex),
      'X-Debug-Transcript': encodeURIComponent($('#transcript').value),
    },
    body: audio,
  });
  if (!response.ok) throw new Error(`Garden returned ${response.status}`);
  const turn = await response.json();
  dispatch({ type: 'PROMPT', prompt: turn.prompt, promptIndex: turn.prompt_index, audioBytes: turn.audio_bytes });
  playWordstream(turn.prompt);
}

function goBack() {
  if (state.phase === 'recording' || state.view === 'springboard') return;
  wordRun += 1;
  if (state.view === 'particles') stopParticles();
  dispatch({ type: 'BACK' });
}

$('#open-pond').addEventListener('click', openPond);
$('#open-particles').addEventListener('click', () => { dispatch({ type: 'OPEN_PARTICLES' }); startParticles(); });
$('#open-settings').addEventListener('click', () => dispatch({ type: 'OPEN_SETTINGS' }));
$('#open-network').addEventListener('click', () => { dispatch({ type: 'OPEN_NETWORK' }); scanNetworks(); });
$('#rescan').addEventListener('click', scanNetworks);
$('#brightness').addEventListener('input', (event) => dispatch({ type: 'BRIGHTNESS', value: Number(event.target.value) }));
document.querySelectorAll('[data-rotation]').forEach((button) => {
  button.addEventListener('click', () => dispatch({ type: 'ROTATE', rotation: Number(button.dataset.rotation) }));
});
['wifi-password', 'garden-address'].forEach((id) => $(`#${id}`).addEventListener('focus', () => {
  dispatch({ type: 'KEYBOARD_TARGET', target: id === 'garden-address' ? 'garden' : 'password' });
}));
$('#save-network').addEventListener('click', () => dispatch({ type: 'SAVE_WIFI' }));
$('#record').addEventListener('click', async () => {
  try { state.phase === 'recording' ? await finishTurn() : await startRecording(); }
  catch (error) { dispatch({ type: 'ERROR', message: error.message }); }
});
$('#particle-mic').addEventListener('click', async () => {
  try { await enableParticleMic(); }
  catch (error) { dispatch({ type: 'ERROR', message: error.message }); }
});

function particlePointer(event, touching) {
  const rect = $('#particles').getBoundingClientRect();
  particleInput = {
    ...particleInput,
    x: (event.clientX - rect.left) * 466 / rect.width,
    y: (event.clientY - rect.top) * 466 / rect.height,
    touching,
  };
}
$('#particles').addEventListener('pointerdown', (event) => particlePointer(event, true));
$('#particles').addEventListener('pointermove', (event) => { if (particleInput.touching) particlePointer(event, true); });
['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => {
  $('#particles').addEventListener(type, (event) => particlePointer(event, false));
});

const keyRows = Object.freeze([
  Object.freeze([...'1234567890']),
  Object.freeze([...'qwertyuiop']),
  Object.freeze([...'asdfghjkl']),
  Object.freeze(['shift', ...'zxcvbnm', 'backspace']),
  Object.freeze(['-', '_', '.', '@', 'space', '!', '#']),
]);
keyRows.forEach((keys) => {
  const row = Object.assign(document.createElement('div'), { className: 'key-row' });
  keys.forEach((key) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = ({ shift: '⇧', space: 'space', backspace: '⌫' })[key] || key;
    button.dataset.key = key;
    button.addEventListener('click', () => dispatch({ type: key === 'shift' ? 'SHIFT' : 'KEY', key }));
    row.append(button);
  });
  $('#keyboard').append(row);
});

let gestureStart = null;
$('#screen-content').addEventListener('pointerdown', (event) => {
  gestureStart = { x: event.clientX, y: event.clientY };
});
$('#screen-content').addEventListener('pointerup', (event) => {
  if (!gestureStart) return;
  const dx = event.clientX - gestureStart.x;
  const dy = Math.abs(event.clientY - gestureStart.y);
  gestureStart = null;
  if (dx > 70 && dy < dx * 0.65) goBack();
});
$('#screen-content').addEventListener('pointercancel', () => { gestureStart = null; });

render(state);
