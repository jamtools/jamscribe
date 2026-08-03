import assert from 'node:assert/strict';
import test from 'node:test';

import {getAudioDevicesForDisplay, getStableAudioDeviceLabel, rebindAudioConfigToAvailableDevice} from './audio_device_selection';
import type {AudioRecordingConfig} from './audio_types';

const scarlettConfig: AudioRecordingConfig = {
    enabled: true,
    deviceId: 'plughw:1,0',
    deviceLabel: 'Scarlett 2i2 USB · USB Audio (plughw:1,0)',
    channel: 1,
    channelCount: 2,
    sampleRate: 44100,
};

test('getStableAudioDeviceLabel removes ALSA card numbering from labels', () => {
    assert.equal(
        getStableAudioDeviceLabel('Scarlett 2i2 USB · USB Audio (plughw:2,0) · hardware hw:2,0'),
        'Scarlett 2i2 USB · USB Audio',
    );
    assert.equal(
        getStableAudioDeviceLabel('Scarlett 2i2 USB · USB Audio (hw:1,0)'),
        'Scarlett 2i2 USB · USB Audio',
    );
});

test('rebindAudioConfigToAvailableDevice follows a selected interface after ALSA renumbers it', () => {
    assert.deepEqual(rebindAudioConfigToAvailableDevice(scarlettConfig, [
        {
            id: 'plughw:2,0',
            label: 'Scarlett 2i2 USB · USB Audio (plughw:2,0)',
            hardwareId: 'hw:2,0',
        },
    ]), {
        ...scarlettConfig,
        deviceId: 'plughw:2,0',
        deviceLabel: 'Scarlett 2i2 USB · USB Audio (plughw:2,0)',
    });
});

test('rebindAudioConfigToAvailableDevice leaves unmatched selected devices alone', () => {
    assert.equal(rebindAudioConfigToAvailableDevice(scarlettConfig, []), scarlettConfig);
});

test('rebindAudioConfigToAvailableDevice leaves default ALSA input alone', () => {
    const defaultConfig = {...scarlettConfig, deviceId: 'default', deviceLabel: 'Default ALSA input'};
    assert.equal(rebindAudioConfigToAvailableDevice(defaultConfig, [
        {
            id: 'plughw:2,0',
            label: 'Scarlett 2i2 USB · USB Audio (plughw:2,0)',
            hardwareId: 'hw:2,0',
        },
    ]), defaultConfig);
});

test('getAudioDevicesForDisplay shows selected device while ALSA list is still loading', () => {
    assert.deepEqual(getAudioDevicesForDisplay([], scarlettConfig), [{
        id: 'plughw:1,0',
        label: 'Scarlett 2i2 USB · USB Audio (plughw:1,0)',
    }]);
});

test('getAudioDevicesForDisplay preserves enumerated devices when available', () => {
    const devices = [{
        id: 'plughw:2,0',
        label: 'Scarlett 2i2 USB · USB Audio (plughw:2,0)',
        hardwareId: 'hw:2,0',
    }];

    assert.equal(getAudioDevicesForDisplay(devices, scarlettConfig), devices);
});
