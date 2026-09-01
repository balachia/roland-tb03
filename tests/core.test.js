"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../js/core.js");

test("note names and MIDI notes round-trip across octaves", () => {
  assert.equal(Core.noteNameToMidi("C", 3), 48);
  assert.equal(Core.noteNameToMidi("F#", 4), 66);
  assert.deepEqual(Core.midiToNote(61), { name: "C#", octave: 4 });
  assert.equal(Core.midiToFrequency(69), 440);
});

test("sixteenth-note timing keeps each swung pair the same total length", () => {
  const straight = Core.stepDuration(120, 0, 0);
  const long = Core.stepDuration(120, 0.5, 0);
  const short = Core.stepDuration(120, 0.5, 1);

  assert.equal(straight, 0.125);
  assert.ok(long > straight);
  assert.ok(short < straight);
  assert.equal(long + short, straight * 2);
});

test("sequence position wraps at the selected pattern length", () => {
  assert.equal(Core.nextStep(4, 16), 5);
  assert.equal(Core.nextStep(15, 16), 0);
  assert.equal(Core.nextStep(7, 8), 0);
  assert.equal(Core.normalizePatternLength(99), 16);
  assert.equal(Core.normalizePatternLength(0), 1);
});

test("the default acid pattern is complete, varied, and safe to mutate", () => {
  const first = Core.createDefaultPattern();
  const second = Core.createDefaultPattern();

  assert.equal(first.length, 16);
  assert.equal(first.steps.length, 16);
  assert.ok(first.steps.some((step) => step.rest));
  assert.ok(first.steps.some((step) => step.accent));
  assert.ok(first.steps.some((step) => step.slide));
  first.steps[0].note = "A";
  assert.notEqual(first.steps[0].note, second.steps[0].note);
});

test("persisted pattern data is normalized to safe musical values", () => {
  const pattern = Core.normalizePattern({
    length: 99,
    steps: [
      { note: "H", octave: 80, rest: 0, accent: 1, slide: "" },
      { note: "g#", octave: 3, rest: true, accent: false, slide: true }
    ]
  });

  assert.equal(pattern.length, 16);
  assert.equal(pattern.steps.length, 16);
  assert.deepEqual(pattern.steps[0], {
    note: "C",
    octave: 4,
    rest: false,
    accent: true,
    slide: false
  });
  assert.deepEqual(pattern.steps[1], {
    note: "G#",
    octave: 3,
    rest: true,
    accent: false,
    slide: true
  });

  const malformed = Core.normalizePattern({ length: "not-a-number", steps: [] });
  assert.equal(malformed.length, 16);
  assert.equal(Core.clamp("not-a-number", 0, 7), 0);
});

test("randomization is deterministic with an injected generator and preserves length", () => {
  function seeded(seed) {
    let state = seed >>> 0;
    return () => {
      state = ((state * 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  const original = Core.createDefaultPattern();
  original.length = 7;
  const first = Core.randomizePattern(original, seeded(303));
  const second = Core.randomizePattern(original, seeded(303));

  assert.deepEqual(first, second);
  assert.equal(first.length, 7);
  assert.equal(first.steps.length, 16);
  assert.ok(first.steps.every((step) => Core.NOTE_NAMES.includes(step.note)));
  assert.ok(first.steps.every((step) => step.octave >= 1 && step.octave <= 4));
  assert.notDeepEqual(first.steps, original.steps);
});

test("step events apply tuning and expose only valid slide targets", () => {
  const pattern = Core.normalizePattern({
    length: 2,
    steps: [
      { note: "C", octave: 2, slide: true },
      { note: "D", octave: 2 }
    ]
  });
  const event = Core.createStepEvent(pattern, 0, 100);

  assert.equal(event.midi, 36);
  assert.equal(event.frequency, Core.midiToFrequency(37));
  assert.equal(event.slideToFrequency, Core.midiToFrequency(39));
  assert.equal(event.slideFromPrevious, false);
  assert.equal(Core.createStepEvent(pattern, 1, 0).slideFromPrevious, true);
  assert.equal(Core.createStepEvent(pattern, 1, 0).slideToFrequency, null);

  pattern.steps[1].rest = true;
  assert.equal(Core.createStepEvent(pattern, 0, 0).slideToFrequency, null);
});
