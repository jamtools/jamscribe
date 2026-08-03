import assert from 'node:assert/strict';
import test from 'node:test';

import {calculateAudioTrimDurationSeconds} from './audio_trim';

test('calculateAudioTrimDurationSeconds returns active MIDI duration plus tail padding', () => {
    assert.equal(calculateAudioTrimDurationSeconds({
        audioStartTime: 1_000,
        lastMidiEventTime: 6_500,
        tailPaddingSeconds: 2,
    }), 7.5);
});

test('calculateAudioTrimDurationSeconds returns undefined when timing is unavailable', () => {
    assert.equal(calculateAudioTrimDurationSeconds({
        audioStartTime: null,
        lastMidiEventTime: 6_500,
    }), undefined);
    assert.equal(calculateAudioTrimDurationSeconds({
        audioStartTime: 1_000,
        lastMidiEventTime: null,
    }), undefined);
});

test('calculateAudioTrimDurationSeconds clamps negative timing and padding', () => {
    assert.equal(calculateAudioTrimDurationSeconds({
        audioStartTime: 6_500,
        lastMidiEventTime: 1_000,
        tailPaddingSeconds: -1,
    }), 0);
});
