import type {AudioRecordingConfig} from './audio_types';

export type RecordingConfig = {
    inactivityTimeLimitSeconds: number;
    uploaderUrl: string;
    audio: AudioRecordingConfig;
};

export const initialAudioRecordingConfig: AudioRecordingConfig = {
    enabled: false,
    deviceId: 'default',
    deviceLabel: 'Default ALSA input',
    channel: 1,
    channelCount: 2,
    sampleRate: 44100,
};

export const initialRecordingConfig: RecordingConfig = {
    inactivityTimeLimitSeconds: 60,
    uploaderUrl: '',
    audio: initialAudioRecordingConfig,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const asFiniteNumber = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asString = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value : fallback;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;

export const normalizeRecordingConfig = (value: unknown): RecordingConfig => {
    const config = isRecord(value) ? value : {};
    const audio = isRecord(config.audio) ? config.audio : {};

    const channel = Math.max(1, Math.floor(asFiniteNumber(audio.channel, initialAudioRecordingConfig.channel)));
    const channelCount = Math.max(
        channel,
        Math.floor(asFiniteNumber(audio.channelCount, initialAudioRecordingConfig.channelCount)),
    );

    return {
        inactivityTimeLimitSeconds: Math.max(
            1,
            Math.floor(asFiniteNumber(
                config.inactivityTimeLimitSeconds,
                initialRecordingConfig.inactivityTimeLimitSeconds,
            )),
        ),
        uploaderUrl: asString(config.uploaderUrl, initialRecordingConfig.uploaderUrl),
        audio: {
            enabled: asBoolean(audio.enabled, initialAudioRecordingConfig.enabled),
            deviceId: asString(audio.deviceId, initialAudioRecordingConfig.deviceId) || initialAudioRecordingConfig.deviceId,
            deviceLabel: asString(audio.deviceLabel, initialAudioRecordingConfig.deviceLabel) || initialAudioRecordingConfig.deviceLabel,
            channel,
            channelCount,
            sampleRate: Math.max(
                8000,
                Math.floor(asFiniteNumber(audio.sampleRate, initialAudioRecordingConfig.sampleRate)),
            ),
        },
    };
};
