import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildArecordArgs,
    buildSoxArgs,
    buildSoxTrimArgs,
    generateAudioFileName,
    parseArecordListOutput,
    sanitizeRecordingFilePart,
} from './linux_audio_recorder';

test('parseArecordListOutput returns ALSA plughw device ids and labels by default', () => {
    const output = [
        '**** List of CAPTURE Hardware Devices ****',
        'card 1: USB [USB Audio], device 0: USB Audio [USB Audio]',
        '  Subdevices: 1/1',
        '  Subdevice #0: subdevice #0',
        'card 2: Codec [Codec Capture], device 3: bcm2835 Headphones [bcm2835 Headphones]',
    ].join('\n');

    assert.deepEqual(parseArecordListOutput(output), [
        {id: 'plughw:1,0', label: 'USB Audio (plughw:1,0)', hardwareId: 'hw:1,0'},
        {id: 'plughw:2,3', label: 'Codec Capture · bcm2835 Headphones (plughw:2,3)', hardwareId: 'hw:2,3'},
    ]);
});

test('parseArecordListOutput ignores duplicate capture device lines', () => {
    const output = [
        'card 1: USB [USB Audio], device 0: USB Audio [USB Audio]',
        'card 1: USB [USB Audio], device 0: USB Audio [USB Audio]',
    ].join('\n');

    assert.deepEqual(parseArecordListOutput(output), [
        {id: 'plughw:1,0', label: 'USB Audio (plughw:1,0)', hardwareId: 'hw:1,0'},
    ]);
});

test('parseArecordListOutput can expose strict hw ids for low-level debugging', () => {
    const output = 'card 1: USB [Scarlett 2i2 USB], device 0: USB Audio [USB Audio]';

    assert.deepEqual(parseArecordListOutput(output, {devicePrefix: 'hw'}), [
        {id: 'hw:1,0', label: 'Scarlett 2i2 USB · USB Audio (hw:1,0)', hardwareId: 'hw:1,0'},
    ]);
});

test('buildArecordArgs records bounded raw PCM with selected ALSA device settings', () => {
    assert.deepEqual(buildArecordArgs({
        deviceId: 'plughw:1,0',
        sampleRate: 48000,
        channelCount: 2,
        durationSeconds: 3,
    }), [
        '-D', 'plughw:1,0',
        '-f', 'S16_LE',
        '-r', '48000',
        '-c', '2',
        '-t', 'raw',
        '-d', '3',
    ]);
});

test('buildSoxArgs remixes one selected channel into a mono WAV', () => {
    assert.deepEqual(buildSoxArgs({
        sampleRate: 44100,
        channelCount: 2,
        selectedChannel: 2,
        outputFilePath: '/tmp/test.wav',
    }), [
        '-t', 'raw',
        '-b', '16',
        '-e', 'signed-integer',
        '-L',
        '-r', '44100',
        '-c', '2',
        '-',
        '/tmp/test.wav',
        'remix',
        '2',
    ]);
});

test('buildSoxTrimArgs trims a WAV to the requested duration', () => {
    assert.deepEqual(buildSoxTrimArgs({
        inputFilePath: '/tmp/input.wav',
        outputFilePath: '/tmp/output.wav',
        durationSeconds: 42.34567,
    }), [
        '/tmp/input.wav',
        '/tmp/output.wav',
        'trim',
        '0',
        '42.346',
    ]);
});

test('generateAudioFileName keeps take ids filesystem-safe and includes selected channel', () => {
    assert.equal(sanitizeRecordingFilePart(' 2026-08-02T20:40:30.765Z / USB Audio '), '2026-08-02T20_40_30.765Z_USB_Audio');
    assert.equal(generateAudioFileName('2026-08-02T20:40:30.765Z / USB Audio', 2), '2026-08-02T20_40_30.765Z_USB_Audio_audio_ch2.wav');
});
