import assert from 'node:assert/strict';
import test from 'node:test';

import {initialAudioRecordingConfig} from './audio_types';
import {initialRecordingConfig} from './recording_config';

test('initialRecordingConfig contains only general recording settings', () => {
    assert.deepEqual(initialRecordingConfig, {
        inactivityTimeLimitSeconds: 60,
        uploaderUrl: '',
    });
});

test('initialAudioRecordingConfig contains the separate audio defaults', () => {
    assert.deepEqual(initialAudioRecordingConfig, {
        enabled: false,
        deviceId: 'default',
        deviceLabel: 'Default ALSA input',
        channel: 1,
        channelCount: 2,
        sampleRate: 44100,
    });
});
