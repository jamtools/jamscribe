import assert from 'node:assert/strict';
import test from 'node:test';

import {generateAudioFileName, parseArecordListOutput, sanitizeRecordingFilePart} from './linux_audio_recorder';

test('parseArecordListOutput returns stable ALSA hardware device ids and labels', () => {
    const output = [
        '**** List of CAPTURE Hardware Devices ****',
        'card 1: USB [USB Audio], device 0: USB Audio [USB Audio]',
        '  Subdevices: 1/1',
        '  Subdevice #0: subdevice #0',
        'card 2: Codec [Codec Capture], device 3: bcm2835 Headphones [bcm2835 Headphones]',
    ].join('\n');

    assert.deepEqual(parseArecordListOutput(output), [
        {id: 'hw:1,0', label: 'USB Audio (hw:1,0)'},
        {id: 'hw:2,3', label: 'Codec Capture · bcm2835 Headphones (hw:2,3)'},
    ]);
});

test('parseArecordListOutput ignores duplicate capture device lines', () => {
    const output = [
        'card 1: USB [USB Audio], device 0: USB Audio [USB Audio]',
        'card 1: USB [USB Audio], device 0: USB Audio [USB Audio]',
    ].join('\n');

    assert.deepEqual(parseArecordListOutput(output), [
        {id: 'hw:1,0', label: 'USB Audio (hw:1,0)'},
    ]);
});

test('generateAudioFileName keeps take ids filesystem-safe and includes selected channel', () => {
    assert.equal(sanitizeRecordingFilePart(' 2026-08-02T20:40:30.765Z / USB Audio '), '2026-08-02T20_40_30.765Z_USB_Audio');
    assert.equal(generateAudioFileName('2026-08-02T20:40:30.765Z / USB Audio', 2), '2026-08-02T20_40_30.765Z_USB_Audio_audio_ch2.wav');
});
