(function () {
  "use strict";

  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var DEFAULT_STEPS = [
    ["E", 2, false, true, false],
    ["E", 2, false, false, true],
    ["G", 2, false, false, false],
    ["C", 2, true, false, false],
    ["E", 3, false, true, false],
    ["D", 3, false, false, false],
    ["B", 2, false, false, true],
    ["B", 2, false, false, false],
    ["E", 2, false, true, false],
    ["C", 2, true, false, false],
    ["G", 2, false, false, false],
    ["A", 2, false, true, true],
    ["B", 2, false, false, false],
    ["D", 3, false, false, false],
    ["E", 3, false, true, true],
    ["E", 2, false, false, false]
  ];
  var ACID_PITCHES = [40, 40, 43, 45, 47, 50, 52, 52, 55, 57];

  function noteNameToMidi(name, octave) {
    var pitch = NOTE_NAMES.indexOf(String(name).toUpperCase());
    if (pitch === -1 || !Number.isInteger(octave)) {
      throw new TypeError("Invalid note name or octave");
    }
    return ((octave + 1) * 12) + pitch;
  }

  function midiToNote(midi) {
    var note = Math.round(Number(midi));
    return {
      name: NOTE_NAMES[((note % 12) + 12) % 12],
      octave: Math.floor(note / 12) - 1
    };
  }

  function midiToFrequency(midi) {
    return 440 * Math.pow(2, (Number(midi) - 69) / 12);
  }

  function clamp(value, minimum, maximum) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return minimum;
    }
    return Math.min(maximum, Math.max(minimum, numeric));
  }

  function normalizePatternLength(length) {
    if (!Number.isFinite(Number(length))) {
      return 16;
    }
    return Math.round(clamp(length, 1, 16));
  }

  function nextStep(position, patternLength) {
    return (Math.max(0, Math.floor(Number(position))) + 1) % normalizePatternLength(patternLength);
  }

  function stepDuration(bpm, swing, position) {
    var base = 60 / clamp(bpm, 40, 300) / 4;
    var offset = base * clamp(swing, 0, 1) * 0.5;
    return base + (Number(position) % 2 === 0 ? offset : -offset);
  }

  function normalizeStep(step) {
    var source = step && typeof step === "object" ? step : {};
    var name = String(source.note || "C").toUpperCase();
    var octave = Number(source.octave);
    if (NOTE_NAMES.indexOf(name) === -1) {
      name = "C";
    }
    if (!Number.isFinite(octave)) {
      octave = 2;
    }
    return {
      note: name,
      octave: Math.round(clamp(octave, 1, 4)),
      rest: Boolean(source.rest),
      accent: Boolean(source.accent),
      slide: Boolean(source.slide)
    };
  }

  function normalizePattern(pattern) {
    var source = pattern && typeof pattern === "object" ? pattern : {};
    var sourceSteps = Array.isArray(source.steps) ? source.steps : [];
    var steps = [];
    var index;
    for (index = 0; index < 16; index += 1) {
      steps.push(normalizeStep(sourceSteps[index] || {
        note: "C",
        octave: 2,
        rest: true
      }));
    }
    return {
      version: 1,
      length: normalizePatternLength(source.length === undefined ? 16 : source.length),
      steps: steps
    };
  }

  function createDefaultPattern() {
    return normalizePattern({
      length: 16,
      steps: DEFAULT_STEPS.map(function (step) {
        return {
          note: step[0],
          octave: step[1],
          rest: step[2],
          accent: step[3],
          slide: step[4]
        };
      })
    });
  }

  function randomizePattern(pattern, random) {
    var source = normalizePattern(pattern);
    var rng = typeof random === "function" ? random : Math.random;
    var steps = [];
    var index;
    for (index = 0; index < 16; index += 1) {
      var choice = Math.floor(clamp(rng(), 0, 0.999999) * ACID_PITCHES.length);
      var note = midiToNote(ACID_PITCHES[choice]);
      var rest = rng() < 0.16;
      steps.push({
        note: note.name,
        octave: note.octave,
        rest: rest,
        accent: !rest && rng() < 0.3,
        slide: !rest && rng() < 0.24
      });
    }
    return normalizePattern({
      length: source.length,
      steps: steps
    });
  }

  function createStepEvent(pattern, position, tuningCents) {
    var normalized = normalizePattern(pattern);
    var index = Math.max(0, Math.floor(Number(position))) % normalized.length;
    var step = normalized.steps[index];
    var next = normalized.steps[nextStep(index, normalized.length)];
    var previousIndex = (index - 1 + normalized.length) % normalized.length;
    var previous = normalized.steps[previousIndex];
    var midi = noteNameToMidi(step.note, step.octave);
    var tune = clamp(tuningCents || 0, -1200, 1200) / 100;
    var slideTarget = step.slide && !step.rest && !next.rest
      ? midiToFrequency(noteNameToMidi(next.note, next.octave) + tune)
      : null;
    return {
      index: index,
      rest: step.rest,
      accent: step.accent,
      slide: step.slide,
      slideFromPrevious: previous.slide && !previous.rest && !step.rest,
      midi: midi,
      frequency: step.rest ? null : midiToFrequency(midi + tune),
      slideToFrequency: slideTarget
    };
  }

  var API = {
    NOTE_NAMES: NOTE_NAMES.slice(),
    noteNameToMidi: noteNameToMidi,
    midiToNote: midiToNote,
    midiToFrequency: midiToFrequency,
    clamp: clamp,
    normalizePatternLength: normalizePatternLength,
    nextStep: nextStep,
    stepDuration: stepDuration,
    normalizeStep: normalizeStep,
    normalizePattern: normalizePattern,
    createDefaultPattern: createDefaultPattern,
    randomizePattern: randomizePattern,
    createStepEvent: createStepEvent
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.TB03Core = API;
  }
}());
