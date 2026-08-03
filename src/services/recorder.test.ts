import assert from 'node:assert/strict';
import test from 'node:test';
import {Buffer} from 'node:buffer';
import {Subject} from 'rxjs';

import type {MidiEventFull} from '@jamtools/core/modules/macro_module/macro_module_types';
import type {StateSupervisor} from 'springboard/services/states/shared_state_service';
import type {AudioRecorder, AudioRecordingConfig, AudioRecorderStopArgs, RecordedAudioFile} from './audio_types';
import {initialAudioRecordingConfig} from './audio_types';
import {MidiRecorderImpl, type FileSaver} from './recorder';
import type {RecordingConfig} from './recording_config';

const makeState = <T>(initialState: T): Pick<StateSupervisor<T>, 'getState' | 'setState'> => {
    let state = initialState;
    return {
        getState: () => state,
        setState: (stateOrCallback: T | ((currentState: T) => T)): T => {
            state = typeof stateOrCallback === 'function'
                ? (stateOrCallback as (currentState: T) => T)(state)
                : stateOrCallback;
            return state;
        },
    };
};

const makeMidiEvent = (deviceName: string): MidiEventFull => ({
    deviceInfo: {name: deviceName},
    event: {
        type: 'noteon',
        channel: 1,
        number: 60,
        velocity: 100,
    },
}) as MidiEventFull;

test('MidiRecorderImpl trims audio to last MIDI event plus tail padding before upload', async () => {
    const originalNow = globalThis.performance.now;
    const nowValues = [1_000, 4_500];
    Object.defineProperty(globalThis.performance, 'now', {
        configurable: true,
        value: () => nowValues.shift() ?? 4_500,
    });

    let stopArgs: AudioRecorderStopArgs | undefined;
    const stopped = new Promise<void>(resolve => {
        const audioRecorder: AudioRecorder = {
            start: async () => undefined,
            stop: async (args?: AudioRecorderStopArgs): Promise<RecordedAudioFile | null> => {
                stopArgs = args;
                resolve();
                return null;
            },
        };

        const inputEvents = new Subject<MidiEventFull>();
        const recorder = new MidiRecorderImpl(
            inputEvents,
            {log: () => undefined},
            {
                writeFile: (_fileName: string, _contentType: string, _buffer: Buffer) => undefined,
            } satisfies FileSaver,
            makeState<RecordingConfig>({inactivityTimeLimitSeconds: 0.001, uploaderUrl: ''}) as StateSupervisor<RecordingConfig>,
            makeState<AudioRecordingConfig>(initialAudioRecordingConfig) as StateSupervisor<AudioRecordingConfig>,
            audioRecorder,
        );

        recorder.initialize();
        inputEvents.next(makeMidiEvent('USB MIDI'));
        inputEvents.next(makeMidiEvent('USB MIDI'));
    });

    try {
        await stopped;
    } finally {
        Object.defineProperty(globalThis.performance, 'now', {
            configurable: true,
            value: originalNow,
        });
    }

    assert.equal(stopArgs?.trimDurationSeconds, 5.5);
});
