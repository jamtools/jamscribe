import {writeMidi, MidiData} from 'midi-file';
import {Buffer} from 'buffer';
import {Subject} from 'rxjs';

import {MidiEventFull} from '@jamtools/core/modules/macro_module/macro_module_types';
import {StateSupervisor} from 'springboard/services/states/shared_state_service';
import type {AudioRecorder, AudioRecordingConfig, AudioRecordingStatus} from './audio_types';
import type {RecordingConfig} from './recording_config';
import {calculateAudioTrimDurationSeconds, DEFAULT_AUDIO_TAIL_PADDING_SECONDS} from './audio_trim';

const sendPushNotification = (data: {title: string, data: {url: string}}) => {

};

// const FIVE_SECONDS = 1000 * 5;
const TICKS_PER_BEAT = 480; // Standard MIDI timing resolution
const BPM = 120; // Default BPM

type LoggedMidiEvent = {
    event: MidiEventFull;
    time: number;
};

type Logger = {
    log: (msg: string) => void;
};

export type FileSaver = {
    writeFile: (fileName: string, contentType: string, buffer: Buffer) => void | Promise<void>;
    uploadFileFromPath?: (fileName: string, contentType: string, filePath: string) => void | Promise<void>;
}

export class MidiRecorderImpl {
    private deviceActivity: {[deviceName: string]: boolean} = {};
    private deviceTimeouts: {[deviceName: string]: NodeJS.Timeout | undefined} = {};
    private recordedEvents: {[deviceName: string]: LoggedMidiEvent[]} = {};
    private currentTakeId: string | null = null;
    private currentAudioStartTime: number | null = null;
    private lastMidiEventTime: number | null = null;
    // private INACTIVITY_LIMIT = FIVE_SECONDS;

    constructor(
        private onInputEvent: Subject<MidiEventFull>,
        private logger: Logger,
        private fileSaver: FileSaver,
        private recordingConfigState: StateSupervisor<RecordingConfig>,
        private audioRecordingConfigState: StateSupervisor<AudioRecordingConfig>,
        private audioRecorder?: AudioRecorder,
        private recordingStatusState?: StateSupervisor<AudioRecordingStatus>,
    ) { }

    private formatDeviceName(deviceName: string): string {
        // Truncate long device names and remove common suffixes
        const cleaned = deviceName.replace(/ Air Bluetooth$/, '').replace(/ Bluetooth$/, '');
        return cleaned.length > 20 ? cleaned.substring(0, 17) + '...' : cleaned;
    }

    private formatFilePath(filePath: string): string {
        // Show just the filename without the full path
        const fileName = filePath.split('/').pop() || filePath;
        return fileName.length > 30 ? '...' + fileName.substring(fileName.length - 27) : fileName;
    }

    private hasActiveRecordedEvents = (): boolean => {
        return Object.values(this.recordedEvents).some(events => events.length > 0);
    };

    private generateTakeId = (): string => {
        return new Date().toISOString().replace(/[:.]/g, '-');
    };

    public initialize = () => {
        this.onInputEvent.subscribe(this.handleMidiEvent);
    };

    private handleMidiEvent = (midiEventFull: MidiEventFull) => {
        const deviceName = midiEventFull.deviceInfo.name;
        const event = midiEventFull.event;
        const time = performance.now();
        const shouldStartTake = !this.hasActiveRecordedEvents();

        this.deviceActivity[deviceName] = true;

        if (shouldStartTake) {
            this.startTake(time);
        }
        this.lastMidiEventTime = time;

        // Store the event in memory
        if (!this.recordedEvents[deviceName]?.length) {
            this.logger.log(`Started recording ${this.formatDeviceName(deviceName)}`);
            this.recordedEvents[deviceName] = [];
            this.notifyUserOfStartRecording();
        }
        this.recordedEvents[deviceName].push({event: midiEventFull, time});

        this.resetDeviceInactivityTimerForDevice(deviceName);
    };

    private startTake = (startTime: number) => {
        const takeId = this.generateTakeId();
        this.currentTakeId = takeId;
        this.currentAudioStartTime = startTime;
        this.lastMidiEventTime = startTime;
        this.recordingStatusState?.setState({state: 'recording', activeTakeId: takeId, message: 'Recording MIDI and audio'});

        const audioConfig = this.audioRecordingConfigState.getState();
        if (!audioConfig.enabled || !this.audioRecorder) {
            return;
        }

        void this.audioRecorder.start({takeId, config: audioConfig}).catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.log(`Audio recording failed to start: ${message}`);
            this.recordingStatusState?.setState({state: 'error', activeTakeId: takeId, message});
        });
    };

    // Stop recording and save all recorded MIDI events to a file
    private stopRecordingForAllDevices = async () => {
        const takeId = this.currentTakeId;
        this.logger.log('Stopping recordings due to inactivity');
        this.recordingStatusState?.setState({state: 'stopping', activeTakeId: takeId ?? undefined, message: 'Saving recordings'});
        Object.keys(this.recordedEvents).forEach((deviceName) => {
            this.saveRecordedMidiToFile(deviceName, takeId ?? this.generateTakeId());

            // Clear events after saving
            this.recordedEvents[deviceName] = [];
        });

        if (this.audioRecorder) {
            try {
                const trimDurationSeconds = calculateAudioTrimDurationSeconds({
                    audioStartTime: this.currentAudioStartTime,
                    lastMidiEventTime: this.lastMidiEventTime,
                    tailPaddingSeconds: DEFAULT_AUDIO_TAIL_PADDING_SECONDS,
                });
                if (trimDurationSeconds !== undefined) {
                    this.logger.log(`Trimming audio to last MIDI event plus ${DEFAULT_AUDIO_TAIL_PADDING_SECONDS}s tail (${trimDurationSeconds.toFixed(3)}s)`);
                }
                const audioFile = await this.audioRecorder.stop({trimDurationSeconds});
                if (audioFile) {
                    if (!this.fileSaver.uploadFileFromPath) {
                        throw new Error('audio file upload is not available in this runtime');
                    }
                    await this.fileSaver.uploadFileFromPath(audioFile.fileName, audioFile.contentType, audioFile.filePath);
                    this.recordingStatusState?.setState({state: 'idle', message: 'Audio and MIDI saved', audioFileName: audioFile.fileName});
                } else {
                    this.recordingStatusState?.setState({state: 'idle', message: 'MIDI saved'});
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.log(`Error while saving audio recording: ${message}`);
                this.recordingStatusState?.setState({state: 'error', activeTakeId: takeId ?? undefined, message});
            }
        } else {
            this.recordingStatusState?.setState({state: 'idle', message: 'MIDI saved'});
        }

        this.currentTakeId = null;
        this.currentAudioStartTime = null;
        this.lastMidiEventTime = null;
    };

    private getInactivityLimit = () => {
        return this.recordingConfigState.getState().inactivityTimeLimitSeconds * 1000;
    }

    private resetDeviceInactivityTimerForDevice = (deviceName: string) => {
        if (this.deviceTimeouts[deviceName]) {
            clearTimeout(this.deviceTimeouts[deviceName]);
        }

        this.deviceTimeouts[deviceName] = setTimeout(() => {
            this.logger.log(`${this.formatDeviceName(deviceName)} inactive`);
            this.deviceActivity[deviceName] = false;

            const allInactive = Object.values(this.deviceActivity).every(isActive => !isActive);
            if (allInactive) {
                void this.stopRecordingForAllDevices();
            }
        }, this.getInactivityLimit());
    };

    private generateFilename = (deviceName: string, takeId: string): string => {
        const filename = `${takeId}_${deviceName}_recording.mid`;
        return filename;
    };

    private saveRecordedMidiToFile = (deviceName: string, takeId: string) => {
        const midiEvents = this.recordedEvents[deviceName];
        if (!midiEvents || midiEvents.length === 0) {
            this.logger.log(`No events recorded for device: ${deviceName}`);
            return;
        }

        // Convert the stored events to a MIDI file structure
        const midiData: MidiData = {
            header: {
                format: 1,
                numTracks: 1,
                ticksPerBeat: TICKS_PER_BEAT,
            },
            tracks: [[]],
        };

        let previousTime = midiEvents[0].time; // Set the initial time
        midiEvents.forEach(({event, time}) => {
            const deltaTime = this.calculateDeltaTime(previousTime, time);
            previousTime = time;

            const midiTrackEvent = this.convertMidiEventToMidiFileFormat(event, deltaTime);

            if (midiTrackEvent) {
                midiData.tracks[0].push(midiTrackEvent);
            }
        });

        const midiFilePath = this.generateFilename(deviceName, takeId);

        // Write the MIDI file to disk
        try {
            const outputBuffer = Buffer.from(writeMidi(midiData));
            this.fileSaver.writeFile(midiFilePath, 'audio/midi', outputBuffer);
            this.logger.log(`MIDI saved: ${this.formatFilePath(midiFilePath)}`);
            this.notifyUserOfNewRecordedSession();
        } catch (error) {
            this.logger.log(`Error while saving MIDI file for ${deviceName}: ${(error as Error).message}`);
        }
    };

    private notifyUserOfStartRecording = () => {
        sendPushNotification({
            title: 'Started recording',
            data: {
                url: 'http://jamscribe.local:1337',
            }
        });
    };

    private notifyUserOfNewRecordedSession = () => {
        sendPushNotification({
            title: 'Stopped recording',
            data: {
                url: 'http://jamscribe.local:1337',
            }
        });
    };

    // Convert the event to a format that `midi-file` expects
    private convertMidiEventToMidiFileFormat = (event: MidiEventFull, deltaTime: number): MidiData['tracks'][0][0] | null => {
        if (event.event.type === 'noteon') {
            return {
                deltaTime,
                type: 'noteOn',
                noteNumber: event.event.number,
                velocity: event.event.velocity || 64,
                channel: event.event.channel,
            };
        }
        if (event.event.type === 'noteoff') {
            return {
                deltaTime,
                type: 'noteOff',
                noteNumber: event.event.number,
                velocity: 0,
                channel: event.event.channel,
            };
        }
        if (event.event.type === 'cc') {
            return {
                deltaTime,
                type: 'controller',
                controllerType: event.event.number,
                value: event.event.value!,
                channel: event.event.channel,
            };
        }

        return null;
    };

    private calculateDeltaTime = (previousTime: number, currentTime: number): number => {
        const msPerBeat = (60 / BPM) * 1000;
        const msDifference = currentTime - previousTime;
        return Math.round((msDifference / msPerBeat) * TICKS_PER_BEAT);
    };
}
