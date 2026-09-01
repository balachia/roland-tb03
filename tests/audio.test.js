"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const AudioAPI = require("../js/audio.js");
const Core = require("../js/core.js");

function fakeParam(initialValue) {
  return {
    value: initialValue,
    events: [],
    cancelScheduledValues(time) { this.events.push(["cancel", time]); },
    cancelAndHoldAtTime(time) { this.events.push(["hold", time]); },
    setValueAtTime(value, time) { this.events.push(["set", value, time]); },
    setTargetAtTime(value, time, constant) { this.events.push(["target", value, time, constant]); },
    exponentialRampToValueAtTime(value, time) { this.events.push(["exponential", value, time]); }
  };
}

test("zero drive is transparent while full drive bends the waveform", () => {
  const clean = AudioAPI.makeDriveCurve(0);
  const driven = AudioAPI.makeDriveCurve(1);
  const probe = Math.floor(clean.length * 0.75);
  const expected = ((probe * 2) / (clean.length - 1)) - 1;

  assert.ok(Math.abs(clean[probe] - expected) < 1e-6);
  assert.ok(driven[probe] > clean[probe]);
  assert.equal(clean.length, driven.length);
});

test("the scheduler reuses one voice, keeps slide destinations legato, and gates rests", () => {
  const audio = new AudioAPI.AcidAudio(Core);
  const frequency = fakeParam(110);
  const filterFrequency = fakeParam(800);
  const resonance = fakeParam(1);
  const gain = fakeParam(0.0001);
  audio.context = { currentTime: 0 };
  audio.nodes = {
    oscillator: { frequency, type: "sawtooth" },
    filter: { frequency: filterFrequency, Q: resonance },
    envelope: { gain }
  };

  assert.doesNotThrow(() => audio.scheduleStep({
    rest: false,
    accent: false,
    frequency: 110,
    slideFromPrevious: true,
    slideToFrequency: 123.47
  }, 0.1, 0.12));
  assert.equal(gain.events.some((event) => event[0] === "exponential"), false);

  audio.scheduleStep({ rest: true }, 0.22, 0.12);
  assert.ok(gain.events.some((event) => event[0] === "target" && event[1] === 0.0001));
});
