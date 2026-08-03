export const DEFAULT_AUDIO_TAIL_PADDING_SECONDS = 2;

export const calculateAudioTrimDurationSeconds = ({
    audioStartTime,
    lastMidiEventTime,
    tailPaddingSeconds = DEFAULT_AUDIO_TAIL_PADDING_SECONDS,
}: {
    audioStartTime: number | null;
    lastMidiEventTime: number | null;
    tailPaddingSeconds?: number;
}): number | undefined => {
    if (audioStartTime === null || lastMidiEventTime === null) {
        return undefined;
    }

    const activeDurationSeconds = Math.max(0, (lastMidiEventTime - audioStartTime) / 1000);
    return activeDurationSeconds + Math.max(0, tailPaddingSeconds);
};
