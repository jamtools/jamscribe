// TODO: useState isn't working for some reason
import React, {useState} from 'react';

import springboard from 'springboard';

import '@jamtools/core/modules/io/io_module';
import 'springboard/modules/files/files_module';

import type {FileSaver, RecordingConfig} from './services/recorder';

// @platform "node"
import {uploadFile, uploadFileFromPath} from './services/upload_service';
import {convertMidiToAudio, isFluidSynthAvailable} from './services/fluidsynth_service';
// @platform end

let fileSaver: FileSaver | undefined;

// @platform "node"
import fs from 'node:fs';
// fileSaver will be set inside the module after recordingConfig is available
// @platform end

import {MidiRecorderImpl} from './services/recorder';
import {ConfigModal} from './components/ConfigModal';
import {MidiDevices} from './components/MidiDevices';
import './styles.css';

type DraftedFile = {
    name: string;
    buffer: Buffer;
}

type PendingUpload = {
    id: string;
    fileName: string;
    filePath: string;
    contentType: string;
    attempts: number;
    lastAttemptTime: number;
    error?: string;
};

const initialRecordingConfig: RecordingConfig = {
    inactivityTimeLimitSeconds: 60,
    uploaderUrl: '',
    soundFontPath: '',
};

springboard.registerModule('JamScribe', {}, async (moduleAPI) => {
    if (moduleAPI.deps.core.isMaestro()) {
        await moduleAPI.getModule('io').ensureListening();
    }

    const recordingConfig = await moduleAPI.statesAPI.createPersistentState('recordingConfig', initialRecordingConfig);
    const draftRecordingConfig = await moduleAPI.statesAPI.createSharedState('draftRecordingConfig', recordingConfig.getState());
    const pendingUploads = await moduleAPI.statesAPI.createPersistentState<PendingUpload[]>('pendingUploads', []);

    // @platform "node"
    // Check FluidSynth availability on startup
    let fluidSynthAvailable = false;
    isFluidSynthAvailable().then(available => {
        fluidSynthAvailable = available;
        if (available) {
            console.log('FluidSynth is available for MIDI-to-audio conversion');
        } else {
            console.log('FluidSynth not found - audio conversion will be skipped');
        }
    });

    fileSaver = {
        writeFile: async (fileName, buffer) => {
            if (!fs.existsSync('./midi_files')) {
                fs.mkdirSync('midi_files')
            }

            const filePath = `./midi_files/${fileName}`;
            await fs.promises.writeFile(filePath, buffer);

            const config = recordingConfig.getState();
            const uploaderUrl = config.uploaderUrl;

            // Try to convert MIDI to audio using FluidSynth
            let audioFilePath: string | undefined;
            let audioBuffer: Buffer | undefined;

            if (fluidSynthAvailable && config.soundFontPath) {
                const conversionResult = await convertMidiToAudio(filePath, {
                    soundFontPath: config.soundFontPath,
                });

                if (conversionResult.success && conversionResult.audioFilePath) {
                    audioFilePath = conversionResult.audioFilePath;
                    audioBuffer = await fs.promises.readFile(audioFilePath);
                    console.log(`Converted MIDI to audio: ${audioFilePath}`);
                } else {
                    console.error('MIDI to audio conversion failed:', conversionResult.error);
                }
            } else if (!fluidSynthAvailable) {
                console.log('Skipping audio conversion: FluidSynth not available');
            } else if (!config.soundFontPath) {
                console.log('Skipping audio conversion: No SoundFont configured');
            }

            // Upload MIDI file
            try {
                await uploadFile(fileName, 'audio/midi', buffer, uploaderUrl);
            } catch (error) {
                console.error('MIDI upload failed, queuing for retry:', error);

                // Add to pending uploads queue
                const uploadId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
                pendingUploads.setState(uploads => [
                    ...uploads,
                    {
                        id: uploadId,
                        fileName,
                        filePath,
                        contentType: 'audio/midi',
                        attempts: 1,
                        lastAttemptTime: Date.now(),
                        error: error instanceof Error ? error.message : String(error),
                    },
                ]);
            }

            // Upload audio file if conversion was successful
            if (audioFilePath && audioBuffer) {
                const audioFileName = fileName.replace('.mid', '.wav');
                try {
                    await uploadFile(audioFileName, 'audio/wav', audioBuffer, uploaderUrl);
                } catch (error) {
                    console.error('Audio upload failed, queuing for retry:', error);

                    const uploadId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
                    pendingUploads.setState(uploads => [
                        ...uploads,
                        {
                            id: uploadId,
                            fileName: audioFileName,
                            filePath: audioFilePath,
                            contentType: 'audio/wav',
                            attempts: 1,
                            lastAttemptTime: Date.now(),
                            error: error instanceof Error ? error.message : String(error),
                        },
                    ]);
                }
            }
        },
    };

    // Retry mechanism with exponential backoff
    const retryPendingUploads = async () => {
        const uploads = pendingUploads.getState();
        const now = Date.now();
        const MAX_ATTEMPTS = 10;

        for (const upload of uploads) {
            // Calculate exponential backoff: 1min, 2min, 4min, 8min, 16min, etc.
            const backoffMinutes = Math.pow(2, upload.attempts - 1);
            const backoffMs = backoffMinutes * 60 * 1000;
            const nextAttemptTime = upload.lastAttemptTime + backoffMs;

            // Skip if not time yet or max attempts reached
            if (now < nextAttemptTime || upload.attempts >= MAX_ATTEMPTS) {
                continue;
            }

            try {
                const uploaderUrl = recordingConfig.getState().uploaderUrl;
                if (!uploaderUrl) {
                    continue;
                }

                await uploadFileFromPath(upload.fileName, upload.contentType, upload.filePath, uploaderUrl);

                // Success! Remove from pending uploads
                pendingUploads.setState(uploads => uploads.filter(u => u.id !== upload.id));
                console.log(`Successfully uploaded ${upload.fileName} after ${upload.attempts} attempts`);
            } catch (error) {
                // Update attempt count and error
                pendingUploads.setState(uploads =>
                    uploads.map(u =>
                        u.id === upload.id
                            ? {
                                ...u,
                                attempts: u.attempts + 1,
                                lastAttemptTime: now,
                                error: error instanceof Error ? error.message : String(error),
                            }
                            : u
                    )
                );
                console.error(`Upload retry ${upload.attempts + 1} failed for ${upload.fileName}:`, error);

                // Remove from queue if max attempts reached
                if (upload.attempts + 1 >= MAX_ATTEMPTS) {
                    console.error(`Max retry attempts reached for ${upload.fileName}, removing from queue`);
                    pendingUploads.setState(uploads => uploads.filter(u => u.id !== upload.id));
                }
            }
        }
    };

    // Check for pending uploads every minute
    const retryInterval = setInterval(() => {
        retryPendingUploads().catch(err => {
            console.error('Error in retry mechanism:', err);
        });
    }, 60 * 1000);

    // Try to upload any pending uploads from previous sessions on startup
    setTimeout(() => {
        retryPendingUploads().catch(err => {
            console.error('Error in initial retry attempt:', err);
        });
    }, 5000); // Wait 5 seconds after startup
    // @platform end

    const logMessages = await moduleAPI.statesAPI.createSharedState<LogMessage[]>('logMessages', []);
    const draftedFiles = await moduleAPI.statesAPI.createSharedState<DraftedFile[]>('draftedFiles', []);

    const actions = moduleAPI.createActions({
        changeDraftInactivityTimeLimit: async ({limit}: {limit: number}) => {
            draftRecordingConfig.setState(c => ({...c, inactivityTimeLimitSeconds: limit}));
        },
        submitInactivityTimeLimit: async () => {
            recordingConfig.setState(c => ({...c, inactivityTimeLimitSeconds: draftRecordingConfig.getState().inactivityTimeLimitSeconds}));
        },
        changeDraftUploaderUrl: async ({url}: {url: string}) => {
            draftRecordingConfig.setState(c => ({...c, uploaderUrl: url}));
        },
        submitUploaderUrl: async () => {
            recordingConfig.setState(c => ({...c, uploaderUrl: draftRecordingConfig.getState().uploaderUrl}));
        },
        changeDraftSoundFontPath: async ({path}: {path: string}) => {
            draftRecordingConfig.setState(c => ({...c, soundFontPath: path}));
        },
        submitSoundFontPath: async () => {
            recordingConfig.setState(c => ({...c, soundFontPath: draftRecordingConfig.getState().soundFontPath}));
        },
    });

    moduleAPI.registerRoute('/', {}, () => (
        <Main
            logs={logMessages.useState()}
            availableFiles={draftedFiles.useState()}
            recordingConfig={recordingConfig.useState()}

            draftInactivityTimeLimit={draftRecordingConfig.useState().inactivityTimeLimitSeconds}
            onDraftInactivityTimeLimitChange={(limit: number) => actions.changeDraftInactivityTimeLimit({limit})}
            submitInactivityTimeLimitChange={() => actions.submitInactivityTimeLimit()}

            draftUploaderUrl={draftRecordingConfig.useState().uploaderUrl}
            onDraftUploaderUrlChange={(url: string) => actions.changeDraftUploaderUrl({url})}
            submitUploaderUrlChange={() => actions.submitUploaderUrl()}

            draftSoundFontPath={draftRecordingConfig.useState().soundFontPath}
            onDraftSoundFontPathChange={(path: string) => actions.changeDraftSoundFontPath({path})}
            submitSoundFontPathChange={() => actions.submitSoundFontPath()}
        />
    ));

    // bail out if this is a presentation-only client
    if (!moduleAPI.deps.core.isMaestro()) {
        return;
    }

    // default implementation of file saver
    if (!fileSaver) {
        fileSaver = {
            writeFile: async (fileName, buffer) => {
                const filesModule = moduleAPI.deps.module.moduleRegistry.getModule('Files');
                const file = new File([
                    new Blob([buffer.toString()])
                ], fileName);

                filesModule.uploadFile(file);
            },
        };
    }

    const log = (msg: string) => {
        console.log(msg);
        logMessages.setState(logs => {
            return [...logs, { message: msg, timestamp: new Date(), id: Math.random().toString().slice(2) }]
        });
    }

    const ioModule = moduleAPI.deps.module.moduleRegistry.getModule('io');

    ioModule.midiDeviceStatusSubject.subscribe(device => {
        const msg = `Device '${device.name}' ${device.status}`;
        log(msg);
    });

    const recorder = new MidiRecorderImpl(ioModule.midiInputSubject, {log}, fileSaver, recordingConfig);
    recorder.initialize();
});

type LogMessage = {
    id: string;
    message: string;
    timestamp: Date;
};

type MainProps = {
    logs: LogMessage[];
    availableFiles: DraftedFile[];

    recordingConfig: RecordingConfig;

    draftInactivityTimeLimit: number;
    onDraftInactivityTimeLimitChange: (newLimit: number) => void;
    submitInactivityTimeLimitChange: () => void;

    draftUploaderUrl: string;
    onDraftUploaderUrlChange: (newUrl: string) => void;
    submitUploaderUrlChange: () => void;

    draftSoundFontPath: string;
    onDraftSoundFontPathChange: (newPath: string) => void;
    submitSoundFontPathChange: () => void;
}

const Main = ({
    logs,
    availableFiles,
    recordingConfig,
    draftInactivityTimeLimit,
    onDraftInactivityTimeLimitChange,
    submitInactivityTimeLimitChange,
    draftUploaderUrl,
    onDraftUploaderUrlChange,
    submitUploaderUrlChange,
    draftSoundFontPath,
    onDraftSoundFontPathChange,
    submitSoundFontPathChange
}: MainProps) => {
    const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);

    return (
        <div className="app-container">
            <header className="app-header">
                <h1 className="app-title">🎵 JamScribe</h1>
                <button
                    type='button'
                    className='btn-primary'
                    onClick={() => setIsConfigModalOpen(true)}
                >
                    ⚙️ Settings
                </button>
            </header>

            <ConfigModal
                isOpen={isConfigModalOpen}
                onClose={() => setIsConfigModalOpen(false)}
                recordingConfig={recordingConfig}
                draftInactivityTimeLimit={draftInactivityTimeLimit}
                onDraftInactivityTimeLimitChange={onDraftInactivityTimeLimitChange}
                submitInactivityTimeLimitChange={submitInactivityTimeLimitChange}
                draftUploaderUrl={draftUploaderUrl}
                onDraftUploaderUrlChange={onDraftUploaderUrlChange}
                submitUploaderUrlChange={submitUploaderUrlChange}
                draftSoundFontPath={draftSoundFontPath}
                onDraftSoundFontPathChange={onDraftSoundFontPathChange}
                submitSoundFontPathChange={submitSoundFontPathChange}
            />

            <div className="main-grid">
                <div>
                    <MidiDevices />

                    <div className="card">
                        <div className="card-header">
                            <h2 className="card-title">📁 Recorded Files</h2>
                        </div>
                        {availableFiles.length > 0 ? (
                            <div className="files-grid">
                                {availableFiles.map(file => (
                                    <div
                                        key={file.name}
                                        className="file-item fade-in"
                                        onClick={() => {
                                            // Handle file click
                                        }}
                                    >
                                        <div className="file-icon">🎼</div>
                                        <div className="file-name">{file.name}</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="empty-state">
                                <div className="empty-state-icon">📭</div>
                                <p className="text-muted">No recordings yet. Start playing to record MIDI!</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="card logs-card">
                    <div className="card-header">
                        <h2 className="card-title">📋 Activity Log</h2>
                    </div>
                    <ul className="log-list">
                        {logs.length > 0 ? (
                            [...logs].reverse().map((logEntry) => {
                                const formatTime = (date: Date | string | number) => {
                                    const dateObj = new Date(date);
                                    const now = new Date();
                                    const isToday = dateObj.toDateString() === now.toDateString();
                                    const timeStr = dateObj.toLocaleTimeString('en-US', {
                                        hour: 'numeric',
                                        minute: '2-digit',
                                        hour12: true
                                    });

                                    if (isToday) {
                                        return timeStr;
                                    } else {
                                        const dateStr = dateObj.toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric'
                                        });
                                        return `${dateStr} ${timeStr}`;
                                    }
                                };

                                return (
                                    <li key={logEntry.id} className='log-item fade-in'>
                                        <span className="log-timestamp">{formatTime(logEntry.timestamp)}</span>
                                        <span className="log-message">{logEntry.message}</span>
                                    </li>
                                );
                            })
                        ) : (
                            <li className="log-item text-muted">
                                Waiting for activity...
                            </li>
                        )}
                    </ul>
                </div>
            </div>
        </div>
    );
}
