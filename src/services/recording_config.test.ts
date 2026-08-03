import assert from 'node:assert/strict';
import test from 'node:test';

import {initialRecordingConfig, normalizeRecordingConfig} from './recording_config';

test('normalizeRecordingConfig fills audio defaults for pre-audio persisted config', () => {
    assert.deepEqual(normalizeRecordingConfig({
        inactivityTimeLimitSeconds: 90,
        uploaderUrl: 'https://example.com/upload',
    }), {
        inactivityTimeLimitSeconds: 90,
        uploaderUrl: 'https://example.com/upload',
        audio: initialRecordingConfig.audio,
    });
});

test('normalizeRecordingConfig preserves valid audio settings', () => {
    assert.deepEqual(normalizeRecordingConfig({
        inactivityTimeLimitSeconds: 30,
        uploaderUrl: '',
        audio: {
            enabled: true,
            deviceId: 'plughw:1,0',
            deviceLabel: 'Scarlett 2i2 (plughw:1,0)',
            channel: 2,
            channelCount: 2,
            sampleRate: 48000,
        },
    }), {
        inactivityTimeLimitSeconds: 30,
        uploaderUrl: '',
        audio: {
            enabled: true,
            deviceId: 'plughw:1,0',
            deviceLabel: 'Scarlett 2i2 (plughw:1,0)',
            channel: 2,
            channelCount: 2,
            sampleRate: 48000,
        },
    });
});

test('normalizeRecordingConfig clamps invalid numbers and keeps channel count valid', () => {
    assert.deepEqual(normalizeRecordingConfig({
        inactivityTimeLimitSeconds: 0,
        uploaderUrl: 42,
        audio: {
            enabled: 'yes',
            deviceId: '',
            deviceLabel: '',
            channel: 3,
            channelCount: 1,
            sampleRate: 4000,
        },
    }), {
        inactivityTimeLimitSeconds: 1,
        uploaderUrl: '',
        audio: {
            enabled: false,
            deviceId: 'default',
            deviceLabel: 'Default ALSA input',
            channel: 3,
            channelCount: 3,
            sampleRate: 8000,
        },
    });
});
