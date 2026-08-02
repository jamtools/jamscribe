export type AudioDeviceInfo = {
    id: string;
    label: string;
};

export type AudioRecordingConfig = {
    enabled: boolean;
    deviceId: string;
    deviceLabel: string;
    channel: number;
    channelCount: number;
    sampleRate: number;
};

export type RecordedAudioFile = {
    fileName: string;
    filePath: string;
    contentType: 'audio/wav';
};

export type AudioRecordingStatus = {
    state: 'idle' | 'recording' | 'stopping' | 'error';
    activeTakeId?: string;
    message?: string;
    audioFileName?: string;
};

export type AudioRecorderStartArgs = {
    takeId: string;
    config: AudioRecordingConfig;
};

export interface AudioRecorder {
    start(args: AudioRecorderStartArgs): Promise<void>;
    stop(): Promise<RecordedAudioFile | null>;
}
