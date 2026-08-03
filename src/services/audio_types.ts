export type AudioDeviceInfo = {
    id: string;
    label: string;
    hardwareId?: string;
};

export type AudioRecordingConfig = {
    enabled: boolean;
    deviceId: string;
    deviceLabel: string;
    channel: number;
    channelCount: number;
    sampleRate: number;
};

export const initialAudioRecordingConfig: AudioRecordingConfig = {
    enabled: true,
    deviceId: 'default',
    deviceLabel: 'Default ALSA input',
    channel: 1,
    channelCount: 2,
    sampleRate: 44100,
};

export type RecordedAudioFile = {
    fileName: string;
    filePath: string;
    contentType: 'audio/wav';
};

export type AudioRecordingStatus = {
    state: 'idle' | 'recording' | 'stopping' | 'testing' | 'error';
    activeTakeId?: string;
    message?: string;
    audioFileName?: string;
};

export type AudioRecorderStartArgs = {
    takeId: string;
    config: AudioRecordingConfig;
};

export type AudioRecorderStopArgs = {
    trimDurationSeconds?: number;
};

export interface AudioRecorder {
    start(args: AudioRecorderStartArgs): Promise<void>;
    stop(args?: AudioRecorderStopArgs): Promise<RecordedAudioFile | null>;
}
