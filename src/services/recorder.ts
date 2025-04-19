import {writeMidi, MidiData} from 'midi-file';
import {Buffer} from 'buffer';
import {Subject} from 'rxjs';

import {MidiEventFull} from '@jamtools/core/modules/macro_module/macro_module_types';
import {StateSupervisor} from 'springboard/services/states/shared_state_service';

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
    writeFile: (fileName: string, buffer: Buffer) => void;
}

export type RecordingConfig = {
    inactivityTimeLimitSeconds: number;
}

export class MidiRecorderImpl {
    private deviceActivity: {[deviceName: string]: boolean} = {};
    private deviceTimeouts: {[deviceName: string]: NodeJS.Timeout | undefined} = {};
    private recordedEvents: {[deviceName: string]: LoggedMidiEvent[]} = {};
    // private INACTIVITY_LIMIT = FIVE_SECONDS;

    constructor(private onInputEvent: Subject<MidiEventFull>, private logger: Logger, private fileSaver: FileSaver, private recordingConfigState: StateSupervisor<RecordingConfig>) { }

    public initialize = () => {
        this.onInputEvent.subscribe(this.handleMidiEvent);
    };

    private handleMidiEvent = (midiEventFull: MidiEventFull) => {
        const deviceName = midiEventFull.deviceInfo.name;
        const event = midiEventFull.event;
        const time = performance.now();

        this.deviceActivity[deviceName] = true;

        // Store the event in memory
        if (!this.recordedEvents[deviceName]?.length) {
            this.logger.log(`Started recording ${deviceName}. Will stop after ${this.getInactivityLimit() / 1000} seconds`);
            this.recordedEvents[deviceName] = [];
            this.notifyUserOfStartRecording();
        }
        this.recordedEvents[deviceName].push({event: midiEventFull, time});

        this.resetDeviceInactivityTimerForDevice(deviceName);
    };

    // Stop recording and save all recorded MIDI events to a file
    private stopRecordingForAllDevices = () => {
        this.logger.log('Stopping all recordings due to inactivity...');
        Object.keys(this.recordedEvents).forEach((deviceName) => {
            this.saveRecordedMidiToFile(deviceName);

            // Clear events after saving
            this.recordedEvents[deviceName] = [];
        });
    };

    private getInactivityLimit = () => {
        return this.recordingConfigState.getState().inactivityTimeLimitSeconds * 1000;
    }

    private resetDeviceInactivityTimerForDevice = (deviceName: string) => {
        if (this.deviceTimeouts[deviceName]) {
            clearTimeout(this.deviceTimeouts[deviceName]);
        }

        this.deviceTimeouts[deviceName] = setTimeout(() => {
            this.logger.log(`Device ${deviceName} is now inactive.`);
            this.deviceActivity[deviceName] = false;

            const allInactive = Object.values(this.deviceActivity).every(isActive => !isActive);
            if (allInactive) {
                this.stopRecordingForAllDevices();
            }
        }, this.getInactivityLimit());
    };

    private generateFilename = (deviceName: string): string => {
        const timestamp = new Date().toISOString();
        const filename = `./midi_files/${deviceName}_${timestamp}_recording.mid`;
        return filename;
    };

    private saveRecordedMidiToFile = (deviceName: string) => {
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

        const midiFilePath = this.generateFilename(deviceName);

        // Write the MIDI file to disk
        try {
            const outputBuffer = Buffer.from(writeMidi(midiData));
            this.fileSaver.writeFile(midiFilePath, outputBuffer);
            this.logger.log(`MIDI file saved for device: ${deviceName} at ${midiFilePath}`);
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
