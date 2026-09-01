(function () {
  "use strict";

  function makeDriveCurve(amount) {
    var samples = 2048;
    var curve = new Float32Array(samples);
    var mix = Math.max(0, Math.min(1, amount));
    var strength = 1 + (mix * 18);
    var normalizer = Math.tanh(strength);
    var index;
    for (index = 0; index < samples; index += 1) {
      var x = ((index * 2) / (samples - 1)) - 1;
      var shaped = Math.tanh(x * strength) / normalizer;
      curve[index] = x + ((shaped - x) * mix);
    }
    return curve;
  }

  function AcidAudio(core) {
    this.core = core;
    this.context = null;
    this.nodes = null;
    this.settings = {
      waveform: "sawtooth",
      cutoff: 0.65,
      resonance: 0.65,
      envMod: 0.72,
      decay: 0.45,
      accent: 0.62,
      drive: 0.28,
      delayTime: 0.18,
      feedback: 0.28,
      volume: 0.72
    };
  }

  AcidAudio.prototype.isSupported = function () {
    return Boolean(globalThis.AudioContext || globalThis.webkitAudioContext);
  };

  AcidAudio.prototype.ensureStarted = function () {
    var AudioContextClass;
    if (!this.context) {
      AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) {
        return Promise.reject(new Error("Web Audio is not supported in this browser."));
      }
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.buildGraph();
    }
    if (this.context.state === "suspended") {
      return this.context.resume();
    }
    return Promise.resolve();
  };

  AcidAudio.prototype.buildGraph = function () {
    var context = this.context;
    var oscillator = context.createOscillator();
    var filter = context.createBiquadFilter();
    var envelope = context.createGain();
    var input = context.createGain();
    var shaper = context.createWaveShaper();
    var dry = context.createGain();
    var delay = context.createDelay(1.2);
    var feedback = context.createGain();
    var wet = context.createGain();
    var compressor = context.createDynamicsCompressor();
    var master = context.createGain();
    var analyser = context.createAnalyser();

    oscillator.type = this.settings.waveform;
    oscillator.frequency.value = 110;
    filter.type = "lowpass";
    filter.frequency.value = 800;
    filter.Q.value = 1;
    envelope.gain.value = 0.0001;
    input.gain.value = 0.76;
    shaper.oversample = "2x";
    dry.gain.value = 0.92;
    wet.gain.value = 0.28;
    compressor.threshold.value = -10;
    compressor.knee.value = 8;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.14;
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;

    oscillator.connect(filter);
    filter.connect(envelope);
    envelope.connect(input);
    input.connect(shaper);
    shaper.connect(dry);
    dry.connect(compressor);
    shaper.connect(delay);
    delay.connect(wet);
    wet.connect(compressor);
    delay.connect(feedback);
    feedback.connect(delay);
    compressor.connect(master);
    master.connect(analyser);
    analyser.connect(context.destination);
    oscillator.start();

    this.nodes = {
      oscillator: oscillator,
      filter: filter,
      envelope: envelope,
      input: input,
      shaper: shaper,
      dry: dry,
      delay: delay,
      feedback: feedback,
      wet: wet,
      compressor: compressor,
      master: master,
      analyser: analyser,
      meterData: new Uint8Array(analyser.fftSize)
    };
    this.applySettings(true);
  };

  AcidAudio.prototype.updateSettings = function (settings) {
    var key;
    for (key in settings) {
      if (Object.prototype.hasOwnProperty.call(settings, key)) {
        this.settings[key] = settings[key];
      }
    }
    if (this.nodes) {
      this.applySettings(false);
    }
  };

  AcidAudio.prototype.applySettings = function (immediate) {
    var now = this.context.currentTime;
    var smoothing = immediate ? 0 : 0.025;
    var delaySeconds = this.core.clamp(this.settings.delayTime, 0, 1);
    var volume = this.core.clamp(this.settings.volume, 0, 1);
    this.nodes.oscillator.type = this.settings.waveform === "square" ? "square" : "sawtooth";
    this.nodes.shaper.curve = makeDriveCurve(this.core.clamp(this.settings.drive, 0, 1));
    this.nodes.delay.delayTime.setTargetAtTime(delaySeconds, now, Math.max(0.001, smoothing));
    this.nodes.feedback.gain.setTargetAtTime(
      this.core.clamp(this.settings.feedback, 0, 0.82),
      now,
      Math.max(0.001, smoothing)
    );
    this.nodes.wet.gain.setTargetAtTime(delaySeconds < 0.012 ? 0 : 0.28, now, Math.max(0.001, smoothing));
    this.nodes.master.gain.setTargetAtTime(volume * volume * 0.94, now, Math.max(0.001, smoothing));
  };

  AcidAudio.prototype.now = function () {
    return this.context ? this.context.currentTime : 0;
  };

  AcidAudio.prototype.scheduleStep = function (event, when, duration) {
    if (!this.context || !this.nodes || !event) {
      return;
    }

    var context = this.context;
    var start = Math.max(when, context.currentTime);
    var stepLength = Math.max(0.03, duration);
    var oscillator = this.nodes.oscillator;
    var filter = this.nodes.filter;
    var envelope = this.nodes.envelope;

    if (event.rest) {
      envelope.gain.cancelScheduledValues(start);
      envelope.gain.setTargetAtTime(0.0001, start, 0.006);
      return;
    }

    var cutoff = 70 * Math.pow(100, this.core.clamp(this.settings.cutoff, 0, 1));
    var resonance = 0.8 + (this.core.clamp(this.settings.resonance, 0, 1) * 24);
    var envAmount = this.core.clamp(this.settings.envMod, 0, 1);
    var decay = 0.045 + (this.core.clamp(this.settings.decay, 0, 1) * 1.1);
    var accentAmount = this.core.clamp(this.settings.accent, 0, 1);
    var accentScale = event.accent ? 1 + (accentAmount * 0.72) : 1;
    var peakCutoff = Math.min(15000, cutoff * (1 + (envAmount * 9 * accentScale)));
    var voiceLevel = event.accent ? 0.62 + (accentAmount * 0.42) : 0.62;
    var releaseAt = start + (stepLength * 0.82);

    oscillator.frequency.cancelScheduledValues(start);
    oscillator.frequency.setValueAtTime(Math.max(20, event.frequency), start);
    if (event.slideToFrequency) {
      oscillator.frequency.setValueAtTime(Math.max(20, event.frequency), start + (stepLength * 0.42));
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, event.slideToFrequency),
        start + (stepLength * 0.96)
      );
    }

    filter.Q.setValueAtTime(resonance, start);
    if (!event.slideFromPrevious) {
      filter.frequency.cancelScheduledValues(start);
      filter.frequency.setValueAtTime(Math.max(40, cutoff), start);
      filter.frequency.exponentialRampToValueAtTime(Math.max(45, peakCutoff), start + 0.009);
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(40, cutoff),
        Math.min(start + decay, releaseAt)
      );

      envelope.gain.cancelScheduledValues(start);
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(voiceLevel, start + 0.006);
      envelope.gain.setTargetAtTime(voiceLevel * 0.38, start + 0.012, Math.max(0.02, decay * 0.34));
    }
    if (!event.slideToFrequency) {
      envelope.gain.setTargetAtTime(0.0001, releaseAt, Math.max(0.006, stepLength * 0.07));
    }
  };

  AcidAudio.prototype.silence = function () {
    if (!this.context || !this.nodes) {
      return;
    }
    var now = this.context.currentTime;
    var parameters = [
      this.nodes.oscillator.frequency,
      this.nodes.filter.frequency,
      this.nodes.filter.Q,
      this.nodes.envelope.gain
    ];
    parameters.forEach(function (parameter) {
      if (typeof parameter.cancelAndHoldAtTime === "function") {
        parameter.cancelAndHoldAtTime(now);
      } else {
        var value = parameter.value;
        parameter.cancelScheduledValues(now);
        parameter.setValueAtTime(value, now);
      }
    });
    this.nodes.envelope.gain.setTargetAtTime(0.0001, now, 0.006);
  };

  AcidAudio.prototype.getLevel = function () {
    if (!this.nodes) {
      return 0;
    }
    var data = this.nodes.meterData;
    var sum = 0;
    var index;
    this.nodes.analyser.getByteTimeDomainData(data);
    for (index = 0; index < data.length; index += 1) {
      var sample = (data[index] - 128) / 128;
      sum += sample * sample;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 2.8);
  };

  var API = {
    AcidAudio: AcidAudio,
    makeDriveCurve: makeDriveCurve
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  globalThis.TB03Audio = API;
}());
