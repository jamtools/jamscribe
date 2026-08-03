export type RecordingConfig = {
    inactivityTimeLimitSeconds: number;
    uploaderUrl: string;
};

export const initialRecordingConfig: RecordingConfig = {
    inactivityTimeLimitSeconds: 60,
    uploaderUrl: '',
};
