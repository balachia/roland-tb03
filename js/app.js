(function () {
  "use strict";

  var Core = globalThis.TB03Core;
  var AudioAPI = globalThis.TB03Audio;
  if (!Core || !AudioAPI) {
    throw new Error("TB-03 Lab could not load its core scripts.");
  }

  var STORAGE_KEY = "tb03-lab-state-v1";
  var DEFAULT_SETTINGS = {
    waveform: "sawtooth",
    tuning: 0,
    cutoff: 64,
    resonance: 62,
    envMod: 74,
    decay: 46,
    accent: 62,
    tempo: 128,
    swing: 18,
    drive: 30,
    delayTime: 180,
    feedback: 28,
    volume: 74
  };
  var SETTING_LIMITS = {
    tuning: [-100, 100],
    cutoff: [0, 100],
    resonance: [0, 100],
    envMod: [0, 100],
    decay: [0, 100],
    accent: [0, 100],
    tempo: [40, 300],
    swing: [0, 75],
    drive: [0, 100],
    delayTime: [0, 700],
    feedback: [0, 80],
    volume: [0, 100]
  };

  function blankPattern() {
    return Core.normalizePattern({ length: 16, steps: [] });
  }

  function freshPatterns() {
    var patterns = [Core.createDefaultPattern()];
    while (patterns.length < 8) {
      patterns.push(blankPattern());
    }
    return patterns;
  }

  function normalizeSettings(candidate) {
    var source = candidate && typeof candidate === "object" ? candidate : {};
    var result = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
      if (key === "waveform") {
        result[key] = source[key] === "square" ? "square" : "sawtooth";
        return;
      }
      var limits = SETTING_LIMITS[key];
      var value = Number(source[key]);
      if (!Number.isFinite(value)) {
        value = DEFAULT_SETTINGS[key];
      }
      result[key] = Core.clamp(value, limits[0], limits[1]);
    });
    return result;
  }

  function loadState() {
    var result = {
      activeSlot: 0,
      patterns: freshPatterns(),
      settings: normalizeSettings(DEFAULT_SETTINGS)
    };
    try {
      var raw = globalThis.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return result;
      }
      var saved = JSON.parse(raw);
      if (saved && Array.isArray(saved.patterns)) {
        result.patterns = [];
        for (var index = 0; index < 8; index += 1) {
          result.patterns.push(saved.patterns[index]
            ? Core.normalizePattern(saved.patterns[index])
            : blankPattern());
        }
      }
      result.activeSlot = Math.round(Core.clamp(saved.activeSlot || 0, 0, 7));
      result.settings = normalizeSettings(saved.settings);
    } catch (error) {
      // Storage may be blocked or contain an older/corrupt value; defaults remain usable.
    }
    return result;
  }

  function boot() {
    var state = loadState();
    var audio = new AudioAPI.AcidAudio(Core);
    var selectedStep = 0;
    var playhead = -1;
    var nextPosition = 0;
    var nextNoteTime = 0;
    var slidePending = false;
    var playing = false;
    var schedulerId = null;
    var startGeneration = 0;
    var visualTimers = new Set();
    var root = document.getElementById("instrument");
    var stepGrid = document.getElementById("step-grid");
    var notePad = document.getElementById("note-pad");
    var slotRow = document.getElementById("slot-row");
    var statusText = document.getElementById("status-text");
    var audioState = document.getElementById("audio-state");
    var patternReadout = document.getElementById("pattern-readout");
    var stepReadout = document.getElementById("step-readout");
    var tempoReadout = document.getElementById("tempo-readout");
    var octaveReadout = document.getElementById("octave-readout");
    var lengthControl = document.getElementById("pattern-length");
    var lengthReadout = document.getElementById("length-readout");
    var restButton = document.getElementById("rest-step");
    var accentButton = document.getElementById("accent-step");
    var slideButton = document.getElementById("slide-step");
    var startButton = document.getElementById("start-transport");
    var stopButton = document.getElementById("stop-transport");
    var meterFill = document.getElementById("meter-fill");

    function currentPattern() {
      return state.patterns[state.activeSlot];
    }

    function setStatus(message, tone) {
      statusText.textContent = message;
      root.dataset.tone = tone || "idle";
    }

    function audioSettings() {
      return {
        waveform: state.settings.waveform,
        cutoff: state.settings.cutoff / 100,
        resonance: state.settings.resonance / 100,
        envMod: state.settings.envMod / 100,
        decay: state.settings.decay / 100,
        accent: state.settings.accent / 100,
        drive: state.settings.drive / 100,
        delayTime: state.settings.delayTime / 1000,
        feedback: state.settings.feedback / 100,
        volume: state.settings.volume / 100
      };
    }

    function saveState() {
      try {
        globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          activeSlot: state.activeSlot,
          patterns: state.patterns,
          settings: state.settings
        }));
        return true;
      } catch (error) {
        setStatus("Storage unavailable — this session will not persist", "warn");
        return false;
      }
    }

    function patternHasNotes(pattern) {
      return pattern.steps.some(function (step, index) {
        return index < pattern.length && !step.rest;
      });
    }

    function createButton(className, text) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.textContent = text;
      return button;
    }

    function buildPatternSlots() {
      for (var index = 0; index < 8; index += 1) {
        var button = createButton("slot-button", "P" + (index + 1));
        button.dataset.slot = String(index);
        button.setAttribute("aria-label", "Load pattern " + (index + 1));
        slotRow.appendChild(button);
      }
    }

    function buildNotePad() {
      Core.NOTE_NAMES.forEach(function (note) {
        var button = createButton("note-button" + (note.includes("#") ? " is-sharp" : ""), note);
        button.dataset.note = note;
        button.setAttribute("aria-label", "Enter " + note + " and select next step");
        notePad.appendChild(button);
      });
    }

    function stepDescription(step, index) {
      var details = step.rest ? "rest" : step.note + step.octave;
      if (step.accent) {
        details += ", accent";
      }
      if (step.slide) {
        details += ", slide";
      }
      if (index >= currentPattern().length) {
        details += ", outside current pattern length";
      }
      return "Step " + (index + 1) + ", " + details;
    }

    function renderSteps() {
      var pattern = currentPattern();
      var fragment = document.createDocumentFragment();
      pattern.steps.forEach(function (step, index) {
        var button = createButton("step-button", "");
        var number = document.createElement("span");
        var note = document.createElement("span");
        var flags = document.createElement("span");
        button.dataset.index = String(index);
        button.classList.toggle("is-selected", index === selectedStep);
        button.classList.toggle("is-playing", index === playhead);
        button.classList.toggle("is-rest", step.rest);
        button.classList.toggle("is-accent", step.accent);
        button.classList.toggle("has-slide", step.slide);
        button.classList.toggle("is-outside", index >= pattern.length);
        button.setAttribute("aria-pressed", String(index === selectedStep));
        button.setAttribute("aria-label", stepDescription(step, index));
        number.className = "step-number";
        number.textContent = String(index + 1).padStart(2, "0");
        note.className = "step-note";
        note.textContent = step.rest ? "—" : step.note + step.octave;
        flags.className = "step-flags";
        flags.textContent = (step.accent ? "A" : "·") + " " + (step.slide ? "S" : "·");
        button.appendChild(number);
        button.appendChild(note);
        button.appendChild(flags);
        fragment.appendChild(button);
      });
      stepGrid.replaceChildren(fragment);
    }

    function renderSlots() {
      slotRow.querySelectorAll("[data-slot]").forEach(function (button) {
        var slot = Number(button.dataset.slot);
        var active = slot === state.activeSlot;
        button.classList.toggle("is-active", active);
        button.classList.toggle("has-data", patternHasNotes(state.patterns[slot]));
        button.setAttribute("aria-pressed", String(active));
      });
    }

    function renderEditor() {
      var pattern = currentPattern();
      var step = pattern.steps[selectedStep];
      stepReadout.textContent = String(selectedStep + 1).padStart(2, "0");
      patternReadout.textContent = "P" + (state.activeSlot + 1);
      octaveReadout.textContent = String(step.octave);
      lengthControl.value = String(pattern.length);
      lengthReadout.textContent = String(pattern.length);
      restButton.classList.toggle("is-active", step.rest);
      restButton.setAttribute("aria-pressed", String(step.rest));
      accentButton.classList.toggle("is-active", step.accent);
      accentButton.setAttribute("aria-pressed", String(step.accent));
      slideButton.classList.toggle("is-active", step.slide);
      slideButton.setAttribute("aria-pressed", String(step.slide));
      notePad.querySelectorAll("[data-note]").forEach(function (button) {
        var active = !step.rest && button.dataset.note === step.note;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }

    function formatSetting(key, value) {
      if (key === "tuning") {
        return (value > 0 ? "+" : "") + Math.round(value) + " ct";
      }
      if (key === "tempo") {
        return Math.round(value) + " BPM";
      }
      if (key === "delayTime") {
        return Math.round(value) + " ms";
      }
      return Math.round(value) + "%";
    }

    function renderSettings() {
      document.querySelectorAll("[data-setting]").forEach(function (input) {
        var key = input.dataset.setting;
        var value = state.settings[key];
        var limits = SETTING_LIMITS[key];
        var proportion = (value - limits[0]) / (limits[1] - limits[0]);
        input.value = String(value);
        input.setAttribute("aria-valuetext", formatSetting(key, value));
        input.closest(".dial").style.setProperty("--dial-angle", (-135 + (proportion * 270)) + "deg");
        var output = document.querySelector("[data-output-for='" + key + "']");
        if (output) {
          output.textContent = formatSetting(key, value);
        }
      });
      document.querySelectorAll("[data-waveform]").forEach(function (button) {
        var active = button.dataset.waveform === state.settings.waveform;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      tempoReadout.textContent = String(Math.round(state.settings.tempo));
      audio.updateSettings(audioSettings());
    }

    function renderTransport() {
      startButton.disabled = playing;
      stopButton.disabled = !playing;
      startButton.classList.toggle("is-active", playing);
      root.classList.toggle("is-running", playing);
    }

    function renderAll() {
      renderSteps();
      renderSlots();
      renderEditor();
      renderSettings();
      renderTransport();
    }

    function selectStep(index) {
      selectedStep = ((Math.round(index) % 16) + 16) % 16;
      renderSteps();
      renderEditor();
    }

    function replaceSelectedStep(changes) {
      var pattern = currentPattern();
      pattern.steps[selectedStep] = Core.normalizeStep(Object.assign({}, pattern.steps[selectedStep], changes));
      saveState();
    }

    function previewStep(index) {
      var pattern = currentPattern();
      var event = Core.createStepEvent(pattern, index, state.settings.tuning);
      if (event.rest) {
        return;
      }
      event.slideFromPrevious = false;
      event.slideToFrequency = null;
      audio.ensureStarted().then(function () {
        audioState.textContent = "READY";
        audio.updateSettings(audioSettings());
        audio.scheduleStep(event, audio.now() + 0.012, 0.2);
      }).catch(function (error) {
        audioState.textContent = "UNAVAILABLE";
        setStatus(error.message, "warn");
      });
    }

    function enterNote(note) {
      var enteredIndex = selectedStep;
      replaceSelectedStep({ note: note, rest: false });
      previewStep(enteredIndex);
      selectedStep = (selectedStep + 1) % 16;
      renderSteps();
      renderEditor();
      setStatus("Note entered — advanced to step " + (selectedStep + 1), "edit");
    }

    function enterRest() {
      replaceSelectedStep({ rest: true, slide: false });
      selectedStep = (selectedStep + 1) % 16;
      renderSteps();
      renderSlots();
      renderEditor();
      setStatus("Rest entered — advanced to step " + (selectedStep + 1), "edit");
    }

    function adjustOctave(amount) {
      var step = currentPattern().steps[selectedStep];
      replaceSelectedStep({ octave: Core.clamp(step.octave + amount, 1, 4) });
      renderSteps();
      renderEditor();
      setStatus("Step octave set to " + currentPattern().steps[selectedStep].octave, "edit");
    }

    function toggleFlag(flag) {
      var step = currentPattern().steps[selectedStep];
      var change = {};
      change[flag] = !step[flag];
      replaceSelectedStep(change);
      renderSteps();
      renderSlots();
      renderEditor();
      setStatus((flag === "accent" ? "Accent" : "Slide") + (change[flag] ? " on" : " off"), "edit");
    }

    function clearVisualTimers() {
      visualTimers.forEach(function (timer) {
        globalThis.clearTimeout(timer);
      });
      visualTimers.clear();
    }

    function queuePlayhead(index, when) {
      var delay = Math.max(0, (when - audio.now()) * 1000);
      var timer = globalThis.setTimeout(function () {
        visualTimers.delete(timer);
        if (playing) {
          playhead = index;
          renderSteps();
        }
      }, delay);
      visualTimers.add(timer);
    }

    function schedulerTick() {
      if (!playing || !audio.context) {
        return;
      }
      var now = audio.now();
      if (nextNoteTime < now - 0.12) {
        nextNoteTime = now + 0.035;
      }
      var scheduled = 0;
      while (nextNoteTime < now + 0.12 && scheduled < 32) {
        var pattern = currentPattern();
        if (nextPosition >= pattern.length) {
          nextPosition = 0;
        }
        var duration = Core.stepDuration(state.settings.tempo, state.settings.swing / 100, nextPosition);
        var event = Core.createStepEvent(pattern, nextPosition, state.settings.tuning);
        event.slideFromPrevious = event.slideFromPrevious && slidePending;
        audio.scheduleStep(event, nextNoteTime, duration);
        slidePending = Boolean(event.slideToFrequency);
        queuePlayhead(nextPosition, nextNoteTime);
        nextNoteTime += duration;
        nextPosition = Core.nextStep(nextPosition, pattern.length);
        scheduled += 1;
      }
    }

    function startTransport() {
      if (playing) {
        return;
      }
      var generation = ++startGeneration;
      setStatus("Waking audio…", "start");
      audio.ensureStarted().then(function () {
        if (generation !== startGeneration) {
          return;
        }
        audioState.textContent = "READY";
        audio.updateSettings(audioSettings());
        playing = true;
        playhead = -1;
        nextPosition = 0;
        slidePending = false;
        nextNoteTime = audio.now() + 0.055;
        schedulerTick();
        schedulerId = globalThis.setInterval(schedulerTick, 25);
        renderTransport();
        setStatus("Sequencer running", "start");
      }).catch(function (error) {
        audioState.textContent = "UNAVAILABLE";
        setStatus(error.message, "warn");
        renderTransport();
      });
    }

    function stopTransport() {
      startGeneration += 1;
      playing = false;
      if (schedulerId !== null) {
        globalThis.clearInterval(schedulerId);
        schedulerId = null;
      }
      clearVisualTimers();
      audio.silence();
      playhead = -1;
      slidePending = false;
      renderSteps();
      renderTransport();
      setStatus("Sequencer stopped", "idle");
    }

    function resetPatternQueue() {
      nextPosition = 0;
      slidePending = false;
      playhead = -1;
      if (playing) {
        clearVisualTimers();
        audio.silence();
        nextNoteTime = audio.now() + 0.04;
        schedulerTick();
      }
    }

    function switchPattern(slot) {
      state.activeSlot = Math.round(Core.clamp(slot, 0, 7));
      selectedStep = 0;
      resetPatternQueue();
      saveState();
      renderAll();
      setStatus("Pattern " + (state.activeSlot + 1) + " loaded", "edit");
    }

    function clearPattern() {
      var length = currentPattern().length;
      state.patterns[state.activeSlot] = Core.normalizePattern({ length: length, steps: [] });
      selectedStep = 0;
      resetPatternQueue();
      saveState();
      renderAll();
      setStatus("Pattern cleared to rests", "edit");
    }

    function randomizePattern() {
      state.patterns[state.activeSlot] = Core.randomizePattern(currentPattern());
      selectedStep = 0;
      resetPatternQueue();
      saveState();
      renderAll();
      setStatus("Acid pattern randomized", "edit");
    }

    function updateSetting(input) {
      var key = input.dataset.setting;
      var limits = SETTING_LIMITS[key];
      state.settings[key] = Core.clamp(Number(input.value), limits[0], limits[1]);
      renderSettings();
      saveState();
    }

    stepGrid.addEventListener("click", function (event) {
      var button = event.target.closest("[data-index]");
      if (button) {
        selectStep(Number(button.dataset.index));
        setStatus("Editing step " + (selectedStep + 1), "edit");
      }
    });
    notePad.addEventListener("click", function (event) {
      var button = event.target.closest("[data-note]");
      if (button) {
        enterNote(button.dataset.note);
      }
    });
    slotRow.addEventListener("click", function (event) {
      var button = event.target.closest("[data-slot]");
      if (button) {
        switchPattern(Number(button.dataset.slot));
      }
    });
    document.getElementById("octave-down").addEventListener("click", function () {
      adjustOctave(-1);
    });
    document.getElementById("octave-up").addEventListener("click", function () {
      adjustOctave(1);
    });
    restButton.addEventListener("click", enterRest);
    accentButton.addEventListener("click", function () {
      toggleFlag("accent");
    });
    slideButton.addEventListener("click", function () {
      toggleFlag("slide");
    });
    lengthControl.addEventListener("input", function () {
      currentPattern().length = Core.normalizePatternLength(lengthControl.value);
      if (nextPosition >= currentPattern().length) {
        nextPosition = 0;
      }
      saveState();
      renderSteps();
      renderEditor();
      setStatus("Pattern length: " + currentPattern().length + " steps", "edit");
    });
    startButton.addEventListener("click", startTransport);
    stopButton.addEventListener("click", stopTransport);
    document.getElementById("clear-pattern").addEventListener("click", clearPattern);
    document.getElementById("random-pattern").addEventListener("click", randomizePattern);
    document.querySelectorAll("[data-setting]").forEach(function (input) {
      input.addEventListener("input", function () {
        updateSetting(input);
      });
    });
    document.querySelectorAll("[data-waveform]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.settings.waveform = button.dataset.waveform;
        renderSettings();
        saveState();
        setStatus(button.textContent + " wave selected", "edit");
      });
    });

    var pianoKeys = {
      a: "C",
      w: "C#",
      s: "D",
      e: "D#",
      d: "E",
      f: "F",
      t: "F#",
      g: "G",
      y: "G#",
      h: "A",
      u: "A#",
      j: "B"
    };
    document.addEventListener("keydown", function (event) {
      var target = event.target;
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if ((typeof target.closest === "function" && target.closest(
        "input, button, select, textarea, summary, [contenteditable='true']"
      )) || target.isContentEditable) {
        return;
      }
      var key = event.key.toLowerCase();
      var handled = true;
      if (pianoKeys[key]) {
        enterNote(pianoKeys[key]);
      } else if (event.code === "Space") {
        startTransport();
      } else if (event.key === "ArrowLeft") {
        selectStep(selectedStep - 1);
      } else if (event.key === "ArrowRight") {
        selectStep(selectedStep + 1);
      } else if (key === "r") {
        enterRest();
      } else if (key === "x") {
        toggleFlag("accent");
      } else if (key === "l") {
        toggleFlag("slide");
      } else if (event.key === "[") {
        adjustOctave(-1);
      } else if (event.key === "]") {
        adjustOctave(1);
      } else if (event.code.indexOf("Digit") === 0 && Number(event.key) >= 1 && Number(event.key) <= 8) {
        switchPattern(Number(event.key) - 1);
      } else if (event.key === "Escape") {
        stopTransport();
      } else {
        handled = false;
      }
      if (handled) {
        event.preventDefault();
      }
    });

    function animateMeter() {
      meterFill.style.setProperty("--meter-level", String(audio.getLevel()));
      globalThis.requestAnimationFrame(animateMeter);
    }

    buildPatternSlots();
    buildNotePad();
    renderAll();
    if (!audio.isSupported()) {
      audioState.textContent = "UNSUPPORTED";
      setStatus("This browser does not expose Web Audio", "warn");
    } else {
      audioState.textContent = "SLEEPING";
      setStatus("Choose Start or enter a note to wake audio", "idle");
    }
    var readyMarker = document.createElement("span");
    readyMarker.id = "tb03-app-ready";
    readyMarker.hidden = true;
    readyMarker.textContent = "ready";
    root.appendChild(readyMarker);
    root.dataset.appReady = "true";
    if (globalThis.location.search.indexOf("smoke=1") === -1) {
      animateMeter();
    } else {
      meterFill.style.setProperty("--meter-level", "0");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}());
