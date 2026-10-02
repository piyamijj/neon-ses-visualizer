(function () {
  'use strict';

  const canvas = document.getElementById('visualizer');
  const ctx = canvas.getContext('2d');
  const audio = document.getElementById('audio');
  const fileInput = document.getElementById('fileInput');
  const playBtn = document.getElementById('playBtn');
  const micBtn = document.getElementById('micBtn');
  const seek = document.getElementById('seek');
  const volume = document.getElementById('volume');
  const sensitivityEl = document.getElementById('sensitivity');
  const currentTimeEl = document.getElementById('currentTime');
  const durationEl = document.getElementById('duration');
  const trackTitle = document.getElementById('trackTitle');
  const trackSub = document.getElementById('trackSub');
  const statusDot = document.getElementById('statusDot');
  const progressWrap = document.getElementById('progressWrap');
  const dropOverlay = document.getElementById('dropOverlay');
  const toastEl = document.getElementById('toast');
  const modeBtns = document.querySelectorAll('.mode-btn');

  let W = 0, H = 0, dpr = 1;
  let audioCtx = null, analyser = null, gainNode = null;
  let mediaSource = null, micSource = null, micStream = null;
  let freqData = new Uint8Array(1024);
  let timeData = new Uint8Array(2048);
  let mode = 'both';
  let sensitivity = 1;
  let rotation = 0;
  let smoothBass = 0;
  let currentUrl = null;
  let hasFile = false;
  let lastTitle = '';
  let lastSub = '';
  let seeking = false;
  const particles = [];

  // ---------- Canvas ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05010f';
    ctx.fillRect(0, 0, W, H);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Yardımcılar ----------
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { toastEl.classList.remove('show'); }, 3500);
  }

  function fmt(s) {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function updateRangeFill(el) {
    const min = parseFloat(el.min) || 0;
    const max = parseFloat(el.max) || 100;
    const p = ((parseFloat(el.value) - min) / (max - min || 1)) * 100;
    el.style.setProperty('--p', p + '%');
  }

  function setStatus(type, title, sub) {
    statusDot.className = 'status-dot' + (type !== 'none' ? ' ' + type : '');
    trackTitle.textContent = title;
    trackSub.textContent = sub;
  }

  function safeDisconnect(node) {
    if (!node) return;
    try { node.disconnect(); } catch (e) { /* zaten bağlı değil */ }
  }

  // ---------- Web Audio ----------
  function initAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        showToast('Tarayıcınız Web Audio API desteklemiyor.');
        return false;
      }
      audioCtx = new AC();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.82;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      gainNode = audioCtx.createGain();
      gainNode.gain.value = parseFloat(volume.value);
      gainNode.connect(audioCtx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
      timeData = new Uint8Array(analyser.fftSize);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return true;
  }

  function routeFile() {
    safeDisconnect(micSource);
    safeDisconnect(analyser);
    if (!mediaSource) mediaSource = audioCtx.createMediaElementSource(audio);
    safeDisconnect(mediaSource);
    mediaSource.connect(analyser);
    analyser.connect(gainNode);
  }

  function routeMic() {
    // Mikrofon hoparlöre bağlanmaz (geri besleme olmasın diye)
    safeDisconnect(mediaSource);
    safeDisconnect(analyser);
    micSource.connect(analyser);
  }

  // ---------- Dosya ----------
  function loadFile(file) {
    if (!file) return;
    const lower = file.name.toLowerCase();
    const isAudio = (file.type && file.type.indexOf('audio') === 0) || lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.ogg') || lower.endsWith('.m4a');
    if (!isAudio) {
      showToast('Lütfen geçerli bir ses dosyası (MP3) seçin.');
      return;
    }
    if (!initAudio()) return;
    if (micStream) stopMic(true);
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(file);
    audio.src = currentUrl;
    hasFile = true;
    routeFile();

    const dot = file.name.lastIndexOf('.');
    lastTitle = dot > 0 ? file.name.slice(0, dot) : file.name;
    lastSub = 'Yerel dosya • ' + (file.size / 1048576).toFixed(1) + ' MB';
    setStatus('file', lastTitle, lastSub);

    playBtn.disabled = false;
    progressWrap.classList.remove('disabled');
    audio.play().catch(function () { showToast('Oynatma başlatılamadı.'); });
  }

  fileInput.addEventListener('change', function (e) {
    loadFile(e.target.files[0]);
    fileInput.value = '';
  });

  // ---------- Oynatma ----------
  playBtn.addEventListener('click', function () {
    if (!hasFile) return;
    initAudio();
    if (micStream) stopMic();
    if (audio.paused) {
      audio.play().catch(function () { showToast('Oynatma başlatılamadı.'); });
    } else {
      audio.pause();
    }
  });

  audio.addEventListener('play', function () { playBtn.textContent = '❚❚'; });
  audio.addEventListener('pause', function () { playBtn.textContent = '▶'; });
  audio.addEventListener('ended', function () { playBtn.textContent = '▶'; });

  audio.addEventListener('loadedmetadata', function () {
    seek.max = audio.duration || 100;
    seek.value = 0;
    durationEl.textContent = fmt(audio.duration);
    updateRangeFill(seek);
  });

  audio.addEventListener('timeupdate', function () {
    if (seeking) return;
    seek.value = audio.currentTime;
    currentTimeEl.textContent = fmt(audio.currentTime);
    updateRangeFill(seek);
  });

  seek.addEventListener('input', function () {
    seeking = true;
    currentTimeEl.textContent = fmt(parseFloat(seek.value));
    updateRangeFill(seek);
  });

  seek.addEventListener('change', function () {
    audio.currentTime = parseFloat(seek.value);
    seeking = false;
  });

  volume.addEventListener('input', function () {
    const v = parseFloat(volume.value);
    if (gainNode) gainNode.gain.setTargetAtTime(v, audioCtx.currentTime, 0.02);
    updateRangeFill(volume);
  });

  sensitivityEl.addEventListener('input', function () {
    sensitivity = parseFloat(sensitivityEl.value);
    updateRangeFill(sensitivityEl);
  });

  // ---------- Mikrofon ----------
  async function startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('Mikrofon desteklenmiyor (HTTPS veya localhost gerekli).');
      return;
    }
    if (!initAudio()) return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
    } catch (err) {
      micStream = null;
      showToast('Mikrofon erişimi reddedildi veya bulunamadı.');
      return;
    }
    audio.pause();
    micSource = audioCtx.createMediaStreamSource(micStream);
    routeMic();
    micBtn.classList.add('active');
    micBtn.textContent = '⏹ Mikrofonu Kapat';
    setStatus('mic', 'Canlı Mikrofon', 'Gerçek zamanlı ses analizi');
  }

  function stopMic(silent) {
    if (!micStream) return;
    micStream.getTracks().forEach(function (t) { t.stop(); });
    micStream = null;
    safeDisconnect(micSource);
    micSource = null;
    micBtn.classList.remove('active');
    micBtn.textContent = '🎤 Mikrofonu Aç';
    if (silent) return;
    if (hasFile) {
      routeFile();
      setStatus('file', lastTitle, lastSub);
    } else {
      setStatus('none', 'Ses kaynağı seçilmedi', 'MP3 yükle veya mikrofonu aç');
    }
  }

  micBtn.addEventListener('click', function () {
    if (micStream) stopMic(); else startMic();
  });

  // ---------- Mod ----------
  modeBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      modeBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      mode = btn.dataset.mode;
    });
  });

  // ---------- Sürükle & Bırak ----------
  let dragCounter = 0;
  window.addEventListener('dragenter', function (e) {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.add('show');
  });
  window.addEventListener('dragleave', function (e) {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropOverlay.classList.remove('show');
    }
  });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('show');
    if (e.dataTransfer && e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
  });

  // ---------- Klavye ----------
  window.addEventListener('keydown', function (e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!playBtn.disabled) playBtn.click();
    } else if (e.key === 'm' || e.key === 'M') {
      micBtn.click();
    }
  });

  // ---------- Çizim ----------
  function isActive() {
    return analyser && (micStream || !audio.paused);
  }

  function fillIdle(t) {
    for (let i = 0; i < freqData.length; i++) {
      if (i < 400) {
        freqData[i] = (Math.sin(t * 1.5 + i * 0.08) * 0.5 + 0.5) * 45 * (1 - i / 400) + 12;
      } else {
        freqData[i] = 0;
      }
    }
    for (let j = 0; j < timeData.length; j++) {
      timeData[j] = 128 + Math.sin(t * 2 + j * 0.012) * 10 * Math.sin(t * 0.7);
    }
  }

  function getAvg(from, to) {
    let s = 0;
    for (let i = from; i < to; i++) s += freqData[i];
    return s / ((to - from) * 255);
  }

  function drawGlow(cx, cy, minDim) {
    const r = minDim * (0.4 + smoothBass * 0.3);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(176, 38, 255, ' + (0.04 + smoothBass * 0.1) + ')');
    g.addColorStop(0.5, 'rgba(0, 240, 255, ' + (0.015 + smoothBass * 0.04) + ')');
    g.addColorStop(1, 'rgba(5, 1, 15, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawMirrorSpectrum(cy, minDim) {
    const bars = 96;
    const barW = W / bars;
    const maxBin = Math.floor(freqData.length * 0.6);
    ctx.shadowBlur = 0;
    for (let i = 0; i < bars; i++) {
      const p = i / bars;
      const idx = Math.floor(Math.pow(p, 1.6) * maxBin) + 1;
      const v = Math.min(1, (freqData[idx] / 255) * sensitivity);
      const h = v * minDim * 0.28;
      const hue = 190 + p * 95;
      ctx.fillStyle = 'hsla(' + hue + ', 100%, 60%, 0.18)';
      ctx.fillRect(i * barW + 1, cy - h, barW - 2, h * 2);
    }
  }

  function drawWave(cy, minDim) {
    const len = timeData.length;
    const amp = minDim * 0.25 * sensitivity;
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#00f0ff');
    grad.addColorStop(0.5, '#b026ff');
    grad.addColorStop(1, '#00f0ff');

    ctx.lineJoin = 'round';
    ctx.strokeStyle = grad;
    ctx.shadowColor = '#b026ff';

    const layers = [
      { scale: 1, alpha: 1, width: 3, blur: 20 },
      { scale: -0.6, alpha: 0.35, width: 2, blur: 10 },
      { scale: 1.6, alpha: 0.15, width: 1.5, blur: 6 }
    ];

    layers.forEach(function (layer) {
      ctx.globalAlpha = layer.alpha;
      ctx.lineWidth = layer.width;
      ctx.shadowBlur = layer.blur;
      ctx.beginPath();
      for (let i = 0; i < len; i += 2) {
        const x = (i / (len - 1)) * W;
        const v = (timeData[i] - 128) / 128;
        const edge = Math.sin((i / (len - 1)) * Math.PI);
        const y = cy + v * amp * layer.scale * edge;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function drawCircle(cx, cy, minDim) {
    const baseR = minDim * 0.15 * (1 + smoothBass * 0.35);
    const half = 90;
    const maxBin = Math.floor(freqData.length * 0.55);
    const maxLen = minDim * 0.2 * sensitivity;

    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, ((Math.PI * 2 * baseR) / (half * 2)) * 0.55);
    ctx.shadowBlur = 14;

    for (let i = 0; i < half; i++) {
      const p = i / half;
      const idx = Math.floor(Math.pow(p, 1.4) * maxBin) + 2;
      const v = freqData[idx] / 255;
      const l = 3 + v * v * maxLen * 1.3;
      const hue = 190 + p * 95;
      const color = 'hsl(' + hue + ', 100%, ' + (55 + v * 20) + '%)';
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      for (let s = -1; s <= 1; s += 2) {
        const a = rotation - Math.PI / 2 + s * p * Math.PI;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(cx + cos * baseR, cy + sin * baseR);
        ctx.lineTo(cx + cos * (baseR + l), cy + sin * (baseR + l));
        ctx.stroke();
      }
    }

    // Dairesel dalga halkası
    const ringR = baseR * 0.82;
    const ringGrad = ctx.createLinearGradient(cx - baseR, cy - baseR, cx + baseR, cy + baseR);
    ringGrad.addColorStop(0, '#00f0ff');
    ringGrad.addColorStop(1, '#b026ff');
    ctx.strokeStyle = ringGrad;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    const tl = timeData.length;
    for (let i = 0; i <= tl; i += 4) {
      const v = (timeData[i % tl] - 128) / 128;
      const a = (i / tl) * Math.PI * 2 - rotation * 1.5;
      const r = ringR + v * baseR * 0.5 * sensitivity;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    // İnce dış halka
    ctx.beginPath();
    ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 10;
    ctx.stroke();

    // Parlayan çekirdek
    const coreR = ringR * (0.45 + smoothBass * 0.25);
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    core.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    core.addColorStop(0.3, 'rgba(0, 240, 255, 0.6)');
    core.addColorStop(0.7, 'rgba(176, 38, 255, 0.35)');
    core.addColorStop(1, 'rgba(176, 38, 255, 0)');
    ctx.fillStyle = core;
    ctx.shadowColor = '#b026ff';
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function updateParticles(cx, cy, minDim) {
    if (isActive() && smoothBass > 0.5 && particles.length < 300) {
      const count = Math.floor(smoothBass * 5);
      const r0 = minDim * 0.15 * (1 + smoothBass * 0.35);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 3 * smoothBass;
        particles.push({
          x: cx + Math.cos(a) * r0,
          y: cy + Math.sin(a) * r0,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          life: 1,
          size: 1 + Math.random() * 2.5,
          hue: Math.random() > 0.5 ? 190 : 285
        });
      }
    }

    ctx.globalCompositeOperation = 'lighter';
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.vx *= 0.99;
      pt.vy *= 0.99;
      pt.life -= 0.012;
      if (pt.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.fillStyle = 'hsla(' + pt.hue + ', 100%, 65%, ' + pt.life + ')';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function draw(time) {
    requestAnimationFrame(draw);
    const t = (time || 0) * 0.001;

    if (isActive()) {
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);
    } else {
      fillIdle(t);
    }

    const bass = Math.min(1, getAvg(1, 12) * sensitivity);
    const mid = Math.min(1, getAvg(12, 120) * sensitivity);
    smoothBass += (bass - smoothBass) * 0.2;

    // İz efekti için yarı saydam temizleme
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(5, 1, 15, 0.28)';
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H * 0.44;
    const minDim = Math.min(W, H);

    drawGlow(cx, cy, minDim);
    rotation += 0.002 + mid * 0.012;

    if (mode === 'wave') drawMirrorSpectrum(cy, minDim);
    if (mode !== 'circle') drawWave(cy, minDim);
    if (mode !== 'wave') drawCircle(cx, cy, minDim);
    updateParticles(cx, cy, minDim);
  }

  // ---------- Başlangıç ----------
  updateRangeFill(volume);
  updateRangeFill(sensitivityEl);
  updateRangeFill(seek);
  requestAnimationFrame(draw);
})();
