/* ============================================================
   Acoustic Guitar Studio · 吉他练习台
   模块：调音器 / 节拍器 / 乐谱库 / 和弦库
   ============================================================ */

(() => {
  'use strict';

  /* ---------------- 通用工具 ---------------- */

  let audioCtx = null;

  function getCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  function freqToNote(f) {
    const midi = Math.round(69 + 12 * Math.log2(f / 440));
    const name = NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
    return { name, midi };
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* ---------------- 选项卡 ---------------- */

  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      panels.forEach((p) => p.classList.toggle('active', p.id === 'panel-' + target));
    });
  });

  /* ============================================================
     调音器
     ============================================================ */

  const TUNINGS = {
    standard: {
      label: '标准调弦（E A D G B E）',
      strings: [
        { string: 6, label: 'E2', freq: 82.41 },
        { string: 5, label: 'A2', freq: 110.0 },
        { string: 4, label: 'D3', freq: 146.83 },
        { string: 3, label: 'G3', freq: 196.0 },
        { string: 2, label: 'B3', freq: 246.94 },
        { string: 1, label: 'E4', freq: 329.63 },
      ],
    },
    dropD: {
      label: 'Drop D（D A D G B E）',
      strings: [
        { string: 6, label: 'D2', freq: 73.42 },
        { string: 5, label: 'A2', freq: 110.0 },
        { string: 4, label: 'D3', freq: 146.83 },
        { string: 3, label: 'G3', freq: 196.0 },
        { string: 2, label: 'B3', freq: 246.94 },
        { string: 1, label: 'E4', freq: 329.63 },
      ],
    },
    dadgad: {
      label: 'DADGAD（D A D G A D）',
      strings: [
        { string: 6, label: 'D2', freq: 73.42 },
        { string: 5, label: 'A2', freq: 110.0 },
        { string: 4, label: 'D3', freq: 146.83 },
        { string: 3, label: 'G3', freq: 196.0 },
        { string: 2, label: 'A3', freq: 220.0 },
        { string: 1, label: 'D4', freq: 293.66 },
      ],
    },
    openG: {
      label: 'Open G（D G D G B D）',
      strings: [
        { string: 6, label: 'D2', freq: 73.42 },
        { string: 5, label: 'G2', freq: 98.0 },
        { string: 4, label: 'D3', freq: 146.83 },
        { string: 3, label: 'G3', freq: 196.0 },
        { string: 2, label: 'B3', freq: 246.94 },
        { string: 1, label: 'D4', freq: 293.66 },
      ],
    },
  };

  const tuner = {
    running: false,
    stream: null,
    source: null,
    analyser: null,
    buffer: null,
    vals: null,
    raf: 0,
    lastDetect: 0,
    lastSound: 0,
    history: [],
    tuning: 'standard',
    selected: 0,
  };

  const micStatus = document.getElementById('micStatus');
  const micToggle = document.getElementById('micToggle');
  const tuningSelect = document.getElementById('tuningSelect');
  const stringList = document.getElementById('stringList');
  const noteNameEl = document.getElementById('noteName');
  const freqValueEl = document.getElementById('freqValue');
  const centsTextEl = document.getElementById('centsText');
  const gaugeMarker = document.getElementById('gaugeMarker');
  const statPitch = document.getElementById('statPitch');
  const statString = document.getElementById('statString');
  const statCents = document.getElementById('statCents');
  const refToneBtn = document.getElementById('refToneBtn');
  const headstockEl = document.getElementById('headstock');
  const headstockStatus = document.getElementById('headstockStatus');
  const headstockTip = document.getElementById('headstockTip');

  // 填充调弦下拉框
  Object.entries(TUNINGS).forEach(([key, val]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = val.label;
    tuningSelect.appendChild(opt);
  });
  tuningSelect.value = tuner.tuning;

  function currentStrings() {
    return TUNINGS[tuner.tuning].strings;
  }

  function renderStrings() {
    const strings = currentStrings();
    stringList.innerHTML = '';
    strings.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.className = 'string-btn' + (i === tuner.selected ? ' active' : '');
      btn.type = 'button';
      btn.innerHTML = `<b>${s.label}</b><small>${s.string} 弦</small>`;
      btn.addEventListener('click', () => {
        tuner.selected = i;
        renderStrings();
        playReferenceTone(s.freq);
      });
      stringList.appendChild(btn);
    });
  }

  function playReferenceTone(freq) {
    const ctx = getCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.28, t + 0.05);
    gain.gain.setValueAtTime(0.28, t + 0.9);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1.55);
  }

  refToneBtn.addEventListener('click', () => {
    playReferenceTone(currentStrings()[tuner.selected].freq);
  });

  /* --- 琴头调音图：6 个旋钮对应 6 根弦，方便新手找到该拧哪颗 --- */
  // 左列（低音侧）6→4 弦靠近琴枕往下排，右列（高音侧）3→1 弦由远及近
  const HEADSTOCK_PEGS = [
    { x: 48, y: 218 }, { x: 48, y: 148 }, { x: 48, y: 78 },
    { x: 192, y: 78 }, { x: 192, y: 148 }, { x: 192, y: 218 },
  ];
  const HEADSTOCK_NUT_X = [90, 102, 114, 126, 138, 150];
  const HEADSTOCK_POST_X = [82, 82, 82, 158, 158, 158];

  function renderHeadstock() {
    const strings = currentStrings();

    const stringLayer = strings.map((s, i) => {
      const nx = HEADSTOCK_NUT_X[i];
      const px = HEADSTOCK_POST_X[i];
      const py = HEADSTOCK_PEGS[i].y;
      const w = (2.4 - i * 0.28).toFixed(1);
      return `<path class="hs-string" data-index="${i}" d="M${nx} 271 L${px} ${py}" stroke-width="${w}" />`;
    }).join('');

    const pegLayer = strings.map((s, i) => {
      const { x, y } = HEADSTOCK_PEGS[i];
      const px = HEADSTOCK_POST_X[i];
      const note = s.label.replace(/\d+$/, '');
      const stemEnd = x + (i < 3 ? 9 : -9);
      return `
        <g class="hs-peg" data-index="${i}">
          <line class="hs-stem" x1="${px}" y1="${y}" x2="${stemEnd}" y2="${y}" />
          <circle class="hs-post" cx="${px}" cy="${y}" r="4" />
          <circle class="hs-knob" cx="${x}" cy="${y}" r="15" />
          <text class="hs-note" x="${x}" y="${y + 4.5}">${note}</text>
          <text class="hs-num" x="${x}" y="${y + 27}">${s.string} 弦</text>
          <circle class="hs-hit" cx="${x}" cy="${y}" r="22" />
        </g>`;
    }).join('');

    headstockEl.innerHTML = `
      <svg viewBox="0 0 240 292" role="img" aria-label="吉他琴头旋钮示意图">
        <defs>
          <linearGradient id="hsWood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#3b2c1b" />
            <stop offset="1" stop-color="#241a10" />
          </linearGradient>
          <linearGradient id="hsKnob" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ffd79b" />
            <stop offset="1" stop-color="#e6a542" />
          </linearGradient>
          <linearGradient id="hsKnobActive" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff3d4" />
            <stop offset="1" stop-color="#ffcf85" />
          </linearGradient>
          <linearGradient id="hsKnobTuned" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#a5f3d6" />
            <stop offset="1" stop-color="#3cc794" />
          </linearGradient>
        </defs>
        <path class="hs-body" d="M72 44 Q72 22 94 22 L146 22 Q168 22 168 44 L159 244 Q158 264 138 264 L102 264 Q82 264 81 244 Z" />
        ${stringLayer}
        <rect class="hs-truss" x="116" y="40" width="8" height="34" rx="4" />
        <rect class="hs-nut" x="87" y="264" width="66" height="9" rx="3" />
        ${pegLayer}
      </svg>`;

    headstockEl.querySelectorAll('.hs-peg').forEach((peg) => {
      peg.addEventListener('click', () => {
        const i = Number(peg.dataset.index);
        tuner.selected = i;
        renderStrings();
        playReferenceTone(currentStrings()[i].freq);
        const s = currentStrings()[i];
        setHeadstockState(i, false);
        headstockStatus.textContent = `试听中`;
        headstockStatus.className = 'pill';
        headstockTip.textContent = `正在试听 ${s.string} 弦 ${s.label} 标准音`;
        headstockTip.className = 'headstock-tip';
      });
    });

    clearHeadstockHighlight();
  }

  function setHeadstockState(index, inTune) {
    headstockEl.querySelectorAll('.hs-peg').forEach((peg, i) => {
      peg.classList.toggle('active', i === index);
      peg.classList.toggle('tuned', i === index && inTune);
    });
    headstockEl.querySelectorAll('.hs-string').forEach((line, i) => {
      line.classList.toggle('active', i === index);
      line.classList.toggle('tuned', i === index && inTune);
    });
  }

  function clearHeadstockHighlight() {
    headstockEl.querySelectorAll('.hs-peg, .hs-string').forEach((el) => {
      el.classList.remove('active', 'tuned');
    });
    headstockStatus.textContent = '待拨弦';
    headstockStatus.className = 'pill muted';
    headstockTip.textContent = '拨响任意琴弦，亮起的旋钮就是要调的那根弦。';
    headstockTip.className = 'headstock-tip';
  }

  tuningSelect.addEventListener('change', () => {
    tuner.tuning = tuningSelect.value;
    tuner.selected = 0;
    tuner.history = [];
    renderStrings();
    renderHeadstock();
    resetTunerDisplay();
  });

  function resetTunerDisplay() {
    noteNameEl.textContent = '--';
    noteNameEl.classList.remove('in-tune');
    freqValueEl.textContent = '0.0 Hz';
    centsTextEl.textContent = '拨响任意一根弦开始';
    centsTextEl.className = 'cents-text';
    gaugeMarker.style.transform = 'translateX(-50%)';
    gaugeMarker.classList.remove('in-tune');
    statPitch.textContent = '--';
    statString.textContent = '--';
    statCents.textContent = '--';
    clearHeadstockHighlight();
    document.querySelectorAll('.string-btn').forEach((b) => b.classList.remove('active'));
    if (tuner.selected >= 0) {
      const btns = stringList.querySelectorAll('.string-btn');
      if (btns[tuner.selected]) btns[tuner.selected].classList.add('active');
    }
  }

  /* --- 音高检测：归一化自相关 --- */
  const DETECT_N = 2048;

  function detectPitch(buf, offset, sampleRate) {
    // 计算 RMS，过滤环境噪声
    let rms = 0;
    for (let i = 0; i < DETECT_N; i++) {
      const v = buf[offset + i];
      rms += v * v;
    }
    rms = Math.sqrt(rms / DETECT_N);
    if (rms < 0.008) return null;

    const minLag = Math.floor(sampleRate / 520);
    const maxLag = Math.floor(sampleRate / 65);
    const vals = tuner.vals;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      let e1 = 0;
      let e2 = 0;
      const limit = DETECT_N - lag;
      for (let i = 0; i < limit; i++) {
        const a = buf[offset + i];
        const b = buf[offset + i + lag];
        sum += a * b;
        e1 += a * a;
        e2 += b * b;
      }
      vals[lag] = sum / (Math.sqrt(e1 * e2) + 1e-12);
    }

    let maxVal = 0;
    let maxLagPos = minLag;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (vals[lag] > maxVal) {
        maxVal = vals[lag];
        maxLagPos = lag;
      }
    }
    if (maxVal < 0.55) return null;

    // 优先取最早的强峰，避免八度误判（取到 2 倍周期）
    let chosen = maxLagPos;
    for (let lag = minLag + 1; lag < maxLagPos; lag++) {
      if (vals[lag] > vals[lag - 1] && vals[lag] >= vals[lag + 1] && vals[lag] > 0.86 * maxVal) {
        chosen = lag;
        break;
      }
    }

    // 抛物线插值，提高精度
    let refined = chosen;
    if (chosen > minLag && chosen < maxLag) {
      const y1 = vals[chosen - 1];
      const y2 = vals[chosen];
      const y3 = vals[chosen + 1];
      const a = (y1 + y3 - 2 * y2) / 2;
      const b = (y3 - y1) / 2;
      if (Number.isFinite(a) && a !== 0) refined = chosen - b / (2 * a);
    }

    return { freq: sampleRate / refined, clarity: maxVal };
  }

  function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  async function startTuner() {
    if (tuner.running) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const ctx = getCtx();
      if (!ctx) throw new Error('当前浏览器不支持 Web Audio');

      tuner.stream = stream;
      tuner.source = ctx.createMediaStreamSource(stream);
      tuner.analyser = ctx.createAnalyser();
      tuner.analyser.fftSize = 4096;
      tuner.analyser.smoothingTimeConstant = 0;
      tuner.source.connect(tuner.analyser);
      tuner.buffer = new Float32Array(tuner.analyser.fftSize);
      tuner.vals = new Float32Array(Math.floor(ctx.sampleRate / 65) + 4);
      tuner.history = [];
      tuner.running = true;
      tuner.lastSound = performance.now();

      micStatus.textContent = '正在监听 · 拨弦试试';
      micStatus.className = 'pill live';
      micToggle.textContent = '停止调音';
      micToggle.classList.remove('primary');
      micToggle.classList.add('ghost');
      refToneBtn.disabled = false;

      tuner.raf = requestAnimationFrame(tunerLoop);
    } catch (err) {
      micStatus.textContent = '麦克风不可用';
      micStatus.className = 'pill error';
      centsTextEl.textContent =
        '无法访问麦克风：请检查浏览器权限，并确认通过 http://localhost 打开本页面。';
      centsTextEl.className = 'cents-text off';
      console.warn('麦克风启动失败：', err);
    }
  }

  function stopTuner() {
    tuner.running = false;
    cancelAnimationFrame(tuner.raf);
    if (tuner.stream) {
      tuner.stream.getTracks().forEach((t) => t.stop());
    }
    if (tuner.source) tuner.source.disconnect();
    tuner.stream = null;
    tuner.source = null;
    tuner.analyser = null;
    tuner.history = [];

    micStatus.textContent = '麦克风未开启';
    micStatus.className = 'pill';
    micToggle.textContent = '开始调音';
    micToggle.classList.add('primary');
    micToggle.classList.remove('ghost');
    resetTunerDisplay();
  }

  micToggle.addEventListener('click', () => {
    if (tuner.running) stopTuner();
    else startTuner();
  });

  function tunerLoop() {
    if (!tuner.running) return;
    const analyser = tuner.analyser;
    if (!analyser) return;

    analyser.getFloatTimeDomainData(tuner.buffer);

    const now = performance.now();
    if (now - tuner.lastDetect > 60) {
      tuner.lastDetect = now;
      const ctx = getCtx();
      const offset = tuner.buffer.length - DETECT_N;
      const res = detectPitch(tuner.buffer, offset, ctx.sampleRate);

      if (res) {
        const prev = tuner.history[tuner.history.length - 1];
        // 突变超过 25% 视为新音，清空历史
        if (prev && Math.abs(res.freq - prev) / prev > 0.25) tuner.history = [];
        tuner.history.push(res.freq);
        if (tuner.history.length > 6) tuner.history.shift();
        updateTuner(median(tuner.history));
        tuner.lastSound = now;
      } else if (now - tuner.lastSound > 900) {
        resetTunerDisplay();
        tuner.history = [];
      }
    }

    tuner.raf = requestAnimationFrame(tunerLoop);
  }

  function updateTuner(freq) {
    const strings = currentStrings();
    let nearest = strings[0];
    let nearestCents = Infinity;

    strings.forEach((s) => {
      const cents = 1200 * Math.log2(freq / s.freq);
      if (Math.abs(cents) < Math.abs(nearestCents)) {
        nearestCents = cents;
        nearest = s;
      }
    });

    const note = freqToNote(freq);
    const inTune = Math.abs(nearestCents) <= 4;

    noteNameEl.textContent = note.name;
    noteNameEl.classList.toggle('in-tune', inTune);
    freqValueEl.textContent = freq.toFixed(1) + ' Hz';

    if (inTune) {
      centsTextEl.textContent = '音准了 ✓';
      centsTextEl.className = 'cents-text in-tune';
    } else if (nearestCents < 0) {
      centsTextEl.textContent = `${nearest.string} 弦 ${nearest.label} 偏低 ${Math.abs(nearestCents).toFixed(0)} 音分`;
      centsTextEl.className = 'cents-text off';
    } else {
      centsTextEl.textContent = `${nearest.string} 弦 ${nearest.label} 偏高 ${nearestCents.toFixed(0)} 音分`;
      centsTextEl.className = 'cents-text off';
    }

    // 指针位置
    const width = gaugeMarker.parentElement.clientWidth;
    const px = (clamp(nearestCents, -50, 50) / 50) * (width / 2 - 6);
    gaugeMarker.style.transform = `translateX(calc(-50% + ${px}px))`;
    gaugeMarker.classList.toggle('in-tune', inTune);

    statPitch.textContent = `${note.name} · ${freq.toFixed(1)} Hz`;
    statString.textContent = `${nearest.string} 弦 ${nearest.label}`;
    statCents.textContent = `${nearestCents > 0 ? '+' : ''}${nearestCents.toFixed(1)} 音分`;

    const activeIndex = strings.findIndex((s) => s.string === nearest.string);
    setHeadstockState(activeIndex, inTune);
    if (inTune) {
      headstockStatus.textContent = '已调准';
      headstockStatus.className = 'pill live';
      headstockTip.textContent = `${nearest.string} 弦 ${nearest.label} 已调准 ✓`;
      headstockTip.className = 'headstock-tip in-tune';
    } else {
      headstockStatus.textContent = `${nearest.string} 弦`;
      headstockStatus.className = 'pill';
      headstockTip.textContent = nearestCents < 0
        ? `${nearest.string} 弦 ${nearest.label} 偏低 → 顺时针拧紧旋钮`
        : `${nearest.string} 弦 ${nearest.label} 偏高 → 逆时针拧松旋钮`;
      headstockTip.className = 'headstock-tip off';
    }

    stringList.querySelectorAll('.string-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === activeIndex);
    });
  }

  renderStrings();
  renderHeadstock();
  resetTunerDisplay();

  /* ============================================================
     节拍器
     ============================================================ */

  const metro = {
    bpm: 96,
    beats: 4,
    sub: 1,
    sound: 'wood',
    vol: 0.6,
    accent: true,
    preset: null,
    running: false,
    nextTime: 0,
    click: 0,
    timer: 0,
    raf: 0,
    queue: [],
    noise: null,
    master: null,
  };

  const bpmValue = document.getElementById('bpmValue');
  const bpmSlider = document.getElementById('bpmSlider');
  const beatDots = document.getElementById('beatDots');
  const beatCaption = document.getElementById('beatCaption');
  const timeSig = document.getElementById('timeSig');
  const subdiv = document.getElementById('subdiv');
  const clickSound = document.getElementById('clickSound');
  const metroVol = document.getElementById('metroVol');
  const volLabel = document.getElementById('volLabel');
  const accentToggle = document.getElementById('accent');
  const metroToggle = document.getElementById('metroToggle');
  const tapTempo = document.getElementById('tapTempo');
  const metroPresets = document.getElementById('metroPresets');

  const METRO_PRESETS = {
    pop: { bpm: 96, beats: 4, sub: 2, accent: true },
    ballad: { bpm: 66, beats: 4, sub: 1, accent: true },
    rock: { bpm: 132, beats: 4, sub: 2, accent: true },
    finger: { bpm: 84, beats: 4, sub: 4, accent: true },
  };

  function buildNoise() {
    const ctx = getCtx();
    if (metro.noise || !ctx) return;
    const len = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    metro.noise = buf;
  }

  function ensureMaster() {
    const ctx = getCtx();
    if (!ctx) return null;
    if (!metro.master) {
      metro.master = ctx.createGain();
      metro.master.gain.value = metro.vol;
      metro.master.connect(ctx.destination);
    }
    metro.master.gain.value = metro.vol;
    return ctx;
  }

  function playClick(time, accent) {
    const ctx = getCtx();
    if (!ctx) return;

    if (metro.sound === 'beep') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = accent ? 1046 : 784;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.9, time + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
      osc.connect(gain).connect(metro.master);
      osc.start(time);
      osc.stop(time + 0.14);
      return;
    }

    if (!metro.noise) buildNoise();
    const src = ctx.createBufferSource();
    src.buffer = metro.noise;

    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    if (metro.sound === 'wood') {
      filter.type = 'bandpass';
      filter.frequency.value = accent ? 2200 : 1450;
      filter.Q.value = 3.2;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(1, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.075);
    } else {
      filter.type = 'highpass';
      filter.frequency.value = accent ? 3200 : 2400;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.85, time + 0.001);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    }

    src.connect(filter).connect(gain).connect(metro.master);
    src.start(time);
    src.stop(time + 0.08);
  }

  function schedule() {
    const ctx = getCtx();
    if (!ctx) return;
    while (metro.nextTime < ctx.currentTime + 0.12) {
      const beat = Math.floor(metro.click / metro.sub);
      const subIndex = metro.click % metro.sub;
      const isAccent = metro.accent && beat === 0 && subIndex === 0;
      playClick(metro.nextTime, isAccent);
      metro.queue.push({ time: metro.nextTime, beat, subIndex });
      metro.nextTime += 60 / metro.bpm / metro.sub;
      metro.click += 1;
      if (metro.click >= metro.beats * metro.sub) metro.click = 0;
    }
  }

  function visualLoop() {
    if (!metro.running) return;
    const ctx = getCtx();
    const now = ctx.currentTime;
    while (metro.queue.length && metro.queue[0].time <= now) {
      const item = metro.queue.shift();
      markBeat(item.beat, item.subIndex);
    }
    metro.raf = requestAnimationFrame(visualLoop);
  }

  let clearBeatTimer = 0;

  function markBeat(beat, subIndex) {
    const dots = beatDots.children;
    if (!dots.length) return;
    const dot = dots[beat];
    if (!dot) return;
    if (subIndex === 0) {
      for (let i = 0; i < dots.length; i++) dots[i].classList.remove('on');
      dot.classList.add('on');
      clearBeatTimer = performance.now();
    }
  }

  function clearBeatsLoop() {
    if (!metro.running) return;
    if (clearBeatTimer && performance.now() - clearBeatTimer > 140) {
      for (const d of beatDots.children) d.classList.remove('on');
      clearBeatTimer = 0;
    }
    requestAnimationFrame(clearBeatsLoop);
  }

  function rebuildDots() {
    beatDots.innerHTML = '';
    for (let i = 0; i < metro.beats; i++) {
      const d = document.createElement('div');
      d.className = 'beat-dot' + (i === 0 ? ' accent' : '');
      beatDots.appendChild(d);
    }
    const label = timeSig.options[timeSig.selectedIndex].textContent.replace(' 拍', '');
    beatCaption.textContent = `${label} · 每拍 ${metro.sub} 下${metro.accent ? ' · 首拍重音' : ''}`;
  }

  function startMetro() {
    const ctx = getCtx();
    if (!ctx) return;
    ensureMaster();
    metro.running = true;
    metro.queue = [];
    metro.click = 0;
    metro.nextTime = ctx.currentTime + 0.08;
    metro.timer = setInterval(schedule, 25);
    metro.raf = requestAnimationFrame(visualLoop);
    requestAnimationFrame(clearBeatsLoop);
    metroToggle.textContent = '停止';
    metroToggle.classList.remove('primary');
    metroToggle.classList.add('ghost');
    schedule();
  }

  function stopMetro() {
    metro.running = false;
    clearInterval(metro.timer);
    cancelAnimationFrame(metro.raf);
    metro.queue = [];
    metroToggle.textContent = '开始练习';
    metroToggle.classList.add('primary');
    metroToggle.classList.remove('ghost');
    for (const d of beatDots.children) d.classList.remove('on');
  }

  metroToggle.addEventListener('click', () => {
    if (metro.running) stopMetro();
    else startMetro();
  });

  function markCustom() {
    if (!metro.preset) return;
    metro.preset = null;
    syncPresetButtons();
    saveSettings();
  }

  function syncPresetButtons() {
    for (const b of metroPresets.children) {
      b.classList.toggle('active', b.dataset.preset === metro.preset);
    }
  }

  function applyPreset(id) {
    const p = METRO_PRESETS[id];
    if (!p) return;
    setBpm(p.bpm);
    metro.beats = p.beats;
    metro.sub = p.sub;
    metro.accent = p.accent;
    timeSig.value = String(p.beats);
    subdiv.value = String(p.sub);
    accentToggle.checked = p.accent;
    metro.click = 0;
    if (metro.running) metro.nextTime = getCtx().currentTime + 0.08;
    metro.preset = id;
    syncPresetButtons();
    rebuildDots();
    saveSettings();
  }

  metroPresets.addEventListener('click', (e) => {
    const btn = e.target.closest('.preset-btn');
    if (btn) applyPreset(btn.dataset.preset);
  });

  function setBpm(v) {
    markCustom();
    metro.bpm = clamp(Math.round(v), 40, 240);
    bpmValue.textContent = metro.bpm;
    bpmSlider.value = metro.bpm;
    saveSettings();
  }

  bpmSlider.addEventListener('input', () => setBpm(+bpmSlider.value));
  document.getElementById('bpmMinus').addEventListener('click', () => setBpm(metro.bpm - 1));
  document.getElementById('bpmPlus').addEventListener('click', () => setBpm(metro.bpm + 1));

  timeSig.addEventListener('change', () => {
    metro.beats = +timeSig.value;
    metro.click = 0;
    markCustom();
    rebuildDots();
    saveSettings();
  });

  subdiv.addEventListener('change', () => {
    metro.sub = +subdiv.value;
    metro.click = 0;
    markCustom();
    rebuildDots();
    saveSettings();
  });

  clickSound.addEventListener('change', () => {
    metro.sound = clickSound.value;
    saveSettings();
  });

  metroVol.addEventListener('input', () => {
    metro.vol = +metroVol.value / 100;
    volLabel.textContent = metroVol.value + '%';
    if (metro.master) metro.master.gain.value = metro.vol;
    saveSettings();
  });

  accentToggle.addEventListener('change', () => {
    metro.accent = accentToggle.checked;
    rebuildDots();
    metro.click = 0;
    markCustom();
    saveSettings();
  });

  // 打拍定速
  let taps = [];
  tapTempo.addEventListener('click', () => {
    const now = performance.now();
    taps.push(now);
    if (taps.length > 6) taps.shift();
    if (taps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avg > 150 && avg < 1500) {
        setBpm(60000 / avg);
        tapTempo.textContent = `已记录 ${taps.length} 拍`;
      }
    }
    clearTimeout(tapTempo.resetTimer);
    tapTempo.resetTimer = setTimeout(() => {
      tapTempo.textContent = '点我打拍定速';
      taps = [];
    }, 2200);
  });

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    if (!viewer.hidden) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (metro.running) stopMetro();
      else startMetro();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      setBpm(metro.bpm + (e.key === 'ArrowLeft' ? -2 : 2));
    }
  });

  rebuildDots();

  /* ============================================================
     乐谱库（IndexedDB）
     ============================================================ */

  const DB_NAME = 'guitar-studio';
  const STORE = 'sheets';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function dbAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbAdd(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPut(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).put(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /* ---------- 桌面版：乐谱保存为本地真实文件 ---------- */

  const disk = window.gsDisk && window.gsDisk.libraryPath ? window.gsDisk : null;

  function fileUrl(fsPath) {
    return new URL('file:///' + fsPath.replace(/\\/g, '/')).href;
  }

  // 每页的显示地址：本地文件用 file://，网页版用 blob:
  function pageUrl(page, pool) {
    if (page.path) return fileUrl(page.path);
    const url = URL.createObjectURL(page.blob);
    if (pool) pool.push(url);
    return url;
  }

  // 自制乐谱查看器里的参考图片区
  function renderChartRefs(pages, pool) {
    const wrap = document.createElement('section');
    wrap.className = 'score-refs';
    const title = document.createElement('h3');
    title.className = 'score-refs-title';
    title.textContent = `参考图片 · ${pages.length}`;
    const grid = document.createElement('div');
    grid.className = 'score-refs-grid';
    pages.forEach((page) => {
      const figure = document.createElement('figure');
      figure.className = 'score-ref';
      const img = document.createElement('img');
      img.src = pageUrl(page, pool);
      img.alt = page.name;
      img.loading = 'lazy';
      const cap = document.createElement('figcaption');
      cap.textContent = page.name;
      cap.title = page.name;
      figure.append(img, cap);
      grid.appendChild(figure);
    });
    wrap.append(title, grid);
    return wrap;
  }

  async function loadAlbums() {
    if (disk) return (await disk.list()) || [];
    return (await dbAll()).map(normalizeRecord);
  }

  async function createAlbum(name, pages) {
    if (disk) {
      const paths = pages.map((p) => disk.pathForFile(p.blob)).filter(Boolean);
      if (!paths.length) {
        alert('无法读取文件路径。请用「选择文件」按钮上传，或把文件直接拖入窗口。');
        return false;
      }
      const res = await disk.create(name, paths);
      if (!res.ok) {
        console.warn('保存失败', res.error);
        alert(`保存失败：${res.error || '未知错误'}`);
        return false;
      }
      return true;
    }
    const now = Date.now();
    try {
      await dbAdd({ name, pages, added: now, updated: now });
      return true;
    } catch (err) {
      console.warn('保存失败', err);
      alert('保存失败，可能是浏览器存储空间不足。');
      return false;
    }
  }

  async function appendPages(rec, pages) {
    if (disk) {
      const paths = pages.map((p) => disk.pathForFile(p.blob)).filter(Boolean);
      const res = await disk.addPages(rec.folder, paths);
      if (!res.ok) throw new Error(res.error || '追加失败');
      return;
    }
    await dbPut({ ...rec, pages: rec.pages.concat(pages), updated: Date.now() });
  }

  async function createChart(name, payload) {
    if (!disk) {
      alert('自制乐谱目前仅支持桌面版。');
      return '';
    }
    const res = await disk.createChart(name, payload);
    if (!res.ok) {
      alert(`保存失败：${res.error || '未知错误'}`);
      return '';
    }
    return res.folder || '';
  }

  // 把暂存的参考图片写入乐谱文件夹
  async function flushChartImages(folder) {
    if (!folder || !chartPendingImages.length) return;
    const paths = chartPendingImages.slice();
    chartPendingImages = [];
    const res = await disk.addPages(folder, paths);
    if (!res || !res.ok) throw new Error((res && res.error) || '参考图片保存失败');
  }

  async function saveChart(rec, payload) {
    const res = await disk.saveChart(rec.folder, payload);
    if (!res.ok) throw new Error(res.error || '保存失败');
  }

  async function renameAlbum(rec, newName) {
    if (disk) {
      const res = await disk.rename(rec.folder, newName);
      if (!res.ok) throw new Error(res.error || '重命名失败');
      return res.folder;
    }
    await dbPut({ ...rec, name: newName, updated: Date.now() });
    return newName;
  }

  async function deleteAlbum(rec) {
    if (disk) {
      const res = await disk.remove(rec.folder);
      if (!res.ok) throw new Error(res.error || '删除失败');
      return;
    }
    await dbDelete(rec.id);
  }

  // 把旧版 IndexedDB 里的乐谱一次性迁移为本地文件
  async function migrateFromIndexedDb() {
    if (!disk || localStorage.getItem('gs-disk-migrated')) return;
    let records = [];
    try {
      records = (await dbAll()).map(normalizeRecord);
    } catch (err) {
      console.warn('读取旧数据失败', err);
      return;
    }
    for (const rec of records) {
      const pages = [];
      for (const page of rec.pages) {
        try {
          pages.push({ name: page.name, buffer: await page.blob.arrayBuffer() });
        } catch (err) {
          console.warn('迁移单页失败', page.name, err);
        }
      }
      if (!pages.length) continue;
      const res = await disk.importAlbum(rec.name, pages);
      if (!res.ok) console.warn('迁移图集失败', rec.name, res.error);
    }
    localStorage.setItem('gs-disk-migrated', '1');
  }

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const pageInput = document.getElementById('pageInput');
  const browseBtn = document.getElementById('browseBtn');
  const sheetGrid = document.getElementById('sheetGrid');
  const libCount = document.getElementById('libCount');
  const libEmpty = document.getElementById('libEmpty');
  const searchInput = document.getElementById('searchInput');
  const viewer = document.getElementById('viewer');
  const viewerBody = document.getElementById('viewerBody');
  const viewerName = document.getElementById('viewerName');
  const pageNav = document.getElementById('pageNav');
  const pageCounter = document.getElementById('pageCounter');
  const prevPageBtn = document.getElementById('prevPage');
  const nextPageBtn = document.getElementById('nextPage');
  const pageStrip = document.getElementById('pageStrip');

  let thumbUrls = [];
  let viewerUrls = [];
  let viewerRecord = null;
  let viewerPage = 0;
  let viewerScale = 1;
  let pendingAlbum = null;

  const PAGE_SORTER = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

  function fileKind(file) {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
    return null;
  }

  function toPage(file) {
    const kind = fileKind(file);
    return kind ? { name: file.name, kind, size: file.size, blob: file } : null;
  }

  // 兼容旧版单文件记录：{ name, kind, size, blob } → 图集记录
  function normalizeRecord(rec) {
    if (rec.pages && rec.pages.length) return rec;
    return {
      id: rec.id,
      name: rec.name,
      pages: [{ name: rec.name, kind: rec.kind, size: rec.size, blob: rec.blob }],
      added: rec.added || Date.now(),
      updated: rec.updated || rec.added || Date.now(),
    };
  }

  function albumSize(rec) {
    return rec.pages.reduce((sum, p) => sum + (p.size || 0), 0);
  }

  function kindLabel(rec) {
    const images = rec.pages.filter((p) => p.kind === 'image').length;
    const pdfs = rec.pages.length - images;
    if (!pdfs) return '图片';
    if (!images) return 'PDF';
    return '图片 + PDF';
  }

  function guessAlbumName(names) {
    const stems = names.map((n) => n.replace(/\.[^.]+$/, ''));
    if (stems.length === 1) return stems[0];
    let prefix = stems[0];
    for (const stem of stems) {
      while (prefix && !stem.toLowerCase().startsWith(prefix.toLowerCase())) {
        prefix = prefix.slice(0, -1);
      }
    }
    const cleaned = prefix.replace(/[\s_\-·.]+$/g, '').trim();
    return cleaned || stems[0];
  }

  // Electron 不支持 window.prompt，用页面内对话框代替
  function askInput(title, desc, value = '') {
    const mask = document.getElementById('inputDialog');
    const titleEl = document.getElementById('inputDialogTitle');
    const descEl = document.getElementById('inputDialogDesc');
    const field = document.getElementById('inputDialogField');
    const okBtn = document.getElementById('inputDialogOk');
    const cancelBtn = document.getElementById('inputDialogCancel');

    titleEl.textContent = title;
    descEl.textContent = desc;
    descEl.hidden = !desc;
    field.value = value;
    mask.hidden = false;
    setTimeout(() => {
      field.focus();
      field.select();
    }, 0);

    return new Promise((resolve) => {
      const cleanup = (result) => {
        mask.hidden = true;
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        field.removeEventListener('keydown', onKey);
        mask.removeEventListener('click', onMask);
        resolve(result);
      };
      const onOk = () => {
        const text = field.value.trim();
        if (!text) {
          field.focus();
          return;
        }
        cleanup(text);
      };
      const onCancel = () => cleanup(null);
      const onKey = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOk();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cleanup(null);
        }
      };
      const onMask = (e) => {
        if (e.target === mask) cleanup(null);
      };

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      field.addEventListener('keydown', onKey);
      mask.addEventListener('click', onMask);
    });
  }

  async function addFiles(files) {
    const pages = [];
    const rejected = [];
    for (const f of files) {
      const page = toPage(f);
      if (page) pages.push(page);
      else rejected.push(f.name);
    }
    // 按文件名自然排序，例如 第2页 会排在 第10页 之前
    pages.sort((a, b) => PAGE_SORTER.compare(a.name, b.name));

    let saved = 0;
    if (pages.length === 1) {
      const albumName = pages[0].name.replace(/\.[^.]+$/, '');
      saved = (await createAlbum(albumName, pages)) ? 1 : 0;
    } else if (pages.length > 1) {
      const merge = confirm(
        `已选择 ${pages.length} 个文件。\n\n确定：合并成一个图集（同一首曲子）\n取消：分别作为独立乐谱`
      );
      if (merge) {
        const guess = guessAlbumName(pages.map((p) => p.name));
        const input = await askInput(
          '图集名称',
          `已合并 ${pages.length} 个文件，给这首曲子起个名字（以后也能重命名）`,
          guess
        );
        const name = input || guess;
        saved = (await createAlbum(name, pages)) ? 1 : 0;
      } else {
        for (const page of pages) {
          const albumName = page.name.replace(/\.[^.]+$/, '');
          if (await createAlbum(albumName, [page])) saved += 1;
          else break;
        }
      }
    }

    if (rejected.length) {
      alert('以下文件格式不支持，已跳过：\n' + rejected.join('\n'));
    }
    if (saved) {
      searchInput.value = '';
      await renderLibrary();
    }
  }

  function bindDropEvents() {
    ['dragenter', 'dragover'].forEach((ev) => {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) addFiles(files);
    });
    dropzone.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.tagName === 'INPUT') return;
      fileInput.click();
    });
    browseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
    fileInput.addEventListener('change', () => {
      addFiles(Array.from(fileInput.files || []));
      fileInput.value = '';
    });
  }
  bindDropEvents();

  /* ---------- 自制乐谱 v2（弹唱谱 / 六线谱） ---------- */
  const $id = (id) => document.getElementById(id);
  const chartEditor = $id('chartEditor');
  const chartEditorTitle = $id('chartEditorTitle');
  const chartTitleInput = $id('chartTitleInput');
  const chartArtistInput = $id('chartArtistInput');
  const chartMetaGrid = $id('chartMetaGrid');
  const chartModeSwitch = $id('chartModeSwitch');
  const chartMeasuresEl = $id('chartMeasures');
  const chartPreview = $id('chartPreview');
  const chartZoomLabel = $id('chartZoomLabel');
  const chartSelFrom = $id('chartSelFrom');
  const chartSelTo = $id('chartSelTo');
  const chartLoopBtn = $id('chartLoopBtn');
  const chartTabTools = $id('chartTabTools');
  const chartPlayBtn = $id('chartPlayBtn');
  const chartStopBtn = $id('chartStopBtn');
  const chartDraftState = $id('chartDraftState');
  const tabString = $id('tabString');
  const tabFret = $id('tabFret');
  const tabDur = $id('tabDur');
  const tabTech = $id('tabTech');
  const tabForce = $id('tabForce');
  const tabTie = $id('tabTie');
  const tabAddNote = $id('tabAddNote');
  const tabDeleteNote = $id('tabDeleteNote');
  const chordPicker = $id('chordPicker');
  const chordPickerList = $id('chordPickerList');
  const chordPickerSearch = $id('chordPickerSearch');
  const chartImportFile = $id('chartImportFile');
  const chartImageFile = $id('chartImageFile');

  const CHART_SECTIONS = ['', '前奏', '主歌', '副歌', '间奏', '桥段', '尾奏'];
  const CHART_REPEATS = ['', '||:', ':||', 'D.C.', 'D.S.', 'Fine', '1 房子', '2 房子'];
  const CHART_STRUMS = ['', '↓', '↑', '↓ ↑', '↓ ↑ ↓ ↑', '分解 53231323', '分解 6321'];
  const CHART_DURATIONS = [
    ['w', '全音符'], ['h', '二分音符'], ['q', '四分音符'],
    ['8', '八分音符'], ['16', '十六分音符'], ['r', '休止符'],
  ];
  const CHART_TECHS = [
    ['', '—'], ['h', 'h 击弦'], ['p', 'p 勾弦'], ['s', 's 滑音'],
    ['b', 'b 推弦'], ['tr', 'tr 颤音'], ['harm', '泛音'],
  ];
  const CHART_KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const CHART_TUNING_LABEL = {
    standard: '标准调弦', dropD: 'Drop D', dadgad: 'DADGAD', openG: 'Open G', openD: 'Open D',
  };
  const CHART_TUNING_MIDI = {
    standard: { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 },
    dropD: { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 38 },
    dadgad: { 1: 62, 2: 57, 3: 55, 4: 50, 5: 45, 6: 38 },
    openG: { 1: 62, 2: 59, 3: 55, 4: 50, 5: 43, 6: 38 },
    openD: { 1: 62, 2: 57, 3: 54, 4: 50, 5: 45, 6: 38 },
  };
  const DUR_BEATS = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25, r: 1 };
  const DUR_GAP = { w: 52, h: 44, q: 34, '8': 26, '16': 20, r: 30 };

  let chartEditing = null;
  let chartModel = null;
  let chartHistory = [];
  let chartRedo = [];
  let chartZoom = 1;
  let chartSel = { from: 1, to: 1 };
  let chartLoop = false;
  let chartActiveMeasure = 0;
  let chartSelNote = null;
  let chartPickTarget = null;
  let chartPlayTimer = 0;
  let chartPlayToken = 0;
  let chartPlayBtnReset = null;
  // 导入的参考图片：保存乐谱时随谱写入同一文件夹
  let chartPendingImages = [];

  function emptyMeasure(kind) {
    return kind === 'tab'
      ? { section: '', notes: [] }
      : { section: '', chords: [], strum: '', repeat: '' };
  }

  function emptyChart() {
    return {
      version: 2,
      kind: 'chord',
      meta: {
        title: '', artist: '', originalKey: 'C', key: 'C', capo: 0,
        timeSig: '4/4', bpm: 84, keySig: 'C', tuning: 'standard',
        difficulty: '入门', note: '',
      },
      measures: [emptyMeasure('chord')],
    };
  }

  // 旧版 [C]歌词 文本 → v2 小节
  function migrateLegacyChart(text) {
    const chart = emptyChart();
    const measures = [];
    String(text || '').split('\n').forEach((raw) => {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) return;
      const re = /\[([^\]]+)\]/g;
      const marks = [];
      let m;
      while ((m = re.exec(line))) {
        marks.push({ name: m[1].trim(), start: m.index, end: m.index + m[0].length });
      }
      if (!marks.length) {
        measures.push({ section: '', chords: [{ name: '', lyric: line.trim() }], strum: '', repeat: '' });
        return;
      }
      const chords = marks.map((mark, i) => {
        const next = i + 1 < marks.length ? marks[i + 1].start : line.length;
        return { name: mark.name, lyric: line.slice(mark.end, next).trim() };
      });
      measures.push({ section: '', chords, strum: '', repeat: '' });
    });
    chart.measures = measures.length ? measures : [emptyMeasure('chord')];
    return chart;
  }

  function normalizeChart(payload) {
    if (!payload || typeof payload !== 'object') return emptyChart();
    if (Number(payload.version) >= 2 && payload.meta && Array.isArray(payload.measures)) {
      const kind = payload.kind === 'tab' ? 'tab' : 'chord';
      const fresh = emptyChart();
      const measures = payload.measures
        .filter((m) => m && typeof m === 'object')
        .map((m) => (kind === 'tab'
          ? { section: m.section || '', notes: Array.isArray(m.notes) ? m.notes : [] }
          : {
            section: m.section || '',
            chords: Array.isArray(m.chords) ? m.chords : [],
            strum: m.strum || '',
            repeat: m.repeat || '',
          }));
      return {
        version: 2,
        kind,
        meta: { ...fresh.meta, ...payload.meta },
        measures: measures.length ? measures : [emptyMeasure(kind)],
      };
    }
    const migrated = migrateLegacyChart(payload.content || '');
    if (payload.title) migrated.meta.title = String(payload.title);
    return migrated;
  }

  function chartSnapshot() {
    return JSON.stringify({
      kind: chartModel.kind,
      meta: chartModel.meta,
      measures: chartModel.measures,
    });
  }

  function chartCommit(mutator) {
    chartHistory.push(chartSnapshot());
    if (chartHistory.length > 80) chartHistory.shift();
    chartRedo = [];
    mutator();
    renderChartMeasures();
    renderChartPreview();
  }

  function chartDraftKey() {
    return 'gs-chart-draft:' + (chartEditing ? chartEditing.folder : 'new');
  }

  function timeSigBeats(sig) {
    const n = parseInt(String(sig || '4/4').split('/')[0], 10);
    return Number.isFinite(n) && n > 0 ? n : 4;
  }

  function chartTuningMidi(tuning) {
    return CHART_TUNING_MIDI[tuning] || CHART_TUNING_MIDI.standard;
  }

  /* ---- 音频：拨弦合成与整谱播放 ---- */

  function schedulePluck(when, freq, dur) {
    const ctx = getCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const peak = 0.18;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0008, when + Math.max(0.25, dur + 0.35));
    osc.connect(gain).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + Math.max(0.3, dur + 0.4));
  }

  function strumChord(name, strings, when, dur) {
    const chord = ALL_CHORDS.find((c) => c.name === name);
    if (!chord) return;
    chord.frets.forEach((fret, i) => {
      if (fret < 0) return;
      const stringNo = 6 - i;
      const midi = (strings[stringNo] || 40) + fret;
      schedulePluck(when + i * 0.022, midiToFreq(midi), dur);
    });
  }

  function scheduleChartMeasure(model, measure, startAt, beat, strings) {
    let cursor = startAt;
    if (model.kind === 'tab') {
      (measure.notes || []).forEach((n) => {
        const d = (DUR_BEATS[n.dur] || 1) * beat;
        if (n.dur !== 'r') {
          const midi = (strings[n.s] || 40) + (Number(n.fret) || 0);
          schedulePluck(cursor, midiToFreq(midi), Math.max(0.22, d * 0.92));
        }
        cursor += d;
      });
      return cursor;
    }
    const chords = (measure.chords || []).filter((c) => c.name);
    const beats = timeSigBeats(model.meta.timeSig);
    const span = beats / Math.max(1, chords.length);
    chords.forEach((c, i) => {
      strumChord(c.name, strings, cursor + i * span * beat, Math.min(1.4, span * beat * 0.95));
    });
    return cursor + beats * beat;
  }

  function stopChartPlayback() {
    chartPlayToken += 1;
    if (chartPlayTimer) {
      clearTimeout(chartPlayTimer);
      chartPlayTimer = 0;
    }
    if (chartPlayBtnReset) {
      const fn = chartPlayBtnReset;
      chartPlayBtnReset = null;
      fn();
    }
  }

  function playChart(chart, opts = {}) {
    const ctx = getCtx();
    if (!ctx) return false;
    stopChartPlayback();
    const token = chartPlayToken;
    const model = normalizeChart(chart);
    const measures = model.measures;
    if (!measures.length) return false;
    const from = clamp((opts.from || 1) - 1, 0, measures.length - 1);
    const to = clamp((opts.to || measures.length) - 1, from, measures.length - 1);
    const bpm = clamp(Number(model.meta.bpm) || 84, 40, 240);
    const beat = 60 / bpm;
    const strings = chartTuningMidi(model.meta.tuning);
    const loop = !!opts.loop;
    if (typeof opts.onEnd === 'function') chartPlayBtnReset = opts.onEnd;

    let index = from;
    const step = () => {
      if (token !== chartPlayToken) return;
      if (index > to) {
        if (loop) {
          index = from;
          chartPlayTimer = setTimeout(step, 60);
        } else {
          const fn = chartPlayBtnReset;
          chartPlayBtnReset = null;
          if (fn) fn();
        }
        return;
      }
      const startAt = ctx.currentTime + 0.07;
      const endAt = scheduleChartMeasure(model, measures[index], startAt, beat, strings);
      index += 1;
      const wait = Math.max(140, (endAt - ctx.currentTime) * 1000);
      chartPlayTimer = setTimeout(step, wait);
    };
    step();
    return true;
  }

  /* ---- 六线谱 SVG ---- */

  function svgNode(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  function tabMeasureSVG(measure, opts = {}) {
    const notes = measure.notes || [];
    const left = 30;
    const top = 26;
    const gap = 12;
    const bottom = top + 5 * gap;
    let cursor = left + 14;
    const xs = notes.map((n) => {
      const x = cursor;
      cursor += DUR_GAP[n.dur] || 32;
      return x;
    });
    const width = Math.max(200, cursor + 24);

    const svg = svgNode('svg', {
      viewBox: `0 0 ${width} ${bottom + 20}`,
      class: 'tab-staff' + (opts.editable ? ' editable' : ''),
      role: 'img',
      'aria-label': '六线谱小节',
    });

    for (let i = 0; i < 6; i++) {
      const y = top + i * gap;
      svg.appendChild(svgNode('line', {
        x1: left, y1: y, x2: width - 10, y2: y,
        class: 'tab-string-line',
        'stroke-width': i === 0 ? 0.8 : 0.8 + i * 0.22,
      }));
      const num = svgNode('text', { x: 8, y: y + 3.5, class: 'tab-string-num' });
      num.textContent = String(i + 1);
      svg.appendChild(num);
    }

    // 小节线（起止）
    svg.appendChild(svgNode('line', {
      x1: left, y1: top - 6, x2: left, y2: bottom + 6, class: 'tab-bar-line',
    }));
    svg.appendChild(svgNode('line', {
      x1: width - 10, y1: top - 6, x2: width - 10, y2: bottom + 6, class: 'tab-bar-line',
    }));
    if (measure.repeat === ':||' || opts.last) {
      svg.appendChild(svgNode('line', {
        x1: width - 15, y1: top - 6, x2: width - 15, y2: bottom + 6, class: 'tab-bar-line thin',
      }));
    }

    // 对齐辅助线：每个音符位置一条淡竖线
    xs.forEach((x) => {
      svg.appendChild(svgNode('line', {
        x1: x, y1: top - 4, x2: x, y2: bottom + 4, class: 'tab-guide',
      }));
    });

    notes.forEach((n, i) => {
      const x = xs[i];
      const isSelected = opts.selectedIndex === i;
      if (n.dur === 'r') {
        const rest = svgNode('text', { x, y: top + 2 * gap + 5, class: 'tab-rest' });
        rest.textContent = 'R';
        svg.appendChild(rest);
      } else {
        const y = top + (n.s - 1) * gap + 4;
        const group = svgNode('g', { class: 'tab-note' + (isSelected ? ' selected' : '') });
        if (isSelected) {
          group.appendChild(svgNode('circle', {
            cx: x, cy: y - 4, r: 8.5, class: 'tab-note-ring',
          }));
        }
        const fret = svgNode('text', { x, y, class: 'tab-fret' });
        fret.textContent = String(n.fret);
        group.appendChild(fret);
        if (n.tech) {
          const tech = svgNode('text', { x: x + 7, y: y - 7, class: 'tab-tech' });
          tech.textContent = n.tech === 'harm' ? '◇' : n.tech;
          group.appendChild(tech);
        }
        if (n.tie && i < notes.length - 1) {
          group.appendChild(svgNode('path', {
            d: `M${x + 6} ${y - 9} Q${(x + xs[i + 1]) / 2} ${y - 16} ${xs[i + 1] - 6} ${y - 9}`,
            class: 'tab-tie',
          }));
        }
        if (n.force) {
          const force = svgNode('text', { x, y: bottom + 16, class: 'tab-force' });
          force.textContent = n.force;
          group.appendChild(force);
        }
        if (opts.editable) {
          group.style.cursor = 'pointer';
          group.addEventListener('click', (e) => {
            e.stopPropagation();
            selectTabNote(opts.index, i);
          });
        }
        svg.appendChild(group);
      }
    });

    if (opts.editable) {
      svg.addEventListener('click', (e) => {
        const rect = svg.getBoundingClientRect();
        if (!rect.height) return;
        const y = ((e.clientY - rect.top) / rect.height) * (bottom + 20);
        const s = clamp(Math.round((y - top) / gap), 0, 5) + 1;
        chartActiveMeasure = opts.index;
        addTabNote(opts.index, { ...readTabTools(), s });
      });
    }
    return svg;
  }

  /* ---- 编辑器：元信息 / 模式 ---- */

  function syncChartForm() {
    const meta = chartModel.meta;
    chartTitleInput.value = meta.title || '';
    chartArtistInput.value = meta.artist || '';
    $id('chartOriginalKey').value = meta.originalKey || 'C';
    $id('chartKey').value = meta.key || 'C';
    $id('chartCapo').value = String(meta.capo || 0);
    $id('chartTimeSig').value = meta.timeSig || '4/4';
    $id('chartBpm').value = meta.bpm || 84;
    $id('chartKeySig').value = meta.keySig || 'C';
    $id('chartTuning').value = meta.tuning || 'standard';
    $id('chartDifficulty').value = meta.difficulty || '入门';
    $id('chartNote').value = meta.note || '';
    chartActiveMeasure = 0;
    chartSelNote = null;
    chartSel = { from: 1, to: Math.max(1, chartModel.measures.length) };
    chartLoop = false;
    chartLoopBtn.classList.remove('active');
    chartZoom = 1;
    applyChartZoom();
    syncChartMode();
    refreshChartSelection();
    updateTabNoteButtons();
    chartDraftState.textContent = '';
  }

  function syncChartMode() {
    [...chartModeSwitch.querySelectorAll('.seg')].forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === chartModel.kind);
    });
    chartTabTools.hidden = chartModel.kind !== 'tab';
  }

  function applyChartZoom() {
    chartPreview.style.transform = `scale(${chartZoom})`;
    chartPreview.style.width = `${100 / chartZoom}%`;
    chartZoomLabel.textContent = Math.round(chartZoom * 100) + '%';
  }

  function refreshChartSelection() {
    const count = Math.max(1, chartModel.measures.length);
    chartSel.from = clamp(chartSel.from || 1, 1, count);
    chartSel.to = clamp(chartSel.to || count, chartSel.from, count);
    chartSelFrom.value = String(chartSel.from);
    chartSelTo.value = String(chartSel.to);
    chartSelFrom.max = String(count);
    chartSelTo.max = String(count);
  }

  function openChartEditor(rec) {
    chartEditing = rec || null;
    chartPendingImages = [];
    chartEditorTitle.textContent = rec ? `编辑《${rec.name}》` : '新建自制乐谱';
    chartModel = rec ? normalizeChart(rec.chart) : emptyChart();
    if (rec) chartModel.meta.title = rec.name;
    chartHistory = [];
    chartRedo = [];

    // 有草稿时询问是否恢复
    let draft = null;
    try {
      draft = JSON.parse(localStorage.getItem(chartDraftKey()) || 'null');
    } catch (err) {
      draft = null;
    }
    if (draft && draft.measures) {
      if (confirm('发现上次未保存的草稿，是否恢复？')) {
        chartModel = normalizeChart(draft);
        if (rec) chartModel.meta.title = rec.name;
        chartDraftState.textContent = '已恢复草稿';
      } else {
        localStorage.removeItem(chartDraftKey());
      }
    }

    chartEditor.hidden = false;
    syncChartForm();
    renderChartMeasures();
    renderChartPreview();
    setTimeout(() => {
      chartTitleInput.focus();
      if (chartTitleInput.value) chartTitleInput.select();
    }, 30);
  }

  function closeChartEditor() {
    stopChartPlayback();
    chordPicker.hidden = true;
    chartEditor.hidden = true;
    chartEditing = null;
    chartModel = null;
    chartHistory = [];
    chartRedo = [];
  }

  function collectChartPayload() {
    chartModel.meta.title = chartTitleInput.value.trim() || chartModel.meta.title || '';
    chartModel.meta.bpm = clamp(Number(chartModel.meta.bpm) || 84, 40, 240);
    return {
      version: 2,
      kind: chartModel.kind,
      meta: { ...chartModel.meta },
      measures: chartModel.measures,
    };
  }

  async function submitChart() {
    const payload = collectChartPayload();
    if (chartEditing) {
      try {
        await saveChart(chartEditing, payload);
        await flushChartImages(chartEditing.folder);
        localStorage.removeItem(chartDraftKey());
        closeChartEditor();
        await renderLibrary();
      } catch (err) {
        alert(`保存失败：${err.message || '请重试'}`);
      }
      return;
    }
    const title = payload.meta.title.trim();
    if (!title) {
      alert('请填写曲名。');
      chartTitleInput.focus();
      return;
    }
    payload.meta.title = title;
    const folder = await createChart(title, payload);
    if (!folder) return;
    try {
      await flushChartImages(folder);
    } catch (err) {
      alert(`参考图片保存失败：${err.message || '请重试'}`);
    }
    localStorage.removeItem(chartDraftKey());
    closeChartEditor();
    await renderLibrary();
  }

  async function saveChartAs() {
    const payload = collectChartPayload();
    const base = payload.meta.title.trim() || '自制乐谱';
    const name = await askInput('另存为', '输入新乐谱名称，会保存为一份新乐谱', `${base} 副本`);
    if (!name) return;
    const clean = name.trim();
    if (!clean) return;
    payload.meta.title = clean;
    const folder = await createChart(clean, payload);
    if (!folder) return;
    try {
      await flushChartImages(folder);
    } catch (err) {
      alert(`参考图片保存失败：${err.message || '请重试'}`);
    }
    localStorage.removeItem(chartDraftKey());
    closeChartEditor();
    await renderLibrary();
  }

  /* ---- 编辑器：小节列表 ---- */

  function makeSelect(options, value, onChange, className) {
    const sel = document.createElement('select');
    sel.className = className || 'cm-select';
    options.forEach((item) => {
      const opt = document.createElement('option');
      if (Array.isArray(item)) {
        opt.value = item[0];
        opt.textContent = item[1];
      } else {
        opt.value = item;
        opt.textContent = item || '段落';
      }
      sel.appendChild(opt);
    });
    sel.value = value || '';
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  function updateTabNoteButtons() {
    tabAddNote.textContent = chartSelNote ? '更新音符' : '＋ 添加音符';
    tabDeleteNote.disabled = !chartSelNote;
  }

  function readTabTools() {
    return {
      s: Number(tabString.value) || 1,
      fret: clamp(Number(tabFret.value) || 0, 0, 24),
      dur: tabDur.value || 'q',
      tech: tabTech.value || '',
      tie: !!tabTie.checked,
      force: tabForce.value || '',
    };
  }

  function selectTabNote(measureIndex, noteIndex) {
    const measure = chartModel.measures[measureIndex];
    if (!measure || !measure.notes || !measure.notes[noteIndex]) return;
    const note = measure.notes[noteIndex];
    chartSelNote = { m: measureIndex, n: noteIndex };
    chartActiveMeasure = measureIndex;
    tabString.value = String(note.s || 1);
    tabFret.value = String(note.fret || 0);
    tabDur.value = note.dur || 'q';
    tabTech.value = note.tech || '';
    tabForce.value = note.force || '';
    tabTie.checked = !!note.tie;
    renderChartMeasures();
  }

  function addTabNote(measureIndex, note) {
    chartCommit(() => {
      const measure = chartModel.measures[measureIndex];
      if (!measure) return;
      if (chartSelNote && chartSelNote.m === measureIndex && measure.notes[chartSelNote.n]) {
        measure.notes[chartSelNote.n] = note;
        chartSelNote = null;
      } else {
        measure.notes.push(note);
      }
    });
    updateTabNoteButtons();
  }

  function renderChartMeasures() {
    if (!chartModel) return;
    if (!chartModel.measures.length) chartModel.measures.push(emptyMeasure(chartModel.kind));
    chartActiveMeasure = clamp(chartActiveMeasure, 0, chartModel.measures.length - 1);
    if (chartSelNote && chartSelNote.m >= chartModel.measures.length) chartSelNote = null;
    refreshChartSelection();
    updateTabNoteButtons();
    chartMeasuresEl.innerHTML = '';

    chartModel.measures.forEach((measure, idx) => {
      const card = document.createElement('div');
      card.className = 'chart-measure' + (idx === chartActiveMeasure ? ' active' : '');

      const head = document.createElement('div');
      head.className = 'cm-head';
      const num = document.createElement('button');
      num.type = 'button';
      num.className = 'cm-index';
      num.textContent = String(idx + 1).padStart(2, '0');
      num.title = '点击设为选区起点，Shift+点击设为终点（用于循环练习）';
      num.addEventListener('click', (e) => {
        e.stopPropagation();
        const at = idx + 1;
        if (e.shiftKey) {
          chartSel.to = clamp(at, chartSel.from, chartModel.measures.length);
        } else {
          chartSel.from = at;
          chartSel.to = at;
        }
        refreshChartSelection();
        paintChartRange();
      });
      head.appendChild(num);

      const sectionSel = makeSelect(
        CHART_SECTIONS.map((s) => [s, s || '段落']),
        measure.section || '',
        (v) => chartCommit(() => { measure.section = v; })
      );
      head.appendChild(sectionSel);

      if (chartModel.kind === 'chord') {
        head.appendChild(makeSelect(
          CHART_STRUMS.map((s) => [s, s || '节奏']),
          measure.strum || '',
          (v) => chartCommit(() => { measure.strum = v; })
        ));
        head.appendChild(makeSelect(
          CHART_REPEATS.map((s) => [s, s || '反复']),
          measure.repeat || '',
          (v) => chartCommit(() => { measure.repeat = v; })
        ));
      } else {
        const count = document.createElement('span');
        count.className = 'cm-count';
        count.textContent = `${(measure.notes || []).length} 个音符`;
        head.appendChild(count);
      }

      const tools = document.createElement('div');
      tools.className = 'cm-tools';
      const addAfter = document.createElement('button');
      addAfter.type = 'button';
      addAfter.textContent = '＋';
      addAfter.title = '在后面插入小节';
      addAfter.addEventListener('click', () => {
        chartCommit(() => {
          chartModel.measures.splice(idx + 1, 0, emptyMeasure(chartModel.kind));
          chartActiveMeasure = idx + 1;
          chartSelNote = null;
        });
      });
      const up = document.createElement('button');
      up.type = 'button';
      up.textContent = '↑';
      up.title = '上移';
      up.disabled = idx === 0;
      up.addEventListener('click', () => {
        chartCommit(() => {
          const arr = chartModel.measures;
          [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
          chartActiveMeasure = idx - 1;
        });
      });
      const down = document.createElement('button');
      down.type = 'button';
      down.textContent = '↓';
      down.title = '下移';
      down.disabled = idx === chartModel.measures.length - 1;
      down.addEventListener('click', () => {
        chartCommit(() => {
          const arr = chartModel.measures;
          [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
          chartActiveMeasure = idx + 1;
        });
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'danger';
      del.textContent = '×';
      del.title = '删除小节';
      del.addEventListener('click', () => {
        chartCommit(() => {
          if (chartModel.measures.length === 1) {
            chartModel.measures[0] = emptyMeasure(chartModel.kind);
          } else {
            chartModel.measures.splice(idx, 1);
            chartActiveMeasure = clamp(idx, 0, chartModel.measures.length - 1);
          }
          chartSelNote = null;
        });
      });
      tools.append(addAfter, up, down, del);
      head.appendChild(tools);
      card.appendChild(head);

      if (chartModel.kind === 'chord') {
        const body = document.createElement('div');
        body.className = 'cm-chords';
        (measure.chords || []).forEach((chord, ci) => {
          const seg = document.createElement('div');
          seg.className = 'cm-chord';

          const nameBtn = document.createElement('button');
          nameBtn.type = 'button';
          nameBtn.className = 'cm-chord-name';
          nameBtn.textContent = chord.name || '—';
          nameBtn.title = '点击查看和弦库指法';
          nameBtn.addEventListener('click', () => openChordModal(chord.name));

          const editBtn = document.createElement('button');
          editBtn.type = 'button';
          editBtn.className = 'cm-mini';
          editBtn.textContent = '✎';
          editBtn.title = '更换和弦';
          editBtn.addEventListener('click', () => openChordPicker({ mode: 'edit', measureIndex: idx, chordIndex: ci }));

          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'cm-mini danger';
          delBtn.textContent = '×';
          delBtn.title = '删除这组和弦';
          delBtn.addEventListener('click', () => {
            chartCommit(() => { measure.chords.splice(ci, 1); });
          });

          const lyric = document.createElement('input');
          lyric.type = 'text';
          lyric.className = 'cm-lyric';
          lyric.value = chord.lyric || '';
          lyric.placeholder = '歌词';
          lyric.maxLength = 60;
          lyric.addEventListener('input', () => {
            chord.lyric = lyric.value;
            renderChartPreview();
          });

          const nameRow = document.createElement('div');
          nameRow.className = 'cm-chord-head';
          nameRow.append(nameBtn, editBtn, delBtn);
          seg.append(nameRow, lyric);
          body.appendChild(seg);        });

        const addChord = document.createElement('button');
        addChord.type = 'button';
        addChord.className = 'cm-add-chord';
        addChord.textContent = '＋ 和弦';
        addChord.addEventListener('click', () => openChordPicker({ mode: 'add', measureIndex: idx }));
        body.appendChild(addChord);
        card.appendChild(body);
      } else {
        const body = document.createElement('div');
        body.className = 'cm-tab';
        const selectedIndex = chartSelNote && chartSelNote.m === idx ? chartSelNote.n : -1;
        body.appendChild(tabMeasureSVG(measure, {
          editable: true,
          index: idx,
          selectedIndex,
          last: idx === chartModel.measures.length - 1,
        }));
        card.appendChild(body);
      }

      card.addEventListener('click', (e) => {
        if (e.target.closest('button, select, input')) return;
        chartActiveMeasure = idx;
        [...chartMeasuresEl.children].forEach((c, i) => c.classList.toggle('active', i === idx));
        refreshChartSelection();
      });

      chartMeasuresEl.appendChild(card);
    });
    paintChartRange();
  }

  function paintChartRange() {
    [...chartMeasuresEl.children].forEach((card, i) => {
      const at = i + 1;
      card.classList.toggle('in-range', at >= chartSel.from && at <= chartSel.to);
    });
  }

  /* ---- 实时预览 / 乐谱渲染 ---- */

  function renderChartPreview() {
    if (!chartModel) return;
    chartPreview.innerHTML = '';
    renderChartScore(chartPreview, chartModel, { compact: true });
    applyChartZoom();
  }

  function scoreChip(text) {
    const chip = document.createElement('span');
    chip.className = 'score-chip';
    chip.textContent = text;
    return chip;
  }

  function renderChartScore(container, chart, opts = {}) {
    const model = normalizeChart(chart);
    const meta = model.meta;

    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'score-sheet';

    const head = document.createElement('div');
    head.className = 'score-head';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'score-title-wrap';
    const title = document.createElement('h2');
    title.className = 'score-title';
    title.textContent = meta.title || opts.title || '未命名乐谱';
    const artist = document.createElement('p');
    artist.className = 'score-artist';
    artist.textContent = meta.artist || '';
    titleWrap.append(title, artist);
    head.appendChild(titleWrap);

    const chipRow = document.createElement('div');
    chipRow.className = 'score-chips';
    const chips = [
      meta.key ? `选调 ${meta.key}` : '',
      meta.originalKey && meta.originalKey !== meta.key ? `原调 ${meta.originalKey}` : '',
      `Capo ${Number(meta.capo) || 0}`,
      meta.timeSig,
      `${meta.bpm} BPM`,
      CHART_TUNING_LABEL[meta.tuning] || meta.tuning,
      meta.difficulty ? `难度 ${meta.difficulty}` : '',
      meta.keySig ? `调号 ${meta.keySig}` : '',
      model.kind === 'tab' ? '六线指弹谱' : '弹唱和弦谱',
    ].filter(Boolean);
    chips.forEach((c) => chipRow.appendChild(scoreChip(c)));
    head.appendChild(chipRow);

    if (meta.note) {
      const note = document.createElement('p');
      note.className = 'score-note-text';
      note.textContent = meta.note;
      head.appendChild(note);
    }

    if (opts.viewer) {
      const controls = document.createElement('div');
      controls.className = 'score-controls';
      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'btn primary small';
      playBtn.textContent = '▶ 示范播放';
      playBtn.addEventListener('click', () => {
        const ok = playChart(model, {
          loop: false,
          onEnd: () => { playBtn.textContent = '▶ 示范播放'; },
        });
        if (!ok) alert('音频启动失败，请重试。');
        else playBtn.textContent = '■ 播放中…';
      });
      const stopBtn = document.createElement('button');
      stopBtn.type = 'button';
      stopBtn.className = 'btn ghost small';
      stopBtn.textContent = '■ 停止';
      stopBtn.addEventListener('click', () => stopChartPlayback());
      const tuneBtn = document.createElement('button');
      tuneBtn.type = 'button';
      tuneBtn.className = 'btn ghost small';
      tuneBtn.textContent = '◎ 音准检测';
      tuneBtn.addEventListener('click', () => {
        stopChartPlayback();
        closeViewer();
        const tab = document.querySelector('.tab[data-tab="tuner"]');
        if (tab) tab.click();
        setTimeout(() => alert('已切换到调音器：开启麦克风后弹奏，即可对照谱子检查音准。'), 120);
      });
      controls.append(playBtn, stopBtn, tuneBtn);
      head.appendChild(controls);
    }

    scrollWrap.appendChild(head);

    if (model.kind === 'tab') {
      const body = document.createElement('div');
      body.className = 'score-tab-body';
      let lastSection = '';
      model.measures.forEach((measure, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'score-tab-measure';
        if (measure.section && measure.section !== lastSection) {
          lastSection = measure.section;
          const label = document.createElement('span');
          label.className = 'score-section';
          label.textContent = measure.section;
          wrap.appendChild(label);
        }
        const svg = tabMeasureSVG(measure, { last: i === model.measures.length - 1 });
        wrap.appendChild(svg);
        body.appendChild(wrap);
      });
      scrollWrap.appendChild(body);
    } else {
      const body = document.createElement('div');
      body.className = 'score-chords';
      let lastSection = '';
      model.measures.forEach((measure) => {
        if (measure.section && measure.section !== lastSection) {
          lastSection = measure.section;
          const label = document.createElement('div');
          label.className = 'score-section-label';
          label.textContent = measure.section;
          body.appendChild(label);
        }

        const row = document.createElement('div');
        row.className = 'score-measure';
        const marks = [];
        if (measure.repeat) marks.push(measure.repeat);
        if (measure.strum) marks.push(measure.strum);
        if (marks.length) {
          const mark = document.createElement('span');
          mark.className = 'score-mark';
          mark.textContent = marks.join('  ');
          row.appendChild(mark);
        }

        const line = document.createElement('div');
        line.className = 'score-chord-line';
        if (!(measure.chords || []).length) {
          const empty = document.createElement('span');
          empty.className = 'score-empty';
          empty.textContent = '（空小节）';
          line.appendChild(empty);
        } else {
          measure.chords.forEach((chord) => {
            const seg = document.createElement('span');
            seg.className = 'score-seg';
            if (chord.name) {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'score-chord';
              btn.textContent = chord.name;
              btn.title = '点击查看和弦库指法';
              btn.addEventListener('click', () => openChordModal(chord.name));
              seg.appendChild(btn);
            }
            const lyric = document.createElement('span');
            lyric.className = 'score-lyric';
            lyric.textContent = chord.lyric || '\u00a0';
            seg.appendChild(lyric);
            line.appendChild(seg);
          });
        }
        row.appendChild(line);
        body.appendChild(row);
      });
      scrollWrap.appendChild(body);
    }

    container.appendChild(scrollWrap);
  }

  /* ---- 和弦选择器 ---- */

  function openChordPicker(target) {
    chartPickTarget = target;
    chordPicker.hidden = false;
    chordPickerSearch.value = '';
    renderChordPickerList('');
    setTimeout(() => chordPickerSearch.focus(), 30);
  }

  function renderChordPickerList(query) {
    const all = ALL_CHORDS.map((c) => c.name);
    const common = [
      'C', 'G', 'D', 'A', 'E', 'F', 'Am', 'Em', 'Dm', 'Bm',
      'Fmaj7', 'Cmaj7', 'G7', 'C7', 'D7', 'Am7', 'Em7', 'Dm7', 'Asus4', 'Dsus4',
    ].filter((n) => all.includes(n));
    const names = [...new Set([...common, ...all])];
    const q = query.trim().toLowerCase();
    chordPickerList.innerHTML = '';
    names
      .filter((n) => !q || n.toLowerCase().includes(q))
      .slice(0, 160)
      .forEach((name) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chord-pick-chip';
        btn.textContent = name;
        btn.addEventListener('click', () => applyChordPick(name));
        chordPickerList.appendChild(btn);
      });
    if (!chordPickerList.children.length) {
      chordPickerList.innerHTML = '<p class="hint">没有匹配的和弦。</p>';
    }
  }

  function applyChordPick(name) {
    const target = chartPickTarget;
    chordPicker.hidden = true;
    chartPickTarget = null;
    if (!target) return;
    const measure = chartModel.measures[target.measureIndex];
    if (!measure) return;
    if (target.mode === 'add') {
      chartCommit(() => measure.chords.push({ name, lyric: '' }));
    } else if (measure.chords[target.chordIndex]) {
      chartCommit(() => { measure.chords[target.chordIndex].name = name; });
    }
  }

  /* ---- 编辑器事件绑定 ---- */

  // 曲头表单选项
  CHART_KEYS.forEach((k) => {
    [$id('chartOriginalKey'), $id('chartKey')].forEach((sel) => {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      sel.appendChild(opt);
    });
  });
  for (let i = 0; i <= 12; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = i === 0 ? '不夹（0 品）' : `${i} 品`;
    $id('chartCapo').appendChild(opt);
  }

  function onMetaChange(e) {
    const field = e.target.closest('[data-meta]');
    if (!field || !chartModel) return;
    const key = field.dataset.meta;
    chartModel.meta[key] = key === 'bpm'
      ? clamp(Number(field.value) || 84, 40, 240)
      : field.value;
    if (key === 'title') chartModel.meta.title = field.value.trim();
    renderChartPreview();
  }
  chartMetaGrid.addEventListener('input', onMetaChange);
  chartMetaGrid.addEventListener('change', onMetaChange);

  [...chartModeSwitch.querySelectorAll('.seg')].forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (!chartModel || mode === chartModel.kind) return;
      const hasContent = chartModel.measures.some(
        (m) => (m.chords && m.chords.length) || (m.notes && m.notes.length)
      );
      if (hasContent && !confirm('切换模式会清空当前小节内容（弹唱谱与六线谱不能共用小节），继续？')) return;
      chartCommit(() => {
        chartModel.kind = mode;
        chartModel.measures = [emptyMeasure(mode)];
        chartActiveMeasure = 0;
        chartSelNote = null;
        chartSel = { from: 1, to: 1 };
      });
      syncChartMode();
    });
  });

  $id('chartUndoBtn').addEventListener('click', () => {
    if (!chartHistory.length) return;
    chartRedo.push(chartSnapshot());
    const prev = JSON.parse(chartHistory.pop());
    chartModel.kind = prev.kind;
    chartModel.meta = prev.meta;
    chartModel.measures = prev.measures;
    chartSelNote = null;
    syncChartMode();
    renderChartMeasures();
    renderChartPreview();
  });

  $id('chartRedoBtn').addEventListener('click', () => {
    if (!chartRedo.length) return;
    chartHistory.push(chartSnapshot());
    const next = JSON.parse(chartRedo.pop());
    chartModel.kind = next.kind;
    chartModel.meta = next.meta;
    chartModel.measures = next.measures;
    chartSelNote = null;
    syncChartMode();
    renderChartMeasures();
    renderChartPreview();
  });

  $id('chartAddMeasure').addEventListener('click', () => {
    chartCommit(() => {
      chartModel.measures.push(emptyMeasure(chartModel.kind));
      chartActiveMeasure = chartModel.measures.length - 1;
      chartSelNote = null;
    });
  });

  chartLoopBtn.addEventListener('click', () => {
    chartLoop = !chartLoop;
    chartLoopBtn.classList.toggle('active', chartLoop);
    chartLoopBtn.title = chartLoop ? '播放时循环选区内的小节（已开启）' : '播放时循环选区内的小节';
  });

  [chartSelFrom, chartSelTo].forEach((input) => {
    input.addEventListener('change', () => {
      const count = chartModel.measures.length;
      chartSel.from = clamp(Number(chartSelFrom.value) || 1, 1, count);
      chartSel.to = clamp(Number(chartSelTo.value) || count, chartSel.from, count);
      refreshChartSelection();
    });
  });

  $id('chartZoomIn').addEventListener('click', () => {
    chartZoom = clamp(chartZoom + 0.1, 0.6, 1.8);
    applyChartZoom();
  });
  $id('chartZoomOut').addEventListener('click', () => {
    chartZoom = clamp(chartZoom - 0.1, 0.6, 1.8);
    applyChartZoom();
  });

  chartPlayBtn.addEventListener('click', () => {
    if (!chartModel) return;
    const ok = playChart(chartModel, {
      from: chartSel.from,
      to: chartSel.to,
      loop: chartLoop,
      onEnd: () => { chartPlayBtn.textContent = '▶ 示范播放'; },
    });
    if (!ok) {
      alert('音频启动失败，请重试。');
      return;
    }
    chartPlayBtn.textContent = chartLoop ? '▶ 循环播放中…' : '▶ 播放中…';
  });
  chartStopBtn.addEventListener('click', () => stopChartPlayback());

  tabAddNote.addEventListener('click', () => {
    const index = clamp(chartActiveMeasure, 0, chartModel.measures.length - 1);
    addTabNote(index, readTabTools());
  });
  tabDeleteNote.addEventListener('click', () => {
    if (!chartSelNote) return;
    const { m, n } = chartSelNote;
    chartCommit(() => {
      const measure = chartModel.measures[m];
      if (measure && measure.notes) measure.notes.splice(n, 1);
      chartSelNote = null;
    });
  });

  $id('chartDraftBtn').addEventListener('click', () => {
    try {
      localStorage.setItem(chartDraftKey(), JSON.stringify(collectChartPayload()));
      chartDraftState.textContent = chartPendingImages.length
        ? `草稿已保存（参考图需保存乐谱后写入） ${new Date().toTimeString().slice(0, 5)}`
        : `草稿已保存 ${new Date().toTimeString().slice(0, 5)}`;
    } catch (err) {
      alert('草稿保存失败，可能是本地存储空间不足。');
    }
  });

  $id('chartExportBtn').addEventListener('click', () => {
    const payload = collectChartPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(payload.meta.title || '自制乐谱').replace(/[\\/:*?"<>|]/g, ' ')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  });

  $id('chartImportBtn').addEventListener('click', () => chartImportFile.click());
  chartImportFile.addEventListener('change', async () => {
    const file = chartImportFile.files && chartImportFile.files[0];
    chartImportFile.value = '';
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      chartModel = normalizeChart(payload);
      if (!chartModel.meta.title) chartModel.meta.title = file.name.replace(/\.json$/i, '');
      chartHistory = [];
      chartRedo = [];
      syncChartForm();
      renderChartMeasures();
      renderChartPreview();
      chartDraftState.textContent = '已导入文件内容';
    } catch (err) {
      alert('导入失败：文件不是有效的自制谱 JSON。');
    }
  });

  /* ---- 图片导入 / 导出 ---- */

  const EXPORT_FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
  const EXPORT_INK = '#1b1f27';
  const EXPORT_MUTED = '#6b7280';
  const EXPORT_ACCENT = '#a9670a';
  const EXPORT_LINE = '#d7dbe3';

  function canvasRoundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    const raw = String(text || '');
    if (!raw) return [''];
    const lines = [];
    let current = '';
    for (const ch of raw) {
      if (ch === '\n') {
        lines.push(current);
        current = '';
        continue;
      }
      const next = current + ch;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = ch;
      } else {
        current = next;
      }
    }
    if (current || !lines.length) lines.push(current);
    return lines;
  }

  function paintCanvasChord(ctx, model, box) {
    let y = box.y;
    let lastSection = '';
    const mGap = 14;

    model.measures.forEach((measure) => {
      if (measure.section && measure.section !== lastSection) {
        lastSection = measure.section;
        y += 6;
        if (!box.measureOnly) {
          ctx.fillStyle = EXPORT_ACCENT;
          ctx.fillRect(box.x - 10, y + 2, 3, 14);
          ctx.font = `700 12px ${EXPORT_FONT}`;
          ctx.fillStyle = EXPORT_ACCENT;
          ctx.fillText(measure.section, box.x, y);
        }
        y += 22;
      }

      const marks = [measure.repeat, measure.strum].filter(Boolean).join('  ');
      if (marks) {
        if (!box.measureOnly) {
          ctx.font = `400 11px ${EXPORT_FONT}`;
          ctx.fillStyle = EXPORT_ACCENT;
          ctx.fillText(marks, box.x, y);
        }
        y += 17;
      }

      const chords = measure.chords || [];
      if (!chords.length) {
        if (!box.measureOnly) {
          ctx.font = `400 12px ${EXPORT_FONT}`;
          ctx.fillStyle = '#9aa1ad';
          ctx.fillText('（空小节）', box.x, y + 2);
        }
        y += 26 + mGap;
        return;
      }

      let cx = box.x;
      let rowY = y;
      chords.forEach((chord) => {
        ctx.font = `700 14px ${EXPORT_FONT}`;
        const nameW = ctx.measureText(chord.name || '').width;
        ctx.font = `400 13.5px ${EXPORT_FONT}`;
        const lyricW = ctx.measureText(chord.lyric || ' ').width;
        const segW = Math.min(box.width, Math.max(30, nameW, lyricW) + 4);
        if (cx > box.x && cx + segW > box.x + box.width) {
          cx = box.x;
          rowY += 40;
        }
        if (!box.measureOnly) {
          if (chord.name) {
            ctx.font = `700 14px ${EXPORT_FONT}`;
            ctx.fillStyle = EXPORT_ACCENT;
            ctx.fillText(chord.name, cx, rowY);
          }
          ctx.font = `400 13.5px ${EXPORT_FONT}`;
          ctx.fillStyle = EXPORT_INK;
          ctx.fillText(chord.lyric || '', cx, rowY + 20);
        }
        cx += Math.max(segW, 34) + 6;
      });
      y = rowY + 40;

      if (!box.measureOnly && measure !== model.measures[model.measures.length - 1]) {
        ctx.save();
        ctx.strokeStyle = '#e5e8ee';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(box.x, y + mGap / 2);
        ctx.lineTo(box.x + box.width, y + mGap / 2);
        ctx.stroke();
        ctx.restore();
      }
      y += mGap;
    });

    return y;
  }

  function paintCanvasTab(ctx, model, box) {
    let y = box.y;
    let lastSection = '';
    const topGap = 18;
    const stringGap = 14;
    const staffH = stringGap * 5;
    const staffW = Math.min(box.width, 880);

    model.measures.forEach((measure) => {
      if (measure.section && measure.section !== lastSection) {
        lastSection = measure.section;
        y += 4;
        if (!box.measureOnly) {
          ctx.font = `700 12px ${EXPORT_FONT}`;
          ctx.fillStyle = EXPORT_ACCENT;
          ctx.fillText(measure.section, box.x, y);
        }
        y += 20;
      }

      const notes = measure.notes || [];
      const left = box.x + 34;
      let cursor = left + 16;
      const xs = notes.map((n) => {
        const x = cursor;
        cursor += DUR_GAP[n.dur] || 32;
        return x;
      });
      const right = box.x + clamp(cursor - box.x + 14, 620, staffW);
      const staffTop = y + topGap;

      if (!box.measureOnly) {
        // 六根弦
        for (let i = 0; i < 6; i++) {
          const sy = staffTop + i * stringGap;
          ctx.strokeStyle = '#c8cdd6';
          ctx.lineWidth = 0.8 + i * 0.15;
          ctx.beginPath();
          ctx.moveTo(left, sy);
          ctx.lineTo(right, sy);
          ctx.stroke();
          ctx.font = `400 10px ${EXPORT_FONT}`;
          ctx.fillStyle = EXPORT_MUTED;
          ctx.textAlign = 'right';
          ctx.fillText(String(i + 1), left - 10, sy - 5);
          ctx.textAlign = 'left';
        }

        // 小节线
        ctx.strokeStyle = '#5b6270';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(left, staffTop - 7);
        ctx.lineTo(left, staffTop + staffH + 7);
        ctx.moveTo(right, staffTop - 7);
        ctx.lineTo(right, staffTop + staffH + 7);
        ctx.stroke();

        notes.forEach((n, i) => {
          const x = xs[i];
          if (n.dur === 'r') {
            ctx.font = `600 11px ${EXPORT_FONT}`;
            ctx.fillStyle = EXPORT_MUTED;
            ctx.textAlign = 'center';
            ctx.fillText('R', x, staffTop + stringGap * 2 - 7);
            ctx.textAlign = 'left';
            return;
          }
          const ny = staffTop + (n.s - 1) * stringGap;
          // 白色底遮住弦线，保证品位数字清晰
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x - 8, ny - 9, 17, 18);
          ctx.font = `600 12.5px ${EXPORT_FONT}`;
          ctx.fillStyle = EXPORT_INK;
          ctx.textAlign = 'center';
          ctx.fillText(String(n.fret), x, ny - 7);
          ctx.textAlign = 'left';
          if (n.tech) {
            ctx.font = `400 10px ${EXPORT_FONT}`;
            ctx.fillStyle = EXPORT_ACCENT;
            ctx.fillText(n.tech === 'harm' ? '◇' : n.tech, x + 8, ny - 17);
          }
          if (n.force) {
            ctx.font = `400 10px ${EXPORT_FONT}`;
            ctx.fillStyle = EXPORT_MUTED;
            ctx.textAlign = 'center';
            ctx.fillText(n.force, x, staffTop + staffH + 12);
            ctx.textAlign = 'left';
          }
          if (n.tie && i < notes.length - 1) {
            const nx = xs[i + 1];
            ctx.strokeStyle = EXPORT_MUTED;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 7, ny - 10);
            ctx.quadraticCurveTo((x + nx) / 2, ny - 19, nx - 7, ny - 10);
            ctx.stroke();
          }
        });
      }

      y = staffTop + staffH + 28;
    });

    return y;
  }

  function paintChartSheet(ctx, model, opts) {
    const width = opts.width || 1000;
    const pad = 48;
    const contentW = width - pad * 2;
    const meta = model.meta;
    let y = pad;

    if (!opts.measureOnly) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, opts.height || 600);
    }
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    // 曲名 / 作者
    ctx.font = `700 30px ${EXPORT_FONT}`;
    ctx.fillStyle = EXPORT_INK;
    ctx.fillText(meta.title || '未命名乐谱', pad, y);
    y += 42;

    if (meta.artist) {
      ctx.font = `400 14px ${EXPORT_FONT}`;
      ctx.fillStyle = EXPORT_MUTED;
      ctx.fillText(meta.artist, pad, y);
      y += 22;
    }

    // 元信息 chip
    const chips = [
      meta.key ? `选调 ${meta.key}` : '',
      meta.originalKey && meta.originalKey !== meta.key ? `原调 ${meta.originalKey}` : '',
      `Capo ${Number(meta.capo) || 0}`,
      meta.timeSig,
      `${meta.bpm} BPM`,
      CHART_TUNING_LABEL[meta.tuning] || meta.tuning,
      meta.difficulty ? `难度 ${meta.difficulty}` : '',
      meta.keySig ? `调号 ${meta.keySig}` : '',
      model.kind === 'tab' ? '六线指弹谱' : '弹唱和弦谱',
    ].filter(Boolean);

    const chipH = 22;
    let cx = pad;
    let cy = y;
    chips.forEach((text) => {
      ctx.font = `400 12px ${EXPORT_FONT}`;
      const w = ctx.measureText(text).width + 18;
      if (cx > pad && cx + w > pad + contentW) {
        cx = pad;
        cy += chipH + 8;
      }
      if (!opts.measureOnly) {
        canvasRoundRect(ctx, cx, cy, w, chipH, 11);
        ctx.strokeStyle = EXPORT_LINE;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = EXPORT_MUTED;
        ctx.fillText(text, cx + 9, cy + 5);
      }
      cx += w + 8;
    });
    y = cy + chipH + 12;

    if (meta.note) {
      ctx.font = `400 13px ${EXPORT_FONT}`;
      ctx.fillStyle = EXPORT_MUTED;
      wrapCanvasText(ctx, meta.note, contentW).forEach((line) => {
        if (!opts.measureOnly) ctx.fillText(line, pad, y);
        y += 20;
      });
    }

    y += 8;
    if (!opts.measureOnly) {
      ctx.strokeStyle = EXPORT_LINE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, y + 0.5);
      ctx.lineTo(pad + contentW, y + 0.5);
      ctx.stroke();
    }
    y += 16;

    y = model.kind === 'tab'
      ? paintCanvasTab(ctx, model, { x: pad, y, width: contentW, measureOnly: opts.measureOnly })
      : paintCanvasChord(ctx, model, { x: pad, y, width: contentW, measureOnly: opts.measureOnly });

    y += 12;
    if (!opts.measureOnly) {
      ctx.font = `400 11px ${EXPORT_FONT}`;
      ctx.fillStyle = '#9aa1ad';
      ctx.fillText('Acoustic Guitar Studio · 吉他练习台', pad, y);
    }
    y += 26;

    return y + pad;
  }

  function renderChartCanvas(chart) {
    const model = normalizeChart(chart);
    const width = 1000;
    const scale = 2;
    const probe = document.createElement('canvas').getContext('2d');
    const height = Math.round(paintChartSheet(probe, model, { width, measureOnly: true }));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    paintChartSheet(ctx, model, { width, height });
    return canvas;
  }

  async function exportChartImage() {
    if (!chartModel) return;
    if (!disk) {
      alert('导出图片仅支持桌面版。');
      return;
    }
    const payload = collectChartPayload();
    const base = (payload.meta.title || '自制乐谱').trim() || '自制乐谱';
    const target = await disk.chartImageSavePath(base);
    if (!target || !target.ok) {
      if (target && target.error) alert(`导出失败：${target.error}`);
      return;
    }
    const btn = $id('chartExportImageBtn');
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '导出中…';
    try {
      const canvas = renderChartCanvas(payload);
      const isJpeg = /\.jpe?g$/i.test(target.filePath);
      const dataUrl = canvas.toDataURL(isJpeg ? 'image/jpeg' : 'image/png', isJpeg ? 0.92 : 1);
      const res = await disk.writeChartImage(target.filePath, dataUrl);
      if (!res || !res.ok) {
        alert(`导出失败：${(res && res.error) || '未知错误'}`);
      } else {
        chartDraftState.textContent = '图片已导出';
      }
    } catch (err) {
      alert(`导出失败：${err.message || '请重试'}`);
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }

  $id('chartImportImageBtn').addEventListener('click', () => chartImageFile.click());
  chartImageFile.addEventListener('change', () => {
    const files = Array.from(chartImageFile.files || []);
    chartImageFile.value = '';
    if (!files.length || !chartModel) return;
    const paths = files.map((file) => disk.pathForFile(file)).filter(Boolean);
    if (!paths.length) {
      alert('无法读取图片路径，请重新选择文件。');
      return;
    }
    chartPendingImages.push(...paths);
    chartDraftState.textContent = `已选择 ${chartPendingImages.length} 张参考图，保存乐谱后随谱保存`;
  });

  $id('chartExportImageBtn').addEventListener('click', exportChartImage);

  $id('chartSaveAsBtn').addEventListener('click', saveChartAs);

  $id('chartEditorClose').addEventListener('click', closeChartEditor);
  $id('chartCancelBtn').addEventListener('click', closeChartEditor);
  $id('chartSaveBtn').addEventListener('click', submitChart);
  document.getElementById('newChartBtn').addEventListener('click', () => openChartEditor(null));

  chartEditor.addEventListener('click', (e) => {
    if (e.target === chartEditor) closeChartEditor();
  });
  chartEditor.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!chordPicker.hidden) {
        chordPicker.hidden = true;
      } else {
        closeChartEditor();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      submitChart();
    } else if (!typing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      $id('chartUndoBtn').click();
    } else if (!typing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      $id('chartRedoBtn').click();
    }
  });

  chordPickerSearch.addEventListener('input', () => renderChordPickerList(chordPickerSearch.value));
  $id('chordPickerClose').addEventListener('click', () => { chordPicker.hidden = true; });
  chordPicker.addEventListener('click', (e) => {
    if (e.target === chordPicker) chordPicker.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !chordPicker.hidden) chordPicker.hidden = true;
  });

  async function renderLibrary() {
    let records = [];
    try {
      records = await loadAlbums();
    } catch (err) {
      console.warn('读取乐谱库失败', err);
    }
    records.sort((a, b) => b.updated - a.updated);

    const query = searchInput.value.trim().toLowerCase();
    const list = query
      ? records.filter(
          (r) =>
            r.name.toLowerCase().includes(query) ||
            r.pages.some((p) => p.name.toLowerCase().includes(query))
        )
      : records;

    // 清理旧缩略图链接
    thumbUrls.forEach((u) => URL.revokeObjectURL(u));
    thumbUrls = [];

    sheetGrid.innerHTML = '';
    const totalPages = records.reduce((sum, r) => sum + r.pages.length, 0);
    const chartCount = records.filter((r) => r.type === 'chart').length;
    libCount.textContent =
      `${records.length} 份乐谱` +
      (totalPages ? ` · ${totalPages} 页` : '') +
      (chartCount ? ` · ${chartCount} 份自制` : '') +
      (query ? ` · 匹配 ${list.length}` : '');
    libEmpty.classList.toggle('show', list.length === 0);
    libEmpty.textContent = records.length === 0
      ? '还没有乐谱，上传一张吉他谱，或点右上角「自制乐谱」新建一份。'
      : '没有匹配的乐谱，换个关键词试试。';

    list.forEach((rec) => {
      const card = document.createElement('div');
      card.className = 'sheet-card';

      const thumb = document.createElement('div');
      thumb.className = 'sheet-thumb';
      const first = rec.pages[0];
      if (rec.type === 'chart') {
        const wrap = document.createElement('div');
        wrap.className = 'chart-thumb';
        const mark = document.createElement('span');
        mark.className = 'chart-mark';
        mark.textContent = '谱';
        const label = document.createElement('span');
        label.textContent = '自制乐谱';
        wrap.append(mark, label);
        thumb.appendChild(wrap);
      } else if (first && first.kind === 'image') {
        const url = pageUrl(first, thumbUrls);
        const img = document.createElement('img');
        img.src = url;
        img.alt = rec.name;
        thumb.appendChild(img);
      } else {
        thumb.innerHTML = '<div class="pdf-badge"><b>PDF</b><span>点击查看</span></div>';
      }
      if (rec.pages.length > 1) {
        const badge = document.createElement('span');
        badge.className = 'sheet-count';
        badge.textContent = `${rec.pages.length} 页`;
        thumb.appendChild(badge);
      }
      thumb.addEventListener('click', () => openViewer(rec));

      const meta = document.createElement('div');
      meta.className = 'sheet-meta';
      const name = document.createElement('p');
      name.className = 'sheet-name';
      name.textContent = rec.name;
      name.title = rec.name;
      const sub = document.createElement('p');
      sub.className = 'sheet-sub';
      sub.textContent = rec.type === 'chart'
        ? `${rec.chart && rec.chart.kind === 'tab' ? '六线指弹谱' : '弹唱和弦谱'} · 更新于 ${formatDate(rec.updated)}`
        : `${rec.pages.length} 页 · ${kindLabel(rec)} · ${formatSize(albumSize(rec))} · ${formatDate(rec.updated)}`;
      meta.append(name, sub);

      const actions = document.createElement('div');
      actions.className = 'sheet-actions';

      const openBtn = document.createElement('button');
      openBtn.textContent = '打开';
      openBtn.addEventListener('click', () => openViewer(rec));

      const addBtn = document.createElement('button');
      addBtn.textContent = '加页';
      addBtn.addEventListener('click', () => {
        pendingAlbum = rec;
        pageInput.click();
      });

      const renameBtn = document.createElement('button');
      renameBtn.textContent = '重命名';
      renameBtn.addEventListener('click', async () => {
        const newName = await askInput('重命名乐谱', '输入新的名称', rec.name);
        if (!newName || newName === rec.name) return;
        try {
          const finalName = await renameAlbum(rec, newName);
          await renderLibrary();
          // 重命名后按更新时间排序，卡片会跳到顶部，把它滚动到可视区域
          requestAnimationFrame(() => {
            const updated = [...document.querySelectorAll('.sheet-card')].find(
              (c) => c.querySelector('.sheet-name').textContent === finalName
            );
            if (updated) updated.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          });
        } catch (err) {
          console.warn('重命名失败', err);
          alert(`重命名失败：${err.message || '请重试'}`);
        }
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'del';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', async () => {
        const what = rec.type === 'chart' ? '这份自制乐谱' : `共 ${rec.pages.length} 页`;
        if (!confirm(`确定删除《${rec.name}》（${what}）？`)) return;
        try {
          await deleteAlbum(rec);
          await renderLibrary();
        } catch (err) {
          alert(`删除失败：${err.message || '请重试'}`);
        }
      });

      if (rec.type === 'chart') {
        const editBtn = document.createElement('button');
        editBtn.textContent = '编辑';
        editBtn.addEventListener('click', () => openChartEditor(rec));
        actions.append(openBtn, editBtn, renameBtn, delBtn);
      } else {
        actions.append(openBtn, addBtn, renameBtn, delBtn);
      }
      card.append(thumb, meta, actions);
      sheetGrid.appendChild(card);
    });
  }

  searchInput.addEventListener('input', renderLibrary);

  pageInput.addEventListener('change', async () => {
    const files = Array.from(pageInput.files || []);
    pageInput.value = '';
    const album = pendingAlbum;
    pendingAlbum = null;
    const pages = files.map(toPage).filter(Boolean);
    if (!album || !pages.length) return;
    pages.sort((a, b) => PAGE_SORTER.compare(a.name, b.name));

    try {
      await appendPages(album, pages);
    } catch (err) {
      console.warn('追加页失败', err);
      alert(`保存失败：${err.message || '请重试'}`);
      return;
    }
    await renderLibrary();
  });

  function openViewer(rec, pageIndex = 0) {
    closeViewer();
    viewerRecord = rec;
    viewerName.textContent = rec.name;
    viewerName.title = rec.name;

    const zoomBtns = ['zoomOut', 'zoomReset', 'zoomIn', 'openTab'].map((id) =>
      document.getElementById(id)
    );

    if (rec.type === 'chart') {
      viewerPage = 0;
      viewerUrls = [];
      zoomBtns.forEach((b) => (b.hidden = true));
      pageNav.hidden = true;
      pageStrip.hidden = true;
      pageStrip.innerHTML = '';
      viewerBody.innerHTML = '';
      viewerBody.dataset.kind = 'chart';
      const chartData = rec.chart && (Number(rec.chart.version) >= 2 || rec.chart.measures)
        ? normalizeChart(rec.chart)
        : migrateLegacyChart(rec.chart ? rec.chart.content : '');
      if (chartData.meta && !chartData.meta.title) chartData.meta.title = rec.name;
      renderChartScore(viewerBody, chartData, { viewer: true, title: rec.name });
      const refs = (rec.pages || []).filter((p) => p.kind === 'image');
      if (refs.length) {
        viewerUrls = [];
        viewerBody.appendChild(renderChartRefs(refs, viewerUrls));
      }
      viewer.hidden = false;
      document.body.style.overflow = 'hidden';
      return;
    }

    zoomBtns.forEach((b) => (b.hidden = false));
    viewerPage = clamp(pageIndex, 0, rec.pages.length - 1);
    viewerUrls = rec.pages.map((p) => pageUrl(p, viewerUrls));
    buildPageStrip();
    renderPage();
    viewer.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function buildPageStrip() {
    pageStrip.innerHTML = '';
    const many = viewerRecord.pages.length > 1;
    pageStrip.hidden = !many;
    if (!many) return;

    viewerRecord.pages.forEach((page, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'page-thumb';
      btn.title = page.name;
      if (page.kind === 'image') {
        const img = document.createElement('img');
        img.src = viewerUrls[i];
        img.alt = page.name;
        btn.appendChild(img);
      } else {
        const pdf = document.createElement('span');
        pdf.className = 'page-pdf';
        pdf.textContent = 'PDF';
        btn.appendChild(pdf);
      }
      const num = document.createElement('span');
      num.className = 'page-num';
      num.textContent = i + 1;
      btn.appendChild(num);
      btn.addEventListener('click', () => {
        viewerPage = i;
        renderPage();
      });
      pageStrip.appendChild(btn);
    });
  }

  function renderPage() {
    const page = viewerRecord.pages[viewerPage];
    if (!page) return;
    viewerScale = 1;
    document.getElementById('zoomReset').textContent = '100%';
    viewerBody.innerHTML = '';

    if (page.kind === 'image') {
      const img = document.createElement('img');
      img.src = viewerUrls[viewerPage];
      img.alt = page.name;
      img.style.transform = 'scale(1)';
      viewerBody.dataset.kind = 'image';
      viewerBody.appendChild(img);
    } else {
      const frame = document.createElement('iframe');
      frame.src = viewerUrls[viewerPage] + '#toolbar=1&navpanes=0';
      frame.title = page.name;
      viewerBody.dataset.kind = 'pdf';
      viewerBody.appendChild(frame);
    }

    const many = viewerRecord.pages.length > 1;
    pageNav.hidden = !many;
    if (many) {
      pageCounter.textContent = `${viewerPage + 1} / ${viewerRecord.pages.length}`;
      prevPageBtn.disabled = viewerPage === 0;
      nextPageBtn.disabled = viewerPage === viewerRecord.pages.length - 1;
    }
    Array.from(pageStrip.children).forEach((btn, i) =>
      btn.classList.toggle('active', i === viewerPage)
    );
    const activeThumb = pageStrip.children[viewerPage];
    if (activeThumb) activeThumb.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function goPage(delta) {
    if (!viewerRecord) return;
    const next = viewerPage + delta;
    if (next < 0 || next >= viewerRecord.pages.length) return;
    viewerPage = next;
    renderPage();
  }

  prevPageBtn.addEventListener('click', () => goPage(-1));
  nextPageBtn.addEventListener('click', () => goPage(1));

  function closeViewer() {
    if (viewer.hidden) return;
    stopChartPlayback();
    viewer.hidden = true;
    viewerBody.innerHTML = '';
    pageStrip.innerHTML = '';
    document.body.style.overflow = '';
    viewerUrls.forEach((u) => URL.revokeObjectURL(u));
    viewerUrls = [];
    viewerRecord = null;
  }

  document.getElementById('viewerClose').addEventListener('click', closeViewer);
  viewer.addEventListener('click', (e) => {
    if (e.target === viewer) closeViewer();
  });
  document.addEventListener('keydown', (e) => {
    if (viewer.hidden) return;
    if (e.key === 'Escape') {
      closeViewer();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goPage(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goPage(1);
    }
  });

  function applyZoom(delta) {
    const img = viewerBody.querySelector('img');
    if (!img) return;
    viewerScale = clamp(viewerScale + delta, 0.5, 3);
    img.style.transform = `scale(${viewerScale})`;
    document.getElementById('zoomReset').textContent = Math.round(viewerScale * 100) + '%';
  }

  document.getElementById('zoomIn').addEventListener('click', () => applyZoom(0.25));
  document.getElementById('zoomOut').addEventListener('click', () => applyZoom(-0.25));
  document.getElementById('zoomReset').addEventListener('click', () => {
    const img = viewerBody.querySelector('img');
    if (!img) return;
    viewerScale = 1;
    img.style.transform = 'scale(1)';
    document.getElementById('zoomReset').textContent = '100%';
  });
  document.getElementById('openTab').addEventListener('click', () => {
    const url = viewerUrls[viewerPage];
    if (url) window.open(url, '_blank');
  });

  const storeHint = document.getElementById('storeHint');
  const openLibBtn = document.getElementById('openLibBtn');
  const storeDirBtn = document.getElementById('storeDirBtn');
  const libRefreshBtn = document.getElementById('libRefreshBtn');
  let refreshTimer = 0;
  if (disk) {
    openLibBtn.hidden = false;
    storeDirBtn.hidden = false;
    libRefreshBtn.hidden = false;
    document.getElementById('newChartBtn').hidden = false;
    openLibBtn.addEventListener('click', () => disk.openLibrary());

    // 重新扫描乐谱文件夹，同步在资源管理器里新增/删除的乐谱
    libRefreshBtn.addEventListener('click', async () => {
      clearTimeout(refreshTimer);
      libRefreshBtn.disabled = true;
      libRefreshBtn.textContent = '刷新中…';
      await renderLibrary();
      libRefreshBtn.textContent = '已刷新';
      refreshTimer = setTimeout(() => {
        libRefreshBtn.textContent = '刷新';
        libRefreshBtn.disabled = false;
      }, 900);
    });

    const showStorePath = (dir) => {
      storeHint.textContent =
        `文件直接保存在本地文件夹「${dir}」，每首曲子一个文件夹，可用资源管理器打开查看、备份或复制；自制乐谱存放在对应文件夹的 chart.json 中。更换位置后只显示新文件夹里的乐谱。`;
    };
    disk.libraryPath().then(showStorePath);

    storeDirBtn.addEventListener('click', async () => {
      const res = await disk.chooseDir();
      if (!res || res.canceled) return;
      if (!res.ok) {
        alert(`更换存储位置失败：${res.error || '未知错误'}`);
        return;
      }
      showStorePath(res.dir);
      searchInput.value = '';
      renderLibrary();
    });
  }

  migrateFromIndexedDb().then(() => renderLibrary());

  /* ============================================================
     和弦库
     ============================================================ */

  const CHORD_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const QUALITY_ORDER = ['', 'm', '7', 'maj7', 'm7', 'sus4', 'sus2', '6'];
  const QUALITY_LABEL = {
    '': '大三和弦',
    m: '小三和弦',
    '7': '属七和弦',
    maj7: '大七和弦',
    m7: '小七和弦',
    sus4: '挂四和弦',
    sus2: '挂二和弦',
    '6': '六和弦',
    add9: '加九和弦',
  };

  // 和弦色彩 / 曲风 / 常用走向：走向用调内级数表示，按和弦根音移调后显示
  const CHORD_INFO = {
    '': {
      read: 'major',
      short: '大三',
      color: '明亮、稳定、有支撑感，是调性的「家」，收尾与落点最常用它。',
      styles: ['流行', '民谣', '摇滚'],
      keyShift: 0,
      patterns: [
        { name: '万能四和弦', degrees: ['I', 'V', 'vi', 'IV'] },
        { name: '50 年代进行', degrees: ['I', 'vi', 'IV', 'V'] },
        { name: '正格进行', degrees: ['I', 'IV', 'V', 'I'] },
      ],
    },
    m: {
      read: 'minor',
      short: '小三',
      color: '柔和、忧郁、带叙事感，常用来接住大调的情绪转折。',
      styles: ['流行', '民谣', '指弹'],
      keyShift: 0,
      patterns: [
        { name: '小调流行', degrees: ['i', 'VI', 'III', 'VII'] },
        { name: '小调经典', degrees: ['i', 'iv', 'v', 'i'] },
      ],
    },
    '7': {
      read: 'dominant seventh',
      short: '属七',
      color: '紧张、有推动力，蓝调味明显，会强烈指向主和弦。',
      styles: ['布鲁斯', '摇滚'],
      keyShift: -7,
      patterns: [
        { name: '属七解决（V7 → I）', degrees: ['V7', 'I'] },
        { name: '布鲁斯收尾', degrees: ['I7', 'IV7', 'V7', 'I7'] },
      ],
    },
    maj7: {
      read: 'major seventh',
      short: '大七',
      color: '温柔、梦幻、带城市感和爵士味，适合安静段落。',
      styles: ['爵士', '城市民谣'],
      keyShift: 0,
      patterns: [
        { name: '爵士回转（I–vi–ii–V）', degrees: ['Imaj7', 'vi7', 'ii7', 'V7'] },
        { name: '城市民谣', degrees: ['Imaj7', 'IVmaj7', 'vi7', 'V7'] },
      ],
    },
    m7: {
      read: 'minor seventh',
      short: '小七',
      color: '柔顺、略带慵懒，是流行与 R&B 里最常用的底色和弦。',
      styles: ['R&B', '爵士'],
      keyShift: -2,
      patterns: [{ name: 'ii–V–I 进行', degrees: ['ii7', 'V7', 'Imaj7'] }],
    },
    sus4: {
      read: 'suspended fourth',
      short: '挂四',
      color: '悬而未决、开阔，适合做停顿、推进和副歌前的蓄力。',
      styles: ['流行', '民谣', '摇滚'],
      keyShift: 0,
      patterns: [
        { name: '挂四回落', degrees: ['Isus4', 'I', 'V', 'vi'] },
        { name: '挂四推进', degrees: ['Isus4', 'IV', 'V'] },
      ],
    },
    sus2: {
      read: 'suspended second',
      short: '挂二',
      color: '空灵、通透，分解和弦与前奏里很常见。',
      styles: ['民谣', '指弹', '流行'],
      keyShift: 0,
      patterns: [{ name: '挂二循环', degrees: ['Isus2', 'IV', 'V', 'I'] }],
    },
    '6': {
      read: 'sixth',
      short: '六',
      color: '复古、轻快，带一点老歌与爵士味。',
      styles: ['爵士', '民谣'],
      keyShift: 0,
      patterns: [{ name: '六和弦进行', degrees: ['I6', 'IV', 'V', 'I6'] }],
    },
    add9: {
      read: 'add nine',
      short: '加九',
      color: '开阔、明亮，在明亮和弦上加一层空气感。',
      styles: ['流行', '民谣', '指弹'],
      keyShift: 0,
      patterns: [{ name: '加九进行', degrees: ['Iadd9', 'IV', 'V', 'Iadd9'] }],
    },
  };

  const DEGREES = {
    I: [0, ''], ii: [2, 'm'], iii: [4, 'm'], IV: [5, ''], V: [7, ''], vi: [9, 'm'],
    i: [0, 'm'], III: [3, ''], iv: [5, 'm'], v: [7, 'm'], VI: [8, ''], VII: [10, ''],
    Imaj7: [0, 'maj7'], IVmaj7: [5, 'maj7'], vi7: [9, 'm7'], ii7: [2, 'm7'], V7: [7, '7'],
    I7: [0, '7'], IV7: [5, '7'], I6: [0, '6'], Isus4: [0, 'sus4'], Isus2: [0, 'sus2'], Iadd9: [0, 'add9'],
  };

  // 开放把位指法（6→1 弦顺序，-1 表示不弹）
  const OPEN_CHORDS = [
    { name: 'C', frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
    { name: 'Cadd9', frets: [-1, 3, 2, 0, 3, 0], fingers: [0, 2, 1, 0, 3, 0] },
    { name: 'Cmaj7', frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0] },
    { name: 'C7', frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] },
    { name: 'C6', frets: [-1, 3, 2, 2, 1, 0], fingers: [0, 4, 2, 3, 1, 0] },
    { name: 'D', frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
    { name: 'Dm', frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
    { name: 'D7', frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3] },
    { name: 'Dm7', frets: [-1, -1, 0, 2, 1, 1], fingers: [0, 0, 0, 3, 1, 1] },
    { name: 'Dmaj7', frets: [-1, -1, 0, 2, 2, 2], fingers: [0, 0, 0, 1, 1, 1] },
    { name: 'Dsus2', frets: [-1, -1, 0, 2, 3, 0], fingers: [0, 0, 0, 1, 2, 0] },
    { name: 'Dsus4', frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 2, 3] },
    { name: 'E', frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
    { name: 'Em', frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] },
    { name: 'E7', frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] },
    { name: 'Em7', frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0] },
    { name: 'Emaj7', frets: [0, 2, 1, 1, 0, 0], fingers: [0, 4, 1, 2, 0, 0] },
    { name: 'Esus4', frets: [0, 2, 2, 2, 0, 0], fingers: [0, 1, 2, 3, 0, 0] },
    { name: 'F', frets: [1, 1, 2, 2, 2, 1], fingers: [1, 1, 2, 3, 4, 1], barre: { fret: 1, from: 0, to: 5 } },
    { name: 'Fmaj7', frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0] },
    { name: 'F7', frets: [1, 3, 1, 2, 1, 1], fingers: [1, 3, 1, 2, 1, 1], barre: { fret: 1, from: 0, to: 5 } },
    { name: 'G', frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
    { name: 'G7', frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] },
    { name: 'Gmaj7', frets: [3, 2, 0, 0, 0, 2], fingers: [3, 2, 0, 0, 0, 1] },
    { name: 'Gsus4', frets: [3, 3, 0, 0, 1, 3], fingers: [2, 3, 0, 0, 1, 4] },
    { name: 'A', frets: [-1, 2, 2, 2, 0, 0], fingers: [0, 1, 2, 3, 0, 0] },
    { name: 'Am', frets: [-1, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
    { name: 'Am7', frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] },
    { name: 'Amaj7', frets: [-1, 0, 2, 1, 2, 0], fingers: [0, 0, 3, 1, 2, 0] },
    { name: 'A7', frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0] },
    { name: 'A6', frets: [-1, 0, 2, 2, 2, 2], fingers: [0, 0, 1, 1, 1, 1] },
    { name: 'Asus2', frets: [-1, 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0] },
    { name: 'Asus4', frets: [-1, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0] },
    { name: 'B7', frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] },
    { name: 'Bm', frets: [-1, 2, 4, 4, 3, 2], fingers: [0, 1, 3, 4, 2, 1], barre: { fret: 2, from: 1, to: 5 } },
  ];

  // 可移动横按指法：off 为相对根音品位的偏移
  const MOVE_SHAPES = {
    '': [
      { rootString: 6, off: [0, 2, 2, 1, 0, 0], fingers: [1, 3, 4, 2, 1, 1] },
      { rootString: 5, off: [-1, 0, 2, 2, 2, 0], fingers: [0, 1, 3, 3, 3, 1] },
    ],
    m: [
      { rootString: 6, off: [0, 2, 2, 0, 0, 0], fingers: [1, 3, 4, 1, 1, 1] },
      { rootString: 5, off: [-1, 0, 2, 2, 1, 0], fingers: [0, 1, 3, 4, 2, 1] },
    ],
    '7': [
      { rootString: 6, off: [0, 2, 0, 1, 0, 0], fingers: [1, 3, 1, 2, 1, 1] },
      { rootString: 5, off: [-1, 0, 2, 0, 2, 0], fingers: [0, 1, 3, 1, 4, 1] },
    ],
    maj7: [
      { rootString: 6, off: [0, 2, 1, 1, 0, 0], fingers: [1, 4, 2, 3, 1, 1] },
      { rootString: 5, off: [-1, 0, 2, 1, 2, 0], fingers: [0, 1, 3, 2, 4, 1] },
    ],
    m7: [
      { rootString: 6, off: [0, 2, 0, 0, 0, 0], fingers: [1, 3, 1, 1, 1, 1] },
      { rootString: 5, off: [-1, 0, 2, 0, 1, 0], fingers: [0, 1, 3, 1, 2, 1] },
    ],
    sus4: [
      { rootString: 6, off: [0, 2, 2, 2, 0, 0], fingers: [1, 2, 3, 4, 1, 1] },
      { rootString: 5, off: [-1, 0, 2, 2, 3, 0], fingers: [0, 1, 2, 3, 4, 1] },
    ],
    sus2: [{ rootString: 5, off: [-1, 0, 2, 2, 0, 0], fingers: [0, 1, 3, 4, 1, 1] }],
    '6': [{ rootString: 5, off: [-1, 0, 2, 2, 2, 2], fingers: [0, 1, 3, 3, 3, 3] }],
  };

  const ALL_CHORDS = (() => {
    const list = [];
    const seen = new Set();

    OPEN_CHORDS.forEach((c) => {
      const root = (/^[A-G]#?/.exec(c.name) || [''])[0];
      const quality = c.name.slice(root.length);
      const qualityLabel = QUALITY_LABEL[quality] || '和弦';
      list.push({
        ...c,
        root,
        quality,
        note: `${qualityLabel} · ${c.barre ? '开放把位小横按' : '开放把位'}`,
      });
      seen.add(c.name);
    });

    CHORD_ROOTS.forEach((root, pc) => {
      QUALITY_ORDER.forEach((quality) => {
        const name = root + quality;
        if (seen.has(name)) return;
        let best = null;
        (MOVE_SHAPES[quality] || []).forEach((shape) => {
          const openPc = shape.rootString === 6 ? 4 : 9; // 6 弦空弦 E、5 弦空弦 A
          const fret = (pc - openPc + 12) % 12;
          if (fret < 1) return; // 0 品即开放和弦，已在上面列出
          if (!best || fret < best.fret) best = { ...shape, fret };
        });
        if (!best) return;
        const frets = best.off.map((o) => (o < 0 ? -1 : o + best.fret));
        list.push({
          name,
          root,
          quality,
          frets,
          fingers: best.fingers,
          barre: {
            fret: best.fret,
            from: best.off.findIndex((o) => o >= 0),
            to: 5,
          },
          note: `${QUALITY_LABEL[quality] || '和弦'} · 横按第 ${best.fret} 品`,
        });
        seen.add(name);
      });
    });

    return list;
  })();

  function chordSVG(chord) {
    const W = 132;
    const H = 172;
    const left = 16;
    const right = 116;
    const top = 40;
    const step = 22;
    const stringX = (i) => left + (i * (right - left)) / 5;

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', chord.name + ' 和弦指法图');

    // 高把位和弦只显示包含按弦点的 5 品窗口；低把位从琴枕开始画
    const fretted = chord.frets.filter((f) => f > 0);
    const base = fretted.length && Math.max(...fretted) > 5 ? Math.min(...fretted) : 1;

    const lineColor = 'rgba(255,255,255,0.28)';
    const stroke = (x1, y1, x2, y2, width, color) => {
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', x1);
      l.setAttribute('y1', y1);
      l.setAttribute('x2', x2);
      l.setAttribute('y2', y2);
      l.setAttribute('stroke', color || lineColor);
      l.setAttribute('stroke-width', width || 1);
      svg.appendChild(l);
    };

    // 品位线
    for (let f = 0; f <= 5; f++) {
      const y = top + f * step;
      const isNut = f === 0 && base === 1;
      stroke(left, y, right, y, isNut ? 3 : 1, isNut ? 'rgba(255,255,255,0.72)' : lineColor);
    }
    // 琴弦线
    for (let i = 0; i < 6; i++) {
      stroke(stringX(i), top, stringX(i), top + 5 * step, 1);
    }
    // 高把位起点标记
    if (base > 1) {
      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', left);
      label.setAttribute('y', top - 28);
      label.setAttribute('fill', 'rgba(240,180,90,0.85)');
      label.setAttribute('font-size', '10');
      label.setAttribute('font-weight', '600');
      label.textContent = `${base}fr`;
      svg.appendChild(label);
    }

    // 空弦 / 闷弦标记
    chord.frets.forEach((fr, i) => {
      const x = stringX(i);
      if (fr === 0) {
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('cx', x);
        c.setAttribute('cy', top - 13);
        c.setAttribute('r', 5);
        c.setAttribute('fill', 'none');
        c.setAttribute('stroke', '#4fd6a4');
        c.setAttribute('stroke-width', 1.6);
        svg.appendChild(c);
      } else if (fr === -1) {
        const cy = top - 13;
        const ring = document.createElementNS(ns, 'circle');
        ring.setAttribute('cx', x);
        ring.setAttribute('cy', cy);
        ring.setAttribute('r', 7);
        ring.setAttribute('fill', 'rgba(255, 92, 92, 0.2)');
        ring.setAttribute('stroke', '#ff6b6b');
        ring.setAttribute('stroke-width', 1.7);
        svg.appendChild(ring);
        stroke(x - 3, cy - 3, x + 3, cy + 3, 1.8, '#ff9a9a');
        stroke(x + 3, cy - 3, x - 3, cy + 3, 1.8, '#ff9a9a');
      }
    });

    // 横按
    if (chord.barre) {
      const { fret, from, to } = chord.barre;
      const y = top + (fret - base + 0.5) * step;
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', stringX(from) - 8);
      rect.setAttribute('y', y - 6);
      rect.setAttribute('width', stringX(to) - stringX(from) + 16);
      rect.setAttribute('height', 12);
      rect.setAttribute('rx', 6);
      rect.setAttribute('fill', '#f0b45a');
      rect.setAttribute('opacity', 0.9);
      svg.appendChild(rect);

      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', (stringX(from) + stringX(to)) / 2);
      label.setAttribute('y', y + 4);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', '#231809');
      label.setAttribute('font-size', '10');
      label.setAttribute('font-weight', '700');
      label.textContent = '1';
      svg.appendChild(label);
    }

    // 按弦点
    chord.frets.forEach((fr, i) => {
      if (fr <= 0) return;
      const x = stringX(i);
      const y = top + (fr - base + 0.5) * step;
      const isBarre = chord.barre && chord.barre.fret === fr && i >= chord.barre.from && i <= chord.barre.to;

      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', y);
      dot.setAttribute('r', isBarre ? 7 : 8);
      dot.setAttribute('fill', isBarre ? '#ffd694' : '#f0b45a');
      svg.appendChild(dot);

      const finger = chord.fingers[i];
      if (finger && !isBarre) {
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('x', x);
        t.setAttribute('y', y + 4);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('fill', '#231809');
        t.setAttribute('font-size', '10');
        t.setAttribute('font-weight', '700');
        t.textContent = String(finger);
        svg.appendChild(t);
      }
    });

    return svg;
  }

  const chordGrid = document.getElementById('chordGrid');
  const chordCats = document.getElementById('chordCats');
  const chordStyles = document.getElementById('chordStyles');
  const chordRoots = document.getElementById('chordRoots');
  const chordCount = document.getElementById('chordCount');
  const favCount = document.getElementById('favCount');
  const chordState = {
    cat: 'all',
    style: 'all',
    root: 'all',
    query: '',
    flats: localStorage.getItem('gs-accidental') === 'flat',
  };
  const FAV_KEY = 'gs-chord-favs';
  const favs = new Set();
  try {
    JSON.parse(localStorage.getItem(FAV_KEY) || '[]').forEach((n) => favs.add(n));
  } catch (err) {
    /* 忽略损坏的收藏数据 */
  }
  function saveFavs() {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
    } catch (err) {
      /* 忽略存储失败 */
    }
  }
  const FLAT_OF_SHARP = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };
  const chordRootLabel = (root) => (chordState.flats && FLAT_OF_SHARP[root]) || root;

  function chordCard(chord) {
    const card = document.createElement('div');
    card.className = 'chord-card';
    card.dataset.chord = chord.name;
    card.appendChild(chordSVG(chord));

    const name = document.createElement('div');
    name.className = 'chord-name';
    name.textContent = chordRootLabel(chord.root) + chord.quality;

    const note = document.createElement('div');
    note.className = 'chord-note';
    note.textContent = chord.note;

    const on = favs.has(chord.name);
    const fav = document.createElement('button');
    fav.className = 'fav-btn' + (on ? ' active' : '');
    fav.dataset.chord = chord.name;
    fav.textContent = on ? '★' : '☆';
    fav.title = on ? '取消收藏' : '收藏和弦';
    fav.setAttribute('aria-label', `${fav.title} ${chord.name}`);

    card.append(fav, name, note);
    return card;
  }

  function chordMatches(chord, query) {
    const flatRoot = FLAT_OF_SHARP[chord.root] || chord.root;
    const haystack = [
      chord.name,
      flatRoot + chord.quality,
      QUALITY_LABEL[chord.quality] || '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  }

  function renderChords() {
    const query = chordState.query.trim().toLowerCase();
    const list = ALL_CHORDS.filter((c) => {
      if (chordState.cat === 'fav' && !favs.has(c.name)) return false;
      if (chordState.style !== 'all') {
        const info = CHORD_INFO[c.quality];
        if (!info || !info.styles.includes(chordState.style)) return false;
      }
      if (chordState.root !== 'all' && c.root !== chordState.root) return false;
      if (query && !chordMatches(c, query)) return false;
      return true;
    });

    chordGrid.textContent = '';
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      if (query) {
        empty.textContent = `没有找到匹配「${chordState.query.trim()}」的和弦，换个写法试试（如 Am、Fmaj7、Bb）。`;
      } else if (chordState.cat === 'fav') {
        empty.textContent = '还没有收藏和弦，点卡片右上角的 ☆ 就能把常用和弦收进自己的和弦库。';
      } else if (chordState.style !== 'all') {
        empty.textContent = `「${chordState.style}」曲风下暂时没有匹配的和弦，换个曲风或取消筛选试试。`;
      } else {
        empty.textContent = '这个分类下还没有收录和弦，换个分类看看。';
      }
      chordGrid.appendChild(empty);
    } else if (chordState.root === 'all') {
      CHORD_ROOTS.forEach((root) => {
        const group = list.filter((c) => c.root === root);
        if (!group.length) return;
        const title = document.createElement('h3');
        title.className = 'chord-group-title';
        title.textContent = `${chordRootLabel(root)} 组 · ${group.length} 个`;
        chordGrid.appendChild(title);
        group.forEach((c) => chordGrid.appendChild(chordCard(c)));
      });
    } else {
      list.forEach((c) => chordGrid.appendChild(chordCard(c)));
    }

    chordCount.textContent = `共 ${ALL_CHORDS.length} 个和弦 · 收藏 ${favs.size} 个 · 当前 ${list.length} 个`;
    favCount.textContent = String(favs.size);
  }

  // 根音索引：全部 / C / C# / …
  [{ key: 'all', label: '全部音名' }]
    .concat(CHORD_ROOTS.map((r) => ({ key: r, label: r })))
    .forEach((item) => {
      const btn = document.createElement('button');
      btn.className = 'chip' + (item.key === 'all' ? ' active' : '');
      btn.dataset.root = item.key;
      chordRoots.appendChild(btn);
    });

  function paintRootChips() {
    [...chordRoots.children].forEach((btn) => {
      const key = btn.dataset.root;
      btn.textContent = key === 'all' ? '全部音名' : chordRootLabel(key);
    });
  }
  paintRootChips();

  // 升降号显示切换
  const accidentalToggle = document.getElementById('accidentalToggle');
  [...accidentalToggle.children].forEach((b) => {
    b.classList.toggle('active', (b.dataset.acc === 'flat') === chordState.flats);
  });
  accidentalToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    const flats = btn.dataset.acc === 'flat';
    if (flats === chordState.flats) return;
    chordState.flats = flats;
    localStorage.setItem('gs-accidental', flats ? 'flat' : 'sharp');
    [...accidentalToggle.children].forEach((b) => b.classList.toggle('active', b === btn));
    paintRootChips();
    renderChords();
  });

  // 和弦搜索：升号/降号写法与和弦性质都能匹配
  const chordSearchInput = document.getElementById('chordSearch');
  chordSearchInput.addEventListener('input', () => {
    chordState.query = chordSearchInput.value;
    if (chordState.query.trim() && chordState.root !== 'all') {
      chordState.root = 'all';
      [...chordRoots.children].forEach((b) => {
        b.classList.toggle('active', b.dataset.root === 'all');
      });
    }
    renderChords();
  });

  chordCats.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    chordState.cat = chordState.cat === 'fav' ? 'all' : 'fav';
    btn.classList.toggle('active', chordState.cat === 'fav');
    renderChords();
  });

  // 曲风筛选：按和弦性质的色彩标签过滤
  chordStyles.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    chordState.style = btn.dataset.style;
    [...chordStyles.querySelectorAll('.chip')].forEach((b) => b.classList.toggle('active', b === btn));
    renderChords();
  });

  chordRoots.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    chordState.root = btn.dataset.root;
    [...chordRoots.children].forEach((b) => b.classList.toggle('active', b === btn));
    renderChords();
  });

  // 收藏 / 取消收藏常用和弦
  chordGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.fav-btn');
    if (!btn) {
      const card = e.target.closest('.chord-card');
      if (card) openChordModal(card.dataset.chord);
      return;
    }
    const key = btn.dataset.chord;
    if (favs.has(key)) favs.delete(key);
    else favs.add(key);
    saveFavs();
    if (chordState.cat === 'fav') {
      renderChords();
      return;
    }
    const on = favs.has(key);
    btn.classList.toggle('active', on);
    btn.textContent = on ? '★' : '☆';
    btn.title = on ? '取消收藏' : '收藏和弦';
    chordCount.textContent = `共 ${ALL_CHORDS.length} 个和弦 · 收藏 ${favs.size} 个 · 当前 ${chordGrid.querySelectorAll('.chord-card').length} 个`;
    favCount.textContent = String(favs.size);
  });

  /* ---------------- 和弦详情（读音 / 色彩 / 曲风 / 走向） ---------------- */

  const chordModal = document.getElementById('chordModal');
  const chordModalName = document.getElementById('chordModalName');
  const chordModalDiagram = document.getElementById('chordModalDiagram');
  const chordModalInfo = document.getElementById('chordModalInfo');

  function rootRead(label) {
    const letter = label[0];
    if (label.endsWith('#')) return { en: `${letter} sharp`, cn: `升${letter}` };
    if (label.endsWith('b')) return { en: `${letter} flat`, cn: `降${letter}` };
    return { en: letter, cn: letter };
  }

  function progressionNames(chord, degrees) {
    const info = CHORD_INFO[chord.quality] || CHORD_INFO[''];
    const keyIndex = CHORD_ROOTS.indexOf(chord.root) + info.keyShift;
    return degrees.map((deg) => {
      const [offset, quality] = DEGREES[deg];
      const root = CHORD_ROOTS[(((keyIndex + offset) % 12) + 12) % 12];
      return chordRootLabel(root) + quality;
    });
  }

  function detailRow(title, content) {
    const row = document.createElement('div');
    row.className = 'detail-row';
    const h = document.createElement('h4');
    h.textContent = title;
    row.appendChild(h);
    row.appendChild(content);
    return row;
  }

  function openChordModal(name) {
    const chord = ALL_CHORDS.find((c) => c.name === name);
    if (!chord) return;
    const info = CHORD_INFO[chord.quality] || CHORD_INFO[''];
    const shownRoot = chordRootLabel(chord.root);
    const read = rootRead(shownRoot);

    chordModalName.textContent = `${shownRoot}${chord.quality} · ${QUALITY_LABEL[chord.quality] || '和弦'}`;

    chordModalDiagram.textContent = '';
    chordModalDiagram.appendChild(chordSVG(chord));
    const cap = document.createElement('div');
    cap.className = 'diagram-caption';
    cap.textContent = chord.note;
    chordModalDiagram.appendChild(cap);

    chordModalInfo.textContent = '';

    const readP = document.createElement('p');
    readP.textContent = `${read.en} ${info.read} · 中文常说「${read.cn}${info.short}和弦」`;
    chordModalInfo.appendChild(detailRow('读音', readP));

    const colorP = document.createElement('p');
    colorP.textContent = info.color;
    chordModalInfo.appendChild(detailRow('和弦色彩', colorP));

    const tags = document.createElement('div');
    tags.className = 'style-tags';
    info.styles.forEach((s) => {
      const chip = document.createElement('span');
      chip.className = 'mini-chip';
      chip.textContent = s;
      tags.appendChild(chip);
    });
    chordModalInfo.appendChild(detailRow('适用曲风', tags));

    const progWrap = document.createElement('div');
    info.patterns.forEach((p) => {
      const line = document.createElement('div');
      line.className = 'prog';
      const label = document.createElement('span');
      label.className = 'prog-name';
      label.textContent = p.name;
      line.appendChild(label);
      progressionNames(chord, p.degrees).forEach((n, i) => {
        if (i) {
          const arrow = document.createElement('span');
          arrow.className = 'arrow';
          arrow.textContent = '→';
          line.appendChild(arrow);
        }
        const chip = document.createElement('span');
        chip.className = 'mini-chip';
        chip.textContent = n;
        line.appendChild(chip);
      });
      progWrap.appendChild(line);
    });
    chordModalInfo.appendChild(detailRow('常用走向', progWrap));

    chordModal.hidden = false;
  }

  function closeChordModal() {
    chordModal.hidden = true;
  }

  document.getElementById('chordModalClose').addEventListener('click', closeChordModal);
  chordModal.addEventListener('click', (e) => {
    if (e.target === chordModal) closeChordModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !chordModal.hidden) closeChordModal();
  });

  // 曲风筛选项：标注该曲风下收录的和弦数量
  [...chordStyles.querySelectorAll('.chip')].forEach((btn) => {
    const style = btn.dataset.style;
    if (style === 'all') return;
    const n = ALL_CHORDS.filter((c) => (CHORD_INFO[c.quality] || {}).styles?.includes(style)).length;
    const badge = document.createElement('span');
    badge.className = 'chip-badge';
    badge.textContent = String(n);
    btn.append(' ', badge);
  });

  renderChords();

  /* ============================================================
     设置持久化
     ============================================================ */

  const SETTINGS_KEY = 'guitar-studio-settings';

  function saveSettings() {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          bpm: metro.bpm,
          beats: metro.beats,
          sub: metro.sub,
          sound: metro.sound,
          vol: metro.vol,
          accent: metro.accent,
          preset: metro.preset,
          tuning: tuner.tuning,
        })
      );
    } catch (err) {
      /* 忽略存储失败 */
    }
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.bpm) {
        metro.bpm = clamp(s.bpm, 40, 240);
        bpmValue.textContent = metro.bpm;
        bpmSlider.value = metro.bpm;
      }
      if (s.beats && timeSig.querySelector(`option[value="${s.beats}"]`)) {
        metro.beats = s.beats;
        timeSig.value = String(s.beats);
      }
      if (s.sub && subdiv.querySelector(`option[value="${s.sub}"]`)) {
        metro.sub = s.sub;
        subdiv.value = String(s.sub);
      }
      if (s.sound && clickSound.querySelector(`option[value="${s.sound}"]`)) {
        metro.sound = s.sound;
        clickSound.value = s.sound;
      }
      if (typeof s.vol === 'number') {
        metro.vol = s.vol;
        metroVol.value = Math.round(s.vol * 100);
        volLabel.textContent = metroVol.value + '%';
      }
      if (typeof s.accent === 'boolean') {
        metro.accent = s.accent;
        accentToggle.checked = s.accent;
      }
      if (s.preset && METRO_PRESETS[s.preset]) {
        metro.preset = s.preset;
      }
      if (s.tuning && TUNINGS[s.tuning]) {
        tuner.tuning = s.tuning;
        tuningSelect.value = s.tuning;
      }
    } catch (err) {
      /* 忽略损坏的设置 */
    }
    rebuildDots();
    renderStrings();
    syncPresetButtons();
  }

  loadSettings();
  saveSettings();
})();
